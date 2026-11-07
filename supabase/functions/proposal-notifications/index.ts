// Proposal Notifications Edge Function
// Sends real email notifications to freelancers when:
//   1) Proposal is ACCEPTED → "Congratulations, you're hired!" email
//   2) Proposal is REJECTED → "Application update" email
// Also creates in-app notifications for the freelancer.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendLoggedEmail } from '../_shared/emailService.ts'
import { brandedEmailHtml, htmlToText } from '../_shared/emailTemplates.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { SITE_URL } from '../_shared/site.ts'

// Transactional email via Brevo (shared helper).
const ADMIN_EMAIL = 'growlanzo.own@gmail.com'
const APP_URL = SITE_URL

// ─── HTML Escape Helper ─────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


// ─── Per-user rate limiting (in-memory sliding window) ────────────────────
const RATE_WINDOW_MINUTES = 60;
const RATE_MAX_CALLS = 20;
const callLog = new Map<string, number[]>(); // userId -> [timestamps]

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MINUTES * 60 * 1000;
  const hits = (callLog.get(userId) ?? []).filter(t => t > windowStart);
  if (hits.length >= RATE_MAX_CALLS) return true;
  hits.push(now);
  callLog.set(userId, hits);
  // Memory safety: prune stale entries when the map grows large.
  if (callLog.size > 5000) {
    for (const [k, v] of callLog) {
      if (!v.some(t => t > windowStart)) callLog.delete(k);
    }
  }
  return false;
}

// ─── Email Sender (central service) ───────────────────────────────────────
// Proposal events are project activity → the `info` identity, logged in
// email_logs with an idempotency key per (proposal, action, recipient).
async function sendNotificationEmail(
  to: string,
  toName: string,
  subject: string,
  htmlContent: string,
  event: string,
  idempotencyKey?: string
): Promise<boolean> {
  const outcome = await sendLoggedEmail({
    event,
    to,
    subject,
    html: htmlContent,
    text: htmlToText(htmlContent),
    senderKey: 'info',
    templateId: event,
    recipientName: toName,
    idempotencyKey: idempotencyKey ?? null,
  })
  return outcome.ok
}

function baseEmailHtml(title: string, bodyHtml: string): string {
  // Shared branded shell: logo, gradient header, responsive 600px layout and
  // the social follow-us footer (X / Instagram / LinkedIn). The local name is
  // kept so the template builders below stay unchanged, but the markup now
  // lives in _shared/emailTemplates.ts — one place, every email.
  return brandedEmailHtml({ title, bodyHtml })
}

/** Proposal Accepted — freelancer hired! */
function buildAcceptedEmailHtml(freelancerName: string, projectTitle: string, clientName: string): string {
  const body = `
    <p style="font-size: 16px; color: #0f172a; line-height: 1.7; margin: 0 0 20px;">Hi ${escapeHtml(freelancerName)},</p>
    <div style="margin: 0 0 24px; padding: 20px; background: #f1fcef; border: 1px solid #89e07f; border-radius: 14px; text-align: center;">
      <p style="font-size: 36px; margin: 0 0 8px; line-height: 1;">🎉</p>
      <h2 style="font-size: 18px; color: #10591a; margin: 0 0 4px; font-weight: 800;">Congratulations, You're Hired!</h2>
      <p style="font-size: 14px; color: #0f6f1a; margin: 0; line-height: 1.5;">
        Your proposal for <strong>"${escapeHtml(projectTitle)}"</strong> has been accepted by <strong>${escapeHtml(clientName)}</strong>!
      </p>
    </div>
    <div style="margin: 0 0 24px; padding: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h3 style="font-size: 14px; color: #0f172a; margin: 0 0 14px; font-weight: 700;">📋 Next Steps</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; color: #475569;">
        <tr><td width="28" style="padding: 6px 8px 6px 0; vertical-align: top; font-weight: 700; color: #14861f;">1.</td><td style="padding: 6px 0;">A contract has been created and is awaiting your review</td></tr>
        <tr><td width="28" style="padding: 6px 8px 6px 0; vertical-align: top; font-weight: 700; color: #14861f;">2.</td><td style="padding: 6px 0;">The client will fund escrow to activate the contract</td></tr>
        <tr><td width="28" style="padding: 6px 8px 6px 0; vertical-align: top; font-weight: 700; color: #14861f;">3.</td><td style="padding: 6px 0;">Start working and submit milestones for payment</td></tr>
      </table>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr>
              <td style="background: #14861f; border-radius: 12px; padding: 14px 32px;" bgcolor="#14861f">
                <a href="${APP_URL}/dashboard/contracts" target="_blank" rel="noopener noreferrer" style="display: inline-block; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700;">View Contract Dashboard →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="font-size: 14px; color: #64748b; line-height: 1.7; margin: 0;">
      If you have any questions, reach out to <a href="mailto:${ADMIN_EMAIL}" style="color: #14861f; font-weight: 600;">${ADMIN_EMAIL}</a>.
    </p>`
  return baseEmailHtml('You\'re Hired! 🎉', body)
}

