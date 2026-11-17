#!/usr/bin/env node
/**
 * Growlanzo — BATCH TEST USER CREATION (20 users)
 *
 * Creates 20 fully-confirmed test users on the LIVE Supabase project:
 *   - 10 freelancers (freelancer-1 .. freelancer-10)
 *   - 10 clients      (client-1 .. client-10)
 *
 * All users get:
 *   - email_confirm: true → login works immediately
 *   - profile via create_user_profile RPC (wallet + notification triggers fire)
 *   - India country + onboarding_completed = true (audited state)
 *
 * Usage:
 *   node scripts/create_test_users_batch.mjs          # create 20 users
 *   node scripts/create_test_users_batch.mjs --cleanup  # delete all 20 + data
 *   node scripts/create_test_users_batch.mjs --list     # show existing
 *
 * ENV (auto-loaded from .env / .env.local):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * SAFE: only touches emails matching TEST_EMAIL_DOMAIN below.
 *       cleanup requires --force (never destructive by accident).
 */
import { readFileSync } from 'fs';

// ── CONFIG ──────────────────────────────────────────────────────────────────
const TEST_EMAIL_DOMAIN = 'growlancer-test.com';
const TEST_PASSWORD = 'Test@1234';

const USER_COUNTS = {
  freelancer: 10,
  client: 10,
};

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
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const ARGS = new Set(process.argv.slice(2));

// ── HELPERS ─────────────────────────────────────────────────────────────────
const h = { 'Content-Type': 'application/json' };

function guard() {
  if (!URL) throw new Error('VITE_SUPABASE_URL missing in .env / .env.local');
  if (!ANON) throw new Error('VITE_SUPABASE_ANON_KEY missing in .env / .env.local');
  if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing in .env / .env.local');
}

const authHeaders = {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...h },
};

async function adminFetch(path, options = {}) {
  const res = await fetch(`${URL}${path}`, { ...options, ...authHeaders, ...options });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

async function listTestUsers() {
  const { ok, json } = await adminFetch('/auth/v1/admin/users?per_page=1000');
  if (!ok || !json?.users) return [];
  return json.users.filter((u) => (u.email || '').toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`));
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

// ── MODE: --list ────────────────────────────────────────────────────────────
if (ARGS.has('--list')) {
  guard();
  const users = await listTestUsers();
  if (users.length === 0) {
    console.log(`\nℹ️  No test users on @${TEST_EMAIL_DOMAIN}.`);
  } else {
    console.log(`\nExisting test users on @${TEST_EMAIL_DOMAIN}:`);
    for (const u of users) {
      console.log(`  • ${u.email}  (id: ${u.id}, created: ${(u.created_at || '').slice(0, 10)})`);
    }
    console.log(`  Total: ${users.length}\n`);
  }
  process.exit(0);
}

// ── MODE: --cleanup ────────────────────────────────────────────────────────
if (ARGS.has('--cleanup')) {
  guard();
  const users = await listTestUsers();
  if (users.length === 0) {
    console.log(`\n✅ No test users to clean on @${TEST_EMAIL_DOMAIN}.\n`);
    process.exit(0);
  }
  if (!ARGS.has('--force')) {
    console.error(`\n⚠️  About to DELETE ${users.length} user(s) from @${TEST_EMAIL_DOMAIN}:`);
    for (const u of users) console.error(`    • ${u.email}`);
    console.error(`\n   This is destructive. Re-run with --force to confirm:`);
    console.error(`   node scripts/create_test_users_batch.mjs --cleanup --force\n`);
    process.exit(1);
  }
  console.log(`\n🗑️  Deleting ${users.length} test user(s) from @${TEST_EMAIL_DOMAIN}...\n`);
  let okCount = 0;
  for (const u of users) {
    const { status, json } = await adminFetch('/rest/v1/rpc/delete_user_all_data', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: u.id }),
    });
    const steps = Array.isArray(json?.steps) ? `${json.steps.length} steps` : '';
    const result = status === 200 ? `✅ deleted (${steps})` : `❌ status ${status}: ${json ? JSON.stringify(json).slice(0, 120) : ''}`;
    console.log(`  ${u.email} → ${result}`);
    if (status === 200) okCount++;
  }
  const { status: profStatus } = await adminFetch(
    `/rest/v1/profiles?email=ilike.*@${TEST_EMAIL_DOMAIN}`,
    { method: 'DELETE' },
  );
  console.log(`\n${okCount}/${users.length} users removed. Stray profile sweep: HTTP ${profStatus}`);
  console.log('✅ Cleanup complete.\n');
  process.exit(0);
}

// ── MODE: create ────────────────────────────────────────────────────────────
guard();

const totals = { freelancer: USER_COUNTS.freelancer, client: USER_COUNTS.client };
const existing = await listTestUsers();
const existingEmails = new Set(existing.map((u) => u.email.toLowerCase()));

const toCreate = [];
for (const [role, count] of Object.entries(totals)) {
  for (let i = 1; i <= count; i++) {
    const email = `${role}-${i}.test@${TEST_EMAIL_DOMAIN}`;
    if (!existingEmails.has(email)) {
      toCreate.push({ role, email, name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)} ${i}` });
    }
  }
}

