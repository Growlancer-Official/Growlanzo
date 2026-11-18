/** Helpers for contract amount, escrow shape, milestone progress, and milestone CRUD in workspace UIs. */
import { supabase, uniqueChannelName } from './supabase';
import type { Tables } from '../types/supabase';

// ─── Existing types ──────────────────────────────────────────────────────────

export type MilestoneItem = {
  title?: string;
  description?: string;
  amount?: number;
  status?: string;
  due_date?: string;
  delivered_at?: string | null;
  auto_release_hours?: number | null;
};

export type MilestoneStatus = 'pending' | 'in_progress' | 'delivered' | 'completed' | 'approved' | 'released' | 'paid' | 'disputed' | 'cancelled';

type EscrowRow = { id: string; amount: number; status: string };

type ContractLike = {
  amount: number;
  milestones?: unknown;
  escrow?: EscrowRow | EscrowRow[] | null;
};

const COMPLETED_STATUSES = new Set(['completed', 'approved', 'released', 'paid', 'done']);

export function parseMilestones(raw: unknown): MilestoneItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as MilestoneItem[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as MilestoneItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeEscrow(
  escrow: EscrowRow | EscrowRow[] | null | undefined
): EscrowRow | null {
  if (!escrow) return null;
  return Array.isArray(escrow) ? escrow[0] ?? null : escrow;
}

export function contractDisplayAmount(contract: ContractLike): number {
  const milestones = parseMilestones(contract.milestones);
  if (milestones.length > 0) {
    const sum = milestones.reduce((acc, m) => acc + (Number(m.amount) || 0), 0);
    if (sum > 0) return sum;
  }
  return Number(contract.amount) || 0;
}

export function getMilestoneProgress(milestonesRaw: unknown): {
  milestones: MilestoneItem[];
  completed: number;
  total: number;
  percent: number;
} {
  const milestones = parseMilestones(milestonesRaw);
  const total = milestones.length;
  const completed = milestones.filter((m) =>
    COMPLETED_STATUSES.has(String(m.status || '').toLowerCase())
  ).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { milestones, completed, total, percent };
}

// ─── Phase 10: Advanced types ────────────────────────────────────────────────

export interface MilestoneStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  disputed: number;
  fundedAmount: number;
  releasedAmount: number;
  pendingAmount: number;
}

export interface EscrowBalance {
  totalAmount: number;
  fundedAmount: number;
  heldAmount: number;
  releasedAmount: number;
  milestoneCount: number;
  fundedMilestoneCount: number;
  isFullyFunded: boolean;
  isPartiallyFunded: boolean;
  /** Escrow has already paid out — the funding badge must not read "partial". */
  isReleased: boolean;
  escrowRecord: Tables<'escrow'> | null;
}

// ─── Milestone Service ───────────────────────────────────────────────────────

