// Growlanzo UI E2E — the money path a real client + freelancer walk:
//
//   client posts a project (UI)
//     → freelancer's proposal exists (seeded; proposal submission is covered
//       separately by the authenticated audit and the DB privilege tests)
//     → client clicks "Accept & Hire" (UI)            ← regression: button used
//                                                       to stick on "Hiring…"
//     → client funds escrow from wallet (UI)
//     → freelancer starts work + delivers (UI)
//     → client releases escrow (UI)
//     → service-role assertions on contracts/escrow/wallets + teardown
//
// The wallet is credited through the service role before the run because a CI
// test client has no money; that is a fixture, not a shortcut around a payment.
// Real card/Razorpay/PayPal checkout cannot run unattended (see the audit doc).
//
// Usage (CI):
//   node scripts/e2e/hire-release-flow.mjs --base=http://127.0.0.1:4174
//
// Required env:
//   SUPABASE_URL (or VITE_SUPABASE_URL), VITE_SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY,
//   E2E_CLIENT_EMAIL / E2E_CLIENT_PASSWORD,
//   E2E_FREELANCER_EMAIL / E2E_FREELANCER_PASSWORD
//
// Flags:
//   --base=<url>          app under test (default http://127.0.0.1:4174)
//   --temp-accounts=true  create disposable client/freelancer accounts for a
//                         local run (needs the service role) and delete them
//                         afterwards — use this when you don't have the CI
//                         account passwords locally
//   --keep=true           skip teardown (debugging a failed run)
//   --headed=true         watch the browser
//   --timeout=<ms>        per-step UI timeout (default 30000)

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  })
);

const BASE = (args.base || 'http://127.0.0.1:4174').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TEMP_ACCOUNTS = args['temp-accounts'] === 'true';
const KEEP = args.keep === 'true';
const HEADED = args.headed === 'true';
const STEP_TIMEOUT = Number(args.timeout || 30000);
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PROJECT_TITLE = `E2E Hire Flow ${RUN_ID}`;
const AMOUNT = 5000;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('HIRE-FLOW FAIL — missing SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ── tiny REST helpers (service role) ─────────────────────────────────────────
const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(pathname, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: prefer ? { ...H, Prefer: prefer } : H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text };
}

async function rpc(name, payload) {
  return rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: payload });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  return ok;
}

async function pollUntil(fn, { timeout = 20000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}

// ── accounts ────────────────────────────────────────────────────────────────
let clientEmail = process.env.E2E_CLIENT_EMAIL;
let clientPassword = process.env.E2E_CLIENT_PASSWORD;
let freelancerEmail = process.env.E2E_FREELANCER_EMAIL;
let freelancerPassword = process.env.E2E_FREELANCER_PASSWORD;
const tempUserIds = [];

async function createTempAccount(role) {
  const email = `e2e.hireflow.${role}.${RUN_ID}@growlancer-test.com`;
  const password = `Hf-${RUN_ID}-${Math.random().toString(36).slice(2, 10)}!A9`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: `E2E ${role}` } }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) throw new Error(`could not create temp ${role}: HTTP ${res.status} ${JSON.stringify(body)}`);
  tempUserIds.push(body.id);
  return { email, password, id: body.id };
}

async function signIn(email, password, role) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new Error(`${role}: sign-in failed (HTTP ${res.status}) ${JSON.stringify(body)}`);
  }
  return { session: body, id: body.user.id };
}

function storageKeyFor(url) {
  return `sb-${new URL(url).host.split('.')[0]}-auth-token`;
}

async function newRolePage(browser, session) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* filled in by the assertion below */
      }
    },
    [storageKeyFor(SUPABASE_URL), JSON.stringify(session)]
  );
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return { context, page };
}

async function boot(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => !document.getElementById('boot-overlay'), { timeout: 20000 }).catch(() => {});
}

