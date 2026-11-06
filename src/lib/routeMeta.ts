/**
 * Route metadata — the ONE place that decides a page's <title>, description and
 * indexing directive.
 *
 * Dependency-free on purpose (no React, no router, no DOM) so it can be used in
 * three environments from the same source:
 *   1. `pages/+Head.tsx`      — at build time, to prerender correct static
 *                                <title>/canonical/OG tags per URL.
 *   2. `src/components/RouteHead.tsx` — at runtime, so client-side navigation
 *                                inside this single-Vike-page SPA updates the head.
 *   3. tests                    — `src/test/routeHeadCoverage.test.ts`.
 *
 * Splitting the metadata out of the component was required: before this, only
 * the runtime component knew the rules, so every prerendered HTML file shipped
 * the homepage title and `canonical="https://growlanzo.com/"` — including
 * /pricing, /terms and /privacy.
 */

export const SITE_URL = 'https://growlanzo.com';
export const SITE_NAME = 'Growlanzo';
export const DEFAULT_TITLE = 'Growlanzo — AI-Powered Freelancing Marketplace';
export const DEFAULT_DESCRIPTION =
    'Growlanzo is an AI-powered freelancing marketplace connecting talented freelancers with innovative clients. Find work, hire talent, and collaborate seamlessly.';

export interface RouteMeta {
    title: string;
    description: string;
    /** Private/authenticated route → keep out of search indexes. */
    noindex?: boolean;
    /**
     * Two URLs that render the SAME screen (an alias) must point their canonical
     * at the one URL you want indexed, otherwise search engines see duplicate
     * pages competing with each other. Measured: `/certificate` and
     * `/verify-certificate` prerendered byte-identical heads, as did
     * `/internships` and `/careers`.
     */
    canonicalPath?: string;
}

interface RouteRule {
    test: (pathname: string) => boolean;
    meta: RouteMeta;
}

function isPath(prefix: string): (p: string) => boolean {
    return (p) => p === prefix || p.startsWith(prefix + '/');
}

function exact(path: string): (p: string) => boolean {
    return (p) => p === path;
}

/**
 * Match any of the given exact paths.
 *
 * ⚠️ Never write `exact('/a') || exact('/b')` as a rule's `test`: those are two
 * FUNCTION values, so `||` returns the first function and the second path is
 * never tested. Three rules were written that way, which left `/careers`,
 * `/verify-certificate` and `/auth/verify-email` falling through to the
 * not-found metadata (`noindex` on a public page). Found by
 * `src/test/routeHeadCoverage.test.ts`.
 */
function oneOf(...paths: string[]): (p: string) => boolean {
    return (p) => paths.includes(p);
}

function dynamic(prefix: string): (p: string) => boolean {
    const re = new RegExp(`^${prefix}/[^/]+$`);
    return (p) => re.test(p);
}

/**
 * Ordered rules — FIRST match wins. Private/dynamic rules are evaluated before
 * static public ones so that e.g. `/dashboard/*` never falls through to a
 * public default.
 */
