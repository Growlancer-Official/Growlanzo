import { supabase } from './supabase';

// ────────────────────────────────────────────────────────────────────────────
// GROW COIN — frontend model for the referral-reward currency
//
// Mirrors the server contract in
// supabase/migrations/20270129000000_grow_coin_referral_rewards.sql:
//   • 1 Grow Coin = ₹1, whole coins only.
//   • Approved KYC pays 5 coins to the referrer AND 5 to the referred user —
//     once per referral relationship, never on signup.
//   • EVERY successful project completed by the referred user pays 5 + 5,
//     repeating for life with no cap (20270302000000).
//   • No registration reward, personal KYC milestone, first-project bonus or
//     monthly cap (20270303000000).
//   • Minimum redemption is 100 coins.
//   • The balance is derived from the ledger server-side; this file never
//     "computes" a stored balance.
// ────────────────────────────────────────────────────────────────────────────

export const GROW_COIN = {
  /** ₹ value of one coin. Used for display only; the server owns the math. */
  valueInr: 1,
  /** KYC referral reward: 5 coins to each side, once per referral relationship. */
  referralBonus: 5,
  /** Same 5-coin KYC reward, named for the KYC surface. */
  kycBonus: 5,
  /** Retired: the one-shot 20-coin first-project bonus no longer exists. */
  firstProjectBonus: 0,
  minRedemption: 100,
  /** Retired: the programme has no monthly cap. */
  monthlyBonusCap: 0,
  /** Premium (₹199/month) is priced in coins 1:1. Display fallback only. */
  premiumCost: 199,
} as const;

export type GrowCoinState = {
  balance: number;
  reserved: number;
  available: number;
  lifetimeEarned: number;
  redeemed: number;
  withdrawn: number;
  earnedThisMonth: number;
  monthlyCap: number;
};

export type GrowCoinLeader = {
  rank: number;
  name: string;
  avatar: string | null;
  referrals: number;
  isYou: boolean;
};

const EMPTY_STATE: GrowCoinState = {
  balance: 0,
  reserved: 0,
  available: 0,
  lifetimeEarned: 0,
  redeemed: 0,
  withdrawn: 0,
  earnedThisMonth: 0,
  monthlyCap: GROW_COIN.monthlyBonusCap,
};

/**
 * Format coins consistently everywhere: "🪙 240 Grow Coins".
 * Negative amounts are rendered with a leading minus and never as a balance.
 */
export function formatGrowCoins(amount: number, opts: { withLabel?: boolean; compact?: boolean } = {}): string {
  const { withLabel = true, compact = false } = opts;
  const safe = Number.isFinite(Number(amount)) ? Math.trunc(Number(amount)) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const digits = compact && abs >= 1000
    ? new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(abs)
    : new Intl.NumberFormat('en-IN').format(abs);
  return withLabel ? `🪙 ${sign}${digits} Grow Coins` : `🪙 ${sign}${digits}`;
}

/** Number-only helper for places that already render their own coin icon. */
export function formatCoinAmount(amount: number): string {
  const safe = Number.isFinite(Number(amount)) ? Math.trunc(Number(amount)) : 0;
  return new Intl.NumberFormat('en-IN').format(safe);
}

/**
 * Client-side preview of the server discount rule.
 *
 * The server recomputes this from the authoritative balance — this function
 * exists so the checkout can show an honest number, and is asserted against
 * the same rules in src/test/growCoins.test.ts. It never sends a discount.
 */
export function previewCoinDiscount(
  coinsRequested: number,
  availableCoins: number,
  orderTotalInr: number
): { coinsUsed: number; discountInr: number; payableInr: number; reason?: string } {
  const total = Math.max(Number(orderTotalInr) || 0, 0);
  const requested = Math.trunc(Number(coinsRequested) || 0);
  const available = Math.max(Math.trunc(Number(availableCoins) || 0), 0);

  if (requested <= 0) {
    return { coinsUsed: 0, discountInr: 0, payableInr: total };
  }
  if (requested < GROW_COIN.minRedemption) {
    return { coinsUsed: 0, discountInr: 0, payableInr: total, reason: `Minimum ${GROW_COIN.minRedemption} coins` };
  }
  if (available < GROW_COIN.minRedemption) {
    return { coinsUsed: 0, discountInr: 0, payableInr: total, reason: `You need at least ${GROW_COIN.minRedemption} coins` };
  }

  // Razorpay requires a payable amount: coins never cover the last ₹1.
  const maxDiscount = Math.floor(total) - 1;
  if (maxDiscount < GROW_COIN.minRedemption) {
    return { coinsUsed: 0, discountInr: 0, payableInr: total, reason: 'This order is too small to use coins' };
  }

  const coinsUsed = Math.min(requested, available, maxDiscount);
  const discountInr = coinsUsed * GROW_COIN.valueInr;
  return { coinsUsed, discountInr, payableInr: total - discountInr };
}

