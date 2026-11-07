#!/usr/bin/env node
/**
 * ────────────────────────────────────────────────────────────────────────────
 * GROWLANZO — REAL-TIME EMAIL SYSTEM TEST HARNESS
 * ────────────────────────────────────────────────────────────────────────────
 * Exercises the LIVE stack (Supabase edge functions + Brevo) and writes an
 * honest report to docs/EMAIL-TEST-REPORT.md.
 *
 * It never reports PASS for something it did not observe. Anything that needs a
 * credential, DNS permission or a human eye is marked SKIP with the reason and
 * the exact manual step.
 *
 * USAGE
 *   node scripts/e2e/email-tests.mjs
 *
 * ENV (from .env / .env.local / process env)
 *   VITE_SUPABASE_URL              required
 *   VITE_SUPABASE_ANON_KEY         required
 *   EMAIL_TEST_ADMIN_EMAIL         required — an admin account (test account!)
 *   EMAIL_TEST_ADMIN_PASSWORD      required
 *   BREVO_WEBHOOK_SECRET           optional — enables the webhook tests
 *
 * SAFETY
 *   • Every test message goes to the admin's own address; no customer is
 *     touched and no real project/contract/payment row is created.
 *   • No payout, refund or subscription is triggered.
 *   • The report never contains a token, password or API key.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\r/g, '')
        .split(/\n+/)
        .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
        .map((line) => {
          const i = line.indexOf('=');
          let value = line.slice(i + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          return [line.slice(0, i).trim(), value];
        }),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env'), ...process.env };
const SUPABASE_URL = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
const ADMIN_EMAIL = env.EMAIL_TEST_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = env.EMAIL_TEST_ADMIN_PASSWORD || '';
const WEBHOOK_SECRET = env.BREVO_WEBHOOK_SECRET || '';

const results = [];
let jwt = '';

function record(name, expected, actual, status, error = '') {
  results.push({ name, expected, actual, status, error });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} ${name} — ${status}${error ? ` (${error})` : ''}`);
}

async function adminAction(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/email-admin`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(
      `Admin sign-in failed (HTTP ${res.status}). Check EMAIL_TEST_ADMIN_EMAIL / EMAIL_TEST_ADMIN_PASSWORD.`,
    );
  }
  jwt = json.access_token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for a freshly written log row to appear (edge functions are async). */
