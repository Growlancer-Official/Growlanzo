import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency, currencySymbol } from '../lib/currency';
import { ArrowRight, Briefcase, CheckCircle, IndianRupee, Sparkles, CheckCircle2 } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { PageSkeleton } from '../components/PageSkeleton';
import { useToast } from '../components/Toast';
import { useCategories } from '../hooks/useCategories';
import { CategoryPicker } from '../components/CategoryPicker';
import { IndustrySelect } from '../components/IndustrySelect';
import AIGenerateModal from '../components/AIGenerateModal';

export function ClientPostProjectPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const editProjectId = searchParams.get('edit');
  const { categories } = useCategories();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [fetchingEditData, setFetchingEditData] = useState(!!editProjectId);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    budget: '',
    skills_required: [] as string[],
    deadline: '',
    category: '',
    industry: '',
    experience_level: 'intermediate' as 'entry' | 'intermediate' | 'expert',
    visibility: 'public' as 'public' | 'private' | 'invite_only',
  });

  // Load existing project data for edit mode
  useEffect(() => {
    if (!editProjectId) return;
    
    const fetchProject = async () => {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', editProjectId)
          .eq('client_id', user?.id)
          .single();

        if (error) throw error;
        if (data) {
          const skillNames: string[] = data.skills_required || [];
          setFormData({
            title: data.title || '',
            description: data.description || '',
            // Single-budget model: min === max (legacy projects may differ —
            // prefer budget_max so the stored value matches what was asked).
            budget: (data.budget_max ?? data.budget_min)?.toString() || '',
            skills_required: skillNames,
            deadline: data.deadline ? data.deadline.slice(0, 10) : '',
            category: data.category || '',
            industry: (data as any).industry || '',
            experience_level: (data.experience_level as 'entry' | 'intermediate' | 'expert') || 'intermediate',
            visibility: (data.visibility as 'public' | 'private' | 'invite_only') || 'public',
          });

          // Resolve category ID and free-text skills from existing data
          if (data.category) {
            const cat = categories.find(c => c.name === data.category);
            if (cat) setSelectedCategoryIds([cat.id]);
          }
          if (skillNames.length > 0) {
            setSkillNames(skillNames);
          }
        }
      } catch (err) {
        console.error('Error loading project for edit:', err);
      } finally {
        setFetchingEditData(false);
      }
    };
    fetchProject();
  }, [editProjectId, user?.id, categories]);

  // Sync selected category into formData.category string (also clears on deselect)
  useEffect(() => {
    if (selectedCategoryIds.length > 0) {
      const cat = categories.find(c => c.id === selectedCategoryIds[0]);
      setFormData(prev => ({ ...prev, category: cat ? cat.name : '' }));
    } else {
      setFormData(prev => ({ ...prev, category: '' }));
    }
  }, [selectedCategoryIds, categories]);

  // Sync free-text skills into formData.skills_required
  useEffect(() => {
    setFormData(prev => ({ ...prev, skills_required: skillNames }));
  }, [skillNames]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.description || !formData.budget) {
      toast.error('Validation Error', 'Please fill in all required fields');
      return;
    }

    if (!formData.category) {
      toast.error('Validation Error', 'Please select a category for your project');
      return;
    }

    // Single budget validation
    const budget = parseInt(formData.budget);
    if (isNaN(budget)) {
      toast.error('Validation Error', 'Please enter a valid budget amount.');
      return;
    }
    if (budget < 500) {
      toast.error('Validation Error', `Budget must be at least ${formatCurrency(500)}.`);
      return;
    }
    if (budget > 100000) {
      toast.error('Validation Error', `Budget cannot exceed ${formatCurrency(100000)}.`);
      return;
    }
    setLoading(true);

    try {
      // Single-budget model: min === max = the one budget the client entered.
      // Keeping both columns in sync keeps AI matching, the invite-hire RPC and
      // every existing budget display working without a schema change.
      const projectData = {
        client_id: user?.id,
        title: formData.title,
        description: formData.description,
        budget_min: budget,
        budget_max: budget,
        skills_required: formData.skills_required,
        deadline: formData.deadline || null,
        category: formData.category,
        industry: formData.industry || null,
        experience_level: formData.experience_level,
        visibility: formData.visibility,
      };

      let result;
      if (editProjectId) {
        // UPDATE existing project
        result = await supabase
          .from('projects')
          .update({ ...projectData, updated_at: new Date().toISOString() } as any)
          .eq('id', editProjectId)
          .select()
          .single();
      } else {
        // INSERT new project
        result = await supabase
          .from('projects')
          .insert(projectData as any)
          .select()
          .single();
      }

      const { data: projectDataResult, error: insertError } = result;

      if (insertError) throw insertError;
      if (!projectDataResult) throw new Error('No project data returned');

      // Save to project_categories junction table
      const projectId = projectDataResult.id;

      // Save category link — surface errors so matching issues are never silent
      for (const catId of selectedCategoryIds) {
        const { error: catError } = await supabase.from('project_categories').upsert({
          project_id: projectId,
          category_id: catId,
        }, { onConflict: 'project_id, category_id', ignoreDuplicates: true });
        if (catError) {
          console.error('Failed to link project category:', catError.message);
        }
      }

      // Free-text skills are stored directly on the project (skills_required).
      // No junction-table writes needed — freelancers match on the category.

      // Clear old AI matches so fresh skill-based matching runs on matches page
      const { error: matchError } = await supabase
        .from('ai_matches')
        .delete()
        .eq('project_id', projectId);
      if (matchError) {
        console.error('Failed to clear old AI matches:', matchError.message);
      }

      navigate(`/client/matches?project_id=${projectDataResult.id}`);
    } catch (error) {
      toast.error('Error', 'Failed to save project. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (fetchingEditData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <PageSkeleton showStats={false} cards={false} />
      </div>
    );
  }

  return (
    <div
      className="space-y-1.5"
      // Keep the sticky cookie notice from covering the final "Post Project"
      // action on first visit. Same measured-height pattern as WaitlistPage /
      // UnsubscribePage: the banner publishes --consent-banner-h while visible.
      style={{ paddingBottom: 'calc(var(--consent-banner-h, 0px) + 1rem)' }}
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <Briefcase className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 mb-1 flex items-center gap-2">
            {editProjectId ? 'Edit Project' : 'Post New Project'} <InfoTip title="Post a project" text="Set a clear title, budget and description so freelancers know exactly what you need. The category and skills help AI match you with the best freelancers. After posting, proposals arrive in real time — review, shortlist and hire with escrow protection on every payment." /></h1>
        <p className="text-slate-500 text-xs sm:text-sm">
          {editProjectId
            ? 'Update your project details and regenerate AI matches'
            : 'Fill in the details to post your project and get matched with talented freelancers'}
        </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Basic Information */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-100">
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-emerald-600" />
            Basic Information
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1.5">Project Title *</label>
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all text-sm"
                  placeholder="e.g., Build a React Native Mobile App"
                />
                <AIGenerateModal
                  field="project_title"
                  triggerLabel="AI"
                  className="shrink-0 mt-1"
                  clientFree
                  context={{
                    budget: formData.budget || undefined,
                    category: formData.category || undefined,
                    industry: formData.industry || undefined,
                    skills: formData.skills_required,
                    deadline: formData.deadline || undefined,
                  }}
                  onApply={(text) => setFormData({ ...formData, title: text })}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Stuck on a title? Click <span className="font-semibold text-violet-600">AI</span> — describe what you
                want to build and get a professional title in seconds.
              </p>
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1.5">Description *</label>
              <textarea
                required
                rows={4}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all resize-none text-sm"
                placeholder="Describe your project in detail. Include requirements, deliverables, and any specific skills needed..."
              />
              <div className="mt-2 flex items-center gap-3">
                <AIGenerateModal
                  field="project_description"
                  triggerLabel="Write description with AI"
                  clientFree
                  context={{
                    budget: formData.budget || undefined,
                    category: formData.category || undefined,
                    industry: formData.industry || undefined,
                    skills: formData.skills_required,
                    deadline: formData.deadline || undefined,
                    experience_level: formData.experience_level,
                  }}
                  onApply={(text) => setFormData({ ...formData, description: text })}
                />
                <span className="text-xs text-slate-400">AI is free for clients — no limits</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Experience Level *</label>
                <select
                  required
                  value={formData.experience_level}
                  onChange={(e) => setFormData({ ...formData, experience_level: e.target.value as 'entry' | 'intermediate' | 'expert' })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                >
                  <option value="entry">Entry Level</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="expert">Expert</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Deadline</label>
                <input
                  type="date"
                  aria-label="Project deadline"
                  value={formData.deadline}
                  onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Budget */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-100">
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
            <IndianRupee className="w-4 h-4 text-emerald-600" />
            Budget
          </h2>

          <div className="max-w-md">
            <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1.5">Enter Your Budget ({currencySymbol()}) *</label>
            <input
              type="number"
              required
              min="500"
              max="100000"
              value={formData.budget}
              onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all text-sm"
              placeholder="e.g., 10000"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Set the budget you're willing to pay for this project ({formatCurrency(500)} – {formatCurrency(100000)}).
              Freelancers use it to gauge scope and submit accurate proposals.
            </p>
          </div>

          <div className="mt-4">
            <InfoTip title="How you'll pay — always protected" text="You only pay once a contract starts, and the money goes into{' '} Growlanzo Escrow — never directly to the freelancer. It's released only after you approve the completed work (a small platform fee applies at payment). This keeps your money safe on every project." />
          </div>
        </div>

        {/* Category + Skills (145 categories only, free-text skills) */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-100">
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            Category & Skills
          </h2>
          <p className="text-sm text-slate-500 mb-2">
            Pick the category for your project, then type the skills you need. Growlanzo matches freelancers by category.
          </p>

          {/* Industry — which business sector this project belongs to (optional) */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 mb-2">Your Industry</label>
            <IndustrySelect
              value={formData.industry}
              onChange={(ind) => setFormData((prev) => ({ ...prev, industry: ind }))}
              placeholder="Select the industry your business is in..."
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Helps us recommend the right freelancers for projects like yours (optional)
            </p>
          </div>

          <CategoryPicker
            mode="client"
            maxCategories={1}
            selectedCategoryIds={selectedCategoryIds}
            selectedSkills={skillNames}
            onCategoriesChange={setSelectedCategoryIds}
            onSkillsChange={setSkillNames}
          />

          {/* Show selected category */}
          {formData.category && (
            <div className="mt-4 p-3 bg-emerald-50 rounded-xl">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-700">
                  {formData.category}
                </span>
              </div>
              {skillNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {skillNames.map(skill => (
                    <span key={skill} className="px-2 py-1 bg-white text-emerald-700 rounded-lg text-xs font-medium border border-emerald-200">
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-100">
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 mb-2">Project Visibility</h2>
          <div className="space-y-4">
            {[
              { value: 'public', label: 'Public - Visible to all freelancers', desc: 'Get maximum exposure and proposals' },
              { value: 'private', label: 'Private - Only invited freelancers', desc: 'Control who can see your project' },
              { value: 'invite_only', label: 'Invited Only - Send specific invites', desc: 'Target specific freelancers' },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                  formData.visibility === option.value
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={option.value}
                  checked={formData.visibility === option.value}
                  onChange={(e) => setFormData({ ...formData, visibility: e.target.value as 'public' | 'private' | 'invite_only' })}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-slate-900">{option.label}</p>
                  <p className="text-sm text-slate-500">{option.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate('/client/projects')}
            className="px-4 py-2.5 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                {editProjectId ? 'Updating...' : 'Posting...'}
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                {editProjectId ? 'Update Project' : 'Post Project'}
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
