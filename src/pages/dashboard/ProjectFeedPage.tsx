import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCategories } from '../../hooks/useCategories';
import { ArrowRight, Briefcase, CheckCircle2, Clock, Loader2, Search, Send, Sparkles, Star, Wallet, X, Zap } from 'lucide-react';
import { InfoTip } from '../../components/InfoTip';
import { useToast } from '../../components/Toast';
import { formatBudgetRange, safeLower } from '../../utils/date';
import { formatCurrency, currencySymbol } from '../../lib/currency';
import { Pagination } from '../../components/Pagination';
import { PageSkeleton } from '../../components/PageSkeleton';
import AIGenerateModal from '../../components/AIGenerateModal';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { notifyProposalSubmitted } from '../../lib/workflowService';
import type { Tables } from '../../types/supabase';

interface AIMatchRow {
  id: string;
  freelancer_id: string;
  project_id: string;
  match_score: number | null;
  skill_score: number | null;
  experience_score: number | null;
  budget_score: number | null;
  availability_score: number | null;
  completion_score: number | null;
  created_at: string | null;
}

type MatchWithProject = AIMatchRow & {
  project: Tables<'projects'> & {
    client: Tables<'profiles'>;
  };
};

interface ProposalModalProps {
  project: Tables<'projects'> | null;
  freelancerRate: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (proposal: { message: string; estimated_duration: number; proposed_rate: number; rate_type: string }) => void;
  isSubmitting: boolean;
}

