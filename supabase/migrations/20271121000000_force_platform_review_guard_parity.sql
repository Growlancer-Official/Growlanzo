-- ═══════════════════════════════════════════════════════════════════════════
-- Force platform-review guard parity between the repo and the live database.
--
-- Why a second file: the live DB still reports
--   • self_writable_trust_columns() -> platform_reviews.rating  (the documented
--     exception is missing from the deployed function body), and
--   • anon_reachable_money_rpc     -> set_platform_review_fields()
-- even though 20270402000000 and 20270407000000 both declare the fix. The
-- versions are recorded as applied on the remote while their function bodies
-- are the older ones, so re-running those files changes nothing. This later
-- version re-states both definitions so the next `db push` actually lands them.
--
-- Safe to re-run: CREATE OR REPLACE + REVOKE/GRANT are idempotent, and no data
-- is read or written.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. The trigger function needs no client EXECUTE at all: Postgres does not
--    check EXECUTE privilege when a trigger fires, so only service_role keeps
--    the grant (for manual/administrative calls).
REVOKE ALL ON FUNCTION public.set_platform_review_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_review_fields() TO service_role;

-- 2. Drift monitor with the documented platform_reviews.rating exception.
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
     -- the app role can still write it
     AND has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
     -- …on a table whose write policy is scoped to the row's owner
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
     -- …with no protect_* guard attached
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       JOIN pg_proc tp ON tp.oid = t.tgfoid
        WHERE t.tgrelid = c.oid
          AND NOT t.tgisinternal
          AND tp.proname LIKE 'protect%'
     )
     -- documented exceptions (audit report §13.3 / §13.4)
     AND (c.relname || '.' || a.attname) NOT IN (
       'reviews.rating',              -- the review's own author may edit their review
       'platform_reviews.rating',     -- …and their platform review; the trigger locks it on UPDATE
       'certifications.verified',     -- no reader anywhere in app or edge code
       'freelancer_skills.is_verified',
       'payout_methods.is_verified',
       'services.rating'
     )
   ORDER BY c.relname, a.attname;
$function$;

REVOKE ALL ON FUNCTION public.self_writable_trust_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.self_writable_trust_columns() TO service_role;

-- 3. Refresh PostgREST's function cache so both RPCs resolve immediately.
NOTIFY pgrst, 'reload schema';
