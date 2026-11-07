# Growlanzo — Domain Flows (product map)

**Last verified: 2026-10-20.** **Scope:** every product journey that moves a user, a contract or money — page → action → client service → RPC / edge function → table, with the states, fees and failure modes the code actually has. **Documentation only:** this file describes the tree; it changes nothing. **Launch blockers are tracked in [`../LAUNCH-READINESS.md`](../LAUNCH-READINESS.md), not here.** Read it with `CLAUDE.md` §Business Model (the FINAL rules) and [`INVENTORY.md`](INVENTORY.md) (generated file list). Where this document and the code disagree, the code wins and this file is the bug.

**Routing note:** runtime routing is the string literals in `src/app/App.tsx`; `src/routes.ts` is a partial mirror with dead constants, **not** the source of truth. A public page also needs an entry in `pages/prerenderUrls.ts` or it 404s on a hard load (AGENTS.md §5).

**Status tags:** **LIVE** = executed against production, recorded in LAUNCH-READINESS §C · **BUILT** = traced end to end, no live evidence · **BLOCKED** = depends on an owner action in §A · **PARTIAL** = UI/schema exists, behaviour incomplete or one rail disabled · **UNVERIFIED** = not traceable to code/migrations.

## 1. Actors, roles and gates

| Actor | Account | Can do | Role enforced at |
|---|---|---|---|
| **Anonymous** | no session | Browse `/`, `/freelancers`, `/services(/:id)`, `/freelancer/:id`, `/contests`, `/certificate`, legal pages; submit a report; join a country waitlist | Postgres RLS for `anon` (column grants only); `ProtectedRoute` never renders |
| **Freelancer** | `profiles.role='freelancer'` + `profiles_private` + wallet | Feed, proposals, contracts, workspace, wallet/withdrawals, services/packages, KYC, skill tests, Premium, AI, referrals | `ProtectedRoute allowedRoles={['freelancer']}` on `/dashboard/*`; every money RPC re-checks `auth.uid()` |
| **Client** | `profiles.role='client'` | Post single/team projects, AI matches, invites, proposals, contracts, escrow funding, disputes, reviews, contests, free client AI | `ProtectedRoute allowedRoles={['client']}` on `/client/*`; RPC ownership checks |
| **Admin** | `profiles_private.is_admin=true` (effective role becomes `admin` in `fetchUserProfile`) | Admin console via the `admin-data` proxy, KYC mode, disputes, certificates, support, finance/withdrawal views | `AdminAuthGuard` **and** `verifyAdminSession()` inside `admin-data` reading `profiles_private.is_admin`; admin RPCs re-check |

**Role at signup.** Public sign-in is **OAuth-only**: `SignupModal`/`LoginModal` call `AuthContext.signInWithOAuth(provider, role)` → `supabase.auth.signInWithOAuth` for `github` or `linkedin_oidc` with `redirectTo = origin + '/auth/callback'`. The role is saved in `localStorage['growlancer_oauth_role']` and `user_metadata.role` before leaving; after the round-trip `resolveOAuthRole()` resolves `localStorage → user_metadata.role → roleHint → 'freelancer'` (`src/context/AuthContext.tsx`). `/login` and `/signup` redirect to `/?modal=login|signup`;
the only password surface left is `/admin` (`AdminLoginPage`), plus the re-auth dialog and the email-verification page.

**Profile creation.** `AFTER INSERT ON auth.users` → `handle_new_auth_user_profile()` (`20270119000026_signup_profile_trigger.sql`) writes `profiles` + `profiles_private`; existing triggers then create the wallet and notification preferences. The browser's `create_user_profile` (`src/lib/services/authService.ts`) remains the idempotent role/referral writer and repair path. Failures land in `signup_profile_failures` and are swept by `signup_ghost_accounts()` — not swallowed. *`CLAUDE.md`'s "signup ke peeche koi DB trigger nahi hai" is stale: the trigger exists since `20270119000026`.*

**Country gate.** A first-time OAuth user with no `profiles.country` stops on `/auth/callback` (`CallbackStatus='country_gate'`). India → `update_user_country()` → `/onboarding`; any other country → `join_waitlist()` → `/waitlist` (the auth account still exists). `CountrySelect` pins India as the only live country; the rest are browsable A→Z as "Coming soon" (`src/components/CountrySelect.tsx`, `20270119000028/29`).

**Onboarding.** `/onboarding` (`OnboardingPage.tsx`), one flow for every role: welcome (role choice) → profile → skills (freelancers only) → review. Review calls `update_user_country()`, writes `freelancer_profiles` / `client_profiles`, `complete_onboarding()`, then `process_referral()`. `ProtectedRoute` sends `onboardingCompleted === false` back to `/onboarding`.

**Suspension / deletion.** `fetchUserProfile` returns `null` when `profiles_private.suspended_at` is set, and `ProtectedRoute` queries it explicitly and signs the session out. Deletion has two paths: the immediate `delete-account` edge → `delete_user_all_data()` (LIVE, `errors: []`), and the 7-day `request_account_deletion` → `process_account_deletion` flow, with failures visible in `/admin/data-isolation`.

## 2. Business rules as implemented (not aspirational)

| Rule (CLAUDE.md) | Enforcement point(s) | Copy/code disagreement |
|---|---|---|
| **Flat 5% commission, client-side, no hidden fee** | `create_contract_with_escrow()` stores `platform_fee = ROUND(amount*0.05,2)`; `razorpay` `create_order` recomputes `amount = funding + 5%` from the DB; `fund_escrow_from_wallet()` debits `amount + fee`; service purchase and contest pool add 5% server-side | **Two 5% slices.** `_release_escrow_internal()` pays the freelancer `gross − fee` (`20270124000000`), so a ₹5,000 contract costs the client ₹5,250 and pays the freelancer ₹4,750 — the platform books ₹500, **10% of contract value**. CLAUDE.md says the freelancer "receives 100%"; `calculateFreelancerAmount()` in `src/lib/config.ts` still returns the full amount. **Founder decision needed.** |
| **Premium ₹299/month, one plan, optional** | `subscription_plans.premium_monthly`; `create_user_subscription()`; Razorpay `order_type='subscription'` reads the plan price server-side; `pay_subscription_with_wallet`; `subscription-billing-cron` | `20270101000018` deactivates every other paid plan (no yearly/team plan). Trial: plan row says 7 days, `20261103000000` sets **freelancer = 1 day** (client 7). Clients have no paid plan (`/client/ai-subscription` redirects to the free assistant). |
| **Packaging free for everyone** | `CreateServicePage.tsx` requires Basic/Standard/Premium and writes `services.packages`; no `is_pro`/subscription check in create/edit/toggle | None found. `services.price` mirrors Basic for legacy cards (`src/lib/servicePricing.ts`). |
| **Client AI free, fair use 100/day** | `ai-writer`: client fields = title/description, `CLIENT_FAIR_USE_DAILY_LIMIT = 100`; `ai-assistant`: `CLIENT_DAILY_LIMIT = 100`; clients never see an upsell | The `ai-assistant` system prompt says *"All AI features are free and unlimited"* — false for freelancers (10 assistant messages/month free, writer 5/day) — and "only a 5% commission on completed contracts", which contradicts fee-at-funding. |
| **Merit-only ranking/matching/search** | Search sorts only `rating`, `hourly_rate`, `created_at` (`FreelancersSearchPage.tsx`); `search_freelancers_by_category()` orders by rating/rate; `ai-matching` scores skill/experience/budget/availability (+category), never `is_pro`; the client fallback weights 40/20/25/15; `is_pro` is only a `ProBadge` | Reputation columns are locked against self-writes (`20270119000013`, `20270119000019`). Residual: `services.rating`, `certifications.verified`, `freelancer_skills.is_verified`, `payout_methods.is_verified` are self-writable with **0 readers** (B4) — do not wire them without a guard. |
| **Withdrawal fee ~2%, separate** | `withdrawal/index.ts`: `feeRate = 0.02` for `razorpay_payout`, `fee = round(amount*0.02)`, `net = round(amount*0.98)`, stored on the row; `PLATFORM_CONFIG.fees.razorpay_payout_percentage = 2` | Wallet/legal copy promises payouts "usually within 24 hours" while every payout queues (A1). PayPal withdrawal is "coming soon" in copy, but the server returns **400** and its rail charges 2.9% — unreachable either way. |
| **Team projects = independent contracts** | `contracts.team_project_id` + `team_project_role_id`; one `create_team_role_contract()` per role; each contract has its own escrow, milestones, dispute, release; isolation runtime-proven | No freelancer accept/decline step (B7). There is **no server-side per-role matchmaker**: suggestions are scored client-side by `matchFreelancersBySkills()` and cached in `team_project_roles.suggested_freelancers`. Any "AI matches team roles in real time" copy must be verified before it stays. |

