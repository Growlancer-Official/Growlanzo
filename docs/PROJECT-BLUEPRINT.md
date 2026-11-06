# Growlanzo — Project Blueprint

**Last verified: 2026-10-20** · repo `main` @ `2f31d6d` + working-tree fixes
**Audience:** the senior development team (human or agent) who will change this
product next.
**Purpose:** one end-to-end picture of how Growlanzo is built, where every kind
of change belongs, which invariants must never break, and what is actually true
about the running product today.

> **How to use this document.** Read §1–§3 for the shape, §4–§8 for the
> mechanics, §12–§13 before planning work, and §14 before touching money. Then
> open the module map for the area you will edit:
>
> - [`blueprint/FRONTEND.md`](blueprint/FRONTEND.md) — Vike/React, routing, guards, state, UI system
> - [`blueprint/BACKEND.md`](blueprint/BACKEND.md) — all 33 edge functions, auth, webhooks, deploy
> - [`blueprint/DATABASE.md`](blueprint/DATABASE.md) — schema, RPCs, RLS, money paths, detectors
> - [`blueprint/DOMAIN-FLOWS.md`](blueprint/DOMAIN-FLOWS.md) — every user journey, state machine, gap
> - [`blueprint/QUALITY-AND-OPS.md`](blueprint/QUALITY-AND-OPS.md) — tests, CI, E2E, runbooks, secrets
> - [`blueprint/INVENTORY.md`](blueprint/INVENTORY.md) — generated file inventory (do not edit)
>
> Durable working rules are in [`../AGENTS.md`](../AGENTS.md); business and
> security law is in [`../CLAUDE.md`](../CLAUDE.md); launch blockers are in
> [`LAUNCH-READINESS.md`](LAUNCH-READINESS.md).

---

## 1. What the product is

Growlanzo is an India-first, AI-assisted freelancing marketplace: clients post
projects, AI ranks freelancers, the two sides agree a proposal, work runs in a
contract workspace, and money is held in escrow until milestones are released.

**Business model — non-negotiable (`CLAUDE.md`):**

| Rule | Value | Where it lives |
| --- | --- | --- |
| Commission | **Flat 5%**, withheld from the freelancer's released payout (Option B, decided A12) | `_book_escrow_release` books 5% as platform revenue at release; client pays exactly the agreed amount |
| Freelancer share | **Contract amount − 5%** at release | `contracts.freelancer_amount` reflects the post-commission credit |
| Premium | **₹299/month**, one optional plan, freelancer-only | `PLATFORM_CONFIG`, subscriptions |
| Packaging | Basic/Standard/Premium free for every freelancer | package tables, UI |
| Client AI | Free for life, fair-use limits only | `ai-*` functions, 100/day cap |
| Ranking | 100% merit; no paid flag in score/sort | `ai-matching`, search, `is_pro` must never appear |
| Withdrawal | ~2% gateway cost, shown separately | `withdrawal`, wallet UI |

## 2. System topology

```
Browser
 ├─ Vike 0.4 SSR / prerender  ──> static HTML + hydration (Vercel or server.js)
 └─ React 19 SPA              ──> react-router (src/app/App.tsx)
        │ supabase-js (anon key + user JWT)
        ▼
Supabase project (Postgres 17)
 ├─ Auth            GitHub + LinkedIn OIDC; profile trigger on auth.users
 ├─ PostgREST       tables + RPCs; RLS + column grants are the real gate
 ├─ Realtime        postgres_changes, owner/participant-scoped
 ├─ Storage         avatars, portfolio, contract files, KYC documents
 ├─ Edge Functions  Deno 2, 33 functions, service-role for privileged work
 │    ├─ Razorpay / RazorpayX  payments in, payouts out (currently blocked)
 │    ├─ PayPal                implemented, UI-disabled
 │    ├─ Brevo                 transactional email (currently IP-blocked)
 │    ├─ OpenRouter            AI chat / writer / matching
 │    ├─ Surepass/Deepvue      KYC adapter (currently development mode)
 │    └─ pg_net + CRON_SECRET  scheduled functions
 └─ Postgres objects
      ├─ ~100+ tables, 300+ function definitions
      ├─ RLS policies + explicit column grants
      ├─ SECURITY DEFINER RPCs (the only money writers)
      ├─ triggers (signup profile, wallet, privilege guards, notifications)
      └─ pg_cron → check_security_drift() hourly → security_alerts → email edge
```