/**
 * Returns the referral bonus description for the given role.
 * Freelancer referrals pay when their referral completes a contract as freelancer.
 * Client referrals pay when their referral passes KYC verification.
 * Admin sees the default freelancer description.
 * Both pay only after real engagement, never on signup. BOTH SIDES are paid
 * at that moment: the referee earns their own 10 coins in the same
 * transaction (reason 'referee_referral_bonus').
 */
export function getReferralBonusDescription(role: 'freelancer' | 'client' | 'admin'): string {
  const sameSide = role === 'client'
    ? 'Codes are same-side: you can only refer other clients.'
    : 'Codes are same-side: you can only refer other freelancers.';
  return 'Approved identity verification pays 5 Grow Coins to you and 5 to your referral — once per referral, never at signup. Then every project your referred user completes keeps paying 5 coins to them and 5 coins to you, with no lifetime cap. ' + sameSide;
}

/**
 * Returns the first-project bonus description for the given role.
 * Retired: there is no one-shot 20-coin bonus. Every completed project now pays
 * the referral pair 5 + 5, so this helper describes the current rule.
 */
export function getFirstProjectBonusDescription(role: 'freelancer' | 'client' | 'admin'): string {
  return role === 'client'
    ? 'Every project you complete as a client pays 5 Grow Coins to you and 5 to whoever referred you — no lifetime cap.'
    : 'Every project you complete as a freelancer pays 5 Grow Coins to you and 5 to whoever referred you — no lifetime cap.';
}

/**
 * Returns the KYC bonus description. The amount is identical for every role;
 * only the wording changes for a client, whose verification is business KYC.
 */
export function getKycBonusDescription(role: 'freelancer' | 'client' | 'admin'): string {
  return role === 'client'
    ? 'Approved business identity verification pays 5 Grow Coins to you and 5 to your referral — once per referral.'
    : 'Approved identity verification pays 5 Grow Coins to you and 5 to your referral — once per referral.';
}

/** Stable per-action key so a double click cannot debit twice. */
export function newCoinRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts: still unique enough for idempotency.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

type BalanceResponse = {
  success?: boolean;
  error?: string;
  balance?: number;
  reserved?: number;
  available?: number;
  lifetime_earned?: number;
  redeemed?: number;
  withdrawn?: number;
  earned_this_month?: number;
  monthly_cap?: number;
};

export async function fetchGrowCoinState(userId: string): Promise<GrowCoinState> {
  const { data, error } = await (supabase.rpc as any)('get_grow_coin_balance', { p_user_id: userId });
  if (error) throw new Error(error.message);
  const row = (data || {}) as BalanceResponse;
  if (row.success === false) {
    throw new Error(row.error || 'Could not load Grow Coins');
  }
  return {
    balance: Number(row.balance) || 0,
    reserved: Number(row.reserved) || 0,
    available: Number(row.available) || 0,
    lifetimeEarned: Number(row.lifetime_earned) || 0,
    redeemed: Number(row.redeemed) || 0,
    withdrawn: Number(row.withdrawn) || 0,
    earnedThisMonth: Number(row.earned_this_month) || 0,
    monthlyCap: Number(row.monthly_cap) || GROW_COIN.monthlyBonusCap,
  };
}

export async function fetchGrowCoinLeaderboard(limit = 10): Promise<GrowCoinLeader[]> {
  const { data, error } = await (supabase.rpc as any)('get_grow_coin_leaderboard', { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data || []) as any[]).map((row) => ({
    rank: Number(row.rank) || 0,
    name: String(row.display_name || 'Growlanzo member'),
    avatar: (row.avatar as string | null) ?? null,
    referrals: Number(row.referrals) || 0,
    isYou: row.is_self === true,
  }));
}

export async function redeemGrowCoinsForCash(coins: number, requestKey: string) {
  const { data, error } = await (supabase.rpc as any)('redeem_grow_coins_for_cash', {
    p_amount_coins: coins,
    p_idempotency_key: requestKey,
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Redemption failed');
  return data;
}

export async function redeemGrowCoinsForPremium(requestKey: string) {
  const { data, error } = await (supabase.rpc as any)('redeem_grow_coins_for_premium', {
    p_idempotency_key: requestKey,
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Redemption failed');
  return data;
}

export const GROW_COIN_EMPTY_STATE = EMPTY_STATE;
