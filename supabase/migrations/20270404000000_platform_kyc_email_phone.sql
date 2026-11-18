-- ─────────────────────────────────────────────────────────────────────────────
-- PLATFORM-LEVEL KYC — email + phone, no external provider.
--
-- Product decision (Nov 2026): identity verification is performed entirely on
-- the platform. There is no Surepass/KYC vendor, no document upload, no PAN /
-- Aadhaar / GST collection, and no per-row provider verdict.
--
--   1. NAME  — self-declared legal name (2+ words), stored as profiles.kyc_name.
--   2. EMAIL — auth.users.email_confirmed_at (the confirmation link proves it).
--   3. PHONE — a one-time code issued BY THIS PLATFORM, verified server-side and
--              recorded as profiles.phone_verified_at with kyc_method
--              'platform_phone'. The code is hashed (pgcrypto) and never stored
--              in plain text.
--
-- Code delivery: while no SMS provider is connected, `platform_kyc_settings.
-- dev_mode` is ON and `request_phone_otp` returns the code so the screen can
-- show it (labelled clearly as development delivery). Flip dev_mode OFF with
-- `admin_set_platform_kyc_dev_mode(false)` once an SMS channel exists — the
-- code is then never returned by the API.
--
-- The only writer of verification_status stays `refresh_light_kyc`; this file
-- re-declares it so a platform-verified phone counts as the phone criterion.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Settings (single row) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_kyc_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  dev_mode BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

INSERT INTO public.platform_kyc_settings (id, dev_mode)
VALUES (TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_kyc_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_kyc_settings FROM PUBLIC, anon, authenticated;

-- ── One-time phone codes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.phone_verification_codes (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_verification_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_verification_codes FROM PUBLIC, anon, authenticated;

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_kyc_phone_normalize(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $normalize$
  SELECT nullif(regexp_replace(coalesce(p_phone, ''), '[\s()\-]', '', 'g'), '');
$normalize$;

CREATE OR REPLACE FUNCTION public.platform_kyc_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $is_admin$
  SELECT coalesce(
    (SELECT pp.is_admin FROM public.profiles_private pp WHERE pp.id = auth.uid()),
    false
  );
$is_admin$;

REVOKE ALL ON FUNCTION public.platform_kyc_is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_kyc_is_admin() TO authenticated, service_role;

-- ── Request a code ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_phone_otp(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $request_phone_otp$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := coalesce(auth.role(), '');
  v_phone TEXT := public.platform_kyc_phone_normalize(p_phone);
  v_code TEXT;
  v_existing public.phone_verification_codes%ROWTYPE;
  v_dev BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_phone IS NULL OR v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_phone');
  END IF;

  SELECT * INTO v_existing FROM public.phone_verification_codes WHERE user_id = v_uid;
  IF FOUND AND v_existing.sent_at > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_existing.sent_at + interval '60 seconds' - now()))))::int
    );
  END IF;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO public.phone_verification_codes (user_id, phone, code_hash, expires_at, attempts, sent_at)
  VALUES (v_uid, v_phone, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes', 0, now())
  ON CONFLICT (user_id) DO UPDATE
    SET phone = excluded.phone,
        code_hash = excluded.code_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        sent_at = now();

  SELECT dev_mode INTO v_dev FROM public.platform_kyc_settings WHERE id;
  v_dev := coalesce(v_dev, FALSE) OR v_role = 'service_role';

  RETURN jsonb_build_object(
    'success', true,
    'phone_masked', repeat('•', greatest(length(v_phone) - 4, 1)) || right(v_phone, 4),
    'expires_in_seconds', 600,
    'dev_mode', v_dev,
    'dev_code', CASE WHEN v_dev THEN v_code ELSE NULL END
  );
END;
$request_phone_otp$;

REVOKE ALL ON FUNCTION public.request_phone_otp(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_phone_otp(TEXT) TO authenticated, service_role;

-- ── Verify a code ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_phone_otp(p_phone TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $verify_phone_otp$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := coalesce(auth.role(), '');
  v_phone TEXT := public.platform_kyc_phone_normalize(p_phone);
  v_code TEXT := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_row public.phone_verification_codes%ROWTYPE;
  v_name TEXT;
  v_email_confirmed TIMESTAMPTZ;
  v_name_ok BOOLEAN;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_phone IS NULL OR v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_phone');
  END IF;
  IF length(v_code) <> 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  SELECT * INTO v_row FROM public.phone_verification_codes WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_code');
  END IF;
  IF v_row.phone <> v_phone THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone_mismatch');
  END IF;
  IF v_row.expires_at < now() THEN
    DELETE FROM public.phone_verification_codes WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'expired');
  END IF;
  IF v_row.attempts >= 5 THEN
    DELETE FROM public.phone_verification_codes WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'too_many_attempts');
  END IF;

  IF v_row.code_hash <> crypt(v_code, v_row.code_hash) THEN
    UPDATE public.phone_verification_codes SET attempts = attempts + 1 WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'wrong_code', 'attempts_left', greatest(0, 4 - v_row.attempts));
  END IF;

  DELETE FROM public.phone_verification_codes WHERE user_id = v_uid;

  UPDATE public.profiles
     SET phone_verified_at = now(),
         kyc_method = coalesce(kyc_method, 'platform_phone'),
         kyc_last_checked_at = now()
   WHERE id = v_uid;

  UPDATE public.profiles_private SET phone = v_phone WHERE id = v_uid;

  SELECT p.kyc_name INTO v_name FROM public.profiles p WHERE p.id = v_uid;
  SELECT u.email_confirmed_at INTO v_email_confirmed FROM auth.users u WHERE u.id = v_uid;

  v_name_ok := coalesce(array_length(regexp_split_to_array(btrim(coalesce(v_name, '')), '\s+'), 1), 0) >= 2;

  IF v_name_ok AND v_email_confirmed IS NOT NULL THEN
    PERFORM set_config('app.bypass_privilege_check', 'true', true);
    UPDATE public.profiles
       SET verification_status = 'verified',
           kyc_verified_at = coalesce(kyc_verified_at, now()),
           kyc_last_checked_at = now()
     WHERE id = v_uid;
    UPDATE public.freelancer_profiles
       SET verification_status = 'verified'
     WHERE user_id = v_uid
       AND verification_status IS DISTINCT FROM 'verified';
    PERFORM set_config('app.bypass_privilege_check', 'false', true);
  END IF;

  SELECT p.verification_status INTO v_status FROM public.profiles p WHERE p.id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'verified', v_status = 'verified',
    'phone_ok', true
  );
