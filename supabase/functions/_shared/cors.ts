/**
 * Centralized CORS configuration for all edge functions.
 *
 * Single source of truth — add new domains HERE ONLY.
 * Every edge function imports getCorsHeaders from this module.
 */

const ALLOWED_ORIGINS = [
  'https://growlanzo.com',
  'https://growlanzo.com',
  // The alias the site is actually served on today (growlancer.vercel.app
  // 307-redirects here, and growlanzo.com does not resolve yet). Without this
  // entry every browser call from the live site to an edge function is blocked
  // by CORS, and the sections that depend on one stay on their spinner forever.
  'https://growlanzo.com',
  'https://growlanzo.com',
  'https://www.growlanzo.com',
  // The former brand domain. Kept until its DNS points at the new deployment:
  // while the cutover is in progress both hosts serve the same app, and a
  // browser on the old origin must still be able to read authenticated API
  // responses. Remove these two once growlancer.com redirects.
  'https://growlancer.mrkhan154212s-projects.vercel.app',
  'https://www.growlancer.mrkhan154212s-projects.vercel.app',
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
