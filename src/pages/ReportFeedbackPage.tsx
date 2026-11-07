import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Mail,
  Megaphone,
  MessageSquareHeart,
  Send,
  Shield,
  Sparkles,
  Star,
  ThumbsUp,
  Zap,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

type ReportType = 'bug' | 'feature' | 'feedback' | 'security' | 'other';
type Priority = 'low' | 'medium' | 'high' | 'critical';

const REPORT_TYPES: { id: ReportType; label: string; icon: typeof Bug; desc: string }[] = [
  { id: 'bug', label: 'Bug Report', icon: Bug, desc: 'Something is broken or not working as expected' },
  { id: 'feature', label: 'Feature Request', icon: Sparkles, desc: 'A new capability you want us to build' },
  { id: 'feedback', label: 'Feedback', icon: MessageSquareHeart, desc: 'Ideas, suggestions and general feedback' },
  { id: 'security', label: 'Security Concern', icon: Shield, desc: 'A privacy or security issue you noticed' },
  { id: 'other', label: 'Other', icon: Megaphone, desc: 'Anything else you want to share' },
];

const PRIORITIES: { id: Priority; label: string; color: string }[] = [
  { id: 'low', label: 'Low', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'medium', label: 'Medium', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'high', label: 'High', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'critical', label: 'Critical', color: 'bg-red-50 text-red-700 border-red-200' },
];

const CATEGORIES = [
  'Account & Login',
  'Onboarding',
  'Dashboard',
  'Project / Posting',
  'Proposals & Invites',
  'Contracts & Workspace',
  'Messages / Inbox',
  'AI Assistant',
  'Payments & Escrow',
  'Wallet & Withdrawals',
  'Profile & Verification',
  'Services & Portfolio',
  'Search & Matching',
  'Mobile Experience',
  'Performance / Speed',
  'Other',
];

