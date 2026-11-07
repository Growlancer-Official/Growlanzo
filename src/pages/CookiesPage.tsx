import { Link } from 'react-router-dom';
import { BarChart3, Lock, Settings2, ShieldCheck } from 'lucide-react';
import { formatLegalLastUpdatedLine } from '@/lib/legalLastUpdated';
import { openConsentPreferences } from '../lib/consent';
import { BrandLogo } from '../components/BrandLogo';

export function CookiesPage() {
  // ⚠️ Every entry here is backed by code that reads it. Nothing is listed
  // "for completeness": a policy that describes a tracker the product does not
  // run is as wrong as one that omits a tracker it does.
  const cookieTypes = [
    {
      icon: Lock,
      title: 'Strictly necessary — always on',
      description:
        'Required for the platform to function. These keep you signed in, protect your session, and remember the analytics choice you make in cookie preferences. They cannot be switched off, because GitHub/LinkedIn sign-in cannot work without them.',
      examples:
        'sb-<project>-auth-token (Supabase session in localStorage), growlancer_last_activity (24-hour inactivity sign-out), growlancer_consent (this choice), growlancer_oauth_provider / growlancer_oauth_role (survive the provider round-trip)',
    },
    {
      icon: BarChart3,
      title: 'Analytics — optional, off by default',
      description:
        'Aggregate page views and real-user performance (Vercel Web Analytics and Speed Insights). Cookieless: it stores nothing on your device, cannot identify you, and cannot follow you to other sites. These scripts are not loaded at all until you allow analytics.',
      examples: 'Aggregate page-view counts, page-load performance percentiles',
    },
    {
      icon: ShieldCheck,
      title: 'Advertising and tracking — not used',
      description:
        'Growlanzo does not run advertising, retargeting, cross-site tracking pixels, session recording, or behavioural profiling. There is no marketing consent to give because there is nothing to opt in to.',
      examples: 'None',
    },
  ];

  return (
    <div className="min-h-screen bg-cream font-sans pb-24 text-slate-800">
      {/* Premium Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/50">
        <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <BrandLogo variant="wordmark" className="h-8 sm:h-9 transition-transform group-hover:scale-105 w-auto" />
          </Link>
          <Link to="/" className="inline-block py-1 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">Back to Home</Link>
        </div>
      </header>

      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 2xl:px-12">
          <h1 className="font-display text-4xl font-bold text-slate-900 mb-8">Cookie Policy</h1>
          <p className="text-slate-600 mb-8">{formatLegalLastUpdatedLine()}</p>

          <div className="prose prose-slate max-w-none">
            <p className="text-slate-600 mb-8">
              This Cookie Policy explains how Growlanzo uses cookies and similar technologies
              to recognize you when you visit our platform.
            </p>

            <h2 className="text-2xl font-bold text-slate-900 mb-2">What Are Cookies?</h2>
            <p className="text-slate-600 mb-8">
              Cookies are small data files stored on your device when you visit a website.
              They help websites remember your preferences and improve your browsing experience.
              Growlanzo stores the items below in your browser&apos;s local storage rather than in
              cookies wherever possible — that data is never attached to requests to our servers or
              shared with third parties.
            </p>

            <h2 className="text-2xl font-bold text-slate-900 mb-3">Types of Cookies We Use</h2>
            <div className="space-y-3 mb-8">
              {cookieTypes.map((type, i) => (
                <div key={i} className="bg-white rounded-xl p-3 shadow-sm border border-slate-200/60">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                      <type.icon className="w-5 h-5 text-emerald-600" />
                    </div>
                    <h3 className="font-bold text-slate-900">{type.title}</h3>
                  </div>
                  <p className="text-slate-600 mb-2">{type.description}</p>
                  <p className="text-sm text-slate-500">Examples: {type.examples}</p>
                </div>
              ))}
            </div>

            <p className="text-slate-600 mb-8">
              We do not currently use marketing or advertising cookies, and we do not deploy
              third-party behavioral tracking pixels. Essential storage is required for the platform
              to function; analytics is optional and off until you allow it. If we ever introduce
              marketing cookies in the future, this policy will be updated and consent will be asked
              again before anything loads.
            </p>

            <h2 className="text-2xl font-bold text-slate-900 mb-2">Managing Cookies</h2>
            <p className="text-slate-600 mb-4">
              You can change your choice at any time — no need to clear site data or contact us.
              Use the button below (also available as “Cookie preferences” in the site footer), or
              change it through your browser&apos;s site-data settings. Note that blocking essential
              storage will prevent you from signing in.
            </p>

            <div className="mb-8 not-prose">
              <button
                type="button"
                onClick={openConsentPreferences}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-[#08110D] text-white text-sm font-semibold ring-1 ring-emerald-500/40 hover:bg-[#0d1a14] hover:ring-emerald-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <Settings2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                Manage cookie preferences
              </button>
            </div>

            <h2 className="text-2xl font-bold text-slate-900 mb-2">Your Consent Choices</h2>
            <p className="text-slate-600 mb-4">
              On your first visit a short notice explains this policy. Closing it records the safe
              default — essential storage only, analytics off — so dismissing the notice is never
              treated as agreement. Analytics is optional, starts switched off, and is only ever
              turned on deliberately in the preferences panel. Your choice is stored on your device
              under{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">growlancer_consent</code>{' '}
              so we do not ask again, and reopening the preferences panel shows exactly what you
              chose and when. Withdrawing analytics consent stops new measurements immediately; it
              does not delete aggregate counts already recorded.
            </p>

            <h2 className="text-2xl font-bold text-slate-900 mb-2">Changes to This Policy</h2>
            <p className="text-slate-600 mb-8">
              We may update this policy from time to time. Changes will be posted on this page with an updated date.
            </p>

            <h2 className="text-2xl font-bold text-slate-900 mb-2">Contact</h2>
            <p className="text-slate-600">
              Questions about cookies or this policy? Email{' '}
              <a href="mailto:support@growlanzo.com" className="text-emerald-600 hover:underline">support@growlanzo.com</a>{' '}
              — we acknowledge requests within 24 hours and aim to resolve them within 15 days.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
