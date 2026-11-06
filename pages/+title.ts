import type { PageContext } from 'vike/types';
import { resolveMeta } from '../src/lib/routeMeta';

/**
 * Per-URL <title> for the prerendered HTML.
 *
 * This app is a single Vike page (catch-all → react-router), so Vike only ever
 * sees the requested URL. Resolving it through the same rule table the client
 * uses (`src/lib/routeMeta.ts`) is what makes `/pricing` ship "Pricing ·
 * Growlanzo" instead of the homepage title in its static HTML.
 *
 * Before this, the title lived as a constant in `pages/+config.ts`, so all 33
 * prerendered pages carried the homepage title and
 * `canonical="https://growlanzo.com/"`.
 */
export function title(pageContext: PageContext): string {
  return resolveMeta(pageContext.urlPathname).title;
}
