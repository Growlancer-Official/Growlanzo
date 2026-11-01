import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { aiMatchingService, type AIMatchWithProfile } from '../lib/aiMatching';
import { realtimeChannels, supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/currency';
import { useAuth } from '../context/AuthContext';
import { inviteFreelancerToProject } from '../lib/workflowService';
import { CheckCircle2, IndianRupee, MapPin, RefreshCw, Send, Sparkles, Star, User, XCircle, Plus, Briefcase, ArrowRight, Loader2 } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { useToast } from '../components/Toast';
import { ProBadge } from '../components/ProBadge';
import { VerifiedBadge } from '../components/VerifiedBadge';

export function ClientMatchesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id');

  const [matches, setMatches] = useState<AIMatchWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [invitedFreelancers, setInvitedFreelancers] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const toast = useToast();
  const [clientProjects, setClientProjects] = useState<{ id: string; title: string; skills_required: string[] }[]>([]);
  const [currentProject, setCurrentProject] = useState<{ id: string; title: string; skills_required: string[] } | null>(null);
  const initializedProjects = useRef<Set<string>>(new Set());

  // Fetch all client projects + current project details
  useEffect(() => {
    if (!user?.id) return;

    const fetchProjects = async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, title, skills_required')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });

      setClientProjects(data || []);

      // If projectId is set, find current project
      if (projectId && data) {
        const found = data.find(p => p.id === projectId);
        setCurrentProject(found || null);
      } else {
        setCurrentProject(null);
      }
    };

    fetchProjects();
  }, [user?.id, projectId]);

  // Auto-generate matches once per project (tracks initialized IDs via ref)
  useEffect(() => {
    if (!projectId) return;
    if (initializedProjects.current.has(projectId)) return;
    
    initializedProjects.current.add(projectId);
    
    const autoGenerate = async () => {
      setLoading(true);
      
      // Check if any matches exist
      const { data: existingMatches } = await supabase
        .from('ai_matches')
        .select('id')
        .eq('project_id', projectId)
        .limit(1);
      
      // Only generate if NO matches exist yet
      if (!existingMatches || existingMatches.length === 0) {
        await aiMatchingService.generateMatches(projectId);
      }
      
      // Fetch matches regardless
      const data = await aiMatchingService.getProjectMatches(projectId);
      setMatches(data);
      setLoading(false);
    };
    
    autoGenerate();
  }, [projectId]);

  const fetchMatches = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }

    setLoading(true);
    const data = await aiMatchingService.getProjectMatches(projectId);
    setMatches(data);
    setLoading(false);
  }, [projectId]);

  // Live list when AI matches are inserted/updated for this project
  useEffect(() => {
    if (!projectId) return;

    const channel = realtimeChannels
      .aiMatches(`client-matches-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_matches',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void fetchMatches();
        }
      )
      .subscribe();

    // Fetch existing invites for this project
    const fetchInvites = async () => {
      const { data } = await supabase
        .from('invites')
        .select('freelancer_id')
        .eq('project_id', projectId);

      if (data) {
        setInvitedFreelancers(new Set(data.map(i => i.freelancer_id)));
      }
    };
    void fetchInvites();

    // Subscribe to invites realtime changes
    const inviteChannel = supabase
      .channel(`client-invites-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invites',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void fetchInvites();
        }
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
      void inviteChannel.unsubscribe();
    };
  }, [projectId, fetchMatches]);

  const handleGenerateMatches = async () => {
    if (!projectId) return;

    setGenerating(true);
    setSkipped(new Set()); // Reset skipped
    const result = await aiMatchingService.generateMatches(projectId);

    if (result.success) {
      await fetchMatches();
    }
    setGenerating(false);
  };

  const handleInvite = async (freelancerId: string) => {
    if (!user?.id || !projectId) return;
    setInviteBusy(freelancerId);
    const result = await inviteFreelancerToProject(
      user.id,
      projectId,
      freelancerId,
      'We would like you to review this project on Growlanzo.'
    );
    if (!result.success) toast.error('Invite Failed', result.error || 'Invite failed');
    setInviteBusy(null);
  };

  const visibleMatches = matches.filter((m) => !skipped.has(m.freelancer_id));

  // CASE 1: User has NO projects at all
  if (!loading && clientProjects.length === 0 && !projectId) {
    return (
      <div className="space-y-1.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">AI Talent Matches <InfoTip title="How AI matching works" text="Our engine scores freelancers against your project's skills, experience and budget — higher scores mean a stronger fit. Invite the freelancers you like; when they accept, a contract and workspace are created and the milestone escrow protects the payment. Regenerate anytime to refresh the list in real time." /></h1>
              <p className="text-slate-500 mt-1">
                Get AI-powered freelancer recommendations based on your project requirements
              </p>
            </div>
          </div>
        </div>

        <div className="text-center py-16 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="h-20 w-20 rounded-xl bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <Briefcase className="w-7 h-7 text-emerald-600" />
          </div>
          <h3 className="font-display text-xl font-bold text-slate-900 mb-2">No Projects Yet</h3>
          <p className="text-slate-500 mb-4 max-w-md mx-auto">
            Create your first project with the skills you need, and our AI will find the perfect freelancers for you.
          </p>
          <Link
            to="/client/post"
            className="inline-flex items-center justify-center gap-3 px-8 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all"
          >
            <Plus className="w-4 h-4" />
            Create Your First Project
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  // CASE 2: User has projects but NO project selected
  if (!projectId) {
    return (
      <div className="space-y-1.5">
      <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">AI Talent Matches <InfoTip title="How AI matching works" text="Our engine scores freelancers against your project's skills, experience and budget — higher scores mean a stronger fit. Invite the freelancers you like; when they accept, a contract and workspace are created and the milestone escrow protects the payment. Regenerate anytime to refresh the list in real time." /></h1>
              <p className="text-slate-500 mt-1">
                Select a project to view AI-powered freelancer recommendations
              </p>
            </div>
          </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-display font-bold text-slate-900 mb-2">Your Projects</h3>
          {clientProjects.length > 0 ? (
            <div className="grid gap-1.5">
              {clientProjects.map((p) => (
                <Link
                  key={p.id}
                  to={`/client/matches?project_id=${p.id}`}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-emerald-400 hover:bg-emerald-50/50 transition-all group"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <Briefcase className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-slate-900">{p.title}</p>
                      <p className="text-xs text-slate-400">
                        {p.skills_required?.length || 0} skills • Click to view matches
                      </p>
                    </div>
                  </div>
                  <Sparkles className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-500 mb-2">No projects found</p>
              <Link
                to="/client/post"
                className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all"
              >
                <Plus className="w-4 h-4" />
                Post a New Project
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  // CASE 3: Project selected — show matches

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <Link
              to="/client/matches"
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              ← All Projects
            </Link>
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            {currentProject?.title || 'AI Talent Matches'}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {currentProject?.skills_required?.length 
              ? `Matching freelancers by: ${currentProject.skills_required.join(', ')}`
              : 'No skills set — edit project to add skills for better matches'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to={`/client/post?edit=${projectId}`}
            className="px-4 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
          >
            Edit Project
          </Link>
          <button
            onClick={handleGenerateMatches}
            disabled={generating}
            className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Matching...' : 'Generate Matches'}
          </button>
          {matches.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-sm">
              <Sparkles className="w-4 h-4" />
              <span className="font-bold">{visibleMatches.length} Matches</span>
            </div>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Finding the best freelancers for your project...</p>
          </div>
        </div>
      )}

      {/* Empty State — No matches generated yet */}
      {!loading && matches.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <Sparkles className="w-16 h-16 text-slate-300 mx-auto mb-2" />
          <h3 className="font-display text-xl font-bold text-slate-900 mb-2">No Matches Found</h3>
          <p className="text-slate-500 mb-2 max-w-md mx-auto">
            {currentProject?.skills_required?.length 
              ? 'No freelancers match your project skills yet. Try adding more skills or adjusting your requirements.'
              : 'Add skills to your project first so our AI can find matching freelancers.'}
          </p>
          {currentProject?.skills_required?.length ? (
            <p className="text-xs text-slate-400 mb-3">
              Searching for: {currentProject.skills_required.join(', ')}
            </p>
          ) : null}
          <div className="flex gap-1.5 justify-center">
            <button
              onClick={handleGenerateMatches}
              disabled={generating}
              className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Generating...' : 'Generate Matches'}
            </button>
            <Link
              to={`/client/post?edit=${projectId}`}
              className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors"
            >
              Edit Project Skills
            </Link>
          </div>
        </div>
      )}

      {/* Match Cards */}
      {!loading && visibleMatches.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {visibleMatches.map((match) => (
            <div
              key={match.id}
              className="bg-white p-6 rounded-xl border border-slate-100 hover:shadow-md transition-shadow"
            >
              {/* Match Score Badge */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-bold">
                  <Sparkles className="w-4 h-4" />
                  {match.match_score}% Match
                </div>
                {match.ai_score != null && (
                  <span className="text-xs font-semibold text-blue-600 bg-blue-50 ring-1 ring-blue-200 rounded-full px-2 py-0.5">
                    AI Score {match.ai_score}
                  </span>
                )}
              </div>

              {/* AI Match Reason */}
              {match.match_reason && (
                <p className="mb-2 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  <span className="font-medium text-slate-600">Why matched: </span>
                  {match.match_reason}
                </p>
              )}

              {/* Freelancer Info */}
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden">
                  {match.freelancer.avatar ? (
                    <img src={match.freelancer.avatar} alt={match.freelancer.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-900 flex items-center gap-1.5">
                    {match.freelancer.name || 'Unknown'}
                    {match.freelancer.verification_status === 'verified' && <VerifiedBadge size="xs" />}
                    {match.freelancer.is_pro && <ProBadge size="xs" />}
                  </h3>
                  <div className="flex items-center gap-1 text-sm text-slate-500">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    <span>{match.freelancer.freelancer_profiles?.rating ? Number(match.freelancer.freelancer_profiles.rating).toFixed(1) : '—'}</span>
                    <span className="text-slate-400">({match.freelancer.freelancer_profiles?.reviews_count ?? 0} reviews)</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-2 text-sm">
                <div className="flex items-center gap-3 text-slate-600">
                  <IndianRupee className="w-4 h-4" />
                  {match.freelancer.hourly_rate > 0 ? (
                    <span>
                      {formatCurrency(match.freelancer.hourly_rate)}
                      <span className="text-xs text-slate-400">/hr</span>
                    </span>
                  ) : (match.freelancer.starting_rate || 0) > 0 ? (
                    <span title="Starting price from this freelancer's published services">
                      From {formatCurrency(match.freelancer.starting_rate || 0)}
                    </span>
                  ) : (
                    <span className="text-slate-500">Rate on request</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-slate-600">
                  <MapPin className="w-4 h-4" />
                  <span>{match.freelancer.location || 'Remote'}</span>
                </div>
              </div>

              {/* Skills */}
              <div className="flex flex-wrap gap-3 mb-2">
                {match.freelancer.skills?.slice(0, 3).map((skill) => (
                  <span
                    key={skill}
                    className="px-2 py-1 bg-slate-50 text-slate-600 text-xs font-medium rounded-full border border-slate-200"
                  >
                    {skill}
                  </span>
                ))}
                {match.freelancer.skills && match.freelancer.skills.length > 3 && (
                  <span className="px-2 py-1 bg-slate-50 text-slate-600 text-xs font-medium rounded-full border border-slate-200">
                    +{match.freelancer.skills.length - 3}
                  </span>
                )}
              </div>

              {/* Score Breakdown */}
              <div className="space-y-4 mb-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Skills</span>
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 rounded-full" 
                        style={{ width: `${match.skill_score}%` }}
                      />
                    </div>
                    <span className="font-medium text-slate-700">{match.skill_score}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Experience</span>
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full" 
                        style={{ width: `${match.experience_score}%` }}
                      />
                    </div>
                    <span className="font-medium text-slate-700">{match.experience_score}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Budget</span>
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-purple-500 rounded-full" 
                        style={{ width: `${match.budget_score}%` }}
                      />
                    </div>
                    <span className="font-medium text-slate-700">{match.budget_score}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                {invitedFreelancers.has(match.freelancer_id) ? (
                  <button
                    type="button"
                    disabled
                    className="flex-1 flex items-center justify-center gap-3 px-4 py-2 bg-slate-100 text-slate-500 font-bold rounded-lg cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Invited
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={inviteBusy === match.freelancer_id}
                    onClick={() => handleInvite(match.freelancer_id)}
                    className="flex-1 inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {inviteBusy === match.freelancer_id ? 'Sending…' : 'Invite'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSkipped((s) => new Set(s).add(match.freelancer_id))}
                  className="flex items-center justify-center gap-3 px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  Skip
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All Skipped */}
      {!loading && visibleMatches.length === 0 && matches.length > 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <XCircle className="w-16 h-16 text-slate-300 mx-auto mb-2" />
          <h3 className="font-display text-lg font-medium text-slate-900 mb-2">All matches skipped</h3>
          <p className="text-slate-500 mb-2">
            You've skipped all {matches.length} match{matches.length !== 1 ? 'es' : ''}. Regenerate to find new freelancers.
          </p>
          <div className="flex gap-1.5 justify-center">
            <button
              onClick={() => setSkipped(new Set())}
              className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors"
            >
              Show Skipped
            </button>
            <button
              onClick={handleGenerateMatches}
              disabled={generating}
              className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Generating...' : 'Regenerate Matches'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
