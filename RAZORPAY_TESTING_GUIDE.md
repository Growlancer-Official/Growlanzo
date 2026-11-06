# 💳 Razorpay Testing Guide — Test Mode, Escrow Funding & Full Payment Flow

> **Purpose:** Step-by-step runbook for testing Growlanzo's Razorpay integration end-to-end in **test mode** — from setting up test keys to funding escrow and verifying the money path in the database. No real money is involved while in test mode.
>
> ## §0. A real webhook secret was committed here — rotate it (2026-10-07)
>
> This file used to carry the actual signing secret for the payment webhook in plain text. It was
> verified against the deployed function: a test event signed with the committed value was accepted
> (`200 unknown_order`), i.e. **the committed value was the live secret**. Anyone who can read this
> repository could therefore forge a valid `payment.captured` event and mark an unpaid order as
> captured, which funds escrow without money arriving and lets the release path credit a wallet.
>
> The literal is removed from the working tree, but it still exists in git history — so it **must be
> rotated**, not just deleted:
> 1. Razorpay Dashboard → Settings → **Webhooks** → your endpoint → **regenerate the secret**.
> 2. `npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=<new> --project-ref zttwsjehcgaicziqyxpq`
> 3. Add the same value as the GitHub repo secret `RAZORPAY_WEBHOOK_SECRET` if you want the CI rehearsal
>    to run (optional). Never paste it into a tracked file.
> 4. Prove the new secret works:
>    `RAZORPAY_WEBHOOK_SECRET=<new> node scripts/e2e/razorpay-webhook-rehearsal.mjs` → 33 checks, 0 failures.
>
> `src/test/noCommittedSecrets.test.ts` now fails the build if a secret-shaped literal (64 hex chars, or
> a `*_SECRET` / `*_KEY` / `*_TOKEN` assignment) reappears anywhere in the repo.

---

## 0. Quick Reference — Real Values (Test Mode)

| Item | Value |
|---|---|
| **Live app** | `https://growlancer.vercel.app` |
| **Supabase project** | `zttwsjehcgaicziqyxpq` |
| **Payment webhook URL** (paste in Razorpay Dashboard) | `https://zttwsjehcgaicziqyxpq.supabase.co/functions/v1/razorpay-webhook` |
| **Webhook secret** (set in Razorpay webhook + Supabase secrets) | Generate it in the dashboard — **never** paste the value into this file. Store it only as the `RAZORPAY_WEBHOOK_SECRET` secret (Supabase + CI), see §0 |
| **Webhook events to enable** | `order.paid`, `payment.captured`, `payment.authorized`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed` |
| **Payout webhook URL** (RazorpayX, when enabled) | `https://zttwsjehcgaicziqyxpq.supabase.co/functions/v1/razorpay-payout-webhook` |

> ⚠️ **API keys are stored in Supabase secrets** (Dashboard → Project Settings → Edge Functions → Secrets): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. They are **never committed to git**. **Before testing, regenerate a fresh test key pair** in Razorpay Dashboard → Settings → API Keys (Test Mode) and update the secrets — the previously generated pair currently returns `Authentication failed`, which is why checkout will show that error until fresh keys are set.

### 🧪 Test payment instruments (Razorpay test mode)

| Method | Details | Result |
|---|---|---|
| **Card (success)** | `4111 1111 1111 1111` · any future expiry · any CVV · any name | ✅ Success |
| **Card (insufficient)** | `5109 5109 5109 5100` (declined) | ❌ Declined |
| **UPI** | any UPI ID → select **`success@razorpay`** | ✅ Success |
| **UPI (pending)** | any UPI ID → select **`pending@razorpay`** | ⏳ Pending |
| **NetBanking** | pick any bank → **“Success”** button | ✅ Success |
| **EMI** | any card → EMI tab → **success** plan | ✅ Success |
| **Wallet** | any wallet → **success** option | ✅ Success |

### 👥 Test user accounts (created for end-to-end testing)

| Role | Email | Password |
|---|---|---|
| **Client** | `paytest.client.2026@gmail.com` | `PayTestClient1!` |
| **Freelancer** | `paytest.freelancer.2026@gmail.com` | `PayTestFree1!` |

> A test contract is pre-created: client + freelancer → contract **₹100** (+ ₹5 platform fee = **₹105** payable).

### 💎 Pro subscription plans (freelancer, INR)

| Plan | Price | Interval | Trial |
|---|---|---|---|
| Free | ₹0 | monthly | — |
| Pro Starter | ₹299 | monthly | 14 days |
| Pro Monthly | ₹499 | monthly | 14 days |
| Pro Starter | ₹2,999 | yearly | 14 days |
| Pro Yearly | ₹4,999 | yearly | 14 days |

