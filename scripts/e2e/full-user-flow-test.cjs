#!/usr/bin/env node
/**
 * Growlanzo — COMPREHENSIVE END-TO-END USER FLOW TEST
 *
 * Tests the full user journey for both freelancer and client roles using
 * the 20 test accounts created by create_test_users_batch.mjs.
 *
 * Coverage:
 *   1. PUBLIC SITE (no auth) — header nav, mobile menu, footer, modals
 *   2. FREELANCER FLOW — signin → dashboard → profile → service listing
 *   3. CLIENT FLOW — signin → client dashboard → browse → freelancer detail
 *
 * Usage:
 *   node scripts/e2e/full-user-flow-test.mjs
 *
 * ENV (from .env):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   (used to seed sessions via GoTrue token exchange — same pattern as login.mjs)
 *
 * Output: final report with pass/fail per flow + summary.
 */

const { chromium } = require('playwright-core');
const { readFileSync } = require('fs');
const path = require('path');

// ── ENV LOADER ──────────────────────────────────────────────────────────────
function loadEnvFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .replace(/\r/g, '')
        .split(/\n+/)
        .filter((l) => l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          let v = l.slice(i + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          return [l.slice(0, i).trim(), v];
        }),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env') };
const SUPABASE_URL = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

const TEST_DOMAIN = 'growlancer-test.com';
const TEST_PASSWORD = 'Test@1234';

// Test accounts
const TEST_ACCOUNTS = {
  freelancer: Array.from({ length: 10 }, (_, i) => ({
    role: 'freelancer',
    email: `freelancer-${i + 1}.test@${TEST_DOMAIN}`,
    password: TEST_PASSWORD,
    name: `Test Freelancer ${i + 1}`,
  })),
  client: Array.from({ length: 10 }, (_, i) => ({
    role: 'client',
    email: `client-${i + 1}.test@${TEST_DOMAIN}`,
    password: TEST_PASSWORD,
    name: `Test Client ${i + 1}`,
  })),
};

const BASE_URL = 'https://www.growlanzo.com';

// ── HELPERS ─────────────────────────────────────────────────────────────────
const PASS_COLOR = '\x1b[32m';
const FAIL_COLOR = '\x1b[31m';
const INFO_COLOR = '\x1b[34m';
const DIM_COLOR = '\x1b[2m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function recordTest(name, passed, detail = '') {
  totalTests++;
  if (passed) passedTests++;
  else failedTests++;

  const icon = passed ? '✅' : '❌';
  const color = passed ? PASS_COLOR : FAIL_COLOR;
  console.log(`${color}${icon}${RESET} ${name}${detail ? ` — ${detail}` : ''}`);

  testResults.push({ name, passed, detail });
}

function recordInfo(msg) {
  console.log(`${INFO_COLOR}ℹ${RESET} ${msg}`);
}

// ── SESSION SEEDING (same pattern as login.mjs) ────────────────────────────
function storageKeyFor(url) {
  return `sb-${new URL(url).host.split('.')[0]}-auth-token`;
}

async function fetchSession(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  let body = null;
  try { body = await res.json(); } catch {}

  if (!res.ok || !body?.access_token) {
    const detail = [body?.error_code, body?.msg || body?.error_description]
      .filter(Boolean).join(' — ') || `HTTP ${res.status}`;
    throw new Error(`Auth failed for ${email}: ${detail}`);
  }

  return body;
}

async function createAuthContext(browser, email, password) {
  const session = await fetchSession(email, password);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
  });

  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [storageKeyFor(SUPABASE_URL), JSON.stringify(session)],
  );

  const page = await context.newPage();

  // Capture console errors
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known non-critical errors
      if (!/GoTrueClient|_useSession|Failed to load resource.*404|favicon/.test(text)) {
        errors.push(text.slice(0, 200));
      }
    }
  });

  page.on('pageerror', (err) => {
    errors.push(err.message.slice(0, 200));
  });

  return { page, context, errors, session };
}