External: Vercel (frontend), GitHub Actions (CI + deploy), Sentry (browser
telemetry only), Razorpay, PayPal, Brevo, OpenRouter, KYC provider.

## 3. Repo map

| Area | Path | Scale |
| --- | --- | --- |
| Vike shell | `pages/`, `index.html`, `vite.config.ts`, `scripts/build.mjs`, `server.js` | one catch-all page + prerender list |
| Frontend app | `src/**` | 95 page files, 50 components, 4 layouts, 64 lib/service modules, 10 context/hooks |
| Edge functions | `supabase/functions/**` | 33 functions + 6 `_shared` modules |
| Database | `supabase/migrations/**` | 296 applied + 6 archived SQL files |
| Tests | `src/test/**` | 50 suites (≈580 assertions/tests) |
| E2E / live probes | `scripts/e2e/**` | 19 harnesses, throwaway-account teardown |
| Generated map | `docs/blueprint/INVENTORY.md` | refreshed by `npm run docs:map`, guarded by `projectMap.test.ts` |

Authoritative generated list: [`blueprint/INVENTORY.md`](blueprint/INVENTORY.md).

## 4. Request lifecycle

**Public page.** Vike serves prerendered HTML from `dist/` (or `server.js`
static-first), the client hydrates the same React tree, `src/app/App.tsx` routes
by URL. The boot splash is cleared only after the router paints; the theme class
is applied in `<head>` before paint. `pages/prerenderUrls.ts` is the only
prerender list that matters.

**Authenticated page.** `ProtectedRoute` loads `AuthContext`, re-reads
`profiles.role` and `profiles_private.suspended_at` from the server, enforces
onboarding and allowed roles, then renders the dashboard layout. `AdminAuthGuard`
is a UX gate only; the `admin-data` edge function re-verifies `is_admin`.

**Read.** Page → `src/lib/*` service → `supabase.from(...).select()` or
`supabase.rpc(...)` → PostgREST applies RLS/column grants → rows. Realtime
subscriptions use `realtimeChannels.*` with a unique name and unconditional
unsubscribe.

**Write (normal).** Page → service → table insert/update allowed by RLS, or a
non-money RPC. Every user action is toast/error-handled; no silent failure.

**Write (privileged).** Page → `supabase.functions.invoke()` or `fetch` →
edge function verifies the JWT with `auth.getUser()` → service-role client →
`SECURITY DEFINER` RPC (ownership + idempotency + row lock) → tables + ledger.

**Webhook.** Gateway → edge function with `verify_jwt = false` → signature
verified fail-closed → idempotency row (`payment_webhook_events.event_id`) →
RPC → escrow/ledger/notifications. Unknown or unsigned events change nothing.

## 5. Frontend in one page

- **One router.** Vike has a single catch-all; all routes are in
  `src/app/App.tsx`, lazy-loaded, wrapped in one `<Suspense>`. `src/routes.ts`
  is a partial, partly-wrong mirror with dead constants — do not use it as the
  source of truth.
- **Guards.** `ProtectedRoute` = session + server role + suspension +
  onboarding + role allow-list. `getPostAuthPath()` is the single post-auth
  destination policy (full-page replace to avoid races).
- **Auth.** OAuth only (GitHub, LinkedIn). `AuthContext` owns session, profile,
  cross-tab sync, liveness and deferred referral processing.
- **State/data.** No React Query/Redux. Services in `src/lib/**` return typed
  data and call Supabase directly; hooks compose loading/refresh/realtime.
- **UI system.** Tailwind with a CSS palette remap for dark mode; any new colour
  class is a dark-mode bug until remapped. Lucide icons only (brand marks are
  allowlisted). Shared primitives: `Button`, `ModalShell`, `Toast`,
  `ConfirmModal`, `EmptyState`, skeletons.
- **Money display.** `useCurrency()` + `formatCurrency`; the current
  implementation changes the symbol but **not the value** (FX is a known bug).
- **SEO.** One global `pages/+Head.tsx`; `RouteHead` exists but is unmounted, so
  per-route titles are not live.

Details, file-by-file playbooks and hazards: [`blueprint/FRONTEND.md`](blueprint/FRONTEND.md).

## 6. Backend in one page

