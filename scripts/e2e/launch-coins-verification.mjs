// ═══════════════════════════════════════════════════════════════════════════
// GROWLANZO — LAUNCH ECOSYSTEM LIVE PROBE
//
// Runs against the LINKED Supabase project with disposable, pre-confirmed
// accounts (service role; no mail is ever sent) and tears them down again.
//
// Proves on the real database:
//   1. freelancer referral earnings stop at 199 coins per calendar month;
//   2. client referral earnings stop at 100 coins per calendar month;
//   3. a client redeems 100 coins for ONE custom project posting, the project is
//      really created, and a second posting is refused;
//   4. a freelancer redeems 199 coins for Premium: subscription active,
//      profiles.is_pro true, duplicate redemption refused, expiry clears it;
//   5. verification submission RPCs are not callable by a signed-in user.
//
// Usage:
//   set -a; . ./.env; set +a
//   node scripts/e2e/launch-coins-verification.mjs
//   node scripts/e2e/launch-coins-verification.mjs --keep
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
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${JSON.stringify(detail)?.slice(0, 400)}`}`);
};

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
    created.push(id);
  } else {
    await admin(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { password: PW, email_confirm: true } });
    created.push(id);
  }
  await admin('/rest/v1/rpc/create_user_profile', {
    method: 'POST',
    body: { p_id: id, p_email: email, p_name: name, p_role: role, p_referral_code: CODE() },
  });
  await admin(`/rest/v1/profiles_private?id=eq.${id}`, { method: 'PATCH', body: { onboarding_completed: true } });
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
  if (!r.json?.access_token) throw new Error(`login ${user.email}: HTTP ${r.status}`);
  return { ...user, token: r.json.access_token };
}

const codeOf = async (u) => (await row(`/rest/v1/profiles_private?select=referral_code&id=eq.${u.id}`, u.token))?.referral_code;
const claim = (u, code) => rpc('process_referral', { p_referral_code: code, p_new_user_id: u.id, p_new_user_email: u.email }, u.token);

