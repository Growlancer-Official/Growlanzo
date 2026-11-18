#!/usr/bin/env node
/**
 * Early-access scope guard (CLI twin of src/test/mvpScopeGuard.test.ts).
 *
 * Why both: the vitest suite is the developer-facing guard, but a release
 * check must be runnable on its own — `npm run test:mvp-scope` — and must print
 * a human-readable PASS/FAIL per invariant for the release report. Neither is a
 * substitute for the other: this script is what the release manager runs, the
 * test is what CI cannot forget.
 *
 * Exit codes: 0 = every invariant holds, 1 = at least one FAIL.
 * No dependencies, no network, no credentials.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    if (detail === false) throw new Error('assertion returned false');
    results.push({ name, ok: true, detail: typeof detail === 'string' ? detail : '' });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

function functionEntrypoints(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...functionEntrypoints(full));
    else if (entry.name === 'index.ts' && path.basename(path.dirname(full)) !== '_shared') out.push(full);
  }
  return out;
}

const FEATURES = read('supabase/functions/_shared/features.ts');
const ADMIN_DATA = read('supabase/functions/admin-data/index.ts');
const INTERNSHIPS = read('supabase/functions/internship-applications/index.ts');
const CRON = read('supabase/functions/subscription-billing-cron/index.ts');
const PLATFORM_KYC = read('supabase/migrations/20270404000000_platform_kyc_email_phone.sql');
const APP = read('src/app/App.tsx');

check('deferred features default to OFF', () => {
  const block = /const DEFAULTS[^=]*=\s*\{([\s\S]*?)\}/.exec(FEATURES);
  if (!block) throw new Error('DEFAULTS block missing');
  const on = [...block[1].matchAll(/(\w+):\s*(true|false)/g)].filter((m) => m[2] !== 'false');
  if (on.length) throw new Error('enabled by default: ' + on.map((m) => m[1]).join(', '));
  return 'all deferred modules off unless FEATURE_*_ENABLED=true';
});

check('certificate verification returns 410 with no PII', () => {
  const start = ADMIN_DATA.indexOf('verify_certificate / verify_credential_qr (DEFERRED)');
  const end = ADMIN_DATA.indexOf('send_welcome_email (AUTHENTICATED');
  if (start < 0 || end <= start) throw new Error('deferred-route branch not found');
  // Strip comments first: the branch's own explanation names the tables it used
  // to read, and a comment must never satisfy or fail a code assertion.
  const branch = ADMIN_DATA.slice(start, end).replace(/\/\/.*$/gm, '');
  if (/\.from\(|\.select\(|internship_applications|token:\s*tokenData/.test(branch)) {
    throw new Error('the public branch still reads certificate/applicant rows');
  }
  if (!/featureDisabledResponse\(corsHeaders, 'certificates'\)/.test(branch)) {
    throw new Error('410 response missing');
  }
  return 'no record read on the public path';
});

check('internship API is closed before its first DB read', () => {
  const guard = INTERNSHIPS.indexOf("isFeatureEnabled('internships')");
  const readAt = INTERNSHIPS.indexOf(".from('internship_applications')");
  if (guard < 0) throw new Error('guard missing');
  if (readAt < 0 || guard > readAt) throw new Error('guard is after the first read');
  return 'all methods 410; historical rows untouched';
});

check('subscription billing cannot charge while deferred', () => {
  const handler = CRON.slice(CRON.indexOf('serve(async (req: Request) => {'));
  const guard = handler.indexOf("isFeatureEnabled('subscription_billing')");
  const charge = handler.indexOf('await attemptRenewalCharge');
  if (guard < 0) throw new Error('guard missing');
  if (charge < 0 || guard > charge) throw new Error('a charge can be attempted before the guard');
  if (!/charged: false/.test(handler)) throw new Error('response does not state charged:false');
  return 'no gateway call can run while deferred';
});

check('platform KYC issues hashed, rate-limited codes and no external provider', () => {
  if (!/FUNCTION public\.request_phone_otp\(p_phone TEXT\)/.test(PLATFORM_KYC)) {
    throw new Error('request_phone_otp missing');
  }
  if (!/FUNCTION public\.verify_phone_otp\(p_phone TEXT, p_code TEXT\)/.test(PLATFORM_KYC)) {
    throw new Error('verify_phone_otp missing');
  }
  if (!/crypt\(v_code, gen_salt\('bf'\)\)/.test(PLATFORM_KYC)) throw new Error('code not hashed');
  const code = PLATFORM_KYC.replace(/--[^\n]*/g, '');
  if (/surepass|document_url|aadhaar|gstin/i.test(code)) {
    throw new Error('external provider or document surface reappeared');
  }
  return 'platform phone codes: hashed, single-use, rate-limited, no external provider';
});

