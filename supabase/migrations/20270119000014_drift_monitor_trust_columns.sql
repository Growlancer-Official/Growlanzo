-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: teach the drift monitor the bug class that produced the
--      profiles_private.is_admin hole
--
-- 20270119000013 locked the columns. This makes the *class* self-detecting, so
-- the next time a trusted column is relocated to a new table — exactly how the
-- is_admin hole was created: a table gets created, the column moves, the old
-- protections do not follow — the hourly security_drift_monitor raises an alert
-- instead of waiting for the next audit pass.
--
-- What it detects: a trust-shaped column that the `authenticated` role can
-- still UPDATE, on a table whose write policy is owner-scoped
-- (auth.uid() = …), with no `protect_*` trigger attached. That is precisely the
-- shape of the profiles_private escalation (self is_admin = true, self-lift of
-- suspended_at / banned_at) and of the reputation columns fixed alongside it.
--
-- run_weekly_cleanup/purge_orphan_user_data are untouched; this only adds to the
-- hourly check_security_drift() sweep, whose alerts already email admins.
--
-- Two pieces:
--   1. self_writable_trust_columns() — the predicate, as a server-only helper so
--      it is callable (and assertable) on its own instead of buried in a loop.
--      Rendering-aware: this function's search_path carries no auth schema, so
--      pg_policies renders `auth.uid()` as bare `uid()` — both spellings match.
--   2. check_security_drift() — patched from its live definition (not retyped)
--      to sweep the helper and alert per finding; the patch RAISEs if its anchor
--      stops matching.
--
-- FAIL-CLOSED, WITH A POSITIVE CONTROL: the migration creates a throwaway
-- violator inside its own transaction, requires the helper to flag it, drops it,
-- and requires the live schema to yield exactly zero findings afterwards. A
-- detector that is merely quiet fails here just as loudly as one that is noisy.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The predicate.
--
--    `role` is only trust-shaped on the two profile tables (it is a job title
--    on employment_history, an invitation type on user_invitations, a plan
--    audience on subscription_plans), so it is matched there and nowhere else.
--    The exclusion list is the documented, reader-less hygiene set from the
--    audit report §13.3 plus the one legitimate case: a review's own author may
--    edit their review rating.
-- ───────────────────────────────────────────────────────────────────────────
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
       'platform_reviews.rating',     -- the review's own author may edit their platform review
       'certifications.verified',     -- no reader anywhere in app or edge code
       'freelancer_skills.is_verified',
       'payout_methods.is_verified',
       'services.rating'
     )
   ORDER BY c.relname, a.attname;
$function$;

