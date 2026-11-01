import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowRight, Briefcase, Calendar, CheckCircle2, ChevronDown, ChevronRight, Clock, IndianRupee, FileText, Handshake, Loader2, Shield, ThumbsUp, User, X } from 'lucide-react';
import { InfoTip } from '../../components/InfoTip';
import { Button } from '../../components/Button';
import { PageSkeleton } from '../../components/PageSkeleton';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { useAuth } from '../../context/AuthContext';
import { supabase, realtimeChannels } from '../../lib/supabase';
import type { Tables } from '../../types/supabase';
import { milestoneService, getMilestoneProgress } from '../../lib/contractMilestones';
import { safeFormatDate } from '../../utils/date';
import type { MilestoneItem } from '../../lib/contractMilestones';
import { ACTIVE_STATUSES, PENDING_STATUSES } from '../../lib/contractStatuses';

type ContractWithDetails = Tables<'contracts'> & {
  project?: Tables<'projects'> | null;
  profiles?: Tables<'profiles'> | null;
};

interface EscrowState {
  loaded: boolean;
  balance?: {
    totalAmount: number;
    fundedAmount: number;
    heldAmount: number;
    releasedAmount: number;
    milestoneCount: number;
    fundedMilestoneCount: number;
    isFullyFunded: boolean;
    isPartiallyFunded: boolean;
  };
  error?: string;
}

/** Color-coded milestone progress bar displayed on each contract card. */
function MilestoneProgressBar({ milestones }: { milestones: MilestoneItem[] }) {
  const progress = getMilestoneProgress(milestones);
  if (progress.total === 0) return null;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-600">
          Milestones: {progress.completed}/{progress.total}
        </span>
        <span className="text-xs font-bold text-slate-700">{progress.percent}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${
            progress.percent === 100
              ? 'bg-emerald-500'
              : progress.percent >= 50
              ? 'bg-blue-500'
              : 'bg-amber-500'
          }`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

/** Funding badge wrapped with an explanatory hover tooltip so freelancers &
 * clients instantly understand what each escrow state means. */
function FundingTooltip({ label, icon, classes, tooltip }: {
  label: string;
  icon: React.ReactNode;
  classes: string;
  tooltip: string;
}) {
  return (
    <span className="relative inline-flex group">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full cursor-help ${classes}`}
      >
        {icon}
        {label}
      </span>
      {/* Hover tooltip */}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      >
        <span className="block bg-slate-900 text-white text-xs leading-relaxed rounded-xl px-3.5 py-2.5 shadow-xl">
          {tooltip}
        </span>
        <span className="block w-0 h-0 mx-auto border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-900" />
      </span>
    </span>
  );
}

/** Displays escrow funding status badge with an explanatory hover tooltip. */
function EscrowStatusBadge({ balance }: { balance: EscrowState['balance'] | undefined }) {
  if (!balance) return null;

  if (balance.isFullyFunded) {
    return (
      <FundingTooltip
        label="Fully Funded"
        icon={<Shield className="w-3.5 h-3.5" />}
        classes="bg-emerald-100 text-emerald-700"
        tooltip="The client has deposited the FULL contract amount into escrow. This money is protected by Growlanzo and is released to you only after the client approves your completed work."
      />
    );
  }
  if (balance.isPartiallyFunded || balance.fundedAmount > 0) {
    return (
      <FundingTooltip
        label="Partially Funded"
        icon={<AlertTriangle className="w-3.5 h-3.5" />}
        classes="bg-amber-100 text-amber-700"
        tooltip="The client has deposited PART of the contract amount into escrow. The funded part is protected, but the remaining amount is not yet covered — remind the client to fund the rest before you deliver final work."
      />
    );
  }
  return (
    <FundingTooltip
        label="Not Funded"
        icon={<IndianRupee className="w-3.5 h-3.5" />}
        classes="bg-slate-100 text-slate-500"
        tooltip="The client has not deposited any money into escrow yet. You are not required to start working before escrow is funded — once the client funds it, the payment is protected on both sides."
      />
  );
}

