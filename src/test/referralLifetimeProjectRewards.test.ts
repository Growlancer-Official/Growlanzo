import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20270302000000_referral_lifetime_project_rewards.sql';

function readMigration(): string {
  return readFileSync(path.join(process.cwd(), MIGRATION), 'utf8');
}

describe('lifetime referral project rewards', () => {
  const sql = readMigration();

  it('creates an auditable per-contract reward event table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.referral_project_reward_events');
    // Idempotency: a contract can pay each recipient at most once.
    expect(sql).toMatch(/CONSTRAINT referral_project_reward_once UNIQUE \(contract_id, recipient_id\)/);
    expect(sql).toContain('ALTER TABLE public.referral_project_reward_events ENABLE ROW LEVEL SECURITY');
  });

  it('awards 5 coins to each side of the referral, with no lifetime cap', () => {
    expect(sql).toContain('v_coins constant integer := 5;');
    expect(sql).toContain("'role', 'referred'");
    expect(sql).toContain("'role', 'referrer'");
    expect(sql).toContain("'referral_project_reward'");
    // No "first project only" gate inside the new reward function itself.
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.award_referral_project_reward');
    const fnEnd = sql.indexOf('REVOKE ALL ON FUNCTION public.award_referral_project_reward', fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    const awardFunctionBody = sql.slice(fnStart, fnEnd);
    expect(awardFunctionBody).not.toContain('first_project_bonus');
    expect(awardFunctionBody).not.toContain('bonus_claimed');
  });

  it('only rewards contracts that are completed and payment-settled', () => {
    expect(sql).toContain("IF v_contract.status IS DISTINCT FROM 'completed' THEN");
    expect(sql).toContain("RETURN jsonb_build_object('success', false, 'reason', 'payment_not_settled');");
    expect(sql).toContain('AND t.status = ' + "'completed'");
    expect(sql).toContain('AND t.type IN (' + "'payment', 'fee')");
    expect(sql).toContain('IF NOT COALESCE(v_contract.escrow_funded, false) THEN');
  });

  it('wires the award into the contract completion trigger', () => {
    expect(sql).toContain('PERFORM public.award_referral_project_reward(NEW.id);');
    expect(sql).toMatch(/WHEN \(NEW\.status = 'completed' AND OLD\.status IS DISTINCT FROM NEW\.status\)/);
  });

  it('is service-role only and not callable by users', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.award_referral_project_reward(uuid) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.award_referral_project_reward(uuid) TO service_role;'
    );
  });

  it('keeps coins non-withdrawable by closing the cash redemption RPC', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.redeem_grow_coins_for_cash');
    expect(sql).toContain("'code', 'coming_soon'");
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.redeem_grow_coins_for_cash(integer, uuid) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('gives admins an audited reversal path that requires a reason', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.admin_reverse_referral_project_reward');
    expect(sql).toMatch(/IF NOT COALESCE\(v_is_admin, false\) THEN/);
    expect(sql).toContain("'A reversal reason is required'");
    expect(sql).toContain('SET status = ' + "'reversed'");
  });

  it('adds RLS to internal tables that previously had none', () => {
    for (const table of ['credential_audit_logs', 'credential_version_history', 'reviews_duplicate_archive']) {
      expect(sql).toContain(`ALTER TABLE IF EXISTS public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it('is additive only - no destructive statements', () => {
    expect(sql).not.toMatch(/\bDROP TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP COLUMN\b/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });
});
