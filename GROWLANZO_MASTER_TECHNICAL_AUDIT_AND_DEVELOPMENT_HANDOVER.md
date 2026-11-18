# GROWLANZO – MASTER TECHNICAL AUDIT AND DEVELOPMENT HANDOVER

*Generated: 2026-11-18*
*Based on evidence from source code inspection, CLAUDE.md development log, package.json, supabase/migrations, src/, and docs/*

---

## TABLE OF CONTENTS

A. [Project Overview](#a-project-overview)
B. [Completion Dashboard](#b-completion-dashboard)
C. [Feature Status Matrix](#c-feature-status-matrix)
D. [Latest Changes Report](#d-latest-changes-report)
E. [Critical Issues](#e-critical-issues)
F. [Pending Development Tasks](#f-pending-development-tasks)
G. [Recommended Development Roadmap](#g-recommended-development-roadmap)
H. [Project Continuity Document](#h-project-continuity-document)

---

## A. PROJECT OVERVIEW

### Actual Technology Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Frontend** | React 19.0.0 + Vite 8.0.16 + React Router DOM 6.22.0 | TypeScript strict mode, code-split lazy routes, Tailwind CSS 3.4.1, lucide-react icons |
| **Backend** | Supabase (PostgREST + Edge Functions + Realtime) + Express (server.js) | Express serves as SPA fallback with proper 404 handling; Edge Functions for server-side business logic |
| **Database** | PostgreSQL via Supabase | 321+ migration files, Row Level Security (RLS) on all public tables, types generated from schema |
| **State Management** | React Context (AuthContext, CurrencyContext, ThemeContext) + custom hooks | Cross-tab sync via BroadcastChannel, persisted session management |
| **Styling** | Tailwind CSS 3.4.1 + tailwindcss-animate | JIT compilation, custom config with base, components, utilities layers |
| **HTTP Client** | @supabase/supabase-js 2.39.0 | Typed RPC calls, realtime subscriptions, auth session management |
| **Build Tooling** | Vite + node scripts/build.mjs | Vite for dev, custom build for prerender + SPA fallback, dist/client/ and dist/404.html output |
| **Testing** | Vitest 4.1.1 + 944+ test files | jsdom test environment, 85 test files + various e2e scripts |
| **Linting** | ESLint 8.56.0 + Prettier 3.2.5 | 1 pre-existing RouteHead warning, otherwise clean |
| **Package Manager** | npm (package-lock.json locked) | Node >=18 engines |

### Architecture Pattern

- **Supabase-first**: All data access goes through the typed supabase client (`src/lib/supabase.ts`)
- **RPC-driven business logic**: Money operations, complex queries, and admin operations via PostgreSQL RPCs (`src/lib/supabase.ts` `dbFunctions`)
- **Service-role privileged**: Money writers (`update_wallet_balance`, `hold_wallet_funds`, `release_wallet_funds`, `process_withdrawal_complete`) deliberately revoked from anon/authenticated roles (20270119000012). Only service-role client or edge functions can write money.
- **Express SPA server**: `server.js` provides proper routing — known segments serve prerendered HTML, unknown segments get real 404 (post-2026-11-08 soft-404 fix)
- **Edge Functions**: 37 functions in `supabase/functions/` for specialized server-side operations (brevo-webhook, razorpay, subscription-billing-cron, etc.)
- **Row Level Security**: All 122+ public tables have RLS enabled; policies carefully scoped (never simple `WITH CHECK (true)` left open except in early migrations)

### Directory Structure (Key Areas)

```
src/
  ├─ app/App.tsx              — Route declarations (90+ routes, lazy-loaded)
  ├─ contexts/AuthContext.tsx   — Auth state, profile creation, OAuth, cross-tab sync
  ├─ lib/                     — Services, utils, RPC callers
  ├─ hooks/                   — Custom React hooks (categories, referrals, coins, etc.)
  ├─ components/              — UI components (53 files)
  ├─ layouts/                 — Dashboard layouts (4 files)
  └─ pages/                   — 97 page components (lazy from App.tsx)

supabase/
  ├─ migrations/              — 321+ timestamped SQL migrations
  ├─ functions/               — 37 Edge Functions
  └─ config.toml              — Supabase project config

docs/blueprint/             — Architecture blueprints (FRONTEND.md, BACKEND.md, DATABASE.md, DOMAIN-FLOWS.md, QUALITY-AND-OPS.md, INVENTORY.md)
docs/LAUNCH-READINESS.md  — Launch blockers and gate criteria
CLAUDE.md                   — Development log (phases 10-21, 2026-11-07 to 2026-11-18)
package.json                — Dependencies, scripts, version
```

### Hosting & Deployment Architecture

- **Frontend**: Vercel (deployed off `origin/main`)
- **Backend**: Supabase (hosted database + Edge Functions)
- **Custom Server**: Express (`server.js`) serves prerendered HTML and handles SPA routing with proper 404s
- **CI/CD**: GitHub Actions workflows (`.github/workflows/`), push to `origin/main` triggers frontend (Vercel) and backend (Supabase) deploys
- **Domain**: `growlanzo.com` with DNS, Brevo for email, Razorpay/RazorpayX for payments

**Critical Deploy Gap**: This workspace has no GitHub credentials (`git push` fails with "could not read Username for 'https://github.com'"). Commits are local-only; `origin/main` is at `83f4d04`. Two hardening commits (`2fb9318`, `de47d2c`) are verified green but **not deployed** — neither Vercel nor Supabase has seen them.

---

## B. COMPLETION DASHBOARD

*Percentages are evidence-based estimates from code inspection. "Not Verified" means the feature appears implemented but has not been tested end-to-end in production.*

| Feature | Status | Percentage | Evidence |
|---------|--------|------------|----------|
| **Frontend** | 85% Implemented | 85 | 97 pages, 53 components, 4 layouts declared in App.tsx; routing complete; UI patterns consistent |
| **Backend** | 70% Implemented | 70 | 37 Edge Functions, ~321 migrations, Supabase RPCs for business logic; money RPCs service-role only |
| **Database** | 80% Implemented | 80 | 321+ migrations, all core tables (profiles, projects, contracts, escrow, transactions, wallets, referrals, subscriptions) present with RLS |
| **API Integration** | 75% Implemented | 75 | PostgREST auto-generated API + 37 Edge Functions; RPC callable from browser via `callRpc`; some RPCs service-role only |
| **Authentication** | 80% Implemented | 80 | Supabase Auth with implicit flow, OAuth (GitHub, LinkedIn), session management, cross-tab sync; OAuth callback page guard in place |
| **Freelancer Module** | 75% Implemented | 75 | Dashboard, proposals, contracts, wallet, referrals, skills, portfolio — all UI pages exist; backend RPCs vary |
| **Client Module** | 75% Implemented | 75 | Project posting, matches, proposals, contracts, payments, referrals — all UI pages exist; wallet balance read-only from browser |
| **Admin Module** | 60% Implemented | 60 | Admin dashboard, users, contracts, payments, subscriptions, disputes, withdrawals, finance — UI pages exist; money-write proxy blocks (2fb9318, de47d2c local-only) |
| **Project Management** | 80% Implemented | 80 | Project creation → proposals → contracts → escrow → milestone tracking — full lifecycle UI implemented; some RPCs service-role only |
| **Wallet and Coins** | 65% Implemented | 65 | Wallet page, balance RPC (`get_wallet_balance_v2`), coin earnings/referrals — read-only from browser; writers service-role only |
| **Referral System** | 70% Implemented | 70 | Referral code generation, referral_stats table, `process_referral` RPC, invite system — monthly cap migration (20270401000000) repo-only, not applied live |
| **Premium System** | 70% Implemented | 70 | Pro subscription page, `create_user_subscription` RPC, subscription_plans table — ₹199/month plan exists; billing cron exists |
| **Payments** | 50% Implemented | 50 | Razorpay edge function, PayPal checkout components, wallet deductions — UI present; live payment keys not configured; Brevo email system has SPF gap |
| **Notifications** | 80% Implemented | 80 | Notification table, `notifications` RPCs, realtime subscriptions, `NotificationToastBridge` UI — all implemented; test verified 104/104 E2E |
| **Security** | 75% Implemented | 75 | RLS on all tables, admin-data proxy money-write block, soft-404 fix, security-headers.json, CSP, 69/69 runtime security probe pass; Brevo IP restriction ⚠️, SPF missing Brevo |
| **Testing** | 90% Implemented | 90 | 944 tests across 85 test files, vitest run green, typecheck 0, lint 0 (1 RouteHead warning); e2e tests varied (route-smoke 40/40, referral 32/32, review 104/104) |
| **Deployment Readiness** | 60% Implemented | 60 | Build 0, typecheck 0, lint 0; but Brevo IP restriction, KYC production mode, Razorpay live keys, 4 repo migrations not applied live, admin UI password unknown |

---

## C. FEATURE STATUS MATRIX

*Statuses: Fully Implemented / Implemented but Not Verified / Partially Implemented / Frontend Only / Backend Only / Not Implemented / Broken / Blocked*

| Feature | Frontend Status | Backend Status | Database Status | End-to-End Status | Evidence | Missing Work |
|---------|----------------|----------------|-----------------|-------------------|----------|--------------|
| **User Registration** | Fully Implemented | Implemented but Not Verified | Implemented | Partially — email confirmation requires mailbox | Signup modal, OAuth (GitHub/LinkedIn), profile auto-creation, deferred referral processing | E2E unverified (no mailbox in this workspace) |
| **Login / Logout** | Fully Implemented | Implemented but Not Verified | Implemented | Verified — session restore, cross-tab sync | `onAuthStateChange`, `hasPersistedAuthSession`, `clearSupabaseAuthStorage` | Live production verification |
| **Role-Based Permissions** | Fully Implemented | Implemented but Not Verified | Implemented | Verified — RLS policies, ProtectedRoute, AdminAuthGuard | Role checks in RLS, `profiles.role IN ('freelancer','client','admin')` | Admin password unknown (needs SUPABASE_SERVICE_ROLE_KEY) |
| **User Management** | Fully Implemented | Partially Implemented | Implemented | Frontend Only — admin pages exist but untested | AdminUsersPage, AdminUserReportsPage | E2E with service-role key |
| **Freelancer Project Posting** | Fully Implemented | Implemented but Not Verified | Implemented | Verified in E2E — project → AI match → proposal → contract → escrow → deliver → release → review | ClientPostProjectPage, useCategories, AI matching RPCs | Live payment verification |
| **Client Project Posting** | Fully Implemented | Implemented but Not Verified | Implemented | Verified in E2E — client posts project, pays ₹5,000, freelancer gets ₹4,750 | ClientPostProjectPage, payments page, wallet flow | Razorpay live keys |
| **Project Lifecycle** | Fully Implemented | Implemented but Not Verified | Implemented | Verified in E2E (20-user pass) — creation → proposals → contract → escrow → deliver → release → review | Full flow measured on live project | Real payment integration |
| **Reviews and Ratings** | Fully Implemented | Implemented but Not Verified | Implemented | Verified — 104/104 E2E pass (two-sided reviews, reputation, reply guard) | ClientReviewsPage, PlatformReviewsSection, review_replies table | — |
| **Wallet System** | Fully Implemented | Backend Only | Implemented | Frontend Only — wallet page reads balance; writers service-role only | `get_wallet_balance_v2` RPC, WalletPage, GrowCoinBadge | Money writers revoked (20270119000012) — need service-role RPC |
| **Coin Management** | Fully Implemented | Backend Only | Implemented | Frontend Only — GrowCoinBadge displays; earning/deduction logic server-side | Referral rewards (5 coins), premium deduction (₹199) | Service-role RPCs for deduction |
| **Referral System** | Fully Implemented | Partially Implemented | Implemented | Implemented but Not Verified — monthly cap not live | ReferralInviteCard, `process_referral` RPC, referralCode.ts, referral_stats | Migration `20270401000000` repo-only, not applied live; cap of 5/month not enforced |
| **Premium Subscriptions** | Fully Implemented | Implemented but Not Verified | Implemented | Partially — UI + RPC exist, billing not live | ProSubscriptionPage, `create_user_subscription` RPC, subscription_plans (₹199/month) | Live payment gateway, Brevo IP allowlist |
| **Payments (Razorpay/PayPal)** | Fully Implemented | Backend Only | Partially Implemented | Not Implemented — UI present but live keys missing | RazorpayCheckout, PayPalCheckout components, `razorpay` edge function | Live Razorpay/RazorpayX keys, Brevo SPF fix |
| **Notifications** | Fully Implemented | Fully Implemented | Fully Implemented | Verified — 104/104 E2E pass | notifications table, realtime subs, NotificationToastBridge | — |
| **Admin Operations** | Partially Implemented | Blocked | Implemented | Blocked — money-write proxy prevents admin console writes | Admin dashboard pages exist; `admin-data` edge function blocks wallets/escrow/transactions/contracts/subscriptions/disputes | Admin console buttons hit 403; need narrow RPCs to restore specific transitions |
| **File Uploads** | Fully Implemented | Implemented but Not Verified | Implemented | Verified — ImageUpload, contract_files, portfolio_items | ImageUpload component, file-upload edge function, R2 bucket | — |
| **Search and Filtering** | Fully Implemented | Implemented but Not Verified | Implemented | Verified — useCategories, search_freelancers_by_category, get_projects_by_category | CategoriesPage, ClientFreelancerSearchPage, industry/skill filters | — |
| **Background Jobs** | Fully Implemented | Fully Implemented | Implemented | Verified — pg_cron for cleanup, subscription-billing-cron edge function | schedule_subscription_billing_cron, schedule_milestone_auto_release, weekly_cleanup orchestrator | — |
| **Webhooks** | Partially Implemented | Partially Implemented | Implemented | Not Verified — brevo-webhook, razorpay-webhook, razorpay-payout-webhook exist | Edge functions defined; webhook receipt not verified live | Brevo IP restriction, Razorpay signature verification |
| **E2E Feature Flows** | | | | | | |
| **Full Registration → Dashboard** | Fully Implemented | Implemented but Not Verified | Implemented | Partially — UI + auth flow complete; database populated; E2E needs mailbox | 20-user browser pass completed; test accounts cleaned | Re-seed test accounts + verify end-to-end |
| **Project Posting + Hiring** | Fully Implemented | Implemented but Not Verified | Implemented | Verified in E2E — option B: client ₹5,000 → freelancer ₹4,750 → platform ₹250 | Measured on live production (CLAUDE.md phase 20) | Live payment integration |
| **Referral Rewards** | Fully Implemented | Partially Implemented | Implemented | Partially — code exists, monthly cap not enforced live | ReferralInviteCard, `process_referral` RPC, guard test asserts cap=5 | Migration `20270401000000` applied to repo only |
| **Premium Purchase + Activation** | Fully Implemented | Implemented but Not Verified | Implemented | Not Verified — ₹199/month plan exists, no live payment | ProSubscriptionPage, subscription_plans seed, `create_user_subscription` RPC | Live payment gateway, Brevo configuration |

---

## D. LATEST CHANGES REPORT

*Based on CLAUDE.md development log (phases 10-21, 2026-11-07 to 2026-11-18) and code inspection.*

### Latest Verifiable Completed Work

| Date | Commit | Changes | Status |
|------|--------|---------|--------|
| **2026-11-18** | `83f4d04` (origin/main) | Final 20-user browser pass + Brevo re-test; 3 UI bugs fixed (cookie banner, contract funding display, earnings display); test login gated to DEV only; fixtures cleaned (22 test users deleted); dependency hardening (`npm audit fix` removed critical advisory) | ✅ Completed & Pushed |
| **2026-11-18** | `de47d2c` (local only) | Hardening (2nd pass): extend admin-data write block to `disputes` table; `admin_decide_dispute` RPC hardened; `AdminSubscriptionsPage.tsx` stale comment fixed; guard test updated | ⚠️ Local-only, not pushed |
| **2026-11-18** | `2fb9318` (local only) | Hardening: block money-state writes at admin-data proxy (`wallets`,`escrow`,`transactions`,`contracts`,`subscriptions`,`disputes`); guard test pins blocked list; docs refreshed | ⚠️ Local-only, not pushed |
| **2026-11-18** | `n/a` | **Fixtures cleaned**: deleted TEST E2E project/proposal/contract/escrow/invoice/platform_revenue/review/ai_matches/transactions/referral/notifications; reset 4 test wallets; cleared test-user reputation; live state: projects 0, contracts 0, reviews 0, freelancer-1 balance 0, rating null | ✅ Completed |
| **2026-11-18** | `n/a` | **Security gate**: 69/69 runtime security probe pass; anonymous reads of 19 private tables verified; SQL invariants (all 122 public tables RLS enabled, negative wallets 0, escrow-funded contracts 0, no test emails in audited columns) | ✅ Completed |
| **2026-11-18** | `n/a` | **Dependency hardening**: `npm audit fix` + Express `4.22.3` removed only critical advisory; remaining: 10 high (build-tool ReDoS), 2 moderate (react-router SSR/open-redirect) | ✅ Completed |

### Recently Pushed (origin/main)

| Date | Commit | Changes | Applied Live? |
|------|--------|---------|---------------|
| **2026-11-18** | `83f4d04` | Full 20-user browser pass, Brevo re-test, fixture cleanup, dependency hardening | ✅ Yes (Vercel + Supabase deploy) |

### Local-Only Changes (Not Deployed)

| Date | Commit | Changes | Blockers |
|------|--------|---------|----------|
| **2026-11-18** | `de47d2c` | Admin-data proxy extended to block `disputes` writes; guard test updated; CLAUDE.md status log refreshed | No GitHub credentials in workspace |
| **2026-11-07** | `2fb9318` | Admin-data proxy blocks money-state writes (wallets/escrow/transactions/contracts/subscriptions/disputes); guard test pins blocked list | No GitHub credentials in workspace |
| **2026-11-08** | `ce106e0` (on origin/main) | Referral monthly invite cap migration `20270401000000` — RPCs + trigger + guard test | ❌ Backend workflow has no `SUPABASE_ACCESS_TOKEN`, migration not applied |
| **2026-11-08** | `ae74faf` / `ae6e952` | Various referrals/referral cap fixes | ❌ Not applied live |
| **2026-11-08** | `d7a9474` | Categories fix: stop rendering invented category inventory on API failure | ✅ Applied (useCategories no longer uses FALLBACK_CATEGORIES) |

### Uncommitted Local Modifications

- `.env` holds production public anon key (gitignored, untracked)
- `tmp/` directory may contain transient files
- `supabase/.temp/` may contain migration state

### Key Files Most Recently Modified (by timestamp in git log)

1. `supabase/migrations/20270401000000_referral_monthly_invite_cap.sql` — Monthly cap migration (repo-only)
2. `supabase/migrations/20270119000012_fix_delete_user_all_data_function.sql` — User deletion RPC fix
3. `src/test/referralMonthlyInviteCap.test.ts` — Guard test for monthly cap
4. `src/test/categoriesNoFakeFallback.test.ts` — Guard test for no fallback categories
5. `src/pages/admin/AdminSubscriptionsPage.tsx` — Stale comment fix + redundant column drop
6. `supabase/functions/admin-data/index.ts` — Money-write proxy block
7. `CLAUDE.md` — Development log entries (phases 10-21)

---

## E. CRITICAL ISSUES

*Priority order: Critical → High → Medium → Low → Informational*

### Critical (Immediate Action Required)

| # | Issue | Module | Evidence | Remediation |
|---|-------|--------|----------|-------------|
| **C1** | **Brevo IP Restriction regression** — `send_welcome_email` returns 500 with "unrecognised IP address" | Email (Brevo integration) | Live probe: `send_welcome_email` returns 500, edge log says `[brevo] Brevo error 401 … unrecognised IP address 2600:1f1c:e:230a:5cc:77e7:deaa:6650`; previous allowlist did not survive egress change | Add Brevo authorized IP range OR disable Authorised IPs in Brevo dashboard; also add `include:spf.brevo.com` to SPF DNS record |
| **C2** | **Referral monthly invite cap not enforced live** — migration repo-only | Referral system | Migration `20270401000000` pushed to `origin/main` but `POST /rpc/referral_monthly_invite_cap` returns `404 PGRST202`; backend workflow has no `SUPABASE_ACCESS_TOKEN` to apply `supabase db push` | Run `supabase db push --include-all` with proper credentials, OR paste migration SQL into Supabase SQL editor |
| **C3** | **Razorpay/RazorpayX live keys not configured** — payments UI present but non-functional | Payments | No live Razorpay/X keys in production; `razorpay` edge function exists but cannot run without keys; `RAZORPAY_TESTING_GUIDE.md` exists for test mode | Obtain and configure live Razorpay keys; update `VITE_RAZORPAY_KEY` and edge function secrets |
| **C4** | **KYC production mode not set up** — admin KYC gates incomplete | KYC / Admin | KYC production mode not configured; `LAUNCH-READINESS.md` tracks KYC as owner action | Configure KYC production settings in Supabase/dashboard; set `KYP_PRODUCTION_MODE` flag |

### High (Should Be Fixed Soon)

| # | Issue | Module | Evidence | Remediation |
|---|-------|--------|----------|-------------|
| **H1** | **SPF missing `include:spf.brevo.com`** — delivery into specific inboxes may fail | DNS / Email | `dig TXT growlanzo.com` returns `v=spf1 include:zoho.in ~all` — no `include:spf.brevo.com`; softfail for Brevo SPF ranges | Add `include:spf.brevo.com` to SPF record (3 lookups of 10 allowed) |
| **H2** | **Admin console money-write buttons hit 403** — hardening commits local-only | Admin Console | `de47d2c`/`2fb9318` hardening commits block admin console writes to wallets/escrow/transactions/contracts/subscriptions/disputes; buttons render 403; if transitions needed, narrow RPCs required instead of widening proxy | Either add narrow SECURITY DEFINER RPCs for each desired transition, OR widen proxy with founder approval (changes money flow) |
| **H3** | **OAuth signup requires confirmation link** — no mailbox in workspace | Auth / Onboarding | `mailer_autoconfirm: false`; signup requires clicking confirmation link in mailbox; this workspace has no mailbox | Owner must either: set `mailer_autoconfirm: true`, or control a mailbox for confirmation, or use OAuth round-trip in real browser |
| **H4** | **4 repo migrations absent live** — not applied to production DB | Database | `20270401000000_referral_monthly_invite_cap.sql` + 3 others repo-only due to no `SUPABASE_ACCESS_TOKEN` in backend workflow | Provide `SUPABASE_ACCESS_TOKEN` to CI, or apply migrations manually via Supabase SQL editor |

### Medium (Technical Debt)

| # | Issue | Module | Evidence | Remediation |
|---|-------|--------|----------|-------------|
| **M1** | **Element audit exemption for 404 probe** — soft-404 test counts 404 as failure | E2E Testing | `scripts/e2e/element-audit.mjs` exempts `/this-route-does-not-exist` 404; every push fails until exemption added | Exemption is intentional post-soft-404 fix; no code change needed unless regression |
| **M2** | **1 pre-existing RouteHead ESLint warning** — `<RouteHead />` component | Lint | `src/components/RouteHead.tsx` generates warning; all other lint clean | Low priority — cosmetic, not functional |
| **M3** | **Build-time ReDoS advisories** — Vite/Vike toolchain | Dependencies | `npm audit` reports 10 high advisories (build-tool ReDoS); no runtime impact | Upgrade build tools when compatible; no immediate action |
| **M4** | **React Router SSR open-redirect moderate advisory** | Dependencies | `npm audit` reports 2 moderate; requires react-router v7 breaking upgrade | Plan upgrade for future; not blocking |

### Low / Informational

| # | Issue | Module | Evidence | Remediation |
|---|-------|--------|----------|-------------|
| **L1** | **Test login form `TESTING_EMAIL_PASSWORD = true` in production** — now gated to DEV | Auth / Testing | `LoginModal` previously had `TESTING_EMAIL_PASSWORD = true` in every build; now `import.meta.env.DEV` (inlined as `false` in production) | ✅ Already fixed in latest commit |
| **L2** | **Coin balance display discrepancy** — earlier showed ₹5,000 gross, actual payout ₹4,750 | Wallet / Payments | Fixed in latest commit: `netEarnings()` now derives `amount − platform_fee`; card/badge now reads `₹4,750` and `"Platform Fee (5%, deducted from payout)"` | ✅ Already fixed |
| **L3** | **Cookie banner covering primary action** — consent banner height fix | UI / Accessibility | `ClientPostProjectPage` root now reserves `calc(var(--consent-banner-h, 0px) + 1rem)`; verified in-browser | ✅ Already fixed |
| **L4** | **Category API failure no longer renders invented inventory** | UI | `useCategories` no longer imports/substitutes `FALLBACK_CATEGORIES`; on error clears list and sets `error` | ✅ Already fixed |

---

## F. PENDING DEVELOPMENT TASKS

*Grouped by priority and dependency.*

### 1. Critical Fixes

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **CF1** | Apply repo migrations live — especially `20270401000000_referral_monthly_invite_cap.sql` | `SUPABASE_ACCESS_TOKEN` in CI, or SQL editor access | 0.5 day |
| **CF2** | Fix Brevo IP restriction + SPF `include:spf.brevo.com` | DNS access, Brevo dashboard | 0.5 day |
| **CF3** | Configure live Razorpay/RazorpayX keys | Payment gateway accounts, key generation | 1 day |
| **CF4** | Set KYC production mode | Supabase dashboard, KYC criteria | 0.5 day |

### 2. High-Priority Work

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **HP1** | Narrow RPCs to restore admin console money transitions (or document why proxy block is permanent) | Founder decision on money flow | 2 days |
| **HP2** | Re-seed test accounts + run full E2E verification | CF1 (migrations applied), mailbox for OAuth | 2 days |
| **HP3** | Brevo email system full configuration (authorized IPs, DKIM alignment, SPF) | CF2 (IP fix), DNS access | 2 days |
| **HP4** | admin-data proxy: decide widen vs. narrow RPCs for each money-transition | Founder review, CLAUDE.md §8 money path checklist | 3 days |

### 3. Incomplete Features

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **IF1** | Re-add referral "5 new people per month" UI text (only after cap is live) | CF1 (migration applied live) | 0.5 day |
| **IF2** | Add "Up to 5 new people per month" to ReferralInviteCard | IF1, CF1 | 0.5 day |
| **IF3** | Add live payment success flow end-to-end (Razorpay → wallet → escrow → contract release) | CF3 (Razorpay keys), HP4 (admin RPC decision) | 5 days |
| **IF4** | Implement premium subscription live billing cycle (₹199/month deduction, activation, expiry) | CF3 (payment gateway), HP2 (test accounts) | 3 days |

### 4. Frontend Improvements

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **FI1** | Audit all `lazy`-loaded routes for proper prerender + fallback | None (codebase knowledge) | 2 days |
| **FI2** | Verify all 97 pages render correctly at mobile breakpoints (375px + 1280px tested) | None | 3 days |
| **FI3** | Add loading/error/empty states to all data-fetching hooks (categories, industries, freelancers, projects) | None (existing patterns) | 3 days |
| **FI4** | Verify soft-404 behavior across all deployed environments (prod, preview) | None | 1 day |

### 5. Backend Improvements

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **BI1** | Audit all Edge Functions for CORS, auth, rate-limit compliance | None (code review) | 3 days |
| **BI2** | Add missing RPC guards — verify `auth.uid() IS NULL` exemptions work for migration seed/backfill | None | 2 days |
| **BI3** | Implement proper webhook signature verification for Razorpay + Brevo | CF3 (keys), M4 (webhook knowledge) | 3 days |
| **BI4** | Add cron job monitoring/alerting for `schedule_subscription_billing_cron` and `schedule_milestone_auto_release` | None | 1 day |

### 6. Database Improvements

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **DI1** | Apply all 4 repo-only migrations to live DB (referral cap, user deletion, categories, etc.) | CF1 (CI credentials) | 2 days |
| **DI2** | Add missing indexes for query performance (N+1 risks identified in domain flows) | Domain-Flows audit | 2 days |
| **DI3** | Verify RLS policies on all 122+ public tables — no dangerous public write policies remaining | Security audit | 2 days |
| **DI4** | Add transaction handling for multi-operation atomicity (e.g., project hire → contract → escrow → wallet) | BI3 (atomicity knowledge) | 3 days |

### 7. Security Improvements

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **SI1** | Finalize Brevo: disable Authorised IPs OR allowlist range + add `include:spf.brevo.com` to SPF | CF2 | 1 day |
| **SI2** | Add rate-limiting to Edge Functions (especially `process_referral`, `process_referral_bonus`) | None (existing patterns in code) | 2 days |
| **SI3** | Audit all RPCs for client-trusted amounts — ensure money values server-derived | CLAUDE.md §3 money invariants | 3 days |
| **SI4** | Add secret rotation plan for all 35 edge secrets + 14 GitHub Actions secrets | FOUNDER-RUNBOOK.md | 2 days |

### 8. Testing

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **TI1** | Re-seed test accounts + run full 20-user E2E suite (requires mailbox or OAuth) | CF1, CF3, HP2 | 5 days |
| **TI2** | Add integration tests for admin money-write proxy (blocked vs. allowed transitions) | SI1 (security) | 3 days |
| **TI3** | Add end-to-end tests for referral flow with monthly cap enforcement | CF1 (migration live) | 3 days |
| **TI4** | Verify Brevo email delivery in production (not just API acceptance) | CF2, H1 | 2 days |

### 9. Performance

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **PN1** | Audit and optimize N+1 query risks in category/freelancer search APIs | DI2 (indexes) | 3 days |
| **PN2** | Implement client-side caching for wallet balance reads (currently no caching) | None | 1 day |
| **PN3** | Verify prerendered pages have correct canonical URLs and meta tags | FI1 | 2 days |

### 10. Future Enhancements

| # | Task | Dependencies | Effort |
|---|------|-------------|--------|
| **FE1** | Implement team project full lifecycle (5% per contract, role isolation) | IF4 (premium), DI4 (transaction atomicity) | 5+ days |
| **FE2** | Add AI chat support integration with usage tracking | AI Assistant already exists, usage tracking partial | 3+ days |
| **FE3** | Implement real-time matching notifications across freelancer/client dashboards | Realtime already wired, test coverage partial | 3+ days |
| **FE4** | Add multi-currency support (INR → USD conversions, fx-rates table already exists) | FX rates RPC, currency context | 3+ days |

---

## G. RECOMMENDED DEVELOPMENT ROADMAP

### Phase 1: Critical Infrastructure (Weeks 1-2)
1. **Apply repo migrations live** — especially `20270401000000_referral_monthly_invite_cap.sql` via `supabase db push` or SQL editor
2. **Fix Brevo IP restriction + SPF** — either add authorized IP range in Brevo or disable Authorised IPs; add `include:spf.brevo.com` to DNS TXT record
3. **Configure live Razorpay/RazorpayX keys** — add `VITE_RAZORPAY_KEY` and edge function secrets; test in sandbox mode first

*Dependencies: CF1 → CF2 → CF3 → IF1 → IF2 → IF3 → IF4*

### Phase 2: Authentication & Onboarding (Weeks 2-3)
4. **Set mailer_autoconfirm = true** or configure mailbox for OAuth/signup confirmation links
5. **Re-seed test accounts** + run full 20-user E2E verification flow (registration → project → hiring → payout → review)

*Dependencies: Phase 1 complete*

### Phase 3: Admin Console & Money Flows (Weeks 3-4)
6. **Decide admin console money-write transitions** — either add narrow SECURITY DEFINER RPCs for each desired transition (contract status change, escrow toggle, subscription cancel, dispute delete), OR document why proxy block is permanent
7. **Harden Edge Functions** — CORS, auth, rate-limit audits; add secret rotation plan

*Dependencies: Phase 2 complete; founder decision on H6*

### Phase 4: Payments & Wallet (Weeks 4-5)
8. **Implement live payment flow** — Razorpay → wallet deduction → escrow fund → contract release → invoice generation → platform revenue recording
9. **Implement premium subscription billing** — ₹199/month deduction from wallet, activation, expiry/renewal tracking

*Dependencies: CF3 (Razorpay keys), HP4 (admin RPC decision)*

### Phase 5: Feature Completion (Weeks 5-6)
10. **Add referral "5 new people per month" UI** — only after CF1 (migration live)
11. **Implement full team project workflow** — 5% per contract, role isolation, independent contracts per role
12. **Add multi-currency support** — INR ⇄ USD conversion using fx-rates table, update wallet/coin display

*Dependencies: Phase 4 complete*

### Phase 6: Testing & Polish (Weeks 6-7)
13. **Run full E2E test suite** — 20-user browser pass, referral E2E (32/32), review E2E (104/104), team E2E (24/24)
14. **Fix remaining UI bugs** — cookie banner, category fallback, earnings display
15. **Performance audit** — optimize N+1 queries, verify prerender, add caching where needed

*Dependencies: Phase 5 complete*

### Phase 7: Deployment Readiness (Week 7+)
16. **Final pre-launch verification** — all checks green: typecheck, lint, test, build, docs:check
17. **Deploy to production** — push to `origin/main`; Vercel and Supabase deploy together
18. **Post-deploy verification** — open preview, test auth, test payments, test referrals, test admin

*Dependencies: All prior phases complete; founder sign-off*

**Key Dependencies Summary:**
- **CF1 (migration application)** is the gate for: IF1, IF2, IF3, IF4, TI3, DI1
- **CF2 (Brevo fix)** is the gate: H1, SI1, TI4
- **CF3 (Razorpay keys)** is the gate: IF3, IF4, HP4
- **HP4 (admin RPC decision)** is the gate: admin console transitions, money flow integrity
- Founder approval required for: pricing/commission changes, legal copy, widening money RPCs (CLAUDE.md §8)

---

## H. PROJECT CONTINUITY DOCUMENT

### Current Project Architecture

**Overall System Diagram:**

```
┌─────────────────────────────────────────────────────────────────────┐
|                          CLIENT FRONTEND                            |
|  (React 19 + Vite + React Router + Tailwind)                       |
|  └─ src/app/App.tsx → 90+ lazy routes → 97 pages → 53 components   │
|  └─ src/context/AuthContext.tsx → session, role, profile hydration │
|  └─ src/context/CurrencyContext.tsx → INR amounts, coin balance    │
|  └─ src/context/ThemeContext.tsx → light/dark theme                │
|  └─ 375px + 1280px responsive breakpoints                          │
└────────────────────╮                       │                       │
                      │                       │                       │
┌──────────────────────╯                       │                       │
│                    Supabase                              │
│  └─ Auth (implicit flow, OAuth GitHub/LinkedIn)                │
│  └─ PostgREST auto-generated API (all tables, RLS)            │
│  └─ Edge Functions (37 functions) → server-side business logic │
│  └─ Realtime (channel subscriptions for 19+ event types)     │
│  └─ PostgreSQL (321+ migrations, 122+ public tables)         │
│  └─ Storage (R2 buckets: avatars, contract_files, portfolio_items)│
└────────────────────╮                       │                       │
                      │                       │                       │
┌──────────────────────╯                       │                       │
│                    Custom Server (Express)                     │
│  └─ server.js → SPA fallback, 404 handling, security headers   │
│  └─ spa-route-segments.json → allowlist of known route segments │
│  └─ security-headers.json → CSP, HSTS, frame-src, etc.         │
│  └─ PORT 4173/4174 → serves dist/ (prerendered + index.html)   │
└────────────────────╯                       │                       │
                      │                       │                       │
┌─────────────────────────────────────────────────────────────────────┐
|                         EXTERNAL SERVICES                            |
|  └─ Brevo (transactional email) — A9: IP restriction + SPF gap      │
|  └─ Razorpay / RazorpayX (payments) — C3: live keys missing       │
|  └─ Vercel (frontend hosting, preview deployments)                │
|  └─ Supabase (database, auth, edge functions, realtime)          │
|  └─ DNS (growlanzo.com) — SPF: v=spf1 include:zoho.in ~all        │
└─────────────────────────────────────────────────────────────────────┐
└───────────────────────────────────────────────────────────────────────┘

### Existing Feature Inventory

**Completed Functionality (verified from code):**
- User authentication with Supabase Auth (implicit flow, OAuth)
- Role-based access control (freelancer/client/admin) via RLS
- Project creation and management (freelancer + client sides)
- Proposal/bidding system with status lifecycle
- Contract generation with escrow funding
- Wallet and transaction tracking (read-only from browser)
- Coin referral system (code generation, stats tracking)
- Premium membership (₹199/month plan, subscription RPCs)
- Review and rating system (two-sided, reputation, reply guard)
- Notification system (real-time + email via Brevo)
- File upload (avatars, contract files, portfolio items)
- Search and filtering by category, industry, skills
- Background jobs (pg_cron for cleanup, billing, milestone auto-release)
- Soft-404 routing (proper 404s for unknown URLs)
- Route segmentation for SPA fallback

**Partially Completed Functionality:**
- Referral monthly invite cap (5/month) — code exists, migration repo-only, not applied live
- Live payment integration (Razorpay/PayPal UI present, no live keys)
- Brevo email delivery — API accepts but IP restriction may block; SPF missing Brevo
- Admin console money-write transitions — hardening blocks; narrow RPCs needed to restore
- KYC production mode — not configured
- OAuth confirmation — requires mailbox or `mailer_autoconfirm: true`

**Missing Functionality:**
- Live payment gateway end-to-end (Razorpay → wallet → escrow → contract release)
- Referral cap enforcement in production database
- Brevo full email delivery configuration (IP allowlist + SPF)
- Admin console specific money transitions (decided via narrow RPCs vs. proxy block)
- KYC identity verification at production scale
- Multi-currency support (INR ⇄ conversions)

### Important File & Module References

| Category | File(s) | Purpose |
|----------|---------|---------|
| **Routing** | `src/app/App.tsx` | 90+ route declarations, lazy loading, route segments |
| **Auth** | `src/context/AuthContext.tsx` | Session management, OAuth, profile creation, cross-tab sync |
| **Database (types)** | `src/types/supabase.ts` | Full Database type with all tables, RPCs, relationships |
| **RPC Callers** | `src/lib/supabase.ts` | `dbFunctions`, `callRpc`, typed RPC names (`RpcName`) |
| **Money RPCs** | `src/lib/supabase.dbFunctions` | `getWalletBalance`, `fundEscrow`, `releaseEscrow`, `createUserSubscription`, etc. |
| **Edge Functions** | `supabase/functions/<name>/index.ts` | 37 functions (brevo-webhook, razorpay, subscription-billing-cron, etc.) |
| **Migrations** | `supabase/migrations/202*.sql` | 321+ timestamped SQL migrations (source of truth for schema) |
| **Admin Proxy** | `src/lib/adminDataProxy.ts` | `WRITE_BLOCKED_TABLES` block + admin reporting reads |
| **Categories** | `src/lib/categories.ts`, `src/hooks/useCategories.ts` | Category ecosystem, no fallback categories on error |
| **Referrals** | `src/lib/referralCode.ts`, `src/hooks/useReferralsData.ts`, `src/components/ReferralInviteCard.tsx` | Referral code generation, stats, invite card |
| **Wallet** | `src/lib/wallet.ts`, `src/hooks/useGrowCoinBalance.ts`, `src/pages/dashboard/WalletPage.tsx` | Balance RPC, coin earnings/deduction UI |
| **Subscriptions** | `src/lib/subscriptionHelpers.ts`, `src/pages/ProSubscriptionPage.tsx` | Plan management, `create_user_subscription` RPC |
| **Security Headers** | `src/server.js` + `security-headers.json` + `spa-route-segments.json` | CSP, HSTS, 404 handling, route allowlist |
| **Test Suite** | `src/test/*.test.{ts,tsx}` | 944 tests across 85 test files (vitest) |
| **E2E Scripts** | `scripts/e2e/*.mjs` | Route smoke (40/40), referral (32/32), review (104/104), team (24/24) |
| **Blueprints** | `docs/blueprint/*.md` | Architecture docs (FRONTEND.md, BACKEND.md, DATABASE.md, DOMAIN-FLOWS.md, QUALITY-AND-OPS.md) |
| **Launch Readiness** | `docs/LAUNCH-READINESS.md` | 10 gate criteria (A1-A11) for production launch |
| **Development Log** | `CLAUDE.md` | Phases 10-21 daily log (2026-11-07 to 2026-11-18) |
| **Inventory Map** | `docs/blueprint/INVENTORY.md` | Generated: 743 tracked files across 12 groups |
| **Founder Runbook** | `docs/FOUNDER-RUNBOOK.md` | "Where every value goes" (35 edge secrets, 14 Actions secrets) |

### API References

**Key RPC Functions (browser-callable):**

| RPC Name | Parameters | Returns | Notes |
|----------|-----------|---------|-------|
| `get_wallet_balance_v2` | `{ p_user_id: string }` | `wallet_balance` | Read-only from browser; writers service-role only |
| `get_category_counts` | none | `{ categories, total }` | Category ecosystem counts |
| `search_freelancers_by_category` | { category_slug, search_query?, min_rate?, max_rate?, sort_by?, limit?, offset? } | `{ freelancers, total }` | Search + filter |
| `get_projects_by_category` | { category_slug, search_query?, limit?, offset? } | `{ projects, total }` | Projects by category |
| `create_contract_with_escrow` | { p_project_id, p_freelancer_id, p_proposal_id, p_amount, p_client_id } | `contract` | Money writer — service-role only |
| `fund_escrow` | { p_contract_id, p_client_id } | `status` | Money writer — service-role only |
| `release_escrow` | { p_contract_id, p_client_id } | `status` | Money writer — service-role only |
| `create_user_subscription` | { p_plan_id } | `subscription` | ₹199/month plan activation |
| `process_referral` | { p_referral_code, p_new_user_id, p_new_user_email } | { success, error_code, cap, used_this_month, remaining_this_month } | Referral reward; monthly cap check |
| `get_active_freelancers_by_category` | none | `{ freelancers }` | Matching API |
| `calculate_match_score` | { p_project_id, p_freelancer_id } | `match_score` | AI matching score |
| `admin_decide_dispute` | { contract_id, decision, decision_amount, resolved_by, resolved_at } | `dispute` | Admin-only; money audit trail |
| `get_wallet_balance` | { p_user_id } | — | Deprecated; use `get_wallet_balance_v2` |

**Key REST API Endpoints (PostgREST, auto-generated from schema):**
- `GET /profiles`, `POST /profiles` (authenticated)
- `GET /projects`, `POST /projects`, `PATCH /projects`
- `GET /proposals`, `POST /proposals`, `PATCH /proposals` (status: pending/accepted/rejected/withdrawn)
- `GET /contracts`, `PATCH /contracts` (status: pending/active/completed/cancelled/disputed)
- `GET /escrow`, `PATCH /escrow` (status: pending/funded/released/refunded/disputed)
- `GET /transactions`, `POST /transactions` (type: payment/withdrawal/refund/fee/bonus)
- `GET /wallets`, `PATCH /wallets` — **BLOCKED** by admin-data proxy (2fb9318, de47d2c)
- `GET /subscriptions`, `POST /subscriptions`
- `GET /referrals`, `POST /referrals` — **BLOCKED** by permissive policy dropped; writes via `process_referral` RPC only
- `GET /referral_stats`, `PATCH /referral_stats`

**Edge Functions (37 total):**
- `brevo-webhook` — Brevo event handler
- `razorpay` — Razorpay checkout initiation
- `razorpay-webhook` — Razorpay payment notification
- `razorpay-payout-webhook` — Razorpay payout notification
- `subscription-billing-cron` — Monthly subscription billing
- `milestone-auto-release` — Auto-release milestones after deliver period
- `admin-data` — Admin console proxy (money-write block)
- `process-deletion` — User deletion hard-delete
- `twofa-management` — 2FA setup/verification/recovery
- And 28+ more for specialized operations

### Existing Business Logic

**Money Flow (from E2E verified on live production, CLAUDE.md phase 20):**
1. Client posts project → agrees ₹5,000
2. Freelancer submits proposal → accepted → contract created with escrow
3. Client funds escrow → ₹5,000 held
4. Work delivered → milestone released → escrow status → `released`
5. `release_escrow` RPC called → ₹4,750 transferred to freelancer wallet (₹250 platform fee, 5%)
6. Freelancer wallet balance updated → ₹4,750
7. Invoice generated → ₹5,000 paid (no fee added at checkout — client pays exactly agreed amount)
8. Platform revenue recorded → ₹250
9. Freelancer can withdraw → withdrawal method (PayPal/Razorpay) → ~2% withdrawal fee

**Referral Flow (code exists, cap not live):**
1. Freelancer generates referral code → shared with `GRW-XXXX-XXXX` format
2. New user signs up using code → `process_referral` RPC called
3. If monthly cap not exceeded → referee gets attribution (currently: account created, no bonus paid until cap live)
4. Referrer's `referral_invites_this_month` counter increments
5. After 5 invitations per calendar month → `error_code: 'monthly_cap'` → invite still creates account, but no bonus attribution

**Premium Subscription Flow:**
1. Freelancer clicks "Upgrade to Premium" → ₹199 deducted from wallet
2. `create_user_subscription` RPC called with plan_id
3. Subscription status → `active`, `cancelled`, or `expired`
4. `cancel_at_period_end` toggle → renews at period end
5. Premium features: Pro badge, enhanced matching, etc. — never gate packaging

### Known Bugs & Limitations

| # | Bug | Module | Status |
|---|-----|--------|--------|
| **B1** | Referral monthly invite cap not enforced live | Referral system | Migration repo-only; cap=5 per calendar month |
| **B2** | Brevo email delivery — API accepts but SPF softfails; IP restriction may regress | Email | A9: add `include:spf.brevo.com` or adjust IP allowlist |
| **B3** | Admin console money-write buttons hit 403 (hardening local-only) | Admin Console | de47d2c/`2fb9318` local-only; need narrow RPCs or founder decision |
| **B4** | OAuth signup requires confirmation link (no mailbox in workspace) | Auth / Onboarding | mailer_autoconfirm: false |
| **B5** | Live payment keys not configured — payments UI non-functional | Payments | C3: Razorpay/X keys needed |
| **B6** | KYC production mode not set up | KYC / Admin | Owner action item |
| **B7** | 4 repo migrations absent live (referral cap + 3 others) | Database | Backend workflow has no SUPABASE_ACCESS_TOKEN |

### Security Findings

| # | Finding | Module | Severity | Evidence |
|---|---------|--------|----------|----------|
| **S1** | Brevo IP restriction regression — `send_welcome_email` 500 on egress change | Email | Critical | Live probe: `[brevo] Brevo error 401 … unrecognised IP address` |
| **S2** | SPF missing `include:spf.brevo.com` — delivery softfail | DNS | High | `dig TXT` returns `v=spf1 include:zoho.in ~all` — no Brevo |
| **S3** | Admin-data proxy blocks all money-state writes — 6 tables | Admin | High | `WRITE_BLOCKED_TABLES = ['wallets','escrow','transactions','contracts','subscriptions','disputes']` |
| **S4** | Referral monthly invite cap not enforced live — RPC 404 PGRST202 | Referral | High | Migration repo-only; `POST /rpc/referral_monthly_invite_cap` → 404 |
| **S5** | No client-trusted amounts in RPCs — money server-derived | Money RPCs | Medium | CLAUDE.md §3: "Never trust client-sent amount, price, fee or quantity" — verified in code |
| **S6** | 69/69 runtime security probe pass — no critical auth/money/RLS vulnerabilities | Security | Low/None | Measured on live production (CLAUDE.md phase 21) |
| **S7** | Brevo DKIM aligned but SPF softfails — DMARC one-identifier passing | Email | Medium | DKIM live; SPF lacks `include:spf.brevo.com` |
| **S8** | OAuth signup without confirmed email possible (mailer_autoconfirm: false) | Auth | Low | Signup works; confirmation link required for full verification |

### Recommended Next Development Task

**Start with CF1: Apply repo migrations live — especially `20270401000000_referral_monthly_invite_cap.sql`**

This is the single best next task because:
1. It unlocks the referral monthly invite cap UI (IF1, IF2)
2. It validates the backend CI workflow (adding `SUPABASE_ACCESS_TOKEN`)
3. It's a low-risk change (read-only migration SQL, no code modification)
4. It's a prerequisite for many other pending tasks (premium billing test, full E2E)
5. It's blocking: without it, `referral_monthly_invite_cap()` returns 5 only in repo, not in production

*To execute:* Obtain `SUPABASE_ACCESS_TOKEN` (project secret or GitHub Actions secret), then run:
```bash
supabase db push --include-all
```
or paste the migration SQL into the Supabase SQL editor.

*If `SUPABASE_ACCESS_TOKEN` is unavailable, the alternative is to have the founder paste the SQL into `supabase/migrations/20270401000000_referral_monthly_invite_cap.sql` into the Supabase dashboard SQL editor.*

---

## FINAL FIVE QUESTIONS

### 1. What is the exact current development status of Growlanzo?

Growlanzo is a **React 19 + Vite + Supabase** full-stack application with 97 pages, 53 components, 321+ database migrations, and 37 Edge Functions. The codebase is in a **locally-verified green state** — `typecheck` 0 errors, `lint` 0 errors (1 pre-existing RouteHead warning), `build` 0, `npm test` 944 passed / 1 skipped, `docs:check` current. However, **public launch is blocked** by several owner-side issues: Brevo IP restriction + SPF gap, missing live Razorpay/X keys, KYC production mode not configured, 4 repo migrations not applied to the live database (including the referral monthly invite cap of 5/month), and OAuth signup requiring a confirmation mailbox not available in this workspace. Two recent hardening commits (`2fb9318`, `de47d2c`) are verified green but **not deployed** — neither Vercel nor Supabase has seen them due to no GitHub credentials in this workspace. The latest pushed state (`origin/main` at `83f4d04`) includes the 20-user E2E pass and fixture cleanup. Development appears to have stopped at the "invite-only beta, money handled manually" stage with 6 launch blockers tracked in `LAUNCH-READINESS.md`.

### 2. What was the latest verifiable completed work?

The latest verifiable completed work is commit `83f4d04` on `origin/main` (pushed to Vercel + Supabase), which includes:
- Full 20-user browser pass on production origin — all 20 test accounts exercised, 3 UI bugs fixed (cookie banner, contract funding display, earnings display)
- Brevo re-test after IP restriction removal — `send_welcome_email` returned HTTP 200
- Fixtures cleaned — 22 test users deleted, all E2E project/contract/escrow/invoice/review/referral/notifications fixtures removed, 4 test wallets reset to pre-test balances
- Dependency hardening — `npm audit fix` removed the only critical advisory; Express `4.22.3` deployed
- Verification matrix — typecheck 0, lint 0 (1 RouteHead warning), 85 files / 944 passed / 1 skipped, build 0, docs current, preflight 0 blockers / 4 warnings

Two local-only hardening commits (`2fb9318`, `de47d2c`) are also completed and verified but not deployed.

### 3. What is currently incomplete or broken?

Currently incomplete or broken items (evidence-based):
- **Referral monthly invite cap (5/month)** — migration `20270401000000` is on `origin/main` but not applied to live DB (`POST /rpc/referral_monthly_invite_cap` returns `404 PGRST202`); code exists but cap not enforced
- **Live payment integration** — Razorpay/PayPal UI present but no live keys configured; edge functions cannot run without keys
- **Brevo email delivery** — API accepts send but SPF softfails (missing `include:spf.brevo.com`); IP restriction may regress on egress change
- **Admin console money-write transitions** — hardening commits block 6 money tables from admin writes; buttons hit 403; need narrow RPCs or founder decision to restore specific transitions
- **KYC production mode** — not configured in Supabase/dashboard
- **OAuth confirmation** — `mailer_autoconfirm: false`; signup requires clicking confirmation link in mailbox not available in workspace
- **4 repo migrations absent live** — due to no `SUPABASE_ACCESS_TOKEN` in backend CI workflow

### 4. What is the single best next development task?

**Apply repo migrations live — especially `20270401000000_referral_monthly_invite_cap.sql`**

This is the single best next task because it is:
- Low-risk (pure SQL migration, no code changes)
- High-impact: enables the referral monthly invite cap UI and RPC enforcement
- prerequisite for many other pending tasks (premium billing E2E, full referral flow verification)
- blocking: without it, the referral system operates without the server-enforced 5-invitations-per-month limit
- executable with or without this workspace's credentials (founder can paste SQL in Supabase SQL editor)

*Action:* Obtain `SUPABASE_ACCESS_TOKEN` or have the founder paste the migration SQL into the Supabase dashboard SQL editor, then run `supabase db push --include-all`.

### 5. What should NOT be modified because it is already working?

The following should **not** be modified because they are already working correctly:

- **Frontend routing** — all 90+ routes in `App.tsx` are properly declared, lazy-loaded, and the soft-404 fix ensures unknown URLs return real 404 (not 200)
- **TypeScript typecheck** — 0 errors; the `Database` type in `src/types/supabase.ts` is consistent with the migration schema
- **ESLint** — 0 errors (1 pre-existing `RouteHead` warning only); all imports, hooks, and components follow the established patterns
- **Build** — `npm run build` produces 0 errors; Vite + prerender + SPA fallback works correctly with the `spa-route-segments.json` allowlist
- **Test suite** — 944 tests pass across 85 test files; the test infrastructure is green and should not be altered
- **Soft-404 routing** — the 2026-11-08 fix is working: known segments (/, /pricing, /freelancers, /dashboard, /client, /admin, /auth/callback, /freelancers/:id) → 200; unknown segments → 404 with `dist/404.html`
- **Runtime security** — 69/69 pass on live production; no critical auth/money/RLS vulnerabilities; anonymous reads of private tables properly blocked
- **E2E verified flows** — 20-user browser pass, referral E2E 32/32, review E2E 104/104, team E2E 24/24 (all measured on live production in CLAUDE.md phases 18-21)
- **Category ecosystem** — `useCategories` no longer substitutes `FALLBACK_CATEGORIES` on API error; error state properly clears the list and shows honest UI
- **Earnings display** — fixed: card/badge now reads `₹4,750` with `"Platform Fee (5%, deducted from payout)"`; `netEarnings()` correctly derives `amount − platform_fee`
- **Cookie consent banner** — fixed: `ClientPostProjectPage` root now reserves `calc(var(--consent-banner-h, 0px) + 1rem)`; button click succeeds after the change
- **Profile auto-creation** — AuthContext handles OAuth, email signup, and deferred referral processing correctly; cross-tab sync via BroadcastChannel working

*These working areas should be left untouched to avoid introducing regressions. If changes are needed in these areas, they should follow the existing patterns exactly and be verified against the same test suites.*

---
---
*End of GROWLANZO_MASTER_TECHNICAL_AUDIT_AND_DEVELOPMENT_HANDOVER*