-- Catalogs only, and only the drift monitor needs it: keep it off the client
-- surface entirely.
REVOKE ALL ON FUNCTION public.self_writable_trust_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.self_writable_trust_columns() TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Sweep it from the hourly monitor. Patched from the live definition:
--    the anchor is the notify comment that closes the function, and a missing
--    anchor aborts the migration rather than silently adding nothing.
-- ───────────────────────────────────────────────────────────────────────────
DO $patch$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'check_security_drift'
     AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'check_security_drift() not found — cannot patch';
  END IF;

  IF v_src LIKE '%self_writable_trust_columns%' THEN
    RETURN; -- already patched (idempotent re-run)
  END IF;

  v_new := replace(
    v_src,
    '  -- 📨 Real-time admin email via the CRON_SECRET-protected notify function',
    '  -- 🔴 CRITICAL/HIGH: a trust-shaped column an app role can still write on an' || chr(10) ||
    '  --    owner-scoped table with no protect_* guard. This is the class that' || chr(10) ||
    '  --    produced the profiles_private.is_admin escalation (20270119000013):' || chr(10) ||
    '  --    the column moves to a new table, the old protections do not follow, and' || chr(10) ||
    '  --    a value the server trusts becomes client-controlled.' || chr(10) ||
    '  FOR v_finding IN' || chr(10) ||
    '    SELECT table_name, column_name FROM public.self_writable_trust_columns()' || chr(10) ||
    '  LOOP' || chr(10) ||
    '    IF NOT EXISTS (' || chr(10) ||
    '      SELECT 1 FROM public.security_alerts' || chr(10) ||
    '      WHERE category = ''self_writable_trust_column''' || chr(10) ||
    '        AND detail LIKE ''%'' || v_finding.table_name || ''.'' || v_finding.column_name || ''%''' || chr(10) ||
    '        AND (is_resolved = false OR resolved_at > NOW() - interval ''7 days'')' || chr(10) ||
    '    ) THEN' || chr(10) ||
    '      INSERT INTO public.security_alerts (severity, category, detail)' || chr(10) ||
    '      VALUES (' || chr(10) ||
    '        CASE WHEN v_finding.column_name IN (''is_admin'', ''is_super_admin'', ''is_staff'', ''role'')' || chr(10) ||
    '             THEN ''critical'' ELSE ''high'' END,' || chr(10) ||
    '        ''self_writable_trust_column'',' || chr(10) ||
    '        format(''Column %s.%s is writable by the authenticated role on an owner-scoped table with no protect_* trigger — the value the server trusts is client-controlled'',' || chr(10) ||
    '               v_finding.table_name, v_finding.column_name)' || chr(10) ||
    '      );' || chr(10) ||
    '      v_new := v_new + 1;' || chr(10) ||
    '    END IF;' || chr(10) ||
    '  END LOOP;' || chr(10) || chr(10) ||
    '  -- 📨 Real-time admin email via the CRON_SECRET-protected notify function'
  );

  IF v_new = v_src THEN
    RAISE EXCEPTION 'check_security_drift anchor did not match — sweep not added';
  END IF;

  EXECUTE v_new;
END
$patch$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Positive control + baseline, in this migration's own transaction.
--    Creates a violator shaped exactly like the original hole, requires the
--    detector to see it, drops it, and requires the live schema to then be
--    clean. If the detector is broken the migration fails; if the live schema
--    still has an unguarded trust column the migration fails too (which is the
--    point — that is a finding, not a flaky test).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public._drift_probe_trust (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_verified boolean NOT NULL DEFAULT false
);
ALTER TABLE public._drift_probe_trust ENABLE ROW LEVEL SECURITY;
CREATE POLICY "probe owner can update own row"
  ON public._drift_probe_trust
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
GRANT UPDATE (is_verified) ON public._drift_probe_trust TO authenticated;

DO $assert$
DECLARE
  v_bad text;
BEGIN
  -- 3a. The detector must SEE the injected violator.
  IF NOT EXISTS (
    SELECT 1 FROM public.self_writable_trust_columns()
     WHERE table_name = '_drift_probe_trust' AND column_name = 'is_verified'
  ) THEN
    RAISE EXCEPTION 'positive control failed: the sweep did not flag a self-writable trust column';
  END IF;

  -- 3b. The injected table must not survive this migration.
  DROP TABLE public._drift_probe_trust;

  -- 3c. Baseline: with the probe gone, the live schema must yield nothing.
  SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name)
    INTO v_bad
    FROM public.self_writable_trust_columns();
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unguarded trust column(s) present: % — lock them (see 20270119000013) or add a documented exception', v_bad;
  END IF;

  -- 3d. The monitor must actually sweep it now.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'check_security_drift'
       AND p.prosrc ILIKE '%self_writable_trust_columns%'
  ) THEN
    RAISE EXCEPTION 'check_security_drift is not sweeping self_writable_trust_columns()';
  END IF;

  -- 3e. The helper stays server-only.
  IF has_function_privilege('authenticated', 'public.self_writable_trust_columns()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.self_writable_trust_columns()', 'EXECUTE') THEN
    RAISE EXCEPTION 'self_writable_trust_columns() is reachable by an app role';
  END IF;
END
$assert$;
