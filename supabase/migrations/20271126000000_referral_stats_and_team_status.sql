-- ═══════════════════════════════════════════════════════════════════════════
-- Two dashboard-facing state bugs found by the live scale run
-- (scripts/e2e/referral-team-scale.mjs, 2026-11-25)
--
-- 1. referral_stats.valid_referrals / points froze at 0.
--    20270303000000 rewrote award_referral_bonus_if_eligible() for the current
--    coin table (KYC → 5 + 5) but dropped the referral_stats update the older
--    body performed. Every referral therefore completed with the Referrals page
--    still showing "Valid Referrals 0" and "Points 0" forever — the two numbers
--    the page renders at src/pages/ReferralsPage.tsx. The counters move again
--    here, in the same transaction as the payout, only when the KYC reward is
--    actually written (the bonus_claimed latch keeps it once-per-referral).
--
-- 2. team_projects.status never reached 'completed'.
--    The UI only flips 'open' → 'in_progress' when the first seat is hired
--    (ClientTeamProjectDetailPage.doHireRole). Nothing ever closed the project,
--    so after all ten seats' contracts were funded, delivered and released the
--    client still saw an "In Progress" project next to ten completed contracts.
--    A trigger now derives the status from the contracts: first seat →
--    in_progress, every role filled and every seat completed → completed.
--    Deriving it in the database also covers hires made through the RPC/API.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Referral counters move with the KYC payout
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_referral_bonus_if_eligible(p_referred_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_coins constant integer := 5;
  v_verified boolean := false;
  v_paid integer := 0;
BEGIN
  IF p_referred_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user');
  END IF;

  SELECT * INTO v_referral
    FROM public.referrals r
   WHERE r.referred_user_id = p_referred_user_id
   ORDER BY r.created_at ASC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_referral');
  END IF;

  IF COALESCE(v_referral.bonus_claimed, false) THEN
    RETURN jsonb_build_object('success', true, 'already_awarded', true, 'coins', 0);
  END IF;

  -- KYC reward only on a genuinely approved verification from a real provider.
  SELECT EXISTS (
    SELECT 1 FROM public.identity_verifications iv
     WHERE iv.user_id = p_referred_user_id
       AND iv.status = 'verified'
       AND COALESCE(iv.verification_provider, 'manual') NOT IN ('dev_mode', 'dev-sandbox')
  ) INTO v_verified;

  IF NOT v_verified THEN
    RETURN jsonb_build_object('success', false, 'reason', 'kyc_not_approved');
  END IF;

  INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
  VALUES
    (p_referred_user_id, v_coins, 'kyc_bonus', v_referral.id,
     jsonb_build_object('role', 'referred', 'rule', 'kyc_referral_reward', 'referral_id', v_referral.id)),
    (v_referral.referrer_id, v_coins, 'kyc_bonus', v_referral.id,
     jsonb_build_object('role', 'referrer', 'rule', 'kyc_referral_reward', 'referral_id', v_referral.id))
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_paid = ROW_COUNT;

  UPDATE public.referrals
     SET bonus_claimed = true,
         status = 'completed',
         activated_at = COALESCE(activated_at, now())
   WHERE id = v_referral.id;

  -- The page's "Valid Referrals" and "Points" counters. Only count when a
  -- payout row was actually written, so a retry can never inflate them.
  IF v_paid > 0 THEN
    UPDATE public.referral_stats
       SET valid_referrals = COALESCE(valid_referrals, 0) + 1,
           points = COALESCE(points, 0) + v_coins,
           updated_at = now()
     WHERE user_id = v_referral.referrer_id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES
    (p_referred_user_id, 'system', 'KYC verified — 5 Grow Coins earned',
     'Your identity verification is approved. You and your referral partner have each earned 5 Growlanzo Coins.',
     '/referrals', jsonb_build_object('coins', v_coins, 'event', 'kyc_referral', 'referral_id', v_referral.id)),
    (v_referral.referrer_id, 'system', 'Your referral passed KYC — 5 Grow Coins earned',
     'KYC verified! You and your referral partner have each earned 5 Growlanzo Coins.',
     '/referrals', jsonb_build_object('coins', v_coins, 'event', 'kyc_referral', 'referral_id', v_referral.id));

  RETURN jsonb_build_object('success', true, 'coins', v_coins, 'referral_id', v_referral.id, 'stats_updated', v_paid > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.award_referral_bonus_if_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_bonus_if_eligible(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Team project status follows its seats
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_team_project_status_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_pending_contracts integer;
  v_unfilled_roles integer;
BEGIN
  IF NEW.team_project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_pending_contracts
    FROM public.contracts
   WHERE team_project_id = NEW.team_project_id
     AND status IS DISTINCT FROM 'completed';

  IF v_pending_contracts = 0 THEN
    SELECT count(*) INTO v_unfilled_roles
      FROM public.team_project_roles
     WHERE team_project_id = NEW.team_project_id
       AND status IS DISTINCT FROM 'filled';

    IF v_unfilled_roles = 0 THEN
      UPDATE public.team_projects
         SET status = 'completed', updated_at = now()
       WHERE id = NEW.team_project_id
         AND status IS DISTINCT FROM 'completed';
      RETURN NEW;
    END IF;
  END IF;

  UPDATE public.team_projects
     SET status = 'in_progress', updated_at = now()
   WHERE id = NEW.team_project_id
     AND status = 'open';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_team_project_status_fn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_team_project_status_sync ON public.contracts;
CREATE TRIGGER trg_team_project_status_sync
  AFTER INSERT OR UPDATE OF status ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_team_project_status_fn();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Fail-closed guards: the deploy refuses if either fix is lost
-- ───────────────────────────────────────────────────────────────────────────
DO $guards$
DECLARE
  v_referral_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_referral_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'award_referral_bonus_if_eligible';

  IF v_referral_def IS NULL THEN
    RAISE EXCEPTION 'referral stats fix failed: award_referral_bonus_if_eligible is missing';
  END IF;
  IF v_referral_def NOT LIKE '%valid_referrals%' OR v_referral_def NOT LIKE '%points%' THEN
    RAISE EXCEPTION 'referral stats fix failed: the referral counters are no longer updated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_team_project_status_sync'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'team status fix failed: trg_team_project_status_sync is missing';
  END IF;
END;
$guards$;

NOTIFY pgrst, 'reload schema';

COMMIT;
