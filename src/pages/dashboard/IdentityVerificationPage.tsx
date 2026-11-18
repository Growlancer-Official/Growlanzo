import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Check, Clock, Loader2, Mail, Phone, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, realtimeChannels } from '../../lib/supabase';
import { KYC_COMING_SOON } from '../../lib/featureFlags';

/**
 * ACCOUNT verification — LIGHT, for both roles.
 *
 * Founder decision (Oct 2026): as an early-stage startup the check is three
 * criteria and nothing else:
 *
 *   1. Name  — the legal name on file (self-declared full name).
 *   2. Email — confirmed through the auth provider (email link).
 *   3. Phone — confirmed OTP sent to the number.
 *
 * This is ACCOUNT verification, not KYC. Full KYC (government-ID / document
 * verification) is deferred for the Beta (`KYC_VERIFICATION_ENABLED` in
 * `lib/featureFlags.ts`) and is shown here as Coming Soon only — a confirmed
 * phone number is never presented as "KYC verified".
 *
 * Nothing else is collected here: no tax IDs, no business registration, no
 * scans. src/test/kycLightVerification.test.ts fails if any of that returns.
 *
 * Every criterion is driven by a record only the user can change:
 * `auth.users.email_confirmed_at` and `auth.users.phone_confirmed_at`. The page
 * never writes `verification_status` itself — `refresh_light_kyc` derives it
 * server-side from those two facts plus the saved name.
 *
 * Real time: the screen re-evaluates on auth state changes (email link opened in
 * this or another tab), on a profiles realtime subscription, and on window
 * focus, so a verification that lands elsewhere ticks over without a reload.
 */

type Criterion = {
  key: 'name' | 'email' | 'phone';
  title: string;
  detail: string;
  done: boolean;
  icon: typeof User;
};

type Status = 'loading' | 'unverified' | 'pending' | 'verified' | 'rejected';

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 4) return '';
  return `${'•'.repeat(Math.max(phone.length - 4, 1))}${phone.slice(-4)}`;
}

/**
 * Full KYC is deferred for the Beta. This card is the only place the deferred
 * feature is mentioned: a status, an explanation and no form, no upload and no
 * claim that anything here is a KYC check.
 */
function KycComingSoonCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-slate-500" />
          {KYC_COMING_SOON.title}
        </h2>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
          {KYC_COMING_SOON.status}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-600">{KYC_COMING_SOON.description}</p>
      <p className="mt-2 text-[11px] text-slate-500">
        Account verification above is separate from KYC: a confirmed phone number is never shown as
        KYC verified.
      </p>
    </div>
  );
}

