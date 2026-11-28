import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Briefcase, Check, CreditCard, FileText, Handshake, Headphones, LayoutDashboard, MessageSquare, Plus, Sparkles, Trophy, Users, Wallet, Zap,  } from 'lucide-react';
import { PageSkeleton } from '../../components/PageSkeleton';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatBudgetRange, safeFormatDate, safeNumber } from '../../utils/date';
import { formatCurrency } from '../../lib/currency';
import { CacheManager } from '../../lib/services/cacheManager';
import {
  projectsService,
  proposalsService,
  contractsService,
  invitesService,
  transactionsService,
} from '../../lib/dataService';
import { notificationService } from '../../lib/notifications';
import { ProBadge } from '../../components/ProBadge';
import { InfoTip } from '../../components/InfoTip';
import { useProStatus } from '../../hooks/useProStatus';
import { ACTIVE_STATUSES, PENDING_STATUSES } from '../../lib/contractStatuses';
import { getSellerLevelInfo, getSellerLevelProgress, type SellerLevel } from '../../lib/sellerLevels';
import { isFeatureEnabled } from '../../lib/featureFlags';

interface DashboardStats {
  activeContracts: number;
  pendingProposals: number;
  newMatches: number;
  pendingInvites: number;
  totalEarnings: number;
  monthlyEarnings: number;
  profileViews: number;
  unreadNotifications: number;
}

interface QuickStat {
  label: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  /** Short plain-language explanation shown as a hover tooltip next to the label. */
  hint?: string;
}

/**
 * Resolve a project title from a row that embeds `projects`/`project`
 * (PostgREST may embed a to-one FK as an object OR an array depending on
 * relationship detection). Falls back gracefully instead of showing 'Unknown'.
 */
function resolveProjectTitle(row: any): string {
  const embedded = row?.projects ?? row?.project;
  const target = Array.isArray(embedded) ? embedded[0] : embedded;
  const title = target?.title;
  return title && String(title).trim() ? String(title) : 'Untitled project';
}

/**
 * Resolve a party (client/freelancer) name from an embedded profile key.
 */
function resolvePartyName(row: any, key: string, fallback: string): string {
  const embedded = row?.[key];
  const target = Array.isArray(embedded) ? embedded[0] : embedded;
  const name = target?.name;
  return name && String(name).trim() ? String(name) : fallback;
}

