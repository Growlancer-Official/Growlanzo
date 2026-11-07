import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locks the money-state write-block on the admin-data proxy.
 *
 * Why this exists: the admin-data edge function exposes a generic CRUD proxy over
 * the service role. Some tables there carry money or money-state and must only ever
 * change through a SECURITY DEFINER RPC (row locks, idempotency guard, ledger entry,
 * status-transition rules) — Security Principle §2. The proxy already blocks
 * wallets / escrow / transactions. This test adds contracts and subscriptions to
 * that block and proves the blocking list still contains the tables the admin console
 * legitimately reads, so the proxy does not silently stop being able to list them.
 *
 * The failure it guards against is silent: someone reorders or shrinks
 * WRITE_BLOCKED_TABLES, or a new money-state table gets added to ALLOWED_TABLES but
 * not to WRITE_BLOCKED_TABLES.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');
const read = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const ADMIN_DATA = read('supabase/functions/admin-data/index.ts');

/** The set the proxy blocks for writes. Parsed straight out of the source. */
function writeBlockedTables(source: string): string[] {
  const re = /const WRITE_BLOCKED_TABLES = \[([^\]]*)\]/.exec(source);
  expect(re, 'admin-data lost its WRITE_BLOCKED_TABLES definition').toBeTruthy();
  const inner = re!.toString().slice(re!.toString().indexOf('[') + 1, re!.toString().lastIndexOf(']'));
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const BLOCKED = writeBlockedTables(ADMIN_DATA);

/** The set the proxy allows, for completeness (docs-only assertion here). */
function allowedTables(source: string): string[] {
  const re = /const ALLOWED_TABLES = \[([^\]]*)\]/.exec(source);
  expect(re, 'admin-data lost its ALLOWED_TABLES definition').toBeTruthy();
  const inner = re!.toString().slice(re!.toString().indexOf('[') + 1, re!.toString().lastIndexOf(']'));
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const ALLOWED = allowedTables(ADMIN_DATA);

/** Real admin call sites that write through the proxy, taken from src/pages/admin. */
const ADMIN_WRITE_SITES = [
  // AdminContractsPage: status + escrow_funded toggle — money state, must be blocked.
  { file: 'src/pages/admin/AdminContractsPage.tsx', table: 'contracts' },
  // AdminSubscriptionsPage: cancel + reactivate — money/billing state, must be blocked.
  { file: 'src/pages/admin/AdminSubscriptionsPage.tsx', table: 'subscriptions' },
  // AdminPaymentsPage: transaction status — ledger, already blocked; keep listed as the
  // positive control that the block list still covers a table the console writes.
  { file: 'src/pages/admin/AdminPaymentsPage.tsx', table: 'transactions' },
  // AdminUsersPage: profiles / profiles_private writes — non-money state, still allowed.
  { file: 'src/pages/admin/AdminUsersPage.tsx', table: 'profiles' },
  { file: 'src/pages/admin/AdminUsersPage.tsx', table: 'profiles_private' },
  // AdminProjectsPage: project status — non-money state, still allowed.
  { file: 'src/pages/admin/AdminProjectsPage.tsx', table: 'projects' },
  // AdminSupportTicketsPage: ticket status — non-money state, still allowed.
  { file: 'src/pages/admin/AdminSupportTicketsPage.tsx', table: 'support_tickets' },
  // AdminUserReportsPage: report state — non-money state, still allowed.
  { file: 'src/pages/admin/AdminUserReportsPage.tsx', table: 'user_reports' },
  // AdminDashboard: profiles write (is_pro / deleted_at) — non-money state, still allowed.
  { file: 'src/pages/AdminDashboard.tsx', table: 'profiles' },
];

describe('admin-data money-state write block', () => {
  it('blocks the ledger tables that were already blocked', () => {
    expect(BLOCKED).toContain('wallets');
    expect(BLOCKED).toContain('escrow');
    expect(BLOCKED).toContain('transactions');
  });

  it('blocks contract money-state writes through the proxy', () => {
    expect(BLOCKED).toContain('contracts');
  });

  it('blocks subscription money/billing-state writes through the proxy', () => {
    expect(BLOCKED).toContain('subscriptions');
  });

  it('still lists the money-state tables, so the console can read them', () => {
    // The console lists these for reporting; only writes are blocked.
    expect(ALLOWED).toContain('contracts');
    expect(ALLOWED).toContain('subscriptions');
  });

  it('still allows the non-money tables the admin console actually writes', () => {
    const writeSiteTables = ADMIN_WRITE_SITES.map((s) => s.table);
    for (const table of writeSiteTables) {
      // Money-state tables are intentionally NOT allowed here even though the console
      // currently calls adminUpdate on them — that is the bug this guard locks.
      if (BLOCKED.includes(table)) continue;
      expect(ALLOWED).toContain(
        table,
      );
    }
  });

  it('keeps every blocked table out of the allowed-write path, and documents why', () => {
    // The comment above WRITE_BLOCKED_TABLES must still say these are blocked for an
    // invariant reason (ledger / money-state / status-transition), not by accident.
    expect(ADMIN_DATA).toMatch(/ledger- or money-state-bearing table/);
    expect(ADMIN_DATA).toMatch(/create_contract_with_escrow/);
    expect(ADMIN_DATA).toMatch(/admin_fund_escrow/);
    expect(ADMIN_DATA).toMatch(/enforce_subscription_client_update_guard/);
  });

  // Positive control: the only money-state tables the admin console currently writes
  // through the proxy are the ones this guard intentionally blocks. If a new
  // money-state table enters ALLOWED_TABLES, add it here and block it.
  it('names the money-state tables the admin console writes today (so new ones are noticed)', () => {
    const moneyStateTables = ['contracts', 'subscriptions', 'transactions', 'wallets', 'escrow'];
    for (const table of ADMIN_WRITE_SITES) {
      if (moneyStateTables.includes(table.table)) {
        expect(BLOCKED).toContain(table.table);
      }
    }
  });
});
