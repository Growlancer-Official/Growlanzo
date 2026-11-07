// Project Notifications Edge Function
//
// Wires the project-lifecycle email events to the real workflow that produces
// them (the client marking a project complete). Two events, both `info` sender
// through the one shared transactional pipeline:
//
//   1) project_completed → the freelancer who delivered the work
//   2) review_request    → the same freelancer, asking for a review
//
// The recipient is NEVER taken from the request body: the caller must own the
// project, and the address is resolved server-side from the contract (or the
// hired proposal) + profiles_private. That is the same trust model as
// proposal-notifications, so this endpoint cannot be used as a mail relay.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTransactionalEmail } from '../_shared/emailService.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import type { EmailEventKey } from '../_shared/emailTemplates.ts'

/** Only these events are wired to a real workflow yet. */
const WIRED_EVENTS = ['project_completed', 'review_request'] as const
type WiredEvent = (typeof WIRED_EVENTS)[number]

function isWiredEvent(value: unknown): value is WiredEvent {
  return typeof value === 'string' && (WIRED_EVENTS as readonly string[]).includes(value)
}

// ─── Per-user rate limiting (in-memory sliding window, same shape as the
//     sibling notification functions) ──────────────────────────────────────
const RATE_WINDOW_MINUTES = 60
const RATE_MAX_CALLS = 20
const callLog = new Map<string, number[]>()

function rateLimited(userId: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_WINDOW_MINUTES * 60 * 1000
  const hits = (callLog.get(userId) ?? []).filter((t) => t > windowStart)
  if (hits.length >= RATE_MAX_CALLS) return true
  hits.push(now)
  callLog.set(userId, hits)
  if (callLog.size > 5000) {
    for (const [k, v] of callLog) {
      if (!v.some((t) => t > windowStart)) callLog.delete(k)
    }
  }
  return false
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    // 🔐 Identity comes from the session, never from the body.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return json({ error: 'Unauthorized — valid session required' }, 401)
    }

    if (rateLimited(user.id)) {
      return json({ error: 'Rate limit exceeded — try again later' }, 429)
    }

    const body = await req.json().catch(() => ({}))
    const projectId = typeof body?.project_id === 'string' ? body.project_id : ''
    const event = body?.event

    if (!projectId || !isWiredEvent(event)) {
      return json(
        { error: `project_id and event (${WIRED_EVENTS.join(' | ')}) are required` },
        400,
      )
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, title, client_id, status')
      .eq('id', projectId)
      .maybeSingle()

    if (projectError || !project) {
      return json({ error: 'Project not found' }, 404)
    }

    // 🔐 Only the project's client (or an admin) may trigger lifecycle emails.
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const callerIsAdmin = callerProfile?.role === 'admin'
    if (!callerIsAdmin && project.client_id !== user.id) {
      console.warn(`[project-notifications] FORBIDDEN: user ${user.id} on project ${projectId}`)
      return json({ error: 'Forbidden — you do not own this project' }, 403)
    }

    // These emails claim a project is complete, so they may only go out once
    // the database actually says so. No premature "you're done" mail.
    if (project.status !== 'completed') {
      return json({ error: 'Project is not completed yet' }, 409)
    }

    // ── Resolve the counterparty server-side ───────────────────────────────
    let freelancerId: string | null = null
    let amount: number | null = null

    const { data: contract } = await admin
      .from('contracts')
      .select('freelancer_id, amount')
      .eq('project_id', projectId)
      .limit(1)
      .maybeSingle()

    if (contract?.freelancer_id) {
      freelancerId = contract.freelancer_id as string
      amount = contract.amount === null || contract.amount === undefined
        ? null
        : Number(contract.amount)
    } else {
      const { data: hired } = await admin
        .from('proposals')
        .select('freelancer_id')
        .eq('project_id', projectId)
        .eq('status', 'hired')
        .limit(1)
        .maybeSingle()
      if (hired?.freelancer_id) freelancerId = hired.freelancer_id as string
    }

    if (!freelancerId) {
      // Nobody was hired through Growlanzo — there is no one to tell, and
      // inventing a recipient would be worse than sending nothing.
      return json({ success: true, email_sent: false, reason: 'no_hired_freelancer' })
    }

    const [{ data: recipientProfile }, { data: recipientPrivate }] = await Promise.all([
      admin.from('profiles').select('name').eq('id', freelancerId).maybeSingle(),
      admin.from('profiles_private').select('email').eq('id', freelancerId).maybeSingle(),
    ])

    const recipientEmail = String(recipientPrivate?.email ?? '').trim()
    if (!recipientEmail) {
      return json({ success: true, email_sent: false, reason: 'no_recipient_email' })
    }
    const recipientName = String(recipientProfile?.name ?? 'there')

    const templateData: Record<string, unknown> = {
      name: recipientName,
      project_id: projectId,
      project_title: project.title,
    }
    if (amount !== null) templateData.amount = amount

    const outcome = await sendTransactionalEmail({
      event: event as EmailEventKey,
      to: recipientEmail,
      recipientName,
      recipientUserId: freelancerId,
      data: templateData,
      // One mail per project per event — a double-click, a retry or a second
      // tab cannot send it twice.
      idempotencyKey: `${event}:${projectId}:${recipientEmail.toLowerCase()}`,
    })

    // In-app notification mirrors the email. Failure here must never turn a
    // sent email into an error response.
    const notif = event === 'project_completed'
      ? {
          type: 'contract',
          title: 'Project completed ✅',
          message: `"${project.title}" has been marked complete by the client.`,
          action_url: '/dashboard/contracts',
        }
      : {
          type: 'review',
          title: 'Leave a review ⭐',
          message: `How did "${project.title}" go? A short review helps the next client decide.`,
          action_url: '/dashboard/reviews',
        }

    const { error: notifError } = await admin.from('notifications').insert({
      user_id: freelancerId,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      metadata: { project_id: projectId, event },
      action_url: notif.action_url,
    })
    if (notifError) {
      console.error(`[project-notifications] in-app notification failed: ${notifError.message}`)
    }

    console.log(`[project-notifications] ${event} — sent: ${outcome.ok} duplicate: ${!!outcome.duplicate}`)

    return json({
      success: true,
      email_sent: outcome.ok,
      duplicate: !!outcome.duplicate,
      status: outcome.status,
    })
  } catch (error) {
    // Never leak internal detail to the client (schema/constraint/provider text).
    console.error('[project-notifications] unexpected error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
})