export function ReportFeedbackPage() {
  const { user } = useAuth();

  const [reportType, setReportType] = useState<ReportType>('bug');
  const [priority, setPriority] = useState<Priority>('medium');
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [includeContext, setIncludeContext] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();
    if (trimmedTitle.length < 3) {
      setError('Please enter a short title (at least 3 characters).');
      return;
    }
    if (trimmedDesc.length < 10) {
      setError('Please describe the issue in a bit more detail (at least 10 characters).');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('submit-report', {
        body: {
          report_type: reportType,
          priority,
          category: category || null,
          title: trimmedTitle,
          description: trimmedDesc,
          email: email.trim() || null,
          page_url: includeContext ? window.location.href : null,
          browser_info: includeContext ? navigator.userAgent : null,
        },
      });

      if (invokeError) throw invokeError;
      if (!data?.success) throw new Error(data?.error || 'Failed to submit report');

      setSuccessId((data as { report_id: string }).report_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit your report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success state ──
  if (successId) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans pb-24">
        <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/50">
          <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group">
              <BrandLogo variant="wordmark" className="h-8 sm:h-9 transition-transform group-hover:scale-105 w-auto" />
            </Link>
            <Link to="/" className="flex items-center gap-1.5 py-1 text-sm font-bold text-slate-600 hover:text-emerald-600 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-16">
          <div className="bg-white rounded-xl border border-slate-100 shadow-xl p-4 sm:p-12 text-center">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3 animate-workflow-glow">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <h1 className="font-display text-3xl font-black text-slate-900 mb-3">Report submitted!</h1>
            <p className="text-slate-500 max-w-md mx-auto mb-3">
              Thank you for helping us improve Growlanzo. Our team will review your report and reply if a response is needed.
            </p>
            <div className="inline-flex items-center gap-3 px-5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl mb-3">
              <span className="text-sm text-slate-500">Reference ID:</span>
              <span className="font-mono font-bold text-emerald-700 text-sm">{successId.slice(0, 8)}</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-3 px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25"
              >
                Back to Home
              </Link>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center gap-3 px-6 py-3 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Submit Another
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/50">
        <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <BrandLogo variant="wordmark" className="h-8 sm:h-9 transition-transform group-hover:scale-105 w-auto" />
          </Link>
          <Link to="/" className="flex items-center gap-1.5 py-1 text-sm font-bold text-slate-600 hover:text-emerald-600 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-16 sm:py-20 overflow-hidden bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-white border-b border-emerald-900/30">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl -ml-20 -mb-20"></div>

        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 2xl:px-12 text-center space-y-3">
          <span className="inline-flex items-center gap-3 px-3.5 py-1 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30 text-xs uppercase tracking-wider">
            <Star className="w-4 h-4 animate-pulse" />
            Report & Feedback
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight leading-none">
            Help us make Growlanzo <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">better</span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto font-medium leading-relaxed">
            Found a bug? Have an idea? Share it with our team — every report helps us build the #1 freelancing platform.
            Reports go straight to our team inbox and are reviewed in real time.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <main className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 -mt-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          {/* Left: Info cards */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:border-emerald-200 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-sm">Reviewed Quickly</h2>
                  <p className="text-xs text-slate-500">Our team triages reports daily</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:border-emerald-200 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-sm">Direct to Team</h2>
                  <p className="text-xs text-slate-500">Sent to support@growlanzo.com</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:border-emerald-200 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-sm">Private & Secure</h2>
                  <p className="text-xs text-slate-500">Your details stay confidential</p>
                </div>
              </div>
            </div>

            {/* Direct email fallback */}
            <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl p-3 border border-emerald-100 shadow-sm">
              <h2 className="font-bold text-slate-900 text-sm mb-2 flex items-center gap-3">
                <Mail className="w-4 h-4 text-emerald-600" /> Prefer email?
              </h2>
              <p className="text-xs text-slate-500 mb-3">
                You can always write to us directly — we read every message.
              </p>
              <a
                href="mailto:support@growlanzo.com"
                className="inline-flex items-center gap-3 px-4 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-xl text-sm font-semibold hover:bg-emerald-50 transition-colors"
              >
                <Mail className="w-4 h-4" />
                support@growlanzo.com
              </a>
            </div>
          </div>

          {/* Right: Form */}
          <div className="lg:col-span-2">
            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-100 shadow-xl p-3 sm:p-4 space-y-3">
              {/* Report Type */}
              <div>
                <label className="block text-sm font-bold text-slate-900 mb-3">What would you like to share?</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {REPORT_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setReportType(t.id)}
                      className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                        reportType === t.id
                          ? 'border-emerald-500 bg-emerald-50/60 shadow-sm'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        reportType === t.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <t.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{t.label}</p>
                        <p className="text-xs text-slate-500 leading-snug mt-0.5">{t.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority (only for bugs/security) */}
              {(reportType === 'bug' || reportType === 'security') && (
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-3">How urgent is it?</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPriority(p.id)}
                        className={`px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
                          priority === p.id
                            ? `${p.color} border-current shadow-sm`
                            : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Category */}
              <div>
                <label htmlFor="report-category" className="block text-sm font-bold text-slate-900 mb-2">Category <span className="text-slate-400 font-normal">(optional)</span></label>
                <select
                  id="report-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all bg-white"
                >
                  <option value="">Select an area of the platform…</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Title */}
              <div>
                <label htmlFor="report-title" className="block text-sm font-bold text-slate-900 mb-2">Short title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  id="report-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder={reportType === 'bug' ? 'e.g. Chat messages fail to send on the workspace' : reportType === 'feature' ? 'e.g. Dark mode for the dashboard' : 'Summarize in a few words'}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="report-details" className="block text-sm font-bold text-slate-900 mb-2">Details <span className="text-red-500">*</span></label>
                <textarea
                  id="report-details"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  placeholder={reportType === 'bug'
                    ? 'What did you expect? What happened instead? Any steps to reproduce, screenshots or error messages you can share?'
                    : 'Tell us everything — the more detail, the better we can act on it.'}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all resize-none"
                />
                <p className="text-xs text-slate-400 mt-1 text-right">{description.length}/5000</p>
              </div>

              {/* Contact email */}
              <div>
                <label htmlFor="report-email" className="block text-sm font-bold text-slate-900 mb-2">
                  Contact email <span className="text-slate-400 font-normal">(optional — for follow-ups)</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="email"
                    id="report-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Context toggle */}
              <label className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(e) => setIncludeContext(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-emerald-600 rounded border-slate-300"
                />
                <div>
                  <p className="font-medium text-slate-900 text-sm">Include technical context</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Attach the page you were on and your browser details — this helps us reproduce issues faster.
                  </p>
                </div>
              </label>

              {/* Error */}
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Submit */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pt-2">
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <ThumbsUp className="w-4 h-4" />
                  Every report is read by the Growlanzo team
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-3 px-8 py-3.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> Submitting…
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" /> Submit Report
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
