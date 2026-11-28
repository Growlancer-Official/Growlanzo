import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { AI_API_KEY, AI_MODEL, AI_BASE_URL } from '../_shared/ai.ts';
import { getCorsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;


interface Project {
  id: string;
  title: string;
  category: string;
  skills_required: string[];
  budget_min: number;
  budget_max: number;
  experience_level: string;
  description?: string;
}

interface FreelancerCandidate {
  id: string;
  name: string;
  skills: string[];
  categories: string[];
  hourly_rate: number;
  availability: boolean;
  experience_years: number;
  completion_rate: number;
  reputation_score: number;
  bio?: string;
}

interface MatchResult {
  project_id: string;
  freelancer_id: string;
  match_score: number;
  skill_score: number;
  experience_score: number;
  budget_score: number;
  availability_score: number;
  completion_score: number;
  category_score: number;
  ai_score: number | null;
  match_reason: string | null;
}

// Rate limiting - DB-backed (uses service role client)
const ROUTE = 'ai-matching';
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60000;

// Client AI is FREE FOR LIFETIME — per-user-per-day fair-use abuse guard
// (never a paywall, never an upsell). Keyed on the authenticated user id.
const CLIENT_DAILY_ROUTE = 'client-ai-daily';
const CLIENT_DAILY_LIMIT = 100;
const CLIENT_DAILY_WINDOW_MS = 86400000;

async function checkDailyLimit(
  supabaseClient: any,
  identifier: string,
  route: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; resetsInMs: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  try {
    await supabaseClient.rpc('cleanup_expired_rate_limits');
  } catch {
    // Non-critical; cleanup also runs via cron
  }

  const { count, error } = await supabaseClient
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('identifier', identifier)
    .eq('route', route)
    .gte('window_start', windowStart.toISOString());

  if (error) return { allowed: true, resetsInMs: 0 };
  if (count !== null && count >= limit) {
    return { allowed: false, resetsInMs: Math.max(0, windowMs - (Date.now() - windowStart.getTime())) };
  }

  await supabaseClient
    .from('rate_limits')
    .insert({ identifier, route, count: 1, window_start: now.toISOString() });

  return { allowed: true, resetsInMs: 0 };
}

async function checkRateLimit(supabaseClient: any, identifier: string): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_WINDOW_MS);

  try {
    await supabaseClient.rpc('cleanup_expired_rate_limits');
  } catch {
    // Non-critical; cleanup also runs via cron
  }

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

  await supabaseClient
    .from('rate_limits')
    .insert({ identifier, route: ROUTE, count: 1, window_start: now.toISOString() });

  return true;
}

/**
 * AI semantic scoring pass via the AI gateway.
 * Asks the LLM to evaluate the top deterministic candidates against the
 * project and return refined scores + a one-line reason. Best-effort: if the
 * gateway is unreachable, returns null and the deterministic scores are used
 * as-is — matching ALWAYS works.
 */