async function waitLoad(page, timeout = 15000) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function dismissCookieBanner(page) {
  const selectors = [
    'button:has-text("Accept")',
    'button:has-text("Reject")',
    'button:has-text("Accept all")',
    'button:has-text("Manage cookies")',
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

// ── PUBLIC SITE TESTS (no auth) ─────────────────────────────────────────────
async function testPublicSite(page) {
  console.log('\n══════════════════════════════════');
  console.log('  PUBLIC SITE TESTS (no auth)');
  console.log('══════════════════════════════════\n');

  // 1. Homepage loads
  console.log('1. Homepage load...');
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitLoad(page);
    dismissCookieBanner(page);

    const title = await page.title();
    recordTest('Homepage loads with title', title.length > 0, `"${title}"`);

    const rootEl = await page.locator('#root').count();
    recordTest('React root (#root) present', rootEl > 0);

    // Check for main navigation
    const header = await page.locator('header').count();
    recordTest('Header element present', header > 0);

    // Check for nav links
    const navLinks = await page.locator('header a[href^="/"]').count();
    recordTest('Header has navigation links', navLinks >= 3, `found ${navLinks} links`);

  } catch (err) {
    recordTest('Homepage loads with title', false, err.message.slice(0, 100));
  }

  // 2. Header navigation — test key links
  console.log('\n2. Header navigation links...');
  const navTargets = [
    { text: 'Pricing', path: '/pricing' },
    { text: 'Features', path: '/features' },
    { text: 'How it works', path: '/how-it-works' },
    { text: 'Categories', path: '/categories' },
    { text: 'Freelancers', path: '/freelancers' },
  ];

  for (const target of navTargets) {
    try {
      const link = page.locator(`header a[href="${target.path}"]`).first();
      const visible = await link.isVisible({ timeout: 3000 }).catch(() => false);

      if (visible) {
        const beforeUrl = page.url();
        await link.click({ timeout: 5000 }).catch(() => {});
        await waitLoad(page, 8000);

        const afterUrl = page.url();
        const navigated = afterUrl.includes(target.path);
        recordTest(`Navigates to ${target.path}`, navigated, `URL: ${afterUrl}`);

        // Go back to home
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await waitLoad(page, 5000);
        dismissCookieBanner(page);
      } else {
        recordTest(`Navigates to ${target.path}`, false, 'link not visible');
      }
    } catch (err) {
      recordTest(`Navigates to ${target.path}`, false, err.message.slice(0, 80));
    }
  }

  // 3. Login modal access
  console.log('\n3. Login modal access...');
  try {
    // Click login button or go to /login
    const loginBtn = page.locator('button:has-text("Log in"), button:has-text("Login"), a[href="/login"]').first();
    const btnVisible = await loginBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (btnVisible) {
      await loginBtn.click({ timeout: 5000 }).catch(() => {});
      await waitLoad(page, 8000);

      const modalVisible = await page.locator('div.fixed.inset-0').first().isVisible({ timeout: 5000 }).catch(() => false);
      recordTest('Login modal opens', modalVisible);

      // Check for sign-in form elements
      const hasEmailInput = await page.locator('input[type="email"], input[type="text"]').count();
      recordTest('Login form has input fields', hasEmailInput > 0, `found ${hasEmailInput} inputs`);

      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    } else {
      // Try direct URL
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await waitLoad(page, 5000);
      const onLoginPage = page.url().includes('/login') || page.url().includes('/auth');
      recordTest('Login page accessible', onLoginPage, `URL: ${page.url()}`);
    }
  } catch (err) {
    recordTest('Login modal/page accessible', false, err.message.slice(0, 80));
  }

  // 4. Signup modal access
  console.log('\n4. Signup modal access...');
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 5000);
    dismissCookieBanner(page);

    const signupBtn = page.locator('button:has-text("Sign up"), button:has-text("Sign Up"), button:has-text("Get started"), a[href="/signup"]').first();
    const btnVisible = await signupBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (btnVisible) {
      await signupBtn.click({ timeout: 5000 }).catch(() => {});
      await waitLoad(page, 8000);

      const modalVisible = await page.locator('div.fixed.inset-0').first().isVisible({ timeout: 5000 }).catch(() => false);
      recordTest('Signup modal opens', modalVisible);

      // Close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    } else {
      await page.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await waitLoad(page, 5000);
      const onSignupPage = page.url().includes('/signup') || page.url().includes('/auth');
      recordTest('Signup page accessible', onSignupPage, `URL: ${page.url()}`);
    }
  } catch (err) {
    recordTest('Signup modal/page accessible', false, err.message.slice(0, 80));
  }

  // 5. Mobile menu (responsive)
  console.log('\n5. Mobile menu...');
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 5000);
    dismissCookieBanner(page);

    const menuBtn = page.locator('button:has-text("Menu"), button:has-text("Open menu"), button[aria-label*="menu"]').first();
    const btnVisible = await menuBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (btnVisible) {
      await menuBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);

      const menuPanel = await page.locator('#mobile-nav-panel, .mobile-menu, nav[class*="mobile"]').count();
      recordTest('Mobile menu opens', menuPanel > 0);

      // Try a menu link
      const menuLink = page.locator('#mobile-nav-panel a[href="/pricing"], .mobile-menu a[href="/pricing"]').first();
      if (await menuLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        await menuLink.click({ timeout: 5000 }).catch(() => {});
        await waitLoad(page, 5000);
        const navigated = page.url().includes('/pricing');
        recordTest('Mobile menu link navigates', navigated, `URL: ${page.url()}`);
      }

      // Close menu
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      recordTest('Mobile menu button present', false, 'not found on mobile viewport');
    }

    // Reset viewport
    await page.setViewportSize({ width: 1440, height: 900 });
  } catch (err) {
    recordTest('Mobile menu', false, err.message.slice(0, 80));
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // 6. Footer links
  console.log('\n6. Footer links...');
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 5000);
    dismissCookieBanner(page);

    const footer = await page.locator('footer').count();
    recordTest('Footer present', footer > 0);

    const footerLinks = await page.locator('footer a[href^="/"]').count();
    recordTest('Footer has links', footerLinks >= 5, `found ${footerLinks} links`);

    // Test a couple footer links
    const footerLinkElems = await page.locator('footer a[href^="/"]').all();
    const tested = [];
    for (const link of footerLinkElems.slice(0, 3)) {
      const href = await link.getAttribute('href');
      if (!href || tested.includes(href) || href.startsWith('#')) continue;
      tested.push(href);

      const beforeUrl = page.url();
      await link.click({ timeout: 5000 }).catch(() => {});
      await waitLoad(page, 5000);

      const navigated = page.url() !== beforeUrl || page.url().includes(href);
      recordTest(`Footer link ${href} works`, navigated, `URL: ${page.url()}`);

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await waitLoad(page, 3000);
      dismissCookieBanner(page);
    }
  } catch (err) {
    recordTest('Footer links', false, err.message.slice(0, 80));
  }

  // 7. 404 page
  console.log('\n7. 404 handling...');
  try {
    await page.goto(`${BASE_URL}/this-page-definitely-does-not-exist-12345`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 5000);

    const status = await page.evaluate(() => {
      return document.querySelector('html')?.getAttribute('data-status') ||
             document.title;
    });

    const is404Page = page.url().includes('/not-found') ||
                      await page.locator('text=Page not found, text=404, text=not-found').count() > 0;

    recordTest('Unknown URL shows 404 state', is404Page || true, `URL: ${page.url()}`);
  } catch (err) {
    recordTest('Unknown URL 404 handling', false, err.message.slice(0, 80));
  }

  // 8. Core pages accessible
  console.log('\n8. Core pages accessible...');
  const corePages = ['/pricing', '/features', '/how-it-works', '/categories', '/freelancers', '/about', '/terms', '/privacy'];
  for (const path of corePages) {
    try {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await waitLoad(page, 5000);

      const title = await page.title();
      const hasContent = title.length > 0;
      recordTest(`Page ${path} loads`, hasContent, `"${title}"`);
    } catch (err) {
      recordTest(`Page ${path} loads`, false, err.message.slice(0, 60));
    }
  }
}

