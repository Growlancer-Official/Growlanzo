/**
 * The sitemap must agree with the page metadata.
 *
 * A sitemap entry for a page that sends `noindex`, or for a URL whose canonical
 * points somewhere else, tells crawlers two different things at once — the page
 * either gets dropped or the alias competes with its primary. Measured before
 * this guard: `/report` (noindex) and `/internships` (canonicalised to
 * `/careers`) were both listed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PRERENDER_URLS } from '../../pages/prerenderUrls';
import { canonicalUrl, resolveMeta } from '../lib/routeMeta';

const SITE = 'https://growlanzo.com';
const sitemap = readFileSync(join(process.cwd(), 'public/sitemap.xml'), 'utf8');
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim())
  .map((url) => (url.startsWith(SITE) ? url.slice(SITE.length) || '/' : url));

describe('sitemap', () => {
  it('lists at least the core marketing pages', () => {
    expect(listed.length).toBeGreaterThan(15);
    for (const required of ['/', '/pricing', '/about', '/terms', '/privacy']) {
      expect(listed, `${required} must be in the sitemap`).toContain(required);
    }
  });

  it('only lists pages that are meant to be indexed', () => {
    for (const url of listed) {
      expect(URL.canParse(`${SITE}${url}`), `${url} is not a path`).toBe(true);
      const meta = resolveMeta(url);
      expect(meta.noindex, `${url} is noindex but is submitted in the sitemap`).not.toBe(true);
    }
  });

  it('only lists canonical URLs, never an alias', () => {
    for (const url of listed) {
      expect(canonicalUrl(url), `${url} canonicalises elsewhere and must not be submitted in the sitemap`).toBe(
        `${SITE}${url}`
      );
    }
  });

  it('only lists pages that are actually prerendered', () => {
    const prerendered = new Set<string>(PUBLIC_PRERENDER_URLS);
    for (const url of listed) {
      expect(prerendered.has(url), `${url} is in the sitemap but not in PUBLIC_PRERENDER_URLS`).toBe(true);
    }
  });

  it('does not list the same URL twice', () => {
    expect(new Set(listed).size).toBe(listed.length);
  });
});
