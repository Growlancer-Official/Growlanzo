#!/usr/bin/env node
/**
 * Push Supabase Auth redirect URLs to production.
 *
 * Run: node scripts/push_redirect_urls.mjs
 *
 * Requires env vars:
 *   SUPABASE_ACCESS_TOKEN  – a personal access token from https://supabase.com/dashboard/account/tokens
 *   SUPABASE_PROJECT_REF   – the project ref (zttwsjehcgaicziqyxpq)
 */
import { readFileSync } from 'node:fs';

function getEnv(key) {
  try {
    const env = readFileSync('.env', 'utf8');
    const line = env.split('\n').find(l => l.startsWith(key + '='));
    if (line) return line.slice(key.length + 1).trim().replace(/\r$/, '');
  } catch {}
  return process.env[key] || '';
}

const TOKEN = getEnv('SUPABASE_ACCESS_TOKEN');
const PROJECT_REF = getEnv('SUPABASE_PROJECT_REF') || 'zttwsjehcgaicziqyxpq';

if (!TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN not set. Get one from https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

const REDIRECT_URLS = [
  // Production main domain
  'https://growlancer.vercel.app',
  'https://growlancer.vercel.app/auth/callback',
  'https://growlancer.vercel.app/auth/email-confirm',
  'https://growlancer.vercel.app/auth/callback*',
  'https://growlancer.vercel.app/auth/email-confirm*',
  // Preview deployment
  'https://growlancer-mrkhan154212s-projects.vercel.app',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/callback',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/email-confirm',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/callback*',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/email-confirm*',
  // Old custom domain (growlancer.com)
  'https://growlancer.com',
  'https://growlancer.com/auth/callback',
  'https://growlancer.com/auth/email-confirm',
  'https://growlancer.com/auth/callback*',
  'https://growlancer.com/auth/email-confirm*',
  'https://www.growlancer.com',
  'https://www.growlancer.com/auth/callback',
  'https://www.growlancer.com/auth/email-confirm',
  'https://www.growlancer.com/auth/callback*',
  'https://www.growlancer.com/auth/email-confirm*',
  // Local dev
  'http://localhost:5173',
  'http://localhost:5173/auth/callback',
  'http://localhost:5173/auth/email-confirm',
];

function resolveSiteUrl() {
  return 'https://growlancer.vercel.app';
}

const SITE_URL = resolveSiteUrl();
const UNIQUE_REDIRECT_URLS = [...new Set(REDIRECT_URLS)];

async function main() {
  console.log('🔧 Pushing Supabase Auth redirect URLs to production...');
  console.log(`   Project: ${PROJECT_REF}`);
  console.log(`   Site URL: ${SITE_URL}`);
  console.log(`   Redirect URLs: ${UNIQUE_REDIRECT_URLS.length} entries`);

  // 1. Get current config
  const getRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
  );
  if (!getRes.ok) {
    const err = await getRes.text();
    console.error(`❌ Failed to read current config: ${getRes.status} ${err}`);
    process.exit(1);
  }
  const current = await getRes.json();
  console.log('\n📋 Current site_url:', current.site_url);
  console.log('   Current redirect URLs:', (current.redirect_urls || []).length, 'entries');

  // 2. Update config
  const patchBody = {
    site_url: SITE_URL,
    redirect_urls: UNIQUE_REDIRECT_URLS,
  };

  const patchRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    }
  );
  if (!patchRes.ok) {
    const err = await patchRes.text();
    console.error(`❌ Failed to update config: ${patchRes.status} ${err}`);
    process.exit(1);
  }
  const updated = await patchRes.json();
  console.log('\n✅ Config updated!');
  console.log('   site_url:', updated.site_url);
  console.log('   redirect_urls:', (updated.redirect_urls || []).length, 'entries');

  // 3. Verify LinkedIn OIDC is reachable
  const ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY');
  if (ANON_KEY) {
    const provRes = await fetch(
      `https://${PROJECT_REF}.supabase.co/auth/v1/authorize?provider=linkedin_oidc&redirect_to=${encodeURIComponent(SITE_URL + '/auth/callback')}`,
      { headers: { apikey: ANON_KEY }, redirect: 'manual' }
    );
    const loc = provRes.headers.get('location') || '';
    if (provRes.status === 302 && loc.includes('linkedin.com')) {
      console.log('\n✅ LinkedIn OIDC: ENABLED (302 → linkedin.com)');
    } else {
      console.log(`\n⚠️  LinkedIn OIDC: HTTP ${provRes.status} — may not be configured in Supabase Dashboard`);
    }

    const ghRes = await fetch(
      `https://${PROJECT_REF}.supabase.co/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(SITE_URL + '/auth/callback')}`,
      { headers: { apikey: ANON_KEY }, redirect: 'manual' }
    );
    const ghLoc = ghRes.headers.get('location') || '';
    if (ghRes.status === 302 && ghLoc.includes('github.com')) {
      console.log('✅ GitHub: ENABLED (302 → github.com)');
    } else {
      console.log(`⚠️  GitHub: HTTP ${ghRes.status} — may not be configured in Supabase Dashboard`);
    }
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
