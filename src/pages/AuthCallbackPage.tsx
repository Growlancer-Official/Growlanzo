import { useEffect, useState, startTransition } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, clearSupabaseAuthStorage } from '../lib/supabase';
import { fetchUserProfile, createUserProfile as createProfile } from '../lib/services/authService';
import { redirectAfterAuth } from '../lib/authAction';
import {
  alternateProvider,
  clearOAuthAttempt,
  describeOAuthFailure,
  providerDisplayName,
  readOAuthAttempt,
  type OAuthProvider,
} from '../lib/oauthDiagnostics';
import { emailNotificationService } from '../lib/emailNotificationService';
import {
  approveSecondAccount,
  consumeSecondAccountApproval,
  detectSecondAccount,
  type SecondAccountCandidate,
} from '../lib/secondAccountGuard';
import { recordBrowserAccount } from '../lib/browserIdentity';
import { useAuth } from '../context/AuthContext';
import { CheckCircle2, Loader2, XCircle, MapPin, ArrowRight, AlertTriangle, LogIn } from 'lucide-react';
import { CountrySelect } from '../components/CountrySelect';
import { BrandLogo } from '../components/BrandLogo';

const isDev = import.meta.env.DEV;
function devLog(...args: unknown[]) {
  if (isDev) console.log('[AuthCallback]', ...args);
}

/** Safe navigation wrapper — prevents React state-update-on-unmounted errors */
function safeNavigate(navFn: () => void) {
  startTransition(() => {
    setTimeout(navFn, 50);
  });
}

// ⚠️ redirectAfterAuth is imported from ../lib/authAction (shared with
// EmailConfirmPage + VerifyEmailPage) so every auth entry point converges on
// the SAME destination rules: role selection → onboarding → dashboard.
// Full-page window.location.replace avoids the ProtectedRoute bounce-back race.

type CallbackStatus =
  | 'processing'
  | 'success'
  | 'error'
  | 'country_gate'
  | 'provider_mismatch'
  | 'second_account';

/**
 * Why this sign-in could not continue on the provider that was attempted.
 *
 * Growlanzo accounts can ONLY be created with GitHub or LinkedIn, which is
 * what makes both cases answerable without asking the database anything:
 *
 *  - already_exists: GoTrue rejected the sign-in because the email already has
 *    an account, and the identity it just tried did NOT match it — so the
 *    account lives on the OTHER provider, named here with certainty (no lookup,
 *    no email enumeration, no second account created).
 *  - email_hidden: the provider handed us no usable address, so nothing can be
 *    matched or set up at all (GitHub gives "<id>+<uuid>@users.noreply.github.com"
 *    when the address is private).
 */
type ProviderMismatch =
  | { kind: 'already_exists'; existingProvider: OAuthProvider }
  | { kind: 'email_hidden'; attemptedProvider: OAuthProvider };

/**
 * How recent a profile row must be to count as "created by this signup", so the
 * welcome emails fire for the account the person just made — and never for a
 * returning user who merely signed in again.
 */
