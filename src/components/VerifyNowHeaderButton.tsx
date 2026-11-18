import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, realtimeChannels } from '../lib/supabase';
import { IDENTITY_VERIFICATION_ENABLED } from '../lib/featureFlags';

type VerificationState = 'loading' | 'verified' | 'pending' | 'needed';

// ── Verify Now (top-bar chip) ────────────────────────────────────────────────
// Compact ACCOUNT-verification nudge (name + email + phone) shown in the
// dashboard header next to the AI badge until the account is verified. It is
// not a KYC prompt — full KYC is deferred for the Beta. Disappears IN REAL TIME
// the moment verification_status flips to 'verified' (realtime subscription on
// profiles), with a focus-refetch safety net. Hidden on mobile, like the AI badge.
export function VerifyNowHeaderButton() {
  const { user } = useAuth();
  const [state, setState] = useState<VerificationState>('loading');

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('verification_status, role')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (data?.role === 'admin' || data?.verification_status === 'verified') setState('verified');
        else if (data?.verification_status === 'pending') setState('pending');
        else setState('needed');
      } catch {
        if (!cancelled) setState('verified'); // fail silent — never block on a header chip
      }
    };
    void load();

    // Real-time: hide the instant verification completes
    const channel = realtimeChannels.profiles('header-verification')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        () => { void load(); }
      )
      .subscribe();

    // Safety net: re-check when the tab regains focus
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      try {
        channel.unsubscribe();
      } catch {
        // Unsubscribe failed silently
      }
    };
  }, [user?.id]);

  // Account verification entry point — off only if that feature is switched off
  // (KYC is a different, deferred feature and never gates this chip).
  if (!IDENTITY_VERIFICATION_ENABLED) return null;
  if (state !== 'needed' && state !== 'pending') return null;

  const verificationPath =
    user?.role === 'client' ? '/client/verification' : '/dashboard/identity-verification';

  // Pending — softer chip: review in progress, still links to the status page.
  if (state === 'pending') {
    return (
      <Link
        to={verificationPath}
        title="Account verification in review"
        className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 rounded-full border border-amber-200 hover:bg-amber-100 transition-colors"
      >
        <Clock className="w-4 h-4 text-amber-600" />
        <span className="text-xs font-bold text-amber-700">In Review</span>
      </Link>
    );
  }

  // Needed — clear action CTA, same emerald language as the rest of the app.
  return (
    <Link
      to={verificationPath}
      title="Verify your account (name, email and phone)"
      className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-full hover:bg-emerald-700 transition-colors shadow-sm"
    >
      <ShieldCheck className="w-4 h-4" />
      Verify Now
    </Link>
  );
}
