import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  Handshake,
  Banknote,
  AlertOctagon,
  Zap,
  BarChart3,
  ChevronDown,
  ShieldCheck,
  ExternalLink,
  Globe,
  Search,
  Award,
  GraduationCap,
  Star,
  TrendingUp,
  Database,
  Inbox,
  LogOut,
  Mail,
} from 'lucide-react';
import { AdminDashboardFallback } from '../components/LoadingSkeleton';
import { NotificationsPanel } from '../components/NotificationsPanel';
import { adminLogout, getAdminSession } from '../components/AdminAuthGuard';
import { isDeferredRoute, isFeatureEnabled } from '../lib/featureFlags';
import { BrandLogo } from '../components/BrandLogo';

interface SidebarItem {
  id: string;
  path?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children?: { path: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
}

const sidebarSections: SidebarItem[] = [
  { id: 'overview', path: '/admin', icon: LayoutDashboard, label: 'Overview' },
  { id: 'users', path: '/admin/users', icon: Users, label: 'Users' },
  { id: 'projects', path: '/admin/projects', icon: FolderKanban, label: 'Projects' },
  { id: 'contracts', path: '/admin/contracts', icon: Handshake, label: 'Contracts' },
  { id: 'payments', path: '/admin/payments', icon: Banknote, label: 'Payments' },
  { id: 'finance', path: '/admin/finance', icon: TrendingUp, label: 'Finance' },
  { id: 'withdrawals', path: '/admin/withdrawals', icon: Banknote, label: 'Withdrawals' },
  { id: 'disputes', path: '/admin/disputes', icon: AlertOctagon, label: 'Disputes' },
  { id: 'subscriptions', path: '/admin/subscriptions', icon: Zap, label: 'Subscriptions' },
  { id: 'reports', path: '/admin/reports', icon: BarChart3, label: 'Reports' },
  { id: 'internships', path: '/admin/internships', icon: Users, label: 'Internships' },
  { 
    id: 'certificates', 
    icon: Award, 
    label: 'Certificates',
    children: [
      { path: '/admin/certificates', label: 'Internship Applicants', icon: GraduationCap },
      { path: '/admin/certificates?tab=certs', label: 'All Certificates', icon: Star },
    ],
  },
  { id: 'identity-verification', path: '/admin/identity-verification', icon: ShieldCheck, label: 'Verification' },
  { id: 'support-tickets', path: '/admin/support-tickets', icon: AlertOctagon, label: 'Support Tickets' },
  { id: 'user-reports', path: '/admin/user-reports', icon: Inbox, label: 'User Reports' },
  { id: 'emails', path: '/admin/emails', icon: Mail, label: 'Emails' },
  { id: 'waitlist', path: '/admin/waitlist', icon: Globe, label: 'Waitlist' },
  { id: 'data-isolation', path: '/admin/data-isolation', icon: Database, label: 'Data Isolation' },
];

/**
 * Deferred modules (internships, certificates) are removed from the admin
 * navigation too — the routes still render FeatureUnavailablePage when a stale
 * link is opened, but the shell must never advertise what this release does
 * not ship. Children are filtered individually so a section with mixed
 * visibility keeps only its live entries.
 */
const visibleSidebarSections: SidebarItem[] = sidebarSections
  .map((section) => {
    if (!section.children) return section;
    const children = section.children.filter((child) => !isDeferredRoute(child.path));
    return children.length === section.children.length ? section : { ...section, children };
  })
  .filter((section) => {
    if (section.children) return section.children.length > 0;
    return !isDeferredRoute(section.path);
  });

export function AdminDashboardLayout() {
  const location = useLocation();
  const currentPath = location.pathname;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ label: string; path: string; icon: React.ReactNode }[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Track expanded sections for slide-down submenus
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Auto-expand section if a sub-item is active
  useEffect(() => {
    visibleSidebarSections.forEach(section => {
      if (section.children) {
        const isChildActive = section.children.some(child => {
          const childPath = child.path.split('?')[0];
          return currentPath.startsWith(childPath);
        });
        if (isChildActive) {
          setExpandedSections(prev => {
            if (!prev.has(section.id)) {
              const next = new Set(prev);
              next.add(section.id);
              return next;
            }
            return prev;
          });
        }
      }
    });
  }, [currentPath]);

  // Get admin session info (set by AdminAuthGuard before rendering)
  const [adminName, setAdminName] = useState('Admin');

  useEffect(() => {
    const session = getAdminSession();
    if (session) {
      setAdminName(session.label || 'Admin');
    }
  }, []);

  // Search functionality — search both parent items and sub-items
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    const q = query.toLowerCase();
    const results: { label: string; path: string; icon: React.ReactNode }[] = [];
    
    visibleSidebarSections.forEach(item => {
      const Icon = item.icon;
      // Check parent
      if (item.path && (item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))) {
        results.push({ label: item.label, path: item.path, icon: <Icon className="w-4 h-4" /> });
      }
      // Check children
      if (item.children) {
        item.children.forEach(child => {
          if (child.label.toLowerCase().includes(q)) {
            const ChildIcon = child.icon;
            results.push({ label: `${item.label} → ${child.label}`, path: child.path, icon: <ChildIcon className="w-4 h-4" /> });
          }
        });
      }
    });
    
