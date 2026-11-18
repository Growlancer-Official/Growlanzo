import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Briefcase, AlertCircle, ShieldCheck, X, Mail, Lock, Loader2, UserPlus } from 'lucide-react';
import { supabase, clearSupabaseAuthStorage, isStaleSessionError } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from './Modal';
import { OAuthButtons } from './OAuthButtons';

interface SignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToLogin: () => void;
  initialRole?: 'freelancer' | 'client';
}

/**
 * ⚠️ TEMPORARY: email + password sign-up, for testing the full journey.
 *
 * Mirrors the DEV-only password login in `LoginModal`. Production launch is
 * OAuth-only (GitHub + LinkedIn), so in a production build the form is not
 * rendered unless the deployment explicitly opts in with
 * `VITE_ENABLE_EMAIL_PASSWORD_AUTH=true` — which is how a hosted preview can be
 * tested without shipping password auth to real users.
 *
 * Explicit property access (never a computed lookup on `import.meta.env`):
 * Vike replaces a bare env expression with `null` at build time.
 */
const TESTING_EMAIL_PASSWORD =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_EMAIL_PASSWORD_AUTH === 'true';

/**
 * SignupModal — GitHub / LinkedIn sign-up only.
 *
 * The user picks how they want to use Growlanzo (freelance or hire talent),
 * then continues with a provider. The chosen role is persisted by
 * `signInWithOAuth` (localStorage → read back by AuthCallbackPage after the
 * redirect) and the profile row is created from the provider's name/email —
 * there is no signup form to fill.
 *
 * Referral links keep working: `signInWithOAuth` also captures `?ref=…` from
 * the URL before leaving for the provider, and AuthContext applies it on the
 * way back.
 */