export function IdentityVerificationPage() {
  const { user, updateUser } = useAuth();
  const [searchParams] = useSearchParams();
  const isClient = user?.role === 'client';
  const backPath = searchParams.get('redirect') || (isClient ? '/client' : '/dashboard');

  const [status, setStatus] = useState<Status>('loading');
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [email, setEmail] = useState('');
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);

  const [nameSaving, setNameSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('+91');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneNotice, setPhoneNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSeq = useRef(0);
  const doneRef = useRef(false);

  /** Re-read the auth record + profile status and re-derive the KYC result. */
  const refresh = useCallback(
    async (options: { pushName?: string } = {}) => {
      if (!user?.id) return;
      const seq = ++refreshSeq.current;
      try {
        const { data: authData } = await supabase.auth.getUser();
        const authUser = authData?.user ?? null;
        if (seq !== refreshSeq.current) return;

        const confirmedEmail = !!authUser?.email_confirmed_at;

        // Server-side evaluator: the only writer of verification_status.
        // Untyped until the generated database types are refreshed for this
        // migration; the function itself is locked by kycLightVerification.test.
        const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('refresh_light_kyc', {
          p_full_name: options.pushName ?? null,
        });
        if (rpcError && options.pushName) {
          setError(rpcError.message || 'Could not save your name. Please try again.');
        }
        if (seq !== refreshSeq.current) return;

        const result = (rpcData || {}) as {
          status?: string;
          name?: string | null;
          verified?: boolean;
          phone_ok?: boolean;
          phone_masked?: string | null;
        };

        setEmail(authUser?.email || user.email || '');
        setEmailConfirmed(confirmedEmail);
        setPhone(result.phone_masked || authUser?.phone || null);
        setPhoneConfirmed(!!result.phone_ok);
        setSavedName(result.name || '');

        if (result.name) {
          // Keep the input in step with the saved value without clobbering an
          // edit the user is in the middle of typing.
          setName((current) => (current.trim() ? current : (result.name as string)));
        }

        const nextStatus: Status =
          result.status === 'verified' || result.verified
            ? 'verified'
            : result.status === 'pending'
              ? 'pending'
              : result.status === 'rejected'
                ? 'rejected'
                : 'unverified';

        setStatus(nextStatus);

        if (nextStatus === 'verified' && !doneRef.current) {
          doneRef.current = true;
          // Header/profile state only — no KYC funnel metadata is written: the
          // old `kyc_submitted_at` stamp belonged to the deferred KYC feature.
          updateUser({ verificationStatus: 'verified' });
        }
      } catch {
        if (seq === refreshSeq.current && status === 'loading') {
          setError('Could not load your verification status. Please refresh the page.');
        }
      }
    },
    // `status` is intentionally out of the dependency list: only the first load
    // uses it to decide whether to show an error banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, user?.email, updateUser]
  );

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Real time #1 — email confirmations and phone OTPs land in the auth session.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        void refresh();
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [refresh]);

  // Real time #2 — the profile row (verification_status) and other tabs.
  useEffect(() => {
    if (!user?.id) return;
    const channel = realtimeChannels
      .profiles('account-verification')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        () => {
          void refresh();
        }
      )
      .subscribe();
    const onFocus = () => {
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      try {
        channel.unsubscribe();
      } catch {
        // already closed
      }
    };
  }, [user?.id, refresh]);

  const nameOk = useMemo(() => savedName.trim().split(/\s+/).filter(Boolean).length >= 2, [savedName]);

  const criteria: Criterion[] = [
    {
      key: 'name',
      title: 'Full name',
      detail: nameOk ? savedName : 'Add the legal name on your bank account',
      done: nameOk,
      icon: User,
    },
    {
      key: 'email',
      title: 'Email address',
      detail: emailConfirmed ? email : email ? `Confirm the link sent to ${email}` : 'No email on file',
      done: emailConfirmed,
      icon: Mail,
    },
    {
      key: 'phone',
      title: 'Phone number',
      detail: phoneConfirmed ? phone || 'Confirmed' : 'Verify with the one-time code',
      done: phoneConfirmed,
      icon: Phone,
    },
  ];

  const completed = criteria.filter((c) => c.done).length;

  const handleSaveName = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.split(/\s+/).filter(Boolean).length < 2) {
      setError('Enter your full name (first and last).');
      return;
    }
    setNameSaving(true);
    await refresh({ pushName: trimmed });
    setNameSaving(false);
  };

  const handleSendEmail = async () => {
    setError(null);
    setEmailNotice(null);
    if (!email) {
      setError('No email address on file for this account.');
      return;
    }
    setEmailSending(true);
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
    setEmailSending(false);
    if (resendError) {
      setError(
        resendError.message?.toLowerCase().includes('rate')
          ? 'Please wait a minute before requesting another email.'
          : resendError.message || 'Could not send the confirmation email.'
      );
      return;
    }
    setEmailNotice(`Confirmation link sent to ${email}. Open it, then come back to this page.`);
  };

  const handleSendOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPhoneNotice(null);
    const cleaned = phoneInput.replace(/[\s()-]/g, '');
    if (!PHONE_PATTERN.test(cleaned)) {
      setError('Enter the number with country code, for example +919876543210.');
      return;
    }
    setPhoneBusy(true);
    setDevCode(null);
    const { data, error: rpcError } = await (supabase.rpc as any)('request_phone_otp', {
      p_phone: cleaned,
    });
    setPhoneBusy(false);
    const res = (data || {}) as {
      success?: boolean;
      error?: string;
      phone_masked?: string;
      retry_after_seconds?: number;
      dev_mode?: boolean;
      dev_code?: string | null;
    };
    if (rpcError) {
      setError(rpcError.message || 'Could not send a code to that number.');
      return;
    }
    if (res.success === false) {
      if (res.error === 'rate_limited') {
        setError(`Please wait ${res.retry_after_seconds ?? 60}s before requesting another code.`);
      } else {
        setError('Enter the number with country code, for example +919876543210.');
      }
      return;
    }
    setOtpSent(true);
    if (res.dev_code) {
      setDevCode(res.dev_code);
      setPhoneNotice(
        `Platform code generated for ${res.phone_masked || cleaned}. Development delivery shows the code below — no SMS is sent.`
      );
    } else {
      setPhoneNotice(`Code sent to ${res.phone_masked || cleaned}. It expires in 10 minutes.`);
    }
  };

  const handleVerifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const token = otp.replace(/\D/g, '');
    if (token.length < 4) {
      setError('Enter the code from the SMS.');
      return;
    }
    const cleaned = phoneInput.replace(/[\s()-]/g, '');
    setPhoneBusy(true);
    const { data, error: rpcError } = await (supabase.rpc as any)('verify_phone_otp', {
      p_phone: cleaned,
      p_code: token,
    });
    setPhoneBusy(false);
    const res = (data || {}) as { success?: boolean; error?: string; attempts_left?: number };
    if (rpcError) {
      setError(rpcError.message || 'That code did not match. Try again.');
      return;
    }
    if (res.success === false) {
      if (res.error === 'expired') {
        setError('That code expired. Request a new one.');
        setOtpSent(false);
      } else if (res.error === 'too_many_attempts') {
        setError('Too many attempts. Request a new code.');
        setOtpSent(false);
      } else {
        setError(
          res.attempts_left !== undefined
            ? `That code did not match. ${res.attempts_left} attempt(s) left.`
            : 'That code did not match. Try again.'
        );
      }
      return;
    }
    setOtp('');
    setOtpSent(false);
    setDevCode(null);
    await refresh();
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Account Verification</h1>
        </div>
        <p className="text-sm text-slate-600">
          Three quick checks — name, email and phone. Takes about a minute, and every step updates
          here automatically.
        </p>
      </div>
      {children}
    </div>
  );

  if (status === 'verified') {
    return shell(
      <div className="space-y-3">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <BadgeCheck className="h-6 w-6 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-emerald-900">Your account is verified</h2>
            <p className="mt-1 text-sm text-emerald-800">
              Your name, email and phone are confirmed. The verified badge now shows on your profile.
            </p>
            <dl className="mt-4 space-y-1.5 text-sm text-emerald-900">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-semibold">Name:</dt>
                <dd className="break-words">{savedName || '—'}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-semibold">Email:</dt>
                <dd className="break-all">{email || '—'}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-semibold">Phone:</dt>
                <dd>{maskPhone(phone)}</dd>
              </div>
            </dl>
            <Link
              to={backPath}
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
      <KycComingSoonCard />
      </div>
    );
  }

  return shell(
    <div className="space-y-4">
      {/* Progress */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-900">
            {completed} of {criteria.length} complete
          </p>
          {status === 'pending' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
              <Clock className="h-3.5 w-3.5" /> In review
            </span>
          )}
          {status === 'rejected' && (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
              Action needed
            </span>
          )}
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${(completed / criteria.length) * 100}%` }}
          />
        </div>
        <ul className="mt-4 space-y-2">
          {criteria.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key} className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {item.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{item.title}</p>
                  <p className="truncate text-xs text-slate-500">{item.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* 1 — Name */}
      {!nameOk && (
        <form
          onSubmit={handleSaveName}
          className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
        >
          <label htmlFor="kyc-name" className="block text-sm font-semibold text-slate-900">
            Full name
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Use the name on your bank account so payouts and invoices match.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="kyc-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              placeholder="e.g. Asha Rao"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
            <button
              type="submit"
              disabled={nameSaving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {nameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save name
            </button>
          </div>
        </form>
      )}

      {/* 2 — Email */}
      {!emailConfirmed && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900">Email address</h2>
          <p className="mt-1 text-xs text-slate-500">
            We sent a confirmation link to <span className="font-medium">{email || 'your inbox'}</span>.
            Open it on any device — this page updates by itself.
          </p>
          {emailNotice && <p className="mt-2 text-xs text-emerald-700">{emailNotice}</p>}
          <button
            type="button"
            onClick={handleSendEmail}
            disabled={emailSending}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Resend confirmation link
          </button>
        </div>
      )}

      {/* 3 — Phone */}
      {!phoneConfirmed && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900">Phone number</h2>
          <p className="mt-1 text-xs text-slate-500">
            We generate a one-time code on the platform to confirm this number.
          </p>
          {phoneNotice && <p className="mt-2 text-xs text-amber-700">{phoneNotice}</p>}
          {devCode && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Development delivery — your code: <span className="tracking-[0.3em]">{devCode}</span>
            </p>
          )}
          {!otpSent ? (
            <form onSubmit={handleSendOtp} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="tel"
                inputMode="tel"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                placeholder="+919876543210"
                aria-label="Phone number with country code"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
              <button
                type="submit"
                disabled={phoneBusy}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {phoneBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                Send code
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="6-digit code"
                aria-label="One-time code"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tracking-widest text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
              <button
                type="submit"
                disabled={phoneBusy}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {phoneBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Verify
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtp('');
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Change number
              </button>
            </form>
          )}
        </div>
      )}

      <p className="px-1 text-xs text-slate-500">
        We check three things only — your name, email and phone. This is account verification for the
        Beta, not KYC; nothing else is collected, and a step you finish on another device shows up
        here on its own.
      </p>

      <KycComingSoonCard />
    </div>
  );
}
