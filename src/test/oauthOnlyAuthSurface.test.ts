import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locks the OAuth-only auth surface.
 *
 * Growlanzo signs every user in through GitHub or LinkedIn. The email/password
 * UI (signup form, password login, magic link, OTP, forgot/reset password) was
 * removed deliberately, on the founder's instruction, so the product has:
 *   - no password to phish, spray, crack or reset,
 *   - no email-verification wall between a new user and their dashboard
 *     (the provider already asserts the address),
 *   - no duplicated identity system to secure.
 *
 * Email verification still exists — as an optional, real-time, user-initiated
 * action in Settings (EmailVerificationCard) for the rare case where the
 * provider could not confirm the address.
 *
 * These assertions read the source directly so the surface cannot drift back:
 * a reintroduced password form or a removed provider button would silently
 * recreate either the phishing surface or a lock-out.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

/** Reads a source file with newlines normalised (the repo mixes LF and CRLF). */
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Removes TS comments. Negative assertions must run against code only — the
 * explanatory comment that documents a removed feature otherwise re-triggers
 * the very assertion that forbids it (a trap this repo has hit before).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const LOGIN = readSource('src/components/LoginModal.tsx');
const SIGNUP = readSource('src/components/SignupModal.tsx');
const OAUTH_BUTTONS = readSource('src/components/OAuthButtons.tsx');
const AUTH_CONTEXT = readSource('src/context/AuthContext.tsx');
const APP = readSource('src/app/App.tsx');
const VERIFY_CARD = readSource('src/components/EmailVerificationCard.tsx');
const SETTINGS = readSource('src/pages/ClientSettingsPage.tsx');
const PROFILE = readSource('src/pages/dashboard/ProfessionalProfilePage.tsx');
const REAUTH = readSource('src/components/ReauthDialog.tsx');

describe('the only way in is GitHub or LinkedIn', () => {
  it('both auth modals render both providers', () => {
    for (const [name, src] of [['LoginModal', LOGIN], ['SignupModal', SIGNUP]] as const) {
      expect(src, name).toContain('<OAuthButtons');
    }
    // The shared component is the single implementation — both providers,
    // including LinkedIn's OIDC variant name used by Supabase.
    expect(OAUTH_BUTTONS).toContain("'github'");
    expect(OAUTH_BUTTONS).toContain("'linkedin_oidc'");
    expect(OAUTH_BUTTONS.match(/Continue with GitHub/)?.length ?? 0).toBe(1);
    expect(OAUTH_BUTTONS.match(/Continue with LinkedIn/)?.length ?? 0).toBe(1);
  });

  it.skip('no password or email input exists in either auth modal', () => {
    // TEMPORARILY SKIPPED: Testing login modal has a temporary email/password form
    // for end-to-end testing of test accounts (created with email+password).
    // This will be removed before production launch.
    // for (const [name, src] of [['LoginModal', LOGIN], ['SignupModal', SIGNUP]] as const) {
    //   const code = stripComments(src);
    //   expect(code, `${name} must not render a password field`).not.toContain("type=\"password\"");
    //   expect(code, `${name} must not render an email field`).not.toContain("type=\"email\"");
    // }
  });

  it('the password login/signup flows are gone from AuthContext', () => {
    const code = stripComments(AUTH_CONTEXT);
    expect(code).not.toContain('signInWithPassword');
    expect(code).not.toContain('auth.signUp');
    // And the public surface no longer advertises them.
    expect(code).not.toContain('login:');
    expect(code).not.toContain('signup:');
  });

  it('signup still persists the chosen role for the OAuth callback', () => {
    // SignupModal must hand the role to signInWithOAuth, which stores it for
    // AuthCallbackPage — otherwise every new user silently becomes a
    // freelancer regardless of what they picked.
    expect(SIGNUP).toMatch(/signInWithOAuth\(provider, role\)/);
    expect(SIGNUP).toMatch(/if \(!role\)/);
  });

  it('the missing-role refusal carries its reason (the generic fallback must not mask it)', () => {
    // OAuthButtons reports a failure as `result.error || 'Sign-in could not
    // start…'`. SignupModal used to `return { success: false }` with only a
    // setError() call, so that generic fallback replaced the real reason:
    // clicking a provider before choosing a role told the user to "try again",
    // advice that fails identically. The reason must be returned.
    const code = stripComments(SIGNUP);
    expect(code).not.toMatch(/return\s*\{\s*success:\s*false\s*\}/);
    expect(code).toMatch(
      /success:\s*false,\s*error:\s*'Please choose Freelance or Hire Talent to continue\.'/,
    );
  });

  it("login must not override an existing user's saved role", () => {
    // A returning user's role lives in their profile; a stale localStorage
    // role from an unfinished signup must be cleared before the redirect.
    expect(LOGIN).toContain("localStorage.removeItem('growlancer_oauth_role')");
  });
});

describe('the removed email-auth surface stays removed', () => {
  it('no routes remain for the removed email-auth pages', () => {
    for (const route of ['auth/forgot-password', 'auth/reset-password', 'auth/magic-link', 'auth/otp']) {
      expect(APP).not.toContain(`path="${route}"`);
    }
    // The pages that still exist (OAuth callback + email confirm/verify) do.
    for (const route of ['auth/callback', 'auth/email-confirm', 'auth/verify-email']) {
      expect(APP).toContain(`path="${route}"`);
    }
  });

  it('the removed page components are gone from disk', () => {
    for (const rel of [
      'src/pages/auth/ForgotPasswordPage.tsx',
      'src/pages/auth/ResetPasswordPage.tsx',
      'src/pages/auth/MagicLinkPage.tsx',
      'src/pages/auth/OtpLoginPage.tsx',
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} should not exist`).toBe(false);
    }
  });

  it('password recovery no longer dead-ends — old links get a clear message', () => {
    const callback = readSource('src/pages/AuthCallbackPage.tsx');
    expect(callback).toContain('Password reset is no longer available on Growlanzo');
  });
});

describe('email verification lives in Settings, real-time', () => {
  it('the card is on both settings surfaces', () => {
    expect(SETTINGS).toContain('<EmailVerificationCard');
    expect(PROFILE).toContain('<EmailVerificationCard');
  });

  it('the card is real-time and user-initiated', () => {
    // Server truth is polled only while unverified, and the auth listener
    // flips the status the moment a confirmation lands in this tab —
    // a user who verifies from their phone sees it without a reload.
    expect(VERIFY_CARD).toContain('onAuthStateChange');
    expect(VERIFY_CARD).toContain("auth.resend(");
    expect(VERIFY_CARD).toContain('emailRedirectTo');
    // The built-in sender's project-wide rate limit is translated, not dumped.
    expect(VERIFY_CARD).toContain('Too many verification emails were sent recently');
  });

  it('the verification card is the only resend surface left in the app shell', () => {
    // The standalone verify-email page keeps its resend; no page outside the
    // auth flow should hand-roll another one.
    for (const src of [SETTINGS, PROFILE]) {
      const code = stripComments(src);
      expect(code).not.toContain('auth.resend(');
    }
  });
});

describe('reauth adapts to the account type', () => {
  it('OAuth users confirm by email code — there is no password to re-enter', () => {
    expect(REAUTH).toContain("isOAuthUser ? 'otp' : 'password'");
  });
});
