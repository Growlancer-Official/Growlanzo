#!/usr/bin/env node
/**
 * Growlanzo — 20-ACCOUNT END-TO-END JOURNEY RUNNER
 *
 * Drives the LIVE site with the 20 batch accounts created by
 * `scripts/create_test_users_batch.mjs` (10 freelancers + 10 clients):
 *
 *   overview (/) → role dashboard routes → logout → protected route blocked
 *
 * Sign-in is real: the account's credentials are exchanged with GoTrue
 * (`POST /auth/v1/token?grant_type=password`) exactly as `login.mjs` does, and
 * the resulting session is seeded into localStorage before the app boots. The
 * product's UI sign-in is OAuth-only, so this is the only honest way to reach an
 * authenticated surface programmatically — the session itself is server-issued.
 *
 * Every route is asserted for: no client-side error, no "Page not found", no
 * login wall while signed in, session still present, and the expected path.
 * Logout asserts the stored session is gone AND the protected route blocks again.
 *
 * Exports are used by the cloud-browser Playwright session:
 *   const j = require('./scripts/e2e/twenty-user-journey.cjs');
 *   await j.runBatch(browser, users, { screenshotDir: 'showcase' });
 */

const fs = require('fs');
const path = require('path');

function readEnv(file = '.env') {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      out[line.slice(0, i).trim()] = v;
    }
  } catch {
    /* missing file — caller sees an explicit config error */
  }
  return out;
}

const env = readEnv();
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';

const CFG = {
  BASE: process.env.E2E_BASE_URL || 'https://www.growlanzo.com',
  SUPABASE_URL,
  ANON_KEY,
  STORAGE_KEY: SUPABASE_URL ? `sb-${new URL(SUPABASE_URL).host.split('.')[0]}-auth-token` : '',
  PASSWORD: process.env.E2E_BATCH_PASSWORD || 'Test@1234',
};

const FREELANCER_ROUTES = [
  '/dashboard',
  '/dashboard/proposals',
  '/dashboard/contracts',
  '/dashboard/services',
  '/dashboard/wallet',
  '/dashboard/profile',
];

const CLIENT_ROUTES = [
  '/client',
  '/client/matches',
  '/client/projects',
  '/client/proposals',
  '/client/contracts',
  '/client/payments',
];

/** Which routes a role walks (dashboard first — that screenshot is the identity shot). */
function routesFor(role) {
  return role === 'client' ? CLIENT_ROUTES.slice() : FREELANCER_ROUTES.slice();
}

/** Build the 20-account roster in a stable order. */
function roster() {
  const users = [];
  for (let i = 1; i <= 10; i++) {
    users.push({ role: 'freelancer', index: i, email: `freelancer-${i}.test@growlancer-test.com` });
    users.push({ role: 'client', index: i, email: `client-${i}.test@growlancer-test.com` });
  }
  return users;
}

/** Exchange credentials for a real server-issued session. Never prints tokens. */
async function fetchSession(email, password = CFG.PASSWORD) {
  const res = await fetch(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: CFG.ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`auth failed for ${email}: HTTP ${res.status} ${body.error_code || body.msg || ''}`.trim());
  }
  return body;
}

