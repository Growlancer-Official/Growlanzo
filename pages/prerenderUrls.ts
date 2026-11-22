// ═══════════════════════════════════════════════════════════════════
// Single source of truth: which public URLs are PRE-RENDERED
// ═══════════════════════════════════════════════════════════════════
// This list is consumed by ONE place:
//
//   1. pages/+onBeforePrerenderStart.ts — tells Vike which URLs to render
//      to static HTML at build time (instant FCP + real HTML for crawlers).
//
// The pre-hydration boot splash does NOT read this list any more. It derives
// the route the HTML was rendered for from `#vike_pageContext` itself (see
// scripts/build.mjs), so it cannot drift from what Vike actually prerendered.
//
// A second hand-maintained copy did drift once: `/report` and
// `/refund-policy` were linked site-wide from the footer but missing from
// BOTH — so those two public pages were served the homepage HTML (wrong
// <title>/canonical, a React hydration mismatch, nothing rendered until JS
// loaded) instead of their own prerendered page.
//
// Keep this file dependency-free (no vike imports) so vite.config.ts can
// import it directly.
// ═══════════════════════════════════════════════════════════════════

export const PUBLIC_PRERENDER_URLS = [
  // ── Main pages ──────────────────────────────────────────
  '/',
  '/how-it-works',
  '/features',
  '/categories',
  '/pricing',
  '/about',
  '/philosophy',
  '/contact',
  '/internships',
  '/careers',
  '/help-center',
  '/safety',
  '/guidelines',
  '/status',
  '/terms',
  '/privacy',
  '/escrow-policy',
  '/refund-policy',
  '/cookies',

  // ── Browse pages ────────────────────────────────────────
  '/freelancers',
  '/services',
  '/contests',

  // ── Verification / Utility ──────────────────────────────
  '/certificate',
  '/verify-certificate',
  '/report',
  '/waitlist',

  // ── Auth pages (reached from email links) ───────────────
  // ⚠️ ONLY pages that actually exist may be listed here. The email/password
  // auth pages (`/auth/forgot-password`, `/auth/reset-password`,
  // `/auth/magic-link`, `/auth/otp`) were removed when sign-in became
  // GitHub/LinkedIn-only — listing them made the build PRERENDER a 404 page for
  // each one, so an old bookmark or a stale verification email landed on a
  // bare `<h1>404</h1>` instead of the app's styled not-found screen. Absent
  // from this list, those URLs fall through to the SPA shell and React Router
  // renders the real NotFound route (same as any other unknown path).
  // `src/test/oauthOnlyAuthSurface.test.ts` keeps them un-routed;
  // `src/test/authRouteSurface.test.ts` keeps them out of this list.
  '/auth/email-confirm',
  '/auth/verify-email',

  // ── Payment outcomes ────────────────────────────────────
  '/payment/success',
  '/payment/cancel',

  // ── Fallback ────────────────────────────────────────────
  '/not-found',
] as const;

export type PublicPrerenderUrl = (typeof PUBLIC_PRERENDER_URLS)[number];
