import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, IndianRupee, FileText, Loader2, Plus, Tag, Trophy, X } from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { useToast } from '../components/Toast';
import { currencySymbol } from '../lib/currency';
import { useAuth } from '../context/AuthContext';
import { contestService, CONTEST_CATEGORIES } from '../lib/contests';

export function ClientContestCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: '',
    contest_type: 'design' as 'design' | 'development' | 'writing' | 'marketing' | 'other',
    prize_amount: '',
    second_prize: '',
    third_prize: '',
    end_date: '',
    max_submissions: '',
    skills_required: [] as string[],
  });
  const [skillInput, setSkillInput] = useState('');

  const skills = [
    'React', 'Node.js', 'Python', 'JavaScript', 'TypeScript',
    'UI/UX Design', 'Graphic Design', 'PenTool', 'Adobe XD',
    'Content Writing', 'SEO', 'Social Media', 'Marketing',
    'Video Editing', '3D Modeling', 'Branding', 'Logo Design',
  ];

  const handleAddSkill = (skill: string) => {
    if (!formData.skills_required.includes(skill)) {
      setFormData({
        ...formData,
        skills_required: [...formData.skills_required, skill],
      });
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setFormData({
      ...formData,
      skills_required: formData.skills_required.filter((s) => s !== skill),
    });
  };

  const handleCustomSkill = () => {
    if (skillInput.trim() && !formData.skills_required.includes(skillInput.trim())) {
      setFormData({
        ...formData,
        skills_required: [...formData.skills_required, skillInput.trim()],
      });
      setSkillInput('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    const result = await contestService.createContest({
      client_id: user.id,
      title: formData.title,
      description: formData.description,
      category: formData.category,
      contest_type: formData.contest_type,
      prize_amount: parseFloat(formData.prize_amount),
      second_prize: formData.second_prize ? parseFloat(formData.second_prize) : 0,
      third_prize: formData.third_prize ? parseFloat(formData.third_prize) : 0,
      skills_required: formData.skills_required,
      start_date: new Date().toISOString(),
      end_date: new Date(formData.end_date).toISOString(),
      max_submissions: formData.max_submissions ? parseInt(formData.max_submissions) : 0,
    });

    setLoading(false);

    if (result.success) {
      navigate('/client/contests');
    } else {
      toast.error('Failed', result.error || 'Failed to create contest');
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <Trophy className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Create Contest <InfoTip title="Tips for a successful contest" text="Set a clear brief with specific deliverables so freelancers know exactly what to submit. A fair prize attracts quality entries — 2nd/3rd prizes are optional but encourage more submissions. The deadline controls how long entries are accepted, then you review and award the winner. Skills shown help freelancers decide if they're a fit." /></h1>
          <p className="text-slate-500 text-xs">Post a design or development contest and receive competing submissions</p>
        </div>
      </div>

      <InfoTip title="Escrow protection — how your prize is secured" text="After creating the contest you'll fund the prize pool (1st + 2nd + 3rd + a 5% platform fee) from your wallet. The money is held in escrow — freelancers can only submit once it's funded, so everyone knows the prize is real. When you award winners, their prizes are released to their wallets. Fair for you, fair for freelancers." />

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Basic Information */}
        <div className="bg-white p-4 rounded-xl border border-slate-100">
          <h2 className="font-display text-xl font-bold text-slate-900 mb-2 flex items-center gap-3">
            <FileText className="w-4 h-4 text-emerald-600" />
            Contest Details
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Contest Title *</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                placeholder="e.g., Design a Modern Logo for Our Tech Startup"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Description *</label>
              <textarea
                required
                rows={6}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all resize-none"
                placeholder="Describe what you're looking for. Include requirements, deliverables, and any specific details..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Category *</label>
                <select
                  required
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                >
                  <option value="">Select category</option>
                  {CONTEST_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Contest Type *</label>
                <select
                  required
                  value={formData.contest_type}
                  onChange={(e) => setFormData({ ...formData, contest_type: e.target.value as typeof formData.contest_type })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                >
                  <option value="design">Design</option>
                  <option value="development">Development</option>
                  <option value="writing">Writing</option>
                  <option value="marketing">Marketing</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Prize & Timeline */}
        <div className="bg-white p-4 rounded-xl border border-slate-100">
          <h2 className="font-display text-xl font-bold text-slate-900 mb-2 flex items-center gap-3">
            <IndianRupee className="w-4 h-4 text-emerald-600" />
            Prizes & Timeline
          </h2>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">1st Prize ({currencySymbol()}) *</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={formData.prize_amount}
                  onChange={(e) => setFormData({ ...formData, prize_amount: e.target.value })}
                  aria-label="First prize amount"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  placeholder="500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">2nd Prize ({currencySymbol()})</label>
                <input
                  type="number"
                  min="0"
                  value={formData.second_prize}
                  onChange={(e) => setFormData({ ...formData, second_prize: e.target.value })}
                  aria-label="Second prize amount"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  placeholder="250"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">3rd Prize ({currencySymbol()})</label>
                <input
                  type="number"
                  min="0"
                  value={formData.third_prize}
                  onChange={(e) => setFormData({ ...formData, third_prize: e.target.value })}
                  aria-label="Third prize amount"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  placeholder="100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">End Date *</label>
                <input
                  type="date"
                  required
                  min={new Date().toISOString().split('T')[0]}
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  aria-label="Contest end date"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Max Submissions (0 = unlimited)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.max_submissions}
                  onChange={(e) => setFormData({ ...formData, max_submissions: e.target.value })}
                  aria-label="Maximum submissions per participant (0 means unlimited)"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  placeholder="0"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Skills */}
        <div className="bg-white p-4 rounded-xl border border-slate-100">
          <h2 className="font-display text-xl font-bold text-slate-900 mb-2 flex items-center gap-3">
            <Tag className="w-4 h-4 text-emerald-600" />
            Required Skills
          </h2>

          <div className="mb-2">
            <div className="flex gap-3">
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCustomSkill())}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                placeholder="Type a skill and press Enter"
              />
              <button
                type="button"
                onClick={handleCustomSkill}
                aria-label="Add skill"
                className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mb-2">
            {skills.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => handleAddSkill(skill)}
                className={`px-4 py-2 rounded-full border transition-colors ${
                  formData.skills_required.includes(skill)
                    ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                }`}
              >
                {skill}
              </button>
            ))}
          </div>

          {formData.skills_required.length > 0 && (
            <div className="flex flex-wrap gap-3 p-4 bg-slate-50 rounded-xl">
              <span className="text-sm font-medium text-slate-700">Selected:</span>
              {formData.skills_required.map((skill) => (
                <span
                  key={skill}
                  className="px-3 py-1 bg-emerald-100 text-emerald-700 text-sm font-medium rounded-full flex items-center gap-1"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="hover:text-emerald-900"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/client/contests')}
            className="px-3 py-3 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin w-5 h-5" />
                Creating...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Create Contest
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