> **Pay from wallet:** freelancers can pay for Pro with their Growlanzo wallet balance (server-validated, atomic). The **PRO badge** (blue verified style) appears in the sidebar, dashboard, profile and public profile once active.

---

## 1. System Overview — How Payments & Escrow Work

Growlanzo uses **Razorpay as the primary payment gateway** (INR). Escrow payments flow like this:

```
Client hires freelancer → Contract created (e.g. ₹5,000)
        │
        ▼
Client Workspace → "Fund Escrow" button (only if escrow_funded = false)
        │
        ▼
EscrowPayPalPayment UI → Amount breakdown (₹5,000 + 5% platform fee = ₹5,250)
        │
        ▼
"Pay ₹5,250 with Razorpay" clicked
        │
        ▼
Edge function `razorpay` → action `create_order`
   • Verifies the authenticated user owns the contract
   • RECOMPUTES the amount server-side from the DB (never trusts the client body)
   • Calls Razorpay API POST /v1/orders (amount in paise)
   • Stores the order in `razorpay_orders` (status = 'created')
        │
        ▼
Razorpay Checkout modal opens → TEST CARD / UPI entered
        │
        ▼
Payment success → `verify_payment`
   • HMAC-SHA256 signature verified server-side (Web Crypto)
   • Order ownership re-checked
   • Paid amount vs order amount checked
   • Order status → 'captured', transaction recorded in `razorpay_transactions`
        │
        ▼
fund_escrow RPC (requires a captured payment order — no payment, no escrow)
   • Escrow row funded
   • Contract becomes active
   • Notifications sent to client + freelancer
        │
        ▼
Work done → client approves → release_escrow → freelancer wallet credited
        │
        ▼
Freelancer withdraws → `withdrawal` edge function → RazorpayX payout (UPI/Bank)
```

### Key files
| File | Role |
|---|---|
| `supabase/functions/razorpay/index.ts` | Order creation, payment verification, refunds, saved cards, RazorpayX fund accounts |
| `supabase/functions/razorpay-webhook/index.ts` | Server-to-server callback (HMAC verified, idempotent), backup escrow funding |
| `supabase/functions/razorpay-payout-webhook/index.ts` | Payout status updates from RazorpayX |
| `supabase/functions/withdrawal/index.ts` | Withdrawals → RazorpayX/PayPal payout |
| `src/lib/razorpay.ts` | Frontend service (createOrder, verifyPayment, openCheckout) |
| `src/components/RazorpayCheckout.tsx` | Checkout button + modal flow UI |
| `src/components/EscrowPayPalPayment.tsx` | Escrow funding UI (milestone selection + payment breakdown) |
| `src/pages/ClientWorkspacePage.tsx` | Where the "Fund Escrow" button lives |

---

## 2. Prerequisites

- [ ] A **Razorpay account** (free) — https://dashboard.razorpay.com
- [ ] A **Supabase project** (Growlanzo backend) with the `razorpay` edge function deployed
- [ ] Two Growlanzo accounts for testing: **1 client + 1 freelancer**
- [ ] Supabase CLI installed (for secrets via CLI) — or use the Supabase Dashboard

---

## 3. Step 1 — Enable Razorpay Test Mode & Get Test Keys

1. Open **https://dashboard.razorpay.com/app/keys**
2. Toggle **Test Mode** to **ON** (top-right of the page).
3. Copy the **Key ID** and **Key Secret** shown. Both must start with `rzp_test_...`.
4. Store the **Account Number** too (for RazorpayX payouts): Dashboard → **Settings → Payouts**.

> ⚠️ **Critical:** If your keys start with `rzp_live_...`, you are in **LIVE mode** — real money will move. Always confirm test mode before testing.

---

## 4. Step 2 — Configure Secrets in Supabase (Edge Function env vars)

Razorpay keys are **server-side only**. Do **NOT** put them in the frontend `.env` — the edge function returns the public key id in its response.

### Via Supabase Dashboard
> Project Settings → **Edge Functions → Secrets** → **Add new secret**

| Secret | Value |
|---|---|
| `RAZORPAY_KEY_ID` | `rzp_test_xxxxxxxx` |
| `RAZORPAY_KEY_SECRET` | `rzp_test_xxxxxxxxxxxxxxxx` |
| `RAZORPAY_ACCOUNT_NUMBER` *(for payouts)* | e.g. `<digits>` |
| `RAZORPAY_WEBHOOK_SECRET` *(after Step 3)* | generated on webhook creation |

### Via Supabase CLI (project root)
```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx \
  RAZORPAY_KEY_SECRET=rzp_test_xxxxxxxxxxxxxxxx \
  RAZORPAY_ACCOUNT_NUMBER=<your-razorpayx-source-account-number>
```

