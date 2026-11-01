import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Real-time behaviour + AI quota + Pro priority support (2026-11-01).
 *
 * Every item below was reported from the live site as "real time me kaam nahi
 * kar raha". The root cause for all the realtime complaints was the same: the
 * tables were never added to the `supabase_realtime` publication, so
 * `postgres_changes` was a silent no-op no matter what the client subscribed to.
 *
 * This file locks the invariants so a future migration/refactor cannot quietly
 * unplug them again:
 *   • support tickets, ticket messages, referral stats/history, usage logs and
 *     the coin ledger are all published for realtime;
 *   • the free AI allowance is enforced in ONE atomic database transaction
 *     (consume_ai_message) and is service-role only;
 *   • Pro entitlement is centralised and expires correctly (a stale trial row
 *     that the cron has not flipped yet must not grant Pro);
 *   • Pro tickets are escalated server-side and Pro AI traffic takes the fast
 *     lane, while the UI shows the same truth.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read(
  'supabase/migrations/20270304000000_realtime_ai_quota_priority_support.sql'
);
const AI_ASSISTANT = read('supabase/functions/ai-assistant/index.ts');
const AI_SHARED = read('supabase/functions/_shared/ai.ts');
const TICKET_RESPONDER = read('supabase/functions/ai-ticket-responder/index.ts');
const CHAT = read('src/components/AIChatSupport.tsx');
const TICKETS_PAGE = read('src/pages/dashboard/SupportTicketsPage.tsx');
const REFERRALS_HOOK = read('src/hooks/useReferralsData.ts');
const MATCHES_PAGE = read('src/pages/ClientMatchesPage.tsx');
const TEAM_PAGE = read('src/pages/ClientTeamProjectsPage.tsx');
const HOW_IT_WORKS = read('src/pages/HowItWorksPage.tsx');

describe('realtime publication covers the live UI', () => {
  const required = [
    'support_tickets',
    'ticket_messages',
    'referral_stats',
    'referrals',
    'usage_logs',
    'grow_coin_ledger',
  ];

  it.each(required)('%s is added to supabase_realtime', (table) => {
    expect(MIGRATION).toContain(`'${table}'`);
    expect(MIGRATION).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE');
    // Guarded so re-running the migration never errors on an existing member.
    expect(MIGRATION).toContain('pg_publication_tables');
  });

  it('fails loudly if the publication is incomplete after the migration', () => {
    expect(MIGRATION).toMatch(/RAISE EXCEPTION 'Realtime publication incomplete/);
  });
});

describe('free AI allowance is enforced atomically in the database', () => {
  it('consume_ai_message checks AND records under one lock', () => {
    expect(MIGRATION).toContain('FUNCTION public.consume_ai_message');
    expect(MIGRATION).toContain('SECURITY DEFINER');
    expect(MIGRATION).toMatch(/pg_advisory_xact_lock/);
    expect(MIGRATION).toContain('INSERT INTO public.usage_logs');
    expect(MIGRATION).toContain("feature_type = 'ai_assistant'");
    expect(MIGRATION).toMatch(/v_limit\s+constant integer := 10/);
  });

  it('is not callable from the browser', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.consume_ai_message\(uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consume_ai_message\(uuid\) TO service_role/
    );
  });

  it('the edge function consumes quota exactly once and reports it live', () => {
    expect(AI_ASSISTANT).toContain("rpc('consume_ai_message'");
    expect(AI_ASSISTANT).not.toMatch(/\.from\('usage_logs'\)\s*\.insert/);
    // First SSE frame carries used/limit so the meter moves with the reply.
    expect(AI_ASSISTANT).toMatch(/usage:\s*\{[\s\S]*used: entitlement\.used/);
  });

  it('the read-only meter RPC is available to signed-in users', () => {
    expect(MIGRATION).toContain('FUNCTION public.ai_support_entitlement()');
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ai_support_entitlement\(\) TO authenticated, service_role/
    );
  });
});

describe('Pro entitlement drives real-time priority support', () => {
  it('an expired trial row never counts as Pro', () => {
    expect(MIGRATION).toMatch(
      /s\.status = 'trial' AND s\.trial_end_date IS NOT NULL AND s\.trial_end_date > now\(\)/
    );
  });

  it('Pro tickets are escalated on insert without downgrading the user', () => {
    expect(MIGRATION).toContain('FUNCTION public.escalate_pro_support_ticket');
    expect(MIGRATION).toMatch(/BEFORE INSERT ON public\.support_tickets/);
    expect(MIGRATION).toMatch(/NEW\.priority IN \('low', 'normal'\)/);
    expect(MIGRATION).not.toMatch(/NEW\.priority := 'urgent'/);
  });

  it('the AI has a priority lane with a tighter budget and timeout', () => {
    expect(AI_SHARED).toContain("sort: 'latency'");
    expect(AI_SHARED).toMatch(/priority \? 800 : 1200/);
    expect(AI_ASSISTANT).toMatch(/priority: isPriority/);
    expect(AI_ASSISTANT).toMatch(/RATE_LIMIT_PRIORITY = 120/);
  });

  it('ticket replies take the priority lane for Pro members', () => {
    expect(TICKET_RESPONDER).toContain("rpc('user_has_active_pro'");
    expect(TICKET_RESPONDER).toMatch(/priority: priorityLane/);
    expect(TICKET_RESPONDER).toContain('timeoutMs: 25000');
    // The old 1800-token non-streaming reply was the main source of the lag.
    expect(TICKET_RESPONDER).not.toContain('max_tokens: 1800');
  });

  it('the UI shows the same priority truth', () => {
    expect(CHAT).toContain('Priority support active');
    expect(TICKETS_PAGE).toContain('Priority support active');
    expect(TICKETS_PAGE).toMatch(/if \(isPro\) setPriority/);
  });
});

describe('quota + rewards update without a page refresh', () => {
  it('the chat meter subscribes to usage_logs and subscription changes', () => {
    expect(CHAT).toMatch(/table: 'usage_logs'/);
    expect(CHAT).toMatch(/table: 'subscriptions'/);
    expect(CHAT).toMatch(/aiUsage\.used >= aiUsage\.limit/);
  });

  it('referral counters follow the coin award tables', () => {
    expect(REFERRALS_HOOK).toMatch(/table: 'referral_project_reward_events'/);
    expect(REFERRALS_HOOK).toMatch(/table: 'grow_coin_ledger'/);
  });
});

describe('client mobile icons are consistent and never squashed', () => {
  it.each([['AI Matches', MATCHES_PAGE], ['Team Projects', TEAM_PAGE]])(
    '%s header uses the shared emerald tile with shrink-0',
    (_label, source) => {
      expect(source).toContain('from-emerald-500 to-emerald-700');
      expect(source).toContain('shrink-0');
      expect(source).not.toContain('from-orange-500 to-orange-600');
    }
  );
});

describe('marketing copy makes no unverifiable commitment', () => {
  it('no "guaranteed funding" / "instant release" claims', () => {
    expect(HOW_IT_WORKS).not.toContain('Guaranteed Funding Lock');
    expect(HOW_IT_WORKS).not.toContain('Instant Release');
    expect(HOW_IT_WORKS).not.toMatch(/guarantees a clear/);
  });
});
