import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase, realtimeChannels } from '../lib/supabase';
import { formatCurrency } from '../lib/currency';
import { ACTIVE_STATUSES, PENDING_STATUSES } from '../lib/contractStatuses';
import { AlertCircle, Calendar, Clock, FileText, Handshake, IndianRupee, Laptop, User, Users,  } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { ProBadge } from '../components/ProBadge';
import { PageSkeleton } from '../components/PageSkeleton';

interface Contract {
  id: string;
  project_id: string;
  freelancer_id: string;
  client_id: string;
  proposal_id?: string;
  amount: number;
  status: string | null;
  start_date: string | null;
  end_date?: string | null;
  created_at: string | null;
  project?: { id: string; title: string } | null;
  freelancer?: { id: string; name: string; avatar?: string | null; is_pro?: boolean; verification_status?: string | null } | null;
  escrow?: { id: string; amount: number; status: string }[] | { id: string; amount: number; status: string } | null;
}

function getEscrow(c: Contract) {
  if (!c.escrow) return null;
  return Array.isArray(c.escrow) ? c.escrow[0] : c.escrow;
}



export function ClientContractsPage() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'pending'>('all');
  // Once the user clicks a tab, stop auto-flipping (auto-select only until then)
  const userTouchedFilter = useRef(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageSize = 20;
  const pageRef = useRef(0);
  const [searchParams] = useSearchParams();

  // Honor ?tab= from the URL (e.g. after a review submit -> land on completed history)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'all' || tab === 'active' || tab === 'pending' || tab === 'completed') {
      setFilter(tab);
      userTouchedFilter.current = true;
    }
  }, [searchParams]);

  const fetchContracts = useCallback(async (loadMore = false) => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    const currentPage = pageRef.current;
    const from = loadMore ? (currentPage + 1) * pageSize : 0;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('contracts')
      .select(`
        *,
        project:projects(id, title),
        freelancer:profiles!contracts_freelancer_id_fkey(id, name, avatar, is_pro, verification_status),
        escrow(id, amount, status)
      `)
      .eq('client_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('Error fetching contracts:', error);
    } else {
      const newContracts = (data as unknown as Contract[]) || [];
      if (loadMore) {
        setContracts(prev => [...prev, ...newContracts]);
        pageRef.current = currentPage + 1;
      } else {
        setContracts(newContracts);
        pageRef.current = 0;
      }
      setHasMore(newContracts.length === pageSize);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    void fetchContracts();

    const subscription = realtimeChannels
      .contracts(`client-contracts-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contracts',
          filter: `client_id=eq.${user.id}`,
        },
        () => {
          void fetchContracts();
        }
      )
      .subscribe();

    return () => {
      void subscription.unsubscribe();
    };
  }, [user?.id, fetchContracts]);

  const filteredContracts = contracts.filter((c) => {
    if (filter === 'all') return true;
    if (filter === 'active') return ACTIVE_STATUSES.includes(c.status || '');
    if (filter === 'completed') return c.status === 'completed';
    if (filter === 'pending') return PENDING_STATUSES.includes(c.status || '');
    return true;
  });

  // Auto-select the tab that matches the user's current state — Active → Pending →
  // Completed → All — until they manually pick one. Re-runs on realtime refetches
  // so the user always lands on (and follows) the workflow stage they are in.
  useEffect(() => {
    if (userTouchedFilter.current) return;
    if (contracts.some((c) => ACTIVE_STATUSES.includes(c.status || ''))) {
      setFilter('active');
    } else if (contracts.some((c) => PENDING_STATUSES.includes(c.status || ''))) {
      setFilter('pending');
    } else if (contracts.some((c) => c.status === 'completed')) {
      setFilter('completed');
    } else {
      setFilter('all');
    }
  }, [contracts]);

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'pending':
      case 'draft':
        return 'bg-yellow-100 text-yellow-700';
      case 'active':
      case 'in_progress':
        return 'bg-emerald-100 text-emerald-700';
      case 'completed':
        return 'bg-blue-100 text-blue-700';
      case 'cancelled':
        return 'bg-red-100 text-red-700';
      case 'disputed':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2 flex-wrap">
              Contracts
            <InfoTip
              title="How contracts work for you"
              text="1) Accept a proposal or a freelancer accepts your invite → contract is Pending. 2) You fund escrow → contract becomes Active and the freelancer starts work. 3) The freelancer delivers in the Workspace → you review and approve. 4) Funds release from escrow only after your approval. Your money is safe until you're happy with the work."
            />
          </h1>
          <p className="text-slate-500 mt-1">Manage active and completed contracts with freelancers</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl flex-shrink-0">
          <Handshake className="w-4 h-4" />
          <span className="font-bold">{contracts.length} Contracts</span>
        </div>
      </div>

      <InfoTip title="Your money is protected until you approve" text="A contract is only active after escrow is funded. The freelancer can't touch the funds — they release only when you approve the delivered work. If you're not satisfied, request a revision or raise a dispute instead of paying outside the platform. Never pay a freelancer directly; it voids Growlanzo's protection." />

      <div className="flex gap-3 border-b border-slate-200 overflow-x-auto">
        {(['all', 'active', 'completed', 'pending'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { userTouchedFilter.current = true; setFilter(f); }}
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

      {filteredContracts.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-xl border border-slate-100">
          <div className="w-20 h-20 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-2.5">
            <Handshake className="w-7 h-7 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            {filter === 'all' ? 'No contracts yet' : `No ${filter} contracts`}
          </h3>
          <p className="text-slate-500 max-w-sm mx-auto mb-3">
            {filter === 'all'
              ? 'Contracts are created when you accept a proposal or a freelancer accepts your invite. Then you can manage milestones, escrow, and payments here.'
              : `You don't have any ${filter} contracts at the moment.`}
          </p>
          {filter === 'all' ? (
            <div className="flex gap-1.5 justify-center">
              <Link
                to="/client/proposals"
                className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all"
              >
                <FileText className="w-4 h-4" />
                View Proposals
              </Link>
              <Link
                to="/client/matches"
                className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all"
              >
                <Users className="w-4 h-4" />
                Find Freelancers
              </Link>
            </div>
          ) : (
            <Link
              to="/client/contracts"
              className="text-emerald-600 font-medium hover:underline text-sm"
            >
              View all contracts →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredContracts.map((contract) => {
            const escrow = getEscrow(contract);
            return (
              <div
                key={contract.id}
                className="bg-white p-6 rounded-xl border border-slate-100 hover:shadow-md transition-shadow"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {contract.freelancer?.avatar ? (
                        <img src={contract.freelancer.avatar} alt={contract.freelancer.name} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display font-bold text-slate-900">
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          {contract.freelancer?.name || 'Unknown Freelancer'}
                                                    {contract.freelancer?.is_pro && <ProBadge size="xs" />}
                        </span>
                      </h3>
                      {contract.project && (
                        <p className="text-sm text-slate-500 truncate">{contract.project.title}</p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${getStatusColor(
                      contract.status
                    )}`}
                  >
                    {contract.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2 text-sm">
                  <div className="flex items-center gap-3 text-slate-600">
                    <IndianRupee className="w-4 h-4" />
                    <span className="font-medium text-slate-900">
                      {formatCurrency(Number(contract.amount))}
                    </span>
                  </div>
                  {contract.start_date && (
                    <div className="flex items-center gap-3 text-slate-600">
                      <Calendar className="w-4 h-4" />
                      <span>Started: {new Date(contract.start_date).toLocaleDateString()}</span>
                    </div>
                  )}
                  {contract.end_date && (
                    <div className="flex items-center gap-3 text-slate-600">
                      <Clock className="w-4 h-4" />
                      <span>Ends: {new Date(contract.end_date).toLocaleDateString()}</span>
                    </div>
                  )}
                  {escrow && (
                    <div className="flex items-center gap-3 text-slate-600">
                      <FileText className="w-4 h-4" />
                      <span>
                        Escrow: {formatCurrency(escrow.amount)} ({escrow.status})
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 flex-wrap">
                  <Link
                    to={`/client/workspace?contract=${contract.id}`}
                    className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors"
                  >
                    <Laptop className="w-4 h-4" />
                    Open Workspace
                  </Link>
                  {!escrow && (
                    <Link
                      to={`/client/workspace?contract=${contract.id}&fund=1`}
                      className="flex items-center gap-3 px-4 py-2 bg-emerald-50 text-emerald-700 font-semibold rounded-lg border border-emerald-200 hover:bg-emerald-100"
                    >
                      <IndianRupee className="w-4 h-4" />
                      Fund Escrow
                    </Link>
                  )}
                  <Link
                    to="/client/payments"
                    className="flex items-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50"
                  >
                    <IndianRupee className="w-4 h-4" />
                    Payments
                  </Link>
                  {(contract.status === 'active' || contract.status === 'in_progress') && (
                    <Link
                      to={`/client/workspace?contract=${contract.id}`}
                      className="flex items-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50"
                    >
                      <AlertCircle className="w-4 h-4" />
                      Report Issue
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Load More */}
      {filteredContracts.length > 0 && hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => fetchContracts(true)}
            disabled={loadingMore}
            className="px-3 py-3 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More Contracts'}
          </button>
        </div>
      )}
    </div>
  );
}
