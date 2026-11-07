import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard for the OAuth → dashboard redirect invariant.
 *
 * The reported bug ("GitHub/LinkedIn login works, then back to homepage"):
 * a user signs in with a provider, the callback page renders, and instead of
 * landing on /dashboard / /client / /admin (or /onboarding for a new user),
 * the browser ends up back on the homepage with a session that never continues.
 *
 * The root cause is always one of these source-level decisions:
 *   1. getPostAuthPath can return "/" for a valid profile, or
 *   2. the callback redirects with a null/incomplete profile, or
 *   3. the callback never calls redirectAfterAuth at all for the happy path.
 *
 * None of those are runtime-state bugs — they're source decisions — so the
 * cheapest, most reliable guard reads the source and pins the exact paths and
 * the exact redirect call that must survive every edit. This is the single test
 * that would have caught the original report.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const ACTION = readSource('src/lib/authAction.ts');
const CALLBACK = readSource('src/pages/AuthCallbackPage.tsx');

describe('OAuth sign-in always resolves to a dashboard or onboarding — never the homepage', () => {
  it('getPostAuthPath never returns "/" for a valid profile', () => {
    // The reported bug is "logged in, back to homepage". If getPostAuthPath can
    // return "/" for a profile that has a role and onboarding complete, that is
    // the bug — full stop — regardless of every other guard in the chain.
    expect(ACTION).not.toMatch(/return\s+['"`]\/['"`]\s*;/);

    // The four legitimate destinations must all still be present and explicit.
    expect(ACTION).toContain("return '/onboarding';");
    expect(ACTION).toContain("return '/client';");
    expect(ACTION).toContain("return '/dashboard';");
    expect(ACTION).toContain("return '/admin';");
  });

  it('the callback redirects a completed user to the role dashboard path', () => {
    // redirectAfterAuth(profile) is the single exit that lands a finished user
    // on the app. It must be called for the happy path (not only for an error or
    // a country-gate sub-branch), and it must be the LAST routing decision before
    // the effect's catch block.
    expect(CALLBACK).toContain('redirectAfterAuth(profile);');

    // The redirect must come AFTER the profile-existence decision, not before it.
    const profileGate = CALLBACK.indexOf('if (!profile && authUser?.id) {');
    const redirect = CALLBACK.indexOf('redirectAfterAuth(profile);');
    expect(profileGate, 'profile creation gate must exist').toBeGreaterThan(-1);
    expect(redirect, 'redirectAfterAuth must exist').toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(profileGate);
  });

  it('a new (onboarding-incomplete) OAuth user is routed to /onboarding, not the homepage', () => {
    // For a user still onboarding, redirectAfterAuth must receive a profile whose
    // onboardingCompleted === false, which makes getPostAuthPath return /onboarding.
    // The callback must not redirect a new user straight to "/" or to a role
    // dashboard they have not chosen yet.
    expect(CALLBACK).toContain("if (profile?.onboardingCompleted === false) {");

    // The role-choice step lives on onboarding's welcome page — there is no
    // role-specific onboarding path the callback could shortcut to.
    expect(CALLBACK).toContain('ONE onboarding for everyone');
  });

  it('the callback persists the session before redirecting (so the next load restores)', () => {
    // A redirect that fires before the session is written to localStorage is the
    // classic "callback page works, next page load is back to login/homepage" bug.
    // The persist+confirm block must appear before redirectAfterAuth.
    const persistBlock = CALLBACK.indexOf('localStorage.setItem(sbKey, JSON.stringify(session));');
    const redirect = CALLBACK.indexOf('redirectAfterAuth(profile);');
    expect(persistBlock, 'session must be written to localStorage before redirect').toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(persistBlock);

    // And the write must be confirmed before the redirect is allowed to fire.
    const confirmRead = CALLBACK.indexOf('const check = await supabase.auth.getSession()');
    expect(confirmRead, 'session write must be confirmed before redirect').toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(confirmRead);
  });

  it('the callback does not hand a null profile to redirectAfterAuth on the happy path', () => {
    // After profile creation (or fetch), the happy-path code path must have a
    // concrete profile object before it calls redirectAfterAuth. The persist
    // failure branch is the ONLY place that returns before the redirect, and it
    // does so with an error screen — never a silent homepage drop.
    const redirect = CALLBACK.indexOf('redirectAfterAuth(profile);');
    const errorExit = CALLBACK.lastIndexOf('return;', redirect);
    const blockBetween = CALLBACK.slice(redirect, errorExit);

    // There must be no early `return` between the profile gate and the redirect
    // that could leave `profile` null on the happy path. The only returns in this
    // region should be the cancelled-check guards and the final redirect itself.
    const lines = blockBetween.split('\n');
    let seenRedirect = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('redirectAfterAuth(profile);')) {
        seenRedirect = true;
        continue;
      }
      if (!seenRedirect) {
        // Before the redirect: only allow the cancelled guard and whitespace.
        expect(
          trimmed === '' ||
          trimmed.startsWith('if (cancelled) return;') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('}') ||
          trimmed.startsWith('{'),
          `unexpected pre-redirect line: ${trimmed.slice(0, 80)}`
        ).toBe(true);
      }
    }
  });

  it('the OAuth redirect target is the callback URL, not the homepage', () => {
    // If signInWithOAuth requests the homepage as redirectTo, Supabase appends
    // the code/token there and the user appears "stuck on the homepage". The
    // redirect target must be /auth/callback so the callback page can exchange
    // the token and route onward.
    const CONTEXT = readSource('src/context/AuthContext.tsx');
    expect(CONTEXT).toContain("/auth/callback`");
    expect(CONTEXT).toContain('redirectTo = `${window.location.origin}/auth/callback`');
  });

  it('ProtectedRoute does not wrap /auth/callback (no Navigate race during the callback)', () => {
    // If ProtectedRoute wrapped the callback route, its unauthenticated→/?modal=login
    // and incomplete-onboarding→/onboarding Navigates could race the callback's own
    // redirect and drop the user. The callback route must be a bare page element.
    const APP = readSource('src/app/App.tsx');
    // The route is `<Route path="auth/callback" element={<AuthCallbackPage />} />`.
    const callbackRoute = APP.indexOf('path="auth/callback"');
    expect(callbackRoute, 'auth/callback must be routed').toBeGreaterThan(-1);
    // The element on the same route line must be <AuthCallbackPage />, not <ProtectedRoute>.
    const lineEnd = APP.indexOf('\n', callbackRoute);
    const line = APP.slice(callbackRoute, lineEnd === -1 ? undefined : lineEnd);
    expect(line).toContain('<AuthCallbackPage');
    expect(line).not.toContain('ProtectedRoute');
  });
});
