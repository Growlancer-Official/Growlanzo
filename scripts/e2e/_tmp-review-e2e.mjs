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
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
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
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, json: j };
}
const rpc = (fn, body, token) => api(`/rest/v1/rpc/${fn}`, token, { method: 'POST', body });
const edge = async (fn, body, token) => {
  const r = await fetch(`${URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, json: j };
};
const one = async (path, token) => {
  const r = await api(path, token);
  return { status: r.status, row: Array.isArray(r.json) ? r.json[0] : r.json };
};

// ── 1. All numbered test users can sign in and their profile/wallet is readable
const users = [];
for (const role of ['client', 'freelancer']) {
  for (let i = 1; i <= 10; i++) users.push({ role, email: `${role}-${i}.test@growlancer-test.com` });
}
const sessions = {};
for (const u of users) {
  const s = await login(u.email);
  sessions[u.email] = s;
  ok(`login ${u.email}`, s.status === 200 && !!s.token && !!s.user?.id, { status: s.status });
  if (!s.token) continue;
  const p = await one(`/rest/v1/profiles?select=id,role,name,rating,total_reviews&id=eq.${s.user.id}`, s.token);
  ok(`profile ${u.email}`, p.status === 200 && p.row?.role === u.role, { status: p.status, role: p.row?.role });
  const w = await one(`/rest/v1/wallets?select=user_id,balance,currency&user_id=eq.${s.user.id}`, s.token);
  ok(`wallet ${u.email}`, w.status === 200 && w.row?.user_id === s.user.id, { status: w.status });
  const pp = await one(`/rest/v1/profiles_private?select=referral_code&id=eq.${s.user.id}`, s.token);
  ok(`referral code ${u.email}`, pp.status === 200 && typeof pp.row?.referral_code === 'string', { status: pp.status });
}
ok('all 20 test users present', Object.values(sessions).filter((s) => s.token).length === 20, {
  signed_in: Object.values(sessions).filter((s) => s.token).length,
});

const c1 = sessions['client-1.test@growlancer-test.com'];
const c2 = sessions['client-2.test@growlancer-test.com'];
const f1 = sessions['freelancer-1.test@growlancer-test.com'];
const f2 = sessions['freelancer-2.test@growlancer-test.com'];

// ── 2. One real completed contract (client-1 ↔ freelancer-1)
const proj = await api('/rest/v1/projects', c1.token, {
  method: 'POST', prefer: 'return=representation',
  body: {
    client_id: c1.user.id,
    title: 'TEST E2E — Reviews & Platform Test',
    description: 'Disposable end-to-end review test.',
    budget_min: 4000, budget_max: 6000,
    skills_required: ['React', 'TypeScript'],
    category: 'Web Development', status: 'open',
  },
});
const projectId = proj.json?.[0]?.id;
ok('create project', proj.status === 201 && !!projectId, { status: proj.status, projectId });

const prop = await api('/rest/v1/proposals', f1.token, {
  method: 'POST', prefer: 'return=representation',
  body: { project_id: projectId, freelancer_id: f1.user.id, message: 'E2E proposal', proposed_rate: 5000, rate_type: 'fixed', status: 'pending' },
});
const proposalId = prop.json?.[0]?.id;
ok('create proposal', prop.status === 201 && !!proposalId, { status: prop.status, proposalId });

const created = await rpc('create_contract_with_escrow', {
  p_project_id: projectId, p_freelancer_id: f1.user.id, p_proposal_id: proposalId, p_amount: 5000, p_client_id: c1.user.id,
}, c1.token);
const contractId = typeof created.json === 'string' ? created.json : created.json?.contract_id || created.json?.id;
ok('create contract', created.status === 200 && !!contractId, { status: created.status, body: created.json });

let funded = await rpc('fund_escrow_from_wallet', { p_contract_id: contractId, p_milestone_indices: null }, c1.token);
if (funded.status >= 400) funded = await rpc('fund_escrow_from_wallet', { p_contract_id: contractId, p_milestone_indices: [0] }, c1.token);
ok('fund escrow', funded.status === 200, { status: funded.status, body: funded.json });

const delivered = await rpc('mark_contract_delivered', { p_contract_id: contractId }, f1.token);
ok('mark delivered', delivered.status === 200, { status: delivered.status, body: delivered.json });

const released = await rpc('release_escrow', { p_contract_id: contractId, p_client_id: c1.user.id }, c1.token);
ok('release escrow', released.status === 200, { status: released.status, body: released.json });

const contract = await one(`/rest/v1/contracts?select=id,status,amount,platform_fee,freelancer_amount&id=eq.${contractId}`, c1.token);
ok('contract completed', contract.row?.status === 'completed', contract.row);

// ── 3. Reviews: both directions
const clientReview = await edge('reviews', {
  contract_id: contractId, reviewee_id: f1.user.id, rating: 5,
  communication_rating: 5, quality_rating: 5, timeliness_rating: 5, professionalism_rating: 5,
  comment: 'Excellent delivery — clear communication and production-ready work.', would_hire_again: true,
}, c1.token);
ok('client reviews freelancer', clientReview.status === 200, { status: clientReview.status, body: clientReview.json });

const freelancerReview = await edge('reviews', {
  contract_id: contractId, reviewee_id: c1.user.id, rating: 4,
  communication_rating: 4, quality_rating: 4, timeliness_rating: 5, professionalism_rating: 4,
  comment: 'Clear brief and fast approvals; a pleasure to work with.', would_hire_again: true,
}, f1.token);
ok('freelancer reviews client', freelancerReview.status === 200, { status: freelancerReview.status, body: freelancerReview.json });

const dup = await edge('reviews', { contract_id: contractId, reviewee_id: f1.user.id, rating: 3, comment: 'duplicate' }, c1.token);
ok('duplicate review blocked', dup.status >= 400, { status: dup.status, body: dup.json });

const outsider = await edge('reviews', { contract_id: contractId, reviewee_id: f1.user.id, rating: 1, comment: 'not a participant' }, f2.token);
ok('non-participant review blocked', outsider.status >= 400, { status: outsider.status, body: outsider.json });

// Direct REST bypass attempt (RLS-only path, no edge validation)
const fake = await api('/rest/v1/reviews', c2.token, {
  method: 'POST', prefer: 'return=representation',
  body: { contract_id: contractId, reviewer_id: c2.user.id, reviewee_id: f1.user.id, rating: 1, comment: 'FAKE direct insert' },
});
ok('direct fake review blocked', fake.status >= 400, { status: fake.status, body: fake.json });

const reviewsNow = await api(`/rest/v1/reviews?select=id,reviewer_id,reviewee_id,rating,comment&contract_id=eq.${contractId}`, ANON);
ok('two-direction reviews readable', reviewsNow.status === 200 && reviewsNow.json?.length === 2, {
  status: reviewsNow.status, count: reviewsNow.json?.length,
});

const f1p = await one(`/rest/v1/profiles?select=rating,total_reviews&id=eq.${f1.user.id}`, f1.token);
const c1p = await one(`/rest/v1/profiles?select=rating,total_reviews&id=eq.${c1.user.id}`, c1.token);
ok('freelancer reputation updated', Number(f1p.row?.rating) === 5 && Number(f1p.row?.total_reviews) >= 1, f1p.row);
ok('client reputation updated', Number(c1p.row?.rating) === 4 && Number(c1p.row?.total_reviews) >= 1, c1p.row);

// Reply from the reviewee; outsider refused.
const reviewRows = reviewsNow.json || [];
const aboutF1 = reviewRows.find((r) => r.reviewee_id === f1.user.id);
const reply = await api('/rest/v1/review_replies', f1.token, {
  method: 'POST', prefer: 'return=representation',
  body: { review_id: aboutF1?.id, user_id: f1.user.id, content: 'Thank you — glad the delivery landed well.' },
});
ok('reviewee can reply', reply.status === 201, { status: reply.status, body: reply.json });
const badReply = await api('/rest/v1/review_replies', f2.token, {
  method: 'POST', prefer: 'return=representation',
  body: { review_id: aboutF1?.id, user_id: f2.user.id, content: 'outsider reply' },
});
ok('outsider reply blocked', badReply.status >= 400, { status: badReply.status, body: badReply.json });

// ── 4. Platform reviews (public homepage testimonials)
const prClient = await api('/rest/v1/platform_reviews', c1.token, {
  method: 'POST', prefer: 'return=representation',
  body: { user_id: c1.user.id, rating: 5, comment: 'Growlanzo escrow made hiring predictable: one brief, one clear shortlist, and the payout released on approval.' },
});
const c1Review = prClient.json?.[0];
ok('client platform review published', prClient.status === 201 && c1Review?.role === 'client', { status: prClient.status, body: prClient.json });

const prFree = await api('/rest/v1/platform_reviews', f1.token, {
  method: 'POST', prefer: 'return=representation',
  body: { user_id: f1.user.id, rating: 5, comment: 'The 5% is only taken when the payout releases, so every project I accept has a real, funded budget behind it.' },
});
const f1Review = prFree.json?.[0];
ok('freelancer platform review published', prFree.status === 201 && f1Review?.role === 'freelancer', { status: prFree.status, body: prFree.json });

const prPublic = await api('/rest/v1/platform_reviews?select=id,role,rating,comment&status=eq.published', ANON);
ok('platform reviews publicly readable', prPublic.status === 200 && (prPublic.json?.length || 0) >= 2, { status: prPublic.status, count: prPublic.json?.length });

const prAnon = await api('/rest/v1/platform_reviews', ANON, { method: 'POST', body: { user_id: c1.user.id, rating: 5, comment: 'anonymous write attempt' } });
ok('anon platform review blocked', prAnon.status >= 400, { status: prAnon.status });

const prIneligible = await api('/rest/v1/platform_reviews', c2.token, {
  method: 'POST', body: { user_id: c2.user.id, rating: 5, comment: 'no completed contract yet' },
});
ok('no-contract platform review blocked', prIneligible.status >= 400, { status: prIneligible.status, body: prIneligible.json });

const prRoleSpoof = await api(`/rest/v1/platform_reviews?user_id=eq.${c1.user.id}`, c1.token, {
  method: 'PATCH', prefer: 'return=representation',
  body: { role: 'freelancer', status: 'hidden', comment: 'Updated client testimonial after the project closed.' },
});
ok('role/status cannot be spoofed', prRoleSpoof.json?.[0]?.role === 'client' && prRoleSpoof.json?.[0]?.status === 'published', {
  status: prRoleSpoof.status, row: prRoleSpoof.json?.[0],
});

console.log(JSON.stringify({ summary: { pass: out.filter((o) => o.pass).length, fail: fails.length, fails }, contractId, projectId, out }, null, 2));
process.exit(fails.length ? 1 : 0);
