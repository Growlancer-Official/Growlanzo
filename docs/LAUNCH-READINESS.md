# Growlanzo — Launch Readiness Checklist

**Owner: Muhammad (founder).** Every item below is an **action only you can take** — a dashboard
setting, a secret, a product decision — followed by the exact way to prove it is done. Anything that
could be verified or fixed in code has already been verified and is listed in **§C**.

**Start here:** run `npm run preflight` (read-only) — it prints the current blocker/warning list
without ever echoing a secret value, and `npm run preflight -- --strict` exits non-zero while any
blocker remains. The full ordered operator playbook (RazorpayX, one real test-mode payment, PayPal,
KYC, the `.com` domain switch, branch protection) is
[FOUNDER-RUNBOOK.md](FOUNDER-RUNBOOK.md).

Last verified: **2026-10-20 19:30 IST**. Live state (surface audit run `39429630144`, after
`db push`): **9 signable profiles**, 0 active services, **0** contracts / escrow / withdrawals /
orders / transactions / invoices / revenue / KYC rows, 0 orphan profiles, **0 open security
alerts**, and `20270130000000` + `20270129000000` + `20270201000000` applied. That deploy run is
still **red at the whole-surface audit's teardown** (probe leftovers), not at a migration or money
check. The last fully green browser layer was run `36237099675` (Sep 26); the 20 Oct referral
commits did **not** get an authenticated browser pass (CI was red on lint/guards first).
**A12 (commission charged twice) is resolved:** Option B shipped and is recorded in §A12 — the
client now pays exactly the contract amount and the flat 5% is withheld from the freelancer at
release.

> Honest scope: this lists what is *proven to work* and what is *still unproven*. Nobody can promise
> "no error, anywhere, ever" — the same pass that wrote this found four defects in its own probes.

---

## §A — Blocking. Do not take real money until these are done.

### A0. Rotate the payment-webhook secret that was committed to the repo 🔴 **first**

**Why:** `RAZORPAY_TESTING_GUIDE.md` carried the **live** signing secret of the payment webhook as
plain text. That is measured, not suspected — an event signed with the committed value was accepted
by the deployed function (`200 unknown_order`, 2026-10-07). With it, anyone who can read the repo can
forge `payment.captured`, mark an unpaid order as captured, fund its escrow without money arriving,
and let the release path credit a wallet (money-out the day payouts work). The literal is now removed
from the tree and `src/test/noCommittedSecrets.test.ts` fails the build on any new secret-shaped
literal — but git history still holds the old value, so **deletion is not rotation**.

**Your action:** Razorpay Dashboard → Settings → Webhooks → your endpoint → regenerate the secret;
then `npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=<new> --project-ref zttwsjehcgaicziqyxpq`
(and, optionally, the same value as the GitHub repo secret).

**How to verify it is done:** `RAZORPAY_WEBHOOK_SECRET=<new> node scripts/e2e/razorpay-webhook-rehearsal.mjs`
→ **33 checks, 0 failures**; and the same command run with the **old** value → refused with 401.

### A1. Enable RazorpayX Payouts, and set the account number

**Why:** money cannot leave the platform. `POST /v1/payouts` answers
`404 The requested URL was not found on the server`, which the withdrawal function treats as
"payout service not configured" and therefore **queues** the withdrawal — the freelancer's funds are
safely *held* (`balance 4000 / pending 1000` in the verified run), not lost, and a retry cron runs
every 15 minutes. But a queued withdrawal is not a paid freelancer.

