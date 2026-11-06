#!/usr/bin/env node
/**
 * ────────────────────────────────────────────────────────────────────────────
 * GROWLANZO — TEST USER CREATION SCRIPT
 * ────────────────────────────────────────────────────────────────────────────
 * Ready-to-run. Creates fully-confirmed test users (freelancer + client +
 * optional admin) on the LIVE Supabase project, so you can test the whole
 * product with real logins — no email verification needed.
 *
 * USAGE:
 *   node scripts/create_test_users.mjs                      # create freelancer + client
 *   node scripts/create_test_users.mjs --admin              # also create a test admin
 *   node scripts/create_test_users.mjs --cleanup            # delete ALL test users + their data
 *   node scripts/create_test_users.mjs --list               # show existing test users
 *
 * ENV (auto-loaded from .env / .env.local):
 *   VITE_SUPABASE_URL          (required)
 *   VITE_SUPABASE_ANON_KEY     (required — fallback SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY  (required — from Supabase dashboard → Settings → API)
 *
 * DEFAULT TEST USERS (edit below):
 *   freelancer.test@mydomain.com / Test@1234
 *   client.test@mydomain.com     / Test@1234
 *   admin.test@mydomain.com      / Test@1234   (only with --admin)
 *
 * NOTES:
 *   - Users are created with email_confirm: true → login directly works.
 *   - Profiles are created via the production create_user_profile RPC, so the
 *     normal AFTER-INSERT triggers fire (wallet, notification preferences…).
 *   - Admin user gets role='admin' + is_admin=true on the profile.
 *   - --cleanup uses delete_user_all_data() — full cascade (contracts, escrow,
 *     wallets, reviews, transactions, notifications…) and removes auth.users.
 *   - SAFE: only touches emails matching TEST_EMAIL_DOMAIN below.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';

// ── CONFIG ──────────────────────────────────────────────────────────────────
const TEST_EMAIL_DOMAIN = 'mydomain.com'; // ⚠️ cleanup only touches this domain
const TEST_PASSWORD = 'Test@1234'; // must meet password policy (min 8 chars, 1 upper, 1 number, 1 symbol)

const USERS = [
  {
    key: 'freelancer',
    email: `freelancer.test@${TEST_EMAIL_DOMAIN}`,
    name: 'Test Freelancer',
    role: 'freelancer',
  },
  {
    key: 'client',
    email: `client.test@${TEST_EMAIL_DOMAIN}`,
    name: 'Test Client',
    role: 'client',
  },
];

const ADMIN_USER = {
  key: 'admin',
  email: `admin.test@${TEST_EMAIL_DOMAIN}`,
  name: 'Test Admin',
  role: 'admin',
};

// ── ENV LOADER (handles CRLF + quoted values + .env/.env.local merge) ──────
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
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://zttwsjehcgaicziqyxpq.supabase.co';
const ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const ARGS = new Set(process.argv.slice(2));

// ── HELPERS ────────────────────────────────────────────────────────────────
const h = { 'Content-Type': 'application/json' };

function guardServiceKey() {
  if (!SERVICE) {
    fail('SUPABASE_SERVICE_ROLE_KEY missing in .env / .env.local (project Settings → API → service_role key)');
  }
}

async function adminFetch(path, options = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...options,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...h, ...(options.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

async function listTestUsers() {
  const { ok, json } = await adminFetch(`/auth/v1/admin/users?per_page=1000`);
  if (!ok || !json?.users) return [];
  return json.users.filter((u) => (u.email || '').toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`));
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

// ── MODE: --list ───────────────────────────────────────────────────────────
if (ARGS.has('--list')) {
  guardServiceKey();
  const users = await listTestUsers();
  if (users.length === 0) {
    console.log('\nℹ️  No test users found on the @' + TEST_EMAIL_DOMAIN + ' domain.');
  } else {
    console.log('\nExisting test users:');
    for (const u of users) {
      console.log(`  • ${u.email}  (id: ${u.id}, created: ${(u.created_at || '').slice(0, 10)})`);
    }
  }
  process.exit(0);
}

// ── MODE: --cleanup ────────────────────────────────────────────────────────
if (ARGS.has('--cleanup')) {
  guardServiceKey();
  const users = await listTestUsers();
  if (users.length === 0) {
    console.log('\n✅ No test users found — nothing to clean.');
    process.exit(0);
  }
  // 🛡️ Production-safety: never delete without an explicit --force.
  if (!ARGS.has('--force')) {
    console.error(`\n⚠️  About to DELETE ${users.length} user(s) ending in @${TEST_EMAIL_DOMAIN} from the LIVE database:`);
    for (const u of users) console.error(`    • ${u.email}`);
    console.error(`\n   This is destructive and cannot be undone.`);
    console.error(`   Re-run with --force to confirm:  node scripts/create_test_users.mjs --cleanup --force\n`);
    process.exit(1);
  }
  console.log(`\n🗑️  Deleting ${users.length} test user(s) from @${TEST_EMAIL_DOMAIN}...\n`);
  let okCount = 0;
  for (const u of users) {
    const { status, json } = await adminFetch('/rest/v1/rpc/delete_user_all_data', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: u.id }),
    });
    const steps = Array.isArray(json?.steps) ? `${json.steps.length} cleanup steps` : '';
    const result = status === 200 ? `✅ deleted (${steps})` : `❌ status ${status}: ${JSON.stringify(json).slice(0, 120)}`;
    console.log(`  ${u.email} → ${result}`);
    if (status === 200) okCount++;
  }
  // Also remove any stray profile rows for the domain (shouldn't happen, but safe)
  const { status: profStatus } = await adminFetch(
    `/rest/v1/profiles?email=ilike.*@${TEST_EMAIL_DOMAIN}`,
    { method: 'DELETE' },
  );
  console.log(`\n${okCount}/${users.length} users removed. Stray-profile sweep: HTTP ${profStatus}`);
  console.log('✅ Cleanup complete — live DB is back to a clean state.\n');
  process.exit(0);
}

// ── MODE: create ───────────────────────────────────────────────────────────
if (!ANON) fail('VITE_SUPABASE_ANON_KEY missing in .env / .env.local');
guardServiceKey();

const targets = [...USERS];
if (ARGS.has('--admin')) targets.push(ADMIN_USER);

// De-duplicate if an email already exists
const existing = await listTestUsers();
const existingEmails = new Set(existing.map((u) => u.email.toLowerCase()));
const toCreate = targets.filter((u) => !existingEmails.has(u.email));

if (toCreate.length === 0) {
  console.log('\nℹ️  All test users already exist — nothing to create.');
  console.log('   (Use --cleanup to delete them first, or --list to see them.)\n');
  process.exit(0);
}

// 🆙 --admin re-runs: promote an existing admin.test@… user that was created
// earlier WITHOUT --admin (dedup skips creation, but promotion must still run).
if (ARGS.has('--admin')) {
  const existingAdmin = existing.find((u) => u.email.toLowerCase() === ADMIN_USER.email);
  if (existingAdmin) {
    await adminFetch(`/rest/v1/profiles?id=eq.${existingAdmin.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'admin', is_admin: true }),
    });
    console.log(`  ✅ ${ADMIN_USER.email}  → already existed, promoted to ADMIN (role=admin, is_admin=true)`);
  }
}

console.log(`\n🔧 Creating ${toCreate.length} test user(s) on ${URL}\n`);

for (const u of toCreate) {
  // 1. Create the auth user (email confirmed → login works immediately)
  const { status, json } = await adminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: u.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { name: u.name, role: u.role === 'admin' ? 'client' : u.role },
    }),
  });
  if (!json?.id) {
    console.log(`  ✗ ${u.email} → creation failed: HTTP ${status} ${JSON.stringify(json).slice(0, 200)}`);
    continue;
  }
  const userId = json.id;

  // 2. Create the profile via the production RPC (fires wallet + notification triggers)
  const rpcRole = u.role === 'admin' ? 'client' : u.role; // create_user_profile only accepts freelancer/client
  const { status: rpcStatus, json: rpcJson } = await adminFetch('/rest/v1/rpc/create_user_profile', {
    method: 'POST',
    body: JSON.stringify({ p_id: userId, p_email: u.email, p_name: u.name, p_role: rpcRole, p_referral_code: null }),
  });
  if (rpcStatus !== 200) {
    console.log(`  ⚠ ${u.email} → user created but profile RPC failed (${rpcStatus}): ${JSON.stringify(rpcJson).slice(0, 160)}`);
  }

  // 3. Admin only: promote role + legacy flag (matches AdminAuthGuard check)
  if (u.role === 'admin') {
    await adminFetch(`/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'admin', is_admin: true }),
    });
    console.log(`  ✅ ${u.email}  → ADMIN created + promoted (role=admin, is_admin=true)`);
  } else {
    console.log(`  ✅ ${u.email}  → created (${u.role}, wallet + preferences auto-setup)`);
  }
}

// ── SUMMARY ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
console.log('  🎉 TEST USERS READY — login credentials');
console.log('══════════════════════════════════════════════════════════');
for (const u of targets) {
  console.log(`\n  ${u.name}`);
  console.log(`    Email    : ${u.email}`);
  console.log(`    Password : ${TEST_PASSWORD}`);
  console.log(`    Role     : ${u.role.toUpperCase()}`);
}
console.log('\n  🔗 Test at: https://growlancer.vercel.app');
console.log('  🧹 Cleanup : node scripts/create_test_users.mjs --cleanup --force');
console.log('══════════════════════════════════════════════════════════\n');

// Let undici's fetch sockets settle before exiting — prevents a spurious
// Windows libuv `UV_HANDLE_CLOSING` assertion during process teardown.
await new Promise((r) => setTimeout(r, 150));
process.exit(0);
