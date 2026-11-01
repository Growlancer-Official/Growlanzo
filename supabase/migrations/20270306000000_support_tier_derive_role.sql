-- 20270306000000_support_tier_derive_role.sql
--
-- Follow-up to 20270305000000, which gated ticket support on NEW.user_role.
-- That column is supplied by the browser and the insert policy on
-- support_tickets only checks `user_id = auth.uid()`, so a free freelancer
-- could POST user_role:'client' and be waved through as a client — the Pro
-- requirement never ran. A guard that reads its decision from the payload is
-- not a guard.
--
-- This replaces the decision input with profiles.role, the same authoritative
-- source ProtectedRoute, is_user_admin() and the admin RPCs already use, and
-- writes that derived value back to user_role so the stored label cannot lie.
--
-- Unchanged behaviour: clients (no Premium plan exists for them) are never
-- gated; admins file nothing under a plan either; service-role / cron / admin
-- tooling inserts carry no end-user JWT and stay untouched.
--
-- Additive: replaces one function body, re-asserts its grants, keeps the
-- existing trigger. No column, policy or row is changed.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_freelancer_support_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
BEGIN
  -- Service role / cron / admin tooling: no end-user identity to gate.
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- A ticket always belongs to its own author.
  IF NEW.user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'You can only open a support ticket for your own account';
  END IF;

  -- The decision input, read from the database rather than the request.
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = v_caller;

  IF v_role IS NULL THEN
    -- Fail closed: without a profile the plan cannot be established, and
    -- guessing "free" or "paid" here would be an authorization decision made
    -- on missing data.
    RAISE EXCEPTION 'Your profile could not be found, so your plan could not be verified. Please reload and try again, or email support.';
  END IF;

  -- Keep the recorded label honest. Only overwrite for the two values the
  -- column accepts, so an admin row is not forced into a role it cannot hold.
  IF v_role IN ('freelancer', 'client') AND NEW.user_role IS DISTINCT FROM v_role THEN
    NEW.user_role := v_role;
  END IF;

  -- Clients are free for life and have no Premium tier to buy; admins are
  -- staff, not subscribers.
  IF v_role IN ('client', 'admin') THEN
    RETURN NEW;
  END IF;

  IF public.user_has_active_pro(v_caller) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Free freelancer plan includes in-app support only (AI assistant and Help Center). Priority ticket support is part of Freelancer Premium.';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_freelancer_support_tier() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_freelancer_support_tier() TO service_role;

-- Fail closed: a guard that silently did not install, or that still reads the
-- request payload, is worse than no guard.
DO $support_tier_derive_assert$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.enforce_freelancer_support_tier()') IS NULL THEN
    RAISE EXCEPTION 'support tier guard function is missing';
  END IF;

  IF to_regprocedure('public.user_has_active_pro(uuid)') IS NULL THEN
    RAISE EXCEPTION 'user_has_active_pro(uuid) is missing — the tier guard would reject every freelancer ticket';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_enforce_freelancer_support_tier'
       AND NOT tgisinternal
       AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'support tier trigger is missing or disabled';
  END IF;

  SELECT prosrc INTO v_src
    FROM pg_proc
   WHERE proname = 'enforce_freelancer_support_tier'
     AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL OR position('FROM public.profiles' IN v_src) = 0 THEN
    RAISE EXCEPTION 'support tier guard does not derive the role from public.profiles';
  END IF;
END
$support_tier_derive_assert$;

COMMIT;
