// ═══════════════════════════════════════════════════════════════════════════
// GROWLANZO — ONE-SHOT FULL VERIFICATION (nothing left untested)
//
// Runs every gate this repo has, in order, against the real stack:
//
//   1. static      typecheck · lint · unit/guard tests · production build · docs map
//   2. marketplace full-sweep.mjs      auth, projects, proposals, contracts,
//                                      escrow, release math, reviews, dispute,
//                                      notifications, messages, admin gate
//   3. security    pentest-privileges.mjs + surface-audit.mjs
//   4. scale       referral-team-scale.mjs (referral chains, 10-seat team project)
//   5. routes      route-smoke.mjs against production (40 routes + 404 control)
//   6. leftovers   live-DB audit: no disposable accounts/projects/contracts/wallets
//
// Each phase is a child process; its full log is written to artifacts/ and its
// tail is printed. The run fails if ANY phase fails. A JSON + Markdown report is
// written so the result can be attached to a release note.
//
// Usage:
//   node scripts/e2e/run-all.mjs                 # everything
//   node scripts/e2e/run-all.mjs --skip-static   # live only (faster)
//   node scripts/e2e/run-all.mjs --only=full-sweep,pentest
//   node scripts/e2e/run-all.mjs --keep          # leave fixtures (debug)
//
// Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// ───────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  })
);

const fileEnv = ['.env.local', '.env']
  .filter((f) => { try { return fs.existsSync(path.join(ROOT, f)); } catch { return false; } })
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
  .join('\n');
const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || /VITE_SUPABASE_URL=(.+)/.exec(fileEnv)?.[1]?.trim();
const ANON = process.env.VITE_SUPABASE_ANON_KEY || /VITE_SUPABASE_ANON_KEY=(.+)/.exec(fileEnv)?.[1]?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || /SUPABASE_SERVICE_ROLE_KEY=(.+)/.exec(fileEnv)?.[1]?.trim();
if (!URL || !ANON || !SERVICE) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const ENV = { ...process.env, VITE_SUPABASE_URL: URL, SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE };
const RUN_TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(ROOT, 'artifacts', `e2e-${RUN_TS}`);
fs.mkdirSync(OUT, { recursive: true });

const only = args.only ? new Set(String(args.only).split(',').map((s) => s.trim())) : null;
const phases = [];
const startedAll = Date.now();

