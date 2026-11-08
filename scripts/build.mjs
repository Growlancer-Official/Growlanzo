#!/usr/bin/env node

/**
 * Build script for Growlanzo.
 *
 * 1. Runs Vite build (with Vike prerender + copy plugin)
 * 2. Deterministically copies dist/client/ → dist/
 * 3. Validates that the critical output files exist
 * 4. Generates a fallback SPA shell if prerender was skipped
 * 5. Removes any 404.html from dist/ that could override SPA fallback
 *
 * Vercel SPA Routing Strategy (VERIFIED):
 * ─────────────────────────────────────────
 * - vercel.json        →  `rewrites` enumerating ONLY the SPA route segments
 *                         (admin|dashboard|client|freelancers|… — the same list
 *                         as spa-route-segments.json, derived from App.tsx)
 * - build.mjs          →  Generates dist/404.html from the SPA shell
 * - public/_redirects  →  REMOVED. Its `/* /index.html 200` blanket rule made
 *                         every unknown URL answer 200, which is a soft-404:
 *                         search engines index an endless supply of real-looking
 *                         pages and a typo'd URL never says "not found".
 *
 * Why enumerated (measured 2026-11-08): `https://growlanzo.com/this-route-does-
 * not-exist` returned **200** because the blanket rewrite caught it before the
 * static 404 handler. With the allowlist, a known segment still gets the SPA
 * (index.html, 200) and anything else falls through to dist/404.html, which
 * Vercel serves with a real 404 status — while the app still renders its own
 * NotFound page inside that shell.
 *
 * src/test/soft404Routing.test.ts is the guard: it re-derives the segments from
 * src/app/App.tsx and fails if a route is added without updating the list, or if
 * a blanket rewrite is ever reintroduced here or in vercel.json.
 *
 * Why the fallback shell exists:
 * Vercel's git-triggered builds occasionally skip Vike's prerender step, so
 * dist/client/ contains the assets but NO index.html. The deterministic copy
 * in step 2 then has nothing to copy and the deploy fails with
 * "Missing dist/index.html". The fallback generator reads the Vite manifest
 * and emits a minimal SPA shell (root div + client entry imports) so
 * dist/index.html ALWAYS exists and the app boots via client-side rendering.
 */