    setSearchResults(results);
    setShowSearchResults(results.length > 0);
  };

  // Close search on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut: Ctrl+K to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector('#admin-search') as HTMLInputElement;
        input?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isActive = (path: string) => {
    if (path === '/admin' && currentPath === '/admin') return true;
    if (path !== '/admin' && currentPath.startsWith(path)) return true;
    return false;
  };

  return (
    <div className="flex min-h-screen bg-[#0F172A] text-slate-100">
      {/* Sidebar */}
      <aside
        className="w-72 sticky top-0 h-screen hidden lg:flex flex-col p-6 z-50"
        style={{
          background: 'rgba(30, 41, 59, 0.7)',
          backdropFilter: 'blur(16px)',
          borderRight: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        {/* Logo */}
        <Link to="/" className="block mb-10 px-2">
          <BrandLogo variant="wordmark" theme="inverse" className="h-9 w-auto max-w-full object-contain object-left" />
          <span className="mt-1 block text-[10px] uppercase tracking-widest text-emerald-100 font-bold">Admin Panel</span>
        </Link>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {visibleSidebarSections.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = expandedSections.has(item.id);
            
            // Check if any child is active
            const isChildActive = hasChildren && item.children!.some(child => {
              const childPath = child.path.split('?')[0];
              return currentPath.startsWith(childPath);
            });
            
            // For items with children, check if the parent path matches or any child is active
            const isSectionActive = item.path ? isActive(item.path) : isChildActive;

            if (hasChildren) {
              return (
                <div key={item.id}>
                  {/* Parent Button — toggles expand */}
                  <button
                    onClick={() => toggleSection(item.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all ${
                      isChildActive || isExpanded
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                    style={isChildActive || isExpanded ? { borderLeft: '3px solid #24ba35' } : {}}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      <span className="font-medium text-sm">{item.label}</span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-300 ${
                        isExpanded ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                  </button>
                  
                  {/* Sub-items with slide-down animation */}
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      isExpanded ? 'max-h-96 opacity-100 mt-1' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="ml-4 space-y-0.5 border-l border-white/5 pl-3">
                      {item.children!.map((child) => {
                        const isChildRouteActive = currentPath.startsWith(child.path.split('?')[0]);
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all text-sm ${
                              isChildRouteActive
                                ? 'bg-emerald-500/10 text-emerald-500 font-bold'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            <child.icon className="w-4 h-4" />
                            <span>{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            // Flat link item
            return (
              <Link
                key={item.id}
                to={item.path!}
                className={`flex items-center justify-between px-4 py-3 rounded-lg transition-all ${
                  isSectionActive
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
                style={isSectionActive ? { borderLeft: '3px solid #24ba35' } : {}}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* System Status Card */}
        <div className="mt-auto">
          <div className="p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">System Secure</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Platform monitoring active. All systems operational.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-20 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 border-b border-white/5 px-4 md:px-8 flex items-center justify-between">
          {/* Search */}
          <div className="flex items-center gap-4 w-1/2">
            <div ref={searchRef} className="relative w-full max-w-lg">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                id="admin-search"
                type="text"
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setShowSearchResults(true); }}
                placeholder="Search sections... (Ctrl+K)"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-800/50 rounded-xl border border-white/5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm text-slate-300"
              />
              {/* Search Results Dropdown */}
              {showSearchResults && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-2 bg-slate-800 rounded-xl border border-white/10 shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                  {searchResults.map((result, i) => (
                    <button
                      key={i}
                      onClick={() => { navigate(result.path); setShowSearchResults(false); setSearchQuery(''); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      {result.icon}
                      <span>{result.label}</span>
                      <ExternalLink className="w-3 h-3 ml-auto text-slate-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Actions — gap-4 on mobile: the Linux CI runner ships wider
              DejaVu fonts, and at 375px with gap-6 + px-8 this row measured
              287px wide starting at x=94, i.e. 6px past the viewport (the
              strict element audit flagged it on all 17 admin routes). */}
          <div className="flex items-center gap-3 md:gap-6">
            {/* Live Monitoring Badge */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 rounded-full border border-emerald-500/10">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Live Monitoring</span>
            </div>

            {/* The admin console is a permanently dark surface by design; the
                public site is light-only, so there is no theme switch here. */}

            {/* Notifications Panel - Real-time with Supabase */}
            <NotificationsPanel />

            <div className="hidden md:block h-8 w-px bg-white/5"></div>

            {/* User Menu */}
            <button className="flex items-center gap-3 pl-1 pr-3 py-1 hover:bg-white/5 rounded-full transition-all group">
              <div className="h-9 w-9 rounded-full overflow-hidden border-2 border-emerald-500/20 group-hover:border-emerald-500 transition-all">
                <div className="w-full h-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
                  {adminName.charAt(0).toUpperCase()}
                </div>
              </div>
              <div className="text-left hidden md:block">
                <p className="text-sm font-bold leading-tight">{adminName}</p>
                <p className="text-[10px] text-emerald-500 font-bold tracking-wide uppercase">Administrator</p>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-500" />
            </button>
            {/* Logout button - visible on hover */}
            <button
              onClick={() => void adminLogout()}
              className="p-2 hover:bg-red-500/10 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
              title="Logout from Admin"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-8 max-w-[100rem] mx-auto w-full">
          <Suspense fallback={<AdminDashboardFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Mobile Navigation Bar - Scrollable with all links */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-white/5 lg:hidden z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.5)]">
        <nav className="flex items-center overflow-x-auto px-3 py-1 gap-1 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <Link to="/admin" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin') && !isActive('/admin/users') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Dash</span>
          </Link>
          <Link to="/admin/users" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/users') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Users</span>
          </Link>
          <Link to="/admin/projects" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/projects') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <FolderKanban className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Projects</span>
          </Link>
          <Link to="/admin/contracts" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/contracts') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <Handshake className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Contracts</span>
          </Link>
          <Link to="/admin/payments" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/payments') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <Banknote className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Payments</span>
          </Link>
          <Link to="/admin/finance" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/finance') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <TrendingUp className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Finance</span>
          </Link>
          <Link to="/admin/withdrawals" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/withdrawals') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <Banknote className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Withdraw</span>
          </Link>
          <Link to="/admin/disputes" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/disputes') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <AlertOctagon className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Disputes</span>
          </Link>
          <Link to="/admin/subscriptions" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/subscriptions') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <Zap className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Config</span>
          </Link>
          <Link to="/admin/reports" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/reports') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <BarChart3 className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Reports</span>
          </Link>
          {isFeatureEnabled('internships') && (
            <Link to="/admin/internships" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/internships') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
              <Users className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase whitespace-nowrap">Internships</span>
            </Link>
          )}
          {isFeatureEnabled('certificates') && (
            <Link to="/admin/certificates" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/certificates') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
              <Award className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase whitespace-nowrap">Certificates</span>
            </Link>
          )}
          <Link to="/admin/identity-verification" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/identity-verification') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <ShieldCheck className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Verification</span>
          </Link>
          <Link to="/admin/support-tickets" className={`flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg shrink-0 ${isActive('/admin/support-tickets') ? 'text-emerald-500 bg-emerald-500/5' : 'text-slate-400'}`}>
            <AlertOctagon className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase whitespace-nowrap">Tickets</span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
