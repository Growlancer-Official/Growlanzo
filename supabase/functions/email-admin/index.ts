// ────────────────────────────────────────────────────────────────────────────
// email-admin — admin email monitoring + test console
//
// Every action is gated on a real session AND profiles_private.is_admin
// (AGENTS §3.4: admin checks are server-side, never only in a route guard).
//
// Actions:
//   stats   → delivery counters (total/queued/sent/delivered/bounced/failed)
//   list    → filtered, paginated email_logs
//   detail  → one log row + its Brevo delivery events
//   retry   → re-send a failed row (authorised, rate-limited)
//   test    → send a real test message (to the CALLING ADMIN only)
//   senders → which of the four verified identities are configured
//   events  → event → sender catalogue
//
// The test action can never be pointed at an arbitrary address: the recipient
// is always the admin's own account email, which makes the console useless as
// a spam relay even if an admin token leaks.
// ────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { listSenders, getSender, type EmailSenderKey } from '../_shared/emailSenders.ts';
import { brandedEmailHtml, escapeHtml, renderEmail, isEmailEvent } from '../_shared/emailTemplates.ts';
import {
  emailCatalogue,
  isValidRecipient,
  retryEmailLog,
  sendLoggedEmail,
  sendTransactionalEmail,
} from '../_shared/emailService.ts';

