// Reviews Edge Function
// Handles review creation and management
// Supports rating calculations and aggregation

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { sendTransactionalEmail } from '../_shared/emailService.ts'

/**
 * "You received a review" — sent once the review row exists, to the person who
 * was reviewed. Best-effort by design: the review is already saved, so a failed
 * email is logged and never turns a successful review into an error.
 */
async function notifyReviewReceived(
  supabaseAdmin: any,
  params: { reviewId: string; revieweeId: string; rating: number; projectTitle?: string },
): Promise<void> {
  try {
    const [{ data: pub }, { data: priv }] = await Promise.all([
      supabaseAdmin.from('profiles').select('name').eq('id', params.revieweeId).maybeSingle(),
      supabaseAdmin.from('profiles_private').select('email').eq('id', params.revieweeId).maybeSingle(),
    ])
    const email = String(priv?.email ?? '').trim()
    if (!email) return

    await sendTransactionalEmail({
      event: 'review_received',
      to: email,
      recipientName: String(pub?.name ?? 'there'),
      recipientUserId: params.revieweeId,
      data: {
        name: String(pub?.name ?? ''),
        rating: params.rating,
        project_title: params.projectTitle ?? 'your project',
      },
      // One mail per review row — a retried request cannot send it twice.
      idempotencyKey: `review_received:${params.reviewId}`,
    })
  } catch (err) {
    console.error('[reviews] review_received email failed:', err instanceof Error ? err.message : err)
  }
}


// Rate limiting - DB-backed
const ROUTE = 'reviews';
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60000;

