// ────────────────────────────────────────────────────────────────────────────
// brevo-webhook — Brevo transactional delivery events
//
// Brevo reports what actually happened to a message (delivered / deferred /
// hard_bounce / blocked / spam / invalid_email / error) here. Without this,
// "Brevo accepted the request" would be the last thing we ever knew.
//
// SECURITY (fail closed, per the repo's webhook invariant):
//   Brevo does not HMAC-sign transactional payloads. It supports a shared
//   secret in the URL and/or HTTP basic auth, both configured in the Brevo
//   dashboard. This function requires BREVO_WEBHOOK_SECRET and rejects every
//   request when the secret is missing OR does not match:
//     • header  x-brevo-webhook-secret: <secret>
//     • query   ?token=<secret>
//     • basic auth password (user: any, password: <secret>)
//
// IDEMPOTENCY: each (message id, event, event timestamp) is unique in
// email_log_events, so a redelivered payload is stored once and the
// email_logs status is only ever moved FORWARD along the lifecycle.
// ────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type LogStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'deferred'
  | 'bounced'
  | 'blocked'
  | 'failed';

/** Brevo event name → our stored status. */
const EVENT_STATUS: Record<string, LogStatus> = {
  requests: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  deferred: 'deferred',
  soft_bounce: 'deferred',
  hard_bounce: 'bounced',
  blocked: 'blocked',
  spam: 'blocked',
  invalid_email: 'failed',
  error: 'failed',
  unique_opened: 'delivered',
  opened: 'delivered',
  proxy_open: 'delivered',
};

/** Higher wins, so an out-of-order webhook can never move a status backwards. */
const STATUS_RANK: Record<LogStatus, number> = {
  queued: 0,
  processing: 1,
  sent: 2,
  deferred: 3,
  delivered: 4,
  bounced: 5,
  blocked: 6,
  failed: 7,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function providedSecret(req: Request, url: URL): string {
  const header = req.headers.get('x-brevo-webhook-secret') ?? '';
  if (header) return header;

  const token = url.searchParams.get('token') ?? '';
  if (token) return token;

  const auth = req.headers.get('authorization') ?? '';
  if (/^basic\s+/i.test(auth)) {
    try {
      const decoded = atob(auth.replace(/^basic\s+/i, ''));
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password) return password;
    } catch {
      /* malformed basic auth — treated as no secret */
    }
  }
  return '';
}

interface BrevoEvent {
  event?: string;
  email?: string;
  'message-id'?: string;
  messageId?: string;
  ts?: number;
  ts_event?: number;
  date?: string;
  tag?: string;
  subject?: string;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = (Deno.env.get('BREVO_WEBHOOK_SECRET') ?? '').trim();
  if (!expected) {
    // Fail closed: an unauthenticated delivery webhook could otherwise be used
    // to mark arbitrary emails delivered.
    console.error('[brevo-webhook] BREVO_WEBHOOK_SECRET is not set — rejecting all events');
    return json({ error: 'Webhook secret is not configured' }, 503);
  }

  const url = new URL(req.url);
  const supplied = providedSecret(req, url).trim();
  if (!supplied || !timingSafeEqual(supplied, expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const events: BrevoEvent[] = Array.isArray(payload) ? (payload as BrevoEvent[]) : [payload as BrevoEvent];
  if (events.length === 0) return json({ ok: true, processed: 0 });
  if (events.length > 200) return json({ error: 'Too many events in one payload' }, 413);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  let processed = 0;
  let ignored = 0;

  for (const evt of events) {
    const eventName = String(evt?.event ?? '').toLowerCase();
    const messageId = String(evt?.['message-id'] ?? evt?.messageId ?? '').trim();
    const status = EVENT_STATUS[eventName];

    if (!status || !messageId) {
      ignored += 1;
      continue;
    }

    const eventAt = evt.ts_event
      ? new Date(Number(evt.ts_event) * 1000).toISOString()
      : evt.ts
        ? new Date(Number(evt.ts) * 1000).toISOString()
        : evt.date
          ? new Date(evt.date).toISOString()
          : new Date().toISOString();

    const { data: logRow } = await supabase
      .from('email_logs')
      .select('id, status')
      .eq('brevo_message_id', messageId)
      .maybeSingle();

    // Record the event even when the log row is unknown (kept for forensics),
    // and rely on the unique index for dedupe.
    const { error: eventError } = await supabase.from('email_log_events').insert({
      email_log_id: logRow?.id ?? null,
      brevo_message_id: messageId,
      event: eventName,
      event_at: eventAt,
      payload: {
        email: evt.email ?? null,
        subject: evt.subject ?? null,
        reason: evt.reason ?? null,
        tag: evt.tag ?? null,
      },
    });

    if (eventError && (eventError as { code?: string }).code !== '23505') {
      console.error('[brevo-webhook] could not store event:', eventError.message);
      continue;
    }
    if (eventError) {
      // Duplicate delivery of the same event — already applied.
      ignored += 1;
      continue;
    }

    if (!logRow?.id) {
      processed += 1;
      continue;
    }

    const current = (logRow.status ?? 'queued') as LogStatus;
    // Never regress: a late "sent" webhook must not overwrite "delivered".
    if (STATUS_RANK[status] < STATUS_RANK[current]) {
      ignored += 1;
      continue;
    }

    const patch: Record<string, unknown> = {
      status,
      last_event_at: eventAt,
    };
    if (status === 'delivered') patch.delivered_at = eventAt;
    if (status === 'bounced' || status === 'blocked') patch.bounced_at = eventAt;
    if (status === 'failed') {
      patch.failed_at = eventAt;
      patch.error_message = evt.reason ? String(evt.reason).slice(0, 1000) : `Brevo reported ${eventName}`;
    }

    const { error: updateError } = await supabase
      .from('email_logs')
      .update(patch)
      .eq('id', logRow.id);

    if (updateError) {
      console.error('[brevo-webhook] could not update log:', updateError.message);
      continue;
    }
    processed += 1;
  }

  return json({ ok: true, processed, ignored });
});