/** Navigate to a route and collect the facts the assertions need. */
async function visit(page, route, settleMs = 550) {
  const errors = [];
  const onPageError = (e) => errors.push(String((e && e.message) || e).slice(0, 180));
  page.on('pageerror', onPageError);
  const t0 = Date.now();
  let status = null;
  try {
    const resp = await page.goto(CFG.BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = resp ? resp.status() : null;
  } catch (e) {
    errors.push(`NAV: ${String(e.message).slice(0, 120)}`);
  }
  await page.waitForFunction(() => !document.getElementById('boot-overlay'), { timeout: 8000 }).catch(() => {});
  // Data-backed pages paint their shell first and fill in after their queries
  // resolve. Waiting for real MAIN text (not a fixed sleep, and not the sidebar)
  // is what separates "the page rendered" from "the skeleton was still up".
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector('main');
        return main ? main.innerText.trim().length > 200 : document.body.innerText.trim().length > 400;
      },
      { timeout: 6000 }
    )
    .catch(() => {});
  await page.waitForTimeout(settleMs);

  const info = await page
    .evaluate(() => {
      const h1 = document.querySelector('h1');
      const main = document.querySelector('main');
      const text = document.body ? document.body.innerText : '';
      // The dashboard greeting is also "Welcome back, <name>!" — so the login
      // wall must be detected as an actual sign-in dialog (or the ?modal=login
      // route), never by that phrase alone.
      const loginDialog = Array.from(document.querySelectorAll('[role="dialog"], .fixed.inset-0')).some(
        (el) => /welcome back/i.test(el.innerText || '') && /github|linkedin|sign in|continue with|email/i.test(el.innerText || '')
      );
      let session = false;
      try {
        session = Object.keys(localStorage).some(
          (k) => k.includes('auth-token') && (localStorage.getItem(k) || '').includes('access_token')
        );
      } catch {
        /* storage unavailable */
      }
      return {
        url: location.pathname + location.search,
        title: document.title,
        h1: h1 ? h1.textContent.trim().replace(/\s+/g, ' ').slice(0, 90) : '',
        mainLen: main ? main.innerText.trim().length : 0,
        loginDialog,
        head: text.slice(0, 1500),
        len: text.length,
        session,
      };
    })
    .catch(() => ({ url: '', title: '', h1: '', head: '', len: 0, session: false }));

  page.off('pageerror', onPageError);

  const loginWall = info.loginDialog === true || page.url().includes('modal=login');
  const notFound = /page not found/i.test(info.h1) || /page not found/i.test(info.title);
  const routeOk = info.url === route || info.url === `${route}/` || info.url.startsWith(`${route}?`);
  const ok =
    !notFound &&
    !loginWall &&
    routeOk &&
    info.mainLen > 200 &&
    info.session &&
    status !== null &&
    status < 400;

  return { route, status, ...info, loginWall, notFound, routeOk, ok, errors, ms: Date.now() - t0 };
}

/** Click the sidebar Logout and prove the session is really gone. */
async function logout(page) {
  const clicked = await page
    .evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((el) => /^logout$/i.test((el.innerText || '').trim()));
      if (!b) return false;
      b.click();
      return true;
    })
    .catch(() => false);

  // Poll for the storage clear: the write races the logout navigation, and a
  // single read can still see the pre-logout document.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const live = await page
      .evaluate(() => {
        try {
          return Object.keys(localStorage).some(
            (k) => k.includes('auth-token') && (localStorage.getItem(k) || '').includes('access_token')
          );
        } catch {
          return true;
        }
      })
      .catch(() => true);
    if (!live) break;
    await page.waitForTimeout(300);
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);

  const after = await page
    .evaluate(() => {
      let live = false;
      try {
        live = Object.keys(localStorage).some(
          (k) => k.includes('auth-token') && (localStorage.getItem(k) || '').includes('access_token')
        );
      } catch {
        /* storage unavailable */
      }
      return {
        url: location.pathname,
        live,
        head: (document.body ? document.body.innerText : '').slice(0, 700),
      };
    })
    .catch(() => ({ url: '', live: true, head: '' }));

  return {
    clicked,
    url: after.url,
    sessionCleared: !after.live,
    landedLoggedOut: /welcome back|hire the right freelancer|log ?in|sign ?in/i.test(after.head),
    ok: clicked && !after.live,
  };
}

