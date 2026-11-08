import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for a bug found in the live browser audit:
 *
 * `useCategories` used to substitute the hardcoded `FALLBACK_CATEGORIES` list on
 * ANY query error with only a `console.warn`. With a placeholder anon key in
 * `.env`, every request returned 401 and the homepage still rendered "145 live
 * categories" plus an invented catalogue — a backend outage looked like a
 * populated marketplace. A second `useCategories()` instance on the same page
 * reported 0, so the page also showed "Show All Categories (145)" beside
 * "Explore all 0 categories".
 *
 * These assertions read the source as text so the fallback cannot be quietly
 * reintroduced.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

// Strip comments first: the explanatory comment in useCategories.ts names the
// old fallback on purpose, and a raw match would assert on prose instead of code.
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\/[^\n]*$/gm, '');

const HOOK = code(read('src/hooks/useCategories.ts'));
const HOME = code(read('src/pages/HomePage.tsx'));

describe('categories: no invented inventory when the API fails', () => {
  it('never substitutes the static category list for live data', () => {
    expect(HOOK, 'useCategories must not fall back to FALLBACK_CATEGORIES').not.toMatch(
      /FALLBACK_CATEGORIES/
    );
    // The synthetic ids the fallback rows used (`fallback-${i}`).
    expect(HOOK, 'synthetic fallback rows must not come back').not.toMatch(/fallback-/);
  });

  it('surfaces the failure so the UI can offer a retry', () => {
    expect(HOOK, 'the query error must set error state').toMatch(
      /setError\(catsResult\.error\.message/
    );
    expect(HOOK, 'a failed query must clear the list rather than fill it').toMatch(
      /setCategories\(\[\]\)/
    );
  });

  it('does not advertise a category count while the data is unavailable', () => {
    expect(HOME, 'homepage must not print a live count on error').toMatch(
      /'Live category data is temporarily unavailable\.'/
    );
    expect(HOME, 'the explore link must not print a count until data is real').toMatch(
      /error \|\| loading \? 'Browse all categories'/
    );
  });
});
