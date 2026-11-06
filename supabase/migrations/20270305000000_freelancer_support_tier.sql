-- 20270305000000_freelancer_support_tier.sql
--
-- Product rule: a freelancer on the free plan gets IN-APP support (the AI
-- assistant + Help Center). Priority ticket support is part of Freelancer
-- Premium (₹199/month). Clients have no Premium plan, so their ticket support
-- must keep working exactly as before.
--
-- This is enforced at the database, not in the form: a client-side-only gate
-- would just hide the button while the same rows stayed insertable through
-- PostgREST. An end-user insert is identified by a non-null auth.uid();
-- service-role/system inserts (admin tooling, cron, the AI responder) have no
-- end-user JWT and are deliberately left alone.
--
-- Additive: no column, policy or existing row is changed.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_freelancer_support_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- Service role / cron / admin tooling: no end-user identity to gate.
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- A ticket always belongs to its own author.
  IF NEW.user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'You can only open a support ticket for your own account';
  END IF;

  -- Clients are free forever and have no Premium tier to buy.
  IF COALESCE(NEW.user_role, 'freelancer') = 'client' THEN
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

DROP TRIGGER IF EXISTS trg_enforce_freelancer_support_tier ON public.support_tickets;
CREATE TRIGGER trg_enforce_freelancer_support_tier
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_freelancer_support_tier();

-- Fail closed: a guard that silently did not install is worse than no guard.
DO $support_tier_assert$
BEGIN
  IF to_regprocedure('public.enforce_freelancer_support_tier()') IS NULL THEN
    RAISE EXCEPTION 'support tier guard function was not created';
  END IF;

  IF to_regprocedure('public.user_has_active_pro(uuid)') IS NULL THEN
    RAISE EXCEPTION 'user_has_active_pro(uuid) is missing — the tier guard would reject every freelancer ticket';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_enforce_freelancer_support_tier'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'support tier trigger was not created';
  END IF;
END;
$support_tier_assert$;

COMMIT;
