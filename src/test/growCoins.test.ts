import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROW_COIN, formatGrowCoins, previewCoinDiscount } from '../lib/growCoins';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const MIGRATION = read('supabase/migrations/20270129000000_grow_coin_referral_rewards.sql');
const RAZORPAY = read('supabase/functions/razorpay/index.ts');
const WEBHOOK = read('supabase/functions/razorpay-webhook/index.ts');
const SERVICE_PAGE = read('src/pages/ServiceDetailPage.tsx');
const REFERRALS_PAGE = read('src/pages/ReferralsPage.tsx');
const CLIENT_REFERRALS_PAGE = read('src/pages/ClientReferralsPage.tsx');
const TERMS_PAGE = read('src/pages/TermsPage.tsx');
const PRIVACY_PAGE = read('src/pages/PrivacyPage.tsx');

describe('Grow Coin formatting', () => {
  it('renders one consistent format with Indian digit grouping', () => {
    expect(formatGrowCoins(240)).toBe('🪙 240 Grow Coins');
    expect(formatGrowCoins(123456)).toBe('🪙 1,23,456 Grow Coins');
    expect(formatGrowCoins(0)).toBe('🪙 0 Grow Coins');
  });

  it('never renders NaN or a fractional coin', () => {
    expect(formatGrowCoins(Number.NaN)).toBe('🪙 0 Grow Coins');
    expect(formatGrowCoins(12.7)).toBe('🪙 12 Grow Coins');
    expect(formatGrowCoins(-50)).toBe('🪙 -50 Grow Coins');
  });

  it('matches the server constants exactly', () => {
    expect(GROW_COIN.valueInr).toBe(1);
    expect(GROW_COIN.referralBonus).toBe(5);
    expect(GROW_COIN.kycBonus).toBe(5);
    expect(GROW_COIN.firstProjectBonus).toBe(0);
    expect(GROW_COIN.minRedemption).toBe(100);
    expect(GROW_COIN.monthlyBonusCap).toBe(0);
  });
});

describe('checkout discount preview', () => {
  it('applies a 1:1 discount above the minimum', () => {
    const result = previewCoinDiscount(250, 500, 5000);
    expect(result).toEqual({ coinsUsed: 250, discountInr: 250, payableInr: 4750 });
  });

  it('caps at the available balance', () => {
    expect(previewCoinDiscount(900, 120, 5000).coinsUsed).toBe(120);
  });

  it('refuses anything below the 100-coin minimum', () => {
    const result = previewCoinDiscount(99, 500, 5000);
    expect(result.coinsUsed).toBe(0);
    expect(result.reason).toMatch(/minimum/i);
    expect(result.payableInr).toBe(5000);
  });

  it('never covers the last rupee (Razorpay needs a payable amount)', () => {
    const result = previewCoinDiscount(5000, 5000, 5000);
    expect(result.coinsUsed).toBe(4999);
    expect(result.payableInr).toBe(1);
  });

  it('offers nothing when the balance is below the minimum', () => {
    const result = previewCoinDiscount(50, 50, 5000);
    expect(result.coinsUsed).toBe(0);
    expect(result.payableInr).toBe(5000);
  });
});

