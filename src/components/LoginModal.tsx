import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Clock, Loader2, ShieldCheck, Mail, Lock, LogIn, X } from 'lucide-react';
import { supabase, clearSupabaseAuthStorage, hasPersistedAuthSession, isStaleSessionError } from '../lib/supabase';
import { readLogoutNotice, clearLogoutNotice, LOGOUT_NOTICE_COPY } from '../lib/logoutNotice';
import { useAuth } from '../context/AuthContext';
import { getPostAuthPath } from '../lib/authAction';
import { Modal } from './Modal';
import { OAuthButtons } from './OAuthButtons';

/**
 * ⚠️ TEMPORARY: Email/password login for E2E testing only.
 * This will be removed after full end-to-end testing is complete.
 * Removed because: production launch uses OAuth-only (GitHub + LinkedIn).
 * Kept temporarily so test accounts (created with email+password) can be tested.
 */
// Dev-only: Vite statically replaces import.meta.env.DEV with `false` in a
// production build, so this temporary password form can never reach real users.
const TESTING_EMAIL_PASSWORD = import.meta.env.DEV;

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToSignup: () => void;
}

/**
 * LoginModal — GitHub / LinkedIn sign-in only.
 *
 * Growlanzo has no email/password login: identity comes from the provider,
 * and the session + profile are created by the shared OAuth callback flow.
 * Removing the password form also removes that attack surface entirely —
 * there is no password to phish, spray or reset.
 *
 * 🔁 RETURNING USERS NEVER SEE THIS FORM. Once someone has signed up, their
 * session is persisted (supabase-js `persistSession`), so opening the login
 * entry point again walks them straight into the app: no provider chooser, no
 * second GitHub/LinkedIn round trip, no "Processing…" page. The form only ever
 * renders for a visitor with no valid session. Switching accounts stays
 * possible through the explicit "use a different account" action, which signs
 * out first.
 */
