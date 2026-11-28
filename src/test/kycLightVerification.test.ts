import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITY_VERIFICATION_ENABLED, KYC_REQUIRED_FOR_ACTIONS } from '../lib/featureFlags';
import { requireKycForAction } from '../lib/kycGate';

/**
 * Verification — Coming Soon for BOTH roles (launch decision, Nov 2026).
 *
 * What this locks:
 *   1. the client flag is OFF and the shared screen is a Coming Soon page with
 *      no form, upload or OTP submission;
 *   2. no dashboard header nags a user to "verify now";
 *   3. the server submission RPCs are revoked from app roles, so a direct API
 *      call cannot start or complete verification;
 *   4. no green "verified" badge exists anywhere — the green badge is the
 *      Premium PRO badge, driven by active subscription state only.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const FREELANCER_SHELL = read('src/layouts/DashboardLayout.tsx');
const CLIENT_SHELL = read('src/layouts/ClientDashboardLayout.tsx');
const PAGE = read('src/pages/dashboard/IdentityVerificationPage.tsx');
const MIGRATION = read('supabase/migrations/20271128000000_launch_referral_caps_custom_project_and_verification.sql');
const PRO_BADGE = read('src/components/ProBadge.tsx');
const PRIVACY = read('src/pages/PrivacyPage.tsx');

describe('verification is Coming Soon for both roles', () => {
  it('the feature flag is off', () => {
    expect(IDENTITY_VERIFICATION_ENABLED).toBe(false);
  });

  it('the shared screen renders Coming Soon and no submission control', () => {
    expect(PAGE).toContain('Coming Soon');
    expect(PAGE).not.toContain("'refresh_light_kyc'");
    expect(PAGE).not.toContain("'request_phone_otp'");
    expect(PAGE).not.toContain("'verify_phone_otp'");
    expect(PAGE).not.toMatch(/type=["']file["']/i);
    expect(PAGE).not.toMatch(/<input/i);
    expect(PAGE).not.toMatch(/<form/i);
    expect(PAGE).not.toMatch(/document_(type|url|file|number)/i);
    // The Coming Soon copy names documents only to say they are NOT collected.
    expect(PAGE).toMatch(/No Aadhaar, PAN, passport/i);
  });

  it('no dashboard prompts a user to verify now', () => {
    expect(FREELANCER_SHELL).not.toContain('VerifyNowHeaderButton');
    expect(CLIENT_SHELL).not.toContain('VerifyNowHeaderButton');
  });

  it('both roles still have a routed Verification entry that shows the section', () => {
    const APP = read('src/app/App.tsx');
    expect(APP).toContain('<Route path="identity-verification" element={<IdentityVerificationPage />} />');
    expect(APP).toContain('<Route path="verification" element={<IdentityVerificationPage />} />');
  });

  it('the money gate remains deliberately off', async () => {
    expect(KYC_REQUIRED_FOR_ACTIONS).toBe(false);
    await expect(requireKycForAction({ id: 'user-1' })).resolves.toMatchObject({
      verified: true,
      status: 'not_required',
    });
  });
});

describe('the server submission surface is closed', () => {
  it('revokes every verification write RPC from app roles', () => {
    for (const signature of [
      'public.refresh_light_kyc(TEXT)',
      'public.request_phone_otp(TEXT)',
      'public.verify_phone_otp(TEXT, TEXT)',
    ]) {
      expect(MIGRATION).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
    }
    expect(MIGRATION).toContain('REVOKE INSERT, UPDATE ON public.identity_verifications FROM authenticated, anon;');
  });

  it('keeps historical rows and never drops the table', () => {
    expect(MIGRATION).not.toMatch(/\bDROP TABLE\b/i);
    expect(MIGRATION).not.toMatch(/\bDELETE FROM public\.identity_verifications\b/i);
    expect(MIGRATION).toContain('Historical rows are retained read-only for audit');
  });

  it('fails the deploy if a submission RPC is still client-callable', () => {
    expect(MIGRATION).toContain("has_function_privilege('authenticated', 'public.refresh_light_kyc(text)', 'EXECUTE')");
    expect(MIGRATION).toContain('verification submission RPC is still callable by clients');
  });
});

describe('the green badge is Premium only', () => {
  it('the old verified badge component is gone and nothing imports it', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/components/VerifiedBadge.tsx'))).toBe(false);
    const grep = fs
      .readdirSync(path.join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !f.startsWith('test'));
    for (const file of grep) {
      const content = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
      expect(content, `${file} still references VerifiedBadge`).not.toContain('VerifiedBadge');
    }
  });

  it('PRO badge shows PRO and is described as subscription-driven', () => {
    expect(PRO_BADGE).toContain('>PRO<');
    expect(PRO_BADGE).toMatch(/active subscription/i);
    expect(PRO_BADGE).toMatch(/never a ranking boost/i);
    expect(PRO_BADGE).not.toContain('Verified on Growlanzo');
    expect(PRO_BADGE).not.toContain('>VERIFIED<');
  });

  it('public privacy copy no longer claims a Verified badge', () => {
    expect(PRIVACY).not.toMatch(/Verified badge means/i);
    expect(PRIVACY).toMatch(/green PRO badge means an active Premium subscription/i);
  });
});
