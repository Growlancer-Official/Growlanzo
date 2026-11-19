#!/usr/bin/env node
/**
 * Guarded custom-domain switch for Growlanzo.
 *
 * WHY THIS EXISTS
 * ---------------
 * GROWLANZO.md §6 rewrites `.env`'s APP_URL and then pushes it
 * straight into the LIVE Supabase Auth `site_url`. If that happens before the new
 * domain actually serves the app, every verification / password-reset / OAuth
 * email link starts pointing at a domain that does not work — for every user, at
 * once, and no code change can recall the emails already sent.
 *
 * So this script FAILS CLOSED: it refuses to touch anything unless the domain
 * demonstrably resolves AND serves THIS app from Vercel over HTTPS.
 *
 * Usage
 *   node scripts/domain-switch.mjs <domain>            # verify only (safe)
 *   node scripts/domain-switch.mjs <domain> --check    # same, explicit
 *   node scripts/domain-switch.mjs <domain> --apply    # switch (only if checks pass)
 *
 * Order of operations (mirrors GROWLANZO.md §6):
 *   1. verify DNS + HTTPS + it is really our app          ← fail closed here
 *   2. rewrite APP_URL in .env                            (local only)
 *   3. push_redirect_urls.mjs  → site_url + redirect list (live auth config)
 *   4. supabase secrets set APP_URL                       (edge functions)
 *   5. founder-preflight.mjs                              (report)
 *
 * Everything the founder must still do by hand (Sentry, Brevo, Search Console)
 * is printed at the end — this script never pretends to have done them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import dns from 'node:dns';
import https from 'node:https';

const resolve4 = promisify(dns.resolve4);
const resolveCname = promisify(dns.resolveCname);

const PROJECT_REF = 'zttwsjehcgaicziqyxpq';
const OLD_ORIGIN = 'https://growlancer.vercel.app'; // must keep working throughout
const APP_NAME_HINT = 'Growlanzo';

const [, , rawDomain, mode = '--check'] = process.argv;
if (!rawDomain || rawDomain.startsWith('--')) {
  console.error('Usage: node scripts/domain-switch.mjs <domain> [--check|--apply]');
  process.exit(2);
}
if (mode !== '--check' && mode !== '--apply') {
  console.error(`Unknown mode "${mode}" — use --check or --apply`);
  process.exit(2);
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(rawDomain)) {
  console.error(`"${rawDomain}" is not a bare domain (expected e.g. growlancing.com)`);
  process.exit(2);
}
const DOMAIN = rawDomain.toLowerCase();
const ORIGIN = `https://${DOMAIN}`;
const WWW = `www.${DOMAIN}`;

/** One HTTPS GET that never throws — result is normalised to {status, server, body} */
function get(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      const status = res.statusCode;
      const server = res.headers.server || '';
      const location = res.headers.location || '';
      // don't download the whole page — the title is enough to identify us
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        if (body.length < 60000) body += c;
      });
      res.on('end', () => {
        if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
          const next = new URL(location, url).toString();
          return resolve(get(next, redirectsLeft - 1));
        }
        resolve({ status, server, body, finalUrl: url });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, server: '', body: '', error: e.code || e.message }));
  });
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name} — ${detail}`);
};

async function check() {
  console.log(`\nDomain switch pre-flight for ${ORIGIN}\n`);

  // 1. apex must resolve at all (a domain nobody owns simply does not)
  let apexIps = [];
  try {
    apexIps = await resolve4(DOMAIN);
    record('apex DNS', apexIps.length > 0, `A → ${apexIps.join(', ')}`);
  } catch (e) {
    record('apex DNS', false, `${e.code || e.message} — the domain does not exist yet (buy it first)`);
  }

  // 2. www must resolve too (Vercel needs both, apex primary + www redirect)
  try {
    const ips = await resolve4(WWW);
    record('www DNS', ips.length > 0, `A → ${ips.join(', ')}`);
  } catch (e) {
    try {
      const cname = await resolveCname(WWW);
      record('www DNS', cname.length > 0, `CNAME → ${cname.join(', ')}`);
    } catch (e2) {
      record('www DNS', false, `${e2.code || e2.message} — add www and point it at cname.vercel-dns.com`);
    }
  }

  // 3. apex must answer HTTPS...
  const apex = await get(ORIGIN + '/');
  record('apex HTTPS', apex.status === 200, apex.error ? apex.error : `HTTP ${apex.status}`);

  // 4. ...and it must be Vercel serving OUR app, not a registrar parking page.
  //    This is the check that actually protects the auth email links.
  const isVercel = /vercel/i.test(apex.server);
  const isOurs = apex.body.includes(APP_NAME_HINT) || apex.body.includes('<title');
  record('apex serves this app', isVercel && isOurs && apex.status === 200,
    `server="${apex.server}" title/greeting ${isOurs ? 'found' : 'missing'} (must be this app on Vercel)`);

  // 5. www must reach the same app (redirect to apex or serve directly)
  const wwwRes = await get(`https://${WWW}/`);
  const wwwOk = wwwRes.status === 200 && (wwwRes.body.includes(APP_NAME_HINT) || wwwRes.body.includes('<title'));
  record('www reaches the app', wwwOk, wwwRes.error ? wwwRes.error : `HTTP ${wwwRes.status} → ${wwwRes.finalUrl}`);

  // 6. the old origin must keep serving (alias, never cut it off early)
  const old = await get(OLD_ORIGIN + '/');
  record('old origin still serves', old.status === 200, old.error ? old.error : `HTTP ${old.status} on ${OLD_ORIGIN}`);

  return results.every((r) => r.pass);
}

