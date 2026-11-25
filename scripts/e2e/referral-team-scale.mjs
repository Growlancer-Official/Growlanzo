// ═══════════════════════════════════════════════════════════════════════════
// GROWLANZO — REFERRAL CHAIN (1 → 5) + TEAM PROJECT (10 freelancers)
//
// Runs the two multi-user flows end to end against the LINKED Supabase project,
// using the same RPCs and RLS paths the app uses. It creates its own disposable
// accounts with the service role (email_confirm: true — no confirmation mail is
// ever sent), then deletes them again unless --keep is passed.
//
// Referral chain:
//   referrer invites ref1..ref5      → 5/5 accepted
//   ref6 tries the same code         → refused, monthly_cap (cap 5)
//   each referee completes a contract → referred + referrer each earn
//                                        10 coins (referral_bonus / referee_…)
//                                      +  5 coins (referral_project_reward)
//
// Team project:
//   client creates one project with 10 roles, hires 10 different freelancers
//   (the 5 referred ones included), funds/delivers/releases each seat
//   independently and proves one seat can never move another seat's money.
//
// Usage:
//   set -a; . ./.env; set +a
//   node scripts/e2e/referral-team-scale.mjs            # run + clean up
//   node scripts/e2e/referral-team-scale.mjs --keep     # leave data for manual UI checks
//
// Env: VITE_SUPABASE_URL (or SUPABASE_URL) + VITE_SUPABASE_ANON_KEY
//      + SUPABASE_SERVICE_ROLE_KEY. Nothing secret is printed.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';

const fileEnv = ['.env.local', '.env']
  .filter((f) => { try { return fs.existsSync(f); } catch { return false; } })
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || /VITE_SUPABASE_URL=(.+)/.exec(fileEnv)?.[1]?.trim();
const ANON = process.env.VITE_SUPABASE_ANON_KEY || /VITE_SUPABASE_ANON_KEY=(.+)/.exec(fileEnv)?.[1]?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || /SUPABASE_SERVICE_ROLE_KEY=(.+)/.exec(fileEnv)?.[1]?.trim();
if (!URL || !ANON || !SERVICE) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const DOMAIN = 'growlancer-test.com';
const PW = 'Test@1234';
const KEEP = process.argv.includes('--keep');
const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = () => {
  let s = '';
  for (let i = 0; i < 8; i++) s += REFERRAL_ALPHABET[Math.floor(Math.random() * REFERRAL_ALPHABET.length)];
  return `GRW-${s.slice(0, 4)}-${s.slice(4)}`;
};

