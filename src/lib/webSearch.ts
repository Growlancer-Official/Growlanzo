import { supabase } from './supabase';

/**
 * Web search (Exa) — browser-side wrapper around the `exa-search` edge
 * function.
 *
 * WHAT: one authenticated `/search` with highlighted excerpts, so a page or an
 * AI workflow can ground an answer in real sources. The endpoint is the only
 * caller of the Exa API: the Exa key is an edge-function secret and must never
 * appear in this (shipping) bundle, so there is no direct Exa call here and no
 * Exa SDK import.
 *
 * `category` is an allowlist of two values and is for raw category-constrained
 * retrieval only — `'people'` or `'company'` documents as results. Building a
 * list of people or enriching company rows is an async research job
 * (Exa `/agent`), not a `/search` call. Pass `objective` whenever the search is
 * one step of a larger task: it tells Exa which documents should rank first and
 * which facts to pull.
 */
const FN = 'exa-search';

export type WebSearchCategory = 'people' | 'company';

export interface WebSearchOptions {
  query: string;
  /** Product-decided cap; the endpoint clamps to 1..10. */
  numResults?: number;
  /** Hard allowlist of plain domains (`example.com`), max 5. */
  includeDomains?: string[];
  category?: WebSearchCategory;
  /** The broader goal this search serves (max 4096 characters). */
  objective?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  author: string | null;
  highlights: string[];
}

export interface WebSearchResponse {
  success: boolean;
  query: string;
  category: WebSearchCategory | null;
  results: WebSearchResult[];
}

/**
 * Run one authenticated web search.
 *
 * @throws Error carrying the endpoint's own message (for example
 * "Web search is not configured") when the call fails.
 */
export async function searchWeb(options: WebSearchOptions): Promise<WebSearchResponse> {
  const { data, error } = await supabase.functions.invoke(FN, {
    method: 'POST',
    body: {
      query: options.query,
      ...(options.numResults !== undefined ? { numResults: options.numResults } : {}),
      ...(options.includeDomains && options.includeDomains.length > 0
        ? { includeDomains: options.includeDomains }
        : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(options.objective ? { objective: options.objective } : {}),
    },
  });

  if (error) {
    // Supabase wraps the function's JSON error body in `context`.
    const ctx = (error as { context?: { body?: string; status?: number } }).context;
    let message = error.message;
    if (ctx?.body) {
      try {
        const parsed = JSON.parse(ctx.body) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        /* keep the transport message */
      }
    }
    throw new Error(message);
  }

  const payload = data as WebSearchResponse & { error?: string };
  if (payload?.error) throw new Error(payload.error);

  return {
    success: payload?.success === true,
    query: payload?.query ?? options.query,
    category: payload?.category ?? null,
    results: Array.isArray(payload?.results) ? payload.results : [],
  };
}

/** People documents (LinkedIn-style profiles) for a query. */
export function searchPeople(
  options: Omit<WebSearchOptions, 'category'>
): Promise<WebSearchResponse> {
  return searchWeb({ ...options, category: 'people' });
}

/** Company documents (official sites, profiles) for a query. */
export function searchCompanies(
  options: Omit<WebSearchOptions, 'category'>
): Promise<WebSearchResponse> {
  return searchWeb({ ...options, category: 'company' });
}
