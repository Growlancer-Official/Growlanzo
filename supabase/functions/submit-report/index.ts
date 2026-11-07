// Submit Report / Feedback Edge Function
// Users report bugs, request features, or share feedback. Each report is:
//   1) Stored in public.user_reports (service role — RLS still guards the table)
//   2) Emailed to the monitored support inbox (support@growlanzo.com) via Brevo
//      when BREVO_API_KEY is configured (graceful no-op fallback otherwise).
//      Customer replies to this address reach the support team; the raw owner
//      Gmail is never exposed to the reporter.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/brevo.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { SITE_URL } from '../_shared/site.ts'

const REPORT_EMAIL = Deno.env.get('REPORT_EMAIL') ?? 'support@growlanzo.com'
const APP_URL = SITE_URL

// ─── HTML Escape Helper ──────────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


// ─── Email Sender (Brevo when configured — graceful no-op otherwise) ───────
async function sendReportEmail(payload: {
  reportId: string;
  name: string;
  email: string | null;
  reportType: string;
  category: string;
  priority: string;
  title: string;
  description: string;
  pageUrl: string;
  browserInfo: string;
  userId: string | null;
}): Promise<boolean> {
  const typeLabels: Record<string, string> = {
    bug: '🐛 Bug Report',
    feature: '✨ Feature Request',
    feedback: '💬 Feedback',
    security: '🔒 Security Concern',
    other: '📝 Other',
  };
  const priorityColors: Record<string, string> = {
    low: '#94a3b8',
    medium: '#f59e0b',
    high: '#f97316',
    critical: '#ef4444',
  };

  const subject = `[${payload.priority.toUpperCase()}] ${typeLabels[payload.reportType] || 'Report'}: ${payload.title.slice(0, 80)}`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:linear-gradient(135deg,#14861f,#0d9488);padding:24px 32px;">
      <h1 style="margin:0;color:#ffffff;font-size:20px;">New User Report — Growlanzo</h1>
      <p style="margin:6px 0 0;color:#ddf7d9;font-size:13px;">Report ID: <strong>${escapeHtml(payload.reportId.slice(0, 8))}</strong></p>
    </div>
    <div style="padding:32px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:140px;">Type</td><td style="padding:8px 0;font-weight:600;color:#0f172a;">${escapeHtml(typeLabels[payload.reportType] || payload.reportType)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Priority</td><td style="padding:8px 0;"><span style="display:inline-block;padding:2px 10px;border-radius:999px;color:#fff;background:${priorityColors[payload.priority] || '#94a3b8'};font-weight:600;font-size:12px;text-transform:uppercase;">${escapeHtml(payload.priority)}</span></td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Category</td><td style="padding:8px 0;font-weight:600;color:#0f172a;">${escapeHtml(payload.category || '—')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Submitted by</td><td style="padding:8px 0;color:#0f172a;">${escapeHtml(payload.name || 'Guest')}${payload.email ? ` &lt;${escapeHtml(payload.email)}&gt;` : ''}${payload.userId ? ` (user: ${escapeHtml(payload.userId.slice(0, 8))})` : ''}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Page</td><td style="padding:8px 0;"><a href="${escapeHtml(payload.pageUrl)}" style="color:#14861f;">${escapeHtml(payload.pageUrl || '—')}</a></td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Browser</td><td style="padding:8px 0;color:#0f172a;word-break:break-all;">${escapeHtml(payload.browserInfo || '—')}</td></tr>
      </table>
      <div style="margin-top:20px;padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
        <p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:15px;">${escapeHtml(payload.title)}</p>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(payload.description)}</p>
      </div>
      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
        Sent automatically from ${escapeHtml(APP_URL)} · Manage this report in the admin panel.
      </p>
    </div>
  </div>
</body></html>`;

  // Send via the shared Brevo helper (subject-only logging, never PII).
  return sendEmail({
    to: REPORT_EMAIL,
    subject,
    html,
    ...(payload.email ? { replyTo: payload.email } : {}),
  });
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────
// submit-report is a public endpoint that inserts into user_reports and
// sends emails via Brevo. Without rate limiting, an attacker could spam
// thousands of reports flooding the inbox and burning Brevo quota.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const ROUTE = 'submit-report';

async function checkReportRateLimit(supabaseClient: any, identifier: string): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
  try { await supabaseClient.rpc('cleanup_expired_rate_limits'); } catch { /* non-critical */ }
  const { count, error } = await supabaseClient
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('identifier', identifier)
    .eq('route', ROUTE)
    .gte('window_start', windowStart.toISOString());
  if (error) return true;
  if (count !== null && count >= RATE_LIMIT_MAX) return false;
  await supabaseClient.from('rate_limits').insert({ identifier, route: ROUTE, count: 1, window_start: now.toISOString() });
  return true;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // Rate limit by IP (public endpoint — no JWT required)
  const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
  const rateAllowed = await checkReportRateLimit(supabaseClient, clientIP);
  if (!rateAllowed) {
    return new Response(JSON.stringify({ error: 'Too many reports — please try again later.' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()
    const { data: { user } } = await supabaseClient.auth.getUser()

    const reportType = String(body.report_type || 'other').trim()
    const title = String(body.title || '').trim()
    const description = String(body.description || '').trim()
    const category = String(body.category || '').trim().slice(0, 80) || null
    const priority = ['low', 'medium', 'high', 'critical'].includes(String(body.priority || '')) ? String(body.priority) : 'medium'
    const name = String(body.name || user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim().slice(0, 80)
    const email = String(body.email || user?.email || '').trim().slice(0, 160) || null
    const pageUrl = String(body.page_url || '').trim().slice(0, 500) || null
    const browserInfo = String(body.browser_info || '').trim().slice(0, 300) || null

    if (!['bug', 'feature', 'feedback', 'security', 'other'].includes(reportType)) {
      return new Response(JSON.stringify({ error: 'Invalid report type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (title.length < 3 || title.length > 120) {
      return new Response(JSON.stringify({ error: 'Title must be 3–120 characters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (description.length < 10 || description.length > 5000) {
      return new Response(JSON.stringify({ error: 'Description must be 10–5000 characters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: report, error: insertError } = await supabaseClient
      .from('user_reports')
      .insert({
        user_id: user?.id ?? null,
        name,
        email,
        report_type: reportType,
        category,
        priority,
        title,
        description,
        page_url: pageUrl,
        browser_info: browserInfo,
        status: 'new',
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[submit-report] Insert error:', insertError)
      return new Response(JSON.stringify({ error: 'Failed to store report' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Email the company inbox — never blocks a successful submission.
    await sendReportEmail({
      reportId: report.id,
      name,
      email,
      reportType,
      category: category || '',
      priority,
      title,
      description,
      pageUrl: pageUrl || '',
      browserInfo: browserInfo || '',
      userId: user?.id ?? null,
    })

    return new Response(
      JSON.stringify({ success: true, report_id: report.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('[submit-report] Exception:', err)
    return new Response(JSON.stringify({ error: 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