const checks = [];
const fails = [];
const check = (name, cond, detail) => {
  checks.push({ name, pass: !!cond, ...(detail === undefined ? {} : { detail }) });
  if (!cond) fails.push(name);
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${JSON.stringify(detail)?.slice(0, 400)}`}`);
};

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function admin(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${URL}${path}`, { method, headers: svc, body: body === undefined ? undefined : JSON.stringify(body) });
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
const row = async (path, token) => {
  const r = await api(path, token);
  return Array.isArray(r.json) ? r.json[0] : r.json;
};

// ── Accounts ──────────────────────────────────────────────────────────────
async function listAuthUsers() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await admin(`/auth/v1/admin/users?per_page=200&page=${page}`);
    const users = Array.isArray(r.json) ? r.json : r.json?.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

async function ensureUser(email, role, name) {
  const existing = (await listAuthUsers()).find((u) => (u.email || '').toLowerCase() === email);
  let id = existing?.id;
  if (!id) {
    const created = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password: PW, email_confirm: true, user_metadata: { name, role } },
    });
    id = created.json?.id;
    if (!id) throw new Error(`create ${email} failed: HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
  } else {
    // Repair: known password + confirmed, so password login never depends on mail.
    await admin(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { password: PW, email_confirm: true } });
  }
  const prof = await admin('/rest/v1/rpc/create_user_profile', {
    method: 'POST',
    body: { p_id: id, p_email: email, p_name: name, p_role: role, p_referral_code: CODE() },
  });
  if (prof.status !== 200) throw new Error(`profile ${email}: HTTP ${prof.status} ${JSON.stringify(prof.json).slice(0, 200)}`);
  await admin(`/rest/v1/profiles_private?id=eq.${id}`, { method: 'PATCH', body: { onboarding_completed: true, updated_at: new Date().toISOString() } });
  await admin(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', body: { country: 'India', updated_at: new Date().toISOString() } });
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

async function wallet(user) {
  const r = await row(`/rest/v1/wallets?select=balance,escrow_balance&user_id=eq.${user.id}`, user.token);
  return { balance: Number(r?.balance ?? 0), escrow: Number(r?.escrow_balance ?? 0) };
}

async function seedWallet(user, balance) {
  await admin(`/rest/v1/wallets?user_id=eq.${user.id}`, { method: 'PATCH', body: { balance, escrow_balance: 0, updated_at: new Date().toISOString() } });
}

// Full contract cycle: project → proposal → contract → fund → deliver → release.
async function runContract({ client, freelancer, amount, title }) {
  const proj = await api('/rest/v1/projects', client.token, {
    method: 'POST', prefer: 'return=representation',
    body: {
      client_id: client.id, title, description: 'Disposable automated scale test.',
      budget_min: amount, budget_max: amount, skills_required: ['Testing'], category: 'Development', status: 'open',
    },
  });
  const projectId = proj.json?.[0]?.id;
  if (!projectId) throw new Error(`project: HTTP ${proj.status} ${JSON.stringify(proj.json).slice(0, 200)}`);

  const prop = await api('/rest/v1/proposals', freelancer.token, {
    method: 'POST', prefer: 'return=representation',
    body: { project_id: projectId, freelancer_id: freelancer.id, message: 'Automated scale test', proposed_rate: amount, rate_type: 'fixed', status: 'pending' },
  });
  const proposalId = prop.json?.[0]?.id;
  if (!proposalId) throw new Error(`proposal: HTTP ${prop.status} ${JSON.stringify(prop.json).slice(0, 200)}`);

  const created = await rpc('create_contract_with_escrow', {
    p_project_id: projectId, p_freelancer_id: freelancer.id, p_proposal_id: proposalId, p_amount: amount, p_client_id: client.id,
  }, client.token);
  const contractId = typeof created.json === 'string' ? created.json : created.json?.contract_id || created.json?.id;
  if (!contractId) throw new Error(`contract: HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 300)}`);

  const fund = await rpc('fund_escrow_from_wallet', { p_contract_id: contractId, p_milestone_indices: null }, client.token);
  const deliver = await rpc('mark_contract_delivered', { p_contract_id: contractId }, freelancer.token);
  const release = await rpc('release_escrow', { p_contract_id: contractId, p_client_id: client.id }, client.token);
  return { projectId, proposalId, contractId, fund, deliver, release };
}

const coins = async (userId, reason) =>
  (await admin(`/rest/v1/grow_coin_ledger?select=amount,reason,reference_id&user_id=eq.${userId}&reason=eq.${reason}`)).json || [];

(async () => {
  console.log(`Target: ${URL}\n`);

  // ── Seed ────────────────────────────────────────────────────────────────
  // Deterministic emails: remove leftovers from an interrupted earlier run
  // first. A stale referral row would answer "already referred" and poison
  // every assertion below, which is a harness-isolation bug, not a product one.
  const stale = (await listAuthUsers()).filter((u) => /^scale\..*@growlancer-test\.com$/i.test(u.email || ''));
  for (const u of stale) {
    await admin('/rest/v1/rpc/delete_user_all_data', { method: 'POST', body: { p_user_id: u.id } });
  }
  if (stale.length) console.log(`Removed ${stale.length} leftover scale account(s) from an earlier run.`);

  const client = await ensureUser(`scale.client@${DOMAIN}`, 'client', 'Scale Client');
  const client2 = await ensureUser(`scale.client2@${DOMAIN}`, 'client', 'Scale Client 2');
  const referrer = await ensureUser(`scale.referrer@${DOMAIN}`, 'freelancer', 'Scale Referrer');
  const refs = [];
  for (let i = 1; i <= 9; i++) refs.push(await ensureUser(`scale.ref${i}@${DOMAIN}`, 'freelancer', `Scale Referee ${i}`));

  const c1 = await login(client);
  const c2 = await login(client2);
  const referrerL = await login(referrer);
  const refL = [];
  for (const r of refs) refL.push(await login(r));
  check('12 disposable accounts created and signed in (2 clients + 10 freelancers)', !!c1.token && !!c2.token && !!referrerL.token && refL.every((r) => r.token));

  const codeOf = async (u) => (await row(`/rest/v1/profiles_private?select=referral_code&id=eq.${u.id}`, u.token))?.referral_code;
  const referrerCode = await codeOf(referrerL);
  const refereeCodes = [];
  for (const r of refL) refereeCodes.push(await codeOf(r));
  check('every account has a GRW-XXXX-XXXX code', /^GRW-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(referrerCode || '') && refereeCodes.every((c) => /^GRW-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c || '')), { referrerCode, refereeCodes });

  const claim = (u, code) => rpc('process_referral', { p_referral_code: code, p_new_user_id: u.id, p_new_user_email: u.email }, u.token);

  // ── Referral chain: 1 referrer → 5 freelancers ─────────────────────────
  for (let i = 0; i < 5; i++) {
    const r = await claim(refL[i], referrerCode);
    check(`referral ${i + 1}/5 accepted (remaining ${4 - i})`, r.json?.success === true && r.json?.remaining_this_month === 4 - i, r.json);
  }

  const sixth = await claim(refL[5], referrerCode);
  check('6th referral refused by the monthly cap (cap=5)', sixth.json?.success === false && sixth.json?.error_code === 'monthly_cap' && sixth.json?.cap === 5 && sixth.json?.used_this_month === 5, sixth.json);

  const dup = await claim(refL[0], referrerCode);
  check('same referee cannot be claimed twice', dup.json?.success === false && /already referred/i.test(dup.json?.error || ''), dup.json);

  const crossRole = await claim(c1, referrerCode);
  check('a client cannot use a freelancer code', crossRole.json?.success === false && crossRole.json?.error_code === 'role_mismatch', crossRole.json);

  const invalid = await claim(refL[6], 'GRW-0000-0000');
  check('invalid code refused', invalid.json?.success === false && /invalid/i.test(invalid.json?.error || ''), invalid.json);

  const self = await rpc('process_referral', { p_referral_code: refereeCodes[0], p_new_user_id: refL[0].id, p_new_user_email: refL[0].email }, refL[0].token);
  check('self-referral refused', self.json?.success === false, self.json);

  const statsRef = await row(`/rest/v1/referral_stats?select=total_referrals,valid_referrals,points&user_id=eq.${referrer.id}`, referrerL.token);
  check('referrer stats show 5 invites, 0 valid before any contract', Number(statsRef?.total_referrals) === 5 && Number(statsRef?.valid_referrals) === 0, statsRef);
  const usedThisMonth = await rpc('referral_invites_this_month', { p_user_id: referrer.id }, referrerL.token);
  check('invites-this-month reports 5', usedThisMonth.json === 5, usedThisMonth.json);

  // ── Rewards: each referee completes one contract ───────────────────────
  await seedWallet(c1, 20000);
  const refWalletBefore = [];
  for (const r of refL.slice(0, 5)) refWalletBefore.push((await wallet(r)).balance);

  const referralContracts = [];
  for (let i = 0; i < 5; i++) {
    const run = await runContract({
      client: c1, freelancer: refL[i], amount: 1000,
      title: `TEST E2E — referral reward for referee ${i + 1}`,
    });
    referralContracts.push(run.contractId);
    check(`referee ${i + 1}: escrow funded / delivered / released`,
      run.fund.json?.success === true && run.deliver.json?.success !== false && run.release.json === true,
      { fund: run.fund.json, deliver: run.deliver.json, release: run.release.json });
  }

  // Current published coin table (20270303000000): every completed project pays
  // 5 + 5 — the old 10-coin 'referral_bonus' / 'referee_referral_bonus' rows are
  // retired, and the one-time 5 + 5 now belongs to the KYC milestone below.
  for (let i = 0; i < 5; i++) {
    const project = await coins(refL[i].id, 'referral_project_reward');
    check(`referee ${i + 1} earned 5 project coins`,
      project.some((x) => Number(x.amount) === 5), project);
  }
  const referrerProject = await coins(referrer.id, 'referral_project_reward');
  check('referrer earned 5 coins × 5 completed projects', referrerProject.length === 5 && referrerProject.every((x) => Number(x.amount) === 5), referrerProject);
  const retiredReasons = [
    ...(await coins(referrer.id, 'referral_bonus')),
    ...(await coins(refL[0].id, 'referee_referral_bonus')),
  ];
  check('retired 10-coin reasons are never written', retiredReasons.length === 0, retiredReasons);

  // ── KYC milestone: 5 + 5 once, and the dashboard counters move ──────────
  const kyc = await admin('/rest/v1/identity_verifications', {
    method: 'POST', prefer: 'return=representation',
    body: {
      user_id: refL[0].id, document_type: 'national_id',
      document_url: 'https://example.test/automated-kyc.jpg',
      status: 'verified', verification_provider: 'manual',
      verified_at: new Date().toISOString(),
    },
  });
  check('KYC approval recorded for referee 1', kyc.status === 201, { status: kyc.status, body: kyc.json });

  const kycAward = await admin('/rest/v1/rpc/award_referral_bonus_if_eligible', {
    method: 'POST', body: { p_referred_user_id: refL[0].id },
  });
  // The verification trigger may already have settled the reward, so either a
  // fresh 5-coin award or an 'already_awarded' answer is correct here; the
  // ledger rows below are the real proof that both sides were paid.
  check('KYC milestone settles for both sides',
    kycAward.json?.success === true && (kycAward.json?.coins === 5 || kycAward.json?.already_awarded === true), kycAward.json);
  const refereeKyc = await coins(refL[0].id, 'kyc_bonus');
  const referrerKyc = await coins(referrer.id, 'kyc_bonus');
  check('both KYC ledger rows exist with 5 coins',
    refereeKyc.some((x) => Number(x.amount) === 5) && referrerKyc.some((x) => Number(x.amount) === 5), { refereeKyc, referrerKyc });

  const referralRow = await row(`/rest/v1/referrals?select=status,bonus_claimed&referred_user_id=eq.${refL[0].id}`, referrerL.token);
  check('referral marked completed + bonus_claimed', referralRow?.status === 'completed' && referralRow?.bonus_claimed === true, referralRow);

  const statsAfter = await row(`/rest/v1/referral_stats?select=total_referrals,valid_referrals,points&user_id=eq.${referrer.id}`, referrerL.token);
  check('dashboard counters move: 5 invites / 1 valid / 5 points',
    Number(statsAfter?.total_referrals) === 5 && Number(statsAfter?.valid_referrals) === 1 && Number(statsAfter?.points) === 5, statsAfter);

  const kycRetry = await admin('/rest/v1/rpc/award_referral_bonus_if_eligible', {
    method: 'POST', body: { p_referred_user_id: refL[0].id },
  });
  check('KYC reward retry is a no-op', kycRetry.json?.already_awarded === true && kycRetry.json?.coins === 0, kycRetry.json);
  const statsRetry = await row(`/rest/v1/referral_stats?select=valid_referrals,points&user_id=eq.${referrer.id}`, referrerL.token);
  check('retry did not inflate the counters', Number(statsRetry?.valid_referrals) === 1 && Number(statsRetry?.points) === 5, statsRetry);

  for (let i = 0; i < 5; i++) {
    const after = (await wallet(refL[i])).balance;
    check(`referee ${i + 1} wallet +950 (95% of ₹1000)`, after - refWalletBefore[i] === 950, { before: refWalletBefore[i], after });
  }

  const idempotent = await admin('/rest/v1/rpc/award_referral_project_reward', {
    method: 'POST', body: { p_contract_id: referralContracts[0] },
  });
  check('awarding the same contract again is a no-op', idempotent.status >= 400 || idempotent.json?.awarded === 0, { status: idempotent.status, body: idempotent.json });

  // ── Team project: 10 roles, 10 different freelancers ───────────────────
  const teamFreelancers = [referrerL, ...refL.slice(0, 9)]; // 10 distinct people
  check('team roster has 10 unique freelancers', new Set(teamFreelancers.map((f) => f.id)).size === 10);

  const tp = await api('/rest/v1/team_projects', c1.token, {
    method: 'POST', prefer: 'return=representation',
    body: {
      client_id: c1.id, title: 'TEST E2E — 10-role team project',
      description: 'Disposable project: one client, ten independent seats, ten separate escrows.',
      total_budget_estimate: 10000,
    },
  });
  const teamProjectId = tp.json?.[0]?.id;
  check('team project created with ₹10,000 estimate', tp.status === 201 && !!teamProjectId, { status: tp.status, body: tp.json });

  const roleTitles = [
    ['Frontend Developer', ['React', 'TypeScript']],
    ['Backend Developer', ['Node.js', 'PostgreSQL']],
    ['UI Designer', ['Figma', 'UI Design']],
    ['UX Researcher', ['User Research', 'Interviews']],
    ['QA Engineer', ['Playwright', 'Testing']],
    ['DevOps Engineer', ['Docker', 'CI/CD']],
    ['Content Writer', ['Copywriting', 'SEO']],
    ['SEO Specialist', ['SEO', 'Analytics']],
    ['Video Editor', ['Premiere Pro', 'Motion Graphics']],
    ['Data Analyst', ['SQL', 'Dashboards']],
  ];
  const rolesRes = await api('/rest/v1/team_project_roles', c1.token, {
    method: 'POST', prefer: 'return=representation',
    body: roleTitles.map(([role_title, required_skills]) => ({
      team_project_id: teamProjectId, role_title, required_skills, budget_range_min: 900, budget_range_max: 1100,
    })),
  });
  const roles = rolesRes.json || [];
  check('10 roles created on one team project', rolesRes.status === 201 && roles.length === 10 && new Set(roles.map((r) => r.id)).size === 10, { status: rolesRes.status, count: roles.length });

  const hijack = await rpc('create_team_role_contract', {
    p_team_project_id: teamProjectId, p_team_project_role_id: roles[0].id,
    p_freelancer_id: teamFreelancers[9].id, p_amount: 1000, p_client_id: c2.id,
  }, c2.token);
  check('another client cannot hire on this team project', hijack.status >= 400, { status: hijack.status, body: hijack.json });

  // Hire each seat with a different freelancer.
  const teamContracts = [];
  for (let i = 0; i < 10; i++) {
    const hire = await rpc('create_team_role_contract', {
      p_team_project_id: teamProjectId, p_team_project_role_id: roles[i].id,
      p_freelancer_id: teamFreelancers[i].id, p_amount: 1000, p_client_id: c1.id,
    }, c1.token);
    const contractId = typeof hire.json === 'string' ? hire.json : hire.json?.contract_id;
    teamContracts.push(contractId);
    check(`seat ${i + 1}/10 hired (${roles[i].role_title})`, hire.status === 200 && !!contractId, { status: hire.status, body: hire.json });
  }
  check('10 seats → 10 distinct contracts', new Set(teamContracts).size === 10);

  const rehire = await rpc('create_team_role_contract', {
    p_team_project_id: teamProjectId, p_team_project_role_id: roles[0].id,
    p_freelancer_id: teamFreelancers[1].id, p_amount: 1000, p_client_id: c1.id,
  }, c1.token);
  check('a filled seat cannot be re-hired', rehire.status >= 400, { status: rehire.status, body: rehire.json });

  const rows = [];
  for (const id of teamContracts) {
    rows.push(await row(`/rest/v1/contracts?select=id,status,amount,platform_fee,freelancer_amount,escrow_funded,team_project_role_id&id=eq.${id}`, c1.token));
  }
  check('every seat carries its own 5% fee and 95% net (₹1000 → ₹50 / ₹950)',
    rows.every((r) => Number(r?.amount) === 1000 && Number(r?.platform_fee) === 50 && Number(r?.freelancer_amount) === 950));
  check('each contract is linked to a different role',
    new Set(rows.map((r) => r?.team_project_role_id)).size === 10, rows.map((r) => r?.team_project_role_id));

  // A freelancer cannot deliver somebody else's seat.
  const wrongDeliver = await rpc('mark_contract_delivered', { p_contract_id: teamContracts[0] }, teamFreelancers[1].token);
  check("one freelancer cannot deliver another seat's contract", wrongDeliver.json?.success === false, { status: wrongDeliver.status, body: wrongDeliver.json });
  const wrongFund = await rpc('fund_escrow_from_wallet', { p_contract_id: teamContracts[0], p_milestone_indices: null }, c2.token);
  check("another client cannot fund this team's escrow", wrongFund.status >= 400, { status: wrongFund.status, body: wrongFund.json });

  const clientBeforeTeam = (await wallet(c1)).balance;
  const teamWalletBefore = [];
  for (const f of teamFreelancers) teamWalletBefore.push((await wallet(f)).balance);

  // Fund / deliver / release seat by seat.
  for (let i = 0; i < 10; i++) {
    const fund = await rpc('fund_escrow_from_wallet', { p_contract_id: teamContracts[i], p_milestone_indices: null }, c1.token);
    const deliver = await rpc('mark_contract_delivered', { p_contract_id: teamContracts[i] }, teamFreelancers[i].token);
    const release = await rpc('release_escrow', { p_contract_id: teamContracts[i], p_client_id: c1.id }, c1.token);
    check(`seat ${i + 1}/10 funded → delivered → released`,
      fund.json?.success === true && deliver.json?.success !== false && release.json === true,
      { fund: fund.json, deliver: deliver.json, release: release.json });

    // Prove isolation: later seats are untouched while earlier ones complete.
    if (i === 0) {
      const nextEscrow = await row(`/rest/v1/escrow?select=status&contract_id=eq.${teamContracts[1]}`, c1.token);
      check('seat 2 escrow is still pending while seat 1 is released', nextEscrow?.status === 'pending', nextEscrow);
    }
  }

  const clientAfterTeam = (await wallet(c1)).balance;
  check('client charged exactly ₹10,000 for 10 seats', clientBeforeTeam - clientAfterTeam === 10000, { before: clientBeforeTeam, after: clientAfterTeam });

  for (let i = 0; i < 10; i++) {
    const after = (await wallet(teamFreelancers[i])).balance;
    check(`seat ${i + 1} paid ₹950 to its own freelancer`, after - teamWalletBefore[i] === 950, { before: teamWalletBefore[i], after, role: roles[i].role_title });
  }

  const rolesNow = (await api(`/rest/v1/team_project_roles?select=id,role_title,status,matched_freelancer_id&team_project_id=eq.${teamProjectId}`, c1.token)).json || [];
  check('all 10 roles are filled by the hired freelancer',
    rolesNow.length === 10 && rolesNow.every((r) => r.status === 'filled' && !!r.matched_freelancer_id) && new Set(rolesNow.map((r) => r.matched_freelancer_id)).size === 10);

  const lookup = await rpc('get_team_role_contract', { p_role_id: roles[0].id, p_client_id: c1.id }, c1.token);
  check('role → contract lookup resolves the right contract', lookup.json?.id === teamContracts[0], lookup.json);

  const tpNow = await row(`/rest/v1/team_projects?select=id,status,title&id=eq.${teamProjectId}`, c1.token);
  check('team project readable and completed', tpNow?.id === teamProjectId && tpNow?.status === 'completed', tpNow);

  const statuses = (await api(`/rest/v1/contracts?select=id,status&id=in.(${teamContracts.join(',')})`, c1.token)).json || [];
  check('all 10 team contracts are completed', statuses.length === 10 && statuses.every((s) => s.status === 'completed'), statuses.map((s) => s.status));

  // ── Cleanup ────────────────────────────────────────────────────────────
  if (!KEEP) {
    console.log('\nCleaning up disposable accounts…');
    for (const u of [client, client2, referrer, ...refs]) {
      await admin('/rest/v1/rpc/delete_user_all_data', { method: 'POST', body: { p_user_id: u.id } });
    }
    const leftover = (await listAuthUsers()).filter((u) => (u.email || '').startsWith('scale.') && (u.email || '').endsWith(`@${DOMAIN}`));
    check('all disposable accounts removed', leftover.length === 0, leftover.map((u) => u.email));
  } else {
    console.log('\n--keep passed: accounts left in place.');
  }

  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n════════ ${pass}/${checks.length} checks passed, ${fails.length} failed ════════`);
  if (fails.length) console.log(fails.join('\n'));
  console.log(JSON.stringify({ pass, total: checks.length, fails, teamProjectId, referralContracts }, null, 2));
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error(`\n✗ run aborted: ${err.message}`);
  process.exit(1);
});
