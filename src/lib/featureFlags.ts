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
 * Identity verification is ON for both roles — the light three-criteria check
 * (name + confirmed email + confirmed phone), not the old document upload.
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
 * OFF deliberately: the phone criterion needs the project's SMS provider
 * connected in Supabase (Auth → Providers → Phone). Until that credential is in
 * place a newly verified user could not finish step three, and blocking escrow
 * or withdrawals on it would lock real money out of the product. Flip this to
 * `true` in the same release that turns SMS on — `requireKycForAction` already
 * implements the check, so nothing else changes.
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