export function ContractsPage() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<ContractWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'pending' | 'completed'>('all');
  // Once the user clicks a tab, stop auto-flipping (auto-select only until then)
  const userTouchedFilter = useRef(false);
  const [selectedContract, setSelectedContract] = useState<ContractWithDetails | null>(null);
  const [escrowModalContract, setEscrowModalContract] = useState<ContractWithDetails | null>(null);
  const [contractModalContract, setContractModalContract] = useState<ContractWithDetails | null>(null);
  const pageSize = 20;
  const pageRef = useRef(0);
  const [searchParams] = useSearchParams();

  // Honor ?tab= from the URL (e.g. after a review submit -> land on completed history)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'all' || tab === 'active' || tab === 'pending' || tab === 'completed') {
      setActiveTab(tab);
      userTouchedFilter.current = true;
    }
  }, [searchParams]);

  // Escrow balances keyed by contract ID
  const [escrowBalances, setEscrowBalances] = useState<Record<string, EscrowState>>({});
  // Action loading states
  const [releasingMilestone, setReleasingMilestone] = useState<{ contractId: string; idx: number } | null>(null);
  const [disputingMilestone, setDisputingMilestone] = useState<{ contractId: string; idx: number } | null>(null);
  const [disputeReason, setDisputeReason] = useState<string>('');
  const [disputeModal, setDisputeModal] = useState<{ contractId: string; idx: number } | null>(null);

  const fetchContracts = useCallback(async (loadMore = false) => {
    if (!user) return;

    try {
      const currentPage = pageRef.current;
      const from = loadMore ? (currentPage + 1) * pageSize : 0;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('contracts')
        .select(`
          *,
          project:projects(*),
          profiles!contracts_client_id_fkey(*)
        `)
        .eq('freelancer_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      if (data) {
        const newContracts = data as unknown as ContractWithDetails[];

        if (loadMore) {
          setContracts(prev => [...prev, ...newContracts]);
          pageRef.current = currentPage + 1;
        } else {
          setContracts(newContracts);
          pageRef.current = 0;

          // Load escrow balances only on initial load
          const balanceMap: Record<string, EscrowState> = {};
          await Promise.all(
            newContracts.map(async (contract) => {
              const result = await milestoneService.getEscrowBalance(contract.id);
              if (result.success && result.balance) {
                balanceMap[contract.id] = { loaded: true, balance: result.balance };
              } else {
                balanceMap[contract.id] = { loaded: true, error: result.error };
              }
            })
          );
          setEscrowBalances(balanceMap);
        }

        // Load escrow balances for new items if loading more
        if (loadMore) {
          const balanceMap: Record<string, EscrowState> = {};
          await Promise.all(
            newContracts.map(async (contract) => {
              const result = await milestoneService.getEscrowBalance(contract.id);
              if (result.success && result.balance) {
                balanceMap[contract.id] = { loaded: true, balance: result.balance };
              } else {
                balanceMap[contract.id] = { loaded: true, error: result.error };
              }
            })
          );
          setEscrowBalances(prev => ({ ...prev, ...balanceMap }));
        }

        setHasMore(newContracts.length === pageSize);
      }

      setLoading(false);
      setLoadingMore(false);
    } catch (error) {
      console.error('Error fetching contracts:', error);
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user, pageSize]);

  useEffect(() => {
    if (!user) return;

    // Add timeout to prevent infinite loading - reduced to 3 seconds for faster UX
    const timeoutId = setTimeout(() => {
      if (loading) {
        setLoading(false);
      }
    }, 3000);

    fetchContracts();

    // Real-time subscription for contract updates
    const channel = realtimeChannels.contracts(`contracts-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contracts',
          filter: `freelancer_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setContracts(prev =>
              prev.map((c) =>
                c.id === payload.new.id ? { ...c, ...payload.new } : c
              )
            );
            milestoneService.getEscrowBalance(payload.new.id).then((result) => {
              if (result.success && result.balance) {
                setEscrowBalances(prev => ({
                  ...prev,
                  [payload.new.id]: { loaded: true, balance: result.balance },
                }));
              }
            });
          } else if (payload.eventType === 'INSERT') {
            supabase
              .from('contracts')
              .select(`
                *,
                project:projects(*),
                profiles!contracts_client_id_fkey(*)
              `)
              .eq('id', payload.new.id)
              .single()
              .then(({ data }) => {
                if (data) {
                  // Dedup by id — realtime can deliver the same INSERT twice;
                  // never render duplicate contracts.
                  const incoming = data as unknown as ContractWithDetails;
                  setContracts(prev =>
                    prev.some(c => c.id === incoming.id)
                      ? prev
                      : [incoming, ...prev]
                  );
                  milestoneService.getEscrowBalance(payload.new.id).then((result) => {
                    if (result.success && result.balance) {
                      setEscrowBalances(prev => ({
                        ...prev,
                        [payload.new.id]: { loaded: true, balance: result.balance },
                      }));
                    }
                  });
                }
              });
          }
        }
      )
      .subscribe();

    return () => {
      clearTimeout(timeoutId);
      channel.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchContracts]);

  const filteredContracts = contracts.filter((c) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'active') return ACTIVE_STATUSES.includes(c.status || '');
    if (activeTab === 'pending') return PENDING_STATUSES.includes(c.status || '');
    if (activeTab === 'completed') return c.status === 'completed';
    return true;
  });

  const activeCount = contracts.filter((c) => ACTIVE_STATUSES.includes(c.status || '')).length;
  const pendingCount = contracts.filter((c) => PENDING_STATUSES.includes(c.status || '')).length;
  const completedCount = contracts.filter((c) => c.status === 'completed').length;

  // Auto-select the tab that matches the user's current state — Active → Pending →
  // Completed → All — until they manually pick one. Re-runs on realtime updates so
  // the user always lands on (and follows) the workflow stage they are in.
  useEffect(() => {
    if (userTouchedFilter.current) return;
    if (contracts.some((c) => ACTIVE_STATUSES.includes(c.status || ''))) {
      setActiveTab('active');
    } else if (contracts.some((c) => PENDING_STATUSES.includes(c.status || ''))) {
      setActiveTab('pending');
    } else if (contracts.some((c) => c.status === 'completed')) {
      setActiveTab('completed');
    } else {
      setActiveTab('all');
    }
  }, [contracts]);

  // Earnings = money actually released to the wallet (completed contracts only).
  // Active contracts are still in escrow — counting them here would overstate
  // earnings and contradict the "Escrow Held" stat right next to it.
  const totalEarnings = contracts
    .filter((c) => c.status === 'completed')
    .reduce((sum, c) => sum + c.freelancer_amount, 0);

  const totalEscrowHeld = Object.values(escrowBalances).reduce(
    (sum, state) => sum + (state.balance?.heldAmount || 0),
    0
  );

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'active':
      case 'in_progress':
        return 'In Progress';
      case 'submitted':
        return 'Submitted';
      case 'revision_requested':
        return 'Revision Requested';
      case 'approved':
        return 'Approved';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      case 'refunded':
        return 'Refunded';
      case 'disputed':
        return 'Disputed';
      case 'closed':
        return 'Closed';
      case 'draft':
        return 'Draft';
      case 'pending':
        return 'Pending';
      default:
        return status || 'Pending';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
      case 'in_progress':
        return (
          <span className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full">
            <Clock className="w-3.5 h-3.5" />
            In Progress
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 text-sm font-medium rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case 'cancelled':
        return (
          <span className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-full">
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  const formatCurrency = (amount: number) => {
    // NaN-safe — contracts can have null/undefined amounts; never render ₹NaN.
    const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(safeAmount);
  };

  const handleReleaseMilestone = async (contractId: string, milestoneIndex: number) => {
    setReleasingMilestone({ contractId, idx: milestoneIndex });
    try {
      // Call releaseMilestonePayment — uses the release_milestone RPC which
      // has FOR UPDATE row locking to prevent double-release race conditions.
      const result = await milestoneService.releaseMilestonePayment(contractId, milestoneIndex);
      if (!result.success) {
        console.error('Failed to release milestone payment:', result.error);
      }
      // Refresh escrow balance
      const balanceResult = await milestoneService.getEscrowBalance(contractId);
      if (balanceResult.success && balanceResult.balance) {
        setEscrowBalances(prev => ({
          ...prev,
          [contractId]: { loaded: true, balance: balanceResult.balance },
        }));
      }
    } finally {
      setReleasingMilestone(null);
    }
  };

  const handleDisputeMilestone = async () => {
    if (!disputeModal) return;
    const { contractId, idx } = disputeModal;
    if (!disputeReason.trim()) return;

    setDisputingMilestone({ contractId, idx });
    try {
      const result = await milestoneService.disputeMilestone(
        contractId,
        idx,
        disputeReason.trim(),
        disputeReason.trim()
      );
      if (!result.success) {
        console.error('Failed to dispute milestone:', result.error);
      }
      setDisputeModal(null);
      setDisputeReason('');
      // Refresh escrow balance
      const balanceResult = await milestoneService.getEscrowBalance(contractId);
      if (balanceResult.success && balanceResult.balance) {
        setEscrowBalances(prev => ({
          ...prev,
          [contractId]: { loaded: true, balance: balanceResult.balance },
        }));
      }
    } finally {
      setDisputingMilestone(null);
    }
  };

  const milestones = (raw: unknown): MilestoneItem[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as MilestoneItem[];
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) as MilestoneItem[]; } catch { return []; }
    }
    return [];
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
            <Handshake className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2 flex-wrap">My Contracts <InfoTip title="How contracts & money work" text="1) Client hires you → contract is Pending. 2) Client funds escrow → contract becomes Active. 3) You deliver work in the Workspace → client approves. 4) Funds release to your wallet. If the client doesn't respond after delivery, funds auto-release after the review window. Everything stays protected in escrow — no payment ever happens outside Growlanzo." /></h1>
            <p className="text-slate-500">
              {activeCount} active contract{activeCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="px-4 py-2 bg-emerald-50 rounded-xl border border-emerald-100">
            <p className="text-xs text-emerald-600">Total Earnings</p>
            <p className="text-xl font-bold text-emerald-700">{formatCurrency(totalEarnings)}</p>
          </div>
          <div className="px-4 py-2 bg-blue-50 rounded-xl border border-blue-100">
            <p className="text-xs text-blue-600">Escrow Held</p>
            <p className="text-xl font-bold text-blue-700">{formatCurrency(totalEscrowHeld)}</p>
          </div>
        </div>
      </div>

      {/* How-it-works strip — hover the funding badges on any contract for details */}
      <InfoTip title="Your money is always protected" text="The{' '}funding badges on each contract (Not Funded / Partially Funded / Fully Funded) tell you exactly where escrow stands. Work confidently — payment releases to your wallet only after the client approves your work, or automatically once the review window passes." />

      {/* Tabs — workflow order: All → Active → Pending → Completed.
          Wrap (not horizontal scroll) on mobile so no tab is ever cut off. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0 border-b border-slate-200">
        <button
          onClick={() => { userTouchedFilter.current = true; setActiveTab('all'); }}
          className={`px-3 sm:px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'all'
              ? 'text-emerald-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          All
          {activeTab === 'all' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></span>
          )}
        </button>
        <button
          onClick={() => { userTouchedFilter.current = true; setActiveTab('active'); }}
          className={`px-3 sm:px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'active'
              ? 'text-emerald-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Active
          {activeCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-blue-500 text-white text-xs rounded-full">
              {activeCount}
            </span>
          )}
          {activeTab === 'active' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></span>
          )}
        </button>
        <button
          onClick={() => { userTouchedFilter.current = true; setActiveTab('pending'); }}
          className={`px-3 sm:px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'pending'
              ? 'text-emerald-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Pending
          {pendingCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-amber-500 text-white text-xs rounded-full">
              {pendingCount}
            </span>
          )}
          {activeTab === 'pending' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></span>
          )}
        </button>
        <button
          onClick={() => { userTouchedFilter.current = true; setActiveTab('completed'); }}
          className={`px-3 sm:px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'completed'
              ? 'text-emerald-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Completed
          {completedCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full">
              {completedCount}
            </span>
          )}
          {activeTab === 'completed' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></span>
          )}
        </button>
      </div>

      {/* Contracts List */}
      {filteredContracts.length > 0 ? (
        <>
          <div className="space-y-4">
            {filteredContracts.map((contract) => {
            const contractMilestones = milestones(contract.milestones);
            const escrowState = escrowBalances[contract.id];
            const balance = escrowState?.balance;

            return (
              <div
                key={contract.id}
                className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setSelectedContract(selectedContract?.id === contract.id ? null : contract)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mb-3">
                      <h3 className="font-display text-xl font-bold text-slate-900 break-words min-w-0">
                        {contract.project?.title || 'Project'}
                      </h3>
                      {getStatusBadge(contract.status || 'active')}
                      {balance && <EscrowStatusBadge balance={balance} />}
                    </div>

                    {/* Client Info */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mb-2">
                      <span className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        Client: <span className="font-medium text-slate-700 flex items-center gap-1">
                          {contract.profiles?.name}
                          {contract.profiles?.verification_status === 'verified' && <VerifiedBadge size="xs" tone="blue" />}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        Started {safeFormatDate(contract.start_date) || '—'}
                      </span>
                      {contract.end_date && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          Ends {safeFormatDate(contract.end_date)}
                        </span>
                      )}
                    </div>

                    {/* Financial Details — 2-col grid on mobile so ₹ tiles stay readable */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-2">
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500 mb-1">Contract Value</p>
                        <p className="text-xl font-bold text-slate-900">{formatCurrency(contract.amount)}</p>
                      </div>
                      <div className="p-3 bg-emerald-50 rounded-xl">
                        <p className="text-xs text-emerald-600 mb-1">Your Earnings</p>
                        <p className="text-xl font-bold text-emerald-700">{formatCurrency(contract.freelancer_amount)}</p>
                      </div>
                      <div className="p-3 bg-blue-50 rounded-xl">
                        <p className="text-xs text-blue-600 mb-1">Platform Fee (paid by client)</p>
                        <p className="text-xl font-bold text-blue-700">{formatCurrency(contract.platform_fee)}</p>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-xl">
                        <p className="text-xs text-purple-600 mb-1">Status</p>
                        <p className="text-xl font-bold text-purple-700 capitalize">{getStatusLabel(contract.status || '')}</p>
                      </div>
                      {/* Escrow Balance Indicator */}
                      <div className={`p-3 rounded-xl max-sm:col-span-2 ${
                        balance?.isFullyFunded
                          ? 'bg-emerald-50'
                          : balance && balance.fundedAmount > 0
                          ? 'bg-amber-50'
                          : 'bg-slate-50'
                      }`}>
                        <p className="text-xs text-slate-500 mb-1">Escrow</p>
                        <p className={`text-xl font-bold ${
                          balance?.isFullyFunded
                            ? 'text-emerald-700'
                            : balance && balance.fundedAmount > 0
                            ? 'text-amber-700'
                            : 'text-slate-500'
                        }`}>
                          {formatCurrency(balance?.heldAmount || 0)}
                        </p>
                        {balance && (
                          <p className="text-xs mt-0.5 text-slate-400">
                            {balance.isFullyFunded
                              ? 'Fully funded'
                              : balance.fundedAmount > 0
                              ? `${formatCurrency(balance.fundedAmount)} funded`
                              : 'Not funded'}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Milestone Progress Bar */}
                    {contractMilestones.length > 0 && (
                      <div className="mb-2">
                        <MilestoneProgressBar milestones={contractMilestones} />
                      </div>
                    )}

                    {/* Milestones */}
                    {contractMilestones.length > 0 && (
                      <div className="mb-2">
                        <p className="text-sm font-medium text-slate-700 mb-2">Milestones</p>
                        <div className="space-y-4">
                          {contractMilestones.map((milestone, idx) => {
                            const mStatus = String(milestone.status || 'pending').toLowerCase();
                            const isCompleted = ['completed', 'approved', 'released', 'paid'].includes(mStatus);
                            const isDisputed = mStatus === 'disputed';
                            const isInProgress = mStatus === 'in_progress';

                            return (
                              <div
                                key={idx}
                                className={`flex items-center justify-between p-3 rounded-lg ${
                                  isCompleted
                                    ? 'bg-emerald-50'
                                    : isDisputed
                                    ? 'bg-red-50'
                                    : 'bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                    isCompleted
                                      ? 'bg-emerald-500 text-white'
                                      : isDisputed
                                      ? 'bg-red-500 text-white'
                                      : isInProgress
                                      ? 'bg-blue-500 text-white'
                                      : 'bg-slate-200 text-slate-600'
                                  }`}>
                                    {isCompleted ? (
                                      <CheckCircle2 className="w-4 h-4" />
                                    ) : isDisputed ? (
                                      <AlertCircle className="w-4 h-4" />
                                    ) : (
                                      idx + 1
                                    )}
                                  </span>
                                  <div>
                                    <span className="text-sm text-slate-700">{milestone.title || `Milestone ${idx + 1}`}</span>
                                    <span className={`ml-2 text-xs font-medium capitalize ${
                                      isCompleted
                                        ? 'text-emerald-600'
                                        : isDisputed
                                        ? 'text-red-600'
                                        : 'text-slate-400'
                                    }`}>
                                      {mStatus.replace('_', ' ')}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-medium text-slate-900">
                                    {formatCurrency(milestone.amount || 0)}
                                  </span>

                                  {/* Release Payment button - shown when milestone is completed and not yet released */}
                                  {mStatus === 'completed' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReleaseMilestone(contract.id, idx);
                                      }}
                                      disabled={releasingMilestone?.contractId === contract.id && releasingMilestone?.idx === idx}
                                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                                    >
                                      {releasingMilestone?.contractId === contract.id && releasingMilestone?.idx === idx ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <ThumbsUp className="w-3.5 h-3.5" />
                                      )}
                                      Release
                                    </button>
                                  )}

                                  {/* Dispute button - shown when milestone is in progress or completed but not released */}
                                  {(isInProgress || mStatus === 'completed') && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDisputeModal({ contractId: contract.id, idx });
                                        setDisputeReason('');
                                      }}
                                      className="px-3 py-1.5 border border-red-200 hover:bg-red-50 text-red-600 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                                    >
                                      <AlertTriangle className="w-3.5 h-3.5" />
                                      Dispute
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Escrow Balance Summary */}
                    {balance && (
                      <div className="mb-2 p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600 font-medium">Escrow Summary</span>
                          <span className="text-xs text-slate-400">
                            {balance.milestoneCount > 0
                              ? `${balance.fundedMilestoneCount} of ${balance.milestoneCount} milestones funded`
                              : 'Full contract escrow'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 mt-2">
                          <div>
                            <p className="text-xs text-slate-500">Funded</p>
                            <p className="text-sm font-bold text-slate-900">{formatCurrency(balance.fundedAmount)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Held</p>
                            <p className="text-sm font-bold text-emerald-700">{formatCurrency(balance.heldAmount)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Released</p>
                            <p className="text-sm font-bold text-blue-700">{formatCurrency(balance.releasedAmount)}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1.5">
                      <Link
                        to={`/dashboard/workspace?contract=${contract.id}`}
                        className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors inline-flex items-center gap-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Briefcase className="w-4 h-4" />
                        Workspace
                      </Link>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setContractModalContract(contract);
                        }}
                        icon={<FileText className="w-4 h-4" />}
                      >
                        View Contract
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEscrowModalContract(contract);
                        }}
                        icon={<Shield className="w-4 h-4" />}
                      >
                        Escrow Details
                      </Button>
                    </div>
                  </div>

                  <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${selectedContract?.id === contract.id ? 'rotate-90' : ''}`} />
                </div>
              </div>
            );
          }            )}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => { setLoadingMore(true); fetchContracts(true); }}
                disabled={loadingMore}
                className="flex items-center gap-3 px-3 py-3 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
              >
                {loadingMore ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</>
                ) : (
                  <><ChevronDown className="w-4 h-4" /> Load More Contracts</>
                )}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-xl p-12 border border-slate-100 text-center">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Handshake className="w-7 h-7 text-slate-400" />
          </div>
          <h3 className="font-display text-xl font-bold text-slate-900 mb-2">
            {activeTab === 'active'
              ? 'No active contracts'
              : activeTab === 'pending'
              ? 'No pending contracts'
              : activeTab === 'completed'
              ? 'No completed contracts yet'
              : 'No contracts'}
          </h3>
          <p className="text-slate-500 max-w-md mx-auto mb-3">
            {activeTab === 'active'
              ? 'You have no active contracts. Submit proposals to get hired!'
              : activeTab === 'pending'
              ? 'Pending contracts will appear here once a client hires you.'
              : activeTab === 'completed'
              ? 'Your completed contracts will appear here. Keep up the good work!'
              : 'Start your freelance journey by submitting proposals to projects.'}
          </p>
          <Link
            to="/dashboard/feed"
            className="inline-flex items-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
          >
            Browse Projects
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Dispute Modal */}
      {disputeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setDisputeModal(null); setDisputeReason(''); }}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-7 h-7 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Dispute Milestone</h3>
            </div>

            <p className="text-sm text-slate-600 mb-2">
              Are you sure you want to dispute milestone "{milestones(
                contracts.find((c) => c.id === disputeModal.contractId)?.milestones
              )[disputeModal.idx]?.title || `Milestone ${disputeModal.idx + 1}`}"?
              This will create a dispute case that needs resolution.
            </p>

            <div className="mb-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Reason for Dispute
              </label>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Describe the issue with this milestone..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                rows={3}
              />
            </div>

            <div className="flex gap-1.5">
              <button
                onClick={() => { setDisputeModal(null); setDisputeReason(''); }}
                className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDisputeMilestone}
                disabled={!disputeReason.trim() || disputingMilestone !== null}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-medium rounded-lg transition-colors text-sm flex items-center justify-center gap-3"
              >
                {disputingMilestone ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    Submit Dispute
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contract Details Modal — real-time view of the contract without
          leaving the page. Workspace stays reserved for actual collaboration. */}
      {contractModalContract && (() => {
        const cc = contractModalContract;
        const cBalance = escrowBalances[cc.id]?.balance;
        const cMilestones = milestones(cc.milestones);

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setContractModalContract(null)}
          >
            <div
              className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-3 bg-gradient-to-r from-slate-800 to-slate-900 rounded-t-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-11 h-11 bg-white/15 rounded-xl flex items-center justify-center">
                      <FileText className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-display text-xl font-bold text-white">Contract Details</h3>
                      <p className="text-sm text-slate-300">{cc.project?.title || 'Contract'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setContractModalContract(null)}
                    className="w-8 h-8 bg-white/15 hover:bg-white/25 rounded-full flex items-center justify-center text-white transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-3 space-y-4.5">
                {/* Status + Parties */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {getStatusBadge(cc.status || 'active')}
                  {cBalance && <EscrowStatusBadge balance={cBalance} />}
                  <span className="text-sm text-slate-500">
                    Client: <span className="font-semibold text-slate-800 flex items-center gap-1">
                      {cc.profiles?.name || '—'}
                      {cc.profiles?.verification_status === 'verified' && <VerifiedBadge size="xs" tone="blue" />}
                    </span>
                  </span>
                </div>

                {/* Money breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">Contract Value</p>
                    <p className="text-xl font-bold text-slate-900">{formatCurrency(cc.amount)}</p>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-xl">
                    <p className="text-xs text-emerald-600 mb-1">Your Earnings (100%)</p>
                    <p className="text-xl font-bold text-emerald-700">{formatCurrency(cc.freelancer_amount)}</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-xl">
                    <p className="text-xs text-blue-600 mb-1">Platform Fee (paid by client)</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(cc.platform_fee)}</p>
                  </div>
                </div>

                {/* Commission note — withheld from the payout, never added to the client */}
                <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <Shield className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    <strong>You keep 95% of your contract value.</strong> Growlanzo&apos;s flat 5% commission is deducted
                    once, when the payment is released to your wallet. The client pays exactly the agreed
                    amount — nothing is added to their invoice.
                  </p>
                </div>

                {/* Escrow summary */}
                {cBalance && (
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-slate-700">Escrow Summary</p>
                      <span className="text-xs text-slate-400">
                        {cBalance.milestoneCount > 0
                          ? `${cBalance.fundedMilestoneCount} of ${cBalance.milestoneCount} milestones funded`
                          : 'Full contract escrow'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <p className="text-xs text-slate-500">Funded</p>
                        <p className="text-sm font-bold text-emerald-700">{formatCurrency(cBalance.fundedAmount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Held</p>
                        <p className="text-sm font-bold text-slate-900">{formatCurrency(cBalance.heldAmount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Released</p>
                        <p className="text-sm font-bold text-blue-700">{formatCurrency(cBalance.releasedAmount)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-sm">
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-0.5">Created</p>
                    <p className="font-medium text-slate-800">{safeFormatDate(cc.created_at) || '—'}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-0.5">Started</p>
                    <p className="font-medium text-slate-800">{safeFormatDate(cc.start_date) || '—'}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-0.5">Deadline / Ends</p>
                    <p className="font-medium text-slate-800">{safeFormatDate(cc.end_date) || '—'}</p>
                  </div>
                </div>

                {/* Milestones */}
                {cMilestones.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Milestones ({cMilestones.length})</p>
                    <div className="space-y-4 pr-1">
                      {cMilestones.map((m, idx) => {
                        const mStatus = String(m.status || 'pending').toLowerCase();
                        const isDone = ['completed', 'approved', 'released', 'paid'].includes(mStatus);
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between p-3 rounded-xl border ${
                              isDone ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  isDone ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-white'
                                }`}
                              >
                                {isDone ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                              </span>
                              <span className="text-sm text-slate-700">{m.title || `Milestone ${idx + 1}`}</span>
                            </div>
                            <span className="text-sm font-bold text-slate-900">{formatCurrency(m.amount || 0)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* CTA */}
                <div className="flex flex-col sm:flex-row gap-1.5 pt-2">
                  <Link
                    to={`/dashboard/workspace?contract=${cc.id}`}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-3"
                  >
                    <Briefcase className="w-4 h-4" />
                    Open Workspace
                  </Link>
                  <button
                    onClick={() => {
                      setContractModalContract(null);
                      setEscrowModalContract(cc);
                    }}
                    className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-3"
                  >
                    <Shield className="w-4 h-4" />
                    Escrow Details
                  </button>
                </div>

                {/* Safety note */}
                <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <Shield className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700 leading-relaxed">
                    This contract is protected by Growlanzo Escrow. Funds are only released after the
                    client approves your completed work — payments never go outside the platform.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Escrow Details Modal */}
      {escrowModalContract && (() => {
        const ec = escrowModalContract;
        const escrowState = escrowBalances[ec.id];
        const balance = escrowState?.balance;
        const escrowMilestones = milestones(ec.milestones);
        const totalAmount = balance?.totalAmount ?? ec.amount ?? 0;
        const funded = balance?.fundedAmount ?? 0;
        const held = balance?.heldAmount ?? 0;
        const released = balance?.releasedAmount ?? 0;
        const fundedPct = totalAmount > 0 ? Math.round((funded / totalAmount) * 100) : 0;
        const releasedPct = totalAmount > 0 ? Math.round((released / totalAmount) * 100) : 0;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setEscrowModalContract(null)}
          >
            <div
              className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-t-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center">
                      <Shield className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-display text-xl font-bold text-white">Escrow Details</h3>
                      <p className="text-sm text-emerald-100">{ec.project?.title || 'Contract'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEscrowModalContract(null)}
                    className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-3">
                {/* Contract breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mb-2.5">
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">Contract Value</p>
                    <p className="text-xl font-bold text-slate-900">{formatCurrency(ec.amount)}</p>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-xl">
                    <p className="text-xs text-emerald-600 mb-1">Your Earnings (100%)</p>
                    <p className="text-xl font-bold text-emerald-700">{formatCurrency(ec.freelancer_amount)}</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-xl">
                    <p className="text-xs text-blue-600 mb-1">Platform Fee (paid by client)</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(ec.platform_fee)}</p>
                  </div>
                </div>

                {/* Commission note — withheld from the payout, never added to the client */}
                <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl mb-2.5">
                  <Shield className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    <strong>You keep 95% of your contract value.</strong> Growlanzo&apos;s flat 5% commission is deducted
                    once, when the payment is released to your wallet. The client pays exactly the agreed
                    amount — nothing is added to their invoice.
                  </p>
                </div>

                {/* Escrow status + funding progress */}
                <div className="mb-2.5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-slate-700">Escrow Status</p>
                    <EscrowStatusBadge balance={balance} />
                  </div>

                  <div className="mb-2">
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-medium text-slate-700">Funding Progress</span>
                      <span className="font-bold text-emerald-600">{fundedPct}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5">
                      <div
                        className="h-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
                        style={{ width: `${fundedPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-slate-400">
                      <span>{formatCurrency(funded)} funded</span>
                      <span>{formatCurrency(totalAmount)} contract value</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm mb-1.5 mt-4">
                    <span className="font-medium text-slate-700">Release Progress</span>
                    <span className="font-bold text-blue-600">{releasedPct}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 transition-all duration-500"
                      style={{ width: `${releasedPct}%` }}
                    />
                  </div>
                </div>

                {/* Funded / Held / Released */}
                <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                  <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                    <p className="text-xs text-emerald-600 font-medium mb-1">Funded</p>
                    <p className="text-xl font-bold text-emerald-700">{formatCurrency(funded)}</p>
                  </div>
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <p className="text-xs text-blue-600 font-medium mb-1">Held in Escrow</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(held)}</p>
                  </div>
                  <div className="p-4 bg-purple-50 border border-purple-100 rounded-xl">
                    <p className="text-xs text-purple-600 font-medium mb-1">Released</p>
                    <p className="text-xl font-bold text-purple-700">{formatCurrency(released)}</p>
                  </div>
                </div>

                {/* Milestones breakdown */}
                <p className="text-sm font-medium text-slate-700 mb-2">Milestone Breakdown</p>
                {escrowMilestones.length > 0 ? (
                  <div className="space-y-4 mb-2.5">
                    {escrowMilestones.map((m, idx) => {
                      const mStatus = String(m.status || 'pending').toLowerCase();
                      const isReleased = ['completed', 'approved', 'released', 'paid'].includes(mStatus);
                      const isDisputed = mStatus === 'disputed';
                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between p-3 rounded-xl border ${
                            isReleased
                              ? 'bg-emerald-50 border-emerald-100'
                              : isDisputed
                              ? 'bg-red-50 border-red-100'
                              : 'bg-slate-50 border-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                isReleased
                                  ? 'bg-emerald-500 text-white'
                                  : isDisputed
                                  ? 'bg-red-500 text-white'
                                  : 'bg-slate-300 text-white'
                              }`}
                            >
                              {isReleased ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : isDisputed ? (
                                <AlertTriangle className="w-4 h-4" />
                              ) : (
                                idx + 1
                              )}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-slate-800">{m.title || `Milestone ${idx + 1}`}</p>
                              <p className="text-xs text-slate-500 capitalize">{mStatus.replace('_', ' ')}</p>
                            </div>
                          </div>
                          <span className="text-sm font-bold text-slate-900">{formatCurrency(m.amount || 0)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 text-center py-4 bg-slate-50 rounded-xl mb-2.5">
                    This contract has no milestones — the full amount is protected as a single escrow.
                  </div>
                )}

                {/* Safety note */}
                <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <Shield className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700 leading-relaxed">
                    Funds are held securely in Growlanzo Escrow protection and are released to your
                    wallet only after the client approves the work. Escrow keeps payments safe for both sides.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
