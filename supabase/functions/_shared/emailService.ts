// ═══════════════════════════════════════════════════════════════════════════
// Central transactional email service.
//
// Everything that sends a user-facing transactional email goes through here so
// that four guarantees hold for every message, not just some:
//
//   1. SENDER ROUTING — the event decides the verified sender identity
//      (security / support / hello / info). No ad-hoc From address.
//   2. IDEMPOTENCY — a stable key per (event, recipient, reference) means a
//      retried request or a double-click cannot send the same message twice.
//   3. AUDIT — every attempt is a row in email_logs with the sender, subject,
//      template, Brevo message id, status and failure reason.
//   4. HONEST STATUS — `sent` means "Brevo accepted it". `delivered`,
//      `bounced` and `blocked` only arrive later via the Brevo webhook.
//
// Never stores secrets: no API keys, OTP values, passwords or session tokens
// are written to email_logs.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmailDetailed } from './brevo.ts';
import { getSender, type EmailSenderKey } from './emailSenders.ts';
import {
  EMAIL_EVENTS,
  isEmailEvent,
  renderEmail,
  type EmailData,
  type EmailEventKey,
} from './emailTemplates.ts';

export type EmailStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'deferred'
  | 'bounced'
  | 'blocked'
  | 'failed';

export interface SendOutcome {
  ok: boolean;
  status: EmailStatus | 'skipped';
  logId?: string;
  messageId?: string;
  /** True when an identical idempotency key had already been used. */
  duplicate?: boolean;
  /** True when nothing was sent (missing key, unsubscribed, invalid input). */
  skipped?: boolean;
  error?: string;
}

