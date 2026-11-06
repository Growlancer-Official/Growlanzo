#!/usr/bin/env node
/**
 * Growlanzo — founder launch pre-flight (READ-ONLY).
 *
 * Answers one question: "what is left before real money can move?"
 *
 * Run:  node scripts/founder-preflight.mjs
 *       node scripts/founder-preflight.mjs --strict   # exit 1 if a blocker remains
 *
 * SECURITY NOTES (why this file is written the way it is):
 *   * It never prints a secret value. Only names and ✅/❌/⚠️ verdicts.
 *   * It never prints secret DIGESTS either. `supabase secrets list` returns a
 *     sha256 of each value, and a digest of a low-entropy value ("true") is
 *     trivially reversible — printing them would leak the secret. Digests are
 *     used internally, only to VERIFY a value against a candidate set.
 *   * Every network call is a read (REST GET, secrets list). Nothing is written
 *     to the database, no migrations, no deploys.
 *   * Nothing here is wired into CI on purpose: it needs production credentials
 *     and a human reading the output.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'zttwsjehcgaicziqyxpq';
const STRICT = process.argv.includes('--strict');
const rel = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(rel(p), 'utf8').replace(/\r\n/g, '\n');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ─── output helpers ─────────────────────────────────────────────────────────

const blockers = [];
const warnings = [];

const ok = (msg, detail = '') => console.log(`  ✅ ${msg}${detail ? ` — ${detail}` : ''}`);
const warn = (msg, detail = '') => {
  warnings.push(msg);
  console.log(`  ⚠️  ${msg}${detail ? ` — ${detail}` : ''}`);
};
const bad = (msg, detail = '') => {
  blockers.push(msg);
  console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg) => console.log(`     ${msg}`);
const section = (title) => console.log(`\n${title}\n${'─'.repeat(title.length)}`);

// ─── local env files (names only) ───────────────────────────────────────────

/**
 * Parse the gitignored env files into a map. Values stay in memory to make the
 * read-only HTTP calls below; they are never logged.
 */
