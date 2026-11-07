-- ────────────────────────────────────────────────────────────────────────────
-- 20270307000000_email_logs.sql
--
-- Transactional email audit log + Brevo delivery-event log.
--
-- WHY: every outbound transactional email now goes through
--   supabase/functions/_shared/emailService.ts
-- which needs (a) an idempotency guard so a retried request cannot send the
-- same message twice, and (b) an accepted→delivered/bounced/failed lifecycle
-- so "Brevo accepted the API call" is never reported as "delivered".
--
-- SECURITY: these tables hold recipient addresses (PII) and are readable ONLY
-- by the service role. RLS is enabled with NO policies and no grants to
-- anon/authenticated, so the admin console must read them through the
-- `email-admin` edge function (which verifies profiles_private.is_admin).
--
-- Never stored here: API keys, OTP codes, passwords, session tokens.
-- `metadata` holds non-sensitive reference ids only (project/contract/ticket).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email   text        NOT NULL,
  recipient_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_email      text        NOT NULL,
  sender_name       text        NOT NULL,
  event_type        text        NOT NULL,
  subject           text        NOT NULL,
  template_id       text,
  brevo_message_id  text,
  status            text        NOT NULL DEFAULT 'queued',
  error_message     text,
  idempotency_key   text,
  retry_count       integer     NOT NULL DEFAULT 0,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  delivered_at      timestamptz,
  bounced_at        timestamptz,
  failed_at         timestamptz,
  last_event_at     timestamptz,
  CONSTRAINT email_logs_status_check CHECK (
    status IN ('queued', 'processing', 'sent', 'delivered', 'deferred', 'bounced', 'blocked', 'failed')
  )
);

COMMENT ON TABLE public.email_logs IS
  'Transactional email audit log. Service-role only — read via the email-admin edge function.';
COMMENT ON COLUMN public.email_logs.status IS
  'sent = accepted by Brevo. delivered/bounced/blocked/deferred arrive later via the Brevo webhook.';

-- Idempotency: a repeated request with the same key must not send again.
CREATE UNIQUE INDEX IF NOT EXISTS email_logs_idempotency_key_key
  ON public.email_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_created_at
  ON public.email_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient
  ON public.email_logs (lower(recipient_email));
CREATE INDEX IF NOT EXISTS idx_email_logs_event_type
  ON public.email_logs (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status
  ON public.email_logs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_brevo_message_id
  ON public.email_logs (brevo_message_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sender
  ON public.email_logs (sender_email, created_at DESC);

-- ── Delivery events reported by the Brevo webhook ───────────────────────────
-- One row per (message, event, event timestamp); the unique key is the webhook
-- idempotency guard, so a redelivered payload cannot double-apply.
CREATE TABLE IF NOT EXISTS public.email_log_events (
  id               bigserial PRIMARY KEY,
  email_log_id     uuid        REFERENCES public.email_logs(id) ON DELETE CASCADE,
  brevo_message_id text,
  event            text        NOT NULL,
  event_at         timestamptz,
  received_at      timestamptz NOT NULL DEFAULT now(),
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.email_log_events IS
  'Raw Brevo delivery events (one per message+event), used to advance email_logs.status idempotently.';

CREATE UNIQUE INDEX IF NOT EXISTS email_log_events_unique_event
  ON public.email_log_events (brevo_message_id, event, event_at);
CREATE INDEX IF NOT EXISTS idx_email_log_events_log_id
  ON public.email_log_events (email_log_id, received_at DESC);

-- ── Lock both tables down ───────────────────────────────────────────────────
ALTER TABLE public.email_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log_events ENABLE ROW LEVEL SECURITY;

-- Explicitly remove the default grants: recipient emails are PII and must not
-- be readable by the anon or authenticated roles.
REVOKE ALL ON public.email_logs       FROM anon, authenticated;
REVOKE ALL ON public.email_log_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.email_log_events_id_seq FROM anon, authenticated;

-- Service role (edge functions) keeps full access.
GRANT ALL ON public.email_logs       TO service_role;
GRANT ALL ON public.email_log_events TO service_role;
GRANT ALL ON SEQUENCE public.email_log_events_id_seq TO service_role;

-- ── Admin-only aggregate stats (cheap, single round trip) ───────────────────
-- Used by the email-admin edge function. SECURITY DEFINER + explicit admin
-- check on profiles_private.is_admin, the same flag the rest of the admin
-- surface uses — never a client-supplied role.
CREATE OR REPLACE FUNCTION public.get_email_log_stats(
  p_since timestamptz DEFAULT (now() - interval '30 days')
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_result   jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles_private
  WHERE id = auth.uid();

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total',      count(*),
    'queued',     count(*) FILTER (WHERE status = 'queued'),
    'processing', count(*) FILTER (WHERE status = 'processing'),
    'sent',       count(*) FILTER (WHERE status = 'sent'),
    'delivered',  count(*) FILTER (WHERE status = 'delivered'),
    'deferred',   count(*) FILTER (WHERE status = 'deferred'),
    'bounced',    count(*) FILTER (WHERE status IN ('bounced', 'blocked')),
    'failed',     count(*) FILTER (WHERE status = 'failed'),
    'since',      p_since
  ) INTO v_result
  FROM public.email_logs
  WHERE created_at >= p_since;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_log_stats(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_email_log_stats(timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_email_log_stats(timestamptz) IS
  'Admin-only email delivery counters for the admin console. Refuses non-admins via profiles_private.is_admin.';