export const ROUTE_RULES: RouteRule[] = [
    // ── Private / authenticated surfaces (noindex) ─────────────────────
    {
        test: isPath('/admin'),
        meta: { title: `Admin · ${SITE_NAME}`, description: 'Growlanzo administration console.', noindex: true },
    },
    {
        test: isPath('/dashboard'),
        meta: { title: `Dashboard · ${SITE_NAME}`, description: 'Your Growlanzo workspace.', noindex: true },
    },
    {
        test: isPath('/client'),
        meta: { title: `Client Dashboard · ${SITE_NAME}`, description: 'Manage your projects on Growlanzo.', noindex: true },
    },
    {
        test: isPath('/onboarding'),
        meta: { title: `Get Started · ${SITE_NAME}`, description: 'Set up your Growlanzo account.', noindex: true },
    },
    {
        test: isPath('/settings'),
        meta: { title: `Settings · ${SITE_NAME}`, description: 'Manage your Growlanzo settings.', noindex: true },
    },
    {
        test: isPath('/messages'),
        meta: { title: `Messages · ${SITE_NAME}`, description: 'Your Growlanzo messages.', noindex: true },
    },
    {
        test: isPath('/wallet'),
        meta: { title: `Wallet · ${SITE_NAME}`, description: 'Your Growlanzo wallet.', noindex: true },
    },
    {
        test: isPath('/notifications'),
        meta: { title: `Notifications · ${SITE_NAME}`, description: 'Your Growlanzo notifications.', noindex: true },
    },
    {
        test: isPath('/checkout'),
        meta: { title: `Checkout · ${SITE_NAME}`, description: 'Complete your Growlanzo checkout.', noindex: true },
    },
    {
        test: isPath('/payment'),
        meta: { title: `Payment · ${SITE_NAME}`, description: 'The status of your Growlanzo payment and what happens next.', noindex: true },
    },
    {
        test: isPath('/report'),
        meta: { title: `Report · ${SITE_NAME}`, description: 'Report an issue to Growlanzo.', noindex: true },
    },

    // ── Auth action routes (noindex) ───────────────────────────────────
    {
        test: isPath('/auth/forgot-password'),
        meta: { title: `Reset Your Password · ${SITE_NAME}`, description: 'Reset your Growlanzo password.', noindex: true },
    },
    {
        test: isPath('/auth/reset-password'),
        meta: { title: `Set a New Password · ${SITE_NAME}`, description: 'Choose a new Growlanzo password.', noindex: true },
    },
    {
        test: isPath('/auth/magic-link'),
        meta: { title: `Sign In · ${SITE_NAME}`, description: 'Sign in to Growlanzo.', noindex: true },
    },
    {
        test: isPath('/auth/otp'),
        meta: { title: `Verify Your Email · ${SITE_NAME}`, description: 'Verify your email with a one-time code.', noindex: true },
    },
    {
        test: (p) => isPath('/auth/email-confirm')(p) || isPath('/auth/verify-email')(p),
        meta: { title: `Confirm Your Email · ${SITE_NAME}`, description: 'Confirm your Growlanzo email address.', noindex: true },
    },
    {
        test: isPath('/auth/callback'),
        meta: { title: `Signing You In · ${SITE_NAME}`, description: 'Completing sign-in.', noindex: true },
    },
    {
        test: isPath('/auth'),
        meta: { title: `Sign In · ${SITE_NAME}`, description: 'Sign in to Growlanzo.', noindex: true },
    },

    // ── Dynamic public routes ──────────────────────────────────────────
    {
        test: dynamic('/projects'),
        meta: { title: `Project Details · ${SITE_NAME}`, description: 'View project details on Growlanzo.' },
    },
    {
        test: dynamic('/freelancer'),
        meta: { title: `Freelancer Profile · ${SITE_NAME}`, description: 'View a freelancer profile on Growlanzo.' },
    },
    {
        test: dynamic('/services'),
        meta: { title: `Service Details · ${SITE_NAME}`, description: 'View a service on Growlanzo.' },
    },
    {
        test: dynamic('/contests'),
        meta: { title: `Contest Details · ${SITE_NAME}`, description: 'View a design contest on Growlanzo.' },
    },
    {
        // The bare pages (no code) are public and indexable; the /:code variants
        // are the same screen with a specific certificate already looked up.
        test: oneOf('/certificate', '/verify-certificate'),
        // /certificate is an alias of /verify-certificate (same component, and
        // every QR code and in-app link points at /verify-certificate).
        meta: {
            title: `Certificate Verification · ${SITE_NAME}`,
            description: 'Verify a Growlanzo certificate.',
            canonicalPath: '/verify-certificate',
        },
    },
    {
        test: (p) => dynamic('/certificate')(p) || dynamic('/verify-certificate')(p),
        meta: { title: `Certificate Verification · ${SITE_NAME}`, description: 'Verify a Growlanzo certificate.' },
    },

    // ── Static public routes ───────────────────────────────────────────
    {
        test: exact('/'),
        meta: {
            title: DEFAULT_TITLE,
            description: DEFAULT_DESCRIPTION,
        },
    },
    {
        test: exact('/how-it-works'),
        meta: { title: `How It Works · ${SITE_NAME}`, description: 'Learn how Growlanzo connects freelancers and clients.' },
    },
    {
        test: exact('/features'),
        meta: { title: `Features · ${SITE_NAME}`, description: 'Explore Growlanzo features for freelancers and clients.' },
    },
    {
        test: exact('/categories'),
        meta: { title: `Categories · ${SITE_NAME}`, description: 'Browse freelancing categories on Growlanzo.' },
    },
    {
        test: exact('/pricing'),
        meta: { title: `Pricing · ${SITE_NAME}`, description: 'Growlanzo pricing and plans.' },
    },
    {
        test: exact('/about'),
        meta: { title: `About · ${SITE_NAME}`, description: 'About Growlanzo and our mission.' },
    },
    {
        test: exact('/philosophy'),
        meta: { title: `Our Philosophy · ${SITE_NAME}`, description: 'The philosophy behind Growlanzo.' },
    },
    {
        test: oneOf('/internships', '/careers'),
        // Both paths render the same page; /careers is the one linked site-wide,
        // so the duplicate collapses there instead of competing with it.
        meta: {
            title: `Internships & Careers · ${SITE_NAME}`,
            description: 'Internship and career opportunities at Growlanzo.',
            canonicalPath: '/careers',
        },
    },
    {
        test: exact('/contact'),
        meta: { title: `Contact · ${SITE_NAME}`, description: 'Get in touch with the Growlanzo team.' },
    },
    {
        test: exact('/help-center'),
        meta: { title: `Help Center · ${SITE_NAME}`, description: 'Help and support for Growlanzo users.' },
    },
    {
        test: exact('/safety'),
        meta: { title: `Safety · ${SITE_NAME}`, description: 'Trust and safety on Growlanzo.' },
    },
    {
        test: exact('/guidelines'),
        meta: { title: `Community Guidelines · ${SITE_NAME}`, description: 'Growlanzo community guidelines.' },
    },
    {
        test: exact('/status'),
        meta: { title: `System Status · ${SITE_NAME}`, description: 'Growlanzo platform status and uptime.' },
    },
    {
        test: exact('/terms'),
        meta: { title: `Terms of Service · ${SITE_NAME}`, description: 'Growlanzo terms of service.' },
    },
    {
        test: exact('/privacy'),
        meta: { title: `Privacy Policy · ${SITE_NAME}`, description: 'Growlanzo privacy policy.' },
    },
    {
        test: exact('/escrow-policy'),
        meta: { title: `Escrow Policy · ${SITE_NAME}`, description: 'How Growlanzo escrow works.' },
    },
    {
        test: exact('/refund-policy'),
        meta: { title: `Refund Policy · ${SITE_NAME}`, description: 'Growlanzo refund policy.' },
    },
    {
        test: exact('/cookies'),
        meta: { title: `Cookie Policy · ${SITE_NAME}`, description: 'Growlanzo cookie policy.' },
    },
    {
        test: exact('/freelancers'),
        meta: { title: `Find Freelancers · ${SITE_NAME}`, description: 'Search and hire talented freelancers on Growlanzo.' },
    },
    {
        test: exact('/services'),
        meta: { title: `Browse Services · ${SITE_NAME}`, description: 'Browse professional services on Growlanzo.' },
    },
    {
        test: exact('/contests'),
        meta: { title: `Design Contests · ${SITE_NAME}`, description: 'Run or join design contests on Growlanzo.' },
    },
    {
        test: exact('/waitlist'),
        meta: { title: `Join the Waitlist · ${SITE_NAME}`, description: 'Join the Growlanzo waitlist.' },
    },
    {
        test: exact('/unsubscribe'),
        meta: { title: `Unsubscribe · ${SITE_NAME}`, description: 'Manage Growlanzo product-update emails.', noindex: true },
    },
];

export const NOT_FOUND_META: RouteMeta = {
    title: `Page Not Found · ${SITE_NAME}`,
    description: 'The page you are looking for could not be found.',
    noindex: true,
};

export function resolveMeta(pathname: string): RouteMeta {
    const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    for (const rule of ROUTE_RULES) {
        if (rule.test(p)) return rule.meta;
    }
    return NOT_FOUND_META;
}

/**
 * Absolute canonical URL for a pathname. Kept next to the rules so the
 * prerendered <link rel="canonical"> and the runtime one can never disagree.
 */
export function canonicalUrl(pathname: string): string {
    // An alias resolves to its primary URL, so the prerendered <link rel="canonical">
    // is right at build time too (not just after hydration).
    const target = resolveMeta(pathname).canonicalPath ?? pathname;
    const p = target.length > 1 ? target.replace(/\/+$/, '') : '/';
    return `${SITE_URL}${p === '/' ? '/' : p}`;
}
