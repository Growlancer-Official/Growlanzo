## Status log (chronological, newest at bottom)

### (6) 2026-11-07 · Respan Gateway wired as the local AI router; smoke check green
- `supabase/functions/_shared/ai.ts`: new `AI_GATEWAY_URL` → gateway mode. Base
  URL becomes `{AI_GATEWAY_URL}/v1`, the default models become the logical
  routes `growlanzo-chat` / `growlanzo-priority` (overridable via
  `AI_MODEL`/`AI_PRIORITY_MODEL`), and the OpenRouter-only
  `provider: {sort:'latency'}` field is not forwarded. Unset = previous
  OpenRouter behaviour, unchanged (asserted in the smoke check).
- `gateway.toml` (root, `respan-gateway` default config path): loopback
  `127.0.0.1:8080`, no client keys, provider key = existing `env:AI_API_KEY`,
  routes with retries/backoff and a hedged priority lane.
  `requirements-gateway.txt` pins `respan-gateway==0.3.0` (wheel-only);
  `.gitignore` ignores `.venv/`; `.env.example` documents `AI_GATEWAY_URL`.
- `scripts/e2e/respan-gateway-smoke.mjs` (`npm run e2e:gateway`): drives the real
  `callAI()` through a gateway backed by an in-process OpenAI-compatible
  fixture. 18/18 checks green — route translated to a provider model, broken
  target retried, streaming + priority SSE complete, gateway stopped after the
  run, direct mode still OpenRouter.
- **NOT verified:** no live provider request (no provider key here). Docs:
  `docs/blueprint/BACKEND.md` §4.11 + §6; guide
  https://github.com/respanai/respan-gateway
- Verified for this change: `npm run e2e:gateway` 18/18, new guard test 10/10,
  `npm run docs:map` refreshed. Repo-wide `typecheck`, `lint`, `test` and
  `build` are red on files this change does not touch: the
  `src/test/emailEventWiring.test.ts` guard drift and a mid-edit
  `src/pages/ClientReferralsPage.tsx` already present in the worktree —
  unrelated to the gateway.

### (5) 2026-11-07 · Proposal-received + project-invitation wired; guard tests rewritten; pushed
- Wired two more real workflows through server-derived recipients:
  - `proposal_received` — on every proposal submit, `proposal-notifications`
    action `submitted` emails the project's client from `profiles_private.email`,
    authorised as the proposal's freelancer (or admin). One notice per proposal.
  - `project_invitation` — `project-notifications` branches on
    `event === 'project_invitation'`, re-confirms the invite row
    (`invites` by `project_id + freelancer_id`), emails the invited freelancer
    from `profiles_private`, mirrors an in-app 'invite' notification.
- Completion/review events keep their `project.status === 'completed'` gate; the
  owner-vs-non-owner 403 now only blocks non-invitation events (invitations are
  triggered by the client).
- `workflowService.notifyProposalSubmitted(proposalId)` added; `ProjectFeedPage`
  captures the inserted proposal and fires the notice (fire-and-forget).
- `CLAUDE.md` § B.3 + § C.2 updated: bid → proposal, submit → client
  `proposal_received`, invitation → freelancer.
- Guard tests rewritten (12 guards) to match the three-event project whitelist
  (`project_completed`, `review_request`, `project_invitation`), the
  `event:project_id:recipientId` idempotency key, the invite-table guard, the
  per-submitter proposal authorization, and the page-level call sites.
- Verified: typecheck 0, lint 0 (1 pre-existing RouteHead warning),
  **893 tests / 77 files pass**, build 0, `npm run docs:map` 0.
- Commit `be55ac0` pushed to `freebuff/70241dbd803b648fce1d7732`.
- **Deploy status — not yet triggered on this branch.** GitHub auth is absent in
  the workspace, so the `backend-deploy` workflow does not auto-run on the new
  branch and `gh` cannot poll/query runs. Pushing to `main` is the normal trigger
  for an authenticated-deploy run, but I cannot push `main` without explicit
  authorization, and cannot observe the run's step-8 drift outcome without auth.
  See § Blockers below.
- **Blocker unchanged (owner-only):** the step-8 "Migration drift check (repo vs
  live DB)" has been failing on `main` for the last 12 pushed commits
  (`385ed5b` → `d894cbc` → `a3d6a31` → and now `be55ac0` is not yet on `main`).
  The failure is a generic exit-1 with a single step annotation and no
  `::error::` per-version lines, which means the script exited before it could
  report drift — i.e. `supabase migration list` failed (connection/auth) rather
  than real drift. GitHub auth is required to read the step log and confirm,
  and Supabase credentials are required to run `supabase db push` and deploy
  functions. Neither is available here.

