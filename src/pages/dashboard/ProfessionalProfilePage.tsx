import { useState, useEffect, useCallback, useRef } from 'react';
import { InfoTip } from '../../components/InfoTip';
import { PageSkeleton } from '../../components/PageSkeleton';
import { useAuth } from '../../context/AuthContext';
import { supabase, clearSupabaseAuthStorage, uniqueChannelName } from '../../lib/supabase';
import { CacheManager } from '../../lib/services/cacheManager';
import { avatarUploadService } from '../../lib/avatarUpload';
import { notificationPreferencesService } from '../../lib/notificationPreferences';
import { withdrawalService } from '../../lib/withdrawal';
import { useToast } from '../../components/Toast';
import { ConfirmModal } from '../../components/ConfirmModal';
import { formatCurrency, currencySymbol } from '../../lib/currency';
import { ReauthDialog } from '../../components/ReauthDialog';
import { isReauthValid, verifyReauthBeforeAction, markReauthVerified } from '../../lib/reauth';
import { EmailVerificationCard } from '../../components/EmailVerificationCard';
import {AlertCircle, AlertTriangle, Bell, Briefcase, Camera, Check, CheckCircle2, Globe, Clock, Copy, CreditCard, IndianRupee, Edit2, Eye, EyeOff, Languages, Loader2, Lock, Info, Mail, MapPin, Monitor, QrCode, RefreshCw, Save, Settings, Shield, Star, Trash2, User, X, XCircle, } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import { CategoryPicker } from '../../components/CategoryPicker';
import { ProBadge } from '../../components/ProBadge';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { useProStatus } from '../../hooks/useProStatus';
import type { Tables } from '../../types/supabase';
import type { PayoutMethod } from '../../lib/withdrawal';
import { getNameChangeLock } from '../../lib/nameChangeLock';
import { freelancerProfileCompletion } from '../../lib/profileCompletion';



type FreelancerProfile = Tables<'freelancer_profiles'>;
type Profile = Tables<'profiles'>;

type TabId = 'profile' | 'account' | 'security' | 'notifications' | 'privacy' | 'payout' | 'deletion';

/** Get a user-friendly error message from various error types */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('network') || msg.includes('fetch')) return 'Network error. Please check your connection.';
    if (msg.includes('timeout')) return 'Request timed out. Please try again.';
    if (msg.includes('permission') || msg.includes('policy')) return 'Permission denied. You may not have access to perform this action.';
    if (msg.includes('duplicate') || msg.includes('unique')) return 'This value already exists. Please use a different one.';
    if (msg.includes('not found')) return 'Resource not found. It may have been deleted.';
    return err.message;
  }
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred. Please try again.';
}

