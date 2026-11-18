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

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  return { status: r.status, token: j.access_token, user: j.user };
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

const c1 = await login('client-1.test@growlancer-test.com');
const c2 = await login('client-2.test@growlancer-test.com');
const f1 = await login('freelancer-1.test@growlancer-test.com');
const f2 = await login('freelancer-2.test@growlancer-test.com');
ok('team actors signed in', [c1, c2, f1, f2].every((s) => s.token));

const walletBeforeC1 = (await one(`/rest/v1/wallets?select=balance&user_id=eq.${c1.user.id}`, c1.token)).row?.balance;
const walletBeforeF1 = (await one(`/rest/v1/wallets?select=balance&user_id=eq.${f1.user.id}`, f1.token)).row?.balance;


// ── Create team project + two independent roles
const tp = await api('/rest/v1/team_projects', c1.token, {
  method: 'POST', prefer: 'return=representation',
  body: {
    client_id: c1.user.id,
    title: 'TEST E2E — Team Project (2 roles)',
    description: 'Disposable two-role team project.',
    total_budget_estimate: 10000,
  },
});
const teamProjectId = tp.json?.[0]?.id;
ok('create team project', tp.status === 201 && !!teamProjectId, { status: tp.status, body: tp.json });

const rolesRes = await api('/rest/v1/team_project_roles', c1.token, {
  method: 'POST', prefer: 'return=representation',
  body: [
    { team_project_id: teamProjectId, role_title: 'Frontend Developer', required_skills: ['React', 'TypeScript'], budget_range_min: 5000, budget_range_max: 6000 },
    { team_project_id: teamProjectId, role_title: 'UI Designer', required_skills: ['Figma', 'UI Design'], budget_range_min: 3000, budget_range_max: 4000 },
  ],
});
const roles = rolesRes.json || [];
const role1 = roles.find((r) => r.role_title === 'Frontend Developer');
const role2 = roles.find((r) => r.role_title === 'UI Designer');
ok('create two roles', rolesRes.status === 201 && !!role1?.id && !!role2?.id, { status: rolesRes.status, count: roles.length });

// Other client cannot attach a contract to this team project.
const hijack = await rpc('create_team_role_contract', {
  p_team_project_id: teamProjectId, p_team_project_role_id: role1.id,
  p_freelancer_id: f2.user.id, p_amount: 1000, p_client_id: c2.user.id,
}, c2.token);
ok('other client cannot hire on team project', hijack.status >= 400, { status: hijack.status, body: hijack.json });

// ── Hire both roles via the real RPC
const hire1 = await rpc('create_team_role_contract', {
  p_team_project_id: teamProjectId, p_team_project_role_id: role1.id,
  p_freelancer_id: f1.user.id, p_amount: 6000, p_client_id: c1.user.id,
}, c1.token);
const contract1 = typeof hire1.json === 'string' ? hire1.json : hire1.json?.contract_id;
ok('hire role 1', hire1.status === 200 && !!contract1, { status: hire1.status, body: hire1.json });

const hire2 = await rpc('create_team_role_contract', {
  p_team_project_id: teamProjectId, p_team_project_role_id: role2.id,
  p_freelancer_id: f2.user.id, p_amount: 4000, p_client_id: c1.user.id,
}, c1.token);
const contract2 = typeof hire2.json === 'string' ? hire2.json : hire2.json?.contract_id;
ok('hire role 2', hire2.status === 200 && !!contract2, { status: hire2.status, body: hire2.json });

const c1row = await one(`/rest/v1/contracts?select=id,status,amount,platform_fee,freelancer_amount,escrow_funded,team_project_id,team_project_role_id&id=eq.${contract1}`, c1.token);
const c2row = await one(`/rest/v1/contracts?select=id,status,amount,platform_fee,freelancer_amount,escrow_funded,team_project_id,team_project_role_id&id=eq.${contract2}`, c1.token);
ok('two independent contracts', c1row.row?.team_project_role_id === role1.id && c2row.row?.team_project_role_id === role2.id && c1row.row?.id !== c2row.row?.id, { c1: c1row.row, c2: c2row.row });
ok('team fee fields (role1: fee 300, net 5700)', Number(c1row.row?.platform_fee) === 300 && Number(c1row.row?.freelancer_amount) === 5700, c1row.row);
ok('role1 filled / role2 filled', (await one(`/rest/v1/team_project_roles?select=status,matched_freelancer_id&id=eq.${role1.id}`, c1.token)).row?.status === 'filled'
  && (await one(`/rest/v1/team_project_roles?select=status,matched_freelancer_id&id=eq.${role2.id}`, c1.token)).row?.status === 'filled');

// Cannot hire the same seat twice.
const rehire = await rpc('create_team_role_contract', {
  p_team_project_id: teamProjectId, p_team_project_role_id: role1.id,
  p_freelancer_id: f2.user.id, p_amount: 1000, p_client_id: c1.user.id,
}, c1.token);
ok('filled role cannot be re-hired', rehire.status >= 400, { status: rehire.status, body: rehire.json });