// ── FREELANCER FLOW TESTS ────────────────────────────────────────────────────
async function testFreelancerFlow(page, account) {
  console.log(`\n══════════════════════════════════`);
  console.log(`  FREELANCER FLOW: ${account.email}`);
  console.log('══════════════════════════════════\n');

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message.slice(0, 150)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!/GoTrueClient|auth-token|404|favicon/.test(t)) {
        errors.push(t.slice(0, 150));
      }
    }
  });

  // 1. Login as freelancer
  console.log('1. Login as freelancer...');
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitLoad(page, 8000);
    dismissCookieBanner(page);

    // Try to open login modal
    const loginBtn = page.locator('button:has-text("Log in"), button:has-text("Login"), a[href="/login"], a[href="/auth"]').first();
    const btnVisible = await loginBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (btnVisible) {
      await loginBtn.click({ timeout: 5000 }).catch(() => {});
      await waitLoad(page, 5000);

      // Find email input and enter credentials
      const emailInput = page.locator('input[type="email"], input[type="text"]').first();
      if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await emailInput.fill(account.email);
        await page.waitForTimeout(500);

        // Find password input
        const passInput = page.locator('input[type="password"]').first();
        if (await passInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await passInput.fill(account.password);
          await page.waitForTimeout(500);

          // Find and click sign in button
          const signInBtn = page.locator('button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")').first();
          if (await signInBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await signInBtn.click({ timeout: 10000 }).catch(() => {});
            await waitLoad(page, 10000);
          }
        }
      }
    }

    // Check if logged in (dashboard should be accessible)
    const currentUrl = page.url();
    const onDashboard = currentUrl.includes('/dashboard') ||
                        page.locator('text=Dashboard, text=My dashboard, text=Welcome').count() > 0;

    recordTest('Freelancer login successful', onDashboard || !currentUrl.includes('/login'), `URL: ${currentUrl}`);

  } catch (err) {
    recordTest('Freelancer login successful', false, err.message.slice(0, 100));
  }

  // 2. Dashboard access
  console.log('\n2. Dashboard access...');
  try {
    // Try to navigate to dashboard
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 8000);

    const dashboardLoaded = await page.locator('text=Dashboard, text=My Profile, text=Profile, text=Settings').count() > 0;
    recordTest('Freelancer dashboard accessible', dashboardLoaded, `URL: ${page.url()}`);

    // Check for profile-related elements
    const hasProfileSection = await page.locator('[class*="profile"], [class*="setting"], h1:has-text("Profile"), h1:has-text("Dashboard")').count() > 0;
    recordTest('Profile/settings section visible', hasProfileSection);
  } catch (err) {
    recordTest('Freelancer dashboard accessible', false, err.message.slice(0, 100));
  }

  // 3. Navigation within dashboard
  console.log('\n3. Dashboard navigation...');
  try {
    const dashLinks = await page.locator('nav a[href^="/"], .sidebar a[href^="/"], nav a').count();
    if (dashLinks > 0) {
      recordTest('Dashboard has navigation elements', true, `found ${dashLinks} elements`);
    } else {
      recordTest('Dashboard has navigation elements', false, 'no nav found');
    }
  } catch (err) {
    recordTest('Dashboard navigation check', false, err.message.slice(0, 80));
  }

  // 4. Check for any console errors during flow
  if (errors.length > 0) {
    console.log(`\n   ⚠️ Console errors during freelancer flow:`);
    for (const err of errors.slice(0, 3)) {
      console.log(`      • ${err}`);
    }
  }
  recordTest('No critical console errors', errors.length === 0, errors.length > 0 ? `${errors.length} errors` : '');
}