if (toCreate.length === 0) {
  console.log(`\nℹ️  All ${totals.freelancer + totals.client} test users already exist on @${TEST_EMAIL_DOMAIN}.`);
  console.log(`   (Use --cleanup --force to wipe, or --list to see them.)\n`);
  process.exit(0);
}

console.log(`\n🔧 Creating ${toCreate.length} test user(s) on ${URL}`);
console.log(`   ${totals.freelancer} freelancers + ${totals.client} clients = ${totals.freelancer + totals.client} total`);
console.log(`   Domain: @${TEST_EMAIL_DOMAIN}`);
console.log(`   Password: ${TEST_PASSWORD}\n`);

// Stats tracking
const stats = {
  created: 0,
  failed: [],
  byRole: { freelancer: 0, client: 0 },
};

for (const user of toCreate) {
  const isFreelancer = user.role === 'freelancer';
  const roleLabel = isFreelancer ? 'FREELANCER' : 'CLIENT';

  // 1. Create auth user (email confirmed)
  const { status, json } = await adminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: user.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { name: user.name, role: user.role },
    }),
  });

  if (!json?.id) {
    const err = json ? JSON.stringify(json).slice(0, 200) : `HTTP ${status}`;
    console.log(`  ✗ ${user.email} → CREATE FAILED (${status}): ${err}`);
    stats.failed.push({ email: user.email, stage: 'create', detail: err });
    continue;
  }

  const userId = json.id;

  // 2. Create profile via production RPC
  const { status: rpcStatus, json: rpcJson } = await adminFetch('/rest/v1/rpc/create_user_profile', {
    method: 'POST',
    body: JSON.stringify({
      p_id: userId,
      p_email: user.email,
      p_name: user.name,
      p_role: user.role,
      p_referral_code: null,
    }),
  });

  if (rpcStatus !== 200) {
    console.log(`  ⚠ ${user.email} → user created but profile RPC failed (${rpcStatus}): ${rpcJson ? JSON.stringify(rpcJson).slice(0, 160) : ''}`);
    // Non-fatal: user exists, profile may be partial
  }

  // 3. Set onboarded state (India + onboarding_completed)
  const onboarded = await adminFetch('/rest/v1/profiles_private?id=eq.' + userId, {
    method: 'PATCH',
    body: JSON.stringify({
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    }),
  });

  const profilePatch = await adminFetch('/rest/v1/profiles?id=eq.' + userId, {
    method: 'PATCH',
    body: JSON.stringify({
      country: 'India',
      updated_at: new Date().toISOString(),
    }),
  });

  // 4. Verify the state
  const verifyRes = await adminFetch('/rest/v1/profiles_private?id=eq.' + userId + '&select=onboarding_completed', {
    headers: { ...authHeaders.headers, Prefer: 'return=minimal' },
  });

  const isOnboarded = verifyRes.json && verifyRes.json.length > 0 && verifyRes.json[0].onboarding_completed === true;

  if (status === 200 && isOnboarded) {
    stats.created++;
    stats.byRole[user.role]++;
    console.log(`  ✅ ${user.email} → ${roleLabel} ${stats.byRole[user.role]}/${totals[user.role]}`);
  } else {
    stats.failed.push({
      email: user.email,
      stage: 'onboarding',
      detail: `onboarding_completed=${isOnboarded}, profilePatch=${profilePatch.status}`,
    });
    console.log(`  ✗ ${user.email} → ONBOARD FAIL (${isOnboarded ? 'onboarded' : 'not onboarded'})`);
  }
}

// ── SUMMARY ─────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
console.log('  🎉 TEST USERS CREATION COMPLETE');
console.log('══════════════════════════════════════════════════════════');
console.log(`\n  Total created : ${stats.created}/${toCreate.length}`);
console.log(`  Freelancers   : ${stats.byRole.freelancer}/${totals.freelancer}`);
console.log(`  Clients       : ${stats.byRole.client}/${totals.client}`);
console.log(`  Failed        : ${stats.failed.length}`);

if (stats.failed.length > 0) {
  console.log('\n  Failed accounts:');
  for (const f of stats.failed) {
    console.log(`    • ${f.email} — ${f.stage}: ${f.detail}`);
  }
}

console.log('\n  Credentials (all users):');
console.log(`    Email domain : @${TEST_EMAIL_DOMAIN}`);
console.log(`    Password     : ${TEST_PASSWORD}`);
console.log(`    Format       : <role>-<number>.test@${TEST_EMAIL_DOMAIN}`);
console.log(`                  e.g. freelancer-1.test@${TEST_EMAIL_DOMAIN}`);
console.log(`                  e.g. client-1.test@${TEST_EMAIL_DOMAIN}`);
console.log(`\n  Test site: https://www.growlanzo.com`);
console.log('══════════════════════════════════════════════════════════\n');

// Cleanup
await new Promise((r) => setTimeout(r, 150));
process.exit(stats.failed.length > 0 ? 1 : 0);
