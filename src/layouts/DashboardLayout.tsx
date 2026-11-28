import { Suspense } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Rss,
  Mail,
  FileText,
  Handshake,
  Laptop,
  Wallet,
  User,
  Search,
  Share2,
  LogOut,
  Home,
  Package,
  Bot,
  Menu,
  X,
  BarChart3,
  Image,
  Bell,
  Scale,
  Crown,
  Award,
  Trophy,
  HelpCircle,
  LifeBuoy,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, realtimeChannels } from '../lib/supabase';
import { notificationService } from '../lib/notifications';
import { NotificationsPanel } from '../components/NotificationsPanel';
import { NotificationToastBridge } from '../components/NotificationToastBridge';
import { ProBadge } from '../components/ProBadge';
import { GrowCoinBadge } from '../components/GrowCoinBadge';
import { resolveDashboardSection } from '../lib/dashboardSection';
import { isDeferredRoute } from '../lib/featureFlags';
import { useProStatus } from '../hooks/useProStatus';
import { getSellerLevelInfo, type SellerLevel } from '../lib/sellerLevels';
import { BrandLogo } from '../components/BrandLogo';

// ─── Sidebar Link Groups with Section Headers ───────────────────────────
interface SidebarLink {
  id: string;
  path: string;
  icon: LucideIcon;
  label: string;
}

interface SidebarGroup {
  label: string;
  links: SidebarLink[];
}

