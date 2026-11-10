/**
 * Shared Exa web-search client for Growlanzo edge functions.
 *
 * WHAT: `webSearch()` performs one Exa `/search` call (official `exa-js` SDK)
 * with `highlights`, so an edge function or agent gets relevant pages plus the
 * excerpts that answer the query — not just links.
 *
 * SECURITY: `EXA_API_KEY` is read from edge-function secrets only
 * (`supabase secrets set EXA_API_KEY=...`). It is never exposed to the
 * frontend, never logged and never committed. A missing key leaves
 * `EXA_CONFIGURED` false so every caller can fail closed instead of crashing at
 * import time (importing a module must not take a function down).
 *
 * SDK: the official package, pinned. `package.json` carries the same version so
 * local tooling resolves the exact client the edge runtime runs.
 */
import Exa from 'npm:exa-js@2.28.0';

export const EXA_API_KEY = (Deno.env.get('EXA_API_KEY') || '').trim();
export const EXA_CONFIGURED = EXA_API_KEY.length > 0;

export const DEFAULT_RESULT_COUNT = 5;
/** Exa allows up to 100; the app caps lower because the endpoint spends one
 *  billable search and the reply is rendered in a small list. */
export const MAX_RESULT_COUNT = 10;

/** Hard budget: a stalled upstream must not hold the request open. */
const SEARCH_TIMEOUT_MS = 8000;

export interface WebSearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  author: string | null;
  highlights: string[];
}

export interface WebSearchOptions {
  numResults?: number;
  /** Domain filters (`example.com`), validated by the caller. */
  includeDomains?: string[];
  excludeDomains?: string[];
}

let client: Exa | null = null;

/** Lazily construct the SDK client so importing this module never throws. */
function getClient(): Exa {
  if (!EXA_CONFIGURED) {
    throw new Error('EXA_API_KEY is not configured');
  }
  if (!client) {
    client = new Exa(EXA_API_KEY);
  }
  return client;
}

/** Sanitise a caller-supplied count into 1..MAX_RESULT_COUNT. */
export function clampResultCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RESULT_COUNT;
  return Math.min(MAX_RESULT_COUNT, Math.max(1, Math.trunc(n)));
}

/**
 * Run one Exa search with highlighted excerpts.
 *
 * @throws when the key is missing, the query is empty, or Exa/the network fails.
 */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebSearchResult[]> {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) {
    throw new Error('Search query is empty');
  }

  const response = await getClient().search(
    trimmed,
    {
      type: 'auto',
      numResults: clampResultCount(options.numResults),
      ...(options.includeDomains && options.includeDomains.length > 0
        ? { includeDomains: options.includeDomains }
        : {}),
      ...(options.excludeDomains && options.excludeDomains.length > 0
        ? { excludeDomains: options.excludeDomains }
        : {}),
      contents: { highlights: true },
    },
    { timeout: SEARCH_TIMEOUT_MS }
  );

  return (response.results ?? []).map((result) => ({
    title: result.title ?? '',
    url: result.url,
    publishedDate: result.publishedDate ?? null,
    author: result.author ?? null,
    highlights: Array.isArray(result.highlights) ? result.highlights : [],
  }));
}
