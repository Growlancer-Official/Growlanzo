-- ═══════════════════════════════════════════════════════════════════════════
-- 20271128_01 — HOTFIX: the 199/100 earning cap must never abort a payout.
--
-- Found by the live criteria probe (scripts/e2e/referral-criteria-team-ai.mjs):
-- 20271128000000 writes `grow_coin_review_flags.kind = 'monthly_earning_cap'`
-- when the monthly cap blocks a referrer reward, but the table's CHECK
-- constraint (20270129000000) only allowed
--   'monthly_cap', 'shared_phone', 'shared_identity', 'redemption_shortfall'.
-- The insert therefore raised 23514, which aborted the WHOLE
-- award_referral_project_reward / award_referral_bonus_if_eligible
-- transaction. The contract-completion trigger wraps that call in
-- `EXCEPTION WHEN OTHERS`, so the failure was silent — and the referee lost
-- their own 5 coins (and the KYC 5+5) the moment their referrer reached the
-- cap. The cap must only stop the REFERRER's extra coins; it may never take
-- the referee's reward away.
--
-- Additive and idempotent: no row or other kind is removed.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.grow_coin_review_flags
  DROP CONSTRAINT IF EXISTS grow_coin_review_flags_kind_check;

ALTER TABLE public.grow_coin_review_flags
  ADD CONSTRAINT grow_coin_review_flags_kind_check CHECK (
    kind = ANY (ARRAY[
      'monthly_cap',
      'monthly_earning_cap',
      'shared_phone',
      'shared_identity',
      'redemption_shortfall'
    ]::text[])
  );

-- Fail closed: the deploy refuses if the cap flag still cannot be written.
DO $earning_cap_flag_guard$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'grow_coin_review_flags'
     AND c.conname = 'grow_coin_review_flags_kind_check';

  IF v_def IS NULL OR v_def NOT LIKE '%monthly_earning_cap%' THEN
    RAISE EXCEPTION 'hotfix failed: grow_coin_review_flags still cannot record a monthly_earning_cap';
  END IF;

  -- Both award paths must still ask for that flag when the cap is exhausted.
  IF (SELECT pg_get_functiondef(p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'award_referral_project_reward')
     NOT LIKE '%monthly_earning_cap%' THEN
    RAISE EXCEPTION 'hotfix failed: the project award lost its cap review flag';
  END IF;
END;
$earning_cap_flag_guard$;

NOTIFY pgrst, 'reload schema';

COMMIT;