check('every getCorsHeaders caller imports it', () => {
  const offenders = [];
  for (const file of functionEntrypoints(path.join(ROOT, 'supabase/functions'))) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (!/\bgetCorsHeaders\s*\(/.test(text)) continue;
    const ok =
      /import\s*\{[^}]*\bgetCorsHeaders\b[^}]*\}\s*from\s*'[^']*cors\.ts'/.test(text) ||
      /(function|const)\s+getCorsHeaders\b/.test(text);
    if (!ok) offenders.push(path.relative(ROOT, file));
  }
  if (offenders.length) throw new Error(offenders.join(', '));
  return `${functionEntrypoints(path.join(ROOT, 'supabase/functions')).length} entrypoints checked`;
});

check('every deferred page is behind a switch in the router', () => {
  const gated = {
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
  if (ungated.length) throw new Error(ungated.map(([p]) => p).join(', '));
  return `${Object.keys(gated).length} deferred pages gated`;
});

check('navigation does not advertise deferred modules', () => {
  const MAIN = read('src/layouts/MainLayout.tsx');
  const FOOTER = read('src/components/SiteFooter.tsx');
  const DASH = read('src/layouts/DashboardLayout.tsx');
  const CLIENT_DASH = read('src/layouts/ClientDashboardLayout.tsx');
  const ADMIN = read('src/layouts/AdminDashboardLayout.tsx');
  const ABOUT = read('src/pages/AboutPage.tsx');
  const OVERVIEW = read('src/pages/dashboard/OverviewPage.tsx');
  for (const [name, src, needle] of [
    ['MainLayout contests', MAIN, "isFeatureEnabled('contests')"],
    ['MainLayout internships', MAIN, "isFeatureEnabled('internships')"],
    ['SiteFooter internships', FOOTER, "isFeatureEnabled('internships')"],
    ['DashboardLayout sidebar filter', DASH, 'isDeferredRoute'],
    ['ClientDashboardLayout sidebar filter', CLIENT_DASH, 'isDeferredRoute'],
    ['AdminDashboardLayout sidebar filter', ADMIN, 'isDeferredRoute'],
    ['AdminDashboardLayout mobile bar', ADMIN, "isFeatureEnabled('internships')"],
    ['AboutPage internships CTA', ABOUT, "isFeatureEnabled('internships')"],
    ['OverviewPage contests shortcut', OVERVIEW, "isFeatureEnabled('contests')"],
  ]) {
    if (!src.includes(needle)) throw new Error(`${name} still advertises a deferred module`);
  }
  return 'header, footer, three sidebars, About CTA and dashboard shortcuts filter deferred modules';
});

check('subscription charges reserve the billing period first', () => {
  const handler = CRON.slice(CRON.indexOf('serve(async (req: Request) => {'));
  const reserve = handler.indexOf('reserveBillingPeriod(sub.id');
  const charge = handler.indexOf('await attemptRenewalCharge');
  if (reserve < 0) throw new Error('billing ledger is not used');
  if (charge < 0 || reserve > charge) throw new Error('a charge can happen before the ledger reservation');
  // The helper is defined above the handler, so the 23505 branch is checked on
  // the whole file while the call ORDER is checked inside the handler.
  if (!/error\.code === '23505'/.test(CRON)) throw new Error('duplicate-period detection missing');
  if (!/if \(!reservationId\)/.test(handler)) throw new Error('charge is not skipped when the period is taken');
  return 'UNIQUE(subscription_id, billing_period) blocks a second charge';
});

check('commission is freelancer-side: client pays the pool, freelancer gets pool - 5%', () => {
  // The client checkout must never add a platform fee, and the release path
  // must withhold exactly the 5% commission from the freelancer. Asserted on
  // the LATEST definition of each function (timestamped names sort in apply
  // order), with line comments stripped so a migration header that documents
  // the old model is never mistaken for the implementation.
  const dir = path.join(ROOT, 'supabase/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const strip = (sql) => sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');
  const latest = (fn) => {
    const hits = files.filter((f) => read('supabase/migrations/' + f).includes('FUNCTION public.' + fn + '('));
    if (!hits.length) throw new Error('no migration defines ' + fn);
    const f = hits[hits.length - 1];
    return { f, sql: strip(read('supabase/migrations/' + f)) };
  };
  const need = (hay, needle, msg) => {
    if (!hay.includes(needle)) throw new Error(msg);
  };

  const rel = latest('_release_escrow_internal');
  need(rel.sql, 'public.platform_commission(v_gross)', rel.f + ' does not apply the canonical 5% commission at release');
  need(rel.sql, 'v_net := GREATEST(v_gross - v_fee, 0)', rel.f + ' payout is not pool minus commission');
  need(rel.sql, 'balance = balance + v_net', rel.f + ' does not credit the net amount');

  const book = latest('_book_escrow_release');
  need(book.sql, 'v_gross, v_fee, v_net', book.f + ' revenue row is not gross/fee/net');
  need(book.sql, 'v_gross, 0, v_net, v_gross', book.f + ' invoice total is not what the client paid');
  need(book.sql, "'wallet', 'credit', v_net", book.f + ' ledger wallet credit is not the net amount');

  const invite = latest('accept_invite_create_contract');
  need(invite.sql, 'v_amount, 0, v_net', invite.f + ' stores a client-paid fee or the gross as the payout');

  const rz = read('supabase/functions/razorpay/index.ts');
  if (rz.includes('fundingAmount + fee')) throw new Error('razorpay checkout adds a platform fee on top');
  return 'client pays the pool; release credits pool - 5%; invoice.total = pool';
});

check('KYC coin bonuses ignore dev-mode verifications', () => {
  const dir = path.join(ROOT, 'supabase/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const hits = files.filter((f) =>
    read(`supabase/migrations/${f}`).includes('FUNCTION public.award_referral_bonus_if_eligible('),
  );
  if (!hits.length) throw new Error('no migration defines award_referral_bonus_if_eligible');
  const f = hits[hits.length - 1];
  const sql = read(`supabase/migrations/${f}`)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
  if (!/verification_provider[^;]*NOT IN \('dev_mode', 'dev-sandbox'\)/.test(sql)) {
    throw new Error(`${f} counts dev-mode verifications as real engagement (referral farming)`);
  }
  return `${f} excludes dev_mode rows from KYC bonuses`;
});

check('the scope decision is documented', () => {
  if (!exists('docs/MVP-SCOPE-AND-E2E-TEST-PLAN.md')) throw new Error('MVP scope doc missing');
  return 'docs/MVP-SCOPE-AND-E2E-TEST-PLAN.md present';
});

const width = Math.max(...results.map((r) => r.name.length));
console.log('\nGrowlanzo early-access scope guard\n');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} invariants hold.`);
if (failed) {
  console.log('\nA FAIL here means a deferred module is still reachable. Fix the guard, not the check.\n');
  process.exit(1);
}
console.log('Scope guard: PASS\n');
