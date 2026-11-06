import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Truthful plan claims — the plan surfaces advertised benefits the product does
 * not deliver, including on the LIVE paid plan (Rs 299/month):
 *
 *   "Unlimited AI writing"      -> ai-writer caps Pro at PRO_DAILY_LIMIT (100/day)
 *   "Priority AI responses"     -> no priority/queue mechanism exists at all
 *   "Priority support 24/7"     -> there is no 24/7 human support team
 *   "Advanced analytics"        -> (since the tier split) ALLOWED ONLY when the
 *                                  advanced section really exists behind
 *                                  isPremiumSubscription; the plain analytics
 *                                  dashboard must still read as free for all
 *   "AI profile optimization"   -> no such feature exists anywhere in the code
 *   "Priority AI project matching" / "Featured profile placement"
 *                               -> pay-to-win. Ranking and matching are 100%
 *                                  merit-based and a paid flag may never influence
 *                                  them (non-negotiable business rule).
 *
 * These were copy + seed-data defects, so no behavioural test could see them.
 * This guard reads the real files and fails if any claim comes back.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** Every surface that sells a plan, escrow or a trust badge to a user. */
const PLAN_SURFACES = [
  'src/pages/PricingPage.tsx',
  'src/pages/ProSubscriptionPage.tsx',
  'src/components/SubscriptionPayPalPayment.tsx',
  'src/lib/supportTopics.ts',
  'src/lib/config.ts',
  'src/pages/AboutPage.tsx',
  'src/pages/ServiceDetailPage.tsx',
  'src/pages/HelpCenterPage.tsx',
];

/** A claim the product cannot honour, or that would break merit-based ranking. */
const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  // "unlimited" describing writing. The adjective form is adjacent; the em-dash
  // form ("AI writing (…) — unlimited") reverses the order, so it needs its own
  // pattern. A plain proximity window is wrong both ways: it flags a truthful
  // "AI writing, unlimited AI assistant messages" line and misses the em-dash one.
  { label: 'unlimited AI writing', re: /\bunlimited\s+(?:ai[-\s]?generated\s+|ai\s+)?writing\b/i },
  { label: 'writing declared unlimited', re: /\bwriting\b[^.\n]{0,60}?[—–:-]\s*unlimited\b/i },
  { label: 'priority AI responses', re: /priority\s+ai\s+responses?/i },
  { label: 'priority support', re: /priority\s+(human\s+)?support/i },
  { label: '24/7 priority', re: /24\/7\s*priority/i },
  // The advanced analytics CLAIM is checked against real code below rather than
  // banned outright — but the free dashboard can still never be sold as paid.
  { label: 'free dashboard sold as paid', re: /analytics\s+dashboard[^.\n]{0,40}(premium|pro\b|paid|unlock)/i },
  { label: 'basic/free analytics upsell', re: /(?:basic|free)\s+analytics[^.\n]{0,40}(upgrade|premium|unlock)/i },
  { label: 'AI profile optimization', re: /(ai|profile)\s+optimi[sz]ation/i },
  { label: 'priority matching', re: /priority[-\s]+(ai\s+)?(project\s+|freelancer\s+)?matching/i },
  { label: 'featured profile placement', re: /featured\s+(profile\s+)?placement/i },
  { label: 'high-priority visibility', re: /high[-\s]priority\s+visibility/i },
  // Absolute guarantees. Escrow protects the money, but it never guarantees the
  // outcome: a dispute can refund the client and a client can still reject work.
  { label: '100% secure', re: /100%\s*secure/i },
  { label: 'satisfaction guarantee', re: /satisfaction\s+guarantee/i },
  { label: '100% escrow guarantee', re: /100%\s*escrow/i },
  {
    label: 'absolute escrow/delivery guarantee',
    re: /guarantee[ds]?\s+(secure|payment|deliverables?|collaboration)/i,
  },
  // Naming the company as the guarantor ("the Growlanzo guarantee") promises an
  // outcome, not a mechanism. Escrow holds the money; a dispute can still refund
  // the client. The patterns above missed this because the word sits before an
  // em-dash rather than directly before "secure"/"payment" — found in
  // src/lib/supportTopics.ts, which this guard already scans.
  { label: 'company-level guarantee', re: /\b(?:growlanzo|platform|our)\s+guarantee\b/i },
];

/** Find every forbidden claim in a blob of text (one line at a time). */
function violations(text: string): string[] {
  const hits: string[] = [];
  for (const line of text.split('\n')) {
    for (const { label, re } of FORBIDDEN) {
      if (re.test(line)) hits.push(`${label}: ${line.trim().slice(0, 120)}`);
    }
  }
  return hits;
}

const PRO_DAILY_LIMIT = Number(
  /PRO_DAILY_LIMIT\s*=\s*(\d+)/.exec(read('supabase/functions/ai-writer/index.ts'))?.[1]
);