**Also verified:** the edge-function secret list contains `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
and `RAZORPAY_WEBHOOK_SECRET` — and **no `RAZORPAY_ACCOUNT_NUMBER`**, which the payout code reads.

**Your action**
1. Activate the **Payouts** product on your RazorpayX account (Razorpay dashboard → Payouts).
2. Set the secret: `npx supabase secrets set RAZORPAY_ACCOUNT_NUMBER=<your-account-number> --project-ref zttwsjehcgaicziqyxpq`

**How to verify it is done**
- `node scripts/e2e/razorpay-chain.mjs` → the final payout leg completes instead of stopping.
- Or in the DB: a `withdrawals` row reaches `status = 'completed'` with `razorpay_payout_id` set and
  `failure_reason` null. Today every attempt ends `Queued — payout service not configured yet`.

---

### A2. Run one real test-mode payment by hand (proves money can come *in*)

**Why:** this is the single biggest unproven journey. `razorpay_orders = 0`, `transactions = 0`,
`invoices = 0`, `platform_revenue = 0` — so the **webhook → escrow funding** leg, the 5% commission
booking, the invoice and the ledger have **never executed in production**. You would discover
whether they work on your first real customer, which is the worst possible time.

What *is* already proven (test mode): an order is created on the real gateway with a **server-derived**
amount (₹5250 = ₹5000 contract + ₹250 flat 5%; the client sends no price), a forged
`verify_payment` signature is refused, and an unsigned webhook is refused with `401`, leaving escrow
`pending` (fail-closed).

The authorisation step itself cannot be automated — it happens inside Razorpay's hosted checkout —
so this one requires you, by hand.

**Your action:** log in as a client, create/fund a contract's escrow, and pay with a **test-mode card**
from your Razorpay dashboard's test-card list (test mode is confirmed active on the deployed keys).

**UPDATE (2026-10-07) — the chain itself is now proven; only the real card is left.**
`scripts/e2e/razorpay-webhook-rehearsal.mjs` signs a real `payment.captured` event with the webhook
secret (the same thing Razorpay sends), posts it into the deployed function and asserts every row the
success branch must write: escrow funded, contract active, project in_progress, order captured,
capture row, event logged, both parties notified — then a replay that is ignored without
double-funding, then the release that books the **5% commission**, the **invoice (₹5250)** and the
three **ledger** rows, with the freelancer wallet credited. Throwaway accounts, full cascade
teardown, row counts compared with the baseline: **33 checks, 0 failures**. Controls keep it honest:
a forged signature is refused (401) and a valid signature for an unknown order funds nothing.
So the remaining uncertainty is *your card + your UI + a real webhook delivery*, not the code path.

**Two corrections to what this file used to ask you to check** (verified against the live function
bodies — `admin_fund_escrow` books no invoice and no commission):

```sql
-- right after the payment (money is HELD). escrow.amount is the CONTRACT amount;
-- razorpay_orders.amount is the contract + 5% that the client actually paid.
select status, amount from escrow order by created_at desc limit 1;                  -- 'funded'
select amount, status from razorpay_orders order by created_at desc limit 1;         -- 'captured', contract + 5%
select count(*) from razorpay_transactions  where created_at > now() - interval '1 hour'; -- >= 1
select count(*) from payment_webhook_events where created_at > now() - interval '1 hour'; -- >= 1