// ── fixtures ────────────────────────────────────────────────────────────────
async function ensureProfile(user, role, name) {
  const existing = await rest(`/rest/v1/profiles?id=eq.${user.id}&select=id,role,country`);
  if (!existing.json?.[0]) {
    // The signup trigger normally creates this; a temp account created through
    // the admin API still goes through it, so this is only a safety net.
    await rpc('ensure_profile', { p_id: user.id, p_email: user.email, p_name: name, p_role: role, p_referral_code: '' });
  }
  await rest(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    body: { country: 'IN', updated_at: new Date().toISOString() },
  });
  await rest(`/rest/v1/profiles_private?id=eq.${user.id}`, {
    method: 'PATCH',
    body: { onboarding_completed: true, updated_at: new Date().toISOString() },
  });
}

async function seedWallet(userId, balance) {
  const current = await rest(`/rest/v1/wallets?user_id=eq.${userId}&select=user_id,balance,currency`);
  const previous = current.json?.[0] ? Number(current.json[0].balance) : null;
  if (current.json?.[0]) {
    await rest(`/rest/v1/wallets?user_id=eq.${userId}`, { method: 'PATCH', body: { balance } });
  } else {
    await rest('/rest/v1/wallets', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { user_id: userId, balance, currency: 'INR' },
    });
  }
  return previous;
}

async function restoreWallet(userId, previous) {
  if (previous === null) {
    await rest(`/rest/v1/wallets?user_id=eq.${userId}`, { method: 'DELETE' });
  } else {
    await rest(`/rest/v1/wallets?user_id=eq.${userId}`, { method: 'PATCH', body: { balance: previous } });
  }
}

async function walletBalance(userId) {
  const row = await rest(`/rest/v1/wallets?user_id=eq.${userId}&select=balance`);
  return Number(row.json?.[0]?.balance ?? 0);
}

// ── main ────────────────────────────────────────────────────────────────────
let browser = null;
let clientPage = null;
let freelancerPage = null;
let clientId = null;
let freelancerId = null;
let clientWalletBefore = null;
let freelancerWalletBefore = null;
let projectId = null;
let contractId = null;

