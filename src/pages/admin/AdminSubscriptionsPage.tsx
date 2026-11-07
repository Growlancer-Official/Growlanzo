import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap, Crown, Loader2, RefreshCw, Search, Ban, Mail, RotateCcw, Clock, Trash2
} from 'lucide-react';
import { adminQuery, adminUpdate, adminDelete } from '../../lib/adminDataProxy';
import { fetchProfileDirectory } from '../../lib/adminProfileDirectory';
import { supabase, realtimeChannels } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import { ConfirmModal } from '../../components/ConfirmModal';
import { paypalService } from '../../lib/paypal';

interface SubscriptionPlan {
  id: string; name: string; description: string | null; price: number;
  interval: string; features: Record<string, unknown> | null; active: boolean;
}

interface UserSubscription {
  id: string; user_id: string; plan_id: string; status: string;
  // The live table carries BOTH generations of columns: legacy `start_date` /
  // `expiry_date` and the canonical `subscription_start_date` /
  // `subscription_end_date` (what the billing cron and the user-facing
  // subscription page use). Selecting `end_date` rejected the whole request —
  // that column does not exist, which is why this page showed nothing.
  start_date: string | null; expiry_date: string | null;
  subscription_start_date: string | null; subscription_end_date: string | null;
  created_at: string;
  payment_provider: string | null;
  payment_subscription_id: string | null;
  profile?: { name: string; email: string } | null;
  plan?: { name: string; price: number } | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
}

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400',
  cancelled: 'bg-red-500/10 text-red-400',
  expired: 'bg-slate-500/10 text-slate-400',
  pending: 'bg-amber-500/10 text-amber-400',
};