import { execSync } from 'node:child_process';
import {
  existsSync,
  unlinkSync,
  rmSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DIST_CLIENT = resolve(DIST, 'client');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function ok(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg) {
  console.error(`${RED}✗${RESET} ${msg}`);
  process.exit(1);
}

const start = Date.now();

/**
 * Theme FOUC guard, byte-identical to THEME_FOUC_GUARD in vite.config.ts
 * (src/test/darkThemeCoverage.test.ts fails if the two ever differ).
 *
 * The Vite plugin injects it into every HTML Vike prerenders; this generator
 * writes its own shell from scratch, so it needs its own copy of the same
 * markup — otherwise the shell served by the SPA fallback (i.e. every
 * dashboard/client/admin route, when a Vercel build skips prerender) would
 * paint the light theme before React applies the user's preference.
 *
 * DECLARED HERE, before step 3b: `generateFallbackIndexHtml()` is a hoisted
 * function, so it can be CALLED above this line while a `const` at module
 * scope is still in its temporal dead zone. Measured 2026-10-16 in CI run
 * 38864451859 (a clean checkout, where Vike's prerender is skipped and the
 * fallback path therefore actually runs):
 *   `Could not generate fallback index.html: Cannot access 'THEME_FOUC_GUARD'
 *    before initialization` — the fallback died instead of producing the
 *    dist/index.html Vercel's SPA rewrites require.
 */
const THEME_FOUC_GUARD = `<!-- __theme_guard_marker__ -->
<script>
  (function () {
    var root = document.documentElement;
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    try {
      localStorage.removeItem('growlancer-theme');
    } catch (e) {
      // Storage blocked (private mode) — nothing to clean up.
    }
  })();
</script>`;

// ── Step 0: start from an EMPTY dist/ ──────────────────────────
// Vite empties its own outDir (dist/client) but not the files sitting at the
// dist ROOT — `dist/index.html` is written there by Vike's prerender (or by the
// fallback shell below). On a build host that restores a cached workspace
// (Vercel does), yesterday's index.html survives and is deployed NEXT TO
// today's assets. Every chunk it names carries a hash this build never emitted,
// the SPA rewrite answers those requests with index.html, the browser refuses
// the module because of its text/html MIME type, and every lazy route stays on
// its skeleton forever.
//
// Measured 2026-10-29 on the production alias: its own index.html referenced
// assets/entries/entry-client-routing.B5qlYO1d.js plus 26 chunks that all
// returned text/html (the Vercel build log for that deployment says "Vike
// prerender did not run — dist/client/index.html missing", so the shell it
// shipped was the cached stale one). A clean build cannot reproduce it.
// Wiping dist/ here makes the output self-consistent no matter what the host
// restored: prerender either writes a fresh index.html or the fallback shell
// is generated from the fresh manifest.
// ── Step 1: Vite build ─────────────────────────────────────────
console.log(`\n${YELLOW}[1/5]${RESET} Running vite build...`);
if (process.env.SKIP_VITE_BUILD === '1') {
  // Test/debug mode: reuse the existing dist/client/ output so the
  // fallback shell generator can be exercised in isolation — so nothing is
  // wiped here.
  warn('SKIP_VITE_BUILD=1 — skipping vite build (fallback shell test mode)');
} else {
  try {
    // Wipe first so no artifact from a restored build cache can outlive the
    // assets this build emits (see the Step 0 note above).
    rmSync(DIST, { recursive: true, force: true });
    ok('wiped any restored dist/ so no stale index.html can outlive its assets');
    // ⚠️ `vike build`, not `vite build`. Under Vite 8 the Vite CLI's build no
    // longer fires Vike's prerender hook: it exits 0, prints "built in 647ms",
    // and writes zero HTML — so the site silently fell back to the SPA shell on
    // every route (measured: 1 HTML file for 31 URLs, and every prerendered
    // <title> was the homepage's). Vike's own CLI prerenders all 33 pages
    // (66 files) with the same config and no extra flags. If this ever regresses,
    // step [3/5] now fails the build instead of warning.
    execSync('npx vike build', { cwd: ROOT, stdio: 'inherit' });
    ok('Vite build completed');
  } catch (err) {
    fail(`Vite build failed: ${err.message}`);
  }
}

// ── Step 2: Copy Vike client output → dist/ (DETERMINISTIC) ──
// Vike (SSR/prerender) outputs the client build to dist/client/, but Vercel's
// Vite framework preset expects index.html at dist/ for its SPA rewrites.
//
// The vite.config.ts 'vercel-output-workaround' plugin copies via the
// closeBundle hook — but Vercel's new build system (Vite CLI 58.x + builtin
// plugins) can change hook timing so the copy never runs, which made every
// git-triggered deploy fail with "Missing dist/index.html".
//
// Fix: perform the copy here, deterministically, with a plain Node fs
// recursive copy — guaranteed to run in EVERY environment (local, Vercel git,
// Vercel CLI). Always use the manual copy (NOT fs.cpSync): copying a directory
// into its own parent can throw ERR_FS_CP_* on some Node versions.
console.log(`\n${YELLOW}[2/5]${RESET} Copying dist/client/ → dist/ (deterministic)...`);
if (existsSync(DIST_CLIENT)) {
  try {
    // ── Prune the mirrored tree before merging into it ──
    // The copy below MERGES into dist/, so a directory a PREVIOUS build
    // prerendered but this one no longer produces survives and keeps being
    // served. Measured 2026-10-13: after four dead auth prerender entries were
    // removed from pages/prerenderUrls.ts, `npm run build` still wrote
    // dist/auth/forgot-password/index.html containing a 404 page — a leftover,
    // not a regeneration — so the fix looked ineffective both locally and on
    // the repo's own server (`npm start` serves dist/). Mirror the fresh client
    // tree exactly: drop every top-level directory under dist/ and let the copy
    // recreate it in full. `client` is the copy SOURCE and must be skipped.
    const staleDirs = readdirSync(DIST, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'client')
      .map((e) => e.name);
    for (const name of staleDirs) {
      rmSync(join(DIST, name), { recursive: true, force: true });
    }
    if (staleDirs.length > 0) {
      ok(`pruned ${staleDirs.length} mirrored dir(s) so a removed page cannot linger`);
    }
    copyRecursiveSyncManual(DIST_CLIENT, DIST);
    ok('dist/client/ copied to dist/');
  } catch (copyErr) {
    fail(`Failed to copy dist/client to dist: ${copyErr.message}`);
  }
} else {
  warn('dist/client/ not found — nothing to copy');
}

/** Recursive copy of files from srcDir into destDir (files only, mirrors source structure). */
function copyRecursiveSyncManual(srcDir, destDir) {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyRecursiveSyncManual(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ── Step 3: Validate Vike client output ────────────────────────
console.log(`\n${YELLOW}[3/5]${RESET} Validating Vike client output...`);
const CLIENT_HTML = resolve(DIST_CLIENT, 'index.html');
if (!existsSync(CLIENT_HTML)) {
  warn(`Vike prerender did not run — dist/client/index.html missing.`);
} else {
  ok(`dist/client/index.html exists`);
}

// ── Step 3c: Assert the HTML only names files this build produced ──
// A build whose index.html points at an asset it did not emit still deploys
// "successfully" and then breaks in the browser (module MIME error → lazy route
// never mounts → infinite skeleton). Fails after BOTH HTML sources exist — the
// prerendered one and the fallback shell — so no path can ship a dangling tag.
function referencedAssets() {
  const refs = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // `client` is the copy source (validated by its own tree), and the
        // server build is never served to a browser.
        if (entry.name === 'client' || entry.name === 'server' || entry.name === '.vite') continue;
        walk(full);
      } else if (entry.name.endsWith('.html')) {
        const html = readFileSync(full, 'utf8');
        for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
          refs.add({ html: full.slice(DIST.length + 1), asset: match[1].slice(1) });
        }
      }
    }
  };
  walk(DIST);
  return [...refs];
}

