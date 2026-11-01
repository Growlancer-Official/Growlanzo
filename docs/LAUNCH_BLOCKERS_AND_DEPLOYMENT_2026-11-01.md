# Growlanzo — Launch Blockers & Deployment Instructions (2026-11-01)

## A. Launch blockers (must be closed before real money moves)

| # | Blocker | Owner | Why it blocks | Safe state today |
|---|---|---|---|---|
| 1 | Razorpay merchant + RazorpayX payout approval, webhook secrets, settlement test not verified from the repo | Founder | Payments cannot be claimed "escrow-protected" until the account is approved and one end-to-end test settlement passes | Keep live payments off; test mode only |
| 2 | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAYX_*` must exist in Supabase function secrets for the production project | Founder | Order creation and webhook verification fail closed without them | Functions return errors, no money moves |
| 3 | 2% "gateway fee" is not a verified provider cost; retained amount is unbooked revenue | Founder + finance | Misleading fee disclosure; RazorpayX real charges differ | Fee is deducted at withdrawal as before; copy already says "processor fee" |
| 4 | Legacy coin economy vs master-prompt table (10/20/10 + monthly cap vs 5 + 5 lifetime) | Founder | Two reward tables are live at once, so payouts exceed the spec | Legacy amounts untouched; new lifetime rule added |
| 5 | KYC provider configuration and legal/privacy review of collected documents | Founder + legal | Reward eligibility and identity claims depend on a real provider | KYC rewards only fire on an approved verification |
| 6 | Legal review of Terms, Privacy, Refund, Escrow and Rewards copy by an Indian legal/tax professional | Founder + counsel | Cannot self-certify compliance | Copy matches implementation; no compliance claim made |
| 7 | Production env, domain, HTTPS, auth redirect URLs, Sentry DSN, backups | Founder + ops | Auth redirects and error monitoring are environment-specific | `DEPLOYMENT.md` documents the pipeline |
| 8 | Two-account RLS/browser pass and mobile pass not executed in this audit | Engineering | Data-leak or layout regressions would otherwise surface in production | RLS is enabled on all user tables; unit guards pass |

## B. Deployment instructions (verified pipeline)

The repo already documents the pipeline in `DEPLOYMENT.md`. Summary:

1. **Frontend (Vercel)**
   - Build: `npm run build` → `scripts/build.mjs` → `dist/`.
   - Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
     `VITE_RAZORPAY_CONFIG_ID`, optional `VITE_PAYPAL_ENABLED`,
     `VITE_APP_VERSION`, `VITE_AI_MODEL`.
   - Never place service-role or Razorpay secrets in Vercel frontend env.

2. **Database (Supabase)**
   - Apply migrations in filename order: `supabase db push`.
   - This pass adds `20270302000000_referral_lifetime_project_rewards.sql`
     (additive: one table, one constraint update, function replacements).
   - Back up before pushing; the migration performs no destructive statements.

3. **Edge functions**
   - `supabase functions deploy --all` (35 functions).
   - Required secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
     `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
     `RAZORPAYX_ACCOUNT_NUMBER` / payout credentials, `RESEND_API_KEY` (email),
     KYC provider keys, `OPENAI_API_KEY` if AI features are enabled.

4. **Post-deploy verification (do not skip)**
   - Signed-out request to a money RPC → must be 401/403.
   - Webhook replay with the same event id → second call returns
     `{ignored:true}` and moves no money.
   - One test-mode order → verify → escrow row + transaction + invoice.
   - One withdrawal in test mode → hold, finalize, ledger rows (`fee`,
     `net_amount`).
   - Complete one contract as a referred user → two
     `referral_project_reward_events` rows + 4 ledger rows (5 + 5 for each
     side), notifications for both users.

## C. Rollback

- Code: redeploy the previous Vercel build.
- Migration: additive only; to undo, drop
  `referral_project_reward_events`, restore the previous
  `redeem_grow_coins_for_cash` grant, and drop the new constraint version.
  Do this only with a verified backup.

## D. Support and monitoring

- Sentry is wired (`@sentry/react`) — set `VITE_SENTRY_DSN` (or the server-side
  equivalent) for production.
- Vercel Analytics + Speed Insights are installed.
- Watch: `payment_webhook_events` (status ≠ processed), `withdrawals` stuck in
  `pending`, `grow_coin_review_flags`, and admin audit logs on day one.