export function AdminSubscriptionsPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info';
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const toast = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, subsRes] = await Promise.all([
        adminQuery({ table: 'subscription_plans', select: '*', order: 'price', orderDir: 'asc' }),
        adminQuery({
          table: 'subscriptions',
          select: 'id, user_id, plan_id, status, start_date, expiry_date, subscription_start_date, subscription_end_date, created_at, payment_provider, payment_subscription_id',
          order: 'created_at',
          orderDir: 'desc',
          limit: 100,
        }),
      ]);

      const plansData = (plansRes.data || []) as SubscriptionPlan[];
      const subsData = (subsRes.data || []) as UserSubscription[];

      // `email` moved to profiles_private (migration 20261221000000) — querying
      // it from profiles rejected the whole request and blanked the table.
      const profileMap = await fetchProfileDirectory(subsData.map(s => s.user_id));
      const planMap = new Map(plansData.map(p => [p.id, { name: p.name, price: p.price }]));

      setPlans(plansData);
      setSubscriptions(subsData.map(s => ({
        ...s,
        profile: profileMap.get(s.user_id) || null,
        plan: planMap.get(s.plan_id) || null,
      })));
    } catch (err) { 
      console.error('Failed to fetch subscriptions:', err);
      toast.error('Failed to fetch subscriptions', err instanceof Error ? err.message : 'Unknown error');
    }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const channel = realtimeChannels.profiles(`admin-subs-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscription_plans' }, () => fetchData())
      .subscribe();
    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [fetchData]);

  // ─── ACTIONS ─────────────────────────────────────────────────────
  const handleCancelSubscription = async (subId: string, userName: string, sub?: UserSubscription) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Cancel Subscription',
      message: `🚫 Cancel subscription for "${userName}"? They will lose Pro access immediately.`,
      variant: 'danger',
      confirmLabel: 'Cancel Subscription',
      onConfirm: async () => {
        setActionLoading(`cancel-${subId}`);
        try {
          // Cancel via payment provider API if a PayPal subscription ID exists
          if (sub?.payment_provider === 'paypal' && sub?.payment_subscription_id) {
            try {
              await paypalService.cancelSubscription(sub.payment_subscription_id);
            } catch (e) {
              console.warn('PayPal cancel failed, continuing with DB update:', e);
              // Non-critical — DB update will still proceed
            }
          }

          // Write the canonical end columns on the live table. The legacy
          // `end_date` / `auto_renew` columns were already dropped in the live
          // schema reconcile migration; this path writes the live canonical
          // columns only (subscription_end_date / expiry_date).
          const cancelledAt = new Date().toISOString();
          await adminUpdate('subscriptions', subId, {
            status: 'cancelled',
            subscription_end_date: cancelledAt,
            expiry_date: cancelledAt,
            cancel_at_period_end: true,
          });
          await fetchData();
          toast.success(`Subscription cancelled for "${userName}"`);
          setConfirmDialog(null);
        } catch (err) { 
          console.error(err);
          toast.error('Failed to cancel subscription', err instanceof Error ? err.message : 'Unknown error');
        }
        finally { setActionLoading(null); }
      },
    });
  };

  const handleReactivateSubscription = async (subId: string, userName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Reactivate Subscription',
      message: `🔄 Reactivate subscription for "${userName}"? They will regain Pro access.`,
      variant: 'warning',
      confirmLabel: 'Reactivate',
      onConfirm: async () => {
        setActionLoading(`reactivate-${subId}`);
        try {
          await adminUpdate('subscriptions', subId, {
            status: 'active',
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          });
          await fetchData();
          toast.success(`Subscription reactivated for "${userName}"`);
          setConfirmDialog(null);
        } catch (err) { 
          console.error(err);
          toast.error('Failed to reactivate subscription', err instanceof Error ? err.message : 'Unknown error');
        }
        finally { setActionLoading(null); }
      },
    });
  };

  const handleDeleteSubscription = async (subId: string, userName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Subscription',
      message: `🗑️ Delete subscription record for "${userName}"? This cannot be undone!`,
      variant: 'danger',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setActionLoading(`delete-${subId}`);
        try {
          await adminDelete('subscriptions', subId);
          await fetchData();
          toast.success(`Subscription deleted for "${userName}"`);
          setConfirmDialog(null);
        } catch (err) { 
          console.error(err);
          toast.error('Failed to delete subscription', err instanceof Error ? err.message : 'Unknown error');
        }
        finally { setActionLoading(null); }
      },
    });
  };

  const handleSendEmail = (email: string) => {
    window.open(`mailto:${email}?subject=Growlanzo%20Subscription%20Update`, '_blank');
  };

  // ─── STATS ────────────────────────────────────────────────────────
  const activeSubs = subscriptions.filter(s => s.status === 'active');
  const monthlyMRR = activeSubs.reduce((sum, s) => {
    const price = s.plan?.price || 0;
    return sum + (s.plan?.name?.toLowerCase().includes('yearly') ? price / 12 : price);
  }, 0);

  const filtered = subscriptions.filter(s =>
    (s.profile?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.plan?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  ).filter(s => statusFilter === 'all' || s.status === statusFilter);

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white">Subscriptions</h1>
          <p className="text-slate-400 text-sm mt-1">Manage plans and user subscriptions with full control</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Plans Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map(plan => (
          <div key={plan.id} className="p-4 rounded-2xl" style={{ background: '#1E293B', border: `1px solid ${plan.active ? 'rgba(36,186,53,0.2)' : 'rgba(255,255,255,0.05)'}` }}>
            <div className="flex items-center gap-2 mb-2">
              {plan.price > 0 ? <Crown className="w-4 h-4 text-amber-400" /> : <Zap className="w-4 h-4 text-slate-400" />}
              <h3 className="font-bold text-white text-sm">{plan.name}</h3>
              {!plan.active && <span className="text-[7px] bg-red-500/10 text-red-400 px-1 py-0.5 rounded uppercase font-bold">Inactive</span>}
            </div>
            <p className="text-xl font-bold text-white">{formatCurrency(plan.price)}<span className="text-xs text-slate-500 font-normal">/{plan.interval}</span></p>
            <p className="text-[9px] text-slate-500 mt-1">{plan.description}</p>
            <p className="mt-2 text-[9px] text-slate-500">{subscriptions.filter(s => s.plan_id === plan.id && s.status === 'active').length} active</p>
          </div>
        ))}
        <div className="p-4 rounded-2xl" style={{ background: '#1E293B', border: '1px solid rgba(36,186,53,0.2)' }}>
          <p className="text-slate-500 text-[9px] font-bold uppercase tracking-widest mb-1">Monthly Recurring Revenue</p>
          <p className="text-xl font-bold text-emerald-400">{formatCurrency(monthlyMRR)}</p>
          <p className="text-[9px] text-slate-500 mt-1">{activeSubs.length} active subscriptions</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between p-4 rounded-2xl"
        style={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by user or plan..." className="w-full pl-9 pr-3 py-2 bg-slate-800/50 border border-white/5 rounded-lg text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-800 border border-white/5 text-[10px] font-bold uppercase rounded-lg px-3 py-2 text-slate-300 cursor-pointer">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      {/* Subscriptions Table with Actions */}
      <div className="rounded-[2rem] overflow-hidden" style={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500 uppercase text-[10px] font-bold tracking-widest border-b border-white/5">
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Plan</th>
                <th className="px-6 py-4">Price</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-slate-500 mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500 text-xs">No subscriptions found</td></tr>
              ) : (
                filtered.map(sub => (
                  <tr key={sub.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-xs text-slate-300 font-bold">{sub.profile?.name || 'Unknown'}</p>
                      <p className="text-[10px] text-slate-500">{sub.profile?.email || ''}</p>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-300 font-bold">{sub.plan?.name || sub.plan_id}</td>
                    <td className="px-6 py-4 text-xs text-emerald-400 font-bold">{sub.plan?.price ? formatCurrency(sub.plan.price) : '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase ${statusColors[sub.status] || ''}`}>{sub.status}</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-[10px] text-slate-500">
                        {(() => {
                          const start = sub.subscription_start_date || sub.start_date;
                          const end = sub.subscription_end_date || sub.expiry_date;
                          return `${start ? new Date(start).toLocaleDateString() : '—'}${end ? ` → ${new Date(end).toLocaleDateString()}` : ''}`;
                        })()}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Send Email */}
                        {sub.profile?.email && (
                          <button onClick={() => handleSendEmail(sub.profile.email!)}
                            className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-emerald-400 transition-colors" title="Send Email">
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Cancel Subscription */}
                        {sub.status === 'active' && (
                          <button onClick={() => handleCancelSubscription(sub.id, sub.profile?.name || 'User', sub)}
                            disabled={actionLoading === `cancel-${sub.id}`}
                            className="p-1.5 hover:bg-red-500/10 rounded-lg text-red-400 transition-colors" title="Cancel Subscription">
                            {actionLoading === `cancel-${sub.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {/* Reactivate Subscription */}
                        {(sub.status === 'cancelled' || sub.status === 'expired') && (
                          <button onClick={() => handleReactivateSubscription(sub.id, sub.profile?.name || 'User')}
                            disabled={actionLoading === `reactivate-${sub.id}`}
                            className="p-1.5 hover:bg-emerald-500/10 rounded-lg text-emerald-400 transition-colors" title="Reactivate Subscription">
                            {actionLoading === `reactivate-${sub.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {/* Status indicator for pending */}
                        {sub.status === 'pending' && (
                          <span className="text-[9px] text-amber-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Awaiting
                          </span>
                        )}
                        <button onClick={() => handleDeleteSubscription(sub.id, sub.profile?.name || 'User')}
                          disabled={actionLoading === `delete-${sub.id}`}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg text-red-400 transition-colors" title="Delete Subscription">
                          {actionLoading === `delete-${sub.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmDialog && (
        <ConfirmModal
          isOpen={confirmDialog.isOpen}
          onClose={() => setConfirmDialog(null)}
          onConfirm={confirmDialog.onConfirm}
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel={confirmDialog.confirmLabel}
        />
      )}
    </div>
  );
}