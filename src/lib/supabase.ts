import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/supabase';

// 🛡️ Trim env values — prevents broken auth URLs caused by stray trailing
// whitespace/newlines when env vars are pasted into Vercel/Supabase dashboards
// (a trailing \n in the URL silently broke every auth request).
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const REQUEST_TIMEOUT_MS = 15000;
let channelCounter = 0;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

// ═══════════════════════════════════════════════════════════════════
// Static Supabase Client
// ═══════════════════════════════════════════════════════════════════
// The client is created synchronously at module load time.
// This is more reliable than the lazy proxy pattern — no race
// conditions between dynamic import() and React's async lifecycle.
// ═══════════════════════════════════════════════════════════════════

const supabaseClient: SupabaseClient<Database> = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // ⚠️ flowType MUST be 'implicit' (NOT 'pkce') for production email verification:
    // with 'pkce', the confirmation email link ends at /auth/callback?code=... and
    // exchangeCodeForSession() requires a `code_verifier` stored in the SIGNUP
    // browser's localStorage. If the user signs up on localhost/phone/browser A and
    // clicks the link on the vercel domain/browser B, the verifier is missing →
    // exchange fails → 'Authentication failed' even though Supabase already set
    // email_confirmed_at server-side (auth.sessions stays empty — the exact bug
    // we fixed). With 'implicit', session tokens arrive in the URL hash
    // (#access_token=...) and are auto-processed by detectSessionInUrl — no code
    // verifier needed, works on any device/browser.
    flowType: 'implicit',
    debug: import.meta.env.DEV,
  },
  realtime: {
    params: { eventsPerSecond: 100 },
  },
  global: {
    headers: {
      'X-Client-Info': 'growlancer-web',
      'X-App-Version': import.meta.env.VITE_APP_VERSION || 'dev',
    },
    fetch: (...args) => {
      const [url, options = {}] = args;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : '';
      void urlStr; // reserved for future edge-function-specific handling

      // ⚠️ IMPORTANT: do NOT throw on non-2xx here. supabase-js (auth, postgrest,
      // realtime) reads the HTTP status from the response and handles it
      // internally (401 → invalid JWT → silent refresh; 400/403 → returned as
      // `{ error }`). Throwing a generic Error here breaks the auth/session
      // restore flow — e.g. a 401 while validating the OAuth callback token
      // crashed initialization, so the session never persisted and the user was
      // bounced back to login. Only apply the timeout; let supabase-js handle
      // status codes. (Edge-function 4xx are already surfaced by callers.)
      return fetch(url, {
        ...options,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
    },
  },
});

/** For backward compatibility — immediately returns the already-created client */
export async function getClient(): Promise<SupabaseClient<Database>> {
  return supabaseClient;
}

/**
 * 🔥 Force-clears ALL persisted Supabase auth sessions from localStorage.
 *
 * WHY THIS EXISTS:
 * When a user is deleted from Supabase (Auth → Users) while their browser
 * still holds a session, supabase-js keeps the stale token in localStorage.
 * `supabase.auth.signOut()` can return early WITHOUT clearing storage when
 * the token belongs to a deleted/invalid user (it only clears storage on the
 * success path), so the app reloads → re-reads the stale session → the user
 * is stuck in a loop ("Email not verified" / can't log out).
 *
 * This helper guarantees cleanup by removing every `sb-*-auth-token*` key
 * directly from localStorage, regardless of what supabase-js does.
 */
export function clearSupabaseAuthStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const staleKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.includes('-auth-token')) {
        staleKeys.push(key);
      }
    }
    staleKeys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage unavailable (private browsing, disabled) — ignore
  }
}

/**
 * Synchronously answers: "does this browser already hold a Supabase session?"
 *
 * This is the persisted token check ONLY — no network, no validation. It exists
 * so the UI can tell a RETURNING user (session in storage, still restoring) apart
 * from a FIRST-TIME visitor (nothing stored) on the very first paint.
 *
 * Returning users must never be shown the GitHub/LinkedIn buttons again. Before
 * this existed, the header rendered "Login" for the first ~1-2s of a returning
 * visit (auth restore is async), and tapping it opened a modal whose only
 * options were the providers — the "login again sends me back to GitHub" loop.
 */
