-- ═══════════════════════════════════════════════════════════════════════════
-- The KYC referral reward has never been able to complete a referral
--
-- award_referral_bonus_if_eligible() (20270303000000, still the live body) ends
-- with `UPDATE referrals SET status = 'completed'`. The table's status CHECK
-- only allows pending / active / expired, so the UPDATE raised 23514 and the
-- whole award transaction rolled back: no 5 + 5 coins, no notification, no
-- referral_stats movement. The award is called from the contract-completion
-- trigger inside a BEGIN … EXCEPTION WHEN OTHERS block, so the failure was
-- logged as a WARNING and never surfaced anywhere.
--
-- Proven live on 2026-11-25 (scripts/e2e/referral-team-scale.mjs):
--   award: 400 {"code":"23514","message":"new row for relation \"referrals\"
--   violates check constraint \"referrals_status_check\""}
--
-- The constraint was created outside the repo history (drift), hence this
-- repair-by-name. The allowed set only grows: every value that exists today
-- still passes, and 'completed' — a state the product and the UI already
-- describe — becomes writable.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'referrals'
     AND c.conname = 'referrals_status_check';

  IF v_def IS NULL THEN
    -- No constraint at all: nothing to widen, but the state must be valid.
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_status_check
      CHECK (status = ANY (ARRAY['pending', 'active', 'completed', 'expired']::text[]));
  ELSIF v_def LIKE '%completed%' THEN
    -- Already correct (a rebuilt database whose constraint was created from the
    -- current migrations) — leave it untouched.
    NULL;
  ELSE
    ALTER TABLE public.referrals DROP CONSTRAINT referrals_status_check;
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_status_check
      CHECK (status = ANY (ARRAY['pending', 'active', 'completed', 'expired']::text[]));
  END IF;
END $$;

-- Fail closed: the deploy refuses if the status is still unwritable.
DO $guards$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'referrals'
     AND c.conname = 'referrals_status_check';

  IF v_def IS NULL OR v_def NOT LIKE '%completed%' THEN
    RAISE EXCEPTION 'referrals status repair failed: completed is still not an allowed status';
  END IF;
END;
$guards$;

NOTIFY pgrst, 'reload schema';

COMMIT;
