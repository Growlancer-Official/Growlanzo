# Growlanzo — Production Readiness Audit (2026-11-01)

Scope: repository, database, edge functions, payment/reward engines, dashboards,
legal copy and launch configuration. This document separates **verified** work
from **unverified / blocked / not implemented** work. Nothing here is a
certification — every claim names the check that produced it.

---

## 1. Architecture as it actually is (verified by inspection)

| Item | Reality |
|---|---|
| Frontend | React 19 + Vite 8 + TypeScript 5.3, **Vike** file-router (`pages/` + `src/routes.ts`), Tailwind |
| Backend | Supabase (Postgres, Auth, Storage, Realtime, 35 Edge Functions) |
| Production server | Express (`server`), Vercel deploy, `scripts/build.mjs` |
| Payments | Razorpay orders + webhooks, RazorpayX payouts, PayPal (feature-flagged) |
| Migrations | 31 versioned SQL files in `supabase/migrations/` |
| Tests | 70 Vitest files, 827 assertions |

`CLAUDE.md` / `AGENTS.md` and the code now agree on one money model:
**5% flat commission withheld from the freelancer payout**, client pays the
agreed amount only.

---

## 2. Payment and revenue engine — audit result

### Working (verified in SQL + tests)
- Escrow release pays from a **fee-exclusive base**: `net + fee = gross`, so the
  platform keeps its 5% and the freelancer gets the rest
  (`20270124000000_restore_release_escrow_cron_and_fee_base.sql`,
  `20270203000000_commission_freelancer_side.sql`).
- Double-entry booking on every release: commission ledger + invoice +
  transaction, all written from the same numbers.
- Commission derived server-side (`ROUND(pool * 0.05, 2)` and a stored-fee
  fallback), never from browser input.
- Razorpay webhook: deterministic `event_id`, unique constraint, duplicate
  events answered `200 {ignored:true}`, capture/verify race handled
  (`razorpay-webhook`), escrow funding through a service-role RPC.
- Withdrawal flow: `hold_wallet_funds` → payout → finalize/rollback with
  `pending_balance` accounting; failed payouts return the full amount.
- Withdrawal fee is stored per row (`fee`, `net_amount`) — 2% for
  `razorpay_payout`, 2.9% for PayPal (`supabase/functions/withdrawal`).

### Gaps found
1. **The 2% gateway fee is a Growlanzo-side rate, not a verified provider cost.**
   RazorpayX per-transfer fees are not 2%. The user-facing copy says "2%
   processor fee", while the retained difference is platform revenue that is
   **not booked as revenue**. Either the fee must be described as a Growlanzo
   payout fee, or re-priced to the real provider charge. `BLOCKER-3`.
2. Payout fee is a hardcoded constant per method inside the edge function —
   changing the rate needs a redeploy, not a config change.
3. No ledger row separates "gateway fee" from "platform commission" on the
   payout leg (only a `fee` column on `withdrawals`).

### Live-payment status
Razorpay merchant approval, RazorpayX payout activation, webhook secrets and
settlement tests **cannot be verified from this repository**. Treat live
payments as unapproved until the founder confirms them in the Razorpay
dashboard → `BLOCKER-1`.

---

## 3. Referral and Grow Coin system — audit result

### Previously implemented (kept)
- Permanent, one-per-user referral attribution, same-role codes, self-referral
  and duplicate attribution blocked, professional code normalisation
  (`20270129000000`, `20270201000000`, `20270204000000`).
- Ledger-derived balance (never a stored editable number), reservations for
  unpaid orders, admin adjustments with a reason, fraud flags.
- KYC award only on an approved verification (`identity_verifications`
  trigger), contract award only on `status = 'completed'`.

### Implemented in this pass (verified by `src/test/referralLifetimeProjectRewards.test.ts`)
- **Lifetime per-project reward** — new migration
  `20270302000000_referral_lifetime_project_rewards.sql`:
  - `referral_project_reward_events` table with
    `UNIQUE (contract_id, recipient_id)` (hard idempotency).
  - `award_referral_project_reward(contract_id)`, service-role only: requires
    `status = 'completed'` **and** `escrow_funded` **and** a completed
    `payment`/`fee` transaction. Cancelled, unpaid, refunded or disputed
    contracts never qualify.
  - Pays **5 coins to the referred user + 5 to the referrer**, on every
    qualifying contract, no lifetime cap; referrer side has its own conflict
    guard so one referrer who referred both parties is never paid twice.
  - Wired into the contract completion trigger, plus notifications for both
    users.