async function aiSemanticBoost(
  project: Project,
  candidates: FreelancerCandidate[]
): Promise<Map<string, { ai_score: number; reason: string }> | null> {
  if (!AI_API_KEY || candidates.length === 0) return null;

  const candidatePayload = candidates.map((c) => ({
    id: c.id.slice(0, 8),
    name: c.name || 'Freelancer',
    skills: c.skills || [],
    categories: c.categories || [],
    hourly_rate: c.hourly_rate || 0,
    experience_years: c.experience_years || 0,
    completion_rate: c.completion_rate || 100,
    bio: c.bio ? c.bio.slice(0, 200) : '',
  }));

  const systemPrompt = `You are Growlanzo's AI matchmaking engine. Given a project and a list of freelancer candidates, score how well each candidate fits the project from 0-100 and give a short one-line reason.

Respond with STRICT JSON ONLY — an object of the form:
{"<candidate_id>": {"score": <0-100 integer>, "reason": "<one short line>"}}

Rules:
- Score primarily on skill overlap, domain relevance, and experience fit.
- Consider budget compatibility (candidate base rate vs the project's single budget — a base rate within the budget is a strong fit, far above it is a weak fit).
- Never invent skills. Use only what is provided.
- Keep reasons under 12 words, professional and specific.`;

  const userPrompt = `PROJECT:
Title: ${project.title || ''}
Category: ${project.category || ''}
Skills required: ${(project.skills_required || []).join(', ')}
Budget range: ₹${project.budget_min || 0} - ₹${project.budget_max || 0}
Experience level: ${project.experience_level || 'intermediate'}
Description: ${project.description ? project.description.slice(0, 300) : ''}

CANDIDATES (JSON):
${JSON.stringify(candidatePayload)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000); // 9s hard cap

    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error('[ai-matching] AI semantic pass failed:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content) return null;

    // Extract the JSON object (strip markdown fences if present)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const resultMap = new Map<string, { ai_score: number; reason: string }>();
    for (const [key, value] of Object.entries(parsed)) {
      const v = value as { score?: number; reason?: string };
      if (typeof v?.score === 'number') {
        resultMap.set(key, {
          ai_score: Math.max(0, Math.min(100, Math.round(v.score))),
          reason: String(v.reason || '').slice(0, 120),
        });
      }
    }
    return resultMap;
  } catch (err) {
    console.error('[ai-matching] AI semantic pass error (falling back to deterministic):', err?.message || err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Service-role client for DB ops (used below).
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  // Anon client with the caller's JWT — verify identity before touching the DB.
  const supabaseAnon = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
  );

  try {
    // 🔒 Require an authenticated user
    const { data: authData } = await supabaseAnon.auth.getUser();
    if (!authData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { project_id } = await req.json();

    if (!project_id) {
      return new Response(JSON.stringify({ error: 'project_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 🔒 Project ownership — the project is fetched OWNER-SCOPED so a signed-in
    // non-owner can never trigger AI spend (or overwrite ai_matches) against
    // someone else's project. The caller's id comes from the verified JWT,
    // never from the request body. No row → 404 (existence of other users'
    // projects is not disclosed).
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, client_id, title, category, skills_required, budget_min, budget_max, experience_level, description')
      .eq('id', project_id)
      .eq('client_id', authData.user.id)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rate limit check
    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const identifier = project_id || clientIP;
    const allowed = await checkRateLimit(supabase, identifier);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client fair-use daily cap — free forever, abuse-protected. Friendly
    // message only; NEVER an upsell (clients are free for life).
    const daily = await checkDailyLimit(
      supabase,
      authData.user.id,
      CLIENT_DAILY_ROUTE,
      CLIENT_DAILY_LIMIT,
      CLIENT_DAILY_WINDOW_MS
    );
    if (!daily.allowed) {
      const hours = Math.ceil(daily.resetsInMs / 3600000);
      return new Response(JSON.stringify({
        error: `Fair usage limit reached — it resets ${hours > 0 ? `in about ${hours} hour${hours > 1 ? 's' : ''}` : 'tomorrow'}. AI stays free for you forever.`,
        code: 'fair_usage_limit',
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all freelancers (exclude soft-deleted). `bio` lives on
    // freelancer_profiles — it was dropped from profiles, and selecting it
    // there rejected the whole query, which failed every match request.
    const { data: freelancers, error: freelancersError } = await supabase
      .from('profiles')
      .select(`
        id,
        name,
        freelancer_profiles (
          bio,
          skills,
          hourly_rate,
          availability,
          experience,
          completion_rate,
          reputation_score
        )
      `)
      .eq('role', 'freelancer')
      .is('deleted_at', null);

    // Fetch freelancer service categories + skills (a freelancer's live
    // services are strong match signals even when the profile row is empty)
    const { data: allServices } = await supabase
      .from('services')
      .select('freelancer_id, category, skills')
      .eq('status', 'active');

    const freelancerCategoryMap = new Map<string, Set<string>>();
    const freelancerSkillMap = new Map<string, Set<string>>();
    if (allServices) {
      for (const svc of allServices) {
        if (!freelancerCategoryMap.has(svc.freelancer_id)) {
          freelancerCategoryMap.set(svc.freelancer_id, new Set());
        }
        if (svc.category) freelancerCategoryMap.get(svc.freelancer_id)!.add(svc.category);
        const svcSkills = Array.isArray(svc.skills) ? svc.skills : [];
        if (svcSkills.length > 0) {
          if (!freelancerSkillMap.has(svc.freelancer_id)) freelancerSkillMap.set(svc.freelancer_id, new Set());
          for (const s of svcSkills) freelancerSkillMap.get(svc.freelancer_id)!.add(s);
        }
      }
    }

    // PRIMARY category source: freelancer_profiles.categories (145-category-first
    // pivot) — merged with service categories so matching works even when a
    // freelancer has no published services yet.
    const { data: freelancerCats } = await supabase
      .from('freelancer_profiles')
      .select('user_id, categories');
    if (freelancerCats) {
      for (const fp of freelancerCats) {
        const cats = Array.isArray(fp.categories) ? fp.categories : [];
        if (cats.length === 0) continue;
        if (!freelancerCategoryMap.has(fp.user_id)) {
          freelancerCategoryMap.set(fp.user_id, new Set());
        }
        for (const c of cats) freelancerCategoryMap.get(fp.user_id)!.add(c);
      }
    }

    if (freelancersError) {
      console.error('Failed to fetch freelancers:', freelancersError);
      return new Response(JSON.stringify({ error: 'Failed to fetch freelancers', details: freelancersError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── PASS 1: deterministic scores (fast, always works) ─────────────────
    const candidates: FreelancerCandidate[] = [];
    const matches: MatchResult[] = [];

    for (const freelancer of freelancers || []) {
      const fProfile = freelancer.freelancer_profiles?.[0] || freelancer.freelancer_profiles;
      if (!fProfile) continue;

      const freelancerCategories = freelancerCategoryMap.get(freelancer.id) || new Set();
      const profileSkills = Array.isArray(fProfile.skills) ? fProfile.skills : [];
      const serviceSkills = freelancerSkillMap.get(freelancer.id);
      const skills = serviceSkills && serviceSkills.size > 0
        ? mergeSkillSets(profileSkills, Array.from(serviceSkills))
        : profileSkills;

      const freelancerData: FreelancerCandidate = {
        id: freelancer.id,
        name: freelancer.name || 'Freelancer',
        bio: fProfile.bio || '',
        skills,
        categories: Array.from(freelancerCategories),
        hourly_rate: Number(fProfile.hourly_rate) || 0,
        availability: fProfile.availability === true || fProfile.availability === 'true',
        experience_years: Number(fProfile.experience) || 0,
        completion_rate: Number(fProfile.completion_rate) || 100,
        reputation_score: Number(fProfile.reputation_score) || 100,
      };

      const score = calculateMatchScore(project as Project, freelancerData);

      // Skill-first qualification (mirrors the server engine): category overlap
      // qualifies on its own; without it, a REAL skill overlap is required
      // (project lists skills + >= 40% of them matched). Skills alone must
      // never be silently dropped just because categories don't line up.
      const projectSkills = (project as Project).skills_required || [];
      const qualifies = score.category_score > 0
        ? score.match_score >= 40
        : projectSkills.length > 0 && score.skill_score >= 40 && score.match_score >= 40;
      if (qualifies) {
        matches.push(score);
        candidates.push(freelancerData);
      }
    }

    // Sort by match score descending
    matches.sort((a, b) => b.match_score - a.match_score);

    // ─── PASS 2: AI semantic boost (top 25, best-effort) ────────────────
    const topDeterministic = matches.slice(0, 25);
    const topCandidates = candidates.slice(0, 25);
    let aiBoost: Map<string, { ai_score: number; reason: string }> | null = null;

    if (topDeterministic.length > 0) {
      aiBoost = await aiSemanticBoost(project as Project, topCandidates);
    }

    const finalMatches: MatchResult[] = topDeterministic.map((m) => {
      const shortId = m.freelancer_id.slice(0, 8);
      const boost = aiBoost?.get(shortId);

      // Blend: 60% deterministic + 40% AI semantic (when available)
      let matchScore = m.match_score;
      let aiScore: number | null = null;
      let reason: string | null = null;

      if (boost) {
        aiScore = boost.ai_score;
        matchScore = Math.min(100, Math.round(m.match_score * 0.6 + boost.ai_score * 0.4));
        reason = boost.reason || null;
      }

      return { ...m, match_score: matchScore, ai_score: aiScore, match_reason: reason };
    });

    // The AI blend changes scores, so re-rank AFTER it. Without this the
    // response (and the row order written below) could show a lower-scored
    // freelancer above a higher one, while the UI — which orders by
    // match_score — silently disagreed with the API payload.
    finalMatches.sort((a, b) => b.match_score - a.match_score);

    // ─── Persist matches (replaces old ones for this project) ───────────────
    await supabase
      .from('ai_matches')
      .delete()
      .eq('project_id', project_id);

    if (finalMatches.length > 0) {
      const { error: insertError } = await supabase
        .from('ai_matches')
        .insert(finalMatches);

      if (insertError) {
        console.error('Failed to insert AI matches:', insertError);
        throw insertError;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      matches: finalMatches,
      total_analyzed: freelancers?.length || 0,
      ai_enhanced: aiBoost !== null,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('AI Matching internal error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown internal error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/** Merge skill lists (from profile + services), deduped case-insensitively. */
function mergeSkillSets(...sets: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const arr of sets) {
    for (const raw of arr || []) {
      const s = String(raw).trim();
      const key = s.toLowerCase();
      if (s && !seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    }
  }
  return out;
}

function calculateMatchScore(project: Project, freelancer: FreelancerCandidate): MatchResult {
  // All sub-scores are 0-100 (consistent with the server-side SQL engine so the
  // freelancer feed's filters and score bars behave the same on both paths).

  // 1. CATEGORY MATCH (anchor — 35% weight)
  const categoryMatch = freelancer.categories.some(c => {
    const cleanCat = c.toLowerCase().trim();
    const cleanProjCat = (project.category || '').toLowerCase().trim();
    return cleanCat === cleanProjCat;
  });
  const categoryScore = categoryMatch ? 100 : 0;

  // 2. SKILL MATCH (25%)
  const skillScore = calculateSkillScore(project.skills_required, freelancer.skills);

  // 3. EXPERIENCE (15%)
  const experienceScore = calculateExperienceScore(project.experience_level, freelancer.experience_years);

  // 4. BUDGET FIT (12%)
  const budgetScore = calculateBudgetScore(project.budget_min, project.budget_max, freelancer.hourly_rate);

  // 5. AVAILABILITY (8%)
  const availabilityScore = freelancer.availability ? 100 : 40;

  // 6. COMPLETION & REPUTATION (5%)
  const completionScore = Math.max(0, Math.min(100, Math.round((freelancer.completion_rate + freelancer.reputation_score) / 2)));

  const matchScore = Math.min(100, Math.round(
    (categoryScore * 0.35) +
    (skillScore     * 0.25) +
    (experienceScore * 0.15) +
    (budgetScore    * 0.12) +
    (availabilityScore * 0.08) +
    (completionScore * 0.05)
  ));

  return {
    project_id: project.id,
    freelancer_id: freelancer.id,
    match_score: matchScore,
    skill_score: Math.round(skillScore),
    experience_score: Math.round(experienceScore),
    budget_score: Math.round(budgetScore),
    availability_score: Math.round(availabilityScore),
    completion_score: completionScore,
    category_score: categoryScore,
    ai_score: null,
    match_reason: null,
  };
}

function calculateSkillScore(requiredSkills: string[], freelancerSkills: string[]): number {
  if (!requiredSkills || requiredSkills.length === 0) return 50;
  if (!freelancerSkills || freelancerSkills.length === 0) return 0;

  const matchedSkills = requiredSkills.filter(skill =>
    freelancerSkills.some(fs => {
      const cleanFs = fs.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanSkill = skill.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanFs.includes(cleanSkill) || cleanSkill.includes(cleanFs);
    })
  );

  return (matchedSkills.length / requiredSkills.length) * 100;
}

function calculateExperienceScore(requiredLevel: string, freelancerYears: number): number {
  const requirements: Record<string, { min: number; max: number }> = {
    entry: { min: 0, max: 2 },
    beginner: { min: 0, max: 2 },
    intermediate: { min: 2, max: 5 },
    expert: { min: 5, max: 100 },
  };

  const req = requirements[requiredLevel] || requirements.intermediate;

  if (freelancerYears >= req.min && freelancerYears <= req.max) {
    return 100;
  } else if (freelancerYears > req.max) {
    return 70; // Overqualified
  } else if (freelancerYears >= req.min - 1) {
    return 50; // Close to requirement
  }

  return 20;
}

function calculateBudgetScore(budgetMin: number, budgetMax: number, baseRate: number): number {
  // Fixed-pricing model: compare the freelancer's base rate directly to the
  // client's single project budget (min === max). Never reward a deal the
  // freelancer would take at a loss (same 60% floor as proposal smart pricing).
  if (!baseRate) return 50; // Neutral if no rate is set

  const budget = budgetMax > 0 ? budgetMax : budgetMin > 0 ? budgetMin : 0;
  if (budget > 0) {
    if (baseRate <= budget) return 100;          // base rate fits within budget
    if (baseRate <= budget * 1.3) return 80;     // slightly above — close enough
    if (baseRate <= budget * 1.67) return 50;    // moderately above — may not fit
    return 30;                                    // well above budget — poor fit
  }
  return 50;
}
