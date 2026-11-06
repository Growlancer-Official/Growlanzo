import type { Config } from 'vike/types';
import vikeReact from 'vike-react/config';

export default {
  extends: [vikeReact],

  // ─── Global <head> defaults ──────────────────────────────
  // ⚠️ `title` and `description` are deliberately NOT set here: a constant here
  // overrides the per-URL values from pages/+title.ts and +description.ts, which
  // is exactly how every prerendered page ended up advertising itself as the
  // homepage. Only the social image stays global.
  image: 'https://growlanzo.com/og-image.png',
  // ⚠️ vike-react only understands 'responsive' | number here — any other
  // string makes getViewportTag() return an EMPTY string, which silently
  // dropped the <meta name="viewport"> tag from every rendered page. Without
  // it mobile browsers fall back to a ~980px layout viewport and zoom the
  // whole site out (the entire mobile UI rendered as a shrunken desktop).
  // 'responsive' emits: width=device-width,initial-scale=1
  viewport: 'responsive',
  favicon: '/UpdatedLogo.png',

  // ─── Render mode ─────────────────────────────────────────
  // SSR enabled globally. Protected/dashboard routes handle auth
  // on the client side (useEffect in AuthContext).
  ssr: true,

  // ─── Suspense-aware SSR (required by our lazy routes) ────
  // Every non-SEO page in App.tsx is React.lazy()-loaded inside <Suspense>.
  // vike-react defaults to `renderToString`, which CANNOT render Suspense:
  // the first lazy route threw
  //   "Switched to client rendering because the server rendering aborted due
  //    to: The server used `renderToString` which does not support Suspense"
  // on most pages — i.e. SSR silently gave up and those routes were rendered
  // client-side only (no SEO HTML, one thrown React error per page load).
  //
  // `{ require: true, enable: false }` = use the Suspense-capable streaming
  // renderer but await the whole HTML and send it as one string, so prerender
  // output, the boot-splash injection and Vercel's static serving are all
  // unchanged. (vike.dev/stream)
  stream: { require: true, enable: false },

  // ─── React Strict Mode (was in main.tsx) ─────────────────
  reactStrictMode: true,

  // ─── Prerender (SSG): generate static HTML at build time ─
  // Vike crawls the URLs listed in +onBeforePrerenderStart.ts
  // and pre-renders each one to HTML. This gives instant FCP
  // for public pages without needing a running SSR server.
  prerender: true,

  // ─── i18n ─────────────────────────────────────────────────
  lang: 'en',

  // ─── HTML attributes ──────────────────────────────────────
  htmlAttributes: {
    lang: 'en',
  },

  // ─── Body attributes ──────────────────────────────────────
  bodyAttributes: {
    class: '',
  },
} satisfies Config;
