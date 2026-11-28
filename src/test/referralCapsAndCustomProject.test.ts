import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GROW_COIN,
  REFERRAL_MONTHLY_CAP,
  monthlyReferralCapFor,
  CUSTOM_PROJECT_REWARD_COST,
} from '../lib/growCoins';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase/migrations/20271128000000_launch_referral_caps_custom_project_and_verification.sql');
const FREELANCER_PAGE = read('src/pages/ReferralsPage.tsx');
const CLIENT_PAGE = read('src/pages/ClientReferralsPage.tsx');
const POST_PAGE = read('src/pages/ClientPostProjectPage.tsx');

describe('monthly referral earning caps', () => {
  it('uses 199 for freelancers and 100 for clients in the shared mirror', () => {
    expect(REFERRAL_MONTHLY_CAP).toEqual({ freelancer: 199, client: 100 });
    expect(monthlyReferralCapFor('freelancer')).toBe(199);
    expect(monthlyReferralCapFor('admin')).toBe(199);
    expect(monthlyReferralCapFor('client')).toBe(100);
    // Hiding the cap in the UI is not enough — it is readable and enforced.
    expect(FREELANCER_PAGE).toContain('monthlyReferralCapFor');
    expect(CLIENT_PAGE).toContain('monthlyReferralCapFor');
  });

  it('computes the cap from the current calendar month on the server', () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.referral_monthly_earning_cap/);
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.referral_coins_earned_this_month/);
    expect(MIGRATION).toContain("date_trunc('month', now())");
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.referral_remaining_monthly_cap');
    expect(MIGRATION).toContain('THEN 100');
    expect(MIGRATION).toContain('ELSE 199');
  });

  it('enforces the cap in BOTH award paths, not just the UI', () => {
    const kycAward = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.award_referral_bonus_if_eligible'),
      MIGRATION.indexOf('REVOKE ALL ON FUNCTION public.award_referral_bonus_if_eligible')
    );
    const projectAward = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.award_referral_project_reward'),
      MIGRATION.indexOf('REVOKE ALL ON FUNCTION public.award_referral_project_reward')
    );
    for (const body of [kycAward, projectAward]) {
      expect(body).toContain('referral_remaining_monthly_cap');
      expect(body).toContain('monthly_earning_cap');
      expect(body).toContain('LEAST(');
    }
    // The referee keeps their own reward even when the referrer is capped.
    expect(projectAward).toContain("'role', 'referred'");
    expect(kycAward).toContain("'role', 'referred'");
  });

  it('removes the old five-invitation restriction entirely', () => {
    expect(MIGRATION).toMatch(/DROP TRIGGER IF EXISTS trg_enforce_referral_monthly_cap/);
    expect(MIGRATION).toMatch(/DROP FUNCTION IF EXISTS public\.enforce_referral_monthly_cap/);
    // The retired limit is neutralised for any stale caller; it is no longer 5.
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.referral_monthly_invite_cap\(\)[\s\S]*?SELECT 1000000/);
    // The replaced process_referral must not reference the retired cap.
    const proc = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.process_referral'),
      MIGRATION.indexOf('REVOKE ALL ON FUNCTION public.process_referral')
    );
    expect(proc).not.toContain('invite_cap');
    expect(proc).not.toContain('v_invites_this_month');
    expect(proc).not.toContain('referral_monthly_invite_cap');
    expect(proc).toContain("'User already referred'");
    expect(proc).toContain("'error_code', 'role_mismatch'");
  });
});

describe('client custom-project reward', () => {
  it('costs exactly 100 coins and is one-shot', () => {
    expect(CUSTOM_PROJECT_REWARD_COST).toBe(100);
    expect(GROW_COIN.customProjectCost).toBe(100);
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.custom_project_rewards/);
    expect(MIGRATION).toContain("status IN ('unused', 'used')");
    expect(MIGRATION).toMatch(/uq_custom_project_reward_unused/);
    expect(MIGRATION).toMatch(/uq_custom_project_reward_idempotency/);
  });

  it('redeems atomically and refuses duplicate/no-balance claims', () => {
    const redeem = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.redeem_grow_coins_for_custom_project'),
      MIGRATION.indexOf('REVOKE ALL ON FUNCTION public.redeem_grow_coins_for_custom_project')
    );
    expect(redeem).toContain('v_cost constant integer := 100');
    expect(redeem).toContain("'redemption_custom_project'");
    expect(redeem).toContain('FOR UPDATE');
    expect(redeem).toContain("You already have an unused custom project reward");
    expect(redeem).toContain('Insufficient Grow Coins');
    expect(redeem).toContain("v_role IS DISTINCT FROM 'client'");
  });

  it('creates the project and consumes the credit in one transaction', () => {
    const create = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.create_custom_project_with_reward'),
      MIGRATION.indexOf('REVOKE ALL ON FUNCTION public.create_custom_project_with_reward')
    );
    expect(create).toContain('FOR UPDATE');
    expect(create).toContain('INSERT INTO public.projects');
    expect(create).toContain("status = 'used', project_id = v_project_id");
    expect(create).toContain("No custom project reward available");
    // No client-supplied coin count or client id is trusted.
    expect(create).not.toMatch(/p_client_id|p_coins/);
    expect(POST_PAGE).toContain('createCustomProjectWithReward');
  });

  it('is wired to the real project posting workflow, not a fake success', () => {
    expect(CLIENT_PAGE).toContain('<CustomProjectRewardCard');
    expect(POST_PAGE).toContain("searchParams.get('custom') === '1'");
    expect(POST_PAGE).toContain('projects');
  });

  it('keeps the ledger auditable and client-write-free', () => {
    expect(MIGRATION).toContain("'redemption_custom_project'");
    expect(MIGRATION).toContain('ALTER TABLE public.custom_project_rewards ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION).toContain('GRANT SELECT ON TABLE public.custom_project_rewards TO authenticated');
    expect(MIGRATION).not.toMatch(/GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.custom_project_rewards TO authenticated/);
  });
});

describe('premium redemption contract stays intact', () => {
  it('199-coin Premium redemption still points at the existing RPC', () => {
    expect(GROW_COIN.premiumCost).toBe(199);
    expect(FREELANCER_PAGE).toContain('redeemGrowCoinsForPremium');
  });
});