- **33 functions**, one `index.ts` each. `_shared/` holds `cors`, `site`,
  `brevo`, `ai`, `errors`, `urlGuard`; only the first four are used (`errors`
  and `urlGuard` are dead code today).
- **Auth model.** Default `verify_jwt = true`; exactly six overrides are
  `false`: three payment webhooks, two cron functions, `security-alert-notify`.
  Each of those re-authenticates in code (HMAC, PayPal verify API, or
  `CRON_SECRET`) and fails closed.
- **CORS.** Only `_shared/cors.ts`; a private allow-list is a regression
  (`src/test/cors.test.ts` fails on it).
- **Site URL.** Only `_shared/site.ts` reads `APP_URL`; hardcoded origins fail
  `siteUrlGuard.test.ts`.
- **Money.** The edge function never accepts a client price: it fetches the
  contract/package/plan row and computes the amount server-side. Razorpay
  `verify_payment` is idempotent on `status='captured'`; the webhook is
  idempotent on `event_id`.
- **Known backend risks.** Payout webhook HMAC usage, queued-withdrawal retry,
  `ai-assistant` trusting body `user_role`, and a service-role path that calls a
  NULL-safe RPC which now rejects service-role context (see §14).

Details: [`blueprint/BACKEND.md`](blueprint/BACKEND.md).

## 7. Data and money

**Identity.** `auth.users` → `profiles` (public-shaped: id, role, name, avatar,
rating, …) + `profiles_private` (email, phone, referral code, `is_admin`,
suspension). Public SELECT on `profiles` is a **column allowlist** (11 anon,
14 authenticated); a new column needs an explicit grant in the same migration or
the six `profiles!fk(*)` embeds break. The signup trigger creates profile,
private row, wallet and referral code server-side.

**Marketplace.** `projects` → `proposals` → `contracts` → `milestones` →
`escrow`; `services`/`packages` for productised work; `reviews` feed ratings and
reputation; `team_projects` + `team_project_roles` create one independent
contract per role.

**Money path (simplified).**

```
Client funds:
  Razorpay order = contract.amount + 5% fee        (server-derived)
  wallet funding debits contract.amount + 5% fee
        │
        ▼
  escrow row: amount = contract.amount, status pending → funded
  client wallet.escrow_balance += contract.amount
        │
        ▼
  release: escrow amount → freelancer wallet + platform revenue + invoice + ledger
           (Option B: 5% withheld from freelancer at release — see §14.1)
        │
        ▼
  withdrawal: available balance → hold → RazorpayX payout → completed
              (currently queues: payouts product 404)
```

**Invariants that must hold:**

1. `wallets.escrow_balance(client) == Σ escrow.amount WHERE status='funded'`.
2. `platform_revenue.freelancer_amount + platform_fee == escrow.amount`.
3. One revenue/invoice booking per `(contract_id, source='escrow')`.
4. `net + fee == gross` in `_book_escrow_release`'s ledger rows.
5. Team project: one contract's dispute/release/refund never touches another's
   escrow row.
6. No client write policy on wallets, escrow, contracts, transactions,
   withdrawals, refunds, revenue, invoices.

Details, RPC catalog and traps: [`blueprint/DATABASE.md`](blueprint/DATABASE.md).

## 8. Security model

**Trust boundaries.** Browser (untrusted) → PostgREST (RLS + column grants) →
edge function (JWT verified) → service role (bypasses RLS, therefore must do its
own ownership checks) → SECURITY DEFINER RPC (last line).

**Ten rules that are enforced by tests and/or detectors** (full text in
`CLAUDE.md` §Security Principles):

1. Never trust a client amount/price/quantity.
2. Money changes only through SECURITY DEFINER RPCs.
3. Webhooks fail closed on missing/invalid signature.
4. Admin checks are server-side (`profiles_private.is_admin`).
5. Cron functions verify `CRON_SECRET`.
6. Identity comes from `auth.getUser()`, never request-body `user_id`.
7. Every DB change is a migration; dashboard edits are forbidden.
8. Audit SELECT policies, not only writes.
9. Money RPC: ownership + server amount + idempotency + `FOR UPDATE` + ledger.
10. Null-safe guards: `auth.uid()` is NULL for anon; `x <> NULL` is not false,
    it is NULL (falsy), so the guard silently does not run.

