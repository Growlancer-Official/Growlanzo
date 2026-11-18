import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Early-access scope guard — the regression net for the launch hardening.
 *
 * Every assertion here corresponds to a defect that was found in this repo, not
 * to a hypothetical. The failure mode these tests exist for is a *silent* one:
 * a deferred module that still answers a direct API call, a public route that
 * returns rows, a cron that charges a card while the product says billing is
 * off. A hidden navigation link is not a disable, so nothing below tests the UI.
 *
 * If a change makes one of these fail, the fix is to restore the guard in the
 * function (or move the module out of DEFAULTS in _shared/features.ts) — not to
 * delete the assertion.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const FEATURES = read('supabase/functions/_shared/features.ts');
const ADMIN_DATA = read('supabase/functions/admin-data/index.ts');
const INTERNSHIPS = read('supabase/functions/internship-applications/index.ts');
const CRON = read('supabase/functions/subscription-billing-cron/index.ts');
const PLATFORM_KYC = read('supabase/migrations/20270404000000_platform_kyc_email_phone.sql');

const FUNCTIONS_DIR = path.join(ROOT, 'supabase/functions');

/** Every edge function entrypoint, by its `<function>/index.ts` path. */
function functionEntrypoints(dir: string = FUNCTIONS_DIR, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) functionEntrypoints(full, out);
    else if (entry.name === 'index.ts' && path.dirname(full) !== FUNCTIONS_DIR) out.push(full);
  }
  return out;
}

describe('deferred modules are fail-closed by default', () => {
  it('defaults every deferred feature to OFF', () => {
    const block = /const DEFAULTS[^=]*=\s*\{([\s\S]*?)\}/.exec(FEATURES);
    expect(block, 'DEFAULTS block not found in _shared/features.ts').not.toBeNull();
    const pairs = [...block![1].matchAll(/(\w+):\s*(true|false)/g)].map((m) => [m[1], m[2]] as const);
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    expect(pairs.filter(([, v]) => v !== 'false').map(([k]) => k)).toEqual([]);
  });

  it('only an exact "true" enables a feature (a typo must never do it)', () => {
    expect(FEATURES).toMatch(/if \(raw === 'true'\) return true;/);
    expect(FEATURES).toMatch(/if \(raw === 'false'\) return false;/);
    expect(FEATURES).toMatch(/return DEFAULTS\[key\];/);
  });

  it('answers 410 Gone with no record data', () => {
    expect(FEATURES).toMatch(/status: 410/);
    expect(FEATURES).toMatch(/available: false/);
  });
});

describe('certificate verification no longer leaks applicant PII', () => {
  it('returns the disabled response instead of reading any row', () => {
    const start = ADMIN_DATA.indexOf('verify_certificate / verify_credential_qr (DEFERRED)');
    const end = ADMIN_DATA.indexOf('send_welcome_email (AUTHENTICATED');
    expect(start, 'deferred-route marker missing').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Strip comments first: the branch's own explanation names the tables it
    // used to read, and a comment must never satisfy or fail a code assertion.
    const branch = ADMIN_DATA.slice(start, end).replace(/\/\/.*$/gm, '');

    expect(branch).toMatch(/featureDisabledResponse\(corsHeaders, 'certificates'\)/);
    // The old handler returned the full row, the raw token and the applicant's
    // internship_applications row. None of those reads may come back.
    expect(branch).not.toMatch(/\.from\(/);
    expect(branch).not.toMatch(/\.select\(/);
    expect(branch).not.toMatch(/internship_applications/);
    expect(branch).not.toMatch(/token:\s*tokenData/);
  });
});

describe('internships are closed at the API, not just in the UI', () => {
  it('rejects every method before the first database read', () => {
    const guard = INTERNSHIPS.indexOf("isFeatureEnabled('internships')");
    const firstRead = INTERNSHIPS.indexOf(".from('internship_applications')");
    expect(guard, 'internships guard missing').toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstRead);
  });

  it('cannot update an application from an email address alone', () => {
    // The reapply path keyed on `.eq('email', email)` and reset status/notes.
    // With the guard above the whole handler is unreachable while deferred.
    expect(INTERNSHIPS).toMatch(/featureDisabledResponse\(corsHeaders, 'internships'\)/);
  });
});

describe('subscription billing cannot charge while deferred', () => {
  const handler = CRON.slice(CRON.indexOf('serve(async (req: Request) => {'));

  it('returns before any gateway charge is attempted', () => {
    const guard = handler.indexOf("isFeatureEnabled('subscription_billing')");
    const charge = handler.indexOf('await attemptRenewalCharge');
    expect(guard, 'billing guard missing').toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(charge);
  });

  it('says explicitly that nothing was charged', () => {
    expect(handler).toMatch(/charged: false/);
    expect(handler).toMatch(/status: 503/);
  });
});

describe('platform KYC has no external provider and no document surface', () => {
  it('issues and verifies a hashed platform code', () => {
    expect(PLATFORM_KYC).toContain('CREATE OR REPLACE FUNCTION public.request_phone_otp(p_phone TEXT)');
    expect(PLATFORM_KYC).toContain('CREATE OR REPLACE FUNCTION public.verify_phone_otp(p_phone TEXT, p_code TEXT)');
    expect(PLATFORM_KYC).toContain("crypt(v_code, gen_salt('bf'))");
    expect(PLATFORM_KYC).toMatch(/interval '10 minutes'/);
    expect(PLATFORM_KYC).toMatch(/interval '60 seconds'/);
  });

  it('is not callable anonymously', () => {
    expect(PLATFORM_KYC).toContain('REVOKE ALL ON FUNCTION public.request_phone_otp(TEXT) FROM PUBLIC, anon;');
    expect(PLATFORM_KYC).toContain('REVOKE ALL ON FUNCTION public.verify_phone_otp(TEXT, TEXT) FROM PUBLIC, anon;');
    expect(PLATFORM_KYC).toContain("IF v_uid IS NULL OR v_role NOT IN ('authenticated', 'service_role')");
  });

  it('collects no document, PAN, Aadhaar or GST data', () => {
    // Strip SQL comments first: the header explains what was removed.
    const code = PLATFORM_KYC.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/document_|aadhaar|gstin|surepass/i);
  });
});

