// Admin Data Proxy Edge Function — uses real Supabase Auth for admin verification
// Deferred (410): verify_certificate, verify_credential_qr — certificates are not
// part of the early-access scope and their public route leaked applicant PII.
// Public action that remains: send_welcome_email (authenticated, own address only).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/brevo.ts'
import { featureDisabledResponse } from '../_shared/features.ts';
import { SITE_URL } from '../_shared/site.ts';

// Public site origin for every email template in this function (single source
// of truth: supabase/functions/_shared/site.ts).
const APP_URL = SITE_URL;

// ─── Configuration ──────────────────────────────────────────────────

// Allowed tables for admin CRUD operations — restricts the generic proxy
const ALLOWED_TABLES = [
  'profiles', 'profiles_private', 'freelancer_profiles', 'client_profiles',
  'projects', 'proposals', 'contracts', 'escrow',
  'transactions', 'withdrawals', 'subscriptions', 'subscription_plans',
  'services', 'messages', 'notifications', 'reviews',
  'invites', 'project_matches', 'referrals', 'referral_stats',
  'paypal_orders', 'paypal_transactions', 'razorpay_orders', 'razorpay_transactions',
  'categories', 'subcategories', 'skills',
  'skill_certifications', 'internship_applications',
  'credential_verification_tokens', 'credential_version_history', 'credential_audit_logs',
  'verification_rate_limits',
  'identity_verifications', 'support_tickets',
  'usage_logs', 'rate_limits',
  'user_deletion_requests', 'user_mfa_settings', 'recovery_codes',
  'notification_preferences', 'payout_methods',
  'wallets', 'portfolio_items', 'disputes', 'invoices',
  'waitlist', 'countries', 'industries', 'user_reports',
  'saved_searches', 'time_entries', 'connects_transactions',
  'review_replies', 'ai_matches', 'opportunity_events',
  'workspaces', 'workspace_members', 'team_invitations',
  'milestones', 'workspace_activity_logs', 'fraud_events',
  'deletion_failures',
  // Display FX rates (admin sets them, public reads via RPC — table itself RLS-protected).
  'fx_rates',
];

// Ledger-bearing tables. These stay READABLE here (the admin console lists them)
// but are not writable through this generic proxy: a raw row update bypasses the
// balance/escrow invariants that Security Principle §2 requires to live only in
// SECURITY DEFINER RPCs (row locking, idempotency guard, ledger entry). No client
// code writes them through this proxy — every call site is a read or a realtime
// subscription — so this only closes the hole, it does not remove a capability.
// Anything that genuinely needs to move money must go through an RPC.
const WRITE_BLOCKED_TABLES = ['wallets', 'escrow', 'transactions'];

