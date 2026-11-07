import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  noteLogoutReason,
  readLogoutNotice,
  clearLogoutNotice,
  LOGOUT_NOTICE_MAX_AGE_MS,
  LOGOUT_NOTICE_COPY,
} from '../lib/logoutNotice';
import { alternateProvider, providerDisplayName } from '../lib/oauthDiagnostics';

/**
 * The industry-level auth guarantees a founder asked for, in one place:
 *
 *  1. A user who signed up once is signed out automatically after 24 hours of
 *     inactivity — and is TOLD that is what happened, instead of staring at a
 *     login form that looks broken.
 *  2. Signing in with the provider the account was NOT created with (account on
 *     LinkedIn, clicks GitHub) never creates a second account: the app names
 *     the provider the account lives on and takes the person there in one click.
 *  3. A brand-new account hears about it in real time — a welcome email and an
 *     email-verified confirmation to the address the provider verified.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const CALLBACK = readSource('src/pages/AuthCallbackPage.tsx');
const AUTH_CONTEXT = readSource('src/context/AuthContext.tsx');
const LOGIN = readSource('src/components/LoginModal.tsx');
const EMAIL_SERVICE = readSource('src/lib/emailNotificationService.ts');
const EMAIL_FUNCTION = readSource('supabase/functions/email-notifications/index.ts');

const KEY = 'growlancer_logout_notice';

beforeEach(() => {
  window.localStorage.clear();
});

describe('the 24-hour inactivity sign-out', () => {
  it('carries its reason from the sign-out to the login screen', () => {
    // Without a reason this is indistinguishable from a broken login — the
    // person has no idea why they are signed out.
    noteLogoutReason('idle_timeout');
    const notice = readLogoutNotice();
    expect(notice?.reason).toBe('idle_timeout');
    expect(LOGOUT_NOTICE_COPY.idle_timeout.title).toMatch(/24 hours/i);
    expect(LOGOUT_NOTICE_COPY.idle_timeout.message).toMatch(/sign in again/i);
  });

  it('is shown once and then gone', () => {
    noteLogoutReason('idle_timeout');
    expect(readLogoutNotice()).not.toBeNull();
    clearLogoutNotice();
    expect(readLogoutNotice()).toBeNull();
  });

  it('drops a stale notice rather than blaming a fresh login for an old logout', () => {
    noteLogoutReason('idle_timeout');
    expect(readLogoutNotice(Date.now() + LOGOUT_NOTICE_MAX_AGE_MS + 1000)).toBeNull();
    // …and the stale entry is cleaned up, not left to be read later.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('treats unreadable and impossible data as no notice at all', () => {
    window.localStorage.setItem(KEY, 'not json at all');
    expect(readLogoutNotice()).toBeNull();

    window.localStorage.setItem(KEY, JSON.stringify({ reason: 'who_knows', at: Date.now() }));
    expect(readLogoutNotice()).toBeNull();

    window.localStorage.setItem(KEY, JSON.stringify({ reason: 'idle_timeout', at: 'yesterday' }));
    expect(readLogoutNotice()).toBeNull();
  });

  it('is armed by the timeout itself, with the stored token cleared', () => {
    // The check: 24 hours, activity events, and — critically — the persisted
    // token must not survive, or the next page load resumes the session that
    // was just ended.
    expect(AUTH_CONTEXT).toContain('const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000');
    expect(AUTH_CONTEXT).toContain(
      "const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll']"
    );
    expect(AUTH_CONTEXT).toMatch(/noteLogoutReason\('idle_timeout'\)/);
    expect(AUTH_CONTEXT).toContain('clearSupabaseAuthStorage()');
    expect(AUTH_CONTEXT).toContain("window.location.replace('/?modal=login')");
  });

  it('is announced on the login form before the provider buttons', () => {
    expect(LOGIN).toContain('readLogoutNotice');
    expect(LOGIN).toContain('clearLogoutNotice');
    expect(LOGIN).toContain('LOGOUT_NOTICE_COPY');
  });
});

describe('signing in on the wrong provider never creates a second account', () => {
  it('names the provider the account lives on', () => {
    // Growlanzo accounts can only be created with GitHub or LinkedIn, so a
    // duplicate-email rejection on one provider proves the account is on the
    // other. That is the whole trick: no lookup, no email enumeration.
    expect(alternateProvider('github')).toBe('linkedin_oidc');
    expect(alternateProvider('linkedin_oidc')).toBe('github');
    expect(providerDisplayName('linkedin_oidc')).toBe('LinkedIn');
    expect(providerDisplayName('github')).toBe('GitHub');
  });

  it('has a dedicated screen, not a generic error line', () => {
    expect(CALLBACK).toContain("'provider_mismatch'");
    expect(CALLBACK).toContain(
      "| { kind: 'already_exists'; existingProvider: OAuthProvider }"
    );
    // The screen names the other provider and offers a one-click way there.
    expect(CALLBACK).toMatch(/Your Growlanzo account is on /);
    expect(CALLBACK).toMatch(/Continue with \$\{providerDisplayName/);
  });

  it('routes the retry to the provider the account is on', () => {
    // The retry must use the EXISTING account's provider — the one just tried
    // is provably not where the account is.
    expect(CALLBACK).toMatch(
      /retryProvider:\s*mismatch\.kind === 'already_exists'\s*\? mismatch\.existingProvider\s*: alternateProvider\(mismatch\.attemptedProvider\)/
    );
    expect(CALLBACK).toMatch(/handleMismatchRetry\(mismatchView\.retryProvider\)/);
    // …and the failed attempt's breadcrumb is dropped so the return-notice
    // cannot stack a second "try again" modal on top.
    expect(CALLBACK).toContain('clearOAuthAttempt();\n    const result = await signInWithOAuth');
  });

  it('stops an identity that shares no usable email, before any account exists', () => {
    // GitHub hands back "<id>+<uuid>@users.noreply.github.com" for a private
    // address. An account on it would receive no welcome mail, no notifications
    // and no way to be recovered.
    expect(CALLBACK).toContain('/@users\\.noreply\\.github\\.com$/i');
    // Only for an identity with no profile yet — a returning user's working
    // account is never touched.
    expect(CALLBACK).toMatch(/if \(authUser && isProviderOAuth && !profile\) \{/);
    // The half-created identity is dropped locally and storage is cleared.
    expect(CALLBACK).toContain("await supabase.auth.signOut({ scope: 'local' }).catch(() => {});");
    expect(CALLBACK).toContain('clearSupabaseAuthStorage();');
  });
});

describe('a new account hears about it in real time', () => {
  it('sends a welcome and a verification email to the verified address', () => {
    expect(CALLBACK).toContain('void emailNotificationService.welcomeAccount({');
    expect(CALLBACK).toContain('void emailNotificationService.emailVerified({');
    // Both go to the address the provider verified, never to a guessed one.
    expect(CALLBACK).toMatch(/recipientEmail: authUser\.email,/);
    expect(EMAIL_SERVICE).toContain("'welcome_account'");
    expect(EMAIL_SERVICE).toContain("'email_verified'");
  });

  it('fires only for a genuine signup, and only once per account', () => {
    // A returning user must not be welcomed again on every sign-in.
    expect(CALLBACK).toContain('const SIGNUP_EMAIL_WINDOW_MS = 5 * 60 * 1000');
    expect(CALLBACK).toMatch(/Date\.now\(\) - createdAtMs < SIGNUP_EMAIL_WINDOW_MS/);
    // …and a reload / second tab must not duplicate the send.
    expect(CALLBACK).toMatch(/const sentKey = `growlancer_welcome_sent_\$\{authUser\.id\}`/);
    expect(CALLBACK).toMatch(/!localStorage\.getItem\(sentKey\)/);
  });

  it('the edge function actually builds and sends both', () => {
    expect(EMAIL_FUNCTION).toContain("case 'welcome_account':");
    expect(EMAIL_FUNCTION).toContain("case 'email_verified':");
    expect(EMAIL_FUNCTION).toContain('function buildWelcomeHtml(');
    expect(EMAIL_FUNCTION).toContain('function buildEmailVerifiedHtml(');
    // Templates go through the same branded shell and the same logged send
    // path as every other transactional email (sender routing + email_logs
    // audit + idempotency), not a bare Brevo call.
    expect(EMAIL_FUNCTION).toContain('baseEmailHtml(');
    expect(EMAIL_FUNCTION).toContain("import { sendLoggedEmail } from '../_shared/emailService.ts'");
    expect(EMAIL_FUNCTION).not.toMatch(/from '\.\.\/_shared\/brevo\.ts'/);
  });
});