// (function is hoisted; the assertion itself runs after step 3b)

function assertReferencedAssetsExist() {
  const refs = referencedAssets();
  const dangling = refs.filter(({ asset }) => !existsSync(resolve(DIST, asset)));
  if (dangling.length > 0) {
    fail(
      `${dangling.length} asset(s) are referenced by the built HTML but missing from dist/:\n` +
        dangling.slice(0, 10).map((d) => `    ${d.html} → ${d.asset}`).join('\n') +
        `\n  A deployed page that names a file it does not ship shows an empty screen or an\n` +
        `  endless skeleton (browsers reject text/html served for a module import).\n` +
        `  Usually a stale dist/index.html from a restored build cache: this script now\n` +
        `  wipes dist/ before building, so re-run the build and check the prerender step.`
    );
  }
  ok(`all ${refs.length} asset reference(s) in the built HTML exist on disk`);
}

// ── Step 3b: Fallback SPA shell (when prerender was skipped) ──
// If the copy above could not produce dist/index.html (prerender skipped on
// Vercel), generate a minimal SPA shell from the Vite manifest. The client
// entry scripts boot the app via client-side rendering, which is exactly what
// the SPA fallback (_redirects / vercel.json rewrites) serves for all routes.
const DIST_HTML = resolve(DIST, 'index.html');
if (!existsSync(DIST_HTML)) {
  warn(`dist/index.html missing after copy — generating fallback SPA shell...`);
  try {
    generateFallbackIndexHtml();
    ok(`Fallback dist/index.html generated (client-side rendering)`);
  } catch (fallbackErr) {
    fail(
      `Could not generate fallback index.html: ${fallbackErr.message}\n` +
        `  Vercel expects dist/index.html for its SPA rewrites.\n` +
        `  Check scripts/build.mjs step 3b (generateFallbackIndexHtml).`
    );
  }
}

assertReferencedAssetsExist();

// (THEME_FOUC_GUARD itself now lives near the top of this file — see the
//  declaration comment there for why it cannot be declared after step 3b.)

/**
 * Reads the Vite manifest to locate client entry JS + CSS files.
 * Tries dist/.vite/manifest.json first, then dist/client/.vite/manifest.json.
 */