export const milestoneService = {
  /**
   * Fetch parsed milestones for a given contract.
   */
  async getMilestones(contractId: string): Promise<{ success: boolean; milestones: MilestoneItem[]; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('milestones')
        .eq('id', contractId)
        .single();

      if (error) throw error;
      return { success: true, milestones: parseMilestones(data?.milestones) };
    } catch (err) {
      return { success: false, milestones: [], error: err instanceof Error ? err.message : 'Failed to fetch milestones' };
    }
  },

  /**
   * Update a specific milestone at the given index with partial updates.
   * Updates the JSON milestones array on the contracts table.
   */
  async updateMilestone(
    contractId: string,
    milestoneIndex: number,
    updates: Partial<MilestoneItem>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Fetch current milestones
      const { data: contract, error: fetchError } = await supabase
        .from('contracts')
        .select('milestones')
        .eq('id', contractId)
        .single();

      if (fetchError) throw fetchError;

      const milestones = parseMilestones(contract?.milestones);
      if (milestoneIndex < 0 || milestoneIndex >= milestones.length) {
        throw new Error('Milestone index out of bounds');
      }

      // Apply updates
      milestones[milestoneIndex] = { ...milestones[milestoneIndex], ...updates };

      const { error: updateError } = await supabase
        .from('contracts')
        .update({ milestones: milestones as any })
        .eq('id', contractId);

      if (updateError) throw updateError;
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to update milestone' };
    }
  },

  /**
   * Add a new milestone to a contract's milestones array.
   */
  async addMilestone(
    contractId: string,
    milestone: MilestoneItem
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: contract, error: fetchError } = await supabase
        .from('contracts')
        .select('milestones')
        .eq('id', contractId)
        .single();

      if (fetchError) throw fetchError;

      const milestones = parseMilestones(contract?.milestones);
      milestones.push({ status: 'pending', ...milestone });

      const { error: updateError } = await supabase
        .from('contracts')
        .update({ milestones: milestones as any })
        .eq('id', contractId);

      if (updateError) throw updateError;
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add milestone' };
    }
  },

  /**
   * Remove a milestone from a contract's milestones array by index.
   */
  async removeMilestone(
    contractId: string,
    milestoneIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: contract, error: fetchError } = await supabase
        .from('contracts')
        .select('milestones')
        .eq('id', contractId)
        .single();

      if (fetchError) throw fetchError;

      const milestones = parseMilestones(contract?.milestones);
      if (milestoneIndex < 0 || milestoneIndex >= milestones.length) {
        throw new Error('Milestone index out of bounds');
      }

      milestones.splice(milestoneIndex, 1);

      const { error: updateError } = await supabase
        .from('contracts')
        .update({ milestones: milestones as any })
        .eq('id', contractId);

      if (updateError) throw updateError;
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove milestone' };
    }
  },

  /**
   * Mark a milestone as completed (freelancer side).
   */
  async completeMilestone(
    contractId: string,
    milestoneIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    return milestoneService.updateMilestone(contractId, milestoneIndex, { status: 'completed' });
  },

  /**
   * Mark a milestone as approved by the client.
   * This triggers the escrow release for that milestone amount if escrow is funded.
   */
  async approveMilestone(
    contractId: string,
    milestoneIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First update the milestone status to approved
      const updateResult = await milestoneService.updateMilestone(contractId, milestoneIndex, { status: 'approved' });
      if (!updateResult.success) return updateResult;

      // Try to release this milestone from escrow
      const releaseResult = await milestoneService.releaseMilestonePayment(contractId, milestoneIndex);
      if (!releaseResult.success) {
        // Escrow may not be funded yet - that's ok, milestone is still approved
        console.warn('Milestone approved but escrow release skipped:', releaseResult.error);
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to approve milestone' };
    }
  },

  /**
   * Release payment for a specific milestone. Calls the release_milestone RPC
   * which uses FOR UPDATE row locking to prevent race conditions.
   *
   * The RPC handles:
   * - Row-level locking (prevents lost-update race on concurrent releases)
   * - Auth validation (only the contract client can release)
   * - Idempotency (already-released milestones raise an error)
   * - All-milestones-check: calls release_escrow when the last milestone is released
   */
  async releaseMilestonePayment(
    contractId: string,
    milestoneIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: result, error } = await supabase
        .rpc('release_milestone', {
          p_contract_id: contractId,
          p_milestone_index: milestoneIndex,
        });

      if (error) throw error;

      const res = result as { success: boolean; error?: string; message?: string };
      if (!res.success) {
        return { success: false, error: res.error || 'Failed to release milestone' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to release milestone payment' };
    }
  },

  /**
   * Raise a dispute on a specific milestone.
   * Creates a dispute record and updates the milestone status to 'disputed'.
   */
  async disputeMilestone(
    contractId: string,
    milestoneIndex: number,
    reason: string,
    description: string
  ): Promise<{ success: boolean; error?: string; disputeId?: string }> {
    try {
      // Update milestone status to disputed
      const updateResult = await milestoneService.updateMilestone(contractId, milestoneIndex, { status: 'disputed' });
      if (!updateResult.success) return updateResult;

      // Create dispute record using the raise_contract_dispute RPC
      const { data: disputeId, error: disputeError } = await supabase
        .rpc('raise_contract_dispute', {
          p_contract_id: contractId,
          p_description: description,
          p_reason: reason,
        });

      if (disputeError) throw disputeError;

      return { success: true, disputeId: String(disputeId || '') || undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to dispute milestone' };
    }
  },

  /**
   * Get the escrow balance breakdown for a contract.
   * Shows funded, held, and released amounts.
   */
  async getEscrowBalance(contractId: string): Promise<{ success: boolean; balance?: EscrowBalance; error?: string }> {
    try {
      // Fetch contract and escrow in parallel
      const [contractResult, escrowResult] = await Promise.all([
        (supabase.from('contracts') as any).select('amount, milestones, escrow_funded').eq('id', contractId).single(),
        supabase.from('escrow').select('*').eq('contract_id', contractId).maybeSingle(),
      ]);

      if (contractResult.error) throw contractResult.error;
      if (!contractResult.data) throw new Error('Contract not found');

      const contract = contractResult.data;
      const escrow = escrowResult.data as Tables<'escrow'> | null;

      const milestones = parseMilestones(contract.milestones);
      const totalAmount = contract.amount || 0;
      const milestoneCount = milestones.length;

      let fundedAmount = 0;
      let releasedAmount = 0;
      let fundedMilestoneCount = 0;

      if (escrow) {
        // escrow.amount is the CONTRACTED amount recorded when the escrow row is
        // created (before any money moves). It is only "deposited" once the row
        // is actually funded — deriving it from status prevents showing
        // unfunded contracts as "₹X funded"/"Escrow Held ₹X".
        const escrowStatus = String(escrow.status || '').toLowerCase();
        const isMoneyHeld =
          escrowStatus === 'funded' ||
          escrowStatus === 'active' ||
          escrowStatus === 'released' ||
          escrowStatus === 'completed' ||
          escrowStatus === 'partially_funded' ||
          escrowStatus === 'disputed' ||
          escrowStatus === 'frozen';
        fundedAmount = isMoneyHeld ? escrow.amount || 0 : 0;
        const escrowMilestones = parseMilestones(escrow.milestones);

        if (escrowMilestones.length > 0) {
          // Calculate per-milestone breakdown from escrow milestones
          escrowMilestones.forEach((m) => {
            if (COMPLETED_STATUSES.has(String(m.status || '').toLowerCase())) {
              releasedAmount += Number(m.amount) || 0;
              fundedMilestoneCount++;
            }
          });
        } else if (escrow.status === 'released' || escrow.status === 'completed') {
          // Full release
          releasedAmount = fundedAmount;
          fundedMilestoneCount = milestoneCount;
        }
      }

      const heldAmount = Math.max(0, fundedAmount - releasedAmount);
      const isFullyFunded = escrow ? escrow.status === 'funded' || escrow.status === 'active' : false;
      const isPartiallyFunded = escrow ? escrow.status === 'partially_funded' : false;
      const isReleased = escrow ? escrow.status === 'released' : false;

      return {
        success: true,
        balance: {
          totalAmount,
          fundedAmount,
          heldAmount,
          releasedAmount,
          milestoneCount,
          fundedMilestoneCount,
          isFullyFunded,
          isPartiallyFunded,
          isReleased,
          escrowRecord: escrow,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to get escrow balance' };
    }
  },

  /**
   * Calculate milestone statistics from a milestones array.
   */
  getMilestoneStats(milestones: MilestoneItem[]): MilestoneStats {
    const stats: MilestoneStats = {
      total: milestones.length,
      completed: 0,
      inProgress: 0,
      pending: 0,
      disputed: 0,
      fundedAmount: 0,
      releasedAmount: 0,
      pendingAmount: 0,
    };

    milestones.forEach((m) => {
      const status = String(m.status || '').toLowerCase();
      const amount = Number(m.amount) || 0;

      if (COMPLETED_STATUSES.has(status)) {
        stats.completed++;
        stats.releasedAmount += amount;
      } else if (status === 'disputed') {
        stats.disputed++;
        stats.pendingAmount += amount;
      } else if (status === 'in_progress') {
        stats.inProgress++;
        stats.fundedAmount += amount;
      } else {
        stats.pending++;
        stats.pendingAmount += amount;
      }
    });

    stats.fundedAmount = stats.fundedAmount + stats.releasedAmount;

    return stats;
  },

  /**
   * Subscribe to real-time changes on a contract's escrow and milestones.
   * Returns an unsubscribe function for cleanup.
   */
  subscribeToContractChanges(
    contractId: string,
    callback: () => void
  ): { unsubscribe: () => void } {
    const channel = supabase.channel(uniqueChannelName('contract-milestones', contractId))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contracts',
          filter: `id=eq.${contractId}`,
        },
        () => {
          callback();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'escrow',
          filter: `contract_id=eq.${contractId}`,
        },
        () => {
          callback();
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        channel.unsubscribe();
      },
    };
  },
};