import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Award,
  BadgeCheck,
  Briefcase,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  Eye,
  ExternalLink,
  Image as ImageIcon,
  IndianRupee,
  Loader2,
  MapPin,
  MessageSquare,
  Package,
  Share2,
  Star,
  Users,
  X,
} from 'lucide-react';
import { supabase, realtimeChannels } from '../lib/supabase';
import { portfolioService } from '../lib/portfolio';
import { reviewService } from '../lib/reviews';
import { useToast } from '../components/Toast';
import { ProBadge } from '../components/ProBadge';
import { InfoTip } from '../components/InfoTip';
import { invitesService } from '../lib/dataService';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../utils/date';
import { isValidUuid } from '../utils/validation';
import { serviceFromPrice } from '../lib/servicePricing';
import {
  isProSubscription,
  subscriptionService,
} from '../lib/subscriptionHelpers';

interface FreelancerProfile {
  id: string;
  user_id: string;
  location: string | null;
  title: string | null;
  bio: string | null;
  hourly_rate: number | null;
  experience: string | number | null;
  skills: string[];
  languages: string[];
  education: string[] | string | null;
  certifications: string[];
  portfolio_url: string | null;
  availability: boolean | string | null;
  created_at: string;
  // Name + avatar + pro flag live on `profiles`, not `freelancer_profiles`
  profile?: { name: string | null; avatar: string | null; is_pro?: boolean } | null;
  // KYC status lives on `freelancer_profiles` (the `*` select) — 'verified' shows the green badge
  verification_status?: string | null;
}

interface PortfolioItem {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  tags: string[];
  is_featured: boolean;
}

interface ReviewData {
  id: string;
  reviewer: { name: string | null; avatar: string | null };
  // The reviews table stores the overall score in `rating` (there is NO
  // `overall_rating` column) — reading the wrong field made every star render
  // white (NaN). Sub-ratings are separate columns.
  rating: number;
  overall_rating?: number;
  communication_rating: number;
  quality_rating: number;
  timeliness_rating: number;
  professionalism_rating: number;
  review_text: string | null;
  created_at: string;
}

interface FreelancerService {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  price: number;
  packages?: unknown;
  delivery_days: number | null;
  revisions: number | null;
  extra_revision_price?: number | null;
  tags: string[];
  active: boolean;
}

const formatExperience = (experience: string | number | null | undefined): string => {
  if (experience === null || experience === undefined || experience === '') return 'N/A';
  const n = typeof experience === 'number' ? experience : Number(experience);
  if (!isNaN(n)) {
    return `${n}${n === 1 ? ' yr' : ' yrs'}`;
  }
  return String(experience).trim() || 'N/A';
};