function readManifest() {
  const candidates = [
    resolve(DIST, '.vite', 'manifest.json'),
    resolve(DIST_CLIENT, '.vite', 'manifest.json'),
  ];
  for (const manifestPath of candidates) {
    if (!existsSync(manifestPath)) continue;
    try {
      return JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      // corrupt manifest — try next candidate
    }
  }
  return null;
}

/**
 * Generates a minimal SPA shell at dist/index.html that boots the app
 * client-side. Uses the entry JS files (client routing + pages client) and
 * the CSS emitted by Vite's manifest, mirroring the structure Vike prerender
 * would produce. Falls back to scanning dist/client/assets/ if no manifest.
 */
function generateFallbackIndexHtml() {
  const manifest = readManifest();
  const scriptImports = [];
  const cssHrefs = [];

  if (manifest) {
    for (const key of Object.keys(manifest)) {
      const entry = manifest[key];
      if (!entry || typeof entry !== 'object') continue;
      // Collect CSS emitted for any entry (deduped below).
      if (Array.isArray(entry.css)) {
        for (const css of entry.css) {
          if (typeof css === 'string' && css.endsWith('.css')) cssHrefs.push(css);
        }
      }
      // Collect real entry JS files (skip virtual: keys which have no file).
      if (entry.isEntry && typeof entry.file === 'string' && !key.startsWith('virtual:')) {
        scriptImports.push(entry.file);
      }
    }
  }

  // Manifest missing/corrupt → scan the built assets directories directly.
  if (scriptImports.length === 0) {
    const entriesDir = resolve(DIST_CLIENT, 'assets', 'entries');
    if (existsSync(entriesDir)) {
      for (const f of readdirSync(entriesDir)) {
        if (f.endsWith('.js')) scriptImports.push(`assets/entries/${f}`);
      }
    }
  }
  if (cssHrefs.length === 0) {
    const staticDir = resolve(DIST_CLIENT, 'assets', 'static');
    if (existsSync(staticDir)) {
      for (const f of readdirSync(staticDir)) {
        if (f.endsWith('.css')) cssHrefs.push(`assets/static/${f}`);
      }
    }
  }

  // 🛡️ Guard: never write a blank shell (no scripts = blank page).
  // Dedupe first so the check reflects what will actually be emitted.
  const scriptSet = [...new Set(scriptImports)].filter((rel) =>
    existsSync(resolve(DIST_CLIENT, rel)) || existsSync(resolve(DIST, rel)),
  );
  if (scriptSet.length === 0) {
    fail(
      `Fallback generator found NO client entry scripts — would produce a blank page.\n` +
        `  Check that dist/client/assets/entries/ exists after vite build.`
    );
  }

  // Deterministic order: client-routing entry first, then pages client.
  scriptImports.sort((a, b) => {
    const aIsRouter = a.includes('entry-client-routing') ? 0 : 1;
    const bIsRouter = b.includes('entry-client-routing') ? 0 : 1;
    return aIsRouter - bIsRouter;
  });
  // Only emit references that will actually exist in the deployed output. A
  // manifest can name a prerender-only entry that the client build did not
  // emit; shipping the tag regardless is exactly how a boot shell ends up
  // importing a 404.
  const shipped = (rel) =>
    existsSync(resolve(DIST_CLIENT, rel)) || existsSync(resolve(DIST, rel));
  const uniqueCss = [...new Set(cssHrefs)].filter(shipped);
  const uniqueScripts = [...new Set(scriptImports)].filter(shipped);

  const cssTags = uniqueCss
    .map((css) => `  <link rel="stylesheet" type="text/css" href="/${css}">`)
    .join('\n');
  const importStmts = uniqueScripts.map((js) => `    import("/${js}");`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Growlanzo — AI-Powered Freelancing Marketplace</title>
    <meta name="description" content="Growlanzo is the AI-powered freelancing marketplace. Hire top freelancers or get hired for high-quality work.">
    <link rel="icon" href="/UpdatedLogo.webp?v=7" type="image/webp">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=7" type="image/png">
    <meta name="theme-color" content="#24ba35">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Growlanzo — AI-Powered Freelancing Marketplace">
    <meta property="og:description" content="Hire top freelancers or get hired for high-quality work with Growlanzo.">
    <meta name="twitter:card" content="summary_large_image">
    <!-- Design fonts (Cabinet Grotesk + Satoshi) — must stay identical to
         pages/+Head.tsx and index.html, or fallback-shell routes (served when the
         Vike prerender is skipped) would load different fonts than prerendered
         pages. src/test/typographyFonts.test.ts fails on any drift.
         Two requests, one per family: a combined fontshare URL returns HTTP 200
         but silently serves only one of the two families. CSP (server.js +
         vercel.json) allows api.fontshare.com and cdn.fontshare.com. -->
    <link rel="preconnect" href="https://api.fontshare.com" crossorigin>
    <link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
    <!-- Plain stylesheet links: pages/+Head.tsx renders through React, which does
         not serialise event handlers, so a media=print + onload pair shipped as
         print-only CSS and the fonts never applied on prerendered pages. Keep
         these identical in kind (no media trick) so both serving paths behave. -->
    <link rel="preload" as="style" href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&display=swap">
    <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&display=swap">
    <link rel="preload" as="style" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap">
    <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap">
    <noscript>
      <link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800,900&display=swap" rel="stylesheet">
      <link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet">
    </noscript>
${cssTags}
${THEME_FOUC_GUARD}
    <style>
      /* Dark theme boot splash — mirrors vite.config.ts's #boot-overlay so the
         SPA fallback shell (served when Vike prerender is skipped) does not flash
         the light cream theme before React applies the user's preference. */
      html.dark #boot-overlay {
        background: #070b14;
      }
      html.dark #boot-overlay .boot-spinner {
        border-color: #123b20;
        border-top-color: #24ba35;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <!-- Vike REQUIRES BOTH #vike_pageContext AND #vike_globalContext in the HTML.
         Vike's client router UNCONDITIONALLY reads #vike_pageContext on first render
         (renderPageClient -> getPageContextFromHooksServer_firstRender). Without it the
         boot crashes with "Couldn't find #vike_pageContext" (white screen) — this is the
         root cause of the white screen when the fallback shell is served.
         pageId is always "/pages/@path" because the app is a single catch-all route
         (pages/@path/+route.ts = '/*') that renders <App /> (react-router). The routeParams
         value is therefore irrelevant for routing — this matches exactly what Vike's
         prerender emits for the "/" URL. {} for globalContext = client-side only boot. -->
    <script id="vike_pageContext" type="application/json">{"pageId":"/pages/@path","routeParams":{"*":""}}</script>
    <script id="vike_globalContext" type="application/json">{}</script>
    <script type="module" async>
${importStmts}
    </script>
  </body>
</html>
`;

  writeFileSync(DIST_HTML, html);
  // Also write into dist/client/ so both trees stay in sync.
  mkdirSync(DIST_CLIENT, { recursive: true });
  writeFileSync(resolve(DIST_CLIENT, 'index.html'), html);
}

// ── Step 4: Validate copied output ─────────────────────────────
console.log(`\n${YELLOW}[4/5]${RESET} Validating dist/ output...`);
if (!existsSync(DIST_HTML)) {
  fail(
    `Missing dist/index.html — neither the deterministic copy step nor the\n` +
      `  fallback generator produced it. Check scripts/build.mjs steps 2 & 3b.`
  );
}
ok(`dist/index.html exists`);

// ── Step 4b: White-screen regression guard (NEVER deploy a broken shell) ──
// Vike's client router UNCONDITIONALLY reads #vike_pageContext (and also
// #vike_globalContext) from the served HTML on first render. If either element
// is missing, the boot crashes with "Couldn't find #vike_..." → white screen.
// This guard HARD-FAILS the build so a broken shell can never be deployed
// silently again: the deploy fails loudly instead of shipping a white screen.
// (Valid for BOTH the prerendered HTML and the fallback SPA shell.)
{
  const html = readFileSync(DIST_HTML, 'utf8');
  const CRITICAL_ELEMENTS = [
    ['#root mount', 'id="root"'],
    ['#vike_pageContext', 'id="vike_pageContext"'],
    ['#vike_globalContext', 'id="vike_globalContext"'],
  ];
  for (const [label, marker] of CRITICAL_ELEMENTS) {
    if (!html.includes(marker)) {
      fail(
        `CRITICAL: dist/index.html is missing the ${label} element (${marker}).\n` +
          `  Vike's client router would crash on first render (white screen).\n` +
          `  Fix scripts/build.mjs step 3b (generateFallbackIndexHtml) or the\n` +
          `  prerender output — this build must NOT be deployed.`
      );
    }
  }
  ok('index.html contains #root + both Vike context elements (white-screen guard ✓)');
}