export function SignupModal({ isOpen, onClose, onSwitchToLogin, initialRole }: SignupModalProps) {
  const navigate = useNavigate();
  const { signInWithOAuth } = useAuth();

  const [role, setRole] = useState<'freelancer' | 'client' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingUser, setExistingUser] = useState(false);

  // ── Email/password sign-up (testing only — see TESTING_EMAIL_PASSWORD) ──
  const [emailName, setEmailName] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  // Set once Supabase has accepted the sign-up but wants the address confirmed
  // first. This is the honest "not verified yet" state: nothing is activated
  // until the user opens the link, so an account is never silently confirmed.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);

  // Sync role from initialRole when modal opens (only if explicitly provided via URL)
  useEffect(() => {
    if (isOpen && initialRole) {
      setRole(initialRole);
    } else if (isOpen && !initialRole) {
      setRole(null);
    }
    if (isOpen) {
      // Never carry a half-typed password or a stale "check your inbox" state
      // into the next time the modal is opened.
      setEmailName('');
      setEmailAddress('');
      setEmailPassword('');
      setAwaitingConfirmation(null);
      setError(null);
    }
  }, [isOpen, initialRole]);

  // Check if there's already a VALID session on this device.
  // Uses getUser() (server-validated) instead of getSession() (localStorage
  // only) — a stale token for a deleted user would otherwise show the
  // "Already logged in" banner forever. Dead sessions are force-cleared.
  useEffect(() => {
    async function checkSession() {      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) return;
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (isStaleSessionError(userError)) {
        // 🔥 Stale session for a deleted user — clear it so it stops blocking auth.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        clearSupabaseAuthStorage();
        setExistingUser(false);
        return;
      }
      if (userError || !userData?.user) return; // transient network — don't show banner
      setExistingUser(true);
    }
    checkSession();
  }, [isOpen]);

  /**
   * Create an account with email + password (testing path).
   *
   * Email confirmation stays ON: `signUp` returns no session until the link in
   * the inbox is opened, so an address is never marked verified on the user's
   * behalf — that is the whole point of keeping verification in the profile.
   * The chosen role is persisted in the same key the OAuth flow uses
   * (`growlancer_oauth_role`) so the shared profile-creation path picks it up.
   */
  const handleEmailSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!role) {
      setError('Please choose Freelance or Hire Talent to continue.');
      return;
    }
    const fullName = emailName.trim();
    if (fullName.split(/\s+/).filter(Boolean).length < 2) {
      setError('Enter your full name (first and last).');
      return;
    }
    const cleanEmail = emailAddress.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (emailPassword.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }

    setEmailSubmitting(true);
    try {
      localStorage.setItem('growlancer_oauth_role', role);
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: emailPassword,
        options: {
          data: { name: fullName, role },
          emailRedirectTo: `${window.location.origin}/auth/email-confirm`,
        },
      });

      if (signUpError) {
        const message = signUpError.message || '';
        setError(
          /already|registered|exists/i.test(message)
            ? 'That email already has an account. Use "Log in here" instead.'
            : message
        );
        return;
      }

      // A session here means confirmation is disabled on the project. Otherwise
      // the account exists but stays inactive until the emailed link is opened.
      if (data.session) {
        onClose();
        navigate('/onboarding');
        return;
      }
      setAwaitingConfirmation(cleanEmail);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create the account. Please try again.'
      );
    } finally {
      setEmailSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create your account" brand>
      {/* Subtle Background Decorations */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-100/50 rounded-full blur-2xl -mr-12 -mt-12 opacity-60 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-orange-100/50 rounded-full blur-2xl -ml-12 -mb-12 opacity-60 pointer-events-none"></div>

      <div className="relative animate-fade-in-content">
        <p className="text-slate-500 mb-5 text-sm">
          Tell us how you want to use Growlanzo, then continue with GitHub or LinkedIn. Your
          profile is created automatically.
        </p>

        {/* ⚠️ Existing Session Banner — Dismissible, NOT blocking */}
        {existingUser && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800">Already logged in</p>
                <p className="text-xs text-amber-600 leading-relaxed">
                  You can still create a new account below. Logging out first is recommended.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => { onClose(); navigate(role === 'client' ? '/client' : '/dashboard'); }}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline px-2 py-1"
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    onClose();
                    await supabase.auth.signOut().catch(() => {});
                    clearSupabaseAuthStorage();
                    window.location.href = '/';
                  }}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline px-2 py-1"
                >
                  Logout
                </button>
                <button
                  type="button"
                  onClick={() => setExistingUser(false)}
                  className="p-1 rounded-lg hover:bg-amber-100 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4 text-amber-500" />
                </button>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-amber-200/50">
              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut().catch(() => {});
                  clearSupabaseAuthStorage();
                  setExistingUser(false);
                }}
                className="w-full py-2 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
              >
                ← Log out of the current account
              </button>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Role Selection */}
        <div className="space-y-1.5 mb-5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
            I want to…
          </label>
          <div className="grid grid-cols-2 gap-3.5 sm:gap-3">
            <label
              className={`cursor-pointer flex items-center gap-3 sm:gap-3.5 p-2.5 sm:p-3.5 border-2 rounded-xl transition-all min-w-0 ${
                role === 'freelancer'
                  ? 'border-emerald-500 bg-emerald-50/50 shadow-sm shadow-emerald-500/10'
                  : role === null
                  ? 'border-slate-200 hover:border-orange-300 bg-slate-50/50 hover:bg-orange-50/30'
                  : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-100/50'
              }`}
            >
              <input
                type="radio"
                name="role"
                value="freelancer"
                checked={role === 'freelancer'}
                onChange={() => { setRole('freelancer'); setError(null); }}
                className="sr-only"
              />
              <div className={`shrink-0 flex items-center justify-center w-7 h-7 sm:w-9 sm:h-9 rounded-lg border ${
                role === 'freelancer'
                  ? 'bg-emerald-100 border-emerald-200 text-emerald-600'
                  : role === null
                  ? 'bg-white border-orange-200 text-slate-400'
                  : 'bg-white border-slate-200 text-slate-400'
              } transition-all`}>
                <User className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-slate-800 truncate">Freelance</span>
                <span className="text-xs text-slate-400 hidden sm:block truncate">Work &amp; earn</span>
              </div>
            </label>
            <label
              className={`cursor-pointer flex items-center gap-3 sm:gap-3.5 p-2.5 sm:p-3.5 border-2 rounded-xl transition-all min-w-0 ${
                role === 'client'
                  ? 'border-emerald-500 bg-emerald-50/50 shadow-sm shadow-emerald-500/10'
                  : role === null
                  ? 'border-slate-200 hover:border-orange-300 bg-slate-50/50 hover:bg-orange-50/30'
                  : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-100/50'
              }`}
            >
              <input
                type="radio"
                name="role"
                value="client"
                checked={role === 'client'}
                onChange={() => { setRole('client'); setError(null); }}
                className="sr-only"
              />
              <div className={`shrink-0 flex items-center justify-center w-7 h-7 sm:w-9 sm:h-9 rounded-lg border ${
                role === 'client'
                  ? 'bg-emerald-100 border-emerald-200 text-emerald-600'
                  : role === null
                  ? 'bg-white border-orange-200 text-slate-400'
                  : 'bg-white border-slate-200 text-slate-400'
              } transition-all`}>
                <Briefcase className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-slate-800 truncate">Hire Talent</span>
                <span className="text-xs text-slate-400 hidden sm:block truncate">Find &amp; hire</span>
              </div>
            </label>
          </div>
          {role === null && (
            <p className="text-xs text-slate-400 ml-1">
              Choose one to continue — the providers stay locked until you do.
            </p>
          )}
        </div>

        {/* GitHub & LinkedIn — the only sign-up methods */}
        <OAuthButtons
          onSelect={async (provider) => {
            setError(null);
            if (!role) {
              // ⚠️ The reason MUST travel in the RETURN value, not only through
              // setError: OAuthButtons reports failures with
              //   onError?.(result.error || 'Sign-in could not start…')
              // so a bare `{ success: false }` is immediately overwritten by
              // that generic fallback (measured 2026-10-13: clicking a provider
              // with no role selected told the user to "try again" — advice that
              // fails identically — instead of asking for the missing choice).
              return {
                success: false,
                error: 'Please choose Freelance or Hire Talent to continue.',
              };
            }
            return signInWithOAuth(provider, role);
          }}
          onError={setError}
        />

        {/* ⚠️ TEMPORARY: email + password sign-up for testing — hidden in a
            production build unless VITE_ENABLE_EMAIL_PASSWORD_AUTH=true. */}
        {TESTING_EMAIL_PASSWORD && (
          <>
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-500">
                  or sign up with email (testing only)
                </span>
              </div>
            </div>

            {awaitingConfirmation ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-900">
                  Confirm your email to activate the account
                </p>
                <p className="mt-1 text-xs leading-relaxed text-emerald-800">
                  We sent a confirmation link to{' '}
                  <span className="font-semibold break-all">{awaitingConfirmation}</span>. Your
                  email is <span className="font-semibold">not verified yet</span> — the account
                  stays inactive until you open that link, so nothing is auto-confirmed.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate(
                      `/auth/verify-email?email=${encodeURIComponent(awaitingConfirmation)}`
                    );
                  }}
                  className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  I&apos;ve confirmed — continue
                </button>
              </div>
            ) : (
              <form onSubmit={handleEmailSignup} className="space-y-3">
                <div>
                  <label
                    htmlFor="signup-name"
                    className="mb-1.5 block text-xs font-medium text-slate-700"
                  >
                    Full name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="signup-name"
                      type="text"
                      autoComplete="name"
                      value={emailName}
                      onChange={(e) => setEmailName(e.target.value)}
                      placeholder="e.g. Asha Rao"
                      disabled={emailSubmitting}
                      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="signup-email"
                    className="mb-1.5 block text-xs font-medium text-slate-700"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      value={emailAddress}
                      onChange={(e) => setEmailAddress(e.target.value)}
                      placeholder="you@example.com"
                      disabled={emailSubmitting}
                      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="signup-password"
                    className="mb-1.5 block text-xs font-medium text-slate-700"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      disabled={emailSubmitting}
                      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={emailSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:bg-emerald-400"
                >
                  {emailSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating account…
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      Create account with email
                    </>
                  )}
                </button>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  We email you a confirmation link. Your address is marked verified only after you
                  open it — never automatically.
                </p>
              </form>
            )}
          </>
        )}

        {/* Trust note — honest, Growlanzo-branded */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-100 p-3">
          <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-500 leading-relaxed">
            We use the name and email from your provider to create your Growlanzo profile. We
            never see your password and never post anything to your accounts.
          </p>
        </div>

        {/* Terms */}
        <p className="mt-4 text-center text-xs text-slate-400 leading-relaxed">
          By creating an account, you agree to our{' '}
          <Link to="/terms" className="text-emerald-600 font-medium hover:text-emerald-700 transition-colors">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="text-emerald-600 font-medium hover:text-emerald-700 transition-colors">
            Privacy Policy
          </Link>
          .
        </p>

        {/* Login Redirect */}
        <div className="mt-5 text-center">
          <p className="text-slate-600 text-sm">
            Already have an account?{' '}
            <button
              onClick={onSwitchToLogin}
              className="text-emerald-600 font-semibold hover:text-emerald-700 transition-all duration-200 hover:scale-105"
            >
              Log in here
            </button>
          </p>
        </div>
      </div>
    </Modal>
  );
}