> ⚠️ **Fail-closed behavior:** The `razorpay` function **refuses all requests** (HTTP 500 `Payment service is not configured`) when the keys are missing. If you see this error, the secrets are not set. Secrets take effect on the next invocation — **no function redeploy needed** for secret changes.

---

## 5. Step 3 — Set Up the Webhook (Recommended)

The client-verify path funds escrow even without a webhook, but the webhook is the **backup funding path + refund lifecycle** (`refund.processed`), so set it up for full coverage.

> **This project's URLs** (project ref `zttwsjehcgaicziqyxpq`):
> - Payment webhook: `https://zttwsjehcgaicziqyxpq.supabase.co/functions/v1/razorpay-webhook`
> - Payout webhook: `https://zttwsjehcgaicziqyxpq.supabase.co/functions/v1/razorpay-payout-webhook`

### 5.1 Payment webhook (escrow/orders/refunds)
1. Razorpay Dashboard → **Settings → Webhooks → Add Webhook**
2. **Webhook URL:** `https://zttwsjehcgaicziqyxpq.supabase.co/functions/v1/razorpay-webhook`
3. **Events** (select ALL — the function handles every one of these):
   - `order.paid` ✅ (funds escrow)
   - `payment.captured` ✅ (funds escrow)
   - `payment.authorized` (audit log only)
   - `payment.failed` ✅ (marks order failed + notifies)
   - `refund.created` (notifies)
   - `refund.processed` ✅ (reverses escrow, order → refunded)
   - `refund.failed` (notifies + audits)
4. **Generate secret** → copy it.
5. Set it as `RAZORPAY_WEBHOOK_SECRET` in Supabase secrets (Dashboard → Project Settings → **Edge Functions → Secrets**, or `supabase secrets set RAZORPAY_WEBHOOK_SECRET=...`).

### 5.2 Payout webhook (withdrawals → RazorpayX)
1. Razorpay Dashboard → **Settings → Payouts → Webhooks** (same section)
2. **Webhook URL:** `https://zttwsjehcgaicziqyxpq.supabase.co/functions/v1/razorpay-payout-webhook`
3. **Events:** `payout.processed`, `payout.failed`, `payout.cancelled`, `payout.reversed`, `payout.queued`, `payout.initiated`
4. Same `RAZORPAY_WEBHOOK_SECRET` is used — no extra secret needed.

> **Critical:** Both functions **fail closed** — if `RAZORPAY_WEBHOOK_SECRET` is not set, every webhook is rejected with HTTP 500. Set the secret BEFORE testing, or nothing will arrive.
>
> The webhook verifies the `x-razorpay-signature` (HMAC-SHA256 over the **raw body**) and is **idempotent** (via `payment_webhook_events.event_id`) — duplicate events are safe no-ops.
>
> **To verify setup:** after a test payment, check `SELECT * FROM payment_webhook_events ORDER BY created_at DESC LIMIT 5;` — rows should appear with `status = 'processed'`. Or use Razorpay's **Send Test Webhook** button (unrecognized event shapes are acknowledged gracefully).

---

## 6. Step 4 — Run the End-to-End Escrow Funding Test

### 6.1 Create the contract
1. Log in as the **client**.
2. Post a project (or use existing seed data) → accept a proposal from your freelancer account → **hire**.
3. A contract is created (e.g. **₹5,000**).

### 6.2 Fund the escrow
1. Open the **Client Workspace** (`/client/workspace` or contracts page).
2. Select the contract → the **"Fund Escrow"** button appears (only while `escrow_funded = false` and contract is not completed).
3. Review the breakdown:
   - Project Amount: `₹5,000`
   - Platform Fee (5%): `₹250`
   - **Total to Pay: `₹5,250`**
4. Click **"Pay ₹5,250 with Razorpay"**.

### 6.3 Pay with a test instrument
The Razorpay checkout modal opens. Use a **test card** (see §7). If a 3-D Secure / OTP simulation appears, select **"Success"**.

### 6.4 Confirm the result
- UI shows **"Payment successful!"**
- The contract is funded and becomes **active**.

---

## 7. Test Instruments Reference (Razorpay Test Mode)

### Cards (always succeed)
| Instrument | Details |
|---|---|
| **Visa** | `4111 1111 1111 1111` — any future expiry, any CVV, any name |
| **Mastercard** | `5555 5555 5555 4444` |
| **Amex** | `4000 3560 0000 0000` — CVV is 4 digits |

### UPI
| Instrument | Result |
|---|---|
| `success@razorpay` | ✅ Payment successful |
| `failure@razorpay` | ❌ Payment failed |