describe('server contract — ledger-only money', () => {
  it('defines the ledger with the seven agreed reasons and no balance column', () => {
    for (const reason of [
      'referral_bonus',
      'kyc_bonus',
      'first_project_bonus',
      'redemption_premium',
      'redemption_project_discount',
      'withdrawal',
      'admin_adjustment',
    ]) {
      expect(MIGRATION).toContain(`'${reason}'`);
    }
    const table = MIGRATION.slice(
      MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS public.grow_coin_ledger'),
      MIGRATION.indexOf('CREATE INDEX IF NOT EXISTS idx_grow_coin_ledger_user_created')
    );
    expect(table).not.toMatch(/\bbalance\b/i);
  });

  it('allows no client write policy on the ledger', () => {
    expect(MIGRATION).toMatch(
      /No INSERT\/UPDATE\/DELETE policies exist on purpose/
    );
    expect(MIGRATION).toMatch(/grow_coin_ledger must have no client write policy/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON TABLE public\.grow_coin_ledger FROM PUBLIC, anon, authenticated/);
  });

  it('pays only after real engagement, with a 20/month cap', () => {
    expect(MIGRATION).toMatch(/v_bonus constant integer := 10/);
    expect(MIGRATION).toMatch(/v_cap constant integer := 20/);
    expect(MIGRATION).toMatch(/c\.status = 'completed'/);
    expect(MIGRATION).toMatch(/iv\.status = 'verified'/);
    expect(MIGRATION).toMatch(/bonus_claimed/);
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('keeps the award RPC server-only and the leaderboard public', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.award_referral_bonus_if_eligible\(uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_grow_coin_leaderboard\(integer\) TO anon, authenticated, service_role/
    );
    expect(MIGRATION).toMatch(/display_name text/);
    expect(MIGRATION).not.toMatch(/RETURNS TABLE \([^)]*email/);
  });

  it('carries fail-closed assertions for the guards it claims', () => {
    expect(MIGRATION).toMatch(/grow coin migration failed its own assertions/);
    expect(MIGRATION).toMatch(/award_referral_bonus_if_eligible is client-callable/);
    expect(MIGRATION).toMatch(/redeem_reserved_grow_coins is client-callable/);
    expect(MIGRATION).toMatch(/trg_grow_coin_award_on_contract_complete/);
    expect(MIGRATION).toMatch(/trg_grow_coin_award_on_kyc_verified/);
  });
});

describe('milestone bonuses — KYC 10, first project 20', () => {
  it('awards KYC coins only for real-provider verdicts, server-only, once per user', () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.award_kyc_bonus_if_eligible\(p_user_id uuid\)/);
    expect(MIGRATION).toMatch(/v_bonus constant integer := 10/);
    // Dev-mode/sandbox verdicts verify instantly — they must never pay coins.
    expect(MIGRATION).toMatch(
      /iv\.verification_provider, 'manual'\) NOT IN \('dev_mode', 'dev-sandbox'\)/
    );
    // Idempotency: partial unique index + ON CONFLICT DO NOTHING.
    expect(MIGRATION).toMatch(/uq_grow_coin_kyc_bonus_per_user/);
    expect(MIGRATION).toMatch(/uq_grow_coin_first_project_per_user/);
    // Never client-callable.
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.award_kyc_bonus_if_eligible\(uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.award_first_project_bonus_if_eligible\(uuid\) FROM PUBLIC, anon, authenticated/
    );
    // The deploy refuses to apply if any of these guards go missing. The two
    // milestone RPCs are asserted through a FOREACH over their names, so the
    // failure message is built at runtime — assert the loop and its message.
    expect(MIGRATION).toMatch(
      /FOREACH v_def IN ARRAY ARRAY\['award_kyc_bonus_if_eligible', 'award_first_project_bonus_if_eligible'\]/
    );
    expect(MIGRATION).toMatch(/v_def \|\| ' is client-callable'/);
    expect(MIGRATION).toMatch(/KYC bonus does not exclude dev-mode\/sandbox verdicts/);
    expect(MIGRATION).toMatch(/referral eligibility does not exclude dev-mode\/sandbox verdicts/);
    expect(MIGRATION).toMatch(/milestone bonus idempotency indexes are missing/);
  });

  it('pays the first-project bonus to BOTH sides of a completed contract', () => {
    expect(MIGRATION).toMatch(/v_bonus constant integer := 20/);
    // The trigger hands the award the client as well as the freelancer.
    expect(MIGRATION).toMatch(/v_second_user_id := NEW\.client_id/);
    expect(MIGRATION).toMatch(/award_first_project_bonus_if_eligible\(v_second_user_id\)/);
    // Eligibility covers either role on a completed contract.
    expect(MIGRATION).toMatch(/c\.freelancer_id = p_user_id OR c\.client_id = p_user_id/);
  });

  it('also excludes dev-mode verdicts from REFERRAL eligibility (farming fix)', () => {
    // The referral award used to accept any verified row — in development mode
    // every throwaway account verifies instantly and farms the monthly cap.
    expect(MIGRATION).toMatch(/referral eligibility does not exclude dev-mode\/sandbox verdicts/);
  });

  it('announces the milestone rules on both referral surfaces', () => {
    expect(REFERRALS_PAGE).toMatch(/5 Grow Coins to you and 5 to them/si);
    expect(REFERRALS_PAGE).toMatch(/5 coins to them and 5 coins to you/si);
    expect(REFERRALS_PAGE).not.toMatch(/20 coins/);
    expect(CLIENT_REFERRALS_PAGE).toMatch(/when a client you referred passes identity verification/i);
    expect(CLIENT_REFERRALS_PAGE).toMatch(/5 coins to them and 5 coins to you/si);
    expect(CLIENT_REFERRALS_PAGE).not.toMatch(/20 coins/);
  });
});

