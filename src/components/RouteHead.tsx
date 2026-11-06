import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SITE_NAME, resolveMeta, canonicalUrl } from '../lib/routeMeta';

/**
 * RouteHead — applies per-route document head metadata during client-side
 * navigation (MR-43 / SEO-002).
 *
 * The app uses a single Vike catch-all (`pages/@path/+route.ts` → `/*`) that
 * delegates routing to react-router-dom inside `src/app/App.tsx`, so Vike never
 * sees an in-app navigation. `pages/+Head.tsx` handles the first load (and
 * prerendering); this component keeps the head correct for every route change
 * after that.
 *
 * The rules themselves live in `src/lib/routeMeta.ts` — shared with +Head so
 * the static and client metadata cannot drift.
 */
function upsertMetaByName(name: string, content: string): void {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute('name', name);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content);
}

function upsertMetaByProperty(property: string, content: string): void {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute('property', property);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content);
}

function upsertCanonical(href: string): void {
    let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', 'canonical');
        document.head.appendChild(el);
    }
    el.setAttribute('href', href);
}

export function RouteHead() {
    const { pathname } = useLocation();

    useEffect(() => {
        if (typeof document === 'undefined') return;

        const meta = resolveMeta(pathname);
        const canonical = canonicalUrl(pathname);

        document.title = meta.title;

        upsertMetaByName('description', meta.description);
        upsertMetaByName('robots', meta.noindex ? 'noindex, nofollow' : 'index, follow');

        // Open Graph
        upsertMetaByProperty('og:title', meta.title);
        upsertMetaByProperty('og:description', meta.description);
        upsertMetaByProperty('og:url', canonical);
        upsertMetaByProperty('og:site_name', SITE_NAME);

        // Twitter
        upsertMetaByName('twitter:title', meta.title);
        upsertMetaByName('twitter:description', meta.description);
        upsertMetaByName('twitter:url', canonical);

        upsertCanonical(canonical);
    }, [pathname]);

    return null;
}

export default RouteHead;

export { resolveMeta, DEFAULT_TITLE } from '../lib/routeMeta';
