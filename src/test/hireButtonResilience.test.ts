import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * "Accept & Hire" sat on "Hiring…" even though the contract had been created.
 *
 * Two causes, both locked here:
 *  1. the fire-and-forget `proposal-notifications` invoke was awaited with no
 *     timeout, so a hung edge-function call meant the promise never resolved;
 *  2. the page awaited a proposals refresh BEFORE navigating and had no
 *     try/finally, so any throw left the button disabled forever.
 *
 * These are source-text guards on purpose: the behaviour itself is covered by
 * the live hire → escrow → release UI E2E, which cannot run in this sandbox.
 */
describe('Accept & Hire cannot hang the button', () => {
  it('bounds every notification call it awaits', () => {
    const service = read('src/lib/workflowService.ts');
    expect(service).toContain('NOTIFICATION_TIMEOUT_MS');
    expect(service).toContain('withinTimeout(');
    // Both notification helpers must go through the bounded wrapper.
    const awaited = service.match(/await supabase\.functions\.invoke\(/g) ?? [];
    expect(awaited.length).toBe(0);
    expect(service).toMatch(/withinTimeout\(\s*\n?\s*supabase\.functions\.invoke\('proposal-notifications'/);
    expect(service).toMatch(/withinTimeout\(\s*\n?\s*supabase\.functions\.invoke\('project-notifications'/);
  });

  it('always resets the hiring state, and navigates before refreshing', () => {
    const page = read('src/pages/ClientProposalsPage.tsx');
    const accept = page.slice(page.indexOf('const handleAccept'), page.indexOf('const handleReject'));

    // try/catch/finally around the whole hire call
    expect(accept).toContain('try {');
    expect(accept).toContain('} catch (err) {');
    expect(accept).toContain('} finally {');
    expect(accept).toMatch(/finally \{\s*setActionId\(null\);/);

    // navigation must not wait on the refresh (`void` = not awaited, and it
    // must appear after the navigate call, not before it)
    const navigateAt = accept.indexOf('navigate(`/client/workspace?contract=');
    const refreshAt = accept.indexOf('void fetchProposals()');
    expect(navigateAt).toBeGreaterThan(-1);
    expect(refreshAt).toBeGreaterThan(navigateAt);

    // double-click guard: a second click while hiring must be ignored
    expect(accept).toMatch(/if \(!user \|\| actionId\) return;/);
  });
});

describe('the proposal card cannot print a stray review count', () => {
  it('uses the shared RatingSummary instead of its own rating JSX', () => {
    const page = read('src/pages/dashboard/ProposalsPage.tsx');
    expect(page).toContain("import { RatingSummary } from '../../components/RatingSummary'");
    expect(page).toContain('<RatingSummary');
    // The old inline block printed `({total_reviews || 0})` next to the name.
    expect(page).not.toMatch(/total_reviews \|\| 0/);
  });

  it('renders nothing at all when there are no reviews', () => {
    const component = read('src/components/RatingSummary.tsx');
    expect(component).toContain('if (!summary) return null;');
  });
});