/** Admin-only actions are capped so a stuck client cannot flood Brevo. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 30;
const sendLog = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const hits = (sendLog.get(userId) ?? []).filter((t) => t > now - RATE_WINDOW_MS);
  if (hits.length >= MAX_SENDS_PER_WINDOW) return true;
  hits.push(now);
  sendLog.set(userId, hits);
  if (sendLog.size > 2000) {
    for (const [k, v] of sendLog) {
      if (!v.some((t) => t > now - RATE_WINDOW_MS)) sendLog.delete(k);
    }
  }
  return false;
}

const json = (body: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const VALID_STATUSES = [
  'queued', 'processing', 'sent', 'delivered', 'deferred', 'bounced', 'blocked', 'failed',
];

/** Purpose-built test message so each of the four identities is verifiable. */
function testEmailFor(senderKey: EmailSenderKey): { subject: string; html: string; text: string } {
  const sender = getSender(senderKey);
  const purpose: Record<EmailSenderKey, string> = {
    security: 'OTP, email verification, password reset and security alerts',
    support: 'support tickets, acknowledgements and complaint correspondence',
    hello: 'welcome emails, registration confirmation and onboarding',
    info: 'project, proposal, milestone, payment and activity notifications',
  };
  const heading = `Test email — ${sender.name}`;
  const intro = `This is a live delivery test from the Growlanzo email console. It was sent from ${sender.email}, the identity reserved for ${purpose[senderKey]}.`;

  return {
    subject: `[TEST] ${sender.name} — delivery check`,
    html: brandedEmailHtml({
      title: heading,
      preheader: intro,
      bodyHtml: `
        <p style="font-size:16px;color:#0f172a;line-height:1.7;margin:0 0 18px;">${escapeHtml(intro)}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
          <tr><td style="padding:16px 18px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;width:42%;">Sender name</td><td style="color:#0f172a;font-weight:600;">${escapeHtml(sender.name)}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;">Sender address</td><td style="color:#0f172a;font-weight:600;">${escapeHtml(sender.email)}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;">Purpose</td><td style="color:#0f172a;font-weight:600;">${escapeHtml(purpose[senderKey])}</td></tr>
            </table>
          </td></tr>
        </table>
        <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0;">If this arrived in your inbox, the ${escapeHtml(senderKey)} identity is working.</p>`,
      tone: 'success',
    }),
    text: [
      heading,
      '',
      intro,
      '',
      `Sender name: ${sender.name}`,
      `Sender address: ${sender.email}`,
      `Purpose: ${purpose[senderKey]}`,
      '',
      `If this arrived in your inbox, the ${senderKey} identity is working.`,
    ].join('\n'),
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = getCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized — valid session required' }, 401, cors);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    // Server-side admin check. profiles_private.is_admin is the canonical flag.
    const { data: priv } = await admin
      .from('profiles_private')
      .select('is_admin, email')
      .eq('id', user.id)
      .maybeSingle();

    if (!priv?.is_admin) {
      console.warn(`[email-admin] FORBIDDEN: non-admin ${user.id} attempted access`);
      return json({ error: 'Forbidden — admin access required' }, 403, cors);
    }

    const adminEmail = String(priv.email ?? user.email ?? '').trim();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '').trim();

    // ── stats ───────────────────────────────────────────────────────────────
    if (action === 'stats') {
      const days = Math.min(Math.max(Number(body.days ?? 30), 1), 365);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await admin.rpc('get_email_log_stats', { p_since: since });
      if (error) return json({ error: error.message }, 500, cors);
      return json({ stats: data }, 200, cors);
    }

    // ── list ────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
      const offset = Math.max(Number(body.offset ?? 0), 0);

      let query = admin
        .from('email_logs')
        .select(
          'id, recipient_email, sender_email, sender_name, event_type, subject, template_id, brevo_message_id, status, error_message, retry_count, created_at, sent_at, delivered_at, bounced_at, failed_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const recipient = String(body.recipient ?? '').trim().toLowerCase();
      if (recipient) query = query.ilike('recipient_email', `%${recipient}%`);

      const eventType = String(body.event_type ?? '').trim();
      if (eventType) query = query.eq('event_type', eventType);

      const sender = String(body.sender ?? '').trim().toLowerCase();
      if (sender) query = query.eq('sender_email', sender);

      const status = String(body.status ?? '').trim();
      if (status && VALID_STATUSES.includes(status)) query = query.eq('status', status);

      const from = String(body.from ?? '').trim();
      if (from) query = query.gte('created_at', new Date(from).toISOString());

      const to = String(body.to ?? '').trim();
      if (to) query = query.lte('created_at', new Date(to).toISOString());

      const { data, error, count } = await query;
      if (error) return json({ error: error.message }, 500, cors);
      return json({ rows: data ?? [], total: count ?? 0 }, 200, cors);
    }

    // ── detail ──────────────────────────────────────────────────────────────
    if (action === 'detail') {
      const id = String(body.id ?? '').trim();
      if (!id) return json({ error: 'id is required' }, 400, cors);

      const [{ data: log, error: logError }, { data: events }] = await Promise.all([
        admin.from('email_logs').select('*').eq('id', id).maybeSingle(),
        admin
          .from('email_log_events')
          .select('event, event_at, received_at, payload')
          .eq('email_log_id', id)
          .order('received_at', { ascending: true }),
      ]);

      if (logError) return json({ error: logError.message }, 500, cors);
      if (!log) return json({ error: 'Email log not found' }, 404, cors);
      return json({ log, events: events ?? [] }, 200, cors);
    }

    // ── retry ───────────────────────────────────────────────────────────────
    if (action === 'retry') {
      if (rateLimited(`retry:${user.id}`)) return json({ error: 'Rate limit exceeded' }, 429, cors);
      const id = String(body.id ?? '').trim();
      if (!id) return json({ error: 'id is required' }, 400, cors);
      const outcome = await retryEmailLog(id, {});
      return json({ outcome }, outcome.ok ? 200 : 502, cors);
    }

    // ── senders ─────────────────────────────────────────────────────────────
    if (action === 'senders') {
      const senders = listSenders();
      return json({ senders }, 200, cors);
    }

    // ── events ──────────────────────────────────────────────────────────────
    if (action === 'events') {
      return json({ events: emailCatalogue() }, 200, cors);
    }

    // ── test ────────────────────────────────────────────────────────────────
    if (action === 'test') {
      if (!adminEmail || !isValidRecipient(adminEmail)) {
        return json({ error: 'Admin account has no usable email address' }, 400, cors);
      }
      if (rateLimited(user.id)) {
        return json({ error: 'Rate limit exceeded — try again later' }, 429, cors);
      }

      const eventRaw = String(body.event ?? '').trim();
      const senderRaw = String(body.sender ?? '').trim() as EmailSenderKey;

      if (eventRaw) {
        if (!isEmailEvent(eventRaw)) return json({ error: `Unknown event: ${eventRaw}` }, 400, cors);
        const sample = (body.data ?? {}) as Record<string, unknown>;
        const outcome = await sendTransactionalEmail({
          event: eventRaw,
          to: adminEmail,
          recipientUserId: user.id,
          data: {
            name: 'Test Admin',
            email: adminEmail,
            project_title: 'Sample project',
            client_name: 'Sample client',
            freelancer_name: 'Sample freelancer',
            milestone_title: 'Sample milestone',
            amount: 25000,
            net_amount: 24500,
            rating: 5,
            status: 'in progress',
            method: 'UPI',
            reference: 'TEST-REF-001',
            role: 'freelancer',
            ...sample,
          },
          idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : null,
          metadata: { source: 'admin-test-console', event: eventRaw },
        });
        return json({ outcome, recipient: adminEmail, mode: 'event', event: eventRaw }, 200, cors);
      }

      const keys: EmailSenderKey[] = ['security', 'support', 'hello', 'info'];
      if (!keys.includes(senderRaw)) {
        return json({ error: 'sender must be one of security|support|hello|info (or pass event)' }, 400, cors);
      }

      const msg = testEmailFor(senderRaw);
      const outcome = await sendLoggedEmail({
        event: `test_${senderRaw}`,
        to: adminEmail,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        senderKey: senderRaw,
        templateId: `test-${senderRaw}`,
        recipientUserId: user.id,
        idempotencyKey: body.idempotencyKey
          ? String(body.idempotencyKey)
          : `test:${senderRaw}:${Date.now()}`,
        metadata: { source: 'admin-test-console', sender: senderRaw },
      });

      return json({ outcome, recipient: adminEmail, mode: 'sender', sender: senderRaw }, 200, cors);
    }

    return json({ error: `Unknown action: ${action || '(none)'}` }, 400, cors);
  } catch (err) {
    console.error('[email-admin] error:', err instanceof Error ? err.message : err);
    return json({ error: 'Internal server error' }, 500, cors);
  }
});