**Self-detection.** Hourly `check_security_drift()` sweeps RLS-disabled tables,
open policies, definer `search_path`, storage writes, PUBLIC writes, anon PII,
plus eight detectors (self-writable trust columns, anon-reachable money RPCs,
client-writable money tables, NULL-unsafe guards, self-referential policies,
legacy JWT-claim checks, anon/authenticated profile-column allowlists, signup
ghost accounts). Findings land in `security_alerts` and are emailed through
`security-alert-notify` — but email is currently blocked by Brevo (A9), so the
admin console is the real inbox.

## 9. User journeys — index

Full step-by-step traces and state machines: [`blueprint/DOMAIN-FLOWS.md`](blueprint/DOMAIN-FLOWS.md).

| # | Journey | Build state (2026-10-20) |
| --- | --- | --- |
| J1 | OAuth signup → profile trigger → onboarding → country gate | Built; provider leg live |
| J2 | Discovery: search, catalogue, public profile, service, reviews | Built; marketplace empty (0 active services) |
| J3 | Post project → AI matching → invite/proposal → hire | Built; AI verified live |
| J4 | Contract workspace, single + team | Built; team isolation runtime-proven |
| J5 | Escrow funding: wallet / Razorpay / PayPal / admin | Built; no real payment ever captured (A2) |
| J6 | Milestones, delivery, release, invoice, ledger | Built; rehearsed |
| J7 | Withdrawal → payout methods → RazorpayX | **Blocked**: payout product 404 (A1) |
| J8 | Disputes, refunds, admin resolution | Built |
| J9 | Reviews, reputation, seller levels | Built; 0 reviews |
| J10 | Premium ₹299 + AI quotas | Built; AI providers live |
| J11 | KYC / identity verification | Built; **development mode auto-verifies** (A4) |
| J12 | Skill certifications, certificate verification | Partial; quiz answers ship client-side |
| J13 | Contests, internships, tickets, reports, notification prefs | Mixed |
| J14 | Referrals + Grow Coin | Built; professional codes deployed this pass |
| J15 | Admin console | Built; reads runtime-verified |

## 10. Build, verify, deploy

```bash
npm run dev          # Vite, local
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest, jsdom, 1 worker
npm run build        # scripts/build.mjs → dist + prerender + SPA fallback
npm run docs:check   # generated inventory freshness
npm run preflight    # launch configuration check (founder-facing)
npm run verify       # typecheck + lint + test + build
```

A push to `main` is the deploy:

| Workflow | What it does |
| --- | --- |
| Vercel (Git integration) | Builds/deploys the frontend |
| `ci.yml` | Typecheck, lint, unit tests, build, element audit, authenticated sweeps |
| `backend-deploy.yml` | Secret guards → drift check → `db push` → drift check → deploy 33 functions → pentest → whole-surface audit |
| `supabase-check.yml` / `supabase-deploy.yml` | Legacy; `supabase-deploy.yml` is dormant but armed with `--no-verify-jwt` — do not revive it |

**Reality check:** `main` is not branch-protected, the three workflows run in
parallel, and the backend workflow's verification stages run *after* the
migration/functions are already live. A red Backend Deploy can mean "deployed
but the audit failed", not "nothing shipped". Read the job list, not the badge.
See [`blueprint/QUALITY-AND-OPS.md`](blueprint/QUALITY-AND-OPS.md).

## 11. Environment and secrets (names only)

- **Browser:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_APP_VERSION`, `VITE_SENTRY_DSN`, `VITE_PAYPAL_ENABLED`,
  `VITE_RAZORPAY_CONFIG_ID`.
- **Edge functions:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
  `RAZORPAY_ACCOUNT_NUMBER`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
  `PAYPAL_WEBHOOK_ID`, `PAYPAL_SANDBOX`, `BREVO_API_KEY`, `EMAIL_FROM`,
  `EMAIL_REPLY_TO`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `APP_URL`,
  `CRON_SECRET`, KYC provider secrets.
- **GitHub Actions:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
  `SUPABASE_DB_PASSWORD` (or `SUPABASE_DB_URL`), `SUPABASE_SERVICE_ROLE_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, six `E2E_*` credentials.
- **Single source for links:** `APP_URL` (read only by `_shared/site.ts`).

Never print or commit a value. `.env*` and `.e2e/` are gitignored; `noCommittedSecrets.test.ts`
is a textual backstop, not a vault.

