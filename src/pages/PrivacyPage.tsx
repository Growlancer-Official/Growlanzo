import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatLegalLastUpdatedLine } from '@/lib/legalLastUpdated';
import { ArrowLeft, ChevronRight, Cookie, Database, Eye, Globe, HelpCircle, History, Lock, Shield, ShieldAlert,  } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

interface Section {
  id: string;
  title: string;
  icon: any;
  content: React.ReactNode;
}

const privacySections: Section[] = [
  {
    id: 'commitment',
    title: '1. Privacy Commitment',
    icon: Shield,
    content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            At Growlanzo ("Platform", "we", "us", or "our"), your privacy is a foundational pillar of our service architecture. Unlike legacy freelancing platforms that rely on static database scraping and third-party advertising tracking, Growlanzo is built to coordinate real-time workspaces with the highest standard of client and freelancer confidentiality.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            This Privacy Policy details what information we collect, how it is utilized for real-time synchronization and AI matchmaking, the security measures we employ to safeguard it, and your rights under applicable data protection laws, including the Indian Digital Personal Data Protection (DPDP) Act, 2023 where applicable.
          </p>
          <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4 flex gap-3 text-emerald-800 text-sm font-medium">
            <Lock className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
            <div>
              <p className="font-bold">We Do Not Sell Your Data</p>
              <p className="text-emerald-700 text-xs mt-1">We do not sell, trade, or license your personal profile information, project parameters, messaging logs, or canvas files to third-party ad networks or data brokers, and we do not intend to do so. If this ever changes, we will update this policy and, where required by applicable law, seek your consent.</p>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'collection',
      title: '2. Information We Collect',
      icon: Database,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            To power our real-time coordination ecosystem, we collect data across three primary layers:
          </p>
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">A. Account & Profile Information</h3>
              <p className="text-slate-600 text-xs mt-1">Includes registered names, email addresses, verified credentials, portfolios, base rates, declared skills, and avatar images.</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">B. Real-Time Workspace Canvas Transactions</h3>
              <p className="text-slate-600 text-xs mt-1">When active in a project workspace, our synchronization engines parse and log task cards on your Kanban board, collaborative scratchpad text entries, real-time message threads, and files uploaded to the shared asset locker. This helps coordinate states stay in sync on both freelancer and client screens in real time.</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">C. Payment & Verification Parameters</h3>
              <p className="text-slate-600 text-xs mt-1">Escrow payment coordinates, withdrawal methods (UPI IDs, bank account details with IFSC), and transaction history are stored securely to comply with international KYC (Know Your Customer) and anti-money laundering (AML) protocols. We do not store credit card PIN details on our servers; payment card data is handled by our payment processors in accordance with their security standards.</p>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'usage',
      title: '3. Data Usage & AI Matching',
      icon: Eye,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Your data is processed strictly to coordinate, improve, and protect the platform features:
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li><strong>AI-Driven Matchmaking:</strong> Our Postgres semantic algorithms parse freelancer skill tags and client project descriptions. The matches are updated dynamically without exposing private contact credentials, preventing preemptive system circumvention.</li>
            <li><strong>Escrow Transactions:</strong> Verified billing identifiers coordinate directly with secure escrow pools through our payment processor.</li>
            <li><strong>Service Notifications:</strong> Critical updates (funding of milestone, new task card creation, chat ping, or dispute raise) trigger instant client/freelancer notification loops.</li>
            <li><strong>Grow Coins Leaderboard:</strong> Top referrers are displayed publicly by display name and avatar only. Email addresses, phone numbers and coin balances are never published. Contact support to have your display removed.</li>
          </ul>
        </>
      ),
    },
    {
    id: 'security',
    title: '4. Security & Data Protection Practices',
      icon: Lock,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Security is important to us. We use industry-standard technical and organizational security measures designed to protect personal information:
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-3 text-sm">
            <li><strong>Encryption at Rest:</strong> We employ industry-standard encryption to help protect stored data, including user databases, canvas assets, and profiles.</li>
            <li><strong>Encryption in Transit:</strong> Data transmitted between your device and our services is protected using industry-standard transport encryption (e.g., TLS).</li>
            <li><strong>Security Best Practices:</strong> We follow industry-standard security practices including encryption in transit and at rest, and we are working toward formal third-party security certifications as we scale. Our infrastructure is hosted on trusted cloud providers with physical and network security controls.</li>
            <li><strong>Dispute Isolation:</strong> In the event of a raised dispute, the workspace asset locker is placed into read-only isolation to help prevent modification or tampering of evidence while our mediation team reviews the logs.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'retention',
      title: '5. Asset Retention Policies',
      icon: History,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            We retain active data only for as long as necessary to maintain operational continuity, provide coordinate workspace safety, and adhere to legal tax filings:
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li><strong>Active Workspaces:</strong> Completed workspace canvases (Kanban status history, finalized notes) remain archived on your client and freelancer dashboard for reference unless both sides explicitly consent to delete the archive.</li>
            <li><strong>Financial Records:</strong> Transactional logs, escrow allocations, and platform fee billing details are retained for a minimum of seven (7) years to comply with standard audit and taxation requirements.</li>
            <li><strong>Account Deletion:</strong> Upon filing a profile deletion request under account settings, we will use reasonable efforts to delete your public profile and matches from the database, typically within a few business days. Cached analytical weights are generally purged within 30 days, subject to applicable retention obligations.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'kyc',
      title: '6. Identity Verification (KYC) & Verified Badge',
      icon: ShieldAlert,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo verifies the identity of freelancers and clients to build trust, prevent fraud and duplicate accounts, and satisfy applicable anti-money-laundering (AML) obligations. This section explains exactly what we collect, why, how it is processed, and what the Verified badge means.
          </p>
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">A. What We Collect &amp; Why</h3>
              <ul className="list-disc pl-5 text-slate-600 space-y-2 mt-1 text-sm">
                <li><strong>Identity details:</strong> PAN number, full name as printed on the document, and (where provided) date of birth — used solely to verify your identity and confirm the record belongs to you.</li>
                <li><strong>Document images:</strong> Uploaded front/back copies, used only to review your submission and removed once review is complete. We do not retain raw identity documents longer than necessary for the verification purpose.</li>
                <li><strong>Verification records:</strong> Status, provider/reference ID, timestamps, and masked (non-sensitive) metadata. We do not store your PAN in plain text; it is stored in a format that cannot be used to reconstruct the number, and never displayed publicly. We never store Aadhaar information unless a lawful basis requires it, and we do not claim to perform government-authorized Aadhaar authentication.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">B. Automated Processing &amp; Development Mode</h3>
              <p className="text-slate-600 text-xs mt-1">
                Verification is processed automatically by our systems. During Growlanzo's pre-launch / development phase, verification may be performed through our <strong>development verification mode</strong>, which runs automated platform checks instead of a third-party identity verification provider. Verification records produced this way are clearly labelled internally as such.
              </p>
              <p className="text-slate-600 text-xs mt-2">
                <strong>The Verified badge indicates your verification status on the Growlanzo platform. It is not a government-issued identity certification and should not be represented as one.</strong> Once a third-party verification provider is configured, new verifications run against that provider, and we may re-verify previously automated records.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">C. Third-Party Providers &amp; Consent</h3>
              <p className="text-slate-600 text-xs mt-1">
                When a verification provider is active, we share only the minimum information required for verification (e.g., PAN, name, and date of birth) with that provider, under contractual safeguards, solely for the purpose of verifying your identity. We never sell your identity data. You give explicit consent before any submission, and you may withdraw consent or delete your account at any time; withdrawal may affect your ability to use verification-gated features.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">D. Retention &amp; Your Rights</h3>
              <p className="text-slate-600 text-xs mt-1">
                Verification records are retained while your account is active and thereafter only where required by law (e.g., anti-money-laundering and tax record-keeping). All rights in Section 8 below (access, correction, erasure, withdrawal of consent) apply to verification data, including the right to request correction of a name mismatch or deletion of your verification records.
              </p>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'cookies',
      title: '7. Cookie Policy',
      icon: Cookie,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            To preserve a clean and premium user experience, we keep cookies strictly functional.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo uses cookies to:
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li>Keep you securely authenticated in your active session.</li>
            <li>Preserve workspace layout preferences (such as collapsed sidebars or preferred canvas grid viewports).</li>
            <li>Protect our API endpoints against CSRF (Cross-Site Request Forgery) injections.</li>
          </ul>
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex gap-3 text-slate-700 text-xs">
            <ShieldAlert className="w-5 h-5 shrink-0 text-slate-500 mt-0.5" />
            <div>
              <p className="font-bold">No Retargeting Trackers</p>
              <p className="text-slate-500 mt-1">We do not deploy external ad-tracking, social media remarketing pixels, or third-party behavioral cookies inside your collaborative workspaces.</p>
            </div>
          </div>
        </>
      ),
    },
    {      id: 'rights',
      title: '8. Data Protection & Your Rights',
    icon: Globe,
    content: (
      <>
        <p className="text-slate-600 leading-relaxed mb-2">
          Growlanzo is an India-first platform, and your data is protected in accordance with applicable Indian data protection law, including the Digital Personal Data Protection (DPDP) Act, 2023. We extend the following rights to all users regardless of location:
        </p>
        <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
          <li><strong>Right to Access:</strong> You may request a copy of the personal data we hold about you in a structured, portable format.</li>
          <li><strong>Right to Correction:</strong> You may request correction of inaccurate or incomplete personal information.</li>
          <li><strong>Right to Erasure:</strong> You may request deletion of your personal data, subject to legal retention requirements (e.g., financial records retained for 7 years).</li>
          <li><strong>Right to Withdraw Consent:</strong> You may withdraw consent for data processing at any time, though this may affect your ability to use certain platform features.</li>
        </ul>
        <p className="text-slate-600 text-sm">
          As Growlanzo expands to other regions, we will extend equivalent rights to users in those jurisdictions in accordance with local law (e.g., GDPR for EU users, CCPA for California users).
        </p>
        <p className="text-slate-600 text-sm mt-4">
          <strong>International Transfers:</strong> Where we process or transfer personal data to jurisdictions outside your country of residence, we take steps intended to help ensure that such transfers are subject to appropriate safeguards where required by applicable law.
        </p>
        <p className="text-slate-600 text-sm mt-4">
          To execute any data request or download your workspace history, submit a support ticket through our AI assistant and we'll process your request.
        </p>
      </>
      ),
    },
    {
      id: 'support',
      title: '9. Privacy Administration',
      icon: HelpCircle,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            If you have questions, comments, or seek to file an appeal regarding the processing of data in a disputed contract workspace, please contact our designated Data Protection Officer (DPO): <strong>Muhammad (Founder &amp; CEO)</strong> at <a href="mailto:support@growlanzo.com" className="text-emerald-600 font-medium hover:underline">support@growlanzo.com</a>. We acknowledge privacy requests within 24 hours and aim to resolve them within 15 days.
          </p>
          <div className="bg-slate-900 rounded-xl p-3 text-white flex flex-col sm:flex-row items-center justify-between gap-3 mt-6">
            <div>
              <h3 className="font-bold text-sm">Have a privacy question?</h3>
              <p className="text-xs text-slate-400 mt-1">Create a support ticket and we'll get back to you — all requests are handled securely.</p>
            </div>
            <Link
              to="/contact"
              className="inline-flex h-10 px-4 items-center justify-center font-bold bg-white text-slate-900 rounded-xl hover:bg-slate-100 transition-colors shrink-0 text-xs"
            >
              Contact AI Support
            </Link>
          </div>
        </>
      ),
    },
  ];

