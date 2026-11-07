import { useSearchParams, Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

/**
 * Public unsubscribe page.
 *
 * Why it exists: every newsletter welcome email has always linked to
 * `${APP_URL}/unsubscribe?email=...`, but no such route was ever registered, so
 * the link in a legal footer landed on "Page not found". There is no tokenised
 * unsubscribe endpoint yet, and an email-only query parameter is not safe to
 * delete rows with (anyone could unsubscribe anyone). This page therefore
 * states the truth and gives one working action: a pre-filled mailto to the
 * support inbox, which is monitored and removes the address manually.
 *
 * When a signed unsubscribe endpoint exists, replace the mailto with it — do
 * not add a delete-by-email RPC.
 */
const SUPPORT_EMAIL = 'support@growlanzo.com';

export function UnsubscribePage() {
  const [searchParams] = useSearchParams();
  const email = (searchParams.get('email') || '').trim();
  const subject = encodeURIComponent('Unsubscribe me from Growlanzo updates');
  const body = encodeURIComponent(
    email
      ? `Please remove ${email} from Growlanzo product updates and launch emails.\n\nThanks.`
      : 'Please remove this address from Growlanzo product updates and launch emails.\n\nThanks.',
  );
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

  return (
    <div
      className="min-h-screen bg-cream flex items-center justify-center p-4"
      style={{ paddingBottom: 'calc(var(--consent-banner-h, 0px) + 1rem)' }}
    >
      <div className="max-w-lg w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 text-center">
        <div className="flex justify-center mb-5">
          <BrandLogo variant="full" className="h-12 w-auto" />
        </div>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-100">
          <Mail className="h-6 w-6 text-emerald-600" />
        </div>

        <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">
          Unsubscribe from updates
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-5">
          {email ? (
            <>
              We&apos;ll remove <strong className="text-slate-900">{email}</strong> from Growlanzo
              product updates and launch emails.
            </>
          ) : (
            <>Send us the address you want removed and we&apos;ll take it off the list.</>
          )}{' '}
          You&apos;ll still receive essential account, contract and payment emails — those are part
          of using the platform.
        </p>

        <a
          href={mailto}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
        >
          <Mail className="h-4 w-4" />
          Email {SUPPORT_EMAIL}
        </a>

        <p className="mt-4 text-xs text-slate-500">
          Requests are actioned within 48 hours. You can also reply to any Growlanzo email with
          &ldquo;unsubscribe&rdquo;.
        </p>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs">
          <Link to="/" className="inline-flex items-center gap-1 text-slate-500 hover:text-emerald-700">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Growlanzo
          </Link>
          <Link to="/cookies" className="inline-flex items-center gap-1 text-slate-500 hover:text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Cookie policy
          </Link>
        </div>
      </div>
    </div>
  );
}
