import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatLegalLastUpdatedLine } from '@/lib/legalLastUpdated';
import { AlertOctagon, ArrowLeft, BookOpen, ChevronRight, IndianRupee, FileCode, Gavel, HelpCircle, Lock, Scale, Shield, ShieldCheck, Cpu,  } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';

interface Section {
  id: string;
  title: string;
  icon: any;
  content: React.ReactNode;
}

const termsSections: Section[] = [
  {
    id: 'intro',
    title: '1. Introduction & Account Terms',
    icon: BookOpen,
    content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Welcome to Growlanzo ("Platform", "we", "us", or "our"). These Terms of Service constitute a legally binding agreement made between you, whether personally or on behalf of an entity ("you", "User", "Client", or "Freelancer") and Growlanzo, concerning your access to and use of our website, applications, and services.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            By accessing the Platform, creating an account, or clicking "Accept", you acknowledge that you have read, understood, and agree to be bound by all of these Terms. If you do not agree with all of these terms, you are expressly prohibited from using the Platform and must discontinue use immediately.
          </p>
          <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4 flex gap-3 text-emerald-800 text-sm font-medium">
            <ShieldCheck className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
            <div>
              <p className="font-bold">Eligibility Requirement</p>
              <p className="text-emerald-700 text-xs mt-1">You must be at least 18 years old and capable of entering into legally binding contracts under applicable jurisdiction to register and use Growlanzo.</p>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'relationship',
      title: '2. Freelancer & Client Relations',
      icon: Scale,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo operates as a high-fidelity workspace matching platform. We provide the infrastructure (including our real-time collaborative workspace canvases, interactive Kanban boards, focus-locked shared scratchpads, and secure escrow tools) to facilitate professional engagements.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            You explicitly acknowledge and agree that:
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li><strong>Independent Status:</strong> Freelancers are independent contractors, not employees, agents, or partners of Growlanzo or the Client. Nothing in these Terms creates an employment, agency, partnership, or joint venture relationship between you and Growlanzo, and no freelancer is entitled to employee benefits, withholdings, or protections provided to employees.</li>
            <li><strong>Service Contracts:</strong> Upon a Client purchasing a Freelancer's Service or awarding a bid, a direct, legally binding contract is established between the Client and the Freelancer. Growlanzo is not a party to this contract, but acts as a secure platform and escrow facilitator.</li>
            <li><strong>Performance Quality:</strong> Freelancers are solely responsible for the quality, accuracy, and timely delivery of their work as agreed upon in the workspace.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'fees',
      title: '3. Platform Fees & 5% Commission',
      icon: IndianRupee,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            To sustain our real-time synchronization servers, AI semantic matching models, and secure escrow operations, Growlanzo implements a highly competitive and flat fee structure across all transactions.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-xs font-black uppercase text-emerald-600 tracking-wider">Client Fee</span>
                <h2 className="text-3xl font-black text-slate-900 mt-1">0%</h2>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  You pay the agreed project amount. Growlanzo adds no commission, service charge or platform fee at checkout — escrow processing, the workspace and dispute mediation are included.
                </p>
              </div>
            </div>
            <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-xs font-black uppercase text-emerald-600 tracking-wider">Freelancer Commission</span>
                <h2 className="text-3xl font-black text-slate-900 mt-1">5%</h2>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Deducted from the amount you earn when it is released to your wallet — never charged upfront. ₹10,000 released means ₹9,500 in your wallet.
                </p>
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-xs text-amber-800 font-medium">
                    <strong>Note:</strong> A separate payment-processing fee may apply when you withdraw funds from your wallet, charged by our payment processor, not by Growlanzo. As of the date of these Terms, RazorpayX (India) withdrawals incur a 2% processing fee, though this rate may change from time to time. PayPal withdrawals are coming soon. Any current applicable fees are clearly displayed before you confirm any transaction or withdrawal.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <p className="text-slate-600 leading-relaxed text-sm">
            All prices and payouts are calculated in INR (₹). Platform fees may be updated from time to time, and the fees applicable at the time of a transaction will apply. Platform fees are non-refundable once work on a milestone has commenced or the escrow payment has been released to the Freelancer.
          </p>
        </>
      ),
    },
    {
      id: 'escrow',
      title: '4. Escrow Safety Protection',
      icon: Lock,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo's proprietary <strong>Escrow Safety Protection</strong> is designed to help reduce financial risk for both parties and minimize the coordination gaps that can occur on freelancing platforms. Escrow helps protect both clients and freelancers by holding funds until agreed milestones or completion conditions are met, but it cannot eliminate every dispute.
          </p>
          <div className="relative border-l-2 border-emerald-500 pl-4 space-y-4 mb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">A. Contract Funding</h3>
              <p className="text-slate-600 text-xs mt-1">Clients must fully fund the agreed contract amount (the milestone or project total) into a secure Growlanzo Escrow balance before the Freelancer starts working. No platform commission is added to this amount. This is designed to help confirm that funds are available before work begins.</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">B. Real-Time Workspace Canvas</h3>
              <p className="text-slate-600 text-xs mt-1">Work progress is tracked transparently. Once the project begins, task milestones are automatically populated in the collaborative space and are updated dynamically as changes occur.</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">C. Milestone Releases & Auto-Release</h3>
              <p className="text-slate-600 text-xs mt-1">Upon delivery of the milestone files or services, the Client reviews the work within the review window (default 72 hours, adjustable 24 hours – 7 days). Once satisfied, the Client releases the escrow, transferring funds to the Freelancer's wallet. If the Client does not respond within the window, the payment releases automatically — funds are never held hostage by either party, and how many days the work took is irrelevant to the timer, which starts only at delivery. Releasing funds constitutes final acceptance of that milestone; a released payment is final and is not refundable except in cases of verified fraud or a clear violation of these Terms.</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">D. Revisions & Extra Work</h3>
              <p className="text-slate-600 text-xs mt-1">Each Service listing states the number of free revisions included in the base price. Requests within the included free revisions are covered at no additional cost. If the Client requests more revisions than included, the Freelancer may charge their published extra-revision rate or a mutually agreed price; the Client's consent is required before any paid extra work begins, and any such charges are payable through Growlanzo Escrow. Unaddressed delivered work follows the platform's review-window escalation process so that no party is left without a resolution. Revision disputes are governed by Section 6 (Dispute Resolution & Mediation).</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">E. Team Projects — Independent Contracts</h3>
              <p className="text-slate-600 text-xs mt-1">When a Client hires multiple freelancers through a Team Project, each freelancer is engaged under a <strong>separate, independent contract</strong> — with its own escrow, milestones, review window and dispute process. The Client is independently contracting with each freelancer; there is no single mega-contract covering the team. Each freelancer is individually responsible for their own deliverables, and Growlanzo provides no cross-freelancer coordination or delivery guarantee — only payment protection (escrow) for each individual contract. If one member of the team fails to deliver, the other contracts <strong>are not</strong> cancelled or affected; each contract is resolved on its own terms. The 5% platform fee applies to each individual contract, with no separate "team fee".</p>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'ip',
      title: '5. Deliverables & IP Rights',
      icon: FileCode,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Intellectual Property ("IP") rights are critical for both clients and freelancers. Unless explicitly agreed otherwise in a custom written contract between the Freelancer and the Client:
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li><strong>Automatic Transfer:</strong> Upon the Client's final payment release of the respective project's escrow funds, all intellectual property rights, ownership, and titles in the deliverables created specifically for that project are transferred to the Client, subject to any separate written agreement between the Freelancer and Client to the contrary.</li>
            <li><strong>Pre-Existing Intellectual Property:</strong> The Freelancer retains all rights to any pre-existing code, libraries, design templates, and tools used during the project. Freelancer grants the Client a perpetual, royalty-free, worldwide license to use such pre-existing intellectual property within the deliverables, as is standard for platform-delivered work.</li>
            <li><strong>Platform Portfolio Rights:</strong> Freelancers are granted a limited license to showcase completed deliverables in their Growlanzo portfolios, unless the Client has purchased a "Private Work" contract that specifies confidentiality.</li>
          </ul>
          <p className="text-slate-600 leading-relaxed mb-2">
            <strong>Ownership Distinctions:</strong> Growlanzo does not automatically own, and makes no claim to, the work product, deliverables, or content created by Freelancers or uploaded by Users. Growlanzo retains ownership of the Platform itself, including its software, design, trademarks, logos, and other platform intellectual property. Users retain ownership of their user-generated content and uploaded files, and Clients retain ownership of assets they provide to a Freelancer for a project. By uploading content to the Platform, you grant Growlanzo a limited, non-exclusive, worldwide, royalty-free license to host, display, and process that content solely to operate and improve the Platform.
          </p>
        </>
      ),
    },
    {
      id: 'disputes',
      title: '6. Dispute Resolution & Mediation',
      icon: Gavel,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            In the event of a coordination breakdown or standard mismatch in deliverables, users can trigger the official dispute process directly in their active Milestones tab.
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3 mb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              The 3-Step Dispute Protocol:
            </h3>
            <ol className="list-decimal pl-5 text-xs text-slate-600 space-y-4">
              <li><strong>1. Coordination Check (48 Hours):</strong> Upon raising a dispute, the contract status is changed to "disputed". The workspace asset locker is frozen, preventing any further uploads or modifications. The client and freelancer are given 48 hours to communicate and resolve the issue mutually (e.g. adjust task requirements or agree to a partial refund).</li>
              <li><strong>2. AI-Assisted Audit:</strong> If no agreement is reached, either party may escalate the dispute to the Growlanzo Dispute Center. Our AI Mediator may assist by evaluating workspace logs, chat archives, and task cards, and may propose a split ratio (e.g. 70% payout / 30% refund) as a non-binding starting point for resolution. AI assistance is provided to support, not replace, human judgment.</li>
              <li><strong>3. Human Review & Binding Decision:</strong> A human dispute resolution specialist reviews the AI's recommendation, along with all evidence, and confirms or adjusts the proposed split. Growlanzo then issues a final, binding escrow allocation decision. Both parties agree to abide by this decision. Funds are moved only after human confirmation.</li>
            </ol>
          </div>
        </>
      ),
    },
    {
      id: 'circumvention',
      title: '7. Anti-Circumvention Policy',
      icon: AlertOctagon,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            To support a safe, fair, and reliable environment for both parties, Growlanzo strictly prohibits circumvention of our system's secure escrow and project matching structures.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            Prohibited actions include:
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li>Exchanging direct emails, phone numbers, MessageSquare invites, or social accounts prior to a contract being funded.</li>
            <li>Soliciting, suggesting, or accepting direct payments outside of the Growlanzo system (e.g. direct PayPal, wire transfers, crypto payments) for projects initially sourced on Growlanzo.</li>
            <li>Registering multiple user accounts under fake identities to game our AI matching systems or bypass platform suspension restrictions.</li>
          </ul>
          <p className="text-slate-600 text-sm">
            <strong>Penalties:</strong> Violations of this policy may result in suspension of your account, forfeiture of active referral payouts, and restrictions on access to our matching and workspace services, depending on the nature and severity of the violation.
          </p>
        </>
      ),
    },
    {
      id: 'liability',
      title: '8. Limitation of Liability',
      icon: AlertOctagon,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            <strong>IMPORTANT: PLEASE READ THIS SECTION CAREFULLY. IT LIMITS THE LIABILITY OF GROWLANZO AND ITS AFFILIATES.</strong>
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            To the fullest extent permitted by applicable law, in no event shall Growlanzo, its officers, directors, employees, or agents be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, use, goodwill, or other intangible losses, arising out of or in connection with your use of the Platform, whether based on warranty, contract, tort (including negligence), or any other legal theory, even if Growlanzo has been advised of the possibility of such damages.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo's total liability to you for any claims arising from or relating to these Terms or your use of the Platform shall be limited to the aggregate amount of fees paid by you to Growlanzo in the twelve (12) months preceding the event giving rise to the claim.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            The limitations in this section do not apply to liability that cannot be excluded or limited by applicable law, such as liability for gross negligence, fraud, or death or personal injury caused by negligence.
          </p>
        </>
      ),
    },
    {
      id: 'disclaimer',
      title: '9. Disclaimer of Warranties',
      icon: Shield,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            <strong>IMPORTANT: PLEASE READ THIS SECTION CAREFULLY. IT DISCLAIMS CERTAIN WARRANTIES.</strong>
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            THE PLATFORM IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT ANY WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, GROWLANZO DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND COURSE OF DEALING OR USAGE OF TRADE.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo does not warrant that: (a) the Platform will function uninterrupted, secure, or available at any particular time or location; (b) any errors or defects will be corrected; (c) the results of using the Platform will meet your requirements or expectations; or (d) the Platform is free of viruses or other harmful components.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            No advice or information, whether oral or written, obtained by you from Growlanzo or through the Platform shall create any warranty not expressly stated in these Terms.
          </p>
        </>
      ),
    },
    {
      id: 'ai',
      title: '10. AI & Automated Features Disclaimer',
      icon: Cpu,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo uses artificial intelligence ("AI") and automated systems to assist with features such as project matching, dispute analysis, workspace coordination, and AI writing (generating project titles, descriptions, service listings, and cover messages from your input). AI is intended to help improve your experience and may provide recommendations, but it does not make final or perfect decisions.
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li><strong>AI Assists, It Does Not Decide:</strong> AI-generated recommendations and outputs are provided to support, not replace, human judgment. Dispute resolutions and other decisions are subject to human review where applicable.</li>
            <li><strong>Not Professional Advice:</strong> AI-generated recommendations, including matching suggestions and dispute analysis, should not be treated as legal, financial, tax, or other professional advice.</li>
            <li><strong>No Guarantee of Outcomes:</strong> AI assistance does not guarantee project success, matching quality, or any particular outcome. Outputs may occasionally require human review or correction.</li>
            <li><strong>AI Writing Is Your Responsibility:</strong> Text generated by our AI writing feature (titles, descriptions, cover messages, service listings) is a suggestion — you are responsible for reviewing, editing, and confirming that any AI-generated content you publish is accurate, original, and complies with these Terms and applicable law.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'professional-advice',
      title: '11. No Professional Advice',
      icon: Gavel,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo is a technology platform and does not provide legal, financial, tax, accounting, employment, immigration, or other professional consulting services. Content available on the Platform, including AI-generated recommendations and informational materials, is provided for general informational purposes only.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            You remain solely responsible for obtaining independent professional advice where required, including in relation to your contracts, taxes, employment status, intellectual property, or compliance with applicable laws.
          </p>
        </>
      ),
    },
    {
      id: 'verified-badge',
      title: '12. Identity Verification & Verified Badge',
      icon: ShieldCheck,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo offers identity verification to strengthen trust between freelancers and clients. The platform's <strong>Verified badge</strong> indicates that a user has completed Growlanzo's verification process and is in good standing.
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-4 mb-2 text-sm">
            <li><strong>Badge Meaning:</strong> The Verified badge reflects your verification status on the Growlanzo platform. It is not a government-issued identity certification, a creditworthiness assessment, or a representation of professional qualifications. You may not represent it as such.</li>
            <li><strong>Automated Verification & Development Mode:</strong> Verification is processed automatically by Growlanzo. During the platform's pre-launch / development phase, verification may be performed through Growlanzo's development verification mode, which runs automated platform checks rather than a third-party identity verification provider. Verification records from this mode are internally labelled as such.</li>
            <li><strong>Accurate Information Required:</strong> You agree to provide accurate, current, and complete identity information. Submitting false, fabricated, or another person's identity documents is a violation of these Terms and may result in account suspension, permanent ban, or legal action.</li>
            <li><strong>One Identity Per Account:</strong> Each verified identity may be used on only one Growlanzo account. Attempting to verify the same identity on multiple accounts is prohibited; such attempts may be rejected or result in account action.</li>
            <li><strong>Badge Can Be Removed:</strong> Growlanzo may remove, suspend, or reset a Verified badge at any time if we reasonably believe verification information is inaccurate, fraudulent, or in breach of these Terms. If your badge is removed, you may be able to re-verify by submitting accurate information again.</li>
            <li><strong>Consent & Data Use:</strong> By submitting verification information you consent to its processing as described in our <Link to="/privacy" className="text-emerald-600 hover:text-emerald-700 font-medium underline underline-offset-2">Privacy Policy</Link>, including automated processing and, where applicable, sharing with third-party verification providers solely for verification purposes.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'force-majeure',
      title: '13. Force Majeure',
      icon: Shield,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo shall not be liable for any failure or delay in performing its obligations under these Terms caused by events beyond its reasonable control, including but not limited to natural disasters, internet or network outages, cloud provider failures, payment provider outages, cyber attacks, government actions, war, civil unrest, pandemics, power failures, and other unforeseen events.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            Where such an event occurs, Growlanzo will use reasonable efforts to resume performance as soon as reasonably practicable. Obligations suspended by a force majeure event will resume once the event ceases to affect performance.
          </p>
        </>
      ),
    },
    {
      id: 'grow-coins',
      title: '14. Grow Coins Programme',
      icon: IndianRupee,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            Grow Coins are a rewards currency: <strong>1 Grow Coin = ₹1</strong>, whole coins only. You earn them through real platform activity — never by signing up. When a referral relationship is confirmed — the referred user's identity is approved by a real verification provider — <strong>5 coins are credited to each side</strong>. Every project that referred user completes afterwards credits <strong>5 coins to each side again</strong>, for as long as the relationship exists, with no monthly or lifetime cap. Automated development-mode or sandbox verification results never earn coins.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            Freelancers can exchange coins for one month of Premium (199 coins). Clients can apply coins as a ₹1-per-coin discount at checkout, from 100 coins upward. Cash withdrawal is not open yet and is shown as “coming soon” for both roles; coins do not expire while it is unavailable. Automated development-mode or sandbox verification results never earn coins.
          </p>
          <ul className="list-disc pl-5 text-slate-600 space-y-2 mb-2 text-sm">
            <li><strong>No cash value except redemption</strong> — coins cannot be sold, transferred or gifted outside the published redemption routes.</li>
            <li><strong>No expiry</strong> — coins do not lapse.</li>
            <li><strong>Correction &amp; clawback</strong> — coins credited in error or obtained through fraud, abuse, or fake accounts may be removed, and an admin adjustment can never leave a negative balance.</li>
            <li><strong>Tax</strong> — coins have a real rupee value; any tax on redemptions is the recipient's responsibility.</li>
            <li><strong>Public leaderboard</strong> — top referrers are shown by display name and avatar only; email, phone and balances are never published.</li>
            <li><strong>No ranking influence</strong> — coins never affect search visibility, matching or ranking. Those stay 100% merit-based.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'support',
      title: '15. Legal Administration & Contact',
      icon: HelpCircle,
      content: (
        <>
          <p className="text-slate-600 leading-relaxed mb-2">
            These Terms of Service shall be governed by and construed in accordance with the laws of India, without regard to conflict of law principles.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            Growlanzo is operated by <strong>Muhammad (Founder &amp; CEO)</strong>, India. For legal notices, grievances, or complaints, contact our grievance officer at <a href="mailto:growlanzo.own@gmail.com" className="text-emerald-600 font-medium hover:underline">growlanzo.own@gmail.com</a>. We acknowledge grievances within 24 hours and aim to resolve them within 15 days, in line with the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.
          </p>
          <p className="text-slate-600 leading-relaxed mb-2">
            If any provision of these Terms is deemed invalid or unenforceable, that specific clause shall be severed, and the remaining provisions shall continue in full force and effect.
          </p>
          <div className="bg-slate-900 rounded-xl p-3 text-white flex flex-col sm:flex-row items-center justify-between gap-3 mt-6">
            <div>
              <h3 className="font-bold text-sm">Have legal or compliance questions?</h3>
              <p className="text-xs text-slate-400 mt-1">Submit a support ticket and our team will review your inquiry.</p>
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

export function TermsPage() {
  const [activeSection, setActiveSection] = useState<string>('intro');
  const sections = termsSections;

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
            Legal Terms
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight leading-none">
            Terms of <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Service Agreement</span>
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-xl mx-auto font-medium">
            Please read these terms carefully. They define platform fees, escrow safety, work ownership, and dispute rules.
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
