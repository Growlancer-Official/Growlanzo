import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase, realtimeChannels } from '../lib/supabase';
import { formatCurrency } from '../lib/currency';
import { hireFreelancerFromProposal, rejectProposal } from '../lib/workflowService';
import { CheckCircle, Clock, ExternalLink, Eye, FileText, IndianRupee, MoreVertical, Plus, Star, User, XCircle } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { PageSkeleton } from '../components/PageSkeleton';
import { useToast } from '../components/Toast';
import { ProBadge } from '../components/ProBadge';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { formatBudgetRange } from '../utils/date';

interface Proposal {
  id: string;
  project_id: string;
  freelancer_id: string;
  bid_amount?: number;
  proposed_rate?: number;
  cover_letter: string;
  estimated_duration: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
  project?: {
    id: string;
    title: string;
    budget_min: number;
    budget_max: number;
  };
    freelancer?: {
      id: string;
      name: string;
      avatar?: string;
      is_pro?: boolean;
      verification_status?: string | null;
      deleted_at?: string | null;
      freelancer_profiles?: {
        rating?: number;
        hourly_rate?: number;
        completion_rate?: number;
      } | {
        rating?: number;
        hourly_rate?: number;
        completion_rate?: number;
      }[];
    };
  }

/* ── Dropdown menu for each proposal card ── */
function ProposalMenu({
  freelancerId,
  status,
  onAccept,
  onReject,
}: {
  freelancerId: string;
  status: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex h-10 w-10 items-center justify-center hover:bg-slate-100 rounded-lg transition-colors relative z-10"
      >
        <MoreVertical className="w-4 h-4 text-slate-400" />
      </button>

      {open && (
        <div className="menu-surface absolute right-0 top-full mt-1 z-50 w-52 bg-white rounded-xl border border-slate-200 shadow-xl py-1.5 animate-in fade-in slide-in-from-top-1">
          <Link
            to={`/freelancer/${freelancerId}`}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            <ExternalLink className="w-4 h-4 text-slate-400" />
            <span>View Freelancer Profile</span>
          </Link>

          {status === 'hired' && (
            <>
              <div className="h-px bg-slate-100 my-1.5 mx-3" />
              <div className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-emerald-700 font-medium">
                <CheckCircle className="w-4 h-4" />
                <span>Hired — contract created</span>
              </div>
            </>
          )}

          {status === 'pending' && (
            <>
              <div className="h-px bg-slate-100 my-1.5 mx-3" />
              <button
                onClick={() => { setOpen(false); onAccept(); }}
                className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Accept & Hire</span>
              </button>
              <button
                onClick={() => { setOpen(false); onReject(); }}
                className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                <span>Reject</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ClientProposalsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageSize = 20;
  const pageRef = useRef(0);

  const fetchProposals = useCallback(async (loadMore = false) => {
    if (!user) return;
    if (loadMore) setLoadingMore(true);
    try {
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('client_id', user.id);

      const projectIds = projects?.map((p) => p.id) || [];

      if (projectIds.length === 0) {
        setProposals([]);
        setLoading(false);
        return;
      }

      const currentPage = pageRef.current;
      const from = loadMore ? (currentPage + 1) * pageSize : 0;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('proposals')
        .select(`
            *,
            project:projects(id, title, budget_min, budget_max),
            freelancer:profiles!proposals_freelancer_id_fkey(
              id, 
              name, 
              avatar, 
              is_pro,
              verification_status,
              deleted_at,
              freelancer_profiles(rating, hourly_rate, completion_rate)
            )
          `)
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      if (data) {
        // Filter out proposals from deleted users
        const validProposals = (data as unknown as Proposal[]).filter(p => {
          return p.freelancer && !p.freelancer.deleted_at;
        });
        if (loadMore) {
          setProposals(prev => [...prev, ...validProposals]);
          pageRef.current = currentPage + 1;
        } else {
          setProposals(validProposals);
          pageRef.current = 0;
        }
        setHasMore(validProposals.length === pageSize);
      }
    } catch (error) {
      toast.error('Error', 'Failed to load proposals.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (!user) return;

    void fetchProposals();

    const subscription = realtimeChannels.proposals(`client-proposals-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'proposals' },
        () => {
          void fetchProposals();
        }
      )
      .subscribe();

    return () => {
      void subscription.unsubscribe();
    };
  }, [user, fetchProposals]);

  const filteredProposals = proposals.filter((p) =>
    filter === 'all' ? true : p.status === filter
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-700';
      case 'accepted':
      case 'hired':
        return 'bg-emerald-100 text-emerald-700';
      case 'rejected':
        return 'bg-red-100 text-red-700';
      case 'withdrawn':
        return 'bg-slate-100 text-slate-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const handleAccept = async (proposal: Proposal) => {
    // Ignore a second click while the first hire is in flight: two calls would
    // race to create two contracts for one proposal.
    if (!user || actionId) return;
    setActionId(proposal.id);
    setActionError(null);
    try {
      const result = await hireFreelancerFromProposal(proposal.id, user.id, { useEscrowRpc: true });
      if (!result.success) {
        setActionError(('error' in result && result.error) || 'Could not hire this freelancer');
        return;
      }
      // The contract exists now. Navigate FIRST and refresh in the background —
      // this handler used to `await fetchProposals()` before navigating, so a
      // slow/failed refresh left the button on "Hiring…" even though hiring had
      // already succeeded. `finally` below guarantees the button always resets.
      navigate(`/client/workspace?contract=${result.contractId}`);
      void fetchProposals();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not hire this freelancer');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    setActionId(proposalId);
    setActionError(null);
    const ok = await rejectProposal(proposalId);
    if (!ok) setActionError('Could not reject proposal');
    else await fetchProposals();
    setActionId(null);
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Proposals <InfoTip title="Accepting a proposal" text="When you click Accept & Hire, a contract and workspace are created instantly with escrow protection built in — you only pay when you fund the escrow, and funds are released to the freelancer only after you approve the completed work." /></h1>
          <p className="text-slate-500 mt-1">Review and manage proposals from freelancers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 rounded-xl shrink-0 whitespace-nowrap self-start sm:self-auto">
          <FileText className="w-4 h-4 shrink-0" />
          <span className="font-bold">
            {proposals.length} {proposals.length === 1 ? 'Proposal' : 'Proposals'}
          </span>
        </div>
      </div>

      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{actionError}</p>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-3 border-b border-slate-200">
        {(['all', 'pending', 'accepted', 'rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 font-medium transition-colors ${
              filter === f
                ? 'text-emerald-600 border-b-2 border-emerald-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Proposals List */}
      {filteredProposals.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-xl border border-slate-100">
          <div className="w-20 h-20 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-2.5">
            <FileText className="w-7 h-7 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            {filter === 'all' ? 'No proposals yet' : `No ${filter} proposals`}
          </h3>
          <p className="text-slate-500 max-w-sm mx-auto mb-3">
            {filter === 'all'
              ? 'Post a project to start receiving proposals from interested freelancers.'
              : `You don't have any ${filter} proposals at the moment.`}
          </p>
          {filter === 'all' ? (
            <Link
              to="/client/post"
              className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all"
            >
              <Plus className="w-4 h-4" />
              Post a Project
            </Link>
          ) : (
            <Link
              to="/client/proposals"
              className="text-emerald-600 font-medium hover:underline text-sm"
            >
              View all proposals →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {filteredProposals.map((proposal) => (
            <div
              key={proposal.id}
              className="bg-white p-6 rounded-xl border border-slate-100 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Link
                    to={`/freelancer/${proposal.freelancer_id}`}
                    title="View freelancer profile"
                    className="shrink-0"
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-emerald-400 transition-all">
                      {proposal.freelancer?.avatar ? (
                        <img src={proposal.freelancer.avatar} alt={proposal.freelancer.name} />
                      ) : (
                        <User className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </Link>
                  <div>
                    <Link
                      to={`/freelancer/${proposal.freelancer_id}`}
                      className="font-display font-bold text-slate-900 hover:text-emerald-600 transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        {proposal.freelancer?.name || 'Unknown Freelancer'}
                        {proposal.freelancer?.verification_status === 'verified' && <VerifiedBadge size="xs" />}
                        {proposal.freelancer?.is_pro && <ProBadge size="xs" />}
                      </span>
                    </Link>
                    <div className="flex items-center gap-1.5 text-sm text-slate-500">
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        <span>
                          {(() => {
                            const fp = Array.isArray(proposal.freelancer?.freelancer_profiles) 
                              ? proposal.freelancer.freelancer_profiles[0] 
                              : proposal.freelancer?.freelancer_profiles;
                            return fp?.rating ? Number(fp.rating).toFixed(1) : '—';
                          })()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <IndianRupee className="w-4 h-4" />
                        <span>
                          {formatCurrency((() => {
                            const fp = Array.isArray(proposal.freelancer?.freelancer_profiles) 
                              ? proposal.freelancer.freelancer_profiles[0] 
                              : proposal.freelancer?.freelancer_profiles;
                            return fp?.hourly_rate || 0;
                          })())}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${getStatusColor(
                      proposal.status
                    )}`}
                  >
                    {proposal.status}
                  </span>
                  <ProposalMenu
                    freelancerId={proposal.freelancer_id}
                    status={proposal.status}
                    onAccept={() => handleAccept(proposal)}
                    onReject={() => handleReject(proposal.id)}
                  />
                </div>
              </div>

              {proposal.project && (
                <div className="mb-2 p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">Project:</span> {proposal.project.title}
                  </p>
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">Budget:</span> {formatBudgetRange(proposal.project.budget_min, proposal.project.budget_max)}
                  </p>
                </div>
              )}

              <div className="mb-2 p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-700 line-clamp-3">{proposal.cover_letter}</p>
              </div>

              <div className="flex items-center gap-3 text-sm text-slate-500 mb-2">
                <div className="flex items-center gap-3">
                  <IndianRupee className="w-4 h-4" />
                  <span className="font-bold text-slate-900">{formatCurrency(proposal.bid_amount ?? proposal.proposed_rate ?? 0)}</span>
                  {proposal.project && proposal.project.budget_max > 0 && (
                    (proposal.bid_amount ?? proposal.proposed_rate ?? 0) > proposal.project.budget_max ? (
                      <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">Above your budget</span>
                    ) : (
                      <span className="ml-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full">Within budget</span>
                    )
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4" />
                  <span>{proposal.estimated_duration}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4" />
                  <span>Submitted {new Date(proposal.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              {proposal.status === 'pending' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={actionId === proposal.id}
                    onClick={() => handleAccept(proposal)}
                    className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {actionId === proposal.id ? 'Hiring…' : 'Accept & Hire'}
                  </button>
                  <button
                    type="button"
                    disabled={actionId === proposal.id}
                    onClick={() => handleReject(proposal.id)}
                    className="flex items-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                  <Link
                    to="/client/matches"
                    className="flex items-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    Find more talent
                  </Link>
                </div>
              )}
            </div>
          ))}
            </div>
          </>
      )}

      {/* Load More */}
      {filteredProposals.length > 0 && hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => fetchProposals(true)}
            disabled={loadingMore}
            className="px-3 py-3 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More Proposals'}
          </button>
        </div>
      )}
    </div>
  );
}
