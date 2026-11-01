import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase, uniqueChannelName } from '../lib/supabase';
import { formatCurrency } from '../lib/currency';
import { teamProjectsService, type TeamProject, type TeamRole, TEAM_COMMISSION_RATE } from '../lib/teamProjects';
import { AlertCircle, ArrowLeft, CheckCircle2, Plus, RefreshCw, UserCheck, Users } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { useToast } from '../components/Toast';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageSkeleton } from '../components/PageSkeleton';

const ROLE_STATUS_META: Record<string, { label: string; cls: string }> = {
  open:     { label: 'Open',     cls: 'bg-emerald-100 text-emerald-700' },
  matched:  { label: 'Matched',  cls: 'bg-violet-100 text-violet-700' },
  filled:   { label: 'Filled',   cls: 'bg-sky-100 text-sky-700' },
  cancelled:{ label: 'Cancelled',cls: 'bg-slate-100 text-slate-500' },
};

export function ClientTeamProjectDetailPage() {
  // Route declares /client/team-projects/:teamProjectId — the param name
  // must match exactly or useParams() silently returns undefined and the
  // page renders blank (defect caught in live E2E 2026-09-07).
  const { teamProjectId } = useParams<{ teamProjectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [project, setProject] = useState<TeamProject | null>(null);
  const [roles, setRoles] = useState<TeamRole[]>([]);
  const [contracts, setContracts] = useState<Record<string, { id: string; status: string; amount: number } | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rematching, setRematching] = useState<Record<string, boolean>>({});

  const loadContract = useCallback(async (roleId: string) => {
    if (!user) return;
    const { data, error } = await (supabase.rpc as any)('get_team_role_contract', {
      p_role_id: roleId,
      p_client_id: user.id,
    });
    if (error) return;
    setContracts((prev) => ({ ...prev, [roleId]: data as { id: string; status: string; amount: number } | null }));
  }, [user]);

  const load = useCallback(async () => {
    if (!teamProjectId || !user) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const proj = await teamProjectsService.getProject(teamProjectId);
      if (proj.error || !proj.data) {
        setError(proj.error || 'Project not found');
        setLoading(false);
        return;
      }
      setProject(proj.data);

      const rolesRes = await teamProjectsService.getRoles(teamProjectId);
      if (rolesRes.error) {
        setError(rolesRes.error);
        setLoading(false);
        return;
      }
      setRoles(rolesRes.data || []);
      for (const role of rolesRes.data || []) {
        void loadContract(role.id);
      }
    } catch (err: any) {
      console.error('Load team project error:', err);
      setError(err?.message || 'Failed to load the team project.');
    } finally {
      setLoading(false);
    }
  }, [teamProjectId, user, loadContract]);

  useEffect(() => {
    void load();
  }, [load]);

  // Real-time: roles (and their AI suggestions) update live — e.g. when a
  // freelancer adds a matching skill, or the role status/skills/budget change
  // server-side. No manual page reload needed.
  useEffect(() => {
    if (!teamProjectId) return;
    const channel = supabase
      .channel(uniqueChannelName('team-project-roles', teamProjectId))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_project_roles', filter: `team_project_id=eq.${teamProjectId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const incoming = payload.new as TeamRole;
            setRoles((prev) =>
              prev.some((r) => r.id === incoming.id)
                ? prev
                : [...prev, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at))
            );
            void loadContract(incoming.id);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as TeamRole;
            setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            void loadContract(updated.id);
          } else if (payload.eventType === 'DELETE') {
            const oldRole = payload.old as { id?: string };
            if (oldRole.id) {
              setRoles((prev) => prev.filter((r) => r.id !== oldRole.id));
              setContracts((prev) => {
                const next = { ...prev };
                delete next[oldRole.id as string];
                return next;
              });
            }
          }
        }
      )
      .subscribe();

    return () => { void channel.unsubscribe(); };
  }, [teamProjectId, loadContract]);

  const refreshRoleMatches = async (role: TeamRole) => {
    setRematching((prev) => ({ ...prev, [role.id]: true }));
    const result = await teamProjectsService.matchRole({
      id: role.id,
      required_skills: role.required_skills,
      budget_range_max: role.budget_range_max,
    });
    setRematching((prev) => ({ ...prev, [role.id]: false }));
    if (result.error) {
      toast.error('Matching failed', result.error);
      return;
    }
    toast.success('Matches refreshed', `${result.data?.length || 0} freelancer(s) suggested for this role.`);
    void load();
  };

  const markRoleMatched = async (role: TeamRole, freelancerId: string, name: string) => {
    const res = await teamProjectsService.updateRole(role.id, {
      status: 'matched',
      matched_freelancer_id: freelancerId,
    });
    if (res.error) {
      toast.error('Could not update role', res.error);
      return;
    }
    toast.success('Freelancer selected', `"${name}" marked as the match for ${role.role_title}. Create their contract to lock the hire.`);
    void load();
  };

  const [hireConfirmOpen, setHireConfirmOpen] = useState(false);
  const [hireRoleData, setHireRoleData] = useState<{ role: TeamRole; amount: number } | null>(null);

  /** Execute the hire after confirmation. */
  const doHireRole = async (role: TeamRole, amount: number) => {
    if (!project || !user) return;
    const res = await teamProjectsService.createRoleContract({
      teamProjectId: project.id,
      roleId: role.id,
      freelancerId: role.matched_freelancer_id!,
      amount,
      clientId: user.id,
    });
    if (res.error) {
      toast.error('Contract failed', res.error);
      return;
    }
    // Mark role filled + project in_progress (idempotent)
    await teamProjectsService.updateRole(role.id, { status: 'filled' });
    if (project.status === 'open') {
      await teamProjectsService.updateProject(project.id, { status: 'in_progress' });
    }
    toast.success('Contract created', 'Escrow-protected contract created. Fund it from the workspace to start.');
    void load();
  };

  const hireRole = async (role: TeamRole) => {
    if (!role.matched_freelancer_id) {
      toast.error('Select a freelancer first', 'Pick a suggested freelancer to match before hiring.');
      return;
    }
    const amount = role.budget_range_max ?? role.budget_range_min;
    if (!amount || amount <= 0) {
      toast.error('Budget required', `Set a budget for "${role.role_title}" before creating the contract.`);
      return;
    }
    if (!project || !user) return;

    setHireRoleData({ role, amount });
    setHireConfirmOpen(true);
  };

  // Transparency breakdown — per-role row + project total
  const rows = roles.map((role) => {
    const amount = role.budget_range_max ?? role.budget_range_min ?? 0;
    const commission = Math.round(amount * TEAM_COMMISSION_RATE * 100) / 100;
    return { role, amount, commission, total: amount };
  });
  const totals = rows.reduce(
    (acc, r) => ({ amount: acc.amount + r.amount, commission: acc.commission + r.commission, total: acc.total + r.total }),
    { amount: 0, commission: 0, total: 0 }
  );

  if (loading) return <PageSkeleton />;

  if (error || !project) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <h1 className="font-display text-xl font-bold text-slate-900 mb-2">Could not load this team project</h1>
        <p className="text-slate-500 mb-3">{error || 'Not found'}</p>
        <Link to="/client/team-projects" className="inline-flex items-center justify-center gap-3 px-3 py-3 rounded-xl bg-emerald-600 text-white font-semibold transition-all hover:bg-emerald-700">
          <ArrowLeft className="w-4 h-4" /> Back to Team Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <button onClick={() => navigate('/client/team-projects')} className="text-sm text-slate-500 hover:text-slate-800 mb-2 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Back to Team Projects
      </button>

      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-900">{project.title}</h1>
          </div>
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${project.status === 'open' ? 'bg-emerald-100 text-emerald-700' : project.status === 'in_progress' ? 'bg-violet-100 text-violet-700' : project.status === 'completed' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
            {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
          </span>
        </div>
        <Link
          to={`/client/team-projects/create?edit=${project.id}`}
          className="inline-flex items-center gap-3 px-4 py-2 rounded-xl border border-emerald-600 text-emerald-600 text-sm font-semibold hover:bg-emerald-50"
        >
          <Plus className="w-4 h-4" /> Add Role
        </Link>
      </div>

      {project.description && <p className="text-slate-600 whitespace-pre-wrap mb-3">{project.description}</p>}

      {/* Roles grid */}
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        {roles.length === 0 && (
          <div className="sm:col-span-2 text-center py-10 bg-white rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500 mb-3">No roles yet — add the team roles you need.</p>
            <Link to={`/client/team-projects/create?edit=${project.id}`} className="inline-flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium transition-colors hover:bg-emerald-700">
              <Plus className="w-4 h-4" /> Add First Role
            </Link>
          </div>
        )}
        {roles.map((role) => {
          const meta = ROLE_STATUS_META[role.status] || ROLE_STATUS_META.open;
          const contract = contracts[role.id];
          return (
            <div key={role.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">{role.role_title}</h3>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${meta.cls}`}>{meta.label}</span>
              </div>
              <p className="text-xs text-slate-500">
                {role.required_skills.length > 0 ? role.required_skills.join(' · ') : 'No skills listed'}
              </p>
              <p className="text-sm font-semibold text-slate-700">
                {role.budget_range_min || role.budget_range_max ? (
                  <>
                    {formatCurrency(role.budget_range_min ?? 0)}{role.budget_range_max && role.budget_range_max !== role.budget_range_min ? ` – ${formatCurrency(role.budget_range_max)}` : ''}
                  </>
                ) : 'Budget not set'}
              </p>

              {/* Suggested freelancers */}
              {(role.suggested_freelancers || []).length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto border-t border-slate-100 pt-2">
                  {(role.suggested_freelancers as any[]).slice(0, 5).map((s) => (
                    <div key={s.freelancer_id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-slate-50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                        <p className="text-xs text-slate-500">{s.match_score}% match{s.verification_status === 'verified' ? ' · ✓ verified' : ''}</p>
                      </div>
                      {role.matched_freelancer_id === s.freelancer_id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold shrink-0">
                          <CheckCircle2 className="w-4 h-4" /> Selected
                        </span>
                      ) : (
                        <button
                          onClick={() => markRoleMatched(role, s.freelancer_id, s.name)}
                          className="text-xs font-semibold text-violet-600 hover:underline shrink-0"
                        >
                          Select
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => refreshRoleMatches(role)}
                  disabled={rematching[role.id]}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-800"
                >
                  <RefreshCw className={`w-4 h-4 ${rematching[role.id] ? 'animate-spin' : ''}`} /> Refresh matches
                </button>

                {contract ? (
                  <Link
                    to={`/client/workspace/${contract.id}`}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                  >
                    Open Workspace →
                  </Link>
                ) : (
                  <button
                    onClick={() => hireRole(role)}
                    disabled={!role.matched_freelancer_id || role.status === 'filled'}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-40"
                  >
                    <UserCheck className="w-4 h-4" /> {role.status === 'filled' ? 'Hired' : 'Hire & Create Contract'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Transparency breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h2 className="font-semibold text-slate-900 mb-1">Spend Breakdown</h2>
        <p className="text-xs text-slate-500 mb-2">
          Har contract independent hai. Growlanzo ka flat 5% commission freelancer ke payout se katta hai —
          aapke total mein kuch add nahi hota, aur koi alag team fee nahi hai.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider">
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Freelancer</th>
                <th className="py-2 pr-4 text-right">Amount</th>
                <th className="py-2 pr-4 text-right">Growlanzo fee (5%, from freelancer)</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.role.id} className="border-b border-slate-100">
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{r.role.role_title}</td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {r.role.matched_freelancer_id ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Matched
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right">{r.amount > 0 ? formatCurrency(r.amount) : '—'}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{r.amount > 0 ? formatCurrency(r.commission) : '—'}</td>
                  <td className="py-2.5 pr-4 text-right font-semibold">{r.amount > 0 ? formatCurrency(r.total) : '—'}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${(ROLE_STATUS_META[r.role.status] || ROLE_STATUS_META.open).cls}`}>
                      {(ROLE_STATUS_META[r.role.status] || ROLE_STATUS_META.open).label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                <td className="py-3 pr-4" colSpan={2}>Project Total</td>
                <td className="py-3 pr-4 text-right">{formatCurrency(totals.amount)}</td>
                <td className="py-3 pr-4 text-right text-slate-600">{formatCurrency(totals.commission)}</td>
                <td className="py-3 pr-4 text-right text-emerald-700">{formatCurrency(totals.total)}</td>
                <td className="py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <InfoTip title="Team project protection" text="If one role's contract gets disputed or cancelled, it doesn't affect the other roles — each contract has its own independent escrow, milestones and dispute. Your team project stays protected regardless." />
      </div>

      <ConfirmModal
        isOpen={hireConfirmOpen}
        onClose={() => { setHireConfirmOpen(false); setHireRoleData(null); }}
        onConfirm={async () => {
          if (hireRoleData) {
            await doHireRole(hireRoleData.role, hireRoleData.amount);
          }
          setHireConfirmOpen(false);
          setHireRoleData(null);
        }}
        title="Create Contract"
        message={hireRoleData ? `Create the contract for "${hireRoleData.role.role_title}" at ${formatCurrency(hireRoleData.amount)}? Growlanzo's 5% commission is deducted from the freelancer's payout — nothing is added to your total.` : ''}
        confirmLabel="Create contract"
        variant="info"
      />
    </div>
  );
}
