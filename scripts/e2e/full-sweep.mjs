// ═══════════════════════════════════════════════════════════════════════════
// GROWLANZO — FULL LIVE SWEEP (marketplace core + auth + money + security)
//
// One runnable proof that walks the whole paid-contract surface against the
// LINKED Supabase project with real JWTs, the same RPCs and the same RLS the
// app uses. It seeds its own confirmed accounts (service role, email_confirm:
// true — no confirmation mail is ever sent), exercises every happy path plus
// the negative control for each one, and deletes everything again.
//
// Covered here (the multi-user scale flows live in referral-team-scale.mjs and
// the curated escape set in pentest-privileges.mjs — run-all.mjs chains all):
//   A  auth        unconfirmed login refused → confirm → sign-in, wrong
//                  password, refresh, sign-out revokes refresh, public profile
//   B  project     create, edit, browse, cross-user edit/delete refused
//   C  proposal    submit, duplicate refused, cross-user edit refused,
//                  proposal count, accept-and-hire authorization
//   D  contract    server-derived 5% fee, start/deliver ownership, messages,
//                  direct wallet/contract writes blocked, notifications RLS
//   E  money       fund → release, exact debit, 95% net, platform revenue,
//                  invoice, idempotent release, double release refused
//   F  reviews     pre-completion refused, both directions, duplicate refused,
//                  outsider refused, reputation recalculated
//   G  dispute     client raise, escrow frozen, outsider refused
//   H  admin       non-admin admin-data refused, admin allowed
//   I  teardown    every disposable account + row gone, counters unchanged
//
// Usage:
//   set -a; . ./.env; . ./.env.local; set +a
//   node scripts/e2e/full-sweep.mjs            # run + clean up
//   node scripts/e2e/full-sweep.mjs --keep     # leave data for manual UI checks
//
// Env: VITE_SUPABASE_URL (or SUPABASE_URL) + VITE_SUPABASE_ANON_KEY
//      + SUPABASE_SERVICE_ROLE_KEY. Nothing secret is printed.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import crypto from 'node:crypto';

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
const RUN = crypto.randomBytes(3).toString('hex');

