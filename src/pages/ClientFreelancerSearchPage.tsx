import { useState, useEffect, useCallback } from 'react';
import { Award, Bell, BellOff, ChevronDown, ChevronUp, Filter, Layers, Loader2, MapPin, MessageSquare, Plus, Search, Star, Trash2 } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/currency';
import { useCategories } from '../hooks/useCategories';
import { getSellerLevelBadgeProps } from '../lib/sellerLevels';
import { CategoriesSection } from '../components/CategoriesSection';
import { ProBadge } from '../components/ProBadge';
import { invitesService } from '../lib/dataService';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { safeLower } from '../utils/date';

interface FreelancerResult {
  id: string;
  user_id: string;
  title: string | null;
  bio: string | null;
  location: string | null;
  hourly_rate: number | null;
  experience: string | number | null;
  skills: string[];
  languages: string[];
  availability: boolean | null;
  rating: number | null;
  total_reviews: number | null;
  completion_rate: number | null;
  seller_level: string | null;
  verification_status: string | null;
  profile: { name: string | null; avatar: string | null; is_pro?: boolean; verification_status?: string | null } | null;
}

interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  notify_new_results: boolean;
  created_at: string;
}

export function ClientFreelancerSearchPage() {
  const { user } = useAuth();
  const [freelancers, setFreelancers] = useState<FreelancerResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [minRate, setMinRate] = useState('');
  const [maxRate, setMaxRate] = useState('');
  const [availabilityOnly, setAvailabilityOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'rating' | 'rate_low' | 'rate_high'>('relevance');
  const [showCategories, setShowCategories] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { flatNames: categories } = useCategories();
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Sync with the dashboard top-bar search: /client/find-talent?search=<term>
  // deep-links a search term into the talent search and re-seeds the box when
  // the user searches again from the header.
  useEffect(() => {
    const term = searchParams.get('search');
    if (term != null) setSearchQuery(term);
  }, [searchParams]);

  // ── Contact (invite) modal state ──
  const [contactFreelancer, setContactFreelancer] = useState<FreelancerResult | null>(null);
  const [clientProjects, setClientProjects] = useState<{ id: string; title: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [contactLoadingProjects, setContactLoadingProjects] = useState(false);

  const openContact = async (f: FreelancerResult) => {
    if (!user) {
      toast.info('Sign in required', 'Please sign in as a client to contact freelancers.');
      return;
    }
    setContactFreelancer(f);
    setSelectedProject('');
    setInviteMessage('');
    setContactLoadingProjects(true);
    try {
      const { data } = await supabase
        .from('projects')
        .select('id, title')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      setClientProjects((data || []).map(p => ({ id: p.id as string, title: p.title as string })));
      setSelectedProject((data && data[0]?.id) || '');
    } finally {
      setContactLoadingProjects(false);
    }
  };

  const handleSendInvite = async () => {
    if (!user || !contactFreelancer || !selectedProject) return;
    setSendingInvite(true);
    try {
      const ok = await invitesService.create(user.id, selectedProject, contactFreelancer.user_id, inviteMessage.trim() || undefined);
      if (ok) {
        toast.success('Invite sent!', `${contactFreelancer.profile?.name || 'Freelancer'} has been invited to your project.`);
        setContactFreelancer(null);
        setInviteMessage('');
      } else {
        toast.error('Failed', 'Could not send the invite. Please try again.');
      }
    } finally {
      setSendingInvite(false);
    }
  };

  const fetchFreelancers = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('freelancer_profiles')
        .select('id, user_id, title, bio, location, hourly_rate, experience, skills, languages, availability, rating, total_reviews, completion_rate, seller_level, verification_status, profile:profiles!freelancer_profiles_user_id_fkey(name, avatar, is_pro)')
        .not('user_id', 'is', null);

      if (minRate) query = query.gte('hourly_rate', Number(minRate));
      if (maxRate) query = query.lte('hourly_rate', Number(maxRate));
      if (availabilityOnly) query = query.eq('availability', true);

      switch (sortBy) {
        case 'relevance':
          // Fair, skills-relevant matching: verified freelancers first, then best rated
          query = query.order('verification_status', { ascending: false, nullsFirst: true });
          query = query.order('rating', { ascending: false, nullsFirst: false });
          break;
        case 'rating': query = query.order('rating', { ascending: false, nullsFirst: false }); break;
        case 'rate_low': query = query.order('hourly_rate', { ascending: true, nullsFirst: true }); break;
        case 'rate_high': query = query.order('hourly_rate', { ascending: false, nullsFirst: false }); break;
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;

      const userIds = (data || []).map((item) => (item as { user_id: string }).user_id).filter(Boolean);
      const { data: profileStatuses } = userIds.length > 0
        ? await supabase.from('profiles').select('id, verification_status').in('id', userIds)
        : { data: [] as { id: string; verification_status: string | null }[] };
      const statusByUserId = new Map((profileStatuses || []).map((item) => [item.id, item.verification_status]));

      let results = (data || []).map((item) => {
        const freelancer = item as unknown as FreelancerResult;
        const profileStatus = statusByUserId.get(freelancer.user_id);
        return {
          ...freelancer,
          verification_status: freelancer.verification_status === 'verified' || profileStatus === 'verified'
            ? 'verified'
            : freelancer.verification_status ?? profileStatus ?? null,
        };
      });

      if (searchQuery) {
        const q = safeLower(searchQuery);
        results = results.filter((f) =>
          safeLower(f.title).includes(q) ||
          safeLower(f.bio).includes(q) ||
          safeLower(f.profile?.name).includes(q) ||
          (f.skills?.some((s) => safeLower(s).includes(q)) ?? false)
        );
      }

      if (selectedCategory !== 'All') {
        results = results.filter((f) =>
          (f.skills?.some((s) => safeLower(s).includes(safeLower(selectedCategory))) ?? false) ||
          safeLower(f.title).includes(safeLower(selectedCategory))
        );
      }

      setFreelancers(results);
    } catch (err) {
      toast.error('Error', 'Failed to load freelancers.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedCategory, minRate, maxRate, availabilityOnly, sortBy, toast]);

  useEffect(() => { fetchFreelancers(); }, [fetchFreelancers]);

  // ── Realtime: new/updated freelancer profiles appear live ────────────────
  // Mirrors the freelancer feed. When a freelancer completes their profile
  // (or updates skills/rates/availability), the search list refreshes
  // instantly — no manual reload needed.
  useEffect(() => {
    const channel = supabase
      .channel('client-freelancer-search')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'freelancer_profiles' },
        () => {
          void fetchFreelancers();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        () => {
          void fetchFreelancers();
        }
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [fetchFreelancers]);

  useEffect(() => {
    if (!user) return;
    const fetchSaved = async () => {
      const { data } = await supabase
        .from('saved_searches')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (data) setSavedSearches(data as unknown as SavedSearch[]);
    };
    fetchSaved();
  }, [user]);

  const handleSaveSearch = async () => {
    if (!user || !saveName.trim()) return;
    const filters = { searchQuery, selectedCategory, minRate, maxRate, availabilityOnly, sortBy };
    await supabase.from('saved_searches').insert({
      user_id: user.id,
      name: saveName.trim(),
      filters,
      notify_new_results: true,
    });
    setShowSaveModal(false);
    setSaveName('');
    // Refresh
    const { data } = await supabase.from('saved_searches').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (data) setSavedSearches(data as unknown as SavedSearch[]);
  };

  const handleDeleteSaved = async (id: string) => {
    await supabase.from('saved_searches').delete().eq('id', id);
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
  };

  const handleToggleNotify = async (search: SavedSearch) => {
    await supabase.from('saved_searches').update({ notify_new_results: !search.notify_new_results }).eq('id', search.id);
    setSavedSearches((prev) => prev.map((s) => s.id === search.id ? { ...s, notify_new_results: !s.notify_new_results } : s));
  };

  const loadSavedSearch = (search: SavedSearch) => {
    const f = search.filters as Record<string, unknown>;
    setSearchQuery((f.searchQuery as string) || '');
    setSelectedCategory((f.selectedCategory as string) || 'All');
    setMinRate((f.minRate as string) || '');
    setMaxRate((f.maxRate as string) || '');
    setAvailabilityOnly((f.availabilityOnly as boolean) || false);
    setSortBy((f.sortBy as typeof sortBy) || 'rating');
  };

  const getSellerLevelBadge = (level: string | null) => {
    if (!level) return null;
    const props = getSellerLevelBadgeProps(level as any);
    return (
      <span className={props.className}>
        <Award className="w-4 h-4" />
        {props.label}
      </span>
    );
  };

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Find Talent <InfoTip title="Verified & Pro badges" text="Verified and Pro badges show real, checked freelancers — contact them here and hiring happens only inside Growlanzo, with escrow protection on every payment." /></h1>
          <p className="text-slate-500 mt-1">Search and hire skilled freelancers for your projects</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowFilters(!showFilters)} className="inline-flex items-center justify-center gap-3 px-4 py-2.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
            <Filter className="w-4 h-4" /> Filters
          </button>
          <button onClick={() => setShowSaveModal(true)} className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors">
            <Plus className="w-4 h-4" /> Save Search
          </button>
        </div>
      </div>

      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {savedSearches.map((search) => (
            <div key={search.id} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm flex-shrink-0">
              <button onClick={() => loadSavedSearch(search)} className="font-medium text-slate-700 hover:text-emerald-600 transition-colors">{search.name}</button>
              <button onClick={() => handleToggleNotify(search)} className="p-1 text-slate-400 hover:text-emerald-600" title={search.notify_new_results ? 'Notifications on' : 'Notifications off'}>
                {search.notify_new_results ? <Bell className="w-4 h-4 text-emerald-500" /> : <BellOff className="w-4 h-4" />}
              </button>
              <button onClick={() => handleDeleteSaved(search.id)} aria-label="Delete saved search" className="p-1 text-slate-400 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Browse Categories - A-Z Accordion */}
      <div className="bg-white rounded-xl border border-slate-100">
        <button
          onClick={() => setShowCategories(!showCategories)}
          className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Layers className="w-4 h-4 text-emerald-600" />
            <span className="font-bold text-slate-900">Browse Categories</span>
            <span className="text-xs text-slate-400 font-medium">A-Z</span>
          </div>
          {showCategories ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
          showCategories ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}>
          <div className="px-4 pb-4 border-t border-slate-50">
            <CategoriesSection mode="browse" maxInitial={0} />
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex gap-1.5">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="Search freelancers by name, skill, or title" placeholder="Search by name, skill, or title..." className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="All">All Categories</option>
              {categories.map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
            </select>
            <input type="number" value={minRate} onChange={(e) => setMinRate(e.target.value)} placeholder="Min" className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <input type="number" value={maxRate} onChange={(e) => setMaxRate(e.target.value)} placeholder="Max" className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <label className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
              <input type="checkbox" checked={availabilityOnly} onChange={(e) => setAvailabilityOnly(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-emerald-600" />
              <span className="text-sm font-medium text-slate-700">Available Now</span>
            </label>
          </div>
        </div>
      )}

      {/* Sort & Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{loading ? 'Searching...' : `${freelancers.length} freelancer${freelancers.length !== 1 ? 's' : ''} found`}</p>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="relevance">Best Match (Verified First)</option>
          <option value="rating">Best Rating</option>
          <option value="rate_low">Base Rate: Low to High</option>
          <option value="rate_high">Base Rate: High to Low</option>
        </select>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>
      ) : freelancers.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100">
          <EmptyState
            icon={<Search className="w-10 h-10" />}
            title="No freelancers found"
            description="Try adjusting your filters."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {freelancers.map((f) => (
            <div key={f.id} className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-start gap-1.5 mb-3">
                <div className="w-8 h-8 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                  {f.profile?.avatar ? <img src={f.profile.avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-slate-400">{(f.profile?.name || f.title || 'U')[0]}</div>}
                </div>
                <div className="flex-1 min-w-0 break-words">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                      {f.profile?.name || f.title || 'Freelancer'}
                      {f.profile?.is_pro && <ProBadge size="xs" />}
                                          </h3>
                    {f.availability && <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-full"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />Available</span>}
                  </div>
                  {f.title && <p className="text-sm text-slate-500">{f.title}</p>}
                </div>
              </div>
              {f.seller_level && <div className="mb-2">{getSellerLevelBadge(f.seller_level)}</div>}
              <div className="flex items-center gap-1.5 text-sm mb-3">
                {f.rating && f.rating > 0 ? <span className="flex items-center gap-1 font-semibold"><Star className="w-4 h-4 text-amber-400 fill-amber-400" />{f.rating.toFixed(1)}<span className="text-slate-400 font-normal">({f.total_reviews || 0})</span></span> : <span className="text-slate-400 text-xs">New</span>}
                {f.completion_rate != null && <span className="flex items-center gap-1 text-slate-500"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />{f.completion_rate}% completion</span>}
              </div>
              {f.skills && f.skills.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {f.skills.slice(0, 3).map((s) => <span key={s} className="px-2 py-0.5 bg-slate-50 text-slate-600 text-xs rounded-lg">{s}</span>)}
                  {f.skills.length > 3 && <span className="text-xs text-slate-400">+{f.skills.length - 3}</span>}
                </div>
              )}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="flex items-center gap-1 text-xs text-slate-500">{f.location && <><MapPin className="w-4 h-4" />{f.location}</>}</span>
                {f.hourly_rate && <span className="text-xl font-bold text-emerald-600">{formatCurrency(Number(f.hourly_rate))}</span>}
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => navigate(`/freelancer/${f.user_id}`)}
                  className="flex-1 px-3 py-2 text-xs font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  View Profile
                </button>
                <button
                  onClick={() => void openContact(f)}
                  className="flex-1 px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <MessageSquare className="w-4 h-4" />
                  Contact
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contact (Invite) Modal */}
      {contactFreelancer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setContactFreelancer(null)}>
          <div className="bg-white rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-slate-900 mb-1">Contact {contactFreelancer.profile?.name || 'Freelancer'}</h3>
            <p className="text-sm text-slate-500 mb-2">Send a project invite — they'll respond in real time.</p>

            {contactLoadingProjects ? (
              <div className="py-4 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              </div>
            ) : clientProjects.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 mb-2">
                You need a posted project to invite a freelancer.{' '}
                <button onClick={() => navigate('/client/post')} className="font-semibold underline">Post a project</button> first.
              </div>
            ) : (
              <>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Project</label>
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {clientProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Message (optional)</label>
                <textarea
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Why do you want to work with them?"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </>
            )}

            <div className="flex gap-1.5">
              <button onClick={() => setContactFreelancer(null)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button
                onClick={handleSendInvite}
                disabled={!selectedProject || sendingInvite || contactLoadingProjects}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {sendingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Search Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSaveModal(false)}>
          <div className="bg-white rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Save This Search</h3>
            <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. React developers under 500" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <div className="flex gap-1.5">
              <button onClick={() => setShowSaveModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={handleSaveSearch} disabled={!saveName.trim()} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">Save Search</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