## 12. Current state — measured, 2026-10-20

**Engineering:** typecheck clean, lint clean after the referral fixes, ~580 unit
tests, production build clean. Before this pass, CI on `main` was red on the
referral commit (lint + icon-count guard); the fixes are in the working tree.

**Product:** public paid launch is **NO**. The honest posture is invite-only beta
with money handled manually. Blockers (`LAUNCH-READINESS.md` §A):

| Gate | State |
| --- | --- |
| Money in | Code path rehearsed; **no real payment ever captured** (A2) |
| Money out | **Impossible** — RazorpayX Payouts 404, account number unset (A1) |
| Marketplace | Empty — 0 active service listings (A8) |
| Members | 9 signable profiles (live metric) |
| KYC | Development mode — anyone verifies instantly (A4) |
| Email | Brevo Authorised-IPs rejects every send (A9) |
| Legal identity | Name/grievance contact added; entity/address/CIN still missing (A10) |
| Grow Coin | Migration and functions deployed this pass; legal terms absent (A11) |

## 13. How to change the product (end-to-end playbook)

**A feature that touches UI + data (no money).**

1. Find the nearest existing journey in `DOMAIN-FLOWS.md` and the service it
   uses. Reuse that shape.
2. Add/extend the type in `src/types/` (or local service types).
3. Add the service method in `src/lib/<domain>.ts`; register any RPC in
   `RpcName`/`dbFunctions` (`src/lib/supabase.ts`).
4. Add the hook/effect with `loading`, `refresh`, realtime cleanup.
5. Add the page under `src/pages/` (both roles = two files), register it in
   `App.tsx`, the layout nav, `dashboardSection.ts`, and `pages/prerenderUrls.ts`
   if public.
6. Use shared primitives (`Button`, `ModalShell`, `Toast`, `ConfirmModal`,
   `EmptyState`); no native `alert`/`confirm`; no empty `catch`.
7. Add an RTL test if it has behaviour, plus a source guard if it encodes a
   product rule (honesty, merit, fee, quota).
8. `npm run docs:map` (new files), `npm run verify`, real-browser check.
9. Update the status log and deploy.

**A DB change.**

1. New timestamped migration (never edit an applied one). Read
   `DATABASE.md` §1 and §9 first.
2. Idempotent DDL, explicit grants, fail-closed assertions resolved by OID,
   positive/negative controls for any detector.
3. `npm test` (SQL lexer) + dry-run in a rolled-back transaction when DB access
   exists.
4. Push: drift check must be clean before and after `db push`.

**An edge function.**

1. Copy the nearest function; import CORS/site/auth from `_shared`.
2. Choose auth: user JWT (`auth.getUser()`), cron (`CRON_SECRET`), webhook
   (signature), or service-role internal.
3. Rate-limit anything cost-heavy; make money paths idempotent; never trust a
   body amount/user id.
4. Add `[functions.<name>] verify_jwt = false` only for server-to-server calls,
   with an in-code check.
5. Deploy and exercise it; the workflow only proves it bundled, not that it
   works.

**A money change.** Stop. Read §14 and `CLAUDE.md` §Security Principles §9.
Ownership, server-derived amount, idempotency, row lock, ledger entry, and a
rolled-back live proof are all required. If the change affects who pays what,
get the founder's decision before writing code.

## 14. Top risks and open decisions

Ordered by what can hurt the company first. Evidence is in the module docs.

### 14.1 CRITICAL — commission is collected twice (decision required)

> **DECIDED (A12, 2026-10-21): Option B.** The client pays exactly the agreed
> contract amount; the flat 5% is withheld from the freelancer at release.
> Migration `20270203000000_commission_model_option_a.sql` and commit `d45b388`
> implement it, and the pricing/terms/refund copy now states the freelancer-side
> model. The client-pays-5% flow is retired — do not "fix" the money path back
> to it.

**Verified behavior (Option B):** for a released ₹5,000 contract, `client_charged`
= ₹5,000 (nothing added at checkout), `freelancer_credit` = ₹4,750, and
`platform_revenue` books exactly ₹500. A cancelled-before-work contract refunds the
full amount with no commission. `scripts/e2e/pentest-privileges.mjs` asserts both
legs as hard gates.

### 14.2 HIGH — the repo cannot rebuild production