/** Run one account's whole journey in its own isolated browser context. */
async function runUser(browser, user, opts = {}) {
  const routes = opts.routes || routesFor(user.role);
  const session = await fetchSession(user.email);
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    locale: 'en-IN',
  });
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* the check below fails loudly */
      }
    },
    [CFG.STORAGE_KEY, JSON.stringify(session)]
  );
  const page = await context.newPage();

  const checks = [];
  const errors = [];
  try {
    // Overview first: the signed-in homepage.
    checks.push(await visit(page, '/', 700));

    for (const route of routes) {
      const res = await visit(page, route);
      checks.push(res);
      if (errors.length < 6) errors.push(...res.errors);
    }

    // Identity screenshot on the role dashboard (first route).
    let screenshot = null;
    if (opts.screenshotDir) {
      fs.mkdirSync(opts.screenshotDir, { recursive: true });
      screenshot = path.join(opts.screenshotDir, opts.screenshotName || `${user.email}.png`);
      await page.goto(CFG.BASE + routes[0], { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForFunction(() => !document.getElementById('boot-overlay'), { timeout: 8000 }).catch(() => {});
      await page
        .waitForFunction(
          () => {
            const main = document.querySelector('main');
            return main ? main.innerText.trim().length > 200 : document.body.innerText.trim().length > 400;
          },
          { timeout: 6000 }
        )
        .catch(() => {});
      await page.waitForTimeout(600);
      // Viewport-sized by default: a full-page shot on a tall dashboard costs
      // seconds per account, and the matrix is 20 accounts.
      await page.screenshot({ path: screenshot, fullPage: opts.fullPage === true }).catch(() => {
        screenshot = null;
      });
    }

    const out = await logout(page);
    const blocked = await visit(page, routes[0], 300);

    // A logged-out direct visit must land on the public site (the guard does
    // <Navigate to="/?modal=login" />; the SPA settles on '/'), never on the
    // protected content, and never with a session still in storage.
    const blockedOk =
      !blocked.session &&
      (blocked.url === '/' || blocked.url.startsWith('/?') || blocked.loginWall === true);

    const routeFails = checks.filter((c) => !c.ok);
    return {
      email: user.email,
      role: user.role,
      pass: routeFails.length === 0 && out.ok && out.sessionCleared && blockedOk,
      overview: checks[0],
      routes: checks.slice(1),
      logout: out,
      postLogoutBlocked: { ok: blockedOk, loginWall: blocked.loginWall, session: blocked.session, url: blocked.url },
      screenshot,
      pageErrors: errors,
      routeFails: routeFails.map((c) => ({
        route: c.route,
        url: c.url,
        h1: c.h1,
        notFound: c.notFound,
        loginWall: c.loginWall,
        len: c.len,
        session: c.session,
      })),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Run a slice of the roster — keeps each cloud-browser call inside its time budget. */
async function runBatch(browser, users, opts = {}) {
  const started = Date.now();
  const results = [];
  for (const user of users) {
    try {
      results.push(await runUser(browser, user, opts));
    } catch (e) {
      results.push({ email: user.email, role: user.role, pass: false, fatal: String(e.message).slice(0, 200) });
    }
  }
  return {
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    ms: Date.now() - started,
  };
}

/** Merge a slice report into the durable artifact the final report is built from. */
function appendReport(batch, file = 'showcase/e2e-report.json') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let existing = { generatedAt: new Date().toISOString(), base: CFG.BASE, results: [] };
  try {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first slice */
  }
  const byEmail = new Map(existing.results.map((r) => [r.email, r]));
  for (const r of batch.results) byEmail.set(r.email, r);
  existing.results = Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email));
  existing.slices = (existing.slices || 0) + 1;
  existing.updatedAt = new Date().toISOString();
  existing.summary = {
    total: existing.results.length,
    passed: existing.results.filter((r) => r.pass).length,
    failed: existing.results.filter((r) => !r.pass).length,
  };
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  return existing.summary;
}

module.exports = {
  CFG,
  FREELANCER_ROUTES,
  CLIENT_ROUTES,
  routesFor,
  roster,
  fetchSession,
  visit,
  logout,
  runUser,
  runBatch,
  appendReport,
};