function runPhase(name, command, cmdArgs, { cwd = ROOT, extraEnv = {}, timeoutMs = 900000 } = {}) {
  if (only && !only.has(name)) {
    console.log(`\n── ${name} — skipped (--only)`);
    return { name, status: 'skipped', code: null, seconds: 0 };
  }
  console.log(`\n════ ${name} ${'═'.repeat(Math.max(0, 60 - name.length))}`);
  const started = Date.now();
  const res = spawnSync(command, cmdArgs, {
    cwd,
    env: { ...ENV, ...extraEnv },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const log = `$ ${command} ${cmdArgs.join(' ')}\n\n--- stdout ---\n${res.stdout || ''}\n--- stderr ---\n${res.stderr || ''}\n`;
  fs.writeFileSync(path.join(OUT, `${name}.log`), log);
  const code = res.status === null ? 124 : res.status;
  const text = `${res.stdout || ''}\n${res.stderr || ''}`.trimEnd().split('\n');
  console.log(text.slice(-25).join('\n'));
  if (code !== 0) console.log(`✗ ${name} failed (exit ${code}, ${seconds}s) — full log: artifacts/e2e-${RUN_TS}/${name}.log`);
  else console.log(`✓ ${name} passed (${seconds}s)`);
  const phase = { name, status: code === 0 ? 'passed' : 'failed', code, seconds, log: `artifacts/e2e-${RUN_TS}/${name}.log` };
  phases.push(phase);
  return phase;
}

// ── 1. static gates ─────────────────────────────────────────────────────────
if (!args['skip-static']) {
  runPhase('typecheck', 'npm', ['run', 'typecheck']);
  runPhase('lint', 'npm', ['run', 'lint']);
  runPhase('unit-tests', 'npm', ['test']);
  runPhase('build', 'npm', ['run', 'build']);
  runPhase('docs-check', 'npm', ['run', 'docs:check']);
} else {
  console.log('\n── static gates skipped (--skip-static)');
}

// ── 2–4. live suites ────────────────────────────────────────────────────────
const keep = args.keep === 'true' ? ['--keep'] : [];
runPhase('full-sweep', 'node', ['scripts/e2e/full-sweep.mjs', ...keep], {
  extraEnv: { E2E_SWEEP_JSON: path.join(OUT, 'full-sweep.json') },
});
runPhase('pentest', 'node', ['scripts/e2e/pentest-privileges.mjs']);
runPhase('surface-audit', 'node', ['scripts/e2e/surface-audit.mjs']);
runPhase('referral-team-scale', 'node', ['scripts/e2e/referral-team-scale.mjs', ...keep]);
runPhase('launch-coins-verification', 'node', ['scripts/e2e/launch-coins-verification.mjs', ...keep]);
runPhase('referral-criteria-team-ai', 'node', ['scripts/e2e/referral-criteria-team-ai.mjs', ...keep]);

// ── 5. production routes ────────────────────────────────────────────────────
if (!args['skip-routes']) {
  runPhase('routes', 'node', ['scripts/e2e/route-smoke.mjs', '--base=https://www.growlanzo.com']);
} else {
  console.log('\n── production routes skipped (--skip-routes)');
}

// ── 6. leftover audit ──────────────────────────────────────────────────────
async function leftoverAudit() {
  console.log(`\n════ leftover-audit ${'═'.repeat(48)}`);
  const started = Date.now();
  const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  const get = async (p) => {
    const r = await fetch(`${URL}${p}`, { headers: svc });
    let json = null;
    try { json = await r.json(); } catch { /* empty */ }
    return { status: r.status, json };
  };
  const listAuthUsers = async () => {
    const out = [];
    for (let page = 1; page <= 20; page++) {
      const r = await get(`/auth/v1/admin/users?per_page=200&page=${page}`);
      const users = Array.isArray(r.json) ? r.json : r.json?.users || [];
      out.push(...users);
      if (users.length < 200) break;
    }
    return out;
  };
  const users = await listAuthUsers();
  const disposable = users.filter((u) => /^(sweep|scale)\./i.test(u.email || '') && (u.email || '').endsWith('@growlancer-test.com'));
  const projects = await get('/rest/v1/projects?select=id,title&title=like.TEST E2E*');
  const contracts = await get('/rest/v1/contracts?select=id&status=eq.pending_freelancer&created_at=gte.' + encodeURIComponent(new Date(Date.now() - 3600e3).toISOString()));
  const wallets = await get('/rest/v1/wallets?select=user_id&balance=gt.0&updated_at=gte.' + encodeURIComponent(new Date(Date.now() - 3600e3).toISOString()));
  const checks = [
    ['disposable accounts removed', disposable.length === 0, disposable.map((u) => u.email)],
    ['no TEST E2E projects left', (projects.json || []).length === 0, projects.json],
    ['no stale pending contracts from this hour', (contracts.json || []).length === 0, contracts.json],
  ];
  const lines = [];
  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 500)}`}`);
  }
  // Informational only: wallets that changed this hour can belong to real users.
  console.log(`· wallets credited in the last hour (informational): ${(wallets.json || []).length}`);
  fs.writeFileSync(path.join(OUT, 'leftover-audit.log'), lines.join('\n') + '\n');
  const phase = {
    name: 'leftover-audit',
    status: checks.every(([, ok]) => ok) ? 'passed' : 'failed',
    code: checks.every(([, ok]) => ok) ? 0 : 1,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    log: `artifacts/e2e-${RUN_TS}/leftover-audit.log`,
  };
  phases.push(phase);
  console.log(phase.status === 'passed' ? '✓ leftover-audit passed' : '✗ leftover-audit failed');
}

try {
  await leftoverAudit();
} catch (err) {
  phases.push({ name: 'leftover-audit', status: 'failed', code: 1, seconds: 0, log: null, error: err.message });
  console.log(`✗ leftover-audit could not run: ${err.message}`);
}

// ── report ─────────────────────────────────────────────────────────────────
const failed = phases.filter((p) => p.status === 'failed');
const passed = phases.filter((p) => p.status === 'passed');
const skipped = phases.filter((p) => p.status === 'skipped');
const totalSeconds = Math.round((Date.now() - startedAll) / 1000);
const report = {
  target: URL,
  startedAt: RUN_TS,
  durationSeconds: totalSeconds,
  summary: { passed: passed.length, failed: failed.length, skipped: skipped.length },
  phases,
  result: failed.length ? 'FAIL' : 'PASS',
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  `# Growlanzo full verification — ${report.result}`,
  '',
  `- Target: \`${URL}\``,
  `- Started: ${RUN_TS}`,
  `- Duration: ${totalSeconds}s`,
  `- Phases: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
  '',
  '| Phase | Result | Seconds | Log |',
  '| --- | --- | --- | --- |',
  ...phases.map((p) => `| ${p.name} | ${p.status} | ${p.seconds} | ${p.log || '—'} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);

console.log(`\n══════════════════════════════════════════════════════════════`);
console.log(`RESULT: ${report.result} — ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped in ${totalSeconds}s`);
for (const p of phases) console.log(`  ${p.status === 'passed' ? '✓' : p.status === 'failed' ? '✗' : '·'} ${p.name.padEnd(20)} ${p.seconds}s`);
console.log(`Report: artifacts/e2e-${RUN_TS}/report.md`);
console.log('══════════════════════════════════════════════════════════════');
process.exit(failed.length ? 1 : 0);
