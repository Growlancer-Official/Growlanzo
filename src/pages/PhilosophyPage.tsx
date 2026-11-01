import { Link } from 'react-router-dom';
import { ChevronRight, Compass, Cpu, Heart, Scale, TrendingUp,  } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

export function PhilosophyPage() {
  const principles = [
    {
      icon: Cpu,
      title: 'AI-Augmented, Human-Driven',
      description: 'We reject standard automated text-filters. We use state-of-the-art matching engines to read requirements, match them to verifiable portfolios, and skip hours of bids review. But humans remain the creators, the final voice, and the pilots.',
      color: 'from-emerald-500 to-teal-600',
      badge: 'Technology'
    },
    {
      icon: Scale,
      title: 'Symmetrical Fairness & Escrow',
      description: 'We believe both freelancer hours and client capital are equally sacred. The agreed amount is set aside in Growlanzo\u2019s escrow ledger before work begins, so it cannot be spent elsewhere, and it is released only after the buyer approves the delivered work.',
      color: 'from-emerald-500 to-emerald-700',
      badge: 'Trust & Safety'
    },
    {
      icon: Heart,
      title: 'Real-Time Co-Working Synced Canvas',
      description: 'The era of sending emails, MessageSquare messages, and Columns boards back and forth is over. Growlanzo workspaces feature live canvas boards, type-locked shared notes, WebRTC peer sessions, and transaction ledgers directly side by side.',
      color: 'from-orange-500 to-orange-600',
      badge: 'Collaboration'
    },
  ];

  const pillars = [
    { value: '5%', label: 'Flat Platform Fee', desc: 'No hidden tiered percentages or premium markups. What you see is what you pay.' },
    { value: 'Fair', label: 'Dispute Resolution', desc: 'Structured mediation process with transparent documentation and admin oversight.' },
    { value: 'Real-time', label: 'Collaboration', desc: 'Live sync for shared notes, tasks, and project updates across both sides.' },
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
            <Compass className="w-4 h-4" />
            Explore Home
          </Link>
        </div>
      </header>

      {/* Hero section */}
      <section className="relative py-24 overflow-hidden bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-900 text-white border-b border-emerald-900/30">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl -mr-40 -mt-40"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -ml-40 -mb-20"></div>

        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 2xl:px-12 text-center space-y-3">
          <span className="inline-flex items-center gap-3 px-3.5 py-1 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30 text-xs uppercase tracking-wider">
            <TrendingUp className="w-4 h-4 text-emerald-300" />
            Foundational Philosophy
          </span>
          <h1 className="font-display text-4xl sm:text-7xl font-black tracking-tight leading-none">
            Rewriting the rules of <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">remote partnership</span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto font-medium leading-relaxed">
            Traditional freelancing is noisy, fragmented, and full of friction. Growlanzo is built from first principles to bridge the gap between clients and creators.
          </p>
        </div>
      </section>

      {/* Stats Section */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 -mt-8 relative z-10">
        <div className="bg-white rounded-xl border border-slate-200/60 shadow-xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100 overflow-hidden">
          {pillars.map((item, idx) => (
            <div key={idx} className="p-4 space-y-4 hover:bg-slate-50/50 transition-colors">
              <div className="font-display font-black text-4xl text-slate-900 tracking-tight">{item.value}</div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{item.label}</h2>
              <p className="text-xs text-slate-500 leading-normal">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Core Principles */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-20 space-y-12">
        <div className="text-center space-y-4">
          <h2 className="font-display text-3xl font-extrabold text-slate-900">Our Three Pillars of Alignment</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">These ideas direct every feature, pixel, and line of code we write for our remote ecosystem.</p>
        </div>

        <div className="space-y-3">
          {principles.map((p, idx) => (
            <div 
              key={idx} 
              className="bg-white rounded-[2rem] border border-slate-200/50 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-start hover:border-emerald-500/20 hover:shadow-md transition-all group"
            >
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${p.color} text-white flex items-center justify-center shadow-lg shrink-0 group-hover:scale-105 transition-transform`}>
                <p.icon className="w-7 h-7" />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-xl font-bold text-slate-900 leading-tight">{p.title}</h3>
                  <span className="px-2.5 py-0.5 bg-slate-100 text-slate-500 font-bold rounded-full text-xs uppercase tracking-wider">
                    {p.badge}
                  </span>
                </div>
                <p className="text-slate-600 text-sm leading-relaxed">{p.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Box */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-20">
        <div className="bg-emerald-600 rounded-[2.5rem] p-4 sm:p-12 text-center text-white relative overflow-hidden shadow-xl shadow-emerald-950/20">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-2xl -mr-20 -mt-20"></div>
          
          <div className="relative space-y-3">
            <h2 className="font-display text-3xl font-black tracking-tight leading-tight">Ready to experience remote clarity?</h2>
            <p className="text-emerald-100 text-sm max-w-md mx-auto leading-relaxed">
              Create a free account today to hire vetted creators or find secure projects with integrated payment protection.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                to="/signup"
                className="inline-flex h-12 px-6 items-center justify-center font-bold bg-white text-emerald-600 rounded-xl hover:bg-emerald-50 transition-colors shadow-md text-sm shrink-0"
              >
                Join as Client
              </Link>
              <Link
                to="/signup"
                state={{ role: 'freelancer' }}
                className="inline-flex h-12 px-6 items-center justify-center font-bold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl transition-colors border border-emerald-500/20 text-sm shrink-0"
              >
                Join as Freelancer
                <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