-- after YOU release the milestone: this is when the commission/invoice/ledger appear.
select platform_fee, gross_amount, status from platform_revenue order by created_at desc limit 1; -- 5%, 'released'
select invoice_number, subtotal, platform_fee, total from invoices order by created_at desc limit 1;
select count(*) from ledger_entries where created_at > now() - interval '1 hour';    -- 3
```

If webhook → funding does **not** happen, the escrow stays `pending` while the client has been
charged: that is the failure mode to look for, and it is the reason this item exists.

---

### A3. Add `SUPABASE_SERVICE_ROLE_KEY` as a GitHub repository secret — ✅ **DONE (2026-09-26)**

**Done and verified:** the secret was added on Sep 25; backend deploys now run the whole chain
end-to-end (drift-check → `db push` → functions → pentest **103 checks / 0 failures** → whole-surface
audit **110 checks / 0 failures**, run `36235190403`); migrations `20270119000019/20/21` are live; and
CI's authenticated audit + logout pass runs and is green (run `36237099675`: anonymous 336 loads / 0
flags, authenticated 195 loads / 0 flags, logout 5/5 × 3 roles, teardown `removed=3 failed=0`). The
table below is kept as the record of what the missing secret used to block.

**Original rationale:** it blocked more than it looked. Verified consequences at the time:

| blocked thing | evidence |
|---|---|
| the authenticated audit + logout-security pass in CI | job fails in 5s at the guard: *"Authenticated audit + logout security DID NOT RUN — missing repository secret(s): SUPABASE_SERVICE_ROLE_KEY"* |
| **every backend deploy** | Backend Deploy #21 failed at step 6; drift check, `db push`, migrations verify, functions deploy and the pentest were all **skipped** |
| the privilege + money-path pentest | never runs automatically |
| any future migration (including the fix for §B1) | `db push` is behind the same guard |
| **a critical fix that is already written and committed** | `20270119000019` (anon payout-PII read, anon destructive delete, broken workspace RLS) cannot reach production until this secret exists |

**Your action:** Supabase dashboard → Project Settings → API → **service_role** key → GitHub →
Settings → Secrets and variables → Actions → New repository secret → name `SUPABASE_SERVICE_ROLE_KEY`.

Nothing else is missing: the six `E2E_*` secrets and `VITE_SUPABASE_URL` already exist, and
`SUPABASE_URL` now falls back to `VITE_SUPABASE_URL`, so it does not need adding.

**How to verify it is done**
- `gh secret list -R Growlanzo-Official/Growlanzo` shows `SUPABASE_SERVICE_ROLE_KEY`.
- CI's **Element audit** job turns green and its step list shows *Seed E2E test accounts*,
  *Authenticated audit + logout security* and *Remove E2E test accounts* **ran** (today they cannot).
- A backend deploy reaches the pentest step and passes:
  `node scripts/e2e/pentest-privileges.mjs` → **103 checks / 40 escapes / 0 failures**.

---

### A4. Move KYC out of development mode (or accept it in writing)

**Why:** anyone currently gets verified instantly. `kyc_provider_config.mode = 'development'`,
`identity_verifications` has **0 rows**, and the edge-function secret list contains **no KYC provider
token at all** — so production KYC is not merely unlaunched, it is uncredentialed. For a platform
moving money this is a fraud and compliance gap, not a cosmetic one.

**Your action**
1. Get a real provider token (Surepass / Deepvue — the engine is provider-abstracted).
2. `npx supabase secrets set <PROVIDER>_API_KEY=<token> --project-ref zttwsjehcgaicziqyxpq`
3. Admin console → Verification → switch mode to **Production**.

**How to verify it is done**
- `select mode from kyc_provider_config;` → `production`.
- Run one real KYC on a throwaway account → an `identity_verifications` row appears with
  `provider` **not** `dev_mode` and a real status transition. Rows created in dev mode are honestly
  labelled `provider='dev_mode'` and must be re-verified after the switch.

---

### A5. PayPal — keep it off, and switch it in one atomic change

**Why:** PayPal is deliberately not launched: the UI is gated by `VITE_PAYPAL_ENABLED`
("PayPal — Coming Soon") and the payout rail is blocked server-side with an explicit 400. The
deployed `PAYPAL_SANDBOX` secret's SHA-256 digest matches `sha256("true")`, i.e. **sandbox**.

**The trap to avoid:** `PAYPAL_SANDBOX` also gates the *payment* functions (`paypal`,
`paypal-webhook`). If someone flips `VITE_PAYPAL_ENABLED=true` in Vercel without flipping
`PAYPAL_SANDBOX`, a **sandbox** payment would be accepted and could fund real escrow with test money.

**Your action:** when (and only when) you launch PayPal, make one change that does all of it —
live `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX=false`, and only then
`VITE_PAYPAL_ENABLED=true`.

**How to verify it is done:** `npx supabase secrets list` no longer shows
`b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b` (the digest of `true`) for
`PAYPAL_SANDBOX`; then one small real PayPal payment lands as a live-mode order.

---

### A6. Confirm `APP_URL` is the domain you actually want

**Why:** the deployed `APP_URL`'s digest matches `sha256("https://growlancer.vercel.app")`, so
customers are currently sent to the Vercel domain in every email. As of 2026-10-07 the **code side of
this is done**: a single resolver `supabase/functions/_shared/site.ts` is the only place that reads
`APP_URL`, all 12 edge functions that used to hardcode an origin now import `SITE_URL` from it, and
`src/test/siteUrlGuard.test.ts` fails the build if anyone hardcodes an origin or reads `APP_URL`
directly again. So switching the domain is now **one secret**, not a code change.

**Also found while doing this:** the local `.env` had `APP_URL=growlancer.vercel.app` with **no
scheme**, and `scripts/push_redirect_urls.mjs` used that value to write the live Supabase auth
`site_url` — i.e. running it would have written a broken value into production. Both
`push_redirect_urls.mjs` and `check_providers.mjs` now resolve the origin through one helper and
**fail closed** (`exit 1`) on a non-absolute value. Fix the local line to
`APP_URL=https://growlancer.com` (already done in `.env.example`).

**Your action:** if growlancer.com is canonical, set it:
`npx supabase secrets set APP_URL=https://growlancer.com --project-ref zttwsjehcgaicziqyxpq`

**Checked 22 Oct:** `APP_URL` is still `https://growlancer.vercel.app`, but `pages/+Head.tsx`
(canonical + OG/Twitter URLs), `public/robots.txt` and `public/sitemap.xml` still hardcode
`https://growlancer.com` — and that host **does not resolve** (`curl https://growlancer.com` →
connection failure). Either point the domain at Vercel before launch, or update those three files
to the live origin; a canonical URL on a dead host keeps search engines from indexing the site.

**How to verify it is done:** the `APP_URL` digest changes away from
`d7273ed7f18aa479214f09c76cebd8a72ca844349b08e861cf883676465870d1`; click a link in a real
notification email → it opens on the production domain. `npm run preflight` re-checks this digest
for you (and the local `.env` value) without printing either.

---

### A7. Make the guardrails actually enforced (branch protection)