## 3. Journey catalogue

### J1. Sign-up / sign-in → profile → onboarding → country gate — **BUILT; provider leg LIVE**

**Goal/entry:** create a usable account and land on the right dashboard — `/?modal=signup|login`, `/auth/callback`, `/onboarding`.

1. `SignupModal` → `AuthContext.signInWithOAuth(provider, role)` → `supabase.auth.signInWithOAuth` (`github` | `linkedin_oidc`), with an `oauthDiagnostics.beginOAuthAttempt()` breadcrumb so an unanswered round-trip is reported instead of silent.
2. Provider → `/auth/callback` (`AuthCallbackPage.tsx`). A real session **outranks** a stray error param; the page recovers hash tokens / PKCE `exchangeCodeForSession`, writes the session to localStorage and verifies the write.
3. `fetchUserProfile()` reads `profiles` + `profiles_private`; if missing → `create_user_profile(p_id, p_email, p_name, p_role, p_referral_code)`, retried once to cover the trigger/browser race.
4. First-time OAuth with no country → country gate (§1); otherwise `redirectAfterAuth()` → `/onboarding`.
5. `/onboarding` → `update_user_country`, role write, `complete_onboarding`, `process_referral` → `getPostAuthPath()` → `/dashboard` or `/client`. `ProtectedRoute` gates session, `suspended_at`, `onboardingCompleted`, role.

**States/money:** auth user → profile (trigger) → onboarded → role dashboard; suspended and deleted terminals; no money. **Notify:** welcome email via `email-notifications`/Brevo (currently a no-op, A9). **Fails:** provider never returns (reported by `OAuthReturnNotice`); duplicate callback error with a valid session (ignored by design); profile creation failure (`signup_profile_failures`); "Session could not be persisted". **Live:** GitHub/LinkedIn account creation proven `17/17`; LinkedIn human-consent stalls are external (B10).

### J2. Discovery — search, catalogue, public profile, service detail, reviews — **BUILT; marketplace empty**

**Goal/entry:** find someone to hire or something to buy — `/freelancers`, `/client/find-talent`, `/services`, `/services/:serviceId`, `/freelancer/:id`.

1. `/freelancers` → `freelancer_profiles` with embedded `profiles(name, avatar, is_pro)` + skills; filters min/max rate, min rating, availability, skills; sort `rating | rate_low | rate_high | newest`. Anonymous reads depend on the `profiles` anon column grant (11 columns).
2. Category search → `search_freelancers_by_category(slug, query, min_rate, max_rate, sort_by, limit, offset)` (SECURITY DEFINER, returns `{total, freelancers}`, ordering by rating/rate only).
3. `/services` → `services` where `status='active' AND active=true`; from-price from `packages[basic]` (`serviceFromPrice`); all three tiers are free to publish.
4. `/freelancer/:id` → profile + `freelancer_profiles` + active services; view counter via `record_profile_view()` (anon-callable by design; a vanity metric anyone can inflate). `/services/:id` → service + packages + add-ons + reviews; purchase is J5. Reviews come from `reviews` (embedded reviewer profile); aggregates from `freelancer_profiles.rating/total_reviews` and `get_reputation_stats()`.

**States/money:** service `active`/`inactive` (the toggle writes **both** `status` and `active` — the fix for deactivated services still selling); no money until purchase. **Fails:** a new `profiles` column stays invisible to anon until granted (fail-closed); deleted users filtered by `deleted_at`. **Live:** pages render with **0 active services and 0 reviews** (A8) — working journey, empty marketplace.

### J3. Post project → AI matching → invite/proposal → hire — **BUILT; matching LIVE**

**Goal/entry:** brief → contract — `/client/post`, `/client/matches`, `/client/proposals`, `/dashboard/feed`, `/dashboard/proposals`, `/dashboard/invites`.

1. `ClientPostProjectPage` inserts `projects` (`status='open'`, visibility, `budget_min/max`, category, `skills` **and** `skills_required` kept in sync because readers use both).
2. `/client/matches` → `aiMatchingService.generateMatches(projectId)` → **POST `ai-matching`** with the JWT. The function loads the project **owner-scoped** (`client_id = auth.users.id`, else 404), rate-limits 60/min/project, scores deterministically, optionally adds an LLM semantic boost (`AI_MODEL`), **deletes** existing `ai_matches` for the project and inserts the new set (`ai_enhanced: true|false`). Edge failure falls back to `runSkillBasedMatching()` — same shape, silently degraded (B8); `matchFreelancersBySkills()` is the same engine for team roles and writes nothing.
3. Invite: `inviteFreelancerToProject()` → `invites` (`pending`, 7-day expiry); `notify_new_invite`. Proposal: `/dashboard/feed` → `proposalsService.create()` → `proposals` (`pending`); `notify_new_proposal`.
4. Hire (proposal): `/client/proposals` → `hireFreelancerFromProposal(..., {useEscrowRpc:true})` → **`create_contract_with_escrow(project, freelancer, proposal, amount, client)`** → contract `pending` + `escrow` shell + proposal `hired` + siblings `rejected`; `proposal-notifications` emails the freelancer.
5. Hire (invite): `/dashboard/invites` → `acceptInviteCreateContract(inviteId)` → **`accept_invite_create_contract()`** → contract + escrow, invite `accepted`; decline writes `declined`.