export function hasPersistedAuthSession(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue;
      // `-user` mirrors are not proof of a session; only the token object is.
      if (key.endsWith('-auth-token-user')) continue;
      const raw = localStorage.getItem(key);
      if (raw && raw !== 'null' && raw.length > 2) return true;
    }
  } catch {
    // localStorage unavailable (private browsing, disabled) — treat as signed out
  }
  return false;
}

/**
 * True ONLY when the error means the auth user no longer exists server-side
 * (deleted from Supabase / revoked token). Returns false for transient
 * network errors, timeouts, or GoTrue 5xx — those must NOT trigger a
 * force-logout of a legitimately signed-in user.
 */
export function isStaleSessionError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { status?: number; message?: string };
  // GoTrue returns HTTP 401 for a deleted/unknown user (code 'user_not_found')
  if (typeof err.status === 'number' && err.status === 401) return true;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('user from sub claim') ||
    msg.includes('invalid claim') ||
    msg.includes('user not found') ||
    (msg.includes('does not exist') && msg.includes('user')) ||
    (msg.includes('jwt') && msg.includes('expired'))
  );
}

// ═══ Export the client ════════════════════════════════════════════
// All existing code that does `import { supabase } from '../lib/supabase'`
// continues to work unchanged.
export const supabase = supabaseClient;

// ═══ All known table names (in both Database type & extended) ════
export type TableName =
  // Typed in Database['public']['Tables']
  | keyof Database['public']['Tables']
  // Extended tables (not yet in Database type, added via migrations)
  | 'payment_methods'
  | 'review_replies'
  | 'saved_searches'
  | 'time_entries'
  | 'verification_rate_limits'
  | 'credential_verification_tokens'
  | 'credential_version_history'
  | 'credential_audit_logs'
  | 'connects_transactions'
  | 'support_tickets'
  | 'ticket_messages'
  | 'certifications'
  | 'education_history'
  | 'employment_history'
  | 'languages'
  | 'skill_certifications'
  | 'newsletter_subscribers'
  | 'contact_inquiries'
  | 'internship_applications'
  | 'contest_comments'
  | 'workspace_activity_logs'
  | 'opportunity_events'
  | 'team_invitations'
  | 'fraud_events'
  | 'user_reports'
  | 'client_errors'
  | 'team_projects'
  | 'team_project_roles';

/**
 * Safe typed table reference.
 * Centralizes `as any` casts so only this one function needs the escape hatch.
 * String must match a known table — TS catches typos at compile time.
 */
function t(name: TableName) {
  return supabase.from(name as keyof Database['public']['Tables']);
}

// ═══ Typed table helpers ══════════════════════════════════════════
export const tables = {
  profiles: () => t('profiles'),
  freelancerProfiles: () => t('freelancer_profiles'),
  clientProfiles: () => t('client_profiles'),
  projects: () => t('projects'),
  projectMatches: () => t('project_matches'),
  proposals: () => t('proposals'),
  contracts: () => t('contracts'),
  escrow: () => t('escrow'),
  transactions: () => t('transactions'),
  invites: () => t('invites'),
  subscriptions: () => t('subscriptions'),
  referrals: () => t('referrals'),
  referralStats: () => t('referral_stats'),
  services: () => t('services'),
  messages: () => t('messages'),
  reviews: () => t('reviews'),
  notifications: () => t('notifications'),
  withdrawals: () => t('withdrawals'),
  paypalOrders: () => t('paypal_orders'),
  paypalTransactions: () => t('paypal_transactions'),
  contractFiles: () => t('contract_files'),
  subscriptionPlans: () => t('subscription_plans'),
  userDeletionRequests: () => t('user_deletion_requests'),
  userMfaSettings: () => t('user_mfa_settings'),
  recoveryCodes: () => t('recovery_codes'),
  notificationPreferences: () => t('notification_preferences'),
  pushTokens: () => t('push_tokens'),
  payoutMethods: () => t('payout_methods'),
  portfolioItems: () => t('portfolio_items'),
  disputeCases: () => t('disputes'),
  wallets: () => t('wallets'),
  categories: () => t('categories'),
  subcategories: () => t('subcategories'),
  skills: () => t('skills'),
  freelancerSkills: () => t('freelancer_skills'),
  projectCategories: () => t('project_categories'),
  projectSkills: () => t('project_skills'),
  serviceCategories: () => t('service_categories'),
  workspaceTasks: () => t('workspace_tasks'),
  workspaceNotes: () => t('workspace_notes'),
  razorpayOrders: () => t('razorpay_orders'),
  razorpayTransactions: () => t('razorpay_transactions'),
};

