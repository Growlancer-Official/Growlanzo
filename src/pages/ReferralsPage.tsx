import { useState } from 'react';
import {
  Award,
  CheckCircle,
  Copy,
  Crown,
  Flame,
  Leaf,
  ShieldAlert,
  Sparkles,
  Sprout,
  Trophy,
  UserX,
  Wallet,
} from 'lucide-react';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { ReferralInviteCard } from '../components/ReferralInviteCard';
import { Pagination } from '../components/Pagination';
import { GrowCoinIcon } from '../components/GrowCoinIcon';
import { ConfirmModal } from '../components/ConfirmModal';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { useGrowCoinBalance } from '../hooks/useGrowCoinBalance';
import { useReferralsData } from '../hooks/useReferralsData';
import {
  GROW_COIN,
  formatCoinAmount,
  getReferralBonusDescription,
  getKycBonusDescription,
  newCoinRequestKey,
  redeemGrowCoinsForPremium,
} from '../lib/growCoins';

// Coin cash-out is intentionally not wired to the UI yet: the founder is
// keeping withdrawal "coming soon" for BOTH roles until payouts are live. The
// server RPC stays in place so enabling it later is a one-line change, and no
// visitor is ever shown a button that cannot pay out.

export function ReferralsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [redeemTarget, setRedeemTarget] = useState<'premium' | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const pageSize = 5;
  // The code and stats come from the live hook for BOTH roles, so a code issued
  // or regenerated after load lands without a refresh.
  const { referralStats, referrals, leaders, loading, referralCode, referralLink, live } = useReferralsData(
    user?.id,
    user?.referralCode,
    user?.role
  );
  const { state: coins, loading: coinsLoading, error: coinsError, refresh: refreshCoins } = useGrowCoinBalance(user?.id);

  const canRedeemPremium = coins.available >= GROW_COIN.premiumCost;
  const progressToPremium = Math.min(
    Math.round((coins.available / GROW_COIN.premiumCost) * 100),
    100
  );

  const confirmRedemption = async () => {
    if (!redeemTarget) return;
    setRedeeming(true);
    try {
      const result = await redeemGrowCoinsForPremium(newCoinRequestKey());
      toast.success(
        'Premium unlocked',
        `${result?.coins ?? GROW_COIN.premiumCost} Grow Coins paid for one month of Premium.`
      );
      await refreshCoins();
      setRedeemTarget(null);
    } catch (err) {
      console.error('[ReferralsPage] coin redemption failed:', err);
      toast.error('Redemption failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setRedeeming(false);
    }
  };

  const validRefs = referralStats?.valid_referrals || 0;
  
  let currentLevel: 'Starter' | 'Growth' | 'Pro' | 'Elite' = 'Starter';
  if (validRefs >= 25) {
    currentLevel = 'Elite';
  } else if (validRefs >= 10) {
    currentLevel = 'Pro';
  } else if (validRefs >= 3) {
    currentLevel = 'Growth';
  }

  // Calculate percentage and positioning
  let progressPercent = 0;
  if (validRefs < 3) {
    progressPercent = (validRefs / 3) * 25;
  } else if (validRefs < 10) {
    progressPercent = 25 + ((validRefs - 3) / 7) * 25;
  } else if (validRefs < 25) {
    progressPercent = 50 + ((validRefs - 10) / 15) * 50;
  } else {
    progressPercent = 100;
  }

  let levelRangeLeft = 'PRO (10-24)';
  let levelRangeRight = 'ELITE (25+)';
  let levelLeftColor = 'text-slate-500';
  let levelRightColor = 'text-slate-500';

  if (validRefs < 3) {
    levelRangeLeft = 'STARTER (0-2)';
    levelRangeRight = 'GROWTH (3-9)';
    levelLeftColor = 'text-emerald-400';
  } else if (validRefs < 10) {
    levelRangeLeft = 'GROWTH (3-9)';
    levelRangeRight = 'PRO (10-24)';
    levelLeftColor = 'text-emerald-400';
  } else if (validRefs < 25) {
    levelRangeLeft = 'PRO (10-24)';
    levelRangeRight = 'ELITE (25+)';
    levelLeftColor = 'text-emerald-400';
  } else {
    levelRangeLeft = 'PRO (10-24)';
    levelRangeRight = 'ELITE (25+)';
    levelRightColor = 'text-emerald-400';
  }

  const getTierStyle = (tier: 'Starter' | 'Growth' | 'Pro' | 'Elite') => {
    const isActive = currentLevel === tier;
    const tiers = ['Starter', 'Growth', 'Pro', 'Elite'];
    const currentIdx = tiers.indexOf(currentLevel);
    const tierIdx = tiers.indexOf(tier);
    const isCompleted = tierIdx < currentIdx;

    if (isActive) {
      return {
        container: 'text-center',
        iconContainer: 'h-8 w-8 mx-auto rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-1 ring-1 ring-emerald-500/50',
        text: 'text-[10px] font-bold text-emerald-400',
      };
    } else if (isCompleted) {
      return {
        container: 'text-center opacity-80',
        iconContainer: 'h-8 w-8 mx-auto rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center mb-1',
        text: 'text-[10px] font-bold text-slate-300',
      };
    } else {
      return {
        container: `text-center ${tier === 'Elite' ? 'opacity-20' : 'opacity-40'}`,
        iconContainer: 'h-8 w-8 mx-auto rounded-lg bg-slate-800 text-slate-500 flex items-center justify-center mb-1',
        text: 'text-[10px] font-bold text-slate-500',
      };
    }
  };

  if (loading) {
    return <LoadingSkeleton variant="full-page" />;
  }

  return (
    <div className="space-y-4 pb-20 lg:pb-0">

      {/* Honest expectation setting — the #1 source of referral support tickets
          is "where are my coins?". Say the trigger plainly, before the code. */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3">
        <GrowCoinIcon size={22} className="mt-0.5 shrink-0" />
        <p className="text-xs sm:text-sm leading-relaxed text-amber-950/85">
          <span className="font-bold">When do you get paid?</span> Approved identity verification pays{' '}
          <span className="font-bold">5 Grow Coins to you and 5 to them</span> — once per referral, never at signup.
          Then every project your referred user completes keeps paying{' '}
          <span className="font-bold">5 coins to them and 5 coins to you</span>, for as long as the referral
          relationship exists — no lifetime cap. Nothing is paid for empty, fake, cancelled or unpaid work, which is
          what keeps the programme honest.
        </p>
      </div>

      {/* Hero: Referral Stats & Code */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 bg-white p-4 rounded-[2.5rem] border border-slate-100 shadow-[0_10px_40px_-10px_rgba(36,186,53,0.15)] relative overflow-hidden">
          <div className="relative z-10">
            <ReferralInviteCard
              code={referralCode}
              link={referralLink}
              name={user?.name}
              role={user?.role}
              live={live}
              className="mb-4"
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase">Total Referrals</p>
                <p className="text-3xl font-bold mt-1">{referralStats?.total_referrals || 0}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase">Valid Referrals</p>
                <p className="text-3xl font-bold mt-1 text-emerald-600">{referralStats?.valid_referrals || 0}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase">Points</p>
                <p className="text-3xl font-bold mt-1">{referralStats?.points || 0}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase">Level</p>
                <p className="text-3xl font-bold mt-1 text-orange-500">{referralStats?.level || 1}</p>
              </div>
            </div>
          </div>
          <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl"></div>
        </div>

        {/* Level System */}
        <div className="bg-slate-900 rounded-[2.5rem] p-4 text-white flex flex-col justify-between">
          <div>
            <h3 className="font-display text-xl font-bold mb-1">Level Up</h3>
            <p className="text-xs text-slate-400">Reach 25 referrals to become an Elite Referrer.</p>
          </div>

          <div className="space-y-3 my-8">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className={levelLeftColor}>{levelRangeLeft}</span>
              <span className={levelRightColor}>{levelRangeRight}</span>
            </div>
            <div className="relative">
              <div className="h-2 bg-slate-800 rounded-full w-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
              </div>
              <div 
                className="absolute -top-1 h-4 w-4 bg-emerald-500 rounded-full ring-4 ring-slate-900 transition-all duration-500" 
                style={{ left: `${progressPercent}%`, transform: 'translateX(-50%)' }}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {/* Starter Tier */}
            {(() => {
              const style = getTierStyle('Starter');
              return (
                <div className={style.container}>
                  <div className={style.iconContainer}>
                    <Sprout className="w-5 h-5" />
                  </div>
                  <span className={style.text}>Starter</span>
                </div>
              );
            })()}

            {/* Growth Tier */}
            {(() => {
              const style = getTierStyle('Growth');
              return (
                <div className={style.container}>
                  <div className={style.iconContainer}>
                    <Leaf className="w-4 h-4" />
                  </div>
                  <span className={style.text}>Growth</span>
                </div>
              );
            })()}

            {/* Pro Tier */}
            {(() => {
              const style = getTierStyle('Pro');
              return (
                <div className={style.container}>
                  <div className={style.iconContainer}>
                    <Flame className="w-4 h-4" />
                  </div>
                  <span className={style.text}>Pro</span>
                </div>
              );
            })()}

            {/* Elite Tier */}
            {(() => {
              const style = getTierStyle('Elite');
              return (
                <div className={style.container}>
                  <div className={style.iconContainer}>
                    <Crown className="w-4 h-4" />
                  </div>
                  <span className={style.text}>Elite</span>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Grow Coins — the actual reward currency. Golden surface, deliberately
          different from the emerald referral chrome so it reads as "money". */}
      <section className="relative overflow-hidden rounded-[2.5rem] border border-amber-200/70 bg-gradient-to-br from-amber-50 via-[#FFFBF0] to-white p-5 sm:p-7 shadow-[0_18px_50px_-24px_rgba(180,130,20,0.45)]">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex items-start gap-4 sm:gap-5">
            <div className="shrink-0 rounded-2xl bg-white/70 p-2 ring-1 ring-amber-200/80 shadow-inner">
              <GrowCoinIcon size={76} title="Grow Coin" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700/80">Your Grow Coins</p>
              <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                <p className="font-display text-4xl sm:text-5xl font-bold text-amber-950 tabular-nums leading-none">
                  {coinsLoading ? '—' : formatCoinAmount(coins.balance)}
                </p>
                <p className="text-sm font-semibold text-amber-800/70">1 coin = ₹1</p>
              </div>
              <p className="mt-2 text-sm text-amber-900/80">
                {coinsError
                  ? 'We could not load your coin balance right now. Refresh the page to try again.'
                  : coins.reserved > 0
                    ? `${formatCoinAmount(coins.available)} available · ${formatCoinAmount(coins.reserved)} held for an unpaid order`
                    : `${formatCoinAmount(coins.available)} available`}
              </p>

              {!coinsLoading && !coinsError && (
                <div className="mt-3 max-w-sm">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-amber-800/70">
                    <span>{canRedeemPremium ? 'Premium unlocked' : `Premium at ${GROW_COIN.premiumCost} coins`}</span>
                    <span>{Math.min(coins.available, GROW_COIN.premiumCost)}/{GROW_COIN.premiumCost}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-amber-900/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#D4AF37] to-[#F4E285] transition-all duration-500" style={{ width: `${progressToPremium}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            {/* Cash-out stays visibly "coming soon" for both roles — a
                disabled control that explains itself beats a button that
                credits a wallet nobody can withdraw from yet. */}
            <button
              type="button"
              disabled
              title="Coin withdrawals are coming soon — your coins stay safe in your account and can already pay for Premium."
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-900/70 px-5 py-3 text-sm font-bold text-amber-50 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Wallet className="h-4 w-4" />
              Withdraw to bank
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                Coming soon
              </span>
            </button>
            <button
              type="button"
              onClick={() => setRedeemTarget('premium')}
              disabled={!canRedeemPremium || redeeming}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white/80 px-5 py-3 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              Premium ({GROW_COIN.premiumCost} coins)
              </button>
          </div>
        </div>

        <p className="relative mt-4 border-t border-amber-200/70 pt-3 text-xs leading-relaxed text-amber-900/70">Coins are worth ₹1 each. Right now they can pay for one month of Premium ({GROW_COIN.premiumCost} coins), and cash withdrawal is coming soon for freelancers and clients alike — nothing expires, so your balance keeps growing until it opens. Redeeming coins for Premium needs {GROW_COIN.premiumCost} coins.
        {getReferralBonusDescription(user?.role ?? 'freelancer')}
        </p>
      </section>

      {/* Rewards & Validation */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-2 space-y-4">
          {/* Rewards Grid */}
          <section className="bg-white rounded-[2.5rem] p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-xl font-bold">Opportunity Rewards</h3>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Coin Rewards</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                <div className="h-10 w-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center mb-2">
                  <Award className="w-5 h-5" />
                </div>
                <h4 className="font-bold mb-2">Points &amp; Levels</h4>
                <p className="text-xs text-slate-500 leading-relaxed">Every completed referral adds 10 points and moves you up the Starter → Growth → Pro → Elite tiers.</p>
              </div>
              <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-100">
                <div className="h-10 w-10 rounded-xl bg-amber-600 text-white flex items-center justify-center mb-2">
                  <GrowCoinIcon size={22} />
                </div>
                <h4 className="font-bold mb-2">Grow Coins (₹ value)</h4>
                <p className="text-xs text-slate-500 leading-relaxed">Every approved referral pays 5 Grow Coins to you and 5 Grow Coins to your referral at the same instant, and every project that referral completes pays 5 + 5 again — no lifetime cap. Premium is live today; cash withdrawal is coming soon for both roles.</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center mb-2">
                  <Trophy className="w-5 h-5" />
                </div>
                <h4 className="font-bold mb-2">Leaderboard (no ranking boost)</h4>
                <p className="text-xs text-slate-500 leading-relaxed">Top referrers appear on this page's leaderboard. Coins never influence search, matching or visibility — those stay 100% merit-based.</p>
              </div>
            </div>
          </section>

          {/* Validation & Anti-Spam */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-[2.5rem] border border-slate-100">
              <h3 className="font-display text-lg font-bold mb-3">Validation Rules</h3>
              <ul className="space-y-4">
                <li className="flex items-start gap-3 text-sm">
                  <CheckCircle className="text-emerald-500 mt-0.5 w-5 h-5" />
                  <div>
                    <p className="font-bold">Same Side Only</p>
                    <p className="text-xs text-slate-400">Your code is for other freelancers — a client account using it won't count.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <CheckCircle className="text-emerald-500 mt-0.5 w-5 h-5" />
                  <div>
                    <p className="font-bold">Email Verified</p>
                    <p className="text-xs text-slate-400">The referred user must confirm their email and finish onboarding.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <CheckCircle className="text-emerald-500 mt-0.5 w-5 h-5" />
                  <div>
                    <p className="font-bold">First Project Completed</p>
                    <p className="text-xs text-slate-400">Their first contract must be completed as a freelancer — a signup alone pays nothing.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 text-sm">
                  <CheckCircle className="text-emerald-500 mt-0.5 w-5 h-5" />
                  <div>
                    <p className="font-bold">Or Identity Verified</p>
                    <p className="text-xs text-slate-400">{getKycBonusDescription(user?.role ?? 'freelancer')}</p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="bg-red-50 p-4 rounded-[2.5rem] border border-red-100">
              <h3 className="font-display text-lg font-bold text-red-900 mb-3">Anti-Spam Policy</h3>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <ShieldAlert className="text-red-600 w-6 h-6 shrink-0" />
                  <p className="text-xs text-red-800 leading-relaxed">Self-referrals or creating multiple accounts to farm referrals will result in permanent suspension of the primary account.</p>
                </div>
                <div className="flex gap-3">
                  <UserX className="text-red-600 w-6 h-6 shrink-0" />
                  <p className="text-xs text-red-800 leading-relaxed">Duplicate emails or bot-like registration patterns are automatically flagged by our AI security engine.</p>
                </div>
                <div className="bg-red-600 text-white p-4 rounded-xl text-xs font-bold uppercase tracking-widest text-center">
                  Zero Tolerance Policy
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Leaderboard */}
        <aside className="bg-white rounded-[2.5rem] p-4 border border-slate-100 h-fit">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-xl font-bold">Top Referrers</h3>
            <div className="h-8 w-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
              <Trophy className="w-5 h-5" />
            </div>
          </div>

          <div className="space-y-1">
            {leaders.map((leader) => (
              <div
                key={leader.rank}
                className={`flex items-center justify-between p-3 rounded-xl ${
                  leader.rank === 1
                    ? 'bg-emerald-50 ring-1 ring-emerald-100'
                    : leader.rank % 2 === 0
                      ? 'bg-slate-50/50'
                      : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-6 w-6 rounded-full text-xs font-bold flex items-center justify-center ${
                      leader.rank === 1
                        ? 'bg-emerald-600 text-white'
                        : leader.rank <= 3
                          ? 'bg-slate-200 text-slate-500'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {leader.rank}
                  </span>
                  {leader.avatar ? (
                    <div className="h-8 w-8 rounded-lg overflow-hidden bg-slate-100">
                      <img
                        src={/^https?:\/\//.test(leader.avatar) ? leader.avatar : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(leader.avatar)}`}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : null}
                  <span className={`text-sm ${leader.rank <= 3 ? 'font-bold' : 'font-medium text-slate-600'}`}>
                    {leader.name}
                  </span>
                </div>
                <span
                  className={`text-xs font-bold ${
                    leader.rank === 1 ? 'text-emerald-600' : leader.rank <= 3 ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  {leader.refs} {leader.refs === 1 ? 'referral' : 'referrals'}
                </span>
              </div>
            ))}

            {/* The user's own row is already part of `leaders` (shown with their
                real name + isYou highlight) — no duplicate "You" card. */}
          </div>

          <button className="w-full mt-8 py-3 bg-slate-50 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-all">
            Full Leaderboard
          </button>
        </aside>
      </div>

      {/* Your Referrals — always visible */}
      <section className="bg-white rounded-[2.5rem] p-4 border border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-xl font-bold">Your Referrals</h3>
          <span className="text-sm text-slate-500">{referrals.length} total</span>
        </div>

        {referrals.length > 0 ? (
          <>
            <div className="space-y-3">
              {referrals
                .slice((page - 1) * pageSize, page * pageSize)
                .map((referral) => (
                <div
                  key={referral.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3.5 h-3.5 rounded-full ${
                      referral.status === 'completed' ? 'bg-emerald-500' : referral.status === 'expired' ? 'bg-slate-300' : 'bg-orange-400'
                    }`} />
                    <div>
                      <p className="font-medium text-slate-900">{referral.referred_email}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(referral.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                      referral.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700'
                        : referral.status === 'expired'
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-orange-100 text-orange-700'
                    }`}>
                      {referral.status}
                    </span>
                    {referral.bonus_claimed && (
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Pagination
              currentPage={page}
              totalItems={referrals.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        ) : (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-2">
              <Copy className="w-8 h-8 text-slate-300" />
            </div>
            <h4 className="text-lg font-semibold text-slate-900 mb-2">No referrals yet</h4>
            <p className="text-slate-500 max-w-md mx-auto text-sm">
              Share your unique referral link with other freelancers. When they join and complete their first project, they'll be listed here and you'll earn rewards.
            </p>
          </div>
        )}
      </section>

      <ConfirmModal
        isOpen={redeemTarget !== null}
        onClose={() => (redeeming ? undefined : setRedeemTarget(null))}
        onConfirm={confirmRedemption}
        loading={redeeming}
        variant="warning"
        title="Use coins for Premium?"
        message={`${coins.available} coins available. One month of Premium costs ${GROW_COIN.premiumCost} coins and is applied immediately — the same Premium a card payment would unlock.`}
        confirmLabel="Unlock Premium"
        cancelLabel="Not now"
      />
    </div>
  );
}
