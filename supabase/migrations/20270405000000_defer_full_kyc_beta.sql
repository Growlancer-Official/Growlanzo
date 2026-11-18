-- ─────────────────────────────────────────────────────────────────────────────
-- BETA: FULL KYC DEFERRED — deactivate the legacy document-KYC flow safely.
--
-- Product decision (Nov 2026): full identity verification (KYC) is postponed
-- until a later development phase, subject to legal and payment-provider review.
-- Account verification (name + confirmed email + confirmed phone, migration
-- 20270404000000) stays live and is NOT touched by this file.
--
-- Deliberately NON-DESTRUCTIVE:
--   • no table, column or row is dropped or modified — historical
--     identity_verifications rows, profiles.kyc_* columns and every structure
--     shared with active features stay exactly as they are;
--   • only the deferred feature's ENTRY POINTS are closed: the app can no longer
--     insert a document submission, the legacy validate/verify helpers are no
--     longer executable by app roles, and the 10-minute auto-verify sweep is
--     unscheduled;
--   • every change is reversible by re-granting the same privileges.
--
-- Rollback (manual, only if KYC is reinstated):
--   GRANT SELECT, INSERT ON public.identity_verifications TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.kyc_validate_document_number(TEXT, TEXT) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.kyc_verify_row(UUID) TO service_role;
--   GRANT EXECUTE ON FUNCTION public.auto_verify_kyc() TO service_role;
--   SELECT cron.schedule('kyc-auto-verify', '*/10 * * * *', 'SELECT public.auto_verify_kyc()');
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Close the submission surface. The deferred flow inserted its document rows
--    as `authenticated`; SELECT stays granted so admin/history screens and the
--    coin/referral readers that join this table keep working unchanged.
DO $$
BEGIN
  IF to_regclass('public.identity_verifications') IS NOT NULL THEN
    REVOKE INSERT, UPDATE ON public.identity_verifications FROM authenticated;
    COMMENT ON TABLE public.identity_verifications IS
      'DEFERRED (Beta): document-based KYC submissions are closed. Historical rows are retained for audit and are read-only for app roles.';
  END IF;
END $$;

-- 2. Retire the legacy document helpers from every app role. They keep working
--    for service_role (admin maintenance, historical rows), and the SECURITY
--    DEFINER triggers that may still touch old rows run as their owner.
DO $$
BEGIN
  IF to_regprocedure('public.kyc_validate_document_number(text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.kyc_validate_document_number(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.kyc_validate_document_number(TEXT, TEXT) TO service_role;
  END IF;

  IF to_regprocedure('public.kyc_verify_row(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.kyc_verify_row(UUID) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.kyc_verify_row(UUID) TO service_role;
  END IF;

  IF to_regprocedure('public.auto_verify_kyc()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.auto_verify_kyc() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.auto_verify_kyc() TO service_role;
  END IF;
END $$;

-- 3. Stop the background sweep for the deferred flow — with inserts closed it
--    can only ever no-op. Guarded so the migration is idempotent and safe where
--    pg_cron is not installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kyc-auto-verify') THEN
    PERFORM cron.unschedule('kyc-auto-verify');
  END IF;
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable - skipping kyc-auto-verify unschedule';
END $$;

COMMIT;
