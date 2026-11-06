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
  // Production
  'https://growlanzo.com',
  'https://growlanzo.com/auth/callback',
  'https://growlanzo.com/auth/email-confirm',
  'https://growlanzo.com/auth/callback*',
  'https://growlanzo.com/auth/email-confirm*',
  'https://www.growlanzo.com',
  'https://www.growlanzo.com/auth/callback',
  'https://www.growlanzo.com/auth/email-confirm',
  'https://www.growlanzo.com/auth/callback*',
  'https://www.growlanzo.com/auth/email-confirm*',
  // Preview deployments
  'https://growlancer-mrkhan154212s-projects.vercel.app',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/callback',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/email-confirm',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/callback*',
  'https://growlancer-mrkhan154212s-projects.vercel.app/auth/email-confirm*',
  // Local dev
  'http://localhost:5173',
  'http://localhost:5173/auth/callback',
  'http://localhost:5173/auth/email-confirm',
];

/**
 * Canonical origin for Supabase Auth. Drives `site_url` (where verification and
 * password-reset emails send the user back to) and the OAuth probe target.
 * Reads APP_URL so the custom-domain switch stays a single variable, matching
 * supabase/functions/_shared/site.ts.
 *
 * NEVER guesses: a malformed value would be written straight to the live
 * `site_url` and would break every auth email link, so this fails closed.
 */
function resolveSiteUrl() {
  const raw = (getEnv('APP_URL') || '').trim();
  // Fail closed: guessing a fallback here would write a domain the founder never
  // asked for straight into the live `site_url` and break every auth email link.
  if (!raw) {
    console.error('❌ APP_URL is not set in .env — refusing to guess the site_url.');
    console.error('   Set APP_URL=https://<your-domain> and run this again.');
    process.exit(1);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    console.error(`❌ APP_URL is not an absolute URL: ${JSON.stringify(raw)}`);
    console.error('   Use a full origin, e.g. https://growlanzo.com');
    process.exit(1);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    console.error(`❌ APP_URL must be http(s), got "${parsed.protocol}"`);
    process.exit(1);
  }
  return parsed.origin;
}

const SITE_URL = resolveSiteUrl();

// Custom-domain entries are DERIVED from APP_URL instead of being a hard-coded
// `growlanzo.com` list. The old literal list silently missed any other domain
// (the switch to growlancing.com would have pushed redirects without it), so a
// domain switch must never require editing this file — it is one variable.
const AUTH_PATHS = ['', '/auth/callback', '/auth/email-confirm', '/auth/callback*', '/auth/email-confirm*'];
{
  const host = new URL(SITE_URL).host;
  const altHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  for (const h of [host, altHost]) {
    for (const p of AUTH_PATHS) REDIRECT_URLS.push(`https://${h}${p}`);
  }
}
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