describe('plan claims are truthful', () => {
  it.each(PLAN_SURFACES)('%s advertises no benefit we cannot deliver', (rel) => {
    expect(violations(read(rel))).toEqual([]);
  });

  it('the advertised writing cap is the cap the edge function actually enforces', () => {
    // The number in the copy must be the number in the code, or the two drift.
    expect(PRO_DAILY_LIMIT).toBe(100);
    for (const rel of [
      'src/pages/ProSubscriptionPage.tsx',
      'src/components/SubscriptionPayPalPayment.tsx',
      'src/pages/PricingPage.tsx',
    ]) {
      expect(read(rel)).toContain(String(PRO_DAILY_LIMIT));
    }
  });

  it('the plain analytics dashboard is still advertised as free for everyone', () => {
    expect(read('src/pages/ProSubscriptionPage.tsx')).toContain('Included — free for everyone');
    expect(read('src/pages/ProSubscriptionPage.tsx')).not.toMatch(
      /analytics\s+dashboard[^.\n]{0,40}(premium|pro\b)/i
    );
  });

  it('every advanced-analytics claim is backed by shipped, gated code', () => {
    // The claim may only exist because the feature does: a Premium-only section
    // fetched by a real service method. If either disappears, the copy becomes
    // the exact false differentiator this guard was written to prevent.
    const service = read('src/lib/analyticsService.ts');
    const page = read('src/pages/dashboard/AnalyticsPage.tsx');
    expect(service).toContain('async getAdvancedAnalytics(');
    expect(service).toContain('export interface AdvancedAnalyticsData');
    expect(page).toContain('isPremiumSubscription(');
    expect(page).toContain('analyticsService.getAdvancedAnalytics(');
    // The advanced query must never run for a non-Premium freelancer.
    expect(page).toMatch(/isPremium\s*\n?\s*\? analyticsService\.getAdvancedAnalytics\(|isPremium\s*\?\s*analyticsService\.getAdvancedAnalytics/);
    // And the simple dashboard must remain reachable without a subscription.
    expect(page).toContain('analyticsService.getFreelancerAnalytics(');
    expect(page).toContain('Advanced analytics is a Premium feature');
  });

  it('the single ₹199 plan unlocks advanced analytics and no costlier tier exists', () => {
    const helpers = read('src/lib/subscriptionHelpers.ts');
    expect(helpers).toContain('export function isPremiumSubscription(');
    // ONE paid plan means Pro and Premium are the same thing: anyone who pays
    // gets advanced analytics, and no code path may gate on a retired tier.
    expect(helpers).toContain('return isProSubscription(subscription);');
    expect(helpers).not.toContain('premium_advanced_monthly');

    const page = read('src/pages/ProSubscriptionPage.tsx');
    expect(page).toContain("const TIER_IDS = ['premium_monthly'] as const;");
    expect(page).not.toContain('₹299');
    expect(page).not.toContain('₹499');

    // The collapsing migration prices the one plan at 199 and retires the 499
    // tier instead of deleting it, so existing subscribers keep a readable row.
    const migration = read('supabase/migrations/20270301000000_single_premium_plan_199.sql');
    expect(migration).toContain('price = 199');
    expect(migration).toContain("WHERE id = 'premium_advanced_monthly'");
  });

  it('the seed-data migration scrubs the DB plan rows and fails closed', () => {
    const migration = read('supabase/migrations/20270119000027_truthful_plan_features.sql');
    // fail-closed: a surviving false / pay-to-win claim must abort the deploy
    expect(migration).toContain('false/pay-to-win plan claims still present');
    // and the same claim classes the UI guard forbids must be scrubbed in data
    for (const token of ['unlimited', 'advanced', 'priority', 'featured', 'verified', '24/7']) {
      expect(migration.toLowerCase()).toContain(token);
    }
    // the live plan must state the real cap
    expect(migration).toContain('100 generations per day');
  });
});

describe('the claim detector itself (negative control)', () => {
  it('flags the real historical claims', () => {
    const historical = [
      'Unlimited AI writing',
      'AI writing (titles, descriptions, cover letters) — unlimited',
      'Priority AI responses',
      'Priority support 24/7',
      'Analytics Dashboard — Premium only',
      'Your analytics dashboard is a Premium unlock',
      'AI profile optimization',
      'Priority AI project matching',
      'Featured profile placement',
      'Pro subscribers receive high-priority visibility',
      'Satisfaction guaranteed',
      '100% Secure',
      '100% Escrow and Deliverable IP Protection Guaranteed.',
      'Escrow protection guarantees secure collaboration',
      'This ensures freelancers are guaranteed payment upon successful completion',
    ];
    for (const claim of historical) {
      expect(violations(claim), `should flag: ${claim}`).not.toEqual([]);
    }
  });

  it('does not flag the truthful replacements', () => {
    const honest = [
      'Unlimited AI assistant messages',
      'AI writing — 100 generations per day',
      'No monthly cap on AI assistant messages',
      'Pro badge on your public profile',
      'Merit-based — same for all',
      'Analytics Dashboard',
      'Included — free for everyone',
      'Advanced analytics — earnings trends and proposal conversion (Premium)',
      'Cancel anytime — no lock-in',
      'Email, support tickets & AI assistant',
      'Escrow Protected',
      'Funds held until you approve',
      'You approve the work before funds release',
      'Escrow-protected payments — IP transfers to the client on final release.',
      'AI Matching',
    ];
    for (const line of honest) {
      expect(violations(line), `should NOT flag: ${line}`).toEqual([]);
    }
  });
});
