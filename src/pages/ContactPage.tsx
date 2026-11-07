import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AIChatSupport } from '../components/AIChatSupport';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Clock, Headphones, Mail, MessageSquare, Phone, Shield, Sparkles, Zap,  } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

export function ContactPage() {
  const { user } = useAuth();
  const [chatContext, setChatContext] = useState<'freelancer' | 'client'>('freelancer');

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/50">
        <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <BrandLogo variant="wordmark" className="h-8 sm:h-9 transition-transform group-hover:scale-105 w-auto" />
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 py-1 text-sm font-bold text-slate-600 hover:text-emerald-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-10 overflow-hidden bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-white border-b border-emerald-900/30">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl -ml-20 -mb-20"></div>

        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 2xl:px-12 text-center space-y-3">
          <span className="inline-flex items-center gap-3 px-3.5 py-1 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30 text-xs uppercase tracking-wider">
            <Sparkles className="w-4 h-4 animate-pulse" />
            AI Support
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight leading-none">
            We're here to <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">help you grow</span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto font-medium leading-relaxed">
            Get instant answers from our AI support assistant. Real-time help whenever you need it.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <main className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 -mt-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          {/* Left: Context selector + Info cards */}
          <div className="lg:col-span-1 space-y-4">
            {/* Role Context Selector */}
            {!user && (
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900 mb-3">I need help as a...</h2>
                <div className="flex gap-3">
                  <button
                    onClick={() => setChatContext('freelancer')}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      chatContext === 'freelancer'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Freelancer
                  </button>
                  <button
                    onClick={() => setChatContext('client')}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      chatContext === 'client'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Client
                  </button>
                </div>
              </div>
            )}

            {/* Features */}
            <div className="space-y-3">
              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:border-emerald-200 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Instant Responses</h3>
                    <p className="text-xs text-slate-500">Get help in seconds, not hours</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:border-emerald-200 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">24/7 Availability</h3>
                    <p className="text-xs text-slate-500">Always here, day or night</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:border-emerald-200 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Personalized Help</h3>
                    <p className="text-xs text-slate-500">Tailored to your role and needs</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Links */}
            <div className="bg-gradient-to-br from-slate-50 to-emerald-50/50 border border-slate-200 rounded-xl p-3 space-y-3 shadow-sm">
              <div className="flex items-center gap-3">
                <Headphones className="w-4 h-4 text-emerald-600" />
                <h2 className="font-bold text-slate-900 text-sm">Quick Resources</h2>
              </div>
              <Link to="/help-center" className="block text-xs py-1.5 text-emerald-600 hover:text-emerald-700 font-medium hover:underline">
                → Browse Help Center
              </Link>
              <Link to="/guidelines" className="block text-xs py-1.5 text-emerald-600 hover:text-emerald-700 font-medium hover:underline">
                → Platform Guidelines
              </Link>
              <Link to="/status" className="block text-xs py-1.5 text-emerald-600 hover:text-emerald-700 font-medium hover:underline">
                → System Status
              </Link>
            </div>

            {/* Support channels — honest availability, no invented channels */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
              <h2 className="font-bold text-slate-900 text-sm">Support channels</h2>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">In-app AI support</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">Real-time, 24/7 — open a ticket above and AI works the issue with you until it is actually fixed. Available to freelancers and clients.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">Email support</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    For account, payment or verification changes AI cannot make:{' '}
                    <a className="font-semibold text-emerald-600 hover:text-emerald-700 underline" href="mailto:support@growlanzo.com">support@growlanzo.com</a>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 opacity-70">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-slate-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">Phone & live chat <span className="ml-1 align-middle text-[10px] font-bold uppercase tracking-wide rounded-full bg-slate-100 text-slate-500 px-2 py-0.5">Coming soon</span></p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">We are an early-stage team — these channels are not live yet, so we will not pretend otherwise.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Chat Support */}
          <div className="lg:col-span-2">
            <div className="h-[600px]">
              <AIChatSupport
                context={chatContext}
                chatMode="support"
                title={user ? `Support Chat — ${user.name || user.email}` : '24/7 Support Chat'}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
