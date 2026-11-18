import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Beta-launch invariants (2026-11-18).
 *
 * These are product promises made to users, so they are locked at the source
 * level rather than left to a future refactor:
 *
 *  1. Signed up once = signed in until the user presses Logout. No client-side
 *     inactivity timer may end a session; only server-side revocation can.
 *  2. The AI is presented as **Growlanzo AI**, never a vendor model slug, for
 *     both roles; AI Support speaks like a human support agent and never claims
 *     an action it did not perform.
 *  3. Analytics stays free-basic / Pro-advanced and updates in real time.
 *  4. The profile page must not fake a save (privacy controls are not live) and
 *     must surface a retry instead of silently rendering an empty profile.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const AUTH_CONTEXT = read('src/context/AuthContext.tsx');
const SUPABASE_CLIENT = read('src/lib/supabase.ts');
const AI_ASSISTANT = read('supabase/functions/ai-assistant/index.ts');
const AI_TICKET = read('supabase/functions/ai-ticket-responder/index.ts');
const CHAT = read('src/components/AIChatSupport.tsx');
const ANALYTICS_PAGE = read('src/pages/dashboard/AnalyticsPage.tsx');
const ANALYTICS_SERVICE = read('src/lib/analyticsService.ts');
const PROFILE_PAGE = read('src/pages/dashboard/ProfessionalProfilePage.tsx');

describe('a session lasts until the user logs out', () => {
  it('has no client-side inactivity sign-out', () => {
    expect(AUTH_CONTEXT).not.toContain('SESSION_TIMEOUT_MS');
    expect(AUTH_CONTEXT).not.toContain('LAST_ACTIVITY_KEY');
    expect(AUTH_CONTEXT).not.toMatch(/idle_timeout/);
  });

  it('keeps the session persisted and token-refreshed', () => {
    expect(SUPABASE_CLIENT).toContain('persistSession: true');
    expect(SUPABASE_CLIENT).toContain('autoRefreshToken: true');
  });

  it('never destroys a session because a profile read failed', () => {
    expect(AUTH_CONTEXT).toContain('keeping the session (profile will re-sync)');
    // The only sign-outs left are explicit logout() and server-confirmed
    // account deletion (which explains itself on the login screen).
    expect(AUTH_CONTEXT).toMatch(/noteLogoutReason\('session_expired'\)/);
  });
});

describe('Growlanzo AI naming and support persona', () => {
  it('relays the product name, not the vendor model slug', () => {
    expect(AI_ASSISTANT).toContain("'Growlanzo AI · Priority'");
    expect(AI_ASSISTANT).not.toContain('model: parsed.model');
    expect(CHAT).toContain("useState('Growlanzo AI')");
    expect(CHAT).toContain("parsed.model.startsWith('Growlanzo AI')");
    expect(CHAT).not.toContain('import.meta.env.VITE_AI_MODEL');
  });

  it('has a dedicated human-quality support mode for both roles', () => {
    expect(AI_ASSISTANT).toContain('SUPPORT MODE');
    expect(AI_ASSISTANT).toContain('Growlanzo AI Support');
    expect(AI_ASSISTANT).toMatch(/mode\?: 'assistant' \| 'support'/);
    expect(AI_TICKET).toContain('Growlanzo AI Support');
    // The support persona is bound to honesty about actions it cannot take.
    expect(AI_ASSISTANT).toMatch(/Never claim an action you did not take/);
    expect(AI_TICKET).toMatch(/never claim an action was performed/);
  });

  it('keeps Pro on the fast lane and free on the standard lane', () => {
    expect(AI_ASSISTANT).toContain('priority: isPriority');
    expect(AI_TICKET).toMatch(/priority: priorityLane/);
    expect(AI_TICKET).toContain("rpc('user_has_active_pro'");
  });
});

describe('analytics: free basic, Pro advanced, real time', () => {
  it('gates the advanced block on the live Pro subscription', () => {
    expect(ANALYTICS_PAGE).toContain('isPremiumSubscription(subscription)');
    expect(ANALYTICS_PAGE).toMatch(/isPremium\s*\n?\s*\?\s*analyticsService\.getAdvancedAnalytics/);
    expect(ANALYTICS_PAGE).toContain("table: 'contracts'");
    expect(ANALYTICS_PAGE).toContain("table: 'transactions'");
  });

  it('measures the previous period instead of hardcoding the trend', () => {
    expect(ANALYTICS_SERVICE).toContain('profileViewsPrevious');
    // A real calculation, not just the zeroed default shape.
    expect(ANALYTICS_SERVICE).toMatch(/const profileViewsChange =/);
    expect(ANALYTICS_SERVICE).toMatch(/\n\s+profileViewsChange,\n/);
  });
});

describe('profile page tells the truth', () => {
  it('has no fake privacy save', () => {
    expect(PROFILE_PAGE).not.toContain('Privacy settings saved!');
    expect(PROFILE_PAGE).toContain('These privacy controls are not live yet');
  });

  it('reads explicit profile columns and offers a retry on failure', () => {
    expect(PROFILE_PAGE).toContain('PROFILE_SELECT');
    expect(PROFILE_PAGE).toContain('profileLoadError');
    expect(PROFILE_PAGE).toMatch(/could not load your profile/i);
  });
});
