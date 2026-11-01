import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * AI quota tracking — three real defects, all found live ("rate limit kaam
 * nahi kar raha" + "title aata hai, proper description nahi aata"):
 *
 * 1. `ai-assistant` logged freelancer usage as feature_type='ai_message', but
 *    usage_logs has CHECK (feature_type IN ai_chat/ai_matching/ai_assistant/
 *    profile_view). Every insert failed 23514 — SILENTLY (error unchecked) —
 *    so usage never accumulated and the 10/month free cap could never fire,
 *    and the dashboard meter was stuck at 0/10 forever.
 *
 * 2. `ai-writer` upserted `{ count: 1 }` with onConflict on the UNIQUE
 *    (identifier, route, window_start) key — every generation RESET the
 *    counter instead of accumulating, and it gated on the ROW count (always
 *    ≤ 1). The Free 5/day and Pro 100/day caps were decorative.
 *
 * 3. `AIGenerateModal` read the error payload from `data`, but functions.invoke
 *    returns data=null for every non-2xx in this supabase-js version (the body
 *    lives on error.context). All quota/config errors surfaced as the generic
 *    "AI generation failed" — the user could not tell a spent quota from a
 *    broken generator.
 *
 * Source-level guard (same pattern as aiMatchingOwnership.test.ts): the live
 * runtime is probed by scripts/e2e; this file locks the invariants so a
 * refactor can't silently regress them between deploys.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const aiAssistant = read('supabase/functions/ai-assistant/index.ts');
const aiWriter = read('supabase/functions/ai-writer/index.ts');
const aiChatSupport = read('src/components/AIChatSupport.tsx');
const subscriptionHelpers = read('src/lib/subscriptionHelpers.ts');
const aiGenerateModal = read('src/components/AIGenerateModal.tsx');

describe('ai-assistant monthly quota (usage_logs feature_type)', () => {
  it('uses the CHECK-allowed feature_type (ai_assistant), never ai_message', () => {
    expect(aiAssistant).toContain("AI_USAGE_FEATURE = 'ai_assistant'");
    expect(aiAssistant).not.toContain("'ai_message'");
  });

  it('delegates the quota to the atomic DB RPC instead of a second client-side insert', () => {
    // 20270304: consume_ai_message() checks AND records in one transaction
    // under a per-user advisory lock, so the free limit fires on the exact
    // message that crosses it. A second insert here would double-count.
    expect(aiAssistant).toContain("rpc('consume_ai_message'");
    expect(aiAssistant).not.toMatch(/\.from\('usage_logs'\)\s*\.insert/);
    expect(aiAssistant).toMatch(/quota RPC unavailable/);

    const migration = read(
      'supabase/migrations/20270304000000_realtime_ai_quota_priority_support.sql'
    );
    expect(migration).toContain("feature_type = 'ai_assistant'");
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.consume_ai_message\(uuid\) FROM PUBLIC, anon, authenticated/i
    );
  });

  it('reads usage by SUMMING rows (no maybeSingle on the usage read)', () => {
    const readBlock = aiAssistant.slice(aiAssistant.indexOf('.from(\'usage_logs\')'));
    expect(readBlock).not.toContain('.maybeSingle()');
    expect(readBlock).toMatch(/\.reduce\(/);
  });

  it('frontend readers use the same authoritative quota source', () => {
    // The meter reads ai_support_entitlement() — the same function family the
    // edge function's consume_ai_message() writes through, so the bar can never
    // disagree with what the server will allow.
    expect(aiChatSupport).toContain("rpc('ai_support_entitlement'");
    expect(subscriptionHelpers).toContain(".eq('feature_type', 'ai_assistant')");
    expect(subscriptionHelpers).toContain(".eq('feature_type', 'ai_assistant')");
    expect(aiChatSupport).not.toContain("'ai_message'");
    expect(subscriptionHelpers).not.toContain("'ai_message'");
  });

  it('refreshes the meter after each message (real-time, not mount-only)', () => {
    expect(aiChatSupport).toMatch(/void refreshAiUsage\(\);/g);
  });

  it('hides the usage meter for Pro users (0/10 would be a lie)', () => {
    expect(aiChatSupport).toMatch(/aiUsage && !userIsPro/);
  });
});

describe('ai-writer daily quota (atomic increment)', () => {
  it('increments via the server-only RPC instead of the count-resetting upsert', () => {
    expect(aiWriter).toContain(".rpc('increment_rate_limit'");
    expect(aiWriter).not.toMatch(/onConflict: 'identifier,route,window_start'/);
  });

  it('gates on the accumulated count column, not the row count', () => {
    const gate = aiWriter.slice(aiWriter.indexOf('.from(\'rate_limits\')'));
    expect(gate).toContain(".select('count')");
    expect(gate).not.toContain("{ count: 'exact', head: true }");
  });

  it('logs a failed increment loudly', () => {
    expect(aiWriter).toMatch(/console\.error\('\[ai-writer\] usage increment failed/);
  });

  it('the RPC migration exists, is server-only, and asserts its own grants', () => {
    const migrationPath = 'supabase/migrations/20270119000022_increment_rate_limit_rpc.sql';
    expect(existsSync(path.join(root, migrationPath))).toBe(true);
    const migration = read(migrationPath);
    expect(migration).toContain('security definer');
    expect(migration).toContain("do update set count = public.rate_limits.count + 1");
    expect(migration).toMatch(/revoke execute .* from anon/);
    expect(migration).toMatch(/revoke execute .* from authenticated/);
    expect(migration).toMatch(/grant execute .* to service_role/);
    expect(migration).toContain('raise exception');
    // The signature assertion must resolve the function by OID. String-matching
    // pg_get_function_identity_arguments is wrong for `timestamptz` (Postgres
    // prints "timestamp with time zone"), which aborted the deploy at `db push`.
    expect(migration).toContain("to_regprocedure('public.increment_rate_limit(text,text,timestamptz)')");
  });
});

describe('AIGenerateModal error surfacing', () => {
  it('reads the real error payload from error.context (invoke data is null on 4xx/5xx)', () => {
    expect(aiGenerateModal).toMatch(/invokeError[^)]*context/);
    expect(aiGenerateModal).not.toMatch(/\(data as any\)\?\.error/);
  });
});

describe('services active/status split-brain', () => {
  // Public surfaces must filter on `status` (the source of truth the dashboard
  // toggle writes). Filtering the legacy boolean `active` instead listed
  // DEACTIVATED services publicly.
  const statusFiltered: Array<[string, string]> = [
    ['src/pages/ServicesCatalogPage.tsx', ".eq('status', 'active')"],
    ['src/pages/PublicFreelancerProfilePage.tsx', ".eq('status', 'active')"],
    ['src/pages/HomePage.tsx', ".eq('status', 'active')"],
    ['src/lib/aiMatching.ts', ".eq('status', 'active')"],
  ];

  it.each(statusFiltered)('%s filters services by status', (file, expected) => {
    expect(read(file)).toContain(expected);
  });

  it('the dashboard toggle keeps both columns in sync', () => {
    const servicesPage = read('src/pages/dashboard/ServicesPage.tsx');
    expect(servicesPage).toMatch(/status: newStatus, active: newStatus === 'active'/);
  });

  it('the homepage realtime channel reacts to deactivations (UPDATE)', () => {
    const home = read('src/pages/HomePage.tsx');
    expect(home).toContain("'status=eq.active'");
    expect(home).toMatch(/event: 'UPDATE', schema: 'public', table: 'services'/);
  });
});

describe('record_profile_view repo drift', () => {
  it('the aligning migration exists (repo body must not reference the non-existent count column)', () => {
    const migrationPath = 'supabase/migrations/20270119000023_record_profile_view_align_usage_logs.sql';
    expect(existsSync(path.join(root, migrationPath))).toBe(true);
    const migration = read(migrationPath);
    expect(migration).toContain('usage_count');
    expect(migration).toContain("'profile_view', 'profile_view'");
    expect(migration).toMatch(/grant execute .* to anon, authenticated/);
  });
});