/** Proposal Rejected */
function buildRejectedEmailHtml(freelancerName: string, projectTitle: string): string {
  const body = `
    <p style="font-size: 16px; color: #0f172a; line-height: 1.7; margin: 0 0 20px;">Hi ${escapeHtml(freelancerName)},</p>
    <p style="font-size: 15px; color: #475569; line-height: 1.7; margin: 0 0 24px;">
      Thank you for submitting a proposal for <strong>"${escapeHtml(projectTitle)}"</strong>. After careful review, the client has decided to move forward with another freelancer for this project.
    </p>
    <div style="margin: 0 0 24px; padding: 20px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 14px; text-align: center;">
      <p style="font-size: 28px; margin: 0 0 8px; line-height: 1;">💡</p>
      <h3 style="font-size: 16px; color: #991b1b; margin: 0 0 6px; font-weight: 700;">Don't Lose Heart</h3>
      <p style="font-size: 14px; color: #991b1b; margin: 0; line-height: 1.5;">
        There are many more projects waiting for you on Growlanzo. Keep applying — the right match is out there!
      </p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr>
              <td style="background: #14861f; border-radius: 12px; padding: 14px 32px;" bgcolor="#14861f">
                <a href="${APP_URL}/dashboard/projects" target="_blank" rel="noopener noreferrer" style="display: inline-block; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700;">Browse More Projects →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="font-size: 14px; color: #64748b; line-height: 1.7; margin: 0;">
      Keep building your profile and skills. The next opportunity is just around the corner!
    </p>`
  return baseEmailHtml('Proposal Update 💙', body)
}

// ─── Main Server ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only accept POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 🔐 Auth: verify the caller is a real authenticated user. This is an
    // email-sending endpoint — a valid JWT alone is not enough, we confirm
    // the identity server-side before trusting any of the body fields.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized — valid session required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 🔐 Per-user rate limit (email endpoint abuse protection).
    if (rateLimited(user.id)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded — try again later' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    const { proposal_id, action } = body // action: 'accept' | 'reject'

    if (!proposal_id || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: proposal_id, action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['accept', 'reject'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Must be "accept" or "reject".' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch proposal with freelancer + project details
    const { data: proposal, error: propError } = await supabaseClient
      .from('proposals')
      .select('id, project_id, freelancer_id, status, profiles!proposals_freelancer_id_fkey(id, email, name), projects!proposals_project_id_fkey(id, title), projects!inner(client_id), profiles!projects_client_id_fkey!inner(name)')
      .eq('id', proposal_id)
      .single()

    if (propError || !proposal) {
      return new Response(
        JSON.stringify({ error: 'Proposal not found', details: propError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract data from the nested selects
    const freelancer = proposal.profiles as { id: string; email: string; name: string } | null
    const project = proposal.projects as { id: string; title: string } | null

    // Get the project's client name for the email
    let clientName = 'the client'
    const { data: projectFull } = await supabaseClient
      .from('projects')
      .select('client_id')
      .eq('id', proposal.project_id)
      .single()

    // 🔐 Ownership: only the project's client (or an admin) may trigger
    // accept/reject emails for this proposal. Any other authenticated user
    // is rejected with 403 — this blocks spam/confusion emails about
    // proposals that are not theirs.
    const { data: callerProfile } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const callerIsAdmin = callerProfile?.role === 'admin';
    if (!callerIsAdmin && projectFull?.client_id !== user.id) {
      console.warn(`[proposal-notifications] FORBIDDEN: user ${user.id} tried to ${action} proposal ${proposal_id}`);
      return new Response(
        JSON.stringify({ error: 'Forbidden — you do not own this project' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (projectFull?.client_id) {
      const { data: cp } = await supabaseClient
        .from('profiles')
        .select('name')
        .eq('id', projectFull.client_id)
        .maybeSingle()
      if (cp?.name) clientName = cp.name
    }

    if (!freelancer || !project) {
      return new Response(
        JSON.stringify({ error: 'Could not load freelancer or project details' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send email
    let emailSent = false
    if (action === 'accept') {
      emailSent = await sendNotificationEmail(
        freelancer.email,
        freelancer.name,
        `You're Hired! — Proposal Accepted for "${project.title}"`,
        buildAcceptedEmailHtml(freelancer.name, project.title, clientName),
        'proposal_accepted',
        `proposal_accepted:${proposal_id}:${freelancer.email.toLowerCase()}`,
      )
    } else {
      emailSent = await sendNotificationEmail(
        freelancer.email,
        freelancer.name,
        `Proposal Update — "${project.title}"`,
        buildRejectedEmailHtml(freelancer.name, project.title),
        'proposal_rejected',
        `proposal_rejected:${proposal_id}:${freelancer.email.toLowerCase()}`,
      )
    }

    // Create in-app notification for the freelancer
    const notifType = action === 'accept' ? 'proposal_accepted' : 'proposal_rejected'
    const notifTitle = action === 'accept' ? 'Proposal Accepted! 🎉' : 'Proposal Update 💙'
    const notifMessage = action === 'accept'
      ? `Your proposal for "${project.title}" was accepted! Contract has been created.`
      : `Your proposal for "${project.title}" was not selected. Keep applying!`

    await supabaseClient.from('notifications').insert({
      user_id: freelancer.id,
      type: notifType,
      title: notifTitle,
      message: notifMessage,
      metadata: { proposal_id, project_id: project.id, action },
      action_url: action === 'accept' ? '/dashboard/contracts' : '/dashboard/projects',
    })

    console.log(`Proposal ${action} — email sent: ${emailSent}`)

    return new Response(
      JSON.stringify({
        success: true,
        email_sent: emailSent,
        notif_type: notifType,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Proposal notifications error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
