import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, currencySymbol } from '../lib/currency';
import { teamProjectsService, type TeamRoleSuggestion } from '../lib/teamProjects';
import { ArrowRight, Loader2, Plus, Sparkles, Trash2, Users, CheckCircle2, AlertCircle } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import AIGenerateModal from '../components/AIGenerateModal';
import { useToast } from '../components/Toast';

interface RoleDraft {
  key: string;
  /** DB id — set when this draft came from an existing role (edit mode). */
  dbId?: string;
  role_title: string;
  required_skills: string;
  budget_min: string;
  budget_max: string;
  matching: boolean;
  matched: boolean;
  matchError: string | null;
  suggestions: TeamRoleSuggestion[];
}

let roleKeyCounter = 0;
const nextRoleKey = () => `role_${Date.now()}_${roleKeyCounter++}`;

export function ClientPostTeamProjectPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();
  // ?edit=<id> → edit an EXISTING team project (used by the detail page's
  // "Add Role" link). Without edit mode this route silently ignored the param
  // and would create a DUPLICATE project (playtest defect 2026-09-07).
  const editingId = searchParams.get('edit');
  const [loadingEdit, setLoadingEdit] = useState(!!editingId);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** DB ids of the roles that existed when the edit form loaded (for delete-on-remove). */
  const [originalRoleIds, setOriginalRoleIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [totalBudgetEstimate, setTotalBudgetEstimate] = useState('');
  const [roles, setRoles] = useState<RoleDraft[]>([
    { key: nextRoleKey(), role_title: '', required_skills: '', budget_min: '', budget_max: '', matching: false, matched: false, matchError: null, suggestions: [] },
  ]);
  const [saving, setSaving] = useState(false);

  // Load the existing project + roles when editing, then pre-populate the form.
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    (async () => {
      setLoadingEdit(true);
      const [projRes, rolesRes] = await Promise.all([
        teamProjectsService.getProject(editingId),
        teamProjectsService.getRoles(editingId),
      ]);
      if (cancelled) return;
      if (projRes.error || !projRes.data) {
        setLoadError(projRes.error || 'Project not found');
        setLoadingEdit(false);
        return;
      }
      const proj = projRes.data;
      setTitle(proj.title || '');
      setDescription(proj.description || '');
      setTotalBudgetEstimate(proj.total_budget_estimate != null ? String(proj.total_budget_estimate) : '');
      const drafts: RoleDraft[] = (rolesRes.data || []).map((r) => ({
        key: nextRoleKey(),
        dbId: r.id,
        role_title: r.role_title,
        required_skills: (r.required_skills || []).join(', '),
        budget_min: r.budget_range_min != null ? String(r.budget_range_min) : '',
        budget_max: r.budget_range_max != null ? String(r.budget_range_max) : '',
        matching: false,
        matched: (r.suggested_freelancers || []).length > 0,
        matchError: null,
        suggestions: r.suggested_freelancers || [],
      }));
      if (drafts.length > 0) setRoles(drafts);
      setOriginalRoleIds(drafts.map((d) => d.dbId!).filter(Boolean));
      setLoadingEdit(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  const updateRole = (key: string, patch: Partial<RoleDraft>) => {
    setRoles((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRole = () => {
    setRoles((prev) => [
      ...prev,
      { key: nextRoleKey(), role_title: '', required_skills: '', budget_min: '', budget_max: '', matching: false, matched: false, matchError: null, suggestions: [] },
    ]);
  };

  const removeRole = (key: string) => {
    setRoles((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  };

  // Parse a comma-separated skill string into a clean array
  const parseSkills = (raw: string): string[] =>
    raw.split(',').map((s) => s.trim()).filter(Boolean);

  // Real-time per-role AI matching — uses the SAME engine as single projects.
  const runMatchForRole = async (role: RoleDraft) => {
    const skills = parseSkills(role.required_skills);
    if (!role.role_title.trim()) {
      toast.error('Role title required', 'Give the role a name (e.g. UI/UX Designer) before matching.');
      return;
    }
    if (skills.length === 0) {
      toast.error('Skills required', 'Add at least one required skill so AI matching can find the right freelancer.');
      return;
    }
    updateRole(role.key, { matching: true, matchError: null });
    const budgetMax = role.budget_max ? Number(role.budget_max) : role.budget_min ? Number(role.budget_min) : null;
    try {
      const result = await teamProjectsService.matchRole({
        id: role.key,
        required_skills: skills,
        budget_range_max: budgetMax,
      });
      if (result.error) {
        updateRole(role.key, { matching: false, matchError: result.error });
        return;
      }
      updateRole(role.key, { matching: false, matched: true, suggestions: result.data || [] });
    } catch (err: any) {
      updateRole(role.key, { matching: false, matchError: err?.message || 'Matching failed. Please try again.' });
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('Not signed in', 'Please sign in to post a team project.');
      return;
    }
    if (!title.trim()) {
      toast.error('Title required', 'Give your team project a title.');
      return;
    }
    const validRoles = roles.filter((r) => r.role_title.trim());
    if (validRoles.length === 0) {
      toast.error('At least one role required', 'Add the roles you need — e.g. Designer, Developer, Writer.');
      return;
    }
    for (const r of validRoles) {
      const min = r.budget_min ? Number(r.budget_min) : 0;
      const max = r.budget_max ? Number(r.budget_max) : 0;
      if (max > 0 && min > 0 && max < min) {
        toast.error('Budget error', `Role "${r.role_title}" max budget is below its min.`);
        return;
      }
    }

    setSaving(true);
    try {
      // ── EDIT MODE: update the existing project + reconcile roles ──
      if (editingId) {
        const upd = await teamProjectsService.updateProject(editingId, {
          title: title.trim(),
          description: description.trim() || undefined,
          totalBudgetEstimate: totalBudgetEstimate ? Number(totalBudgetEstimate) : undefined,
        });
        if (upd.error) throw new Error(upd.error);

        const existingDbIds = validRoles.filter((r) => r.dbId).map((r) => r.dbId!) as string[];
        let saved = 0;
        for (const r of validRoles) {
          const skills = parseSkills(r.required_skills);
          const budgetMin = r.budget_min ? Number(r.budget_min) : undefined;
          const budgetMax = r.budget_max ? Number(r.budget_max) : undefined;
          if (r.dbId) {
            const res = await teamProjectsService.updateRole(r.dbId, {
              role_title: r.role_title.trim(),
              required_skills: skills,
              budget_range_min: budgetMin ?? null,
              budget_range_max: budgetMax ?? null,
            });
            if (res.error) {
              toast.error('Partial save', `Role "${r.role_title}" failed to update: ${res.error}`);
              continue;
            }
            saved++;
          } else {
            const res = await teamProjectsService.addRole({
              teamProjectId: editingId,
              roleTitle: r.role_title.trim(),
              requiredSkills: skills,
              budgetMin,
              budgetMax,
            });
            if (res.error || !res.data) {
              toast.error('Partial save', `Role "${r.role_title}" failed to save: ${res.error || 'unknown error'}.`);
              continue;
            }
            saved++;
            // Fire AI matching for the new role (best-effort)
            if (skills.length > 0) {
              void teamProjectsService.matchRole({
                id: res.data.id,
                required_skills: skills,
                budget_range_max: res.data.budget_range_max,
              });
            }
          }
        }
        // Roles removed from the form get deleted
        const keptDbIds = new Set(existingDbIds);
        const removed = originalRoleIds.filter((id) => !keptDbIds.has(id));
        for (const id of removed) {
          await teamProjectsService.deleteRole(id);
        }

        toast.success('Team project updated', `${saved} role(s) saved.`);
        navigate(`/client/team-projects/${editingId}`);
        return;
      }

      // 1. Create the team project
      const proj = await teamProjectsService.createProject({
        clientId: user.id,
        title: title.trim(),
        description: description.trim() || undefined,
        totalBudgetEstimate: totalBudgetEstimate ? Number(totalBudgetEstimate) : undefined,
      });
      if (proj.error || !proj.data) throw new Error(proj.error || 'Failed to create team project');

      // 2. Create each role (idempotent — if a save fails part-way, the project
      // still exists and roles can be re-added from the detail page).
      const createdRoleIds: string[] = [];
      for (const r of validRoles) {
        const role = await teamProjectsService.addRole({
          teamProjectId: proj.data.id,
          roleTitle: r.role_title.trim(),
          requiredSkills: parseSkills(r.required_skills),
          budgetMin: r.budget_min ? Number(r.budget_min) : undefined,
          budgetMax: r.budget_max ? Number(r.budget_max) : undefined,
        });
        if (role.error || !role.data) {
          toast.error('Partial save', `Role "${r.role_title}" failed to save: ${role.error || 'unknown error'}. You can add it from the project page.`);
          continue;
        }
        createdRoleIds.push(role.data.id);
        // Fire AI matching for this role (best-effort, non-blocking)
        if (parseSkills(r.required_skills).length > 0) {
          void teamProjectsService.matchRole({
            id: role.data.id,
            required_skills: parseSkills(r.required_skills),
            budget_range_max: role.data.budget_range_max,
          });
        }
      }

      toast.success('Team project created', `${createdRoleIds.length} role(s) added. Now invite or match freelancers for each role.`);
      navigate(`/client/team-projects/${proj.data.id}`);
    } catch (err: any) {
      console.error('Create team project error:', err);
      toast.error('Something went wrong', err?.message || 'Failed to create the team project. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingEdit) {
    return (
      <div className="space-y-1.5">
        <button onClick={() => navigate('/client/team-projects')} className="text-sm text-slate-500 hover:text-slate-800 mb-2 flex items-center gap-1">
          ← Back to Team Projects
        </button>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Users className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">Loading project…</h1>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-1.5">
        <button onClick={() => navigate('/client/team-projects')} className="text-sm text-slate-500 hover:text-slate-800 mb-2 flex items-center gap-1">
          ← Back to Team Projects
        </button>
        <div className="bg-white rounded-xl p-6 border border-red-200">
          <p className="text-sm font-semibold text-red-700 mb-1">Could not load this project</p>
          <p className="text-sm text-slate-500">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button onClick={() => navigate('/client/team-projects')} className="text-sm text-slate-500 hover:text-slate-800 mb-2 flex items-center gap-1">
        ← Back to Team Projects
      </button>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
          <Users className="w-5 h-5 text-white" />
        </div>
        <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">{editingId ? 'Edit Team Project' : 'Post a Team Project'} <InfoTip title="How team projects work" text="Each role gets an independent contract — its own escrow, milestones and dispute. One member's issue never affects the rest of the team. Commission (5%) is withheld from each freelancer's payout per contract — never added to your total, and there is no separate team fee." />      </h1>
      </div>
      <p className="text-slate-600 mb-3">
        Hire a whole team for bigger projects — Designer, Developer, Writer — all in one place. Each freelancer has their <strong>own protected escrow</strong>.
      </p>

      <form onSubmit={handleCreateProject} className="space-y-4">
        {/* Project basics */}
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-2">Project Details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Project Title *</label>
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Build our company website + branding"
                  className="flex-1 min-w-0 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <AIGenerateModal
                  field="project_title"
                  triggerLabel="AI"
                  className="shrink-0 mt-1"
                  clientFree
                  context={{
                    budget: totalBudgetEstimate || undefined,
                    team_roles: roles
                      .filter((r) => r.role_title.trim())
                      .map((r) => r.role_title.trim()),
                    skills: roles
                      .flatMap((r) => r.required_skills.split(',').map((s) => s.trim()))
                      .filter(Boolean),
                  }}
                  onApply={(text) => setTitle(text)}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Stuck on a title? Click <span className="font-semibold text-violet-600">AI</span> — describe what the
                team should build and get a professional title in seconds.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="What are you building? Share the goal, timeline and anything the team should know."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <AIGenerateModal
                  field="project_description"
                  triggerLabel="Write description with AI"
                  clientFree
                  context={{
                    title: title.trim() || undefined,
                    budget: totalBudgetEstimate || undefined,
                    team_roles: roles
                      .filter((r) => r.role_title.trim())
                      .map((r) => r.role_title.trim()),
                    skills: roles
                      .flatMap((r) => r.required_skills.split(',').map((s) => s.trim()))
                      .filter(Boolean),
                  }}
                  onApply={(text) => setDescription(text)}
                />
                <span className="text-xs text-slate-400">AI is free for clients — no limits</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Total Budget Estimate ({currencySymbol()})</label>
              <input
                type="number"
                value={totalBudgetEstimate}
                onChange={(e) => setTotalBudgetEstimate(e.target.value)}
                placeholder="Optional — overall project budget"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Roles */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Team Roles</h2>
            <button
              type="button"
              onClick={addRole}
              className="inline-flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-emerald-600 text-emerald-600 text-sm font-medium hover:bg-emerald-50 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Role
            </button>
          </div>

          {roles.map((role, idx) => (
            <div key={role.key} className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Role {idx + 1}</span>
                <button type="button" onClick={() => removeRole(role.key)} disabled={roles.length <= 1} aria-label={`Remove role ${idx + 1}`} className="text-slate-400 hover:text-red-500 disabled:opacity-30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Role Title *</label>
                  <input
                    type="text"
                    value={role.role_title}
                    onChange={(e) => updateRole(role.key, { role_title: e.target.value })}
                    placeholder="e.g. UI/UX Designer"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Required Skills (comma separated)</label>
                  <input
                    type="text"
                    value={role.required_skills}
                    onChange={(e) => updateRole(role.key, { required_skills: e.target.value, matched: false })}
                    placeholder="e.g. Figma, UI Design, Prototyping"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Budget Min ({currencySymbol()})</label>
                  <input
                    type="number"
                    value={role.budget_min}
                    onChange={(e) => updateRole(role.key, { budget_min: e.target.value, matched: false })}
                    placeholder="e.g. 5000"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Budget Max ({currencySymbol()})</label>
                  <input
                    type="number"
                    value={role.budget_max}
                    onChange={(e) => updateRole(role.key, { budget_max: e.target.value, matched: false })}
                    placeholder="e.g. 15000"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* AI match trigger */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => runMatchForRole(role)}
                  disabled={role.matching}
                  className="inline-flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {role.matching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {role.matching ? 'Matching...' : 'Find AI Matches'}
                </button>
                {role.matched && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 className="w-4 h-4" /> {role.suggestions.length} suggested
                  </span>
                )}
                {role.matchError && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-red-600 font-medium">
                    <AlertCircle className="w-4 h-4" /> {role.matchError}
                  </span>
                )}
              </div>

              {/* Suggested freelancers — role-scoped, never cross-role */}
              {role.suggestions.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Suggested Freelancers for this role</p>
                  <div className="space-y-4 max-h-64 overflow-y-auto">
                    {role.suggestions.slice(0, 6).map((s) => (
                      <div key={s.freelancer_id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-sm shrink-0">
                            {(s.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                            <p className="text-xs text-slate-500">
                              {s.match_score}% match{s.skill_score >= 70 ? ' · strong skill overlap' : ''}
                              {s.verification_status === 'verified' ? ' · ✓ verified' : ''}
                            </p>
                          </div>
                        </div>
                        {s.hourly_rate > 0 && (
                          <span className="text-xs font-medium text-slate-600 shrink-0">{formatCurrency(s.hourly_rate)}/hr</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    Save the project first, then invite freelancers from the team project page.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => navigate('/client/team-projects')} className="px-5 py-3 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-60 shadow-lg"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {saving ? (editingId ? 'Saving...' : 'Creating...') : (editingId ? 'Save Changes' : 'Create Team Project')}
          </button>
        </div>
      </form>
    </div>
  );
}
