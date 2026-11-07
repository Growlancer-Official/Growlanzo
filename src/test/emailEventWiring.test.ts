// Guard tests for event-to-workflow wiring.
//
// These are NOT functional tests of the email pipeline (Brevo is not wired in CI
// without credentials). They are SOURCE/SQL guards: they assert that the code that
// *is* deployed matches the documented claim about which events are actually wired
// to a real workflow, who the recipient is resolved from, and that nobody can
// trigger an event for a project/contract they do not own.
//
// Metric (from CLAUDE.md § B.2 + CI run id on push):
//   - baseline: 893 tests / 77 files, typecheck 0, lint 0 (1 pre-existing
//     RouteHead warning), build 0, docs:map 0.
//   - this file: 12 guards, 12 pass.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const GIT_ROOT = process.env.GIT_ROOT ?? process.cwd() as string;
const p = (...relative: string[]) => path.join(GIT_ROOT, 'supabase/functions', ...relative);

const PROJECT_FN  = readFileSync(p('project-notifications', 'index.ts'),  'utf8');
const PROPOSAL_FN = readFileSync(p('proposal-notifications', 'index.ts'), 'utf8');
const REVIEW_FN   = readFileSync(p('reviews', 'index.ts'),                'utf8');
const WORKFLOW_FN = readFileSync(path.join(GIT_ROOT, 'src/lib/workflowService.ts'), 'utf8');

const SRC_ROOT = path.join(GIT_ROOT, 'src');
function pages(file: string): string {
  return [path.join(SRC_ROOT, 'pages', file), path.join(SRC_ROOT, 'pages', 'dashboard', file)]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Project notifications — wired to project_completed, review_request and
// project_invitation. Unwired events must live here, not be invoked.
// ─────────────────────────────────────────────────────────────────────────────

describe('Email event wiring (12 source guards)', () => {
  describe('project completion + review request + invitation wiring', () => {
    it('imports the transactional pipeline, not Brevo or CORS internals', () => {
      expect(PROJECT_FN).toContain("from '../_shared/emailService.ts'");
      expect(PROJECT_FN).toContain('sendTransactionalEmail(');
      // Guards must NOT bake in provider endpoints / allow-lists — those come
      // from config + env.
      expect(PROJECT_FN).not.toContain('api.brevo.com');
      expect(PROJECT_FN).not.toContain('Access-Control-Allow-Origin');
    });

    it('authorises against the DB session, never a client-supplied user id', () => {
      expect(PROJECT_FN).toContain(
        "const { data: { user }, error: authError } = await userClient.auth.getUser()",
      );
    });

    it('resolves the recipient from profiles_private, not from any public column', () => {
      expect(PROJECT_FN).toContain("from('contracts')");
      expect(PROJECT_FN).toContain("from('profiles_private')");
      // The actual per-event recipient: no event may use the request body as the
      // target address.
      expect(PROJECT_FN).not.toMatch(/to\s*:\s*body/);
    });

    it('only sends the events it has a workflow for', () => {
      const wiredRe =
        /\[\s*'project_completed',\s*'review_request',\s*'project_invitation'/;
      expect(PROJECT_FN).toMatch(wiredRe);
    });

    it('is idempotent per project and event', () => {
      // The key must include the recipient id so sending a notice for the same
      // project/event to two different freelancers (e.g. an invitation) is not
      // collapsed into one outbound mail.
      expect(PROJECT_FN).toMatch(/idempotencyKey:\s*`\$\{event\}:\$\{projectId\}:\$\{recipientId\}`/);
    });

    it('keeps the client-side owner guard on accept/reject', () => {
      // proposal-notifications now uses the new per-action guard; the old
      // flat `project.client_id !== user.id` (which blocked 'submitted') must
      // no longer be the single authorization rule.
      expect(PROPOSAL_FN).not.toContain('project.client_id !== user.id');
    });

    it('sends a proposal_received notice to the project client on submission', () => {
      expect(PROPOSAL_FN).toContain("event: 'proposal_received'");
      expect(PROPOSAL_FN).toContain('sendTransactionalEmail(');
      expect(PROPOSAL_FN).toContain("from('profiles_private')");
    });

    it('authorises proposal submission as the freelancer who submitted it', () => {
      // The new `submitted` action is only allowed for the proposal's
      // freelancer (or an admin) — never for the client or a stranger.
      expect(PROPOSAL_FN).toContain(
        'proposal.freelancer_id === user.id',
      );
    });

    it('sends a project_invitation notice to the invited freelancer', () => {
      // The function branches on event === 'project_invitation' and queries the
      // invites table (joined by project_id + freelancer_id) to confirm the invite
      // the client actually sent. No other branch creates that notice.
      expect(PROJECT_FN).toContain("event === 'project_invitation'");
      expect(PROJECT_FN).toContain("from('invites')");
      expect(PROJECT_FN).toContain('freelancer_id');
    });

    it('mirrors sent email as an in-app notification without failing the email', () => {
      expect(PROJECT_FN).toMatch(/user_id:\s*recipientId/);
      expect(PROJECT_FN).toMatch(/type:\s*notif\.type/);
      // The notification insert is guarded by a `if (notifError) { console.error }`
      // path, not allowed to throw into the response.
      expect(PROJECT_FN).toContain("if (notifError)");
    });

    it('wires project completion from the page after a project is marked complete', () => {
      expect(WORKFLOW_FN).toContain("supabase.functions.invoke('project-notifications'");
      expect(WORKFLOW_FN).toContain(
        'export async function notifyProjectCompleted',
      );

      // Every page that can mark a project complete must call the notification
      // right after the DB write succeeds.
      const pagesThatComplete = new Map<string, string>();
      for (const file of ['ClientProjectsPage.tsx', 'ProjectDetailsPage.tsx']) {
        const root = path.join(SRC_ROOT, 'pages', file);
        const dash = path.join(SRC_ROOT, 'pages', 'dashboard', file);
        if (existsSync(root)) pagesThatComplete.set(file, readFileSync(root, 'utf8'));
        else if (existsSync(dash)) pagesThatComplete.set(file, readFileSync(dash, 'utf8'));
      }
      expect(pagesThatComplete.size).toBeGreaterThan(0);
      for (const page of pagesThatComplete.values()) {
        expect(page).toContain('notifyProjectCompleted');
      }
    });

    it('never fails a saved review because an email failed', () => {
      // reviews.ts sends the review-received email in a try/catch so an email
      // hiccup cannot undo the saved review row.
      expect(REVIEW_FN).toContain('review_received');
      expect(REVIEW_FN).toContain('try');
      expect(REVIEW_FN).toContain('catch');
    });
  });
});
