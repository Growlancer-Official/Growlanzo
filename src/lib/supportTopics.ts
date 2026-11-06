// ═══════════════════════════════════════════════════════════════════════════
// AI SUPPORT — PRELOADED TOPICS (guided, role-aware)
//
// Support is DIFFERENT from the AI Assistant: no free-typing required — the
// user clicks a topic and follows a short guided flow. Each topic is a small
// decision tree; options either move to the next step or finish with a clear
// answer. All answers are self-contained — no human escalation needed.
// ═══════════════════════════════════════════════════════════════════════════

import { formatCurrency } from './currency';

export interface SupportOption {
  label: string;
  /** Index of the next step in the flow. */
  next?: number;
  /** Ends the flow with this final assistant message. */
  done?: string;
}

export interface SupportStep {
  text: string;
  options: SupportOption[];
}

export interface SupportTopic {
  id: string;
  title: string;
  emoji: string;
  description: string;
  steps: SupportStep[];
}

const verifySteps: SupportStep[] = [
  {
    text: 'Identity verification is quick (usually under a minute) and unlocks payments, escrow funding and withdrawals. What do you need help with?',
    options: [
      { label: 'How do I verify?', next: 1 },
      { label: 'My verification is stuck / pending', next: 2 },
      { label: 'My verification was rejected', next: 3 },
    ],
  },
  {
    text: 'Great — go to **Verification** in your dashboard (or tap the shield icon). Upload a clear photo of a government ID (Aadhaar, PAN, Passport or Driver\u2019s License) and your details are checked instantly. Once verified, your badge goes live in real time.',
    options: [{ label: 'Open Verification page', next: 4 }, { label: 'Got it — thanks!', done: 'You\u2019re welcome! Your verified badge and full access unlock as soon as it goes live. 🎉' }],
  },
  {
    text: 'Verification usually completes in seconds. If it has been more than 15 minutes, try refreshing the page or logging out and back in. The system re-checks automatically — most stuck verifications resolve on their own.',
    options: [{ label: 'Try again', next: 1 }, { label: 'Got it — thanks!', done: 'If it\u2019s still pending after an hour, it\u2019s usually a document quality issue — retake the photo in good lighting and resubmit. 📸' }],
  },
  {
    text: 'Verification rejections are usually due to blurry photos, expired IDs, or name mismatches. You can resubmit anytime with a clearer photo — no penalty.',
    options: [{ label: 'Resubmit now', next: 4 }, { label: 'Got it — thanks!', done: 'Take a clear, well-lit photo of your ID and resubmit from the Verification page. You\u2019ll be verified in no time! ✅' }],
  },
  {
    text: 'You can open the verification page from your dashboard menu anytime.',
    options: [{ label: 'Done — thanks!', done: 'You\u2019re welcome! Your verified badge and full access unlock as soon as it goes live. 🎉' }],
  },
];

