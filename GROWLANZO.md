# GROWLANZO — Master Technical Document

> Single source of truth for the Growlanzo codebase: what the product is, how it is
> built, how it is deployed, what the business and security rules are, which secrets
> the backend needs, and where the project currently stands.
>
> The agent working contract lives in `AGENTS.md` (rules, change protocol,
> verification matrix) and the dated engineering log lives in `CLAUDE.md`
> (newest entry at the bottom). This file is the handover document for humans.

Last full audit: 2026-11-19 (Exa people/company search deployed and verified live).

---

## 1. Product

Growlanzo is an AI-assisted freelancing marketplace. It joins talent discovery,
contracts, collaboration, escrow payments, verification and reputation into one
workflow:

- **Freelancers** publish work packages (Basic / Standard / Premium), get matched to
  projects, deliver milestones, get paid into a wallet and withdraw.
- **Clients** post projects, compare freelancers, fund escrow, review milestones.
- **Admins** moderate projects, disputes, wallets, withdrawals, KYC and email.

Public site: `https://www.growlanzo.com` · Supabase project: `zttwsjehcgaicziqyxpq`
(region `ap-southeast-1`).

## 2. Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript, Vite, Tailwind, `lucide-react`, react-router (route strings live in `src/app/App.tsx`) |
| Build / serve | `scripts/build.mjs` (Vite build + prerender + SPA/404 handling), `server.js` (Node, production static server), `vercel.json` (rewrites) |
| Backend | Supabase: Postgres + RLS, Auth (email/password + OAuth), Storage, Realtime, 37 Edge Functions (Deno) |
| Payments | Razorpay (primary: orders, webhooks, RazorpayX payouts), PayPal (implemented, disabled) |
| Email | Brevo (`_shared/brevo.ts`, `emailService.ts`, templates) |
| AI | OpenAI-compatible gateway (`_shared/ai.ts`), models via `AI_MODEL` / `AI_PRIORITY_MODEL` |
| Search / web | Exa (`_shared/exa.ts` → `exa-search` edge function) |
| Hosting | Frontend Vercel, backend Supabase, CI GitHub Actions |

## 3. Repository map

```
src/
  app/            App.tsx — runtime routing (source of truth for route strings)
  pages/          one exported page component per file, lazy-loaded
  components/     shared UI (Button, Modal, Toast, ConfirmModal, EmptyState, …)
  lib/            business logic + services; services call Supabase/RPC/edge functions
  context/        AuthContext — session, role, profile hydration, cross-tab sync
  test/           vitest suites (jsdom, single worker); many are source-reading guards
supabase/
  functions/      one folder per edge function (index.ts) + `_shared/` helpers
  migrations/     timestamped SQL, one change per file; repo is the DB source of truth
scripts/          build, project map, preflight, e2e probes (scripts/e2e/*)
docs/blueprint/   generated INVENTORY.md + module notes
public/           static assets, manifest, platform metrics
```

## 4. Local development

```bash
npm ci                 # install exactly what the lockfile pins
npm run dev            # Vite dev server
npm run verify         # typecheck + lint + test + build (the gate before a push)
```

Individual gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run docs:check` (generated inventory must be current), `npm run preflight`
(founder-facing launch configuration check).

Node: see `.nvmrc`. Frontend needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
in `.env` (public values, safe to ship).

## 5. Environment variables — where each one goes

| Destination | Variables | Notes |
| --- | --- | --- |
| Vercel (build-time, **public**) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_*` feature flags, `VITE_PAYPAL_ENABLED`, `VITE_RAZORPAY_CONFIG_ID`, `VITE_AI_MODEL`, `VITE_APP_VERSION`, `VITE_SENTRY_DSN` | Vite inlines these into the bundle — treat as visitor-readable |
| Supabase Edge Function secrets (**server-only**) | everything else: Razorpay, PayPal, Brevo, Exa, AI, `CRON_SECRET`, `APP_URL`, `EMAIL_*`, `REPORT_EMAIL`, `ADMIN_SIGNUP_SECRET`, `FEATURE_*_ENABLED` | never gets a `VITE_` prefix, never goes to Vercel |
| GitHub Actions (CI only) | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` / `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`, `E2E_*` logins | not injected into the Vercel build |

The frontend holds **no** server secret. `src/test/frontendEnvLeak.test.ts` fails the
build if a secret ever becomes reachable through `import.meta.env` / `process.env` in
shipping code, and `src/test/noCommittedSecrets.test.ts` fails if a credential is
committed anywhere in the tree. Verified 2026-11-19: searching the built bundle for the
real values of `EXA_API_KEY`, `BREVO_API_KEY`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` matched **0 files**.