export function LoginModal({ isOpen, onClose, onSwitchToSignup }: LoginModalProps) {
  const navigate = useNavigate();
  const { signInWithOAuth, user, session, isAuthenticated, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [signedInOnThisDevice, setSignedInOnThisDevice] = useState(false);
  // Why the last session ended, when the app itself ended it (24h inactivity).
  // Read once on open and dropped immediately so it never shows twice.
  const [logoutNotice, setLogoutNotice] = useState<{ title: string; message: string } | null>(null);

  // ⚠️ TEMPORARY: Email/password form state for testing
  const [emailPasswordEmail, setEmailPasswordEmail] = useState('');
  const [emailPasswordPassword, setEmailPasswordPassword] = useState('');
  const [emailPasswordLoading, setEmailPasswordLoading] = useState(false);
  const [emailPasswordError, setEmailPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const notice = readLogoutNotice();
    if (notice) {
      setLogoutNotice(LOGOUT_NOTICE_COPY[notice.reason]);
      clearLogoutNotice();
    }
    // Reset email/password form when modal opens
    if (TESTING_EMAIL_PASSWORD) {
      setEmailPasswordEmail('');
      setEmailPasswordPassword('');
      setEmailPasswordError(null);
    }
  }, [isOpen]);

  // Read the persisted token synchronously on open: it is the only instant
  // evidence that this visitor already has an account on this device, and it
  // decides whether the provider buttons may be shown while auth restores.
  useEffect(() => {
    if (isOpen) setSignedInOnThisDevice(hasPersistedAuthSession());
  }, [isOpen]);

  const hasSession = Boolean(session) || isAuthenticated;
  /**
   * ⛔ The window that used to send returning users back to the provider: a
   * session exists (or its token is in storage) but the app has not finished
   * restoring it. Offering "Continue with GitHub" here means the person taps
   * it and is walked through LinkedIn/GitHub again for an account they already
   * have. While `restoring` is true, the modal shows the resume card instead —
   * for a first-time visitor (no token, nothing to restore) the provider
   * buttons still appear immediately, so nothing new blocks signup.
   */
  const restoring = isOpen && !isAuthenticated && (hasSession || (isLoading && signedInOnThisDevice));

  // Auto-resume: a valid session outranks the sign-in form. getUser() (not
  // getSession()) is the trigger because it is the server-validated check — a
  // token for a deleted account must never "resume" into a broken dashboard.
  // Stale sessions are force-cleared, which leaves the provider buttons in
  // place so the person can sign in again.
  useEffect(() => {
    if (!isOpen) {
      setResuming(false);
      return;
    }
    if (!hasSession || !user) return;

    let cancelled = false;
    setResuming(true);

    (async () => {
      const { error: userError } = await supabase.auth.getUser();
      if (cancelled) return;

      if (isStaleSessionError(userError)) {
        // 🔥 Dead session (user deleted server-side) — clear it and fall back
        // to the provider buttons instead of resuming into a dead account.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        clearSupabaseAuthStorage();
        setResuming(false);
        return;
      }

      // Transient network errors still resume: the token in storage is what
      // ProtectedRoute will use, and bouncing the user to a provider chooser
      // for a flaky connection is exactly the friction this removes.
      onClose();
      navigate(getPostAuthPath(user), { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, hasSession, user, navigate, onClose]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Welcome back" brand>
      {/* Subtle Background Decorations */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-100/50 rounded-full blur-2xl -mr-12 -mt-12 opacity-60 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-orange-100/50 rounded-full blur-2xl -ml-12 -mb-12 opacity-60 pointer-events-none"></div>

      <div className="relative animate-fade-in-content">
        <p className="text-slate-500 mb-5 text-sm">
          {restoring
            ? 'Checking the session already on this device…'
            : 'Sign in to manage your projects, contracts and payouts.'}
        </p>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Returning session — skip the provider round trip entirely. */}
        {restoring || resuming ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <Loader2 className="w-5 h-5 text-emerald-600 animate-spin shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-800">
                {user ? 'Taking you to your dashboard…' : 'Restoring your session…'}
              </p>
              <p className="text-xs text-emerald-700/80 leading-relaxed mt-0.5">
                {user
                  ? `You're already signed in as ${user.email || 'your account'} — no need to sign in again.`
                  : 'You signed in on this device already. One moment while we open your account.'}
              </p>
              <div className="mt-3 flex items-center gap-3">
                {user && (
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate(getPostAuthPath(user), { replace: true }); }}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    Open dashboard
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    setResuming(false);
                    /* Explicit account switch: drop the stored session first,
                       then reload so the provider buttons appear for real. */
                    window.localStorage.removeItem('growlancer_oauth_role');
                    await supabase.auth.signOut().catch(() => {});
                    clearSupabaseAuthStorage();
                    window.location.replace('/?modal=login');
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Use a different account
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Signed out by the app itself (24h idle) — say so before offering
                the providers, so it never looks like a failed login. */}
            {logoutNotice && (
              <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
                <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-800">{logoutNotice.title}</p>
                  <p className="text-xs text-amber-700/90 leading-relaxed mt-0.5">
                    {logoutNotice.message}
                  </p>
                </div>
              </div>
            )}

            {/* GitHub & LinkedIn — the only sign-in methods */}
            <OAuthButtons
              onSelect={async (provider) => {
                setError(null);
                setEmailPasswordError(null);
                // A returning user keeps their existing role — clear any role left
                // behind by an unfinished signup so it cannot override it.
                localStorage.removeItem('growlancer_oauth_role');
                return signInWithOAuth(provider);
              }}
              onError={setError}
            />

            {/* Trust note — honest, Growlanzo-branded */}
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-100 p-3">
              <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-500 leading-relaxed">
                Growlanzo uses GitHub and LinkedIn for secure sign-in — we never see or store your
                password, and we never post anything to your accounts.
              </p>
            </div>

            {/* ⚠️ TEMPORARY: Email/Password login for testing — REMOVE BEFORE PRODUCTION LAUNCH */}
            {TESTING_EMAIL_PASSWORD && (
              <>
                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-slate-50 px-2 text-slate-500">Test login (temporary)</span>
                  </div>
                </div>

                {emailPasswordError && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-600">{emailPasswordError}</p>
                  </div>
                )}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setEmailPasswordLoading(true);
                    setEmailPasswordError(null);
                    const email = emailPasswordEmail.trim();
                    const password = emailPasswordPassword;
                    if (!email || !password) {
                      setEmailPasswordError('Please enter both email and password');
                      setEmailPasswordLoading(false);
                      return;
                    }
                    const { error } = await supabase.auth.signInWithPassword({
                      email,
                      password,
                    });
                    setEmailPasswordLoading(false);
                    if (error) {
                      setEmailPasswordError(error.message);
                    } else {
                      // Email/password sign-in — navigate to appropriate dashboard
                      onClose();
                      const role = user?.role || 'freelancer';
                      navigate(getPostAuthPath({ role } as any));
                    }
                  }}
                  className="space-y-3"
                >
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="email"
                          value={emailPasswordEmail}
                          onChange={(e) => setEmailPasswordEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 bg-white placeholder-slate-400"
                          disabled={emailPasswordLoading}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Password</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="password"
                          value={emailPasswordPassword}
                          onChange={(e) => setEmailPasswordPassword(e.target.value)}
                          placeholder="Enter password"
                          className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 bg-white placeholder-slate-400"
                          disabled={emailPasswordLoading}
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={emailPasswordLoading}
                    className="w-full py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {emailPasswordLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        Sign in with Email
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmailPasswordEmail('');
                      setEmailPasswordPassword('');
                      setEmailPasswordError(null);
                    }}
                    className="w-full py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors flex items-center justify-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    Clear
                  </button>
                </form>
              </>
            )}

            {/* Signup Redirect */}
            <div className="mt-5 text-center">
              <p className="text-slate-600 text-sm">
                New to Growlanzo?{' '}
                <button
                  onClick={onSwitchToSignup}
                  className="text-emerald-600 font-semibold hover:text-emerald-700 transition-all duration-200 hover:scale-105"
                >
                  Create an account
                </button>
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
