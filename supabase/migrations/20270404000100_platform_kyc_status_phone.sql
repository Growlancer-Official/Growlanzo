-- ─────────────────────────────────────────────────────────────────────────────
-- Platform KYC — show the verified phone on the status screen.
--
-- Bug (found in the 2026-11-18 live E2E run): after a phone was verified with a
-- platform code, the success summary rendered "Phone:" with nothing after it.
-- `get_platform_kyc_status` read `auth.users.phone`, but a platform code never
-- writes there: `verify_phone_otp` stores the number in
-- `profiles_private.phone`. The verified phone therefore existed and was
-- verifiable, just never displayed.
--
-- Fix: read the platform-verified number first and fall back to the auth
-- provider's phone (which is still valid for users who verified through the
-- provider). `refresh_light_kyc` gets the same treatment so its `phone_masked`
-- matches what the screen shows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_platform_kyc_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $get_platform_kyc_status$
DECLARE
  v_uid UUID := auth.uid();
  v_name TEXT;
  v_phone_at TIMESTAMPTZ;
  v_method TEXT;
  v_status TEXT;
  v_email_confirmed TIMESTAMPTZ;
  v_phone TEXT;
  v_dev BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.kyc_name, p.phone_verified_at, p.kyc_method, p.verification_status
    INTO v_name, v_phone_at, v_method, v_status
    FROM public.profiles p WHERE p.id = v_uid;

  -- Platform-verified number lives in profiles_private.phone; the auth row is
  -- only the fallback for provider-verified numbers.
  SELECT u.email_confirmed_at, coalesce(pp.phone, u.phone)
    INTO v_email_confirmed, v_phone
    FROM auth.users u
    LEFT JOIN public.profiles_private pp ON pp.id = u.id
   WHERE u.id = v_uid;

  SELECT dev_mode INTO v_dev FROM public.platform_kyc_settings WHERE id;

  RETURN jsonb_build_object(
    'status', coalesce(v_status, 'unverified'),
    'name', v_name,
    'name_ok', coalesce(array_length(regexp_split_to_array(btrim(coalesce(v_name, '')), '\s+'), 1), 0) >= 2,
    'email', (SELECT u.email FROM auth.users u WHERE u.id = v_uid),
    'email_ok', v_email_confirmed IS NOT NULL,
    'phone_masked', CASE
      WHEN v_phone IS NULL OR length(v_phone) < 4 THEN NULL
      ELSE repeat('•', greatest(length(v_phone) - 4, 1)) || right(v_phone, 4)
    END,
    'phone_ok', v_phone_at IS NOT NULL,
    'kyc_method', v_method,
    'dev_mode', coalesce(v_dev, FALSE)
  );
END;
$get_platform_kyc_status$;

REVOKE ALL ON FUNCTION public.get_platform_kyc_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_kyc_status() TO authenticated, service_role;

-- ── refresh_light_kyc: same phone source in its masked display ──────────────
CREATE OR REPLACE FUNCTION public.refresh_light_kyc(p_full_name TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $refresh_light_kyc$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := coalesce(auth.role(), '');
  v_name TEXT;
  v_words INTEGER;
  v_email_confirmed TIMESTAMPTZ;
  v_phone TEXT;
  v_phone_confirmed TIMESTAMPTZ;
  v_platform_phone_at TIMESTAMPTZ;
  v_platform_phone TEXT;
  v_name_ok BOOLEAN;
  v_email_ok BOOLEAN;
  v_phone_ok BOOLEAN;
  v_complete BOOLEAN;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_full_name IS NOT NULL THEN
    v_name := nullif(btrim(regexp_replace(p_full_name, '\s+', ' ', 'g')), '');
    IF v_name IS NULL OR length(v_name) < 3 THEN
      RAISE EXCEPTION 'enter your full name' USING ERRCODE = '22023';
    END IF;
    IF length(v_name) > 120 THEN
      RAISE EXCEPTION 'name is too long' USING ERRCODE = '22023';
    END IF;
    IF v_name !~ '^[A-Za-z][A-Za-z .''-]+$' THEN
      RAISE EXCEPTION 'name may only contain letters, spaces, hyphens and apostrophes'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.profiles
       SET kyc_name = v_name,
           name = coalesce(nullif(btrim(name), ''), v_name)
     WHERE id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile missing' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT p.kyc_name INTO v_name FROM public.profiles p WHERE p.id = v_uid;
  END IF;

  IF v_name IS NOT NULL THEN
    v_words := array_length(regexp_split_to_array(btrim(v_name), '\s+'), 1);
  ELSE
    v_words := 0;
  END IF;
  v_name_ok := coalesce(v_words, 0) >= 2;

  SELECT u.email_confirmed_at, u.phone, u.phone_confirmed_at
    INTO v_email_confirmed, v_phone, v_phone_confirmed
    FROM auth.users u
   WHERE u.id = v_uid;

  SELECT p.phone_verified_at, pp.phone
    INTO v_platform_phone_at, v_platform_phone
    FROM public.profiles p
    LEFT JOIN public.profiles_private pp ON pp.id = p.id
   WHERE p.id = v_uid;

  v_email_ok := v_email_confirmed IS NOT NULL;
  -- Phone is satisfied by EITHER the auth provider's OTP or a platform code.
  v_phone_ok := (v_phone_confirmed IS NOT NULL AND coalesce(v_phone, '') <> '')
             OR v_platform_phone_at IS NOT NULL;
  v_complete := v_name_ok AND v_email_ok AND v_phone_ok;

  PERFORM set_config('app.bypass_privilege_check', 'true', true);

  UPDATE public.profiles
     SET kyc_last_checked_at = now(),
         phone_verified_at = CASE
           WHEN v_platform_phone_at IS NOT NULL THEN v_platform_phone_at
           WHEN v_phone_confirmed IS NOT NULL THEN v_phone_confirmed
           ELSE phone_verified_at END,
         verification_status = CASE WHEN v_complete THEN 'verified' ELSE verification_status END,
         kyc_verified_at = CASE WHEN v_complete THEN coalesce(kyc_verified_at, now()) ELSE kyc_verified_at END,
         kyc_method = CASE WHEN v_complete THEN coalesce(kyc_method, 'platform_phone') ELSE kyc_method END
   WHERE id = v_uid;

  IF v_complete THEN
    UPDATE public.freelancer_profiles
       SET verification_status = 'verified'
     WHERE user_id = v_uid
       AND verification_status IS DISTINCT FROM 'verified';
  END IF;

  PERFORM set_config('app.bypass_privilege_check', 'false', true);

  SELECT p.verification_status INTO v_status FROM public.profiles p WHERE p.id = v_uid;

  RETURN jsonb_build_object(
    'status', v_status,
    'name', v_name,
    'name_ok', v_name_ok,
    'email_ok', v_email_ok,
    'phone_ok', v_phone_ok,
    'phone_masked', CASE
      WHEN coalesce(v_platform_phone, v_phone) IS NULL
        OR length(coalesce(v_platform_phone, v_phone)) < 4 THEN NULL
      ELSE repeat('•', greatest(length(coalesce(v_platform_phone, v_phone)) - 4, 1))
           || right(coalesce(v_platform_phone, v_phone), 4)
    END,
    'verified', v_status = 'verified'
  );
END;
$refresh_light_kyc$;

REVOKE ALL ON FUNCTION public.refresh_light_kyc(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_light_kyc(TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
