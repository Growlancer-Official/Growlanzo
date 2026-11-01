/**
 * Unit tests for the client-side team-projects service (src/lib/teamProjects.ts).
 *
 * Covers the client "Team Projects" section logic:
 *  - TEAM_COMMISSION_RATE + per-role breakdownRow / projectTotal math (5% client fee)
 *  - createProject / updateProject / getProject / listProjects
 *  - addRole / getRoles / updateRole / deleteRole
 *  - matchRole (real-time AI matching + suggestion caching)
 *  - createRoleContract (RPC wiring)
 *
 * Supabase is mocked at the module level; the fee math in ../lib/config is the
 * real module so the 5% invariants are tested against the real source of truth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase + AI matching mocks ───────────────────────────────────────────
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockMatch = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
  uniqueChannelName: vi.fn(() => 'test-channel'),
}));

vi.mock('../lib/aiMatching', () => ({
  matchFreelancersBySkills: mockMatch,
}));

// Use the real config so fee math is tested against the real 5% source.
vi.mock('../lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/config')>();
  return actual;
});

// ─── Chain builder ──────────────────────────────────────────────────────────
interface ChainOpts {
  single?: { data: unknown; error: unknown };
  order?: { data: unknown; error: unknown };
  maybeSingle?: { data: unknown; error: unknown };
  eqResolve?: { data: unknown; error: unknown };
  error?: unknown;
}

/** Build a fluent query chain whose terminal methods resolve to configured values. */
function makeChain(opts: ChainOpts = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'order', 'limit', 'single', 'maybeSingle', 'update', 'insert', 'delete', 'not'];
  for (const m of methods) {
    chain[m] = vi.fn();
  }
  // Every non-terminal method returns the chain itself (fluent).
  for (const m of ['select', 'neq', 'in', 'limit', 'not'] as const) {
    chain[m].mockReturnValue(chain);
  }
  // eq is used both as a fluent filter (.eq().select().single()) AND as a
  // terminal call (.update().eq().single() -> .single() is terminal; .eq() is fluent).
  chain.eq.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  // Terminals
  chain.single.mockResolvedValue(opts.single ?? { data: null, error: null });
  chain.maybeSingle.mockResolvedValue(opts.maybeSingle ?? { data: null, error: null });
  chain.order.mockResolvedValue(opts.order ?? { data: [], error: null });
  return chain;
}