**States/money:** project `open → in_progress → completed|cancelled`; proposal `pending → hired|rejected|withdrawn`; invite `pending → accepted|declined|expired`; contract/escrow `pending`; no money yet, `platform_fee` already fixed at 5%. **Fails:** duplicate hire (idempotent RPC + duplicate guards); amount tampering (`p_amount` ≠ `proposed_rate` → rejected); non-owner matching (404). **Live:** owner matching `ai_enhanced=true`, non-owner `404`, client→freelancer→proposal flow `12/12`.

### J4. Contract workspace (single and team) — **BUILT; team isolation LIVE**

**Goal/entry:** one place per contract for milestones, files, chat, delivery, release — `/dashboard/workspace`, `/client/workspace(/:contractId)`, `/client/team-projects(/:id)`.

1. Workspaces load `contracts` (+ `escrow`, `projects`, counterpart profile) scoped via `client_id`/`freelancer_id`; RLS limits rows to participants.
2. Team: `/client/team-projects/create` → `team_projects` + `team_project_roles` (`src/lib/teamProjects.ts`), role `open → matched → filled`. Per-role hire → **`create_team_role_contract(team_project_id, role_id, freelancer_id, amount, client_id)`**: a normal contract with `project_id = NULL`, `team_project_id`, `team_project_role_id`, its own escrow, the same 5% fee; role becomes `filled`; the freelancer is notified.
3. Actions: `mark_contract_delivered(contract_id)` (milestone-less delivery, default 72h auto-release), `mark_milestone_status(contract_id, idx, status)` (`pending|in_progress|completed|delivered`), `set_auto_release_hours(contract_id, 24–168)`, `messages`, `contract_files`, `workspace_tasks`, `workspace_notes`.
4. Extra revisions: `revision_requests` (`pending_freelancer → pending_client → paid|declined`); freelancer accepts with a price (`respond_extra_revision`), client pays via Razorpay `revision_payment` → `mark_revision_paid()` increments `escrow.amount`.

**States/money:** contract `pending → active → completed|cancelled|disputed` (+ `delivered_at`, `frozen_at`); role `open|matched|filled|cancelled`; money = escrow only, revisions grow the pool. **Fails:** direct `contracts` UPDATE is not a money path; a `disputed`/`frozen_at` contract refuses delivery and milestones; the UI accepts a 10h auto-release input while the RPC enforces 24–168 (`ClientWorkspacePage.tsx` vs `20261211000000`). **Live:** one member's dispute/release/refund leaves the others untouched; `escrow_balance == sum(held escrows)` at every step.

### J5. Escrow funding — wallet / Razorpay / PayPal / admin — **PARTIAL; money-in never executed (A2)**

**Goal/entry:** move the client's money into held escrow — client workspace "Fund Escrow" (`EscrowPayPalPayment`), `/client/payments` (top-up), `/services/:id` buy.

1. **Wallet:** `fund_escrow_from_wallet(contract_id, milestone_indices)` — owner-checked, recomputes `funding_amount` from the contract (or selected milestones), `fee = contract.platform_fee ?? 5%`, `total = funding + fee`, atomic `UPDATE wallets … WHERE balance >= total`, then `admin_fund_escrow` (statuses + `wallets.escrow_balance`), then two `transactions` rows (escrow debit + fee debit). Refuses if already funded.
2. **Card/UPI:** `razorpayService.createOrder({order_type:'contract_escrow', contract_id})` → edge `razorpay` `create_order` recomputes `serverAmount` from `contracts.amount` (+ selected milestones) + 5%, writes `razorpay_orders` (`created`) → hosted checkout → `verifyPayment` → `verify_payment` checks HMAC, ownership and paid amount, sets `captured`, writes `razorpay_transactions`, calls `fund_escrow(contract_id, user.id)` → `admin_fund_escrow`, notifies both. `razorpay-webhook` does the same on `payment.captured`, fail-closed `401` on bad/unsigned signatures, with a replay guard.
3. **PayPal:** `paypal` (`create_order`/`capture_order`) + `paypal-webhook` (verified with `PAYPAL_WEBHOOK_ID`) exist, but the UI is "Coming Soon" and `PAYPAL_SANDBOX=true` (A5). **Admin:** `admin_fund_escrow(contract_id)` is service-role only and is the chokepoint every path calls; `admin-data` cannot write `escrow` (403).
4. Wallet top-up: Razorpay `wallet_topup` → `update_wallet_balance` + `transactions` credit.

**States/money:** `escrow.pending → funded`; `contracts.pending → active` (`start_date`, `escrow_funded=true`); `projects.open → in_progress`. Client pays **contract + 5%**; `escrow.amount` holds only the contract amount. **Fails:** webhook never arrives → client charged, escrow `pending` (exactly what A2 exists to catch); forged signature → `401`, nothing funded; amount mismatch → rejected; double funding → idempotency guard. **Live:** test-mode order with a server-derived ₹5,250; forged signature and unsigned webhook refused; **no real payment has ever completed** (`razorpay_orders = 0`, `transactions = 0`, `invoices = 0`).

### J6. Milestones, delivery, release, commission/invoice/ledger — **BUILT; release rehearsed**

**Goal/entry:** pay the freelancer when work is accepted (or auto-accepted) — both workspaces, "Release", "Approve milestone", `milestone-auto-release` cron.

1. Client approves a milestone → `release_milestone(contract_id, index)` (client-only, row lock, idempotent, refuses `released|paid|completed`); when all milestones are released it calls `release_escrow(contract_id, client_id)`.
2. `release_escrow` (owner or service role) → `_release_escrow_internal`: locks contract + escrow, requires `escrow.status='funded'`, `gross = escrow.amount`, `fee = contract.platform_fee ?? 5%`, `net = gross − fee`; escrow `released`, contract `completed`, freelancer wallet credited, `transactions` credit inserted, client `wallets.escrow_balance` decremented, then `_book_escrow_release()`.
3. `_book_escrow_release()` (idempotent per `(contract_id, source='escrow')`) writes **`platform_revenue`** (`gross/platform_fee/freelancer_amount`, `released`), one **`invoices`** row (`GL-YYYYMM-NNNNNN`, subtotal = net, fee, total = gross, `paid`) and **3 `ledger_entries`** (escrow debit gross, platform revenue credit fee, wallet credit net), plus an audit log and two notifications.
4. Auto-release: cron `growlancer-milestone-auto-release` → `process_milestone_auto_release()` (`delivered_at + auto_release_hours`, default 72, client override 24–168) and `auto_release_contract()` (milestone-less), both service-role and blocked while `disputed` or `frozen_at` is set.

**States/money:** milestone `pending|in_progress|delivered|released|paid|completed|disputed|cancelled` (JSONB on `contracts.milestones`); escrow `funded → released`; contract `active → completed`. Freelancer += **net (95%)**, platform += fee, invoice total = escrow gross. **Fails:** release on unfunded escrow raises; double release refused; cron without a service-role claim fails closed (fixed `20270119000018`, re-fixed `20270130000000`). **Live:** signed synthetic webhook → release → 5% booking → invoice → 3 ledger rows → wallet credit, `33 checks / 0 failures`; never from a real card.

### J7. Withdrawals, payout methods, RazorpayX — **BLOCKED (A1)**

