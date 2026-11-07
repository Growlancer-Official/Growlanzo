import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locks the "returning user resumes, never re-authenticates" behaviour.
 *
 * The defect this prevents, reported live after launch: someone who had
 * already signed up clicked Login, was shown the provider buttons again with
 * an "Already logged in" banner, went through GitHub a second time, watched a
 * "Processing…" page, and only then reached the dashboard they already had a
 * session for. Nothing failed — every step was individually correct — so no
 * test caught the flow as a whole.
 *
 * The invariant, one line: a persisted session must always outrank the
 * sign-in form, and a session with onboarding complete must never sit on a
 * confirmation screen.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const LOGIN = readSource('src/components/LoginModal.tsx');
const LAYOUT = readSource('src/layouts/MainLayout.tsx');
const CALLBACK = readSource('src/pages/AuthCallbackPage.tsx');
const ACTION = readSource('src/lib/authAction.ts');

describe('a signed-in visitor is never asked to sign in again', () => {
  it('the login modal resumes an existing session instead of showing providers', () => {
    // The modal must resolve the real destination and leave — not render a
    // second OAuth round trip for a session that already exists.
    expect(LOGIN).toContain("import { getPostAuthPath } from '../lib/authAction'");
    expect(LOGIN).toMatch(/navigate\(getPostAuthPath\(user\)/);
    // Server-validated check, so a deleted account cannot "resume".
    expect(LOGIN).toContain('supabase.auth.getUser()');
    expect(LOGIN).toContain('isStaleSessionError');
    // The old banner that kept the provider buttons in front of a signed-in
    // user is gone.
    expect(LOGIN).not.toContain('Already logged in');
  });

  it('login/signup entry points route through to the dashboard when authenticated', () => {
    expect(LAYOUT).toContain("import { getPostAuthPath } from '../lib/authAction'");
    expect(LAYOUT).toMatch(/const resumeDestination = isAuthenticated && user \? getPostAuthPath\(user\) : null/);
    // Both the URL-driven (?modal=login|signup) and click-driven paths respect it.
    expect(LAYOUT).toMatch(/modal === 'login' \|\| modal === 'signup'\) && resumeDestination/);
    expect(LAYOUT.match(/navigate\(resumeDestination, \{ replace: true \}\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('the restore window never offers the provider buttons (reported live, Oct 27)', () => {
    // The second live report: "login karne par pehle LinkedIn/GitHub par jata
    // hai". Cause was a first-paint race, not a broken session — auth restore is
    // async, so for ~1-2s the header rendered "Login" and the modal rendered the
    // provider buttons for someone who was already signed in. Tapping either
    // started a second OAuth round trip.
    //
    // The invariant: the persisted token is read SYNCHRONOUSLY, and while a
    // session exists-but-is-restoring, neither the header nor the modal may
    // offer a provider.
    const SUPABASE = readSource('src/lib/supabase.ts');

    // One shared, synchronous check — no network, so it works on first paint.
    expect(SUPABASE).toContain('export function hasPersistedAuthSession')
    expect(SUPABASE).toMatch(/key\.endsWith\('-auth-token-user'\)/);

    // Header: reserve the space for the WHOLE unresolved window, not just when a
    // token happens to be readable. The pre-rendered shell used to bake in a
    // Login button (the build renders with auth unresolved), so a signed-in
    // visitor saw it on every load — and tapped it.
    expect(LAYOUT).toMatch(
      /const isRestoringSession = !isAuthenticated && \(Boolean\(session\) \|\| authLoading\)/
    );
    expect(LAYOUT).toMatch(/\{!isAuthenticated && !isRestoringSession && \(/);

    // The "your sign-in did not finish" retry prompt offers the providers too,
    // so it must stay silent while auth is still resolving.
    const NOTICE = readSource('src/components/OAuthReturnNotice.tsx');
    expect(NOTICE).toMatch(/if \(isLoading\) return;/);

    // Modal: the providers render only when there is nothing to restore.
    expect(LOGIN).toContain('hasPersistedAuthSession');
    expect(LOGIN).toMatch(/const restoring = isOpen && !isAuthenticated &&/);
    expect(LOGIN).toMatch(/\{restoring \|\| resuming \? \(/);
  });

  it('the OAuth callback does not park a returning user on a success screen', () => {
    // The delay/status flash is gated on onboarding actually being pending.
    expect(CALLBACK).toContain('if (profile?.onboardingCompleted === false) {');
    // and it sits AFTER that gate, right before the redirect.
    const gate = CALLBACK.indexOf('profile?.onboardingCompleted === false) {');
    const redirect = CALLBACK.indexOf('redirectAfterAuth(profile);');
    expect(gate).toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(gate);
    // No unconditional "success → sleep → redirect" remains.
    expect(CALLBACK).not.toMatch(/setStatus\('success'\);\s*\n\s*\n\s*\/\/ ⚡/);
  });

  it('the destination rules still send finished users to their role dashboard', () => {
    expect(ACTION).toContain("return '/client';");
    expect(ACTION).toContain("return '/dashboard';");
    expect(ACTION).toContain("return '/onboarding';");
  });
});

describe('the final brand email is the one users can actually reach', () => {
  // The public contact address is the monitored support inbox. The private owner
  // Gmail (growlanzo.own@gmail.com) is the RECIPIENT for internal admin alerts only
  // (spec §7) and is never a customer-facing From / contact link.
  const SUPPORT_EMAIL = 'support@growlanzo.com';

  it('the footer, legal pages and report form all show the support inbox', () => {
    for (const rel of [
      'src/components/SiteFooter.tsx',
      'src/pages/TermsPage.tsx',
      'src/pages/PrivacyPage.tsx',
      'src/pages/CookiesPage.tsx',
      'src/pages/ReportFeedbackPage.tsx',
    ]) {
      expect(readSource(rel), rel).toContain(SUPPORT_EMAIL);
    }
  });

  it('the mail sender default is a verified domain sender, not the owner Gmail', () => {
    const BREVO = readSource('supabase/functions/_shared/brevo.ts');
    // The legacy default must not be the owner Gmail.
    expect(BREVO).not.toContain('growlanzo.own@gmail.com');
    // It falls back to a verified @growlanzo.com sender.
    expect(BREVO).toContain('info@growlanzo.com');
  });

  it('the owner Gmail is absent from customer-facing shipped surfaces', () => {
    for (const rel of [
      'src/components/SiteFooter.tsx',
      'src/pages/TermsPage.tsx',
      'src/pages/PrivacyPage.tsx',
      'src/pages/CookiesPage.tsx',
      'src/pages/ReportFeedbackPage.tsx',
      'supabase/functions/_shared/brevo.ts',
      'public/manifest.json',
    ]) {
      expect(readSource(rel), rel).not.toContain('growlanzo.own@gmail.com');
    }
  });

  it('the owner Gmail remains only as the internal admin-alert recipient', () => {
    const ALERT_FILES = [
      'supabase/functions/admin-data/index.ts',
      'supabase/functions/security-alert-notify/index.ts',
      'supabase/functions/internship-applications/index.ts',
      'supabase/functions/proposal-notifications/index.ts',
    ];
    for (const rel of ALERT_FILES) {
      expect(readSource(rel), rel).toContain('growlanzo.own@gmail.com');
    }
  });
});