**Why:** `main` is **not protected** — `GET .../branches/main/protection` returns
`404 "Branch not protected"`. So a red CI run is a *signal only*; it blocks nothing mechanically.
(The deploy workflow is different: its pre-flight guard genuinely stopped a deploy — Backend Deploy
#21 shipped nothing.)

**Your action:** GitHub → Settings → Branches → add a rule for `main` → require status checks:
**Typecheck (tsc)**, **Lint (eslint)**, **Unit tests + Production build**, **Element audit
(375/768/1280)**. (A3 must be done first, or the audit check can never pass.)

**How to verify it is done:** `gh api repos/Growlanzo-Official/Growlanzo/branches/main/protection`
returns the rule with `required_status_checks` listing the four checks; a deliberately failing push
shows *"merging is blocked"*.

---

### A8. Put something in the marketplace (content, not code)

**Why:** `services = 0` and `reviews = 0`. A new visitor lands on a working site with **nothing to
buy**, which no test and no fix can repair. This is the one blocker that is entirely about
supply and demand, not engineering.

**Your action:** onboard the first **5–20 real freelancers**, each with at least one real active
service listing — or run an invite-only beta with concierge matching until that exists.

**How to verify it is done:** `select count(*) from services where status = 'active';` > 0, and a
fresh visitor can browse a real listing, open a freelancer profile, and start a hire.

---

### A9. Brevo rejects every API send — the account's "Authorised IPs" security setting is ON 🔴

**Why:** the founder activated Brevo (2026-10-14) and `BREVO_API_KEY` + `EMAIL_FROM` secrets are
both set, but a **real live test email** through the deployed `admin-data` → `test_email` action
fails: `HTTP 200 {success:false, status:502}` and the edge log carries Brevo's own words:

```
[brevo] Brevo error 401 {"message":"We have detected you are using an unrecognised IP address
2406:da1a:…:5c95. If you performed this action make sure to add the new IP address in this
link: https://app.brevo.com/security/authorised_ips","code":"unauthorized"}
```

The key is valid (Brevo authenticates then refuses by IP). Supabase edge functions egress from
AWS IPs that **change**, so whitelisting individual IPs will break again — either disable the
restriction or (if your org requires it) whitelist the *range*, not one address.

**Your action** (Brevo dashboard — only the account owner can do this):
1. Open <https://app.brevo.com/security/authorised_ips> (or: organisation name → Settings →
   Security → Authorised IPs).
2. Either turn the restriction **off**, or add every egress IP Brevo has complained about.
3. Re-test: Admin console → any page where the test-email action lives, or ask to re-run
   `.e2e/brevo-test.mjs` — the verdict must be `{"success":true}`.

**How to verify it is done:** `node .e2e/brevo-test.mjs` → `{"success":{"success":true}}` and a
"Growlanzo Test Email ✅" lands in the configured sender inbox (default `support@growlanzo.com`). Until then **every** Brevo send
(welcome, proposals, milestones, withdrawals, security alerts, admin notifications) is a
logged no-op with `email_sent:false` — the platform is fully silent by email.

---

### A10. Name the legal entity and a grievance contact on the policy pages 🔴

**Why:** Terms §14 says disputes are governed by "the laws of the jurisdiction of the Platform's
incorporation" but never names the entity, address or jurisdiction. Privacy §9 promises a
"designated Data Protection Officer" with no name or contact. India's IT Rules 2021 and the DPDP
Act expect a named grievance/redressal contact, and payment providers ask for the same details.

**Partial progress (20 Oct):** Terms §14 and Privacy §9 now name **Muhammad (Founder & CEO),
India** and a working `support@growlancer.com` grievance/DPO contact. **22 Oct:** the site footer
also carries the grievance address and the 24-hour / 15-day response commitment on every page.
Still missing: registered legal entity name, registered address, CIN/GSTIN. A grep for those terms
returns nothing.

**Your action:** supply the legal name, registered address, jurisdiction and a monitored contact
address (grievance/DPO). I can wire them into Terms §14 + Privacy §9 the same day — but the values
must come from you, not be invented.

**How to verify it is done:** all three legal pages name the entity and show a working contact;
`grep -ri "grievance officer" src/pages` returns the real name/address.

### A11. Grow Coin is live in the database but has no terms — and its KYC trigger interacts with A4 ⚠️

**Why:** `20270129000000_grow_coin_referral_rewards.sql` and the Grow Coin deploy landed in
`e517864` and were applied by Backend Deploy `39429630144` (`db push` ✓, post drift-check ✓).
The legal/product gap is still open: the programme has no Terms/Privacy coverage, and the award
RPC's KYC leg accepts any `identity_verifications.status = 'verified'` row. In **development
mode** every submission verifies instantly, so one referrer could farm 10 coins per throwaway
account (cap: 20 paid/month = up to ₹200 cashable) for no real work.

**Your decision (before promoting coins):** either exclude `provider = 'dev_mode'` from eligibility
(no KYC-sourced bonuses until A4), or hold cash redemption until A4, or accept the capped cost.

**Your action:** add the coin programme to Terms (no cash value except redemption, no expiry,
clawback on fraud, tax on recipient, public leaderboard name) and a line to Privacy about the
leaderboard. The code is already live, so this is a content/decision task now.

**How to verify it is done:** `select proname from pg_proc where proname like '%grow_coin%';`
returns the RPCs; `select * from get_grow_coin_leaderboard(10);` returns rows without email/phone;
a coin redemption moves a real subscription row to `payment_provider = 'grow_coins'`.

