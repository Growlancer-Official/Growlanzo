import { PageSkeleton } from '../components/PageSkeleton';
import { Link } from 'react-router-dom';
import { Award, Bell, CheckCircle2, ClipboardCheck, MailCheck, ShieldCheck, Sparkles, Trophy, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useReferralsData } from '../hooks/useReferralsData';
import { useGrowCoinBalance } from '../hooks/useGrowCoinBalance';
import { GrowCoinIcon } from '../components/GrowCoinIcon';
import { ReferralInviteCard } from '../components/ReferralInviteCard';
import { GROW_COIN, formatCoinAmount, getReferralBonusDescription } from '../lib/growCoins';

/**
 * Same four tiers as the freelancer dashboard (Starter → Growth → Pro → Elite at
 * 0/3/10/25 referrals). Both roles earn under one programme, so both pages must
 * read the same ladder.
 */
function tierFromCount(count: number) {
  if (count >= 25) {
    return { label: 'Elite', next: null, progress: 100, remaining: 0, band: ['Pro (10-24)', 'Elite (25+)'] };
  }
  if (count >= 10) {
    return {
      label: 'Pro',
      next: 'Elite',
      progress: Math.round(((count - 10) / 15) * 100),
      remaining: 25 - count,
      band: ['Pro (10-24)', 'Elite (25+)'],
    };
  }
  if (count >= 3) {
    return {
      label: 'Growth',
      next: 'Pro',
      progress: Math.round(((count - 3) / 7) * 100),
      remaining: 10 - count,
      band: ['Growth (3-9)', 'Pro (10)'],
    };
  }
  return {
    label: 'Starter',
    next: 'Growth',
    progress: Math.round((count / 3) * 100),
    remaining: 3 - count,
    band: ['Starter (0-2)', 'Growth (3)'],
  };
}

