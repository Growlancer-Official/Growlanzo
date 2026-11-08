import React, { useState, startTransition, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROUTES } from '../routes';
import {
  AlertCircle, ArrowRight, BriefcaseBusiness, CheckCircle2,
  ClipboardCheck, ClipboardList, Clock3, Eye, FolderKanban, Handshake,
  IndianRupee, Layers, Loader2, LockKeyhole, MessagesSquare, Package,
  Receipt, ShieldCheck, Sparkles, Timer, Users, Wallet, Wand2, Zap,
} from 'lucide-react';
import { useCategories } from '../hooks/useCategories';
import { useCountries } from '../hooks/useCountries';
import { useAboutPageMetrics } from '../hooks/useAboutPageMetrics';
import { CategoriesSection as CategoriesSectionComponent } from '../components/CategoriesSection';
import { supabase } from '../lib/supabase';
import { serviceFromPrice } from '../lib/servicePricing';
import { validateEmail } from '../utils/validation';

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════
const SECTION_PADDING = 'py-6 sm:py-8 lg:py-10';
const CONTAINER = 'mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12';
const CARD_CLASS = 'rounded-xl bg-white ring-1 ring-slate-200/70 shadow-sm';

type SignupHandler = (role?: 'freelancer' | 'client') => void;

// ═══════════════════════════════════════════════════════════════
// Hero — what we are, how it works, why it is different
// ═══════════════════════════════════════════════════════════════
function HeroSection({
  onOpenSignup,
  members,
  countries,
}: {
  onOpenSignup: SignupHandler;
  // Supplied by HomePage from its single live-metrics instance: the hero trust
  // line shows the real member/country counts, never a hardcoded number.
  members: number | null;
  countries: number | null;
}) {
  const [videoFailed, setVideoFailed] = useState(false);
  // 🔥 The hero clip is 9MB. Loading it alongside the CSS/JS a visitor actually
  // needs is what made the homepage feel slow on a phone. Keep the 109KB poster
  // first and attach the video only once the page is idle — never on save-data,
  // and never on a 2G/3G phone where the poster is the whole experience.
  const [videoReady, setVideoReady] = useState(false);
  const { isAuthenticated, role } = useAuth();

  useEffect(() => {
    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return;
    if (window.matchMedia('(max-width: 767px)').matches && conn?.effectiveType === '3g') return;
    const id = window.setTimeout(() => startTransition(() => setVideoReady(true)), 1500);
    return () => window.clearTimeout(id);
  }, []);
  const navigate = useNavigate();

  const handleStartHiring = () => {
    if (isAuthenticated && role === 'client') {
      navigate('/client/post');
    } else if (isAuthenticated && role === 'freelancer') {
      navigate('/dashboard/feed');
    } else {
      onOpenSignup('client');
    }
  };

  const handleStartFreelancing = () => {
    if (isAuthenticated && role === 'freelancer') {
      navigate('/dashboard/feed');
    } else if (isAuthenticated && role === 'client') {
      navigate('/client/post');
    } else {
      onOpenSignup('freelancer');
    }
  };

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/40 via-white to-white pointer-events-none" />

      <div className={`${CONTAINER} relative pt-12 sm:pt-16 lg:pt-20 pb-10 sm:pb-14 lg:pb-16`}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center">
          {/* ── Left Content ── */}
          <div className="lg:col-span-6 lg:pr-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-white ring-1 ring-slate-200 px-3 py-1.5 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-sans font-medium text-slate-600">
                India-first freelancing · escrow-protected
              </span>
            </div>

            <h1 className="mt-5 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 font-display leading-[1.1]">
              Hire the right freelancer.
              <br />
              <span className="text-emerald-600">Not the loudest proposal.</span>
            </h1>

            <p className="mt-4 text-sm sm:text-base text-slate-600 leading-relaxed max-w-lg">
              Post a brief and get a shortlist ranked on fit — skills, availability and
              proof of work. Every contract runs on protected escrow, and we earn one
              flat 5% only when the freelancer gets paid.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleStartHiring}
                className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-emerald-600 text-white font-sans font-semibold shadow-sm hover:bg-emerald-700 hover:shadow-md transition-all text-sm"
              >
                {isAuthenticated ? (role === 'client' ? 'Post a Project' : 'Browse Projects') : 'Start Hiring'}
                <ArrowRight className="ml-2 w-4 h-4" />
              </button>
              <button
                onClick={handleStartFreelancing}
                className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-white text-slate-700 font-sans font-semibold ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 transition-all text-sm"
              >
                {isAuthenticated ? (role === 'freelancer' ? 'Browse Projects' : 'Post a Project') : 'Start Freelancing'}
                <ArrowRight className="ml-2 w-4 h-4 text-emerald-500" />
              </button>
            </div>

            {/* The four facts that define the product — no inflated claims. */}
            <div className="mt-6 grid grid-cols-2 gap-2">
              {[
                { icon: Wallet, title: '₹0 for clients', desc: 'No platform fee at checkout' },
                { icon: Receipt, title: '5% flat', desc: 'Only when freelancers get paid' },
                { icon: ShieldCheck, title: 'Escrow first', desc: 'Funded before work starts' },
                { icon: Eye, title: 'Merit-only', desc: 'Ranking can never be bought' },
              ].map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded-xl bg-white ring-1 ring-slate-200/70 px-3 py-2.5 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-sm font-sans font-semibold text-slate-900">{title}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 leading-snug">{desc}</div>
                </div>
              ))}
            </div>

            {/* Trusted by — DB-backed count from get_public_platform_metrics()
                (same source as the About page). Renders nothing until the real
                number arrives, so no visitor ever sees an inflated claim. */}
            {members !== null && (
              <div className="mt-6 text-xs sm:text-sm text-slate-400">
                Trusted by <span className="font-sans font-semibold text-slate-600">{members.toLocaleString('en-US')}</span>{' '}
                member{members === 1 ? '' : 's'}
                {countries !== null && countries > 0
                  ? <> across {countries.toLocaleString('en-US')} {countries === 1 ? 'country' : 'countries'}</>
                  : null}
              </div>
            )}
          </div>

          {/* ── Right Visual ── */}
          <div className="lg:col-span-6 flex flex-col items-center">
            <div className="relative w-full max-w-[640px]">
              <div className="absolute -inset-4 bg-gradient-to-br from-emerald-500/20 via-transparent to-teal-500/20 rounded-[32px] blur-2xl -z-10" />

              <div className="relative rounded-xl overflow-hidden shadow-xl ring-1 ring-black/5 bg-slate-900">
                {!videoFailed ? (
                  videoReady ? (
                    <video
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="w-full aspect-video object-cover"
                      poster="/hero-poster.png"
                      onError={() => startTransition(() => setVideoFailed(true))}
                    >
                      <source src="/videos/hero-demo.mp4" type="video/mp4" />
                    </video>
                  ) : (
                    <img
                      src="/hero-poster.png"
                      alt="Growlanzo product preview"
                      width={1280}
                      height={720}
                      fetchPriority="high"
                      className="w-full aspect-video object-cover"
                    />
                  )
                ) : (
                  <div className="w-full aspect-video flex flex-col justify-center p-6 sm:p-8 bg-gradient-to-br from-slate-800 to-emerald-900">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="h-12 w-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                        <Layers className="w-6 h-6 text-emerald-400" strokeWidth={1.5} />
                      </div>
                      <div>
                        <div className="text-lg font-bold font-display text-white">Growlanzo</div>
                        <div className="text-emerald-400 text-xs font-sans font-medium">
                          Brief → ranked shortlist → escrow
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      {[
                        'Post the brief once, with real scope and budget',
                        'Review a shortlist ranked on fit, not bids',
                        'Fund escrow, deliver in one workspace, release on approval',
                      ].map((step, i) => (
                        <div key={step} className="flex items-start gap-2.5">
                          <span className="mt-0.5 h-5 w-5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <span className="text-xs sm:text-sm text-white/75 leading-relaxed">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Live Services — real supply, updated in real time
// ═══════════════════════════════════════════════════════════════
interface LiveService {
  id: string;
  title: string;
  category: string | null;
  image_url: string | null;
  price: number;
  packages?: unknown;
  created_at: string;
  freelancer?: { name: string | null; avatar: string | null } | null;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function LiveServicesSection() {
  const [services, setServices] = useState<LiveService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const { data } = await supabase
          .from('services')
          .select('id, title, category, image_url, price, packages, created_at, freelancer:profiles!services_freelancer_id_fkey(name, avatar)')
          // `status` is the source of truth (matches ServiceDetailPage) — the
          // old `active`-only filter listed services the freelancer had
          // deactivated, because the dashboard toggle writes only `status`.
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(8);
        if (mounted && data) setServices(data as unknown as LiveService[]);
      } catch {
        // keep last data
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();

    // Real-time: a published service appears immediately, and a deactivated
    // one drops off instead of lingering until the next refresh.
    const channel = supabase
      .channel('homepage-live-services')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'services', filter: 'status=eq.active' },
        () => void load()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'services' },
        () => void load()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'services' },
        () => void load()
      )
      .subscribe();

    return () => {
      mounted = false;
      void channel.unsubscribe();
    };
  }, []);

  return (
    <section className={SECTION_PADDING}>
      <div className={CONTAINER}>
        <div className="flex flex-col items-center text-center lg:text-left lg:flex-row lg:items-end lg:justify-between gap-3 mb-6 lg:mb-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-sans font-semibold text-emerald-600 uppercase tracking-widest mb-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Live marketplace
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 font-display">
              What freelancers are offering right now
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl mx-auto lg:mx-0">
              Published packages, real prices, updated the moment a freelancer goes live.
            </p>
          </div>
          <Link
            to={ROUTES.SERVICES}
            className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-emerald-600 text-white font-sans font-semibold hover:bg-emerald-700 transition-all text-sm shadow-sm"
          >
            Browse All Services
            <ArrowRight className="ml-2 w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`${CARD_CLASS} animate-pulse`}>
                <div className="aspect-video bg-slate-100" />
                <div className="p-4 space-y-4">
                  <div className="h-3.5 bg-slate-100 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : services.length === 0 ? (
          <div className={`${CARD_CLASS} p-10 text-center`}>
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No services published yet — be the first to list one.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {services.map((service) => (
              <Link
                key={service.id}
                to={`/services/${service.id}`}
                className={`${CARD_CLASS} group overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200`}
              >
                {service.image_url ? (
                  <div className="aspect-video bg-slate-50 overflow-hidden">
                    <img
                      src={service.image_url}
                      alt={service.title}
                      className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                ) : (
                  <div className="aspect-video bg-gradient-to-br from-emerald-50 to-slate-50 flex items-center justify-center">
                    <Package className="w-8 h-8 text-emerald-200" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-sans font-semibold text-slate-900 text-sm leading-snug line-clamp-2 group-hover:text-emerald-700 transition-colors">
                      {service.title}
                    </h3>
                    <span className="text-right shrink-0">
                      <span className="block text-[9px] uppercase tracking-wide text-slate-400 font-sans font-semibold leading-none mb-0.5">From</span>
                      <span className="flex items-center gap-0.5 font-bold text-emerald-700 text-sm">
                        <IndianRupee className="w-4 h-4" />
                        {serviceFromPrice(service).toLocaleString('en-IN')}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {service.freelancer?.avatar ? (
                        <img src={service.freelancer.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                      ) : (
                        <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs font-bold flex items-center justify-center">
                          {(service.freelancer?.name || 'F')[0]}
                        </span>
                      )}
                      <span className="text-xs text-slate-500 font-sans font-medium truncate">
                        {service.freelancer?.name || 'Freelancer'}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                      <Clock3 className="w-3.5 h-3.5" />
                      {timeAgo(service.created_at)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// How it works — three steps, one contract
// ═══════════════════════════════════════════════════════════════
function HowItWorksSection() {
  const steps = [
    {
      icon: ClipboardList,
      number: '01',
      title: 'Post a brief — or a profile',
      desc: 'Clients add scope, budget and timeline. Freelancers publish skills, packages and availability.',
      color: 'bg-slate-900',
    },
    {
      icon: Wand2,
      number: '02',
      title: 'Match on fit, not bids',
      desc: 'A shortlist ranked on skills, availability and past work — with the signals shown. Ranking can never be bought.',
      color: 'bg-emerald-600',
    },
    {
      icon: Handshake,
      number: '03',
      title: 'Fund escrow, deliver, release',
      desc: 'Agree milestones, fund escrow before work starts, collaborate in one workspace and release on approval.',
      color: 'bg-orange-500',
    },
  ];

  return (
    <section className={`${SECTION_PADDING} bg-white`}>
      <div className={CONTAINER}>
        <div className="max-w-2xl mb-6 lg:mb-8">
          <div className="text-xs font-sans font-semibold text-emerald-600 uppercase tracking-widest mb-2">How it works</div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 font-display">
            One brief to one paid contract
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed">
            No proposal flood, no chasing invoices, no scattered tools.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {steps.map((step) => (
            <div key={step.number} className="relative rounded-xl bg-white ring-1 ring-slate-200/70 shadow-sm p-5 hover:shadow-lg hover:ring-emerald-200/50 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${step.color}`}>
                  <step.icon className="text-white w-5 h-5" />
                </div>
                <span className="text-2xl font-bold text-slate-200 font-display">{step.number}</span>
              </div>
              <h3 className="text-base font-sans font-semibold tracking-tight text-slate-900">{step.title}</h3>
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Both sides — replaces the old separate Freelancer/Client/Why/
// Features/Trust sections, which repeated the same four promises.
// ═══════════════════════════════════════════════════════════════
function BothSidesSection({ onOpenSignup }: { onOpenSignup: SignupHandler }) {
  const clientPoints = [
    { icon: Zap, title: 'Shortlist in minutes', desc: 'Ranked on fit, with the reasons shown — not a wall of proposals.' },
    { icon: LockKeyhole, title: 'Escrow before work', desc: 'You fund the agreed amount once. It releases only when you approve.' },
    { icon: FolderKanban, title: 'One workspace', desc: 'Milestones, files, feedback and approvals stay on the contract.' },
    { icon: Wallet, title: 'Nothing added at checkout', desc: 'No platform fee, no buyer premium, no surprise line items.' },
  ];

  const freelancerPoints = [
    { icon: BriefcaseBusiness, title: 'Work that fits', desc: 'Your profile is matched to relevant briefs instead of constant bidding.' },
    { icon: Receipt, title: 'Keep 95%', desc: 'One flat 5%, deducted when the payout is released. Nothing upfront.' },
    { icon: Timer, title: 'Paid on delivery', desc: 'Approved work releases from escrow; a silent client cannot hold it forever.' },
    { icon: MessagesSquare, title: 'Packages stay free', desc: 'Basic, Standard and Premium packages cost nothing to publish.' },
  ];

  return (
    <section className={SECTION_PADDING}>
      <div className={CONTAINER}>
        <div className="max-w-2xl mb-6 lg:mb-8">
          <div className="text-xs font-sans font-semibold text-emerald-600 uppercase tracking-widest mb-2">Built for both sides</div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 font-display">
            The same contract protects both of you
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed">
            One escrow, one scope, one set of milestones — so neither side has to trust
            the other&apos;s screenshots or inbox.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Clients */}
          <div className="rounded-xl bg-white ring-1 ring-slate-200/70 shadow-sm p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-orange-50 ring-1 ring-orange-100 flex items-center justify-center">
                <Users className="text-orange-600 w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-sans font-semibold text-slate-400 uppercase tracking-widest">For clients</div>
                <div className="text-lg font-bold tracking-tight text-slate-900">Hire without the guesswork</div>
              </div>
            </div>

            <ul className="mt-5 space-y-3">
              {clientPoints.map(({ icon: Icon, title, desc }) => (
                <li key={title} className="flex gap-3">
                  <Icon className="text-emerald-600 w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-sans font-semibold text-slate-800">{title}</div>
                    <div className="text-xs sm:text-sm text-slate-500 leading-relaxed">{desc}</div>
                  </div>
                </li>
              ))}
            </ul>

            <button
              onClick={() => onOpenSignup('client')}
              className="mt-6 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-emerald-600 text-white font-sans font-semibold shadow-sm hover:bg-emerald-700 hover:shadow-md transition-all text-sm"
            >
              Post a project
              <ArrowRight className="ml-2 w-4 h-4" />
            </button>
          </div>

          {/* Freelancers */}
          <div className="rounded-xl bg-slate-900 text-white shadow-sm p-5 sm:p-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-20 h-56 w-56 rounded-full bg-emerald-600/20 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/10 ring-1 ring-white/10 flex items-center justify-center">
                  <Sparkles className="text-emerald-400 w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-sans font-semibold text-white/50 uppercase tracking-widest">For freelancers</div>
                  <div className="text-lg font-bold tracking-tight">Get paid for the work</div>
                </div>
              </div>

              <ul className="mt-5 space-y-3">
                {freelancerPoints.map(({ icon: Icon, title, desc }) => (
                  <li key={title} className="flex gap-3">
                    <Icon className="text-emerald-400 w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-sans font-semibold text-white">{title}</div>
                      <div className="text-xs sm:text-sm text-white/60 leading-relaxed">{desc}</div>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => onOpenSignup('freelancer')}
                className="mt-6 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-emerald-500 text-slate-900 font-sans font-semibold hover:bg-emerald-400 transition-all text-sm"
              >
                Create a freelancer profile
                <ArrowRight className="ml-2 w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Categories
// ═══════════════════════════════════════════════════════════════
function CategoriesSection({ onOpenSignup }: { onOpenSignup: SignupHandler }) {
  const { categories, loading, error, refresh } = useCategories();

  return (
    <section className={`${SECTION_PADDING} bg-white`}>
      <div className={CONTAINER}>
        {error && !loading && (
          <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>Could not load live category data.</span>
            <button onClick={refresh} className="ml-auto text-xs font-sans font-medium text-amber-700 underline hover:text-amber-800 whitespace-nowrap">
              Retry
            </button>
          </div>
        )}

        <div className="flex flex-col items-center text-center lg:text-left lg:flex-row lg:items-end lg:justify-between gap-3 mb-6 lg:mb-8">
          <div className="max-w-2xl">
            <div className="text-xs font-sans font-semibold text-emerald-600 uppercase tracking-widest mb-2">Categories</div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 font-display">
              Browse by what you need done
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl mx-auto lg:mx-0">
              {loading
                ? 'Loading categories...'
                : error
                  ? 'Live category data is temporarily unavailable.'
                  : `${categories.length} live categories — from development and design to marketing and operations.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={ROUTES.CATEGORIES}
              className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-white text-slate-700 font-sans font-semibold ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 transition-all text-sm"
            >
              View All
              <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
            <button
              onClick={() => onOpenSignup('client')}
              className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-emerald-600 text-white font-sans font-semibold hover:bg-emerald-700 transition-all text-sm shadow-sm"
            >
              Hire talent
              <ArrowRight className="ml-2 w-4 h-4" />
            </button>
          </div>
        </div>

        <CategoriesSectionComponent mode="browse" maxInitial={10} />

        <div className="mt-6 text-center">
          <Link
            to={ROUTES.CATEGORIES}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-emerald-600 font-sans font-semibold rounded-xl border border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 transition-all text-sm shadow-sm"
          >
            <Layers className="w-4 h-4" />
            {error || loading ? 'Browse all categories' : `Explore all ${categories.length} categories`}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Team projects — the one differentiator that needs explaining
// ═══════════════════════════════════════════════════════════════
function TeamProjectsSection({ onOpenSignup }: { onOpenSignup: SignupHandler }) {
  return (
    <section className={SECTION_PADDING}>
      <div className={CONTAINER}>
        <div className={`${CARD_CLASS} overflow-hidden`}>
          <div className="p-5 sm:p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
              <div className="max-w-2xl">
                <div className="text-xs font-sans font-semibold text-violet-600 uppercase tracking-widest mb-2">Team Projects</div>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 font-display">
                  Hire a whole team without one contract covering everyone
                </h2>
                <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
                  Add each role once. Every freelancer gets their own contract, their own
                  escrow and their own milestones — so one delayed member never freezes
                  the rest of the team.
                </p>
                <button
                  onClick={() => onOpenSignup('client')}
                  className="mt-5 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-emerald-600 text-white font-sans font-semibold shadow-sm hover:bg-emerald-700 hover:shadow-md transition-all text-sm"
                >
                  Post a team project
                  <ArrowRight className="ml-2 w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full lg:w-[420px] shrink-0">
                {[
                  { icon: Users, title: 'Independent contracts', desc: 'One per role, never a mega-contract.' },
                  { icon: LockKeyhole, title: 'Per-role escrow', desc: 'Each role is funded and released on its own.' },
                  { icon: Receipt, title: 'Same 5%', desc: 'Per contract — there is no separate team fee.' },
                  { icon: FolderKanban, title: 'Shared workspace', desc: 'The client sees every role in one project.' },
                ].map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="rounded-xl bg-slate-50 ring-1 ring-slate-200/70 p-3.5">
                    <Icon className="text-violet-600 w-4 h-4 mb-1.5" />
                    <div className="text-sm font-sans font-semibold text-slate-800">{title}</div>
                    <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Pricing — the actual numbers, not "transparent pricing" fluff
// ═══════════════════════════════════════════════════════════════
function PricingSection() {
  const tiers = [
    {
      audience: 'Clients',
      price: '₹0',
      unit: 'platform fee',
      desc: 'You fund the agreed project amount. Growlanzo adds nothing at checkout.',
      points: ['Escrow included', 'AI matching free for life', 'Unlimited projects'],
      highlight: false,
    },
    {
      audience: 'Freelancers',
      price: '5%',
      unit: 'flat, on payout',
      desc: 'Deducted from the amount released to you. Nothing upfront, nothing monthly.',
      points: ['Free profile and packages', 'Merit-based ranking', 'Milestone payouts'],
      highlight: true,
    },
    {
      audience: 'Optional Premium',
      price: '₹199',
      unit: 'per month',
      desc: 'Extra AI writing capacity for freelancers. Everything core stays free.',
      points: ['Cancel anytime', 'No lock-in', 'Never affects ranking'],
      highlight: false,
    },
  ];

  return (
    <section className={`${SECTION_PADDING} bg-white`}>
      <div className={CONTAINER}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 mb-6 lg:mb-8">
          <div className="max-w-2xl">
            <div className="text-xs font-sans font-semibold text-emerald-600 uppercase tracking-widest mb-2">Pricing</div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 font-display">
              One fee. Charged once. On the payout.
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed">
              No bidding fees, no buyer premium, no paid placement.
            </p>
          </div>
          <Link
            to={ROUTES.PRICING}
            className="inline-flex items-center justify-center h-10 px-4 rounded-xl bg-white text-slate-700 font-sans font-semibold ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 transition-all text-sm w-fit"
          >
            Full pricing details
            <ArrowRight className="ml-2 w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {tiers.map((tier) => (
            <div
              key={tier.audience}
              className={
                tier.highlight
                  ? 'rounded-xl bg-slate-900 text-white shadow-md p-5 ring-1 ring-slate-800'
                  : `${CARD_CLASS} p-5`
              }
            >
              <div className={`text-xs font-sans font-semibold uppercase tracking-widest ${tier.highlight ? 'text-emerald-400' : 'text-slate-400'}`}>
                {tier.audience}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className={`text-3xl font-bold font-display ${tier.highlight ? 'text-white' : 'text-slate-900'}`}>{tier.price}</span>
                <span className={`text-xs ${tier.highlight ? 'text-white/60' : 'text-slate-500'}`}>{tier.unit}</span>
              </div>
              <p className={`mt-2 text-sm leading-relaxed ${tier.highlight ? 'text-white/70' : 'text-slate-500'}`}>{tier.desc}</p>
              <ul className="mt-4 space-y-2">
                {tier.points.map((point) => (
                  <li key={point} className="flex items-center gap-2">
                    <CheckCircle2 className={`w-4 h-4 shrink-0 ${tier.highlight ? 'text-emerald-400' : 'text-emerald-600'}`} />
                    <span className={`text-xs sm:text-sm ${tier.highlight ? 'text-white/80' : 'text-slate-600'}`}>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          Withdrawals carry the payment provider&apos;s actual transfer cost (shown before you
          confirm) — it is not a platform commission. 5% is charged per contract, including
          each role in a Team Project.
        </p>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Trust + final action. The waitlist form survives here instead of
// taking a whole section of its own.
// ═══════════════════════════════════════════════════════════════
function TrustAndActionSection({ onOpenSignup }: { onOpenSignup: SignupHandler }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { countries, loading: countriesLoading } = useCountries();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !country) {
      setError('Please fill in your name, email, and country.');
      return;
    }
    // Disposable / temp emails are not acceptable anywhere on the platform.
    const emailValidation = validateEmail(email.trim().toLowerCase());
    if (!emailValidation.isValid) {
      setError(emailValidation.error || 'Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const { data, error: fnError } = await supabase.functions.invoke('newsletter-subscribe', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), country },
      });

      // Surface the real server error (e.g. disposable-email rejection).
      let serverMessage: string | null = null;
      if (fnError && (fnError as { context?: Response }).context) {
        try {
          const ctx = (fnError as { context?: Response }).context;
          if (ctx) {
            const body = (await ctx.json()) as { error?: string };
            serverMessage = body?.error ?? null;
          }
        } catch {
          /* ignore body parse errors */
        }
      }

      if (fnError || !data?.success) {
        setError(serverMessage || data?.error || 'Something went wrong. Try again.');
        setIsLoading(false);
        return;
      }

      setSubmitted(true);
      setIsLoading(false);
    } catch {
      setError('Network error. Please try again.');
      setIsLoading(false);
    }
  };

  const trustPoints = [
    { icon: Eye, title: 'Merit-only ranking', desc: 'Subscription and payment never influence search, matching or placement.' },
    { icon: LockKeyhole, title: 'Escrow, not promises', desc: 'Funds sit in escrow until you approve. Released money is final.' },
    { icon: ClipboardCheck, title: 'A real dispute process', desc: 'Evidence-based review, escrow frozen while a dispute is open.' },
  ];

  return (
    <section className={SECTION_PADDING}>
      <div className={CONTAINER}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {trustPoints.map(({ icon: Icon, title, desc }) => (
            <div key={title} className={`${CARD_CLASS} p-4`}>
              <Icon className="text-emerald-600 w-5 h-5" />
              <div className="mt-3 text-base font-sans font-semibold tracking-tight text-slate-900">{title}</div>
              <p className="mt-1 text-sm text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="relative rounded-xl bg-slate-900 text-white shadow-sm overflow-hidden ring-1 ring-slate-800">
          <div className="absolute -top-20 -right-24 h-72 w-72 rounded-full bg-emerald-600/20 pointer-events-none" />
          <div className="absolute -bottom-28 -left-28 h-80 w-80 rounded-full bg-orange-500/15 pointer-events-none" />

          <div className="relative p-5 sm:p-8 lg:p-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-7">
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight font-display">
                  Start with one brief.
                </h2>
                <p className="mt-2 text-sm sm:text-base text-white/70 leading-relaxed max-w-xl">
                  Post a project for free, review a ranked shortlist, and fund escrow only
                  when you decide to hire. Freelancers keep 95% of every payout.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => onOpenSignup('client')}
                    className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 transition-colors font-sans font-semibold text-slate-900 text-sm"
                  >
                    Start hiring
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onOpenSignup('freelancer')}
                    className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-white text-slate-800 hover:bg-slate-100 transition-colors font-sans font-semibold text-sm"
                  >
                    Start freelancing
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Early-access updates — the same newsletter-subscribe backend,
                  now one compact form instead of a full "launching soon" section. */}
              <div className="lg:col-span-5">
                {submitted ? (
                  <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-5 text-center">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-300" />
                    <div className="text-base font-sans font-semibold">You&apos;re on the list</div>
                    <p className="mt-1 text-xs text-white/60">
                      We&apos;ll email you when new categories and payment rails go live.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-2.5">
                    <div className="text-xs font-sans font-semibold text-white/50 uppercase tracking-widest">
                      Early access updates
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        id="waitlist-name"
                        name="name"
                        aria-label="Your name"
                        placeholder="Your name"
                        required
                        autoComplete="name"
                        className="w-full h-11 px-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        id="waitlist-email"
                        name="email"
                        aria-label="Email address"
                        placeholder="you@company.com"
                        required
                        autoComplete="email"
                        className="w-full h-11 px-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <select
                        value={country}
                        onChange={e => setCountry(e.target.value)}
                        id="waitlist-country"
                        name="country"
                        aria-label="Country"
                        required
                        className="w-full sm:flex-1 h-11 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      >
                        <option value="">{countriesLoading ? 'Loading countries...' : 'Select your country'}</option>
                        {countries.map((c) => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="inline-flex items-center justify-center h-11 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors font-sans font-semibold text-slate-900 disabled:opacity-50 gap-2 whitespace-nowrap text-sm"
                      >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Notify me <ArrowRight className="w-4 h-4" /></>}
                      </button>
                    </div>
                    {error && <p className="text-xs text-red-400">{error}</p>}
                    <p className="text-xs text-white/40">No spam. Unsubscribe anytime.</p>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main HomePage
// ═══════════════════════════════════════════════════════════════
export function HomePage() {
  const navigate = useNavigate();
  // ONE live-metrics instance for the whole homepage: the hero trust line reads
  // it, so the RPC and realtime subscription are not duplicated per section.
  const { raw } = useAboutPageMetrics();

  const handleOpenSignup = (role?: 'freelancer' | 'client') => {
    navigate('/?modal=signup&role=' + (role || 'freelancer'));
  };

  return (
    <div id="top">
      <HeroSection onOpenSignup={handleOpenSignup} members={raw.members} countries={raw.countries} />
      <LiveServicesSection />
      <HowItWorksSection />
      <BothSidesSection onOpenSignup={handleOpenSignup} />
      <CategoriesSection onOpenSignup={handleOpenSignup} />
      <TeamProjectsSection onOpenSignup={handleOpenSignup} />
      <PricingSection />
      <TrustAndActionSection onOpenSignup={handleOpenSignup} />
    </div>
  );
}