// ── Step 5: Generate dist/404.html (a REAL 404 status for unknown paths) ──
// Unknown URLs must answer 404, but they must still land on the app's own
// NotFound screen instead of a bare server page. Copying the SPA shell gives
// both: the hosting platform sends the file with a 404 status, and the app boots
// and renders <NotFoundPage /> for the unmatched path. `noindex` keeps search
// engines from treating the shell as a real page.
console.log(`\n${YELLOW}[5/5]${RESET} Generating 404 shell...`);
const FALLBACK_404 = resolve(DIST, '404.html');
{
  const shell = readFileSync(DIST_HTML, 'utf8');
  const noindex = '<meta name="robots" content="noindex, nofollow">';
  const withNoindex = shell.includes('<head>')
    ? shell.replace('<head>', `<head>\n    ${noindex}`)
    : `${noindex}\n${shell}`;
  writeFileSync(FALLBACK_404, withNoindex);
  ok('dist/404.html written from the SPA shell (real 404 + in-app not-found page)');
}

// ── Step 5b: Refuse to ship a blanket SPA rewrite ──────────────
// The soft-404 regression was a `/* → /index.html 200` catch-all. If either
// place ever regains one, every unknown URL answers 200 again — so fail the
// build instead of silently undoing this fix.
{
  const vercel = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'));
  const blanket = (vercel.rewrites || []).find((r) => {
    const src = String(r.source || '');
    return src === '/(.*)' || src === '/:path*' || src === '/*';
  });
  if (blanket) {
    fail(
      `vercel.json rewrites contains a blanket rule (${blanket.source} → ${blanket.destination}).\n` +
        `  That makes every unknown URL answer 200 (soft-404) and defeats dist/404.html.\n` +
        `  Enumerate the SPA route segments instead (see spa-route-segments.json).`
    );
  }
  ok('vercel.json has no blanket rewrite (unknown paths reach a real 404)');
}