### A12. The 5% commission model — ✅ DECIDED (Option B shipped 2026-10-21)

**Decision:** Option B — the client pays exactly the agreed contract amount; the flat 5% is
withheld from the freelancer at release. Commit `d45b388` and migration
`20270203000000_commission_freelancer_side.sql` implement it, and the pricing/terms/refund copy
now states the freelancer-side model.

**What to verify before taking real money:** for a released contract,
`client_charged = contract.amount` (no client-side fee), `freelancer_credit = amount − 5%`, and
`platform_revenue` books exactly that 5%; a cancelled-before-work contract refunds the full amount
with no commission. `scripts/e2e/pentest-privileges.mjs` now asserts both legs as hard gates
(103 checks, 0 failures).

**Doc follow-through (done 2026-11-01):** `CLAUDE.md` §Business Model already states the
freelancer-side model, and `docs/PROJECT-BLUEPRINT.md` (§1 table, §7 money path, §14.1),
`docs/blueprint/DATABASE.md` (§11.2 conflict row) and this file's §A12 migration filename now all
describe Option B and mark the double-charge finding resolved. That matters because §14.1 used to
read "CRITICAL — decision required", which is an invitation for the next change to re-break the
money path.

### Recommended order

```
A12 (decide the commission model)  → A2 (prove money in by hand once) → A1 (prove money out once)
 → A9 (Brevo IP restriction — 2 minutes, unblocks ALL email)
 → A10 (legal entity + registered address — grievance contact is now present)
 → A4, A5, A6 (one-time config decisions)
 → A7 (lock the gates)
 → A8 (supply) → A11 (coin terms) → §B backlog
```

A12 must come first: charging a real card before the fee model is decided would take the wrong
amount from a real customer. A2 and A1 together are the "can this platform actually move money"
gate. Everything else in §A is a setting or a supply problem. (A3 was the old first step — it is
done, and everything it unblocked runs green on every push.)

---

## §B — Engineering backlog. Needs your go-ahead; not launch-blocking.