export function PublicFreelancerProfilePage() {
  const { freelancerId } = useParams<{ freelancerId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<FreelancerProfile | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [services, setServices] = useState<FreelancerService[]>([]);
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [profileViews, setProfileViews] = useState(0);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'services' | 'portfolio' | 'reviews' | 'about'>('services');
  const [isProFreelancer, setIsProFreelancer] = useState(false);

  // Contact (client invite) modal state
  const [contactOpen, setContactOpen] = useState(false);
  const [clientProjects, setClientProjects] = useState<{ id: string; title: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  const profileKey = profile?.user_id || freelancerId || null;  // Load the running view count on every visit + record one view per session
  useEffect(() => {
    if (!profileKey || !profile) return;

    const loadCount = async () => {
      try {
        const { data: total } = await (supabase.rpc as any)('get_profile_views', {
          p_user_id: profileKey,
        });
        if (typeof total === 'number') setProfileViews(total);
      } catch {
        // Count read failed silently — counter stays 0
      }
    };
    void loadCount();

    // Skip recording views of your own profile
    if (user?.id === profile.user_id) return;

    const sessionKey = `gw_profile_view:${profileKey}`;
    if (sessionStorage.getItem(sessionKey)) return;

    const record = async () => {
      try {
        const { data: total } = await (supabase.rpc as any)('record_profile_view', {
          p_user_id: profileKey,
        });
        if (typeof total === 'number') setProfileViews(total);
        sessionStorage.setItem(sessionKey, '1');
      } catch (error) {
        console.error('Error recording profile view:', error);
      }
    };
    void record();
  }, [profileKey, profile, user?.id]);

  useEffect(() => {
    if (!freelancerId) return;

    // 🛡️ Reject malformed ids before any query: both `user_id` and `id` are
    // uuid columns, so Postgres answers a non-UUID with HTTP 400 ("invalid
    // input syntax for type uuid") and the browser logs a red
    // "Failed to load resource: 400" on a visit that is really just a 404.
    if (!isValidUuid(freelancerId)) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      setLoading(true);
      try {
        // freelancer_profiles has BOTH an `id` (its own PK) and a `user_id`
        // (the auth user id). Routes pass the USER id (proposal.freelancer_id),
        // so we must query by user_id first — querying by id returns 0 rows and
        // throws "Profile Not Found". Fall back to id for old-style links.
        const { data: byUser, error: byUserErr } = await supabase
          .from('freelancer_profiles')
          .select('*, profile:profiles!freelancer_profiles_user_id_fkey(name, avatar, is_pro)')
          .eq('user_id', freelancerId)
          .maybeSingle();

        let profileData = byUser;
        if (!profileData && byUserErr && byUserErr.code !== 'PGRST116') {
          throw byUserErr;
        }
        if (!profileData) {
          const { data: byId, error: byIdErr } = await supabase
            .from('freelancer_profiles')
            .select('*, profile:profiles!freelancer_profiles_user_id_fkey(name, avatar, is_pro)')
            .eq('id', freelancerId)
            .maybeSingle();
          if (byIdErr && byIdErr.code !== 'PGRST116') throw byIdErr;
          profileData = byId;
        }

        if (!profileData) {
          setProfile(null);
          return;
        }
        setProfile(profileData as unknown as FreelancerProfile);

        // Fetch portfolio + reviews + services keyed by the freelancer's USER id
        const userKey = profileData.user_id || freelancerId;

        // PRO badge — active/trial subscription OR the profiles.is_pro flag
        // (flag is what the rest of the platform renders from, so keep both in sync)
        const subRes = await subscriptionService.getCurrentSubscription(userKey);
        const profileIsPro = Boolean((profileData as unknown as FreelancerProfile).profile?.is_pro);
        setIsProFreelancer(isProSubscription(subRes.subscription) || profileIsPro);

        const [portfolioItems, reviewsResult, servicesResult] = await Promise.all([
          portfolioService.getByUser(userKey),
          reviewService.getUserReviews(userKey),
          supabase
            .from('services')
            .select('id, title, description, category, image_url, price, packages, delivery_days, revisions, extra_revision_price, tags, active')
            .eq('freelancer_id', userKey)
            // `status` is the source of truth (matches the detail page) — the
            // old `active`-only filter showed services the freelancer had
            // deactivated (the dashboard toggle writes only `status`).
            .eq('status', 'active')
            .order('created_at', { ascending: false }),
        ]);

        setPortfolio(portfolioItems as unknown as PortfolioItem[]);
        setReviews(reviewsResult.reviews as unknown as ReviewData[]);
        setAverageRating(reviewsResult.average_rating);
        setTotalReviews(reviewsResult.total_reviews);
        setServices((servicesResult.data || []) as unknown as FreelancerService[]);
      } catch (err) {
        toast.error('Error', 'Failed to load freelancer profile.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [freelancerId, toast]);

  // Keep the public badge and profile header in sync with KYC/profile changes.
  useEffect(() => {
    if (!profileKey) return;

    const channel = supabase
      .channel(`public-profile-verification-${profileKey}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'freelancer_profiles',
        filter: `user_id=eq.${profileKey}`,
      }, (payload) => {
        setProfile((current) => current
          ? { ...current, ...(payload.new as Partial<FreelancerProfile>) }
          : current);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${profileKey}`,
      }, (payload) => {
        const next = payload.new as { name?: string | null; avatar?: string | null; is_pro?: boolean | null; verification_status?: string | null };
        setProfile((current) => current
          ? {
              ...current,
              verification_status: next.verification_status ?? current.verification_status,
              profile: current.profile
                ? { ...current.profile, name: next.name ?? current.profile.name, avatar: next.avatar ?? current.profile.avatar, is_pro: next.is_pro ?? current.profile.is_pro }
                : current.profile,
            }
          : current);
        if (typeof next.is_pro === 'boolean') setIsProFreelancer(next.is_pro);
      })
      .subscribe();

    return () => { void channel.unsubscribe(); };
  }, [profileKey]);

  // Real-time services sync (services are the freelancer's live offerings)
  useEffect(() => {
    if (!profileKey) return;

    let channel: { unsubscribe?: () => void } | null = null;
    try {
      channel = realtimeChannels.services(`public-profile-${profileKey}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'services',
          filter: `freelancer_id=eq.${profileKey}`,
        }, (payload) => {
          const record = payload.new as { active?: boolean; id?: string } | null;
          if (payload.eventType === 'INSERT' && record?.active) {
            // Dedup by id — realtime can deliver the same INSERT twice;
            // never render duplicate services on the public profile.
            setServices(prev =>
              prev.some(s => s.id === record.id)
                ? prev
                : [record as unknown as FreelancerService, ...prev]
            );
          } else if (payload.eventType === 'UPDATE' && record) {
            if (record.active) {
              setServices(prev => {
                const exists = prev.some(s => s.id === record.id);
                return exists
                  ? prev.map(s => (s.id === record.id ? (record as unknown as FreelancerService) : s))
                  : [record as unknown as FreelancerService, ...prev];
              });
            } else {
              setServices(prev => prev.filter(s => s.id !== record.id));
            }
          } else if (payload.eventType === 'DELETE') {
            setServices(prev => prev.filter(s => s.id !== (payload.old as { id?: string } | null)?.id));
          }
        })
        .subscribe();
    } catch (error) {
      console.error('Error subscribing to services:', error);
    }

    return () => {
      if (channel?.unsubscribe) {
        try { channel.unsubscribe(); } catch { /* ignore */ }
      }
    };
  }, [profileKey]);

  // Real-time reviews sync — new reviews appear instantly without refresh
  useEffect(() => {
    if (!profileKey) return;

    const loadReviews = async () => {
      try {
        const result = await reviewService.getUserReviews(profileKey);
        setReviews(result.reviews as unknown as ReviewData[]);
        setAverageRating(result.average_rating);
        setTotalReviews(result.total_reviews);
      } catch { /* keep last data */ }
    };

    let channel: { unsubscribe?: () => void } | null = null;
    try {
      channel = supabase
        .channel(`public-profile-reviews-${profileKey}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'reviews',
          filter: `reviewee_id=eq.${profileKey}`,
        }, () => { void loadReviews(); })
        .subscribe();
    } catch (error) {
      console.error('Error subscribing to reviews:', error);
    }

    return () => {
      if (channel?.unsubscribe) {
        try { channel.unsubscribe(); } catch { /* ignore */ }
      }
    };
  }, [profileKey]);

  // Load client projects for the invite (Contact) flow
  const openContact = useCallback(() => {
    if (!user) {
      toast.info('Login required', 'Please log in as a client to contact freelancers.');
      navigate('/login');
      return;
    }
    if (user.role === 'client') {
      void (async () => {
        const { data } = await supabase
          .from('projects')
          .select('id, title')
          .eq('client_id', user.id)
          .order('created_at', { ascending: false });
        setClientProjects((data || []).map(p => ({ id: p.id as string, title: p.title as string })));
        setSelectedProject((data && data[0]?.id) || '');
        setContactOpen(true);
      })();
    } else {
      toast.info('Invite only', 'Clients can invite freelancers from a posted project.');
    }
  }, [user, navigate, toast]);

  const handleSendInvite = async () => {
    if (!user || !profileKey || !selectedProject) return;
    setSendingInvite(true);
    try {
      const ok = await invitesService.create(user.id, selectedProject, profileKey, inviteMessage.trim() || undefined);
      if (ok) {
        toast.success('Invite sent!', `${profile?.profile?.name || 'Freelancer'} has been invited to your project.`);
        setContactOpen(false);
        setInviteMessage('');
      } else {
        toast.error('Failed', 'Could not send the invite. Please try again.');
      }
    } finally {
      setSendingInvite(false);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile?.profile?.name || 'Freelancer'} on Growlanzo`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied!', 'Profile link copied to clipboard.');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied!', 'Profile link copied to clipboard.');
      } catch {
        toast.error('Share failed', 'Could not share the profile link.');
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Profile Not Found</h2>
          <p className="text-slate-500 mb-3">This freelancer profile doesn't exist or has been removed.</p>
          <Link to="/" className="inline-flex items-center min-h-[44px] px-2 text-emerald-600 hover:underline font-medium">Go Home</Link>
        </div>
      </div>
    );
  }

  const formatRating = (rating: number) => rating.toFixed(1);

  // Name + avatar come from the joined `profiles` row (not freelancer_profiles)
  const displayName = profile.profile?.name || 'Freelancer';
  const avatarUrl = profile.profile?.avatar || null;
  const initial = (profile.profile?.name || 'U')[0];
  const availabilityLabel =
    typeof profile.availability === 'boolean'
      ? (profile.availability ? 'Available' : 'Unavailable')
      : (profile.availability ? String(profile.availability) : null);

  const RatingStars = ({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) => {
    // Defensive — a missing/NaN rating must not blank the stars to white
    const safeRating = Number(rating) || 0;
    return (
      <div className={`flex gap-0.5 ${size === 'md' ? 'text-lg' : 'text-sm'}`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`${
              star <= Math.round(safeRating) ? 'text-amber-400 fill-amber-400' : 'text-slate-300'
            } ${size === 'md' ? 'w-5 h-5' : 'w-4 h-4'}`}
          />
        ))}
      </div>
    );
  };

  const heroStats = [
    { icon: Package, label: 'Services', value: String(services.length) },
    { icon: Briefcase, label: 'Experience', value: formatExperience(profile.experience) },
    { icon: CheckCircle, label: 'Skills', value: String(profile.skills?.length || 0) },
    { icon: Award, label: 'Certifications', value: String(profile.certifications?.length || 0) },
    { icon: Users, label: 'Languages', value: String(profile.languages?.length || 0) },
  ];

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 text-white overflow-hidden">
        {/* Decorative glow */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-16 w-80 h-80 bg-teal-300/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden bg-white/20 ring-4 ring-white/30 shadow-xl">
                {/* Letter fallback always behind the image */}
                <div className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-white/60">
                  {initial}
                </div>
                {avatarUrl && (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
              </div>
              {isProFreelancer && (
                <div className="absolute -bottom-2 -right-2 w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-lg">
                  <BadgeCheck className="w-6 h-6 text-blue-600" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="text-center sm:text-left flex-1">
              <h1 className="font-display text-3xl sm:text-4xl font-bold flex items-center gap-3.5 flex-wrap justify-center sm:justify-start">
                {displayName}
                                {isProFreelancer && <ProBadge size="md" />}
              </h1>
              {profile.title && (
                <p className="text-lg text-white/80 mt-1">{profile.title}</p>
              )}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-3 text-sm text-white/70">
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {profile.location}
                  </span>
                )}
                {profile.hourly_rate && (
                  <span className="flex items-center gap-1 font-medium text-white/90">
                    <IndianRupee className="w-4 h-4" />
                    {profile.hourly_rate}
                  </span>
                )}
                {availabilityLabel && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {availabilityLabel}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Member since {new Date(profile.created_at).getFullYear()}
                </span>
                <span className="flex items-center gap-1">
                  <Eye className="w-4 h-4" />
                  {profileViews.toLocaleString('en-IN')} profile views
                </span>
              </div>

              {totalReviews > 0 && (
                <div className="flex items-center justify-center sm:justify-start gap-3 mt-3">
                  <RatingStars rating={averageRating} />
                  <span className="text-white/90 font-medium">{formatRating(averageRating)}</span>
                  <span className="text-white/60">({totalReviews} reviews)</span>
                  <InfoTip
                    text="Ratings come only from completed contracts — clients rate quality, communication, timeliness and professionalism. New reviews appear here in real time."
                    title="Ratings & Reviews"
                    align="left"
                    tone="emerald"
                    className="[&_svg]:text-white/70 [&_svg]:hover:text-white"
                  />
                </div>
              )}
            </div>

            {/* CTA Buttons */}
            <div className="flex gap-3.5">
              <button
                onClick={openContact}
                className="flex items-center gap-3 px-5 py-2.5 bg-white text-emerald-700 rounded-xl hover:bg-emerald-50 transition-colors font-semibold shadow-sm"
              >
                <MessageSquare className="w-4 h-4" />
                Contact
              </button>
              <button
                onClick={handleShare}
                className="p-2.5 bg-white/20 rounded-xl hover:bg-white/30 transition-colors"
                title="Share profile"
                aria-label="Share profile"
              >
                <Share2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-3 mt-8">
            {heroStats.map((stat, idx) => (
              <div key={idx} className="bg-white/10 rounded-xl p-4 text-center backdrop-blur-sm border border-white/10 hover:bg-white/15 transition-colors">
                <stat.icon className="w-5 h-5 mx-auto mb-1.5 opacity-80" />
                <p className="text-lg font-bold">{stat.value}</p>
                <p className="text-xs text-white/60">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 py-4">
        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-200 mb-2 overflow-x-auto">
          {[
            { id: 'services' as const, label: 'Services', count: services.length },
            { id: 'portfolio' as const, label: 'Portfolio', count: portfolio.length },
            { id: 'reviews' as const, label: 'Reviews', count: totalReviews },
            { id: 'about' as const, label: 'About' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'border-emerald-600 text-emerald-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'services' && (
          <div>
            {services.length === 0 ? (
              <div className="text-center py-8">
                <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No services offered yet</p>
                <p className="text-xs text-slate-400 mt-1">This freelancer hasn't published any services</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {services.map((service) => (
                  <Link
                    key={service.id}
                    to={`/services/${service.id}`}
                    className="group bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                  >
                    {service.image_url && (
                      <div className="aspect-video bg-slate-50 overflow-hidden">
                        <img
                          src={service.image_url}
                          alt={service.title}
                          className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="p-2.5 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 transition-colors">
                          <Package className="w-5 h-5 text-emerald-600" />
                        </div>
                        {service.category && (
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-bold uppercase tracking-wider rounded-full">
                            {service.category}
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-slate-900 mt-3 group-hover:text-emerald-700 transition-colors line-clamp-2">
                        {service.title}
                      </h3>
                      {service.description && (
                        <p className="text-sm text-slate-500 mt-1.5 line-clamp-2">{service.description}</p>
                      )}
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-50">
                        <div>
                          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">From</p>
                          <p className="font-bold text-emerald-700 text-lg">
                            {formatCurrency(serviceFromPrice(service))}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          {service.delivery_days ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {service.delivery_days} days
                            </span>
                          ) : null}
                          {service.revisions ? (
                            <span className="flex items-center gap-1">
                              <CheckCircle className="w-4 h-4" />
                              {service.revisions} free rev
                            </span>
                          ) : null}
                          {Number(service.extra_revision_price) > 0 ? (
                            <span className="flex items-center gap-1 text-amber-600">
                              <CheckCircle className="w-4 h-4" />
                              +{formatCurrency(Number(service.extra_revision_price))}/extra
                            </span>
                          ) : null}
                          <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div>
            {portfolio.length === 0 ? (
              <div className="text-center py-8">
                <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No portfolio items yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {portfolio.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="aspect-video bg-slate-50">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.title} className="w-full h-full object-contain p-2" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-10 h-10 text-slate-300" />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-slate-900">{item.title}</h3>
                      {item.description && (
                        <p className="text-sm text-slate-500 mt-1 line-clamp-2">{item.description}</p>
                      )}
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="px-2 py-0.5 bg-slate-50 text-slate-600 text-xs rounded-md">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'reviews' && (
          <div>
            {reviews.length === 0 ? (
              <div className="text-center py-8">
                <Star className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No reviews yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {reviews.map((review) => (
                  <div key={review.id} className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-sm font-medium text-slate-600 flex-shrink-0">
                        {review.reviewer?.avatar ? (
                          <img src={review.reviewer.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          (review.reviewer?.name || 'U')[0]
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-slate-900">{review.reviewer?.name || 'Client'}</p>
                          <span className="text-xs text-slate-400">
                            {new Date(review.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <RatingStars rating={review.rating ?? review.overall_rating ?? 0} size="sm" />
                        {review.review_text && (
                          <p className="text-sm text-slate-600 mt-2">{review.review_text}</p>
                        )}
                        <div className="flex gap-3 mt-2 text-xs text-slate-400">
                          <span>Quality: {review.quality_rating}/5</span>
                          <span>Communication: {review.communication_rating}/5</span>
                          <span>Timeliness: {review.timeliness_rating}/5</span>
                          <span>Professionalism: {review.professionalism_rating}/5</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'about' && (
          <div className="max-w-3xl space-y-3">
            {/* Bio */}
            {profile.bio && (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3">About</h2>
                <p className="text-slate-600 whitespace-pre-wrap">{profile.bio}</p>
              </div>
            )}

            {/* Skills */}
            {profile.skills && profile.skills.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Skills</h2>
                <div className="flex flex-wrap gap-3">
                  {profile.skills.map((skill) => (
                    <span
                      key={skill}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Languages */}
            {profile.languages && profile.languages.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Languages</h2>
                <div className="flex flex-wrap gap-3">
                  {profile.languages.map((lang) => (
                    <span key={lang} className="px-3 py-1.5 bg-slate-50 text-slate-700 text-sm rounded-lg">
                      {lang}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Education — can be an array or a single text string in the DB */}
            {profile.education && (Array.isArray(profile.education) ? profile.education.length > 0 : profile.education.trim()) && (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Education</h2>
                {Array.isArray(profile.education) ? (
                  <ul className="space-y-4">
                    {profile.education.map((edu, idx) => (
                      <li key={idx} className="flex items-start gap-3 text-slate-600">
                        <ChevronRight className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        {edu}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-600 whitespace-pre-wrap">{profile.education}</p>
                )}
              </div>
            )}

            {/* Certifications */}
            {profile.certifications && profile.certifications.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Certifications</h2>
                <div className="flex flex-wrap gap-3">
                  {profile.certifications.map((cert) => (
                    <span
                      key={cert}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 text-sm rounded-lg"
                    >
                      <Award className="w-4 h-4" />
                      {cert}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contact Modal (client invite flow) */}
      {contactOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setContactOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-3 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg font-bold text-slate-400">{initial}</span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                    Contact {displayName}
                    {isProFreelancer && <ProBadge size="xs" />}
                  </h3>
                  <p className="text-xs text-slate-500">Send a project invitation</p>
                </div>
              </div>
              <button
                onClick={() => setContactOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {clientProjects.length === 0 ? (
              <div className="text-center py-6">
                <Briefcase className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 mb-2">
                  You need an active project to invite {displayName}. Post a project first.
                </p>
                <Link
                  to="/client/post"
                  onClick={() => setContactOpen(false)}
                  className="inline-flex items-center gap-3 px-4 py-2 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                >
                  Post a Project
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Select project</label>
                  <select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border-0 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/30 outline-none transition-all"
                  >
                    {clientProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Message <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={inviteMessage}
                    onChange={(e) => setInviteMessage(e.target.value)}
                    rows={3}
                    placeholder={`Tell ${displayName} about your project...`}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border-0 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/30 outline-none transition-all resize-none"
                  />
                </div>
                <button
                  onClick={handleSendInvite}
                  disabled={sendingInvite || !selectedProject}
                  className="w-full inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sendingInvite ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4" />
                  )}
                  Send Invite
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
