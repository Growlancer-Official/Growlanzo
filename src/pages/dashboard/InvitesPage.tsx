import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Briefcase, Calendar, CheckCircle2, Clock, Loader2, Mail, MessageSquare, Star, User, Wallet, XCircle } from 'lucide-react';
import { InfoTip } from '../../components/InfoTip';
import { useToast } from '../../components/Toast';
import { PageSkeleton } from '../../components/PageSkeleton';
import { useAuth } from '../../context/AuthContext';
import { supabase, dbFunctions, uniqueChannelName } from '../../lib/supabase';
import { formatBudgetRange, safeFormatDate } from '../../utils/date';
import type { Tables } from '../../types/supabase';

type InviteWithDetails = Tables<'invites'> & {
  projects: {
    title: string;
    description: string;
    budget_min: number | null;
    budget_max: number | null;
    skills_required: string[] | null;
    client_id: string;
    experience_level: string | null;
  };
  profiles: {
    id?: string;
    name: string;
    avatar: string | null;
    verification_status?: string | null;
  };
};

export function InvitesPage() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<InviteWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingInvite, setProcessingInvite] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'accepted' | 'declined'>('pending');
  const [newInviteAlert, setNewInviteAlert] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!user) return;

    const fetchInvites = async () => {
      try {
        const { data, error } = await supabase
          .from('invites')
          .select(`
            *,
            projects!inner(title, description, budget_min, budget_max, skills_required, client_id, experience_level),
            profiles!invites_client_id_fkey(name, avatar, deleted_at, verification_status, rating, total_reviews)
          `)
          .eq('freelancer_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (data) {
          // Filter out invites from deleted clients
          setInvites((data as unknown as InviteWithDetails[]).filter(i => {
            const clientProf = i.profiles as { deleted_at?: string | null } | null;
            return clientProf && !clientProf.deleted_at;
          }));
        }

        setLoading(false);
    } catch (error) {
      toast.error('Error', 'Failed to load invites.');
      setLoading(false);
    }
    };

    // Add timeout to prevent infinite loading - reduced to 3 seconds for faster UX
    const timeoutId = setTimeout(() => setLoading(false), 3000);

    fetchInvites();

    // Set up real-time subscription for invites
    const invitesChannel = supabase
      .channel(uniqueChannelName('invites-changes'))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invites',
          filter: `freelancer_id=eq.${user.id}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // Fetch new invite with details
            const fetchNewInvite = async () => {
              const { data } = await supabase
                .from('invites')
                .select(`
                  *,
                  projects!inner(title, description, budget_min, budget_max, skills_required, client_id, experience_level),
                  profiles!invites_client_id_fkey(name, avatar, deleted_at, verification_status, rating, total_reviews)
                `)
                .eq('id', payload.new.id)
                .single();
              
              if (data) {
                const inviteData = data as unknown as InviteWithDetails;
                const clientProf = inviteData.profiles as { deleted_at?: string | null } | null;
                // Only add the invite if the client is not deleted
                if (clientProf && !clientProf.deleted_at) {
                  // Dedup by id — realtime can deliver the same INSERT twice;
                  // never render duplicate invites.
                  setInvites(prev =>
                    prev.some(inv => inv.id === inviteData.id)
                      ? prev
                      : [inviteData, ...prev]
                  );
                  setNewInviteAlert(`New invite from ${inviteData.profiles?.name}`);
                  setTimeout(() => setNewInviteAlert(null), 5000);
                }
              }
            };
            fetchNewInvite();
          } else if (payload.eventType === 'UPDATE') {
            setInvites(prev => 
              prev.map(invite => 
                invite.id === payload.new.id 
                  ? { ...invite, ...payload.new }
                  : invite
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setInvites(prev => prev.filter(invite => invite.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Real-time subscription for profile/avatar changes
    const profilesChannel = supabase
      .channel(uniqueChannelName('profiles-avatar-changes'))
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`
        },
        (payload) => {
          // Update avatar in all invites that reference this user's profile
          if (payload.new.avatar !== payload.old.avatar) {
            setInvites(prev => 
              prev.map(invite => 
                invite.profiles?.id === user.id
                  ? { 
                      ...invite, 
                      profiles: { 
                        ...invite.profiles, 
                        avatar: payload.new.avatar 
                      }
                    }
                  : invite
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      clearTimeout(timeoutId);
      invitesChannel.unsubscribe();
      profilesChannel.unsubscribe();
    };
  }, [user, toast]);

  const handleAcceptInvite = async (inviteId: string) => {
    setProcessingInvite(inviteId);
    try {
      // ⚙️ Server-side RPC: validates ownership/status/expiry, computes the
      // amount from the project budget, creates the contract + workspace and
      // flips invite + project status atomically (SECURITY DEFINER — direct
      // inserts into contracts are RLS-blocked for freelancers).
      const { error: rpcError } = await dbFunctions.acceptInviteCreateContract(inviteId);

      if (rpcError) {
        toast.error('Contract Error', rpcError.message || 'Failed to create contract from invite.');
        throw rpcError;
      }

      // Update local state
      setInvites(prev =>
        prev.map((invite) =>
          invite.id === inviteId
            ? { ...invite, status: 'accepted', updated_at: new Date().toISOString() }
            : invite
        )
      );
    } catch (error) {
      toast.error('Error', 'Failed to accept invite. Please try again.');
    } finally {
      setProcessingInvite(null);
    }
  };

  const handleDeclineInvite = async (inviteId: string) => {
    setProcessingInvite(inviteId);
    try {
      const { error } = await supabase
        .from('invites')
        .update({ status: 'declined', updated_at: new Date().toISOString() })
        .eq('id', inviteId);

      if (error) throw error;

      setInvites(prev =>
        prev.map((invite) =>
          invite.id === inviteId
            ? { ...invite, status: 'declined', updated_at: new Date().toISOString() }
            : invite
        )
      );
    } catch (error) {
      toast.error('Error', 'Failed to decline invite. Please try again.');
    } finally {
      setProcessingInvite(null);
    }
  };

  const filteredInvites = invites.filter((invite) => invite.status === activeTab);

  const pendingCount = invites.filter((i) => i.status === 'pending').length;
  const acceptedCount = invites.filter((i) => i.status === 'accepted').length;
  const declinedCount = invites.filter((i) => i.status === 'declined').length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-700 text-sm font-medium rounded-full">
            <Clock className="w-3.5 h-3.5" />
            Pending
          </span>
        );
      case 'accepted':
        return (
          <span className="flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 text-sm font-medium rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Accepted
          </span>
        );
      case 'declined':
        return (
          <span className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-full">
            <XCircle className="w-3.5 h-3.5" />
            Declined
          </span>
        );
      case 'expired':
        return (
          <span className="flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-600 text-sm font-medium rounded-full">
            <AlertCircle className="w-3.5 h-3.5" />
            Expired
          </span>
        );
      default:
        return null;
    }
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Mail className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Project Invites <InfoTip title="How invites work" text="A client personally invited you to their project. Accept — a contract is created with escrow protection and you can start working. Decline — the invite is closed and the client is notified. Invites expire after the deadline shown on each card." /></h1>
            <p className="text-slate-500 mt-1">
              Clients have invited you to {pendingCount} project{pendingCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {pendingCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-orange-50 rounded-xl border border-orange-100">
            <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>
            <span className="text-sm font-medium text-orange-700">
              {pendingCount} pending response{pendingCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* New Invite Alert */}
      {newInviteAlert && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-center gap-1.5 animate-in slide-in-from-top">
          <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center">
            <Mail className="w-4 h-4 text-purple-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-purple-900">{newInviteAlert}</p>
            <p className="text-sm text-purple-600">You've received a new project invitation!</p>
          </div>
          <button
            onClick={() => setNewInviteAlert(null)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-purple-100 transition-colors"
          >
            <XCircle className="w-4 h-4 text-purple-600" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'pending'
              ? 'text-emerald-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Pending
          {pendingCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-orange-500 text-white text-xs rounded-full">
              {pendingCount}
            </span>
          )}
          {activeTab === 'pending' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('accepted')}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'accepted'
              ? 'text-emerald-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Accepted
          {acceptedCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full">
              {acceptedCount}
            </span>
          )}
          {activeTab === 'accepted' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('declined')}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'declined'
              ? 'text-emerald-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Declined
          {declinedCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
              {declinedCount}
            </span>
          )}
          {activeTab === 'declined' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"></span>
          )}
        </button>
      </div>

      {/* Invites List */}
      {filteredInvites.length > 0 ? (
        <div className="space-y-4">
          {filteredInvites.map((invite) => (
            <div
              key={invite.id}
              className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm"
            >
              <div className="flex items-start gap-1.5">
                {/* Client Avatar */}
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center overflow-hidden">
                    {invite.profiles?.avatar ? (
                      <img
                        src={invite.profiles.avatar}
                        alt={invite.profiles.name}
                        className="w-full h-full object-cover object-top"
                        style={{
                          objectPosition: 'center 20%',
                          filter: 'brightness(1.05) contrast(1.02)'
                        }}
                      />
                    ) : (
                      <User className="w-7 h-7 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 break-words">
                  {/* Wrap on mobile: content stacks above the action buttons */}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mb-2">
                        <h3 className="font-display text-xl font-bold text-slate-900 break-words min-w-0">
                          {invite.projects.title}
                        </h3>
                        {getStatusBadge(invite.status)}
                      </div>
                      
                      <p className="text-slate-600 mb-2">
                        {invite.projects.description}
                      </p>

                      {/* Client Info */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mb-2">
                        <span className="flex items-center gap-1">
                          <User className="w-4 h-4" />
                          Invited by <span className="font-medium text-slate-700 flex items-center gap-1">
                            {invite.profiles?.name}
                                                        {(invite.profiles as any)?.rating && Number((invite.profiles as any).rating) > 0 && (
                              <span className="flex items-center gap-1 text-xs">
                                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                                <span className="font-semibold text-slate-700">{Number((invite.profiles as any).rating).toFixed(1)}</span>
                                <span className="text-slate-400">({(invite.profiles as any).total_reviews || 0})</span>
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          {safeFormatDate(invite.created_at) || '—'}
                        </span>
                        {invite.expires_at && !isExpired(invite.expires_at) && (
                          <span className="flex items-center gap-1 text-orange-600">
                            <Clock className="w-4 h-4" />
                            Expires {safeFormatDate(invite.expires_at) || '—'}
                          </span>
                        )}
                      </div>

                      {/* Project Details */}
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="flex items-center gap-1 text-slate-600">
                          <Wallet className="w-4 h-4 text-slate-400" />
                          {formatBudgetRange(invite.projects.budget_min, invite.projects.budget_max)}
                        </span>
                        <span className="flex items-center gap-1 text-slate-600">
                          <Briefcase className="w-4 h-4 text-slate-400" />
                          {invite.projects.experience_level}
                        </span>
                      </div>

                      {/* Message from client */}
                      {invite.message && (
                        <div className="mt-4 p-4 bg-slate-50 rounded-xl">
                          <div className="flex items-center gap-3 mb-2">
                            <MessageSquare className="w-4 h-4 text-slate-400" />
                            <span className="text-sm font-medium text-slate-700">Message from client:</span>
                          </div>
                          <p className="text-sm text-slate-600 italic">"{invite.message}"</p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-row gap-3 flex-shrink-0 max-sm:max-w-[240px]">
                      {invite.status === 'pending' && !isExpired(invite.expires_at) ? (
                        <>
                          <button
                            onClick={() => handleAcceptInvite(invite.id)}
                            disabled={processingInvite === invite.id}
                            className="px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                          >
                            {processingInvite === invite.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4" />
                            )}
                            Accept
                          </button>
                          <button
                            onClick={() => handleDeclineInvite(invite.id)}
                            disabled={processingInvite === invite.id}
                            className="px-3 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </>
                      ) : invite.status === 'accepted' ? (
                        <Link
                          to="/dashboard/contracts"
                          className="px-3 py-3 bg-emerald-50 text-emerald-700 font-medium rounded-xl hover:bg-emerald-100 transition-colors inline-flex items-center gap-3"
                        >
                          View Contract
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl p-12 border border-slate-100 text-center">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Mail className="w-7 h-7 text-slate-400" />
          </div>
          <h3 className="font-display text-xl font-bold text-slate-900 mb-2">
            {activeTab === 'pending'
              ? 'No pending invites'
              : activeTab === 'accepted'
              ? 'No accepted invites'
              : 'No declined invites'}
          </h3>
          <p className="text-slate-500 max-w-md mx-auto">
            {activeTab === 'pending'
              ? 'When clients invite you to their projects, they will appear here.'
              : activeTab === 'accepted'
              ? 'Accepted invites will be converted to contracts.'
              : 'Declined invites are archived here for reference.'}
          </p>
          {activeTab === 'pending' && (
            <Link
              to="/dashboard/feed"
              className="mt-6 inline-flex items-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
            >
              Browse Projects
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
