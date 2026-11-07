/**
 * Centralized CORS configuration for all edge functions.
 *
 * Single source of truth — add new domains HERE ONLY.
 * Every edge function imports getCorsHeaders from this module.
 */

const ALLOWED_ORIGINS = [
  'https://growlanzo.com',
  'https://www.growlanzo.com',
  // The Vercel deployment origin of this project. A live CORS failure on it
  // left every admin-data section spinning in production, so it stays listed.
  'https://growlancer-mrkhan154212s-projects.vercel.app',
  // Vercel alias + former brand domain. Kept while the cutover is in progress:
  // both hosts still serve the same app, and a browser sitting on one of them
  // must be able to read authenticated API responses. Remove them once both
  // permanently 301 to growlanzo.com.
  'https://growlancer.vercel.app',
  'https://growlanzo.vercel.app',
  'https://growlancer.com',
  'https://www.growlancer.com',
  'http://localhost:5173',
];

// Pattern-allowed origins (reflected individually):
// - Vercel preview / branch-alias deployments of THIS project only. The team
//   slug suffix is REQUIRED on purpose: a bare `growlancer-*.vercel.app`
//   pattern would also match any third-party Vercel project that simply names
//   itself `growlancer-something`. (The Vercel project slug is unchanged by
//   the Growlanzo rename — the deployment hostnames still read `growlancer`.)
// - local dev / E2E on any loopback port (loopback is not attacker-reachable).
// No `Access-Control-Allow-Credentials` is ever sent and every edge function
// authenticates via JWT, so a reflected origin only controls browser
// readability of a response it already had to authenticate for.
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/growlancer-[a-z0-9-]+-mrkhan154212s-projects\.vercel\.app$/,
  // Same project after the Growlanzo rename; preview/branch aliases now carry
  // the new slug. The team suffix keeps third-party projects out.
  /^https:\/\/growlanzo-[a-z0-9-]+-mrkhan154212s-projects\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

/**
 * Returns CORS headers for the given request origin.
 * - Known origin → reflects it back (proper per-origin CORS)
 * - Unknown/missing origin → returns empty headers (rejects cross-origin)
 *
 * @param origin - The request Origin header value
 * @param methods - Optional override for allowed methods (default: all)
 */
export function getCorsHeaders(
  origin: string | null,
  methods: string = 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
): Record<string, string> {
  if (
    (origin && ALLOWED_ORIGINS.includes(origin)) ||
    (origin && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin)))
  ) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version, x-app-name',
      'Access-Control-Allow-Methods': methods,
    };
  }

  // Unknown origin — do NOT reflect. Return no CORS headers so the browser
  // blocks the response. For server-to-server calls (webhooks, cron) that
  // don't send an Origin header, this is fine — CORS is a browser mechanism.
  return {};
}