30 of 296 migrations are 3-byte placeholders (`;`), and ~20 tables plus several
money RPCs exist only in the live database (`DATABASE.md` §11.1). The drift gate
compares versions, not bodies, so it reports clean. A fresh environment,
disaster recovery, or a `supabase db reset` cannot reproduce production, and a
future `CREATE OR REPLACE` can silently revert a live-only fix (this has already
happened twice). The real bodies survive in git history before `a3a5511` and in
the live catalog. Recovering them into real migrations is the highest structural
priority after launch safety.

### 14.3 HIGH — payouts and the withdrawal state machine

RazorpayX Payouts returns 404 and `RAZORPAY_ACCOUNT_NUMBER` is unset, so every
withdrawal queues. The repo also has no retry cron for queued withdrawals (the
`15-min retry` claim has no workflow/cron counterpart), the payout webhook's
HMAC key import looks wrong, and a sync-completed payout does not deduct
`pending_balance` because the NULL-safe RPC now rejects the service-role caller.
Funds stay held, but the state machine is not trustworthy until A1 is fixed and
these paths are exercised with a real payout.

### 14.4 HIGH — money-in has never run

`razorpay_orders = 0`, `transactions = 0`, `invoices = 0`. The webhook and
release path are rehearsed with synthetic signed events, not a human card. A2
is the single most valuable next test.

### 14.5 HIGH — verification and email are not real

KYC is in `development` mode and auto-verifies anyone; Brevo's Authorised-IPs
setting rejects every transactional email. Both are owner actions (A4/A9).
Until then, "Verified" is not verified and no user can be reliably notified.

### 14.6 MEDIUM — authorization edges still wider than policy

`ai-assistant` trusts `user_role` from the request body; `verifyAdminSession`
has an email-match fallback; 33 SECURITY DEFINER functions were still
anon-executable as of the October audit; `record_profile_view` is anon-callable
and writes; skill-test answers ship in the client bundle and users can insert
their own `skill_certifications`. Each is documented in the module maps with a
concrete fix; none should be silently changed without the money/security review.

### 14.7 MEDIUM — process and documentation drift

`main` is unprotected; CI, Vercel, and Backend Deploy race; the docs disagreed
with the tree on test counts, route architecture, `--include-all`, and the
signup trigger. This blueprint + generated inventory + drift test are the
countermeasure; they only work if every change refreshes them.

## 15. Documentation system

| Question | Authoritative file |
| --- | --- |
| What are we building and why? | `CLAUDE.md` (business model), this file |
| What is blocked before real money? | `LAUNCH-READINESS.md` |
| How do I change frontend/backend/DB? | `blueprint/*.md` |
| What files exist right now? | `blueprint/INVENTORY.md` (generated) |
| What is the latest history/evidence? | `CLAUDE.md` tail (append-only) |
| How do I verify/deploy? | `blueprint/QUALITY-AND-OPS.md` |
| What did the last audit find? | `AUDIT_*`, `UI-ELEMENT-AUDIT-REPORT.md`, `LAUNCH-REVIEW-2026-10-20.md` |

`npm run docs:map` regenerates the inventory; `npm run docs:check` and
`src/test/projectMap.test.ts` fail when it is stale. Module docs are hand-written
and must be corrected in the same change that invalidates them.

## 16. Glossary

- **Escrow** — the `escrow` row holding a contract's money; states
  `pending → funded → released/refunded/disputed`.
- **Funding** — marking escrow funded after money arrives; all paths converge on
  `admin_fund_escrow`.
- **Release** — paying the freelancer and booking commission/invoice/ledger.
- **Milestone** — a JSONB entry on `contracts.milestones` plus optional
  `milestones` rows; release can be full or per-milestone.
- **Team project** — one `team_projects` row with multiple roles; each role gets
  its own contract + escrow.
- **Grow Coin** — referral/reward ledger (`grow_coin_ledger`), no balance
  column; spendable on premium or (freelancer/admin only) cash.
- **RPC** — a Postgres function exposed through PostgREST; money RPCs are
  `SECURITY DEFINER` and usually service-role-only.
- **Detector** — a server-only SQL function that finds a class of security
  regression; each ships with positive and negative controls.
- **Drift** — repo migration versions vs live `schema_migrations`; the deploy
  gate fails on remote-only entries before push and on any difference after.
