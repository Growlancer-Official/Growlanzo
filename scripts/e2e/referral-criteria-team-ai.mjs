// ═══════════════════════════════════════════════════════════════════════════
// GROWLANZO — REFERRAL CRITERIA GATE + MULTI-SKILL TEAM PROJECT + AI MATCHING
//
// Runs against the LINKED Supabase project with disposable, pre-confirmed
// accounts (service role; no mail is ever sent) and tears them down again.
//
// 1. REFERRAL COINS ARE EARNED ONLY WHEN THE CRITERIA ARE FULLY MET
//    • a recorded referral alone pays nothing (0 coins both sides);
//    • a contract that is only created / funded / delivered pays nothing;
//    • the release (completed + settled escrow) pays the referee AND referrer;
//    • KYC pays only for a genuinely verified row from a real provider —
//      pending and dev_mode are refused;
//    • every award is idempotent (a retry pays 0);
//    • the 199 (freelancer) / 100 (client) monthly earning cap is exact.
//    Enough accounts are created for every path (20+ disposable users).
//
// 2. ONE BIG TEAM PROJECT, TEN DIFFERENT SKILLS
//    • ten freelancers with distinct skill sets;
//    • one team project with ten roles — each role's server-side suggestion
//      list is populated by the trigger and its TOP match is the freelancer
//      who really owns those skills (wrong-skill people are not suggested);
//    • a skill edit re-matches open roles in real time;
//    • turning on is_pro changes NO score (merit-based);
//    • ten independent contracts, each funded/delivered/released on its own,
//      ₹950 net to each freelancer, one seat never touching another's escrow.
//
// 3. AI MATCHING WORKFLOW
//    • posting a project triggers server-side deterministic matches;
//    • the ai-matching edge function returns ranked matches for the owner,
//      persists them, and keeps AI scores optional;
//    • a non-owner gets 404, an anonymous caller 401;
//    • RLS shows a freelancer only their own match rows;
//    • the top freelancer gets a real notification.
//
// Usage:
//   node scripts/e2e/referral-criteria-team-ai.mjs
//   node scripts/e2e/referral-criteria-team-ai.mjs --keep
//
// Env: VITE_SUPABASE_URL (or SUPABASE_URL) + VITE_SUPABASE_ANON_KEY
//      + SUPABASE_SERVICE_ROLE_KEY. Nothing secret is printed.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';

const fileEnv = ['.env.local', '.env']
  .filter((f) => { try { return fs.existsSync(f); } catch { return false; } })
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const clean = (v) => v?.trim().replace(/^["']|["']$/g, '').split(/\s+/)[0];
const URL = clean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || clean(/VITE_SUPABASE_URL=(.+)/.exec(fileEnv)?.[1]);
const ANON = clean(process.env.VITE_SUPABASE_ANON_KEY) || clean(/VITE_SUPABASE_ANON_KEY=(.+)/.exec(fileEnv)?.[1]);
const SERVICE = clean(process.env.SUPABASE_SERVICE_ROLE_KEY) || clean(/SUPABASE_SERVICE_ROLE_KEY=(.+)/.exec(fileEnv)?.[1]);
if (!URL || !ANON || !SERVICE) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const DOMAIN = 'growlancer-test.com';
const PREFIX = 'criteria';
const PW = 'Test@1234';
const KEEP = process.argv.includes('--keep');
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = () => {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `GRW-${s.slice(0, 4)}-${s.slice(4)}`;
};

const checks = [];
const fails = [];
const check = (name, cond, detail) => {
  checks.push({ name, pass: !!cond });
  if (!cond) fails.push(name);
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${JSON.stringify(detail)?.slice(0, 500)}`}`);
};
const notes = [];
const note = (msg) => { notes.push(msg); console.log(`· ${msg}`); };

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function admin(path, { method = 'GET', body, prefer } = {}) {
  const headers = { ...svc };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
async function api(path, token, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
const rpc = (fn, body, token) => api(`/rest/v1/rpc/${fn}`, token, { method: 'POST', body });
const adminRpc = (fn, body) => admin(`/rest/v1/rpc/${fn}`, { method: 'POST', body });
const row = async (path, token) => {
  const r = await api(path, token);
  return Array.isArray(r.json) ? r.json[0] : r.json;
};
const adminRow = async (path) => {
  const r = await admin(path);
  return Array.isArray(r.json) ? r.json[0] : r.json;
};
const adminRows = async (path) => (await admin(path)).json || [];
const rows = async (path, token) => (await api(path, token)).json || [];

async function until(fn, pred, tries = 24, delay = 250) {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, delay));
  }
  return v;
}

async function listAuthUsers() {
  const out = [];
  for (let page = 1; page <= 15; page++) {
    const r = await admin(`/auth/v1/admin/users?per_page=200&page=${page}`);
    const users = Array.isArray(r.json) ? r.json : r.json?.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

const created = [];
async function ensureUser(email, role, name) {
  const existing = (await listAuthUsers()).find((u) => (u.email || '').toLowerCase() === email);
  let id = existing?.id;
  if (!id) {
    const res = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password: PW, email_confirm: true, user_metadata: { name, role } },
    });
    id = res.json?.id;
    if (!id) throw new Error(`create ${email}: HTTP ${res.status}`);
  } else {
    await admin(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { password: PW, email_confirm: true } });
  }
  created.push(id);
  const prof = await admin('/rest/v1/rpc/create_user_profile', {
    method: 'POST',
    body: { p_id: id, p_email: email, p_name: name, p_role: role, p_referral_code: CODE() },
  });
  if (prof.status !== 200) throw new Error(`profile ${email}: HTTP ${prof.status} ${JSON.stringify(prof.json).slice(0, 200)}`);
  await admin(`/rest/v1/profiles_private?id=eq.${id}`, { method: 'PATCH', body: { onboarding_completed: true } });
  await admin(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', body: { country: 'India' } });
  await admin('/rest/v1/wallets?on_conflict=user_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: id, balance: 0, escrow_balance: 0, currency: 'INR' },
  });
  return { id, email, role, name };
}

