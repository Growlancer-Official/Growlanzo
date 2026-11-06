import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locks the "shell and its assets must always agree" boundary.
 *
 * Measured 2026-10-29 on the production alias: the deployed index.html named
 * assets/entries/entry-client-routing.B5qlYO1d.js and 26 chunks that all
 * answered with text/html (the SPA rewrite) because the build host restored a
 * cached dist/ — so yesterday's index.html shipped next to today's assets.
 * Browsers reject an HTML response for a module import, the lazy route's import
 * never settles, and every affected section sits on its skeleton forever. That
 * is the "sections load infinitely" report.
 *
 * Three files keep that from recurring, and each is asserted here:
 *   • scripts/build.mjs     — wipes dist/ before building, and FAILS the build
 *                             when the emitted HTML references a missing file.
 *   • public/sw.js          — never stores the HTML fallback under an asset URL
 *                             (v1 did, which made the breakage permanent).
 *   • pages/+client.ts      — reloads once when a chunk import fails, instead of
 *                             leaving the user on a skeleton.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('build output is self-consistent', () => {
  const build = read('scripts/build.mjs');

  it('wipes dist/ before the build so a restored cache cannot ship a stale index.html', () => {
    // ⚠️ Must be Vike's CLI, not Vite's. Under Vite 8 `vite build` exits 0 but
    // never fires Vike's prerender hook, so the site silently ships the SPA
    // shell on every route (measured: 1 HTML file for 31 URLs, every page
    // carrying the homepage <title>). This assertion is what caught the
    // regression when the build script was switched back.
    const viteIndex = build.indexOf("execSync('npx vike build'");
    expect(viteIndex, 'build script must run `vike build` (prerender does not run under `vite build`)').toBeGreaterThan(-1);
    expect(build.indexOf("execSync('npx vite build'"), 'build script regressed to `vite build`, which silently skips prerender').toBe(-1);
    const wipe = build.indexOf('rmSync(DIST, { recursive: true, force: true })');
    expect(wipe, 'build no longer wipes dist/ — a cached index.html will outlive its assets').toBeGreaterThan(-1);
    expect(wipe, 'dist/ must be wiped BEFORE vite build').toBeLessThan(viteIndex);
  });

  it('keeps SKIP_VITE_BUILD=1 able to reuse dist/client as a fixture', () => {
    // The wipe must live inside the real-build branch. The fixture-reusing test
    // mode copies dist/client and would otherwise delete the tree it depends on.
    const branchStart = build.indexOf('if (process.env.SKIP_VITE_BUILD');
    const buildBranch = build.indexOf('} else {', branchStart);
    const wipe = build.indexOf('rmSync(DIST', branchStart);
    expect(branchStart, 'the SKIP_VITE_BUILD branch disappeared').toBeGreaterThan(-1);
    expect(buildBranch, 'the real-build branch disappeared').toBeGreaterThan(branchStart);
    expect(wipe, 'dist/ is wiped in the fixture path — SKIP_VITE_BUILD=1 would lose dist/client').toBeGreaterThan(
      buildBranch,
    );
  });

  it('fails the build when the HTML references an asset it did not emit', () => {
    expect(build).toContain('assertReferencedAssetsExist');
    expect(build).toMatch(/asset\(s\) are referenced by the built HTML but missing/);
    // It must run after the fallback shell exists, or that path escapes the check.
    const assertionCall = build.indexOf('\nassertReferencedAssetsExist();');
    const fallback = build.indexOf('generateFallbackIndexHtml();');
    expect(assertionCall, 'the asset-reference assertion is never called').toBeGreaterThan(-1);
    expect(fallback, 'fallback shell generator disappeared').toBeGreaterThan(-1);
    expect(assertionCall, 'assertion must run after the fallback shell is generated').toBeGreaterThan(fallback);
  });

  it('only emits fallback-shell tags for files that exist', () => {
    expect(build).toMatch(/const uniqueScripts = \[\.\.\.new Set\(scriptImports\)\]\.filter\(shipped\)/);
    expect(build).toMatch(/const uniqueCss = \[\.\.\.new Set\(cssHrefs\)\]\.filter\(shipped\)/);
  });
});

describe('service worker cannot poison assets', () => {
  const sw = read('public/sw.js');

  it('refuses to store HTML under a script/stylesheet URL', () => {
    expect(sw).toContain('isCacheableAsset');
    expect(sw).toMatch(/if \(\/\\\/\(assets\|_next\)/);
    expect(sw).toMatch(/return !contentType\.includes\('text\/html'\)/);
  });

  it('drops an already-poisoned cached entry instead of serving it', () => {
    // Serving a cached HTML body for a .js URL is what made the failure survive
    // reloads and deploys; the cache-first path must evict it.
    expect(sw).toMatch(/if \(cached && isCacheableAsset\(request, cached\)\)/);
    expect(sw).toMatch(/await cache\.delete\(request\)/);
  });

  it('uses a cache name newer than the poisoned v1', () => {
    const name = sw.match(/const CACHE_NAME = '([^']+)'/)?.[1];
    expect(name).toBeDefined();
    expect(name).not.toBe('growlanzo-v1');
    expect(name).toBe('growlanzo-v2');
  });

  it('never caches a non-200 or redirected response', () => {
    expect(sw).toMatch(/response\.status !== 200\) return false/);
    expect(sw).toMatch(/if \(response\.redirected\) return false/);
  });
});

describe('client recovers from a failed chunk import', () => {
  const client = read('pages/+client.ts');

  it('reloads once on vite:preloadError instead of hanging on a skeleton', () => {
    expect(client).toContain("'vite:preloadError'");
    expect(client).toMatch(/sessionStorage\.setItem\(RELOAD_AT_KEY/);
    // Bounded: a genuinely broken build must not become a reload loop.
    expect(client).toMatch(/if \(Date\.now\(\) - last < ONE_MINUTE\) return false/);
  });

  it('also catches the browser-level dynamic-import rejection', () => {
    expect(client).toContain("'unhandledrejection'");
    expect(client).toMatch(/failed to fetch dynamically imported module/);
  });

  it('registers deferred startup even when the load event already fired', () => {
    // Prerendered pages hydrate after `load`; a plain 'load' listener then never runs.
    expect(client).toContain('document.readyState');
    expect(client).toContain('onWindowLoad');
    expect(client, 'SW registration went back to a bare load listener').not.toMatch(
      /window\.addEventListener\('load', \(\) => \{\s*navigator\.serviceWorker\.register/,
    );
  });
});
