/**
 * Guards for the two things that must never silently regress:
 *
 *  1. The MONEY MODEL — client pays the agreed amount, the freelancer's 5 %
 *     commission is withheld at release. Every checkout path and the SQL
 *     release path have to agree, or the platform double-charges again.
 *  2. The PAYMENT SECURITY fixes — payout-webhook signature verification, the
 *     server-side PayPal kill switch, the disabled direct-refund endpoint and
 *     the reviews write path.
 *
 * These are file-level contract tests on purpose: the money/security code is
 * Deno + plpgsql, which vitest cannot execute, but a drifted string is exactly
 * how the original defects came back.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

const COMMISSION_MIGRATION = 'supabase/migrations/20270203000000_commission_freelancer_side.sql';
const REVIEWS_MIGRATION = 'supabase/migrations/20270203100000_reviews_write_path_hardening.sql';
const WITHDRAWAL_MIGRATION = 'supabase/migrations/20270206000000_secure_withdrawal_finalization.sql';

describe('commission model — freelancer-side 5%', () => {
  it('the canonical migration exists and defines one commission helper', () => {
    const sql = read(COMMISSION_MIGRATION);
    expect(sql).toContain('FUNCTION public.platform_commission(p_amount NUMERIC)');
    expect(sql).toContain('ROUND(p_amount * 0.05, 2)');
  });

  it('the release payout uses the helper (5% withheld from the freelancer)', () => {
    const sql = read(COMMISSION_MIGRATION);
    const release = sql.slice(
      sql.indexOf('FUNCTION public._release_escrow_internal'),
      sql.indexOf('FUNCTION public._book_escrow_release'),
    );
    expect(release).toContain('public.platform_commission(v_gross)');
    expect(release).toContain('v_net := GREATEST(v_gross - v_fee, 0)');
    expect(release).toContain('balance = balance + v_net');
  });

  it('the invoice bills exactly the pool (client is never charged a fee)', () => {
    const sql = read(COMMISSION_MIGRATION);
    const booking = sql.slice(sql.indexOf('FUNCTION public._book_escrow_release'));
    expect(booking).toContain('v_gross, 0, v_net, v_gross');
    expect(booking).toContain("'platform_revenue', 'credit', v_fee");
    expect(booking).toContain("'wallet', 'credit', v_net");
  });

  it('wallet funding debits the pool only', () => {
    const sql = read(COMMISSION_MIGRATION);
    const fn = sql.slice(sql.indexOf('FUNCTION public.fund_escrow_from_wallet'));
    expect(fn).not.toContain('v_funding_amount + v_fee');
    expect(fn).toContain('balance = balance - v_funding_amount');
    expect(fn).toContain("'platform_fee', 0");
  });

  const checkouts: Array<[string, string[]]> = [
    ['supabase/functions/razorpay/index.ts', ['fundingAmount + fee', 'pool + fee', 'effectivePrice + tipAmount + platformFee']],
    ['supabase/functions/paypal/index.ts', ['pool + fee']],
  ];

  for (const [file, forbidden] of checkouts) {
    it(`${file} adds no commission at checkout`, () => {
      const src = read(file);
      for (const needle of forbidden) {
        expect(src).not.toContain(needle);
      }
    });
  }

  it('no public page claims the client pays the 5% or the freelancer keeps 100%', () => {
    const pages = [
      'src/pages/PricingPage.tsx',
      'src/pages/HomePage.tsx',
      'src/pages/TermsPage.tsx',
      'src/pages/EscrowPolicyPage.tsx',
      'src/pages/ServiceDetailPage.tsx',
      'src/pages/ClientTeamProjectDetailPage.tsx',
      'src/pages/dashboard/ContractsPage.tsx',
      'src/pages/dashboard/WorkspacePage.tsx',
      'src/pages/dashboard/CreateServicePage.tsx',
      'src/lib/supportTopics.ts',
    ].map(read).join('\n');

    expect(pages).not.toContain('100% To Freelancer');
    expect(pages).not.toContain('100% of the project amount');
    expect(pages).not.toContain('100% of the package price');
    expect(pages).not.toContain('5% platform fee is charged on each successful payment');
    expect(pages).not.toContain('paid by the client, never from your earnings');
    expect(pages).not.toContain('100% of your contract value goes to your wallet');
    expect(pages).not.toContain('you receive 100% of the package price');
    expect(pages).not.toContain('The 5% platform fee is paid by the client');
    expect(pages).not.toContain('total: amount + commission');
  });
});

describe('payout webhook signature', () => {
  const src = read('supabase/functions/razorpay-payout-webhook/index.ts');

  it('imports the HMAC key for signing (not verify) so sign() cannot throw', () => {
    expect(src).toContain("['sign']");
    expect(src).not.toContain("['verify']");
  });

  it('verifies the raw body bytes and compares in constant time', () => {
    expect(src).toContain('await req.text()');
    expect(src).toContain('signature.length !== expectedSig.length');
    expect(src).toContain('diff |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i)');
  });

  it('fails closed when no secret is configured', () => {
    expect(src).toContain('Payout webhook secret is not configured');
  });
});

describe('paypal is server-disabled by default', () => {
  it('the gate only enables on the exact string "true"', () => {
    const gate = read('supabase/functions/_shared/paypalGate.ts');
    expect(gate).toContain("Deno.env.get('PAYPAL_ENABLED') === 'true'");
    expect(gate).not.toContain('|| true');
  });

  for (const fn of ['supabase/functions/paypal/index.ts', 'supabase/functions/paypal-webhook/index.ts']) {
    it(`${fn} refuses before any side effect`, () => {
      const src = read(fn);
      expect(src).toContain('isPaypalEnabled()');
      expect(src).toContain('paypalDisabledResponse(corsHeaders)');
    });
  }
});

describe('direct refund endpoint is disabled', () => {
  it('refund_payment never calls the provider anymore', () => {
    const src = read('supabase/functions/razorpay/index.ts');
    const start = src.indexOf("case 'refund_payment'");
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('case \'', start + 10);
    const block = src.slice(start, next > -1 ? next : start + 4000);
    expect(block).not.toContain("razorpayFetch('/refunds'");
    expect(block).toContain('refunds_require_request');
  });
});

describe('withdrawal finalization boundary', () => {
  const sql = read(WITHDRAWAL_MIGRATION);
  const withdrawal = read('supabase/functions/withdrawal/index.ts');
  const payoutWebhook = read('supabase/functions/razorpay-payout-webhook/index.ts');

  it('revokes browser access and checks service-role context for terminal RPCs', () => {
    expect(sql).toContain('public.process_withdrawal_complete(UUID) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('public.process_withdrawal_failure(UUID, TEXT) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.process_withdrawal_complete(UUID) TO service_role');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.process_withdrawal_failure(UUID, TEXT) TO service_role');
    expect(sql.match(/public\.is_service_role_context\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('uses locked, idempotent atomic terminal transitions for completion and failure', () => {
    expect(sql.match(/FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("IF v_withdrawal.status = 'completed' THEN");
    expect(sql).toContain("IF v_withdrawal.status = 'failed' THEN");
    expect(sql).toContain('pending_balance = pending_balance - v_withdrawal.amount');
    expect(sql).toContain('balance = balance + v_withdrawal.amount');
    expect(sql).toContain("metadata->>'withdrawal_id' = p_withdrawal_id::text");
  });

  it('checks finalizer results and never refunds locally after provider acceptance', () => {
    expect(withdrawal).toContain('async function finalizeProviderWithdrawal(');
    expect(withdrawal).toContain('checkRateLimit(supabaseAdmin, identifier)');
    expect(withdrawal).toContain(`supabaseAdmin.rpc('${['process', 'withdrawal', 'failure'].join('_')}'`);
    expect(withdrawal).toContain('if (result.error || !result.data?.success)');
    expect(withdrawal).toContain('reconciliation_required: true');
    expect(withdrawal).toContain('if (providerPayoutId && errorMsg.includes(\'reconciliation required\'))');
    expect(payoutWebhook).toContain(`supabaseClient.rpc('${['process', 'withdrawal', 'complete'].join('_')}'`);
    expect(payoutWebhook).toContain(`supabaseClient.rpc('${['process', 'withdrawal', 'failure'].join('_')}'`);
    expect(payoutWebhook).not.toContain(`supabaseClient.rpc('${['release', 'wallet', 'funds'].join('_')}'`);
    for (const paymentFunction of ['supabase/functions/razorpay/index.ts', 'supabase/functions/paypal/index.ts']) {
      const source = read(paymentFunction);
      const rateLimitRpc = ['increment', 'rate', 'limit'].join('_');
      expect(source).toContain(`supabaseAdmin.rpc('${rateLimitRpc}'`);
      expect(source).not.toContain(".from('rate_limits').insert");
    }
  });
});

describe('reviews write path', () => {
  const sql = read(REVIEWS_MIGRATION);

  it('drops the direct authenticated INSERT/UPDATE policies', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Users can insert own reviews"');
    expect(sql).toContain('DROP POLICY IF EXISTS "Users can update own reviews"');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON public.reviews FROM authenticated, anon');
  });

  it('enforces one review per reviewer per contract', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_reviewer_per_contract');
    expect(sql).toContain('(reviewer_id, contract_id)');
    expect(sql).toContain('WHERE contract_id IS NOT NULL');
  });

  it('archives duplicates instead of deleting evidence silently', () => {
    expect(sql).toContain('reviews_duplicate_archive');
  });
});

describe('money endpoints fail closed when the rate limiter is unavailable', () => {
  for (const fn of ['supabase/functions/razorpay/index.ts', 'supabase/functions/paypal/index.ts']) {
    it(`${fn} refuses instead of allowing unlimited attempts on a limiter error`, () => {
      const src = read(fn);
      const start = src.indexOf('async function checkRateLimit');
      expect(start, 'rate limiter helper missing').toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf('\n}', start));
      expect(block).not.toContain('if (error) return true');
      expect(block).toContain('fail closed');
    });
  }
});

describe('reviews writes go through the edge function, not the browser', () => {
  const src = read('supabase/functions/reviews/index.ts');

  it('creates a service-role client for review writes', () => {
    expect(src).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(src).toContain('const supabaseAdmin = createClient(');
  });

  it('no review write is issued with the caller client', () => {
    expect(src).not.toMatch(/supabaseClient\s*\r?\n\s*\.from\('reviews'\)/);
  });
});