### Edge secrets currently set (2026-11-19)

Set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`,
`SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `APP_URL`,
`CRON_SECRET`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_VISION_MODEL`,
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`,
`PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX`, `BREVO_API_KEY`, `EMAIL_FROM`, `EXA_API_KEY`.

Still needed from the owner (code reads them, the edge does not have them):

| Name | Needed by | Effect while missing |
| --- | --- | --- |
| `BREVO_WEBHOOK_SECRET` | `brevo-webhook` | every event rejected (function answers 503) |
| `RAZORPAY_ACCOUNT_NUMBER` | `withdrawal`, `admin-withdrawal` | RazorpayX payout cannot be created |
| `ADMIN_SIGNUP_SECRET` | `admin-signup` | admin signup code check impossible |

Optional (code has a default): `PAYPAL_WEBHOOK_ID` + `PAYPAL_ENABLED` (PayPal stays
off), `RAZORPAY_PAYOUT_WEBHOOK_SECRET` (falls back to `RAZORPAY_WEBHOOK_SECRET`),
`EMAIL_REPLY_TO`, `REPORT_EMAIL`, `ADMIN_EMAIL`, `AI_GATEWAY_URL`,
`AI_PRIORITY_MODEL`, `FEATURE_*_ENABLED` (feature flags default to off).

Known inconsistency: the edge copy of `SUPABASE_SERVICE_ROLE_KEY` differs from the
current project service-role key (a stale manual override). Supabase injects its own
value, so this only matters if a function starts answering 401 to service-role calls.

## 6. Deploy

- Frontend: push to `main` → Vercel build (`npm run build`).
- Backend: push to `main` touching `supabase/**` → `.github/workflows/backend-deploy.yml`:
  migration drift check → `supabase db push` → deploy every edge function from repo
  source → privilege/money-path pentest → whole-surface audit. It fails closed: no
  migration and no function deploy is recorded when a guard or the pentest cannot run.
- Backend Deploy failure alerting: the `alert` job opens (or comments on) a GitHub
  issue labelled `deploy-alert` with the run link, commit and failing step(s), and the
  next green run closes it. It uses the workflow token — no extra secret and no
  repository setting change: the job's own `permissions: issues: write` / `actions: read`
  block adds those scopes on top of whatever default Settings → Actions sets.
- Edge functions can also be deployed directly with the pinned CLI:
  `npx supabase@2 functions deploy <name> --project-ref zttwsjehcgaicziqyxpq`
  (`verify_jwt` comes from `supabase/config.toml`; only webhook/cron functions disable it).
- Branch policy: **`main` only**. Work is committed and pushed to `main`; other branches
  are deleted after merge. All other branches currently contain no commits that `main`
  does not already have.

## 7. Database rules

- Every schema change is a migration file in `supabase/migrations/`; the dashboard SQL
  editor is never the source of truth.
- Drift check compares repo versions against `schema_migrations`; two files sharing a
  version number is a hard failure (it silently blocks deploys).
- Money state changes only through `SECURITY DEFINER` RPCs; no client `UPDATE` policy on
  wallets, escrow, contracts, transactions, withdrawals.
- RLS is audited for `SELECT` too, and NULL-safe (`auth.uid() IS NULL OR …`).
- Generated map: `npm run docs:map` refreshes `docs/blueprint/INVENTORY.md`;
  `npm run docs:check` fails when it is stale (also enforced by a unit test).

## 8. Business rules (non-negotiable)