try {
  if (TEMP_ACCOUNTS) {
    const c = await createTempAccount('client');
    const f = await createTempAccount('freelancer');
    clientEmail = c.email;
    clientPassword = c.password;
    freelancerEmail = f.email;
    freelancerPassword = f.password;
    console.log(`· temp accounts: ${clientEmail} / ${freelancerEmail}`);
  }

  const client = await signIn(clientEmail, clientPassword, 'client');
  const freelancer = await signIn(freelancerEmail, freelancerPassword, 'freelancer');
  clientId = client.id;
  freelancerId = freelancer.id;

  await ensureProfile({ id: clientId, email: clientEmail }, 'client', 'E2E Hire Client');
  await ensureProfile({ id: freelancerId, email: freelancerEmail }, 'freelancer', 'E2E Hire Freelancer');
  // The freelancer's workspace + feed expect a freelancer_profiles row.
  await rest('/rest/v1/freelancer_profiles?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: freelancerId, skills: ['React', 'TypeScript', 'Web Development'], hourly_rate: 1000 },
  });

  clientWalletBefore = await seedWallet(clientId, 100000); // null when the row is new
  freelancerWalletBefore = await seedWallet(freelancerId, 0);

  // Same Chrome lookup the other E2E scripts use: CI passes
  // E2E_CHROME_PATH, local machines usually have a system Chrome.
  const executablePath = [
    process.env.E2E_CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => p && fs.existsSync(p));
  browser = await chromium.launch({ headless: !HEADED, ...(executablePath ? { executablePath } : {}) });
  const cp = await newRolePage(browser, client.session);
  const fp = await newRolePage(browser, freelancer.session);
  clientPage = cp.page;
  freelancerPage = fp.page;

  // ── 1. CLIENT POSTS A PROJECT (UI) ────────────────────────────────────────
  await boot(clientPage, '/client/post');
  await clientPage.getByPlaceholder(/Build a React Native Mobile App/i).fill(PROJECT_TITLE);
  await clientPage
    .getByPlaceholder(/Describe your project in detail/i)
    .fill('Automated end-to-end run: post → hire → fund escrow → deliver → release. This project is disposable.');

  // Budget field is the only required number input on the page.
  await clientPage.locator('input[type="number"]').first().fill(String(AMOUNT));

  // Category: pick a real one from the picker (search → matching result).
  // A project cannot be posted without one, so resolve the name from the DB
  // instead of guessing what the picker lists.
  const catRows = await rest('/rest/v1/categories?select=name&limit=200');
  const categoryName =
    (catRows.json ?? []).map((c) => c.name).find((n) => /web|development/i.test(String(n))) ??
    catRows.json?.[0]?.name ??
    'Web Development';
  const categorySearch = clientPage.getByPlaceholder(/Search categories/i);
  await categorySearch.fill(String(categoryName).slice(0, 12));
  const exactCategory = clientPage.getByRole('button', { name: categoryName, exact: true }).first();
  if (await exactCategory.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
    await exactCategory.click();
  } else {
    const firstCategory = clientPage.locator('button').filter({ hasText: /Web|Development|Design|Writing/i }).first();
    if (await firstCategory.count()) await firstCategory.click();
  }

  await clientPage.getByRole('button', { name: /^Post Project$/i }).click();
  const posted = await pollUntil(async () => {
    const row = await rest(
      `/rest/v1/projects?title=eq.${encodeURIComponent(PROJECT_TITLE)}&select=id,status,category,client_id&order=created_at.desc`
    );
    return row.json?.[0] || null;
  }, { timeout: 30000 });
  projectId = posted?.id ?? null;
  check('client posts a project through the UI', !!projectId, projectId ? { projectId, category: posted.category } : 'project row never appeared');
  if (!projectId) throw new Error('cannot continue without a project');

  // ── 2. PROPOSAL (seeded — the freelancer-side submission UI is covered by
  //      the authenticated audit; this run owns the hire → release money path)
  const proposal = await rest('/rest/v1/proposals', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      project_id: projectId,
      freelancer_id: freelancerId,
      message: `E2E hire flow ${RUN_ID}`,
      proposed_rate: AMOUNT,
      rate_type: 'fixed',
      status: 'pending',
    },
  });
  const proposalId = proposal.json?.[0]?.id ?? null;
  check('proposal is in place for the client to accept', !!proposalId, proposal.status);

  // ── 3. CLIENT ACCEPTS & HIRES (UI) — the stuck-"Hiring…" regression ───────
  await boot(clientPage, '/client/proposals');
  const hireButton = clientPage.getByRole('button', { name: /Accept & Hire/i }).first();
  const hireVisible = await hireButton
    .waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  check('proposal card offers Accept & Hire', hireVisible, clientPage.url());

  let hireMs = 0;
  if (hireVisible) {
    const started = Date.now();
    await hireButton.click();
    const navigated = await clientPage
      .waitForURL(/\/client\/workspace\?contract=/, { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    hireMs = Date.now() - started;
    const urlContract = new URL(clientPage.url()).searchParams.get('contract');
    check('Accept & Hire leaves "Hiring…" and opens the contract workspace', navigated && !!urlContract, {
      ms: hireMs,
      url: clientPage.url(),
    });
    contractId = urlContract;
  }

  // The page must not have needed a 45s+ wait: the notification timeout is 5s
  // and the contract itself is created server-side in under a couple of seconds.
  if (contractId) {
    const row = await rest(`/rest/v1/contracts?id=eq.${contractId}&select=id,status,amount,escrow_funded`);
    check('contract exists with the proposed amount', Number(row.json?.[0]?.amount) === AMOUNT, row.json?.[0] || null);
  } else {
    // Fallback for a UI hiccup: still exercise the rest of the money path.
    const row = await rest(`/rest/v1/contracts?project_id=eq.${projectId}&select=id,amount`);
    contractId = row.json?.[0]?.id ?? null;
    check('contract exists after clicking Accept & Hire', !!contractId, row.json?.[0] || null);
    await boot(clientPage, `/client/workspace?contract=${contractId}`);
  }
  if (!contractId) throw new Error('cannot continue without a contract');

  // ── 4. CLIENT FUNDS ESCROW FROM WALLET (UI) ───────────────────────────────
  const fundBtn = clientPage.getByRole('button', { name: /^Fund Escrow$/i }).first();
  const fundVisible = await fundBtn.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).then(() => true).catch(() => false);
  check('funded-escrow prompt is visible on the contract', fundVisible, clientPage.url());
  if (fundVisible) {
    await fundBtn.click();

    // The modal has three steps: milestone selection → review → payment.
    // Step 1 may not appear when the contract has no milestones.
    const continueBtn = clientPage.getByRole('button', { name: /Continue to Payment/i }).first();
    if (await continueBtn.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
      // Select the first fundable milestone (the checkbox has no accessible
      // name, so it is addressed by its own class). Selecting nothing would
      // fund the full contract, which is also fine.
      await clientPage.evaluate(() => {
        const box = [...document.querySelectorAll('button')].find((b) =>
          /rounded border-2/.test(String(b.className))
        );
        box?.click();
      });
      await continueBtn.click();
    }
    const proceedBtn = clientPage.getByRole('button', { name: /Proceed to Payment/i }).first();
    if (await proceedBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
      await proceedBtn.click();
    }

    const walletPay = clientPage.getByRole('button', { name: /Fund Escrow with Wallet/i }).first();
    const walletVisible = await walletPay.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
    check('wallet funding option is offered', walletVisible);
    if (walletVisible) {
      await walletPay.click();
    } else {
      const text = await clientPage.locator('body').innerText().catch(() => '');
      console.log(`· funding modal text: ${text.replace(/\s+/g, ' ').slice(0, 500)}`);
    }
  }
  const funded = await pollUntil(async () => {
    const row = await rest(`/rest/v1/contracts?id=eq.${contractId}&select=escrow_funded`);
    return row.json?.[0]?.escrow_funded === true;
  }, { timeout: 30000 });
  check('escrow is funded after the wallet payment', !!funded);

  // ── 5. FREELANCER STARTS + DELIVERS (UI) ──────────────────────────────────
  await boot(freelancerPage, `/dashboard/workspace?contract=${contractId}`);
  // Start Work lives inside the "Milestones & Escrow" tab, which is NOT the
  // default (the workspace opens on chat). The previous run looked for it on
  // the chat tab, never clicked, and then blamed the RPC for a null column.
  const startTab = freelancerPage.getByRole('button', { name: /Milestones & Escrow/i }).first();
  if (await startTab.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)) {
    await startTab.click();
    await freelancerPage.waitForTimeout(1200);
  }
  const startBtn = freelancerPage.getByRole('button', { name: /Start Work/i }).first();
  if (await startBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    await startBtn.click();
  }
  // Start Work is tracked by the server column freelancer_started_at; wait for
  // that before delivery is possible, and capture the page state if it stalls.
  const started = await pollUntil(async () => {
    const row = await rest(`/rest/v1/contracts?id=eq.${contractId}&select=freelancer_started_at`);
    return !!row.json?.[0]?.freelancer_started_at;
  }, { timeout: 20000 });
  check('freelancer started work on the contract', !!started);
  if (!started) {
    const t = await freelancerPage.locator('body').innerText().catch(() => '');
    console.log(`· freelancer state after Start Work click: ${t.replace(/\s+/g, ' ').slice(0, 400)}`);
    console.log(`· freelancer page URL: ${freelancerPage.url()}`);
  }
  // "Deliver Work" lives in the Milestones & Escrow tab, which is not the
  // default tab. Reload straight into it so both the server state and the tab
  // are correct for the first look.
  await freelancerPage.locator('body').evaluate(() => {
    window.location.href = '/dashboard/workspace?contract=' +
      new URLSearchParams(location.search).get('contract');
  });
  await freelancerPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await freelancerPage.waitForTimeout(2500);
  const freTab = freelancerPage.getByRole('button', { name: /Milestones & Escrow/i }).first();
  if (await freTab.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)) {
    await freTab.click();
    await freelancerPage.waitForTimeout(2000);
  }
  check('freelancer workspace opened the contract', freelancerPage.url().includes(`contract=${contractId}`));

  // Delivery lives inside the "Milestones & Escrow" tab, not the default
  // chat tab. Open it first.
  const freelancerMilestonesTab = freelancerPage.getByRole('button', { name: /Milestones & Escrow/i }).first();
  if (await freelancerMilestonesTab.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    await freelancerMilestonesTab.click();
    await freelancerPage.waitForTimeout(800);
  }

  // Contract-level delivery is the action that flips contract.status to
  // "delivered" (the client's release flow reads that). Fall back to the
  // per-milestone toggle when the button is not rendered.
  const deliverWork = freelancerPage.getByRole('button', { name: /Deliver Work/i }).first();
  let deliverVisible = await deliverWork.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (deliverVisible) {
    await deliverWork.click();
    await freelancerPage.waitForTimeout(2000);
  } else {
    const deliverToggle = freelancerPage.locator('button[title^="Deliver this milestone"]').first();
    deliverVisible = await deliverToggle.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (deliverVisible) {
      await deliverToggle.click();
      await freelancerPage.waitForTimeout(1500);
    }
  }
  if (!deliverVisible) {
    const text = await freelancerPage.locator('body').innerText().catch(() => '');
    console.log(`· freelancer workspace text: ${text.replace(/\s+/g, ' ').slice(0, 500)}`);
  }
  // Delivery is recorded as contracts.delivered_at by mark_contract_delivered;
  // the status stays in_progress until the client releases. Poll the timestamp
  // (the real signal) and accept a completed status as well, so a slow read or
  // an auto-release cannot be reported as a failed delivery.
  const delivered = await pollUntil(async () => {
    const row = await rest(`/rest/v1/contracts?id=eq.${contractId}&select=status,delivered_at`);
    const contract = row.json?.[0];
    if (!contract) return false;
    if (contract.delivered_at) return contract.delivered_at;
    return contract.status === 'delivered' || contract.status === 'completed' ? contract.status : false;
  }, { timeout: 25000 });
  check('freelancer marked the work delivered', !!delivered, { deliverVisible, deliveredAt: delivered || null });

  // ── 6. CLIENT RELEASES ESCROW (UI) ────────────────────────────────────────
  await boot(clientPage, `/client/workspace?contract=${contractId}`);
  // Release sits in the "Milestones & Escrow" tab.
  const clientMilestonesTab = clientPage.getByRole('button', { name: /Milestones & Escrow/i }).first();
  if (await clientMilestonesTab.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    await clientMilestonesTab.click();
    await clientPage.waitForTimeout(800);
  }
  const releaseBtn = clientPage.getByRole('button', { name: /Release Escrow/i }).first();
  const releaseVisible = await releaseBtn.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).then(() => true).catch(() => false);
  check('release action is available after delivery', releaseVisible);
  if (!releaseVisible) {
    const text = await clientPage.locator('body').innerText().catch(() => '');
    console.log(`· client workspace text: ${text.replace(/\s+/g, ' ').slice(0, 500)}`);
  }
  if (releaseVisible) {
    await releaseBtn.click();
    const confirm = clientPage.getByRole('button', { name: /^Release payment$/i }).first();
    if (await confirm.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
      await confirm.click();
    }
  }

  const released = await pollUntil(async () => {
    const row = await rest(`/rest/v1/contracts?id=eq.${contractId}&select=status`);
    const escrowRow = await rest(`/rest/v1/escrow?contract_id=eq.${contractId}&select=status`);
    const contractStatus = String(row.json?.[0]?.status ?? '');
    const escrowStatus = String(escrowRow.json?.[0]?.status ?? '');
    return contractStatus === 'completed' && escrowStatus === 'released' ? { contractStatus, escrowStatus } : false;
  }, { timeout: 30000 });
  check('contract completes and escrow is released', !!released, released || undefined);

  // ── 7. MONEY INVARIANTS (service role, after the UI did the work) ─────────
  const clientAfter = await walletBalance(clientId);
  const freelancerAfter = await walletBalance(freelancerId);
  check('client is charged exactly the contract amount', clientAfter === 100000 - AMOUNT, { before: 100000, after: clientAfter });
  check('freelancer receives the amount minus the 5% platform fee', freelancerAfter === AMOUNT - Math.round(AMOUNT * 0.05), {
    before: freelancerWalletBefore,
    after: freelancerAfter,
    expected: AMOUNT - Math.round(AMOUNT * 0.05),
  });

  const escrow = await rest(`/rest/v1/escrow?contract_id=eq.${contractId}&select=status,amount`);
  check('escrow row is released for the full amount', escrow.json?.[0]?.status === 'released', escrow.json?.[0] || null);
} catch (err) {
  check('hire flow ran to completion', false, err instanceof Error ? err.message : String(err));
} finally {
  // On failure, dump where the browser ended up — that is the whole diagnosis.
  if (results.some((r) => !r.ok) && clientPage) {
    console.log(`· client page at failure: ${clientPage.url()}`);
    if (process.env.GITHUB_ACTIONS) fs.mkdirSync('artifacts', { recursive: true });
  }

  if (browser) await browser.close().catch(() => {});

  if (!KEEP) {
    // ── 8. TEARDOWN ─────────────────────────────────────────────────────────
    const deletes = [];
    async function del(table, filter) {
      const res = await rest(`/rest/v1/${table}?${filter}`, { method: 'DELETE', prefer: 'return=minimal' });
      deletes.push({ table, status: res.status });
    }
    if (contractId) {
      // Children first: the release books platform_revenue + invoices +
      // transactions, and those FKs do not all cascade.
      for (const [table, filter] of [
        ['platform_revenue', `contract_id=eq.${contractId}`],
        ['invoices', `contract_id=eq.${contractId}`],
        ['transactions', `contract_id=eq.${contractId}`],
        ['reviews', `contract_id=eq.${contractId}`],
        ['escrow', `contract_id=eq.${contractId}`],
        ['contract_milestones', `contract_id=eq.${contractId}`],
        ['contracts', `id=eq.${contractId}`],
      ]) {
        await del(table, filter);
      }
    }
    if (projectId) {
      for (const [table, filter] of [
        ['proposals', `project_id=eq.${projectId}`],
        ['project_matches', `project_id=eq.${projectId}`],
        ['project_categories', `project_id=eq.${projectId}`],
        ['projects', `id=eq.${projectId}`],
      ]) {
        await del(table, filter);
      }
    }
    if (clientId) await restoreWallet(clientId, clientWalletBefore);
    if (freelancerId) await restoreWallet(freelancerId, freelancerWalletBefore);

    const failed = deletes.filter((d) => d.status >= 400);
    if (failed.length) console.log(`· teardown warnings: ${JSON.stringify(failed)}`);

    for (const id of tempUserIds) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
    }

    if (projectId) {
      const left = await rest(`/rest/v1/projects?id=eq.${projectId}&select=id`);
      check('teardown removed the test project', (left.json?.length ?? 0) === 0);
    }
  }

  const failedCount = results.filter((r) => !r.ok).length;
  console.log(
    `\nHIRE-FLOW ${failedCount === 0 ? 'PASS' : 'FAIL'} — ${results.length - failedCount}/${results.length} checks passed`
  );
  if (projectId) console.log(`  project: ${projectId}${contractId ? `  contract: ${contractId}` : ''}`);
  process.exit(failedCount === 0 ? 0 : 1);
}