describe('every deferred page is behind a switch in the router', () => {
  it('renders FeatureUnavailablePage whenever its flag is off', () => {
    const APP = read('src/app/App.tsx');
    const gated: Record<string, string> = {
      InternshipsPage: 'INTERNSHIPS_ENABLED',
      AdminInternshipsPage: 'INTERNSHIPS_ENABLED',
      CertificateVerifyPage: 'CERTIFICATES_ENABLED',
      SkillCertificationsPage: 'CERTIFICATES_ENABLED',
      SkillTestPage: 'CERTIFICATES_ENABLED',
      AdminCertificatesPage: 'CERTIFICATES_ENABLED',
      ContestsPage: 'CONTESTS_ENABLED',
      ContestDetailPage: 'CONTESTS_ENABLED',
      ContestsDashboardPage: 'CONTESTS_ENABLED',
      ClientContestsPage: 'CONTESTS_ENABLED',
      ClientContestCreatePage: 'CONTESTS_ENABLED',
    };
    const ungated = Object.entries(gated).filter(
      ([page, flag]) => !APP.includes(`${flag} ? <${page} /> : <FeatureUnavailablePage />`),
    );
    expect(ungated.map(([p]) => p), 'these pages are rendered without a switch').toEqual([]);
  });

  it('does not advertise them in the header, footer or sidebars', () => {
    expect(read('src/layouts/MainLayout.tsx')).toMatch(/isFeatureEnabled\('contests'\)/);
    expect(read('src/layouts/MainLayout.tsx')).toMatch(/isFeatureEnabled\('internships'\)/);
    expect(read('src/components/SiteFooter.tsx')).toMatch(/isFeatureEnabled\('internships'\)/);
    expect(read('src/layouts/DashboardLayout.tsx')).toMatch(/isDeferredRoute/);
    expect(read('src/layouts/ClientDashboardLayout.tsx')).toMatch(/isDeferredRoute/);
    // The admin shell and in-page CTAs advertise the same modules — they are
    // part of the same promise: navigation never links to what is not shipped.
    expect(read('src/layouts/AdminDashboardLayout.tsx')).toMatch(/isDeferredRoute/);
    expect(read('src/layouts/AdminDashboardLayout.tsx')).toMatch(/isFeatureEnabled\('internships'\)/);
    expect(read('src/pages/AboutPage.tsx')).toMatch(/isFeatureEnabled\('internships'\)/);
    expect(read('src/pages/dashboard/OverviewPage.tsx')).toMatch(/isFeatureEnabled\('contests'\)/);
  });
});

describe('subscription charges reserve the billing period first', () => {
  // Billing ships disabled, so this is the guard that makes RE-ENABLING safe.
  const handler = CRON.slice(CRON.indexOf('serve(async (req: Request) => {'));

  it('inserts the UNIQUE(subscription_id, billing_period) row before charging', () => {
    const reserve = handler.indexOf('reserveBillingPeriod(sub.id');
    const charge = handler.indexOf('await attemptRenewalCharge');
    expect(reserve, 'billing ledger is not used').toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(reserve);
    // The helper is defined above the handler, so the 23505 branch is checked on
    // the whole file while the call ORDER is checked inside the handler.
    expect(CRON).toMatch(/error\.code === '23505'/);
    expect(handler).toMatch(/if \(!reservationId\)/);
  });
});

