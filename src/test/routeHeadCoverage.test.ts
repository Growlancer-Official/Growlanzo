/**
 * Per-page metadata must exist AND be mounted.
 *
 * `RouteHead` (title, description, canonical, OG/Twitter tags) was written, kept
 * correct and never rendered: no `<RouteHead />` anywhere in the app, so every
 * page shipped the homepage `<title>` and no canonical link. Measured before the
 * fix: 19 rendered public routes, 1 distinct title, 0 canonical tags.
 *
 * The mount check below is the important one. A coverage test alone would have
 * passed the whole time the component was dead.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLE, resolveMeta } from '../components/RouteHead';
import { PUBLIC_PRERENDER_URLS } from '../../pages/prerenderUrls';

/** The fallback for an unknown path. Landing on it in the index is a soft 404. */
const NOT_FOUND_TITLE = 'Page Not Found · Growlanzo';

/**
 * Public URLs that are deliberately kept out of search results: forms that
 * produce no content, one-time auth links, payment outcome screens, and the
 * not-found page itself.
 */
const EXPECTED_NOINDEX = new Set<string>([
  '/report',
  '/unsubscribe',
  '/not-found',
  '/auth/email-confirm',
  '/auth/verify-email',
  '/payment/success',
  '/payment/cancel',
]);

describe('per-page metadata', () => {
  it('is mounted by the app router', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*\bRouteHead\b[^}]*\}\s*from\s*'\.\.\/components\/RouteHead'/);
    expect(src).toMatch(/<RouteHead\s*\/>/);
  });

  it('gives every prerendered public URL its own title and description', () => {
    for (const url of PUBLIC_PRERENDER_URLS) {
      const meta = resolveMeta(url);
      expect(meta.title, `${url} has no title`).toBeTruthy();
      // `/not-found` is the one URL allowed to carry the not-found metadata.
      if (url !== '/not-found') {
        expect(meta.title, `${url} fell through to the not-found metadata`).not.toBe(NOT_FOUND_TITLE);
      }
      if (url !== '/') {
        expect(meta.title, `${url} still uses the generic site title`).not.toBe(DEFAULT_TITLE);
      }
      expect(meta.description.length, `${url} has no usable description`).toBeGreaterThan(20);
    }
  });

  it('keeps utility, auth and payment screens out of the index', () => {
    for (const url of PUBLIC_PRERENDER_URLS) {
      const meta = resolveMeta(url);
      if (EXPECTED_NOINDEX.has(url)) {
        expect(meta.noindex, `${url} must be noindex`).toBe(true);
      } else {
        expect(meta.noindex, `${url} must be indexable`).not.toBe(true);
      }
    }
  });

  it('marks an unknown path noindex instead of letting it be indexed', () => {
    const meta = resolveMeta('/this-route-does-not-exist');
    expect(meta.title).toBe(NOT_FOUND_TITLE);
    expect(meta.noindex).toBe(true);
  });

  it('treats a trailing slash as the same page', () => {
    expect(resolveMeta('/pricing/').title).toBe(resolveMeta('/pricing').title);
    expect(resolveMeta('/').title).toBe(DEFAULT_TITLE);
  });
});
