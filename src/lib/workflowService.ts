/**
 * End-to-end workflow helpers: PROJECT → PROPOSAL → CONTRACT → WORKSPACE → PAYMENT
 * Prefer these over ad-hoc status updates so client + freelancer dashboards stay connected.
 */
import { contractsService, invitesService, proposalsService } from './dataService';
import { dbFunctions, supabase } from './supabase';

export type HireFromProposalResult =
  | { success: true; contractId: string }
  | { success: false; error: string };

/** Accept proposal and create contract (+ escrow shell via RPC when available).
 * Also sends email notification to the freelancer via proposal-notifications edge function. */
export async function hireFreelancerFromProposal(
  proposalId: string,
  clientId: string,
  options?: { useEscrowRpc?: boolean }
): Promise<HireFromProposalResult> {
  if (options?.useEscrowRpc) {
    const { data: proposal, error: loadErr } = await supabase
      .from('proposals')
      .select('project_id, freelancer_id, proposed_rate')
      .eq('id', proposalId)
      .single();

    if (loadErr || !proposal) {
      return { success: false, error: loadErr?.message || 'Proposal not found' };
    }

    const amount = Math.round(Number(proposal.proposed_rate ?? 0));
    const { data, error } = await dbFunctions.createContractWithEscrow({
      p_project_id: proposal.project_id,
      p_freelancer_id: proposal.freelancer_id,
      p_proposal_id: proposalId,
      p_amount: amount,
      p_client_id: clientId,
    });

    if (error) {
      const fallback = await contractsService.createFromProposal(proposalId, clientId);
      if (!fallback.success || !fallback.data) {
        return { success: false, error: error.message || fallback.error || 'Failed to create contract' };
      }
      // Send email notification even if RPC failed, fallback worked
      await sendProposalNotification(proposalId, 'accept');
      return { success: true, contractId: fallback.data.id };
    }

    const resData = data as any;
    const contractId =
      resData && typeof resData === 'object' && 'contract_id' in resData
        ? String(resData.contract_id)
        : typeof resData === 'string'
          ? resData
          : '';

    if (!contractId) {
      const fallback = await contractsService.createFromProposal(proposalId, clientId);
      if (!fallback.success || !fallback.data) {
        return { success: false, error: 'Contract created but id missing' };
      }
      // Send email notification
      await sendProposalNotification(proposalId, 'accept');
      return { success: true, contractId: fallback.data.id };
    }

    // Send email notification to the hired freelancer
    await sendProposalNotification(proposalId, 'accept');
    return { success: true, contractId };
  }

  const result = await contractsService.createFromProposal(proposalId, clientId);
  if (!result.success || !result.data) {
    return { success: false, error: result.error || 'Failed to create contract' };
  }
  // Send email notification
  await sendProposalNotification(proposalId, 'accept');
  return { success: true, contractId: result.data.id };
}

export async function inviteFreelancerToProject(
  clientId: string,
  projectId: string,
  freelancerId: string,
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const ok = await invitesService.create(clientId, projectId, freelancerId, message);
  if (!ok) return { success: false, error: 'Could not send invite (duplicate or permission denied)' };
  return { success: true };
}

export async function rejectProposal(proposalId: string): Promise<boolean> {
  const ok = await proposalsService.reject(proposalId);
  if (ok) {
    // Send rejection email to freelancer (fire-and-forget)
    await sendProposalNotification(proposalId, 'reject');
  }
  return ok;
}

/** Project lifecycle emails the freelancer receives when a project finishes. */
export type ProjectEmailEvent = 'project_completed' | 'review_request';

/**
 * Call the project-notifications edge function. The recipient and the ownership
 * check are resolved server-side from the project, so nothing here is trusted:
 * a caller can only produce mail about a project they own.
 * Fire-and-forget — the project is already complete whether or not it sends.
 */
async function sendProjectNotification(projectId: string, event: ProjectEmailEvent): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('project-notifications', {
      method: 'POST',
      body: { project_id: projectId, event },
    });
    if (error) {
      console.error(`[project-notifications] ${event} failed:`, error.message);
    }
  } catch (err) {
    // Intentionally silent: post-completion notification is non-critical background work.
    console.error(`[project-notifications] ${event} error:`, err);
  }
}

/**
 * Tell the hired freelancer the project is complete and invite their review.
 * Both are idempotent per project (email_logs idempotency key), so calling this
 * from two places — or twice from the same tab — sends each email at most once.
 */
export async function notifyProjectCompleted(projectId: string): Promise<void> {
  await sendProjectNotification(projectId, 'project_completed');
  await sendProjectNotification(projectId, 'review_request');
}

/** Call the proposal-notifications edge function to send email + in-app notification. */
async function sendProposalNotification(proposalId: string, action: 'accept' | 'reject'): Promise<void> {
  try {
    await supabase.functions.invoke('proposal-notifications', {
      method: 'POST',
      body: { proposal_id: proposalId, action },
    });
  } catch (err) {
    // Intentionally silent: proposal notification is fire-and-forget (non-critical background email).
    // The main proposal action (accept/reject) has already succeeded at this point.
    console.error(`Failed to send proposal ${action} notification:`, err);
  }
}