const SIGNUP_EMAIL_WINDOW_MS = 5 * 60 * 1000;
type AuthAction = 'signup' | 'recovery' | 'magiclink' | 'email_change' | 'invite' | 'reauthentication' | 'unknown';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // True heading for the failure — "Authentication failed" is wrong for a
  // sign-in the user cancelled or one the provider never finished.
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<ProviderMismatch | null>(null);
  // The identity that just signed in, when it is NOT the account this browser
  // already uses. Rendered as a question, never as a silent account switch.
  const [secondAccount, setSecondAccount] = useState<SecondAccountCandidate | null>(null);
  const [secondAttemptProvider, setSecondAttemptProvider] = useState<OAuthProvider>('github');
  const { signInWithOAuth } = useAuth();
  const [action, setAction] = useState<AuthAction>('unknown');

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      // True once the visitor explicitly agreed to create an additional account.
      let approvedSecondAccount = false;
      try {
        // ── 1. Detect auth action type ──
        // With flowType 'implicit', session tokens arrive in the URL hash
        // (#access_token=...&type=signup). React fires child effects before parent
        // effects, so THIS effect runs BEFORE AuthProvider's getSession() — the hash
        // is still present here and supabase-js hasn't stripped it yet. Read `type`
        // from BOTH the search string (email links carry ?type=signup) and the hash.
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const typeParam = (searchParams.get('type') || hashParams.get('type') || null) as
          | AuthAction
          | null;
        const detectedAction = typeParam || 'unknown';
        setAction(detectedAction);

        // Session resolution state. Declared here (not at step 5) because the
        // benign-error check below can already establish the session.
        let authUser: import('@supabase/supabase-js').User | null = null;
        let sessionFound = false;

        /**
         * Recover a session that REALLY exists (persisted storage, or the
         * implicit-flow tokens in the URL hash). Used only to decide whether an
         * `error` param describes the current state or just one stray request.
         */
        const recoverEstablishedSession = async () => {
          const existing = await supabase.auth
            .getSession()
            .catch(() => ({ data: { session: null } }));
          if (existing.data?.session?.user) return existing.data.session.user;

          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          if (!accessToken || !refreshToken) return null;

          const restored = await supabase.auth
            .setSession({ access_token: accessToken, refresh_token: refreshToken })
            .catch(() => ({ data: { session: null } }));
          return restored.data?.session?.user ?? null;
        };

        // ── 2. Check for OAuth error (search or hash) ──
        const error = searchParams.get('error') || hashParams.get('error');
        const errorDescription =
          searchParams.get('error_description') || hashParams.get('error_description');

        // 🛡️ A session that genuinely exists OUTRANKS an error param. Live case
        // (2026-10-10 16:26 UTC): GoTrue's /callback was hit twice — the first
        // request ran past this client's 15s abort, the user refreshed, and the
        // replay came back as
        //   ?error=invalid_request&error_code=bad_oauth_state
        // The signup had ALREADY succeeded (auth.users row + Login event fired),
        // but this page rendered "Authentication failed" — and leaving the page
        // killed the in-flight profile creation, leaving an account with no
        // profile that could never finish onboarding. An error param describes
        // one request; the session is the actual authentication state, so never
        // trade a real session for an error screen.
        if (error && await recoverEstablishedSession()) {
          devLog('[AuthCallback] ignoring auth error param — a valid session exists', {
            error,
            error_code: searchParams.get('error_code') || hashParams.get('error_code'),
          });
        } else if (error) {
          setStatus('error');
          const rawDescription = errorDescription?.replace(/\+/g, ' ') || '';
          // 🆕 Friendly duplicate-email message: the GitHub/LinkedIn account's
          // email is already used on Growlanzo — log in with the original
          // method instead of creating a second account.
          if (/already registered|already exists|already.*in use|duplicate/i.test(rawDescription)) {
            // 🔁 PROVIDER MISMATCH. Accounts can only be created with GitHub or
            // LinkedIn, so a duplicate-email rejection on THIS provider proves
            // the account was made on the other one. Name it and take the person
            // there in one click, instead of a generic "use the original method".
            const attemptedRaw =
              (searchParams.get('provider') as OAuthProvider | null) ||
              (readOAuthAttempt()?.provider as OAuthProvider | undefined) ||
              (localStorage.getItem('growlancer_oauth_provider') as OAuthProvider | null);
            const attempted =
              attemptedRaw === 'github' || attemptedRaw === 'linkedin_oidc' ? attemptedRaw : null;
            if (attempted) {
              devLog('[AuthCallback] provider mismatch — account exists on the other provider', {
                attempted,
                existing: alternateProvider(attempted),
              });
              // The failed attempt is answered; its breadcrumb must not survive
              // to stack an "unfinished sign-in" notice on top of this screen.
              clearOAuthAttempt();
              setMismatch({ kind: 'already_exists', existingProvider: alternateProvider(attempted) });
              setStatus('provider_mismatch');
              return;
            }
            setErrorMessage(
              'This email is already used professionally on Growlanzo. Continue with the provider the account was created with — or contact support if you previously signed up with email.'
            );
          } else {
            // Provider / GoTrue codes → the next action the user should take.
            // The provider is taken from the URL first, then the breadcrumb
            // written before the redirect — never guessed.
            const providerId =
              searchParams.get('provider') ||
              hashParams.get('provider') ||
              readOAuthAttempt()?.provider ||
              localStorage.getItem('growlancer_oauth_provider');
            const failure = describeOAuthFailure({
              provider: providerId,
              error,
              errorCode: searchParams.get('error_code') || hashParams.get('error_code'),
              description: rawDescription,
            });
            devLog('[AuthCallback] mapped OAuth failure', {
              provider: providerId,
              error,
              title: failure.title,
            });
            setErrorTitle(failure.title);
            setErrorMessage(failure.message);
          }
          return;
        }

        // ── 3. Handle magiclink type specially (has token_hash) ──
        if (detectedAction === 'magiclink') {
          const tokenHash = searchParams.get('token_hash');
          if (tokenHash) {
            const { error: verifyError } = await supabase.auth.verifyOtp({
              type: 'magiclink',
              token_hash: tokenHash,
            });

            if (verifyError) {
              setStatus('error');
              setErrorMessage(verifyError.message);
              return;
            }
          }
        }

        // ── 4. Handle signup/email_change verification via token_hash ──
        if (detectedAction === 'signup' || detectedAction === 'email_change') {
          const tokenHash = searchParams.get('token_hash');
          if (tokenHash) {
            const { error: verifyOtpError } = await supabase.auth.verifyOtp({
              type: detectedAction === 'email_change' ? 'email_change' : 'signup',
              token_hash: tokenHash,
            });

            // 🛡️ Invalid / expired verification link — show a clear error instead of
            // a misleading success (this is the primary email signup path now that
            // real email verification is enabled).
            if (verifyOtpError) {
              setStatus('error');
              setErrorMessage(
                verifyOtpError.message.includes('expired')
                  ? 'This verification link has expired. Please sign up again to receive a fresh link.'
                  : 'This verification link is invalid. Please sign up again to receive a fresh link.'
              );
              return;
            }
          }
        }

        // 4b. Welcome email disabled — Brevo removed. Verification handled by Supabase Auth.

        // ── 5. Get the current session (with retry + fallbacks) ──
        // (authUser / sessionFound are declared at the top of this handler.)
        // Try getSession with retry first — supabase-js's detectSessionInUrl usually
        // auto-exchanges the PKCE `code` on load, so getSession is the common path.
        // Mobile browsers can restore the callback session after a slower
        // provider/network handoff, so allow a short bounded recovery window.
        for (let attempt = 0; attempt < 7; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 500));
          try {
            const { data, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) continue;
            if (data.session?.user) {
              authUser = data.session.user;
              sessionFound = true;
              break;
            }
          } catch (sessionThrow) {
            devLog('[AuthCallback] getSession threw (attempt', attempt, '):',
              sessionThrow instanceof Error ? sessionThrow.message : String(sessionThrow));
          }
        }

        // 🆕 PKCE explicit exchange fallback: if no session after getSession retries
        // and a `code` param is present (e.g. the redirect chain through the homepage
        // fallback bounced here and the auto-detection was missed), exchange it now.
        if (!sessionFound) {
          const pkceCode = searchParams.get('code');
          if (pkceCode) {
            try {
              const { data: exchanged, error: exchangeError } = await supabase.auth
                .exchangeCodeForSession(pkceCode);
              if (!exchangeError && exchanged?.session?.user) {
                authUser = exchanged.session.user;
                sessionFound = true;
                devLog('[AuthCallback] PKCE code exchanged successfully');
              } else {
                devLog('[AuthCallback] PKCE exchange failed (may already be exchanged):',
                  exchangeError?.message || 'unknown');
              }
            } catch (pkceThrow) {
              devLog('[AuthCallback] PKCE exchange threw:',
                pkceThrow instanceof Error ? pkceThrow.message : String(pkceThrow));
            }
          }
        }

        // 🛡️ DIRECT implicit-flow session from the URL hash — run BEFORE the
        // getUser fallback. getSession() only reads localStorage; if supabase-js's
        // detectSessionInUrl hasn't persisted the OAuth tokens (or failed to),
        // there's no session in storage and getSession returns null. Building the
        // session here with setSession() PERSISTS it, so the post-callback redirect
        // actually has a session — otherwise ProtectedRoute bounces the user back
        // to login even though the GitHub/LinkedIn user exists.
        // (Confirmed via console: user found via getUser, but no session in
        //  storage → 'Protected route blocked unauthenticated' → back to login.)
        if (!sessionFound) {
          const hashAccessToken = hashParams.get('access_token');
          const hashRefreshToken = hashParams.get('refresh_token');
          if (hashAccessToken && hashRefreshToken) {
            devLog('[AuthCallback] Implicit-flow hash tokens present — setting session directly');
            try {
              const { data: setSessionData, error: setSessionErr } = await supabase.auth.setSession({
                access_token: hashAccessToken,
                refresh_token: hashRefreshToken,
              });
              if (!setSessionErr && setSessionData?.session?.user) {
                authUser = setSessionData.session.user;
                sessionFound = true;
                devLog('[AuthCallback] Session established from hash tokens');
              } else {
                devLog('[AuthCallback] setSession from hash failed:',
                  setSessionErr?.message || 'unknown');
              }
            } catch (setSessionThrow) {
              devLog('[AuthCallback] setSession from hash threw:',
                setSessionThrow instanceof Error ? setSessionThrow.message : String(setSessionThrow));
            }
          }
        }

        // If still no session, try silent refresh via getUser — but ONLY a real
        // session counts. A bare user (no persisted session) does NOT survive the
        // next page load and would bounce back to login.
        if (!sessionFound) {
          devLog('[AuthCallback] getSession failed — trying getUser + refresh');
          try {
            const { data: userData } = await supabase.auth.getUser();
            if (userData?.user) {
              const { data: refreshed } = await supabase.auth.refreshSession();
              if (refreshed?.session?.user) {
                authUser = refreshed.session.user;
                sessionFound = true;
              }
            }
          } catch (getUserThrow) {
            devLog('[AuthCallback] getUser/refresh threw:',
              getUserThrow instanceof Error ? getUserThrow.message : String(getUserThrow));
          }
        }

        // 🆕 localStorage-direct recovery: if supabase-js saved the OAuth session
        // to storage but the in-memory state is missing (e.g. _initialize raced or
        // failed partway), read the raw stored session and re-establish it. The
        // stored value is the full Session JSON (user included) under
        // sb-<project-ref>-auth-token.
        if (!sessionFound) {
          let storedKey = '';
          try {
            storedKey = `sb-${new URL(import.meta.env.VITE_SUPABASE_URL || '').host.split('.')[0]}-auth-token`;
          } catch {
            // env missing — skip
          }
          try {
            const raw = storedKey ? localStorage.getItem(storedKey) : null;
            if (raw && raw !== 'null') {
              const parsed = JSON.parse(raw) as
                | { access_token?: string; refresh_token?: string; user?: { id: string } | null }
                | null;
              if (parsed?.access_token && parsed?.refresh_token) {
                devLog('[AuthCallback] Recovered session from localStorage — re-establishing');
                await supabase.auth
                  .setSession({
                    access_token: parsed.access_token,
                    refresh_token: parsed.refresh_token,
                  })
                  .catch(() => ({ data: { session: null } }));
                const { data: recovered } = await supabase.auth
                  .getSession()
                  .catch(() => ({ data: { session: null } }));
                if (recovered?.session?.user) {
                  authUser = recovered.session.user;
                  sessionFound = true;
                  devLog('[AuthCallback] Session re-established from localStorage');
                }
              }
            }
          } catch (localRecoveryThrow) {
            devLog('[AuthCallback] localStorage session recovery failed:',
              localRecoveryThrow instanceof Error ? localRecoveryThrow.message : String(localRecoveryThrow));
          }
        }

        // ── 5b. 🛡️ Email verification gate ──
        // For a signup confirmation, the email MUST be confirmed before we route
        // the user onward. Never trust the frontend — supabase.auth.getUser() only
        // returns email_confirmed_at once Supabase has actually confirmed it.
        // OAuth providers (github/linkedin) auto-confirm the email at account
        // creation, so the gate only applies to email/password signups.
        const storedOAuthProvider = localStorage.getItem('growlancer_oauth_provider') || '';
        const authProvider = (authUser?.app_metadata?.provider as string | undefined) || storedOAuthProvider;
        const isProviderOAuth =
          authProvider === 'github' || authProvider === 'linkedin_oidc';
        const isOAuthFlow =
          detectedAction === 'unknown' || isProviderOAuth;

        if (sessionFound && authUser && detectedAction === 'signup' && !isOAuthFlow && !authUser.email_confirmed_at) {
          devLog('[AuthCallback] Signup session but email NOT confirmed yet');
          setStatus('error');
          setErrorMessage(
            'Your email is not confirmed yet. Check your inbox (and spam folder) for the verification link, then click it to activate your account.'
          );
          return;
        }

        // 🎯 Email/password signup with CONFIRMED email — show the plain "Email
        // verified ✓ — you can now close this window" screen and STOP. NEVER
        // auto-redirect this tab to onboarding: the user finishes in the ORIGINAL
        // tab via VerifyEmailPage's "I've verified, continue" button (or its
        // real-time listener), which routes to onboarding. This is the exact flow
        // requested: the confirm tab only ever says "verified, close this window".
        // (Covers confirm links that still point at /auth/callback — e.g. emails
        //  sent before the redirect target was switched to /auth/email-confirm.)
        if (sessionFound && authUser && detectedAction === 'signup' && !isOAuthFlow) {
          devLog('[AuthCallback] Email signup confirmed — showing close-window screen (no auto-onboarding)');
          // Brief success flash, then land on EmailConfirmPage's dedicated
          // "Email verified ✓ — close this window" screen (session is already
          // persisted, so it shows success instantly).
          setStatus('success');
          await new Promise(resolve => setTimeout(resolve, 1200));
          if (cancelled) return;
          window.location.replace('/auth/email-confirm');
          return;
        }

        // ✅ OAuth (GitHub/LinkedIn) users NEVER hit an email-confirmation gate —
        // the provider already verified identity at sign-in, so requiring another
        // app-level email confirmation would block brand-new users from onboarding
        // (the 'logged in but stuck on verify-email' bug). They proceed straight to
        // role selection → onboarding → dashboard. Verification can be done later
        // from Settings (email shows 'Not Verified' with a resend button).
        // Email/password signups keep their confirmation gate (handled above).

        if (!sessionFound) {
          // 🛡️ PKCE flow: if a `code` param is present in the URL but no session was
          // established, the verification link was expired/invalid — show a clear
          // error instead of a misleading success.
          const hasPkceCode = searchParams.get('code');

          // For signup/verification, handle success vs expired-link error properly
          if (detectedAction === 'signup' || detectedAction === 'email_change') {
            if (hasPkceCode) {
              devLog('[AuthCallback] PKCE code present but no session — link likely expired/invalid');
              setStatus('error');
              setErrorMessage(
                'This verification link is invalid or has expired. Once signed in, you can request a fresh verification email from Settings → Account.'
              );
              return;
            }

            // 🛡️ OAuth signup callbacks can arrive with type=signup in the URL.
            // NEVER send an OAuth (GitHub/LinkedIn) user back to /login — show a
            // clear, actionable error instead (the login redirect was a big part
            // of the 'OAuth login works but bounces back to login' bug).
            if (isProviderOAuth) {
              devLog('[AuthCallback] OAuth signup callback without session — showing error', {
                hasCode: !!searchParams.get('code'),
                error: searchParams.get('error'),
              });
              setStatus('error');
              setErrorMessage(
                'Your GitHub/LinkedIn sign-in did not complete. This usually means the redirect URL is not configured correctly. Add ' +
                window.location.origin + '/auth/callback to your Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.'
              );
              return;
            }

            // No code in URL — plain visit (e.g., user navigated here directly).
            // Email is confirmed; guide them to log in.
            setStatus('success');
            await new Promise(resolve => setTimeout(resolve, 1500));
            if (cancelled) return;
            safeNavigate(() => navigate('/login', { replace: true }));
            return;
          }

          // For OAuth (unknown), try one more thing — check URL hash directly
          devLog('[AuthCallback] All session recovery failed — showing error', {
            hasCode: !!searchParams.get('code'),
            hasError: !!searchParams.get('error'),
            hasHash: !!window.location.hash,
          });
          const isOAuthProvider = isProviderOAuth;
          setStatus('error');
          if (isOAuthProvider) {
            // The provider never handed us a code/session — say exactly that
            // instead of blaming the redirect configuration for every case.
            const failure = describeOAuthFailure({ provider: authProvider });
            setErrorTitle(failure.title);
            setErrorMessage(failure.message);
          } else {
            setErrorMessage('No session found. Please try logging in again.');
          }
          return;
        }

        if (cancelled) return;

        // ── 6. Handle specific actions ──
        if (detectedAction === 'recovery') {
          // Password recovery no longer exists (GitHub/LinkedIn sign-in only).
          // An old reset link must not dead-end on a removed route.
          setStatus('error');
          setErrorMessage(
            'Password reset is no longer available on Growlanzo. Please sign in with GitHub or LinkedIn instead.'
          );
          return;
        }          if (detectedAction === 'email_change') {
          // Sync the new email into profiles_private via SECURITY DEFINER RPC
          // (bypasses RLS + validate_india_phone trigger)
          if (authUser?.id && authUser.email) {
            const { error: emailSyncErr } = await (supabase.rpc as any)('sync_private_email', { p_email: authUser.email });
            if (emailSyncErr) devLog('[AuthCallback] email_change profile sync warning:', emailSyncErr.message);
          }
          setStatus('success');
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (cancelled) return;
          safeNavigate(() => navigate('/login', { replace: true }));
          return;
        }

        if (detectedAction === 'invite') {
          // 🆕 Accept the invitation in real time — mark accepted + apply the invited
          // role, then route the invitee through onboarding with role pre-selected.
          const inviteToken = searchParams.get('invite_token');
          const inviteRole = searchParams.get('invite_role');
          const invitedRole = inviteRole === 'client' ? 'client' : 'freelancer';

          if (authUser?.id && inviteToken) {
            // 1. Mark the invitation accepted (only if it's still pending)
            const { error: acceptErr } = await supabase
              .from('user_invitations' as any)
              .update({ status: 'accepted', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq('invite_token', inviteToken)
              .eq('status', 'pending');
            if (acceptErr) devLog('[AuthCallback] invite accept warning:', acceptErr.message);

            // 2. Apply the invited role to the profile — fetch it first, and create
            //    it with the invited role if it doesn't exist yet (brand-new
            //    invitee). No localStorage dependency — the role is persisted in
            //    the DB so onboarding and the dashboard both see it.
            let inviteProfile = authUser.id ? await fetchUserProfile(authUser.id) : null;
            if (!inviteProfile && authUser.id) {
              const name = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User';
              inviteProfile = await createProfile(authUser.id, authUser.email || '', name, invitedRole);
            }
            if (inviteProfile) {
              const { error: roleErr } = await supabase
                .from('profiles')
                .update({ role: invitedRole })
                .eq('id', authUser.id);
              if (roleErr) devLog('[AuthCallback] invite role warning:', roleErr.message);
            }
          }

          setStatus('success');
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (cancelled) return;
          safeNavigate(() => navigate('/onboarding', { replace: true }));
          return;
        }

        // ── 7. Country gate for OAuth signups ──
        // If user authenticated via OAuth and has no country set, show country confirmation.
        //
        // ⚡ No "Processing…" splash for a returning user. They asked to sign in,
        // the session is already established, so this page stays on the spinner
        // only for the profile read below (a single query) and then replaces
        // itself with their dashboard. The confirmation flash is reserved for
        // people who still have onboarding to do — see the fast path at the end.

        // 🆕 Read saved role from localStorage (preserved during OAuth signup)
        const savedRole = localStorage.getItem('growlancer_oauth_role');
        const oauthRole = (savedRole === 'freelancer' || savedRole === 'client') ? savedRole : 'freelancer';
        if (savedRole) {
          localStorage.removeItem('growlancer_oauth_role');
        }
        localStorage.removeItem('growlancer_oauth_provider');
        // The provider round-trip completed — drop the unanswered-sign-in
        // breadcrumb so no return notice can fire after a success.
        clearOAuthAttempt();

        // 🛡️ Only OAuth flows (detectedAction === 'unknown' OR a real OAuth provider)
        // get role correction from localStorage. Email signup users chose their role in
        // the signup form and it's already stored in the profile — never overwrite it
        // here (prevents a 'client' email signup being silently flipped to 'freelancer'
        // after email verification).
        // (isOAuthFlow computed above — includes provider-based detection so GitHub/
        //  LinkedIn signups keep their chosen role even when Supabase sends type=signup.)

        // ⚡ Fast profile fetch — the DB trigger creates the profile row synchronously on
        // auth.users insert, so a single fetch (plus one quick retry) is enough. No more
        // 5×600ms polling loop (was adding up to 3s of artificial delay).
        let profile = authUser?.id ? await fetchUserProfile(authUser.id) : null;
        if (!profile && authUser?.id) {
          await new Promise(r => setTimeout(r, 300));
          profile = await fetchUserProfile(authUser.id);
        }

        // 🔁 HIDDEN EMAIL — only for an identity that has NO account yet.
        // A private GitHub address comes back as "<id>+<uuid>@users.noreply.github.com".
        // Creating an account on it would leave the person with a second,
        // unreachable account: no welcome mail, no notifications, nothing that
        // can be recovered. A returning user who already has a profile is never
        // touched here — their account works, whatever the address looks like.
        if (authUser && isProviderOAuth && !profile) {
          const oauthEmail = authUser.email || '';
          const hiddenEmail =
            !oauthEmail || /@users\.noreply\.github\.com$/i.test(oauthEmail);
          if (hiddenEmail) {
            const attemptedRaw =
              (localStorage.getItem('growlancer_oauth_provider') as OAuthProvider | null) ||
              ((authProvider as OAuthProvider | undefined) ?? null);
            const attempted: OAuthProvider =
              attemptedRaw === 'linkedin_oidc' ? 'linkedin_oidc' : 'github';
            devLog('[AuthCallback] OAuth identity has no usable email — stopping before account creation', {
              provider: attempted,
            });
            // Drop the half-created identity locally: signing in with an address
            // nobody can reach is worse than signing in again. Storage is cleared
            // explicitly as well — the same belt-and-braces the rest of the app
            // uses, so the token cannot come back on the next page load.
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
            clearSupabaseAuthStorage();
            clearOAuthAttempt();
            setMismatch({ kind: 'email_hidden', attemptedProvider: attempted });
            setStatus('provider_mismatch');
            return;
          }
        }
        // 🛡️ SECOND-ACCOUNT GUARD — the case the mismatch screen cannot see.
        //
        // Someone whose account lives on LinkedIn taps "Continue with GitHub".
        // GitHub authenticates them with a DIFFERENT email, so GoTrue finds no
        // duplicate and creates a second account; the auth.users trigger then
        // writes an unfinished profile row for it. Nothing errors, and the person
        // silently ends up in a brand-new empty dashboard instead of their own.
        //
        // Signals, all of which must hold:
        //   • a provider OAuth sign-in,
        //   • a LOGIN intent (no role saved — SignupModal would have saved one),
        //   • an unfinished profile (the second account the trigger just created),
        //   • this browser already recorded a DIFFERENT account (same fingerprint),
        //   • and no explicit approval for an extra account.
        //
        // The incoming session is destroyed here rather than carried across the
        // question: identity we may not use must not stay live while the visitor
        // is deciding. Both answers re-run the provider once, which is the only
        // way back with a session we are allowed to keep.
        if (authUser && isProviderOAuth && !savedRole && (!profile || profile.onboardingCompleted === false)) {
          const candidate = detectSecondAccount(authUser.email);
          if (candidate && !consumeSecondAccountApproval()) {
            const attempted: OAuthProvider =
              authProvider === 'linkedin_oidc' ? 'linkedin_oidc' : 'github';
            devLog('[AuthCallback] second account detected — asking before anything continues', {
              attempted,
            });
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
            clearSupabaseAuthStorage();
            clearOAuthAttempt();
            setSecondAttemptProvider(attempted);
            setSecondAccount(candidate);
            setStatus('second_account');
            return;
          }
          if (candidate) {
            // Explicitly approved: this account may keep the new identity, and
            // the browser marker moves to it so the guard does not fire on every
            // future sign-in of the account they chose to create.
            approvedSecondAccount = true;
          }
        }

        if (profile && isOAuthFlow && savedRole && profile.role !== oauthRole) {
          // 🆕 Role correction ONLY when the user explicitly chose a role in the signup
          // modal (savedRole is set). Returning OAuth users (login flow, no savedRole)
          // keep their existing profile role — never flip a client to freelancer.
          try {
            const { error: roleUpdateErr } = await supabase
              .from('profiles')
              .update({ role: oauthRole })
              .eq('id', authUser!.id);
            if (!roleUpdateErr) {
              profile = { ...profile, role: oauthRole as 'freelancer' | 'client' | 'admin' };
            }
          } catch {
            // Non-critical — will be corrected on onboarding
          }
        }

        // 🆕 If profile still doesn't exist after retries, create one with the correct role
        // (OAuth: saved role; email signup: role from user_metadata set in the signup form)
        if (!profile && authUser?.id) {
          const name = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User';
          const metaRole = authUser.user_metadata?.role;
          const createRole = isOAuthFlow
            ? oauthRole
            : (metaRole === 'freelancer' || metaRole === 'client' ? metaRole : oauthRole);
          profile = await createProfile(
            authUser.id,
            authUser.email || '',
            name,
            createRole as 'freelancer' | 'client'
          );
          // 🆕 Retry once — the DB trigger and the RPC insert can race; a second
          // attempt usually lands (create_user_profile is idempotent via upsert).
          if (!profile && authUser?.id) {
            await new Promise(r => setTimeout(r, 500));
            profile = await createProfile(
              authUser.id,
              authUser.email || '',
              name,
              createRole as 'freelancer' | 'client'
            );
          }
        }

        // 📬 REAL-TIME WELCOME + VERIFICATION EMAILS
        // The moment a NEW account exists, the address the provider verified
        // hears about it: one welcome email (what they signed up as, what to do
        // next) and one "your email is verified" confirmation. OAuth sign-ins
        // get no Supabase confirmation link — this is the proof they receive.
        // Fire-and-forget: the account exists whether or not the send succeeds.
        if (profile && authUser?.email) {
          const createdAtMs = profile.createdAt ? Date.parse(profile.createdAt) : NaN;
          const isNewAccount =
            Number.isFinite(createdAtMs) && Date.now() - createdAtMs < SIGNUP_EMAIL_WINDOW_MS;
          // One send per account, ever — a reload, a retry or a second tab must
          // not turn a signup into three welcome emails.
          const sentKey = `growlancer_welcome_sent_${authUser.id}`;
          if (isNewAccount && !localStorage.getItem(sentKey)) {
            localStorage.setItem(sentKey, '1');
            const name =
              profile.name ||
              authUser.user_metadata?.name ||
              authUser.email.split('@')[0] ||
              'there';
            const provider = providerDisplayName(authProvider);
            devLog('[AuthCallback] new account — sending welcome + verification emails', {
              provider,
              role: profile.role,
            });
            void emailNotificationService.welcomeAccount({
              recipientEmail: authUser.email,
              recipientName: name,
              role: profile.role === 'client' ? 'client' : 'freelancer',
              provider,
            });
            void emailNotificationService.emailVerified({
              recipientEmail: authUser.email,
              recipientName: name,
              provider,
            });
          }
        }

        // 🆕 Country gate: If user has no profile country set (first-time OAuth), show country confirmation
        // Only for OAuth flows (unknown action) / invites — email signups already
        // provided an India phone number in the signup modal, so skip the gate.
        if (profile && !profile.country && profile.onboardingCompleted === false && detectedAction === 'unknown') {
          setStatus('country_gate');
          if (cancelled) return;
          return; // Stop — country confirmation UI will handle the redirect
        }

        // 🎯 ONE onboarding for everyone (email + OAuth + invite): redirectAfterAuth
        // always lands on /onboarding where the role is chosen on the welcome step.
        // 🛡️ GUARANTEE the session is in localStorage before redirecting.
        // getSession() can return an in-memory session even when supabase-js
        // didn't finish writing storage — the next page load had no session →
        // ProtectedRoute bounced back to login ("login works but back to login").
        // So we write the session + user directly under supabase-js's storage
        // keys, then confirm it reads back before redirecting.
        const sbUrl = import.meta.env.VITE_SUPABASE_URL || '';
        const sbKey = `sb-${new URL(sbUrl).host.split('.')[0]}-auth-token`;

        const sessionReady = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        let session = sessionReady.data?.session ?? null;

        // If no session in-memory (or storage), re-establish from URL tokens.
        if (!session?.user && hashParams.get('access_token') && hashParams.get('refresh_token')) {
          const re = await supabase.auth.setSession({
            access_token: hashParams.get('access_token')!,
            refresh_token: hashParams.get('refresh_token')!,
          }).catch(() => ({ data: { session: null } }));
          session = re.data?.session ?? null;
        }

        if (session?.access_token && session?.refresh_token) {
          // Write both the session and the separate user object supabase-js uses.
          localStorage.setItem(sbKey, JSON.stringify(session));
          localStorage.setItem(`${sbKey}-user`, JSON.stringify({ user: session.user }));
        }

        // Confirm the write actually landed in storage.
        const check = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const rawStored = localStorage.getItem(sbKey);
        if (!check.data?.session?.user && (!rawStored || rawStored === 'null')) {
          // One retry covers the common host-prefix storage race (the callback page
          // reads the in-memory session, writes it under the wrong key prefix, and
          // the next page load — reading the correct prefix — sees nothing). Without
          // the retry this is the "login works, back to homepage" bug.
          const retry = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          if (retry.data?.session?.user) {
            localStorage.setItem(sbKey, JSON.stringify(retry.data.session));
            localStorage.setItem(`${sbKey}-user`, JSON.stringify({ user: retry.data.session.user }));
          } else {
            // Still nothing — try once more to re-establish from the URL tokens if
            // they are still present (implicit-flow or a refresh that re-appended
            // the hash).
            const parsed = new URLSearchParams(window.location.hash.replace(/^#/, ''));
            const accessToken = parsed.get('access_token');
            const refreshToken = parsed.get('refresh_token');
            if (accessToken && refreshToken) {
              const re = await supabase.auth
                .setSession({ access_token: accessToken, refresh_token: refreshToken })
                .catch(() => ({ data: { session: null } }));
              if (re.data?.session?.user) {
                localStorage.setItem(sbKey, JSON.stringify(re.data.session));
                localStorage.setItem(`${sbKey}-user`, JSON.stringify({ user: re.data.session.user }));
              }
            }
          }
        }

        // Final confirmation before redirecting. If even the retry left nothing,
        // the session genuinely did not survive — render an error, never a silent
        // homepage drop.
        const confirm = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const confirmStored = localStorage.getItem(sbKey);
        if (!confirm.data?.session?.user && (!confirmStored || confirmStored === 'null')) {
          setStatus('error');
          setErrorMessage('Session could not be persisted. Please try again.');
          return;
        }

        devLog('[AuthCallback] redirectAfterAuth', {
          hasProfile: !!profile,
          role: profile?.role,
        });
        // Returning user (onboarding already done) → straight to the app.
        // Only an incomplete profile waits on the success screen, because the
        // onboarding page needs a beat before it can paint.
        if (profile?.onboardingCompleted === false) {
          setStatus('success');
          await new Promise(resolve => setTimeout(resolve, isProviderOAuth ? 350 : 1000));
          if (cancelled) return;
        }
        // 🎯 ONE onboarding for everyone — role chosen on the onboarding
        // welcome step (no separate OAuth role-selection mini-form).
        //
        // 📌 Point the browser marker at the account the visitor explicitly
        // chose to create. Without this the marker keeps the FIRST account, and
        // the second-account guard would question this sign-in forever.
        if (approvedSecondAccount && authUser?.email) {
          recordBrowserAccount(
            authUser.email,
            profile?.role,
            /* force */ true,
            authProvider === 'github' || authProvider === 'linkedin_oidc' ? authProvider : undefined
          );
        }
        redirectAfterAuth(profile);
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'An unexpected error occurred. Please try again.'
          );
        }
      }
    }

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  // ── Country Gate State ──
  // selectedCountry is the canonical country NAME ("India", "Brazil") exactly
  // as onboarding stores it — not an ISO code. Two spellings of the same
  // country are two rows in the admin waitlist and two groups in its chart.
  const [countryGateLoading, setCountryGateLoading] = useState(false);
  const [countryGateError, setCountryGateError] = useState<string | null>(null);

  const handleCountrySelect = async (selectedCountry: string) => {
    // Double-tap guard: the dropdown rows stay clickable while a submit is in
    // flight (only the trigger is disabled), and two writes would race.
    if (countryGateLoading) return;
    setCountryGateLoading(true);
    setCountryGateError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;

      if (!userId) {
        setCountryGateError('Session expired. Please log in again.');
        setCountryGateLoading(false);
        return;
      }

      if (selectedCountry === 'India') {
        // Save country as India — proceed normally
        const { error: countryErr } = await supabase.rpc('update_user_country', {
          p_user_id: userId,
          p_country: 'India',
        });
        if (countryErr) {
          // Non-blocking: still continue to onboarding, but log so we can fix silently
          devLog('[AuthCallback] update_user_country RPC warning:', countryErr.message);
        }

        // Resolve the profile for the redirect. A brand-new OAuth user's profile
        // row can lag behind the auth.users row by a few hundred ms, so retry once.
        let profile = await fetchUserProfile(userId);
        if (!profile) {
          await new Promise(r => setTimeout(r, 300));
          profile = await fetchUserProfile(userId);
        }

        // 🛡️ FULL PAGE redirect — same reason as the main callback flow above.
        // Avoids the ProtectedRoute bounce-back race after country selection.
        // Country gate is only reachable for OAuth flows — one onboarding for
        // everyone (role chosen on the welcome step).
        //
        // Persist-and-confirm the session the SAME way the main callback does,
        // because the country gate can be reached after a callback that did not
        // finish persisting (e.g. a refresh mid-flow). A redirect that fires with
        // a dead token is exactly the "logged in, back to homepage" bug.
        const sbUrl = import.meta.env.VITE_SUPABASE_URL || '';
        const sbKey = `sb-${new URL(sbUrl).host.split('.')[0]}-auth-token`;

        const sessionReady = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        let session = sessionReady.data?.session ?? null;

        if (!session?.user && window.location.hash) {
          const parsed = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const accessToken = parsed.get('access_token');
          const refreshToken = parsed.get('refresh_token');
          if (accessToken && refreshToken) {
            const re = await supabase.auth
              .setSession({ access_token: accessToken, refresh_token: refreshToken })
              .catch(() => ({ data: { session: null } }));
            session = re.data?.session ?? null;
          }
        }

        // If the callback left a persisted session, make sure it still reads back.
        // One retry covers the common host-prefix storage race without hiding a
        // genuine failure behind a misleading success.
        if (!session?.access_token) {
          const retry = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          session = retry.data?.session ?? null;
        }

        if (session?.access_token && session?.refresh_token) {
          localStorage.setItem(sbKey, JSON.stringify(session));
          localStorage.setItem(`${sbKey}-user`, JSON.stringify({ user: session.user }));
        }

        const check = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const rawStored = localStorage.getItem(sbKey);
        if (!check.data?.session?.user && (!rawStored || rawStored === 'null')) {
          // The session did not survive — re-establish from the provider redirect
          // tokens if they are still in the URL, otherwise ask the user to retry.
          const parsed = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const accessToken = parsed.get('access_token');
          const refreshToken = parsed.get('refresh_token');
          if (accessToken && refreshToken) {
            const re = await supabase.auth
              .setSession({ access_token: accessToken, refresh_token: refreshToken })
              .catch(() => ({ data: { session: null } }));
            if (re.data?.session?.user) {
              localStorage.setItem(sbKey, JSON.stringify(re.data.session));
              localStorage.setItem(`${sbKey}-user`, JSON.stringify({ user: re.data.session.user }));
            }
          }
        }

        const finalCheck = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        if (!finalCheck.data?.session?.user) {
          setCountryGateError('Your sign-in did not finish persisting. Please try again.');
          setCountryGateLoading(false);
          return;
        }

        redirectAfterAuth(profile);
      } else {
        // Non-India country — insert into waitlist, redirect to /waitlist
        const email = sessionData.session?.user?.email || '';
        const oauthName = sessionData.session?.user?.user_metadata?.name
          || sessionData.session?.user?.user_metadata?.full_name
          || sessionData.session?.user?.user_metadata?.user_name
          || null;
        await supabase.rpc('join_waitlist', {
          p_email: email,
          p_country: selectedCountry,
          p_signup_source: 'oauth',
          p_user_id: userId,
          p_name: oauthName,
        });

        safeNavigate(() => navigate('/waitlist', { replace: true }));
      }
    } catch (err) {
      setCountryGateError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      );
      setCountryGateLoading(false);
    }
  };

  /**
   * The one-click way back to the provider the account actually lives on.
   * The failed attempt is already answered, so its breadcrumb must not survive
   * into the retry.
   */
  const handleMismatchRetry = async (provider: OAuthProvider) => {
    clearOAuthAttempt();
    const result = await signInWithOAuth(provider);
    if (!result.success) {
      setMismatch(null);
      setErrorTitle(`Could not open ${providerDisplayName(provider)}`);
      setErrorMessage(result.error || 'Please try again.');
      setStatus('error');
    }
  };

  /**
   * "That is not my account" — go back to the provider the recorded account
   * lives on. The failed attempt is already answered, so its breadcrumb must
   * not survive into the retry.
   */
  const handleSecondAccountUseExisting = async (provider: OAuthProvider) => {
    clearOAuthAttempt();
    const result = await signInWithOAuth(provider);
    if (!result.success) {
      setSecondAccount(null);
      setErrorTitle(`Could not open ${providerDisplayName(provider)}`);
      setErrorMessage(result.error || 'Please try again.');
      setStatus('error');
    }
  };

  /**
   * "Yes, create a second account" — an explicit decision, recorded once, then
   * straight back to the provider. The callback sees the approval, skips the
   * question and continues into onboarding with the new identity.
   */
  const handleSecondAccountCreate = async (provider: OAuthProvider) => {
    approveSecondAccount();
    clearOAuthAttempt();
    const result = await signInWithOAuth(provider);
    if (!result.success) {
      setSecondAccount(null);
      setErrorTitle(`Could not open ${providerDisplayName(provider)}`);
      setErrorMessage(result.error || 'Please try again.');
      setStatus('error');
    }
  };

  const mismatchView = mismatch
    ? {
        title:
          mismatch.kind === 'already_exists'
            ? `Your Growlanzo account is on ${providerDisplayName(mismatch.existingProvider)}`
            : `We could not read an email address from ${providerDisplayName(mismatch.attemptedProvider)}`,
        message:
          mismatch.kind === 'already_exists'
            ? `You already have an account — it was created with ${providerDisplayName(mismatch.existingProvider)}, so that is where your profile, contracts and payouts live. Sign in with ${providerDisplayName(mismatch.existingProvider)} and you go straight back to your dashboard. No second account was created, and nothing on your account changed.`
            : `${providerDisplayName(mismatch.attemptedProvider)} did not share an email address with Growlanzo, so we cannot create your account or send you anything there. Make your email visible in your ${providerDisplayName(mismatch.attemptedProvider)} account settings, then try again — or continue with the other provider if that is where your account is.`,
        retryProvider:
          mismatch.kind === 'already_exists'
            ? mismatch.existingProvider
            : alternateProvider(mismatch.attemptedProvider),
        retryLabel:
          mismatch.kind === 'already_exists'
            ? `Continue with ${providerDisplayName(mismatch.existingProvider)}`
            : `Continue with ${providerDisplayName(alternateProvider(mismatch.attemptedProvider))}`,
      }
    : null;

  const actionTitles: Record<AuthAction, string> = {
    signup: 'Email verified successfully!',
    recovery: 'Password reset link verified!',
    magiclink: 'Signing you in...',
    email_change: 'Email updated successfully!',
    invite: 'Welcome to Growlanzo!',
    reauthentication: 'Identity verified!',
    unknown: 'Signing you in…',
  };

  const actionDescriptions: Record<AuthAction, string> = {
    signup: 'Your email has been confirmed. Setting up your account...',
    recovery: 'Redirecting you to set a new password...',
    magiclink: 'You will be signed in automatically...',
    email_change: 'Your email has been changed. Redirecting to login...',
    invite: 'Setting up your account. Redirecting to onboarding...',
    reauthentication: 'Your identity has been verified.',
    unknown: 'Hang on a moment — opening your account…',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-3xl shadow-lg border border-slate-200 p-8 text-center">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <BrandLogo variant="full" className="h-14 w-auto" />
          </div>

          {status === 'processing' && (
            <div className="animate-fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                </div>
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
                {actionTitles[action]}
              </h2>
              <p className="text-sm text-slate-500">
                {actionDescriptions[action]}
              </p>
            </div>
          )}

          {status === 'success' && (
            <div className="animate-fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
                {actionTitles[action]}
              </h2>
              <p className="text-sm text-slate-500">
                {actionDescriptions[action]}
              </p>
            </div>
          )}

          {/* 🆕 Country Gate UI — shown after OAuth for users without country set */}
          {status === 'country_gate' && (
            <div className="animate-fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                  <MapPin className="w-8 h-8 text-emerald-600" />
                </div>
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
                Where are you located?
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Growlanzo is currently available in <strong>India</strong>. Select your country to continue.
              </p>

              {/* Country Options */}
              <div className="space-y-3 mb-6">
                {/* India — Enabled */}
                <button
                  onClick={() => handleCountrySelect('India')}
                  disabled={countryGateLoading}
                  className="w-full flex items-center gap-4 p-4 bg-emerald-50 border-2 border-emerald-500 rounded-xl hover:bg-emerald-100 transition-colors text-left group disabled:opacity-50"
                >
                  <span className="text-3xl">🇮🇳</span>
                  <div className="flex-1">
                    <p className="font-bold text-slate-900">India</p>
                    <p className="text-xs text-emerald-600 font-medium">Available now</p>
                  </div>
                  {countryGateLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  ) : (
                    <ArrowRight className="w-5 h-5 text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>

                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Or pick your country — all countries, A→Z
                  </p>
                  {/* Same component onboarding uses: the list can never drift
                      from the sign-up flow, and every country here joins the
                      waitlist with its canonical name. */}
                  <CountrySelect
                    value=""
                    placeholder="Search your country..."
                    disabled={countryGateLoading}
                    // onPick owns every tap here; onChange is the same destination
                    // so the gate stays correct even if the picker falls back.
                    onChange={(name) => void handleCountrySelect(name)}
                    onPick={(country) => void handleCountrySelect(country.name)}
                  />
                  <p className="px-1 pt-2 text-[11px] text-slate-400">
                    Not India yet? Pick your country and we'll email you the moment Growlanzo
                    launches there.
                  </p>
                </div>
              </div>

              {countryGateError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-xs text-red-600">{countryGateError}</p>
                </div>
              )}

              <p className="text-xs text-slate-400">
                By continuing, you agree to our{' '}
                <a href="/terms" className="text-emerald-600 hover:underline">Terms of Service</a>
              </p>
            </div>
          )}

          {/* 🔁 Provider mismatch — the account exists, just not on this provider. */}
          {status === 'provider_mismatch' && mismatch && mismatchView && (
            <div className="animate-fade-in">
              <div className="flex justify-center mb-4">
                <div
                  className={`h-16 w-16 rounded-2xl flex items-center justify-center ${
                    mismatch.kind === 'already_exists' ? 'bg-amber-100' : 'bg-red-100'
                  }`}
                >
                  {mismatch.kind === 'already_exists' ? (
                    <AlertTriangle className="w-8 h-8 text-amber-500" />
                  ) : (
                    <XCircle className="w-8 h-8 text-red-500" />
                  )}
                </div>
              </div>

              <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
                {mismatchView.title}
              </h2>
              <p className="text-sm text-slate-500 mb-6">{mismatchView.message}</p>

              <button
                onClick={() => void handleMismatchRetry(mismatchView.retryProvider)}
                className="w-full inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                {mismatchView.retryLabel}
              </button>
              <button
                onClick={() => safeNavigate(() => navigate('/', { replace: true }))}
                className="mt-3 inline-flex items-center justify-center h-10 px-6 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
              >
                Back to home
              </button>

              <p className="mt-4 text-xs text-slate-400 leading-relaxed">
                Growlanzo accounts are created with GitHub or LinkedIn — there is no separate
                password account, so nothing can be lost by signing in with the right provider.
              </p>
            </div>
          )}

          {/* 🛡️ Different identity on this browser — ask before creating a second account. */}
          {status === 'second_account' && secondAccount && (
            <div className="animate-fade-in text-left">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-2xl bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                </div>
              </div>

              <h2 className="font-display text-xl font-bold text-slate-900 mb-2 text-center">
                This is a different account
              </h2>

              <p className="text-sm text-slate-500 mb-3 leading-relaxed">
                {providerDisplayName(secondAttemptProvider)} signed you in as{' '}
                <strong className="text-slate-700 break-all">{secondAccount.incomingEmail}</strong>,
                but this browser already uses{' '}
                <strong className="text-slate-700 break-all">{secondAccount.existingEmail}</strong>
                {secondAccount.existingProvider
                  ? ` — signed in with ${providerDisplayName(secondAccount.existingProvider)}`
                  : ''}
                .
              </p>

              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-5">
                <p className="text-xs text-amber-800 leading-relaxed">
                  Continuing here would create a <strong>second Growlanzo account</strong> with its own
                  dashboard, contracts and payouts. Nothing on your existing account has been changed
                  or deleted, and no second account has been created yet — you are signed out until
                  you choose.
                </p>
              </div>

              <button
                onClick={() =>
                  void handleSecondAccountUseExisting(
                    secondAccount.existingProvider ?? alternateProvider(secondAttemptProvider)
                  )
                }
                className="w-full inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Sign in to my existing account
              </button>

              <button
                onClick={() => void handleSecondAccountCreate(secondAttemptProvider)}
                className="mt-3 w-full inline-flex items-center justify-center h-11 px-6 rounded-xl bg-white text-slate-700 ring-1 ring-slate-200 font-semibold hover:bg-slate-50 hover:ring-slate-300 transition-colors"
              >
                Create a new account with {providerDisplayName(secondAttemptProvider)}
              </button>

              <p className="mt-4 text-xs text-slate-400 leading-relaxed text-center">
                Only choose “create a new account” if you really want a separate account — for
                example a client account alongside your freelancer one.
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="animate-fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-2xl bg-red-100 flex items-center justify-center">
                  <XCircle className="w-8 h-8 text-red-500" />
                </div>
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
                {errorTitle || `Authentication failed`}
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                {errorMessage || 'Something went wrong. Please try again.'}
              </p>
              <button
                onClick={() => safeNavigate(() => navigate('/?modal=login', { replace: true }))}
                className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
              >
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
