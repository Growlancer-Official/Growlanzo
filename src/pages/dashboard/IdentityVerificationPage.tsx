import { Link } from 'react-router-dom';
import { BadgeCheck, Clock, FileText, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Verification — Coming Soon for BOTH roles (freelancer and client).
 *
 * Launch decision (Nov 2026): the whole verification section is presented as
 * Coming Soon. There is no submission form, no document upload, no OTP request
 * and no status write on this screen. The server-side submission RPCs are
 * revoked from app roles by migration 20271128000000, so a direct API call
 * cannot start or complete verification either.
 *
 * Historical verification records remain in the database for audit; they are
 * not shown as an active workflow and they no longer grant any badge.
 */
export function IdentityVerificationPage() {
  const { user } = useAuth();
  const isClient = user?.role === 'client';
  const backPath = isClient ? '/client' : '/dashboard';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-emerald-600" />
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Verification</h1>
          <p className="text-sm text-slate-600">Identity verification for both freelancers and clients.</p>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-100/60 blur-3xl" aria-hidden="true" />

        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700">
            <Clock className="h-3.5 w-3.5" />
            Coming Soon
          </span>

          <h2 className="mt-4 font-display text-xl font-bold text-slate-900 sm:text-2xl">
            Verification is coming soon
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            We are completing the legal, privacy and provider review required before we collect identity
            documents. Until that is finished, no verification submission is open for freelancers or clients —
            and nothing is blocked for you while we wait.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              {
                icon: FileText,
                title: 'No documents needed',
                text: 'No Aadhaar, PAN, passport, bank or business documents are requested on Growlanzo today.',
              },
              {
                icon: Lock,
                title: 'Secure by design',
                text: 'The submission endpoints are closed at the database level, not just hidden in the app.',
              },
              {
                icon: BadgeCheck,
                title: 'No badge yet',
                text: 'Verification does not grant a badge. The green PRO badge now means an active Premium subscription only.',
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <Icon className="h-4 w-4 text-emerald-600" />
                <p className="mt-2 text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-xs leading-relaxed text-emerald-900">
            Hiring, applying, contracts, escrow and payouts keep working exactly as they do today. When
            verification launches, we will ask for your consent first and update the Privacy Policy before
            collecting anything new.
          </p>

          <Link
            to={backPath}
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}

export default IdentityVerificationPage;