/** 403 body when an admin tries to write a ledger-bearing table. */
function writeBlockedResponse(
  table: string,
  verb: string,
  corsHeaders: Record<string, string>,
): Response | null {
  if (!WRITE_BLOCKED_TABLES.includes(table)) return null;
  return new Response(
    JSON.stringify({
      error: `${table} is read-only through this endpoint (${verb} blocked). Financial rows must change through their SECURITY DEFINER RPC so the ledger invariants hold.`,
    }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// profiles_private holds PII + the admin flag itself. The admin console only
// ever flips suspension / onboarding state on it, so writes through this
// generic proxy are narrowed to those columns — otherwise a single admin
// request could rewrite `is_admin` (granting admin to anyone), `email` or
// `phone` on any row.
const ALLOWED_PRIVATE_PROFILE_COLUMNS = [
  'id', 'suspended_at', 'suspend_reason', 'suspended_by', 'banned_at', 'onboarding_completed',
];

/** Keys in an profiles_private payload that this proxy refuses to write. */
function disallowedPrivateProfileColumns(payload: Record<string, unknown>): string[] {
  return Object.keys(payload || {}).filter(
    (key) => !ALLOWED_PRIVATE_PROFILE_COLUMNS.includes(key),
  );
}

// Rate limiting for failed admin auth: max 10 failed attempts per IP per 15 minutes
import { getCorsHeaders } from '../_shared/cors.ts';

const MAX_FAILED_ATTEMPTS = 10
const RATE_WINDOW_MS = 15 * 60 * 1000
const ROUTE = 'admin-data-auth'

// ─── Helpers ────────────────────────────────────────────────────────

// ─── HTML Escape Helper ─────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Rate limit failed admin auth attempts per IP (prevents brute-force of admin endpoints) */
async function checkAuthRateLimit(
  supabaseClient: any,
  identifier: string,
): Promise<boolean> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - RATE_WINDOW_MS)

  try { await supabaseClient.rpc('cleanup_expired_rate_limits') } catch { /* ignore */ }

  const { count, error } = await supabaseClient
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('identifier', identifier)
    .eq('route', ROUTE)
    .gte('window_start', windowStart.toISOString())

  if (error) return true // Allow if table doesn't exist yet
  if (count !== null && count >= MAX_FAILED_ATTEMPTS) return false

  await supabaseClient.from('rate_limits').insert({
    identifier,
    route: ROUTE,
    count: 1,
    window_start: now.toISOString(),
  })

  return true
}

const _eh = escapeHtml; // shorthand

// ─── Simple email validation ─────────────────────────────────────────────
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── Email sender (Brevo) ────────────────────────────────────────────────
async function sendNotificationEmail(
  subject: string,
  htmlContent: string,
  to: { email: string; name: string },
  attachments?: { url: string; name: string }[],
): Promise<{ success: boolean; status: number; text: string }> {
  const sent = await sendEmail({
    to: to.email,
    subject,
    html: htmlContent,
    ...(attachments && attachments.length > 0
      ? { attachments: attachments.map((a) => ({ path: a.url, name: a.name, filename: a.name })) }
      : {}),
  });
  return sent
    ? { success: true, status: 200, text: 'Email sent' }
    : { success: false, status: 502, text: 'Email delivery failed (Brevo not configured or API error)' };
}

// ─── Shared Email Template Wrapper ───────────────────────────────────────
// Professional, responsive email template with consistent design system
function baseEmailHtml(title: string, bodyHtml: string, headerGradient?: string): string {
  const bg = headerGradient || '#14861f 0%, #0f6f1a 100%';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f1f5f9; padding: 24px 12px; margin: 0; -webkit-font-smoothing: antialiased;">
  <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;"><tr><td style="padding: 24px 16px;" align="center"><![endif]-->
  <div style="max-width: 600px; width: 100%; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06);">
    
    <!-- Logo Bar -->
    <div style="background: #ffffff; padding: 20px 24px 0; text-align: center;">
      <img src="${APP_URL}/growlanzo-full.png" alt="Growlanzo" style="height: 40px; width: auto; border-radius: 10px;" />
    </div>

    <!-- Header -->
    <div style="background: linear-gradient(135deg, ${bg}); margin: 12px 12px 0; border-radius: 12px; padding: 28px 24px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 20px; font-weight: 800; margin: 0; letter-spacing: -0.3px; word-break: break-word;">${title}</h1>
    </div>

    <!-- Body -->
    <div style="padding: 28px 24px; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; line-height: 1.6;">
      ${bodyHtml}
    </div>

    <!-- Footer -->
    <div style="padding: 20px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <td style="padding-bottom: 12px;">
            <a href="${APP_URL}" target="_blank" rel="noopener noreferrer" style="color: #14861f; font-size: 12px; font-weight: 600; text-decoration: none; padding: 0 8px;">Website</a>
            <span style="color: #cbd5e1; font-size: 12px;">|</span>
            <a href="${APP_URL}/help-center" target="_blank" rel="noopener noreferrer" style="color: #14861f; font-size: 12px; font-weight: 600; text-decoration: none; padding: 0 8px;">Help Center</a>
            <span style="color: #cbd5e1; font-size: 12px;">|</span>
            <a href="${APP_URL}/contact" target="_blank" rel="noopener noreferrer" style="color: #14861f; font-size: 12px; font-weight: 600; text-decoration: none; padding: 0 8px;">Contact</a>
          </td>
        </tr>
        <tr>
          <td>
            <p style="color: #94a3b8; font-size: 11px; margin: 0; line-height: 1.5;">Growlanzo — AI-Powered Freelancing Marketplace</p>
            <p style="color: #cbd5e1; font-size: 10px; margin: 4px 0 0; line-height: 1.5;">© 2026 Growlanzo. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </div>
  </div>
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`
}

/**
 * Verify the caller is an authenticated admin using the standard Supabase Auth session.
 * Reads the Authorization: Bearer <token> header (sent automatically by supabase.functions.invoke),
 * verifies the JWT via auth.getUser(), then checks profiles.is_admin = true.
 * Rate-limits ONLY failed attempts (not valid admin requests) to prevent brute-force.
 */
async function verifyAdminSession(
  serviceClient: any,
  req: Request,
): Promise<{ user_id: string; email: string } | null> {
  const authHeader = req.headers.get('authorization') || ''
  let token = ''
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim()
  }

  if (!token) return null

  // Create an anon-key client to verify the caller's JWT
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  )

  const { data: { user }, error } = await anonClient.auth.getUser()
  if (error || !user) {
    // Rate limit ONLY on failure — prevents brute-force without blocking legitimate admins
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown'
    await checkAuthRateLimit(serviceClient, clientIP)
    return null
  }

  // Check is_admin flag from profiles_private (is_admin was moved there
  // from profiles in migration 20261221000000 — it's no longer on profiles).
  let { data: privData } = await serviceClient
    .from('profiles_private')
    .select('is_admin, email')
    .eq('id', user.id)
    .maybeSingle()

  let isAdmin = privData?.is_admin === true

  // Fallback: check by email if not found by ID (handles ID mismatch)
  if (!isAdmin && user.email) {
    const { data: privByEmail } = await serviceClient
      .from('profiles_private')
      .select('is_admin, email')
      .eq('email', user.email)
      .maybeSingle()
    if (privByEmail?.is_admin === true) {
      privData = privByEmail
      isAdmin = true
    }
  }

  if (!isAdmin) {
    // Rate limit ONLY on failure
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown'
    await checkAuthRateLimit(serviceClient, clientIP)
    return null
  }

  return { user_id: user.id, email: privData?.email || user.email || '' }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Parse body once
    let body: Record<string, any> = {}
    try { body = await req.json() } catch { /* empty body */ }
    const action = body?.action || 'query'

    // ────────────────────────────────────────────────────────────────────
    // PUBLIC ACTIONS (no admin session required)
    // These MUST be handled BEFORE the admin auth check below
    // ────────────────────────────────────────────────────────────────────

    // ─── POST: verify_certificate / verify_credential_qr (DEFERRED) ────────
    // Certificates are deferred for early access (docs/MVP-SCOPE-AND-E2E-TEST-PLAN.md).
    // Until this change the route returned the FULL skill_certifications row, the raw
    // credential token, and the applicant's internship_applications row (name, email,
    // phone, documents) to any anonymous caller — a public PII leak with no working
    // rate limit. Nothing is read now, so the leak is structurally gone rather than
    // filtered. 410 (not 404) tells a crawler and a support agent the truth.
    if (req.method === 'POST' && (action === 'verify_certificate' || action === 'verify_credential_qr')) {
      return featureDisabledResponse(corsHeaders, 'certificates');
    }

    // ─── POST: send_welcome_email (AUTHENTICATED — own verified email only) ─
    // Was PUBLIC with an arbitrary recipient → anyone could spam any address
    // with branded Growlanzo emails (phishing + Brevo quota abuse). Now the
    // caller must be signed in AND the recipient must be their own verified
    // email; IP rate-limited to prevent abuse.
    if (req.method === 'POST' && action === 'send_welcome_email') {
      const { recipient_email, recipient_name: rawRecipientName } = body;

      if (!recipient_email || !rawRecipientName) {
        return new Response(JSON.stringify({ success: false, error: 'recipient_email and recipient_name are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 1) Must be authenticated
      const authHeader = req.headers.get('authorization') || ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
      if (!token) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized: sign in required' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const anonClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      )
      const { data: { user: signer }, error: userErr } = await anonClient.auth.getUser()
      if (userErr || !signer) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized: invalid session' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 2) Recipient must be the caller's OWN verified email
      if (!signer.email || signer.email.toLowerCase() !== String(recipient_email).toLowerCase()) {
        return new Response(JSON.stringify({ success: false, error: 'You can only send a welcome email to your own verified email address' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 3) IP rate limit (5 per 15 min) — prevents email-quota abuse
      const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
      const rateAllowed = await checkAuthRateLimit(supabaseClient, `${clientIP}:welcome_email`);
      if (!rateAllowed) {
        return new Response(JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const recipient_name = _eh(rawRecipientName);

      const rawName = rawRecipientName;
      const subject = `Welcome to Growlanzo, ${rawName}! Your AI-powered journey begins now 🚀`;

      const bodyContent = `
        <p style="font-size: 16px; color: #0f172a; line-height: 1.7; margin: 0 0 6px;">Hey <strong style="color: #14861f;">${recipient_name}</strong> 👋</p>
        <p style="font-size: 14px; color: #475569; line-height: 1.7; margin: 0 0 28px;">Welcome to <strong>Growlanzo</strong> — India's first AI-powered freelancing marketplace. We're thrilled to have you on board!</p>
        <div style="margin-bottom: 28px;">
          ${[
            { emoji: '🔍', title: 'Explore Top Projects', desc: 'Discover freelance opportunities tailored to your unique skills and expertise from top clients worldwide.' },
            { emoji: '🤖', title: 'AI-Powered Matching', desc: 'Our intelligent AI connects you with the perfect projects — no more endless scrolling through irrelevant listings.' },
            { emoji: '🛡️', title: 'Secure Payments', desc: 'Built-in escrow and milestone tracking ensure you get paid reliably and on time, every time.' },
            { emoji: '📈', title: 'Grow Your Career', desc: 'Build your portfolio, earn certifications, and access exclusive resources to advance your freelance career.' },
          ].map((f, i) => `<div style="margin-bottom: ${i < 3 ? '10px' : '0'}; padding: 16px 18px; background: #f1fcef; border: 1px solid #bbefb4; border-radius: 12px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
              <tr><td width="40" style="vertical-align: top; font-size: 22px; text-align: center; padding-right: 12px;">${f.emoji}</td>
                <td style="vertical-align: top;">
                  <h3 style="font-size: 14px; color: #10591a; font-weight: 700; margin: 0 0 2px;">${f.title}</h3>
                  <p style="font-size: 13px; color: #475569; margin: 0; line-height: 1.5;">${f.desc}</p>
                </td>
              </tr>
            </table>
          </div>`).join('')}
        </div>
        <div style="text-align: center; margin-bottom: 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr><td align="center" style="padding: 0;">
              <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                <tr><td style="background: #14861f; border-radius: 12px; padding: 14px 32px;" bgcolor="#14861f">
                  <a href="${APP_URL}/login" target="_blank" rel="noopener noreferrer" style="display: inline-block; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">Go to Dashboard →</a>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </div>
        <div style="margin-bottom: 28px; padding: 16px 20px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr><td width="32" style="vertical-align: top; font-size: 18px; padding-right: 10px;">💡</td>
              <td style="vertical-align: top;">
                <p style="font-size: 13px; color: #92400e; margin: 0; line-height: 1.5;"><strong>Quick Tip:</strong> Complete your profile and add your skills to unlock AI-powered project matches tailored just for you!</p>
              </td>
            </tr>
          </table>
        </div>
        <div style="width: 100%; height: 1px; background: #e2e8f0; margin-bottom: 24px;"></div>
        <p style="font-size: 14px; color: #64748b; line-height: 1.7; margin: 0 0 24px;">If you have any questions, simply reply to this email or visit our <a href="${APP_URL}/help-center" target="_blank" rel="noopener noreferrer" style="color: #14861f; text-decoration: underline;">Help Center</a>. We're always here to support you!</p>
        <p style="font-size: 15px; color: #0f172a; line-height: 1.7; margin: 0 0 28px;">Welcome aboard, and here's to your success! 🚀</p>
        <div style="padding-top: 20px; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 14px; color: #64748b; margin: 0 0 2px; line-height: 1.6;">Warm regards,</p>
          <p style="font-size: 15px; color: #14861f; margin: 0 0 2px; font-weight: 700;">Mohammad Miran Khan</p>
          <p style="font-size: 13px; color: #64748b; margin: 0 0 12px;">Founder &amp; CEO, Growlanzo</p>
        </div>`;

      const bodyHtml = baseEmailHtml('Welcome to Growlanzo! 🎉', bodyContent);
      const emailResult = await sendNotificationEmail(subject, bodyHtml, { email: recipient_email, name: recipient_name });

      if (!emailResult.success) {
        return new Response(JSON.stringify({ success: false, error: 'Failed to send welcome email', details: emailResult.text }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, message: 'Welcome email sent!' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // ADMIN-ONLY ACTIONS (require valid admin JWT session from here)
    // ────────────────────────────────────────────────────────────────────
    {
      const session = await verifyAdminSession(supabaseClient, req)
      if (!session) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Admin session required' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ─── POST: purge_orphans (ADMIN) ─────────────────────────────
    // Runs purge_orphan_user_data() — wipes ALL data for any profile whose
    // auth.users row is gone (deleted while a deletion was incomplete).
    if (req.method === 'POST' && action === 'purge_orphans') {
      try {
        const { data: result, error: rpcError } = await supabaseClient.rpc('purge_orphan_user_data')
        if (rpcError) {
          return new Response(JSON.stringify({ success: false, error: rpcError.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ success: true, result }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: String(err) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ─── POST: storage_upload ──────────────────────────────────────
    if (req.method === 'POST' && action === 'storage_upload') {
      const { bucket, file_path, file_base64, content_type } = body;

      if (!bucket || !file_path || !file_base64) {
        return new Response(JSON.stringify({ error: 'bucket, file_path, and file_base64 are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        // Auto-create bucket if it doesn't exist (using service_role).
        // Private by default — documents/resumes must never be public.
        const { error: bucketError } = await supabaseClient
          .storage
          .createBucket(bucket, { public: false });

        if (bucketError && !bucketError.message?.includes('already exists')) {
          console.error('Bucket creation error:', bucketError.message);
          // Non-fatal — might already exist, continue
        }

        // Decode base64 to binary
        const binaryStr = atob(file_base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const { data, error } = await supabaseClient
          .storage
          .from(bucket)
          .upload(file_path, bytes, {
            contentType: content_type || 'application/octet-stream',
            upsert: true,
          });

        if (error) {
          console.error('Storage upload error:', error);
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // internship_documents is a private bucket — the stored reference is
        // the file path; the client renders it via a signed URL on demand.
        const filePath = data?.path || file_path;

        return new Response(JSON.stringify({ success: true, path: filePath, filePath, publicUrl: '' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Storage upload exception:', err);
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Upload failed' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ─── POST: generate_qr_token ─────────────────────────────────
    if (req.method === 'POST' && action === 'generate_qr_token') {
      const { credential_id, admin_id } = body;

      if (!credential_id) {
        return new Response(JSON.stringify({ success: false, error: 'credential_id is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        // Revoke existing active token (if any)
        const { data: existingToken } = await supabaseClient
          .from('credential_verification_tokens')
          .select('id, token_version')
          .eq('credential_id', credential_id)
          .eq('status', 'active')
          .maybeSingle();

        if (existingToken) {
          await supabaseClient
            .from('credential_verification_tokens')
            .update({ status: 'revoked', revoked_at: new Date().toISOString() })
            .eq('id', existingToken.id);
        }

        const newVersion = (existingToken?.token_version || 0) + 1;
        const newToken = 'grw-' + Array.from({ length: 48 }, () =>
          'abcdef0123456789'[Math.floor(Math.random() * 16)]
        ).join('');

        const { data, error } = await supabaseClient
          .from('credential_verification_tokens')
          .insert({
            credential_id,
            token: newToken,
            token_version: newVersion,
            generated_by: admin_id || null,
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, token: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Failed to generate QR token',
        }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ─── POST: issue_certificate ───────────────────────────────────
    if (req.method === 'POST' && action === 'issue_certificate') {
      const { user_id, skill, level, recipient_name, recipient_email, certificate_type, metadata, certificate_url } = body;

      if (!user_id || !skill || !level || !recipient_name) {
        return new Response(JSON.stringify({ success: false, error: 'user_id, skill, level, and recipient_name are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ─── user_id for certificate ────────────────────────────────────
      // The FK constraint skill_certifications.user_id → auth.users.id
      // has been DROPPED from the database. We can now use the original
      // user_id (internship_applications.id) directly.
      // The real application link is stored in metadata.application_id.
      const actualUserId = user_id;

      // Generate verification code — fallback if RPC doesn't exist
      let verificationCode: string;
      try {
        const { data: codeData } = await supabaseClient.rpc('generate_certificate_code');
        verificationCode = codeData || ('GRW-CERT-' + Array.from({ length: 5 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join(''));
      } catch (rpcErr) {
        console.error('RPC generate_certificate_code failed, using fallback:', rpcErr);
        verificationCode = 'GRW-CERT-' + Array.from({ length: 5 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
      }

      // Store the original application ID in metadata for verification page lookup
      const mergedMetadata = {
        ...(metadata || {}),
        application_id: user_id, // store the internship_applications.id here
      };

      // Only insert columns that exist in the table — avoid missing column errors
      const insertData: Record<string, any> = {
        user_id: actualUserId,
        skill,
        level,
        score: 100,
        max_score: 100,
        recipient_name,
        recipient_email,
        certificate_type: certificate_type || 'internship',
        verification_code: verificationCode,
        issued_at: new Date().toISOString(),
        status: 'active',
        metadata: mergedMetadata,
      };

      // Include certificate URL if provided
      if (certificate_url) {
        insertData.certificate_url = certificate_url;
      }

      // NOTE: never log the verification code — it is a credential for
      // public certificate verification.

      const { data, error } = await supabaseClient
        .from('skill_certifications')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('Certificate insert error:', error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('Certificate issued successfully:', data.id);

      return new Response(JSON.stringify({ success: true, certificate: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── POST: test_email — sends a live Brevo test email ──
    if (req.method === 'POST' && action === 'test_email') {
      const testTo = body?.to || 'support@growlanzo.com'
      const sent = await sendNotificationEmail('Growlanzo Test Email ✅', '<p>This is a test email from Growlanzo via Brevo.</p>', { email: testTo, name: 'Test' })
      return new Response(JSON.stringify({ success: sent, error: sent ? undefined : 'Email delivery failed (Brevo not configured or API error)' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── POST: send_admin_notification ────────────────────────────
    if (req.method === 'POST' && action === 'send_admin_notification') {
      const { subject, message, requester_name, requester_email, details } = body;
      
      if (!subject || !message) {
        return new Response(JSON.stringify({ success: false, error: 'subject and message are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const ADMIN_EMAIL = 'growlanzo.own@gmail.com';

      // Build details table HTML
      let detailsHtml = '';
      if (details && typeof details === 'object') {
        detailsHtml = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px;">' +
          Object.entries(details).map(([k, v]) => 
            `<tr><td style="padding:6px 12px;color:#64748b;border-bottom:1px solid #f1f5f9;font-weight:600;">${_eh(k.replace(/_/g, ' '))}</td>` +
            `<td style="padding:6px 0;color:#0f172a;border-bottom:1px solid #f1f5f9;">${_eh(String(v || '—'))}</td></tr>`
          ).join('') +
        '</table>';
      }

      const bodyContent = `
        <div style="margin-bottom:20px;padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;">
          <h3 style="font-size:14px;color:#991b1b;margin:0 0 6px;">🔔 New Admin Notification</h3>
          <p style="font-size:13px;color:#7f1d1d;margin:0;">Action may be required</p>
        </div>
        <div style="margin-bottom:24px;">
          <p style="font-size:14px;color:#475569;line-height:1.6;margin:0;">${_eh(message)}</p>
        </div>
        <div style="margin-bottom:20px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="padding:6px 12px;color:#64748b;border-bottom:1px solid #f1f5f9;font-weight:600;">From</td>
                <td style="padding:6px 0;color:#0f172a;border-bottom:1px solid #f1f5f9;">${_eh(requester_name || 'Unknown')}</td></tr>
            <tr><td style="padding:6px 12px;color:#64748b;border-bottom:1px solid #f1f5f9;font-weight:600;">Email</td>
                <td style="padding:6px 0;color:#0f172a;border-bottom:1px solid #f1f5f9;"><a href="mailto:${_eh(requester_email || '')}" style="color:#14861f;">${_eh(requester_email || '—')}</a></td></tr>
          </table>
          ${detailsHtml}
        </div>
        <div style="text-align:center;margin-top:24px;">
          <a href="${APP_URL}/admin" style="display:inline-block;padding:12px 32px;background:#14861f;color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">
            Go to Admin Dashboard →
          </a>
        </div>`;

      const emailResult = await sendNotificationEmail(
        subject,
        bodyContent,
        { email: ADMIN_EMAIL, name: 'Growlanzo Admin' }
      );

      if (!emailResult.success) {
        return new Response(JSON.stringify({ success: false, error: 'Failed to send admin notification', details: emailResult.text }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, message: 'Admin notification sent!' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── POST: send_certificate_email ──────────────────────────────
    if (req.method === 'POST' && action === 'send_certificate_email') {
      const { certificate_id, recipient_email, recipient_name: rawRecipientName, certificate_type, role_name: rawRoleName, level, verification_code, performance_summary: rawPerformanceSummary, skills_demonstrated: rawSkills, certificate_url } = body;
      const recipient_name = _eh(rawRecipientName || '');
      const role_name = _eh(rawRoleName || '');
      const performance_summary = _eh(rawPerformanceSummary || '');
      const skills_demonstrated = rawSkills; // JSON array — safe

      if (!certificate_id || !recipient_email || !recipient_name) {
        return new Response(JSON.stringify({ success: false, error: 'certificate_id, recipient_email, and recipient_name are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const verifyUrl = `${APP_URL}/verify-certificate/${verification_code || ''}`;
      const isLOR = certificate_type === 'lor';

      const pdfDocSection = certificate_url ? `
      <div style="margin: 28px 0; padding: 0; background: #ffffff; border: 2px solid ${isLOR ? '#7c3aed' : '#14861f'}; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, ${isLOR ? '#7c3aed 0%, #6d28d9 100%' : '#14861f 0%, #0f6f1a 100%'}); padding: 20px 24px; text-align: center;">
          <div style="font-size: 32px; margin-bottom: 4px;">📄</div>
          <h3 style="font-size: 17px; color: white; margin: 0; font-weight: 700; word-break: break-word;">Your ${isLOR ? 'Recommendation Letter' : 'Certificate'} Document</h3>
          <p style="font-size: 12px; color: ${isLOR ? '#c4b5fd' : '#bbefb4'}; margin: 6px 0 0; word-break: break-word;">Official PDF — Download for your records</p>
        </div>
        <div style="padding: 20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="width: 100%;">
            <tr>
              <td style="background: ${isLOR ? '#7c3aed' : '#14861f'}; border-radius: 12px; padding: 0;">
                <a href="${certificate_url}" target="_blank" rel="noopener noreferrer"
                   style="display: block; padding: 14px 20px; color: white; text-decoration: none; font-size: 15px; font-weight: 700; text-align: center; word-break: break-word;">
                  📥 Download ${isLOR ? 'LOR' : 'Certificate'} PDF
                </a>
              </td>
            </tr>
          </table>
          <p style="font-size: 11px; color: #94a3b8; margin: 12px 0 0; text-align: center; word-break: break-word;">
            The PDF contains your official ${isLOR ? 'letter of recommendation with details of your performance' : 'completion certificate with your name, skill, and level'}.
          </p>
        </div>
      </div>` : '';

      const subject = isLOR
        ? `Letter of Recommendation — ${role_name || 'Internship'} at Growlanzo`
        : `Internship Completion Certificate — ${role_name || 'Internship'} at Growlanzo`;

      const bodyContent = isLOR ? `
        <!-- LOR Content -->
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="display: inline-block; font-size: 48px; line-height: 1;">⭐</div>
        </div>

        <p style="font-size: 16px; color: #0f172a; line-height: 1.7; margin: 0 0 6px;">Dear ${recipient_name},</p>

        <p style="font-size: 14px; color: #475569; line-height: 1.7; margin: 0 0 18px;">
          On behalf of the entire team at <strong>Growlanzo</strong>, it is my distinct privilege to provide you with this
          <strong style="color: #7c3aed;">Letter of Recommendation</strong> in recognition of your exceptional performance during your
          <strong>${role_name || 'Internship'}</strong> with us.
        </p>

        <div style="margin-bottom: 24px; padding: 16px 20px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 12px;">
          <p style="font-size: 14px; color: #6b21a8; margin: 0; line-height: 1.6;">
            ${performance_summary ? `<strong>Outstanding Contributions:</strong> ${performance_summary}` : 'Throughout your tenure, you demonstrated remarkable skill, dedication, and professionalism. Your contributions have made a meaningful and lasting impact on our team and projects.'}
          </p>
        </div>

        <p style="font-size: 14px; color: #475569; line-height: 1.7; margin: 0 0 24px;">
          You consistently exceeded expectations and showed exceptional aptitude in your role. Your ability to tackle complex challenges, collaborate effectively with team members, and deliver high-quality results has been truly impressive.
        </p>

        ${pdfDocSection}

        <!-- Verification Card -->
        <div style="margin: 28px 0 24px; padding: 0; background: #ffffff; border: 1px solid #e9d5ff; border-radius: 14px; overflow: hidden;">
          <div style="background: #faf5ff; padding: 20px 24px; text-align: center;">
            <div style="font-size: 24px; margin-bottom: 8px;">🔗</div>
            <h3 style="font-size: 15px; color: #6d28d9; margin: 0 0 4px; font-weight: 700;">View &amp; Verify Online</h3>
            <p style="font-size: 12px; color: #7c3aed; margin: 0 0 14px;">Employers can verify this letter instantly</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
              <tr>
                <td align="center" style="padding: 0;">
                  <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                    <tr>
                      <td style="background: #7c3aed; border-radius: 10px; padding: 12px 24px;" bgcolor="#7c3aed">
                        <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer"
                           style="display: inline-block; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; white-space: nowrap;">
                          Verify LOR Online →
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="font-size: 10px; color: #7c3aed; margin: 10px 0 0; font-family: 'SF Mono', 'Consolas', monospace;">Code: ${verification_code || ''}</p>
          </div>
        </div>

        <p style="font-size: 14px; color: #64748b; line-height: 1.7; margin: 0 0 24px;">
          We have no doubt that you will continue to excel in all your future endeavors. Your time at Growlanzo has been truly valued, and we are confident you will achieve great things ahead.
        </p>

        <p style="font-size: 15px; color: #0f172a; line-height: 1.7; margin: 0 0 28px;">
          We wish you continued success and growth in your career! 🚀
        </p>

        <!-- Signature -->
        <div style="padding-top: 20px; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 14px; color: #64748b; margin: 0 0 2px; line-height: 1.6;">With warm regards,</p>
          <p style="font-size: 15px; color: #7c3aed; margin: 0 0 2px; font-weight: 700;">Mohammad Miran Khan</p>
          <p style="font-size: 13px; color: #64748b; margin: 0 0 12px;">Founder &amp; CEO, Growlanzo</p>
          <table style="border-collapse: collapse;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding: 8px 16px; background: #faf5ff; border-radius: 8px;">
                <p style="font-size: 11px; color: #6d28d9; margin: 0;">
                  🌐 ${APP_URL} &nbsp;|&nbsp; ✉️ support@growlanzo.com
                </p>
              </td>
            </tr>
          </table>
        </div>`
        : `
        <!-- Certificate Content -->
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="display: inline-block; font-size: 48px; line-height: 1;">🎓</div>
        </div>

        <!-- Congratulations Banner -->
        <div style="margin: 0 0 24px; padding: 20px; background: linear-gradient(135deg, #f1fcef 0%, #ddf7d9 100%); border: 1px solid #bbefb4; border-radius: 14px; text-align: center;">
          <h2 style="font-size: 18px; color: #10591a; margin: 0 0 6px; font-weight: 800;">Congratulations, ${recipient_name}! 🎉</h2>
          <p style="font-size: 14px; color: #0f6f1a; margin: 0; line-height: 1.5;">
            You have successfully completed your <strong>${role_name || 'Internship'}</strong> at <strong>Growlanzo</strong>.
          </p>
        </div>

        <p style="font-size: 14px; color: #475569; line-height: 1.7; margin: 0 0 18px;">
          Your dedication, hard work, and contributions during your time with us have been truly outstanding. You have grown both personally and professionally, and we are honored to have been part of your journey.
        </p>

        <p style="font-size: 14px; color: #475569; line-height: 1.7; margin: 0 0 24px;">
          This <strong>Internship Completion Certificate</strong> officially recognizes your successful completion of the program and the valuable skills you have developed along the way.
        </p>

        ${pdfDocSection}

        <!-- Verification Card -->
        <div style="margin: 28px 0 24px; padding: 0; background: #ffffff; border: 1px solid #bbefb4; border-radius: 14px; overflow: hidden;">
          <div style="background: #f1fcef; padding: 20px 24px; text-align: center;">
            <div style="font-size: 24px; margin-bottom: 8px;">🔗</div>
            <h3 style="font-size: 15px; color: #10591a; margin: 0 0 4px; font-weight: 700;">View &amp; Verify Online</h3>
            <p style="font-size: 12px; color: #0f6f1a; margin: 0 0 14px;">Employers can verify this certificate instantly</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
              <tr>
                <td align="center" style="padding: 0;">
                  <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                    <tr>
                      <td style="background: #14861f; border-radius: 10px; padding: 12px 24px;" bgcolor="#14861f">
                        <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer"
                           style="display: inline-block; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; white-space: nowrap;">
                          Verify Certificate →
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="font-size: 10px; color: #14861f; margin: 10px 0 0; font-family: 'SF Mono', 'Consolas', monospace;">Code: ${verification_code || ''}</p>
          </div>
        </div>

        <p style="font-size: 14px; color: #64748b; line-height: 1.7; margin: 0 0 24px;">
          You can now proudly add this certificate to your LinkedIn profile, resume, and professional portfolio. Employers can verify its authenticity instantly using the verification code above.
        </p>

        <p style="font-size: 15px; color: #0f172a; line-height: 1.7; margin: 0 0 28px;">
          We wish you the very best in all your future endeavors! Keep growing, keep learning, and keep achieving. 🚀
        </p>

        <!-- Signature -->
        <div style="padding-top: 20px; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 14px; color: #64748b; margin: 0 0 2px; line-height: 1.6;">Warm regards,</p>
          <p style="font-size: 15px; color: #14861f; margin: 0 0 2px; font-weight: 700;">Mohammad Miran Khan</p>
          <p style="font-size: 13px; color: #64748b; margin: 0 0 12px;">Founder &amp; CEO, Growlanzo</p>
          <table style="border-collapse: collapse;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding: 8px 16px; background: #f1fcef; border-radius: 8px;">
                <p style="font-size: 11px; color: #10591a; margin: 0;">
                  🌐 ${APP_URL} &nbsp;|&nbsp; ✉️ support@growlanzo.com
                </p>
              </td>
            </tr>
          </table>
        </div>`;

      const headerTitle = isLOR ? 'Letter of Recommendation' : 'Internship Completion Certificate';
      const headerGradient = isLOR ? '#7c3aed 0%, #6d28d9 100%' : '#14861f 0%, #0f6f1a 100%';
      const bodyHtml = baseEmailHtml(headerTitle, bodyContent, headerGradient);

      // Attach the certificate/LOR PDF as an email attachment
      const attachments = certificate_url
        ? [{ url: certificate_url, name: isLOR ? 'Letter_of_Recommendation.pdf' : 'Completion_Certificate.pdf' }]
        : undefined;

      const emailResult = await sendNotificationEmail(subject, bodyHtml, { email: recipient_email, name: recipient_name }, attachments);

      if (!emailResult.success) {
        return new Response(JSON.stringify({ success: false, error: 'Failed to send email', details: emailResult.text }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, message: 'Email sent successfully' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── POST: counts ──────────────────────────────────────────────
    if (req.method === 'POST' && action === 'counts') {
      const tables: string[] = body.tables || []
      const results: Record<string, number> = {}

      for (const t of tables) {
        const tableEntry = t as string
        let tableName = tableEntry
        let filterCol: string | undefined
        let filterVal: string | undefined

        if (typeof tableEntry === 'string' && tableEntry.includes(':')) {
          const parts = tableEntry.split(':')
          tableName = parts[0]
          filterCol = parts[1]
          filterVal = parts[2]
        }

        if (!ALLOWED_TABLES.includes(tableName)) {
          return new Response(JSON.stringify({ error: `Table '${tableName}' is not allowed for admin queries` }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        try {
          let q = supabaseClient.from(tableName).select('*', { count: 'exact', head: true })
          if (filterCol && filterVal) q = q.eq(filterCol, filterVal)
          if (filterCol && filterCol === 'null') q = q.is(filterCol, null)
          const { count } = await q
          results[tableName] = count || 0
        } catch {
          results[tableName] = -1
        }
      }

      return new Response(JSON.stringify({ counts: results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── POST: query ───────────────────────────────────────────────
    if (req.method === 'POST' && action === 'query') {
      const table = body.table
      const selectParam = body.select || '*'
      const orderCol = body.order
      const orderDir = body.orderDir || 'desc'
      const limitVal = body.limit ?? 100
      const offsetVal = body.offset ?? 0
      const countVal = body.count
      const headOnly = body.head === true
      const filters = body.filters || {}
      const isNull = body.isNull || {}
      const gte = body.gte || {}
      const lte = body.lte || {}
      const inFilters = body.in || {}

      if (!table) {
        return new Response(JSON.stringify({ error: 'table parameter is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!ALLOWED_TABLES.includes(table)) {
        return new Response(JSON.stringify({ error: `Table '${table}' is not allowed for admin queries` }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let query = supabaseClient.from(table).select(selectParam, countVal ? { count: countVal as any, head: headOnly } : undefined)

      for (const [col, value] of Object.entries(filters)) {
        query = query.eq(col, value as string)
      }
      for (const [col, value] of Object.entries(isNull)) {
        query = query.is(col, value ? null : undefined)
      }
      for (const [col, value] of Object.entries(gte)) {
        query = query.gte(col, value as string)
      }
      for (const [col, value] of Object.entries(lte)) {
        query = query.lte(col, value as string)
      }
      for (const [col, values] of Object.entries(inFilters)) {
        query = query.in(col, values as string[])
      }

      if (orderCol) query = query.order(orderCol, { ascending: orderDir === 'asc' })
      if (!headOnly) query = query.range(offsetVal, offsetVal + limitVal - 1)

      const { data, error, count } = await query

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ data, total: count || undefined }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── POST: insert ──────────────────────────────────────────────
    if (req.method === 'POST' && action === 'insert') {
      const { table, data: insertData } = body

      if (!table || !insertData) {
        return new Response(JSON.stringify({ error: 'table and data are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!ALLOWED_TABLES.includes(table)) {
        return new Response(JSON.stringify({ error: `Table '${table}' is not allowed for admin inserts` }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const blockedInsert = writeBlockedResponse(table, 'insert', corsHeaders);
      if (blockedInsert) return blockedInsert;

      if (table === 'profiles_private') {
        const rejected = disallowedPrivateProfileColumns(insertData)
        if (rejected.length > 0) {
          return new Response(JSON.stringify({ error: `Column(s) not allowed on profiles_private: ${rejected.join(', ')}` }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      const { data, error } = await supabaseClient
        .from(table)
        .insert(insertData)
        .select()
        .single()

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── PATCH: update ─────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { table, id, id_field, data: updateData } = body

      if (!table || !id || !updateData) {
        return new Response(JSON.stringify({ error: 'table, id, and data are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!ALLOWED_TABLES.includes(table)) {
        return new Response(JSON.stringify({ error: `Table '${table}' is not allowed for admin updates` }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const blockedUpdate = writeBlockedResponse(table, 'update', corsHeaders);
      if (blockedUpdate) return blockedUpdate;

      if (table === 'profiles_private') {
        const rejected = disallowedPrivateProfileColumns(updateData)
        if (rejected.length > 0) {
          return new Response(JSON.stringify({ error: `Column(s) not allowed on profiles_private: ${rejected.join(', ')}` }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      const idCol = id_field || 'id'
      const { data, error } = await supabaseClient
        .from(table)
        .update(updateData)
        .eq(idCol, id)
        .select()
        .single()

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── DELETE ────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { table, id, id_field } = body

      if (!table || !id) {
        return new Response(JSON.stringify({ error: 'table and id are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!ALLOWED_TABLES.includes(table)) {
        return new Response(JSON.stringify({ error: `Table '${table}' is not allowed for admin deletes` }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const blockedDelete = writeBlockedResponse(table, 'delete', corsHeaders);
      if (blockedDelete) return blockedDelete;

      const idCol = id_field || 'id'
      const { data, error } = await supabaseClient
        .from(table)
        .delete()
        .eq(idCol, id)
        .select()
        .single()

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Action not recognized' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Admin data proxy error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
