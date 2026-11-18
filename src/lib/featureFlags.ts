/**
 * Client-side feature switches — the SPA twin of
 * `supabase/functions/_shared/features.ts`.
 *
 * Both layers read the same names, both default to OFF, and both require the
 * exact string `'true'` to enable. The server is the enforcement point; this
 * module only decides what the user SEES, so a mismatch degrades to "page looks
 * available but the API answers 410" — never to "page hidden but API live".
 *
 * Enabling at runtime (staging only):
 *   VITE_FEATURE_CONTESTS_ENABLED=true
 *   VITE_FEATURE_INTERNSHIPS_ENABLED=true
 *   VITE_FEATURE_CERTIFICATES_ENABLED=true
 * and the matching `FEATURE_*_ENABLED=true` on the Supabase function side.
 */

/**
 * FULL KYC (document / government-ID identity verification) is DEFERRED for the
 * Beta release. The founder decision is to ship the Beta with account
 * verification only and present advanced identity verification as "Coming
 * Soon" until a later phase, subject to legal and payment-provider review.
 *
 * This switch is the single place that says so. While it is `false`:
 *   - no KYC submission surface is advertised or reachable (no document
 *     upload, no Aadhaar/PAN collection, no external KYC provider);
 *   - screens that mention KYC render the Coming Soon copy instead of a form;
 *   - nothing claims a user is KYC verified. `profiles.verification_status` and
 *     the green badge mean ACCOUNT verification (name + email + phone) only.
 *
 * Turning this back on is a product + legal decision, not a config tweak.
 */
export const KYC_VERIFICATION_ENABLED = false;

/**
 * The one copy block for the deferred KYC feature. Shared by every surface that
 * mentions KYC so the status can never drift between pages.
 *
 * `reasons` exists because "Coming Soon" on its own reads like an unfinished
 * product. A user who opens the verification screen must be told WHY we are not
 * collecting government IDs yet — and that nothing is blocked while we wait.
 */
export const KYC_COMING_SOON = {
  title: 'KYC Verification',
  status: 'Coming Soon',
  description:
    'Full identity verification (government ID and document checks) is not part of the Growlanzo Beta. Everything available today is unlocked through the account verification above — your name, a confirmed email and a confirmed phone.',
  reasons: [
    'We are an early-stage platform and are completing the legal and compliance review that collecting government IDs requires.',
    'Document checks need a licensed identity-verification provider, and that integration is still being set up.',
    'So we do not collect ID documents we cannot protect and process properly yet — no Aadhaar, PAN, passport or bank documents are requested in the Beta.',
  ],
  reassurance:
    'Nothing is blocked for you: hiring, applying, contracts and payouts all work with account verification. When KYC launches we will ask for your consent first and update the Privacy Policy before collecting anything new.',
} as const;

/**
 * ACCOUNT verification is ON for both roles — the light three-criteria check
 * (name + confirmed email + confirmed phone). It is deliberately NOT KYC and is
 * never labelled as such: a confirmed phone number must never read as "KYC
 * verified".
 *
 * `src/pages/dashboard/IdentityVerificationPage.tsx` is the single screen both
 * roles share; it writes nothing itself and lets `refresh_light_kyc` derive
 * `profiles.verification_status` from the auth record. This switch controls the
 * ENTRY POINTS only: the sidebar link, the header chip and the routes.
 */
export const IDENTITY_VERIFICATION_ENABLED = true;

/**
 * Whether an unverified identity blocks critical money actions (orders, escrow
 * funding, withdrawals).
 *
 * OFF deliberately, for two reasons that must both be resolved before flipping
 * it: (a) the phone criterion needs a real SMS channel — the platform-issued
 * code is currently delivered in development mode, and (b) KYC itself is
 * deferred for the Beta (`KYC_VERIFICATION_ENABLED = false`), so no money
 * action may be gated on identity verification in this release. Payment-provider
 * checks live server-side and are unaffected by this client flag.
 */
export const KYC_REQUIRED_FOR_ACTIONS = false;

export type ClientFeature = 'internships' | 'certificates' | 'contests';

/** Fail-closed defaults. Keep in step with the server module. */
const DEFAULTS: Record<ClientFeature, boolean> = {
  internships: false,
  certificates: false,
  contests: false,
};

/**
 * Read the flag for one feature with EXPLICIT property access.
 *
 * ⚠️ Do not "simplify" this back to one computed lookup on the env object.
 * Vike replaces a BARE env expression (the object itself, with no property
 * access after it) with `null` at build time — it printed exactly that warning
 * for this file on every build — so the computed lookup evaluated `null?.[key]`
 * → `undefined` for every feature in the shipped bundle. Every
 * flag therefore stayed on its fail-closed default and setting
 * `VITE_FEATURE_CONTESTS_ENABLED=true` (the documented way to enable a module)
 * did nothing at all — silently. Property access on the env object is replaced
 * statically by Vite and survives the build, which is why it is written out.
 */
function envFlag(feature: ClientFeature): string | undefined {
  switch (feature) {
    case 'internships':
      return import.meta.env.VITE_FEATURE_INTERNSHIPS_ENABLED;
    case 'certificates':
      return import.meta.env.VITE_FEATURE_CERTIFICATES_ENABLED;
    case 'contests':
      return import.meta.env.VITE_FEATURE_CONTESTS_ENABLED;
    default:
      return undefined;
  }
}

export function isFeatureEnabled(feature: ClientFeature): boolean {
  const raw = envFlag(feature);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DEFAULTS[feature];
}

/**
 * True when `path` is the identity-verification screen for either role.
 * Used by the tests and the router so the redirect stays in one place.
 */
export function isIdentityVerificationPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = path.split('?')[0].split('#')[0];
  return p === '/dashboard/identity-verification' || p === '/client/verification';
}

/**
 * True when `path` belongs to a module deferred from this release.
 *
 * Used to remove navigation entries (not to block rendering — the router gates
 * every deferred path explicitly). Prefix matching is deliberate for
 * `/contests/:id` and `/client/contests/create`, but exact matching is used
 * where a prefix would swallow an unrelated route (`/certificate` vs
 * `/certificates` is not a real conflict here, but `/client/contests` must not
 * match `/client/contracts`).
 */
export function isDeferredRoute(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = path.split('?')[0].split('#')[0];

  if (
    !isFeatureEnabled('internships') &&
    (p === '/internships' || p === '/careers' || p === '/admin/internships')
  ) {
    return true;
  }

  if (
    !isFeatureEnabled('certificates') &&
    (p === '/certificate' ||
      p.startsWith('/certificate/') ||
      p === '/verify-certificate' ||
      p.startsWith('/verify-certificate/') ||
      p === '/dashboard/certifications' ||
      p.startsWith('/dashboard/certifications/') ||
      p === '/admin/certificates')
  ) {
    return true;
  }

  if (
    !isFeatureEnabled('contests') &&
    (p === '/contests' ||
      p.startsWith('/contests/') ||
      p === '/dashboard/contests' ||
      p === '/client/contests' ||
      p.startsWith('/client/contests/'))
  ) {
    return true;
  }

  return false;
}
