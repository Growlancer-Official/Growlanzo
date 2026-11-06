import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {ArrowLeft, BookOpen, ChevronDown, CreditCard, FileText, HelpCircle, LifeBuoy, MessageSquare, Search, Users, } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { BrandLogo } from '../components/BrandLogo';

interface FAQ {
  category: string;
  question: string;
  answer: string;
}

const faqs: FAQ[] = [
  {
    category: 'Getting Started',
    question: 'How do I create an account and get started on Growlanzo?',
    answer: 'Creating an account on Growlanzo is completely free. Simply click the "Sign Up" button on the landing page, choose your role as a Freelancer or a Client, verify your email, and fill out your profile details. Clients can immediately post projects, and freelancers can complete professional profile onboarding to unlock the real-time AI matchmaking system.',
  },
  {
    category: 'Getting Started',
    question: 'What makes Growlanzo different from Upwork or Fiverr?',
    answer: 'Unlike transactional legacy platforms, Growlanzo introduces a state-of-the-art Real-Time Collaboration Canvas directly built into contract workspaces. This includes shared Kanban boards, a live synced scratchpad for note sharing with type collision locks, real-time messaging, and interactive escrow tracking. We eliminate the friction of switching back and forth between MessageSquare, Columns, and static dashboard screens.',
  },
  {
    category: 'Getting Started',
    question: 'How does the AI Matchmaking system work?',
    answer: 'Growlanzo runs an intelligent matching algorithm that cross-analyzes freelancer skills, experience, availability, and base rates with the client\'s specific project requirements (skills required, budget, and deadlines). Best matches are fed directly onto the client\'s "AI Matches" dashboard and the freelancer\'s project feed, enabling immediate invites and hires.',
  },
  {
    category: 'Project Management',
    question: 'How do I create and assign tasks on the shared board?',
    answer: 'Inside your active contract workspace, navigate to the "Co-Working Canvas" tab. Both clients and freelancers can add new task cards, select their progress column (To Do, In Progress, Completed), or remove them. The changes are synchronized live across both screens instantly using Supabase broadcast channels.',
  },
  {
    category: 'Project Management',
    question: 'What is the "Collaborative Scratchpad" and how does the focus lock work?',
    answer: 'The Collaborative Scratchpad is a shared notes area in your workspace. To prevent text jumps, cursor displacement, and input conflicts, we implemented a focus-based edit lock. When either user focuses on and types in the scratchpad, a local lock is activated. Notes from the database will not overwrite their current editing text until they pause typing (800ms debounce) or blur the input, keeping the synchronization flawless and seamless.',
  },
  {
    category: 'Project Management',
    question: 'Can I upload files and deliverables directly to the workspace?',
    answer: 'Yes! In the Chat & Assets tab, both the freelancer and client have access to a secure Shared Asset Locker. You can upload design files, documents, and code bundles. If a project enters a dispute, the locker is frozen automatically to prevent asset tampering until mediation finishes.',
  },
  {
    category: 'Payments & Escrow',
    question: 'What is Escrow Protection and how does it secure transactions?',
    answer: 'When a contract is created, the client funds the contract total into the contract\u2019s escrow balance. Those funds are recorded in Growlanzo\u2019s internal escrow ledger (a bookkeeping hold, not a bank or licensed escrow account) and are not released to the freelancer until the client approves the deliverables, the review window passes, or both sides mutually cancel the agreement. Either party can also open a dispute, which freezes that contract\u2019s escrow until an admin review decides how the funds move.',
  },
  {
    category: 'Payments & Escrow',
    question: 'How do I release an escrow payment as a client?',
    answer: 'Navigate to the active project workspace and select the "Milestones & Escrow" tab. Under the Milestones section, you will see active milestones. Click "Release Payment" on funded milestones. Confirm the action to instantly transfer funds from the escrow pool to the freelancer\'s wallet balance.',
  },
  {
    category: 'Payments & Escrow',
    question: 'What happens if a dispute or coordination breakdown occurs?',
    answer: 'If conflict arises, clients can trigger the "Raise Dispute" resolution button in the Milestones & Escrow tab. Once submitted, the contract status is changed to "disputed", which freezes all file uploads, locks escrow funds, and alerts the Growlanzo mediation team who will step in to audit the workspace canvases, logs, and coordinate a fair settlement.',
  },
  {
    category: 'For Freelancers',
    question: 'How do I submit proposals to open projects?',
    answer: 'Browse your Project Feed for matching jobs. Click "Submit Proposal", propose your project price, enter a cover letter, outline milestones, and click submit. Matching and visibility are merit-based and identical for everyone — Premium never changes how your proposals are ranked or who sees them.',
  },
  {
    category: 'For Freelancers',
    question: 'How do I withdraw my earnings from the Growlanzo Wallet?',
    answer: 'Go to your Wallet dashboard, click "Withdraw Funds", select your withdrawal method (UPI or Bank Account), add your credentials (e.g. UPI ID or bank account details with IFSC), and confirm. Withdrawals are processed via RazorpayX in INR, usually within 24 hours, with a transparent 2% processing fee. The current processing timeline is always shown to you before you confirm. PayPal withdrawals are coming soon.',
  },
  {
    category: 'For Freelancers',
    question: 'How do I level up my profile to attract more clients?',
    answer: 'Completing onboarding 100%, listing accurate skill tags, maintaining on-time task delivery ratios, responding quickly to messages, and securing 5-star ratings directly boosts your AI match score. You can also subscribe to Pro tier to receive verified expert badges.',
  },
];