// ═══ Realtime channels manager ════════════════════════════════════
function nextChannelName(base: string, scope?: string) {
  channelCounter += 1;
  return `${base}:${scope || 'global'}:${channelCounter}`;
}

/**
 * Generate a UNIQUE realtime channel name.
 *
 * ⚠️ WHY THIS EXISTS (critical):
 * supabase-js returns the EXISTING channel object when you call
 * `supabase.channel(name)` with a name that was already created. If that
 * channel is already subscribed, calling `.on('postgres_changes', ...)` on
 * it again throws: "cannot add postgres_changes callbacks ... after
 * subscribe()" — which crashes the whole page via the ErrorBoundary.
 * Multiple components (e.g. useProStatus in DashboardLayout + OverviewPage)
 * subscribing with the SAME static name triggers this bug. Always use
 * `uniqueChannelName()` so every subscriber gets its own channel.
 */
export function uniqueChannelName(base: string, scope?: string): string {
  channelCounter += 1;
  return `${base}:${scope || 'global'}:${channelCounter}:${Date.now().toString(36)}`;
}

export const realtimeChannels = {
  projects: (scope?: string) => supabase.channel(nextChannelName('projects', scope)),
  projectMatches: (scope?: string) => supabase.channel(nextChannelName('project_matches', scope)),
  aiMatches: (scope?: string) => supabase.channel(nextChannelName('ai_matches', scope)),
  invites: (scope?: string) => supabase.channel(nextChannelName('invites', scope)),
  proposals: (scope?: string) => supabase.channel(nextChannelName('proposals', scope)),
  contracts: (scope?: string) => supabase.channel(nextChannelName('contracts', scope)),
  escrow: (scope?: string) => supabase.channel(nextChannelName('escrow', scope)),
  transactions: (scope?: string) => supabase.channel(nextChannelName('transactions', scope)),
  profiles: (scope?: string) => supabase.channel(nextChannelName('profiles', scope)),
  services: (scope?: string) => supabase.channel(nextChannelName('services', scope)),
  messages: (scope?: string) => supabase.channel(nextChannelName('messages', scope)),
  notifications: (scope?: string) => supabase.channel(nextChannelName('notifications', scope)),
  reviews: (scope?: string) => supabase.channel(nextChannelName('reviews', scope)),
  paypalOrders: (scope?: string) => supabase.channel(nextChannelName('paypal_orders', scope)),
  razorpayOrders: (scope?: string) => supabase.channel(nextChannelName('razorpay_orders', scope)),
  savedPaymentCards: (scope?: string) => supabase.channel(nextChannelName('saved_payment_cards', scope)),
  waitlist: (scope?: string) => supabase.channel(nextChannelName('waitlist', scope)),
  referrals: (scope?: string) => supabase.channel(nextChannelName('referrals', scope)),
  referralStats: (scope?: string) => supabase.channel(nextChannelName('referral_stats', scope)),
  // The referral code itself lives on profiles_private (owner-only RLS).
  profilesPrivate: (scope?: string) => supabase.channel(nextChannelName('profiles_private', scope)),
  portfolio: (scope?: string) => supabase.channel(nextChannelName('portfolio_items', scope)),
  workspaceTasks: (scope?: string) =>
    supabase.channel(nextChannelName('workspace_tasks', scope)),
  workspaceNotes: (scope?: string) =>
    supabase.channel(nextChannelName('workspace_notes', scope)),
};