/** Test fixture: place coins in the ledger as only a server role can. */
async function seedCoins(userId, amount, reason = 'referral_project_reward', role = 'referrer') {
  const r = await admin('/rest/v1/grow_coin_ledger', {
    method: 'POST', prefer: 'return=minimal',
    body: { user_id: userId, amount, reason, metadata: { role, source: 'launch-e2e-seed' } },
  });
  if (r.status >= 300) throw new Error(`seed coins: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
}
const coins = async (userId, reason) =>
  (await admin(`/rest/v1/grow_coin_ledger?select=amount,reason,reference_id,created_at&user_id=eq.${userId}${reason ? `&reason=eq.${reason}` : ''}`)).json || [];
const wallet = async (u) => (await row(`/rest/v1/wallets?select=balance&user_id=eq.${u.id}`, u.token))?.balance;

async function seedWallet(u, balance) {
  await admin(`/rest/v1/wallets?user_id=eq.${u.id}`, { method: 'PATCH', body: { balance, escrow_balance: 0 } });
}

async function runContract({ client, freelancer, amount, title }) {
  const proj = await api('/rest/v1/projects', client.token, {
    method: 'POST', prefer: 'return=representation',
    body: {
      client_id: client.id, title, description: 'Disposable automated launch probe.',
      budget_min: amount, budget_max: amount, skills_required: ['Testing'], category: 'Development', status: 'open',
    },
  });
  const projectId = proj.json?.[0]?.id;
  if (!projectId) throw new Error(`project: HTTP ${proj.status} ${JSON.stringify(proj.json).slice(0, 200)}`);
  const prop = await api('/rest/v1/proposals', freelancer.token, {
    method: 'POST', prefer: 'return=representation',
    body: { project_id: projectId, freelancer_id: freelancer.id, message: 'Automated launch probe', proposed_rate: amount, rate_type: 'fixed', status: 'pending' },
  });
  const proposalId = prop.json?.[0]?.id;
  if (!proposalId) throw new Error(`proposal: HTTP ${prop.status} ${JSON.stringify(prop.json).slice(0, 200)}`);
  const made = await rpc('create_contract_with_escrow', {
    p_project_id: projectId, p_freelancer_id: freelancer.id, p_proposal_id: proposalId, p_amount: amount, p_client_id: client.id,
  }, client.token);
  const contractId = typeof made.json === 'string' ? made.json : made.json?.contract_id || made.json?.id;
  if (!contractId) throw new Error(`contract: HTTP ${made.status} ${JSON.stringify(made.json).slice(0, 300)}`);
  const fund = await rpc('fund_escrow_from_wallet', { p_contract_id: contractId, p_milestone_indices: null }, client.token);
  const deliver = await rpc('mark_contract_delivered', { p_contract_id: contractId }, freelancer.token);
  const release = await rpc('release_escrow', { p_contract_id: contractId, p_client_id: client.id }, client.token);
  return { projectId, contractId, fund, deliver, release };
}

(async () => {
  console.log(`Target: ${URL}\n`);

  // Clean leftovers from interrupted runs.
  const stale = (await listAuthUsers()).filter((u) => /^launch\..*@growlancer-test\.com$/i.test(u.email || ''));
  for (const u of stale) {
    await adminRpc('delete_user_all_data', { p_user_id: u.id });
  }

  // ── Fixtures ────────────────────────────────────────────────────────────
  const fx = {
    fRef: await ensureUser(`launch.fref@${DOMAIN}`, 'freelancer', 'Launch F Referrer'),
    fReferee: await ensureUser(`launch.freferee@${DOMAIN}`, 'freelancer', 'Launch F Referee'),
    fOther: await ensureUser(`launch.fother@${DOMAIN}`, 'freelancer', 'Launch F Other'),
    cRef: await ensureUser(`launch.cref@${DOMAIN}`, 'client', 'Launch C Referrer'),
    cReferee: await ensureUser(`launch.creferee@${DOMAIN}`, 'client', 'Launch C Referee'),
    cClient: await ensureUser(`launch.cclient@${DOMAIN}`, 'client', 'Launch C Client'),
    fPremium: await ensureUser(`launch.fpremium@${DOMAIN}`, 'freelancer', 'Launch F Premium'),
    cReward: await ensureUser(`launch.creward@${DOMAIN}`, 'client', 'Launch C Reward'),
    cPoor: await ensureUser(`launch.cpoor@${DOMAIN}`, 'client', 'Launch C Poor'),
    verifyUser: await ensureUser(`launch.verify@${DOMAIN}`, 'freelancer', 'Launch Verify User'),
  };
  const u = {};
  for (const [k, v] of Object.entries(fx)) u[k] = await login(v);
  check('disposable launch accounts signed in', Object.values(u).every((x) => !!x.token), Object.keys(u).length);

  // ── Referral links ─────────────────────────────────────────────────────
  const fCode = await codeOf(u.fRef);
  const cCode = await codeOf(u.cRef);
  check('freelancer referral link made with a real code', /^GRW-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(fCode), fCode);
  check('client referral link made with a real code', /^GRW-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(cCode), cCode);

  const fClaim = await claim(u.fReferee, fCode);
  const cClaim = await claim(u.cReferee, cCode);
  check('freelancer referral recorded in the database', fClaim.json?.success === true, fClaim.json);
  check('client referral recorded in the database', cClaim.json?.success === true, cClaim.json);

  const fRel = await row(`/rest/v1/referrals?select=referrer_id,referred_user_id,status&referred_user_id=eq.${u.fReferee.id}`, u.fRef.token);
  check('freelancer attribution is immutable and points at the referrer', fRel?.referrer_id === u.fRef.id && fRel?.referred_user_id === u.fReferee.id, fRel);
  const cRel = await row(`/rest/v1/referrals?select=referrer_id,status&referred_user_id=eq.${u.cReferee.id}`, u.cRef.token);
  check('client attribution points at the client referrer', cRel?.referrer_id === u.cRef.id, cRel);

  const selfClaim = await claim(u.fRef, fCode);
  check('self-referral refused', selfClaim.json?.success === false, selfClaim.json);
  const roleClaim = await claim(u.cClient, fCode);
  check('cross-role referral refused', roleClaim.json?.success === false && roleClaim.json?.error_code === 'role_mismatch', roleClaim.json);

  // ── 199-coin freelancer monthly earning cap ────────────────────────────
  await seedCoins(u.fRef.id, 195);
  const before = (await coins(u.fRef.id, 'referral_project_reward')).reduce((s, x) => s + Number(x.amount), 0);
  check('freelancer starts the month with 195 referrer coins', before === 195, before);

  await seedWallet(u.cClient, 50000);
  const run1 = await runContract({ client: u.cClient, freelancer: u.fReferee, amount: 1000, title: 'TEST E2E — freelancer cap probe' });
  check('cap probe contract funded / delivered / released',
    run1.fund.json?.success === true && run1.deliver.json?.success !== false && run1.release.json === true,
    { fund: run1.fund.json, deliver: run1.deliver.json, release: run1.release.json });

  const afterRows = await coins(u.fRef.id, 'referral_project_reward');
  const after = afterRows.reduce((s, x) => s + Number(x.amount), 0);
  check('freelancer referrer earned only the remaining 4 coins', after === 199, after);
  check('referee still received their full 5 coins',
    (await coins(u.fReferee.id, 'referral_project_reward')).some((x) => Number(x.amount) === 5),
    await coins(u.fReferee.id, 'referral_project_reward'));

  const run2 = await runContract({ client: u.cClient, freelancer: u.fReferee, amount: 1000, title: 'TEST E2E — freelancer cap second probe' });
  check('second cap probe settled', run2.release.json === true, run2.release.json);
  const capped = await coins(u.fRef.id, 'referral_project_reward');
  check('no further referrer coins after the 199 cap', capped.reduce((s, x) => s + Number(x.amount), 0) === 199, capped);

  // ── 100-coin client monthly earning cap ───────────────────────────────
  await seedCoins(u.cRef.id, 98);
  const cBefore = (await coins(u.cRef.id, 'referral_project_reward')).reduce((s, x) => s + Number(x.amount), 0);
  check('client starts the month with 98 referrer coins', cBefore === 98, cBefore);

  await seedWallet(u.cReferee, 50000);
  const cRun = await runContract({ client: u.cReferee, freelancer: u.fOther, amount: 1000, title: 'TEST E2E — client cap probe' });
  check('client cap probe settled', cRun.release.json === true, cRun.release.json);
  const cAfter = (await coins(u.cRef.id, 'referral_project_reward')).reduce((s, x) => s + Number(x.amount), 0);
  check('client referrer earned only the remaining 2 coins', cAfter === 100, cAfter);

  // ── Custom project reward: 100 coins → exactly one project ────────────
  await seedCoins(u.cReward.id, 100);
  const redeem = await rpc('redeem_grow_coins_for_custom_project', { p_idempotency_key: crypto.randomUUID() }, u.cReward.token);
  check('client redeems 100 coins for a custom project reward', redeem.json?.success === true && redeem.json?.coins === 100, redeem.json);

  const balanceAfterRedeem = (await coins(u.cReward.id)).reduce((s, x) => s + Number(x.amount), 0);
  check('exactly 100 coins were deducted', balanceAfterRedeem === 0, balanceAfterRedeem);

  const create = await rpc('create_custom_project_with_reward', {
    p_idempotency_key: crypto.randomUUID(),
    p_title: 'TEST E2E — custom project reward',
    p_description: 'Disposable automated custom project probe.',
    p_budget: 1500,
    p_category: 'Development',
    p_skills: ['Testing'],
    p_deadline: null,
    p_experience_level: 'intermediate',
    p_industry: null,
    p_visibility: 'private',
  }, u.cReward.token);
  check('custom project reward posts one real project', create.json?.success === true && !!create.json?.project_id, create.json);

  if (create.json?.project_id) {
    const project = await adminRow(`/rest/v1/projects?select=id,client_id,title,status&id=eq.${create.json.project_id}`);
    check('the project exists in the projects table', project?.id === create.json.project_id && project?.client_id === u.cReward.id, project);
    const usage = await adminRow(`/rest/v1/custom_project_rewards?select=status,project_id&user_id=eq.${u.cReward.id}`);
    check('the reward is marked used and tied to that project', usage?.status === 'used' && usage?.project_id === create.json.project_id, usage);
  }

  const reuse = await rpc('create_custom_project_with_reward', {
    p_idempotency_key: crypto.randomUUID(),
    p_title: 'TEST E2E — reuse attempt',
    p_description: 'Must be refused.',
    p_budget: 1500,
    p_category: 'Development',
    p_skills: [],
    p_deadline: null,
    p_experience_level: 'intermediate',
    p_industry: null,
    p_visibility: 'public',
  }, u.cReward.token);
  check('the same reward cannot post a second project', reuse.json?.success === false, reuse.json);

  const poorRedeem = await rpc('redeem_grow_coins_for_custom_project', { p_idempotency_key: crypto.randomUUID() }, u.cPoor.token);
  check('client without 100 coins cannot redeem', poorRedeem.json?.success === false, poorRedeem.json);

  // ── Premium: 199 coins → active subscription + PRO flag ───────────────
  await seedCoins(u.fPremium.id, 199);
  const premium = await rpc('redeem_grow_coins_for_premium', { p_idempotency_key: crypto.randomUUID() }, u.fPremium.token);
  check('freelancer redeems 199 coins for Premium', premium.json?.success === true && premium.json?.coins === 199, premium.json);

  const premiumBalance = (await coins(u.fPremium.id)).reduce((s, x) => s + Number(x.amount), 0);
  check('exactly 199 coins were deducted', premiumBalance === 0, premiumBalance);

  const sub = await adminRow(`/rest/v1/subscriptions?select=status,payment_provider,subscription_end_date&user_id=eq.${u.fPremium.id}&status=eq.active`);
  check('the subscription row is actually active', sub?.status === 'active' && !!sub?.subscription_end_date, sub);
  const prof = await row(`/rest/v1/profiles?select=is_pro&id=eq.${u.fPremium.id}`, u.fPremium.token);
  check('PRO flag is on for the active subscription', prof?.is_pro === true, prof);

  const duplicate = await rpc('redeem_grow_coins_for_premium', { p_idempotency_key: crypto.randomUUID() }, u.fPremium.token);
  check('duplicate Premium redemption refused', duplicate.json?.success === false, duplicate.json);

  // Expiry must clear the badge source (is_pro), which drives the green PRO badge.
  await admin(`/rest/v1/subscriptions?user_id=eq.${u.fPremium.id}`, {
    method: 'PATCH',
    body: { status: 'expired', subscription_end_date: new Date(Date.now() - 86400000).toISOString(), expiry_date: new Date(Date.now() - 86400000).toISOString() },
  });
  await adminRpc('sync_profile_pro_flag', { v_user_id: u.fPremium.id });
  const profAfter = await row(`/rest/v1/profiles?select=is_pro&id=eq.${u.fPremium.id}`, u.fPremium.token);
  check('expired subscription clears PRO', profAfter?.is_pro === false, profAfter);

  // ── Verification section is closed at the API, not just the UI ────────
  const verifyCall = await rpc('refresh_light_kyc', { p_full_name: 'Launch Probe' }, u.verifyUser.token);
  check('refresh_light_kyc is not callable by a signed-in user', verifyCall.status >= 400 && verifyCall.json?.success !== true, { status: verifyCall.status, json: verifyCall.json });
  const otpCall = await rpc('request_phone_otp', { p_phone: '+919876543210' }, u.verifyUser.token);
  check('request_phone_otp is not callable by a signed-in user', otpCall.status >= 400 && otpCall.json?.success !== true, { status: otpCall.status, json: otpCall.json });
  const verifyOtp = await rpc('verify_phone_otp', { p_phone: '+919876543210', p_code: '123456' }, u.verifyUser.token);
  check('verify_phone_otp is not callable by a signed-in user', verifyOtp.status >= 400 && verifyOtp.json?.success !== true, { status: verifyOtp.status, json: verifyOtp.json });

  // ── Teardown ──────────────────────────────────────────────────────────
  if (!KEEP) {
    for (const id of [...new Set(created)]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await adminRpc('delete_user_all_data', { p_user_id: id });
        if (r.status < 300) break;
      }
    }
    const left = (await listAuthUsers()).filter((x) => /^launch\..*@growlancer-test\.com$/i.test(x.email || ''));
    check('all launch probe accounts removed', left.length === 0, left.map((x) => x.email));
  } else {
    console.log('\n--keep: disposable accounts left in place for manual UI review.');
  }

  const passed = checks.length - fails.length;
  console.log(`\nLAUNCH PROBE ${fails.length === 0 ? 'PASS' : 'FAIL'} — ${passed}/${checks.length} checks`);
  if (fails.length) {
    console.log('Failed:', fails.join(' | '));
    process.exit(1);
  }
})().catch((err) => {
  console.error('Launch probe crashed:', err?.message || err);
  process.exit(1);
});
