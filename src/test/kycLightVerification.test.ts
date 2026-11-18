import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITY_VERIFICATION_ENABLED, KYC_REQUIRED_FOR_ACTIONS } from '../lib/featureFlags';
import { requireKycForAction } from '../lib/kycGate';

/**
 * Identity verification — contract for the LIGHT three-criteria flow.
 *
 * Founder decision (Oct 2026): as an early-stage startup verification is name +
 * confirmed email + confirmed phone, for BOTH roles, and nothing else. The old
 * document/PAN/GST/business path is gone and must not come back by accident.
 *
 * What this locks:
 *   1. the feature is ON and both roles have an entry point (sidebar + header
 *      chip) and a routed screen;
 *   2. the money gate is off on purpose while the SMS provider is unconfigured —
 *      the one constant a founder flips after wiring Twilio;
 *   3. the screen collects exactly three things and never claims a verification
 *      the server did not derive from the auth record;
 *   4. the database function refuses anonymous callers, reads the truth from
 *      auth.users, and is the only writer of verification_status.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const FREELANCER_SHELL = read('src/layouts/DashboardLayout.tsx');
const CLIENT_SHELL = read('src/layouts/ClientDashboardLayout.tsx');
const APP = read('src/app/App.tsx');
const PAGE = read('src/pages/dashboard/IdentityVerificationPage.tsx');
const GATE = read('src/lib/kycGate.ts');
const MIGRATION = read('supabase/migrations/20270210000000_light_kyc_three_criteria.sql');

describe('light KYC is live for both roles', () => {
  it('the feature flag is on', () => {
    expect(IDENTITY_VERIFICATION_ENABLED).toBe(true);
  });

  it('both dashboard shells link to their verification screen', () => {
    expect(FREELANCER_SHELL).toContain("path: '/dashboard/identity-verification'");
    expect(CLIENT_SHELL).toContain("path: '/client/verification'");
  });

  it('both dashboards show the realtime Verify Now chip', () => {
    expect(FREELANCER_SHELL).toContain('<VerifyNowHeaderButton');
    expect(CLIENT_SHELL).toContain('<VerifyNowHeaderButton');
  });

  it('both paths render the shared screen instead of redirecting away', () => {
    expect(APP).toContain('<Route path="identity-verification" element={<IdentityVerificationPage />} />');
    expect(APP).toContain('<Route path="verification" element={<IdentityVerificationPage />} />');
    expect(APP).not.toMatch(
      /<Route path="(identity-verification|verification)" element=\{<Navigate/
    );
  });

  it('the section header names the screen "Verification" for both roles', async () => {
    const { resolveDashboardSection } = await import('../lib/dashboardSection');
    expect(resolveDashboardSection('/dashboard/identity-verification')).toBe('Verification');
    expect(resolveDashboardSection('/client/verification')).toBe('Verification');
  });
});

describe('the money gate is deliberately off until SMS is configured', () => {
  it('records the intent in one named constant', () => {
    expect(KYC_REQUIRED_FOR_ACTIONS).toBe(false);
    expect(GATE).toContain('KYC_REQUIRED_FOR_ACTIONS');
  });

  it('opens critical actions while the gate is off, and says why', async () => {
    await expect(requireKycForAction({ id: 'user-1' })).resolves.toMatchObject({
      verified: true,
      status: 'not_required',
    });
    await expect(requireKycForAction(null)).resolves.toMatchObject({ verified: true });
  });
});

describe('the screen collects exactly name, email and phone', () => {
  it('drives the three criteria from the platform records', () => {
    expect(PAGE).toContain('email_confirmed_at');
    expect(PAGE).toContain("'refresh_light_kyc'");
    // Phone is confirmed by a PLATFORM one-time code — no external SMS provider.
    expect(PAGE).toContain("'request_phone_otp'");
    expect(PAGE).toContain("'verify_phone_otp'");
    expect(PAGE).not.toContain("supabase.auth.verifyOtp");
    expect(PAGE).not.toContain("supabase.auth.updateUser({ phone:");
  });

  it('never writes verification_status itself — the server derives it', () => {
    expect(PAGE).toContain("(supabase.rpc as any)('refresh_light_kyc'");
    expect(PAGE).not.toMatch(/from\('profiles'\)[\s\S]{0,200}verification_status\s*:/);
    expect(PAGE).not.toMatch(/verification_status:\s*'verified'/);
  });

  it('is realtime: auth listener + profiles subscription + focus refresh', () => {
    expect(PAGE).toContain('onAuthStateChange');
    expect(PAGE).toContain('realtimeChannels');
    expect(PAGE).toContain("addEventListener('focus'");
  });

  it('the platform KYC migration is server-authoritative and hashed', () => {
    const MIG = read('supabase/migrations/20270404000000_platform_kyc_email_phone.sql');
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.request_phone_otp(p_phone TEXT)');
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.verify_phone_otp(p_phone TEXT, p_code TEXT)');
    expect(MIG).toContain("crypt(v_code, gen_salt('bf'))");
    expect(MIG).toContain('REVOKE ALL ON FUNCTION public.request_phone_otp(TEXT) FROM PUBLIC, anon;');
    expect(MIG).toContain('REVOKE ALL ON FUNCTION public.verify_phone_otp(TEXT, TEXT) FROM PUBLIC, anon;');
    // The platform phone counts as the phone criterion without an external provider.
    expect(MIG).toContain('v_platform_phone_at IS NOT NULL');
  });

  it('carries no document, tax-ID or business-registration surface', () => {
    const forbidden = [
      /document_(type|url|file|number)/i,
      /type=["']file["']/i,
      /pan_?(number|card)/i,
      /\bpan\b/i,
      /gst(in)?_?number/i,
      /\bgstin?\b/i,
      /aadhaar/i,
      /udyam/i,
      /business_pan/i,
      /company_name/i,
    ];
    for (const pattern of forbidden) {
      expect(PAGE, `verification page still mentions ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('the database function is the only writer', () => {
  it('exists with the expected signature and grants', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.refresh_light_kyc(p_full_name TEXT DEFAULT NULL)');
    expect(MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.refresh_light_kyc(TEXT) FROM PUBLIC, anon;'
    );
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.refresh_light_kyc(TEXT) TO authenticated, service_role;'
    );
  });

  it('reads the truth from auth.users, not from a parameter', () => {
    expect(MIGRATION).toContain('u.email_confirmed_at');
    expect(MIGRATION).toContain('u.phone_confirmed_at');
    // A caller cannot hand in a "verified" claim.
    expect(MIGRATION).not.toMatch(/p_(status|verified|verification_status)/);
    expect(MIGRATION).toContain("IF v_uid IS NULL OR v_role NOT IN ('authenticated', 'service_role')");
  });

  it('bypasses the self-modification trigger only inside the definer function', () => {
    expect(MIGRATION).toContain("set_config('app.bypass_privilege_check', 'true', true)");
    // …and the same file has no other table-level bypass.
    const bypasses = MIGRATION.match(/set_config\('app\.bypass_privilege_check', 'true'/g) || [];
    expect(bypasses).toHaveLength(1);
  });

  it('never downgrades an identity an admin already reviewed', () => {
    expect(MIGRATION).toContain(
      "verification_status = CASE WHEN v_complete THEN 'verified' ELSE verification_status END"
    );
  });
});
