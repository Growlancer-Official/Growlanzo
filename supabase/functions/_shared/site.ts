/**
 * Centralized public-site URL for every edge function.
 *
 * SINGLE SOURCE OF TRUTH for the origin used in:
 *   - outbound email (logo, action links, footer links)
 *   - payment redirect URLs (PayPal return_url / cancel_url)
 *   - AI gateway attribution headers (OpenRouter HTTP-Referer)
 *
 * Switching the production domain (e.g. growlancer.vercel.app -> growlanzo.com)
 * is then a SECRET change, not a code change:
 *
 *   npx supabase secrets set APP_URL=https://growlanzo.com --project-ref <ref>
 *
 * The fallback below exists only so a missing secret degrades to a WORKING
 * origin instead of an empty string (which would emit broken links like
 * `/dashboard/subscription`). It is never silent — the miss is logged so it
 * shows up in the function logs. No secret VALUE is ever logged.
 */

const RAW_APP_URL = (Deno.env.get('APP_URL') ?? '').trim();

/**
 * Origin used when the APP_URL secret is not configured.
 * Kept at the currently-live deployment origin on purpose: if the secret were
 * ever lost, this keeps links working rather than pointing at a domain that
 * may not resolve yet.
 */
export const FALLBACK_SITE_URL = 'https://growlancer.vercel.app';

/** Absolute site origin, no trailing slash. */
export const SITE_URL: string = (RAW_APP_URL || FALLBACK_SITE_URL).replace(/\/+$/, '');

if (!RAW_APP_URL) {
  console.warn(
    `[site] APP_URL is not configured — falling back to ${FALLBACK_SITE_URL}. ` +
      'Email links and payment redirects will use that origin. ' +
      'Set the canonical domain with: supabase secrets set APP_URL=https://growlancer.vercel.app',
  );
}

/** Build an absolute URL for a site-relative path (`''` -> the origin). */
export function siteUrl(path = ''): string {
  const suffix = String(path ?? '');
  if (!suffix) return SITE_URL;
  return SITE_URL + (suffix.startsWith('/') ? suffix : `/${suffix}`);
}