| Rule | Value |
| --- | --- |
| Platform commission | **Flat 5%**, withheld from the freelancer's released payout; the client pays exactly the agreed amount |
| Freelancer Premium | **₹199/month**, optional, never gates packaging |
| Packaging (Basic/Standard/Premium) | Free for every freelancer, always |
| Client AI | Free for life, protected by fair-use rate limits, never a paywall |
| Ranking / matching / search | 100% merit-based; no `is_pro`/subscription/payment flag may affect score or order |
| Withdrawal fee | ~2% (real gateway transfer cost), shown separately from commission |
| Team projects | One project → independent contracts per role, 5% per contract, one member's dispute cannot touch another's escrow |

## 9. Security invariants

1. Never trust a client-sent amount, price, fee or quantity — send IDs, derive values server-side.
2. Money state changes only through `SECURITY DEFINER` RPCs.
3. Webhooks fail closed (missing/invalid signature ⇒ reject, no processing).
4. Admin checks are server-side (`profiles_private.is_admin`), never only a route guard.
5. Cron functions verify `CRON_SECRET`.
6. Identity comes from `auth.getUser()`, never `request.body.user_id`.
7. Every DB change is a migration file.
8. Audit `SELECT` policies, not only writes.
9. Money RPC checklist: ownership, server-derived amount, idempotency, `FOR UPDATE` when
   balances move, ledger entry.
10. NULL-safe guards (`x <> NULL` is NULL, which is falsy).

## 10. Verification matrix (before any push)

| Change | Minimum |
| --- | --- |
| Docs only | `npm run docs:check` if structure changed |
| TS / UI | `npm run typecheck` + `npm test` + `npm run build`; load the affected route |
| Edge function | above + exercise the function (or its e2e probe); confirm CORS/auth/rate limit |
| Migration (non-money) | above + `npm run docs:map` + SQL lexer guard + rolled-back dry run when DB access exists |
| Money / RLS / auth | above + invariants audit + `scripts/e2e/pentest-privileges.mjs` / `surface-audit.mjs` + rolled-back dry run + negative control |
| Any push | watch the Backend Deploy run; report run result, never assume it |

## 11. Live edge functions and probes

Authenticated functions (gateway JWT check on): `ai-matching`, `ai-writer`, `exa-search`,
`email-admin`, `project-notifications`, `admin-*`, `invoice`, `withdrawal`, `submit-report`, …
Server-to-server (`verify_jwt=false`, secret verified inside): `razorpay-webhook`,
`paypal-webhook`, `razorpay-payout-webhook`, `brevo-webhook`, and the cron functions
(`subscription-billing-cron`, `milestone-auto-release`, `security-alert-notify`) which
require `CRON_SECRET`.

Live probes that exist in `scripts/e2e/`: `route-smoke.mjs` (40 production routes +
negative control), `pentest-privileges.mjs`, `surface-audit.mjs`, `auth-lifecycle.mjs`,
`oauth-signup-chain.mjs`, `razorpay-webhook-rehearsal.mjs`, `respan-gateway-smoke.mjs`,
`exa-search-smoke.mjs` (`--category=people|company`, `--objective=`).

Verified 2026-11-19: `exa-search` returns 401 without a JWT, 200 with people/company
results for a signed-in user, 400 for a category outside the allowlist.

## 12. Known launch blockers

Public paid launch is currently **no** for owner-side reasons, not code reasons:

- Payouts disabled (Razorpay account number not configured).
- No real payment has ever been run end to end.
- Brevo delivery domain: SPF still lacks `include:spf.brevo.com` (DKIM is aligned, so
  mail arrives; one-identifier alignment is the weakest acceptable state).
- KYC provider still in development mode.
- Legal identity / grievance contact and refund wording pending founder decision.
- Marketplace is empty (no seeded supply).
- Grow Coin deploy pending.

Public posture until the payment path is proven: **invite-only beta, money handled manually**.

## 13. Where to look for more

- `AGENTS.md` — the working contract: decision rights, change protocol, definition of done.
- `CLAUDE.md` — dated engineering log with measured evidence per change.
- `docs/blueprint/INVENTORY.md` — generated list of every page, component, service,
  edge function, migration and test.
- `docs/blueprint/BACKEND.md` — backend/AI-gateway notes that a guard test reads.
- `docs/MVP-SCOPE-AND-E2E-TEST-PLAN.md` — MVP scope used by `npm run test:mvp-scope`.
- `README.md` — public-facing product page.
