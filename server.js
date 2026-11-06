/* eslint-env node */
import express from 'express';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import compression from 'compression';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4173;
const DIST_DIR = join(__dirname, 'dist');

// Enable compression
app.use(compression());

// ─── Security headers (single source of truth) ───
// Applied to every response so browsers enforce nosniff, frame protection,
// HSTS and a baseline CSP even before the SPA's own <meta> tags.
//
// The values live in security-headers.json because this file and vercel.json
// (which serves production) each used to carry a hand-maintained copy, and
// they had drifted: this one omitted every Razorpay checkout host
// (checkout-static-next, cdn, express, lumberjack, api-dark) from
// script/connect/frame-src and set `payment=()`. Anything served by this file
// would therefore have broken live checkout in the browser, silently.
// `src/test/securityHeadersParity.test.ts` fails if the two ever diverge again.
//
// Typography: Fontshare only (api.fontshare.com serves the CSS,
// cdn.fontshare.com serves the woff2). Both are loaded via <link> in
// pages/+Head.tsx, so they must stay in style-src/font-src. Supabase realtime
// uses wss://, hence the wss://*.supabase.co entry in connect-src.
const SECURITY_HEADERS = JSON.parse(
  fs.readFileSync(join(__dirname, 'security-headers.json'), 'utf8')
);
app.use((req, res, next) => {
  // HSTS is inert without TLS, so this is safe for plain-HTTP local dev.
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
});

// Serve static files from dist directory
app.use(express.static(DIST_DIR, {
  maxAge: '1d', // Cache static assets for 1 day
  etag: false,
  // Prerendered pages live at dist/<route>/index.html. Without this, express
  // 301s /pricing → /pricing/ before serving it, while the page's own
  // <link rel="canonical"> says /pricing — a needless hop and a canonical that
  // disagrees with the served URL. `redirect: false` serves the directory's
  // index.html directly at the canonical URL.
  redirect: false,
}));

// Health check endpoint
app.get('/_health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback: route all non-file requests to index.html
app.use((req, res) => {
  // Don't fallback for API routes or specific file types
  if (req.path.startsWith('/api/') || /\.\w+$/.test(req.path)) {
    return res.status(404).json({ error: 'Not found' });
  }

  // SPA routing — same semantics as Vercel's static-first fallback:
  // serve the PRERENDERED page for its URL (correct title/canonical/SSR
  // content), then fall back to index.html only for truly client-only
  // routes (dashboard, onboarding, dynamic public pages…).
  // NOTE: Vike prerenders to dist/client/<route>/index.html; dist/ mirrors
  // dist/client/ (see vercelOutputWorkaroundPlugin in vite.config.ts), so a
  // plain sendFile would path-traverse — always resolve via dist/client/.
  const safePath = path.posix.normalize(req.path).replace(/^([.][.][/\\])+/, '');
  const prerendered = join(DIST_DIR, 'client', safePath, 'index.html');
  if (
    !safePath.includes('..') &&
    safePath !== '/' &&
    fs.existsSync(prerendered) &&
    fs.statSync(prerendered).isFile()
  ) {
    return res.sendFile(prerendered, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  // Client-only route: serve the app shell (boot splash covers the
  // homepage-HTML flash; #root is cleared pre-hydration so React does a
  // clean client render — see BOOT_SPLASH_HTML in vite.config.ts).
  res.sendFile(join(DIST_DIR, 'index.html'), (err) => {
    if (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server running at http://0.0.0.0:${PORT}`);
  console.log(`✓ Serving SPA from ${DIST_DIR}`);
  console.log(`✓ SPA routing enabled - all routes fallback to index.html`);
});