### NetBanking
Any bank → success.

### Amount-driven failures (for testing failure paths)
| Amount ends with | Simulated error |
|---|---|
| `2` | Incorrect card details / generic failure |
| `22` | Insufficient funds |
| `222` | Declined by bank |
| `1222` | Card limit exceeded |

> For clean success tests use amounts ending in `1`, `5`, or `0` (e.g. ₹5,251). The order amount is capped at **₹100,000** server-side (`Invalid amount` above that).

---

## 8. Step 5 — Verify the Money Path in the Database

Run these in **Supabase SQL Editor** (Dashboard → SQL Editor):

```sql
-- 1. Razorpay order captured?
SELECT id, razorpay_order_id, status, amount, currency, order_type
FROM razorpay_orders
ORDER BY created_at DESC
LIMIT 5;

-- 2. Escrow funded?
SELECT * FROM escrow ORDER BY created_at DESC LIMIT 5;

-- 3. Contract updated?
SELECT id, status, escrow_funded, amount
FROM contracts
WHERE id = '<CONTRACT_ID>';

-- 4. Transaction recorded?
SELECT * FROM razorpay_transactions ORDER BY created_at DESC LIMIT 5;

-- 5. Audit trail (financial)
SELECT * FROM payment_audit_logs
ORDER BY created_at DESC LIMIT 5;
```

### Expected results
| Check | Expected |
|---|---|
| `razorpay_orders.status` | `captured` |
| `razorpay_orders.razorpay_payment_id` | set (not null) |
| `escrow` row | funded with the amount |
| `contracts.escrow_funded` | `true` |
| `contracts.status` | `active` (RPC path) / `in_progress` (service fallback) |
| Notifications | Inserted for client + freelancer |

---

## 9. What Happens Next (Release & Withdrawal)

1. Freelancer completes work → submits milestone(s).
2. Client **approves** → `release_escrow` RPC → freelancer **wallet balance** credited (idempotent: platform revenue + invoice + double-entry ledger + audit + notifications).
3. Freelancer goes to **Wallet → Withdraw** → selects UPI/Bank.
4. `withdrawal` edge function validates balance + amount, **holds funds**, and fires a **RazorpayX payout** (requires `RAZORPAY_ACCOUNT_NUMBER`).
5. `razorpay-payout-webhook` updates the withdrawal status; on success `process_withdrawal_complete` clears `pending_balance`.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 500 `Payment service is not configured` | Razorpay secrets not set | Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (Step 2) |
| `Unauthorized: You do not own this contract` | Wrong account paying | Log in as the contract's **client** |
| Modal opens but order never created | Edge function error / SDK load failure | Check function logs + browser console; verify keys |
| `Invalid payment signature` | Signature tampering / key mismatch | Ensure test keys are consistent across env |
| `Too many requests` (HTTP 429) | Rate limit: 20 req/min/user | Wait 1 minute and retry |
| `Invalid amount` | Amount > ₹100,000 or ≤ 0 | Use a smaller test amount |
| Webhook not funding escrow | `RAZORPAY_WEBHOOK_SECRET` mismatch or events not subscribed | Re-check webhook config; the client-verify path still funds escrow as fallback |
| `rzp_live_...` in response | Live keys configured | Switch Razorpay dashboard to **test mode** |
| `Authentication failed` (BAD_REQUEST_ERROR) | Key pair invalid/regenerated/deleted on Razorpay side | Regenerate a fresh **test** key pair in Dashboard → Settings → API Keys → Test Mode, copy both values from the same popup, update Supabase secrets |

---

## 11. Security Notes (Why It Works This Way)

- **Amount is never trusted from the client** — recomputed server-side from `contracts.amount` (+5% fee) or `subscription_plans.price`. An attacker cannot change the price in the request body.
- **`fund_escrow` requires a captured payment order** — you cannot fund escrow without actually paying (hardened in `20260917000000_security_hardening.sql`).
- **`verify_payment` verifies the HMAC signature** over `order_id|payment_id` with the Razorpay key secret, and re-checks order ownership.
- **Idempotency guards** prevent double-processing: same payment never funds escrow twice.
- **Webhooks verify HMAC over the raw body** and dedupe via `payment_webhook_events.event_id`.
- **Rate limiting** (20 req/min) and **CORS allowlist** protect the payment endpoints.
- **`update_wallet_balance` is revoked** from anon/authenticated/PUBLIC — service-role/internal only.

---

*Reference implementation: `supabase/functions/razorpay/index.ts`, `src/components/RazorpayCheckout.tsx`, `src/components/EscrowPayPalPayment.tsx`. Amount model: client pays contract amount + 5% platform fee; freelancer receives the amount.*
