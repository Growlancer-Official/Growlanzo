import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Calendar, Code, ShieldCheck, Sparkles, Users, Wallet, Wrench, Zap,  } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

export function FeaturesPage() {
  const mainFeatures = [
    {
      icon: Sparkles,
      title: 'AI Smart Matchmaker',
      description: 'Skip standard bids review. Our semantic matching engine auto-ranks freelancer portfolios, matching rates and availability directly to job scopes.',
      color: 'from-emerald-400 to-teal-500',
      badge: 'Core'
    },
    {
      icon: ShieldCheck,
      title: 'Escrow Protection',
      description: 'Funds remain secured in a virtual escrow pool. Joint-release arbitration sliders resolve dispute splits without locking funds permanently.',
      color: 'from-emerald-400 to-emerald-500',
      badge: 'Payment'
    },
    {
      icon: Code,
      title: 'Co-Working Canvas',
      description: 'Live shared Kanban task boards and notes with input focus locking preventing editing collisions. Write code side by side.',
      color: 'from-orange-400 to-orange-500',
      badge: 'Collaboration'
    },
    {
      icon: Calendar,
      title: 'Huddle Room Scheduler',
      description: 'Synchronize calendars and launch Live Code Rooms with direct WebRTC peer connections and shared terminals.',
      color: 'from-amber-400 to-orange-500',
      badge: 'Huddles'
    },
    {
      icon: Wallet,
      title: 'Flat 5% Platform Fee',
      description: 'One flat 5% commission, withheld from the freelancer payout at release. Clients pay exactly the project amount — no tiers, no markups.',
      color: 'from-emerald-400 to-teal-500',
      badge: 'Pricing'
    },
    {
      icon: BarChart3,
      title: 'Progress Analytics',
      description: 'Track task burndown rates and milestone releases with visual analytics.',
      color: 'from-orange-400 to-amber-500',
      badge: 'Metrics'
    },
    {
      icon: Zap,
      title: 'Instant Chat Channels',
      description: 'Secure Supabase Realtime messaging. Share files, screenshots, and logs in a locked asset vault.',
      color: 'from-yellow-400 to-amber-500',
      badge: 'Real-time'
    },
    {
      icon: Users,
      title: 'Verified Portfolios',
      description: 'Each onboarding profile requires GitHub or PenTool authentication, ensuring qualifications are authentic.',
      color: 'from-teal-400 to-emerald-500',
      badge: 'Trust'
    }
  ];

  return (
    <div className="min-h-screen bg-cream font-sans pb-24 text-slate-800">
      {/* Symmetrical Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/50">
        <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <BrandLogo variant="wordmark" className="h-8 sm:h-9 transition-transform group-hover:scale-105 w-auto" />
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 py-1 text-sm font-bold text-slate-600 hover:text-emerald-600 transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </header>

      {/* Hero section */}
      <section className="relative py-24 overflow-hidden bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-900 text-white border-b border-emerald-900/30">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl -mr-40 -mt-40"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -ml-40 -mb-20"></div>

        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 2xl:px-12 text-center space-y-3">
          <span className="inline-flex items-center gap-3 px-3.5 py-1 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30 text-xs uppercase tracking-wider">
            <Wrench className="w-4 h-4" />
            Growlanzo Toolkit
          </span>
          <h1 className="font-display text-4xl sm:text-7xl font-black tracking-tight leading-none">
            Features built for <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">frictionless build</span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto font-medium leading-relaxed">
            We built Growlanzo from the ground up to replace outdated bidding platforms, static dashboards, and fragmented payment tools.
          </p>
        </div>
      </section>

      {/* Grid Features */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {mainFeatures.map((feat, idx) => (
            <div 
              key={idx} 
              className="bg-white rounded-xl p-3 border border-slate-200/50 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group hover:border-indigo-500/20"
            >
              <div className="flex justify-between items-start mb-5">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feat.color} text-white flex items-center justify-center shadow-md group-hover:scale-105 transition-transform`}>
                  <feat.icon className="w-6 h-6 text-white" />
                </div>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 font-bold rounded-full text-[10px] uppercase tracking-wider">
                  {feat.badge}
                </span>
              </div>
              <h2 className="font-display text-base font-extrabold text-slate-900 mb-2 leading-tight">{feat.title}</h2>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">{feat.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature breakdown list */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-20">
        <div className="bg-gradient-to-br from-emerald-950 to-slate-900 rounded-[2.5rem] p-4 sm:p-12 text-white relative overflow-hidden shadow-xl shadow-slate-900/10">
          <div className="absolute bottom-0 left-0 w-84 h-84 bg-indigo-500/10 rounded-full blur-3xl -ml-20 -mb-20"></div>

          <div className="relative space-y-3 text-center">
            <h2 className="font-display text-3xl font-black tracking-tight leading-tight">Ready to unlock verified hiring?</h2>
            <p className="text-slate-300 text-xs max-w-md mx-auto leading-relaxed">
              Create a free account to join the state-of-the-art real-time collaboration canvas.
            </p>
            <Link
              to="/signup"
              className="inline-flex h-12 px-8 items-center justify-center font-bold bg-white hover:bg-slate-50 text-emerald-950 rounded-xl transition-all shadow-md text-xs active:scale-[0.99]"
            >
              Start Using Features Free
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
