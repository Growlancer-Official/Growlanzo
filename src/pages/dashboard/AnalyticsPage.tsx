import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowDown, ArrowUp, BarChart3, Briefcase, CheckCircle, Clock, Crown, Eye, FileText, Gem, RefreshCw, ShoppingBag, Star, TrendingUp, Users, Wallet } from 'lucide-react';
import { InfoTip } from '../../components/InfoTip';
import { useToast } from '../../components/Toast';
import { PageSkeleton } from '../../components/PageSkeleton';
import { EarningsChart } from '../../components/EarningsChart';
import { useAuth } from '../../context/AuthContext';
import { useCurrency } from '../../context/CurrencyContext';
import { analyticsService, type AnalyticsData, type AdvancedAnalyticsData } from '../../lib/analyticsService';
import { useProStatus } from '../../hooks/useProStatus';
import { isPremiumSubscription } from '../../lib/subscriptionHelpers';
import { supabase } from '../../lib/supabase';

export function AnalyticsPage() {
  const { user } = useAuth();
  const { format, currency, source: currencySource } = useCurrency();
  // Real-time tier: upgrading to Premium flips this instantly (the hook
  // subscribes to subscription changes), so the advanced section appears
  // without a reload and disappears again the moment a subscription ends.
  const { subscription } = useProStatus();
  const isPremium = isPremiumSubscription(subscription);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<'7d' | '30d' | '90d' | '1y'>('30d');
  const toast = useToast();

  const fetchAnalytics = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    try {
      const [result, advancedResult] = await Promise.all([
        analyticsService.getFreelancerAnalytics(user.id, timeframe),
        // Simple analytics for everyone; the advanced query only runs for the
        // Premium tier so free freelancers never pay for data they cannot see.
        isPremium
          ? analyticsService.getAdvancedAnalytics(user.id, timeframe)
          : Promise.resolve(null),
      ]);
      setData(result);
      setAdvanced(advancedResult);
    } catch (err) {
      console.error('Failed to load analytics:', err);
      toast.error('Error', 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [user, timeframe, toast, isPremium]);

  useEffect(() => {
    fetchAnalytics();

    if (!user) return;
    // Real-time: refresh analytics when any relevant table changes for this user
    const channel = supabase
      .channel(`analytics-realtime:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts', filter: `freelancer_id=eq.${user.id}` }, () => void fetchAnalytics())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proposals', filter: `freelancer_id=eq.${user.id}` }, () => void fetchAnalytics())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, () => void fetchAnalytics())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `reviewee_id=eq.${user.id}` }, () => void fetchAnalytics())
      .subscribe();

    return () => { void channel.unsubscribe(); };
  }, [fetchAnalytics, user]);

  if (loading && !data) {
    return <PageSkeleton />;
  }

  const formatPercent = (value: number) => `${Math.round(value * 10) / 10}%`;

  const MetricCard = ({
    icon: Icon,
    label,
    value,
    sublabel,
    trend,
    trendLabel,
    color,
  }: {
    icon: React.ElementType;
    label: string;
    value: string;
    sublabel?: string;
    trend?: 'up' | 'down' | 'neutral';
    trendLabel?: string;
    color: string;
  }) => (
    <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          {sublabel && <p className="text-xs text-slate-400 mt-1">{sublabel}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color.replace('text-', 'bg-').replace('-600', '-50').replace('-500', '-50').replace('-700', '-100')}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
      {trend && trendLabel && (
        <div className="flex items-center gap-1 mt-3 text-xs">
          {trend === 'up' ? (
            <ArrowUp className="w-3.5 h-3.5 text-emerald-500" />
          ) : trend === 'down' ? (
            <ArrowDown className="w-3.5 h-3.5 text-red-500" />
          ) : null}
          <span className={trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-500' : 'text-slate-400'}>
            {trendLabel}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
              Analytics
              <InfoTip
                title="About these numbers"
                text="All metrics update in real time as contracts, proposals, reviews and payments happen. Success Rate = completed contracts ÷ total contracts. Proposal conversion = accepted proposals ÷ proposals sent. Use the 7d/30d/90d/1y buttons to change the view. Amounts are shown in your country's currency. Every freelancer gets this dashboard free; Premium adds the advanced trend, funnel and category breakdown below it."
              />
            </h1>
            <p className="text-slate-500 mt-1">Track your performance and growth</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchAnalytics}
            className="p-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl transition-colors"
            aria-label="Refresh analytics"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="flex bg-slate-100 rounded-xl p-1 flex-shrink-0">
            {(['7d', '30d', '90d', '1y'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                className={`px-3 py-2 text-xs font-medium rounded-lg transition-all min-h-[36px] ${
                  timeframe === t
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data && (
        <>
          {/* Earnings & Contracts Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              icon={Wallet}
              label="Wallet balance"
              value={format(data.totalEarnings)}
              sublabel={`${format(data.monthlyEarnings)} credited this period`}
              color="text-emerald-600"
            />
            <MetricCard
              icon={TrendingUp}
              label="Pending Payouts"
              value={format(data.pendingPayouts)}
              color="text-amber-600"
            />
            <MetricCard
              icon={Briefcase}
              label="Active Contracts"
              value={String(data.activeContracts)}
              sublabel={`${data.completedContracts} completed`}
              color="text-blue-600"
            />
            <MetricCard
              icon={CheckCircle}
              label="Success Rate"
              value={formatPercent(data.contractSuccessRate)}
              sublabel={`${data.totalContracts} total contracts`}
              color="text-violet-600"
            />
          </div>

          {/* Earnings Chart */}
          <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-1.5">
                  Earnings Overview
                  <InfoTip text="Revenue trend and the monthly breakdown for the last 6 months. Every figure follows your country's currency." />
                </h2>
                <p className="text-sm text-slate-500">Monthly earnings for the past 6 months</p>
              </div>
              <span
                className="inline-flex items-center gap-1.5 self-start rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                title={
                  currencySource === 'profile'
                    ? 'Set from the country on your profile'
                    : currencySource === 'detected'
                      ? 'Detected from your browser region — set your country in onboarding to change it'
                      : 'Default platform currency'
                }
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                {currency}
              </span>
            </div>

            <EarningsChart data={data.earningsByMonth ?? []} />
          </div>

          {/* Proposals & Reviews Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MetricCard
              icon={FileText}
              label="Proposals"
              value={String(data.totalProposals)}
              sublabel={`${formatPercent(data.proposalConversionRate)} conversion rate`}
              trend={data.proposalConversionRate >= 30 ? 'up' : data.proposalConversionRate > 0 ? 'down' : undefined}
              trendLabel={data.proposalConversionRate >= 30 ? 'Above average' : data.proposalConversionRate > 0 ? 'Needs improvement' : undefined}
              color="text-indigo-600"
            />
            <MetricCard
              icon={Star}
              label="Average Rating"
              value={data.averageRating > 0 ? data.averageRating.toFixed(1) : '—'}
              sublabel={`${data.totalReviews} reviews`}
              color="text-amber-500"
            />
            <MetricCard
              icon={Eye}
              label="Profile Views"
              value={String(data.profileViews)}
              trend={data.profileViewsChange > 0 ? 'up' : data.profileViewsChange < 0 ? 'down' : undefined}
              trendLabel={
                data.profileViewsChange > 0
                  ? `+${data.profileViewsChange}% vs last month`
                  : data.profileViewsChange < 0
                    ? `${data.profileViewsChange}% vs last month`
                    : undefined
              }
              color="text-cyan-600"
            />
          </div>

          {/* Performance Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              icon={Clock}
              label="On-Time Delivery"
              value={formatPercent(data.onTimeDelivery)}
              color="text-green-600"
            />
            <MetricCard
              icon={Users}
              label="Repeat Hire Rate"
              value={formatPercent(data.repeatHireRate)}
              color="text-pink-600"
            />
            <MetricCard
              icon={Activity}
              label="Response Rate"
              value={formatPercent(data.responseRate)}
              color="text-teal-600"
            />
            <MetricCard
              icon={ShoppingBag}
              label="Services"
              value={`${data.activeServices} active`}
              sublabel={`${data.totalServiceOrders} orders, ${data.totalServiceViews} views`}
              color="text-orange-600"
            />
          </div>

          {/* Project Matches */}
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-1.5">
                  AI Project Matches
                  <InfoTip text="How well your profile matches available projects." />
                </h2>
                <p className="text-sm text-slate-500">Projects matched to your skills</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4">
                <p className="text-xl font-bold text-violet-600">{data.newMatches}</p>
                <p className="text-sm text-violet-600/70">New Matches</p>
              </div>
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-4">
                <p className="text-xl font-bold text-blue-600">{data.totalMatches}</p>
                <p className="text-sm text-blue-600/70">Total Matches</p>
              </div>
              <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl p-4">
                <p className="text-xl font-bold text-emerald-600">
                  {data.totalProposals > 0 ? Math.round((data.acceptedProposals / data.totalProposals) * 100) : 0}%
                </p>
                <p className="text-sm text-emerald-600/70">Proposal Acceptance</p>
              </div>
            </div>
          </div>
        </>
      )}

      {data && !isPremium && (
        /* Honest upgrade card: Premium really does unlock the section below,
           so this is an offer, not a fake locked panel over data they own. */
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <Gem className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                Advanced analytics is a Premium feature
                <Crown className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
              </h2>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Earnings and views trends, the full proposal funnel, your rating breakdown and your top
                paying categories — all real-time, all included with Premium. Everything above stays free
                for every freelancer.
              </p>
            </div>
          </div>
          <Link
            to="/dashboard/pro"
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors sm:ml-auto"
          >
            See Premium plans <ArrowUp className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      )}

      {data && isPremium && advanced && (
        <section className="rounded-xl border border-emerald-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 flex flex-wrap items-center gap-2">
            <Gem className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-900">Advanced analytics</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <Crown className="w-3 h-3" aria-hidden="true" /> Premium
            </span>
            <span className="text-xs text-slate-500">Compared with the previous {timeframe} — updates live</span>
          </div>

          <div className="p-5 space-y-5">
            {/* Trends */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                icon={TrendingUp}
                label="Earnings vs previous period"
                value={advanced.earningsDeltaPct === null ? 'No baseline' : `${advanced.earningsDeltaPct > 0 ? '+' : ''}${advanced.earningsDeltaPct}%`}
                sublabel={`Previous ${timeframe}: ${format(advanced.earningsPreviousPeriod)}`}
                trend={advanced.earningsDeltaPct === null ? undefined : advanced.earningsDeltaPct > 0 ? 'up' : advanced.earningsDeltaPct < 0 ? 'down' : 'neutral'}
                trendLabel={
                  advanced.earningsDeltaPct === null
                    ? undefined
                    : advanced.earningsDeltaPct > 0
                      ? 'Growing'
                      : advanced.earningsDeltaPct < 0
                        ? 'Slower than last period'
                        : 'Flat'
                }
                color="text-emerald-600"
              />
              <MetricCard
                icon={Eye}
                label="Profile views vs previous"
                value={advanced.viewsDeltaPct === null ? 'No baseline' : `${advanced.viewsDeltaPct > 0 ? '+' : ''}${advanced.viewsDeltaPct}%`}
                sublabel={`${advanced.views} this period · ${advanced.viewsPreviousPeriod} before`}
                trend={advanced.viewsDeltaPct === null ? undefined : advanced.viewsDeltaPct > 0 ? 'up' : advanced.viewsDeltaPct < 0 ? 'down' : 'neutral'}
                color="text-cyan-600"
              />
              <MetricCard
                icon={Briefcase}
                label="Average contract value"
                value={format(advanced.avgContractValue)}
                sublabel={`${format(advanced.completedEarnings)} from completed work`}
                color="text-violet-600"
              />
              <MetricCard
                icon={Star}
                label="Rating split"
                value={`${advanced.ratingBreakdown.five}★ ${advanced.ratingBreakdown.four}★ ${advanced.ratingBreakdown.three}★`}
                sublabel={`${advanced.ratingBreakdown.low} low ratings in period`}
                color="text-amber-500"
              />
            </div>

            {/* Proposal funnel */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Proposal funnel</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Sent', value: advanced.proposalsSent },
                  { label: 'Accepted', value: advanced.proposalsAccepted },
                  { label: 'Pending', value: advanced.proposalsPending },
                  { label: 'Rejected', value: advanced.proposalsRejected },
                  { label: 'Avg bid', value: format(advanced.avgBidAmount) },
                  { label: 'Accepted value', value: format(advanced.acceptedBidValue) },
                ].map((cell) => (
                  <div key={cell.label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-lg font-bold text-slate-900 tabular-nums">{cell.value}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{cell.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Top categories */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Top categories by completed value</h3>
              {advanced.topCategories.length === 0 ? (
                <p className="text-xs text-slate-500 rounded-xl border border-dashed border-slate-200 p-4">
                  No completed contracts with a readable category in this period yet — this fills in as
                  contracts complete.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {advanced.topCategories.map((cat) => (
                    <li key={cat.category} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="text-sm font-medium text-slate-700 truncate">{cat.category}</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                        {format(cat.earnings)}
                        <span className="ml-2 text-xs font-medium text-slate-400">{cat.contracts} contract{cat.contracts === 1 ? '' : 's'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