**Goal/entry:** move wallet balance to bank/UPI/PayPal — `/dashboard/wallet` (freelancer), `/admin/withdrawals` (admin/commission).

1. Add payout method → direct `payout_methods` insert (`upi|bank|paypal`, `details` JSONB mirrors the flat fields) → optional `razorpay` action `create_fund_account` stores `razorpay_fund_account_id`. Default/delete via `set_default_payout_method` / `delete_payout_method` (owner-guarded).
2. `createWithdrawal()` → **POST `/functions/v1/withdrawal`** with the JWT (`amount`, `withdrawal_method`, `payout_method_id` | `paypal_email`, `payout_mode`); a client-sent fund account is ignored unless the payout method belongs to the caller.
3. Edge: `auth.getUser()`; PayPal rail rejected (400); resolves the fund account; checks `availableBalance = balance − pending_balance`; `fee = round(amount*0.02)`, `net`; inserts `withdrawals` (`pending`), **`hold_wallet_funds(user, amount)`** (balance → pending), a `transactions` debit (`pending`), then `POST /v1/payouts`.
4. Provider `processed|completed` → row update + **`process_withdrawal_complete()`** (deducts `pending_balance`, `completed`, final transaction); non-final → `processing`. `404 /v1/payouts` (or config-like errors) → **queue**: row stays `pending` with `failure_reason='Queued — payout service not configured yet…'`, funds held, response `{success:true, queued:true}`. Real failures → `rollbackWithdrawal()` (`release_wallet_funds`, `failed`) + email.
5. Safety nets: `razorpay-payout-webhook` → `process_withdrawal_complete`; cron `growlancer-stale-withdrawal-recovery` → `process_stale_withdrawals()` fails `processing > 4h` without a provider id and `pending > 72h`, returning the full amount to `balance`; owner cancel via `cancel_withdrawal()` (pending/processing only). Admin commission payouts: `/admin/withdrawals` → `admin-withdrawal` → `create_admin_withdrawal` → RazorpayX → `finalize_admin_withdrawal` (₹100–₹5,00,000).

**States/money:** `pending → processing → completed|failed|cancelled` (queued = `pending` + reason); net = amount − 2%, the gateway cost, never revenue. **Fails:** no `RAZORPAY_ACCOUNT_NUMBER` → 404 → queue forever; stale cron returns funds while the UI still promises 24h. **UNVERIFIED:** freelancer min/max (edge checks only `amount > 0` + available balance; the ₹100 floor is admin-only). **Live:** test-mode payout attempt reached RazorpayX and returned `404`; wallet ended `balance 4000 / pending 1000` — held, not lost; no withdrawal has ever completed.

### J8. Disputes, refunds, cancellation, admin resolution — **BUILT**

**Goal/entry:** resolve a contract that went wrong — workspace, `/dashboard/disputes`, `/client/contracts`, `/admin/disputes`.

1. Raise: `raise_contract_dispute(contract_id, reason, description)` (disputeService / disputeMilestone) — party-only, NULL-safe; contract → `disputed`, escrow `disputed`, milestone/auto-release actions frozen.
2. Evidence/conversation: `dispute_evidence`, `dispute_messages`, `attach_dispute_evidence`, `send_dispute_message`; admin assignment/notes via `admin_assign_dispute`, `admin_add_internal_note`.
3. Cancellation/refund: `request_contract_refund` (type matrix in `src/lib/refundService.ts`), freelancer responds via `respond_cancellation_request`, `freelancer_decline_contract`, `mark_freelancer_started`; `refund_requests` goes `pending_freelancer → pending_admin → approved|auto_approved|rejected|cancelled|completed|failed`, with `refund_history_events` and `payment_audit_logs`. A fraud accusation freezes the escrow for `pending_admin` review.
4. `admin_decide_dispute(dispute_id, decision, note, client_amount)`: `client_refund` → escrow `refunded`, contract `cancelled`, `_refundable_amount()` credited to the client's **wallet** (not card), refund request `approved`, booked revenue/invoice reversed; `freelancer_release` → escrow `released`, contract `completed`, freelancer credited, then `_book_escrow_release()` books the commission; `split` → freelancer share = refundable − client amount, both credited; `dismiss` → escrow back to `funded`, contract `active`, dispute `cancelled`. Gateway refunds (`refund_payment` / `execute_refund`) are a separate admin path; appeals via `appeal_dispute()`.

**States/money:** dispute `open → under_review → resolved_refunded|resolved_released|cancelled|dismissed` (+ `appealed`); `_refundable_amount()` is 0 for completed contracts / released escrow and subtracts released milestones.
**Mismatch:** `freelancer_release` credits the **gross** refundable then books a 5% fee (`20270119000300` vs `20270124000000`) — wallet and ledger disagree by the fee; founder decision, not a silent fix. **Fails:** frozen contract blocks actions; double decision blocked by status. `escrow.status='frozen'` is written by `20261210000002` but the baseline CHECK allows only `pending|funded|released|refunded|disputed` — **UNVERIFIED** on a fresh DB (possible `23514`; live may be widened out of band). **Live:** dispute/refund isolation across team members proven at runtime.

### J9. Reviews, reputation, seller levels, badges — **BUILT; reviews = 0**

**Goal/entry:** turn a completed contract into trust — workspace "Leave review", `/client/reviews`, public profile.

1. `ReviewModal` → `reviewsService.createReview` → **POST `reviews` edge** (JWT, rate-limited). Validation: contract exists, caller is a party, contract `status='completed'`, `reviewee_id` is the other party, one review per `(contract_id, reviewer_id)`; stores overall + communication/quality/timeliness/professionalism, comment, `would_hire_again`.
2. Post-insert: `update_reputation_score` (the only legitimate writer of `profiles.rating` / `freelancer_profiles.rating/total_reviews/weighted_rating/reputation_score`) and `recompute_seller_level` (thresholds in `src/lib/sellerLevels.ts`: Top Rated Plus 4.8/50+, Top Rated 4.5/25+, Rising Talent 4.0/5+, Level 1 3.5/1+); badge display. Reads: `reviews` + reviewer profile, `review_replies` (owner), `get_reputation_stats()`.

**States/money:** one review per side per contract (no edit/withdraw path traced); no money. **Fails:** review before completion → 400; non-party → 403; duplicate → 400. **Live:** `reviews = 0`, so no reputation has ever been produced.

### J10. Freelancer Premium (₹299/month) and AI quotas — **BUILT; AI providers LIVE**

**Goal/entry:** optional paid capacity for freelancers, free AI for clients — `/dashboard/pro`, `/dashboard/ai-assistant`, `/client/ai-assistant`, service/proposal writers.