// ═══ RPC function names (typed union for callRpc helper) ═════════
export type RpcName =
  // Typed in Database['public']['Functions']
  | keyof Database['public']['Functions']
  // Extended RPCs (not yet in Database type)
  | 'request_account_deletion'
  | 'cancel_account_deletion'
  | 'check_deletion_status'
  | 'get_mfa_status'
  | 'generate_recovery_codes'
  | 'verify_recovery_code'
  | 'verify_reauth_status'
  | 'complete_onboarding'
  | 'sync_private_email'
  | 'sync_private_referral'
  | 'enable_user_mfa'
  | 'disable_user_mfa'
  | 'get_recovery_codes_count'
  | 'get_notification_preferences'
  | 'set_notification_preferences'
  | 'archive_notification'
  | 'restore_notification'
  | 'archive_all_read_notifications'
  | 'get_notifications_by_category'
  | 'register_push_token'
  | 'unregister_push_token'
  | 'get_user_push_tokens'
  | 'get_category_counts'
  | 'get_category_hierarchy'
  | 'get_category_counts_v2'
  | 'get_active_freelancers_by_category'
  | 'search_freelancers_by_category'
  | 'get_projects_by_category'
  | 'get_wallet_balance'
  | 'get_wallet_balance_v2'
  // update_wallet_balance / hold_wallet_funds / release_wallet_funds /
  // process_withdrawal_complete are NOT callable from the browser — migration
  // 20270119000012 revoked EXECUTE from anon/authenticated (service_role only).
  // The withdrawal edge function drives them with its service-role client.
  | 'cancel_withdrawal'
  | 'get_payout_methods'
  | 'set_default_payout_method'
  | 'delete_payout_method'
  // cleanup_verification_rate_limits is server-only (20270119000012); the
  // verification-rate-limit cleanup now runs from pg_cron.
  | 'generate_credential_token'
  | 'insert_credential_version'
  | 'insert_credential_audit_log'
  | 'verify_credential_by_token'
  | 'raise_contract_dispute'
  | 'create_contract_with_escrow'
  | 'accept_invite_create_contract'
  | 'process_referral'
  | 'update_user_country'
  // Refund & Dispute Resolution System
  | 'request_contract_refund'
  | 'respond_cancellation_request'
  | 'freelancer_decline_contract'
  | 'mark_freelancer_started'
  | 'admin_decide_dispute'
  | 'admin_assign_dispute'
  | 'admin_add_internal_note'
  | 'appeal_dispute'
  | 'send_dispute_message'
  | 'attach_dispute_evidence'
  | 'freeze_contract'
  | 'unfreeze_contract'
  // process_pending_refunds / process_no_response_disputes are pg_cron-only
  // (server-only since 20270119000012).
  | 'create_user_subscription'
  | 'get_ai_writer_usage';

/**
 * Safe typed RPC caller.
 * Centralizes `supabase.rpc as any` so only this one function needs the escape hatch.
 */
function callRpc(name: RpcName, args?: Record<string, unknown>) {
  return supabase.rpc(name as any, args);
}