| # | Item | Evidence | Owner action | Verify |
|---|---|---|---|---|
| B0 | ~~**The whole-surface audit findings are fixed in code but NOT deployed**~~ — ✅ **DONE 2026-09-26**: `20270119000019` deployed, live audit = **110 checks / 0 failure / 3 vacuous** | all of it reproduced at runtime by `scripts/e2e/surface-audit.mjs`; fix committed as `20270119000019` with two new detectors | ~~do A3~~ nothing left | re-run `node scripts/e2e/surface-audit.mjs` any time (currently 0 failures) |
| B1 | ~~**`ai-matching` never checks project ownership**~~ — ✅ **DONE 2026-09-26** (commit `78e5f43`): the project fetch is owner-scoped in the WHERE clause (JWT identity, not request body) before any rate-limit insert, AI spend or match rewrite; a non-owner gets 404; guarded in source by `src/test/aiMatchingOwnership.test.ts` (7 tests, negative control included) | runtime-proven live on the deployed function (Backend Deploy `36253003395`): owner path still `ai_enhanced=true`, non-owner refused | nothing left | `node scripts/e2e/ai-providers.mjs` → *non-owner matching: ENFORCED* |
| B2 | **`admin-data` now blocks money-state + money-audit writes at the proxy (two-pass hardening this session)** (`wallets`, `escrow`, `transactions`, `contracts`, `subscriptions`, `disputes`) — Security Principle §2 says these change only via `SECURITY DEFINER` RPCs. The generic proxy still READS those tables for the admin console; writes (UPDATE/INSERT/DELETE) to them are rejected with 403. Notably the disputes table's own RLS already grants admins UPDATE but not DELETE, so the only working disputes-DELETE path before this block was the service-role proxy — now closed; dispute decisions go through `admin_decide_dispute`. | enforced in `admin-data/index.ts` `WRITE_BLOCKED_TABLES`; guard `src/test/adminMoneyStateProxyBlock.test.ts`; `AdminContractsPage`/`AdminSubscriptionsPage`/`AdminDisputesPage` now hit the 403 for those writes | if the admin console needs a contract-status / subscription-state / dispute-resolution transition, add a narrow RPC rather than widening the proxy |
| B3 | **SECURITY DEFINER helpers still reachable without a session** | measured today: **86 of 204** `public` SECURITY DEFINER functions satisfy `has_function_privilege('anon', …)` (broad measure; includes PUBLIC default grants — report §15.7's explicit-grant count was 33). Money-touching ones were already revoked; the hourly monitor reports 0 open alerts | decide the revoke list. **Do not revoke `is_user_admin()`** — RLS policies evaluate it and the policies would break | the listing matches your intended set; `select public.check_security_drift();` → 0 |
| B4 | **Dead columns, self-writable** (`certifications.verified`, `freelancer_skills.is_verified`, `payout_methods.is_verified`, `services.rating`) | 4 columns, **0 readers** in app/edge code — so no live impact, deferred to avoid blast radius | apply the §13 pattern (ACL column-grant or guard + assertion) when you first use these tables | a self-update probe on each column is blocked |
| B5 | **Heading hierarchy** — 89 `<h3>` under an `<h1>` on dashboard/client/admin pages | audit tracked a count, not selectors, so blind promotion could make the outline *worse* | per-page review (the tasks are cosmetic) | audit reports 0 unjustified H3-under-H1 |
| B6 | **Currency-consistency prep** for multi-currency later | amounts are INR-first today; PayPal is the USD rail | confirm the target behaviour before building | a single currency-source-of-truth module + tests |
| B7 | **Team-project freelancer notification / accept step** | freelancers are notified of a team role hire but there is no accept step | decide the desired flow | a hired freelancer can accept/decline, and the role state reflects it |
| B9 | **Probe rows accumulate in `ledger_entries`** — `delete_user_all_data` cascades `contracts`/`invoices`/`platform_revenue` but **not** ledger entries (they are keyed by `entity_type`/`entity_id` text), so every `pentest-privileges.mjs` / `razorpay-chain.mjs` run leaves 3 rows behind: the table stands at **147 rows, all from probes** while `platform_revenue` is 0 | measured 2026-10-07; the new rehearsal cleans its own rows and asserts the count returns to baseline, the CI pentest does not | add the same cleanup (delete by the entity ids the run created) to `pentest-privileges.mjs` and `razorpay-chain.mjs`; decide separately whether real account deletion should keep ledger rows (accounting) or purge them (privacy) | after a CI run, `select count(*) from ledger_entries` is unchanged |
| B8 | **Client-side AI fallback is invisible** | the frontend falls back to a deterministic engine when the edge AI call fails — users (and you) cannot tell a real AI match from a degraded one | decide whether to surface/telemetry it | a forced-fallback run emits a visible, countable signal |
| B10 | **LinkedIn sign-in can stall on the provider's own page — nothing is wrong on our side, and the app now says so** | 2026-10-14: GoTrue logged three `302 → linkedin.com` at 09:06:30/36/54Z and **no `/callback` at all** (GitHub at 07:15:43 did return and logged in). Every machine checkable leg passes — `node scripts/check_providers.mjs`: provider ENABLED, LinkedIn serves its consent page, and a made-up `redirect_uri` is rejected (proving our Supabase callback URL is registered); the `linkedin_oidc` identity for the founder's account (created 2026-10-13) proves the flow worked the day before. The stop is the human consent leg (closed prompt / blocked redirect / network). What was ours is fixed: an unanswered round-trip used to be silent, and now reports itself (see §C). | **Your call, no code change:** if it recurs, note what the LinkedIn page showed (error text, or nothing). Test once in a desktop Chrome incognito window off the mobile network to rule out an in-app browser / carrier block. | `node scripts/check_providers.mjs` → all legs pass; then ask the person to retry and check whether `/callback` appears in the auth logs within ~60s |
| B11 | **Intermittent React #418 + `insertBefore` crash on protected pages** (pre-existing, unrelated to today's work) | Two element-audit runs of the production build each lost exactly **1–2 of 72 loads** (`/client/team-projects@768` then `/client/post@375`; `/dashboard` + `/dashboard/invites`), with `React error #418` + `NotFoundError: Failed to execute 'insertBefore'` and no logout chrome — while **all 72 loads had a SUCCESSFUL GoTrue session check and 0 were rejected**. A different route each run and untouched routes affected ⇒ a real transport/hydration race, not a per-page defect. Three direct loads of the previously flagged route render fine. | measured 2026-10-14 on the production build (`PORT=4174 node server.js` + `scripts/e2e/element-audit.mjs --group=client --storage=.e2e/client.json`) | decide whether to chase it now (most likely the Vike SPA-fallback hydration race documented in `vite.config.ts`, racing the dashboard's realtime subscriptions) | audit reports 0 auth-integrity loads across 3 consecutive runs |

---

## §C — Verified working. Do not re-do these; re-run the command if in doubt.

| Area | Proven | Re-verify with |
|---|---|---|
| Authorization + money-path locks | **103 checks, 40 escape attempts, 0 failures** against production: anon / cross-party / non-admin refused at every step, owner paths still work | `node scripts/e2e/pentest-privileges.mjs` |
| Whole-surface breadth | **113 tables / 233 functions / 298 policies** walked over real HTTP: 47 private tables unreadable by anon, 22 owner-scoped tables unreadable across users, 23 anon-executable helpers probed with a real victim id, DB invariants + the four drift sweeps | `node scripts/e2e/surface-audit.mjs` (currently **0 failures**, 3 honest vacuous notes) |
| Escrow isolation across team members | one member's dispute/release/refund leaves the others untouched; `escrow_balance == sum(held escrows)` at every step | same script |
| AI providers are real | all three **call a model** — assistant streams SSE as `deepseek/deepseek-chat-v3-0324`, writer returns real text, matching returns `ai_enhanced=true` with model-written scores; anonymous calls are refused `401`, and a signed-in **non-owner is refused 404** (matching is owner-only; §B1 closed). Independently, the deployed `AI_MODEL` digest **matches `sha256("deepseek/deepseek-chat-v3-0324")`** | `node scripts/e2e/ai-providers.mjs` |
| Gateway security posture | forged `verify_payment` signature → `Invalid payment signature`; unsigned webhook → `401` with escrow left `pending` (fail-closed) | `node scripts/e2e/razorpay-chain.mjs` |
| Signup / deletion / referral chain | 9/9 end-to-end as a real user; `delete_user_all_data` returns `errors: []`; no orphan profiles | — |
| Honest public numbers | member count counts only accounts that can still sign in (**4**, not 6); escrow ₹0 is real, not placeholder | `select * from get_public_platform_metrics();` |
| Financial write paths | wallet/escrow/transactions are not client-writable; withdrawal rows can no longer be forged or amount-tampered | pentest script (pass A) |
| Cron payouts | service-role milestone release now credits for real (`credited=5000.00`, previously `false / 0.00`) | pentest script (service-role leg) |
| Frontend health | live site loads with **0 console errors** (excluding the platform-injected `/_vercel/*` insights noise); all assets and public RPCs return 200 | open the site, watch the console |
| Browser layer (element + logout) | anonymous **336 loads / 0 flags** at 375/768/1280; authenticated dashboard **72/0** + client **72/0** + admin **51/0**; logout-security **5/5 × 3 roles**; seed→teardown leaves 0 accounts behind | CI run `36237099675`, or locally: `PORT=4174 node server.js` → `node scripts/e2e/login.mjs --all --require-all` → the audit/logout scripts |
| Money-in chain rehearsed end to end | a signed `payment.captured` event through the deployed webhook: escrow funded, contract active, order captured, capture row, event logged, both parties notified, replay ignored (no double-funding), then release booking the 5% commission + invoice ₹5250 + 3 ledger rows + wallet credit — with throwaway accounts and a clean baseline restore | `RAZORPAY_WEBHOOK_SECRET=<value> node scripts/e2e/razorpay-webhook-rehearsal.mjs` (**33 checks / 0 failures**) |
| One place owns the site URL | `supabase/functions/_shared/site.ts` is the only `APP_URL` reader; no edge function hardcodes a growlancer origin; both operator scripts fail closed on a scheme-less value | `npm test -- siteUrlGuard` and `npm run preflight` |
| Icons + onboarding country | one icon pack (`lucide-react`) with only official brand marks left as raw SVG; India is the only selectable onboarding country (196 others browsable A→Z under "Coming Soon", display-only) — proven in a real post-auth browser run, **16/16** | `npm test -- iconPackConsolidation countrySelectContract` |
| Font declarations cannot drift | the three serving paths (`pages/+Head.tsx`, `index.html`, `scripts/build.mjs`) must declare identical families/weights, no print-parked stylesheet, and every `font-*` weight used in `src/` must have a real published face | `npm test -- typographyFonts` |
| No committed secrets | the webhook secret that used to live in `RAZORPAY_TESTING_GUIDE.md` is gone, and a 64-hex literal or a `*_SECRET` / `*_TOKEN` / `*_PASSWORD` / `*_KEY` assignment with a real-looking value now fails the build (control: planted → RED, restored → byte-identical) | `npm test -- noCommittedSecrets` |
| GitHub / LinkedIn signup creates a usable account | a fresh `auth.users` row now produces `profiles` + `profiles_private` + wallet **with no browser involvement** (trigger `20270119000026`); the profile-less accounts were repaired (ghost count **3 → 0**, 8 users = 8 profiles = 8 wallets); a benign duplicate-callback error no longer overrides a real session — proven **on the deployed site** with a real session (no "Authentication failed", session intact, routed to the country gate) and locally before/after on the same probe | `npm run e2e:oauth-signup` (**17/17**) |
| Dashboard section label is never guessed | both shells resolve the header name from the real route (`src/lib/dashboardSection.ts`): the two reported screens (`/client/post` → "Post a Project", `/client/verification` → "Verification") and every other non-sidebar route (`Post a Team Project`, `Create Service`, `Skill Test`, `Support Tickets`, …) now name themselves instead of showing the old hardcoded "Workspace"; unknown routes derive a truthful name from the URL | `npm test -- dashboardSection`; real UI: `.e2e/verify-ui-fixes.mjs` → **24/24** (client + freelancer, 375px, fail-closed auth) |
| Header crowding on client + freelancer pages | the section header row stacks on mobile instead of overlapping its own action — verified geometrically (no bounding-box intersection at 375px) and by the audit's **0 overflow offenders** across 72 client + 72 dashboard loads | `.e2e/verify-ui-fixes.mjs`; `node scripts/e2e/element-audit.mjs --group=client --storage=.e2e/client.json` |
| Unfinished sign-in is reported, not silent | an unanswered provider round-trip now writes a breadcrumb before leaving for the provider and, on return with no session, shows an honest notice naming the provider, confirming **nothing was created**, and offering a retry + the other provider; callback errors are mapped to real causes (cancelled, no email shared, replayed handshake, config) instead of "Authentication failed". Negative control included: a *fresh* in-flight attempt stays silent | `npm test -- oauthDiagnostics`; real UI positive **and** negative control in `.e2e/verify-ui-fixes.mjs` |
| Team-project AI writing | the multi-role form has the same AI title + AI description controls as the single-project form (reusing `AIGenerateModal`, `clientFree`), and the client fair-use cap is one universal 100/day that is **never rendered as a counter** on a client surface (copy shows "free for you — no limits", and the over-cap message stays neutral) | `.e2e/verify-ui-fixes.mjs` (controls present + no numeric cap in the rendered page) |
| Provider-leg diagnostics | `scripts/check_providers.mjs` probes each leg (GoTrue redirect → provider page → redirect_uri) and reports where the chain stops, with a per-provider control (only where a real one exists). It was silently failing closed before: a module-level `const URL` shadowed the global `URL` constructor, so every run printed "APP_URL is not an absolute URL" and nothing else | `node scripts/check_providers.mjs` |
| Design typography | both families really load on prerendered pages: **9 @font-face parsed / 9 loaded**, per-weight faces are distinct (Cabinet Grotesk 500→900 advance widths differ), `font-display font-black` renders at weight **900**, and **no Google-Fonts request** is made (the unused Inter load is gone). Previously the font CSS shipped as `media="print"` with no `onload` (React SSR strips event handlers), so **no design font applied at all** and every prerendered page rendered in system-ui | open any page, then `await document.fonts.ready; document.fonts.forEach(f => console.log(f.family, f.weight, f.status))` — expect 9 faces, all `loaded` |
| Build health | typecheck + lint + **423 tests** (36 files) + production build all clean | `npm run typecheck && npm run lint && npm test && npm run build` |
| Self-detection | hourly `check_security_drift()` sweeps trust columns, anon-reachable money RPCs, client-writable money tables and stale JWT-claim guards. It works: it **caught a live regression on 16 Oct** (three money RPCs re-created from pre-hardening bodies by `20270122000000`, NULL-safe guards lost) — currently **3 findings / 4 open HIGH alerts** until `20270130000000` deploys, then expected 0/0 | `select public.check_security_drift();` |
| **Both dashboards, LIVE, on the deployed site** (2026-10-14) | real seeded sessions against `https://growlancer.vercel.app`: client **72 loads / 0 flags**, freelancer **72 loads / 0 flags** (every load proved signed-in by logout TEXT + a successful GoTrue check, 0 rejections), logout-security **5/5 × both roles** — and a full cross-role real-data flow: client posted a project through the real form → row confirmed in DB → freelancer saw it in the feed, applied through the real modal → proposal row in DB → client saw it on `/client/proposals` → **12/12 checks, cleanup verified 0 leftovers** | `node .e2e/run-with-env.mjs scripts/e2e/login.mjs --base=https://growlancer.vercel.app --all --require-all` then the element-audit/logout scripts with `--base=https://growlancer.vercel.app`, and `node .e2e/run-with-env.mjs .e2e/cross-role-flow.mjs` |
| Header labels verified on the LIVE deployment | `932659b`'s route→label fix confirmed live on Vercel at 375px: `/client/post`→"Post a Project", `/client/verification`→"Verification", `/client/team-projects/create`→"Post a Team Project", `/dashboard/services/create`→"Create Service", `/dashboard/profile`→"Profile", 0 non-2xx on all five loads | `node .e2e/run-with-env.mjs .e2e/live-verify.mjs` |

---

## The three-sentence version

Money can currently come **in** only through paths nobody has ever exercised end to end, and cannot
go **out** at all until RazorpayX Payouts is enabled and `RAZORPAY_ACCOUNT_NUMBER` is set — so the
honest readiness state is **"invite-only beta with money handled manually"**, not public launch.
The engineering underneath is in better shape than expected: authorization, escrow isolation, the AI
features, the webhooks' fail-closed posture, the build **and the full browser layer** are all verified
working, and the remaining code findings are a short backlog rather than a rewrite. The fastest path to
public launch is **A2 → A1** — prove money in by hand once, prove money out once (the guardrails that
used to gate this are done and green).
