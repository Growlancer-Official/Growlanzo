import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for the founder's spam-protection rule: one account may invite at most
// FIVE people per calendar month. The database is the authority; this test makes
// sure the rule cannot silently disappear from a future re-declaration of
// process_referral (it has been rewritten four times already) and that the
// invite card does not advertise a different number.

const MIGRATION = resolve(
  __dirname,
  '../../supabase/migrations/20270401000000_referral_monthly_invite_cap.sql'
);
const CARD = resolve(__dirname, '../components/ReferralInviteCard.tsx');

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

function stripTsComments(ts: string): string {
  return ts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('referral monthly invite cap', () => {
  const sql = stripSqlComments(readFileSync(MIGRATION, 'utf8'));
  const card = stripTsComments(readFileSync(CARD, 'utf8'));

  it('exposes the limit as one five-invite constant', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.referral_monthly_invite_cap\(\)[\s\S]*?SELECT 5/
    );
  });

  it('counts referrals in the current calendar month', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.referral_invites_this_month/);
    expect(sql).toContain("date_trunc('month', now())");
    expect(sql).toMatch(/WHERE referrer_id = p_user_id/);
  });

  it('rejects the sixth invitation before the referral row is written', () => {
    const guard = sql.indexOf("'monthly_cap'");
    const insert = sql.indexOf('INSERT INTO public.referrals');

    expect(guard).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    // Order matters: a post-insert check would still record the row.
    expect(guard).toBeLessThan(insert);
    expect(sql).toContain('v_invites_this_month >= v_invite_cap');
  });

  it('keeps the existing referral gates intact', () => {
    expect(sql).toContain("'error_code', 'role_mismatch'");
    expect(sql).toContain("'User already referred'");
    expect(sql).toContain("IF p_new_user_id IS DISTINCT FROM auth.uid()");
  });

  it('does not let an anonymous caller reach the referral writer', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.process_referral\(text, uuid, text\) TO authenticated, service_role/
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.process_referral[^;]*\banon\b/);
  });

  it('shows the same limit on the invite card', () => {
    expect(card).toMatch(/MONTHLY_INVITE_CAP\s*=\s*5/);
    expect(card).toContain('{MONTHLY_INVITE_CAP} new people per month');
  });
});
