-- ============================================================================
-- REALTIME + AI QUOTA + PRO PRIORITY SUPPORT (2026-11-01)
--
-- Problems this fixes (all reported from the live site):
--   1. "Support tickets / AI limit / referrals do not update in real time."
--      The tables were never added to the `supabase_realtime` publication, so
--      postgres_changes never fired for them — no amount of client-side
--      .channel() code could ever receive an event.
--   2. "Freelancer free AI limit does not trigger in real time."
--      The limit lived only inside the edge function, was read from the
--      browser with a hardcoded limit of 10, and was never atomic. The quota
--      now lives in the database and is consumed in ONE transaction.
--   3. "Pro users must get priority support in real time."
--      Pro entitlement is centralised in user_has_active_pro(), used by the
--      ticket-priority trigger and the AI entitlement RPC.
--
-- Safety: additive only. No table/column drops, no data rewrite, no changes to
-- money tables. Every publication ADD is guarded (idempotent).
-- ============================================================================

-- ─── 1. Pro entitlement, single source of truth ────────────────────────────
-- Mirrors src/lib/subscriptionHelpers.ts#isProSubscription:
--   * active subscription, OR
--   * trial whose trial_end_date is still in the future (a stale trial row that
--     has not been flipped by the nightly cron must NOT grant Pro).
CREATE OR REPLACE FUNCTION public.user_has_active_pro(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.subscriptions s
      LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
     WHERE s.user_id = p_user_id
       AND (
             s.status = 'active'
             OR (s.status = 'trial' AND s.trial_end_date IS NOT NULL AND s.trial_end_date > now())
           )
       AND (
             COALESCE(sp.price, 0) > 0
             OR lower(COALESCE(sp.name, '')) LIKE '%pro%'
             OR lower(COALESCE(sp.name, '')) LIKE '%premium%'
           )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_active_pro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_active_pro(uuid) TO authenticated, service_role;

-- ─── 2. Server-side AI quota (atomic, authoritative) ───────────────────────
-- The free freelancer allowance is 10 assistant messages per calendar month.
-- Clients are free for life (no quota). Pro is unlimited.
--
-- consume_ai_message() both CHECKS and RECORDS in one transaction, so two
-- parallel requests can never both slip past the last free message.
-- Returns JSONB: { allowed, is_pro, is_priority, used, limit, unlimited, resets_at }
CREATE OR REPLACE FUNCTION public.consume_ai_message(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit       constant integer := 10;
  v_is_pro      boolean;
  v_used        integer;
  v_month_start timestamptz;
  v_reset_at    timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'is_pro', false, 'is_priority', false,
                              'used', 0, 'limit', v_limit, 'unlimited', false,
                              'resets_at', NULL);
  END IF;

  -- Serialise concurrent sends for one user (released at commit).
  PERFORM pg_advisory_xact_lock(hashtext('ai_quota:' || p_user_id::text));

  v_month_start := date_trunc('month', now());
  v_reset_at    := v_month_start + interval '1 month';
  v_is_pro      := public.user_has_active_pro(p_user_id);

  IF v_is_pro THEN
    RETURN jsonb_build_object('allowed', true, 'is_pro', true, 'is_priority', true,
                              'used', 0, 'limit', 0, 'unlimited', true,
                              'resets_at', v_reset_at);
  END IF;

  SELECT COALESCE(SUM(COALESCE(usage_count, 1)), 0)::integer
    INTO v_used
    FROM public.usage_logs
   WHERE user_id = p_user_id
     AND feature_type = 'ai_assistant'
     AND created_at >= v_month_start;

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'is_pro', false, 'is_priority', false,
                              'used', v_used, 'limit', v_limit, 'unlimited', false,
                              'resets_at', v_reset_at);
  END IF;

  INSERT INTO public.usage_logs (user_id, feature_type, usage_count, metadata)
  VALUES (p_user_id, 'ai_assistant', 1,
          jsonb_build_object('route', 'ai-assistant', 'recorded_at', now()));

  RETURN jsonb_build_object('allowed', true, 'is_pro', false, 'is_priority', false,
                            'used', v_used + 1, 'limit', v_limit, 'unlimited', false,
                            'resets_at', v_reset_at);
END;
$$;

-- Only the edge function (service role) may consume quota. A browser must never
-- be able to burn another user's allowance or reset its own.
REVOKE ALL ON FUNCTION public.consume_ai_message(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_message(uuid) TO service_role;

-- Read-only entitlement for the in-app meter (no consumption).
CREATE OR REPLACE FUNCTION public.ai_support_entitlement()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_limit  constant integer := 10;
  v_is_pro boolean;
  v_used   integer;
  v_reset  timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('is_pro', false, 'is_priority', false,
                              'used', 0, 'limit', v_limit, 'unlimited', false,
                              'resets_at', NULL);
  END IF;

  v_reset  := date_trunc('month', now()) + interval '1 month';
  v_is_pro := public.user_has_active_pro(v_uid);

  IF v_is_pro THEN
    RETURN jsonb_build_object('is_pro', true, 'is_priority', true,
                              'used', 0, 'limit', 0, 'unlimited', true,
                              'resets_at', v_reset);
  END IF;

  SELECT COALESCE(SUM(COALESCE(usage_count, 1)), 0)::integer
    INTO v_used
    FROM public.usage_logs
   WHERE user_id = v_uid
     AND feature_type = 'ai_assistant'
     AND created_at >= date_trunc('month', now());

  RETURN jsonb_build_object('is_pro', false, 'is_priority', false,
                            'used', v_used, 'limit', v_limit, 'unlimited', false,
                            'resets_at', v_reset);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_support_entitlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_support_entitlement() TO authenticated, service_role;

-- ─── 3. Pro tickets are escalated in real time, on insert ──────────────────
-- A Pro member who files a ticket gets 'high' immediately (they can still pick
-- 'urgent' themselves — we never downgrade a user's own choice).
CREATE OR REPLACE FUNCTION public.escalate_pro_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.priority IS NULL OR NEW.priority IN ('low', 'normal') THEN
    IF public.user_has_active_pro(NEW.user_id) THEN
      NEW.priority := 'high';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_escalate_pro_support_ticket ON public.support_tickets;
CREATE TRIGGER trg_escalate_pro_support_ticket
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.escalate_pro_support_ticket();

-- ─── 4. Realtime: publish the tables the UI subscribes to ──────────────────
-- Without this, .channel().on('postgres_changes', …) is a silent no-op.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'support_tickets',
    'ticket_messages',
    'referral_stats',
    'referrals',
    'usage_logs',
    'grow_coin_ledger',
    'referral_project_reward_events',
    'team_projects',
    'team_project_roles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Table must exist in this environment before it can be published.
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Filtered subscriptions (e.g. user_id=eq.<uuid>) need the full row in the WAL
-- payload; with REPLICA IDENTITY DEFAULT a DELETE carries only the primary key,
-- so "my ticket was deleted/closed" events never match the filter.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'support_tickets',
    'ticket_messages',
    'referral_stats',
    'referrals',
    'usage_logs',
    'grow_coin_ledger'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;
END;
$$;

-- ─── 5. Quota lookups are on the hot path of every AI message ──────────────
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_feature_type_created
  ON public.usage_logs (user_id, feature_type, created_at DESC);

-- ─── 6. Verification ───────────────────────────────────────────────────────
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ')
    INTO missing
    FROM unnest(ARRAY['support_tickets','ticket_messages','referral_stats','referrals','usage_logs']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Realtime publication incomplete after migration: %', missing;
  END IF;
END;
$$;