// ═══ Database function callers ════════════════════════════════════
export const dbFunctions = {
  calculateMatchScore: (projectId: string, freelancerId: string) =>
    supabase.rpc('calculate_match_score', {
      p_project_id: projectId,
      p_freelancer_id: freelancerId,
    }),
  createContractWithEscrow: (params: {
    p_project_id: string;
    p_freelancer_id: string;
    p_proposal_id: string;
    p_amount: number;
    p_client_id: string;
  }) => supabase.rpc('create_contract_with_escrow', params),
  acceptInviteCreateContract: (inviteId: string) =>
    callRpc('accept_invite_create_contract', { p_invite_id: inviteId }),
  createUserSubscription: (planId: string) =>
    callRpc('create_user_subscription', { p_plan_id: planId }),
  fundEscrow: (contractId: string, clientId: string) =>
    supabase.rpc('fund_escrow', {
      p_contract_id: contractId,
      p_client_id: clientId,
    }),
  releaseEscrow: (contractId: string, clientId: string) =>
    supabase.rpc('release_escrow', {
      p_contract_id: contractId,
      p_client_id: clientId,
    }),
  // NOTE: generate_project_matches / upsert_project_matches are no longer
  // browser-callable (20270119000012 revoked the anon grant; the live AI path
  // is the ai-matching edge function).
  // Account Deletion
  requestAccountDeletion: (userId: string, reason?: string) =>
    callRpc('request_account_deletion', {
      p_user_id: userId,
      p_reason: reason || null,
    }),
  cancelAccountDeletion: (userId: string) =>
    callRpc('cancel_account_deletion', {
      p_user_id: userId,
    }),
  checkDeletionStatus: (userId: string) =>
    callRpc('check_deletion_status', {
      p_user_id: userId,
    }),
  // NOTE: process_account_deletion is intentionally NOT exposed here. It is a
  // destructive RPC (hard-deletes a user across every table) and is granted to
  // service_role only; supabase/functions/process-deletion calls it server-side
  // after verifying the request itself.
  // Two-Factor Authentication (2FA)
  getMFAStatus: (userId: string) =>
    callRpc('get_mfa_status', {
      p_user_id: userId,
    }),
  generateRecoveryCodes: (userId: string) =>
    callRpc('generate_recovery_codes', {
      p_user_id: userId,
    }),
  verifyRecoveryCode: (userId: string, code: string) =>
    callRpc('verify_recovery_code', {
      p_user_id: userId,
      p_code: code,
    }),
  enableUserMFA: (userId: string, totpSecret: string) =>
    callRpc('enable_user_mfa', {
      p_user_id: userId,
      p_totp_secret: totpSecret,
    }),
  disableUserMFA: (userId: string) =>
    callRpc('disable_user_mfa', {
      p_user_id: userId,
    }),
  getRecoveryCodesCount: (userId: string) =>
    callRpc('get_recovery_codes_count', {
      p_user_id: userId,
    }),
  // Notification Preferences
  getNotificationPreferences: (userId: string) =>
    callRpc('get_notification_preferences', {
      p_user_id: userId,
    }),
  setNotificationPreferences: (userId: string, preferences: Record<string, unknown>) =>
    callRpc('set_notification_preferences', {
      p_user_id: userId,
      p_preferences: preferences as unknown as Json,
    }),
  // Notification Enhancements (Phase 5)
  archiveNotification: (notificationId: string, userId: string) =>
    callRpc('archive_notification', {
      p_notification_id: notificationId,
      p_user_id: userId,
    }),
  restoreNotification: (notificationId: string, userId: string) =>
    callRpc('restore_notification', {
      p_notification_id: notificationId,
      p_user_id: userId,
    }),
  archiveAllReadNotifications: (userId: string) =>
    callRpc('archive_all_read_notifications', {
      p_user_id: userId,
    }),
  getNotificationsByCategory: (params: {
    p_user_id: string;
    p_type?: string;
    p_archived?: boolean;
    p_unread_only?: boolean;
    p_limit?: number;
    p_offset?: number;
  }) => callRpc('get_notifications_by_category', params as Record<string, unknown>),
  registerPushToken: (
    userId: string,
    token: string,
    platform: string,
    deviceName?: string,
  ) =>
    callRpc('register_push_token', {
      p_user_id: userId,
      p_token: token,
      p_platform: platform,
      p_device_name: deviceName || null,
    }),
  unregisterPushToken: (userId: string, token: string) =>
    callRpc('unregister_push_token', {
      p_user_id: userId,
      p_token: token,
    }),
  getUserPushTokens: (userId: string) =>
    callRpc('get_user_push_tokens', {
      p_user_id: userId,
    }),
  // === AI WRITER ===
  getAIWriterUsage: () => callRpc('get_ai_writer_usage'),

  // === CATEGORY ECOSYSTEM RPCs ===
  getCategoryCounts: () => callRpc('get_category_counts'),
  getCategoryHierarchy: () => callRpc('get_category_hierarchy'),
  getCategoryCountsV2: () => callRpc('get_category_counts_v2'),
  getActiveFreelancersByCategory: () =>
    callRpc('get_active_freelancers_by_category'),
  searchFreelancersByCategory: (params: {
    p_category_slug: string;
    p_search_query?: string;
    p_min_rate?: number;
    p_max_rate?: number;
    p_sort_by?: string;
    p_limit?: number;
    p_offset?: number;
  }) => callRpc('search_freelancers_by_category', params as Record<string, unknown>),
  getProjectsByCategory: (params: {
    p_category_slug: string;
    p_search_query?: string;
    p_limit?: number;
    p_offset?: number;
  }) => callRpc('get_projects_by_category', params as Record<string, unknown>),

  // === WALLET RPCS ===
  // Only the read is browser-safe; the money writers were deliberately removed
  // (20270119000012 revoked their EXECUTE from every user role).
  getWalletBalance: (userId: string) =>
    callRpc('get_wallet_balance_v2', { p_user_id: userId }),
  cancelWithdrawal: (withdrawalId: string, userId: string) =>
    callRpc('cancel_withdrawal', {
      p_withdrawal_id: withdrawalId,
      p_user_id: userId,
    }).single(),
  getPayoutMethods: (userId: string) =>
    callRpc('get_payout_methods', { p_user_id: userId }),
  setDefaultPayoutMethod: (methodId: string, userId: string) =>
    callRpc('set_default_payout_method', {
      p_method_id: methodId,
      p_user_id: userId,
    }).single(),
  deletePayoutMethod: (methodId: string, userId: string) =>
    callRpc('delete_payout_method', {
      p_method_id: methodId,
      p_user_id: userId,
    }).single(),
};

export type { Database };