1. `/dashboard/pro` loads plans + the current subscription; "Start free trial" → `subscribeToPlan` → `create_user_subscription()` → `subscriptions` (`trial`, 1 day for freelancers) with no payment; after the trial the CTA becomes paid.
2. Paid: Razorpay `order_type='subscription'` (server reads the plan price) → `verify_payment` → `active` + `subscription_start_date` + `is_pro` sync trigger; or PayPal (flag-gated); or `wallet_subscription_pay` → `pay_subscription_with_wallet`. Renewal: `subscription-billing-cron` (CRON_SECRET, daily) charges the saved card; on failure marks `past_due` (never a silent renewal) and emails; sends reminders, expires/cancels.
3. Quotas, all server-side: `ai-assistant` — clients 100/day; freelancers free **10 messages/month**, Premium unlimited, usage in `usage_logs` (`feature_type='ai_assistant'`, read as a SUM). `ai-writer` — freelancer fields free **5/day**, Premium **100/day**; client fields **100/day**, never rendered as a counter; counter via atomic `increment_rate_limit()` on `rate_limits`. `ai-matching` — 60/min/project (abuse guard). `AIGenerateModal` surfaces the real 429/5xx body and refreshes the meter.

**States/money:** `pending → trial|active → cancelled|expired|past_due`; ₹299/month, one plan, no auto-charge without a saved card. **Fails:** no card → `past_due`; quota exhausted → neutral "resets tomorrow"/monthly message, never an upsell for clients. **Live:** all three AI functions verified against a real model (`deepseek-chat-v3-0324`); quota engine fixed and deployed (`20270119000022/23`); no paid subscription has ever been charged.

### J11. KYC / identity verification — **BUILT; dev mode auto-verifies (A4)**

**Goal/entry:** make "Verified" mean something and gate money actions — `/dashboard/identity-verification`, `/client/verification`.

1. Step 1: **real email confirmation** (`supabaseUser.email_confirmed_at`, never client-set), resend via Supabase auth. Step 2: freelancers submit PAN (mandatory); clients may submit PAN and/or business details (GST/Udyam/business PAN, self-attested) → **POST `kyc-submit`** with the JWT.
2. `kyc-submit`: resolves `kyc_provider_config` (DB config wins over env), rate-limits (5/window), validates the document, checks duplicate identity/document hash, calls the provider adapter (Surepass PAN Comprehensive in production), writes `identity_verifications` with a **masked** reference and the generated `document_hash`, and syncs `profiles.verification_status` via trigger. Outcomes: `verified | rejected | review`.
3. Development mode (`kyc_provider_config.mode='development'`, admin-flipped, audited) auto-verifies with `provider='dev_mode'`; production without a token never fabricates a verdict (review instead). Attempts: 2 submissions, then a 24h cooldown (`rejection_count`, `blocked_until`, `kyc_guard_submit_fn`). Admin sets provider/mode, clears config and inspects rows in `/admin/identity-verification`.
4. Gate: `requireKycForAction()` (`src/lib/kycGate.ts`) runs before orders/escrow funding/withdrawals; it fails **open** on transient errors and relies on server checks for the money.

**States/money:** `pending → verified|rejected|review` (+ cooldown); no money directly, it is a gate. **Live:** `identity_verifications = 0`, mode `development` — every submission verifies instantly. Grow Coin awards now exclude `dev_mode` (`20270129000000`), closing the A11 farming concern in code.

### J12. Skill certifications, certificates, public verification — **PARTIAL (self-asserted results)**

**Goal/entry:** prove a skill and let anyone verify a certificate — `/dashboard/certifications(/:testId)`, `/certificate(/:code)`, `/verify-certificate(/:code)`.

1. `/dashboard/certifications` lists tests from `AVAILABLE_SKILL_TESTS` (static list in `src/lib/skillCertifications.ts`) and the user's `skill_certifications`.
2. `/dashboard/certifications/:testId` runs the quiz. **Questions and `correctIndex` ship in the client bundle** (`SkillTestPage.tsx`); scoring is browser-side and the row is written under a "Users can insert own certifications" RLS policy — self-asserted, not assessed. Treat the badge as unverified until the test moves server-side.
3. Admin issuance: `/admin/certificates` → `admin-data` actions `issue_certificate`, `generate_qr_token`, `send_certificate_email`; writes certificate fields (`verification_code`, `certificate_type`, `status`, `recipient_*`) plus `credential_verification_tokens` and `credential_audit_logs`.
4. Public verification: `/certificate/:code` → `admin-data` action `verify_certificate` (unauthenticated by design) and/or `verify_credential_by_token`; renders verified/revoked/replaced/invalid/rate-limited; QR encodes `/verify-certificate/:code`.

**States/money:** certificate `active → revoked|expired`; token `active → replaced|revoked` (version history); no money. **Live:** no certificate issuance is evidenced in the 2026-10-20 launch data (beyond that: **UNVERIFIED**).

### J13. Contests, internships, support tickets, reports, notification preferences — **MIXED**

**Goal/entry:** the surrounding surfaces — `/contests(/:id)`, `/client/contests(/:create)`, `/dashboard/contests`, `/internships`, `/report`, `/dashboard/support-tickets`, `/client/support-tickets`, `/admin/*`.

1. **Contests:** `/client/contests/create` → `contests` (`active`, 1st/2nd/3rd prizes, `end_date`); funding → `fund_contest_prize_from_wallet` (5% fee; **body not in repo migrations — live-only**) or Razorpay `contest_prize`; submissions → `contest_submissions` (`submitted|shortlisted|winner|rejected`) with votes and comments; awarding → `award_contest_prizes` (also live-only) credits winners and auto-issues certificates; `close_expired_contests()` closes by date.
2. **Internships:** `/internships` form → `internshipService` → edge `internship-applications` (resume upload + email) → `internship_applications`; admin triage in `/admin/internships`.
3. **Support:** `supportTicketService` writes `support_tickets` (`open|pending|resolved|closed`, priority, category, `related_contract_id`) + `ticket_messages` (`is_internal` for admin-only notes); admin alert via `emailNotificationService`/`email-notifications`; replies in `/admin/support-tickets`.
4. **Reports:** `/report` → **`submit-report`** (public, rate-limited) → `user_reports` + Brevo email to `REPORT_EMAIL`; triage in `/admin/user-reports` through the `admin-data` proxy. **Preferences:** `/dashboard/profile` → `get_notification_preferences` / `set_notification_preferences` (+ `notification-preferences` edge), per category/channel (`proposals, contracts, messages, payments, milestones, marketing, invitations` × `email, inApp, push`) — **not enforced by the email senders** (§5).

**States/money:** only contests move money (prize pool + 5%). **Live:** the 2026-10-20 launch evidence cites no contest, internship, ticket or report rows — treat all four as unexercised (**UNVERIFIED** beyond that).

### J14. Referrals + Grow Coin — **BUILT + DEPLOYED (20 Oct); invite attribution fixed 20 Oct**

**Goal/entry:** reward real referrals, not signups — `/dashboard/referrals`, `/client/referrals`, `?ref=GRW-…` on signup.

