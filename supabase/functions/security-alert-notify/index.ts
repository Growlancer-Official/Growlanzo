// ────────────────────────────────────────────────────────────────────────────
// security-alert-notify — real-time admin alert for security drift findings
//
// Called by pg_cron → pg_net with the shared CRON_SECRET bearer token
// (verify_jwt = false in config.toml). Reads the latest unresolved
// security_alerts and emails the admin via Brevo.
// ────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail } from '../_shared/brevo.ts';
import { getSender } from '../_shared/emailSenders.ts';
import { SITE_URL } from '../_shared/site.ts';

const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'growlanzo.own@gmail.com';
const APP_URL = SITE_URL;

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildAlertHtml(count: number, alerts: Array<{ severity: string; category: string; detail: string }>): string {
  const rows = alerts.slice(0, 10).map(a => `
    <tr>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;font-weight:600;">${escapeHtml(a.severity.toUpperCase())}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#475569;">${escapeHtml(a.category)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#475569;">${escapeHtml(a.detail)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f1f5f9;padding:24px 12px;margin:0;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.06);">
    <div style="background:linear-gradient(135deg,#b91c1c 0%,#991b1b 100%);padding:28px 24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:20px;font-weight:800;margin:0;">🚨 Security Drift Detected</h1>
    </div>
    <div style="padding:28px 24px;">
      <p style="font-size:15px;color:#0f172a;line-height:1.7;margin:0 0 16px;">
        The hourly security scan found <strong>${count} new finding(s)</strong> on the live database.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th align="left" style="padding:10px 12px;background:#f8fafc;border-radius:8px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Severity</th>
          <th align="left" style="padding:10px 12px;background:#f8fafc;border-radius:8px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Category</th>
          <th align="left" style="padding:10px 12px;background:#f8fafc;border-radius:8px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Detail</th>
        </tr>
        ${rows}
      </table>
      ${alerts.length > 10 ? `<p style="font-size:13px;color:#64748b;margin:12px 0 0;">…and ${alerts.length - 10} more findings.</p>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
        <tr><td align="center">
          <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="background:#14861f;border-radius:12px;padding:14px 32px;" bgcolor="#14861f">
                <a href="${APP_URL}/admin" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Open Admin Console →</a>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </div>
    <div style="padding:20px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.5;">Growlanzo — automated security monitoring. Resolve alerts in the admin dashboard or run <code>node scripts/security-audit.mjs</code>.</p>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  // 🔐 CRON_SECRET check — only pg_cron (via pg_net) may call this.
  const expected = Deno.env.get('CRON_SECRET') ?? '';
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  // Accepts the env CRON_SECRET or the DB cron_settings.cron_secret row, so a
  // one-sided secret rotation can never silently break the alert email again.
  let authorized = !!auth && !!expected && auth === expected;
  if (!authorized && auth) {
    try {
      const probe = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      const { data } = await probe.from('cron_settings').select('value').eq('key', 'cron_secret').maybeSingle();
      authorized = !!data?.value && auth === (data.value as string);
    } catch {
      authorized = false;
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: alerts, error } = await supabase
      .from('security_alerts')
      .select('severity, category, detail')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(25);

    if (error) throw error;
    const list = (alerts ?? []) as Array<{ severity: string; category: string; detail: string }>;
    if (!list.length) {
      return new Response(JSON.stringify({ success: true, emailed: false, reason: 'no unresolved alerts' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const critical = list.filter(a => a.severity === 'critical').length;
    const high = list.filter(a => a.severity === 'high').length;

    const emailed = await sendEmail({
      to: ADMIN_EMAIL,
      subject: `🚨 Growlanzo Security: ${critical} critical / ${high} high finding(s)`,
      html: buildAlertHtml(list.length, list),
      sender: getSender('security'),
    });

    return new Response(JSON.stringify({ success: true, emailed, count: list.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('security-alert-notify error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
