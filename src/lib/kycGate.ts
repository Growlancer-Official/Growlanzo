import { supabase } from './supabase';
import { KYC_REQUIRED_FOR_ACTIONS } from './featureFlags';

/**
 * Identity gate for CRITICAL actions only (orders, escrow funding, withdrawals).
 *
 * Full KYC is DEFERRED for the Beta (`KYC_VERIFICATION_ENABLED = false` in
 * `lib/featureFlags.ts`) and `KYC_REQUIRED_FOR_ACTIONS` is off, so in this
 * release the function always answers "allowed": no action is gated on identity
 * verification, and no caller is ever told it is verified. Browsing the
 * dashboard is always open regardless.
 *
 * The gate is kept — not deleted — because it is the single seam a future KYC
 * release flips: turning the constant on re-enables the rule with no other
 * change. Server ownership/permission checks never depend on it.
 */
export async function requireKycForAction(
  user: { id: string } | null | undefined
): Promise<{ verified: boolean; kycPath: string; status: string | null }> {
  if (!KYC_REQUIRED_FOR_ACTIONS) {
    return { verified: true, kycPath: '', status: 'not_required' };
  }
  if (!user?.id) {
    return { verified: false, kycPath: '/login', status: null };
  }
  try {
    const { data } = await supabase
      .from('profiles')
      .select('verification_status, role')
      .eq('id', user.id)
      .maybeSingle();
    if (data?.role === 'admin') {
      return { verified: true, kycPath: '', status: 'verified' };
    }
    const status = data?.verification_status || 'none';
    // Role from the DB (single source of truth) decides which screen to send.
    const isClient = (data as any)?.role === 'client';
    const kycPath = isClient ? '/client/verification' : '/dashboard/identity-verification';
    return { verified: status === 'verified', kycPath, status };
  } catch {
    // Fail open on transient errors — never block a real action because of a
    // network blip; the server still enforces ownership checks on every RPC.
    return { verified: true, kycPath: '', status: null };
  }
}
