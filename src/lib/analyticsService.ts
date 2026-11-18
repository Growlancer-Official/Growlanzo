// Freelancer Analytics Service
// Provides aggregated analytics data for freelancer dashboard
import { supabase, dbFunctions } from './supabase';

export interface AnalyticsData {
  // Earnings
  totalEarnings: number;
  monthlyEarnings: number;
  pendingPayouts: number;
  earningsByMonth: { month: string; amount: number }[];

  // Contracts
  activeContracts: number;
  completedContracts: number;
  totalContracts: number;
  contractSuccessRate: number;

  // Proposals
  totalProposals: number;
  acceptedProposals: number;
  pendingProposals: number;
  proposalConversionRate: number;

  // Profile & Reputation
  profileViews: number;
  profileViewsChange: number;
  averageRating: number;
  totalReviews: number;
  responseRate: number;
  onTimeDelivery: number;
  repeatHireRate: number;

  // Services
  activeServices: number;
  totalServiceViews: number;
  totalServiceOrders: number;

  // Project matches
  newMatches: number;
  totalMatches: number;
}

/**
 * Advanced analytics - Premium tier only (see isPremiumSubscription).
 * Everything here is derived from rows the freelancer already owns, on the
 * same timeframe picker as the simple dashboard, so it refreshes in real time
 * alongside it. Nothing is estimated or fabricated: when a comparison period
 * has no data the delta is reported as null, not as a flattering number.
 */
export interface AdvancedAnalyticsData {
  /** Earnings in the selected period vs the equally long period before it. */
  earningsDeltaPct: number | null;
  earningsPreviousPeriod: number;
  /** Profile views in the period vs the previous period. */
  viewsDeltaPct: number | null;
  views: number;
  viewsPreviousPeriod: number;
  /** Completed-contract value in the period. */
  completedEarnings: number;
  avgContractValue: number;
  /** Proposal funnel for the period. */
  proposalsSent: number;
  proposalsAccepted: number;
  proposalsRejected: number;
  proposalsPending: number;
  avgBidAmount: number;
  acceptedBidValue: number;
  /** Review rating distribution for the period. */
  ratingBreakdown: { five: number; four: number; three: number; low: number };
  /** Top categories by completed contract value, when projects are readable. */
  topCategories: { category: string; contracts: number; earnings: number }[];
}

