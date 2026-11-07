/**
 * Guard: a catalogued email event is only real if a workflow actually sends it.
 *
 * The catalogue in `_shared/emailTemplates.ts` is documentation until something
 * calls the pipeline. That gap is how `proposal_accepted` looked wired for weeks
 * while it could never send: the function selected `profiles(email)`, a column
 * that moved to `profiles_private`, so the query failed before any email was
 * attempted and nothing reported it.
 *
 * These tests pin the three properties that make the wiring trustworthy:
 *   1. the recipient is derived server-side (never taken from the body),
 *   2. the caller is authorised against the real row (project owner / contract),
 *   3. the email is only sent after the database says the state is true.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PROJECT_FN = read('supabase/functions/project-notifications/index.ts');
const PROPOSAL_FN = read('supabase/functions/proposal-notifications/index.ts');
const REVIEWS_FN = read('supabase/functions/reviews/index.ts');
const WORKFLOW = read('src/lib/workflowService.ts');

describe('project completion + review request wiring', () => {
  it('sends through the one shared, logged pipeline', () => {
    expect(PROJECT_FN).toContain("from '../_shared/emailService.ts'");
    expect(PROJECT_FN).toContain('sendTransactionalEmail(');
    // Never a bare Brevo call, and never a hand-rolled From address.
    expect(PROJECT_FN).not.toContain('api.brevo.com');
    expect(PROJECT_FN).not.toContain('Access-Control-Allow-Origin');
  });

  it('only sends the events it has a workflow for', () => {
    expect(PROJECT_FN).toContain("const WIRED_EVENTS = ['project_completed', 'review_request'] as const");
  });

  it('derives the recipient server-side instead of trusting the body', () => {
    // The address comes from profiles_private for the contracted freelancer…
    expect(PROJECT_FN).toContain("from('contracts')");
    expect(PROJECT_FN).toContain("from('profiles_private')");
    // …and the request body may only carry a project id + event name.
    expect(PROJECT_FN).not.toMatch(/body\??\.\s*recipient_email/);
    expect(PROJECT_FN).not.toMatch(/body\??\.\s*to\b/);
  });

  it('authorises against the real project row, not the request', () => {
    expect(PROJECT_FN).toContain("const { data: { user }, error: authError } = await userClient.auth.getUser()");
    expect(PROJECT_FN).toContain('project.client_id !== user.id');
    expect(PROJECT_FN).toContain("project.status !== 'completed'");
  });

  it('is idempotent per project and event', () => {
    expect(PROJECT_FN).toContain('`${event}:${projectId}:${recipientEmail.toLowerCase()}`');
  });

  it('the completion action actually calls it', () => {
    expect(WORKFLOW).toContain("supabase.functions.invoke('project-notifications'");
    expect(WORKFLOW).toContain('export async function notifyProjectCompleted');
    for (const page of ['src/pages/ClientProjectsPage.tsx', 'src/pages/ProjectDetailsPage.tsx']) {
      const src = read(page);
      expect(src, `${page} must notify after completing a project`).toContain(
        'notifyProjectCompleted(projectId)'
      );
    }
  });
});

describe('proposal acceptance/rejection wiring', () => {
  it('reads the address from profiles_private, never the dropped profiles.email column', () => {
    expect(PROPOSAL_FN).not.toMatch(/profiles![\w]*\(id, email, name\)/);
    expect(PROPOSAL_FN).toContain("from('profiles_private').select('email')");
  });

  it('keeps the owner-only guard and the info sender', () => {
    expect(PROPOSAL_FN).toContain("project.client_id !== user.id");
    expect(PROPOSAL_FN).toContain("senderKey: 'info'");
    expect(PROPOSAL_FN).toContain("'proposal_accepted'");
    expect(PROPOSAL_FN).toContain("'proposal_rejected'");
  });

  it('uses a notifications.type value the CHECK constraint actually allows', () => {
    // notifications_type_check allows 'proposal' — not 'proposal_accepted'.
    expect(PROPOSAL_FN).toContain("const notifType = 'proposal'");
    expect(PROPOSAL_FN).not.toContain("const notifType = action === 'accept' ? 'proposal_accepted'");
  });
});

describe('review received wiring', () => {
  it('sends once the review row exists, from the reviews function', () => {
    expect(REVIEWS_FN).toContain("from '../_shared/emailService.ts'");
    expect(REVIEWS_FN).toContain("event: 'review_received'");
    expect(REVIEWS_FN).toContain('idempotencyKey: `review_received:${params.reviewId}`');
  });

  it('notifies the reviewee, looked up server-side', () => {
    expect(REVIEWS_FN).toContain("from('profiles_private').select('email')");
    expect(REVIEWS_FN).toContain('revieweeId: reviewee_id');
  });

  it('never fails a saved review because an email failed', () => {
    // The send is wrapped in its own try/catch — it must not throw into the handler.
    expect(REVIEWS_FN).toMatch(/async function notifyReviewReceived[\s\S]*?try \{[\s\S]*?catch \(err\)/);
  });
});