- **Coins are not cash, enforced in the database**: `redeem_grow_coins_for_cash`
  now returns `code: 'coming_soon'` and is `REVOKE`d from `authenticated`.
  (The UI already presented withdrawal as "coming soon".)
- **Admin reversal** with a mandatory auditable reason
  (`admin_reverse_referral_project_reward`), admin-gated.
- Dashboard copy on both referral pages now states the recurring 5 + 5 rule.

### Resolved after the first pass — `BLOCKER-4` (coin economy consolidated)

`20270303000000_coin_economy_single_reward_table.sql` now enforces the single
table: KYC approval pays **5 + 5 once per referral**, every completed referred
project pays **5 + 5 for life**, and the legacy 10 + 10 kickoff, personal
10-coin KYC milestone, 20-coin first-project bonus and 20/month cap are retired
(no-op server functions, no new ledger rows; history untouched).

### Original conflict analysis (kept for the record)
The implemented legacy economy and the master-prompt table are **not the same
numbers**. Both are live right now, which means one referred project can pay
more than the spec says:

| Event | Implemented today | Master prompt §4 |
|---|---|---|
| Referral kickoff (first contract or KYC) | 10 coins each side | — |
| Approved KYC (personal milestone) | 10 coins | 5 + 5 (referral pair) |
| First completed project (personal) | 20 coins | — |
| Every completed project (referral pair) | 5 + 5 (new) | 5 + 5 |
| Monthly bonus cap | 20 coins | no cap |

I did **not** rewrite the legacy amounts: per the repository rule, money/reward
changes that alter existing payouts get flagged before implementation. Decide
which table is canonical, then the legacy functions can be reduced to it in one
migration.

---

## 4. Database and security audit

- **RLS coverage**: every user-data table created across the migration history
  is RLS-enabled. Three internal tables shipped without it —
  `credential_audit_logs`, `credential_version_history`,
  `reviews_duplicate_archive` — fixed in the new migration (RLS on, no
  policies, grants revoked from `anon`/`authenticated`).
- **No service-role or gateway secrets in frontend code**: the only matches in
  `src/` are comments; the browser reads `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_RAZORPAY_CONFIG_ID` only.
- Money-moving RPCs are `SECURITY DEFINER` with `search_path` pinned and
  `REVOKE ... FROM PUBLIC, anon, authenticated` unless they are user-scoped.
- Reward/coin writes are server-only; users cannot edit balances.
- Webhook authenticity: Razorpay signature verified before any state change;
  event rows recorded before processing.

Open items (not fixed, documented):
- `get_grow_coin_leaderboard` is granted to `anon` — it exposes display names
  and coin totals publicly. Intentional? Confirm before launch.
- `redeem_grow_coins_for_premium` is still user-callable (allowed by the
  approved model: 199 coins = 1 month Premium). Confirm the coin-discount
  checkout flow is the only other redemption path.

---

## 5. Feature-status matrix

| Area | Status | Evidence |
|---|---|---|
| Auth / session / role routing | Working | typecheck + 827-test suite |
| Client: projects, proposals, contracts, workspace | Working (code paths present) | routes + edge functions |
| Freelancer: feed, proposals, contracts, wallet | Working (code paths present) | routes + edge functions |
| Escrow release + commission + invoice | Working, unit-verified | `mvpScopeGuard`, `commissionAndPaymentSecurity` |
| Withdrawal hold/finalize/rollback | Working, unit-verified | `serverOnlyRpcs`, withdrawal migration |
| Referral attribution + KYC/project rewards | Working + extended this pass | new migration + guard test |
| Coins as cash | **Disabled server-side** (coming soon) | new migration |
| Premium ₹199 single plan | Implemented | `20270301000000_single_premium_plan_199.sql` |
| Team collaboration | Implemented with server permissions | `teamProjects.ts` + migrations |
| Notifications | Event-backed, read/unread | notification service + triggers |
| Admin dashboard | Implemented (users, payments, KYC, referrals, coins) | `admin-data`, admin pages |
| Legal pages | Present; fee/coin copy aligned this pass | `TermsPage`, `EscrowPolicyPage`, etc. |
| Live payments/payouts | **Blocked by provider approval** | see blockers |

---

## 6. What was NOT verified (honest limits)

- No live Razorpay/RazorpayX/PayPal transaction was executed — no credentials.
- No real KYC provider call (provider credentials not available here).
- No two-account end-to-end browser run through contract → completion.
- No Supabase remote migration apply; migrations were validated by syntax
  tests and inspection only.
- Mobile layouts were not visually inspected in this pass.