### (4) 2026-11-07 · Started diagnosing the deploy blocker; hypothesis recorded (not yet resolved)
- Hypothesis: the drift gate's step-8 failure is **not real migration drift** but
  a failed `supabase migration list` (the script exits 1 with no per-version
  `::error::` annotations, which only happens when the command itself errors).
- Root cause candidates (owner-only): wrong pooler host in the derived `db-url`,
  missing/rotated `SUPABASE_DB_PASSWORD`, or pooler unavailable. Cannot confirm
  without GitHub auth (step logs) or Supabase credentials (live `supabase migration
  list`).
- Historical signal: the last Backend Deploy **success** was `run 41285764444`
  on `61883f2` (2026-10-08). Runs on/main after the Sept-23 `04a9ae5`
  "fail-closed when a guardrail cannot run" change are **29 failures / 0 success**
  (through 2026-11-07-07:50 UTC). First failure in that window: `35832130600` on
  `04a9ae5` (2026-09-23 07:31 UTC). Before that: 37 successes.
- **Two competing hypotheses now live side by side:**
  1. *Blocked deploy pipeline* (likely): `04a9ae5` hardened the gate so a
     failed `supabase migration list` now exits 1 instead of being skipped — but
     `gh`/Supabase creds are needed to read the log and fix the underlying
     connection.
  2. *Remote-only drift*: an already-applied migration lives in the live DB but
     not in `supabase/migrations/` (candidates: `20260830000000`, `20260612` —
     see archived/ README notes), so `pre`-mode drift check exits 1.
- The archived/ README says the ghost `20260612` row was deleted from the live DB
  during the 2026-08-03 reconciliation, so `20260612` is not the drift. It also
  says `20260830000000_consolidated_email_verification_final` was "already
  applied" when archived in `dee13e3` (2026-09-03) — if that row really is in
  the live DB, restoring the file to `supabase/migrations/` would make the repo
  match and clear the `pre`-mode remote-only check; if it is not, restoring would
  make it pending and `db push` would attempt to apply it (wrong direction).
- **No restoration attempted yet** because guessing wrong is worse than a blocked
  deploy. Confirmed safe to continue: the email wire is additive-only (2 new
  tables via `20270307000000_email_logs.sql`, RLS enable, new functions), no
  duplicate migration versions in the repo (314 files).

### (3) 2026-11-07 · Email system docs table + deploy list updated + docs map verified
- `docs/BREVO-EMAIL-SYSTEM.md`: "Which events are actually triggered" table now
  includes `proposal_received` (submit→client) and `project_invitation`
  (invite→freelancer); deploy list includes `project-notifications`,
  `proposal-notifications`, `reviews`, `email-admin`.
- `npm run docs:map` exit 0; `docs/check` pass.
- All four verification gates green (see § B.2) for the email wire.

### (2) 2026-11-07 · Completed the full transactional email system and confirmed green
- 4 senders (`security@`, `support@`, `hello@`, `info@`), event→sender routing,
  `sendTransactionalEmail({event, recipient, data, idempotencyKey})`, safe HTML,
  plain-text alt, branded responsive design, footer (website/support + X/IG/LinkedIn
  "Follow us"), `email_logs` exact columns, no credentials in frontend.
- Webhook verified (Brevo has no HMAC on transactional webhooks → `BREVO_WEBHOOK_SECRET`
  fail-closed: 503 unset / 401 mismatch), idempotent per event+recipient.
- Retry with exponential backoff, duplicate prevention, dead-letter; `sent` = Brevo
  accepted; `delivered/bounced/blocked` only via webhook, monotonic rank.
- Admin console on existing admin surface, existing admin auth, real data only;
  test sends only to the calling admin's own address.
- 40-event catalogue; events without a workflow are catalogued but not triggered.
- Verified: typecheck 0, lint 0 (1 pre-existing RouteHead warning), **893 tests /
  77 files pass**, build 0, docs map 0.
- Commit `58a051f` pushed; CI runs observed (public API/HTML) are red at the
  deploy-step-8 migration drift gate (owner-only blocker, see § Blockers).
- **NOT verified live:** no Brevo DNS auth, no webhook URL registered, no Supabase
  Auth SMTP, no secrets set, no real email sent, no delivery confirmed. Must not
  be reported as working.

### (1) 2026-11-07 · Status log established at the start of this work
- Baseline: `main` at `a3d6a31`, branch `freebuff/70241dbd803b648fce1d7732`,
  cloud workspace with no `gh` auth and no Supabase/Brevo credentials.