export function ClientReferralsPage() {
  const { user } = useAuth();
  // Live for clients too: the code and counters stream from the same hook the
  // freelancer page uses, so neither role ever needs a refresh to see changes.
  const { referralStats, referrals, leaders, loading, referralCode, referralLink, live } = useReferralsData(
    user?.id,
    user?.referralCode,
    user?.role
  );
  const { state: coins, loading: coinsLoading, error: coinsError } = useGrowCoinBalance(user?.id);

  const totalReferrals = referralStats?.total_referrals ?? referrals.length;
  const tier = tierFromCount(totalReferrals);
  const myRank = leaders.find((l) => l.isYou)?.rank;

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      {/* Grow Coins for clients: earned the same way as freelancers, spent as a
          discount at checkout. Golden surface so it is instantly recognisable. */}
      <section className="relative overflow-hidden rounded-[2rem] border border-amber-200/70 bg-gradient-to-br from-amber-50 via-[#FFFBF0] to-white p-5 shadow-[0_18px_50px_-24px_rgba(180,130,20,0.4)]">
        <div className="absolute -right-14 -top-14 h-44 w-44 rounded-full bg-amber-300/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <GrowCoinIcon size={56} title="Grow Coin" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700/80">Your Grow Coins</p>
              <p className="font-display text-3xl font-bold leading-tight text-amber-950 tabular-nums">
                {coinsLoading ? '—' : formatCoinAmount(coins.balance)}
                <span className="ml-2 align-middle text-xs font-semibold text-amber-800/60">1 coin = ₹1</span>
              </p>
              <p className="mt-1 text-xs text-amber-900/70">
                {coinsError
                  ? 'Could not load your coin balance — refresh to retry.'
                  : `Min ${GROW_COIN.minRedemption} coins to use at checkout · ${formatCoinAmount(coins.available)} available`}
              </p>
            </div>
          </div>
          <Link
            to="/services"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-bold text-amber-50 transition-colors hover:bg-amber-950"
          >
            Use coins at checkout
          </Link>
        </div>
        <div className="relative mt-3 border-t border-amber-200/70 pt-3 text-xs leading-relaxed text-amber-900/70">You earn <span className="font-bold">5 Grow Coins</span> when a client you referred passes identity verification — never at signup — and your referral earns <span className="font-bold">5 Grow Coins</span> at that same moment, on both screens. Referral codes are same-side: clients refer clients, freelancers refer freelancers. Every project your referred client completes keeps paying <span className="font-bold">5 coins to them and 5 coins to you</span>, with no lifetime cap. At checkout you can apply coins as a ₹1-per-coin discount on a contract or package payment, from {GROW_COIN.minRedemption} coins upward.
          <p className="mt-1 text-xs text-amber-900/70">{getReferralBonusDescription(user?.role ?? 'freelancer')}</p>
        </div>
      </section>

      {loading && (
        <div className="flex justify-center py-4">
          <PageSkeleton showStats={false} cards={false} />
        </div>
      )}


      {/* Hero: Referral Link & Tier */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-1.5">
        <div className="lg:col-span-2 bg-white p-8 rounded-[2rem] border border-slate-100 shadow-[0_10px_40px_-10px_rgba(36,186,53,0.12)] relative overflow-hidden">
          <div className="relative z-10">
            <ReferralInviteCard
              code={referralCode}
              link={referralLink}
              name={user?.name}
              role={user?.role}
              live={live}
            />
          </div>
          <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl"></div>
        </div>

        {/* Level Progress */}
        <div className="bg-slate-900 rounded-[2rem] p-8 text-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-xl font-bold">Your Tier Status</h3>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30 uppercase">{tier.label} Level</span>
            </div>
            <p className="text-xs text-slate-400">
              You've referred <span className="text-white font-bold">{totalReferrals} {totalReferrals === 1 ? 'person' : 'people'}</span> so far.
            </p>
          </div>

          <div className="my-8">
            <div className="flex justify-between text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">
              <span>{tier.band[0]}</span>
              <span className="text-emerald-400">{tier.band[1]}</span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden relative">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${tier.progress}%` }} />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <Award className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xs text-slate-300">
              {tier.next ? (
                <>Get <span className="font-bold text-white">{tier.remaining} more</span> to unlock {tier.next} tier perks.</>
              ) : (
                <>You've reached the Elite referrer tier.</>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Benefits: Hiring Experience Rewards */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-xl font-bold">Referral Benefits</h3>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Referral Engine</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
          <div className="bg-white p-6 rounded-xl border border-slate-100 hover:border-emerald-100 transition-all group">
            <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 mb-2.5 group-hover:scale-110 transition-transform">
              <Zap className="w-4 h-4" />
            </div>
            <h4 className="font-bold mb-2">Referral Points &amp; Tiers</h4>
            <p className="text-sm text-slate-500 leading-relaxed">
              Every completed referral adds points and moves you through the{' '}
              <span className="font-bold text-emerald-600">Starter → Growth → Pro → Elite</span> tiers shown on this page.
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-100 hover:border-emerald-100 transition-all group">
            <div className="h-12 w-12 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 mb-2.5 group-hover:scale-110 transition-transform">
              <Sparkles className="w-4 h-4" />
            </div>
            <h4 className="font-bold mb-2">Merit-Based Matching</h4>
            <p className="text-sm text-slate-500 leading-relaxed">
              AI matching is identical for every client — freelancers are ranked purely on{' '}
              <span className="font-bold text-orange-600">skills, ratings and fit</span>. Referrals never change who you see.
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-100 hover:border-emerald-100 transition-all group">
            <div className="h-12 w-12 rounded-xl bg-slate-900 flex items-center justify-center text-white mb-2.5 group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h4 className="font-bold mb-2">Referral Leaderboard</h4>
            <p className="text-sm text-slate-500 leading-relaxed">
              Active referrers appear on the referrals leaderboard, recognised for{' '}
              <span className="font-bold text-slate-900">helping the community grow</span>.
            </p>
          </div>
        </div>
      </section>

      {/* Middle Row: Validation & Active Stats */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-[2rem] p-8 border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl font-bold">Referral Validation Rules</h3>
            <div className="flex items-center gap-1.5 py-1 px-3 bg-slate-50 rounded-lg">
              <Bell className="text-orange-500 text-sm w-4 h-4" />
              <span className="text-xs font-bold text-slate-400 uppercase">Anti-Spam active</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ul className="space-y-1.5">
              <li className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <MailCheck className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-bold">Email Verification</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    The referred business account must be fully verified via corporate email.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-bold">Post First Project</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Referral only counts once the new client posts a valid project with defined budget. For clients, referral rewards apply when the referred client passes KYC verification. Codes are same-side — a client code can only refer other clients.
                  </p>
                </div>
              </li>
            </ul>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">Why no cash?</p>
              <p className="text-xs text-slate-600 leading-relaxed mb-2">
                We believe high-quality ecosystems are built on shared trust. Instead of cash, we provide the
                infrastructure for you to hire faster and better than your competition.
              </p>
              <div className="flex items-center gap-3 text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-bold">Quality over Quantity</span>
              </div>
            </div>
          </div>
        </div>

        {/* Top Referrers Leaderboard */}
        <aside className="bg-white rounded-[2rem] p-8 border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl font-bold">Top Clients</h3>
            <Trophy className="w-4 h-4 text-orange-500" />
          </div>

          <div className="space-y-1">
            {leaders.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">No leaderboard data yet — be the first to refer clients.</p>
            ) : (
              leaders.map((leader) => (
              <div
                key={leader.name}
                className={`flex items-center justify-between p-3 rounded-xl ${
                  leader.rank === 1
                    ? 'bg-emerald-50 border border-emerald-100'
                    : leader.isYou
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-50/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-6 w-6 rounded-full text-xs font-bold flex items-center justify-center ${
                      leader.rank === 1
                        ? 'bg-emerald-600 text-white'
                        : leader.isYou
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {leader.rank}
                  </span>
                  <div className="h-8 w-8 rounded-lg bg-white overflow-hidden p-1 border border-slate-200">
                    <img
                      src={`https://api.dicebear.com/7.x/initials/svg?seed=${leader.name}`}
                      alt={leader.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className={`text-sm font-bold ${leader.isYou ? 'text-white' : leader.rank === 1 ? 'text-slate-900' : 'text-slate-600'}`}>
                    {leader.name}{leader.isYou ? ' (You)' : ''}
                  </span>
                </div>
                <span
                  className={`text-xs font-bold ${
                    leader.isYou ? 'text-emerald-400' : leader.rank === 1 ? 'text-emerald-600' : 'text-slate-500'
                  }`}
                >
                  {leader.refs} Ref
                </span>
              </div>
            ))
            )}

            {myRank && !leaders.some((l) => l.isYou) && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 text-white mt-4">
                <div className="flex items-center gap-1.5">
                  <span className="h-6 w-6 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center">
                    {myRank}
                  </span>
                  <span className="text-sm font-bold">{user?.name || 'You'} (You)</span>
                </div>
                <span className="text-xs font-bold text-emerald-400">{totalReferrals} Ref</span>
              </div>
            )}
          </div>

          <Link
            to="/client/referrals"
            className="block w-full mt-8 py-3 bg-slate-50 rounded-xl text-center text-xs font-bold uppercase tracking-widest text-slate-400 hover:bg-slate-100 transition-all"
          >
            Live Rankings
          </Link>
        </aside>
      </section>
    </div>
  );
}