export function PrivacyPage() {
  const [activeSection, setActiveSection] = useState<string>('commitment');
  const sections = privacySections;

  const handleScrollToSection = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Sync active section based on scrolling position
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 160;
      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el) {
          const top = el.offsetTop;
          const height = el.offsetHeight;
          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [sections]);

  return (
    <div className="min-h-screen bg-cream font-sans pb-24 text-slate-800">
      {/* Symmetrical Header */}
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

      {/* Hero section */}
      <section className="relative py-16 overflow-hidden bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-900 text-white border-b border-emerald-900/30">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-teal-500/5 rounded-full blur-3xl -ml-20 -mb-20"></div>

        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 2xl:px-12 text-center space-y-4">
          <span className="inline-flex items-center gap-3 px-3 py-1 bg-emerald-500/20 text-emerald-300 font-bold rounded-full border border-emerald-500/30 text-xs uppercase tracking-wider">
            <Shield className="w-4 h-4" />
            Privacy Policy
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight leading-none">
            Privacy & <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Data Protections</span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-xl mx-auto font-medium">
            Your workspace privacy and secure contract data is our priority. Read about our security practices and how we protect your data.
          </p>
          <p className="text-slate-400 text-xs font-bold pt-2">{formatLegalLastUpdatedLine()}</p>
        </div>
      </section>

      {/* Legal Structure Grid */}
      <div className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 mt-12 grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Sticky Sidebar Outline */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-4 bg-white rounded-xl p-4 border border-slate-200/50 shadow-sm max-h-[calc(100vh-10rem)] overflow-y-auto">
            <h2 className="text-xs font-black uppercase text-slate-400 tracking-wider px-3 mb-3">Outline Navigation</h2>
            <div className="space-y-1">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => handleScrollToSection(section.id)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left font-bold text-xs transition-all ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-800 border-l-4 border-emerald-600 shadow-sm'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="truncate">{section.title.split('. ')[1] || section.title}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isActive ? 'rotate-90 text-emerald-600' : 'text-slate-300'}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Detailed Legal Clauses */}
        <div className="lg:col-span-3 space-y-8">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <section
                key={section.id}
                id={section.id}
                className="bg-white rounded-[2rem] border border-slate-200/60 p-3 sm:p-4 shadow-sm scroll-mt-24 hover:shadow-md transition-shadow duration-300"
              >
                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-100">
                  <div className="h-10 w-10 bg-emerald-100/80 rounded-xl flex items-center justify-center text-emerald-700 shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="font-display font-black text-xl text-slate-900 leading-tight">
                    {section.title}
                  </h2>
                </div>
                <div className="prose prose-slate prose-emerald max-w-none text-slate-600 text-sm leading-relaxed">
                  {section.content}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