// ── Check: no blanket _redirects in dist/ ──────────────────────
// public/_redirects used to carry `/* /index.html 200`, which Vercel applies
// BEFORE vercel.json and therefore turned every unknown URL into a 200. It is
// removed on purpose; a reappearing blanket rule would silently restore the
// soft-404 for the whole site.
const REDIRECTS_DIST = resolve(DIST, '_redirects');
if (existsSync(REDIRECTS_DIST)) {
  const body = readFileSync(REDIRECTS_DIST, 'utf8');
  if (/^\s*\/\*\s+\S+\s+200\s*$/m.test(body)) {
    fail(
      'dist/_redirects contains a blanket `/* … 200` rule.\n' +
        '  On Vercel this is applied before vercel.json, so every unknown URL would\n' +
        '  answer 200 again (soft-404) and dist/404.html would never be served.\n' +
        '  Delete public/_redirects — vercel.json owns SPA routing now.'
    );
  }
  warn('dist/_redirects present without a blanket rule — vercel.json still decides routing');
} else {
  ok('no _redirects in dist/ — vercel.json rewrites are the only SPA fallback');
}

// ── Summary ────────────────────────────────────────────────────
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n${GREEN}✓ Build complete in ${elapsed}s${RESET}`);
console.log(`  dist/index.html     ${existsSync(resolve(DIST, 'index.html')) ? GREEN + '✓' : RED + '✗'}${RESET}`);
console.log(`  dist/client/        ${existsSync(DIST_CLIENT) ? GREEN + '✓' : RED + '✗'}${RESET}`);
console.log(`  dist/404.html       ${existsSync(FALLBACK_404) ? GREEN + '✓ (real 404 status)' : RED + '✗ MISSING'}${RESET}`);
console.log(`  dist/_redirects     ${existsSync(REDIRECTS_DIST) ? YELLOW + '⚠ present' : GREEN + '✓ none (good)'}${RESET}`);
