import { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Camera,
  Check,
  CheckCircle,
  Globe,
  Loader2,
  MapPin,
  Shield,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { validateOptionalGstin } from '../lib/gst';
import { CategoryPicker } from '../components/CategoryPicker';
import { IndustrySelect } from '../components/IndustrySelect';
import { CountrySelect } from '../components/CountrySelect';
import { useCategories } from '../hooks/useCategories';
import { avatarUploadService } from '../lib/avatarUpload';
import { avatarPackService } from '../lib/avatarPack';
import { fetchUserProfile, createUserProfile } from '../lib/services/authService';
import { useToast } from '../components/Toast';
import { BrandLogo } from '../components/BrandLogo';

interface FreelancerForm {
  name: string;
  title: string;
  bio: string;
  hourly_rate: number;
  experience: number;
  location: string;
  portfolio_url: string;
  availability: boolean;
  avatar_url: string | null;
  languages: string[];
}

/** Common languages offered to freelancers during onboarding (module-scope constant). */
const COMMON_LANGUAGES = ['English', 'Hindi', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Japanese', 'Chinese', 'Korean', 'Russian', 'Italian', 'Dutch', 'Turkish', 'Bengali', 'Telugu', 'Tamil', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu'];

/** Max characters allowed for a custom language name. */
const MAX_LANGUAGE_LENGTH = 40;

interface ClientForm {
  name: string;
  account_type: 'individual' | 'business';
  company_name: string;
  gst_number: string;
  industry: string;
  size: string;
  location: string;
  description: string;
  website: string;
  company_logo: string | null;
}

type Step = 'welcome' | 'profile' | 'skills' | 'review';


export function OnboardingPage() {
  const toast = useToast();
  const { user, getDashboardRoute, updateUser } = useAuth();
  const { categories } = useCategories();

  // ── ALL hooks declared BEFORE any early return ──
  const [step, setStep] = useState<Step>('welcome');
  const [animationDir, setAnimationDir] = useState<'next' | 'prev'>('next');
  const [saving, setSaving] = useState(false);
  const [showSkipModal, setShowSkipModal] = useState(false);

  // 🎯 ONE onboarding for everyone (email + GitHub/LinkedIn OAuth + invite).
  // The role is chosen on the welcome step: email users see their signup role
  // pre-selected (and can switch before committing), OAuth users pick freely.
  // Previously OAuth users got a separate 1-step mini form — that duplicate
  // experience is gone; every user walks the same welcome → profile → skills
  // → review flow and the chosen role flows through to profiles.role.
  const [chosenRole, setChosenRole] = useState<'freelancer' | 'client' | null>(
    user?.role === 'freelancer' || user?.role === 'client' ? user.role : null
  );

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Client company logo upload state
  const [uploadingClientLogo, setUploadingClientLogo] = useState(false);
  const clientLogoInputRef = useRef<HTMLInputElement>(null);

  // Freelancer form state
  const [freelancerForm, setFreelancerForm] = useState<FreelancerForm>({
    name: user?.name || '',
    title: '',
    bio: '',
    hourly_rate: 0,
    experience: 0,
    location: '',
    portfolio_url: '',
    availability: true,
    avatar_url: null,
    languages: [],
  });

  const [languageInput, setLanguageInput] = useState('');
  const [languageSuggestions, setLanguageSuggestions] = useState<string[]>([]);

  // Raw numeric-field text (decimal-friendly editing) — typing "2." must not
  // collapse to "2"; the parsed numbers still live in freelancerForm.
  const [experienceInput, setExperienceInput] = useState('');

  // Client form state
  const [clientForm, setClientForm] = useState<ClientForm>({
    name: user?.name || '',
    account_type: 'individual',
    company_name: '',
    gst_number: '',
    industry: '',
    size: '',
    location: '',
    description: '',
    website: '',
    company_logo: null,
  });
  const [gstError, setGstError] = useState<string | null>(null);

  // Referral code state (optional, validated live against profiles.referral_code)
  const [referralCode, setReferralCode] = useState('');
  const [referralStatus, setReferralStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'wrong-role'>('idle');
  const [referrerName, setReferrerName] = useState<string | null>(null);

  // Category + free-text skills state (freelancer only)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [selectedCategoryNames, setSelectedCategoryNames] = useState<string[]>([]);

  // Sync selected category IDs to names for form submission
  useEffect(() => {
    const names = selectedCategoryIds
      .map(id => categories.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map(c => c.name);
    setSelectedCategoryNames(names);
  }, [selectedCategoryIds, categories]);

  // Real-time referral code validation (debounced). Same-side rule: a
  // freelancer's code only works for freelancers, a client's for clients —
  // mirrored here so the mistake is caught while typing, not at submit.
  useEffect(() => {
    const code = referralCode.trim();
    if (!code) {
      setReferralStatus('idle');
      setReferrerName(null);
      return;
    }
    if (!user?.id) return;
    setReferralStatus('checking');
    const t = setTimeout(async () => {
      const { data: privData, error } = await supabase
        .from('profiles_private')
        .select('id')
        .eq('referral_code', code)
        .neq('id', user.id)
        .maybeSingle();
      let data: { id: string; name: string | null; role: string | null } | null = null;
      if (privData) {
        const { data: pub } = await supabase.from('profiles').select('id, name, role').eq('id', privData.id).maybeSingle();
        data = pub ? { ...pub } : null;
      }
      if (error) { setReferralStatus('invalid'); return; }
      if (data) {
        const effectiveRole = chosenRole ?? (user.role === 'freelancer' || user.role === 'client' ? user.role : null);
        if (effectiveRole && data.role && data.role !== effectiveRole && data.role !== 'admin') {
          setReferralStatus('wrong-role');
          setReferrerName(null);
          return;
        }
        setReferralStatus('valid');
        setReferrerName(data.name);
      } else {
        setReferralStatus('invalid');
        setReferrerName(null);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [referralCode, user?.id, user?.role, chosenRole]);

  // Role-aware rendering: the welcome-step choice (chosenRole) wins over the
  // context role so switching roles mid-onboarding updates the form instantly.
  const isFreelancer = (chosenRole ?? user?.role) === 'freelancer';
  const isClient = !isFreelancer;

  const handleNext = () => {
    setAnimationDir('next');
    if (step === 'welcome') setStep('profile');
    else if (step === 'profile') {
      // Client users skip the skills step (no skills to add) and go straight to review
      if (isClient) setStep('review');
      else setStep('skills');
    }
    else if (step === 'skills') setStep('review');
  };

  const handleBack = () => {
    setAnimationDir('prev');
    if (step === 'profile') setStep('welcome');
    else if (step === 'skills') setStep('profile');
    else if (step === 'review') {
      // Client users go back to profile (they never visited skills)
      if (isClient) setStep('profile');
      else setStep('skills');
    }
  };

  const handleSkip = () => setShowSkipModal(true);

  const confirmSkip = async () => {
    if (!user?.id) return;

    // 🎯 The role picked on the welcome step wins — skip must land on THAT
    // dashboard (freelancer OR client), never a hardcoded freelancer default.
    const finalRole = isFreelancer ? 'freelancer' : 'client';

    try {
      // Ensure a basic profile row exists so the dashboard doesn't
      // see an empty/null profile (breaks getOpenProjects matching).
      const existing = await fetchUserProfile(user.id);
      if (!existing) {
        const created = await createUserProfile(
          user.id, user.email || '', user.name || 'User',
          finalRole
        );
        if (!created) {
          toast.error('Profile Error', 'Failed to create your profile. Please try again or contact support.');
          return;
        }
      } else if (existing.role !== finalRole) {
        // Role was changed on the welcome step — persist it so the dashboard
        // redirect and role gates match the user's choice.
        const { error: roleErr } = await supabase
          .from('profiles')
          .update({ role: finalRole, updated_at: new Date().toISOString() } as any)
          .eq('id', user.id);
        if (roleErr) console.error('Onboarding skip role change error:', roleErr);
      }

      // If freelancer, create a minimal freelancer_profiles row
      if (isFreelancer) {
        const { error: fpErr } = await supabase.from('freelancer_profiles').upsert({
          user_id: user.id,
          availability: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (fpErr) {
          toast.error('Save Error', 'Failed to save your profile: ' + fpErr.message);
          return;
        }
      }

      // If client, create a minimal client_profiles row
      if (isClient) {
        const { error: cpErr } = await supabase.from('client_profiles').upsert({
          user_id: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (cpErr) {
          toast.error('Save Error', 'Failed to save your company profile: ' + cpErr.message);
          return;
        }
      }

      const { data: onboardingResult, error: onboardingErr } = await (supabase.rpc as any)('complete_onboarding');
      if (onboardingErr) {
        toast.error('Completion Error', 'Failed to complete onboarding: ' + onboardingErr.message);
        return;
      }
      // Check RPC return value — success may be false without a PostgreSQL error
      if (onboardingResult && (onboardingResult as any).success === false) {
        const errMsg = (onboardingResult as any).error || 'RPC returned failure';
        toast.error('Completion Error', 'Failed to complete onboarding: ' + errMsg);
        return;
      }

      updateUser({ onboardingCompleted: true, role: finalRole });
    } catch (err) {
      console.error('Skip onboarding error:', err);
      toast.error('Save Error', 'Failed to skip setup. Please try again.');
      return;
    }

    window.location.href = getDashboardRoute(finalRole);
  };

  const handleSubmit = async () => {
    if (!user?.id) return;
    if (uploadingAvatar) {
      toast.error('Upload In Progress', 'Please wait for your profile photo to finish uploading.');
      return;
    }
    setSaving(true);

    try {
      const existing = await fetchUserProfile(user.id);
      const finalRole = isFreelancer ? 'freelancer' : 'client';
      if (!existing) {
        const created = await createUserProfile(
          user.id,
          user.email || '',
          user.name || 'User',
          finalRole
        );
        if (!created) {
          toast.error('Profile Error', 'Failed to create your profile. Please try again or contact support.');
          setSaving(false);
          return;
        }
      } else if (existing.role !== finalRole) {
        // Role was changed on the welcome step (e.g. OAuth user switched to
        // client) — persist it so the dashboard redirect and role gates match.
        const { error: roleErr } = await supabase
          .from('profiles')
          .update({ role: finalRole, updated_at: new Date().toISOString() } as any)
          .eq('id', user.id);
        if (roleErr) console.error('Onboarding role change error:', roleErr);
      }

      // Save the chosen display name + start the 30-day security lock
      const { error: nameErr } = await supabase
        .from('profiles')
        .update({
          name: (isFreelancer ? freelancerForm.name : clientForm.name).trim() || user.name || 'User',
          name_changed_at: new Date().toISOString(),
        } as any)
        .eq('id', user.id);
      if (nameErr) console.error('Onboarding name save error:', nameErr);

      if (isFreelancer) {
        const { error: fpError } = await supabase
          .from('freelancer_profiles')
          .upsert({
            user_id: user.id,
            title: freelancerForm.title,
            bio: freelancerForm.bio,
            hourly_rate: freelancerForm.hourly_rate || null,
            experience: freelancerForm.experience || null,
            skills: skillNames.length > 0 ? skillNames : freelancerForm.title ? [freelancerForm.title] : [],
            categories: selectedCategoryNames.length > 0 ? selectedCategoryNames : null,
            location: freelancerForm.location || null,
            portfolio_url: freelancerForm.portfolio_url || null,
            languages: freelancerForm.languages.length > 0 ? freelancerForm.languages : null,
            availability: freelancerForm.availability,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        if (fpError) {
          console.error('Onboarding freelancer_profiles error:', fpError);
          toast.error('Save Error', 'Failed to save your profile: ' + fpError.message);
          setSaving(false);
          return;
        }

        // 🆕 Sync country from onboarding to profiles.country (used by ranking, search, matching)
        if (freelancerForm.location) {
          const { error: countryErr } = await supabase.rpc('update_user_country', {
            p_user_id: user.id,
            p_country: freelancerForm.location,
          });
          if (countryErr) console.warn('Onboarding country sync warning:', countryErr.message);
        }

        if (freelancerForm.avatar_url) {
          const { error: avatarError } = await supabase
            .from('profiles')
            .update({ avatar: freelancerForm.avatar_url })
            .eq('id', user.id);
          if (avatarError) {
            console.error('Onboarding avatar save error:', avatarError);
            // Non-fatal — continue (avatar failure shouldn't block onboarding)
          }
        }
      } else if (isClient) {
        const { error: cpError } = await supabase
          .from('client_profiles')
          .upsert({
            user_id: user.id,
            company_name: clientForm.account_type === 'business' ? (clientForm.company_name || null) : null,
            account_type: clientForm.account_type,
            gst_number: clientForm.account_type === 'business' ? (clientForm.gst_number || null) : null,
            industry: clientForm.industry || null,
            size: clientForm.size || null,
            location: clientForm.location || null,
            description: clientForm.description || null,
            website: clientForm.website || null,
            company_logo: clientForm.company_logo || null,
            updated_at: new Date().toISOString(),
          } as any, { onConflict: 'user_id' });

        if (cpError) {
          console.error('Onboarding client_profiles error:', cpError);
          toast.error('Save Error', 'Failed to save your company profile: ' + cpError.message);
          setSaving(false);
          return;
        }

        // 🆕 Sync country from onboarding to profiles.country (used by ranking, search, matching)
        if (clientForm.location) {
          const { error: countryErr } = await supabase.rpc('update_user_country', {
            p_user_id: user.id,
            p_country: clientForm.location,
          });
          if (countryErr) console.warn('Onboarding client country sync warning:', countryErr.message);
        }

        // 🔄 Sync company logo into profiles.avatar so the header/profile icon
        // updates immediately (AuthContext reacts to profiles realtime).
        if (clientForm.company_logo) {
          const { error: avatarError } = await supabase
            .from('profiles')
            .update({ avatar: clientForm.company_logo, updated_at: new Date().toISOString() })
            .eq('id', user.id);
          if (avatarError) {
            console.error('Onboarding client avatar sync error:', avatarError);
          }
        }
      }

      const updatedProfile = await fetchUserProfile(user.id);
      if (!updatedProfile) {
        toast.error('Session Expired', 'Please log in again.');
        setSaving(false);
        return;
      }

      const { data: onboardingData, error: onboardingError } = await (supabase.rpc as any)('complete_onboarding');

      if (onboardingError) {
        console.error('Onboarding completion error:', onboardingError);
        toast.error('Completion Error', 'Failed to complete onboarding: ' + onboardingError.message);
        setSaving(false);
        return;
      }
      // Check RPC return value — success may be false without a PostgreSQL error
      if (onboardingData && (onboardingData as any).success === false) {
        const errMsg = (onboardingData as any).error || 'RPC returned failure';
        console.error('Onboarding completion RPC failed:', errMsg);
        toast.error('Completion Error', 'Failed to complete onboarding: ' + errMsg);
        setSaving(false);
        return;
      }

      // Apply referral code (optional — never blocks onboarding)
      if (referralStatus === 'valid' && referralCode.trim()) {
        const { data: refData, error: refErr } = await supabase.rpc('process_referral', {
          p_referral_code: referralCode.trim(),
          p_new_user_id: user.id,
          p_new_user_email: user.email || '',
        });
        if (refErr) {
          console.error('Referral apply error:', refErr);
        } else if ((refData as any)?.success === false && (refData as any)?.error_code === 'monthly_cap') {
          // The referrer already invited their 5 people this month. The code is
          // valid; this signup simply carries no attribution. Say so instead of
          // silently dropping it — never block onboarding on a referral.
          toast.info(
            'Referral limit reached',
            'That code has already been used for the maximum number of referrals this month, so this account is not linked to it.'
          );
        }
      }

      // Complete any pending referral now that onboarding is done — this is
      // the completion event the referral system was waiting for. Without it
      // referrals stayed "pending" forever and referrers never earned their
      // bonus. No-op when this user signed up without a referral.
      try {
        const { data: refComplete, error: refCompleteErr } = await (supabase.rpc as any)('complete_referral', {
          p_referee_user_id: user.id,
        });
        if (refCompleteErr) {
          console.error('Referral completion error:', refCompleteErr);
        } else if (refComplete && (refComplete as any).success === false && (refComplete as any).error !== 'No pending referral found') {
          console.error('Referral completion failed:', (refComplete as any).error);
        }
      } catch (refE) {
        // Never block onboarding on referral completion
        console.error('Referral completion exception:', refE);
      }

      // 🆕 Sync context BEFORE redirect so the dashboard route check sees
      // onboardingCompleted + the chosen role immediately (no stale-gate flash
      // and the right dashboard for the role picked on the welcome step).
      updateUser({ onboardingCompleted: true, role: finalRole });
      window.location.href = getDashboardRoute(finalRole);
    } catch (err) {
      console.error('Onboarding save error:', err);
      toast.error('Save Error', 'Failed to save your profile. Please try again. Error: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Calculate progress
  // Clients skip the skills step, so their flow is 3 steps (welcome → profile → review)
  const stepIndex = ['welcome', 'profile', 'skills', 'review'].indexOf(step);
  const totalSteps = isClient ? 3 : 4;
  const progress = ((stepIndex + 1) / totalSteps) * 100;

  const stepDots = isClient
    ? [
        { id: 'welcome', label: 'Welcome', icon: Sparkles },
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'review', label: 'Review', icon: Check },
      ]
    : [
        { id: 'welcome', label: 'Welcome', icon: Sparkles },
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'skills', label: 'Skills', icon: Briefcase },
        { id: 'review', label: 'Review', icon: Check },
      ];

  const isFormValid = () => {
    // Welcome step requires a role choice (one onboarding for everyone —
    // email users get their signup role pre-selected, OAuth users pick here).
    if (step === 'welcome') return !!chosenRole;
    if (step === 'profile' && isFreelancer) {
      return (
        freelancerForm.name.trim().length > 0 &&
        freelancerForm.title.trim().length > 0 &&
        freelancerForm.bio.trim().length > 0
      );
    }
    if (step === 'profile' && isClient) {
      if (clientForm.name.trim().length === 0) return false;
      // Business accounts must name the company; individual accounts may skip it.
      if (clientForm.account_type === 'business' && clientForm.company_name.trim().length === 0) return false;
      // GST is optional, but if provided it must be valid.
      return validateOptionalGstin(clientForm.gst_number).valid;
    }
    return true;
  };

  const canProceed = isFormValid();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-emerald-50/30 flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/50">
        <div className="max-w-[100rem] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 group">
            <BrandLogo variant="wordmark" className="h-8 sm:h-9 transition-transform group-hover:scale-105 w-auto" />
          </div>
          <button
            onClick={handleSkip}
            className="text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors"
          >
            Skip
          </button>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-slate-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step Dots Indicator */}
      <div className="bg-white/50 border-b border-slate-100">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          {stepDots.map((s, i) => {
            const Icon = s.icon;
            const isActive = stepIndex >= i;
            const isCurrent = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                  isCurrent
                    ? 'bg-emerald-100 text-emerald-700'
                    : isActive
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-400'
                }`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < stepDots.length - 1 && (
                  <div className={`w-6 h-0.5 ${isActive && i < stepIndex ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center p-4 sm:p-3 pt-8">
        <div className="max-w-2xl w-full">
          <div
            className={`bg-white rounded-xl p-3 sm:p-10 shadow-sm border border-slate-100 transition-all duration-400 ${
              animationDir === 'next'
                ? 'animate-in fade-in slide-in-from-right-4'
                : 'animate-in fade-in slide-in-from-left-4'
            }`}
          >
            {/* ═══════════ WELCOME STEP ═══════════ */}
            {step === 'welcome' && (
              <div className="text-center">
                <div className="inline-flex items-center justify-center h-24 w-24 rounded-xl bg-emerald-100 text-emerald-600 mb-2">
                  <Sparkles className="w-12 h-12" />
                </div>

                <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 mb-2">
                  Welcome to Growlanzo!
                </h1>
                <p className="text-slate-600 text-lg leading-relaxed mb-2 max-w-lg mx-auto">
                  Set up your profile so our AI can match you with the perfect projects — it only takes a few minutes.
                </p>

                {/* 🎯 Role selection — one onboarding for every signup path.
                    Email users see their signup role pre-selected (they can switch
                    before committing); GitHub/LinkedIn OAuth and invited users pick
                    their account type here. Choosing updates the profile role so the
                    rest of the flow (and the dashboard redirect) matches. */}
                <div className="mb-2 text-left">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                    I want to...
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => { setChosenRole('freelancer'); updateUser({ role: 'freelancer' }); }}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                        chosenRole === 'freelancer'
                          ? 'border-emerald-500 bg-emerald-50 shadow-md'
                          : 'border-slate-200 bg-white hover:border-emerald-300'
                      }`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${chosenRole === 'freelancer' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        <User className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-slate-900">Freelancer</p>
                        <p className="text-xs text-slate-500">Offer your skills and earn</p>
                      </div>
                      {chosenRole === 'freelancer' && <Check className="w-5 h-5 text-emerald-600" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setChosenRole('client'); updateUser({ role: 'client' }); }}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                        chosenRole === 'client'
                          ? 'border-emerald-500 bg-emerald-50 shadow-md'
                          : 'border-slate-200 bg-white hover:border-emerald-300'
                      }`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${chosenRole === 'client' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-slate-900">Client</p>
                        <p className="text-xs text-slate-500">Hire talent for your projects</p>
                      </div>
                      {chosenRole === 'client' && <Check className="w-5 h-5 text-emerald-600" />}
                    </button>
                  </div>
                  {!chosenRole && (
                    <p className="text-xs text-amber-600 mt-2">Choose how you'll use Growlanzo to continue.</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
                  {[
                    { icon: User, label: isFreelancer ? 'Your Profile' : 'Company Info', color: 'bg-blue-100 text-blue-600' },
                    { icon: Briefcase, label: isFreelancer ? 'Your Skills' : 'Your Industry', color: 'bg-purple-100 text-purple-600' },
                    { icon: CheckCircle, label: 'Ready to Start', color: 'bg-emerald-100 text-emerald-600' },
                  ].map((item, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${item.color} text-sm font-medium`}>
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleNext}
                  disabled={!chosenRole}
                  className="inline-flex items-center gap-3 px-8 py-3.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-emerald-600/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  Get Started
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* ═══════════ PROFILE STEP ═══════════ */}
            {step === 'profile' && (
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                    <User className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">
                      {isFreelancer ? 'Your Professional Profile' : 'Your Company Profile'}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {isFreelancer
                        ? 'Tell clients about yourself and your expertise'
                        : 'Tell freelancers about your company and what you do'}
                    </p>
                  </div>
                </div>

                {isFreelancer ? (
                  <div>
                    {/* Avatar / Profile Photo */}
                    <div className="flex items-center gap-3 mb-2">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-slate-100 border-2 border-slate-200">
                      {freelancerForm.avatar_url ? (
                        <img src={freelancerForm.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <User className="w-8 h-8 text-slate-400" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-600 text-white rounded-full flex items-center justify-center hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg"
                    >
                      {uploadingAvatar ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4" />
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          toast.error('File Too Large', 'File must be less than 5MB');
                          return;
                        }
                        setUploadingAvatar(true);
                        try {
                          const result = await avatarUploadService.uploadAvatar(file);
                          if (result.success && result.avatar_url) {
                            setFreelancerForm(prev => ({ ...prev, avatar_url: result.avatar_url }));
                          } else {
                            toast.error('Upload Failed', result.error || 'Failed to upload avatar');
                          }
                        } catch {
                          toast.error('Upload Failed', 'Failed to upload avatar');
                        } finally {
                          setUploadingAvatar(false);
                        }
                      }}
                      className="hidden"
                    />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">Profile Photo</p>
                    <p className="text-xs text-slate-500">Upload a professional photo to build trust with clients</p>
                  </div>
                </div>

                {/* Professional Title */}            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Your Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={freelancerForm.name}
                onChange={(e) => setFreelancerForm({ ...freelancerForm, name: e.target.value })}
                placeholder="Your full name — clients will see this on your profile"
                maxLength={60}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
              />
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5" /> Choose your name carefully — for security, you can only change it once every 30 days.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Professional Title <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={freelancerForm.title}
                onChange={(e) => setFreelancerForm({ ...freelancerForm, title: e.target.value })}
                    placeholder="e.g., Full Stack Developer, UI/UX Designer"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  />
                  <p className="text-xs text-slate-400 mt-1">This will appear as your headline on your profile</p>
                </div>

                    {/* Bio */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Bio <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        rows={4}
                        value={freelancerForm.bio}
                        onChange={(e) => setFreelancerForm({ ...freelancerForm, bio: e.target.value })}
                        placeholder="Describe your expertise, experience, and what makes you unique..."
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all resize-none"
                      />
                    </div>

                    {/* Experience only — pricing lives at the service-create step,
                        never during onboarding (final model). */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Years of Experience</label>                          <input
                            type="number"
                            min={0}
                            max={80}
                            step="0.5"
                            value={experienceInput}
                            onChange={(e) => {
                              // String state preserves the '.' while typing "2.5"; empty field = 0
                              const raw = e.target.value;
                              setExperienceInput(raw);
                              const parsed = raw === '' ? 0 : parseFloat(raw);
                              setFreelancerForm({ ...freelancerForm, experience: Number.isFinite(parsed) ? Math.min(80, Math.max(0, parsed)) : 0 });
                            }}
                            placeholder="e.g. 5 or 2.5"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                          />
                      </div>
                    </div>

                    {/* Country / Location */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Country / Location</label>
                      <CountrySelect
                        value={freelancerForm.location}
                        onChange={(country) => setFreelancerForm({ ...freelancerForm, location: country })}
                        placeholder="Select your country..."
                      />
                      <p className="text-xs text-slate-400 mt-1">
                        India is live today. Pick any other country to join its waitlist — we will email
                        you the moment Growlanzo launches there, and your profile keeps working normally.
                      </p>
                    </div>

                    {/* Portfolio URL */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Portfolio URL</label>
                      <input
                        type="url"
                        value={freelancerForm.portfolio_url}
                        onChange={(e) => setFreelancerForm({ ...freelancerForm, portfolio_url: e.target.value })}
                        placeholder="https://yourportfolio.com"
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                      />
                    </div>

                    {/* Languages */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Languages</label>
                      <div className="relative">
                        <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                          type="text"
                          value={languageInput}
                          maxLength={MAX_LANGUAGE_LENGTH}
                          onChange={(e) => {
                            setLanguageInput(e.target.value);
                            if (e.target.value.trim().length > 0) {
                              const filtered = COMMON_LANGUAGES.filter(l =>
                                l.toLowerCase().includes(e.target.value.toLowerCase()) &&
                                !freelancerForm.languages.includes(l)
                              );
                              setLanguageSuggestions(filtered.slice(0, 5));
                            } else {
                              setLanguageSuggestions([]);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && languageInput.trim()) {
                              e.preventDefault();
                              const lang = languageInput.trim();
                              if (!freelancerForm.languages.includes(lang)) {
                                setFreelancerForm(prev => ({ ...prev, languages: [...prev.languages, lang] }));
                              }
                              setLanguageInput('');
                              setLanguageSuggestions([]);
                            }
                          }}
                          onBlur={() => setTimeout(() => setLanguageSuggestions([]), 150)}
                          placeholder="Add languages you speak (e.g., English, Hindi)"
                          className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                        />
                        {languageSuggestions.length > 0 && (
                          <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                            {languageSuggestions.map(lang => (
                              <button
                                key={lang}
                                type="button"
                                onClick={() => {
                                  if (!freelancerForm.languages.includes(lang)) {
                                    setFreelancerForm(prev => ({ ...prev, languages: [...prev.languages, lang] }));
                                  }
                                  setLanguageInput('');
                                  setLanguageSuggestions([]);
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-50 transition-colors"
                              >{lang}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      {freelancerForm.languages.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {freelancerForm.languages.map(lang => (
                            <span
                              key={lang}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium"
                            >
                              {lang}
                              <button
                                type="button"
                                onClick={() => setFreelancerForm(prev => ({ ...prev, languages: prev.languages.filter(l => l !== lang) }))}
                                className="hover:text-red-500 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Availability */}
                    <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={freelancerForm.availability}
                        onChange={(e) => setFreelancerForm({ ...freelancerForm, availability: e.target.checked })}
                        className="w-5 h-5 text-emerald-600 rounded border-slate-300 cursor-pointer"
                      />
                      <div>
                        <span className="font-medium text-slate-900">I'm available to take new projects</span>
                        <p className="text-xs text-slate-500">Uncheck if you're currently busy</p>
                      </div>
                    </label>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Company Logo */}
                    <div className="flex items-center gap-3 mb-2">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
                          {clientForm.company_logo ? (
                            <img src={clientForm.company_logo} alt="Company logo" className="w-full h-full object-cover" />
                          ) : (
                            <Building2 className="w-8 h-8 text-slate-400" />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => clientLogoInputRef.current?.click()}
                          disabled={uploadingClientLogo}
                          className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-600 text-white rounded-full flex items-center justify-center hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg"
                        >
                          {uploadingClientLogo ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Camera className="w-4 h-4" />
                          )}
                        </button>
                        <input
                          ref={clientLogoInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/svg+xml"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !user?.id) return;
                            if (file.size > 2 * 1024 * 1024) {
                              toast.error('File Too Large', 'Company logo must be less than 2MB');
                              return;
                            }
                            setUploadingClientLogo(true);
                            try {
                              const result = await avatarPackService.uploadCompanyLogo(file, user.id);
                              if (result.success && result.logo_url) {
                                setClientForm(prev => ({ ...prev, company_logo: result.logo_url }));
                                toast.success('Logo Uploaded', 'Company logo added!');
                              } else {
                                toast.error('Upload Failed', result.error || 'Failed to upload logo');
                              }
                            } catch {
                              toast.error('Upload Failed', 'Failed to upload company logo');
                            } finally {
                              setUploadingClientLogo(false);
                            }
                          }}
                          className="hidden"
                        />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">Company Logo</p>
                        <p className="text-xs text-slate-500">Add your company logo to build trust (optional)</p>
                      </div>
                    </div>

                    {/* Your Name */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Your Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={clientForm.name}
                        onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                        placeholder="Your full name — freelancers will see this when you hire them"
                        maxLength={60}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                      />
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <Shield className="w-3.5 h-3.5" /> Choose your name carefully — for security, you can only change it once every 30 days.
                      </p>
                    </div>

                    {/* Account Type */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Account Type</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setClientForm({ ...clientForm, account_type: 'individual' })}
                          className={`flex items-center justify-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                            clientForm.account_type === 'individual'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <User className="w-4 h-4" /> Individual
                        </button>
                        <button
                          type="button"
                          onClick={() => setClientForm({ ...clientForm, account_type: 'business' })}
                          className={`flex items-center justify-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                            clientForm.account_type === 'business'
                              ? 'border-violet-500 bg-violet-50 text-violet-700 ring-2 ring-violet-200'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <Building2 className="w-4 h-4" /> Business
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5">
                        {clientForm.account_type === 'business'
                          ? 'Companies hire with their business name — GST appears on invoices.'
                          : 'Individuals hire with their personal name.'}
                      </p>
                    </div>

                    {/* Company Name */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Company Name {clientForm.account_type === 'business' && <span className="text-red-400">*</span>}
                      </label>
                      <input
                        type="text"
                        value={clientForm.company_name}
                        onChange={(e) => setClientForm({ ...clientForm, company_name: e.target.value })}
                        placeholder="Your company or brand name"
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                      />
                    </div>

                    {/* GST Number (business only) */}
                    {clientForm.account_type === 'business' && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">GST Number</label>
                        <input
                          type="text"
                          value={clientForm.gst_number}
                          onChange={(e) => {
                            const raw = e.target.value.toUpperCase();
                            setClientForm({ ...clientForm, gst_number: raw });
                            const check = validateOptionalGstin(raw);
                            setGstError(check.valid ? null : check.error || null);
                          }}
                          placeholder="e.g. 27AABCS1234F1Z5"
                          maxLength={15}
                          className={`w-full px-4 py-3 rounded-xl border outline-none transition-all font-mono tracking-wider ${
                            gstError
                              ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                              : 'border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200'
                          }`}
                        />
                        {gstError ? (
                          <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> {gstError}
                          </p>
                        ) : clientForm.gst_number ? (
                          <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" /> Valid GSTIN format
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400 mt-1">Optional — business invoices show your GST number.</p>
                        )}
                      </div>
                    )}

                    {/* Industry */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Industry</label>
                      <IndustrySelect
                        value={clientForm.industry}
                        onChange={(ind) => setClientForm({ ...clientForm, industry: ind })}
                        placeholder="Select your industry..."
                      />
                    </div>

                    {/* Company Size & Location */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Team Size</label>
                        <select
                          value={clientForm.size}
                          onChange={(e) => setClientForm({ ...clientForm, size: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                        >
                          <option value="">Select size...</option>
                          {/* Values MUST match the client_profiles_size_check DB constraint
                              (same as ClientSettingsPage) or the client_profiles upsert
                              fails with a 400 and onboarding silently stalls. */}
                          <option value="1-10">Just me (1-10)</option>
                          <option value="11-50">11-50 employees</option>
                          <option value="51-200">51-200 employees</option>
                          <option value="201-500">201-500 employees</option>
                          <option value="500+">500+ employees</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Country / Location</label>
                        <CountrySelect
                          value={clientForm.location}
                          onChange={(country) => setClientForm({ ...clientForm, location: country })}
                          placeholder="Select your country..."
                        />
                        <p className="text-xs text-slate-400 mt-1">
                          India is live today. Pick any other country to join its waitlist — we will email
                          you the moment Growlanzo launches there, and your profile keeps working normally.
                        </p>
                      </div>
                    </div>

                    {/* Bio / About */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Bio / About</label>
                      <textarea
                        rows={4}
                        value={clientForm.description}
                        onChange={(e) => setClientForm({ ...clientForm, description: e.target.value })}
                        placeholder="Introduce yourself and your company — freelancers want to know who they'll be working with..."
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all resize-none"
                      />
                    </div>

                    {/* Website */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Website</label>
                      <input
                        type="url"
                        value={clientForm.website}
                        onChange={(e) => setClientForm({ ...clientForm, website: e.target.value })}
                        placeholder="https://yourcompany.com"
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                      />
                    </div>
                  </div>
                )}

                {/* Referral Code (optional) */}
                <div className="mt-6">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Referral Code <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={referralCode}
                      onChange={e => setReferralCode(e.target.value)}
                      placeholder="Have a Growlanzo referral code? Enter it here"
                      className="w-full px-4 py-3 pr-10 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      {referralStatus === 'checking' && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
                      {referralStatus === 'valid' && <Check className="w-4 h-4 text-emerald-600" />}
                      {(referralStatus === 'invalid' || referralStatus === 'wrong-role') && <X className="w-4 h-4 text-red-500" />}
                    </span>
                  </div>
                  {referralStatus === 'valid' && (
                    <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Valid code{referrerName ? ` — you were referred by ${referrerName}` : ''}!
                    </p>
                  )}
                  {referralStatus === 'invalid' && (
                    <p className="mt-1.5 text-xs text-red-500">This referral code doesn't exist.</p>
                  )}
                  {referralStatus === 'wrong-role' && (
                    <p className="mt-1.5 text-xs text-red-500">
                      Referral codes are same-side only — a {(chosenRole ?? user?.role) === 'client' ? 'client' : 'freelancer'} code can't be used by a {(chosenRole ?? user?.role) === 'client' ? 'freelancer' : 'client'} account.
                    </p>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between gap-3 mt-8 pt-6 border-t border-slate-100">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-3 px-6 py-3 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={!canProceed}
                    className="flex items-center gap-3 px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-600/25"
                  >
                    Next: {isFreelancer ? 'Skills' : 'Review'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ═══════════ SKILLS STEP (Freelancer Only) ═══════════ */}
            {step === 'skills' && (
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">Your Skills & Expertise</h2>
                    <p className="text-sm text-slate-500">
                      Select skills so our AI can match you with relevant projects
                    </p>
                  </div>
                </div>

                {isFreelancer && (
                  <div>
                    <div className="p-4 bg-purple-50 border border-purple-100 rounded-xl mb-3">
                      <p className="text-sm text-purple-700">
                        <strong>Tip:</strong> Pick up to 3 categories that describe your work, then add your own skills.
                        Growlanzo matches you to projects based on your categories — you can update these anytime from your profile settings.
                      </p>
                    </div>
                    <CategoryPicker
                      mode="freelancer"
                      maxCategories={3}
                      selectedCategoryIds={selectedCategoryIds}
                      selectedSkills={skillNames}
                      onCategoriesChange={setSelectedCategoryIds}
                      onSkillsChange={setSkillNames}
                    />

                    {/* Selected skills summary */}
                    {skillNames.length > 0 && (
                      <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <div className="flex items-center gap-3 mb-3">
                          <CheckCircle className="w-5 h-5 text-emerald-600" />
                          <span className="font-medium text-emerald-800">{skillNames.length} skills selected</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {skillNames.map(name => (
                            <span key={name} className="px-3 py-1.5 bg-white text-emerald-700 rounded-lg text-sm font-medium border border-emerald-200">
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Navigation — skills step is freelancer-only (clients skip it) */}
                <div className="flex items-center justify-between gap-3 mt-8 pt-6 border-t border-slate-100">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-3 px-6 py-3 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={handleNext}
                    className="flex items-center gap-3 px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25"
                  >
                    Next: Review
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ═══════════ REVIEW STEP ═══════════ */}
            {step === 'review' && (
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Check className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">Review Your Profile</h2>
                    <p className="text-sm text-slate-500">Everything look good? Click Complete Setup to finish!</p>
                  </div>
                </div>

                {/* Profile Summary Card */}
                <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl p-3 border border-emerald-100 mb-3">
                  {isFreelancer ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center overflow-hidden">
                          {freelancerForm.avatar_url ? (
                            <img src={freelancerForm.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-8 h-8 text-emerald-600" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-slate-900">{freelancerForm.title || 'Your Title'}</h3>
                          <p className="text-sm text-slate-500">
                            {freelancerForm.experience > 0 ? `${freelancerForm.experience} years experience` : 'Experience not set'} · {freelancerForm.location || 'Location not set'}
                          </p>
                        </div>
                      </div>
                      {freelancerForm.bio && (
                        <div className="p-3 bg-white rounded-xl border border-emerald-100">
                          <p className="text-sm text-slate-600 line-clamp-3">{freelancerForm.bio}</p>
                        </div>
                      )}
                      {skillNames.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 mb-2">Skills ({skillNames.length})</p>
                          <div className="flex flex-wrap gap-1.5">
                            {skillNames.slice(0, 8).map(name => (
                              <span key={name} className="px-2.5 py-1 bg-white text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium">
                                {name}
                              </span>
                            ))}
                            {skillNames.length > 8 && (
                              <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-medium">
                                +{skillNames.length - 8} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {freelancerForm.location && (
                        <div className="flex items-center gap-1.5 text-sm text-slate-500">
                          <MapPin className="w-4 h-4" />
                          {freelancerForm.location}
                        </div>
                      )}
                      {freelancerForm.languages.length > 0 && (
                        <div className="flex items-center gap-1.5 text-sm text-slate-500">
                          <Globe className="w-4 h-4" />
                          {freelancerForm.languages.join(', ')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-xl bg-emerald-100 flex items-center justify-center overflow-hidden">
                          {clientForm.company_logo ? (
                            <img src={clientForm.company_logo} alt="Company logo" className="w-full h-full object-cover" />
                          ) : (
                            <Building2 className="w-8 h-8 text-emerald-600" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-slate-900">{clientForm.company_name || 'Your Company'}</h3>
                          <p className="text-sm text-slate-500">
                            {clientForm.industry || 'Industry not set'} 
                            {clientForm.size ? ` · ${clientForm.size} people` : ''}
                          </p>
                        </div>
                      </div>
                      {clientForm.description && (
                        <div className="p-3 bg-white rounded-xl border border-emerald-100">
                          <p className="text-sm text-slate-600 line-clamp-3">{clientForm.description}</p>
                        </div>
                      )}
                      {clientForm.location && (
                        <div className="flex items-center gap-1.5 text-sm text-slate-500">
                          <MapPin className="w-4 h-4" />
                          {clientForm.location}
                        </div>
                      )}
                      {clientForm.website && (
                        <div className="flex items-center gap-1.5 text-sm text-slate-500">
                          <Globe className="w-4 h-4" />
                          {clientForm.website}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Completion Percentage */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">Profile Completion</span>
                    <span className="text-sm font-bold text-emerald-600">
                      {Math.round(
                        isFreelancer
                          ? ((freelancerForm.title ? 25 : 0) +
                             (freelancerForm.bio ? 20 : 0) +
                             (skillNames.length > 0 ? 25 : 0) +
                             (freelancerForm.location ? 15 : 0) +
                             (freelancerForm.portfolio_url ? 15 : 0))
                          : ((clientForm.company_name ? 25 : 0) +
                             (clientForm.industry ? 20 : 0) +
                             (clientForm.size ? 15 : 0) +
                             (clientForm.location ? 15 : 0) +
                             (clientForm.description ? 25 : 0))
                      )}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-700"
                      style={{
                        width: `${
                          isFreelancer
                            ? ((freelancerForm.title ? 25 : 0) +
                               (freelancerForm.bio ? 20 : 0) +
                               (skillNames.length > 0 ? 25 : 0) +
                               (freelancerForm.location ? 15 : 0) +
                               (freelancerForm.portfolio_url ? 15 : 0))
                            : ((clientForm.company_name ? 25 : 0) +
                               (clientForm.industry ? 20 : 0) +
                               (clientForm.size ? 15 : 0) +
                               (clientForm.location ? 15 : 0) +
                               (clientForm.description ? 25 : 0))
                        }%`
                      }}
                    />
                  </div>
                </div>

                {/* Action */}
                <div className="flex items-center justify-between gap-3 pt-6 border-t border-slate-100">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-3 px-6 py-3 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={saving}
                    className="flex items-center gap-3 px-8 py-3.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-600/25"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-5 h-5" />
                        Complete Setup
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-[100rem] mx-auto px-4 text-center">
          <p className="text-xs text-slate-400">
            You can always update your profile later from the Settings page
          </p>
        </div>
      </footer>

      {/* Skip Confirmation Modal */}
      {showSkipModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setShowSkipModal(false)}
          />
          <div className="relative bg-white rounded-xl p-4 max-w-md w-full shadow-2xl animate-scale-in">
            <button
              onClick={() => setShowSkipModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>

            <div className="flex items-center justify-center w-16 h-16 bg-orange-100 rounded-xl mb-3 mx-auto">
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>

            <h2 className="font-display text-2xl font-bold text-slate-900 text-center mb-3">
              Skip Profile Setup?
            </h2>

            <p className="text-slate-600 text-center mb-2 leading-relaxed">
              You can skip setting up your profile for now. You can always complete it later from the Settings page, 
              but you'll need a complete profile to get AI-matched projects.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowSkipModal(false)}
                className="flex-1 px-6 py-3 text-slate-700 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Continue Setup
              </button>
              <button
                onClick={confirmSkip}
                className="flex-1 px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-colors"
              >
                Skip Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
