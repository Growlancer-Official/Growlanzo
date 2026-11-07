import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase, realtimeChannels } from '../lib/supabase';
import { formatBudgetRange } from '../utils/date';
import { isValidUuid } from '../utils/validation';
import { useAuth } from '../context/AuthContext';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle,
  CheckCircle2,
  Clock,
  IndianRupee,
  Edit3,
  ExternalLink,
  RefreshCw,
  Send,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { ROUTES } from '../routes';
import { useToast } from '../components/Toast';
import { TipNote } from '../components/TipNote';
import { notifyProjectCompleted } from '../lib/workflowService';

interface ProjectDetails {
  id: string;
  client_id: string;
  title: string;
  description: string;
  budget_min: number;
  budget_max: number;
  skills_required: string[];
  status: string;
  deadline: string | null;
  category: string;
  industry: string | null;
  experience_level: string;
  visibility: string;
  created_at: string;
  proposals_count?: number;
  client?: {
    id: string;
    name: string | null;
    avatar: string | null;
  };
}

export function ProjectDetailsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const toast = useToast();
  const [showReopenModal, setShowReopenModal] = useState(false);

  const fetchProject = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    // 🛡️ Reject malformed ids before querying — `projects.id` is a uuid column,
    // so a non-UUID id made Postgres answer HTTP 400 (red console error) for
    // what is really just a not-found visit.
    if (!isValidUuid(projectId)) {
      setError('Unable to load this project. It may have been removed.');
      setProject(null);
      setLoading(false);
      return;
    }

    // `.maybeSingle()` (not `.single()`): a missing project used to raise
    // PGRST116 → HTTP 406 in the console on every deleted/unknown project URL.
    const { data, error } = await supabase
      .from('projects')
      .select('*, profiles!projects_client_id_fkey(id, name, avatar)')
      .eq('id', projectId)
      .maybeSingle();

    if (error || !data) {
      setError('Unable to load this project. It may have been removed.');
      setProject(null);
    } else {
      setProject(data as unknown as ProjectDetails);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void fetchProject();
  }, [fetchProject]);

  // Real-time subscription for project updates
  useEffect(() => {
    if (!projectId) return;
    const channel = realtimeChannels.projects(`details-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        () => { void fetchProject(); }
      )
      .subscribe();
    return () => { void channel.unsubscribe(); };
  }, [projectId, fetchProject]);

  const isOwner = user?.id === project?.client_id;
  const isFreelancer = user?.role === 'freelancer';

  const handleCloseProject = async () => {
    if (!projectId || !user) return;
    setClosing(true);
    const { error } = await supabase
      .from('projects')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('client_id', user.id);
    if (!error) {
      setShowCloseModal(false);
      void fetchProject();
    } else {
      toast.error('Error', 'Failed to close project. Please try again.');
    }
    setClosing(false);
  };

  const handleCompleteProject = async () => {
    if (!projectId || !user) return;
    setCompleting(true);
    const { error } = await supabase
      .from('projects')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('client_id', user.id);
    if (!error) {
      setShowCompleteModal(false);
      // The freelancer gets the completion email + review request (server-side
      // recipient, idempotent per project).
      void notifyProjectCompleted(projectId);
      void fetchProject();
    } else {
      toast.error('Error', 'Failed to complete project. Please try again.');
    }
    setCompleting(false);
  };

  const handleReopenProject = async () => {
    if (!projectId || !user) return;
    setReopening(true);
    const { error } = await supabase
      .from('projects')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('client_id', user.id);
    if (!error) {
      setShowReopenModal(false);
      void fetchProject();
    } else {
      toast.error('Error', 'Failed to reopen project. Please try again.');
    }
    setReopening(false);
  };

  const handleDeleteProject = async () => {
    if (!projectId || !user) return;
    setDeleting(true);

    // Check for active contracts first
    const { data: contracts } = await supabase
      .from('contracts')
      .select('id')
      .eq('project_id', projectId)
      .in('status', ['active', 'in_progress', 'pending']);

    if (contracts && contracts.length > 0) {
      toast.error('Cannot Delete', 'This project has active contracts. Close them first.');
      setDeleting(false);
      setShowDeleteModal(false);
      return;
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('client_id', user.id);

    if (!error) {
      navigate('/client/projects');
    } else {
      toast.error('Error', 'Failed to delete project. Please try again.');
    }
    setDeleting(false);
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      open: 'bg-emerald-100 text-emerald-700',
      in_progress: 'bg-blue-100 text-blue-700',
      completed: 'bg-slate-100 text-slate-700',
      cancelled: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = {
      open: 'Open',
      in_progress: 'In Progress',
      completed: 'Completed',
      cancelled: 'Cancelled',
    };
    return {
      className: styles[status] || 'bg-slate-100 text-slate-700',
      label: labels[status] || status,
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream px-4">
        <div className="animate-spin h-12 w-12 rounded-full border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center px-4 py-6">
        <div className="max-w-xl w-full bg-white rounded-xl border border-slate-200 p-4 shadow-lg">
          <div className="text-center">
            <Briefcase className="mx-auto h-14 w-14 text-emerald-500 mb-2" />
            <h1 className="text-4xl font-display font-black text-slate-900 mb-2">Project not found</h1>
            <p className="text-sm text-slate-500 mb-3">
              {error ?? 'We could not find the project you were looking for.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to={ROUTES.HOME}
                className="inline-flex items-center justify-center gap-3 px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Home
              </Link>
              <Link
                to="/client/post"
                className="inline-flex items-center justify-center gap-3 px-5 py-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Post a Project
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const badge = getStatusBadge(project.status);

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto max-w-[100rem]">
        {/* Navigation & Actions */}
        <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              to={ROUTES.HOME}
              className="inline-flex items-center gap-3 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to home
            </Link>
            <div className="flex items-center gap-3 mt-3">
              <h1 className="text-4xl font-display font-black tracking-tight text-slate-900">
                {project.title}
              </h1>
              <span className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <p className="mt-2 text-slate-600 max-w-3xl">{project.description}</p>
          </div>

          {/* Owner Actions */}
          {isOwner && (
            <div className="flex items-center gap-3">
              {/* Progress step indicator */}
              <div className="flex items-center gap-1.5 mr-4 px-3 py-1.5 bg-slate-100 rounded-xl">
                {['open', 'in_progress', 'completed'].map((step, idx) => {
                  const statusOrder = ['open', 'in_progress', 'completed'];
                  const currentIdx = statusOrder.indexOf(project.status);
                  const stepIdx = statusOrder.indexOf(step);
                  const isReached = currentIdx >= stepIdx && project.status !== 'cancelled';
                  return (
                    <div key={step} className="flex items-center gap-1.5">
                      {idx > 0 && (
                        <div className={`w-4 h-0.5 ${isReached ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                      )}
                      <div className={`w-2 h-2 rounded-full ${
                        isReached ? 'bg-emerald-500' : 'bg-slate-300'
                      } ${project.status === step ? 'ring-2 ring-emerald-200' : ''}`} />
                    </div>
                  );
                })}
                {project.status === 'cancelled' && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 bg-slate-300" />
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                  </div>
                )}
              </div>

              {project.status !== 'cancelled' && project.status !== 'completed' && (
                <>
                  <Link
                    to={`/client/post?edit=${project.id}`}
                    className="inline-flex items-center gap-3 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit
                  </Link>
                  {project.status === 'in_progress' && (
                    <button
                      onClick={() => setShowCompleteModal(true)}
                      className="inline-flex items-center gap-3 px-5 py-2.5 bg-emerald-50 text-emerald-700 font-medium rounded-xl hover:bg-emerald-100 transition-all border border-emerald-200"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Complete
                    </button>
                  )}
                  <button
                    onClick={() => setShowCloseModal(true)}
                    className="inline-flex items-center gap-3 px-5 py-2.5 bg-orange-50 text-orange-700 font-medium rounded-xl hover:bg-orange-100 transition-all border border-orange-200"
                  >
                    <X className="w-4 h-4" />
                    Close
                  </button>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="inline-flex items-center gap-3 px-5 py-2.5 bg-red-50 text-red-700 font-medium rounded-xl hover:bg-red-100 transition-all border border-red-200"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
              {project.status === 'cancelled' && (
                <button
                  onClick={() => setShowReopenModal(true)}
                  className="inline-flex items-center gap-3 px-5 py-2.5 bg-blue-50 text-blue-700 font-medium rounded-xl hover:bg-blue-100 transition-all border border-blue-200"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reopen
                </button>
              )}
              {project.status === 'completed' && (
                <span className="inline-flex items-center gap-3 px-5 py-2.5 bg-slate-100 text-slate-500 font-medium rounded-xl">
                  <CheckCircle2 className="w-4 h-4" />
                  Project Complete
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.4fr_0.6fr]">
          <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Project details</h2>
              <div className="space-y-4 text-slate-600">
                <div>
                  <div className="text-sm uppercase tracking-[0.2em] text-slate-500 font-semibold mb-2">Description</div>
                  <p className="leading-relaxed">{project.description}</p>
                </div>
                <div>
                  <div className="text-sm uppercase tracking-[0.2em] text-slate-500 font-semibold mb-2">Skills required</div>
                  <div className="flex flex-wrap gap-3">
                    {project.skills_required.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Proposals</h2>
              <p className="text-slate-600">
                This project has <span className="font-semibold text-slate-900">{project.proposals_count ?? 0}</span> proposals so far.
              </p>
            </div>
          </section>

          <aside className="space-y-3">
            {/* Project Meta Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-3 text-sm text-slate-500 mb-2">
                <User className="w-4 h-4" />
                <span>{project.client?.name ?? 'Client'}</span>
              </div>
              <div className="space-y-3 text-sm text-slate-700">
                <div className="flex items-center gap-3">
                  <IndianRupee className="w-4 h-4 text-emerald-500" />
                  <span>Budget: {formatBudgetRange(project.budget_min, project.budget_max)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span>{project.deadline ? new Date(project.deadline).toLocaleDateString() : 'No deadline'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Tag className="w-4 h-4 text-slate-500" />
                  <span>{project.category}</span>
                </div>
                {project.industry && (
                  <div className="flex items-center gap-3">
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <span>{project.industry}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Briefcase className="w-4 h-4 text-slate-500" />
                  <span className="capitalize">{project.experience_level}</span>
                </div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500 font-semibold">
                  {project.visibility || 'public'} project
                </div>
              </div>
            </div>

            {/* How it works note */}
            <TipNote tone="protection" compact>
              <strong>Safe by design:</strong> no money moves outside Growlanzo. You hire → contract + escrow → freelancer
              delivers → you approve → funds release. Disputes and refunds go through our fair resolution process.
            </TipNote>

            {/* Actions Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              {!user && (
                <>
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">Next steps</h3>
                  <div className="space-y-3 text-slate-600 text-sm">
                    <p>Log in to respond, review proposals, or invite freelancers.</p>
                    <Link
                      to="/?modal=login"
                      className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                    >
                      Login to continue
                    </Link>
                  </div>
                </>
              )}
              {isFreelancer && project.status === 'open' && (
                <>
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">Interested in this project?</h3>
                  <Link
                    to={`/dashboard/feed?apply=${project.id}`}
                    className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    Apply Now
                  </Link>
                </>
              )}
              {isOwner && (
                <>
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">Manage Project</h3>
                  <div className="space-y-4">
                    <Link
                      to={`/client/proposals`}
                      className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      View Proposals
                    </Link>
                    <Link
                      to={`/client/matches?project_id=${project.id}`}
                      className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
                    >
                      AI Matches
                    </Link>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Close Project Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-3">
            <div className="flex items-center justify-center w-16 h-16 bg-orange-100 rounded-xl mb-5 mx-auto">
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Close Project</h3>
            <p className="text-sm text-slate-500 text-center mb-3">
              This will mark the project as cancelled. Freelancers will no longer be able to apply.
              Active contracts will continue to be managed from your workspace.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCloseModal(false)}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                Keep Open
              </button>
              <button
                onClick={handleCloseProject}
                disabled={closing}
                className="flex-1 px-4 py-3 bg-orange-600 text-white font-medium rounded-xl hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {closing ? 'Closing...' : 'Close Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Project Modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-3">
            <div className="flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-xl mb-5 mx-auto">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Complete Project</h3>
            <p className="text-sm text-slate-500 text-center mb-3">
              This will mark the project as completed. Escrow funds will be released to the freelancer.
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCompleteModal(false)}
                disabled={completing}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCompleteProject}
                disabled={completing}
                className="flex-1 px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {completing ? 'Completing...' : 'Complete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Project Modal */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-3">
            <div className="flex items-center justify-center w-16 h-16 bg-blue-100 rounded-xl mb-5 mx-auto">
              <RefreshCw className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Reopen Project</h3>
            <p className="text-sm text-slate-500 text-center mb-3">
              This will reopen the project as "Open". Freelancers will be able to apply again.
              AI matches will be regenerated.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowReopenModal(false)}
                disabled={reopening}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReopenProject}
                disabled={reopening}
                className="flex-1 px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {reopening ? 'Reopening...' : 'Reopen Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Project Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-3">
            <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-xl mb-5 mx-auto">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Delete Project</h3>
            <p className="text-sm text-slate-500 text-center mb-3">
              This action cannot be undone. All project data, proposals, and associated records will be permanently removed.
              Projects with active contracts cannot be deleted.
            </p>
            <p className="text-sm font-bold text-red-600 text-center mb-3">
              Are you sure you want to delete "{project.title}"?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleting}
                className="flex-1 px-4 py-3 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
