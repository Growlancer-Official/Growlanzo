-- ═══════════════════════════════════════════════════════════════════════════
-- Reconciliation stub for 20270407000000.
--
-- The drift-exception work that this migration originally carried
-- (self_writable_trust_columns() definition + platform_reviews.rating
-- exception + zero-finding assert) has been folded into
-- 20270402000000_platform_reviews.sql, which creates the table and trigger.
--
-- This file stays as a no-op so the migration drift check
-- (backend-deploy.yml) does not flag 20270407000000 as remote-only.
-- Re-applying it is idempotent: CREATE OR REPLACE of the same function body
-- and the same zero-finding assert are no-ops on a DB that already has them.
-- ═══════════════════════════════════════════════════════════════════════════

-- The service_role-only helper that the hourly check_security_drift() sweep
-- calls. Re-registered here for repo/DB parity; the authoritative definition
-- lives in 20270402000000_platform_reviews.sql.
CREATE OR REPLACE FUNCTION public.self_writable_trust_columns()
RETURNS TABLE(table_name text, column_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT c.relname::text, a.attname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND (
       a.attname IN (
         'is_admin', 'is_super_admin', 'is_staff', 'is_pro', 'verification_status',
         'kyc_verified_at', 'identity_verified', 'suspended_at', 'suspend_reason',
         'suspended_by', 'banned_at', 'is_verified', 'verified', 'seller_level',
         'reputation_score', 'weighted_rating', 'rating', 'total_reviews',
         'commission_rate'
       )
       OR (a.attname = 'role' AND c.relname IN ('profiles', 'profiles_private'))
     )
     AND has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
     AND EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.cmd IN ('UPDATE', 'ALL')
          AND (
            coalesce(p.qual, '') LIKE '%uid()%'
            OR coalesce(p.with_check, '') LIKE '%uid()%'
            OR coalesce(p.qual, '') LIKE '%auth.uid()%'
            OR coalesce(p.with_check, '') LIKE '%auth.uid()%'
          )
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       JOIN pg_proc tp ON tp.oid = t.tgfoid
        WHERE t.tgrelid = c.oid
          AND NOT t.tgisinternal
          AND tp.proname LIKE 'protect%'
     )
     AND (c.relname || '.' || a.attname) NOT IN (
       'reviews.rating',
       'platform_reviews.rating',
       'certifications.verified',
       'freelancer_skills.is_verified',
       'payout_methods.is_verified',
       'services.rating'
     )
   ORDER BY c.relname, a.attname;
$function$;

REVOKE ALL ON FUNCTION public.self_writable_trust_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.self_writable_trust_columns() TO service_role;

-- Assert: live schema yields zero self-writable trust-column findings.
DO $assert$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name)
    INTO v_bad
    FROM public.self_writable_trust_columns();
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unguarded trust column(s) still present after exception update: %', v_bad;
  END IF;
END
$assert$;

-- Keep PostgREST's schema cache in sync with the redefinition above so RPC
-- routing sees the current function signature (the body is always read live,
-- but the cache must know the function exists under its current oid).
NOTIFY pgrst, 'reload schema';
