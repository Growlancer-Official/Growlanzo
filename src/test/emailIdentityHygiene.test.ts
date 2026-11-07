import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard for email-identity hygiene: the private owner Gmail must never appear in
 * customer-facing/public surfaces, and every customer-facing message must use one
 * of the four verified @growlanzo.com senders.
 *
 * The private owner Gmail (growlanzo.own@gmail.com) is the RECIPIENT for internal
 * admin alerts only (security-alert-notify, admin-data send_admin_notification,
 * internship-applications, proposal-notifications ADMIN_EMAIL) — never a From
 * address or a public contact link.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

const OWNER_GMAIL = 'growlanzo.own@gmail.com';

const PUBLIC_FRONTEND_SURFACES = [
  'src/components/SiteFooter.tsx',
  'src/pages/ContactPage.tsx',
  'src/pages/TermsPage.tsx',
  'src/pages/PrivacyPage.tsx',
  'src/pages/ReportFeedbackPage.tsx',
  'src/pages/CookiesPage.tsx',
  'src/pages/UnsubscribePage.tsx',
  'src/pages/dashboard/SupportTicketsPage.tsx',
  'src/components/AIChatSupport.tsx',
  'src/pages/admin/AdminLoginPage.tsx',
  'README.md',
];

const CUSTOMER_FACING_BACKEND_FILES = [
  'supabase/functions/email-notifications/index.ts',
  'supabase/functions/submit-report/index.ts',
  'supabase/functions/ai-ticket-responder/index.ts',
];

/** admin-data/index.ts: customer-facing parts must not carry the owner Gmail. */
const ADMIN_DATA_FILE = 'supabase/functions/admin-data/index.ts';
const ADMIN_DATA_CUSTOMER_FACING_MARKERS = [
  // certificate email footer signatures
  '✉️ ',
  // test_email default recipient
  "body?.to || '",
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('email identity hygiene — private owner Gmail is not customer-facing', () => {
  it('the owner Gmail is absent from every public frontend surface', () => {
    for (const rel of PUBLIC_FRONTEND_SURFACES) {
      expect(read(rel), rel).not.toContain(OWNER_GMAIL);
    }
  });

  it('the owner Gmail is absent from customer-facing backend email templates', () => {
    for (const rel of CUSTOMER_FACING_BACKEND_FILES) {
      expect(read(rel), rel).not.toContain(OWNER_GMAIL);
    }
    // admin-data certificate footers + test_email default must not carry it either.
    const adminData = read(ADMIN_DATA_FILE);
    const lines = adminData.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(OWNER_GMAIL)) continue;
      // Allow the owner Gmail only in the internal send_admin_notification recipient
      // context. Any other line that contains it is a customer-facing leak.
      const isInternalAlertRecipient =
        line.includes('ADMIN_EMAIL') ||
        line.includes('send_admin_notification') ||
        line.includes('Admin Notification') ||
        line.includes('admin notification') ||
        line.includes('//   1) Admin notification');
      expect(isInternalAlertRecipient, `admin-data: owner Gmail in customer-facing context (line ${i + 1}): ${line.slice(0, 140)}`).toBe(true);
    }
  });

  it('the owner Gmail lives only as the internal admin-alert RECIPIENT', () => {
    // These server-side edge functions send TO the owner Gmail as an internal admin
    // alert — the one place the private Gmail is legitimately used, and it is never
    // exposed to a customer (recipient, not From/contact).
    const INTERNAL_ALERT_RECIPIENTS = [
      'supabase/functions/admin-data/index.ts',
      'supabase/functions/security-alert-notify/index.ts',
      'supabase/functions/internship-applications/index.ts',
      'supabase/functions/proposal-notifications/index.ts',
    ];

    for (const rel of INTERNAL_ALERT_RECIPIENTS) {
      expect(read(rel), rel).toContain(OWNER_GMAIL);
    }

    // security-alert-notify now sends FROM the security identity (not the legacy
    // fallback), so the owner Gmail there is only the recipient.
    expect(read('supabase/functions/security-alert-notify/index.ts')).toContain("getSender('security')");
  });

  it('the default Brevo sender fallback is a verified domain sender, never the owner Gmail', () => {
    const BREVO = read('supabase/functions/_shared/brevo.ts');
    expect(BREVO).not.toContain(`'Growlanzo <${OWNER_GMAIL}>'`);
    expect(BREVO).toContain('info@growlanzo.com');
  });

  it('the four verified senders are the documented defaults', () => {
    const SENDERS = read('supabase/functions/_shared/emailSenders.ts');
    expect(SENDERS).toContain("security: { name: 'Growlanzo Security', email: 'security@growlanzo.com' }");
    expect(SENDERS).toContain("support: { name: 'Growlanzo Support', email: 'support@growlanzo.com' }");
    expect(SENDERS).toContain("hello: { name: 'Growlanzo Team', email: 'hello@growlanzo.com' }");
    expect(SENDERS).toContain("info: { name: 'Growlanzo Notifications', email: 'info@growlanzo.com' }");
  });
});
