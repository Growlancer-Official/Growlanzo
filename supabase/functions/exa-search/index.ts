import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { getCorsHeaders } from '../_shared/cors.ts';
import {
  EXA_CONFIGURED,
  clampResultCount,
  webSearch,
  type WebSearchResult,
} from '../_shared/exa.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

// ─── Growlanzo web search (Exa) ─────────────────────────────────────────────
// Authenticated users can search the web for relevant pages and highlighted
// excerpts. This is the retrieval surface an app page or an AI workflow uses to
// ground an answer in real sources.
// - Requires an authenticated user (JWT) — identity comes from auth.getUser()
// - The Exa key is an edge-function secret only — never exposed to the frontend
// - Missing key ⇒ 500 "not configured" (fail closed, never a silent empty list)

const MAX_QUERY_LEN = 500;
const MAX_DOMAINS = 5;

/** Plain domain only (`example.com`): no scheme, path, port or wildcard. */
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** Keep only well-formed, lowercase, de-duplicated domains (max 5). */
function normaliseDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const domain = entry.trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) continue;
    seen.add(domain);
    if (seen.size >= MAX_DOMAINS) break;
  }
  return [...seen];
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  // Fail closed: refuse when the Exa key is not configured.
  if (!EXA_CONFIGURED) {
    console.error('[exa-search] EXA_API_KEY is not configured');
    return json(500, { error: 'Web search is not configured' });
  }

  try {
    // ─── AUTHENTICATION (JWT required; never trust a body user_id) ───
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
    if (authError || !authUser) {
      return json(401, { error: 'Unauthorized' });
    }

    // ─── BODY ───
    let body: { query?: unknown; numResults?: unknown; includeDomains?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return json(400, { error: 'A search query is required.' });
    }
    if (query.length > MAX_QUERY_LEN) {
      return json(400, { error: `Query too long (max ${MAX_QUERY_LEN} characters).` });
    }

    const numResults = clampResultCount(body?.numResults);
    const includeDomains = normaliseDomains(body?.includeDomains);

    // ─── SEARCH ───
    let results: WebSearchResult[];
    try {
      results = await webSearch(query, { numResults, includeDomains });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'ExaTimeoutError') {
        console.error('[exa-search] Exa timed out');
        return json(504, { error: 'Web search timed out. Please try again.' });
      }
      // Never return the upstream message: it can carry request/account detail.
      console.error('[exa-search] Exa search failed:', name, (err as Error)?.message);
      return json(502, { error: 'Web search is temporarily unavailable. Please try again.' });
    }

    return json(200, { success: true, query, results });
  } catch (err) {
    console.error('[exa-search] unexpected error:', (err as Error)?.message || err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
});