export const FREELANCER_SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: 'payments-withdrawals',
    title: 'Payments & Withdrawals',
    emoji: '💰',
    description: 'Wallet balance, payout fees, withdrawal time',
    steps: [
      {
        text: 'What would you like to know about payments?',
        options: [
          { label: 'When can I withdraw?', next: 1 },
          { label: 'What is the 2% payout fee?', next: 2 },
          { label: 'My payment is missing', next: 3 },
        ],
      },
      {
        text: 'Withdrawals are available from your **Wallet** once escrow payments are released to you. Funds appear in your wallet the moment a milestone is approved/released — then you can withdraw to your saved payout method (bank/UPI). Withdrawals typically arrive within 1–2 business days.',
        options: [{ label: 'Got it — thanks!', done: 'Anytime! Your wallet updates in real time — keep earning. 💪' }, { label: 'Tell me about fees', next: 2 }],
      },
      {
        text: 'The **2% payout processing fee** is charged by the payment processor (Razorpay/PayPal) when you withdraw — it\u2019s their actual transfer cost, not a Growlanzo fee, and it\u2019s shown separately before you confirm. A flat 5% commission is deducted once, when your earnings are released — nothing else is taken from your wallet.',
        options: [{ label: 'Clear — thanks!', done: 'You keep 95% of every project amount — the 5% commission is deducted before it reaches your wallet; only the processor’s 2% applies when you withdraw. 🎉' }, { label: 'Back to payments', next: 0 }],
      },
      {
        text: 'If a released payment is not showing in your wallet, check your **Transaction History** — releases post in real time. Common reasons for delay: (1) the client hasn\u2019t approved the milestone yet, (2) the escrow is still in the review window (72h auto-release), or (3) the contract status is still "In Progress".',
        options: [{ label: 'Check my wallet', done: 'Open your Wallet page to see your current balance and recent transactions. If the balance looks wrong after 30 minutes, try refreshing — data syncs in real time. 💰' }, { label: 'Got it — thanks!', done: 'Your wallet updates the instant escrow is released. Keep an eye on your Transaction History for the full timeline. ✅' }],
      },
    ],
  },
  {
    id: 'contracts-escrow',
    title: 'Contracts & Escrow',
    emoji: '📋',
    description: 'Milestones, funding, auto-release',
    steps: [
      {
        text: 'What would you like to know about your contracts?',
        options: [
          { label: 'How does escrow + auto-release work?', next: 1 },
          { label: 'Client hasn\u2019t funded escrow yet', next: 2 },
          { label: 'How do milestones release?', next: 1 },
        ],
      },
      {
        text: 'When a client funds a contract, the full amount sits in **Growlanzo Escrow** — protected for both sides. Once you deliver, the client gets a review window (default 72h). If they don\u2019t respond in time, the escrow **auto-releases** to your wallet — a client can never hold your payment hostage. You can never be paid before delivering, and the client can never be charged for work not done.',
        options: [{ label: 'Perfect — thanks!', done: 'That\u2019s escrow doing its job — the money is held before work starts and released when you deliver, for both sides. 🛡️' }, { label: 'Tell me about milestones', next: 1 }],
      },
      {
        text: 'The freelancer only starts after escrow is funded — that\u2019s by design. Politely remind the client in the workspace chat. Most clients fund within 24–48h. If the contract has been stuck unfunded for over a week, you can withdraw your proposal and move on to other projects.',
        options: [{ label: 'Got it — thanks!', done: 'Communication is key — most funding delays are just clients being busy, not unwilling. 💬' }, { label: 'Back to contracts', next: 0 }],
      },
    ],
  },
  {
    id: 'disputes',
    title: 'Disputes & Refunds',
    emoji: '⚖️',
    description: 'Raise or track a dispute',
    steps: [
      {
        text: 'Disputes are always reviewed by a **human team** — never decided by AI. Before we go further: disputes freeze the remaining escrow so nothing moves while it\u2019s reviewed. What\u2019s happening?',
        options: [
          { label: 'I want to raise a dispute', next: 1 },
          { label: 'My dispute is in review — when?', next: 2 },
        ],
      },
      {
        text: 'To raise a dispute: go to the **Disputes** page from your dashboard sidebar, or open the contract and tap **Raise Dispute**. Attach evidence (screenshots, files, chat logs) — the more context, the faster the resolution. Our team reviews within 1–3 business days.',
        options: [{ label: 'Open Disputes page', done: 'Head to your Disputes page to file a new dispute. Attach all relevant evidence for the fastest resolution. ⚖️' }, { label: 'Got it — thanks!', done: 'Disputes are always resolved fairly with full evidence review. You\u2019re protected. 🛡️' }],
      },
      {
        text: 'Dispute reviews typically take 1–3 business days. You\u2019ll see live status updates in the dispute panel. The team reviews all evidence (files, chat, audit trail) before making a fair, binding decision.',
        options: [{ label: 'Check my dispute', done: 'Open the Disputes page to see your dispute status and any updates from the review team. 📋' }, { label: 'Got it — thanks!', done: 'Your dispute is in good hands — the team reviews everything thoroughly. ⚖️' }],
      },
    ],
  },
  {
    id: 'verification',
    title: 'Identity Verification',
    emoji: '🛡️',
    description: 'KYC, verified badge, unlocks',
    steps: verifySteps,
  },
  {
    id: 'premium',
    title: 'Freelancer Premium',
    emoji: '👑',
    description: `${formatCurrency(199)}/month plan, AI tools, cancel anytime`,
    steps: [
      {
        text: `Freelancer Premium is **${formatCurrency(199)}/month, flat** — optional, cancel anytime. It removes the monthly cap on AI assistant messages, raises AI writing to 100 generations per day (free users get 5 per day) and adds a Premium badge. It never affects your packages, ranking or visibility — everything stays merit-based.`,
        options: [
          { label: 'How do I subscribe?', next: 1 },
          { label: 'How do I cancel?', next: 2 },
        ],
      },
      {
        text: 'You can subscribe from the **Premium** page in your dashboard. Choose your payment method (wallet balance or Razorpay) and you\u2019re upgraded instantly. Your AI tools activate immediately.',
        options: [{ label: 'Open Premium page', done: 'Head to the Premium page from your dashboard sidebar to subscribe. It takes just a couple of clicks! 👑' }, { label: 'Got it — thanks!', done: 'Premium is your choice, always. No pressure, no locks — cancel anytime. 👑' }],
      },
      {
        text: 'You can cancel anytime from the **Premium** page — no questions asked, no cancellation fees. Your premium features stay active until the end of your current billing period.',
        options: [{ label: 'Open Premium page', done: 'Go to Premium → Manage Plan → Cancel. Your features stay active until the billing period ends. 👑' }, { label: 'Got it — thanks!', done: 'Anytime! Premium is your choice, always. 👑' }],
      },
    ],
  },
  {
    id: 'account-security',
    title: 'Account & Security',
    emoji: '🔐',
    description: 'Login, email verification, security',
    steps: [
      {
        text: 'What\u2019s going on with your account?',
        options: [
          { label: 'I can\u2019t log in', next: 1 },
          { label: 'Email verification issues', next: 2 },
        ],
      },
      {
        text: 'Growlanzo signs you in with **GitHub** or **LinkedIn** — we never store a password for your account, so there is nothing to reset here. If you can\u2019t sign in, make sure you\u2019re still able to log in to your GitHub/LinkedIn account (recover it on their site if needed), then come back and continue with the same provider you used to sign up.',
        options: [{ label: 'Got it — thanks!', done: 'Use the same GitHub/LinkedIn account you signed up with and you\u2019re back in — no password involved. 🔐' }, { label: 'Email issues', next: 2 }],
      },
      {
        text: 'If you signed up with LinkedIn or GitHub, your email is already verified through OAuth — nothing to do. For older email/password accounts, check your inbox (and spam folder) for the verification email; you can see live verification status and resend it from the **Email verification** card in your account settings.',
        options: [{ label: 'Got it — thanks!', done: 'LinkedIn/GitHub sign-ups are verified automatically. Older accounts can resend from the settings card. ✅' }],
      },
    ],
  },
];