const checks = [];
const fails = [];
function check(name, cond, detail) {
  checks.push({ name, pass: !!cond, ...(detail === undefined ? {} : { detail }) });
  if (!cond) fails.push(name);
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);
}

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
const row = async (path, token) => {
  const r = await api(path, token);
  return Array.isArray(r.json) ? r.json[0] : r.json;
};
const edge = async (fn, body, token, method = 'POST') => {
  const r = await fetch(`${URL}/functions/v1/${fn}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
};

// ── accounts ──────────────────────────────────────────────────────────────
async function listAuthUsers() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await admin(`/auth/v1/admin/users?per_page=200&page=${page}`);
    const users = Array.isArray(r.json) ? r.json : r.json?.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

async function ensureUser(email, role, name) {
  const existing = (await listAuthUsers()).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
  let id = existing?.id;
  if (!id) {
    const created = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password: PW, email_confirm: true, user_metadata: { name, role } },
    });
    id = created.json?.id;
    if (!id) throw new Error(`create ${email} failed: HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
  } else {
    await admin(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { password: PW, email_confirm: true } });
  }
  const prof = await admin('/rest/v1/rpc/create_user_profile', {
    method: 'POST',
    body: { p_id: id, p_email: email, p_name: name, p_role: role, p_referral_code: 'GRW-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8) },
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

async function login(email, password = PW) {
  const r = await api('/auth/v1/token?grant_type=password', null, { method: 'POST', body: { email, password } });
  return { status: r.status, json: r.json, token: r.json?.access_token };
}
async function signIn(user, password = PW) {
  const r = await login(user.email, password);
  if (!r.token) throw new Error(`login ${user.email}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return { ...user, token: r.token, refresh: r.json.refresh_token };
}
const wallet = async (u) => {
  const r = await row(`/rest/v1/wallets?select=balance,escrow_balance&user_id=eq.${u.id}`, u.token);
  return { balance: Number(r?.balance ?? 0), escrow: Number(r?.escrow_balance ?? 0) };
};
const seedWallet = (u, balance) =>
  admin(`/rest/v1/wallets?user_id=eq.${u.id}`, { method: 'PATCH', body: { balance, escrow_balance: 0, updated_at: new Date().toISOString() } });

async function makeProject(client, title, amount, extra = {}) {
  const r = await api('/rest/v1/projects', client.token, {
    method: 'POST', prefer: 'return=representation',
    body: {
      client_id: client.id, title, description: 'Disposable automated full-sweep project.',
      budget_min: amount, budget_max: amount, skills_required: ['Testing'], category: 'Development',
      status: 'open', ...extra,
    },
  });
  return { status: r.status, project: r.json?.[0] };
}
async function makeProposal(freelancer, projectId, amount) {
  const r = await api('/rest/v1/proposals', freelancer.token, {
    method: 'POST', prefer: 'return=representation',
    body: { project_id: projectId, freelancer_id: freelancer.id, message: 'Automated full sweep', proposed_rate: amount, rate_type: 'fixed', status: 'pending' },
  });
  return { status: r.status, proposal: r.json?.[0] };
}
async function makeContract(client, freelancer, projectId, proposalId, amount) {
  const r = await rpc('create_contract_with_escrow', {
    p_project_id: projectId, p_freelancer_id: freelancer.id, p_proposal_id: proposalId, p_amount: amount, p_client_id: client.id,
  }, client.token);
  const id = typeof r.json === 'string' ? r.json : r.json?.contract_id || r.json?.id;
  return { status: r.status, json: r.json, id };
}

(async () => {
  console.log(`Target: ${URL}\nRun id: ${RUN}`);
  const accounts = [];
  const createdProjectIds = [];
  const createdContractIds = [];

  try {
    // ══ A. AUTH ═══════════════════════════════════════════════════════════
    section('A. Auth, session, profile');
    const unconfirmedEmail = `sweep.unconfirmed.${RUN}@${DOMAIN}`;
    const unconfirmed = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: { email: unconfirmedEmail, password: PW, email_confirm: false, user_metadata: { name: 'Sweep Unconfirmed', role: 'freelancer' } },
    });
    const unconfirmedId = unconfirmed.json?.id;
    accounts.push({ id: unconfirmedId, email: unconfirmedEmail, role: 'freelancer', name: 'Sweep Unconfirmed' });
    check('unconfirmed account created without sending mail', unconfirmed.status === 200 && !!unconfirmedId, unconfirmed.json);
    const blocked = await login(unconfirmedEmail);
    check('unconfirmed account cannot sign in (email verification is real)',
      blocked.status >= 400 && /confirm/i.test(JSON.stringify(blocked.json)), { status: blocked.status, body: blocked.json });
    await admin(`/auth/v1/admin/users/${unconfirmedId}`, { method: 'PUT', body: { email_confirm: true } });
    const afterConfirm = await login(unconfirmedEmail);
    check('after confirmation the same account signs in', afterConfirm.status === 200 && !!afterConfirm.token, { status: afterConfirm.status });

    const cA = await ensureUser(`sweep.client.${RUN}@${DOMAIN}`, 'client', `Sweep Client ${RUN}`);
    const cB = await ensureUser(`sweep.client2.${RUN}@${DOMAIN}`, 'client', `Sweep Client B ${RUN}`);
    const fA = await ensureUser(`sweep.freelancer.${RUN}@${DOMAIN}`, 'freelancer', `Sweep Freelancer ${RUN}`);
    const fB = await ensureUser(`sweep.freelancer2.${RUN}@${DOMAIN}`, 'freelancer', `Sweep Freelancer B ${RUN}`);
    const outsider = await ensureUser(`sweep.outsider.${RUN}@${DOMAIN}`, 'freelancer', `Sweep Outsider ${RUN}`);
    accounts.push(cA, cB, fA, fB, outsider);
    const cAt = await signIn(cA), cBt = await signIn(cB), fAt = await signIn(fA), fBt = await signIn(fB), outT = await signIn(outsider);
    check('5 disposable accounts created and signed in', !!cAt.token && !!cBt.token && !!fAt.token && !!fBt.token && !!outT.token);

    const wrongPw = await login(cA.email, 'WrongPassword!123');
    check('wrong password refused', wrongPw.status >= 400 && !wrongPw.token, { status: wrongPw.status });
    const unknown = await login(`nobody.${RUN}@${DOMAIN}`);
    check('unknown email refused', unknown.status >= 400 && !unknown.token, { status: unknown.status });

    const refreshed = await api('/auth/v1/token?grant_type=refresh_token', null, {
      method: 'POST', body: { refresh_token: cAt.refresh },
    });
    check('refresh token issues a new session', refreshed.status === 200 && !!refreshed.json?.access_token);
    const signedOut = await api('/auth/v1/logout', cAt.token, { method: 'POST' });
    check('sign-out accepted', signedOut.status === 204 || signedOut.status === 200, { status: signedOut.status });
    const deadRefresh = await api('/auth/v1/token?grant_type=refresh_token', null, {
      method: 'POST', body: { refresh_token: cAt.refresh },
    });
    check('sign-out revokes the old refresh token', deadRefresh.status >= 400, { status: deadRefresh.status });
    // The access token itself is stateless; continue the run with a fresh one.
    const cAt2 = await signIn(cA);

    const publicProfile = await api(`/rest/v1/profiles?select=id,name,role&id=eq.${fA.id}`, null);
    check('public freelancer profile readable signed-out', publicProfile.status === 200 && publicProfile.json?.[0]?.name === fA.name, publicProfile.json);
    const privateRead = await api(`/rest/v1/profiles_private?select=email,is_admin&id=eq.${fA.id}`, cBt.token);
    check("a peer cannot read another user's profiles_private row", (privateRead.json || []).length === 0, privateRead.json);
    const walletPeek = await api(`/rest/v1/wallets?select=balance&user_id=eq.${fA.id}`, cBt.token);
    check("a peer cannot read another user's wallet", (walletPeek.json || []).length === 0, walletPeek.json);
    const anonPrivate = await api('/rest/v1/profiles_private?select=email', null);
    check('anonymous cannot read profiles_private', anonPrivate.status === 401 || (anonPrivate.json || []).length === 0, { status: anonPrivate.status, body: anonPrivate.json });

    // ══ B. PROJECT ════════════════════════════════════════════════════════
    section('B. Project create / edit / browse');
    const p1 = await makeProject(cAt2, `TEST E2E — full sweep ${RUN}`, 10000);
    const project1 = p1.project;
    createdProjectIds.push(project1?.id);
    check('client posts a ₹10,000 project', p1.status === 201 && !!project1?.id && Number(project1.budget_max) === 10000, { status: p1.status, body: p1.project });

    const browse = await api(`/rest/v1/projects?select=id,title,status&status=eq.open&id=eq.${project1.id}`, fAt.token);
    check('freelancer sees the open project in the marketplace', browse.status === 200 && browse.json?.[0]?.id === project1.id, browse.json);

    const hijackEdit = await api(`/rest/v1/projects?id=eq.${project1.id}`, cBt.token, {
      method: 'PATCH', prefer: 'return=representation', body: { title: 'HIJACKED' },
    });
    const afterHijack = await row(`/rest/v1/projects?select=title&id=eq.${project1.id}`, cAt2.token);
    check("another client cannot edit this project", (hijackEdit.json || []).length === 0 && afterHijack?.title !== 'HIJACKED', { status: hijackEdit.status, body: hijackEdit.json, title: afterHijack?.title });

    const freelancerEdit = await api(`/rest/v1/projects?id=eq.${project1.id}`, fAt.token, {
      method: 'PATCH', prefer: 'return=representation', body: { status: 'closed' },
    });
    const afterFreelancerEdit = await row(`/rest/v1/projects?select=status&id=eq.${project1.id}`, cAt2.token);
    check("a freelancer cannot close someone else's project",
      (freelancerEdit.json || []).length === 0 && afterFreelancerEdit?.status === 'open',
      { status: freelancerEdit.status, body: freelancerEdit.json, current: afterFreelancerEdit?.status });

    const ownerEdit = await api(`/rest/v1/projects?id=eq.${project1.id}`, cAt2.token, {
      method: 'PATCH', prefer: 'return=representation', body: { description: 'Updated by the owner.' },
    });
    check('the owner can edit their own project', ownerEdit.status === 200 && ownerEdit.json?.[0]?.description === 'Updated by the owner.', { status: ownerEdit.status });

    // ══ C. PROPOSAL ═══════════════════════════════════════════════════════
    section('C. Proposal + hire authorization');
    const prop1 = await makeProposal(fAt, project1.id, 10000);
    check('freelancer submits a ₹10,000 proposal', prop1.status === 201 && !!prop1.proposal?.id, { status: prop1.status, body: prop1.proposal });

    const duplicate = await makeProposal(fAt, project1.id, 9000);
    check('the same freelancer cannot submit twice', duplicate.status >= 400, { status: duplicate.status, body: duplicate.json });

    const spoof = await api('/rest/v1/proposals', cBt.token, {
      method: 'POST', prefer: 'return=representation',
      body: { project_id: project1.id, freelancer_id: fB.id, message: 'spoof', proposed_rate: 1000, rate_type: 'fixed', status: 'pending' },
    });
    check("a client cannot submit a proposal as another freelancer", spoof.status >= 400 || (spoof.json || []).length === 0, { status: spoof.status, body: spoof.json });

    const proposalPeek = await api(`/rest/v1/proposals?select=id,status&project_id=eq.${project1.id}`, cAt2.token);
    check('the client sees exactly 1 proposal on the project', proposalPeek.status === 200 && proposalPeek.json?.length === 1, proposalPeek.json);

    const outsiderPeek = await api(`/rest/v1/proposals?select=id&project_id=eq.${project1.id}`, outT.token);
    check('an unrelated freelancer cannot read the proposals', (outsiderPeek.json || []).length === 0, outsiderPeek.json);

    // ══ D. CONTRACT ═══════════════════════════════════════════════════════
    section('D. Contract, escrow, messages, direct-write locks');
    const hijackHire = await makeContract(cBt, fA, project1.id, prop1.proposal.id, 10000);
    check("another client cannot hire on this project", hijackHire.status >= 400 || !hijackHire.id, { status: hijackHire.status, body: hijackHire.json });

    const contract1 = await makeContract(cAt2, fA, project1.id, prop1.proposal.id, 10000);
    createdContractIds.push(contract1.id);
    check('client hires → contract created', contract1.status === 200 && !!contract1.id, { status: contract1.status, body: contract1.json });

    const c1row = await row(`/rest/v1/contracts?select=id,client_id,freelancer_id,amount,platform_fee,freelancer_amount,status,escrow_funded,auto_release_hours&id=eq.${contract1.id}`, cAt2.token);
    check('server derives the 5% fee and 95% net (₹10,000 → ₹500 / ₹9,500)',
      Number(c1row?.amount) === 10000 && Number(c1row?.platform_fee) === 500 && Number(c1row?.freelancer_amount) === 9500,
      c1row);
    check('contract starts un-funded and pending', c1row?.status !== 'completed' && c1row?.escrow_funded === false, c1row);

    const duplicateHire = await makeContract(cAt2, fA, project1.id, prop1.proposal.id, 10000);
    check('the same project cannot be hired twice for the same role', duplicateHire.status >= 400 || duplicateHire.id === contract1.id, { status: duplicateHire.status, body: duplicateHire.json, id: duplicateHire.id });

    const propStatus = await row(`/rest/v1/proposals?select=status&id=eq.${prop1.proposal.id}`, cAt2.token);
    check('the accepted proposal is marked accepted/hired', ['accepted', 'hired', 'contracted'].includes(String(propStatus?.status)), propStatus);

    const wrongStart = await rpc('mark_freelancer_started', { p_contract_id: contract1.id }, fBt.token);
    check("another freelancer cannot start this contract",
      wrongStart.json === false || wrongStart.json?.success === false,
      { status: wrongStart.status, body: wrongStart.json });
    const start = await rpc('mark_freelancer_started', { p_contract_id: contract1.id }, fAt.token);
    check('the hired freelancer starts work', start.json?.success === true || start.status === 200, { status: start.status, body: start.json });

    const wrongHours = await rpc('set_auto_release_hours', { p_contract_id: contract1.id, p_hours: 48 }, fAt.token);
    check('only the client can set the auto-release window', wrongHours.json?.success === false, { status: wrongHours.status, body: wrongHours.json });
    const hours = await rpc('set_auto_release_hours', { p_contract_id: contract1.id, p_hours: 48 }, cAt2.token);
    check('the client sets a 48h auto-release window', hours.json?.success === true, { status: hours.status, body: hours.json });

    const msg = await api('/rest/v1/messages', cAt2.token, {
      method: 'POST', prefer: 'return=representation',
      body: { contract_id: contract1.id, sender_id: cAt2.id, receiver_id: fA.id, content: 'Sweep: please begin.', message_type: 'text' },
    });
    check('client posts a workspace message', msg.status === 201 && !!msg.json?.[0]?.id, { status: msg.status, body: msg.json });
    const fReads = await api(`/rest/v1/messages?select=id,content&contract_id=eq.${contract1.id}`, fAt.token);
    check('the freelancer reads that message', (fReads.json || []).some((m) => m.content === 'Sweep: please begin.'), fReads.json);
    const outReads = await api(`/rest/v1/messages?select=id&contract_id=eq.${contract1.id}`, outT.token);
    check('an outsider cannot read workspace messages', (outReads.json || []).length === 0, outReads.json);
    const outWrites = await api('/rest/v1/messages', outT.token, {
      method: 'POST', prefer: 'return=representation',
      body: { contract_id: contract1.id, sender_id: outT.id, receiver_id: cAt2.id, content: 'intrusion', message_type: 'text' },
    });
    check('an outsider cannot write into the workspace', !(outWrites.json || []).length, { status: outWrites.status, body: outWrites.json });

    // Direct money/state writes must be impossible from a browser JWT.
    const beforeWallet = await wallet(fAt);
    const directWallet = await api(`/rest/v1/wallets?user_id=eq.${fAt.id}`, fAt.token, {
      method: 'PATCH', prefer: 'return=representation', body: { balance: 999999 },
    });
    const afterDirect = await wallet(fAt);
    check('a freelancer cannot credit their own wallet directly',
      (directWallet.json || []).length === 0 && afterDirect.balance === beforeWallet.balance,
      { status: directWallet.status, body: directWallet.json, before: beforeWallet.balance, after: afterDirect.balance });

    const directContract = await api(`/rest/v1/contracts?id=eq.${contract1.id}`, fAt.token, {
      method: 'PATCH', prefer: 'return=representation', body: { status: 'completed' },
    });
    const contractNow = await row(`/rest/v1/contracts?select=status&id=eq.${contract1.id}`, cAt2.token);
    check('a freelancer cannot mark their own contract completed',
      (directContract.json || []).length === 0 && contractNow?.status !== 'completed',
      { status: directContract.status, body: directContract.json, current: contractNow?.status });

    // Notifications: seed one for fB, prove isolation and mark-read.
    const notif = await admin('/rest/v1/notifications', {
      method: 'POST', prefer: 'return=representation',
      body: { user_id: fB.id, type: 'system', title: `Sweep ${RUN}`, message: 'Isolation probe', read: false },
    });
    const notifId = notif.json?.[0]?.id;
    const notifOther = await api(`/rest/v1/notifications?select=id,title&id=eq.${notifId}`, fAt.token);
    check("one user cannot read another user's notification", (notifOther.json || []).length === 0, notifOther.json);
    const notifOwn = await api(`/rest/v1/notifications?select=id,title&id=eq.${notifId}`, fBt.token);
    check('the owner reads their notification', notifOwn.json?.[0]?.id === notifId, notifOwn.json);
    const notifUpdate = await api(`/rest/v1/notifications?id=eq.${notifId}`, fBt.token, {
      method: 'PATCH', prefer: 'return=representation', body: { read: true },
    });
    check('the owner marks it read', notifUpdate.status === 200 && notifUpdate.json?.[0]?.read === true, { status: notifUpdate.status, body: notifUpdate.json });

    // ══ E. MONEY ══════════════════════════════════════════════════════════
    section('E. Escrow fund → deliver → release');
    await seedWallet(cAt2, 50000);
    const clientBefore = await wallet(cAt2);
    const freelancerBefore = await wallet(fAt);
    const earlyRelease = await rpc('release_escrow', { p_contract_id: contract1.id, p_client_id: cAt2.id }, cAt2.token);
    check('escrow cannot be released before it is funded', earlyRelease.status >= 400 || earlyRelease.json === false, { status: earlyRelease.status, body: earlyRelease.json });

    const fund = await rpc('fund_escrow_from_wallet', { p_contract_id: contract1.id, p_milestone_indices: null }, cAt2.token);
    check('client funds escrow from wallet', fund.json?.success === true, { status: fund.status, body: fund.json });
    const clientFunded = await wallet(cAt2);
    const escrowRow = await row(`/rest/v1/escrow?select=amount,status&contract_id=eq.${contract1.id}`, cAt2.token);
    check('client is debited exactly ₹10,000 (no fee added on top)', clientBefore.balance - clientFunded.balance === 10000, { before: clientBefore.balance, after: clientFunded.balance });
    check('escrow holds ₹10,000', Number(escrowRow?.amount) === 10000 && ['held', 'funded'].includes(String(escrowRow?.status)), escrowRow);

    const wrongFund = await rpc('fund_escrow_from_wallet', { p_contract_id: contract1.id, p_milestone_indices: null }, cBt.token);
    check('another client cannot fund this escrow', wrongFund.status >= 400 || wrongFund.json?.success === false, { status: wrongFund.status, body: wrongFund.json });

    const wrongDeliver = await rpc('mark_contract_delivered', { p_contract_id: contract1.id }, fBt.token);
    check("another freelancer cannot deliver this contract", wrongDeliver.json?.success === false, { status: wrongDeliver.status, body: wrongDeliver.json });
    const deliver = await rpc('mark_contract_delivered', { p_contract_id: contract1.id }, fAt.token);
    check('the hired freelancer delivers', deliver.json?.success === true, { status: deliver.status, body: deliver.json });
    const deliveredRow = await row(`/rest/v1/contracts?select=delivered_at,auto_release_hours&id=eq.${contract1.id}`, cAt2.token);
    check('delivery timestamp + auto-release hours recorded', !!deliveredRow?.delivered_at && Number(deliveredRow?.auto_release_hours) === 48, deliveredRow);

    const wrongRelease = await rpc('release_escrow', { p_contract_id: contract1.id, p_client_id: cBt.id }, cBt.token);
    check('another client cannot release this escrow', wrongRelease.status >= 400 || wrongRelease.json === false, { status: wrongRelease.status, body: wrongRelease.json });
    const outsiderRelease = await rpc('release_escrow', { p_contract_id: contract1.id, p_client_id: cAt2.id }, outT.token);
    check('an outsider cannot release this escrow', outsiderRelease.status >= 400 || outsiderRelease.json === false, { status: outsiderRelease.status, body: outsiderRelease.json });

    const release = await rpc('release_escrow', { p_contract_id: contract1.id, p_client_id: cAt2.id }, cAt2.token);
    check('client releases escrow', release.json === true || release.json?.success === true, { status: release.status, body: release.json });

    const freelancerAfter = await wallet(fAt);
    check('freelancer receives exactly ₹9,500 (95%)', freelancerAfter.balance - freelancerBefore.balance === 9500, { before: freelancerBefore.balance, after: freelancerAfter.balance });
    const finalContract = await row(`/rest/v1/contracts?select=status,escrow_funded&id=eq.${contract1.id}`, cAt2.token);
    check('contract is completed', finalContract?.status === 'completed', finalContract);
    const finalEscrow = await row(`/rest/v1/escrow?select=status&contract_id=eq.${contract1.id}`, cAt2.token);
    check('escrow is released', finalEscrow?.status === 'released', finalEscrow);

    const revenue = await row(`/rest/v1/platform_revenue?select=gross_amount,platform_fee,freelancer_amount,status&contract_id=eq.${contract1.id}`, cAt2.token);
    check('platform revenue: gross ₹10,000 / fee ₹500 / net ₹9,500',
      Number(revenue?.gross_amount) === 10000 && Number(revenue?.platform_fee) === 500 && Number(revenue?.freelancer_amount) === 9500,
      revenue);
    const invoice = await row(`/rest/v1/invoices?select=id,invoice_number,total,platform_fee,status&contract_id=eq.${contract1.id}`, cAt2.token);
    check('an invoice exists for the release', !!invoice?.id && Number(invoice?.total) === 10000, invoice);

    const ledger = await api(`/rest/v1/transactions?select=id,type,amount,status&contract_id=eq.${contract1.id}`, cAt2.token);
    check('the release is on the transaction ledger', Array.isArray(ledger.json) && ledger.json.length > 0, { status: ledger.status, body: ledger.json });

    const beforeSecondRelease = await wallet(fAt);
    const secondRelease = await rpc('release_escrow', { p_contract_id: contract1.id, p_client_id: cAt2.id }, cAt2.token);
    const afterSecondRelease = await wallet(fAt);
    check('releasing twice cannot pay twice',
      secondRelease.json !== true && afterSecondRelease.balance === beforeSecondRelease.balance,
      { status: secondRelease.status, body: secondRelease.json, before: beforeSecondRelease.balance, after: afterSecondRelease.balance });

    // ══ F. REVIEWS ════════════════════════════════════════════════════════
    section('F. Reviews after completion');
    const review = (reviewee, body) => edge('reviews', { contract_id: contract1.id, reviewee_id: reviewee.id, rating: 5, comment: body }, reviewee === fA ? cAt2.token : fAt.token);
    const reviewByClient = await review(fA, 'Sweep: excellent work');
    check('client reviews the freelancer after completion', reviewByClient.status === 200 && reviewByClient.json?.review?.id, { status: reviewByClient.status, body: reviewByClient.json });
    const reviewByFreelancer = await review(cA, 'Sweep: clear brief');
    check('freelancer reviews the client after completion', reviewByFreelancer.status === 200 && reviewByFreelancer.json?.review?.id, { status: reviewByFreelancer.status, body: reviewByFreelancer.json });
    const reviewDup = await review(fA, 'Sweep: duplicate');
    check('the same reviewer cannot review twice', reviewDup.status >= 400, { status: reviewDup.status, body: reviewDup.json });
    const outsiderReview = await edge('reviews', { contract_id: contract1.id, reviewee_id: fA.id, rating: 1, comment: 'Sweep: outsider' }, outT.token);
    check('an outsider cannot review this contract', outsiderReview.status >= 400, { status: outsiderReview.status, body: outsiderReview.json });
    const ratedProfile = await row(`/rest/v1/profiles?select=rating,total_reviews&id=eq.${fA.id}`, cAt2.token);
    check('the freelancer reputation was recalculated', Number(ratedProfile?.total_reviews) >= 1 && Number(ratedProfile?.rating) > 0, ratedProfile);

    // ══ G. DISPUTE ════════════════════════════════════════════════════════
    section('G. Dispute on a second contract');
    const p2 = await makeProject(cAt2, `TEST E2E — dispute sweep ${RUN}`, 2000);
    createdProjectIds.push(p2.project?.id);
    const prop2 = await makeProposal(fAt, p2.project.id, 2000);
    const contract2 = await makeContract(cAt2, fAt, p2.project.id, prop2.proposal.id, 2000);
    createdContractIds.push(contract2.id);
    await seedWallet(cAt2, 20000);
    const fund2 = await rpc('fund_escrow_from_wallet', { p_contract_id: contract2.id, p_milestone_indices: null }, cAt2.token);
    check('second contract funded (₹2,000)', fund2.json?.success === true, { status: fund2.status, body: fund2.json });

    const outsiderDispute = await rpc('raise_contract_dispute', {
      p_contract_id: contract2.id, p_reason: 'Outsider probe', p_description: 'Not a party',
    }, outT.token);
    check('an outsider cannot raise a dispute', outsiderDispute.status >= 400 || outsiderDispute.json?.success === false, { status: outsiderDispute.status, body: outsiderDispute.json });

    const dispute = await rpc('raise_contract_dispute', {
      p_contract_id: contract2.id, p_reason: 'Sweep: scope disagreement', p_description: 'Automated full-sweep dispute probe.',
    }, cAt2.token);
    check('the client raises a dispute', dispute.status === 200 && (dispute.json?.success === true || !!dispute.json?.dispute_id), { status: dispute.status, body: dispute.json });
    const disputeRow = await row(`/rest/v1/disputes?select=id,status,contract_id&contract_id=eq.${contract2.id}`, cAt2.token);
    check('the dispute row exists', !!disputeRow?.id, disputeRow);
    const frozenEscrow = await row(`/rest/v1/escrow?select=status&contract_id=eq.${contract2.id}`, cAt2.token);
    check('the disputed escrow is locked (disputed/frozen), never released',
      ['disputed', 'frozen'].includes(String(frozenEscrow?.status)), frozenEscrow);
    const disputedContract = await row(`/rest/v1/contracts?select=status&id=eq.${contract2.id}`, cAt2.token);
    check('the disputed contract is marked disputed', disputedContract?.status === 'disputed', disputedContract);
    const disputePeek = await api(`/rest/v1/disputes?select=id&contract_id=eq.${contract2.id}`, outT.token);
    check('an outsider cannot read the dispute', (disputePeek.json || []).length === 0, disputePeek.json);

    // ══ H. ADMIN GATE ═════════════════════════════════════════════════════
    section('H. Admin authorization');
    const nonAdmin = await edge('admin-data', { action: 'counts' }, cBt.token);
    check('a normal client cannot call admin-data', nonAdmin.status === 403 || nonAdmin.status === 401 || nonAdmin.json?.error, { status: nonAdmin.status, body: nonAdmin.json });
    await admin(`/rest/v1/profiles_private?id=eq.${cA.id}`, { method: 'PATCH', body: { is_admin: true } });
    const asAdmin = await edge('admin-data', { action: 'counts' }, cAt2.token);
    check('a server-granted admin can call admin-data', asAdmin.status === 200 && !asAdmin.json?.error, { status: asAdmin.status, body: asAdmin.json });
    await admin(`/rest/v1/profiles_private?id=eq.${cA.id}`, { method: 'PATCH', body: { is_admin: false } });
    const revoked = await edge('admin-data', { action: 'counts' }, cAt2.token);
    check('revoking admin closes the door again', revoked.status === 403 || revoked.status === 401 || !!revoked.json?.error, { status: revoked.status, body: revoked.json });

    // ══ I. TEARDOWN ═══════════════════════════════════════════════════════
    section('I. Teardown');
    if (KEEP) {
      console.log('--keep passed: accounts and rows left in place.');
    } else {
      for (const u of accounts) {
        if (!u.id) continue;
        let del = null;
        // The cascade is a long multi-step function; an account with no profile
        // can hit the statement timeout on the first call and succeed on retry.
        for (let attempt = 0; attempt < 3; attempt++) {
          del = await admin('/rest/v1/rpc/delete_user_all_data', { method: 'POST', body: { p_user_id: u.id } });
          if (del.status === 200) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        check(`account deleted: ${u.email.split('@')[0]}`, del.status === 200, { status: del.status, body: del.json });
      }
      const leftoverUsers = (await listAuthUsers()).filter((u) => (u.email || '').startsWith('sweep.') && (u.email || '').endsWith(`@${DOMAIN}`));
      check('no sweep accounts remain in auth', leftoverUsers.length === 0, leftoverUsers.map((u) => u.email));
      const leftoverProjects = await admin(`/rest/v1/projects?select=id&title=like.TEST E2E*full sweep*${RUN}*`);
      check('no sweep projects remain', (leftoverProjects.json || []).length === 0, leftoverProjects.json);
      const leftoverContracts = createdContractIds.length
        ? await admin(`/rest/v1/contracts?select=id&id=in.(${createdContractIds.join(',')})`)
        : { json: [] };
      check('no sweep contracts remain', (leftoverContracts.json || []).length === 0, leftoverContracts.json);
      const orphanWallets = await admin(`/rest/v1/wallets?select=user_id&user_id=in.(${accounts.filter((a) => a.id).map((a) => a.id).join(',')})`);
      check('no sweep wallets remain', (orphanWallets.json || []).length === 0, orphanWallets.json);
    }

    // ══ REPORT ════════════════════════════════════════════════════════════
    const pass = checks.filter((c) => c.pass).length;
    console.log(`\n════════ ${pass}/${checks.length} checks passed, ${fails.length} failed ════════`);
    if (fails.length) console.log(fails.join('\n'));
    if (process.env.E2E_SWEEP_JSON) {
      fs.writeFileSync(process.env.E2E_SWEEP_JSON, JSON.stringify({ suite: 'full-sweep', target: URL, run: RUN, pass, total: checks.length, fails, checks }, null, 2));
    }
    process.exit(fails.length ? 1 : 0);
  } catch (err) {
    console.error(`\n✗ run aborted: ${err.message}`);
    if (!KEEP) {
      console.log('Attempting cleanup after abort…');
      for (const u of accounts) {
        if (!u.id) continue;
        try { await admin('/rest/v1/rpc/delete_user_all_data', { method: 'POST', body: { p_user_id: u.id } }); } catch { /* best effort */ }
      }
    }
    process.exit(1);
  }
})();
