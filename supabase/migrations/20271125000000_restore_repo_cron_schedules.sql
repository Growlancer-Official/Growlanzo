-- Restore repo-owned pg_cron schedules
--
-- Why: every scheduled job that runs on the live project must be reproducible
-- from this repository (AGENTS.md §3 rule 7 — the repo is the source of truth,
-- never the dashboard). Seven jobs that run in production had no
-- `cron.schedule` statement in any migration, so a rebuilt database would
-- silently lose withdrawal recovery, refund processing, deletion processing,
-- dispute escalation, contest closing and rate-limit cleanup.
--
-- Deliberately NOT included: `cleanup-orphaned-data`, `subscription-billing-daily`,
-- `growlancer-milestone-auto-release`, `growlancer-security-drift` and
-- `cleanup-verification-rate-limits` — those already have a `cron.schedule`
-- statement in this repository and are left to their existing migrations.
--
-- Idempotent by design: a schedule is created only when no job with the same
-- jobname exists. Applying this to the already-scheduled production project is
-- therefore a no-op and can never create a duplicate — a duplicated money sweep
-- would run twice on the same window.
--
-- Commands and intervals are copied verbatim from the live `cron.job` rows so
-- the repo matches what is actually running.

-- Fail closed: never schedule a function that does not exist.
DO $assert$
BEGIN
  IF to_regprocedure('public.process_stale_withdrawals()') IS NULL
     OR to_regprocedure('public.process_pending_refunds()') IS NULL
     OR to_regprocedure('public.process_due_deletions()') IS NULL
     OR to_regprocedure('public.process_no_response_disputes()') IS NULL
     OR to_regprocedure('public.close_expired_contests()') IS NULL
     OR to_regprocedure('public.cleanup_expired_rate_limits()') IS NULL THEN
    RAISE EXCEPTION 'A scheduled function is missing; refusing to restore cron schedules';
  END IF;
END
$assert$;

DO $do$
DECLARE
  v_jobs CONSTANT jsonb := '[
    {"name": "growlancer-stale-withdrawal-recovery", "schedule": "*/15 * * * *", "command": "SELECT public.process_stale_withdrawals();"},
    {"name": "growlancer-process-pending-refunds",   "schedule": "*/2 * * * *",  "command": "SELECT public.process_pending_refunds();"},
    {"name": "growlancer-process-due-deletions",     "schedule": "0 4 * * *",    "command": "SELECT public.process_due_deletions();"},
    {"name": "growlancer-no-response-auto-dispute",  "schedule": "0 6 * * *",    "command": "SELECT public.process_no_response_disputes();"},
    {"name": "growlancer-close-contests",            "schedule": "0 * * * *",    "command": "SELECT public.close_expired_contests()"},
    {"name": "cleanup-rate-limits",                  "schedule": "0 3 * * *",    "command": "SELECT cleanup_expired_rate_limits();"}
  ]'::jsonb;
  v_job jsonb;
BEGIN
  FOR v_job IN SELECT * FROM jsonb_array_elements(v_jobs)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = v_job ->> 'name'
    ) THEN
      PERFORM cron.schedule(
        v_job ->> 'name',
        v_job ->> 'schedule',
        v_job ->> 'command'
      );
    END IF;
  END LOOP;
END
$do$;