1. Capture: `SignupModal` stores `?ref=` before OAuth; onboarding calls `process_referral(code, new_user_id, email)` — normalises, rejects self-referral/duplicates, inserts `referrals` (`pending`, `bonus_claimed=false`) and bumps `referral_stats`.
2. Code shape: `20270201000000_professional_referral_codes` (committed in `2f31d6d`, applied by Backend Deploy `39429630144`) emits `GRW-XXXX-XXXX` (8 symbols, no role leak), adds a `profiles_private` BEFORE INSERT trigger and makes `process_referral` dash/case tolerant. Existing codes are never rewritten. **Attribution fix (20 Oct):** `/signup?ref=…` used to redirect to `/?modal=signup` and drop the query, so shared links never carried the code; `SignupRedirect` now preserves it and `MainLayout` keeps `ref` when it cleans the modal params (`src/lib/referralCode.ts`, `App.tsx`, `MainLayout.tsx`, tests in `referralCode.test.ts`).
3. Earning: `award_referral_bonus_if_eligible()` (service-role only) pays **10 coins** once the referred user has a completed first contract or a **real-provider** verified KYC (`dev_mode|dev-sandbox` excluded); monthly cap **20 paid bonuses**, overflow still counts on the leaderboard and raises a `monthly_cap` flag. `award_kyc_bonus_if_eligible` = **10**, first completed project = **20**, once per user, uncapped.
4. Balance is **SUM(`grow_coin_ledger.amount`)** — no balance column; `get_grow_coin_balance` is self-only; holds live in `grow_coin_reservations` (30 min, reduces available only).
5. Redemption: `redeem_grow_coins_for_cash` / `redeem_grow_coins_for_premium` require ≥ **100 coins** and `role IN ('freelancer','admin')`; clients are discount-only via `reserve_grow_coins_for_order` + `redeem_reserved_grow_coins` (reserved at order creation, debited only after capture, released on failure). Premium redemption upserts `premium_monthly` with `payment_provider='grow_coins'`.
6. Leaderboard: `get_grow_coin_leaderboard(limit)` — anon-callable, name/avatar + completed referrals, **no email/phone**.

**States/money:** referral `pending → completed`; ledger kinds referral/kyc/first project/redemption/admin adjustment; reservation `held → redeemed|released|expired`; 1 coin = ₹1, cash redemption moves real wallet money, Premium = 299 coins. **Fails:** dev-mode KYC no longer pays; cap overflow pays 0 + flag; shortfall refuses + `redemption_shortfall`. **Status:** `20270129000000`, `20270130000000` and `20270201000000` are committed and were applied by `db push` in Backend Deploy `39429630144`; that run is red only at the surface audit's teardown, not at a migration. Coin Terms/Privacy coverage is still missing (A11).

### J15. Admin console — **BUILT; runtime-verified reads**

**Goal/entry:** operate the marketplace — `/admin` (`AdminAuthGuard` → `AdminDashboardLayout`).

1. Pages call `adminQuery`/`adminCounts`/`adminUpdate`/`adminInsert`/`adminDelete` (`src/lib/adminDataProxy.ts`) → **`/functions/v1/admin-data`**, which authenticates via `auth.getUser()` and checks `profiles_private.is_admin`; failed attempts are rate-limited (10/15 min/IP).
2. `ALLOWED_TABLES` covers profiles/private, projects, proposals, contracts, escrow, transactions, withdrawals, subscriptions/plans, services, reviews, invites, referrals, payment orders, certificates, KYC, tickets, waitlist, disputes, invoices, wallets, payouts, team/workspace tables. Guardrails: `wallets`, `escrow`, `transactions` are **read-only** here (403 on write); `profiles_private` writes are limited to `suspended_at/suspend_reason/suspended_by/banned_at/onboarding_completed`, so admin cannot rewrite `is_admin`, `email` or `phone`.
3. Capability map: users (view/suspend/unsuspend), projects, contracts (status edits), payments (orders/transactions/refunds via Razorpay), finance (`get_finance_stats`, invoices, revenue), withdrawals (commission payouts via `admin-withdrawal`), disputes (decide/assign/notes), subscriptions, reports, internships, certificates (issue/revoke/email), KYC provider config, support tickets, user reports, waitlist, data-isolation, orphan purge. Money-moving admin actions call the same RPCs as users (`admin_decide_dispute`, `admin_reverse_escrow`, `admin-withdrawal`), never raw table writes.

**Fails:** non-admin → 401/403 + rate limit; writing a blocked table → 403; a stale `is_admin` read is a live security incident (closed by `20270119000013` + runtime pentest). **Live:** 51 admin loads / 0 flags.

## 4. State machines (state → who moves it → trigger)

| Machine | States (who moves it → trigger) |
|---|---|
| **Contract** | `pending` (client hire / freelancer invite accept / team role hire → `create_contract_with_escrow`/`accept_invite_create_contract`/`create_team_role_contract`) → `active` (any funding path → `admin_fund_escrow`) → `completed` (client/cron/admin → `release_escrow`, `auto_release_contract`, `admin_decide_dispute('freelancer_release'\|'split')`) or `cancelled` (admin/freelancer decline) or `disputed` (either party → `raise_contract_dispute`; back to `active` on `dismiss`). Overlays: `frozen_at` (admin `freeze_contract`/`unfreeze_contract`; blocks delivery, milestones, auto-release), `delivered_at`. |
| **Escrow** | `pending` (hire) → `funded` (`admin_fund_escrow` path, idempotent) → `released` (`_release_escrow_internal` / dispute release) or `refunded` (`admin_decide_dispute('client_refund')` / `admin_reverse_escrow`) or `disputed` (`raise_contract_dispute`); `frozen` is written by the fraud path (`20261210000002`) but **not allowed by the repo's CHECK** — UNVERIFIED on a fresh DB. |
| **Milestone** (JSONB on `contracts.milestones`, index-addressed) | `pending` (creation) → `in_progress`/`delivered` (freelancer, `mark_milestone_status`; delivery sets `delivered_at`, default 72h) → `released` (client `release_milestone`, or cron `process_milestone_auto_release`); `disputed` via `disputeMilestone`; `completed\|approved\|paid` are legacy/terminal and count as done in progress/refund math. |
| **Withdrawal** | `pending` (edge insert + `hold_wallet_funds`) → `processing` (provider non-final) → `completed` (`process_withdrawal_complete`, deducts pending) or `failed` (`rollbackWithdrawal` / `process_stale_withdrawals`, funds returned) or `cancelled` (owner `cancel_withdrawal`). Queued = `pending` + `failure_reason`. |
| **Dispute** | `open → under_review → resolved_refunded \| resolved_released \| cancelled \| dismissed` (+ `appealed` via `appeal_dispute`); only `admin_decide_dispute` sets `decision`, `decision_amount`, `resolved_by`, `resolved_at`. |
| **KYC** | `pending → verified \| rejected \| review`; two rejections → 24h cooldown (`blocked_until`); dev mode verifies with `provider='dev_mode'`; admin flips provider/mode/clear. |
| **Subscription** | `pending` (pre-payment) → `trial` (1 day freelancer / 7 days client plan) → `active` (Razorpay, PayPal, wallet or Grow Coin) → `cancelled \| expired \| past_due` (billing cron; never a silent renewal). |
| **Order** | `created → captured \| failed` (+ `refunded`). Only `captured` funds escrow/subscriptions/wallet top-up; `verify_payment` and the webhook share the idempotency guard on that status. |
| **Refund request / team role** | Refund: `pending_freelancer → pending_admin → approved \| auto_approved \| rejected \| cancelled → completed \| failed` (history in `refund_history_events`, audit in `payment_audit_logs`). Team role: `open → matched → filled` (one role = one contract) or `cancelled`. |

