import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const URL = /VITE_SUPABASE_URL=(.+)/.exec(env)[1].trim();
const ANON = /VITE_SUPABASE_ANON_KEY=(.+)/.exec(env)[1].trim();
const PW = 'Test@1234';
const out = [];
const fails = [];
const ok = (name, cond, detail) => {
  out.push({ name, pass: !!cond, ...(detail !== undefined ? { detail } : {}) });
  if (!cond) fails.push(name);
};

async function login(n) {
  const email = `${n}.test@growlancer-test.com`;
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  return { email, status: r.status, token: j.access_token, user: j.user };
}
async function api(path, token, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, json: j };
}
const rpc = (fn, body, token) => api(`/rest/v1/rpc/${fn}`, token, { method: 'POST', body });
const one = async (path, token) => {
  const r = await api(path, token);
  return { status: r.status, row: Array.isArray(r.json) ? r.json[0] : r.json };
};

const f = {};
for (let i = 1; i <= 9; i++) f[i] = await login(`freelancer-${i}`);
const c1 = await login('client-1');
const c2 = await login('client-2');
ok('referral actors signed in', [...Object.values(f), c1, c2].every((s) => s.token));

// Own code only (RLS) — this is what the dashboard/share card reads.
const codes = {};
for (const [k, s] of Object.entries({ ...f, c1, c2 })) {
  const r = await one(`/rest/v1/profiles_private?select=referral_code&id=eq.${s.user.id}`, s.token);
  codes[k] = r.row?.referral_code;
}
const allCodes = Object.values(codes);
ok('every code is GRW-XXXX-XXXX', allCodes.every((c) => /^GRW-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c || '')), codes);
ok('codes use the unambiguous alphabet', allCodes.every((c) => !/[01OILU]/.test((c || '').slice(4).replace(/-/g, ''))), codes);

const ref = (s, code) => rpc('process_referral', {
  p_referral_code: code,
  p_new_user_id: s.user.id,
  p_new_user_email: s.email,
}, s.token);

// ── Gate matrix
const first = await ref(f[3], codes[2]);
ok('same-role referral succeeds', first.json?.success === true && first.json?.remaining_this_month === 4, first.json);

const dup = await ref(f[3], codes[2]);
ok('duplicate referral rejected', dup.json?.success === false && /already referred/i.test(dup.json?.error || ''), dup.json);

const self = await ref(f[3], codes[3]);
ok('self-referral rejected', self.json?.success === false, self.json);

const crossRole = await ref(c1, codes[2]);
ok('client cannot use freelancer code', crossRole.json?.success === false && crossRole.json?.error_code === 'role_mismatch', crossRole.json);

const bad = await ref(f[4], 'GRW-0000-0000');
ok('invalid code rejected', bad.json?.success === false && /invalid/i.test(bad.json?.error || ''), bad.json);

// ── Monthly cap: f2 already has f3, add f4..f7 = 5, then f8 must be refused.
for (const i of [4, 5, 6, 7]) {
  const r = await ref(f[i], codes[2]);
  ok(`f2 invites freelancer-${i}`, r.json?.success === true, r.json);
}
const capped = await ref(f[8], codes[2]);
ok('6th invite in the month is capped', capped.json?.success === false && capped.json?.error_code === 'monthly_cap' && capped.json?.cap === 5 && capped.json?.used_this_month === 5, capped.json);

const otherReferrer = await ref(f[8], codes[1]);
ok('cap is per referrer, not global', otherReferrer.json?.success === true, otherReferrer.json);

// A user already claimed by one referrer cannot be claimed by another.
const secondClaim = await ref(f[3], codes[1]);
ok('second referrer for same user rejected cleanly', secondClaim.status === 200 && secondClaim.json?.success === false, { status: secondClaim.status, body: secondClaim.json });

// ── Direct PostgREST writes must be impossible
const directInsert = await api('/rest/v1/referrals', f[9].token, {
  method: 'POST', prefer: 'return=representation',
  body: { referrer_id: f[9].user.id, referred_user_id: f[8].user.id, referred_email: f[8].email, referral_code: codes[9], status: 'pending' },
});
ok('direct referral INSERT blocked', directInsert.status >= 400, { status: directInsert.status, body: directInsert.json });

const myReferral = await one(`/rest/v1/referrals?select=id,status,bonus_claimed&referred_user_id=eq.${f[3].user.id}`, f[3].token);
const directUpdate = await api(`/rest/v1/referrals?id=eq.${myReferral.row?.id}`, f[3].token, {
  method: 'PATCH', prefer: 'return=representation', body: { status: 'completed', bonus_claimed: true },
});
const updatedRows = directUpdate.json || [];
ok('referee cannot self-complete referral', directUpdate.status >= 400 || updatedRows.length === 0 || updatedRows[0]?.status === 'pending', { status: directUpdate.status, rows: updatedRows.length });

