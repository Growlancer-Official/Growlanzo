// ────────────────────────────────────────────────────────────────────────────
// GROWLANZO — TEAM PROJECTS (multi-freelancer) service
// A team project = 1 client + N independent contracts (one per role). Each
// contract is a NORMAL contract (own escrow / milestones / dispute) linked via
// contracts.team_project_id + team_project_role_id. All existing flows are
// reused untouched — this file only orchestrates them.
// ────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase';
import { matchFreelancersBySkills } from './aiMatching';
import { PLATFORM_CONFIG } from './config';

export type TeamProjectStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type TeamRoleStatus = 'open' | 'matched' | 'filled' | 'cancelled';

export interface TeamProject {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  total_budget_estimate: number | null;
  status: TeamProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface TeamRole {
  id: string;
  team_project_id: string;
  role_title: string;
  required_skills: string[];
  budget_range_min: number | null;
  budget_range_max: number | null;
  status: TeamRoleStatus;
  suggested_freelancers: TeamRoleSuggestion[];
  matched_freelancer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRoleSuggestion {
  freelancer_id: string;
  name: string;
  avatar: string | null;
  verification_status: string | null;
  match_score: number;
  skill_score: number;
  experience_score: number;
  budget_score: number;
  availability_score: number;
  hourly_rate: number;
  location: string | null;
  bio: string | null;
  rating: number | null;
}

/** 5% flat platform commission — withheld from the freelancer's payout at release. */
export const TEAM_COMMISSION_RATE = PLATFORM_CONFIG.fees.platform_percentage / 100; // 0.05

export const teamProjectsService = {
  // ── Create / update project ─────────────────────────────────────────────
  async createProject(input: {
    clientId: string;
    title: string;
    description?: string;
    totalBudgetEstimate?: number;
  }): Promise<{ data?: TeamProject; error?: string }> {
    const { data, error } = await (supabase.from('team_projects' as any)
      .insert({
        client_id: input.clientId,
        title: input.title,
        description: input.description || null,
        total_budget_estimate: input.totalBudgetEstimate || null,
      })
      .select()
      .single() as any);
    if (error) return { error: error.message };
    return { data: data as unknown as TeamProject };
  },

  async updateProject(
    projectId: string,
    patch: Partial<Pick<TeamProject, 'title' | 'description' | 'total_budget_estimate' | 'status'>>
  ): Promise<{ data?: TeamProject; error?: string }> {
    const { data, error } = await (supabase.from('team_projects' as any)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .select()
      .single() as any);
    if (error) return { error: error.message };
    return { data: data as unknown as TeamProject };
  },

  async getProject(projectId: string): Promise<{ data?: TeamProject; error?: string }> {
    const { data, error } = await (supabase.from('team_projects' as any)
      .select('*')
      .eq('id', projectId)
      .single() as any);
    if (error) return { error: error.message };
    return { data: data as unknown as TeamProject };
  },

  async listProjects(clientId: string): Promise<{ data?: TeamProject[]; error?: string }> {
    const { data, error } = await (supabase.from('team_projects' as any)
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }) as any);
    if (error) return { error: error.message };
    return { data: (data || []) as unknown as TeamProject[] };
  },

  // ── Roles ───────────────────────────────────────────────────────────────
  async addRole(input: {
    teamProjectId: string;
    roleTitle: string;
    requiredSkills: string[];
    budgetMin?: number;
    budgetMax?: number;
  }): Promise<{ data?: TeamRole; error?: string }> {
    const { data, error } = await (supabase.from('team_project_roles' as any)
      .insert({
        team_project_id: input.teamProjectId,
        role_title: input.roleTitle,
        required_skills: input.requiredSkills,
        budget_range_min: input.budgetMin ?? null,
        budget_range_max: input.budgetMax ?? null,
      })
      .select()
      .single() as any);
    if (error) return { error: error.message };
    return { data: data as unknown as TeamRole };
  },

  async getRoles(teamProjectId: string): Promise<{ data?: TeamRole[]; error?: string }> {
    const { data, error } = await (supabase.from('team_project_roles' as any)
      .select('*')
      .eq('team_project_id', teamProjectId)
      .order('created_at', { ascending: true }) as any);
    if (error) return { error: error.message };
    return { data: (data || []) as unknown as TeamRole[] };
  },

  async updateRole(
    roleId: string,
    patch: Partial<Pick<TeamRole, 'status' | 'role_title' | 'required_skills' | 'budget_range_min' | 'budget_range_max' | 'matched_freelancer_id' | 'suggested_freelancers'>>
  ): Promise<{ data?: TeamRole; error?: string }> {
    const { data, error } = await (supabase.from('team_project_roles' as any)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', roleId)
      .select()
      .single() as any);
    if (error) return { error: error.message };
    return { data: data as unknown as TeamRole };
  },

  async deleteRole(roleId: string): Promise<{ error?: string }> {
    const { error } = await (supabase.from('team_project_roles' as any).delete().eq('id', roleId) as any);
    if (error) return { error: error.message };
    return {};
  },

  // ── Per-role REAL-TIME AI matching (reuses the existing engine) ─────────
  async matchRole(role: Pick<TeamRole, 'id' | 'required_skills' | 'budget_range_max'>): Promise<{ data?: TeamRoleSuggestion[]; error?: string }> {
    const result = await matchFreelancersBySkills(role.required_skills, role.budget_range_max);
    if (!result.success || !result.matches) {
      return { error: result.error || 'Matching failed' };
    }
    // Cache suggestions on the role (independent per role — no cross-role mixing)
    await this.updateRole(role.id, { suggested_freelancers: result.matches });
    return { data: result.matches };
  },

  // ── Per-role contract creation (reuses create_team_role_contract RPC) ──
  async createRoleContract(input: {
    teamProjectId: string;
    roleId: string;
    freelancerId: string;
    amount: number;
    clientId: string;
  }): Promise<{ data?: { contract_id: string }; error?: string }> {
    const { data, error } = await (supabase.rpc as any)('create_team_role_contract', {
      p_team_project_id: input.teamProjectId,
      p_team_project_role_id: input.roleId,
      p_freelancer_id: input.freelancerId,
      p_amount: input.amount,
      p_client_id: input.clientId,
    });
    if (error) return { error: error.message };
    return { data: { contract_id: data } };
  },

  // ── Transparency helpers ────────────────────────────────────────────────
  /**
   * Row for the transparency breakdown table:
   *   Role | Freelancer | Amount | Platform fee (5%) | Total | Status
   * `total` is what the CLIENT pays — the agreed amount. `commission` is the
   * freelancer-side 5% withheld at release, shown for transparency only.
   */
  breakdownRow(role: TeamRole) {
    const amount = role.budget_range_max ?? role.budget_range_min ?? 0;
    const commission = Math.round(amount * TEAM_COMMISSION_RATE * 100) / 100;
    return {
      roleId: role.id,
      roleTitle: role.role_title,
      freelancerId: role.matched_freelancer_id,
      amount,
      commission,
      total: Math.round(amount * 100) / 100,
      status: role.status,
    };
  },

  projectTotal(rows: ReturnType<typeof teamProjectsService.breakdownRow>[]) {
    return rows.reduce(
      (acc, r) => ({
        amount: acc.amount + r.amount,
        commission: acc.commission + r.commission,
        total: acc.total + r.total,
      }),
      { amount: 0, commission: 0, total: 0 }
    );
  },
};