async function checkRateLimit(supabaseClient: any, identifier: string): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_WINDOW_MS);

  // Best-effort cleanup of expired rate limit records
  try {
    await supabaseClient.rpc('cleanup_expired_rate_limits');
  } catch {
    // Non-critical; cleanup also runs via cron
  }

  // Count existing requests in the current window
  const { count, error } = await supabaseClient
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('identifier', identifier)
    .eq('route', ROUTE)
    .gte('window_start', windowStart.toISOString());

  if (error) {
    console.error('Rate limit check error:', error);
    return true; // Fallback: allow request if DB query fails
  }

  if (count !== null && count >= RATE_LIMIT) {
    return false;
  }

  // Record this request
  await supabaseClient
    .from('rate_limits')
    .insert({ identifier, route: ROUTE, count: 1, window_start: now.toISOString() });

  return true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  // Handle CORS preflight BEFORE rate limit check (always allow OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization') ?? '' },
        },
      }
    )

    // Writes to "reviews" use the service role. Direct PostgREST INSERT /
    // UPDATE was revoked (migration 20270203100000) so that every write must
    // pass the contract-completion, participation and other-party checks above.
    // The caller's JWT still identifies them; the service role only bypasses
    // the table grants a browser could otherwise reach directly.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      console.error('Reviews: Auth failed', userError?.message || 'No user');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limit check (after auth to use user.id as identifier)
    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const identifier = user.id || clientIP;
    const allowed = await checkRateLimit(supabaseClient, identifier);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { method } = req

    if (method === 'POST') {
      // Create a review
      const {
        contract_id,
        contest_id,
        reviewee_id,
        rating,
        communication_rating,
        quality_rating,
        timeliness_rating,
        professionalism_rating,
        comment,
        would_hire_again,
      } = await req.json()

      if ((!contract_id && !contest_id) || !reviewee_id || !rating) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Validate rating range
      if (rating < 1 || rating > 5) {
        return new Response(
          JSON.stringify({ error: 'Rating must be between 1 and 5' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // ── CONTRACT REVIEW ─────────────────────────────────────────────
      if (contract_id) {
        // Verify user is part of the contract
        const { data: contract, error: contractError } = await supabaseClient
          .from('contracts')
          // projects(title) is only for the notification email; the review
          // itself needs nothing but the two parties and the status.
          .select('freelancer_id, client_id, status, projects(title)')
          .eq('id', contract_id)
          .single()

        if (contractError || !contract) {
          return new Response(
            JSON.stringify({ error: 'Contract not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Reviews are only meaningful after the work is actually done — prevents
        // rating-bombing before completion.
        if (contract.status !== 'completed') {
          return new Response(
            JSON.stringify({ error: 'You can only review a contract after it has been completed' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (contract.freelancer_id !== user.id && contract.client_id !== user.id) {
          return new Response(
            JSON.stringify({ error: 'You are not part of this contract' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Verify reviewee is the other party in the contract
        const otherPartyId = contract.freelancer_id === user.id ? contract.client_id : contract.freelancer_id
        if (reviewee_id !== otherPartyId) {
          return new Response(
            JSON.stringify({ error: 'You can only review the other party in the contract' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if review already exists
        const { data: existingReview } = await supabaseAdmin
          .from('reviews')
          .select('id')
          .eq('contract_id', contract_id)
          .eq('reviewer_id', user.id)
          .single()

        if (existingReview) {
          return new Response(
            JSON.stringify({ error: 'You have already reviewed this contract' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Create review
        const { data: review, error: reviewError } = await supabaseAdmin
          .from('reviews')
          .insert({
            contract_id,
            reviewer_id: user.id,
            reviewee_id,
            rating,
            communication_rating,
            quality_rating,
            timeliness_rating,
            professionalism_rating,
            comment,
            would_hire_again,
          })
          .select()
          .single()

        if (reviewError) {
          throw reviewError
        }

        const contractProject = (contract as { projects?: { title?: string } | null } | null)?.projects
        await notifyReviewReceived(supabaseAdmin, {
          reviewId: String(review.id),
          revieweeId: reviewee_id,
          rating,
          projectTitle: contractProject?.title,
        })

        return new Response(
          JSON.stringify({ review }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // ── CONTEST REVIEW ──────────────────────────────────────────────
      // Winner(s) and client review each other after the contest completes.
      // Client → winner freelancer (must hold a 'winner' submission);
      // winner freelancer → client. Both sides verified server-side.
      const { data: contest, error: contestError } = await supabaseClient
        .from('contests')
        .select('client_id, winner_id, status')
        .eq('id', contest_id)
        .single()

      if (contestError || !contest) {
        return new Response(
          JSON.stringify({ error: 'Contest not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (contest.status !== 'completed') {
        return new Response(
          JSON.stringify({ error: 'You can only review a contest after it has been completed' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const isClient = contest.client_id === user.id
      const isWinner = await (async () => {
        if (user.id === contest.winner_id) return true
        const { data: sub } = await supabaseClient
          .from('contest_submissions')
          .select('id')
          .eq('contest_id', contest_id)
          .eq('freelancer_id', user.id)
          .eq('status', 'winner')
          .maybeSingle()
        return !!sub
      })()

      if (!isClient && !isWinner) {
        return new Response(
          JSON.stringify({ error: 'You are not part of this contest' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Reviewee must be the other side
      const otherSideId = isClient ? contest.winner_id : contest.client_id
      if (!otherSideId || reviewee_id !== otherSideId) {
        return new Response(
          JSON.stringify({ error: 'You can only review the other party in the contest' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // No duplicate contest reviews from the same reviewer
      const { data: existingContestReview } = await supabaseAdmin
        .from('reviews')
        .select('id')
        .eq('contest_id', contest_id)
        .eq('reviewer_id', user.id)
        .maybeSingle()

      if (existingContestReview) {
        return new Response(
          JSON.stringify({ error: 'You have already reviewed this contest' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: review, error: reviewError } = await supabaseAdmin
        .from('reviews')
        .insert({
          contest_id,
          reviewer_id: user.id,
          reviewee_id,
          rating,
          communication_rating,
          quality_rating,
          timeliness_rating,
          professionalism_rating,
          comment,
          would_hire_again,
        })
        .select()
        .single()

      if (reviewError) {
        throw reviewError
      }

      // Freelancer rating / reputation / total_reviews are refreshed in real
      // time by the on_review_change trigger (security definer). No direct
      // update here — an authenticated user cannot UPDATE another user's
      // freelancer_profiles row (RLS), which previously failed silently.

      // Contest winners and clients review each other the same way.
      await notifyReviewReceived(supabaseAdmin, {
        reviewId: String(review.id),
        revieweeId: reviewee_id,
        rating,
      })

      return new Response(
        JSON.stringify({ review }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (method === 'GET') {
      const url = new URL(req.url)
      const contractId = url.searchParams.get('contract_id')
      const contestId = url.searchParams.get('contest_id')
      const revieweeId = url.searchParams.get('reviewee_id')

      if (contestId) {
        // Get reviews for a contest (winner + client mutual reviews)
        const { data: reviews, error } = await supabaseAdmin
          .from('reviews')
          .select(`
            *,
            reviewer:profiles!reviews_reviewer_id_fkey(id, name, avatar),
            reviewee:profiles!reviews_reviewee_id_fkey(id, name, avatar)
          `)
          .eq('contest_id', contestId)

        if (error) throw error

        return new Response(
          JSON.stringify({ reviews }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } else if (contractId) {
        // Get reviews for a contract
        const { data: reviews, error } = await supabaseAdmin
          .from('reviews')
          .select(`
            *,
            reviewer:profiles!reviews_reviewer_id_fkey(id, name, avatar),
            reviewee:profiles!reviews_reviewee_id_fkey(id, name, avatar)
          `)
          .eq('contract_id', contractId)

        if (error) throw error

        return new Response(
          JSON.stringify({ reviews }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } else if (revieweeId) {
        // Get reviews for a user
        const { data: reviews, error } = await supabaseAdmin
          .from('reviews')
          .select(`
            *,
            reviewer:profiles!reviews_reviewer_id_fkey(id, name, avatar),
            contract:contracts!reviews_contract_id_fkey(id, project:projects(title))
          `)
          .eq('reviewee_id', revieweeId)
          .order('created_at', { ascending: false })

        if (error) throw error

        // Calculate average rating
        const avgRating = reviews?.length > 0
          ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
          : 0

        return new Response(
          JSON.stringify({ 
            reviews, 
            average_rating: Math.round(avgRating * 10) / 10,
            total_reviews: reviews?.length || 0
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } else {
        return new Response(
          JSON.stringify({ error: 'Either contract_id or reviewee_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if (method === 'PATCH') {
      // Update review
      const { review_id, ...requestData } = await req.json()

      if (!review_id) {
        return new Response(
          JSON.stringify({ error: 'Review ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Whitelist updatable fields — NEVER allow changing the parties or
      // contract (would break the reputation trigger's reviewee lookup).
      const allowedFields = [
        'rating',
        'communication_rating',
        'quality_rating',
        'timeliness_rating',
        'professionalism_rating',
        'comment',
        'would_hire_again',
      ]
      const updateData: Record<string, unknown> = {}
      for (const key of allowedFields) {
        if (requestData[key] !== undefined) {
          updateData[key] = requestData[key]
        }
      }
      if (Object.keys(updateData).length === 0) {
        return new Response(
          JSON.stringify({ error: 'No updatable fields provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Verify ownership
      const { data: existingReview } = await supabaseAdmin
        .from('reviews')
        .select('reviewer_id, reviewee_id')
        .eq('id', review_id)
        .single()

      if (!existingReview || existingReview.reviewer_id !== user.id) {
        return new Response(
          JSON.stringify({ error: 'You can only update your own reviews' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: review, error } = await supabaseAdmin
        .from('reviews')
        .update(updateData)
        .eq('id', review_id)
        .select()
        .single()

      if (error) throw error

      // Rating / reputation / total_reviews refresh via the on_review_change
      // trigger (security definer) — fires on UPDATE too.

      return new Response(
        JSON.stringify({ review }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Reviews error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})