export function OverviewPage() {
  const { user, role } = useAuth();
  const { isPro } = useProStatus();
  const [stats, setStats] = useState<DashboardStats>({
    activeContracts: 0,
    pendingProposals: 0,
    newMatches: 0,
    pendingInvites: 0,
    totalEarnings: 0,
    monthlyEarnings: 0,
    profileViews: 0,
    unreadNotifications: 0,
  });
  const [recentProjects, setRecentProjects] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Seller position (level) — recomputed server-side when contracts complete
  const [sellerInfo, setSellerInfo] = useState<{
    level: SellerLevel;
    rating: number;
    completionRate: number;
    completedProjects: number;
  }>({ level: 'new', rating: 0, completionRate: 100, completedProjects: 0 });

  /**
   * Live AI recommendations (freelancer): the real ai_matches rows the feed
   * shows — embedded project + client, score >= 40, newest best first. Called
   * on mount and on every ai_matches INSERT/UPDATE/DELETE so the card and the
   * "AI Matches" counter update instantly without a full-page reload.
   */
  const refreshAiRecommendations = useCallback(async () => {
    if (!user || role !== 'freelancer') return;
    try {
      const [rowsResult, countResult] = await Promise.all([
        supabase
          .from('ai_matches')
          .select(`
            *,
            project:projects(
              *,
              client:profiles!projects_client_id_fkey(id, name, avatar, deleted_at)
            )
          `)
          .eq('freelancer_id', user.id)
          .gte('match_score', 40)
          .order('match_score', { ascending: false })
          .limit(5),
        supabase
          .from('ai_matches')
          .select('id', { count: 'exact', head: true })
          .eq('freelancer_id', user.id)
          .gte('match_score', 40),
      ]);

      const rows = (rowsResult.data || []) as any[];
      // Mirror the feed guard: hide rows whose project/client is gone.
      const visible = rows.filter(
        (m) =>
          (m.match_score ?? 0) >= 40 &&
          !!m.project &&
          !(
            m.project.client &&
            (m.project.client.deleted_at || !m.project.client.name)
          )
      );
      setRecentProjects(visible.map((m) => m.project));
      setStats((s) => ({ ...s, newMatches: countResult?.count ?? visible.length }));
    } catch (err) {
      console.error('Error refreshing AI recommendations:', err);
    }
  }, [user, role]);

  /** Fetch all dashboard data with forceRefetch=true to bypass cache */
  const fetchDashboardData = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    try {
      setLoading(true);
      setError(null);

      if (role === 'freelancer') {
        // ---------- FREELANCER DASHBOARD ----------
        // Clear only stale (expired) entries — keeps fresh data in cache for instant load
        CacheManager.prune();

        // ⚡ Performance: a small profile query + a tiny usage_logs count for
        // profile views. Previously this called
        // analyticsService.getFreelancerAnalytics() — 8 parallel heavy queries
        // (contracts, proposals, reviews, services, ai_matches, wallet RPC,
        // transactions) — just to display a single profile-views number.
        // AI recommendations load separately via refreshAiRecommendations().
        const [
          contractsData,
          proposalsData,
          invitesData,
          notificationResult,
          earningsData,
          profileResult,
          profileViewsResult,
        ] = await Promise.all([
          contractsService.getByUser(user.id, 'freelancer', true),
          proposalsService.getByFreelancer(user.id, true),
          invitesService.getFreelancerInvites(user.id, true),
          notificationService.getByUser(user.id),
          transactionsService.getEarningsSummary(user.id),
          supabase
            .from('freelancer_profiles')
            .select('seller_level, rating, completion_rate')
            .eq('user_id', user.id)
            .maybeSingle(),
          // Profile views live in usage_logs (feature='profile_view') — the
          // freelancer_profiles table has no such column (old code silently
          // returned 0 via a non-existent column). Count rows headlessly.
          supabase
            .from('usage_logs')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('feature', 'profile_view'),
        ]);

        const profileData = profileResult?.data as Record<string, unknown> | null;
        const profileViews = profileViewsResult?.count ?? 0;

        // Seller position (level) — server-computed, shown live here
        const sellerLevelRaw = (profileData?.seller_level as string | null | undefined) || 'new';
        const sellerLevel = (
          ['top_rated_plus', 'top_rated', 'rising_talent', 'level_1', 'new'].includes(sellerLevelRaw)
            ? sellerLevelRaw
            : 'new'
        ) as SellerLevel;
        const completedProjects = Array.isArray(contractsData)
          ? contractsData.filter(c => c.status === 'completed').length
          : 0;

        // Calculate stats
        const activeContracts = Array.isArray(contractsData)
          ? contractsData.filter(c => ACTIVE_STATUSES.includes(c.status || '')).length
          : 0;
        const pendingProposals = Array.isArray(proposalsData)
          ? proposalsData.filter(p => p.status === 'pending').length
          : 0;
        const pendingInvites = Array.isArray(invitesData)
          ? invitesData.filter(i => i.status === 'pending').length
          : 0;
        const unreadNotifications = Array.isArray(notificationResult?.notifications)
          ? notificationResult.notifications.filter((n: any) => !n.read).length
          : 0;

        // Create activity feed from recent events
        const recentActivities = [
          ...(Array.isArray(contractsData) ? contractsData.slice(0, 3).map((c: any) => ({
            id: c.id,
            type: 'contract',
            title: c.status === 'active' ? 'Contract Active' : 'Contract Pending',
            description: `Project: ${resolveProjectTitle(c)}`,
            timestamp: c.created_at,
            icon: Handshake,
          })) : []),
          ...(Array.isArray(proposalsData) ? proposalsData.slice(0, 3).map((p: any) => ({
            id: p.id,
            type: 'proposal',
            title: p.status === 'pending' ? 'Proposal Pending' : `Proposal ${p.status}`,
            description: `Project: ${resolveProjectTitle(p)}`,
            timestamp: p.created_at,
            icon: FileText,
          })) : []),
          ...(Array.isArray(invitesData) ? invitesData.slice(0, 2).map((i: any) => ({
            id: i.id,
            type: 'invite',
            title: 'New Invitation',
            description: `Project: ${resolveProjectTitle(i)}`,
            timestamp: i.created_at,
            icon: Briefcase,
          })) : []),
        ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 6);

        setStats({
          activeContracts,
          pendingProposals,
          newMatches: 0,
          pendingInvites,
          totalEarnings: earningsData.total,
          monthlyEarnings: earningsData.monthly,
          profileViews,
          unreadNotifications,
        });

        setSellerInfo({
          level: sellerLevel,
          rating: Number(profileData?.rating) || 0,
          completionRate: Number(profileData?.completion_rate) || 100,
          completedProjects,
        });

        setActivities(recentActivities);

        // Real AI recommendation card: same ai_matches the feed shows (score
        // >= 40) — kept lightweight so a new match updates card + counter
        // instantly without re-running the heavy full dashboard reload.
        await refreshAiRecommendations();
      } else if (role === 'client') {
        // ---------- CLIENT DASHBOARD ----------
        CacheManager.clear();

        const [projectsData, contractsData, notificationResult] = await Promise.all([
          projectsService.getClientProjects(user.id, true),
          contractsService.getByUser(user.id, 'client', true),
          notificationService.getByUser(user.id),
        ]);

        // Only genuinely in-progress work counts as "active" — pending contracts
        // (not yet started) are NOT active, which previously made the overview
        // show "Active Contract" while the contracts page showed it as pending.
        const activeContracts = Array.isArray(contractsData)
          ? contractsData.filter(c => ACTIVE_STATUSES.includes(c.status || '')).length
          : 0;
        const pendingContracts = Array.isArray(contractsData)
          ? contractsData.filter(c => PENDING_STATUSES.includes(c.status || '')).length
          : 0;
        const totalSpent = Array.isArray(contractsData)
          ? contractsData
              .filter(c => c.status === 'completed')
              .reduce((sum: number, c: any) => sum + Number(c.amount), 0)
          : 0;
        const unreadNotifications = Array.isArray(notificationResult?.notifications)
          ? notificationResult.notifications.filter((n: any) => !n.read).length
          : 0;
        const pendingProposals = await proposalsService.countPendingForClient(user.id);

        setStats({
          activeContracts,
          pendingProposals,
          newMatches: pendingProposals,
          pendingInvites: pendingContracts,
          totalEarnings: totalSpent,
          monthlyEarnings: 0,
          profileViews: 0,
          unreadNotifications,
        });

        setRecentProjects(Array.isArray(projectsData) ? projectsData.slice(0, 5) : []);

        // Build client activity feed
        const recentActivities = [
          ...(Array.isArray(projectsData) ? projectsData.slice(0, 3).map((p: any) => ({
            id: p.id,
            type: 'project',
            title: p.status === 'open' ? 'Project Posted' : 'Project Updated',
            description: p.title || 'Untitled',
            timestamp: p.created_at,
            icon: Briefcase,
          })) : []),
          ...(Array.isArray(contractsData) ? contractsData.slice(0, 3).map((c: any) => ({
            id: c.id,
            type: 'contract',
            title: c.status === 'active' ? 'Contract Started' : 'Contract Pending',
            description: `Freelancer: ${resolvePartyName(c, 'freelancer_profile', 'Freelancer')}`,
            timestamp: c.created_at,
            icon: Handshake,
          })) : []),
        ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 6);

        setActivities(recentActivities);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data. Pull to refresh or try again later.');
    } finally {
      setLoading(false);
    }
  }, [refreshAiRecommendations, user, role]);

  useEffect(() => {
    fetchDashboardData();

    if (user) {
      if (role === 'freelancer') {
        const contractSub = contractsService.subscribe(user.id, 'freelancer', fetchDashboardData);
        const proposalSub = proposalsService.subscribe(user.id, fetchDashboardData);
        const txSub = transactionsService.subscribe(user.id, fetchDashboardData);
        const notifSub = notificationService.subscribe(user.id, fetchDashboardData);
        const inviteSub = invitesService.subscribeFreelancer(user.id, fetchDashboardData);
        // Live AI matches — the recommendation card AND the counter update
        // instantly (INSERT on a new match, DELETE when a re-score replaces
        // one), without flashing the whole page.
        const matchSub = supabase
          .channel(`overview-matches-${user.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'ai_matches', filter: `freelancer_id=eq.${user.id}` },
            () => { void refreshAiRecommendations(); }
          )
          .subscribe();
        // Live seller position — level bump (contract completed) shows instantly
        const levelSub = supabase
          .channel(`overview-level-${user.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'freelancer_profiles', filter: `user_id=eq.${user.id}` },
            () => { fetchDashboardData(); }
          )
          .subscribe();

        return () => {
          contractSub.unsubscribe();
          proposalSub.unsubscribe();
          txSub.unsubscribe();
          notifSub.unsubscribe();
          inviteSub.unsubscribe();
          matchSub.unsubscribe();
          levelSub.unsubscribe();
        };
      } else if (role === 'client') {
        const contractSub = contractsService.subscribe(user.id, 'client', fetchDashboardData);
        const proposalSub = proposalsService.subscribeForClient(user.id, fetchDashboardData);
        const projectSub = proposalsService.subscribeForClientProjects(user.id, fetchDashboardData);
        const notifSub = notificationService.subscribe(user.id, () => fetchDashboardData());

        return () => {
          contractSub.unsubscribe();
          proposalSub.unsubscribe();
          projectSub.unsubscribe();
          notifSub.unsubscribe();
        };
      }
    }
  }, [fetchDashboardData, refreshAiRecommendations, user, role]);

  if (loading) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-red-700 font-medium mb-4">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="inline-flex items-center gap-3 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isFreelancer = role === 'freelancer';

  // Build stats based on role
  const quickStats: QuickStat[] = isFreelancer
    ? [
        {
          label: 'Active Contracts',
          value: stats.activeContracts,
          change: stats.activeContracts > 0 ? 'Live from workspace' : 'Apply or accept invites',
          changeType: stats.activeContracts > 0 ? 'positive' : 'neutral',
        },
        {
          label: 'Pending Proposals',
          value: stats.pendingProposals,
          change: stats.pendingProposals > 0 ? 'Awaiting client review' : 'Browse project feed',
          changeType: 'neutral',
        },
        {
          label: 'AI Matches',
          value: stats.newMatches,
          change: stats.newMatches > 0 ? 'Fresh matches, live' : 'Update skills to get matched',
          changeType: stats.newMatches > 0 ? 'positive' : 'neutral',
        },
        {
          label: 'Earnings (INR)',
          value: formatCurrency(safeNumber(stats.totalEarnings)),
          change: `${formatCurrency(safeNumber(stats.monthlyEarnings))} this month`,
          changeType: stats.monthlyEarnings > 0 ? 'positive' : 'neutral',
        },
        {
          label: 'Profile Views',
          value: safeNumber(stats.profileViews).toLocaleString(),
          change: 'From your public profile',
          changeType: stats.profileViews > 0 ? 'positive' : 'neutral',
        },
      ]
    : [
        {
          label: 'Active Contracts',
          value: stats.activeContracts,
          change: stats.activeContracts > 0 ? 'In progress right now' : 'No active contracts',
          changeType: stats.activeContracts > 0 ? 'positive' : 'neutral',
        },
        {
          label: 'Pending Contracts',
          value: stats.pendingInvites,
          change: stats.pendingInvites > 0 ? 'Awaiting freelancer start' : 'No pending contracts',
          changeType: stats.pendingInvites > 0 ? 'positive' : 'neutral',
        },
        {
          label: 'Pending Proposals',
          value: stats.pendingProposals,
          change: stats.pendingProposals > 0 ? 'Awaiting your review' : 'No pending proposals',
          changeType: stats.pendingProposals > 0 ? 'positive' : 'neutral',
        },
        {
          label: 'Total Spent',
          value: formatCurrency(safeNumber(stats.totalEarnings)),
          change: 'Across all contracts',
          changeType: 'neutral',
        },
        {
          label: 'Notifications',
          value: stats.unreadNotifications,
          change: stats.unreadNotifications > 0 ? 'Unread messages' : 'All caught up',
          changeType: stats.unreadNotifications > 0 ? 'positive' : 'neutral',
        },
      ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <LayoutDashboard className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2 flex-wrap">
            Welcome back, {user?.name || (isFreelancer ? 'Freelancer' : 'Client')}!
                        {isFreelancer && isPro && <ProBadge size="md" />}
            <InfoTip title="Your dashboard" text="This is your personal command center — contracts, proposals, earnings, AI matches and notifications all in one place. Everything updates in real time as activity happens across the platform." />
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
            {isFreelancer
              ? "Here's your freelancing overview."
              : 'Manage your projects and freelancers.'}
          </p>
          </div>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {quickStats.slice(0, 4).map((stat, index) => (
          <div key={index} className="bg-white p-2.5 sm:p-3 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-all duration-300">
            <p className="flex items-center gap-1 text-slate-500 text-xs sm:text-xs font-medium">
              {stat.label}
              {stat.hint && <InfoTip text={stat.hint} />}
            </p>
            <p className="text-xl font-bold text-slate-900 mt-0.5">{stat.value}</p>
            {stat.change && (
              <p className={`text-[10px] sm:text-xs mt-0.5 ${
                stat.changeType === 'positive' ? 'text-emerald-600' :
                stat.changeType === 'negative' ? 'text-red-600' : 'text-slate-500'
              }`}>
                {stat.change}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left Column - 2/3 */}
        <div className="lg:col-span-2 space-y-4">
          {/* AI Recommendations / Projects */}
          {isFreelancer ? (
            <div className="bg-gradient-to-r from-emerald-500 via-teal-600 to-emerald-600 rounded-xl p-3 text-white shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 flex-wrap">
                      AI Recommendations <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-300 animate-ping shrink-0"></span>
                    </h3>
                    <p className="text-emerald-100 text-[10px]">Projects matched to your skills</p>
                  </div>
                </div>
                <Link
                  to="/dashboard/feed"
                  className="                  w-full sm:w-auto text-center self-start sm:self-auto bg-white text-emerald-600 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-emerald-50 transition-all duration-200 flex items-center justify-center gap-1.5"
                >
                  View All <ArrowRight className="w-4 h-4" />
                </Link>
              </div>                  {recentProjects.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {recentProjects
                    .slice(0, 3)
                    .map((project: any) => (
                    <Link
                      key={project.id}
                      to={`/dashboard/feed?project=${project.id}`}
                      className="block bg-white/10 hover:bg-white/20 rounded-lg p-2.5 transition-colors"
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium text-xs sm:text-xs">{project.title}</h4>
                          <p className="text-emerald-100 text-xs mt-0.5 line-clamp-3">{project.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{formatBudgetRange(project.budget_min, project.budget_max)}</p>
                          <p className="text-emerald-100 text-xs">{project.experience_level}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-center py-2">
                  <p className="text-emerald-100 text-xs">No matching projects. Update your skills.</p>
                  <Link to="/dashboard/profile" className="inline-block mt-1 text-[10px] font-medium underline">
                    Update Profile
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gradient-to-br from-emerald-500 via-teal-600 to-emerald-600 rounded-xl p-3 text-white shadow-md">
              <div className="flex items-center gap-3 mb-1.5">
                <Sparkles className="w-4 h-4 animate-workflow-pulse" />
                <h3 className="text-xs font-semibold flex items-center gap-1.5">
                  AI-Powered Talent Matching <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-300 animate-ping"></span>
                </h3>
              </div>
              <p className="text-emerald-100 text-xs mb-2">
                Let our AI find the best freelancers for your projects.
              </p>
              <Link
                to="/client/ai-assistant"
                className="inline-block bg-white text-emerald-600 px-2.5 py-1 rounded-lg font-medium text-xs hover:bg-emerald-50 transition-all duration-200"
              >
                Chat with AI — Free
              </Link>
            </div>
          )}

          {/* Recent Activity */}
          <div className="bg-white rounded-xl p-3 sm:p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs sm:text-sm font-semibold text-slate-900">Recent Activity</h2>
              <Link
                to={isFreelancer ? '/dashboard/contracts' : '/client/contracts'}
                className="text-emerald-600 font-medium text-sm hover:underline"
              >
                View All
              </Link>
            </div>

            {activities.length > 0 ? (
              <div className="space-y-2">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3.5 p-1.5 hover:bg-slate-50 rounded-lg transition-colors">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      activity.type === 'contract' ? 'bg-emerald-100 text-emerald-600' :
                      activity.type === 'proposal' ? 'bg-blue-100 text-blue-600' :
                      activity.type === 'project' ? 'bg-orange-100 text-orange-600' :
                      'bg-purple-100 text-purple-600'
                    }`}>
                      <activity.icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 break-words">
                      <p className="font-medium text-slate-900 text-xs sm:text-xs">{activity.title}</p>
                      <p className="text-xs text-slate-500">{activity.description}</p>
                    </div>
                    <span className="text-xs text-slate-400">
                      {safeFormatDate(activity.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-slate-500 text-xs">
                  {isFreelancer
                    ? 'No recent activity. Start by submitting proposals!'
                    : 'No recent activity. Post a project to get started!'}
                </p>
                <Link
                  to={isFreelancer ? '/dashboard/feed' : '/client/post'}
                  className="inline-block mt-1.5 text-emerald-600 font-medium text-xs hover:underline"
                >
                  {isFreelancer ? 'Browse Projects' : 'Post a Project'}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - 1/3 */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <div className="bg-white rounded-xl p-3 border border-slate-100">
            <h3 className="font-semibold text-slate-900 text-xs mb-2">Quick Actions</h3>
            <div className="space-y-2">
              {isFreelancer ? (
                <>
                  <Link
                    to="/dashboard/feed"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <Briefcase className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">Find Projects</span>
                  </Link>
                  <Link
                    to="/dashboard/proposals"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <FileText className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">My Proposals</span>
                  </Link>
                  <Link
                    to="/dashboard/invites"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <MessageSquare className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">Invites ({stats.pendingInvites})</span>
                  </Link>
                  <Link
                    to="/dashboard/wallet"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <Wallet className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">Earnings</span>
                  </Link>
                  {isFeatureEnabled('contests') && (
                    <Link
                      to="/contests"
                      className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                    >
                      <Trophy className="w-4 h-4 text-amber-500" />
                      <span className="font-medium text-slate-700 text-xs">Contests</span>
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <Link
                    to="/client/post"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <Plus className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">Post a Project</span>
                  </Link>
                  <Link
                    to="/client/matches"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <Users className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">Find Talent</span>
                  </Link>
                  <Link
                    to="/client/contracts"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <FileText className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">Contracts</span>
                  </Link>
                  <Link
                    to="/client/payments"
                    className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-sm transition-all duration-200"
                  >
                    <CreditCard className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-700 text-xs">Payments</span>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Seller Level / Position — updates live when contracts complete */}
          {isFreelancer && (() => {
            const levelInfo = getSellerLevelInfo(sellerInfo.level);
            const nextInfo = levelInfo.nextLevel ? getSellerLevelInfo(levelInfo.nextLevel) : null;
            const progress = getSellerLevelProgress({
              rating: sellerInfo.rating,
              totalProjects: sellerInfo.completedProjects,
              completionRate: sellerInfo.completionRate,
            });
            // Requirement checklist with live met/unmet state
            const levelReqs: { label: string; met: boolean }[] = nextInfo
              ? nextInfo.nextRequirements.map((req) => {
                  const reqLower = req.toLowerCase();
                  const isRating = reqLower.includes('rating');
                  const isProjects = reqLower.includes('project') || reqLower.includes('completed');
                  const isCompletion = reqLower.includes('completion');
                  const met = isRating
                    ? sellerInfo.rating >= parseFloat(reqLower.match(/\d+(?:\.\d+)?/)?.[0] || '99')
                    : isProjects
                    ? sellerInfo.completedProjects >= parseInt(reqLower.match(/\d+/)?.[0] || '99')
                    : isCompletion
                    ? sellerInfo.completionRate >= parseFloat(reqLower.match(/\d+(?:\.\d+)?/)?.[0] || '99')
                    : false;
                  return { label: req, met };
                })
              : [];
            return (
              <div className="bg-white rounded-xl p-3 border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="flex items-center gap-1.5 font-semibold text-slate-900">
                    Your Position
                    <InfoTip
                      title="Freelancer levels"
                      text="Your position grows automatically as you complete contracts on time with happy clients: New → Level 1 → Rising Talent → Top Rated → Top Rated Plus. Higher levels unlock more visibility and trust with clients."
                    />
                  </h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${levelInfo.bgColor} ${levelInfo.color} ${levelInfo.borderColor}`}>
                    {levelInfo.label}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{levelInfo.description}</p>

                {/* Live performance metrics */}
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <div className="rounded-lg bg-slate-50 border border-slate-100 p-1.5 text-center">
                    <p className="text-xs font-bold text-slate-900">{sellerInfo.completedProjects}</p>
                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Completed</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-100 p-1.5 text-center">
                    <p className="text-xs font-bold text-slate-900">{sellerInfo.rating.toFixed(1)}</p>
                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Rating</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-100 p-1.5 text-center">
                    <p className="text-xs font-bold text-slate-900">{sellerInfo.completionRate}%</p>
                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Completion</p>
                  </div>
                </div>

                {nextInfo ? (
                  <>
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="font-medium text-slate-600">Progress to {nextInfo.label}</span>
                        <span className="font-bold text-emerald-600">{Number.isFinite(progress.percent) ? progress.percent : 0}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700"
                          style={{ width: `${Number.isFinite(progress.percent) ? Math.min(100, progress.percent) : 0}%` }}
                        />
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {levelReqs.map((req) => (
                        <li key={req.label} className="text-[10px] flex items-center gap-1.5">
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                              req.met ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {req.met ? <Check className="w-2.5 h-2.5" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                          </span>
                          <span className={req.met ? 'text-slate-700 font-medium' : 'text-slate-500'}>{req.label}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-emerald-600 mt-2 font-medium">🎉 Highest level achieved!</p>
                )}
              </div>
            );
          })()}

          {/* Notifications */}
          <div className="bg-white rounded-xl p-3 border border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="font-semibold text-slate-900 text-xs">Notifications</h3>
              {stats.unreadNotifications > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                  {stats.unreadNotifications}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {isFreelancer
                ? 'Stay updated with your latest project activities.'
                : 'Stay informed about proposals and contract updates.'}
            </p>
            <Link
              to={isFreelancer ? '/dashboard/notifications' : '/client/contracts'}
              className="block mt-1.5 text-emerald-600 font-medium text-xs hover:underline"
            >
              View Details →
            </Link>
          </div>

          {/* Profile Completion Widget Removed */}
        </div>
      </div>

      {/* AI Assistant & Support */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-emerald-500 via-teal-600 to-emerald-600 rounded-xl p-3 text-white shadow-md">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="h-7 w-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold">AI Assistant</h3>
              <p className="text-emerald-100 text-[10px]">
                {isFreelancer ? 'Proposals, contracts, escrow, career help' : 'Hiring, contracts, escrow, project help'}
              </p>
            </div>
          </div>
          <p className="text-emerald-50 text-xs leading-relaxed mb-2">
            Ask anything in any language — get instant answers about how your{' '}
            {isFreelancer ? 'freelancing business' : 'projects'} work on Growlanzo.
          </p>
          <Link
            to={isFreelancer ? '/dashboard/ai-assistant' : '/client/ai-assistant'}
            className="inline-flex items-center gap-1.5 bg-white text-emerald-700 px-2.5 py-1 rounded-lg font-semibold text-xs hover:bg-emerald-50 transition-colors"
          >
            <Bot className="w-3.5 h-3.5" />
            Chat with AI
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="bg-white rounded-xl p-3 border border-slate-100">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="h-7 w-7 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <Headphones className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900">Support & Help</h3>
              <p className="text-slate-500 text-[10px]">Payments, verification, disputes, account issues</p>
            </div>
          </div>
          <p className="text-slate-600 text-xs leading-relaxed mb-2">
            Guided AI support for account and payment issues.
          </p>
          <div className="flex flex-wrap gap-1">
            <Link
              to={isFreelancer ? '/dashboard/ai-assistant' : '/client/ai-assistant'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-xs hover:bg-slate-200 transition-colors"
            >
              <Headphones className="w-3.5 h-3.5" />
              AI Support
            </Link>
            <Link
              to="/help-center"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
            >
              Help Center
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}