const statsInsert = await api('/rest/v1/referral_stats', f[9].token, {
  method: 'POST', prefer: 'return=representation',
  body: { user_id: f[9].user.id, total_referrals: 999, valid_referrals: 999, points: 999, level: 99 },
});
ok('user cannot insert own referral stats', statsInsert.status >= 400, { status: statsInsert.status, body: statsInsert.json });
const statsPatch = await api(`/rest/v1/referral_stats?user_id=eq.${f[9].user.id}`, f[9].token, {
  method: 'PATCH', prefer: 'return=representation', body: { total_referrals: 999, points: 999 },
});
ok('user cannot inflate own referral stats', statsPatch.status >= 400 || (statsPatch.json || []).length === 0, { status: statsPatch.status, body: statsPatch.json });

// ── Dashboard-side numbers
const stats = await one(`/rest/v1/referral_stats?select=total_referrals,valid_referrals,level&user_id=eq.${f[2].user.id}`, f[2].token);
ok('referral stats count 5 invites', Number(stats.row?.total_referrals) === 5, stats.row);
const used = await rpc('referral_invites_this_month', { p_user_id: f[2].user.id }, f[2].token);
ok('invites-this-month reports 5', used.json === 5, used.json);

// ── Completed contract for a referred freelancer pays 5 + 5 coins
const proj = await api('/rest/v1/projects', c2.token, {
  method: 'POST', prefer: 'return=representation',
  body: {
    client_id: c2.user.id, title: 'TEST E2E — Referral reward contract',
    description: 'Disposable referral reward test.', budget_min: 2500, budget_max: 3500,
    skills_required: ['Figma'], category: 'Design', status: 'open',
  },
});
const projectId = proj.json?.[0]?.id;
ok('reward project created', proj.status === 201 && !!projectId, { status: proj.status, body: proj.json });

const prop = await api('/rest/v1/proposals', f[3].token, {
  method: 'POST', prefer: 'return=representation',
  body: { project_id: projectId, freelancer_id: f[3].user.id, message: 'Referral reward E2E', proposed_rate: 3000, rate_type: 'fixed', status: 'pending' },
});
const proposalId = prop.json?.[0]?.id;
ok('reward proposal created', prop.status === 201 && !!proposalId, { status: prop.status });

const created = await rpc('create_contract_with_escrow', {
  p_project_id: projectId, p_freelancer_id: f[3].user.id, p_proposal_id: proposalId, p_amount: 3000, p_client_id: c2.user.id,
}, c2.token);
const contractId = typeof created.json === 'string' ? created.json : created.json?.contract_id || created.json?.id;
ok('reward contract created', created.status === 200 && !!contractId, { status: created.status, body: created.json });

const fund = await rpc('fund_escrow_from_wallet', { p_contract_id: contractId, p_milestone_indices: null }, c2.token);
ok('reward escrow funded', fund.status === 200 && fund.json?.success === true, { status: fund.status, body: fund.json });
const deliver = await rpc('mark_contract_delivered', { p_contract_id: contractId }, f[3].token);
ok('referred freelancer delivers', deliver.json?.success !== false, { status: deliver.status, body: deliver.json });
const release = await rpc('release_escrow', { p_contract_id: contractId, p_client_id: c2.user.id }, c2.token);
ok('reward release completes', release.status === 200 && release.json === true, { status: release.status, body: release.json });

const f3wallet = await one(`/rest/v1/wallets?select=balance&user_id=eq.${f[3].user.id}`, f[3].token);
const c2wallet = await one(`/rest/v1/wallets?select=balance&user_id=eq.${c2.user.id}`, c2.token);
ok('referred freelancer receives 2850 (95%)', Number(f3wallet.row?.balance) === 2850, f3wallet.row);
ok('client pays 3000', Number(c2wallet.row?.balance) === 1000, c2wallet.row);

const ledgerF3 = await api(`/rest/v1/grow_coin_ledger?select=amount,reason,reference_id&user_id=eq.${f[3].user.id}&reason=eq.referral_project_reward`, f[3].token);
const ledgerF2 = await api(`/rest/v1/grow_coin_ledger?select=amount,reason,reference_id&user_id=eq.${f[2].user.id}&reason=eq.referral_project_reward`, f[2].token);
ok('referred user earns 5 coins', (ledgerF3.json || []).some((r) => r.reference_id === contractId && Number(r.amount) === 5), ledgerF3.json);
ok('referrer earns 5 coins', (ledgerF2.json || []).some((r) => r.reference_id === contractId && Number(r.amount) === 5), ledgerF2.json);

const idempotent = await rpc('award_referral_project_reward', { p_contract_id: contractId }, c2.token);
ok('reward is idempotent', idempotent.status >= 400 || idempotent.json?.awarded === 0, { status: idempotent.status, body: idempotent.json });

console.log(JSON.stringify({ summary: { pass: out.filter((o) => o.pass).length, fail: fails.length, fails }, contractId, projectId, codes, out }, null, 2));
process.exit(fails.length ? 1 : 0);