// Freelancer 2 cannot act on role 1's contract.
const wrongDeliver = await rpc('mark_contract_delivered', { p_contract_id: contract1 }, f2.token);
ok('f2 cannot deliver f1 contract', wrongDeliver.json?.success === false, { status: wrongDeliver.status, body: wrongDeliver.json });
const wrongFund = await rpc('fund_escrow_from_wallet', { p_contract_id: contract2, p_milestone_indices: null }, c2.token);
ok('c2 cannot fund c1 team escrow', wrongFund.status >= 400, { status: wrongFund.status, body: wrongFund.json });

// ── Fund ONLY role 1, deliver, release
const fund1 = await rpc('fund_escrow_from_wallet', { p_contract_id: contract1, p_milestone_indices: null }, c1.token);
ok('fund role1 escrow only', fund1.status === 200 && fund1.json?.success === true, { status: fund1.status, body: fund1.json });

const esc1Before = await one(`/rest/v1/escrow?select=status,amount&contract_id=eq.${contract1}`, c1.token);
const esc2Before = await one(`/rest/v1/escrow?select=status,amount&contract_id=eq.${contract2}`, c1.token);
ok('role1 escrow funded, role2 escrow untouched', esc1Before.row?.status === 'funded' && esc2Before.row?.status === 'pending', { role1: esc1Before.row, role2: esc2Before.row });

const deliver1 = await rpc('mark_contract_delivered', { p_contract_id: contract1 }, f1.token);
ok('f1 delivers role1', deliver1.status === 200, { status: deliver1.status, body: deliver1.json });
const release1 = await rpc('release_escrow', { p_contract_id: contract1, p_client_id: c1.user.id }, c1.token);
ok('release role1', release1.status === 200 && release1.json === true, { status: release1.status, body: release1.json });

const finalC1 = await one(`/rest/v1/contracts?select=status,escrow_funded&id=eq.${contract1}`, c1.token);
const finalC2 = await one(`/rest/v1/contracts?select=status,escrow_funded&id=eq.${contract2}`, c1.token);
ok('role1 completed, role2 still pending', finalC1.row?.status === 'completed' && finalC2.row?.status === 'pending', { role1: finalC1.row, role2: finalC2.row });

const walletAfterC1 = (await one(`/rest/v1/wallets?select=balance&user_id=eq.${c1.user.id}`, c1.token)).row?.balance;
const walletAfterF1 = (await one(`/rest/v1/wallets?select=balance&user_id=eq.${f1.user.id}`, f1.token)).row?.balance;
const walletF2 = (await one(`/rest/v1/wallets?select=balance&user_id=eq.${f2.user.id}`, f2.token)).row?.balance;
ok('client charged role1 amount only', Number(walletAfterC1) === Number(walletBeforeC1) - 6000, { before: walletBeforeC1, after: walletAfterC1 });
ok('f1 receives 95% (5700) of role1', Number(walletAfterF1) === Number(walletBeforeF1) + 5700, { before: walletBeforeF1, after: walletAfterF1 });
ok('f2 receives nothing (role2 unfunded)', Number(walletF2) === 0, { balance: walletF2 });

// Platform revenue and invoices are verified server-side by SQL after the run
// (client RLS intentionally does not expose the platform revenue table).

// Role → contract resolution and isolation
const byRole1 = await rpc('get_team_role_contract', { p_role_id: role1.id, p_client_id: c1.user.id }, c1.token);
const byRole2 = await rpc('get_team_role_contract', { p_role_id: role2.id, p_client_id: c1.user.id }, c1.token);
ok('client resolves both role contracts', byRole1.json?.id === contract1 && byRole2.json?.id === contract2, { role1: byRole1.json?.id, role2: byRole2.json?.id });
const f2Lookup = await rpc('get_team_role_contract', { p_role_id: role1.id, p_client_id: c1.user.id }, f2.token);
ok('f2 cannot resolve c1 team contract', f2Lookup.status >= 400 || f2Lookup.json === null, { status: f2Lookup.status, body: f2Lookup.json });
ok('role2 net stored as 3800', Number(c2row.row?.freelancer_amount) === 3800, c2row.row);

// Team project + role state readable by the owner
const tpNow = await one(`/rest/v1/team_projects?select=id,status,title&id=eq.${teamProjectId}`, c1.token);
ok('team project readable', tpNow.status === 200 && tpNow.row?.id === teamProjectId, tpNow.row);

console.log(JSON.stringify({ summary: { pass: out.filter((o) => o.pass).length, fail: fails.length, fails }, teamProjectId, role1: role1.id, role2: role2.id, contract1, contract2, out }, null, 2));
process.exit(fails.length ? 1 : 0);