const sidebarGroups: SidebarGroup[] = [
  {
    label: 'WORK',
    links: [
      { id: 'overview', path: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
      { id: 'feed', path: '/dashboard/feed', icon: Rss, label: 'Project Feed' },
      { id: 'invites', path: '/dashboard/invites', icon: Mail, label: 'Invites' },
      { id: 'proposals', path: '/dashboard/proposals', icon: FileText, label: 'Proposals' },
      { id: 'contracts', path: '/dashboard/contracts', icon: Handshake, label: 'Contracts' },
      { id: 'workspace', path: '/dashboard/workspace', icon: Laptop, label: 'Workspace' },
    ],
  },
  {
    label: 'OFFERINGS',
    links: [
      { id: 'services', path: '/dashboard/services', icon: Package, label: 'Services' },
      { id: 'portfolio', path: '/dashboard/portfolio', icon: Image, label: 'Portfolio' },
      { id: 'contests', path: '/dashboard/contests', icon: Trophy, label: 'Contests' },
    ],
  },
  {
    label: 'COMMUNICATION',
    links: [
      { id: 'notifications', path: '/dashboard/notifications', icon: Bell, label: 'Notifications' },
      { id: 'ai-assistant', path: '/dashboard/ai-assistant', icon: Bot, label: 'AI Assistant' },
    ],
  },
  {
    label: 'GROWTH',
    links: [
      { id: 'analytics', path: '/dashboard/analytics', icon: BarChart3, label: 'Analytics' },
      { id: 'certifications', path: '/dashboard/certifications', icon: Award, label: 'Certifications' },
      { id: 'referrals', path: '/dashboard/referrals', icon: Share2, label: 'Referrals' },
      { id: 'pro', path: '/dashboard/pro', icon: Crown, label: 'Premium' },
    ],
  },
];

const accountLinks: SidebarLink[] = [
  { id: 'wallet', path: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
  { id: 'profile', path: '/dashboard/profile', icon: User, label: 'Profile' },
  { id: 'identity-verification', path: '/dashboard/identity-verification', icon: ShieldCheck, label: 'Verification' },
];

const supportLinks: SidebarLink[] = [
  { id: 'disputes', path: '/dashboard/disputes', icon: Scale, label: 'Disputes' },
  { id: 'support-tickets', path: '/dashboard/support-tickets', icon: LifeBuoy, label: 'Support Tickets' },
  { id: 'help-center', path: '/dashboard/help-center', icon: HelpCircle, label: 'Help Center' },
];

/**
 * Deferred modules are removed from the sidebar entirely — not routed to an
 * "unavailable" page from the menu — so the release never advertises what it
 * does not ship. The routes themselves still exist for old links.
 */
const visibleSidebarGroups: SidebarGroup[] = sidebarGroups
  .map((group) => ({ ...group, links: group.links.filter((link) => !isDeferredRoute(link.path)) }))
  .filter((group) => group.links.length > 0);

export function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentPath = location.pathname;
  // Header section name — resolved from the real route, never a hardcoded guess.
  // Searching only the sidebar groups (the old behaviour) labelled every
  // non-sidebar route "Workspace": Create Service, Skill Test, Verification,
  // Time Tracking, Support Tickets …
  const sectionLabel = resolveDashboardSection(currentPath, [
    ...visibleSidebarGroups.flatMap((group) => group.links),
    ...accountLinks,
    ...supportLinks,
  ]);
  const [headerSearch, setHeaderSearch] = useState('');
  const [badgeCounts, setBadgeCounts] = useState({
    invites: 0,
    proposals: 0,
    contracts: 0,
  });
  const [userProfile, setUserProfile] = useState<{ name: string; avatar: string | null; rating: number; total_reviews: number; seller_level?: string | null } | null>(null);
  const [newMatchCount, setNewMatchCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const { isPro } = useProStatus();

  const safeUnsubscribe = (channel: { unsubscribe?: () => void } | null | undefined) => {
    if (channel?.unsubscribe) {
      try {
        channel.unsubscribe();
      } catch {
        // Unsubscribe failed silently
      }
    }
  };

  const isActive = (path: string) => {
    if (path === '/dashboard' && currentPath === '/dashboard') return true;
    if (path !== '/dashboard' && (currentPath === path || currentPath.startsWith(path + '/'))) return true;
    return false;
  };

  const getRatingBadge = () => {
    if (!userProfile) return 'New Freelancer';
    // Prefer the server-computed seller level (changes with completed work)
    const level = userProfile.seller_level || 'new';
    if (['top_rated_plus', 'top_rated', 'rising_talent', 'level_1'].includes(level)) {
      return getSellerLevelInfo(level as SellerLevel).label;
    }
    if (userProfile.rating === 0) return 'New Freelancer';
    if (userProfile.rating >= 4.8) return 'Top-Rated Plus';
    if (userProfile.rating >= 4.5) return 'Top-Rated';
    if (userProfile.rating >= 4.0) return 'Rising Talent';
    return 'Rated';
  };

  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      return;
    }

    // Reset profile state when user changes
    setUserProfile(null);

    // Fetch user profile
    const fetchUserProfile = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('name, avatar')
          .eq('id', user.id)
          .single();
        
        if (data) {
          // Seller position is server-computed on contract completion
          const { data: flData } = await supabase
            .from('freelancer_profiles')
            .select('seller_level')
            .eq('user_id', user.id)
            .maybeSingle();
          setUserProfile({
            name: data.name,
            avatar: data.avatar,
            rating: 0,
            total_reviews: 0,
            seller_level: (flData as { seller_level?: string | null } | null)?.seller_level || 'new'
          });
        }
      } catch {
        // Profile fetch failed silently
      }
    };

    // Fetch badge counts
    const fetchBadgeCounts = async () => {
      try {
        const [invitesRes, proposalsRes, contractsRes] = await Promise.all([
          supabase.from('invites').select('id', { count: 'exact' }).eq('freelancer_id', user.id).eq('status', 'pending'),
          supabase.from('proposals').select('id', { count: 'exact' }).eq('freelancer_id', user.id).eq('status', 'pending'),
          supabase.from('contracts').select('id', { count: 'exact' }).eq('freelancer_id', user.id).in('status', ['active', 'pending']),
        ]);

        const { count: matchCount } = await supabase
          .from('ai_matches')
          .select('id', { count: 'exact', head: true })
          .eq('freelancer_id', user.id)
          .gte('match_score', 70);

        setBadgeCounts({
          invites: invitesRes.count || 0,
          proposals: proposalsRes.count || 0,
          contracts: contractsRes.count || 0,
        });
        setNewMatchCount(matchCount ?? 0);
      } catch {
        // Badge count fetch failed silently
      }
    };

    const fetchUnreadCount = async () => {
      try {
        const data = await notificationService.getByUser(user.id, { unreadOnly: true, limit: 1, forceRefetch: true });
        setUnreadNotifications(data.unread_count);
      } catch {
        // Unread count fetch failed silently
      }
    };

    fetchUserProfile();
    fetchBadgeCounts();
    fetchUnreadCount();

    // Subscribe to notifications for real-time badge updates
    const notifSub = notificationService.subscribe(user.id, () => {
      fetchUnreadCount();
    });

    // Set up real-time subscriptions for profile changes
    const profilesChannel = realtimeChannels.profiles('layout-profile')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          if (!payload?.new) return;

          if (
            payload.new.avatar !== payload.old.avatar ||
            payload.new.name !== payload.old.name ||
            payload.new.rating !== payload.old.rating ||
            payload.new.total_reviews !== payload.old.total_reviews
          ) {
            setUserProfile(prev => ({
              name: payload.new.name,
              avatar: payload.new.avatar,
              rating: payload.new.rating || 0,
              total_reviews: payload.new.total_reviews || 0,
              seller_level: prev?.seller_level || 'new',
            }));
          }
        }
      )
      .subscribe();

    const invitesChannel = realtimeChannels.invites('layout-invites')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'invites',
        filter: `freelancer_id=eq.${user.id}`,
      }, () => fetchBadgeCounts())
      .subscribe();

    const proposalsChannel = realtimeChannels.proposals('layout-proposals')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'proposals',
        filter: `freelancer_id=eq.${user.id}`,
      }, () => fetchBadgeCounts())
      .subscribe();

    const contractsChannel = realtimeChannels.contracts('layout-contracts')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'contracts',
        filter: `freelancer_id=eq.${user.id}`,
      }, () => fetchBadgeCounts())
      .subscribe();

    // Real-time seller level — header badge updates the instant a contract
    // completes (recompute_seller_level trigger writes freelancer_profiles)
    const sellerLevelChannel = supabase
      .channel(`layout-seller-level-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'freelancer_profiles', filter: `user_id=eq.${user.id}` },
        async () => {
          const { data: flData } = await supabase
            .from('freelancer_profiles')
            .select('seller_level')
            .eq('user_id', user.id)
            .maybeSingle();
          if (flData) {
            setUserProfile(prev =>
              prev
                ? { ...prev, seller_level: (flData as { seller_level?: string | null }).seller_level || 'new' }
                : prev
            );
          }
        }
      )
      .subscribe();

    return () => {
      safeUnsubscribe(profilesChannel);
      safeUnsubscribe(invitesChannel);
      safeUnsubscribe(proposalsChannel);
      safeUnsubscribe(contractsChannel);
      safeUnsubscribe(sellerLevelChannel);
      safeUnsubscribe(notifSub);
    };
  }, [user]);

  // Keep sidebar badges fresh in REAL TIME — refetch on window focus + every 45s
  // (belt-and-braces on top of the realtime channels above).
  useEffect(() => {
    if (!user) return;
    const refreshBadges = async () => {
      try {
        const [invitesRes, proposalsRes, contractsRes] = await Promise.all([
          supabase.from('invites').select('id', { count: 'exact' }).eq('freelancer_id', user.id).eq('status', 'pending'),
          supabase.from('proposals').select('id', { count: 'exact' }).eq('freelancer_id', user.id).eq('status', 'pending'),
          supabase.from('contracts').select('id', { count: 'exact' }).eq('freelancer_id', user.id).in('status', ['active', 'pending']),
        ]);
        setBadgeCounts({
          invites: invitesRes.count || 0,
          proposals: proposalsRes.count || 0,
          contracts: contractsRes.count || 0,
        });
        const { count: matchCount } = await supabase
          .from('ai_matches')
          .select('id', { count: 'exact', head: true })
          .eq('freelancer_id', user.id)
          .gte('match_score', 70);
        setNewMatchCount(matchCount ?? 0);
      } catch {
        // Badge refresh failed silently — realtime channels still cover it
      }
    };
    const onFocus = () => { void refreshBadges(); };
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(() => { void refreshBadges(); }, 45000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, [user]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Mobile Drawer Overlay */}
      <div
        className={`fixed inset-0 bg-slate-900/40 z-40 transition-opacity duration-200 lg:hidden ${mobileNavOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMobileNavOpen(false)}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] bg-white shadow-2xl border-r border-slate-200 p-5 transform transition-transform duration-300 ease-out lg:hidden ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-5">
          <Link to="/" className="block min-w-0">
            <BrandLogo variant="wordmark" className="h-10 w-auto max-w-full object-contain object-left" />
            <span className="mt-1 block text-[10px] uppercase tracking-widest text-slate-400 font-bold">Freelancer</span>
          </Link>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="inline-flex items-center justify-center h-9 w-9 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <nav className="space-y-1">
            {visibleSidebarGroups.map((group) => (              <div key={group.label} className="mb-1">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {group.label}
              </div>
              {group.links.map((link) => {
                const getBadgeCount = () => {
                  switch (link.id) {
                    case 'notifications':
                      return unreadNotifications > 0 ? unreadNotifications : null;
                    case 'invites':
                      return badgeCounts.invites > 0 ? badgeCounts.invites : null;
                    case 'proposals':
                      return badgeCounts.proposals > 0 ? badgeCounts.proposals : null;
                    case 'contracts':
                      return badgeCounts.contracts > 0 ? badgeCounts.contracts : null;
                    default:
                      return null;
                  }
                };

                const badgeCount = getBadgeCount();

                return (
                  <Link
                    key={link.id}
                    to={link.path}
                    onClick={() => setMobileNavOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                      isActive(link.path)
                        ? 'bg-emerald-50 text-emerald-600 shadow-sm border border-emerald-100'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-emerald-600'
                    }`}
                  >
                    <link.icon className="w-5 h-5 shrink-0" />
                    <span className="font-medium text-sm">{link.label}</span>
                    {link.id === 'pro' && isPro && (
                      <ProBadge size="xs" className="ml-1" />
                    )}
                    {badgeCount && (
                      <span className="ml-auto bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}          <div className="mb-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              ACCOUNT
            </div>
            {accountLinks.map((link) => (
              <Link
                key={link.id}
                to={link.path}
                onClick={() => setMobileNavOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                  isActive(link.path)
                    ? 'bg-emerald-50 text-emerald-600 shadow-sm border border-emerald-100'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-emerald-600'
                }`}
              >
                <link.icon className="w-5 h-5 shrink-0" />
                <span className="font-medium text-sm">{link.label}</span>
              </Link>
            ))}
          </div>

          <div className="mb-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              SUPPORT
            </div>
            {supportLinks.map((link) => (
              <Link
                key={link.id}
                to={link.path}
                onClick={() => setMobileNavOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                  isActive(link.path)
                    ? 'bg-emerald-50 text-emerald-600 shadow-sm border border-emerald-100'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-emerald-600'
                }`}
              >
                <link.icon className="w-5 h-5 shrink-0" />
                <span className="font-medium text-sm">{link.label}</span>
              </Link>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 space-y-1">              <Link
              to="/"
              onClick={() => setMobileNavOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50 hover:text-emerald-600 transition-all duration-200"
            >
              <Home className="w-4 h-4" />
              <span className="font-medium text-sm">Homepage</span>
            </Link>
            <button
              onClick={() => {
                logout();
                setMobileNavOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium text-sm">Logout</span>
            </button>
          </div>
          </nav>
        </div>
      </div>
      </aside>

      {/* Desktop Sidebar */}
      {
        /* h-screen minus the cookie banner's published height (0px when it is not
           showing), so a first visit never buries Homepage / Logout under it. */
      }
      <aside className="w-64 sticky top-0 h-[calc(100vh-var(--consent-banner-h,0px))] hidden lg:flex flex-col p-4 z-50 overflow-y-auto bg-white border-r border-slate-200">
        {/* Logo */}
        <Link to="/" className="block mb-5 px-2">
          <BrandLogo variant="wordmark" className="h-9 w-auto max-w-full object-contain object-left" />
          <span className="mt-1 block text-[10px] uppercase tracking-widest text-slate-400 font-bold">Freelancer</span>
        </Link>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          {visibleSidebarGroups.map((group) => (              <div key={group.label} className="mb-1">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {group.label}
              </div>
              {group.links.map((link) => {
                const getBadgeCount = () => {
                  switch (link.id) {
                    case 'notifications':
                      return unreadNotifications > 0 ? unreadNotifications : null;
                    case 'invites':
                      return badgeCounts.invites > 0 ? badgeCounts.invites : null;
                    case 'proposals':
                      return badgeCounts.proposals > 0 ? badgeCounts.proposals : null;
                    case 'contracts':
                      return badgeCounts.contracts > 0 ? badgeCounts.contracts : null;
                    default:
                      return null;
                  }
                };

                const badgeCount = getBadgeCount();

                return (
                  <Link
                    key={link.id}
                    to={link.path}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                      isActive(link.path)
                        ? 'bg-emerald-50 text-emerald-600 shadow-sm border border-emerald-100'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-emerald-600'
                    }`}
                  >
                    <link.icon className="w-4 h-4" />
                    <span className="font-medium text-sm">{link.label}</span>
                    {link.id === 'pro' && isPro && (
                      <ProBadge size="xs" className="ml-1" />
                    )}
                    {badgeCount && (
                      <span className="ml-auto bg-orange-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}

          <div className="mb-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              ACCOUNT
            </div>
            {accountLinks.map((link) => (
              <Link
                key={link.id}
                to={link.path}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                  isActive(link.path)
                    ? 'bg-emerald-50 text-emerald-600 shadow-sm border border-emerald-100'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-emerald-600'
                }`}
              >
                <link.icon className="w-4 h-4" />
                <span className="font-medium text-sm">{link.label}</span>
              </Link>
            ))}
          </div>          <div className="mb-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              SUPPORT
            </div>
            {supportLinks.map((link) => (
              <Link
                key={link.id}
                to={link.path}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 ${
                  isActive(link.path)
                    ? 'bg-emerald-50 text-emerald-600 shadow-sm border border-emerald-100'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-emerald-600'
                }`}
              >
                <link.icon className="w-4 h-4" />
                <span className="font-medium text-sm">{link.label}</span>
              </Link>
            ))}
          </div>
        </nav>

        {/* AI Boost Card */}
        <div className="mt-4">
          <div className="bg-emerald-50 rounded-xl p-3.5 border border-emerald-100">
            <p className="text-xs text-emerald-800 font-semibold mb-1">AI Boost Active</p>
            <p className="text-[11px] text-emerald-600 leading-relaxed mb-2.5">
              {newMatchCount > 0
                ? `Your profile has ${newMatchCount} strong AI match${newMatchCount === 1 ? '' : 'es'} right now.`
                : 'Post projects or update skills to get fresh AI matches.'}
            </p>
            <Link
              to="/dashboard/feed"
              className="block w-full py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors text-center"
            >
              View Matches
            </Link>
          </div>
        </div>

        {/* Logout & Home */}
        <div className="mt-4 pt-3 border-t border-slate-200 space-y-1">
          <Link
            to="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-emerald-600 transition-all duration-200"
          >
            <Home className="w-4 h-4" />
            <span className="font-medium text-sm">Homepage</span>
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            <span className="font-medium text-sm">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">          {/* Top Bar */}
        <header className="min-h-16 sm:h-20 bg-white sticky top-0 z-40 border-b border-slate-100 px-4 sm:px-6 lg:px-8 2xl:px-12 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shrink-0"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden min-w-0 flex-1 px-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 leading-none">Freelancer Dashboard</p>
              <p className="mt-1 text-sm font-bold text-slate-800 truncate">{sectionLabel}</p>
            </div>
            <div className="hidden sm:flex items-center gap-4 flex-1 min-w-0">
              <div className="relative w-full max-w-xs md:max-w-sm group">
                <input
                  type="search"
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const q = headerSearch.trim();
                      navigate(q ? `/dashboard/feed?search=${encodeURIComponent(q)}` : '/dashboard/feed');
                    }
                  }}
                  placeholder="Search projects, contracts..."
                  aria-label="Search projects"
                  className="w-full pl-4 pr-10 sm:pr-12 py-2 sm:py-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
                />
                <button
                  onClick={() => {
                    const q = headerSearch.trim();
                    navigate(q ? `/dashboard/feed?search=${encodeURIComponent(q)}` : '/dashboard/feed');
                  }}
                  aria-label="Search projects"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1 sm:gap-2 md:gap-4 shrink-0">
            {/* AI Ready Badge - hidden on mobile, shown on md+ */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-bold text-emerald-700">AI Ready</span>
            </div>

            {/* Light KYC nudge — disappears in real time once verified. */}

            <GrowCoinBadge userId={user?.id} role={user?.role} />

            {/* Notifications */}
            <NotificationsPanel />

            <div className="hidden sm:block h-8 w-px bg-slate-200"></div>

            {/* User Menu */}
            <button aria-label="Open account menu" className="flex items-center justify-center gap-1 sm:gap-3 min-h-10 min-w-10 pl-1 pr-1 sm:pr-3 py-1 hover:bg-slate-50 rounded-full transition-all group">
              {user?.avatar ? (
                <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-full overflow-hidden border-2 border-emerald-500/20 group-hover:border-emerald-500 transition-all">
                  <img
                    src={user.avatar}
                    alt={user.name || 'User'}
                    className="w-full h-full object-cover object-top"
                    style={{
                      objectPosition: 'center 20%',
                      filter: 'brightness(1.05) contrast(1.02)'
                    }}
                  />
                </div>
              ) : (
                <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-slate-100 flex items-center justify-center border-2 border-emerald-500/20">
                  <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                </div>
              )}
              <div className="text-left hidden lg:block">
                <p className="text-sm font-bold leading-tight flex items-center gap-1.5">
                  {user?.name || 'User'}
                                    {isPro && <ProBadge size="xs" />}
                </p>
                <div className="flex items-center gap-1">
                  <p className="text-[10px] text-slate-500 font-medium tracking-wide">{getRatingBadge()}</p>
                  {userProfile && userProfile.rating > 0 && (
                    <>
                      <span className="text-[10px] text-emerald-600">★</span>
                      <span className="text-[10px] text-slate-400">({userProfile.total_reviews})</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          </div>
        </header>

        {/* Page Content */}
        {/* Page Content — overflow-x clip keeps long content from pushing the
            page horizontally on mobile (beige-strip bug); header sticky sits
            outside this wrapper so sticky behavior is unaffected. */}
        <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-[100rem] mx-auto w-full break-words overflow-x-hidden">
          <Suspense>
            <Outlet />
          </Suspense>
        </div>
        <NotificationToastBridge />
      </main>

    </div>
  );
}
