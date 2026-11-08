-- ─────────────────────────────────────────────────────────────────────────────
-- Referral anti-spam: FIVE invitations per calendar month (founder rule).
--
-- Why a second cap: the existing `v_cap := 20` inside
-- `award_referral_bonus_if_eligible` limits how many 10-coin BONUSES a referrer
-- can be paid in a month. It does NOT stop someone from recording hundreds of
-- referrals — those simply pay nothing and raise a `monthly_cap` review flag.
-- That is a spend guard, not a spam guard.
--
-- This migration adds the spam guard the product actually wants: a referrer may
-- record at most 5 referrals per calendar month. The check runs at INVITE time
-- (inside `process_referral`, before the row is inserted), so the 6th invited
-- person is never written to `referrals` and never inflates `referral_stats`.
-- The invited user's own signup is unaffected — they just do not carry an
-- attribution.
--
-- Idempotent: CREATE OR REPLACE only, no data changes, no drops.
-- Note: this file must be applied with `supabase db push`; it is repo-only
-- until that runs.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- ─── 1. Single source of truth for the limit ────────────────────────────────
-- The UI reads this number too, so the copy can never drift from enforcement.
CREATE OR REPLACE FUNCTION public.referral_monthly_invite_cap()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 5
$$;

REVOKE ALL ON FUNCTION public.referral_monthly_invite_cap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_monthly_invite_cap() TO authenticated, service_role;

-- ─── 2. How many referrals has this user recorded this calendar month? ──────
-- Counts every row regardless of status: a pending or expired referral still
-- consumed an invitation slot, so an abuser cannot reset by letting rows lapse.
CREATE OR REPLACE FUNCTION public.referral_invites_this_month(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::integer
    FROM public.referrals
   WHERE referrer_id = p_user_id
     AND created_at >= date_trunc('month', now())
$$;

REVOKE ALL ON FUNCTION public.referral_invites_this_month(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_invites_this_month(uuid) TO authenticated, service_role;

-- ─── 3. process_referral — same body as 20270204000000 + the monthly cap ────
CREATE OR REPLACE FUNCTION public.process_referral(
  p_referral_code text,
  p_new_user_id uuid,
  p_new_user_email text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_referrer_id UUID;
  v_referrer_code TEXT;
  v_referrer_role TEXT;
  v_referred_role TEXT;
  v_normalized TEXT := public.normalize_referral_code(p_referral_code);
  v_invites_this_month integer;
  v_invite_cap integer := public.referral_monthly_invite_cap();
BEGIN
  IF p_new_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF v_normalized = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'No referral code provided');
  END IF;

  IF p_new_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No user ID provided');
  END IF;

  SELECT pp.id, pp.referral_code, pr.role
    INTO v_referrer_id, v_referrer_code, v_referrer_role
  FROM public.profiles_private pp
  LEFT JOIN public.profiles pr ON pr.id = pp.id
  WHERE public.normalize_referral_code(pp.referral_code) = v_normalized
    AND pp.id != p_new_user_id
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  -- Same-side gate. Fail closed: an unresolvable role on either end rejects
  -- rather than recording a referral the payout gate would later expire.
  IF v_referrer_role IS DISTINCT FROM 'admin' THEN
    SELECT role INTO v_referred_role
      FROM public.profiles WHERE id = p_new_user_id;

    IF v_referrer_role IS NULL
       OR v_referred_role IS NULL
       OR v_referred_role != v_referrer_role THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',
        CASE
          WHEN v_referrer_role = 'freelancer'
            THEN 'This code belongs to a freelancer — freelancers can only refer other freelancers. Create a freelancer account to use it.'
          WHEN v_referrer_role = 'client'
            THEN 'This code belongs to a client — clients can only refer other clients. Create a client account to use it.'
          ELSE 'This referral code cannot be used with this account type.'
        END,
        'error_code', 'role_mismatch'
      );
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.referrals
    WHERE referrer_id = v_referrer_id AND referred_user_id = p_new_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already referred');
  END IF;

  -- ─── Monthly invite cap (spam protection) ────────────────────────────────
  -- Checked BEFORE the insert so the row never exists and referral_stats is
  -- never incremented. Deliberately checked after the duplicate/referrer
  -- lookups so an invalid code still reports the real reason.
  v_invites_this_month := public.referral_invites_this_month(v_referrer_id);

  IF v_invites_this_month >= v_invite_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'monthly_cap',
      'error', format(
        'This referral code has reached its monthly limit (%s invitations per month). The account was created without a referral.',
        v_invite_cap
      ),
      'cap', v_invite_cap,
      'used_this_month', v_invites_this_month
    );
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_user_id, referred_email, referral_code, status, bonus_claimed)
  VALUES (v_referrer_id, p_new_user_id, p_new_user_email, v_referrer_code, 'pending', false);

  INSERT INTO public.referral_stats (user_id, total_referrals, valid_referrals, points, level, updated_at)
  VALUES (v_referrer_id, 1, 0, 0, 1, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    total_referrals = COALESCE(referral_stats.total_referrals, 0) + 1,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'remaining_this_month', GREATEST(v_invite_cap - v_invites_this_month - 1, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_referral(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_referral(text, uuid, text) TO authenticated, service_role;

-- ─── 4. The cap must not be bypassable by a direct INSERT ──────────────────
-- `20260620000000` created `Users can insert referrals` WITH CHECK (true), and
-- `20270101000013` hardened only the UPDATE policy — so any authenticated user
-- could POST /rest/v1/referrals and record themselves as a referrer without
-- going through process_referral at all. A check inside the RPC alone is
-- therefore decorative. This trigger enforces the cap on every insert path.
CREATE OR REPLACE FUNCTION public.enforce_referral_monthly_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cap integer := public.referral_monthly_invite_cap();
  v_used integer;
BEGIN
  -- Server-side callers (seed/backfill/migration) have no end-user session.
  -- The cap is a rule for people, not for data repair.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Two signups completing at the same moment must not both pass at used = 4.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('referral_cap:' || NEW.referrer_id::text, 0)
  );

  v_used := public.referral_invites_this_month(NEW.referrer_id);

  IF v_used >= v_cap THEN
    RAISE EXCEPTION
      'referral monthly invite cap reached (% per calendar month)', v_cap
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_referral_monthly_cap() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_referral_monthly_cap ON public.referrals;
CREATE TRIGGER trg_enforce_referral_monthly_cap
  BEFORE INSERT ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_referral_monthly_cap();

-- ─── 5. No client-side referral writes ─────────────────────────────────────
-- Referrals are recorded only by SECURITY DEFINER RPCs (process_referral runs
-- as the owner and is unaffected by RLS). Dropping the permissive INSERT policy
-- closes the direct-PostgREST path now that a trigger — not just an RPC — is
-- responsible for the rule. SELECT stays open for the leaderboard.
DROP POLICY IF EXISTS "Users can insert referrals" ON public.referrals;

-- Make both new RPCs callable immediately instead of waiting for a cache reload.
NOTIFY pgrst, 'reload schema';

COMMIT;