describe('commission model — freelancer-side 5%, no client-side fee', () => {
  // The client pays the agreed amount; the 5% commission is withheld from the
  // freelancer's RELEASED earnings. Asserted on the LATEST definition of each
  // function (timestamped migration names sort in apply order), with line
  // comments stripped, so a later re-creation cannot quietly restore the old
  // "client pays +5% AND freelancer loses 5%" double-take.
  const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const stripSqlComments = (sql: string) =>
    sql
      .split('\n')
      .map((line) => {
        const i = line.indexOf('--');
        return i >= 0 ? line.slice(0, i) : line;
      })
      .join('\n');

  function latestDefining(fn: string): { file: string; sql: string } {
    const defining = migrationFiles.filter((f) =>
      read(`supabase/migrations/${f}`).includes(`FUNCTION public.${fn}(`),
    );
    expect(defining.length, `no migration defines ${fn}`).toBeGreaterThan(0);
    const file = defining[defining.length - 1];
    return { file, sql: stripSqlComments(read(`supabase/migrations/${file}`)) };
  }

  it('release withholds the 5% commission and credits the net amount', () => {
    const { file, sql } = latestDefining('_release_escrow_internal');
    expect(sql, `${file} does not use the canonical commission helper`)
      .toContain('public.platform_commission(v_gross)');
    expect(sql, `${file} payout is not gross minus commission`)
      .toContain('v_net := GREATEST(v_gross - v_fee, 0)');
    expect(sql, `${file} does not credit the net amount`)
      .toContain('balance = balance + v_net');
  });

  it('books gross/fee/net and an invoice for the pool only', () => {
    const { file, sql } = latestDefining('_book_escrow_release');
    expect(sql, `${file} revenue row is not gross/fee/net`).toContain('v_gross, v_fee, v_net');
    expect(sql, `${file} invoice total is not the amount the client paid`)
      .toContain('v_gross, 0, v_net, v_gross');
    expect(sql, `${file} ledger wallet credit is not the net amount`)
      .toContain("'wallet', 'credit', v_net");
  });

  it('invite-created contracts store the net payout and no client fee', () => {
    const { file, sql } = latestDefining('accept_invite_create_contract');
    expect(sql, `${file} still charges the client a fee or stores the gross`)
      .toContain('v_amount, 0, v_net');
  });
});

describe('KYC-driven coin bonuses require a REAL provider (no dev_mode farming)', () => {
  // §3.1 of the launch review: dev-mode auto-verifies every submission, so a
  // referrer could farm the KYC bonus with throwaway accounts. The guard must
  // survive any future re-creation of the award function — asserted on the
  // LATEST definition, comments stripped (the header documents the rule).
  const files = fs
    .readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const defining = files.filter((f) =>
    read(`supabase/migrations/${f}`).includes('FUNCTION public.award_referral_bonus_if_eligible('),
  );
  const file = defining[defining.length - 1];
  const sql = read(`supabase/migrations/${file}`)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');

  it('the latest award function excludes dev_mode and dev-sandbox rows', () => {
    expect(defining.length, 'no migration defines award_referral_bonus_if_eligible').toBeGreaterThan(0);
    expect(sql, `${file} counts dev-mode verifications as real engagement`).toMatch(
      /verification_provider[^;]*NOT IN \('dev_mode', 'dev-sandbox'\)/,
    );
  });
});

describe('webhook functions can build their own CORS headers', () => {
  it('every function that calls getCorsHeaders imports it', () => {
    const offenders: string[] = [];
    for (const file of functionEntrypoints()) {
      const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      if (!/\bgetCorsHeaders\s*\(/.test(text)) continue;
      const importsIt =
        /import\s*\{[^}]*\bgetCorsHeaders\b[^}]*\}\s*from\s*'[^']*cors\.ts'/.test(text) ||
        /(function|const)\s+getCorsHeaders\b/.test(text);
      if (!importsIt) offenders.push(path.relative(ROOT, file));
    }
    // This is exactly the paypal-webhook bug: a ReferenceError thrown on the
    // OPTIONS preflight, before signature verification, for every request.
    expect(offenders, 'these functions call getCorsHeaders without defining/importing it').toEqual([]);
  });
});

describe('deferred modules are switched in one place', () => {
  it('no edge function reads FEATURE_* env directly', () => {
    const offenders = functionEntrypoints()
      .filter((file) => path.basename(path.dirname(file)) !== '_shared')
      .filter((file) => /Deno\.env\.get\(\s*['"`]FEATURE_/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
