import type { OnBeforePrerenderStartSync } from 'vike/types';
import { PUBLIC_PRERENDER_URLS } from './prerenderUrls';

// ═══════════════════════════════════════════════════════════════════
// Vike Prerender — Static Site Generation
// ═══════════════════════════════════════════════════════════════════
// During `vite build`, Vike renders each URL in PUBLIC_PRERENDER_URLS to
// static HTML. Visitors get fully-rendered HTML instantly without needing a
// running SSR server (like a CDN-hosted static site).
//
// The URL list lives in `pages/prerenderUrls.ts`. It used to be duplicated in
// vite.config.ts for the boot-splash guard; that guard now derives the rendered
// route from the HTML's own `#vike_pageContext`, so this list has a single
// consumer again. The old two-copy version drifted: `/report` and
// `/refund-policy` were linked site-wide from the footer but prerendered
// nowhere.
//
// Auth-protected routes (dashboard, admin, client) are NOT listed here —
// they require client-side session checks which can't be pre-rendered. Their
// initial HTML shows the loading skeleton until JS hydrates and AuthContext
// resolves the session.
// ═══════════════════════════════════════════════════════════════════

const onBeforePrerenderStart: OnBeforePrerenderStartSync = () => {
  return [...PUBLIC_PRERENDER_URLS];
};

export { onBeforePrerenderStart };
