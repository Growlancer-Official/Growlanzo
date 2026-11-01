import { Link } from 'react-router-dom';
import { ArrowRight, History, Lock, Scale, ShieldCheck, UserCheck } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

export function SafetyPage() {
  const safetyFeatures = [
    {
      icon: ShieldCheck,
      title: 'Escrow Protection with Auto-Release',
      description: 'Your project funds are set aside in Growlanzo\u2019s escrow ledger before work begins. Once the freelancer delivers, you get a review window (default 72h) to approve — if you do not respond, the milestone releases to the freelancer, so funds are not held open indefinitely.',
      color: 'from-emerald-500 to-emerald-600',
      badge: 'Payments'
    },
    {
      icon: Lock,
      title: 'Asset Locker Freeze',
      description: 'Shared design files, code bundle deposits, and documents are securely versioned in the workspace. In the event of a coordination dispute, files and escrow are automatically frozen to prevent tampering while our team reviews the evidence.',
      color: 'from-emerald-500 to-emerald-700',
      badge: 'Assets'
    },
    {
      icon: UserCheck,
      title: 'KYC Document Verification',
      description: 'Both clients and freelancers can verify their identity by submitting government-issued documents (e.g. Aadhaar, PAN). Our system auto-checks the details in real time and issues a verified badge next to the name — verified users are clearly marked everywhere on the platform.',
      color: 'from-orange-500 to-orange-600',
      badge: 'Identity'
    },
    {
      icon: History,
      title: 'Real-Time Audit Trails',
      description: 'Every status change on tasks, chat histories, milestone funding, deliveries and releases is logged and timestamped. Our resolution team uses these complete audits to settle disputes fairly and quickly.',
      color: 'from-amber-500 to-orange-600',
      badge: 'Auditing'
    },
    {
      icon: Scale,
      title: 'Fair Dispute Resolution',
      description: 'If a refund or cancellation is requested after work starts, the freelancer must accept it or the case is escalated to our resolution team with escrow frozen. Fraud accusations freeze everything instantly for evidence review — genuine clients are always protected, only fraud and abuse are not.',
      color: 'from-red-500 to-rose-600',
      badge: 'Fairness'
    },
    {
      icon: ShieldCheck,
      title: 'Outside-Payment Protection',
      description: 'All payments must happen through Growlanzo Escrow. Paying or being asked to pay outside the platform is a policy violation — report it from your workspace and repeat violations lead to suspension or permanent ban.',
      color: 'from-teal-500 to-teal-700',
      badge: 'Protection'
    },
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
      <section className="relative py-10 overflow-hidden bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-900 text-white border-b border-emerald-900/30">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl -mr-40 -mt-40"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl -ml-40 -mb-20"></div>

        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 2xl:px-12 text-center space-y-3">
          <span className="inline-flex items-center gap-3 px-3.5 py-1 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30 text-xs uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            Security & Trust
          </span>
          <h1 className="font-display text-4xl sm:text-6xl font-black tracking-tight leading-none">
            A secure foundation for <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">remote commerce</span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-xl mx-auto font-medium">
            We built multiple security systems directly into active workspaces to help reduce payment issues, work loss, and communication breakdowns.
          </p>
        </div>
      </section>

      {/* Safety Grid */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {safetyFeatures.map((feature, index) => (
            <div 
              key={index} 
              className="bg-white rounded-xl p-4 border border-slate-200/50 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group hover:border-emerald-500/20"
            >
              <div className="flex justify-between items-start mb-3">
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.color} text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                  <feature.icon className="w-7 h-7" />
                </div>
                <span className="px-2.5 py-0.5 bg-slate-100 text-slate-500 font-bold rounded-full text-xs uppercase tracking-wider">
                  {feature.badge}
                </span>
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mb-3">{feature.title}</h2>
              <p className="text-slate-600 text-sm leading-relaxed font-medium">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Proactive Help Promo */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-20">
        <div className="bg-emerald-600 rounded-[2.5rem] p-4 sm:p-12 text-center text-white relative overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-2xl -mr-20 -mt-20"></div>
          
          <div className="relative space-y-3">
            <h2 className="font-display text-3xl font-black tracking-tight leading-tight">Collaborate with Complete Assurance</h2>
            <p className="text-emerald-100 text-xs max-w-md mx-auto leading-relaxed">
              Have any questions or need to raise an issue? Browse our Help Center or chat with our AI assistant.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                to="/help-center"
                className="inline-flex h-12 px-6 items-center justify-center font-bold bg-white text-emerald-600 rounded-xl hover:bg-emerald-50 transition-colors shadow-md text-sm shrink-0"
              >
                Browse Help Center
              </Link>
              <Link
                to="/contact"
                className="inline-flex h-12 px-6 items-center justify-center font-bold bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl transition-colors border border-emerald-500/20 text-sm shrink-0"
              >
                Ask AI Assistant
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