function ProposalModal({ project, freelancerRate, isOpen, onClose, onSubmit, isSubmitting }: ProposalModalProps) {
  const [message, setMessage] = useState('');
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [proposedRate, setProposedRate] = useState(freelancerRate?.toString() || '');

  // ── Smart pricing — fair for both sides ──────────────────────────────────
  // Compare the freelancer's fixed project bid against the client's single
  // budget. Suggestions never push a deal below 60% of the freelancer's base
  // rate — so neither the freelancer nor the client loses.
  const clientBudget = project?.budget_max || 0;
  const baseRate = freelancerRate || 0;
  const parsedProposed = parseFloat(proposedRate) || 0;

  const suggestedTotal = (() => {
    if (clientBudget <= 0) return baseRate;
    if (baseRate <= 0) return clientBudget;
    if (baseRate <= clientBudget) return baseRate;
    return Math.max(Math.round(baseRate * 0.6), clientBudget);
  })();

  const withinBudget = clientBudget > 0 && parsedProposed > 0 && parsedProposed <= clientBudget;
  const aboveBudget = clientBudget > 0 && parsedProposed > clientBudget;
  const baseFitsBudget = clientBudget > 0 && baseRate > 0 && baseRate <= clientBudget;
  const budgetWayBelowBase = clientBudget > 0 && baseRate > 0 && clientBudget < Math.round(baseRate * 0.6);

  if (!isOpen || !project) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      message,
      estimated_duration: parseInt(estimatedDuration),
      proposed_rate: parseFloat(proposedRate),
      rate_type: 'fixed',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Send className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900">Apply for Project</h3>
              <p className="text-sm text-slate-500">{project.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-3 space-y-4">
          {/* Bid-Free Rate Section */}
          <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
            <div className="flex items-center gap-3 mb-3">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-bold text-emerald-900">Bid-War Free Pricing</span>
            </div>
            <p className="text-xs text-emerald-700 mb-3">
              Apply at your standard rate. No competitive bidding - clients see your rate upfront.
            </p>
            
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Your Project Price ({currencySymbol()})
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{currencySymbol()}</span>
                <input
                  type="number"
                  required
                  min={1}
                  value={proposedRate}
                  onChange={(e) => setProposedRate(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
                  placeholder={freelancerRate?.toString() || '50'}
                />
              </div>
              {withinBudget && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Within the client's budget — strong chance of winning
                </p>
              )}
              {aboveBudget && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" /> Above the client's budget ({formatCurrency(clientBudget)}) — a lower bid improves your chances
                </p>
              )}
            </div>
            
            {project.budget_min && project.budget_max && (
              <p className="text-xs text-slate-600 mt-2">
                Client budget: {formatBudgetRange(project.budget_min, project.budget_max)}
              </p>
            )}

            {/* Smart pricing notes — fixed bids, fair for both sides */}
            {baseFitsBudget && (
              <div className="mt-3 flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <p className="text-xs text-emerald-800">
                  <span className="font-semibold">Great fit:</span> your base rate of {formatCurrency(baseRate)} is within the client's budget ({formatCurrency(clientBudget)}) — bid confidently at your standard price.
                </p>
              </div>
            )}

            {!baseFitsBudget && !budgetWayBelowBase && baseRate > 0 && clientBudget > 0 && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">Smart price suggestion:</span> the client's budget ({formatCurrency(clientBudget)}) is below your base rate ({formatCurrency(baseRate)}). Bidding around <span className="font-bold">{formatCurrency(suggestedTotal)}</span> fits their budget and helps you win more orders — your base rate stays unchanged for other projects.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProposedRate(String(suggestedTotal))}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Use suggested price ({formatCurrency(suggestedTotal)})
                </button>
              </div>
            )}

            {budgetWayBelowBase && (
              <div className="mt-3 flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
                <Zap className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                <p className="text-xs text-rose-800">
                  <span className="font-semibold">Heads-up:</span> the client's budget ({formatCurrency(clientBudget)}) is well below your base rate ({formatCurrency(baseRate)}). Taking this project may not be worth your time — consider negotiating the scope or passing.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Estimated Duration (days)
            </label>
            <input
              type="number"
              required
              min={1}
              value={estimatedDuration}
              onChange={(e) => setEstimatedDuration(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              placeholder="14"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Cover Message
            </label>
            <textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
              placeholder="Introduce yourself and explain why you're the best fit for this project..."
            />
            <div className="mt-2 flex items-center gap-3">
              <AIGenerateModal
                field="cover_letter"
                triggerLabel="Write cover message with AI"
                context={{
                  project_title: project.title || undefined,
                  project_description: project.description || undefined,
                  budget: project.budget_max || project.budget_min || undefined,
                  freelancer_skills: [],
                }}
                onApply={(text) => setMessage(text)}
              />
              <span className="text-xs text-slate-400">Free: 5/day · Pro: unlimited</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Apply Now'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProjectFeedPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchWithProject[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<MatchWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedMatch, setSelectedMatch] = useState<MatchWithProject | null>(null);
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [submittingProposal, setSubmittingProposal] = useState(false);
  const [proposalSuccess, setProposalSuccess] = useState<string | null>(null);
  const [newMatchAlert, setNewMatchAlert] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [skills, setSkills] = useState<string[]>([]);
  const [freelancerRate, setFreelancerRate] = useState<number | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean>(true);
  const [appliedProjects, setAppliedProjects] = useState<Set<string>>(new Set());
  // project_id → { contractId, status }: projects with existing work must show
  // the working state (Contract Active / Completed) instead of "Apply Now".
  const [contractInfoMap, setContractInfoMap] = useState<Map<string, { contractId: string; status: string }>>(new Map());
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const applyProjectId = searchParams.get('apply');

  // Sync with the dashboard top-bar search: /dashboard/feed?search=<term>
  // deep-links a search term into the feed and re-seeds the in-page box when
  // the user searches again from the header.
  useEffect(() => {
    const term = searchParams.get('search');
    if (term != null) setSearchQuery(term);
  }, [searchParams]);

  // Deep-link apply flow: /dashboard/feed?apply=<projectId> (from public project
  // detail pages) auto-opens the proposal modal for that project once matches
  // load. Falls back to fetching the project directly when it isn't in the feed.
  useEffect(() => {
    const applyId = searchParams.get('apply');
    if (!applyId) return;
    if (loading || matches.length === 0) return;
    const match = matches.find((m) => m.project_id === applyId) || null;
    if (match) {
      setSelectedMatch(match);
      setProposalModalOpen(true);
    } else {
      const loadProject = async () => {
        const { data } = await supabase
          .from('projects')
          .select('*, client:profiles!projects_client_id_fkey(id, name, avatar, rating, total_reviews)')
          .eq('id', applyId)
          .maybeSingle();
        if (data) {
          setSelectedMatch({
            id: `apply-${applyId}`,
            freelancer_id: user?.id || '',
            project_id: applyId,
            match_score: 0,
            skill_score: null,
            experience_score: null,
            budget_score: null,
            availability_score: null,
            completion_score: null,
            created_at: new Date().toISOString(),
            project: data as unknown as NonNullable<MatchWithProject['project']>,
          });
          setProposalModalOpen(true);
        }
      };
      void loadProject();
    }
    // Clear ?apply so a manual refresh doesn't re-open the modal.
    setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyProjectId, loading, matches, user, setSearchParams]);

  // Declined projects are stored PER USER (shared-device safe): user A's
  // declines must never hide projects from user B. A legacy global key is
  // migrated once into the current user's own key.
  const declinedStorageKey = () => `gw_declined_projects_${user?.id || 'anon'}`;
  const [declinedProjects, setDeclinedProjects] = useState<Set<string>>(() => {
    try {
      const key = declinedStorageKey();
      const stored = localStorage.getItem(key);
      if (stored) return new Set(JSON.parse(stored));
      if (user?.id) {
        const legacy = localStorage.getItem('gw_declined_projects');
        if (legacy) {
          localStorage.setItem(`gw_declined_projects_${user.id}`, legacy);
          return new Set(JSON.parse(legacy));
        }
      }
      return new Set();
    } catch {
      return new Set();
    }
  });

  // Rebuild the project_id → contract map (shared by initial load + realtime)
  const refreshContractInfo = async () => {
    const { data: contracts } = await supabase
      .from('contracts')
      .select('id, project_id, status')
      .eq('freelancer_id', user?.id || '');
    if (!contracts) return;
    const map = new Map<string, { contractId: string; status: string }>();
    contracts.forEach((c: any) => {
      if (!c.project_id || map.has(c.project_id)) return;
      map.set(c.project_id, { contractId: c.id, status: c.status });
    });
    setContractInfoMap(map);
  };

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        // Fetch freelancer skills and rate
        // maybeSingle: the row is OPTIONAL (only onboarding creates it) —
        // .single() on zero rows makes PostgREST answer 406, which showed up
        // as a reproducible non-2xx on every feed load for profile-less users.
        const { data: profileData, error: profileError } = await supabase
          .from('freelancer_profiles')
          .select('skills, hourly_rate')
          .eq('user_id', user.id)
          .maybeSingle();

        if (profileError) {
          setHasProfile(false);
        } else {
          setHasProfile(!!profileData);
          if (profileData?.skills) {
            setSkills(profileData.skills);
          }
          if (profileData?.hourly_rate) {
            setFreelancerRate(profileData.hourly_rate);
          }
        }

        // Fetch matches with project and client details
        const { data: matchesData, error } = await supabase
          .from('ai_matches')
          .select(`
            *,
            project:projects(
              *,
              client:profiles(id, name, avatar, rating, total_reviews)
            )
          `)
          .eq('freelancer_id', user.id)
          .order('match_score', { ascending: false });

        if (error) throw error;

        const rawMatches = (matchesData as unknown as MatchWithProject[]) || [];
        // Filter out declined projects; show all category-first matches.
        // NOTE: sub-scores are 0-100 on both generation paths now, so a
        // match_score threshold alone is the correct gate (no skill_score>=50
        // filter — that silently hid every match when skills didn't overlap).
        const realMatches = rawMatches.filter(m => 
          !declinedProjects.has(m.project_id) && 
          (m.match_score ?? 0) >= 40 &&
          !!m.project // project embed can be null when RLS hides it — drop those rows
        );

        // ── Open-projects fallback (browse-all — the feed is NEVER empty) ──
        // Skill-overlapping projects surface first (score 60); every other
        // open public project still shows below (score 40) so a fresh
        // freelancer — or one with no skills yet — always sees live work.
        // Real AI scores replace these rows as soon as the server-side match
        // engine writes an ai_matches row (which happens automatically on
        // project post / profile completion).
        const freelancerSkillSet = new Set(
          (Array.isArray(profileData?.skills) ? profileData.skills : [])
            .map((s: unknown) => safeLower(s))
            .filter((s: string) => s !== '')
        );
        const alreadyMatched = new Set(realMatches.map(m => m.project_id));
        const { data: openProjects } = await supabase
          .from('projects')
          .select('*, client:profiles!projects_client_id_fkey(id, name, avatar, deleted_at)')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(50);

        const clientOk = (pr: any) => {
          const clientProf = pr.client;
          return !(clientProf && (clientProf.deleted_at || !clientProf.name));
        };
        const skillOverlap = (pr: any) =>
          (Array.isArray(pr.skills_required) ? pr.skills_required : [])
            .some((skill: unknown) => freelancerSkillSet.has(safeLower(skill)));

        const syntheticMatches: MatchWithProject[] = ((openProjects as any[]) || [])
          .filter((pr: any) => {
            if (alreadyMatched.has(pr.id) || declinedProjects.has(pr.id)) return false;
            return clientOk(pr);
          })
          .map((pr: any) => ({
            id: `open-${pr.id}`,
            freelancer_id: user.id,
            project_id: pr.id,
            match_score: skillOverlap(pr) ? 60 : 40,
            skill_score: null,
            experience_score: null,
            budget_score: null,
            availability_score: null,
            completion_score: null,
            created_at: new Date().toISOString(),
            project: pr,
          }));

        const combinedMatches = [...realMatches, ...syntheticMatches];
        setMatches(combinedMatches);
        setFilteredMatches(combinedMatches);

        // Fetch proposals
        const { data: proposals } = await supabase
          .from('proposals')
          .select('project_id')
          .eq('freelancer_id', user.id);
        
        if (proposals) {
          setAppliedProjects(new Set(proposals.map(p => p.project_id)));
        }

        // Projects with active work must show "Contract Active" instead of
        // "Apply Now" (invite-hired projects have NO proposals row, so
        // appliedProjects alone would miss them).
        await refreshContractInfo();

        setLoading(false);
      } catch (error) {
        toast.error('Error', 'Failed to load matches.');
        setLoading(false);
      }
    };

    // Add timeout to prevent infinite loading - reduced to 3 seconds for faster UX
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 3000);

    fetchData();

    // Set up real-time subscription for AI matches
    const matchesChannel = supabase
      .channel(`ai-matches-feed-${user.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_matches',
          filter: `freelancer_id=eq.${user.id}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // Fetch new match with project details
            const fetchNewMatch = async () => {
              const { data } = await supabase
                .from('ai_matches')
                .select(`
                  *,
                  project:projects(
                    *,
                    client:profiles(id, name, avatar, rating, total_reviews)
                  )
                `)
                .eq('id', payload.new.id)
                .single();
              
              if (data && (data as any).project) {
                const matchData = data as unknown as MatchWithProject;
                // Dedup by id — realtime can deliver the same INSERT twice;
                // never render duplicate matches.
                setMatches(prev =>
                  prev.some(m => m.id === matchData.id) ? prev : [matchData, ...prev]
                );
                setFilteredMatches(prev =>
                  prev.some(m => m.id === matchData.id) ? prev : [matchData, ...prev]
                );
                setNewMatchAlert(`New match: ${matchData.project.title}`);
                setTimeout(() => setNewMatchAlert(null), 5000);
              }
            };
            fetchNewMatch();
          } else if (payload.eventType === 'UPDATE') {
            setMatches(prev =>
              prev.map((match) =>
                match.id === payload.new.id ? ({ ...match, ...(payload.new as MatchWithProject) }) : match
              )
            );
            setFilteredMatches(prev =>
              prev.map((match) =>
                match.id === payload.new.id ? ({ ...match, ...(payload.new as MatchWithProject) }) : match
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setMatches(prev => prev.filter(m => m.id !== payload.old.id));
            setFilteredMatches(prev => prev.filter(m => m.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Real-time subscription for profile/avatar changes
    const profilesChannel = supabase
      .channel('profiles-avatar-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles'
        },
        (payload) => {
          // Update client avatar in all matches that reference this profile
          if (payload.new.avatar !== payload.old.avatar) {
            setMatches(prev => 
              prev.map(match => 
                match.project.client?.id === payload.new.id
                  ? { 
                      ...match, 
                      project: { 
                        ...match.project, 
                        client: { 
                          ...match.project.client, 
                          avatar: payload.new.avatar 
                        }
                      }
                    }
                  : match
              )
            );
            setFilteredMatches(prev => 
              prev.map(match => 
                match.project.client?.id === payload.new.id
                  ? { 
                      ...match, 
                      project: { 
                        ...match.project, 
                        client: { 
                          ...match.project.client, 
                          avatar: payload.new.avatar 
                        }
                      }
                    }
                  : match
              )
            );
          }
          // Real-time client rating sync — the review trigger refreshes profiles.rating
          if (payload.new.rating !== payload.old.rating || payload.new.total_reviews !== payload.old.total_reviews) {
            const patchClient = (c: { id?: string; [k: string]: unknown } | null | undefined) =>
              c && c.id === payload.new.id
                ? { ...c, rating: payload.new.rating, total_reviews: payload.new.total_reviews }
                : c;
            setMatches(prev =>
              prev.map(m =>
                m.project.client?.id === payload.new.id
                  ? { ...m, project: { ...m.project, client: patchClient(m.project.client) as never } }
                  : m
              )
            );
            setFilteredMatches(prev =>
              prev.map(m =>
                m.project.client?.id === payload.new.id
                  ? { ...m, project: { ...m.project, client: patchClient(m.project.client) as never } }
                  : m
              )
            );
          }
        }
      )
      .subscribe();

    // Real-time subscription for contracts — instantly flip the card to
    // "Contract Active" when an invite/proposal turns into a contract
    const contractsChannel = supabase
      .channel('feed-contracts-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contracts', filter: `freelancer_id=eq.${user.id}` },
        () => {
          refreshContractInfo();
        }
      )
      .subscribe();

    // Real-time subscription for NEW open projects — the browse-all fallback
    // refetches instantly when a client posts, so the feed updates live for
    // every freelancer (matched or not).
    const projectsChannel = supabase
      .channel('feed-projects-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'projects' },
        (payload) => {
          if (payload.new && (payload.new as any).status === 'open') {
            void fetchData();
          }
        }
      )
      .subscribe();

    return () => {
      clearTimeout(timeoutId);
      matchesChannel.unsubscribe();
      profilesChannel.unsubscribe();
      contractsChannel.unsubscribe();
      projectsChannel.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Filter matches based on search and category
  useEffect(() => {
    let filtered = matches;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (match) =>
          safeLower(match.project?.title).includes(query) ||
          safeLower(match.project?.description).includes(query) ||
          (match.project?.skills_required?.some((skill) =>
            safeLower(skill).includes(query)
          ) ?? false)
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((match) => match.project.category === selectedCategory);
    }

    setFilteredMatches(filtered);
    setPage(1);
  }, [searchQuery, selectedCategory, matches]);

  const handleApply = (match: MatchWithProject) => {
    setSelectedMatch(match);
    setProposalModalOpen(true);
  };

  const handleSubmitProposal = async (proposalData: {
    message: string;
    estimated_duration: number;
    proposed_rate: number;
    rate_type: string;
  }) => {
    if (!selectedMatch || !user) return;

    setSubmittingProposal(true);

    try {
      // Daily proposal limit check (max_proposal_per_day: 20)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: todayCount } = await supabase
        .from('proposals')
        .select('id', { count: 'exact', head: true })
        .eq('freelancer_id', user.id)
        .gte('created_at', todayStart.toISOString());

      if ((todayCount ?? 0) >= 20) {
        toast.error('Daily Limit Reached', 'You\'ve submitted the maximum 20 proposals today. Try again tomorrow.');
        setSubmittingProposal(false);
        return;
      }

      // Create proposal with bid-war free model
      const { data: createdProposal, error: proposalError } = await supabase
        .from('proposals')
        .insert({
          project_id: selectedMatch.project_id,
          freelancer_id: user.id,
          proposed_rate: proposalData.proposed_rate,
          rate_type: proposalData.rate_type,
          message: proposalData.message,
          estimated_duration: proposalData.estimated_duration,
          status: 'pending',
          application_type: 'standard',
        })
        .select()
        .single();

      if (proposalError) throw proposalError;

      // The client is told a proposal arrived (fire-and-forget; the function
      // authorises this caller as the proposal's freelancer).
      if (createdProposal?.id) void notifyProposalSubmitted(createdProposal.id);

      // Update local state
      setAppliedProjects(prev => new Set(prev).add(selectedMatch.project_id));

      setProposalModalOpen(false);
      setProposalSuccess('Application submitted successfully!');
      toast.success(
        'Application Submitted',
        `Your proposal for "${selectedMatch.project?.title || 'the project'}" has been sent to the client. You can track it in My Proposals.`
      );

      // Take the freelancer to "My Proposals" — landing on the feed after
      // submitting felt like a dead end. Now they see their live proposal.
      navigate('/dashboard/proposals');
    } catch (error) {
      toast.error('Error', 'Failed to submit application. Please try again.');
    } finally {
      setSubmittingProposal(false);
    }
  };

  const handleDecline = async (matchId: string, projectIdFromMatch: string) => {
    try {
      // Store declined project ID in localStorage so it persists across refreshes
      const newDeclined = new Set(declinedProjects);
      newDeclined.add(projectIdFromMatch);
      setDeclinedProjects(newDeclined);
      if (user?.id) {
        localStorage.setItem(`gw_declined_projects_${user.id}`, JSON.stringify([...newDeclined]));
      }

      // Optionally delete from DB
      await supabase
        .from('ai_matches')
        .delete()
        .eq('id', matchId);

      setMatches(prev => prev.filter((m) => m.id !== matchId));
      setFilteredMatches(prev => prev.filter((m) => m.id !== matchId));
    } catch (error) {
      toast.error('Error', 'Failed to decline match.');
    }
  };

  const { flatNames: catNames } = useCategories();
  const categories = ['all', ...catNames];

  const getMatchScoreColor = (score: number) => {
    if (score >= 85) return 'bg-emerald-500 text-white';
    if (score >= 70) return 'bg-blue-500 text-white';
    if (score >= 50) return 'bg-orange-500 text-white';
    return 'bg-slate-400 text-white';
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">AI Project Feed <InfoTip title="How to win projects here" text="Each card shows how well the project fits your profile (% Match). Tap Apply Now with your rate and a short cover message — the client reviews proposals in real time. Once you're hired, the button becomes Contract Active and work happens in the workspace with escrow protection. Matching improves as you complete your profile." /></h1>
            <p className="text-slate-500 text-xs sm:text-xs">
              {skills.length > 0
                ? `${matches.length} open projects — matched to your ${skills.length} skills first`
                : `${matches.length} open projects — add skills to your profile to get AI-matched first`}
            </p>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search projects..."
              aria-label="Search projects"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 w-48"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          >
            <option value="all">All Categories</option>
            {categories.filter(c => c !== 'all').map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* New Match Alert */}
      {newMatchAlert && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center gap-3 animate-in slide-in-from-top">
          <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
            <Zap className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-emerald-900 text-xs">{newMatchAlert}</p>
            <p className="text-xs text-emerald-600">New AI-powered match just added!</p>
          </div>
          <button
            onClick={() => setNewMatchAlert(null)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-emerald-100 transition-colors"
          >
            <X className="w-4 h-4 text-emerald-600" />
          </button>
        </div>
      )}

      {/* Success Message */}
      {proposalSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <p className="font-medium text-green-900 text-xs">{proposalSuccess}</p>
        </div>
      )}

      {/* Skills Tags */}
      {skills.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-slate-500">Your skills:</span>
          {skills.slice(0, 5).map((skill) => (
            <span
              key={skill}
              className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded-full"
            >
              {skill}
            </span>
          ))}
          {skills.length > 5 && (
            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full">
              +{skills.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Project Cards */}
      {filteredMatches.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3">
            {filteredMatches
              .slice((page - 1) * pageSize, page * pageSize)
              .map((match) => (
            <div
              key={match.id}
              className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-1.5">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      {match.project?.title || 'Untitled Project'}
                    </h3>
                    {match.id.startsWith('open-') ? (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 text-slate-500">
                        Browse
                      </span>
                    ) : (
                      <span
                        className={`px-2 py-0.5 text-xs font-bold rounded-full ${getMatchScoreColor(
                          match.match_score
                        )}`}
                      >
                        {match.match_score}% Match
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-slate-600 mb-1.5 line-clamp-4 text-xs">
                    {match.project?.description || ''}
                  </p>

                  {/* Meta Info */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                    <span className="flex items-center gap-1">
                      <Wallet className="w-3.5 h-3.5" />
                      {formatBudgetRange(match.project?.budget_min, match.project?.budget_max)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Due {match.project?.deadline && new Date(match.project.deadline).toLocaleDateString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Briefcase className="w-4 h-4" />
                      {match.project?.experience_level || 'Any'}
                    </span>
                    {match.skill_score && match.skill_score > 0 && (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="w-4 h-4" />
                        {match.skill_score} skills match score
                      </span>
                    )}
                  </div>

                  {/* Skills */}
                  {match.project?.skills_required && match.project.skills_required.length > 0 && (
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      {match.project.skills_required.slice(0, 5).map((skill) => (
                        <span
                          key={skill}
                          className={`px-2 py-1 text-xs rounded-lg ${
                            skills.includes(skill)
                              ? 'bg-emerald-100 text-emerald-700 font-medium'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {skill}
                        </span>
                      ))}
                      {match.project.skills_required.length > 5 && (
                        <span className="px-2 py-1 text-xs bg-slate-100 text-slate-500 rounded-lg">
                          +{match.project.skills_required.length - 5}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Client Info */}
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <span>Posted by</span>
                    <span className="font-medium text-slate-700">
                      {match.project.client?.name || 'Client'}
                    </span>
                    {(match.project.client as any)?.rating && Number((match.project.client as any).rating) > 0 && (
                      <span className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        <span className="font-semibold text-slate-700">{Number((match.project.client as any).rating).toFixed(1)}</span>
                        <span className="text-slate-400">({(match.project.client as any).total_reviews || 0})</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  {(() => {
                    const ci = contractInfoMap.get(match.project_id);
                    if (ci) {
                      const terminal =
                        ci.status === 'completed' ||
                        ci.status === 'cancelled' ||
                        ci.status === 'rejected';
                      if (terminal) {
                        const label =
                          ci.status === 'completed'
                            ? 'Completed'
                            : ci.status === 'cancelled'
                              ? 'Cancelled'
                              : 'Closed';
                        return (
                          <button
                            disabled
                            className="px-6 py-3 bg-slate-100 text-slate-500 font-medium rounded-xl cursor-not-allowed inline-flex items-center justify-center gap-3"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {label}
                          </button>
                        );
                      }
                      return (
                        <Link
                          to={`/dashboard/workspace?contract=${ci.contractId}`}
                          className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-3"
                        >
                          <Briefcase className="w-4 h-4" />
                          {ci.status === 'pending' ? 'View Contract' : 'Contract Active'}
                        </Link>
                      );
                    }
                    if (appliedProjects.has(match.project_id)) {
                      return (
                        <button
                          disabled
                          className="px-6 py-3 bg-slate-100 text-slate-500 font-medium rounded-xl cursor-not-allowed inline-flex items-center justify-center gap-3"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Applied
                        </button>
                      );
                    }
                    return (
                      <button
                        onClick={() => handleApply(match)}
                        className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-3"
                      >
                        Apply Now
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    );
                  })()}
                  {!contractInfoMap.has(match.project_id) && (
                    <button
                      onClick={() => handleDecline(match.id, match.project_id)}
                      className="px-6 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Not Interested
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          </div>
          <Pagination
            currentPage={page}
            totalItems={filteredMatches.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      ) : !hasProfile ? (
        <div className="bg-white rounded-xl p-12 border border-slate-100 text-center shadow-sm max-w-2xl mx-auto">
          <div className="w-20 h-20 bg-violet-50 text-violet-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-10 h-10 animate-pulse" />
          </div>
          <h3 className="font-display text-2xl font-bold text-slate-900 mb-3">
            Unlock Your Real-Time Matchmaker Feed!
          </h3>
          <p className="text-slate-600 max-w-md mx-auto mb-4 text-sm leading-relaxed">
            Growlanzo uses a state-of-the-art match scoring engine to hook you up with high-paying client contracts automatically. To unlock your matching projects, you need to complete your professional profile setup first.
          </p>
          <Link
            to="/dashboard/profile"
            className="inline-flex items-center px-8 py-3.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold rounded-xl hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-violet-500/20"
          >
            Create Your Profile Now
            <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl p-12 border border-slate-100 text-center">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Sparkles className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="font-display text-xl font-bold text-slate-900 mb-2">
            No matches found
          </h3>
          <p className="text-slate-500 max-w-md mx-auto mb-3">
            {searchQuery || selectedCategory !== 'all'
              ? 'Try adjusting your search or filters to find more projects.'
              : 'Complete your profile with more skills to get better AI-powered matches.'}
          </p>
          {(searchQuery || selectedCategory !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Proposal Modal */}
      <ProposalModal
        project={selectedMatch?.project || null}
        freelancerRate={freelancerRate}
        isOpen={proposalModalOpen}
        onClose={() => setProposalModalOpen(false)}
        onSubmit={handleSubmitProposal}
        isSubmitting={submittingProposal}
      />
    </div>
  );
}