export const CLIENT_SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: 'payments-refunds',
    title: 'Payments & Refunds',
    emoji: '💳',
    description: 'Fees, escrow funding, refunds',
    steps: [
      {
        text: 'What would you like to know about payments?',
        options: [
          { label: 'What are the fees?', next: 1 },
          { label: 'How do I request a refund?', next: 2 },
          { label: 'My payment failed / charged twice', next: 3 },
        ],
      },
      {
        text: 'Clients pay **exactly the package price** — no platform fee is added at checkout. Growlanzo’s flat 5% commission is deducted from the freelancer’s payout when the work is paid. When you withdraw from your wallet later, the payment processor’s 2% transfer fee applies separately — that’s their cost, passed through at cost.',
        options: [{ label: 'Clear — thanks!', done: 'Simple and transparent — that\u2019s the Growlanzo promise. 🎉' }, { label: 'Tell me about refunds', next: 2 }],
      },
      {
        text: 'Refunds are available for work **not yet delivered or approved** — just open the contract workspace and request a refund. Funded escrow is returned minus any platform fees already incurred. Once work is delivered and approved, payment is final unless there\u2019s verified fraud or a clear Terms violation.',
        options: [{ label: 'How do disputes work?', next: 4 }, { label: 'Got it — thanks!', done: 'You\u2019re protected at every step. 🛡️' }],
      },
      {
        text: 'If a payment failed or you were charged twice, don\u2019t worry — failed payments are automatically reversed within 3–5 business days. Double charges are rare but if they happen, the duplicate is refunded automatically. Check your Transaction History for the refund status.',
        options: [{ label: 'Check my transactions', done: 'Open your Payments page to see your transaction history. Refunds for failed/double charges appear within 3–5 business days. 💳' }, { label: 'Got it — thanks!', done: 'Payment issues are almost always auto-resolved. Check your Transaction History for real-time updates. ✅' }],
      },
      {
        text: 'Disputes are reviewed by a **human team** (never AI) with full evidence — files, chat, and the audit trail. Raise it from the contract workspace; the decision is binding and fair.',
        options: [{ label: 'Got it — thanks!', done: 'You\u2019re protected at every step. 🛡️' }],
      },
    ],
  },
  {
    id: 'hiring-contracts',
    title: 'Hiring & Contracts',
    emoji: '📋',
    description: 'Packages, milestones, escrow funding',
    steps: [
      {
        text: 'What would you like to know about hiring?',
        options: [
          { label: 'How do packages & escrow work?', next: 1 },
          { label: 'I need to fund escrow', next: 2 },
          { label: 'Auto-release — what if I\u2019m late?', next: 3 },
        ],
      },
      {
        text: 'Freelancers offer **3 packages (Basic / Standard / Premium)** with add-ons. When you order, the price is locked into escrow from the freelancer\u2019s published listing. You fund escrow once, the freelancer works, you review the delivery — if you\u2019re happy (or don\u2019t respond within the review window, default 72h), the payment releases. Your money is never at risk for work not done.',
        options: [{ label: 'Perfect — thanks!', done: 'Safe for you, fair for the freelancer. 🎉' }, { label: 'Tell me about escrow', next: 2 }],
      },
      {
        text: 'Open the contract workspace and tap **Fund Escrow** — the payment is protected until you approve the delivery. You can pay by UPI, card, net banking or wallet. The freelancer only starts working after escrow is funded.',
        options: [{ label: 'Open workspace', done: 'Go to your Contracts page, open the contract, and tap Fund Escrow. Your payment is fully protected. 🛡️' }, { label: 'Got it — thanks!', done: 'Anytime! Happy hiring. 🚀' }],
      },
      {
        text: 'The auto-release window is **72 hours** after delivery. If you need more time to review, just open the contract and leave feedback — the timer pauses when you interact. You can also approve early if you\u2019re satisfied. If you genuinely need an extension, communicate with the freelancer in the workspace.',
        options: [{ label: 'Got it — thanks!', done: 'You\u2019re always in control — review at your pace, approve when ready. 🎯' }, { label: 'Open my contract', done: 'Head to your Contracts page to review and manage your active contracts. 📋' }],
      },
    ],
  },
  {
    id: 'disputes',
    title: 'Disputes',
    emoji: '⚖️',
    description: 'Raise or track a dispute',
    steps: [
      {
        text: 'Disputes are always reviewed by a **human** — never AI. Escrow freezes while it\u2019s reviewed so nothing moves unfairly. What\u2019s happening?',
        options: [
          { label: 'I want to raise a dispute', next: 1 },
          { label: 'My dispute is in review — when?', next: 2 },
        ],
      },
      {
        text: 'To raise a dispute: go to the **Disputes** page from your dashboard, or open the contract and tap **Raise Dispute**. Attach evidence (screenshots, files, chat logs). Our team reviews within 1–3 business days.',
        options: [{ label: 'Open Disputes page', done: 'Head to your Disputes page to file a new dispute. Attach all relevant evidence for the fastest resolution. ⚖️' }, { label: 'Got it — thanks!', done: 'Disputes are always resolved fairly with full evidence review. 🛡️' }],
      },
      {
        text: 'Reviews typically take 1–3 business days with live status updates in the dispute panel. The team reviews all evidence before making a fair, binding decision.',
        options: [{ label: 'Check my dispute', done: 'Open the Disputes page to see your dispute status and any updates from the review team. 📋' }, { label: 'Got it — thanks!', done: 'Your dispute is in good hands. ⚖️' }],
      },
    ],
  },
  {
    id: 'verification',
    title: 'Identity Verification',
    emoji: '🛡️',
    description: 'KYC, verified badge, unlocks',
    steps: verifySteps,
  },
  {
    id: 'finding-talent',
    title: 'Finding Freelancers',
    emoji: '🔍',
    description: 'AI matching, invites, proposals',
    steps: [
      {
        text: 'What would you like to know about finding talent?',
        options: [
          { label: 'How does AI matching work?', next: 1 },
          { label: 'How do invites work?', next: 2 },
        ],
      },
      {
        text: 'AI matching scores freelancers purely on merit — category, skills, experience and availability (never paid boosts). The best matches appear at the top. You can also filter by rating, budget, and delivery time to find the perfect fit.',
        options: [{ label: 'Great — thanks!', done: 'Matching is always merit-based — the best freelancer for your project wins. 🎯' }, { label: 'Tell me about invites', next: 2 }],
      },
      {
        text: 'Invites let you reach out to specific freelancers before they even see your project. Go to **Find Talent**, browse profiles, and tap **Invite** on any freelancer you like. They\u2019ll get a notification and can accept or decline. You can also post your project publicly and let proposals come to you.',
        options: [{ label: 'Open Find Talent', done: 'Head to Find Talent to browse freelancers and send invites. The best match is just a click away! 🔍' }, { label: 'Got it — thanks!', done: 'Hiring is easy on Growlanzo — invite or post, the talent comes to you. 🚀' }],
      },
    ],
  },
];