async function login(user) {
  const r = await api('/auth/v1/token?grant_type=password', null, {
    method: 'POST', body: { email: user.email, password: PW },
  });
  if (!r.json?.access_token) throw new Error(`login ${user.email}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return { ...user, token: r.json.access_token };
}

const codeOf = async (u) => (await row(`/rest/v1/profiles_private?select=referral_code&id=eq.${u.id}`, u.token))?.referral_code;
const claim = (u, code) => rpc('process_referral', { p_referral_code: code, p_new_user_id: u.id, p_new_user_email: u.email }, u.token);

const ledger = async (userId) =>
  adminRows(`/rest/v1/grow_coin_ledger?select=amount,reason,reference_id,metadata&user_id=eq.${userId}&order=created_at.asc`);
const coinTotal = async (userId) => (await ledger(userId)).reduce((s, x) => s + Number(x.amount || 0), 0);

async function seedCoins(userId, amount, reason = 'referral_project_reward') {
  const r = await admin('/rest/v1/grow_coin_ledger', {
    method: 'POST', prefer: 'return=minimal',
    body: { user_id: userId, amount, reason, metadata: { role: 'referrer', source: 'criteria-e2e-seed' } },
  });
  if (r.status >= 300) throw new Error(`seed coins: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
}
const seedWallet = async (u, balance) =>
  admin(`/rest/v1/wallets?user_id=eq.${u.id}`, { method: 'PATCH', body: { balance, escrow_balance: 0 } });
const wallet = async (u) => Number((await row(`/rest/v1/wallets?select=balance&user_id=eq.${u.id}`, u.token))?.balance ?? 0);

// ── Contract helpers, split so an INCOMPLETE contract can be asserted on ────
async function openContract({ client, freelancer, amount, title, skills = ['Testing'], category = 'Development' }) {
  const proj = await api('/rest/v1/projects', client.token, {
    method: 'POST', prefer: 'return=representation',
    body: {
      client_id: client.id, title, description: 'Disposable automated criteria probe.',
      budget_min: amount, budget_max: amount, skills_required: skills, category, status: 'open',
    },
  });
  const projectId = proj.json?.[0]?.id;
  if (!projectId) throw new Error(`project: HTTP ${proj.status} ${JSON.stringify(proj.json).slice(0, 200)}`);
  const prop = await api('/rest/v1/proposals', freelancer.token, {
    method: 'POST', prefer: 'return=representation',
    body: { project_id: projectId, freelancer_id: freelancer.id, message: 'Automated criteria probe', proposed_rate: amount, rate_type: 'fixed', status: 'pending' },
  });
  const proposalId = prop.json?.[0]?.id;
  if (!proposalId) throw new Error(`proposal: HTTP ${prop.status} ${JSON.stringify(prop.json).slice(0, 200)}`);
  const made = await rpc('create_contract_with_escrow', {
    p_project_id: projectId, p_freelancer_id: freelancer.id, p_proposal_id: proposalId, p_amount: amount, p_client_id: client.id,
  }, client.token);
  const contractId = typeof made.json === 'string' ? made.json : made.json?.contract_id || made.json?.id;
  if (!contractId) throw new Error(`contract: HTTP ${made.status} ${JSON.stringify(made.json).slice(0, 300)}`);
  return { projectId, proposalId, contractId };
}

(async () => {
  console.log(`Target: ${URL}\n`);

  // Clean leftovers from an interrupted earlier run.
  const stale = (await listAuthUsers()).filter((u) => new RegExp(`^${PREFIX}\\.`, 'i').test(u.email || ''));
  for (const u of stale) await adminRpc('delete_user_all_data', { p_user_id: u.id });
  if (stale.length) console.log(`Removed ${stale.length} leftover criteria account(s).\n`);

  // ── Fixtures: enough accounts for every path ────────────────────────────
  const fx = {
    client: await ensureUser(`${PREFIX}.client@${DOMAIN}`, 'client', 'Criteria Client'),
    referrer: await ensureUser(`${PREFIX}.referrer@${DOMAIN}`, 'freelancer', 'Criteria Referrer'),
    referee: await ensureUser(`${PREFIX}.referee@${DOMAIN}`, 'freelancer', 'Criteria Referee'),
    kycReferrer: await ensureUser(`${PREFIX}.kycreferrer@${DOMAIN}`, 'freelancer', 'Criteria KYC Referrer'),
    kycReferee: await ensureUser(`${PREFIX}.kyc@${DOMAIN}`, 'freelancer', 'Criteria KYC Referee'),
    capRef: await ensureUser(`${PREFIX}.capref@${DOMAIN}`, 'freelancer', 'Criteria Cap Referrer'),
    capReferee: await ensureUser(`${PREFIX}.capreferee@${DOMAIN}`, 'freelancer', 'Criteria Cap Referee'),
    cRef: await ensureUser(`${PREFIX}.cref@${DOMAIN}`, 'client', 'Criteria Client Referrer'),
    cReferee: await ensureUser(`${PREFIX}.creferee@${DOMAIN}`, 'client', 'Criteria Client Referee'),
    capCRef: await ensureUser(`${PREFIX}.capcref@${DOMAIN}`, 'client', 'Criteria Client Cap Referrer'),
    capCReferee: await ensureUser(`${PREFIX}.capcreferee@${DOMAIN}`, 'client', 'Criteria Client Cap Referee'),
    aiClient: await ensureUser(`${PREFIX}.aiclient@${DOMAIN}`, 'client', 'Criteria AI Client'),
  };
  const SKILLED = [
    ['t1', 'Frontend Developer', ['React', 'TypeScript'], 750],
    ['t2', 'Backend Developer', ['Node.js', 'PostgreSQL'], 700],
    ['t3', 'UI Designer', ['Figma', 'UI Design'], 600],
    ['t4', 'UX Researcher', ['User Research', 'Interviews'], 550],
    ['t5', 'QA Engineer', ['Playwright', 'Testing'], 500],
    ['t6', 'DevOps Engineer', ['Docker', 'CI/CD'], 800],
    ['t7', 'Content Writer', ['Copywriting', 'SEO'], 450],
    ['t8', 'SEO Specialist', ['SEO', 'Analytics'], 480],
    ['t9', 'Video Editor', ['Premiere Pro', 'Motion Graphics'], 650],
    ['t10', 'Data Analyst', ['SQL', 'Dashboards'], 700],
  ];
  const team = {};
  for (const [key, title, skills, rate] of SKILLED) {
    const u = await ensureUser(`${PREFIX}.${key}@${DOMAIN}`, 'freelancer', `Criteria ${title}`);
    await admin(`/rest/v1/freelancer_profiles?user_id=eq.${u.id}`, { method: 'DELETE' });
    const fp = await admin('/rest/v1/freelancer_profiles', {
      method: 'POST', prefer: 'return=minimal',
      body: {
        user_id: u.id, title, skills, categories: ['Development'], experience: 4,
        availability: true, hourly_rate: rate, completion_rate: 100, bio: `Specialist ${title}`,
        location: 'Remote', rating: 4.8,
      },
    });
    if (fp.status >= 300) throw new Error(`freelancer_profile ${key}: HTTP ${fp.status} ${JSON.stringify(fp.json).slice(0, 300)}`);
    team[key] = u;
  }

  const u = {};
  for (const [k, v] of Object.entries(fx)) u[k] = await login(v);
  for (const [k, v] of Object.entries(team)) u[k] = await login(v);
  check('22 disposable accounts created and signed in (13 named roles + 10 skilled freelancers + 2 clients)',
    Object.values(u).every((x) => !!x.token), Object.keys(u).length);

  for (const [key, title, skills] of SKILLED) {
    const fp = await adminRow(`/rest/v1/freelancer_profiles?select=skills,title&user_id=eq.${u[key].id}`);
    check(`${key} (${title}) carries exactly ${skills.join(' + ')}`, JSON.stringify(fp?.skills) === JSON.stringify(skills), fp);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PART 1 — REFERRAL COINS ONLY WHEN THE CRITERIA ARE FULLY MET
  // ═══════════════════════════════════════════════════════════════════════
  const fCode = await codeOf(u.referrer);
  const fClaim = await claim(u.referee, fCode);
  check('1.1 referral is recorded with a real code', fClaim.json?.success === true, fClaim.json);

  check('1.2 a recorded referral alone pays the referee 0 coins', (await coinTotal(u.referee.id)) === 0, await ledger(u.referee.id));
  check('1.3 a recorded referral alone pays the referrer 0 coins', (await coinTotal(u.referrer.id)) === 0, await ledger(u.referrer.id));

  await seedWallet(u.client, 60000);
  const c = await openContract({ client: u.client, freelancer: u.referee, amount: 1000, title: 'TEST E2E — criteria gate' });
  check('1.4 contract created but NOT funded pays nothing',
    !!c.contractId && (await coinTotal(u.referee.id)) === 0 && (await coinTotal(u.referrer.id)) === 0,
    { contractId: c.contractId, referee: await coinTotal(u.referee.id), referrer: await coinTotal(u.referrer.id) });

  const fund = await rpc('fund_escrow_from_wallet', { p_contract_id: c.contractId, p_milestone_indices: null }, u.client.token);
  check('1.5 funded escrow still pays nothing', fund.json?.success === true && (await coinTotal(u.referee.id)) === 0 && (await coinTotal(u.referrer.id)) === 0, fund.json);

  const deliver = await rpc('mark_contract_delivered', { p_contract_id: c.contractId }, u.referee.token);
  check('1.6 delivered work (not released) still pays nothing',
    deliver.json?.success !== false && (await coinTotal(u.referee.id)) === 0 && (await coinTotal(u.referrer.id)) === 0, deliver.json);

  const release = await rpc('release_escrow', { p_contract_id: c.contractId, p_client_id: u.client.id }, u.client.token);
  check('1.7 release completes the contract', release.json === true, release.json);

  const refereeRows = await until(() => ledger(u.referee.id), (r) => r.some((x) => x.reason === 'referral_project_reward'));
  const referrerRows = await until(() => ledger(u.referrer.id), (r) => r.some((x) => x.reason === 'referral_project_reward'));
  const refereeProject = refereeRows.filter((x) => x.reason === 'referral_project_reward');
  const referrerProject = referrerRows.filter((x) => x.reason === 'referral_project_reward');
  check('1.8 referee is paid exactly 5 project coins', refereeProject.length === 1 && Number(refereeProject[0].amount) === 5, refereeProject);
  check('1.9 referrer is paid exactly 5 project coins', referrerProject.length === 1 && Number(referrerProject[0].amount) === 5, referrerProject);
  check('1.10 the project reward is attributed to that contract', refereeProject[0]?.reference_id === c.contractId && referrerProject[0]?.reference_id === c.contractId,
    { referee: refereeProject[0]?.reference_id, referrer: referrerProject[0]?.reference_id, contractId: c.contractId });
  check('1.11 no KYC coins were invented before KYC', !refereeRows.some((x) => x.reason === 'kyc_bonus') && !referrerRows.some((x) => x.reason === 'kyc_bonus'),
    { refereeRows, referrerRows });
  check('1.12 referee balance is exactly 5', (await coinTotal(u.referee.id)) === 5, await coinTotal(u.referee.id));
  check('1.13 referrer balance is exactly 5', (await coinTotal(u.referrer.id)) === 5, await coinTotal(u.referrer.id));

  const retryContract = await adminRpc('award_referral_project_reward', { p_contract_id: c.contractId });
  check('1.14 re-awarding the same contract pays 0 and changes nothing',
    (retryContract.status >= 400 || retryContract.json?.awarded === 0) &&
      (await coinTotal(u.referee.id)) === 5 && (await coinTotal(u.referrer.id)) === 5,
    { rpc: retryContract.json, referee: await coinTotal(u.referee.id), referrer: await coinTotal(u.referrer.id) });

  // KYC milestone — referral claim first, then the provider gate.
  const kCode = await codeOf(u.kycReferrer);
  const kClaim = await claim(u.kycReferee, kCode);
  check('1.15 KYC-path referral recorded', kClaim.json?.success === true, kClaim.json);

  const kycRow = await admin('/rest/v1/identity_verifications', {
    method: 'POST', prefer: 'return=representation',
    body: {
      user_id: u.kycReferee.id, document_type: 'national_id',
      document_url: 'https://example.test/criteria-kyc.jpg', status: 'pending',
      verification_provider: 'manual',
    },
  });
  const kycId = kycRow.json?.[0]?.id;
  check('1.16 a pending KYC row exists (not approved yet)', kycRow.status === 201 && !!kycId, { status: kycRow.status, body: kycRow.json });

  const kycPending = await adminRpc('award_referral_bonus_if_eligible', { p_referred_user_id: u.kycReferee.id });
  check('1.17 pending KYC pays nobody', kycPending.json?.success === false && kycPending.json?.reason === 'kyc_not_approved' &&
    (await coinTotal(u.kycReferee.id)) === 0 && (await coinTotal(u.kycReferrer.id)) === 0, kycPending.json);

  await admin(`/rest/v1/identity_verifications?id=eq.${kycId}`, {
    method: 'PATCH', body: { status: 'verified', verification_provider: 'dev_mode', verified_at: new Date().toISOString() },
  });
  const kycDev = await adminRpc('award_referral_bonus_if_eligible', { p_referred_user_id: u.kycReferee.id });
  check('1.18 a dev-mode "verified" row does not pay (real provider required)',
    kycDev.json?.success === false && (await coinTotal(u.kycReferee.id)) === 0 && (await coinTotal(u.kycReferrer.id)) === 0, kycDev.json);

  await admin(`/rest/v1/identity_verifications?id=eq.${kycId}`, {
    method: 'PATCH', body: { verification_provider: 'manual', verified_at: new Date().toISOString() },
  });
  const kycApproved = await adminRpc('award_referral_bonus_if_eligible', { p_referred_user_id: u.kycReferee.id });
  check('1.19 an approved real KYC pays the referee and referrer 5 each',
    kycApproved.json?.success === true && (await coinTotal(u.kycReferee.id)) === 5 && (await coinTotal(u.kycReferrer.id)) === 5,
    { rpc: kycApproved.json, referee: await coinTotal(u.kycReferee.id), referrer: await coinTotal(u.kycReferrer.id) });

  const kycRetry = await adminRpc('award_referral_bonus_if_eligible', { p_referred_user_id: u.kycReferee.id });
  check('1.20 KYC reward retry is a no-op', kycRetry.json?.already_awarded === true && kycRetry.json?.coins === 0 &&
    (await coinTotal(u.kycReferee.id)) === 5 && (await coinTotal(u.kycReferrer.id)) === 5, kycRetry.json);

  const kReferral = await row(`/rest/v1/referrals?select=status,bonus_claimed&referred_user_id=eq.${u.kycReferee.id}`, u.kycReferrer.token);
  check('1.21 the completed referral is marked completed + bonus claimed', kReferral?.status === 'completed' && kReferral?.bonus_claimed === true, kReferral);
  const kStats = await row(`/rest/v1/referral_stats?select=valid_referrals,points&user_id=eq.${u.kycReferrer.id}`, u.kycReferrer.token);
  check('1.22 counters move exactly once (1 valid, 5 points)', Number(kStats?.valid_referrals) === 1 && Number(kStats?.points) === 5, kStats);

  // ── Freelancer 199 earning cap, measured from the ledger ────────────────
  const capCode = await codeOf(u.capRef);
  await claim(u.capReferee, capCode);
  await seedCoins(u.capRef.id, 195);
  check('1.23 cap referrer starts at 195 coins', (await coinTotal(u.capRef.id)) === 195, await coinTotal(u.capRef.id));

  const capOne = await openContract({ client: u.client, freelancer: u.capReferee, amount: 1000, title: 'TEST E2E — freelancer cap 199' });
  await rpc('fund_escrow_from_wallet', { p_contract_id: capOne.contractId, p_milestone_indices: null }, u.client.token);
  await rpc('mark_contract_delivered', { p_contract_id: capOne.contractId }, u.capReferee.token);
  await rpc('release_escrow', { p_contract_id: capOne.contractId, p_client_id: u.client.id }, u.client.token);
  const capped = await until(() => coinTotal(u.capRef.id), (v) => v >= 199);
  check('1.24 the 199 cap pays the referrer only the remaining 4 coins', capped === 199, { total: capped, rows: await ledger(u.capRef.id) });
  check('1.25 the capped referee still gets the full 5 coins', (await coinTotal(u.capReferee.id)) === 5, await coinTotal(u.capReferee.id));

  const capTwo = await openContract({ client: u.client, freelancer: u.capReferee, amount: 1000, title: 'TEST E2E — freelancer cap 199 second' });
  await rpc('fund_escrow_from_wallet', { p_contract_id: capTwo.contractId, p_milestone_indices: null }, u.client.token);
  await rpc('mark_contract_delivered', { p_contract_id: capTwo.contractId }, u.capReferee.token);
  await rpc('release_escrow', { p_contract_id: capTwo.contractId, p_client_id: u.client.id }, u.client.token);
  await new Promise((r) => setTimeout(r, 600));
  check('1.26 nothing is paid past 199', (await coinTotal(u.capRef.id)) === 199, await ledger(u.capRef.id));
  check('1.27 the second contract still pays the referee 5 more', (await coinTotal(u.capReferee.id)) === 10, await coinTotal(u.capReferee.id));
  const capFlags = await adminRows(`/rest/v1/grow_coin_review_flags?select=kind,details&user_id=eq.${u.capRef.id}&kind=eq.monthly_earning_cap`);
  check('1.28 a monthly_earning_cap review flag is raised when the cap blocks a reward', capFlags.length >= 1, capFlags);

  // ── Client 100 earning cap ──────────────────────────────────────────────
  const ccCode = await codeOf(u.capCRef);
  await claim(u.capCReferee, ccCode);
  await seedCoins(u.capCRef.id, 96);
  await seedWallet(u.capCReferee, 40000);
  const clientCap = await openContract({ client: u.capCReferee, freelancer: u.t5, amount: 1000, title: 'TEST E2E — client cap 100' });
  await rpc('fund_escrow_from_wallet', { p_contract_id: clientCap.contractId, p_milestone_indices: null }, u.capCReferee.token);
  await rpc('mark_contract_delivered', { p_contract_id: clientCap.contractId }, u.t5.token);
  await rpc('release_escrow', { p_contract_id: clientCap.contractId, p_client_id: u.capCReferee.id }, u.capCReferee.token);
  const clientCapped = await until(() => coinTotal(u.capCRef.id), (v) => v >= 100);
  check('1.29 the client 100 cap pays only the remaining 4 coins', clientCapped === 100, { total: clientCapped, rows: await ledger(u.capCRef.id) });
  check('1.30 the referred client still gets the full 5 coins', (await coinTotal(u.capCReferee.id)) === 5, await coinTotal(u.capCReferee.id));

  // ═══════════════════════════════════════════════════════════════════════
  // PART 2 — ONE BIG TEAM PROJECT, TEN DIFFERENT SKILLS
  // ═══════════════════════════════════════════════════════════════════════
  await seedWallet(u.client, 100000);
  const tp = await api('/rest/v1/team_projects', u.client.token, {
    method: 'POST', prefer: 'return=representation',
    body: {
      client_id: u.client.id,
      title: 'TEST E2E — multi-skill team project',
      description: 'One big product build: ten roles, ten distinct skill sets, ten independent escrows.',
      total_budget_estimate: 10000,
    },
  });
  const teamProjectId = tp.json?.[0]?.id;
  check('2.1 one big team project created (₹10,000 estimate)', tp.status === 201 && !!teamProjectId, { status: tp.status, body: tp.json });

  const roleRes = await api('/rest/v1/team_project_roles', u.client.token, {
    method: 'POST', prefer: 'return=representation',
    body: SKILLED.map(([, title, skills]) => ({
      team_project_id: teamProjectId, role_title: title, required_skills: skills,
      budget_range_min: 900, budget_range_max: 1100,
    })),
  });
  check('2.2 ten roles created on the same project', roleRes.status === 201 && (roleRes.json || []).length === 10, { status: roleRes.status, body: roleRes.json });

  // The trigger fills suggested_freelancers for each role; re-read until stable.
  const roleRows = await until(
    () => rows(`/rest/v1/team_project_roles?select=id,role_title,required_skills,status,suggested_freelancers,matched_freelancer_id&team_project_id=eq.${teamProjectId}&order=created_at.asc`, u.client.token),
    (rr) => rr.length === 10 && rr.every((r) => Array.isArray(r.suggested_freelancers) && r.suggested_freelancers.length > 0),
    30, 300
  );
  check('2.3 every role has server-side AI suggestions', roleRows.length === 10 && roleRows.every((r) => (r.suggested_freelancers || []).length > 0),
    roleRows.map((r) => ({ role: r.role_title, n: (r.suggested_freelancers || []).length })));

  // Roles are inserted in one statement, so created_at ties can return in any
  // order. Resolve each role to its owner by its REQUIRED SKILLS, never by
  // array index, or the assertions below would test the wrong pairing.
  const skillKey = (list) => (list || []).map((s) => String(s).toLowerCase().trim()).sort().join('|');
  const rolePlan = roleRows.map((role) => {
    const meta = SKILLED.find(([, , skills]) => skillKey(skills) === skillKey(role.required_skills));
    if (!meta) throw new Error(`role has no matching skill set: ${role.role_title} ${JSON.stringify(role.required_skills)}`);
    return { role, key: meta[0], title: meta[1], skills: meta[2] };
  });
  check('2.3b all ten roles resolve to exactly one distinct skill set', new Set(rolePlan.map((p) => p.key)).size === 10, rolePlan.map((p) => p.key));

  let allTopCorrect = true;
  let anyWrongSuggestion = false;
  for (const { role, key, title, skills } of rolePlan) {
    const suggestions = role.suggested_freelancers || [];
    const top = suggestions[0];
    const expected = u[key].id;
    if (top?.freelancer_id !== expected) {
      allTopCorrect = false;
      console.log(`   ${title}: top=${top?.name} score=${top?.match_score} expected ${u[key].name}`);
    }
    // People with zero overlap of THIS role's skills must never be suggested.
    const lowerRequired = skills.map((s) => s.toLowerCase());
    const zeroOverlap = suggestions.filter((s) => {
      const meta = SKILLED.find(([k]) => u[k].id === s.freelancer_id);
      return !meta || !meta[2].some((sk) => lowerRequired.includes(sk.toLowerCase()));
    });
    if (zeroOverlap.length) anyWrongSuggestion = true;
  }
  check('2.4 each role\'s TOP match is the freelancer who really owns those skills', allTopCorrect,
    roleRows.map((r) => ({ role: r.role_title, top: r.suggested_freelancers?.[0]?.name, score: r.suggested_freelancers?.[0]?.match_score })));
  check('2.5 a freelancer with no skill overlap is never suggested', !anyWrongSuggestion,
    roleRows.map((r) => ({ role: r.role_title, people: (r.suggested_freelancers || []).map((s) => s.name) })));

  // Real-time: a skill edit must re-match the open roles without a manual call.
  await admin(`/rest/v1/freelancer_profiles?user_id=eq.${u.t1.id}`, {
    method: 'PATCH', body: { skills: ['React', 'TypeScript', 'Figma', 'UI Design'] },
  });
  const uiRole = roleRows.find((r) => r.role_title === 'UI Designer');
  const reMatched = await until(
    async () => (await row(`/rest/v1/team_project_roles?select=suggested_freelancers&id=eq.${uiRole.id}`, u.client.token))?.suggested_freelancers || [],
    (list) => list.some((s) => s.freelancer_id === u.t1.id),
    30, 300
  );
  check('2.6 a skill edit re-matches open roles in real time (t1 now suggested for UI Designer)',
    reMatched.some((s) => s.freelancer_id === u.t1.id), reMatched.map((s) => s.name));

  // Merit: is_pro must not change a single score.
  const backendRole = roleRows.find((r) => r.role_title === 'Backend Developer');
  const scoreBefore = (await row(`/rest/v1/team_project_roles?select=suggested_freelancers&id=eq.${backendRole.id}`, u.client.token))
    ?.suggested_freelancers?.find((s) => s.freelancer_id === u.t2.id)?.match_score;
  await admin(`/rest/v1/profiles?id=eq.${u.t2.id}`, { method: 'PATCH', body: { is_pro: true } });
  await api(`/rest/v1/team_project_roles?id=eq.${backendRole.id}`, u.client.token, { method: 'PATCH', body: { status: 'open' } });
  const scoreAfter = (await until(
    async () => (await row(`/rest/v1/team_project_roles?select=suggested_freelancers&id=eq.${backendRole.id}`, u.client.token))?.suggested_freelancers || [],
    (list) => list.some((s) => s.freelancer_id === u.t2.id),
    20, 300
  )).find((s) => s.freelancer_id === u.t2.id)?.match_score;
  check('2.7 is_pro does NOT change a match score (100% merit-based)', scoreBefore != null && scoreBefore === scoreAfter, { scoreBefore, scoreAfter });
  await admin(`/rest/v1/profiles?id=eq.${u.t2.id}`, { method: 'PATCH', body: { is_pro: false } });

  // Hire all ten seats with the matched specialists.
  const contracts = [];
  for (let i = 0; i < rolePlan.length; i++) {
    const { role, key } = rolePlan[i];
    const freelancerId = role.suggested_freelancers?.[0]?.freelancer_id;
    const hire = await rpc('create_team_role_contract', {
      p_team_project_id: teamProjectId, p_team_project_role_id: role.id,
      p_freelancer_id: freelancerId, p_amount: 1000, p_client_id: u.client.id,
    }, u.client.token);
    const contractId = typeof hire.json === 'string' ? hire.json : hire.json?.contract_id;
    contracts.push({ role, key, freelancerId, contractId });
    check(`2.8 seat ${i + 1}/10 hired — ${role.role_title} → ${role.suggested_freelancers?.[0]?.name}`,
      hire.status === 200 && !!contractId && freelancerId === u[key].id, { status: hire.status, body: hire.json });
  }
  check('2.9 ten seats became ten distinct contracts', new Set(contracts.map((x) => x.contractId)).size === 10);

  const contractRows = await rows(`/rest/v1/contracts?select=id,status,amount,platform_fee,freelancer_amount,team_project_role_id,team_project_id&id=in.(${contracts.map((x) => x.contractId).join(',')})`, u.client.token);
  check('2.10 every seat carries its own 5% fee and 95% net (₹1000 → ₹50 / ₹950)',
    contractRows.length === 10 && contractRows.every((r) => Number(r.amount) === 1000 && Number(r.platform_fee) === 50 && Number(r.freelancer_amount) === 950),
    contractRows);
  check('2.11 every contract is linked to its own role and the team project',
    new Set(contractRows.map((r) => r.team_project_role_id)).size === 10 && contractRows.every((r) => r.team_project_id === teamProjectId));

  const walletBefore = {};
  for (const cRow of contracts) walletBefore[cRow.freelancerId] = await wallet(u[cRow.key]);
  const clientBefore = await wallet(u.client);

  for (let i = 0; i < contracts.length; i++) {
    const { contractId, freelancerId, key } = contracts[i];
    const freelancerToken = u[key].token;
    const fundOne = await rpc('fund_escrow_from_wallet', { p_contract_id: contractId, p_milestone_indices: null }, u.client.token);
    const deliverOne = await rpc('mark_contract_delivered', { p_contract_id: contractId }, freelancerToken);
    const releaseOne = await rpc('release_escrow', { p_contract_id: contractId, p_client_id: u.client.id }, u.client.token);
    check(`2.12 seat ${i + 1}/10 funded → delivered → released on its own`,
      fundOne.json?.success === true && deliverOne.json?.success !== false && releaseOne.json === true,
      { fund: fundOne.json, deliver: deliverOne.json, release: releaseOne.json });
    if (i === 0) {
      const nextEscrow = await row(`/rest/v1/escrow?select=status&contract_id=eq.${contracts[1].contractId}`, u.client.token);
      check('2.13 seat 2 escrow is still pending while seat 1 is released (isolation)', nextEscrow?.status === 'pending', nextEscrow);
    }
    const after = await wallet({ id: freelancerId, token: freelancerToken });
    check(`2.14 seat ${i + 1} paid exactly ₹950 to ${u[key].name}`, after - walletBefore[freelancerId] === 950, { before: walletBefore[freelancerId], after });
  }
  const clientAfter = await wallet(u.client);
  check('2.15 the client was charged exactly ₹10,000 for ten seats', clientBefore - clientAfter === 10000, { before: clientBefore, after: clientAfter });

  const rolesFilled = await until(
    () => rows(`/rest/v1/team_project_roles?select=status,matched_freelancer_id&team_project_id=eq.${teamProjectId}`, u.client.token),
    (rr) => rr.length === 10 && rr.every((r) => r.status === 'filled'),
    20, 300
  );
  check('2.16 all ten roles are filled by ten different freelancers',
    rolesFilled.length === 10 && rolesFilled.every((r) => r.status === 'filled' && !!r.matched_freelancer_id) &&
      new Set(rolesFilled.map((r) => r.matched_freelancer_id)).size === 10, rolesFilled);
  const tpDone = await until(() => row(`/rest/v1/team_projects?select=status&id=eq.${teamProjectId}`, u.client.token), (r) => r?.status === 'completed', 20, 300);
  check('2.17 the team project closes as completed when every seat is paid', tpDone?.status === 'completed', tpDone);

  // ═══════════════════════════════════════════════════════════════════════
  // PART 3 — AI MATCHING WORKFLOW
  // ═══════════════════════════════════════════════════════════════════════
  const aiProject = await api('/rest/v1/projects', u.aiClient.token, {
    method: 'POST', prefer: 'return=representation',
    body: {
      client_id: u.aiClient.id, title: 'TEST E2E — AI matching workflow',
      description: 'Build a React + TypeScript dashboard with a Node API.',
      budget_min: 5000, budget_max: 5000, skills_required: ['React', 'TypeScript'],
      category: 'Development', status: 'open', experience_level: 'intermediate',
    },
  });
  const aiProjectId = aiProject.json?.[0]?.id;
  check('3.1 client posts a project that lists real skills', aiProject.status === 201 && !!aiProjectId, { status: aiProject.status, body: aiProject.json });

  const triggerMatches = await until(
    () => adminRows(`/rest/v1/ai_matches?select=freelancer_id,match_score,skill_score&project_id=eq.${aiProjectId}&order=match_score.desc`),
    (rr) => rr.length > 0,
    30, 300
  );
  check('3.2 posting the project triggers deterministic matches immediately', triggerMatches.length > 0, triggerMatches);
  const triggerTop = triggerMatches[0];
  check('3.3 the trigger\'s top match is the React + TypeScript freelancer',
    triggerTop?.freelancer_id === u.t1.id, { top: triggerTop, expected: u.t1.id });

  // The freelancer sees their own match through RLS and gets notified.
  const t1Matches = await until(
    () => rows(`/rest/v1/ai_matches?select=project_id,freelancer_id,match_score&project_id=eq.${aiProjectId}`, u.t1.token),
    (rr) => rr.length > 0,
    20, 300
  );
  check('3.4 the matched freelancer can read their own match row', t1Matches.some((m) => m.freelancer_id === u.t1.id), t1Matches);
  check('3.5 RLS never leaks another freelancer\'s match row', t1Matches.every((m) => m.freelancer_id === u.t1.id), t1Matches);
  const outsiderMatches = await rows(`/rest/v1/ai_matches?select=project_id,freelancer_id&project_id=eq.${aiProjectId}`, u.t5.token);
  check('3.6 an unrelated freelancer sees none of t1\'s matches', outsiderMatches.every((m) => m.freelancer_id === u.t5.id), outsiderMatches);
  const t1Notes = await rows(`/rest/v1/notifications?select=type,metadata&user_id=eq.${u.t1.id}&type=eq.new_match`, u.t1.token);
  check('3.7 the matched freelancer receives a real new_match notification',
    t1Notes.some((n) => n.metadata?.project_id === aiProjectId), t1Notes);

  // The edge function: owner-only, authenticated.
  const aiUrl = `${URL}/functions/v1/ai-matching`;
  const aiCall = async (token, projectId) => {
    const r = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ project_id: projectId }),
    });
    let json = null;
    try { json = await r.json(); } catch { /* empty */ }
    return { status: r.status, json };
  };
  const aiOwner = await aiCall(u.aiClient.token, aiProjectId);
  if (aiOwner.status === 404 && /not found/i.test(aiOwner.json?.error || '')) {
    note('ai-matching edge function is not deployed (404) — deterministic DB matching is still live; the client falls back to its local engine.');
    check('3.8 owner can run the AI matching endpoint', false, aiOwner.json);
  } else {
    check('3.8 owner can run the AI matching endpoint (HTTP 200, success)', aiOwner.status === 200 && aiOwner.json?.success === true, { status: aiOwner.status, body: aiOwner.json });
    check('3.9 the endpoint returned a ranked match list', (aiOwner.json?.matches || []).length > 0, (aiOwner.json?.matches || []).slice(0, 3));
    const sorted = (aiOwner.json?.matches || []).every((m, i, arr) => i === 0 || arr[i - 1].match_score >= m.match_score);
    check('3.10 matches are ordered by score (highest first)', sorted, (aiOwner.json?.matches || []).map((m) => m.match_score));
    const best = (aiOwner.json?.matches || [])[0];
    check('3.11 a React + TypeScript freelancer ranks first with a full skill score', best?.freelancer_id === u.t1.id && Number(best?.skill_score) === 100, best);
    note(aiOwner.json?.ai_enhanced ? 'AI semantic boost ran (edge gateway reachable).' : 'AI semantic boost unavailable — deterministic scores were used (matching still worked).');
    const stored = await adminRows(`/rest/v1/ai_matches?select=freelancer_id,match_score&project_id=eq.${aiProjectId}&order=match_score.desc`);
    check('3.12 the endpoint persisted the ranked matches', stored.length === (aiOwner.json?.matches || []).length, { stored: stored.length, returned: (aiOwner.json?.matches || []).length });
  }

  const nonOwner = await aiCall(u.cRef.token, aiProjectId);
  check('3.13 a different client cannot run AI matching on this project (404, no existence leak)', nonOwner.status === 404, { status: nonOwner.status, body: nonOwner.json });
  const anon = await aiCall(null, aiProjectId);
  check('3.14 an anonymous caller is rejected (401)', anon.status === 401, { status: anon.status, body: anon.json });

  // ── Teardown ────────────────────────────────────────────────────────────
  if (!KEEP) {
    for (const id of [...new Set(created)]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await adminRpc('delete_user_all_data', { p_user_id: id });
        if (r.status < 300) break;
      }
    }
    const left = (await listAuthUsers()).filter((x) => new RegExp(`^${PREFIX}\\.`, 'i').test(x.email || ''));
    check('4.1 all disposable accounts removed', left.length === 0, left.map((x) => x.email));
    const leftProjects = await adminRows(`/rest/v1/projects?select=id,title&title=like.TEST E2E*&client_id=in.(${[...new Set(created)].join(',')})`);
    check('4.2 no probe projects left behind', leftProjects.length === 0, leftProjects);
  } else {
    console.log('\n--keep: disposable accounts left in place for manual UI review.');
  }

  const passed = checks.length - fails.length;
  console.log(`\nREFERRAL CRITERIA + TEAM + AI ${fails.length === 0 ? 'PASS' : 'FAIL'} — ${passed}/${checks.length} checks`);
  if (notes.length) console.log(`Notes:\n- ${notes.join('\n- ')}`);
  if (fails.length) {
    console.log('Failed:', fails.join(' | '));
    process.exit(1);
  }
})().catch((err) => {
  console.error('Criteria probe crashed:', err?.message || err);
  process.exit(1);
});
