import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Soft-404 guard (2026-11-08).
//
// Measured on production before this change: GET /this-route-does-not-exist
// returned **200**, because public/_redirects carried `/* /index.html 200` and
// Vercel applies that before vercel.json. Every unknown URL looked like a real
// page, so search engines could index an infinite supply of them.
//
// The fix is an enumerated allowlist: only segments the router actually owns
// fall through to the SPA; everything else reaches dist/404.html with a 404
// status. That stays true only while three copies agree — the router (App.tsx),
// the hosting config (vercel.json) and the segment list
// (spa-route-segments.json). This test is the thing that keeps them honest.
//
// Why a real tokenizer: a child `<Route path="wallet">` under `/dashboard`
// resolves to /dashboard/wallet, so its FIRST URL segment is `dashboard`.
// Counting `wallet` as a routable root would both lie about the URL space and
// make a plain /wallet request look legitimate. The scan below therefore
// composes each nested route with its parent path and takes the first segment of
// the URL the router would actually serve.

const ROOT = resolve(__dirname, '../..');
const APP = readFileSync(resolve(ROOT, 'src/app/App.tsx'), 'utf8');
const SEGMENTS_FILE = JSON.parse(readFileSync(resolve(ROOT, 'spa-route-segments.json'), 'utf8')) as {
  segments: string[];
};
const VERCEL = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) as {
  rewrites?: { source: string; destination: string }[];
};
const BUILD = readFileSync(resolve(ROOT, 'scripts/build.mjs'), 'utf8');
const SERVER = readFileSync(resolve(ROOT, 'server.js'), 'utf8');

type RouteTag = { kind: 'open' | 'self' | 'close'; path: string | null };

/**
 * Finds `<Route …>`, `<Route … />` and `</Route>` in order.
 *
 * The end of an opening tag is the first `>` at brace depth 0 outside a string —
 * naive `[^>]*` regexes break on `element={<Navigate to="…" replace />}`, which
 * is exactly how the first version of this test mis-parsed the tree.
 */
function tokenizeRoutes(src: string): RouteTag[] {
  const tags: RouteTag[] = [];
  let i = 0;

  while (i < src.length) {
    const openIdx = src.indexOf('<Route', i);
    const closeIdx = src.indexOf('</Route>', i);
    if (openIdx === -1 && closeIdx === -1) break;

    if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
      tags.push({ kind: 'close', path: null });
      i = closeIdx + '</Route>'.length;
      continue;
    }

    let j = openIdx + '<Route'.length;
    let brace = 0;
    let quote: string | null = null;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === '\\') {
          j += 1;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{') brace += 1;
      else if (ch === '}') brace -= 1;
      else if (ch === '>' && brace <= 0) break;
    }

    const text = src.slice(openIdx, j + 1);
    const pathMatch = text.match(/\bpath="([^"]*)"/);
    tags.push({
      kind: /\/\s*>$/.test(text) ? 'self' : 'open',
      path: pathMatch ? pathMatch[1] : null,
    });
    i = j + 1;
  }

  return tags;
}

function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function firstSegment(path: string): string | null {
  const first = normalize(path).split('/')[0];
  if (!first || first === '*' || first.startsWith(':')) return null;
  return first;
}

/** Every first URL segment the router can serve, nesting-aware. */
function routerSegments(): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [];

  for (const tag of tokenizeRoutes(APP)) {
    if (tag.kind === 'close') {
      stack.pop();
      continue;
    }

    const parent = stack[stack.length - 1] ?? '';
    const own = tag.path ?? '';

    if (own) {
      const resolved = own.startsWith('/')
        ? normalize(own)
        : normalize([parent, own].filter(Boolean).join('/'));
      const seg = firstSegment(resolved);
      if (seg) out.add(seg);
      if (tag.kind === 'open') stack.push(resolved);
    } else if (tag.kind === 'open') {
      stack.push(parent);
    }
  }

  return out;
}

/** The alternation inside vercel.json's `/:route(a|b|c)` rewrite sources. */
function vercelSegments(): Set<string> {
  const out = new Set<string>();
  for (const rule of VERCEL.rewrites || []) {
    const m = rule.source.match(/\/:route\(([^)]+)\)/);
    if (!m) continue;
    for (const seg of m[1].split('|')) out.add(seg.trim());
  }
  return out;
}

describe('soft-404: unknown paths must answer a real 404', () => {
  it('no blanket SPA rewrite exists anywhere', () => {
    expect(VERCEL.rewrites?.length ?? 0).toBeGreaterThan(0);
    for (const rule of VERCEL.rewrites || []) {
      expect(['/(.*)', '/:path*', '/*']).not.toContain(rule.source);
    }
    // public/_redirects is applied before vercel.json on Vercel; a blanket rule
    // there would silently restore the soft-404 for the whole site.
    const redirects = resolve(ROOT, 'public/_redirects');
    if (existsSync(redirects)) {
      expect(readFileSync(redirects, 'utf8')).not.toMatch(/^\s*\/\*\s+\S+\s+200\s*$/m);
    }
  });

  it('every router segment is allowed through to the SPA', () => {
    const allowed = vercelSegments();
    const missing = [...routerSegments()].filter((seg) => !allowed.has(seg));
    expect(
      missing,
      `route(s) in App.tsx missing from vercel.json rewrites: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('spa-route-segments.json matches the router and the hosting config', () => {
    const declared = new Set(SEGMENTS_FILE.segments);
    const fromRouter = routerSegments();
    const fromVercel = vercelSegments();

    expect(
      [...fromRouter].filter((s) => !declared.has(s)),
      'router segments missing from spa-route-segments.json'
    ).toEqual([]);
    expect([...declared].filter((s) => !fromVercel.has(s))).toEqual([]);
    expect([...fromVercel].filter((s) => !declared.has(s))).toEqual([]);
  });

  it('the build writes a 404 shell instead of deleting it', () => {
    expect(BUILD).toContain("const FALLBACK_404 = resolve(DIST, '404.html')");
    expect(BUILD).toContain('writeFileSync(FALLBACK_404');
    expect(BUILD).not.toContain('unlinkSync(FALLBACK_404');
    expect(BUILD).toContain('blanket rule');
  });

  it('the local production server answers 404 for unknown segments', () => {
    expect(SERVER).toContain('SPA_ROUTE_SEGMENTS');
    expect(SERVER).toContain('res.status(404)');
    expect(SERVER).toContain("join(DIST_DIR, '404.html')");
  });
});