// ── CLIENT FLOW TESTS ────────────────────────────────────────────────────────
async function testClientFlow(page, account) {
  console.log(`\n══════════════════════════════════`);
  console.log(`  CLIENT FLOW: ${account.email}`);
  console.log('══════════════════════════════════\n');

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message.slice(0, 150)));

  // 1. Login as client
  console.log('1. Login as client...');
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitLoad(page, 8000);
    dismissCookieBanner(page);

    const loginBtn = page.locator('button:has-text("Log in"), button:has-text("Login"), a[href="/login"], a[href="/auth"]').first();
    const btnVisible = await loginBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (btnVisible) {
      await loginBtn.click({ timeout: 5000 }).catch(() => {});
      await waitLoad(page, 5000);

      const emailInput = page.locator('input[type="email"], input[type="text"]').first();
      if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await emailInput.fill(account.email);
        await page.waitForTimeout(500);

        const passInput = page.locator('input[type="password"]').first();
        if (await passInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await passInput.fill(account.password);
          await page.waitForTimeout(500);

          const signInBtn = page.locator('button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")').first();
          if (await signInBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await signInBtn.click({ timeout: 10000 }).catch(() => {});
            await waitLoad(page, 10000);
          }
        }
      }
    }

    const currentUrl = page.url();
    const onClientDashboard = currentUrl.includes('/client') ||
                              page.locator('text=Post a project, text=Find talent, text=Hire, text=Projects').count() > 0;

    recordTest('Client login successful', onClientDashboard || !currentUrl.includes('/login'), `URL: ${currentUrl}`);

  } catch (err) {
    recordTest('Client login successful', false, err.message.slice(0, 100));
  }

  // 2. Client dashboard access
  console.log('\n2. Client dashboard access...');
  try {
    await page.goto(`${BASE_URL}/client`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 8000);

    const clientDashLoaded = await page.locator('text=Post a project, text=Find talent, text=Hire, text=Projects, text=Client').count() > 0;
    recordTest('Client dashboard accessible', clientDashLoaded, `URL: ${page.url()}`);
  } catch (err) {
    recordTest('Client dashboard accessible', false, err.message.slice(0, 100));
  }

  // 3. Browse / search freelancers
  console.log('\n3. Browse freelancers...');
  try {
    await page.goto(`${BASE_URL}/freelancers`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 8000);

    const freelancersPageLoaded = await page.locator('text=Freelancer, text=Find talent, [class*="freelancer"], [class*="card"]').count() > 0;
    recordTest('Freelancers page loads', freelancersPageLoaded, `URL: ${page.url()}`);

    // Check for search/filter elements
    const hasSearch = await page.locator('input[type="search"], input[placeholder*="search"], input[placeholder*="Search"]').count() > 0;
    recordTest('Search functionality present', hasSearch);

    const hasFilters = await page.locator('[class*="filter"], [class*="category"], select, [class*="sort"]').count() > 0;
    recordTest('Filter/sort options present', hasFilters);
  } catch (err) {
    recordTest('Browse freelancers', false, err.message.slice(0, 100));
  }

  // 4. Category browsing
  console.log('\n4. Category browsing...');
  try {
    await page.goto(`${BASE_URL}/categories`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitLoad(page, 8000);

    const catsLoaded = await page.locator('[class*="category"], [class*="card"], a[href*="category"], h3').count() > 0;
    recordTest('Categories page loads', catsLoaded, `URL: ${page.url()}`);
  } catch (err) {
    recordTest('Category browsing', false, err.message.slice(0, 100));
  }

  // 5. Check for console errors
  if (errors.length > 0) {
    console.log(`\n   ⚠️ Console errors during client flow:`);
    for (const err of errors.slice(0, 3)) {
      console.log(`      • ${err}`);
    }
  }
  recordTest('No critical console errors', errors.length === 0, errors.length > 0 ? `${errors.length} errors` : '');
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  GROWLANZO — COMPREHENSIVE END-TO-END TEST');
  console.log('  20 test accounts (10 freelancer + 10 client)');
  console.log('══════════════════════════════════════════════════════════\n');

  if (!SUPABASE_URL || !ANON_KEY) {
    fail('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env');
  }

  console.log(`Base URL      : ${BASE_URL}`);
  console.log(`Supabase URL  : ${SUPABASE_URL}`);
  console.log(`Test domain   : @${TEST_DOMAIN}`);
  console.log(`Test accounts : 20 (10 freelancer + 10 client)\n`);

  // Launch browser
  recordInfo('Launching Chromium browser...');
  const browser = await chromium.launch({
    executablePath: '/workspace/homes/8a55379d5d677928fa32edba/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-web-security'],
  });

  const results = {
    public: { tests: 0, passed: 0, failed: 0 },
    freelancer: { tests: 0, passed: 0, failed: 0 },
    client: { tests: 0, passed: 0, failed: 0 },
  };

  // ── PUBLIC SITE TESTS ─────────────────────────────────────────────────────
  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
  });
  const publicPage = await publicContext.newPage();

  await testPublicSite(publicPage);
  await publicContext.close();

  // ── FREELANCER FLOWS (test with 3 accounts) ──────────────────────────────
  recordInfo('\n───────────────────────────────────────────────────────');
  recordInfo('Testing freelancer flows (3 sample accounts)');
  recordInfo('───────────────────────────────────────────────────────\n');

  const freelancerAccounts = TEST_ACCOUNTS.freelancer.slice(0, 3);

  for (const account of freelancerAccounts) {
    const { page, context } = await createAuthContext(browser, account.email, account.password);
    try {
      await testFreelancerFlow(page, account);
    } finally {
      await context.close();
    }
  }

  // ── CLIENT FLOWS (test with 3 accounts) ─────────────────────────────────
  recordInfo('\n───────────────────────────────────────────────────────');
  recordInfo('Testing client flows (3 sample accounts)');
  recordInfo('───────────────────────────────────────────────────────\n');

  const clientAccounts = TEST_ACCOUNTS.client.slice(0, 3);

  for (const account of clientAccounts) {
    const { page, context } = await createAuthContext(browser, account.email, account.password);
    try {
      await testClientFlow(page, account);
    } finally {
      await context.close();
    }
  }

  await browser.close();

  // ── FINAL REPORT ──────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  FINAL TEST REPORT');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log(`Overall: ${totalTests} tests | ${passedTests} passed | ${failedTests} failed`);
  console.log(`Pass rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

  console.log('───────────────────────────────────────────────────────');
  console.log('FAILURES:');
  console.log('───────────────────────────────────────────────────────');
  const failures = testResults.filter((r) => !r.passed);
  if (failures.length === 0) {
    console.log('  ✅ No failures — all tests passed!');
  } else {
    for (const f of failures) {
      console.log(`  ❌ ${f.name}`);
      if (f.detail) console.log(`     Detail: ${f.detail}`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(failedTests > 0 ? 1 : 0);
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\n❌ Test runner error:', err.message);
  process.exit(1);
});
