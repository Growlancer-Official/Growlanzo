import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { BrandLogo } from '../../components/BrandLogo';

type ConfirmStatus = 'processing' | 'success' | 'error';

export function EmailConfirmPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<ConfirmStatus>('processing');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    let cancelled = false;

    async function handleConfirm() {
      try {
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');
        if (error) {
          setStatus('error');
          setMessage(
            errorDescription?.replace(/\+/g, ' ') ||
              'Email verification failed. Please try signing up again.'
          );
          return;
        }

        // ── 1. Detect the verification token from the URL ──
        // OTP flow → token_hash + type  |  PKCE flow → code
        const tokenHash = searchParams.get('token_hash');
        const typeParam = searchParams.get('type');
        const code = searchParams.get('code');

        // ── 2. Exchange the token with Supabase (never trust the frontend) ──
        if (tokenHash) {
          const otpType =
            typeParam === 'email_change'
              ? ('email_change' as const)
              : typeParam === 'recovery'
                ? ('recovery' as const)
                : ('signup' as const);
          const { error: otpError } = await supabase.auth.verifyOtp({
            type: otpType,
            token_hash: tokenHash,
          });
          if (otpError) throw otpError;
        } else if (code) {
          const { error: codeError } = await supabase.auth.exchangeCodeForSession(code);
          if (codeError) throw codeError;
        } else {
          // No token in URL — a session may already exist (e.g. the PKCE code was
          // auto-exchanged by detectSessionInUrl on a prior load, or the user
          // clicked the link twice). Fall through to session check.
        }

        // ── 3. Wait for the session to be established (Supabase auto-processes) ──
        let session = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 800));
          const result = await supabase.auth.getSession();
          if (result.data.session?.user?.email_confirmed_at) {
            session = result.data.session;
            break;
          }
        }

        // 🛡️ Implicit-flow hash fallback: with flowType 'implicit' the confirmation
        // link redirects with #access_token=...&refresh_token=... in the URL hash.
        // supabase-js's detectSessionInUrl normally auto-processes it, but if that
        // raced or failed (fresh load where the client hadn't finished initializing),
        // getSession() returns null even though the tokens are right here. Establish
        // the session explicitly from the hash so the "Email verified ✓" screen
        // always shows instead of a misleading "link invalid/expired".
        if (!session?.user?.email_confirmed_at) {
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const hashAccessToken = hashParams.get('access_token');
          const hashRefreshToken = hashParams.get('refresh_token');
          if (hashAccessToken && hashRefreshToken) {
            const { data: hashSession } = await supabase.auth
              .setSession({
                access_token: hashAccessToken,
                refresh_token: hashRefreshToken,
              })
              .catch(() => ({ data: { session: null } }));
            if (hashSession?.session?.user?.email_confirmed_at) {
              session = hashSession.session;
            }
          }
        }

        if (cancelled) return;

        if (!session?.user?.email_confirmed_at) {
          // No confirmed session after retries — the link is invalid/expired/already used.
          const alreadyVerified = await supabase.auth.getUser().catch(() => null);
          if (alreadyVerified?.data?.user?.email_confirmed_at) {
            // Email is verified in auth.users but no local session — guide to login.
            setStatus('success');
            setMessage('Your email is already verified! You can now log in.');
            setTimeout(() => {
              if (!cancelled) navigate('/?modal=login', { replace: true });
            }, 2000);
            return;
          }
          setStatus('error');
          setMessage(
            'This verification link is invalid or has expired. Please sign up again to receive a fresh link, or request a resend.'
          );
          return;
        }

        if (cancelled) return;

        setStatus('success');
        // ✅ Confirm tab shows a plain success screen ONLY — no redirect to the
        // homepage/onboarding. The user continues in the ORIGINAL tab via the
        // "I've verified, continue" button (or the real-time listener).
        setMessage(
          'Your email is verified. Your account is ready — finish setup in your original Growlanzo tab.'
        );
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage(
            err instanceof Error && err.message.includes('expired')
              ? 'This verification link has expired. Please sign up again to receive a fresh link.'
              : err instanceof Error
                ? err.message
                : 'Something went wrong. Please try again.'
          );
        }
      }
    }

    handleConfirm();
    return () => { cancelled = true; };
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-3xl shadow-lg border border-slate-200 p-6 sm:p-8 text-center">
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
              <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
                Verifying your email
              </h1>
              <p className="text-sm text-slate-500">{message}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="animate-fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900 mb-2">
                Email verified ✓
              </h1>
              <p className="text-sm text-slate-500 mb-6">{message}</p>
              <ol className="text-left space-y-3 mb-6">
                {[
                  'Close this window',
                  'Go back to the Growlanzo tab where you signed up',
                  'Click "I\'ve verified, continue" to set up your profile',
                ].map((step, idx) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="text-sm text-slate-600 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
              {/* 🎯 Only "Close this window" — this tab was opened from the email
                  link; navigating here would just open the homepage as a new page.
                  The user continues in their original Growlanzo tab instead. */}
              <button
                onClick={() => {
                  try { window.close(); } catch { /* ignore */ }
                }}
                className="w-full inline-flex items-center justify-center h-11 px-6 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
              >
                Close this window
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="animate-fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-2xl bg-red-100 flex items-center justify-center">
                  <XCircle className="w-8 h-8 text-red-500" />
                </div>
              </div>
              <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
                Verification failed
              </h1>
              <p className="text-sm text-slate-500 mb-6">{message}</p>
              <button
                onClick={() => navigate('/?modal=signup')}
                className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
              >
                Try signing up again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