## 5. Cross-cutting behaviour

**Notifications.** `notifications` rows are written by DB triggers/functions: `notify_new_proposal`, `notify_proposal_status`, `notify_new_invite`, `notify_new_contract`, `notify_escrow_funded`, `notify_milestone_delivered`, `notify_milestone_released`, `notify_contract_completion`, `notify_deliverable_upload`, `notify_subscription_change`, plus `_refund_notify` for disputes/refunds/withdrawals. The `notifications` edge function serves list/archive/restore/push-token operations; users have SELECT-own RLS; push tokens live in `user_push_tokens` (`register_push_token` / `unregister_push_token`).

**Email.** One Brevo helper (`supabase/functions/_shared/brevo.ts`) used by `email-notifications`, `proposal-notifications`, `submit-report`, `newsletter-subscribe`, `internship-applications`, `security-alert-notify`, `withdrawal`, `subscription-billing-cron` and `admin-data` (test email).
Typed templates: `withdrawal_completed|withdrawal_failed|dispute_opened|dispute_resolved|escrow_funded|milestone_released|verification_approved|verification_rejected|account_suspended|support_ticket_created|admin_notification`. **Two gaps:** Brevo rejects every send from Supabase egress IPs (A9), so sends are logged no-ops; and senders never read `notification_preferences`, so the preference UI is advisory only.

**Realtime.** `supabase.channel()` via `realtimeChannels` (`src/lib/supabase.ts`) with unique per-scope names: projects, project_matches, ai_matches, invites, proposals, contracts, escrow, transactions, profiles, profiles_private, services, messages, notifications, reviews, razorpay/paypal orders, wallets, withdrawals, identity_verifications, workspace tasks/notes, referrals, waitlist. RLS applies to streamed rows; pages subscribe **and** refetch; never subscribe a public page to an RLS-blocked table (the About-page escrow fix).

**Audit / ledger.** `ledger_entries` is the double-entry book (3 rows per release: escrow debit / platform revenue credit / wallet credit). `transactions` is the user-facing history; `platform_revenue` + `invoices` hold commission and billing. Dedicated trails: `payment_audit_logs`, `payment_webhook_events`, `razorpay_transactions`, `paypal_transactions`, `refund_requests`/`refund_history_events`, `credential_audit_logs`, `workspace_activity_logs`, `fraud_events`, `security_alerts`, `signup_profile_failures`, `deletion_failures`.

**Idempotency.** Guards are in code, not convention: `create_contract_with_escrow` (proposal / unique open contract), `admin_fund_escrow` (`escrow_funded` + funded row), `release_escrow` (`funded` only), `_book_escrow_release` (per `(contract_id, source)`), `release_milestone` (status), `process_withdrawal_complete` (status), `redeem_reserved_grow_coins` (reservation), `increment_rate_limit` (atomic `count+1`), `verify_payment` (`captured`), webhook (`payment_webhook_events`). `FOR UPDATE` locks exist on contracts, escrow, wallets, withdrawals and disputes wherever balance or state changes.

**Authorization pattern.** Server identity is always `auth.uid()`/`auth.getUser()`. Money RPCs are `SECURITY DEFINER` with explicit `SET search_path`, NULL-safe guards (`auth.uid() IS NULL OR …`), revoked from `PUBLIC, anon`, granted narrowly. `src/test/serverOnlyRpcs.test.ts` stops app code from calling server-only RPCs by name; the hourly `check_security_drift()` sweeps self-writable trust columns, anon-reachable money RPCs, client-writable money tables and stale JWT-claim guards.

## 6. Current launch truth (2026-10-20) — do not soften

| Gate | State today | Evidence |
|---|---|---|
| Money **in** | Path rehearsed, **never a real payment** | `razorpay_orders = 0`, `transactions = 0`, `invoices = 0`, `platform_revenue = 0` (LAUNCH-REVIEW verdict, A2); synthetic signed-webhook rehearsal `33/33` (readiness §C) |
| Money **out** | **Impossible** | `RAZORPAY_ACCOUNT_NUMBER` unset; `POST /v1/payouts` → `404`; withdrawals queue with funds held (A1) |
| Marketplace | **Empty** | `services (active) = 0`, `reviews = 0` (A8) |
| Members | 7 real | `get_public_platform_metrics()` (readiness header) |
| KYC | **Development mode — anyone verifies instantly** | `kyc_provider_config.mode='development'`, `identity_verifications = 0`, no provider token (A4) |
| Email | **Unverified / blocked** | Brevo `401` "unrecognised IP address" (A9); sends are no-ops |
| Legal | **No entity or grievance contact** | Terms §14 / Privacy §9 name neither; no CIN/GSTIN/address anywhere (A10) |
| Security alerts | **4 open HIGH** — three money RPCs lost NULL-safe guards when `20270122000000` re-created them from pre-hardening bodies | `null_unsafe_auth_guard()`; fix committed as `20270130000000` (LAUNCH-REVIEW §2.0) but readiness says **not deployed**; `check_security_drift()` |
| Build / CI | Green — typecheck, lint, 541 tests, build; browser layer 336/0 anon, 72/0 + 72/0 + 51/0 authed | LAUNCH-REVIEW §5, readiness §C |
| Public posture | **Invite-only beta, money handled manually** | readiness "three-sentence version" |

**Repo-vs-doc drift verified in this tree (not copied):**

- Grow Coin (`20270129000000`), the guard fix (`20270130000000`) and professional referral codes (`20270201000000`) are committed (`e517864`, `2f31d6d`) and were applied by Backend Deploy `39429630144`; the deploy is red only at the post-deploy surface-audit teardown. Coin Terms/Privacy coverage is still missing (A11).
- `CLAUDE.md` says there is no signup trigger; `20270119000026` creates profiles/private/wallet server-side.
- `src/routes.ts` is described as the central route list; runtime routing is `App.tsx` + `pages/prerenderUrls.ts`.
- **Six money RPCs called by shipped UI have no definition in `supabase/migrations`**: `create_service_purchase_contract`, `fund_contest_prize_from_wallet`, `award_contest_prizes`, `get_finance_stats`, `create_admin_withdrawal`, `finalize_admin_withdrawal`. They exist only in the live DB (or not at all); a fresh environment built from this repo would fail those journeys. Bodies are **UNVERIFIED**.

## 7. Gap analysis (partial, copy-only, or contradicting the model)