async function findLog(eventType, idempotencyHint = null) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await adminAction({ action: 'list', event_type: eventType, limit: 5 });
    if (res.ok && Array.isArray(res.json?.rows) && res.json.rows.length > 0) {
      if (!idempotencyHint) return res.json.rows[0];
      return res.json.rows[0];
    }
    await sleep(700);
  }
  return null;
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log(' Growlanzo — email system live test');
  console.log('══════════════════════════════════════════════════════\n');

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('❌ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. Nothing was tested.');
    process.exit(2);
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      '❌ EMAIL_TEST_ADMIN_EMAIL / EMAIL_TEST_ADMIN_PASSWORD missing.\n' +
        '   Use a dedicated test admin account — never a customer account.',
    );
    process.exit(2);
  }

  await signIn();
  console.log(`Signed in as ${ADMIN_EMAIL}\n`);

  // ── 0. Sender identities ────────────────────────────────────────────────
  {
    const res = await adminAction({ action: 'senders' });
    const senders = res.json?.senders ?? [];
    const expected = ['security@growlanzo.com', 'support@growlanzo.com', 'hello@growlanzo.com', 'info@growlanzo.com'];
    const missing = expected.filter((email) => !senders.some((s) => s.email === email));
    record(
      '0. Four sender identities resolved',
      `security/support/hello/info present`,
      missing.length === 0 ? 'all four resolved' : `missing: ${missing.join(', ')}`,
      res.ok && missing.length === 0 ? 'PASS' : 'FAIL',
      res.ok ? '' : `HTTP ${res.status}`,
    );
  }

  // ── 1-4. One live test per sender identity ──────────────────────────────
  for (const [index, sender] of ['hello', 'security', 'support', 'info'].entries()) {
    const label = `Test ${index + 1}. ${sender}@growlanzo.com delivery`;
    try {
      const res = await adminAction({ action: 'test', sender });
      const outcome = res.json?.outcome;
      const ok = res.ok && outcome?.ok === true;
      record(
        label,
        'Brevo accepts the message; email_logs row status = sent',
        outcome ? `ok=${outcome.ok} status=${outcome.status} id=${outcome.messageId ?? 'none'}` : `HTTP ${res.status}`,
        ok ? 'PASS' : 'FAIL',
        ok ? '' : outcome?.error || `HTTP ${res.status}`,
      );
      if (ok) {
        const row = await findLog(`test_${sender}`);
        if (!row) {
          record(
            `${label} — audit row`,
            'email_logs row exists for this event',
            'no row found',
            'FAIL',
            'log write did not appear within ~4s',
          );
        }
      }
    } catch (err) {
      record(label, 'message accepted', 'exception', 'FAIL', err.message);
    }
  }

  // ── 5-9. Workflow templates (rendered + delivered, not workflow-triggered) ──
  const workflowTests = [
    ['5. Client registration / welcome', 'welcome', { role: 'client' }],
    ['6. Freelancer welcome', 'welcome', { role: 'freelancer' }],
    ['7. Project invitation', 'project_invitation', {}],
    ['8. Proposal notification', 'proposal_received', {}],
    ['9. Payment confirmation (sandbox data)', 'payment_success', { amount: 100, reference: 'SANDBOX-TEST' }],
  ];

  for (const [label, event, data] of workflowTests) {
    try {
      const res = await adminAction({ action: 'test', event, data });
      const outcome = res.json?.outcome;
      const ok = res.ok && outcome?.ok === true;
      record(
        label,
        `template "${event}" renders and is accepted by Brevo`,
        outcome ? `ok=${outcome.ok} status=${outcome.status}` : `HTTP ${res.status}`,
        ok ? 'PASS' : 'FAIL',
        ok ? '' : outcome?.error || `HTTP ${res.status}`,
      );
    } catch (err) {
      record(label, 'template accepted', 'exception', 'FAIL', err.message);
    }
  }

  record(
    '5-9 note',
    'workflow triggers (signup, invitation, proposal, payment) fire without manual action',
    'not exercised — these tests render and deliver the template via the admin console',
    'SKIP',
    'Triggering real workflows would create live project/payment rows. Manual check required.',
  );

  // ── 10. Password reset ──────────────────────────────────────────────────
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL }),
    });
    record(
      '10. Password reset email',
      'Supabase Auth accepts the reset request (HTTP 200)',
      `HTTP ${res.status}`,
      res.ok ? 'PASS' : 'FAIL',
      res.ok ? 'Sent by Supabase Auth SMTP, not the Brevo API — see manual step.' : await res.text(),
    );
  } catch (err) {
    record('10. Password reset email', 'HTTP 200', 'exception', 'FAIL', err.message);
  }

  // ── 11. Duplicate prevention ────────────────────────────────────────────
  try {
    const key = `dup-test-${Date.now()}`;
    const first = await adminAction({ action: 'test', event: 'welcome', idempotencyKey: key });
    const second = await adminAction({ action: 'test', event: 'welcome', idempotencyKey: key });
    const firstOk = first.ok && first.json?.outcome?.ok === true;
    const duplicated = second.json?.outcome?.duplicate === true;
    record(
      '11. Duplicate event prevention',
      'second send with the same idempotency key is not delivered',
      `first.ok=${firstOk} second.duplicate=${duplicated}`,
      firstOk && duplicated ? 'PASS' : 'FAIL',
      firstOk && duplicated ? '' : 'idempotency guard did not stop the second send',
    );
  } catch (err) {
    record('11. Duplicate event prevention', 'second send skipped', 'exception', 'FAIL', err.message);
  }

  // ── 12. Invalid input handling ──────────────────────────────────────────
  try {
    const res = await adminAction({ action: 'test', sender: 'attacker@example.com' });
    record(
      '12. Invalid sender/recipient input rejected',
      'HTTP 400 — arbitrary From addresses are refused',
      `HTTP ${res.status}`,
      res.status === 400 ? 'PASS' : 'FAIL',
      res.status === 400 ? '' : res.text.slice(0, 160),
    );
  } catch (err) {
    record('12. Invalid input handling', 'HTTP 400', 'exception', 'FAIL', err.message);
  }

  // ── 13. Brevo failure + retry ───────────────────────────────────────────
  record(
    '13. Brevo API failure and retry handling',
    'a 429/5xx response is retried with backoff, then marked failed',
    'not exercised',
    'SKIP',
    'A real provider failure cannot be forced safely. Code path: emailService.retry (3 attempts, 400ms/1200ms) + admin Retry button.',
  );

  // ── 14. Webhook ─────────────────────────────────────────────────────────
  if (!WEBHOOK_SECRET) {
    record(
      '14. Webhook event processing',
      'signed event advances email_logs.status',
      'not exercised',
      'SKIP',
      'BREVO_WEBHOOK_SECRET is not set locally. Set it, deploy brevo-webhook, and point Brevo at /functions/v1/brevo-webhook?token=<secret>.',
    );
  } else {
    const url = `${SUPABASE_URL}/functions/v1/brevo-webhook`;
    const payload = {
      event: 'delivered',
      email: ADMIN_EMAIL,
      'message-id': `<test-${Date.now()}@growlanzo.com>`,
      ts: Math.floor(Date.now() / 1000),
    };
    try {
      const bad = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const good = await fetch(`${url}?token=${encodeURIComponent(WEBHOOK_SECRET)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const goodBody = await good.json().catch(() => null);
      record(
        '14. Webhook signature + processing',
        'no secret ⇒ 401, valid secret ⇒ 200 processed',
        `unsigned=${bad.status} signed=${good.status} processed=${goodBody?.processed ?? 'n/a'}`,
        bad.status === 401 && good.status === 200 ? 'PASS' : 'FAIL',
        bad.status === 401 && good.status === 200 ? '' : 'check BREVO_WEBHOOK_SECRET matches the deployed secret',
      );
    } catch (err) {
      record('14. Webhook event processing', 'unsigned 401 / signed 200', 'exception', 'FAIL', err.message);
    }
  }

  // ── 15. Mobile responsiveness ───────────────────────────────────────────
  record(
    '15. Mobile email responsiveness',
    'renders at 375px without horizontal scroll',
    'not exercised',
    'SKIP',
    'Requires visual inspection in a real client. Templates use a 600px max-width table-free layout with a 100% wrapper.',
  );

  // ── Report ──────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  const lines = [
    '# Growlanzo — Email Test Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Project: ${SUPABASE_URL}`,
    `Test account: ${ADMIN_EMAIL}`,
    '',
    `**Result: ${passed} passed · ${failed} failed · ${skipped} skipped**`,
    '',
    '| Test | Expected | Actual | Status | Error / reason |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.expected.replace(/\|/g, '\\|')} | ${r.actual.replace(/\|/g, '\\|')} | ${r.status} | ${(r.error || '—').replace(/\|/g, '\\|')} |`,
    ),
    '',
    '> PASS means the stack actually answered for that step. SKIP means the check needs a credential,',
    '> DNS permission, or a human eye — the manual step is named in the table.',
    '',
  ];

  const outPath = path.join(ROOT, 'docs/EMAIL-TEST-REPORT.md');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\nReport written: ${path.relative(ROOT, outPath)}`);
  console.log(`\n${passed} passed · ${failed} failed · ${skipped} skipped\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\n❌ email test harness failed:', err.message);
  process.exit(2);
});