export function HelpCenterPage({ dashboard = false }: { dashboard?: boolean } = {}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [expandedFAQIndex, setExpandedFAQIndex] = useState<number | null>(null);

  const categories = [
    { name: 'All', icon: LifeBuoy, desc: 'Browse all helpful topics' },
    { name: 'Getting Started', icon: BookOpen, desc: 'Onboarding and basic platform setup' },
    { name: 'Project Management', icon: FileText, desc: 'Canvases, workspaces, and matching' },
    { name: 'Payments & Escrow', icon: CreditCard, desc: 'Secure escrow protection and releases' },
    { name: 'For Freelancers', icon: Users, desc: 'Bidding, proposals, and success guidelines' },
  ];

  // Filter FAQs based on active category and search keyword
  const filteredFAQs = useMemo(() => {
    return faqs.filter((faq) => {
      const matchesCategory = activeCategory === 'All' || faq.category === activeCategory;
      const matchesSearch =
        faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchTerm]);

  const handleToggleFAQ = (index: number) => {
    setExpandedFAQIndex(expandedFAQIndex === index ? null : index);
  };

  return (
    <div className="space-y-4">
      {/* Dashboard header — shown when inside dashboard layout */}
      {dashboard && (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
            <HelpCircle className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
              Help Center
              <InfoTip title="Help Center" text="Search our knowledge base for answers about canvases, escrow protection, AI matching, payouts, and more. For instant help, use the AI Support chat." />
            </h1>
            <p className="text-slate-500 mt-1">Find answers to common questions</p>
          </div>
        </div>
      )}

      {/* Public header + hero — shown on standalone /help-center page */}
      {!dashboard && (
        <>
          <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/50">
            <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-12 h-16 flex items-center justify-between">
              <Link to="/" className="flex items-center gap-3">
                <BrandLogo variant="wordmark" className="h-8 sm:h-9 w-auto" />
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

          <section className="relative py-8 sm:py-24 overflow-hidden bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-900 text-white border-b border-emerald-900/30">
            <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-teal-500/5 rounded-full blur-3xl -ml-20 -mb-20"></div>

            <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 2xl:px-12 text-center space-y-3">
              <span className="inline-flex items-center gap-3 px-3 py-1 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30 text-xs uppercase tracking-wider">
                <LifeBuoy className="w-4 h-4" />
                Knowledge Base
              </span>
              <h1 className="font-display text-4xl sm:text-6xl font-black tracking-tight leading-none">
                How can we <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">help you succeed?</span>
              </h1>
              <p className="text-slate-300 text-base sm:text-lg max-w-xl mx-auto font-medium">
                Search our comprehensive, real-time guide system for questions about canvases, escrow protection, AI matching, and payouts.
              </p>
            </div>
          </section>
        </>
      )}

      {/* Search bar — always visible */}
      <div className="relative max-w-xl">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          aria-label="Search help questions"
          placeholder="Search questions..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setExpandedFAQIndex(null);
          }}
          className="w-full h-11 pl-12 pr-4 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
        />
      </div>

      {/* Main FAQ Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Sidebar Filters */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-xs font-black uppercase text-slate-400 tracking-wider px-3 mb-3">Topic Categories</h2>
          <div className="space-y-1">
            {categories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => {
                  setActiveCategory(cat.name);
                  setExpandedFAQIndex(null);
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left font-bold text-sm transition-all ${
                  activeCategory === cat.name
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                    : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/40'
                }`}
              >
                <cat.icon className="w-4 h-4 shrink-0" />
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* FAQs Accordion Panel */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-display text-xl font-extrabold text-slate-900">
              {activeCategory} FAQs ({filteredFAQs.length})
            </h2>
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-xs font-bold text-emerald-600 hover:text-emerald-700">
                Clear Search
              </button>
            )}
          </div>

          {filteredFAQs.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/50 p-12 text-center shadow-sm space-y-4">
              <MessageSquare className="w-12 h-12 text-slate-300 mx-auto" />
              <h4 className="font-bold text-slate-800">No matching questions found</h4>
              <p className="text-slate-500 text-sm max-w-sm mx-auto">
                We couldn't find anything matching your search term. Try browsing the categories or ask our AI assistant below.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredFAQs.map((faq, index) => {
                const isExpanded = expandedFAQIndex === index;
                return (
                  <div
                    key={index}
                    className="bg-white rounded-xl border border-slate-200/60 overflow-hidden shadow-sm transition-all hover:border-emerald-500/20"
                  >
                    <button
                      onClick={() => handleToggleFAQ(index)}
                      className="w-full p-3 text-left font-bold text-slate-900 flex justify-between items-center gap-3 hover:bg-slate-50/50 transition-colors"
                    >
                      <span className="leading-snug">{faq.question}</span>
                      <ChevronDown
                        className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-300 ${
                          isExpanded ? 'rotate-180 text-emerald-600' : ''
                        }`}
                      />
                    </button>
                    {isExpanded && (
                      <div className="px-5 pb-5 pt-1 text-slate-600 text-sm border-t border-slate-100/50 leading-relaxed bg-slate-50/40">
                        {faq.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* AI Support Banner */}
          <div className="mt-8 bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-[2rem] p-3 text-white flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xl shadow-emerald-600/10">
            <div>
              <h3 className="font-bold text-lg leading-tight">Need more help?</h3>
              <p className="text-emerald-100 text-xs mt-1">Our AI support assistant is available 24/7 to answer your questions instantly.</p>
            </div>
            <Link
              to="/contact"
              className="inline-flex h-11 px-5 items-center justify-center font-bold bg-white text-emerald-600 rounded-xl hover:bg-emerald-50 transition-colors shrink-0 text-sm"
            >
              Ask AI Assistant
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