describe('legal pages — coin terms, legal identity, no invented claims', () => {
  it('Terms carries the Grow Coins rules the programme needs', () => {
    expect(TERMS_PAGE).toMatch(/14\. Grow Coins Programme/);
    expect(TERMS_PAGE).toMatch(/1 Grow Coin = ₹1/);
    expect(TERMS_PAGE).toMatch(/No cash value except redemption/);
    expect(TERMS_PAGE).toMatch(/No expiry/);
    expect(TERMS_PAGE).toMatch(/clawback|removed, and an admin adjustment/i);
    expect(TERMS_PAGE).toMatch(/tax.*recipient's responsibility|tax.*recipient responsibility/i);
    expect(TERMS_PAGE).toMatch(/Public leaderboard/);
    expect(TERMS_PAGE).toMatch(/No ranking influence/);
  });

  it('Terms and Privacy name a real operator and grievance contact', () => {
    for (const page of [TERMS_PAGE, PRIVACY_PAGE]) {
      expect(page).toMatch(/Muhammad \(Founder/);
      // The public grievance/DPO contact is the monitored support inbox, never the
      // private owner Gmail (which is the internal admin-alert recipient only).
      expect(page).toMatch(/mailto:support@growlanzo\.com/);
      expect(page).not.toMatch(/mailto:growlanzo\.own@gmail\.com/);
    }
    // The jurisdiction is stated, not left as "the Platform's incorporation".
    expect(TERMS_PAGE).toMatch(/laws of India/);
    expect(TERMS_PAGE).not.toMatch(/jurisdiction of the Platform's incorporation/);
  });

  it('Privacy discloses the public leaderboard and names the DPO', () => {
    expect(PRIVACY_PAGE).toMatch(/Grow Coins Leaderboard/);
    expect(PRIVACY_PAGE).toMatch(/display name and avatar only/);
    expect(PRIVACY_PAGE).toMatch(/Data Protection Officer \(DPO\):/);
  });
});

describe('payment integration — coin count only, debit on capture', () => {
  it('create_order reads a coin COUNT and recomputes the discount server-side', () => {
    expect(RAZORPAY).toContain("coins_to_use");
    expect(RAZORPAY).toContain("rpc('get_grow_coin_balance'");
    expect(RAZORPAY).toContain("rpc('reserve_grow_coins_for_order'");
    expect(RAZORPAY).toMatch(/growCoinDiscount = growCoinsUsed/);
    // A forged metadata.grow_coins_used must be stripped before persisting.
    expect(RAZORPAY).toContain('delete clientMetadata.grow_coins_used');
    // A client-supplied discount must never exist as an input at all.
    expect(RAZORPAY).not.toMatch(/data\.discount/);
    expect(RAZORPAY).toMatch(/const validAmount = Math\.round\(\(serverAmount - growCoinDiscount\)/);
  });

  it('verify and webhook both redeem the hold, idempotently', () => {
    expect(RAZORPAY).toContain("rpc('redeem_reserved_grow_coins'");
    expect(WEBHOOK).toContain("rpc('redeem_reserved_grow_coins'");
    expect(WEBHOOK).toMatch(/redeemOrderGrowCoins\(supabaseAdmin, dbOrder\)/);
    expect(MIGRATION).toMatch(/IF v_res\.status = 'redeemed'/);
  });

  it('checkout sends only coins_to_use, never a discount amount', () => {
    expect(SERVICE_PAGE).toContain('coins_to_use');
    expect(SERVICE_PAGE).not.toMatch(/discount_inr:\s*coinPreview/);
    expect(SERVICE_PAGE).toContain('previewCoinDiscount');
  });
});

describe('honest referral copy', () => {
  it('states the real trigger and never promises a signup bonus', () => {
    expect(REFERRALS_PAGE).toMatch(/every project your referred user completes/i);
    expect(REFERRALS_PAGE).toMatch(/never at signup/i);
    expect(REFERRALS_PAGE).not.toMatch(/Referral counts after their first proposal/i);
  });

  it('shows the leaderboard without leaking private fields', () => {
    expect(REFERRALS_PAGE).toContain('leader.refs');
    expect(REFERRALS_PAGE).not.toContain('leader.email');
  });
});


describe('referral pays BOTH sides, in real time', () => {
  const BOTH = read('supabase/migrations/20270207000000_referee_referral_bonus.sql');

  it('adds a dedicated referee reason and widens the ledger CHECK by exactly one value', () => {
    expect(BOTH).toContain("'referee_referral_bonus'");
    // Every original reason must survive the widening — a historical row can
    // never be left violating the constraint.
    for (const reason of [
      'referral_bonus',
      'kyc_bonus',
      'first_project_bonus',
      'redemption_premium',
      'redemption_project_discount',
      'withdrawal',
      'admin_adjustment',
    ]) {
      expect(BOTH).toContain(`'${reason}'`);
    }
  });

  it('keeps the retired referee reason valid when the 5+5 economy rebuilds the CHECK', () => {
    // 20270303 retires the 10+10 shape, but 20270302 rebuilds the ledger reason
    // constraint. ALTER TABLE ADD CONSTRAINT validates existing rows, so a row
    // written under 20270207 whose reason no longer appears here would make
    // `db push` fail on a real database. Historical reasons must survive.
    const LIFETIME = read('supabase/migrations/20270302000000_referral_lifetime_project_rewards.sql');
    expect(LIFETIME).toContain("'referee_referral_bonus'");
    expect(LIFETIME).toMatch(/referee_referral_bonus[\s\S]{0,400}\]::text\[\]/);
  });

  it('pays the referee in the same transaction, idempotently', () => {
    // The referee's ledger row is written inside the award function itself.
    expect(BOTH).toMatch(/INSERT INTO public\.grow_coin_ledger/);
    expect(BOTH).toMatch(/v_referee_bonus/);
    expect(BOTH).toMatch(/ON CONFLICT DO NOTHING/);
    // One referee payout per referral row, enforced by the database.
    expect(BOTH).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_grow_coin_referee_bonus_per_referral');
    expect(BOTH).toMatch(/WHERE reason = 'referee_referral_bonus' AND reference_id IS NOT NULL/);
  });

  it('keeps every earlier guard: role gate, real-provider gate, server-only', () => {
    expect(BOTH).toMatch(/'reason', 'role_mismatch'/);
    expect(BOTH).toMatch(/NOT IN \('dev_mode', 'dev-sandbox'\)/);
    expect(BOTH).toMatch(/v_cap constant integer := 20/);
    expect(BOTH).toMatch(/bonus_claimed/);
    expect(BOTH).toMatch(
      /REVOKE ALL ON FUNCTION public\.award_referral_bonus_if_eligible\(uuid\) FROM PUBLIC, anon, authenticated/
    );
    // The referee's award is independent of the referrer's monthly cap.
    expect(BOTH).toMatch(/referee_coins/);
  });

  it('notifies the referee on their own side of the marketplace', () => {
    expect(BOTH).toContain("CASE WHEN v_referred_role = 'client' THEN '/client/referrals' ELSE '/referrals' END");
  });

  it('carries fail-closed assertions, including the referee award itself', () => {
    expect(BOTH).toMatch(/referee referral migration failed its own assertions/);
    expect(BOTH).toMatch(/the referee is no longer paid/);
  });
});