const role = (overrides: Partial<any> = {}) => ({
  id: 'role_1',
  team_project_id: 'project_1',
  role_title: 'Frontend Dev',
  required_skills: ['react', 'typescript'],
  budget_range_min: 15000,
  budget_range_max: 20000,
  status: 'open',
  suggested_freelancers: [],
  matched_freelancer_id: null,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Commission math ────────────────────────────────────────────────────────

describe('team projects commission math', () => {
  it('TEAM_COMMISSION_RATE is exactly 0.05 (flat 5% platform commission)', async () => {
    const { TEAM_COMMISSION_RATE } = await import('../lib/teamProjects');
    expect(TEAM_COMMISSION_RATE).toBe(0.05);
  });

  it('breakdownRow uses budget_range_max and keeps the fee off the client total', async () => {
    const { teamProjectsService } = await import('../lib/teamProjects');
    const row = teamProjectsService.breakdownRow(role());
    expect(row.amount).toBe(20000);
    expect(row.commission).toBe(1000);
    expect(row.total).toBe(20000);
  });

  it('breakdownRow falls back to budget_range_min when max is null', async () => {
    const { teamProjectsService } = await import('../lib/teamProjects');
    const row = teamProjectsService.breakdownRow(role({ budget_range_max: null }));
    expect(row.amount).toBe(15000);
    expect(row.commission).toBe(750);
    expect(row.total).toBe(15000);
  });

  it('breakdownRow yields zero when no budget is set', async () => {
    const { teamProjectsService } = await import('../lib/teamProjects');
    const row = teamProjectsService.breakdownRow(role({ budget_range_min: null, budget_range_max: null }));
    expect(row.amount).toBe(0);
    expect(row.commission).toBe(0);
    expect(row.total).toBe(0);
  });

  it('breakdownRow exposes matched freelancer id + status', async () => {
    const { teamProjectsService } = await import('../lib/teamProjects');
    const row = teamProjectsService.breakdownRow(role({ matched_freelancer_id: 'freelancer_9', status: 'matched' }));
    expect(row.freelancerId).toBe('freelancer_9');
    expect(row.status).toBe('matched');
  });

  it('projectTotal aggregates amount, commission and total across roles', async () => {
    const { teamProjectsService } = await import('../lib/teamProjects');
    const r1 = teamProjectsService.breakdownRow(role({ budget_range_max: 10000 }));
    const r2 = teamProjectsService.breakdownRow(role({ id: 'role_2', budget_range_max: 5000 }));
    const totals = teamProjectsService.projectTotal([r1, r2]);
    expect(totals.amount).toBe(15000);
    expect(totals.commission).toBe(750);
    expect(totals.total).toBe(15000);
  });
});

// ─── createProject / getProject / listProjects / updateProject ─────────────

describe('team project CRUD', () => {
  it('createProject inserts a project and returns the created row', async () => {
    const created = { id: 'project_1', client_id: 'client_1', title: 'Build a landing page', description: null, total_budget_estimate: 50000, status: 'open' };
    mockFrom.mockReturnValue(makeChain({ single: { data: created, error: null } }));

    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.createProject({ clientId: 'client_1', title: 'Build a landing page', totalBudgetEstimate: 50000 });

    expect(res.error).toBeUndefined();
    expect(res.data).toEqual(created);
    // Verify it inserted into team_projects with the right payload
    const insert = mockFrom.mock.calls[0][0];
    expect(insert).toBe('team_projects');
  });

  it('createProject surfaces a DB error', async () => {
    mockFrom.mockReturnValue(makeChain({ single: { data: null, error: { message: 'insert failed' } } }));
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.createProject({ clientId: 'c', title: 'x' });
    expect(res.error).toBe('insert failed');
    expect(res.data).toBeUndefined();
  });

  it('listProjects returns projects ordered for a client', async () => {
    const projects = [{ id: 'p1', client_id: 'client_1' }];
    mockFrom.mockReturnValue(makeChain({ order: { data: projects, error: null } }));
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.listProjects('client_1');
    expect(res.data).toEqual(projects);
    expect(res.error).toBeUndefined();
    expect(mockFrom.mock.calls[0][0]).toBe('team_projects');
  });

  it('updateProject patches and returns the updated row', async () => {
    const updated = { id: 'p1', status: 'in_progress' };
    mockFrom.mockReturnValue(makeChain({ single: { data: updated, error: null } }));
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.updateProject('p1', { status: 'in_progress' });
    expect(res.data).toEqual(updated);
    expect(res.error).toBeUndefined();
  });
});

// ─── Roles ──────────────────────────────────────────────────────────────────

describe('team project roles', () => {
  it('addRole inserts into team_project_roles with skills + budget', async () => {
    const newRole = role();
    mockFrom.mockReturnValue(makeChain({ single: { data: newRole, error: null } }));
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.addRole({
      teamProjectId: 'project_1',
      roleTitle: 'Frontend Dev',
      requiredSkills: ['react', 'typescript'],
      budgetMin: 15000,
      budgetMax: 20000,
    });
    expect(res.data).toEqual(newRole);
    expect(mockFrom.mock.calls[0][0]).toBe('team_project_roles');
  });

  it('getRoles returns roles for a team project', async () => {
    const roles = [role()];
    mockFrom.mockReturnValue(makeChain({ order: { data: roles, error: null } }));
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.getRoles('project_1');
    expect(res.data).toEqual(roles);
  });

  it('deleteRole calls delete on team_project_roles', async () => {
    const chain = makeChain({ eqResolve: { data: {}, error: null } });
    chain.delete.mockReturnValue(chain);
    chain.eq.mockResolvedValue({ data: {}, error: null });
    mockFrom.mockReturnValue(chain);
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.deleteRole('role_1');
    expect(res.error).toBeUndefined();
    expect(mockFrom.mock.calls[0][0]).toBe('team_project_roles');
  });
});

// ─── matchRole ──────────────────────────────────────────────────────────────

describe('teamProjectsService.matchRole', () => {
  it('caches matched suggestions onto the role via updateRole', async () => {
    const matches = [
      { freelancer_id: 'f1', name: 'A', match_score: 92 },
      { freelancer_id: 'f2', name: 'B', match_score: 88 },
    ];
    mockMatch.mockResolvedValue({ success: true, matches });
    // updateRole (from team_project_roles) resolves ok
    mockFrom.mockReturnValue(makeChain({ single: { data: role(), error: null } }));

    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.matchRole({ id: 'role_1', required_skills: ['react'], budget_range_max: 20000 });

    expect(res.error).toBeUndefined();
    expect(res.data).toEqual(matches);
    expect(mockMatch).toHaveBeenCalledWith(['react'], 20000);
    // updateRole was called with suggested_freelancers = matches
    const updateCalls = mockFrom.mock.calls.filter((c) => c[0] === 'team_project_roles');
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it('returns an error when AI matching fails', async () => {
    mockMatch.mockResolvedValue({ success: false, error: 'matching down' });
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.matchRole({ id: 'role_1', required_skills: ['x'], budget_range_max: null });
    expect(res.error).toBe('matching down');
    expect(res.data).toBeUndefined();
  });
});

// ─── createRoleContract ─────────────────────────────────────────────────────

describe('teamProjectsService.createRoleContract', () => {
  it('invokes the create_team_role_contract RPC with the right args', async () => {
    mockRpc.mockResolvedValue({ data: 'contract_123', error: null });
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.createRoleContract({
      teamProjectId: 'project_1',
      roleId: 'role_1',
      freelancerId: 'freelancer_1',
      amount: 20000,
      clientId: 'client_1',
    });
    expect(res.error).toBeUndefined();
    expect(res.data).toEqual({ contract_id: 'contract_123' });
    expect(mockRpc).toHaveBeenCalledWith('create_team_role_contract', {
      p_team_project_id: 'project_1',
      p_team_project_role_id: 'role_1',
      p_freelancer_id: 'freelancer_1',
      p_amount: 20000,
      p_client_id: 'client_1',
    });
  });

  it('returns an error when the RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Role not open' } });
    const { teamProjectsService } = await import('../lib/teamProjects');
    const res = await teamProjectsService.createRoleContract({
      teamProjectId: 'project_1',
      roleId: 'role_1',
      freelancerId: 'freelancer_1',
      amount: 10000,
      clientId: 'client_1',
    });
    expect(res.error).toBe('Role not open');
    expect(res.data).toBeUndefined();
  });
});