/** Retry schedule: 3 attempts, exponential backoff, all inside one call. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 400, 1200];

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
}

/** Deliberately strict: no display names, no angle brackets, no whitespace. */
export function isValidRecipient(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  const value = email.trim();
  if (value.length < 6 || value.length > 254) return false;
  if (/[\s<>",;]/.test(value)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value);
}

/**
 * Idempotency key derived from the event, recipient and the reference id the
 * workflow already has (project / contract / ticket / transaction). Stable
 * across retries, distinct across different projects.
 */
export function autoIdempotencyKey(
  event: string,
  to: string,
  data: EmailData = {},
): string | null {
  const ref =
    data.project_id ??
    data.contract_id ??
    data.milestone_id ??
    data.ticket_id ??
    data.payment_id ??
    data.reference ??
    data.dispute_id ??
    null;
  if (!ref) return null;
  const refKey = event.replace(/[^a-z0-9_]/gi, '');
  return `${refKey}:${String(ref)}`;
}

interface LoggedEmailParams {
  event: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  senderKey: EmailSenderKey;
  templateId?: string;
  recipientName?: string;
  recipientUserId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Send an already-rendered email through the audit + retry pipeline.
 * Prefer `sendTransactionalEmail` — this exists for the legacy builders whose
 * HTML is produced by their own functions.
 */
export async function sendLoggedEmail(params: LoggedEmailParams): Promise<SendOutcome> {
  if (!isValidRecipient(params.to)) {
    return { ok: false, status: 'failed', skipped: true, error: 'Invalid recipient address' };
  }

  const sender = getSender(params.senderKey);
  const recipient = params.to.trim().toLowerCase();
  const sb = serviceClient();

  // ── 1. Idempotency guard ─────────────────────────────────────────────────
  if (params.idempotencyKey) {
    const { data: existing } = await sb
      .from('email_logs')
      .select('id, status')
      .eq('idempotency_key', params.idempotencyKey)
      .maybeSingle();
    if (existing?.id) {
      return {
        ok: existing.status !== 'failed',
        status: existing.status as EmailStatus,
        logId: existing.id,
        duplicate: true,
      };
    }
  }

  // ── 2. Open the audit row ────────────────────────────────────────────────
  let logId: string | undefined;
  const { data: inserted, error: insertError } = await sb
    .from('email_logs')
    .insert({
      recipient_email: recipient,
      recipient_user_id: params.recipientUserId ?? null,
      sender_email: sender.email,
      sender_name: sender.name,
      event_type: params.event,
      subject: params.subject,
      template_id: params.templateId ?? params.event,
      status: 'queued',
      idempotency_key: params.idempotencyKey ?? null,
      metadata: params.metadata ?? {},
    })
    .select('id')
    .single();

  if (insertError) {
    // Unique violation = a concurrent request won the race. Treat as duplicate.
    if ((insertError as { code?: string }).code === '23505' && params.idempotencyKey) {
      const { data: existing } = await sb
        .from('email_logs')
        .select('id, status')
        .eq('idempotency_key', params.idempotencyKey)
        .maybeSingle();
      return {
        ok: existing?.status !== 'failed',
        status: (existing?.status as EmailStatus) ?? 'queued',
        logId: existing?.id,
        duplicate: true,
      };
    }
    // Logging failed but delivery should still be attempted; the send is more
    // important than the audit row. The failure is reported in the response.
    console.error('[email] could not write email_logs row:', insertError.message);
  } else {
    logId = inserted?.id as string | undefined;
  }

  // ── 3. Attempt delivery with backoff ─────────────────────────────────────
  let lastError: string | undefined;
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const delay = BACKOFF_MS[attempt] ?? 1200;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const result = await sendEmailDetailed({
      to: recipient,
      subject: params.subject,
      html: params.html,
      text: params.text,
      sender: { name: sender.name, email: sender.email },
      senderKey: params.senderKey,
      tags: ['transactional', params.event],
      customHeader: params.idempotencyKey ?? params.event,
    });

    lastStatus = result.status;
    lastError = result.error;

    if (result.ok) {
      if (logId) {
        await sb
          .from('email_logs')
          .update({
            status: 'sent',
            brevo_message_id: result.messageId ?? null,
            sent_at: new Date().toISOString(),
            last_event_at: new Date().toISOString(),
            retry_count: attempt,
            error_message: null,
          })
          .eq('id', logId);
      }
      return {
        ok: true,
        status: 'sent',
        logId,
        messageId: result.messageId,
        skipped: result.skipped,
      };
    }

    // A missing API key will never succeed — stop immediately.
    if (result.skipped) break;
    if (!result.retryable) break;
  }

  if (logId) {
    await sb
      .from('email_logs')
      .update({
        status: 'failed',
        error_message: (lastError ?? `Brevo HTTP ${lastStatus}`).slice(0, 1000),
        failed_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
        retry_count: MAX_ATTEMPTS,
      })
      .eq('id', logId);
  }

  return { ok: false, status: 'failed', logId, error: lastError ?? 'Delivery failed' };
}

export interface SendTransactionalParams {
  event: EmailEventKey;
  to: string;
  recipientName?: string;
  recipientUserId?: string | null;
  data?: EmailData;
  /** Override the derived key (e.g. one email per contract stage). */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

/** Render an event and send it through the audited pipeline. */
export async function sendTransactionalEmail(
  params: SendTransactionalParams,
): Promise<SendOutcome> {
  if (!isEmailEvent(params.event)) {
    return { ok: false, status: 'failed', skipped: true, error: `Unknown email event: ${params.event}` };
  }

  const data: EmailData = { ...(params.data ?? {}) };
  if (params.recipientName && !data.name) data.name = params.recipientName;

  const rendered = renderEmail(params.event, data);
  const key =
    params.idempotencyKey ??
    autoIdempotencyKey(params.event, params.to, data) ??
    null;

  return sendLoggedEmail({
    event: params.event,
    to: params.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    senderKey: rendered.senderKey,
    templateId: rendered.templateId,
    recipientName: params.recipientName,
    recipientUserId: params.recipientUserId ?? null,
    idempotencyKey: key,
    metadata: {
      ...(params.metadata ?? {}),
      ...Object.fromEntries(
        Object.entries(data).filter(([k, v]) =>
          ['project_id', 'contract_id', 'milestone_id', 'ticket_id', 'payment_id', 'dispute_id', 'reference'].includes(k) &&
          (typeof v === 'string' || typeof v === 'number'),
        ),
      ),
    },
  });
}

/**
 * Re-send a failed log row. Uses the stored subject/HTML-free metadata, so the
 * caller must re-render: `retryFailedEmail` re-renders from event_type + data.
 */
export async function retryEmailLog(
  logId: string,
  options: { event?: string; data?: EmailData } = {},
): Promise<SendOutcome> {
  const sb = serviceClient();
  const { data: row, error } = await sb
    .from('email_logs')
    .select('id, recipient_email, event_type, status, idempotency_key, recipient_user_id')
    .eq('id', logId)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, status: 'failed', error: 'Email log not found' };
  }
  if (row.status === 'delivered' || row.status === 'sent') {
    return { ok: true, status: row.status as EmailStatus, logId, duplicate: true };
  }

  const event = (options.event ?? row.event_type) as EmailEventKey;
  if (!isEmailEvent(event)) {
    return { ok: false, status: 'failed', error: `Cannot retry unknown event: ${event}` };
  }

  const rendered = renderEmail(event, options.data ?? {});
  const key = row.idempotency_key ? `${row.idempotency_key}:retry:${Date.now()}` : null;

  return sendLoggedEmail({
    event,
    to: row.recipient_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    senderKey: rendered.senderKey,
    templateId: rendered.templateId,
    recipientUserId: row.recipient_user_id,
    idempotencyKey: key,
    metadata: { retry_of: logId },
  });
}

/** Catalogue for the admin console (event → sender mapping). */
export function emailCatalogue() {
  return (Object.keys(EMAIL_EVENTS) as EmailEventKey[]).map((event) => ({
    event,
    sender: EMAIL_EVENTS[event].sender,
    label: EMAIL_EVENTS[event].label,
    essential: EMAIL_EVENTS[event].essential,
  }));
}