export const analyticsService = {
  /**
   * Get comprehensive analytics for a freelancer.
   */
  async getFreelancerAnalytics(freelancerId: string, timeframe: '7d' | '30d' | '90d' | '1y' = '30d'): Promise<AnalyticsData> {
    const defaultData: AnalyticsData = {
      totalEarnings: 0,
      monthlyEarnings: 0,
      pendingPayouts: 0,
      earningsByMonth: [],
      activeContracts: 0,
      completedContracts: 0,
      totalContracts: 0,
      contractSuccessRate: 0,
      totalProposals: 0,
      acceptedProposals: 0,
      pendingProposals: 0,
      proposalConversionRate: 0,
      profileViews: 0,
      profileViewsChange: 0,
      averageRating: 0,
      totalReviews: 0,
      responseRate: 0,
      onTimeDelivery: 0,
      repeatHireRate: 0,
      activeServices: 0,
      totalServiceViews: 0,
      totalServiceOrders: 0,
      newMatches: 0,
      totalMatches: 0,
    };

    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Compute date range from timeframe
      const timeframeDays = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : timeframe === '90d' ? 90 : 365;
      const timeframeStart = new Date(now.getTime() - timeframeDays * 24 * 60 * 60 * 1000).toISOString();

      // Run all queries in parallel
      const [
        contractsResult,
        proposalsResult,
        reviewsResult,
        profileResult,
        profileViewsResult,
        profileViewsPrevResult,
        servicesResult,
        matchesResult,
        walletResult,
        transactionsResult,
      ] = await Promise.all([
        // Contracts
        supabase
          .from('contracts')
          .select('id, status, amount')
          .eq('freelancer_id', freelancerId)
          .gte('created_at', timeframeStart),
        // Proposals
        supabase
          .from('proposals')
          .select('id, status')
          .eq('freelancer_id', freelancerId)
          .gte('created_at', timeframeStart),
        // Reviews (using the reviews table)
        supabase
          .from('reviews')
          .select('rating, created_at')
          .eq('reviewee_id', freelancerId)
          .gte('created_at', timeframeStart),
        // Profile
        supabase
          .from('freelancer_profiles')
          .select('response_rate, on_time_delivery_rate, repeat_hire_rate')
          .eq('user_id', freelancerId)
          .maybeSingle(),
        // Profile views live in usage_logs (feature='profile_view') — the
        // freelancer_profiles table has no such column (old code silently
        // returned 0 via a non-existent column). Count rows headlessly.
        supabase
          .from('usage_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', freelancerId)
          .eq('feature', 'profile_view'),
        // Profile views in the equally long PREVIOUS window — this is what
        // makes "vs last period" a real measurement instead of a hardcoded 0.
        supabase
          .from('usage_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', freelancerId)
          .eq('feature', 'profile_view')
          .gte('created_at', new Date(now.getTime() - timeframeDays * 2 * 24 * 60 * 60 * 1000).toISOString())
          .lt('created_at', timeframeStart),
        // Services
        supabase
          .from('services')
          .select('id, status, views, orders')
          .eq('freelancer_id', freelancerId),
        // AI Matches
        supabase
          .from('ai_matches')
          .select('id, match_score')
          .eq('freelancer_id', freelancerId)
          .gte('match_score', 70),
        // Wallet — use RPC for reliability (auto-creates wallet if missing)
        dbFunctions.getWalletBalance(freelancerId),
        // Transactions for monthly earnings
        supabase
          .from('transactions')
          .select('amount, created_at')
          .eq('user_id', freelancerId)
          .eq('type', 'credit')
          .gte('created_at', timeframeStart),
      ]);

      // Process contracts
      const contracts = contractsResult.data || [];
      const activeContracts = contracts.filter((c: any) => c.status === 'active' || c.status === 'pending').length;
      const completedContracts = contracts.filter((c: any) => c.status === 'completed').length;

      // Process proposals
      const proposals = proposalsResult.data || [];
      const acceptedProposals = proposals.filter((p: any) => p.status === 'accepted').length;

      // Process reviews
      const reviews = reviewsResult.data || [];
      const averageRating = reviews.length > 0
        ? reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviews.length
        : 0;

      // Process profile
      const profileData = profileResult.data as any;
      const profileViews = profileViewsResult?.count ?? 0;
      const profileViewsPrevious = profileViewsPrevResult?.count ?? 0;
      // Report a change only when there is a real baseline; a first period
      // shows no trend rather than a fabricated percentage.
      const profileViewsChange =
        profileViewsPrevious > 0
          ? Math.round(((profileViews - profileViewsPrevious) / profileViewsPrevious) * 100)
          : 0;

      // Process services
      const services = servicesResult.data || [];
      const activeServices = services.filter((s: any) => s.status === 'active').length;
      const totalServiceViews = services.reduce((sum: number, s: any) => sum + (s.views || 0), 0);
      const totalServiceOrders = services.reduce((sum: number, s: any) => sum + (s.orders || 0), 0);

      // Process matches
      const newMatches = (matchesResult.data || []).length;

      // Process wallet
      const wallet = walletResult.data as { balance?: number; pending_balance?: number } | null;
      const totalEarnings = wallet?.balance || 0;
      const pendingPayouts = wallet?.pending_balance || 0;

      // Process transactions for monthly earnings
      const txData = transactionsResult.data || [];
      const monthlyEarnings = txData
        .filter((t: any) => t.created_at >= startOfMonth)
        .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

      // Build monthly earnings chart
      const earningsByMonth = buildMonthlyEarnings(txData as Array<{ amount: number; created_at: string }>);

      return {
        ...defaultData,
        totalEarnings,
        monthlyEarnings,
        pendingPayouts,
        earningsByMonth,
        activeContracts,
        completedContracts,
        totalContracts: contracts.length,
        contractSuccessRate: contracts.length > 0
          ? Math.round((completedContracts / contracts.length) * 100) : 0,
        totalProposals: proposals.length,
        acceptedProposals,
        pendingProposals: proposals.filter((p: any) => p.status === 'pending').length,
        proposalConversionRate: proposals.length > 0
          ? Math.round((acceptedProposals / proposals.length) * 100) : 0,
        profileViews,
        profileViewsChange,
        averageRating: Math.round(averageRating * 10) / 10,
        totalReviews: reviews.length,
        responseRate: (profileData?.response_rate as number) || 0,
        onTimeDelivery: (profileData?.on_time_delivery_rate as number) || 0,
        repeatHireRate: (profileData?.repeat_hire_rate as number) || 0,
        activeServices,
        totalServiceViews,
        totalServiceOrders,
        newMatches,
        totalMatches: (matchesResult.data || []).length,
      };
    } catch (error) {
      console.error('Error fetching analytics:', error);
      return defaultData;
    }
  },

  /**
   * Premium-only advanced analytics for the same user + timeframe.
   * Never throws: an unavailable comparison simply reports null deltas.
   */
  async getAdvancedAnalytics(
    freelancerId: string,
    timeframe: '7d' | '30d' | '90d' | '1y' = '30d',
  ): Promise<AdvancedAnalyticsData> {
    const empty: AdvancedAnalyticsData = {
      earningsDeltaPct: null,
      earningsPreviousPeriod: 0,
      viewsDeltaPct: null,
      views: 0,
      viewsPreviousPeriod: 0,
      completedEarnings: 0,
      avgContractValue: 0,
      proposalsSent: 0,
      proposalsAccepted: 0,
      proposalsRejected: 0,
      proposalsPending: 0,
      avgBidAmount: 0,
      acceptedBidValue: 0,
      ratingBreakdown: { five: 0, four: 0, three: 0, low: 0 },
      topCategories: [],
    };

    try {
      const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : timeframe === '90d' ? 90 : 365;
      const ms = days * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const periodStart = new Date(now - ms).toISOString();
      const previousStart = new Date(now - ms * 2).toISOString();

      const [
        contractsNow,
        proposalsNow,
        reviewsNow,
        viewsNow,
        viewsPrev,
        earningsNow,
        earningsPrev,
      ] = await Promise.all([
        supabase
          .from('contracts')
          .select('id, status, amount, created_at, projects(category)')
          .eq('freelancer_id', freelancerId)
          .gte('created_at', periodStart),
        supabase
          .from('proposals')
          .select('id, status, proposed_rate, created_at')
          .eq('freelancer_id', freelancerId)
          .gte('created_at', periodStart),
        supabase
          .from('reviews')
          .select('rating, created_at')
          .eq('reviewee_id', freelancerId)
          .gte('created_at', periodStart),
        supabase
          .from('usage_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', freelancerId)
          .eq('feature', 'profile_view')
          .gte('created_at', periodStart),
        supabase
          .from('usage_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', freelancerId)
          .eq('feature', 'profile_view')
          .gte('created_at', previousStart)
          .lt('created_at', periodStart),
        supabase
          .from('transactions')
          .select('amount, created_at')
          .eq('user_id', freelancerId)
          .eq('type', 'credit')
          .gte('created_at', periodStart),
        supabase
          .from('transactions')
          .select('amount, created_at')
          .eq('user_id', freelancerId)
          .eq('type', 'credit')
          .gte('created_at', previousStart)
          .lt('created_at', periodStart),
      ]);

      const sum = (rows: Array<{ amount?: number | null }> | null) =>
        (rows || []).reduce((total, row) => total + (Number(row.amount) || 0), 0);

      const periodEarnings = sum(earningsNow.data);
      const previousEarnings = sum(earningsPrev.data);
      // A trend is only claimed when there is a real previous period to compare
      // against; a first-time period reports null instead of a fake +100%.
      const earningsDeltaPct =
        previousEarnings > 0
          ? Math.round(((periodEarnings - previousEarnings) / previousEarnings) * 100)
          : null;

      const views = viewsNow.count ?? 0;
      const viewsPreviousPeriod = viewsPrev.count ?? 0;
      const viewsDeltaPct =
        viewsPreviousPeriod > 0
          ? Math.round(((views - viewsPreviousPeriod) / viewsPreviousPeriod) * 100)
          : null;

      const contracts = (contractsNow.data || []) as Array<{
        status: string;
        amount: number;
        projects?: { category: string | null } | { category: string | null }[] | null;
      }>;
      const completed = contracts.filter((c) => c.status === 'completed');
      const completedEarnings = completed.reduce((t, c) => t + (Number(c.amount) || 0), 0);

      const proposals = (proposalsNow.data || []) as Array<{ status: string; proposed_rate: number | null }>;
      const bids = proposals.map((p) => Number(p.proposed_rate) || 0);
      const acceptedBids = proposals
        .filter((p) => p.status === 'accepted')
        .map((p) => Number(p.proposed_rate) || 0);

      const ratings = (reviewsNow.data || []).map((r) => Number(r.rating) || 0);
      const ratingBreakdown = {
        five: ratings.filter((r) => r === 5).length,
        four: ratings.filter((r) => r === 4).length,
        three: ratings.filter((r) => r === 3).length,
        low: ratings.filter((r) => r <= 2).length,
      };

      // Category split - projects are RLS-protected, so a join the freelancer
      // cannot read yields null and is skipped rather than guessed.
      const byCategory = new Map<string, { contracts: number; earnings: number }>();
      for (const contract of completed) {
        const joined = contract.projects;
        const category = Array.isArray(joined) ? joined[0]?.category : joined?.category;
        if (!category) continue;
        const bucket = byCategory.get(category) || { contracts: 0, earnings: 0 };
        bucket.contracts += 1;
        bucket.earnings += Number(contract.amount) || 0;
        byCategory.set(category, bucket);
      }
      const topCategories = [...byCategory.entries()]
        .map(([category, stats]) => ({ category, ...stats }))
        .sort((a, b) => b.earnings - a.earnings)
        .slice(0, 5);

      return {
        earningsDeltaPct,
        earningsPreviousPeriod: Math.round(previousEarnings),
        viewsDeltaPct,
        views,
        viewsPreviousPeriod,
        completedEarnings: Math.round(completedEarnings),
        avgContractValue: completed.length > 0 ? Math.round(completedEarnings / completed.length) : 0,
        proposalsSent: proposals.length,
        proposalsAccepted: proposals.filter((p) => p.status === 'accepted').length,
        proposalsRejected: proposals.filter((p) => p.status === 'rejected').length,
        proposalsPending: proposals.filter((p) => p.status === 'pending').length,
        avgBidAmount: bids.length > 0 ? Math.round(bids.reduce((t, b) => t + b, 0) / bids.length) : 0,
        acceptedBidValue: Math.round(acceptedBids.reduce((t, b) => t + b, 0)),
        ratingBreakdown,
        topCategories,
      };
    } catch (error) {
      console.error('Error fetching advanced analytics:', error);
      return empty;
    }
  },
};


/**
 * Helper to aggregate transactions into monthly buckets.
 */
function buildMonthlyEarnings(transactions: Array<{ amount: number; created_at: string }>): { month: string; amount: number }[] {
  const months: Record<string, number> = {};
  const now = new Date();

  // Initialize last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months[key] = 0;
  }

  // Aggregate
  transactions.forEach((t) => {
    if (!t.created_at) return;
    const d = new Date(t.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (months[key] !== undefined) {
      months[key] += t.amount || 0;
    }
  });

  return Object.entries(months).map(([month, amount]) => ({
    month,
    amount: Math.round(amount * 100) / 100,
  }));
}