function flipEnvFile() {
  const env = readFileSync('.env', 'utf8');
  const current = (env.split('\n').find((l) => l.startsWith('APP_URL=')) || '').slice('APP_URL='.length).trim();
  if (current === ORIGIN) {
    console.log(`  SKIP  .env APP_URL already ${ORIGIN}`);
    return false;
  }
  const line = `APP_URL=${ORIGIN}`;
  const updated = env.includes('\nAPP_URL=')
    ? env.replace(/\r?\nAPP_URL=[^\r\n]*/, `\n${line}`)
    : env.replace(/^APP_URL=[^\r\n]*/, line);
  writeFileSync('.env', updated);
  console.log(`  DONE  .env: APP_URL ${current || '(unset)'} → ${ORIGIN}`);
  return true;
}

function run(label, cmd) {
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: true });
  const ok = res.status === 0;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label} (exit ${res.status})`);
  return ok;
}

async function main() {
  const ok = await check();

  if (!ok) {
    console.log('\n❌ Checks failed — NOTHING was changed.');
    const apexDnsOk = results.find((r) => r.name === 'apex DNS')?.pass;
    if (apexDnsOk) {
      // DNS resolves but HTTPS does not serve: the records already point at
      // Vercel, but no project there claims the domain yet (an unclaimed
      // domain times out rather than erroring).
      console.log('   DNS resolves, but this domain is not serving the app yet.');
      console.log('   Add it in Vercel → Project → Domains and wait for "Valid Configuration"');
      console.log('   (if it was JUST added, wait a minute and re-check — propagation is slow)');
    } else {
      console.log('   Fix the DNS first:  apex A   → 76.223.54.146 and 13.248.169.48');
      console.log('                       www CNAME → cname.vercel-dns.com');
      console.log('   (use the exact records Vercel shows in the project Domains tab)');
    }
    console.log(`   Then re-run: node scripts/domain-switch.mjs ${DOMAIN} --check`);
    process.exit(1);
  }

  console.log('\n✅ All pre-flight checks passed.');
  if (mode === '--check') {
    console.log(`   Ready to switch. Run: node scripts/domain-switch.mjs ${DOMAIN} --apply`);
    return;
  }

  console.log(`\nApplying the switch to ${ORIGIN} …`);
  flipEnvFile();

  const tokenPresent = /^SUPABASE_ACCESS_TOKEN=.+/m.test(readFileSync('.env', 'utf8'));
  let pushed = false;
  if (!tokenPresent) {
    console.log('  WARN  SUPABASE_ACCESS_TOKEN missing from .env — skipping auth redirect push.');
    console.log('        Add it to .env (Supabase dashboard → Account → API tokens), then run:');
    console.log('        node scripts/push_redirect_urls.mjs');
  } else {
    pushed = run('push Supabase Auth site_url + redirect URLs', ['node', 'scripts/push_redirect_urls.mjs']);
  }

  const secretSet = run('set edge-function APP_URL secret', [
    'npx', 'supabase', 'secrets', 'set', `APP_URL=${ORIGIN}`, '--project-ref', PROJECT_REF,
  ]);

  run('founder preflight', ['node', 'scripts/founder-preflight.mjs']);

  console.log('\nManual steps this script does NOT do (see GROWLANZO.md §6):');
  console.log('  5. Sentry  → allow the new origin');
  console.log('  6. Brevo   → verify sender domain (SPF/DKIM) + EMAIL_FROM');
  console.log('  7. Search Console → add the domain property, submit sitemap.xml');
  console.log('\nVerify in a fresh browser:');
  console.log(`  1. ${ORIGIN} loads and ${OLD_ORIGIN} still works`);
  console.log(`  2. sign up → the verification link opens on ${ORIGIN}`);
  console.log('  3. log out / log back in with GitHub and LinkedIn');

  const allGood = pushed || !tokenPresent;
  if (!secretSet) process.exit(1);
  if (!allGood) process.exit(1);
}

main().catch((e) => {
  console.error('❌ domain-switch failed:', e.message);
  process.exit(1);
});