function loadLocalEnv() {
  const files = ['.env', '.env.local', '.env.e2e'];
  const env = {};
  for (const file of files) {
    if (!existsSync(rel(file))) continue;
    for (const line of read(file).split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const localEnv = loadLocalEnv();

// ─── 1. edge-function secret inventory ──────────────────────────────────────

/** Every secret NAME the edge functions read, derived from the code itself. */
function codeSecretNames() {
  const names = new Set();
  const dir = 'supabase/functions';
  const walk = (d) => {
    for (const entry of readdirSync(rel(d), { withFileTypes: true })) {
      const p = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts')) {
        const content = read(p);
        for (const m of content.matchAll(/Deno\.env\.get\(\s*'([A-Z0-9_]+)'\s*\)/g)) names.add(m[1]);
      }
    }
  };
  walk(dir);
  return [...names].sort();
}

const AUTO_PROVIDED = new Set([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_JWKS',
  'SUPABASE_PUBLISHABLE_KEYS',
  'SUPABASE_SECRET_KEYS',
  'SUPABASE_JWT_SECRET',
]);

/**
 * Curated expectations. `required: true` means the platform is degraded or a
 * money path is dead without it.
 */
const CURATED = {
  RAZORPAY_KEY_ID: { required: true, note: 'Razorpay API key id' },
  RAZORPAY_KEY_SECRET: { required: true, note: 'Razorpay key secret (webhook signature)' },
  RAZORPAY_WEBHOOK_SECRET: { required: true, note: 'Razorpay webhook signing secret (fail-closed)' },
  RAZORPAY_ACCOUNT_NUMBER: {
    required: true,
    note: 'RazorpayX payout source account — WITHOUT THIS MONEY CANNOT LEAVE THE PLATFORM (A1)',
  },
  APP_URL: { required: true, note: 'canonical site origin for emails + payment redirects (A6)' },
  AI_API_KEY: { required: true, note: 'OpenRouter key for every AI feature' },
  BREVO_API_KEY: { required: true, note: 'transactional email' },
  CRON_SECRET: { required: true, note: 'scheduled edge functions' },
};

/** Digest verification lets us confirm a VALUE without printing it. */
const DIGEST_CANDIDATES = {
  APP_URL: [
    'https://growlanzo.com',
    'https://growlanzo.com',
    'https://growlanzo.com',
    'https://www.growlanzo.com',
    'http://localhost:5173',
  ],
  PAYPAL_SANDBOX: ['true', 'false'],
};

function listConfiguredSecrets() {
  const out = execSync(`npx supabase secrets list --project-ref ${PROJECT_REF}`, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*\|\s*([0-9a-f]{64})\s*$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function secretInventory() {
  section(`1. Edge-function secrets (project ${PROJECT_REF})`);

  const fromCode = codeSecretNames();
  info(`The edge functions read ${fromCode.length} secret names.`);

  let configured;
  try {
    configured = listConfiguredSecrets();
  } catch (err) {
    warn('could not list deployed secrets', 'run `npx supabase login` first');
    info(`  (${String(err.message).split('\n')[0].slice(0, 120)})`);
    return { configured: new Map(), fromCode };
  }

  // Curated, required secrets.
  for (const [name, meta] of Object.entries(CURATED)) {
    if (configured.has(name)) ok(`${name}`, meta.note);
    else bad(`${name} is NOT set`, meta.note);
  }

  // Everything else the code reads, so an undocumented new secret still shows up.
  const rest = fromCode.filter((n) => !(n in CURATED) && !AUTO_PROVIDED.has(n));
  const missingOptional = rest.filter((n) => !configured.has(n));
  if (missingOptional.length) {
    warn(
      `optional/unset: ${missingOptional.join(', ')}`,
      'each has a code default — check its impact before launch',
    );
  }
  ok(`${rest.length - missingOptional.length}/${rest.length} non-curated names are set`);

  // Digest verification of the two values whose exact value defines behaviour.
  section('1b. Digest-verified settings (values confirmed WITHOUT printing them)');
  const pending = [];
  for (const [name, candidates] of Object.entries(DIGEST_CANDIDATES)) {
    const digest = configured.get(name);
    if (!digest) {
      bad(`${name} is unset`, 'cannot verify');
      continue;
    }
    const match = candidates.find((c) => sha256(c) === digest);
    if (match) ok(`${name} = ${match}`);
    else pending.push(name);
  }
  for (const name of pending) {
    warn(`${name} matches none of the known candidates`, 'value unknown (not printed)');
  }

  const appUrl = configured.get('APP_URL');
  if (appUrl === sha256('https://growlanzo.com')) {
    warn(
      'APP_URL still points at the old domain',
      'switch to https://growlanzo.com after the custom domain is live (see runbook §5)',
    );
  }
  const sandbox = configured.get('PAYPAL_SANDBOX');
  if (sandbox === sha256('true')) {
    warn('PAYPAL_SANDBOX = true', 'PayPal is in sandbox — do NOT enable VITE_PAYPAL_ENABLED yet (A5)');
  }

  return { configured, fromCode };
}

// ─── 2. frontend env ───────────────────────────────────────────────────────

function frontendEnv() {
  section('2. Frontend build variables (gitignored env files)');
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  for (const name of required) {
    if (localEnv[name]) ok(`${name} present locally`);
    else bad(`${name} missing from .env`, 'the app cannot reach Supabase');
  }
  if (localEnv.VITE_PAYPAL_ENABLED === 'true') {
    warn('VITE_PAYPAL_ENABLED=true', 'PayPal buttons are visible to users — confirm live keys first');
  } else {
    ok('PayPal is hidden in the UI (VITE_PAYPAL_ENABLED is not true)');
  }
  info('Vercel project env vars are separate — check them in the Vercel dashboard.');

  // The local APP_URL is not used at runtime (the deployed secret is), but it is
  // the input to scripts/push_redirect_urls.mjs — and a malformed value there
  // would be written to the live Supabase `site_url`, breaking auth email links.
  if (localEnv.APP_URL) {
    try {
      const u = new URL(localEnv.APP_URL);
      if (!/^https?:$/.test(u.protocol)) throw new Error('not http(s)');
      ok(`local APP_URL is an absolute URL (${u.origin})`);
    } catch {
      bad(
        'local APP_URL is not an absolute http(s) URL',
        `got ${JSON.stringify(localEnv.APP_URL)} — push_redirect_urls.mjs will refuse to run; ` +
          'use a full origin such as https://growlanzo.com',
      );
    }
  }
}

// ─── 3. live supply + public metrics (anon, read-only) ──────────────────────

async function anonCount(table, filter = '') {
  const url = `${localEnv.VITE_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${table}?select=id${filter}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: localEnv.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${localEnv.VITE_SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  if (!res.ok || Number.isNaN(total)) return null;
  return total;
}

async function liveState() {
  section('3. Live state a visitor can already see (anonymous, read-only)');

  if (!localEnv.VITE_SUPABASE_URL || !localEnv.VITE_SUPABASE_ANON_KEY) {
    warn('skipped', 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing locally');
    return;
  }

  try {
    const res = await fetch(
      `${localEnv.VITE_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/get_public_platform_metrics`,
      {
        method: 'POST',
        headers: {
          apikey: localEnv.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${localEnv.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );
    if (res.ok) {
      // Shape measured live: { countries, memberCount, totalReviews,
      // totalEscrowInr, avgSatisfactionPercent }. These are the exact numbers the
      // homepage/About page render, so they are the honest supply signal.
      const m = await res.json();
      const satisfaction =
        m.avgSatisfactionPercent === null ? 'New (no reviews yet)' : `${m.avgSatisfactionPercent}%`;
      ok(
        'get_public_platform_metrics',
        `members ${m.memberCount}, countries ${m.countries}, ` +
          `escrow \u20b9${m.totalEscrowInr}, reviews ${m.totalReviews}, satisfaction ${satisfaction}`,
      );
      if (m.memberCount <= 10) warn('member count is still single-digit', 'this is honest, not a bug');
    } else {
      warn('get_public_platform_metrics returned HTTP ' + res.status);
    }
  } catch (err) {
    warn('live metrics unavailable', String(err.message).slice(0, 100));
  }

  // Marketplace depth (A8): what a client actually sees when they land.
  for (const [label, table] of [
    ['active services', 'services'],
    ['reviews posted', 'reviews'],
    ['open projects', 'projects'],
  ]) {
    const filter = table === 'services' ? '&active=eq.true' : '';
    try {
      const n = await anonCount(table, filter);
      if (n === null) warn(`${label}: not readable anonymously (RLS) — check in the Supabase editor`);
      else if (n === 0) warn(`${label}: 0`, 'a visitor sees an empty marketplace (A8)');
      else ok(`${label}: ${n}`);
    } catch (err) {
      warn(`${label}: probe failed`, String(err.message).slice(0, 80));
    }
  }

  info(
    'Contract / escrow / order / invoice counts need the service role — ' +
      'see docs/LAUNCH-READINESS.md (they are all 0 until the first real payment, A2).',
  );
}

// ─── 4. custom-domain readiness (static) ────────────────────────────────────

function domainReadiness() {
  section('4. Custom-domain (.com) switch readiness — static checks');

  const resolver = 'supabase/functions/_shared/site.ts';
  if (!existsSync(rel(resolver))) {
    bad('shared site-URL resolver is missing', resolver);
  } else {
    ok('single source of truth exists', resolver);
    if (read(resolver).includes("Deno.env.get('APP_URL')")) {
      ok('the resolver reads the APP_URL secret');
    } else {
      bad('the resolver does not read APP_URL', 'the domain switch would need code edits');
    }
  }

  // Nothing else may read APP_URL or hardcode an origin (mirrors the vitest guard).
  const offenders = [];
  const walk = (d) => {
    for (const entry of readdirSync(rel(d), { withFileTypes: true })) {
      const p = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts')) {
        if (p === resolver || p === 'supabase/functions/_shared/cors.ts') continue;
        const content = read(p);
        const readsAppUrl = /Deno\.env\.get\(\s*'APP_URL'\s*\)/.test(content);
        const hardcodes = /https:\/\/(?:www\.)?growl(?:ancer|anzo)\.(?:com|vercel\.app)/.test(content);
        if (readsAppUrl || hardcodes) offenders.push(p);
      }
    }
  };
  walk('supabase/functions');
  if (offenders.length) bad('edge functions bypass the resolver', offenders.join(', '));
  else ok('every edge function goes through the resolver');

  const corsOk =
    read('supabase/functions/_shared/cors.ts').includes("'https://growlanzo.com'") &&
    read('supabase/functions/_shared/cors.ts').includes("'https://growlancer-mrkhan154212s-projects.vercel.app'");
  corsOk ? ok('CORS allow-list covers apex + www') : bad('CORS allow-list is missing the .com origins');

  const sitemapOk = read('public/sitemap.xml').includes('<loc>https://growlanzo.com/</loc>');
  const robotsOk = read('public/robots.txt').includes('https://growlanzo.com/sitemap.xml');
  sitemapOk ? ok('sitemap.xml uses growlanzo.com') : warn('sitemap.xml does not use growlanzo.com');
  robotsOk ? ok('robots.txt points at growlanzo.com sitemap') : warn('robots.txt is not on growlanzo.com');

  const configToml = read('supabase/config.toml');
  const authListed =
    configToml.includes('"https://growlanzo.com/auth/callback"') &&
    configToml.includes('"https://growlanzo.com/auth/callback"');
  authListed
    ? ok('supabase/config.toml auth redirects list apex + www')
    : bad('supabase/config.toml is missing the .com auth redirects');

  const pusher = read('scripts/push_redirect_urls.mjs');
  // The custom-domain redirect entries are DERIVED from APP_URL (no hard-coded      // `growlancer.vercel.app` literal left — a literal list silently missed every other
  // domain when the switch target changed).
  pusher.includes('new URL(SITE_URL).host') && pusher.includes('UNIQUE_REDIRECT_URLS')
    ? ok('scripts/push_redirect_urls.mjs derives the custom-domain redirects from APP_URL')
    : bad('scripts/push_redirect_urls.mjs no longer derives redirects from APP_URL');

  const switcher = read('scripts/domain-switch.mjs');
  switcher.includes("mode !== '--check'") && switcher.includes('await check()')
    ? ok('scripts/domain-switch.mjs fails closed — no APP_URL flip until DNS + HTTPS verify')
    : bad('scripts/domain-switch.mjs lost its pre-flight gate');
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' Growlanzo — founder launch pre-flight (read-only)');
  console.log(` project: ${PROJECT_REF}   mode: ${STRICT ? 'strict' : 'report'}`);
  console.log('═══════════════════════════════════════════════════════════');

  secretInventory();
  frontendEnv();
  await liveState();
  domainReadiness();

  section('Summary');
  console.log(`  blockers: ${blockers.length}   warnings: ${warnings.length}`);
  if (blockers.length) blockers.forEach((b) => console.log(`    ❌ ${b}`));

  section('NEXT ACTIONS (full detail: docs/FOUNDER-RUNBOOK.md)');
  console.log('  A1  Enable RazorpayX Payouts, then set RAZORPAY_ACCOUNT_NUMBER (money cannot leave)');
  console.log('  A2  Make ONE real test-mode payment end-to-end (webhook → escrow → 5% → invoice)');
  console.log('  A4  Move KYC off development mode + set the provider token');
  console.log('  A5  PayPal: set live keys + PAYPAL_SANDBOX=false FIRST, then VITE_PAYPAL_ENABLED=true');
  console.log('  A6  APP_URL → https://growlanzo.com (single change now covers every email link)');
  console.log('  A7  Turn on branch protection for main');
  console.log('  A8  Real supply: publish services + collect reviews');
  console.log('  §5  Custom domain: follow the .com switch checklist in order');
  console.log('');

  if (STRICT && blockers.length) process.exit(1);
}

main().catch((err) => {
  console.error('\n❌ pre-flight failed:', String(err.message).split('\n')[0]);
  process.exit(1);
});
