import React from 'react';
import { usePageContext } from 'vike-react/usePageContext';
import { canonicalUrl, resolveMeta } from '../src/lib/routeMeta';

export default function Head() {
  // The app is ONE Vike page (catch-all → react-router). Without this, every
  // prerendered HTML file shipped the global title and
  // `canonical="https://growlanzo.com/"`, so /pricing, /terms and /privacy all
  // told Google they were the homepage. `resolveMeta` is the same rule table the
  // client uses, so static and runtime metadata cannot drift.
  const { urlPathname } = usePageContext();
  const pathname = urlPathname || '/';
  const meta = resolveMeta(pathname);
  const canonical = canonicalUrl(pathname);

  return (
    <>
      {/* ── Favicon + app icon — the final Growlanzo "G" (public/UpdatedLogo.*,
           public/apple-touch-icon.png). `?v=` busts the cached copy some
           returning visitors still hold, so a rebrand actually reaches them. ── */}
      <link rel="icon" type="image/webp" sizes="32x32" href="/UpdatedLogo.webp?v=7" />
      <link rel="icon" type="image/png" sizes="64x64" href="/favicon-growlanzo.png?v=7" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=7" />
      <link rel="shortcut icon" href="/UpdatedLogo.png?v=7" />

      {/* ── Mobile viewport — CRITICAL: without this, phones fall back to the
          980px desktop layout viewport and the whole site renders zoomed-out
          tiny (0.4× on iPhone). This is what makes auth/badges/layout look
          broken on mobile. ── */}
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

      {/* ── Theme ── */}
      <meta name="theme-color" content="#24ba35" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="Growlanzo" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="application-name" content="Growlanzo" />

      {/* ── Per-route metadata ──
          <title> and <meta name="description"> come from pages/+title.ts and
          pages/+description.ts (vike-react also emits their og: counterparts,
          so those are deliberately NOT duplicated here). This file owns the
          tags vike-react does not derive from the page URL. */}
      <meta name="robots" content={meta.noindex ? 'noindex, nofollow' : 'index, follow'} />

      {/* ── Open Graph / Facebook ── */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content="https://growlancer.vercel.app/og-image.png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      {/* ── Twitter ── */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={canonical} />
      <meta property="twitter:title" content={meta.title} />
      <meta property="twitter:description" content={meta.description} />
      <meta property="twitter:image" content="https://growlancer.vercel.app/og-image.png" />

      {/* ── Canonical ── */}
      <link rel="canonical" href={canonical} />
      <link rel="manifest" href="/manifest.json" />

      {/* ── Resource hints ── */}
      <link rel="preconnect" href="https://api.fontshare.com" />
      {/* The woff2 files are served from cdn.fontshare.com, NOT api.fontshare.com
          (the api host only returns the CSS) — preconnecting to the api host alone
          leaves the real font download on a cold connection. */}
      <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://o4511722119495680.ingest.us.sentry.io" />
      <link rel="preconnect" href="https://zttwsjehcgaicziqyxpq.supabase.co" />
      <link rel="dns-prefetch" href="https://zttwsjehcgaicziqyxpq.supabase.co" />

      {/* ── Design fonts: Cabinet Grotesk (display) + Satoshi (sans) ──
           These are exactly the families declared in tailwind.config.js
           (`font-display` / `font-sans`) and src/styles/globals.css, so what the
           CSS asks for is what actually gets loaded.

           ONE REQUEST PER FAMILY, deliberately. A combined request
           (`...css?f[]=cabinet-grotesk@…&f[]=satoshi@…`) answers HTTP 200 but
           SILENTLY serves only one of the two families — verified live: with
           Satoshi listed first the response contains no Cabinet Grotesk at all,
           so every display heading quietly falls back to system-ui with no error
           anywhere. Two requests make each family's load independently checkable.

           The weights are the ones each family really publishes. Fontshare drops
           a weight it does not have without an error (Satoshi has no 600/800), so
           asking for one leaves a hole that renders at the wrong weight — that is
           how the heavy display headings were lost. Every `font-*` utility used in
           src/ must be covered here; src/test/typographyFonts.test.ts enforces
           both that rule and that these three declarations never drift apart.

           A PLAIN stylesheet link, deliberately — not the
           `media="print" onLoad="this.media='all'"` non-blocking trick. React
           renders this head, and React does NOT serialise event handlers, so the
           prerendered HTML shipped `media="print"` with no `onload` at all: the
           CSS stayed in print mode forever and neither family ever applied. That
           is why prerendered pages rendered in system-ui. The stylesheet is a few
           KB from a preconnected origin and the fonts themselves use
           `display=swap`, so loading it normally costs nothing visible. ── */}
      <link
        rel="preload"
        as="style"
        href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&display=swap"
      />
      <link
        rel="stylesheet"
        href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&display=swap"
      />
      <link
        rel="preload"
        as="style"
        href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
      />
      <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" />
      <noscript>
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
          rel="stylesheet"
        />
      </noscript>

      {/* ── Inline critical CSS ── */}
      <style>{`
        html { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        body { margin: 0; background: #FFF8EE; color: #0F172A; overflow-x: hidden; }
        #root { min-height: 100vh; }
        /* ⚠️ Zero-specificity, on purpose. This block is appended to <head>
           AFTER the compiled stylesheet, so a plain '.flex-col { … }' here
           outranked the real utilities by document order and made every
           "flex-col sm:flex-row" element a COLUMN at every width (measured:
           the cookie notice's actions stacked at 1440px). ":where()" keeps the
           pre-stylesheet paint working while letting the compiled sheet — which
           is the source of truth — always win. */
        :where(.mx-auto) { margin-left: auto; margin-right: auto; }
        :where(.max-w-7xl) { max-width: 80rem; }
        :where(.px-4) { padding-left: 1rem; padding-right: 1rem; }
        @media (min-width: 640px) { :where(.sm\\:px-6) { padding-left: 1.5rem; padding-right: 1.5rem; } }
        @media (min-width: 1024px) { :where(.lg\\:px-8) { padding-left: 2rem; padding-right: 2rem; } }
        :where(.relative) { position: relative; }
        :where(.grid) { display: grid; }
        :where(.flex) { display: flex; }
        :where(.items-center) { align-items: center; }
        :where(.justify-center) { justify-content: center; }
        :where(.flex-col) { flex-direction: column; }
        :where(.gap-10) { gap: 2.5rem; }
        :where(.gap-12) { gap: 3rem; }
        :where(.pt-10) { padding-top: 2.5rem; }
        :where(.pb-10) { padding-bottom: 2.5rem; }
        @media (min-width: 640px) { :where(.sm\\:pt-14) { padding-top: 3.5rem; } :where(.sm\\:pb-14) { padding-bottom: 3.5rem; } :where(.sm\\:text-5xl) { font-size: 3rem; line-height: 1; } :where(.sm\\:text-lg) { font-size: 1.125rem; line-height: 1.75rem; } }
        @media (min-width: 1024px) { :where(.lg\\:col-span-6) { grid-column: span 6 / span 6; } :where(.lg\\:text-6xl) { font-size: 3.75rem; line-height: 1; } :where(.lg\\:pt-16) { padding-top: 4rem; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        :where(.animate-fade-up) { animation: fadeUp 700ms ease-out forwards; }
        :where(.opacity-0) { opacity: 0; }
      `}</style>
    </>
  );
}
