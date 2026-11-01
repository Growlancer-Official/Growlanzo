import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { teamProjectsService, type TeamProject } from '../lib/teamProjects';
import { ArrowRight, Plus, Users } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { PageSkeleton } from '../components/PageSkeleton';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open:        { label: 'Open',        cls: 'bg-emerald-100 text-emerald-700' },
  in_progress: { label: 'In Progress', cls: 'bg-violet-100 text-violet-700' },
  completed:   { label: 'Completed',   cls: 'bg-sky-100 text-sky-700' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-slate-100 text-slate-500' },
};

export function ClientTeamProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<TeamProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const res = await teamProjectsService.listProjects(user.id);
    if (res.error) {
      setError(res.error);
    } else {
      setProjects(res.data || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Team Projects <InfoTip title="How team projects work" text="Each role gets its own independent contract (own escrow / milestones / dispute). One member's issue never affects the rest of the team. Commission (5%) is withheld from each freelancer's payout per contract — never added to your total, and there is no separate team fee." /></h1>
          <p className="text-slate-600 mt-1">
            Hire a whole team for bigger projects — each freelancer has their own separately funded escrow.
          </p>
          </div>
        </div>
        <Link
          to="/client/team-projects/create"
          className="inline-flex items-center justify-center gap-3 px-3 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all"
        >
          <Plus className="w-4 h-4" /> Post a Team Project
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-3">
          {error}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-800 mb-1">No team projects yet</h2>
          <p className="text-slate-500 text-sm mb-2.5">
            Designer + Developer + Writer — sab ek project me hire karo, har ek apne contract ke saath.
          </p>
          <Link to="/client/team-projects/create" className="inline-flex items-center justify-center gap-3 px-3 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all">
            <Plus className="w-4 h-4" /> Post Your First Team Project
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          {projects.map((p) => {
            const meta = STATUS_META[p.status] || STATUS_META.open;
            return (
              <Link
                key={p.id}
                to={`/client/team-projects/${p.id}`}
                className="block bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:border-violet-300 hover:shadow-md transition-all group"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 group-hover:text-violet-700">{p.title}</h3>
                    <p className="text-sm text-slate-500 mt-0.5 truncate">{p.description || 'No description'}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${meta.cls}`}>{meta.label}</span>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-violet-500" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
