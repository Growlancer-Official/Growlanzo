// ═══════════════════════════════════════════════════════════════════════════
// Shared Brevo email transport for all Growlanzo edge functions.
//
// This module is the ONLY place that talks to the Brevo API. Two entry points:
//
//   sendEmailDetailed(opts) → { ok, status, messageId, error, retryable }
//       Full result, used by _shared/emailService.ts (which logs + retries).
//
//   sendEmail(opts) → boolean
//       Backwards-compatible wrapper kept for the existing callers
//       (security-alert-notify, submit-report, internship-applications, …).
//
// Reads BREVO_API_KEY from edge-function secrets (never exposed to the
// browser, never committed). A missing key is a logged no-op, not a crash.
//
// Brevo (formerly Sendinblue) — https://developers.brevo.com
// ═══════════════════════════════════════════════════════════════════════════

import type { EmailSenderKey } from './emailSenders.ts';

export interface BrevoSender {
  name: string;
  email: string;
}

export interface EmailAttachment {
  url?: string;
  name?: string;
  filename?: string;
  content?: string; // base64 content (used with filename)
  path?: string; // URL to the attachment file
  type?: string; // MIME type (used with filename/content)
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always sent when provided. */
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  /** Verified sender identity. Defaults to the EMAIL_FROM legacy address. */
  sender?: BrevoSender;
  /** Sender key, for callers that only know the purpose (logs/tags). */
  senderKey?: EmailSenderKey;
  /** Brevo tags (used for dashboard filtering, never PII). */
  tags?: string[];
  /** Correlation value echoed back by Brevo in webhook payloads. */
  customHeader?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** HTTP status from Brevo (0 when the request never left the function). */
  status: number;
  messageId?: string;
  error?: string;
  /** True when a retry could plausibly succeed (429 / 5xx / network). */
  retryable: boolean;
  /** True when the key is absent, so nothing was attempted. */
  skipped?: boolean;
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Parse "Name <addr@domain>" or a bare address into Brevo's sender shape. */
export function parseSender(raw: string, fallbackName = 'Growlanzo'): BrevoSender {
  const match = String(raw ?? '').trim().match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim() || fallbackName, email: match[2].trim() };
  }
  return { name: fallbackName, email: String(raw ?? '').trim() };
}

/**
 * Legacy default sender. Kept for the callers that do not route by purpose
 * (admin reports, internships). New code must pass an explicit `sender` from
 * _shared/emailSenders.ts so every message uses one of the four verified
 * identities.
 */
function legacySender(): BrevoSender {
  return parseSender(
    Deno.env.get('EMAIL_FROM') ?? 'Growlanzo <growlanzo.own@gmail.com>',
    'Growlanzo',
  );
}

/** Send one transactional email and report exactly what Brevo answered. */
export async function sendEmailDetailed(opts: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  if (!apiKey) {
    console.log('[brevo] BREVO_API_KEY not set — email not sent:', opts.subject);
    return { ok: false, status: 0, retryable: false, skipped: true, error: 'BREVO_API_KEY not set' };
  }

  const sender = opts.sender ?? legacySender();
  const replyTo = opts.replyTo ?? Deno.env.get('EMAIL_REPLY_TO');

  try {
    const payload: Record<string, unknown> = {
      sender,
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.html,
    };
    if (opts.text) payload.textContent = opts.text;
    if (replyTo) payload.replyTo = { email: replyTo };
    if (opts.tags && opts.tags.length > 0) payload.tags = opts.tags.slice(0, 10);
    if (opts.customHeader) payload.headers = { 'X-Growlanzo-Ref': opts.customHeader };
    if (opts.attachments && opts.attachments.length > 0) {
      payload.attachment = opts.attachments.map((a) => {
        const url = a.url || a.path;
        const name = a.name || a.filename || 'attachment';
        if (url) return { name, url };
        return { name, content: a.content || '' };
      });
    }

    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await res.text();

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      // Never log the recipient (PII) — subject + status only.
      console.error('[brevo] Brevo error', res.status, rawBody.slice(0, 500));
      return {
        ok: false,
        status: res.status,
        retryable,
        error: `Brevo ${res.status}: ${rawBody.slice(0, 400)}`,
      };
    }

    let messageId: string | undefined;
    try {
      messageId = (JSON.parse(rawBody) as { messageId?: string })?.messageId;
    } catch {
      messageId = undefined;
    }

    console.log('[brevo] Email accepted by Brevo:', opts.subject);
    return { ok: true, status: res.status, messageId, retryable: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[brevo] Brevo exception:', message);
    return { ok: false, status: 0, retryable: true, error: message };
  }
}

/**
 * Backwards-compatible boolean wrapper.
 * - Never throws.
 * - Returns false when the key is missing, Brevo rejects, or the network fails.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const result = await sendEmailDetailed(opts);
  return result.ok;
}
