-- ═══════════════════════════════════════════════════════════════════════════
-- CLEANUP: Deactivate stray subscription plans
-- ═══════════════════════════════════════════════════════════════════════════
-- The seed migration 20270101000011 inserted a duplicate 'pro-monthly' plan
-- with pay-to-win features ("Priority in search results", "100 connects/month")
-- that violate the platform's merit-based business model.
-- This migration deactivates ALL paid plans except the canonical 'premium_monthly'.
-- Idempotent: safe to run multiple times.

UPDATE public.subscription_plans
SET is_active = false
WHERE id <> 'premium_monthly' AND price > 0;

-- Also clean up any plan with forbidden features
UPDATE public.subscription_plans
SET features = features - 'Priority in search results' - '100 connects/month'
WHERE features ? 'Priority in search results' OR features ? '100 connects/month';
