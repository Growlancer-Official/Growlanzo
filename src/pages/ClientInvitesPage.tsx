import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { invitesService } from '../lib/dataService';
import { Calendar, Clock, MailCheck, MoreVertical, Plus, RefreshCw, Send, X } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { PageSkeleton } from '../components/PageSkeleton';
import { useToast } from '../components/Toast';
import { ProBadge } from '../components/ProBadge';

interface Invite {
  id: string;
  project_id: string;
  client_id: string;
  freelancer_id: string;
  message?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
  created_at: string;
  project?: {
    id: string;
    title: string;
  };
  freelancer?: {
    id: string;
    name: string;
    avatar?: string;
    email?: string;
    is_pro?: boolean;
    verification_status?: string | null;
  };  }

/* ── Dropdown menu for each invite card ── */
function InviteMenu({
  onCancel,
  onResend,
}: {
  onCancel: () => void;
  onResend: () => void;
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
        <div className="menu-surface absolute right-0 top-full mt-1 z-50 w-48 bg-white rounded-xl border border-slate-200 shadow-xl py-1.5 animate-in fade-in slide-in-from-top-1">
          <button
            onClick={() => { setOpen(false); onResend(); }}
            className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
            <span>Resend Invite</span>
          </button>
          <div className="h-px bg-slate-100 my-1.5 mx-3" />
          <button
            onClick={() => { setOpen(false); onCancel(); }}
            className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <X className="w-4 h-4" />
            <span>Cancel Invite</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function ClientInvitesPage() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'declined'>('all');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const toast = useToast();

  const fetchInvites = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await invitesService.getByClient(user.id);
      setInvites(data as unknown as Invite[]);
    } catch (error) {
      toast.error('Error', 'Failed to load invites.');
    } finally {
      setLoading(false);
    }
  }, [user?.id, toast]);

  const handleCancel = async (inviteId: string) => {
    setActionId(inviteId);
    const ok = await invitesService.cancel(inviteId);
    if (ok) await fetchInvites();
    setActionId(null);
  };

  const handleResend = async (inviteId: string) => {
    setActionId(inviteId);
    const ok = await invitesService.resend(inviteId);
    if (ok) await fetchInvites();
    setActionId(null);
  };

  useEffect(() => {
    if (!user) return;

    void fetchInvites();

    const sub = invitesService.subscribe(user.id, fetchInvites);
    return () => sub.unsubscribe();
  }, [user, fetchInvites]);

  const filteredInvites = invites.filter((i) =>
    filter === 'all' ? true : i.status === filter
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-700';
      case 'accepted':
        return 'bg-emerald-100 text-emerald-700';
      case 'declined':
        return 'bg-red-100 text-red-700';
      case 'expired':
        return 'bg-slate-100 text-slate-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
            <MailCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Invites <InfoTip title="What happens after you invite a freelancer" text="The freelancer sees your invite in real time and can Accept (a contract + workspace is created instantly with escrow protection) or Decline. You can Cancel a pending invite anytime or Resend it to give the freelancer a gentle nudge. Invites auto-expire after the shown deadline." /></h1>
          <p className="text-slate-500 mt-1">Manage invitations sent to freelancers</p>
          </div>
        </div>
        <Link
          to="/client/matches"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all shrink-0 whitespace-nowrap self-start sm:self-auto"
        >
          <Send className="w-4 h-4 shrink-0" />
          Send New Invite
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-3 border-b border-slate-200">
        {(['all', 'pending', 'accepted', 'declined'] as const).map((f) => (
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

      {/* Invites List */}
      {filteredInvites.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-xl border border-slate-100">
          <div className="w-20 h-20 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-2.5">
            <MailCheck className="w-7 h-7 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            {filter === 'all' ? 'No invites yet' : `No ${filter} invites`}
          </h3>
          <p className="text-slate-500 max-w-sm mx-auto mb-3">
            {filter === 'all'
              ? 'Browse AI-matched freelancers and send them personalized project invitations.'
              : `You don't have any ${filter} invites at the moment.`}
          </p>
          {filter === 'all' ? (
            <Link
              to="/client/matches"
              className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all"
            >
              <Plus className="w-4 h-4" />
              Send an Invite
            </Link>
          ) : (
            <Link
              to="/client/invites"
              className="text-emerald-600 font-medium hover:underline text-sm"
            >
              View all invites →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredInvites.map((invite) => {
            const expired = isExpired(invite.expires_at);
            return (
              <div
                key={invite.id}
                className={`bg-white p-6 rounded-xl border ${
                  expired ? 'border-slate-200 opacity-60' : 'border-slate-100'
                } hover:shadow-md transition-shadow`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {invite.freelancer?.avatar ? (
                        <img 
                          src={invite.freelancer.avatar} 
                          alt={invite.freelancer.name}
                          className="w-full h-full object-cover object-top"
                          style={{
                            objectPosition: 'center 20%',
                            filter: 'brightness(1.05) contrast(1.02)'
                          }}
                        />
                      ) : (
                        <MailCheck className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display font-bold text-slate-900 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        {invite.freelancer?.name || 'Unknown Freelancer'}
                                                {invite.freelancer?.is_pro && <ProBadge size="xs" />}
                      </h3>
                      <p className="text-sm text-slate-500 truncate">{invite.freelancer?.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${getStatusColor(
                        expired ? 'expired' : invite.status
                      )}`}
                    >
                      {expired ? 'Expired' : invite.status}
                    </span>
                    <InviteMenu onCancel={() => handleCancel(invite.id)} onResend={() => handleResend(invite.id)} />
                  </div>
                </div>

                {invite.project && (
                  <div className="mb-2 p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-600">
                      <span className="font-medium">Project:</span> {invite.project.title}
                    </p>
                  </div>
                )}

                {invite.message && (
                  <div className="mb-2 p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-600 italic">"{invite.message}"</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mb-2">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4" />
                    <span>Sent: {new Date(invite.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4" />
                    <span>
                      Expires: {new Date(invite.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {invite.status === 'pending' && !expired && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={actionId === invite.id}
                      onClick={() => void handleCancel(invite.id)}
                      className="flex items-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Cancel Invite
                    </button>
                    <button
                      type="button"
                      disabled={actionId === invite.id}
                      onClick={() => void handleResend(invite.id)}
                      className="flex items-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      Resend
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