END;
$verify_phone_otp$;

REVOKE ALL ON FUNCTION public.verify_phone_otp(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_phone_otp(TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.request_phone_otp(TEXT) IS
  'Issues a platform one-time phone code (hashed, 10 minutes, one request per 60s). No external provider.';
COMMENT ON FUNCTION public.verify_phone_otp(TEXT, TEXT) IS
  'Verifies a platform phone code and records profiles.phone_verified_at with kyc_method = platform_phone.';

-- ── Platform KYC status (for the shared verification screen) ─────────────────
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

  SELECT u.email_confirmed_at, u.phone INTO v_email_confirmed, v_phone
    FROM auth.users u WHERE u.id = v_uid;

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

-- ── Admin: development delivery switch ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_platform_kyc_dev_mode(p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $admin_set_dev$
BEGIN
  IF NOT public.platform_kyc_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: admin access required');
  END IF;

  INSERT INTO public.platform_kyc_settings (id, dev_mode, updated_at, updated_by)
  VALUES (TRUE, coalesce(p_enabled, FALSE), now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET dev_mode = excluded.dev_mode,
        updated_at = now(),
        updated_by = excluded.updated_by;

  RETURN jsonb_build_object('success', true, 'dev_mode', coalesce(p_enabled, FALSE));
END;
$admin_set_dev$;

REVOKE ALL ON FUNCTION public.admin_set_platform_kyc_dev_mode(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_kyc_dev_mode(BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_platform_kyc_settings()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $admin_get_settings$
DECLARE
  v_dev BOOLEAN;
  v_updated TIMESTAMPTZ;
BEGIN
  IF NOT public.platform_kyc_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: admin access required');
  END IF;
  SELECT dev_mode, updated_at INTO v_dev, v_updated FROM public.platform_kyc_settings WHERE id;
  RETURN jsonb_build_object('success', true, 'dev_mode', coalesce(v_dev, FALSE), 'updated_at', v_updated);
END;
$admin_get_settings$;

REVOKE ALL ON FUNCTION public.admin_get_platform_kyc_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_platform_kyc_settings() TO authenticated, service_role;

-- ── refresh_light_kyc: platform phone counts as the phone criterion ──────────
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

  SELECT p.phone_verified_at INTO v_platform_phone_at
    FROM public.profiles p WHERE p.id = v_uid;

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
      WHEN v_phone IS NULL OR length(v_phone) < 4 THEN NULL
      ELSE repeat('•', greatest(length(v_phone) - 4, 1)) || right(v_phone, 4)
    END,
    'verified', v_status = 'verified'
  );
END;
$refresh_light_kyc$;

REVOKE ALL ON FUNCTION public.refresh_light_kyc(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_light_kyc(TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
