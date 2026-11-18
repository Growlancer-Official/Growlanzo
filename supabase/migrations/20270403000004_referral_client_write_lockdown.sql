-- ═══════════════════════════════════════════════════════════════════════════
-- Referral state is server-owned
--
-- Measured live 2026-11-18: an authenticated referee could PATCH their own
-- `referrals` row to `status = 'expired'`, `bonus_claimed = true` (both 204),
-- or `status = 'active'`, changing reward eligibility and the stats trigger.
-- `referral_stats` also allowed a user to INSERT/UPDATE their own row, so any
-- account could make itself look like a top referrer.
--
-- All legitimate writes happen inside SECURITY DEFINER functions
-- (process_referral, update_referral_stats, award_*), which bypass RLS.
-- Users only read.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP POLICY IF EXISTS "Referral participants can update referrals" ON public.referrals;
DROP POLICY IF EXISTS "Users can update own referrals" ON public.referrals;
DROP POLICY IF EXISTS "Users can insert own referral_stats" ON public.referral_stats;
DROP POLICY IF EXISTS "Users can update own referral_stats" ON public.referral_stats;

NOTIFY pgrst, 'reload schema';

COMMIT;
