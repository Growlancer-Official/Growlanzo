import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase, realtimeChannels, tables } from '../lib/supabase';
import { notifyProjectCompleted } from '../lib/workflowService';
import { formatBudgetRange } from '../utils/date';
import { PageSkeleton } from '../components/PageSkeleton';
import { InfoTip } from '../components/InfoTip';
import { AlertTriangle, Briefcase, CheckCircle, CheckCircle2, Clock, IndianRupee, Edit3, Eye, FolderKanban, MoreVertical, Plus, RefreshCw, X } from 'lucide-react';

/* ── Dropdown menu for each project card ── */
function ProjectMenu({
  projectId,
  projectStatus,
  onClose,
  onComplete,
  onReopen,
}: {
  projectId: string;
  projectStatus: string;
  onClose: (id: string) => void;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
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

  const canModify = projectStatus === 'open' || projectStatus === 'in_progress';
  const isCancelled = projectStatus === 'cancelled';
  const isInProgress = projectStatus === 'in_progress';

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
            to={`/projects/${projectId}`}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            <Eye className="w-4 h-4 text-slate-400" />
            <span>View Details</span>
          </Link>
          <Link
            to={`/client/matches?project_id=${projectId}`}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            <Eye className="w-4 h-4 text-slate-400" />
            <span>AI Matches</span>
          </Link>
          <Link
            to={`/client/proposals`}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            <CheckCircle2 className="w-4 h-4 text-slate-400" />
            <span>View Proposals</span>
          </Link>
          {canModify && (
            <>
              <Link
                to={`/client/post?edit=${projectId}`}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => setOpen(false)}
              >
                <Edit3 className="w-4 h-4 text-slate-400" />
                <span>Edit Project</span>
              </Link>
              {isInProgress && (
                <button
                  onClick={() => { setOpen(false); onComplete(projectId); }}
                  className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>Mark Complete</span>
                </button>
              )}
              <div className="h-px bg-slate-100 my-1.5 mx-3" />
              <button
                onClick={() => { setOpen(false); onClose(projectId); }}
                className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <X className="w-4 h-4 text-red-400" />
                <span>Close Project</span>
              </button>
            </>
          )}
          {isCancelled && (
            <>
              <div className="h-px bg-slate-100 my-1.5 mx-3" />
              <button
                onClick={() => { setOpen(false); onReopen(projectId); }}
                className="w-full flex items-center gap-1.5 px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4 text-blue-400" />
                <span>Reopen Project</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface Project {
  id: string;
  title: string;
  description: string;
  budget_min: number;
  budget_max: number;
  skills_required: string[];
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  deadline: string;
  category: string;
  experience_level: 'entry' | 'intermediate' | 'expert';
  created_at: string;
  proposals_count?: number;
}

export function ClientProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'completed' | 'cancelled'>('all');
  const [showCloseModal, setShowCloseModal] = useState<string | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState<string | null>(null);
  const [showReopenModal, setShowReopenModal] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageSize = 20;
  const pageRef = useRef(0);
  const fetchProjects = useCallback(async (loadMore = false) => {
    if (!user?.id) return;

    if (loadMore) setLoadingMore(true);

    const currentPage = pageRef.current;
    const from = loadMore ? (currentPage + 1) * pageSize : 0;
    const to = from + pageSize - 1;

    const { data, error } = await (tables.projects() as any)
      .select('*, proposals(count)')
      .eq('client_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('Error fetching projects:', error);
    } else {
      const newProjects = (data as unknown as Project[]) || [];
      if (loadMore) {
        setProjects(prev => [...prev, ...newProjects]);
        pageRef.current = currentPage + 1;
      } else {
        setProjects(newProjects);
        pageRef.current = 0;
      }
      setHasMore(newProjects.length === pageSize);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    fetchProjects();

    // Set up real-time subscription
    const subscription = realtimeChannels.projects(`client-projects-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
          filter: `client_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // Dedup by id — realtime can deliver the same INSERT twice;
            // never render duplicate projects.
            const incoming = payload.new as Project;
            setProjects((prev) =>
              prev.some((p) => p.id === incoming.id) ? prev : [incoming, ...prev]
            );
          } else if (payload.eventType === 'UPDATE') {
            setProjects((prev) =>
              prev.map((p) => (p.id === payload.new.id ? (payload.new as Project) : p))
            );
          } else if (payload.eventType === 'DELETE') {
            setProjects((prev) => prev.filter((p) => p.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [user?.id, fetchProjects]);

  const filteredProjects = projects.filter((p) =>
    filter === 'all' ? true : p.status === filter
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-emerald-100 text-emerald-700';
      case 'in_progress':
        return 'bg-blue-100 text-blue-700';
      case 'completed':
        return 'bg-slate-100 text-slate-700';
      case 'cancelled':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const handleCloseProject = async (projectId: string) => {
    if (!user?.id) return;
    setClosingId(projectId);
    const { error } = await supabase
      .from('projects')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('client_id', user.id);
    if (!error) {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'cancelled' } : p));
    }
    setClosingId(null);
    setShowCloseModal(null);
  };

  const handleCompleteProject = async (projectId: string) => {
    if (!user?.id) return;
    setCompletingId(projectId);
    const { error } = await supabase
      .from('projects')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('client_id', user.id);
    if (!error) {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'completed' } : p));
      // Fire-and-forget: the freelancer hears the project is done and is asked
      // for a review. Sends nothing if no one was hired through Growlanzo.
      void notifyProjectCompleted(projectId);
    }
    setCompletingId(null);
    setShowCompleteModal(null);
  };

  const handleReopenProject = async (projectId: string) => {
    if (!user?.id) return;
    setReopeningId(projectId);
    const { error } = await supabase
      .from('projects')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('client_id', user.id);
    if (!error) {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'open' } : p));
      // Regenerate AI matches on reopen
      await supabase.from('ai_matches').delete().eq('project_id', projectId);
    }
    setReopeningId(null);
    setShowReopenModal(null);
  };


  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 flex-shrink-0">
            <FolderKanban className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2 flex-wrap">My Projects <InfoTip title="From post to completed — your project journey" text="Open — freelancers can apply and you can invite AI matches. In Progress — a freelancer is hired and working under escrow. Completed — work delivered and approved. Cancelled — you closed it (active contracts continue safely). Use the menu on any project to see proposals, AI matches, edit, or change status — all in real time." /></h1>
          <p className="text-slate-500 mt-1">Manage your posted projects and track progress</p>
          </div>
        </div>
        <Link
          to="/client/post"
          className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Post New Project
        </Link>
      </div>


      {/* Filter Tabs */}
      <div className="flex gap-3 border-b border-slate-200 overflow-x-auto">
        {(['all', 'open', 'in_progress', 'completed', 'cancelled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              filter === f
                ? 'text-emerald-600 border-b-2 border-emerald-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-xl border border-slate-100">
          <div className="w-20 h-20 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-2.5">
            <Briefcase className="w-7 h-7 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            {filter === 'all' ? 'No projects yet' : `No ${filter} projects`}
          </h3>
          <p className="text-slate-500 max-w-sm mx-auto mb-3">
            {filter === 'all'
              ? 'Post your first project and start receiving proposals from talented freelancers.'
              : `You don't have any ${filter} projects at the moment.`}
          </p>
          {filter === 'all' ? (
            <Link
              to="/client/post"
              className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all"
            >
              <Plus className="w-4 h-4" />
              Post Your First Project
            </Link>
          ) : (
            <Link
              to="/client/projects"
              className="text-emerald-600 font-medium hover:underline text-sm"
            >
              View all projects →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {filteredProjects.map((project) => (
            <div
              key={project.id}
              className="bg-white p-6 rounded-xl border border-slate-100 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 mb-2">
                    <h3 className="font-display text-xl font-bold text-slate-900">{project.title}</h3>
                    <span
                      className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${getStatusColor(
                        project.status
                      )}`}
                    >
                      {project.status}
                    </span>
                  </div>
                  <p className="text-slate-600 text-sm line-clamp-4">{project.description}</p>
                </div>
                <ProjectMenu projectId={project.id} projectStatus={project.status} onClose={setShowCloseModal} onComplete={setShowCompleteModal} onReopen={setShowReopenModal} />
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-slate-500 mb-2">
                <div className="flex items-center gap-3">
                  <IndianRupee className="w-4 h-4" />
                  <span>{formatBudgetRange(project.budget_min, project.budget_max)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4" />
                  <span>
                    {project.deadline
                      ? new Date(project.deadline).toLocaleDateString()
                      : 'No deadline'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Briefcase className="w-4 h-4" />
                  <span>{project.proposals_count || 0} proposals</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mb-2">
                {project.skills_required.slice(0, 4).map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1 bg-slate-50 text-slate-600 text-xs font-medium rounded-full border border-slate-200"
                  >
                    {skill}
                  </span>
                ))}
                {project.skills_required.length > 4 && (
                  <span className="px-3 py-1 bg-slate-50 text-slate-600 text-xs font-medium rounded-full border border-slate-200">
                    +{project.skills_required.length - 4} more
                  </span>
                )}
              </div>

              <div className="flex gap-3 flex-wrap">
                <Link
                  to={`/client/matches?project_id=${project.id}`}
                  className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  AI Matches
                </Link>
                <Link
                  to={`/client/proposals`}
                  className="flex items-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                >
                  View Proposals
                </Link>
              </div>
            </div>
          ))}
            </div>
          </>
      )}

      {/* Load More */}
      {filteredProjects.length > 0 && hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => fetchProjects(true)}
            disabled={loadingMore}
            className="px-3 py-3 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More Projects'}
          </button>
        </div>
      )}

      {/* Close Project Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-center w-16 h-16 bg-orange-100 rounded-xl mb-2.5 mx-auto">
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Close Project</h3>
            <p className="text-sm text-slate-500 text-center mb-3">
              This will mark the project as cancelled. Freelancers will no longer be able to apply.
              Active contracts will continue in your workspace.
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowCloseModal(null)}
                disabled={closingId !== null}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Keep Open
              </button>
              <button
                onClick={() => showCloseModal && handleCloseProject(showCloseModal)}
                disabled={closingId !== null}
                className="flex-1 px-4 py-3 bg-orange-600 text-white font-medium rounded-xl hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {closingId === showCloseModal ? 'Closing...' : 'Close Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Project Modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-xl mb-2.5 mx-auto">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Mark Project Complete</h3>
            <p className="text-sm text-slate-500 text-center mb-3">
              This will mark the project as completed. Escrow funds will be released to the freelancer.
              This action cannot be undone.
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowCompleteModal(null)}
                disabled={completingId !== null}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => showCompleteModal && handleCompleteProject(showCompleteModal)}
                disabled={completingId !== null}
                className="flex-1 px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {completingId === showCompleteModal ? 'Completing...' : 'Complete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Project Modal */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-center w-16 h-16 bg-blue-100 rounded-xl mb-2.5 mx-auto">
              <RefreshCw className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Reopen Project</h3>
            <p className="text-sm text-slate-500 text-center mb-3">
              This will reopen the project with status "Open". Freelancers will be able to apply again.
              AI matches will be regenerated.
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowReopenModal(null)}
                disabled={reopeningId !== null}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => showReopenModal && handleReopenProject(showReopenModal)}
                disabled={reopeningId !== null}
                className="flex-1 px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {reopeningId === showReopenModal ? 'Reopening...' : 'Reopen Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
