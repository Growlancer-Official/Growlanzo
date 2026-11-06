import type { PageContext } from 'vike/types';
import { resolveMeta } from '../src/lib/routeMeta';

/** Per-URL <meta name="description"> for the prerendered HTML. See +title.ts. */
export function description(pageContext: PageContext): string {
  return resolveMeta(pageContext.urlPathname).description;
}