| # | Gap | Evidence | Priority |
|---|---|---|---|
| G1 | **Commission is double-sliced:** 5% on top for the client, then another 5% withheld from the payout (`net = gross − fee`). ₹5,000 → client ₹5,250, freelancer ₹4,750. Dispute `freelancer_release` pays gross (100%) while booking the fee — paths disagree | `20270124000000`; `20270119000300`; `calculateFreelancerAmount()` | **P0 — founder decision before real money** |
| G2 | **Six live-only money RPCs** (service purchase, contest fund/award, finance stats, admin withdrawal create/finalize) are not in migrations | grep returns 0 definitions; call sites in `razorpay/index.ts`, `src/lib/contests.ts`, `adminWithdrawal.ts`, `AdminFinancePage.tsx` | P0 — repo must be source of truth |
| G3 | **Team-role matching is client-side only**; no accept/decline for a team hire | `src/lib/teamProjects.ts`; LAUNCH-READINESS B7 | P1 |
| G4 | **Skill tests are self-scored and client-writable** — questions + answers ship in the bundle; users can insert their own `skill_certifications` | `SkillTestPage.tsx`; RLS "Users can insert own certifications" (`20260722000000`) | P1 (badge trust) |
| G5 | **Email preferences are not enforced** by transactional senders | only `notification-preferences/index.ts` reads the table | P1 (once email works) |
| G6 | **`escrow.status='frozen'`** written with no CHECK widening in the repo | `20261210000002` vs base CHECK (`20240511_create_all_tables.sql`) | P1 (fresh-env failure) |
| G7 | **Admin proxy money-state write block — enforced at the proxy.** `AdminContractsPage`/`AdminSubscriptionsPage` call `adminUpdate('contracts', ...)` / `adminUpdate('subscriptions', ...)` through the admin-data generic proxy; the proxy now blocks writes to `contracts` and `subscriptions` via `WRITE_BLOCKED_TABLES` (same list already used for `wallets`/`escrow`/`transactions`), so raw money-state rows can only change through a SECURITY DEFINER RPC. The console can still READ those tables for reporting; if it needs a specific transition that has no RPC yet, add a narrow RPC rather than widening the proxy. Guard: `src/test/adminMoneyStateProxyBlock.test.ts`. | `admin-data` `WRITE_BLOCKED_TABLES`; `AdminContractsPage`/`AdminSubscriptionsPage` | P2 — money-state writers should be RPC-only (now enforced at the proxy) |
| G8 | **Broad EXECUTE on `process_withdrawal_complete`** (authenticated) though only the payout function/cron uses it | `20270130000000` grants | P2 (state integrity, not theft) |
| G9 | **Withdrawal copy promises 24h / PayPal "coming soon"** while payouts queue and PayPal returns 400 | `WalletPage`, Terms; `withdrawal/index.ts` | P2 (copy) |
| G10 | **Client workspace auto-release copy says 10–168h**, RPC enforces 24–168 | `ClientWorkspacePage.tsx` vs `20261211000000` | P3 |
| G11 | **AI fallback is invisible** — real AI and degraded matching look identical | `src/lib/aiMatching.ts`; B8 | P3 |
| G12 | **"Coming soon" countries are display-only** — only India is live, waitlist has no launch path | `CountrySelect.tsx`, `join_country_waitlist` | Product decision |

## 8. How to add a journey (playbook)

1. **Classify the money.** If it moves money, changes escrow/contract state, or grants a paid capability, read `CLAUDE.md` §Security Principles and the money-RPC checklist first. If the request conflicts with the 5% / ₹299 / free-packaging / free-client-AI / merit-only rules, **stop and flag** — do not implement a conflicting rule "temporarily".
2. **Route.** Add the runtime route in `src/app/App.tsx` (the source of truth; `src/routes.ts` is a mirror) and, for a public page, `pages/prerenderUrls.ts`. Add the nav item in the matching layout/sidebar.
3. **Page.** One exported component in `src/pages/**`, lazy-loaded from `App.tsx`; real queries only; `Button`/`Modal`/`Toast`/`ConfirmModal`/`EmptyState`; never `alert()`/`confirm()`.
4. **Client service.** Data access in `src/lib/**` or `src/lib/services/**`, not in the page. Page → service → Supabase/RPC/edge; DB types from `src/types/supabase.ts`.
5. **Server boundary — pick exactly one:** plain table read/write with ownership-proving RLS; a **`SECURITY DEFINER` RPC** whenever money, escrow, wallet, subscription, dispute, KYC or certificate state changes (ownership → server-derived amount → idempotency → `FOR UPDATE` → ledger/audit row → NULL-safe `auth.uid()` guard → explicit `SET search_path` → revoke `PUBLIC, anon`); or an **edge function** when a third party (Razorpay/PayPal/Brevo/AI) or a secret is involved (`auth.getUser()`, rate limit, CORS from `_shared/cors.ts`, `CRON_SECRET` for scheduled runs, fail-closed signature verification, no client-supplied amount).
6. **Migration.** One timestamped file per DB object; never create it in the dashboard. Idempotent where possible, assertions before commit, and add the name to the server-only list if app code must never call it (`src/test/serverOnlyRpcs.test.ts` reads that list).
7. **Tables.** Name the owning table and its cascade. Money tables: `wallets`/`escrow`/`transactions` are read-only through `admin-data`; withdrawals are written only by the edge function/service role; `ledger_entries`/`platform_revenue`/`invoices` only by `_book_escrow_release`-style internals.
8. **Guards.** Ask: does `is_pro`/payment leak into ranking? Is a client-sent amount trusted? Can `anon` reach the RPC (NULL `auth.uid()`)? Is the SELECT policy participant-scoped? Is the admin check server-side? Does a new `profiles` column need its `anon`/`authenticated` grant (`20270119000024/25` obligation)?
9. **Tests.** Guard tests in `src/test/**` (source- and SQL-text guards are the established pattern; add a negative control). Money/RLS/auth changes additionally need a rolled-back live dry-run plus `scripts/e2e/pentest-privileges.mjs`, `scripts/e2e/surface-audit.mjs`, and for gateway chains `razorpay-chain.mjs` / `razorpay-webhook-rehearsal.mjs`. Refresh `docs/blueprint/INVENTORY.md` (`npm run docs:map`) when you add a page/service/function/migration/test.
10. **Docs + deploy.** Update this file and the relevant module doc, add a short `CLAUDE.md` status entry, then commit and push to `main` (frontend + backend deploy together; watch the Backend Deploy drift check). Report what is **not** verified.

**Business rules to re-check before coding:** 5% flat and who pays it; ₹299 one plan and nothing else gated; packaging free forever; client AI free (fair-use only, no counter shown); merit-only scoring/sorting (no `is_pro` in any `order by`/score); 2% withdrawal fee separate from commission; team projects stay independent contracts (one role = one contract, own escrow/dispute); withdrawal/KYC/payout state only through RPCs; no client-supplied amount anywhere.

## 9. UNVERIFIED register

- Bodies of the six live-only RPCs in §6 — cannot be reviewed from this repo.
- `escrow.status='frozen'` on a freshly migrated database (CHECK not widened in the repo).
- Whether `20270129000000` (Grow Coin) and `20270130000000` (null-safe guards) are applied in production — committed in the tree, but readiness says not deployed; verify with read-only SQL.
- Freelancer withdrawal minimum/maximum (edge checks only `amount > 0` + available balance).
- Whether the professional-code migration's trigger is actually firing in production (applied by `db push`, but no post-deploy signup probe has been run against it).
- Exact `ai-matching` weights in SQL (`project_match_components`); the 40/20/25/15 cited are the **client-side fallback** in `src/lib/aiMatching.ts`.
- `services.rating`, `certifications.verified`, `freelancer_skills.is_verified`, `payout_methods.is_verified` have no readers today (B4); any future reader must add a guard first.