export function ProfessionalProfilePage() {
  const { user, updateUser } = useAuth();
  const { isPro } = useProStatus();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Profile state (from ProfilePage + FreelancerSettingsPage) ──
  const [profile, setProfile] = useState<Profile | null>(null);
  const [freelancerProfile, setFreelancerProfile] = useState<FreelancerProfile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Profile form state ──
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    bio: '',
    hourly_rate: 0,
    experience: 0,
    skills: [] as string[],
    languages: [] as string[],
    location: '',
    portfolio_url: '',
    education: '',
    certifications: [] as string[],
    availability: true,
  });

  // ── Raw numeric-field text (decimal-friendly editing) ──
  // Binding the input to the parsed number re-renders on every keystroke and
  // eats the intermediate '.' while typing "2.5" (state becomes 2 → "25").
  // Keeping the raw string lets the user type decimals naturally; the parsed
  // number still lives in formData for validation/save/display.
  const [hourlyRateInput, setHourlyRateInput] = useState('');
  const [experienceInput, setExperienceInput] = useState('');

  // ── Account form state ──
  const [accountData, setAccountData] = useState({
    name: '',
    email: '',
    username: '',
    timezone: 'UTC',
    language: 'en',
    phone: '',
  });
  // When the display name was last changed (profiles.name_changed_at) — used to
  // enforce the 30-day name-change lock for security.
  const [nameChangedAt, setNameChangedAt] = useState<string | null>(null);
  const nameLock = getNameChangeLock(nameChangedAt);

  // ── Security form state ──
  const [securityData, setSecurityData] = useState({
    newPassword: '',
    confirmPassword: '',
    showNewPassword: false,
  });

  // ── Reauth state (password change / disable 2FA gate) ──
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingPasswordChange, setPendingPasswordChange] = useState(false);
  const [pendingDisable2FA, setPendingDisable2FA] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(false);

  // ── 2FA state ──
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [twoFactorSecret, setTwoFactorSecret] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [confirmDisable2FA, setConfirmDisable2FA] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeSessions] = useState(1);
  // Real device session info (OS • Browser • Timezone) — computed once, client-side.
  const [sessionInfo] = useState(() => {
    if (typeof navigator === 'undefined') return 'Web Browser • UTC';
    const ua = navigator.userAgent;
    let os = 'Web';
    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    let browser = 'Browser';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    else if (/OPR\//.test(ua)) browser = 'Opera';
    const tz =
      typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : 'UTC';
    return `${os} • ${browser} • ${tz}`;
  });

  // ── Notification preferences state ──
  const [notifications, setNotifications] = useState({
    proposals: { email: true, inApp: true, push: true },
    contracts: { email: true, inApp: true, push: true },
    messages: { email: true, inApp: true, push: true },
    payments: { email: true, inApp: true, push: true },
    milestones: { email: true, inApp: true, push: true },
    marketing: { email: false, inApp: true, push: false },
    invitations: { email: true, inApp: true, push: true },
  });

  // ── Privacy settings state ──
  const [privacy, setPrivacy] = useState({
    profileVisibility: 'public' as 'public' | 'private' | 'clients_only',
    showOnlineStatus: true,
    showEarnings: false,
    allowDirectMessages: true,
    showActiveProjects: true,
  });

  // ── Payout methods ──
  const [payoutMethods, setPayoutMethods] = useState<PayoutMethod[]>([]);
  const [payoutMethodsLoading, setPayoutMethodsLoading] = useState(false);
  const [payoutMethodsError, setPayoutMethodsError] = useState<string | null>(null);
  const [showAddPayout, setShowAddPayout] = useState(false);
  const [addingPayout, setAddingPayout] = useState(false);
  const [deletingPayoutId, setDeletingPayoutId] = useState<string | null>(null);
  const [confirmDeletePayout, setConfirmDeletePayout] = useState<string | null>(null);
  const [newPayout, setNewPayout] = useState({
    type: 'upi' as 'upi' | 'bank' | 'paypal',
    email: '',
    accountHolderName: '',
    accountNumber: '',
    routingNumber: '',
    bankName: '',
    ifscCode: '',
    upiId: '',
  });

  // ── Account deletion state ──
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionConfirm, setDeletionConfirm] = useState('');
  const [deletionStep, setDeletionStep] = useState<'initial' | 'confirm' | 'processing'>('initial');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // ── Category state (145 categories only, free-text skills) ──
  const { categories } = useCategories();
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedCategoryNames, setSelectedCategoryNames] = useState<string[]>([]);
  const categoriesPreloaded = useRef(false);
  // ── Input states ──
  const [skillInput, setSkillInput] = useState('');
  const [languageInput, setLanguageInput] = useState('');
  const [certInput, setCertInput] = useState('');

  const timezones = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Paris',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
    'Australia/Sydney', 'Pacific/Auckland',
  ];

  const languageOptions = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'ja', label: 'Japanese' },
    { code: 'zh', label: 'Chinese' },
    { code: 'hi', label: 'Hindi' },
    { code: 'ar', label: 'Arabic' },
  ];

  // ── Data Fetching ──
  // Explicit column list instead of `*`: authenticated holds a reviewed
  // column allowlist on `profiles`, so a wildcard silently breaks the whole
  // read the day an un-granted column is added — and an empty profile page is
  // exactly what that looks like to the user.
  const PROFILE_SELECT =
    'id, name, role, avatar, is_pro, created_at, updated_at, rating, total_reviews, deleted_at, country, verification_status, kyc_verified_at, name_changed_at';
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  const fetchProfileData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [profileResp, freelancerResp, privateResp] = await Promise.all([
        supabase.from('profiles').select(PROFILE_SELECT).eq('id', user.id).single(),
        supabase.from('freelancer_profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles_private').select('email, phone, onboarding_completed').eq('id', user.id).maybeSingle(),
      ]);

      if (profileResp.error) {
        console.error('Profile read failed:', profileResp.error.message);
        setProfileLoadError('We could not load your profile just now. Your saved data is safe — retry below.');
      } else {
        setProfileLoadError(null);
      }

      if (!profileResp.error && profileResp.data) {
        const p = profileResp.data as unknown as Profile;
        const priv = privateResp?.data;
        setProfile(p);
        setAccountData(prev => ({ ...prev, name: p?.name || '', email: priv?.email || '', phone: priv?.phone || '' }));
        setNameChangedAt((p as any)?.name_changed_at || null);
      }

      if (!freelancerResp.error && freelancerResp.data) {
        const f = freelancerResp.data as any;
        setFreelancerProfile(f as FreelancerProfile);
        const existingSkills: string[] = f.skills || [];
      setFormData({
          name: profileResp.data?.name || '',
          title: f.title || '',
          bio: f.bio || '',
          hourly_rate: f.hourly_rate || 0,
          experience: f.experience || 0,
          skills: existingSkills,
          languages: f.languages || [],
          location: f.location || '',
          portfolio_url: f.portfolio_url || '',
          education: f.education || '',
          certifications: f.certifications || [],
          availability: f.availability !== false,
        });
        setHourlyRateInput(f.hourly_rate ? String(f.hourly_rate) : '');
        setExperienceInput(f.experience ? String(f.experience) : '');
        if (f.privacy_settings) {
          setPrivacy(prev => ({ ...prev, ...f.privacy_settings }));
        }
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setLoading(false);
    }
  }, [user?.id]);

  // Pre-select saved categories ONCE both the profile and category list are loaded.
  // Guarded by a ref so realtime category refetches never clobber an in-progress edit.
  useEffect(() => {
    if (!freelancerProfile || categories.length === 0 || categoriesPreloaded.current) return;
    const savedCats: string[] = (freelancerProfile as any).categories || [];
    if (savedCats.length > 0) {
      const matched = categories
        .filter(c => savedCats.includes(c.name))
        .map(c => c.id);
      setSelectedCategoryIds(matched);
    }
    categoriesPreloaded.current = true;
  }, [freelancerProfile, categories]);

  useEffect(() => { fetchProfileData(); }, [fetchProfileData]);

  // Real-time subscription for profile changes — syncs across all open sessions/tabs
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(uniqueChannelName('professional-profile-changes', user.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` }, (payload: { new: Record<string, unknown> }) => {
        if (payload.new) {
          const newProfile = payload.new as Profile;
          setProfile(newProfile);
          // Update AuthContext when profile name changes from another session
          if (newProfile.name && newProfile.name !== user.name) {
            updateUser({ name: newProfile.name, avatar: newProfile.avatar || undefined });
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'freelancer_profiles', filter: `user_id=eq.${user.id}` }, (payload: { new: Record<string, unknown> }) => {
        if (payload.new) {
          const u = payload.new as FreelancerProfile;
          setFreelancerProfile(u);
          // Always sync core profile data even during editing
          setFormData(prev => ({
            ...prev,
            bio: u.bio ?? prev.bio,
            hourly_rate: u.hourly_rate ?? prev.hourly_rate,
            experience: u.experience ?? prev.experience,
            skills: (u.skills as string[]) ?? prev.skills,
            languages: (u.languages as string[]) ?? prev.languages,
            location: u.location ?? prev.location,
            portfolio_url: u.portfolio_url ?? prev.portfolio_url,
            availability: u.availability ?? prev.availability,
          }));
          if (u.hourly_rate != null) setHourlyRateInput(String(u.hourly_rate));
          if (u.experience != null) setExperienceInput(String(u.experience));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, updateUser]);

  // Fetch payout methods when tab is active
  const fetchPayoutMethods = useCallback(async () => {
    if (!user?.id) return;
    setPayoutMethodsLoading(true);
    setPayoutMethodsError(null);
    try {
      const result = await withdrawalService.getPayoutMethods();
      if (result.success && result.methods) setPayoutMethods(result.methods);
      else setPayoutMethodsError(result.error || 'Failed to load payout methods');
    } catch { setPayoutMethodsError('Failed to load payout methods'); }
    finally { setPayoutMethodsLoading(false); }
  }, [user?.id]);

  useEffect(() => {
    if (activeTab === 'payout') void fetchPayoutMethods();
  }, [activeTab, fetchPayoutMethods]);

  // ── Profile Completion ──
  // Shared scorer (lib/profileCompletion.ts): nine editable fields, no
  // identity-verification component, so 100% is reachable without any KYC.
  const profileCompletion = freelancerProfileCompletion({
    name: formData.name,
    title: formData.title,
    bio: formData.bio,
    hourly_rate: formData.hourly_rate,
    skills: formData.skills,
    languages: formData.languages,
    location: formData.location,
    portfolio_url: formData.portfolio_url,
    education: formData.education,
  }).percent;

  // ── Helpers ──
  const autoClearMessages = () => {
    setTimeout(() => { setSuccessMessage(null); setErrorMessage(null); }, 5000);
  };

  // ── Profile Save (with optimistic updates, rollback, and cross-session sync) ──
  const handleProfileSave = async () => {
    if (!user) return;

    // ── Validation ──
    if (formData.hourly_rate < 0) {
      setErrorMessage('Base rate must be a positive number.');
      return;
    }
    if (formData.experience < 0 || formData.experience > 80) {
      setErrorMessage('Experience must be between 0 and 80 years.');
      return;
    }
    if (formData.portfolio_url && !/^https?:\/\/.+/.test(formData.portfolio_url)) {
      setErrorMessage('Portfolio URL must start with http:// or https://');
      return;
    }

    setSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    // ── Snapshot for optimistic rollback ──
    const prevFormData = { ...formData };
    const prevFreelancerProfile = freelancerProfile ? { ...freelancerProfile } : null;
    const prevProfile = profile ? { ...profile } : null;

    // ── Optimistic: update local state immediately ──
    if (profile) {
      setProfile(prev => prev ? { ...prev, name: formData.name } : null);
    }
    if (freelancerProfile) {
      setFreelancerProfile(prev => prev ? { ...prev, ...formData } : prev);
    }

    try {
      // 1. Update profiles table (name)
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ name: formData.name, updated_at: new Date().toISOString() } as any)
        .eq('id', user.id);
      if (profileError) throw profileError;

      // 2. Update freelancer_profiles table
      if (freelancerProfile) {
        const { error: fpError } = await supabase
          .from('freelancer_profiles')
          .update({
            title: formData.title,
            bio: formData.bio,
            hourly_rate: formData.hourly_rate,
            experience: formData.experience,
            skills: formData.skills,
            categories: selectedCategoryNames.length > 0 ? selectedCategoryNames : null,
            languages: formData.languages,
            location: formData.location,
            portfolio_url: formData.portfolio_url,
            education: formData.education,
            certifications: formData.certifications,
            availability: formData.availability,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', freelancerProfile.id);
        if (fpError) throw fpError;
      } else {
        const { error: insertError } = await supabase
          .from('freelancer_profiles')
          .insert({
            user_id: user.id,
            title: formData.title,
            bio: formData.bio,
            hourly_rate: formData.hourly_rate,
            experience: formData.experience,
            skills: formData.skills,
            categories: selectedCategoryNames.length > 0 ? selectedCategoryNames : null,
            languages: formData.languages,
            location: formData.location,
            portfolio_url: formData.portfolio_url,
            education: formData.education,
            certifications: formData.certifications,
            availability: formData.availability,
          } as any);
        if (insertError) throw insertError;
      }

      // ── Sync name change to AuthContext (updates navbar & other pages immediately) ──
      updateUser({ name: formData.name });

      // ── Invalidate dashboard caches so OverviewPage etc. show updated data ──
      CacheManager.invalidate(`user_contracts:${user.id}`);
      CacheManager.invalidate(`open_projects:`);
      CacheManager.invalidate(`freelancer_proposals:${user.id}`);
      CacheManager.invalidate(`freelancer_invites:${user.id}`);

      setSuccessMessage('Profile saved successfully!');
      setIsEditing(false);
      autoClearMessages();
    } catch (error) {
      // ── Rollback optimistic updates ──
      setFormData(prevFormData);
      if (prevFreelancerProfile) {
        setFreelancerProfile(prevFreelancerProfile as FreelancerProfile);
      }
      if (prevProfile) {
        setProfile(prevProfile as Profile);
      }

      console.error('Error saving profile:', error);
      setErrorMessage(getErrorMessage(error));
      autoClearMessages();
    } finally {
      setSaving(false);
    }
  };

  // ── Account Save ──
  const handleAccountSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true); setSuccessMessage(null); setErrorMessage(null);

    // Optimistic snapshot
    const prevName = accountData.name;

    // 30-day name-change lock: reject edits while the lock is active.
    if (nameLock.locked && prevName !== accountData.name) {
      setSaving(false);
      setErrorMessage(`Your name is locked for security. You can change it on ${nameLock.unlockDate}.`);
      autoClearMessages();
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ name: accountData.name, updated_at: new Date().toISOString() } as any)
        .eq('id', user.id);
      if (error) throw error;

      // Sync with AuthContext so navbar updates immediately
      updateUser({ name: accountData.name });

      // Also update profile form state
      setFormData(prev => ({ ...prev, name: accountData.name }));

      setSuccessMessage('Account settings saved!');
      autoClearMessages();
    } catch (err) {
      setAccountData(prev => ({ ...prev, name: prevName }));
      setErrorMessage(getErrorMessage(err));
      autoClearMessages();
    } finally {
      setSaving(false);
    }
  };

  // ── Password Change (reauth-gated) ──
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null); setSuccessMessage(null);
    if (securityData.newPassword !== securityData.confirmPassword) { setErrorMessage('Passwords do not match'); return; }
    if (securityData.newPassword.length < 8) { setErrorMessage('Password must be at least 8 characters'); return; }

    // 🛡️ Reauthentication gate — verify identity (password or OTP) first,
    // valid for a 10-minute window.
    if (!isReauthValid()) {
      setPendingPasswordChange(true);
      setReauthOpen(true);
      return;
    }

    // 🛡️ Server-side reauth verification — prevents localStorage bypass
    if (!(await verifyReauthBeforeAction())) {
      setPendingPasswordChange(true);
      setReauthOpen(true);
      return;
    }

    await performPasswordChange();
  };

  const performPasswordChange = async () => {
    setSaving(true); setErrorMessage(null); setSuccessMessage(null);
    try {
      await supabase.auth.updateUser({ password: securityData.newPassword });

      // 🆕 Optional: sign out all other sessions except this one
      if (signOutOthers) {
        await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
      }

      setSuccessMessage(signOutOthers ? 'Password changed and all other sessions signed out!' : 'Password changed!');
      setSecurityData({ newPassword: '', confirmPassword: '', showNewPassword: false });
      setSignOutOthers(false);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch { setErrorMessage('Failed to change password.'); }
    finally { setSaving(false); }
  };

  const handleReauthVerified = async () => {
    markReauthVerified();
    setReauthOpen(false);
    if (pendingPasswordChange) {
      setPendingPasswordChange(false);
      await performPasswordChange();
    } else if (pendingDisable2FA) {
      setPendingDisable2FA(false);
      // Show the code input — 2FA disable needs the current TOTP code,
      // which must be entered by the user (never runs with an empty code).
      setConfirmDisable2FA(true);
    }
  };

  // ── Sync selected category IDs to names (for saving to freelancer_profiles.categories) ──
  useEffect(() => {
    const names = selectedCategoryIds
      .map(id => categories.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map(c => c.name);
    setSelectedCategoryNames(names);
  }, [selectedCategoryIds, categories]);

  // ── Skill/Language/Cert helpers ──
  const addSkill = () => { if (skillInput.trim() && !formData.skills.includes(skillInput.trim())) { setFormData({ ...formData, skills: [...formData.skills, skillInput.trim()] }); setSkillInput(''); } };
  const removeSkill = (s: string) => setFormData({ ...formData, skills: formData.skills.filter(x => x !== s) });
  const addLanguage = () => { if (languageInput.trim() && !formData.languages.includes(languageInput.trim())) { setFormData({ ...formData, languages: [...formData.languages, languageInput.trim()] }); setLanguageInput(''); } };
  const removeLanguage = (l: string) => setFormData({ ...formData, languages: formData.languages.filter(x => x !== l) });
  const addCert = () => { if (certInput.trim() && !formData.certifications.includes(certInput.trim())) { setFormData({ ...formData, certifications: [...formData.certifications, certInput.trim()] }); setCertInput(''); } };
  const removeCert = (c: string) => setFormData({ ...formData, certifications: formData.certifications.filter(x => x !== c) });

  // ── 2FA state ──
  const [factorId, setFactorId] = useState<string | null>(null);

  // ── 2FA ──
  const handleSetup2FA = async () => {
    setTwoFactorLoading(true); setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('twofa-management', {
        body: { action: 'enroll' },
      });
      if (error) throw error;
      const res = data as { factor_id?: string; qr_code?: string; secret?: string; recovery_codes?: string[]; error?: string };
      if (res.error) throw new Error(res.error);
      if (res.factor_id) setFactorId(res.factor_id);
      setQrCodeUrl(res.qr_code || '');
      setTwoFactorSecret(res.secret || '');
      setRecoveryCodes(res.recovery_codes || []);
      setShowQrCode(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to setup 2FA.');
    } finally { setTwoFactorLoading(false); }
  };
  const handleVerify2FA = async () => {
    if (!factorId) { setErrorMessage('No 2FA session. Please re-start setup.'); return; }
    setTwoFactorLoading(true); setErrorMessage(null);
    try {
      if (!twoFactorCode || twoFactorCode.length !== 6) {
        throw new Error('Please enter a valid 6-digit verification code.');
      }
      const { data, error } = await supabase.functions.invoke('twofa-management', {
        body: {
          action: 'verify',
          factor_id: factorId,
          code: twoFactorCode,
        },
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (res.error) throw new Error(res.error);
      if (!res.success) throw new Error('Invalid code.');

      setTwoFactorEnabled(true);
      setShowQrCode(false);
      setShowRecoveryCodes(true);
      setTwoFactorCode('');
      setSuccessMessage('2FA enabled!');
      setTimeout(() => { setSuccessMessage(null); setShowRecoveryCodes(false); }, 5000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Invalid code.');
    } finally { setTwoFactorLoading(false); }
  };
  const handleDisable2FA = async () => {
    // 🛡️ Reauthentication gate — disabling 2FA is a sensitive action
    if (!isReauthValid()) {
      setPendingDisable2FA(true);
      setReauthOpen(true);
      return;
    }

    // 🛡️ Server-side reauth verification
    if (!(await verifyReauthBeforeAction())) {
      setPendingDisable2FA(true);
      setReauthOpen(true);
      return;
    }

    // Ask for the current 6-digit code — verified server-side before disabling.
    setConfirmDisable2FA(true);
  };
  const performDisable2FA = async () => {
    if (!twoFactorCode || twoFactorCode.length !== 6) {
      setErrorMessage('Please enter your current 6-digit code to disable 2FA.');
      return;
    }
    setTwoFactorLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('twofa-management', {
        body: { action: 'disable', code: twoFactorCode },
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (res.error) throw new Error(res.error);
      setTwoFactorEnabled(false);
      setConfirmDisable2FA(false);
      setTwoFactorCode('');
      setSuccessMessage('2FA disabled.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to disable 2FA.');
    } finally {
      setTwoFactorLoading(false);
    }
  };
  const handleCopyRecoveryCodes = () => { navigator.clipboard.writeText(recoveryCodes.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Notifications Save ──
  const handleNotificationsSave = async () => {
    setSaving(true); setSuccessMessage(null); setErrorMessage(null);
    try {
      const { success, error } = await notificationPreferencesService.save(notifications);
      if (!success) throw new Error(error || 'Failed to save');
      setSuccessMessage('Notification preferences saved!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch { setErrorMessage('Failed to save preferences.'); }
    finally { setSaving(false); }
  };


  // ── Payout Methods ──
  const handleAddPayout = async () => {
    if (!user?.id) return;
    setAddingPayout(true); setPayoutMethodsError(null);
    try {
      if (newPayout.type === 'paypal') {
        setPayoutMethodsError('PayPal withdrawals are coming soon. Please add UPI or a Bank Account.');
        return;
      }
      const formData2: any = { type: newPayout.type };
      if (newPayout.type === 'upi') {
        formData2.upi_id = newPayout.upiId || null;
      } else {
        formData2.account_holder_name = newPayout.accountHolderName || null;
        formData2.account_number = newPayout.accountNumber || null;
        formData2.ifsc_code = newPayout.ifscCode || null;
        formData2.bank_name = newPayout.bankName || null;
      }
      if (payoutMethods.length === 0) formData2.is_default = true;
      const result = await withdrawalService.addPayoutMethod(formData2);
      if (!result.success) { setPayoutMethodsError(result.error || 'Failed to add'); return; }
      setShowAddPayout(false); setNewPayout({ type: 'upi', email: '', accountHolderName: '', accountNumber: '', routingNumber: '', bankName: '', ifscCode: '', upiId: '' });
      setSuccessMessage('Payout method added!'); setTimeout(() => setSuccessMessage(null), 3000);
      void fetchPayoutMethods();
    } catch { setPayoutMethodsError('Failed to add'); }
    finally { setAddingPayout(false); }
  };
  const handleRemovePayout = async (id: string) => {
    if (!user?.id) return;
    setDeletingPayoutId(id); setPayoutMethodsError(null);
    try {
      const result = await withdrawalService.deletePayoutMethod(id);
      if (!result.success) { setPayoutMethodsError(result.error || 'Failed'); return; }
      setSuccessMessage('Payout method removed'); setTimeout(() => setSuccessMessage(null), 3000);
      void fetchPayoutMethods();
    } catch { setPayoutMethodsError('Failed to delete'); }
    finally { setDeletingPayoutId(null); setConfirmDeletePayout(null); }
  };
  const handleSetDefaultPayout = async (id: string) => {
    if (!user?.id) return;
    try {
      const result = await withdrawalService.setDefaultPayoutMethod(id);
      if (!result.success) { setPayoutMethodsError(result.error || 'Failed'); return; }
      setSuccessMessage('Default updated'); setTimeout(() => setSuccessMessage(null), 3000);
      void fetchPayoutMethods();
    } catch { setPayoutMethodsError('Failed'); }
  };

  // ── Avatar ──
  const [confirmAvatarDelete, setConfirmAvatarDelete] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);
  const toast = useToast();

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setErrorMessage('Only JPEG, PNG, WebP, GIF allowed'); return; }
    if (file.size > 5 * 1024 * 1024) { setErrorMessage('File must be < 5MB'); return; }
    setUploadingAvatar(true); setErrorMessage(null);
    try {
      const result = await avatarUploadService.uploadAvatar(file);
      if (result.success) { if (profile) setProfile({ ...profile, avatar: result.avatar_url } as Profile); toast.success('Avatar updated!'); }
      else { setErrorMessage(result.error || 'Failed'); toast.error(result.error || 'Failed to upload'); }
    } catch { setErrorMessage('Failed to upload avatar.'); toast.error('Failed to upload avatar.'); }
    finally { setUploadingAvatar(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };
  const handleAvatarDelete = async () => {
    setDeletingAvatar(true);
    try {
      const result = await avatarUploadService.deleteAvatar();
      if (result.success) { if (profile) setProfile({ ...profile, avatar: null } as Profile); toast.success('Avatar removed!'); }
      else { setErrorMessage(result.error || 'Failed'); toast.error(result.error || 'Failed to remove avatar.'); }
    } catch { setErrorMessage('Failed to remove avatar.'); toast.error('Failed to remove avatar.'); }
    finally { setDeletingAvatar(false); setConfirmAvatarDelete(false); }
  };
  // ── Deletion ──
  const handleRequestDeletion = async () => {
    if (!acceptedTerms) return;
    setDeletionStep('processing');
    try {
      const authResult = await supabase.auth.getSession();
      const session = authResult.data?.session ?? null;
      if (!session) throw new Error('Not authenticated');

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to delete account');
      }

      // Sign out and clear local state immediately
      toast.success('Your account has been permanently deleted.');
      await supabase.auth.signOut().catch(() => {});
      clearSupabaseAuthStorage();
      window.location.href = '/';
    } catch (err: any) {
      console.error('[delete-account]', err);
      toast.error(err?.message || 'Failed to delete account. Please contact support.');
      setDeletionStep('confirm');
    }
  };

  // ── Render ──
  if (loading) {
    return <PageSkeleton />;
  }

  const tabs = [
    { id: 'profile' as TabId, label: 'Profile', icon: User, desc: 'Bio, skills, portfolio & experience' },
    { id: 'account' as TabId, label: 'Account', icon: Settings, desc: 'Name, email, timezone & language' },
    { id: 'security' as TabId, label: 'Security', icon: Shield, desc: 'Password, 2FA & sessions' },
    { id: 'notifications' as TabId, label: 'Notifications', icon: Bell, desc: 'Email, push & in-app alerts' },
    { id: 'privacy' as TabId, label: 'Privacy', icon: Globe, desc: 'Visibility, online status & permissions' },
    { id: 'payout' as TabId, label: 'Payout Methods', icon: IndianRupee, desc: 'UPI, bank accounts & PayPal' },
    { id: 'deletion' as TabId, label: 'Delete Account', icon: Trash2, desc: 'Permanent account removal' },
  ];

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-1.5 min-w-0">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
            <User className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">Professional Profile <InfoTip title="A complete profile wins more work" text="Clients see this profile before deciding to hire you. Fill every section — title, bio, skills, rate, portfolio — and the completion bar above turns green. A 100% profile gets higher AI match scores, shows your Verified and Pro badges, and ranks higher in client search. Changes save instantly and sync across all your sessions in real time." /></h1>
            <p className="text-slate-500 text-sm">Complete your profile to get better AI matches</p>
          </div>
        </div>
        {activeTab === 'profile' && (
          <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors inline-flex items-center gap-2 whitespace-nowrap">
                <Edit2 className="w-4 h-4" /> Edit Profile
              </button>
            ) : (
              <>
                <button onClick={() => setIsEditing(false)} className="px-4 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm">Cancel</button>
                <button onClick={handleProfileSave} disabled={saving} className="px-2.5 py-2.5 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-3 text-sm">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Email verification — real-time status, send/resend any time */}
      <EmailVerificationCard />

      {profileLoadError && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="flex-1">{profileLoadError}</span>
          <button
            type="button"
            onClick={() => { void fetchProfileData(); }}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* Messages */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-3">
          <XCircle className="w-4 h-4 flex-shrink-0" /> {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-1.5">
        {/* ── LEFT SIDEBAR: Profile Card + Tab Navigation ── */}
        <div className="lg:col-span-1 space-y-4">
          {/* Profile Card */}
          <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm text-center">
            <div className="relative w-24 h-24 mx-auto mb-2">
              {profile?.avatar ? (
                <div className="w-full h-full rounded-full overflow-hidden">
                  <img src={profile.avatar} alt={formData.name} className="w-full h-full object-cover object-top"
                    style={{ objectPosition: 'center 20%', filter: 'brightness(1.05) contrast(1.02)' }} />
                </div>
              ) : (
                <div className="w-full h-full rounded-full bg-slate-100 flex items-center justify-center">
                  <User className="w-7 h-7 text-slate-400" />
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAvatarUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploadingAvatar} aria-label="Upload profile photo"
                className="absolute bottom-0 right-0 w-10 h-10 bg-emerald-600 text-white rounded-full flex items-center justify-center hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg">
                {uploadingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              </button>

              {profile?.avatar && (
                <button onClick={() => setConfirmAvatarDelete(true)} aria-label="Remove profile photo" className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 mb-0.5 flex items-center justify-center gap-3">
              {formData.name || 'Your Name'}
              {user?.verificationStatus === 'verified' && <VerifiedBadge size="xs" />}
              {isPro && <ProBadge size="xs" />}
            </h2>
            <p className="text-sm text-slate-500 mb-1">{formData.title || 'Freelancer'}</p>
            <p className="text-xs text-slate-400 mb-2">{profile?.role === 'freelancer' ? 'Freelancer Account' : 'User Account'}</p>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100 mb-2">
              <div>
                <p className="text-xl font-bold text-slate-900">{freelancerProfile?.rating ? Number(freelancerProfile.rating).toFixed(1) : '—'}</p>
                <p className="text-xs text-slate-500">Rating</p>
              </div>
              <div>
                <p className="text-xl font-bold text-slate-900">{freelancerProfile?.experience ? Number(freelancerProfile.experience) : '—'}</p>
                <p className="text-xs text-slate-500">Years</p>
              </div>
              <div>
                <p className="text-xl font-bold text-slate-900">{formData.skills.length}</p>
                <p className="text-xs text-slate-500">Skills</p>
              </div>
            </div>

            {/* Completion Bar */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-600">Profile</span>
                <span className="text-xs font-bold text-emerald-600">{profileCompletion}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${profileCompletion}%` }} />
              </div>
            </div>

            {/* Availability Toggle */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${formData.availability ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <span className="text-sm font-medium text-slate-700">{formData.availability ? 'Available' : 'Unavailable'}</span>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-2 sticky top-4">
            <nav className="space-y-0.5">
              {tabs.map(({ id, label, icon: Icon, desc }) => (
                <button key={id} onClick={() => { setActiveTab(id); if (id === 'profile') setIsEditing(false); }}
                  className={`flex items-center gap-1.5 w-full px-3 py-2.5 rounded-xl font-medium transition-all text-left ${
                    activeTab === id ? 'bg-emerald-50 text-emerald-600 shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}>
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0 break-words">
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs text-slate-400 truncate">{desc}</p>
                  </div>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* ── RIGHT CONTENT ── */}
        <div className="lg:col-span-3 space-y-1.5">

          {/* ═══ PROFILE TAB ═══ */}
          {activeTab === 'profile' && (
            <>
              {/* Bio */}
              <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                <h3 className="font-display text-xl font-bold text-slate-900 mb-2">About</h3>
                {isEditing ? (
                  <textarea value={formData.bio} onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    rows={4} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
                    placeholder="Tell clients about yourself..." />
                ) : (
                  <p className="text-slate-600 leading-relaxed">{formData.bio || 'No bio added yet. Edit your profile to add a description.'}</p>
                )}
              </div>

              {isEditing && (
                <>
                  {/* Title */}
                  <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                    <h3 className="font-display text-xl font-bold text-slate-900 mb-2">Professional Title</h3>
                    <input type="text" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                      placeholder="e.g., Full Stack Developer, UI/UX Designer" />
                  </div>

                  {/* Professional Info */}
                  <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                    <h3 className="font-display text-xl font-bold text-slate-900 mb-2">Professional Info</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Base Rate ({currencySymbol()})</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{currencySymbol()}</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={hourlyRateInput}
                            onChange={(e) => {
                              // String state preserves the '.' while typing "50.5";
                              // empty field = 0 (never stuck). Out-of-range values are
                              // left alone here — save validation shows the real error.
                              const raw = e.target.value;
                              setHourlyRateInput(raw);
                              const parsed = raw === '' ? 0 : parseFloat(raw);
                              setFormData({ ...formData, hourly_rate: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 });
                            }}
                            className="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="50" />
                        </div>
                        <p className="text-xs text-slate-400 mt-1.5">Your standard rate — the starting point clients see on your profile</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Years of Experience</label>
                        <input
                          type="number"
                          min="0"
                          max="80"
                          step="0.5"
                          value={experienceInput}
                          onChange={(e) => {
                            // String state preserves the '.' while typing "2.5"; empty
                            // field = 0 (never stuck). >80 is NOT silently wiped here —
                            // save validation shows "between 0 and 80 years".
                            const raw = e.target.value;
                            setExperienceInput(raw);
                            const parsed = raw === '' ? 0 : parseFloat(raw);
                            setFormData({ ...formData, experience: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 });
                          }}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="e.g. 5 or 2.5" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Location</label>
                        <div className="relative">
                          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                          <input type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                            className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="City, Country" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Portfolio URL</label>
                        <input type="url" value={formData.portfolio_url} onChange={(e) => setFormData({ ...formData, portfolio_url: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="https://yourportfolio.com" />
                      </div>
                    </div>
                  </div>

                  {/* Categories + Free-text Skills */}
                  <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                    <h3 className="font-display text-xl font-bold text-slate-900 mb-2">Categories & Skills</h3>
                    <p className="text-xs text-slate-500 mb-2">
                      Pick up to 3 categories — Growlanzo matches you to projects by category. Add your own skills freely.
                    </p>

                    {/* Category → Skills picker (145 categories, no subcategory/skill hierarchy) */}
                    <div className="mb-2 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <CategoryPicker
                        mode="freelancer"
                        maxCategories={3}
                        selectedCategoryIds={selectedCategoryIds}
                        selectedSkills={formData.skills}
                        onCategoriesChange={setSelectedCategoryIds}
                        onSkillsChange={(skills) => setFormData(prev => ({ ...prev, skills }))}
                      />
                    </div>

                    {/* Free-text skill input (quick add) */}
                    <div className="flex gap-3 mb-3">
                      <input type="text" value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill())}
                        className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="e.g., React, Node.js, Python" />
                      <button type="button" onClick={addSkill} className="px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors">Add</button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {formData.skills.map(skill => (
                        <span key={skill} className="flex items-center gap-3 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium">
                          {skill}
                          <button type="button" onClick={() => removeSkill(skill)} className="hover:text-emerald-900">×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Languages */}
                  <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                    <h3 className="font-display text-xl font-bold text-slate-900 mb-2">Languages</h3>
                    <div className="flex gap-3 mb-3">
                      <input type="text" value={languageInput} onChange={(e) => setLanguageInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLanguage())}
                        className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="e.g., English, Spanish" />
                      <button type="button" onClick={addLanguage} className="px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors">Add</button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {formData.languages.map(lang => (
                        <span key={lang} className="flex items-center gap-3 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                          {lang}
                          <button type="button" onClick={() => removeLanguage(lang)} className="hover:text-blue-900">×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Education */}
                  <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                    <h3 className="font-display text-xl font-bold text-slate-900 mb-2">Education</h3>
                    <textarea rows={2} value={formData.education} onChange={(e) => setFormData({ ...formData, education: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all resize-none"
                      placeholder="e.g., B.S. Computer Science, MIT" />
                  </div>

                  {/* Certifications */}
                  <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                    <h3 className="font-display text-xl font-bold text-slate-900 mb-2">Certifications</h3>
                    <div className="flex gap-3 mb-3">
                      <input type="text" value={certInput} onChange={(e) => setCertInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCert())}
                        className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="e.g., AWS Certified" />
                      <button type="button" onClick={addCert} className="px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors">Add</button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {formData.certifications.map(cert => (
                        <span key={cert} className="flex items-center gap-3 px-3 py-1 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium">
                          {cert}
                          <button type="button" onClick={() => removeCert(cert)} className="hover:text-purple-900">×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Availability */}
                  <div className="flex items-center gap-1.5 p-4 bg-slate-50 rounded-xl">
                    <input type="checkbox" checked={formData.availability} onChange={(e) => setFormData({ ...formData, availability: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 cursor-pointer" />
                    <label className="flex-1 text-sm font-medium text-slate-700 cursor-pointer">I'm available to take new projects</label>
                  </div>
                </>
              )}

              {/* View Mode: Display info */}
              {!isEditing && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                    <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                      <h3 className="font-bold text-slate-900 mb-3 text-sm uppercase tracking-wider text-slate-500">Professional Info</h3>
                      <div className="space-y-1.5">
                        <div><span className="text-xs text-slate-400">Title</span><p className="font-medium">{formData.title || 'Not set'}</p></div>
                        <div><span className="text-xs text-slate-400">Base Rate</span><p className="font-medium">{formData.hourly_rate ? formatCurrency(Number(formData.hourly_rate)) : 'Not set'}</p></div>
                        <div><span className="text-xs text-slate-400">Experience</span><p className="font-medium">{formData.experience ? `${formData.experience} years` : 'Not set'}</p></div>
                        <div><span className="text-xs text-slate-400">Location</span><p className="font-medium">{formData.location || 'Not set'}</p></div>
                        <div><span className="text-xs text-slate-400">Portfolio</span><p className="font-medium">{formData.portfolio_url ? <a href={formData.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">{formData.portfolio_url}</a> : 'Not set'}</p></div>
                      </div>
                    </div>
                    <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                      <h3 className="font-bold text-slate-900 mb-3 text-sm uppercase tracking-wider text-slate-500">Education & Certs</h3>
                      <div className="space-y-4">
                        <div>
                          <span className="text-xs text-slate-400">Education</span>
                          <p className="font-medium mt-1">{formData.education || 'Not set yet'}</p>
                          {!formData.education && (
                            <p className="text-xs text-slate-400 mt-1">Add your educational background to build trust with clients</p>
                          )}
                        </div>
                        <div className="pt-2 border-t border-slate-100">
                          <span className="text-xs text-slate-400">Certifications</span>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {formData.certifications.length > 0 ? formData.certifications.map(c => <span key={c} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">{c}</span>) : <p className="text-sm text-slate-400">No certifications added yet</p>}
                          </div>
                          {formData.certifications.length === 0 && (
                            <p className="text-xs text-slate-400 mt-1">Add certifications to showcase your expertise</p>
                          )}
                        </div>
                        {/* Quick tip — fills remaining space naturally */}
                        <div className="pt-2 border-t border-slate-100">
                          <div className="flex items-start gap-3 text-xs text-slate-500">
                            <Info className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <span>Profiles with certifications get <strong className="text-slate-700">3x more</strong> client invitations. Add yours by clicking <strong className="text-emerald-600">Edit Profile</strong>.</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                    <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                      <h3 className="font-bold text-slate-900 mb-3 text-sm uppercase tracking-wider text-slate-500">Categories</h3>
                      <div className="flex flex-wrap gap-3">
                        {selectedCategoryNames.length > 0 ? selectedCategoryNames.map(c => <span key={c} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-lg text-sm">{c}</span>) : <p className="text-slate-400">No categories selected</p>}
                      </div>
                      {selectedCategoryNames.length === 0 && (
                        <p className="text-xs text-slate-400 mt-2">Pick categories to get AI-matched to projects</p>
                      )}
                    </div>
                    <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                      <h3 className="font-bold text-slate-900 mb-3 text-sm uppercase tracking-wider text-slate-500">Skills</h3>
                      <div className="flex flex-wrap gap-3">
                        {formData.skills.length > 0 ? [...formData.skills].sort((a, b) => a.localeCompare(b)).map(s => <span key={s} className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-sm">{s}</span>) : <p className="text-slate-400">No skills added</p>}
                      </div>
                      {formData.skills.length === 0 && (
                        <p className="text-xs text-slate-400 mt-2">Add skills to get better AI project matches</p>
                      )}
                    </div>
                    <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                      <h3 className="font-bold text-slate-900 mb-3 text-sm uppercase tracking-wider text-slate-500">Languages</h3>
                      <div className="flex flex-wrap gap-3">
                        {formData.languages.length > 0 ? formData.languages.map(l => <span key={l} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm">{l}</span>) : <p className="text-slate-400">No languages added</p>}
                      </div>
                      {formData.languages.length === 0 && (
                        <p className="text-xs text-slate-400 mt-2">Multilingual freelancers get hired 40% more</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Bottom Tips — fills blank space */}
              <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl p-3 border border-emerald-100 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
                  <div className="flex items-start gap-1.5">
                    <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Star className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-sm mb-1">Complete Your Profile</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">A complete profile gives clients more reasons to invite you. Add skills, portfolio, and certifications.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-sm mb-1">Verify Your Skills</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Take skill tests to earn verified badges. Clients trust verified freelancers 3x more.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Bell className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-sm mb-1">Stay Active</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Keep your availability updated. Active freelancers appear first in AI matches and client searches.</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ ACCOUNT TAB ═══ */}
          {activeTab === 'account' && (
            <>
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <h2 className="font-display text-xl font-bold text-slate-900 mb-3 flex items-center gap-3">
                  <Settings className="w-4 h-4 text-emerald-600" /> Account Settings
                </h2>
                <form onSubmit={handleAccountSave} className="space-y-1.5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Full Name</label>
                      <input type="text" value={accountData.name} onChange={(e) => setAccountData({ ...accountData, name: e.target.value })}
                        disabled={nameLock.locked}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed" placeholder="Your full name" />
                      {nameLock.locked && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5" /> Name locked for security — you can change it on {nameLock.unlockDate}.
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                      <input type="email" value={accountData.email} disabled className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed" />
                      <p className="text-xs text-slate-400 mt-1">Email cannot be changed here. Contact support.</p>
                      <EmailVerificationCard showEmail={false} className="mt-2" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Username</label>
                      <input type="text" value={accountData.username} onChange={(e) => setAccountData({ ...accountData, username: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="your-username" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
                      <input type="tel" value={accountData.phone} onChange={(e) => setAccountData({ ...accountData, phone: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="+1 (555) 000-0000" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-3"><Clock className="w-4 h-4" /> Timezone</label>
                      <select value={accountData.timezone} onChange={(e) => setAccountData({ ...accountData, timezone: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all">
                        {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-3"><Languages className="w-4 h-4" /> Language</label>
                      <select value={accountData.language} onChange={(e) => setAccountData({ ...accountData, language: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all">
                        {languageOptions.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-4 border-t border-slate-100">
                    <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50">
                      {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
                    </button>
                  </div>
                </form>
              </div>

              {/* Account Tips — fills blank space */}
              <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl p-3 border border-emerald-100 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Settings className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Profile Completeness</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Adding your timezone helps clients know your availability hours for real-time collaboration.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Globe className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Language Preference</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Set your preferred language to receive AI matches and notifications in your language.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Shield className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Account Security</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Visit the Security tab to enable 2FA and protect your account from unauthorized access.</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ SECURITY TAB ═══ */}
          {activeTab === 'security' && (
            <div className="space-y-1.5">
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <h2 className="font-display text-xl font-bold text-slate-900 mb-3 flex items-center gap-3">
                  <Lock className="w-4 h-4 text-emerald-600" /> Change Password
                </h2>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4">
                    For security, you'll be asked to confirm your identity before the password is changed.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">New Password</label>
                      <div className="relative">
                        <input type={securityData.showNewPassword ? 'text' : 'password'} value={securityData.newPassword} onChange={(e) => setSecurityData({ ...securityData, newPassword: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all pr-10" />
                        <button type="button" onClick={() => setSecurityData({ ...securityData, showNewPassword: !securityData.showNewPassword })}
                          aria-label={securityData.showNewPassword ? 'Hide new password' : 'Show new password'}
                          className="absolute right-4 top-1/2 -translate-y-1/2">
                          {securityData.showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Confirm Password</label>
                      <input type="password" value={securityData.confirmPassword} onChange={(e) => setSecurityData({ ...securityData, confirmPassword: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" />
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 p-4 bg-slate-50 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={signOutOthers}
                      onChange={(e) => setSignOutOthers(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 cursor-pointer"
                    />
                    <div>
                      <p className="font-medium text-slate-900 text-sm">Sign out all other sessions</p>
                      <p className="text-xs text-slate-500">Log out every other device after the password change</p>
                    </div>
                  </label>
                  <button type="submit" disabled={saving} className="w-full inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50">
                    {saving ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              </div>

              {/* 2FA */}
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <h2 className="font-display text-xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                  <Shield className="w-4 h-4 text-emerald-600" /> Two-Factor Authentication
                </h2>
                <p className="text-slate-600 mb-2">{twoFactorEnabled ? '2FA is enabled. Your account is more secure.' : 'Add an extra layer of security with 2FA.'}</p>
                {!showQrCode && !showRecoveryCodes && (
                  twoFactorEnabled ? (
                    <div className="flex items-center gap-1.5 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                      <Shield className="w-4 h-4 text-emerald-600" />
                      <div className="flex-1"><p className="font-medium text-emerald-800">2FA is Active</p><p className="text-sm text-emerald-600">Protected by two-factor authentication</p></div>
                      {!confirmDisable2FA ? (
                        <button onClick={handleDisable2FA} disabled={twoFactorLoading} className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 transition-colors">Disable</button>
                      ) : (
                        <div className="flex items-center gap-3">
                          <input
                            value={twoFactorCode}
                            onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="6-digit code"
                            maxLength={6}
                            inputMode="numeric"
                            autoFocus
                            className="w-28 px-3 py-2 text-sm text-center font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          />
                          <button onClick={() => void performDisable2FA()} disabled={twoFactorLoading}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50">
                            {twoFactorLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                          </button>
                          <button onClick={() => { setConfirmDisable2FA(false); setTwoFactorCode(''); }}
                            className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button onClick={handleSetup2FA} disabled={twoFactorLoading}
                      className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50">
                      {twoFactorLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                      {twoFactorLoading ? 'Setting up...' : 'Enable Two-Factor Authentication'}
                    </button>
                  )
                )}
                {showQrCode && (
                  <div className="space-y-4">
                    <div className="flex justify-center p-6 bg-white border-2 border-dashed border-slate-200 rounded-xl">
                      <div className="text-center">
                        {qrCodeUrl ? <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48 mx-auto" /> : <div className="w-48 h-48 bg-slate-100 rounded-lg flex items-center justify-center"><QrCode className="w-16 h-16 text-slate-400" /></div>}
                        <p className="text-sm text-slate-500 mt-3">Scan with your authenticator app</p>
                      </div>
                    </div>
                    {twoFactorSecret && (
                      <div className="p-4 bg-slate-50 rounded-xl">
                        <p className="text-sm font-medium text-slate-700 mb-2">Or enter manually:</p>
                        <code className="block p-3 bg-white border border-slate-200 rounded-lg text-sm font-mono text-center select-all">{twoFactorSecret}</code>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Verify Code</label>
                      <div className="flex gap-3">
                        <input type="text" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} placeholder="000000" maxLength={6}
                          className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all text-center text-lg font-mono tracking-widest" />
                        <button onClick={handleVerify2FA} disabled={twoFactorLoading || twoFactorCode.length !== 6}
                          className="px-3 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50">{twoFactorLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}</button>
                      </div>
                    </div>
                  </div>
                )}
                {showRecoveryCodes && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-center gap-3 mb-2"><AlertTriangle className="w-4 h-4 text-amber-600" /><p className="font-medium text-amber-800">Recovery Codes</p></div>
                    <p className="text-sm text-amber-700 mb-3">Save these codes in a secure place.</p>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {recoveryCodes.map((code, i) => <code key={i} className="p-2 bg-white border border-amber-300 rounded-lg text-sm font-mono text-center">{code}</code>)}
                    </div>
                    <button onClick={handleCopyRecoveryCodes} className="flex items-center gap-3 text-sm font-medium text-amber-700 hover:text-amber-800">
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied!' : 'Copy Codes'}
                    </button>
                  </div>
                )}
              </div>

              {/* Active Sessions */}
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <h2 className="font-display text-xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                  <Monitor className="w-4 h-4 text-emerald-600" /> Active Sessions
                </h2>
                <p className="text-sm text-slate-600 mb-2">You have {activeSessions} active session{activeSessions !== 1 ? 's' : ''}</p>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-1.5">
                    <Monitor className="w-4 h-4 text-slate-400" />
                    <div><p className="font-medium text-slate-900">Current Session</p><p className="text-sm text-slate-500">{sessionInfo}</p></div>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Active now</span>
                </div>
              </div>

              {/* Security Tips — fills blank space */}
              <div className="bg-gradient-to-br from-amber-50 to-white rounded-xl p-3 border border-amber-100 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Lock className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Strong Passwords</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Use a mix of letters, numbers, and symbols. Never reuse passwords across different sites.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Shield className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Enable 2FA</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Two-factor authentication adds an extra layer of security. Highly recommended for all accounts.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Monitor className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Monitor Sessions</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Regularly check your active sessions and sign out from devices you no longer use.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ NOTIFICATIONS TAB ═══ */}
          {activeTab === 'notifications' && (
            <>
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <h2 className="font-display text-xl font-bold text-slate-900 mb-3 flex items-center gap-3">
                  <Bell className="w-4 h-4 text-emerald-600" /> Notification Preferences
                </h2>
                <div className="space-y-4 mb-3">
                  {Object.entries(notifications).map(([key, value]) => (
                    <div key={key} className="p-4 border border-slate-200 rounded-xl">
                      <p className="font-medium text-slate-900 mb-3 capitalize">{key}</p>
                      <div className="flex flex-wrap gap-3">
                        {Object.entries(value).map(([type, enabled]) => (
                          <label key={type} className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={enabled} onChange={(e) => setNotifications({ ...notifications, [key]: { ...value, [type]: e.target.checked } })}
                              className="w-4 h-4 text-emerald-600 rounded border-slate-300" />
                            <span className="text-sm text-slate-600 capitalize">{type === 'inApp' ? 'In-App' : type === 'push' ? 'Push' : 'Email'}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button onClick={handleNotificationsSave} disabled={saving} className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50">
                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Preferences</>}
                  </button>
                </div>
              </div>

              {/* Notifications Tips — fills blank space */}
              <div className="bg-gradient-to-br from-orange-50 to-white rounded-xl p-3 border border-orange-100 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Bell className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Stay Updated</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Enable push notifications to get instant updates about new proposals, messages, and projects.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Mail className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Email Digests</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Email notifications ensure you never miss important updates even when you're away from the platform.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Settings className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Control Frequency</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">You can fine-tune which notifications you receive for each category. Disable what you don't need.</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ PRIVACY TAB ═══ */}
          {activeTab === 'privacy' && (
            <>
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <h2 className="font-display text-xl font-bold text-slate-900 mb-3 flex items-center gap-3">
                  <Globe className="w-4 h-4 text-emerald-600" /> Privacy Settings
                </h2>
                                  <div className="space-y-1.5">
                    {/* Honest state: these controls are a preview and are NOT
                        persisted anywhere. Rendering a working Save button that
                        writes nothing (and said "saved!") was a false
                        confirmation, so the controls are visible but disabled. */}
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <strong>Coming soon.</strong> These privacy controls are not live yet — nothing you
                      change here is saved. Until they ship, your public profile shows only what is already
                      on this page, and you can email support@growlanzo.com for a privacy request.
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Profile Visibility</label>
                    <select value={privacy.profileVisibility} disabled aria-disabled="true"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 outline-none">
                      <option value="public">Public — Anyone can view your profile</option>
                      <option value="clients_only">Clients Only — Only clients can see you</option>
                      <option value="private">Private — Hidden from search</option>
                    </select>
                  </div>
                  {[
                    { key: 'showOnlineStatus', label: 'Show Online Status', desc: 'Let clients see when you\'re online' },
                    { key: 'showEarnings', label: 'Show Earnings', desc: 'Display your total earnings on your profile' },
                    { key: 'showActiveProjects', label: 'Show Active Projects', desc: 'Display your active projects' },
                    { key: 'allowDirectMessages', label: 'Allow Direct Messages', desc: 'Let clients message you directly' },
                  ].map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                      <div><p className="font-medium text-slate-900">{label}</p><p className="text-sm text-slate-600">{desc}</p></div>
                      <input type="checkbox" checked={(privacy as any)[key]} disabled aria-disabled="true" readOnly
                        className="w-4 h-4 text-emerald-600 rounded border-slate-300 opacity-60" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Privacy Tips — fills blank space */}
              <div className="bg-gradient-to-br from-sky-50 to-white rounded-xl p-3 border border-sky-100 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-sky-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Globe className="w-4 h-4 text-sky-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Profile Visibility</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Choose who can discover your profile. Public profiles get the most client matches.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-sky-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Eye className="w-4 h-4 text-sky-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Online Status</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Showing your online status helps clients know when you're available for quick responses.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-sky-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Mail className="w-4 h-4 text-sky-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Direct Messages</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Keep DMs open to receive project invitations directly from interested clients.</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ PAYOUT TAB ═══ */}
          {activeTab === 'payout' && (
            <>
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <h2 className="font-display text-xl font-bold text-slate-900 mb-3 flex items-center gap-3">
                  <IndianRupee className="w-4 h-4 text-emerald-600" /> Payout Methods
                </h2>
                {payoutMethodsLoading && (
                  <div className="flex items-center justify-center py-4 mb-3"><Loader2 className="w-4 h-4 animate-spin text-emerald-600" /><span className="ml-3 text-sm text-slate-500">Loading...</span></div>
                )}
                {payoutMethodsError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl mb-3 flex items-center gap-3">
                    <AlertCircle className="w-4 h-4 text-red-600" /><p className="text-sm text-red-700">{payoutMethodsError}</p>
                    <button onClick={() => void fetchPayoutMethods()} className="ml-auto text-xs text-red-600 font-medium underline">Retry</button>
                  </div>
                )}
                {!payoutMethodsLoading && payoutMethods.length > 0 ? (
                  <div className="space-y-1.5 mb-3">
                    {payoutMethods.map(method => (
                      <div key={method.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${method.type === 'paypal' ? 'bg-blue-100' : method.type === 'upi' ? 'bg-violet-100' : 'bg-green-100'}`}>
                            {method.type === 'paypal' ? <span className="text-blue-600 font-bold text-sm">P</span> : method.type === 'upi' ? <span className="text-violet-600 font-bold text-sm">U</span> : <Briefcase className="w-4 h-4 text-green-600" />}
                          </div>
                          <div><p className="font-medium text-slate-900">{method.type === 'paypal' ? 'PayPal' : method.type === 'upi' ? `UPI — ${method.upi_id || ''}` : `Bank — ${method.bank_name || ''}`}</p>
                          <p className="text-sm text-slate-500">{method.type === 'paypal' ? method.email : method.type === 'upi' ? method.upi_id : `${method.account_holder_name || ''} ••••${method.account_number?.slice(-4) || ''}`}</p></div>
                        </div>
                        <div className="flex items-center gap-3">
                          {method.is_default && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-medium">Default</span>}
                          {!method.is_default && <button onClick={() => handleSetDefaultPayout(method.id)} className="text-xs text-slate-500 hover:text-emerald-600 font-medium">Set Default</button>}
                          {confirmDeletePayout === method.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleRemovePayout(method.id)} disabled={deletingPayoutId === method.id}
                                className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50">{deletingPayoutId === method.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm'}</button>
                              <button onClick={() => setConfirmDeletePayout(null)} className="text-xs px-2 py-1 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 font-medium">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDeletePayout(method.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !payoutMethodsLoading ? (
                  <div className="text-center py-4 text-slate-500 mb-3">
                    <IndianRupee className="w-8 h-8 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium">No payout methods added yet</p>
                    <p className="text-sm">Add a payout method to receive payments</p>
                  </div>
                ) : null}

                {showAddPayout ? (
                  <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl">
                    <h3 className="font-medium text-slate-900 mb-2">Add Payout Method</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Method Type</label>
                        <select value={newPayout.type} onChange={(e) => setNewPayout({ ...newPayout, type: e.target.value as any })}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all">
                          <option value="upi">UPI (Recommended)</option>
                          <option value="bank">Bank Account</option>
                          <option value="paypal">PayPal (Coming Soon)</option>
                        </select>
                      </div>
                      {newPayout.type === 'paypal' && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                          <p className="text-xs text-amber-800">
                            PayPal withdrawals are <strong>coming soon</strong>. For now, add a UPI ID or Bank Account to withdraw in INR via RazorpayX.
                          </p>
                        </div>
                      )}
                      {newPayout.type === 'upi' && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">UPI ID <span className="text-red-400">*</span></label>
                          <input type="text" value={newPayout.upiId} onChange={(e) => setNewPayout({ ...newPayout, upiId: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="yourname@upi" />
                          <p className="text-xs text-slate-400 mt-1">e.g. yourname@okhdfcbank, yourname@ybl — paid via RazorpayX (INR)</p>
                        </div>
                      )}
                      {newPayout.type === 'bank' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Account Holder Name <span className="text-red-400">*</span></label>
                            <input type="text" value={newPayout.accountHolderName} onChange={(e) => setNewPayout({ ...newPayout, accountHolderName: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">Bank Name</label>
                              <input type="text" value={newPayout.bankName} onChange={(e) => setNewPayout({ ...newPayout, bankName: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" placeholder="e.g. HDFC Bank" />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">IFSC Code <span className="text-red-400">*</span></label>
                              <input type="text" value={newPayout.ifscCode} onChange={(e) => setNewPayout({ ...newPayout, ifscCode: e.target.value.toUpperCase() })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all uppercase" placeholder="HDFC0001234" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Account Number <span className="text-red-400">*</span></label>
                            <input type="text" value={newPayout.accountNumber} onChange={(e) => setNewPayout({ ...newPayout, accountNumber: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all" />
                          </div>
                          <p className="text-xs text-slate-400 mt-1">Bank transfers are processed via RazorpayX (INR)</p>
                        </>
                      )}
                      <div className="flex gap-3">
                        <button onClick={() => setShowAddPayout(false)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors">Cancel</button>
                        <button onClick={handleAddPayout} disabled={addingPayout} className="flex-1 flex items-center justify-center gap-3 px-4 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50">
                          {addingPayout ? <Loader2 className="w-4 h-4 animate-spin" /> : <IndianRupee className="w-4 h-4" />}
                          {addingPayout ? 'Adding...' : 'Add Method'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowAddPayout(true)} disabled={payoutMethodsLoading}
                    className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:text-emerald-600 hover:border-emerald-300 transition-all w-full justify-center disabled:opacity-50">
                    <IndianRupee className="w-4 h-4" /> Add Payout Method
                  </button>
                )}
              </div>

              {/* Payout Tips — fills blank space */}
              <div className="bg-gradient-to-br from-green-50 to-white rounded-xl p-3 border border-green-100 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <IndianRupee className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Quick Payouts</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">Set up your preferred payout method to receive payments quickly once a project milestone is completed.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <CreditCard className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Multiple Methods</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">You can add multiple payout methods and set one as default for automatic payments.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Shield className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 text-xs mb-1">Secure Transactions</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">All transactions are processed securely via encrypted channels. Your financial data is protected.</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ DELETION TAB ═══ */}
          {activeTab === 'deletion' && (
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <h2 className="font-display text-xl font-bold text-slate-900 mb-3 flex items-center gap-3">
                <Trash2 className="w-4 h-4 text-red-500" /> Delete Account
              </h2>
              {deletionStep === 'initial' && (
                <div className="space-y-1.5">
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                    <div className="flex items-center gap-3 mb-2"><AlertTriangle className="w-4 h-4 text-red-600" /><p className="font-medium text-red-800">Warning: This cannot be undone</p></div>
                    <p className="text-sm text-red-700">Deleting your account will permanently remove all your data including projects, contracts, messages, and payment history.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Why are you leaving? (optional)</label>
                    <textarea rows={3} value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all resize-none" placeholder="Help us improve..." />
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} className="mt-1 w-4 h-4 text-red-600 rounded border-slate-300 cursor-pointer" />
                      <div><p className="font-medium text-slate-900">I understand this action is irreversible</p><p className="text-sm text-slate-500">I confirm permanent deletion</p></div>
                    </label>
                  </div>
                  <button onClick={() => setDeletionStep('confirm')} disabled={!acceptedTerms} className="inline-flex items-center justify-center gap-3 px-3 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50">
                    <Trash2 className="w-4 h-4" /> Continue with Deletion
                  </button>
                </div>
              )}
              {deletionStep === 'confirm' && (
                <div className="space-y-1.5">
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-red-600 mb-2" />
                    <p className="font-medium text-red-800">Final Confirmation</p>
                    <p className="text-sm text-red-700 mt-1">Type <strong>DELETE</strong> below to confirm</p>
                  </div>
                  <input type="text" value={deletionConfirm} onChange={(e) => setDeletionConfirm(e.target.value)} placeholder="Type DELETE to confirm"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none transition-all text-center text-xl font-bold" />
                  <div className="flex gap-1.5">
                    <button onClick={() => { setDeletionStep('initial'); setDeletionConfirm(''); }} className="flex-1 px-3 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-all">Cancel</button>
                    <button onClick={handleRequestDeletion} disabled={deletionConfirm !== 'DELETE'}
                      className="flex-1 inline-flex items-center justify-center gap-3 px-3 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50">
                      {(deletionStep as string) === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Permanently Delete Account
                    </button>
                  </div>
                </div>
              )}
              {deletionStep === 'processing' && (
                <div className="text-center py-4"><Loader2 className="w-8 h-8 animate-spin text-red-600 mx-auto mb-2" /><p className="font-medium text-slate-900">Processing your deletion request...</p></div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Reauthentication Dialog (password / OTP, 10-min window) ── */}
      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onVerified={handleReauthVerified}
        title="Confirm your identity"
        description="For your security, please verify your identity before changing your password. Your session stays verified for 10 minutes."
      />

      {/* ── Confirm Modals ── */}
      <ConfirmModal
        isOpen={confirmAvatarDelete}
        onClose={() => setConfirmAvatarDelete(false)}
        onConfirm={handleAvatarDelete}
        title="Remove Avatar"
        message="Are you sure you want to remove your profile picture? This action can be undone later by uploading a new avatar."
        confirmLabel={deletingAvatar ? 'Removing...' : 'Remove'}
        variant="warning"
        loading={deletingAvatar}
      />
    </div>
  );
}
