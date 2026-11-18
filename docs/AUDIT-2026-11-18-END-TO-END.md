# Growlanzo — End-to-End QA, Flow & Production Readiness Audit

**Date:** 2026-11-18 · **Target:** production `https://www.growlanzo.com` (Supabase `zttwsjehcgaicziqyxpq`)
**Commit audited:** `c1dcb57` (`main`) · **Method:** live HTTP/API probes + DB ground truth via service role + full local suite
**Rule followed:** nothing was written to production, no account was created or deleted, no money path was executed.

---

## A. Executive Summary

**Verdict: NOT READY FOR PUBLIC LAUNCH — but not because the code is broken.**

Engineering quality is green and the security posture is genuinely strong for a pre-launch product. What blocks launch is **configuration, missing deployments, and an empty marketplace** — plus one real privacy hole found in this audit.

| Measure | Result |
| --- | --- |
| Automated suite | **960 passed**, 1 skipped, 1 failed (harness artifact, see BUG-11) |
| Typecheck / lint | `tsc` 0 errors · eslint 0 errors, 1 pre-existing warning |
| Production build | exit 0 · 67 prerendered HTML · 367 kB entry (102 kB gzip) |
| Production routes | **40 / 40 → 200**, unknown path → real **404** (negative control passed) |
| Security headers | HSTS + CSP + XFO:DENY + nosniff + Referrer-Policy on every sampled route |
| Anonymous DB sweep | 127 tables: **0 rows leaked** from private tables; 19 tables hard-denied; **0 anon RPC succeeded** |
| Project drift sweeps | `check_security_drift`=0 · `client_writable_money_tables`=[] · `null_unsafe_auth_guard`=[] · `self_referential_policy_predicate`=[] |
| Edge functions | 35 deployed-checkable: **4 missing (404)**, 2 returning 503, **0 open without auth** |
| Marketplace data | **0 projects · 0 contracts · 0 referrals · 0 payments** |
| Test accounts (20 requested) | **DO NOT EXIST — 0 rows** (7 real accounts total; see BUG-09) |
| Founder preflight | 0 blockers · 5 warnings · gates A1, A2, A4, A5, A6, A7, A8 open |

**Test counts:** 40 live route cases · 127 anonymous table probes · 19 curated anon RPC probes · 7 drift sweeps · 35 edge-function probes · 7 header/SEO page checks · 4 content-marker scans · 962 unit/integration tests. **Blocked:** every two-sided marketplace journey, payment, email, and UI/responsive case (reasons in each section).

---

## B. Feature Coverage Matrix

| Module | Implemented | Verified live in this audit |
| --- | --- | --- |
| Public pages (22 sitemap URLs) | Yes | **Yes** — 40/40 routes 200, 404 negative control |
| Auth (email+password, reset, verification) | Yes | **No** — needs real accounts/inbox |
| KYC | Coming-soon UI + dev mode | UI only; gate A4 open |
| Freelancer dashboard & profile | Yes | **No** — no freelancer test account |
| Client dashboard & projects | Yes | **No** — no client test account |
| Proposals / contracts / workspace | Yes (325 migrations, 223 RPCs) | **No** — 0 rows in DB |
| Escrow, wallet, 5% commission | Yes, guarded RPCs | **Partially** — drift sweeps clean; no payment executed |
| Subscriptions (₹199) | Yes | **No** — no account |
| Referral / GrowCoin | Yes | **No** — 0 referrals |
| Reviews | Yes | **No** — 0 rows |
| Messaging / notifications | Yes | **No** — no accounts; `project-notifications` **missing** |
| Admin dashboard | Yes (16 routes previously rendered) | **No** — no admin session this audit |
| transactional email (Brevo) | Yes | **No** — `email-admin` + `brevo-webhook` **missing** |
| AI matching | `ai-matching` deployed | Not exercised (needs a signed-in user) |
| PayPal | Code + function exist | **Fails 503** on both functions |

---

## C / D. Freelancer & Client Journey Audits — **BLOCKED**

The 20 designated accounts (F01–F10, C01–C10) **do not exist in the database**. Ground truth from the auth admin API and `profiles`:

```
auth users total ......... 7
@growlancer-test.com ..... 0   (the 20 test accounts)
profiles ................. 7
projects / contracts ..... 0 / 0
referrals ................ 0
```

They were created and then torn down in an earlier session, exactly as requested at that time. Per the audit rules (do not silently replace accounts, do not create accounts without approval) **no replacement accounts were created**, so all 37 freelancer steps and 39 client steps are **not tested** — not "passed".

To unblock, the founder must approve provisioning 20 pre-confirmed test accounts (the repo already has `scripts/create_test_users_batch.mjs`, which creates the whole set and can remove it again with `--cleanup --force`).

---

## E. Two-Sided Marketplace Flow — **BLOCKED (empty database)**

With 0 projects and 0 contracts there is no live journey to walk. Previously proven *in an earlier session against the live backend* (recorded in `CLAUDE.md`, **not re-run here**): referral 32/32, team project 24/24, reviews 104/104, 5% commission (₹3000→₹2850, ₹6000→₹5700), subscription ₹199 via wallet, AI matching `{success:true,total_analyzed:15}`. Treat those as **historical evidence requiring re-verification**, not as current results.

---

## F. Security Audit — measured

### Anonymous (pre-login) surface — what an attacker sees without an account

| Probe | Result |
| --- | --- |
| 127 exposed tables, `SELECT *` | 101 → 200, 19 → **401/403**, 7 → 206 partial |
| Rows visible from private tables | **0** (`wallets`, `transactions`, `contracts`, `milestones`, `notifications`, `messages`, `invoices`, `disputes`, `saved_payment_cards`, `razorpay_orders`, `profiles_private`, `referrals`, `subscriptions`, `withdrawals`, `platform_reviews`, …) |
| Hard-denied to anon (19) | `profiles`, `projects`, `proposals`, `reviews_duplicate_archive`, `kyc_email_otps`, `phone_verification_codes`, `grow_coin_ledger`, `grow_coin_reservations`, `credential_*`, `subscription_billing_charges`, `verification_rate_limits`, `platform_kyc_settings`, `kyc_provider_config`, `signup_profile_failures`, `referral_project_reward_events` |
| Anonymous RPC execution (19 curated money/privilege RPCs) | **0 succeeded** — all rejected |
| `check_security_drift` / `client_writable_money_tables` | `0` / `[]` — no client-writable money table |
| `null_unsafe_auth_guard` / `self_referential_policy_predicate` | `[]` / `[]` — the classic NULL-guard and self-referential-policy bugs are absent |

**Caveat stated honestly:** because most tables are empty, "0 rows" is weak evidence on its own. The strong signals here are the 19 hard denials, the zero anon RPC successes, and the project's own drift sweeps returning clean.

### Findings

- **BUG-01 (P2, privacy/compliance).** `client_profiles` is readable by anonymous visitors including `gst_number`, `business_pan`, `udyam_number`, `website`, `size`, `location`. A business PAN and GSTIN are financial identifiers under Indian compliance norms and must not be world-readable. Fix: revoke anon `SELECT` on those columns (column-level grant) or move them to a private table and expose a public view without them.
- **BUG-07 (P4).** Anon holds `EXECUTE` on the trigger function `set_platform_review_fields()`. Direct call returns 404 (`PGRST202`) so it is **not exploitable**, but the project's own `anon_reachable_money_rpc` query reports it forever — a permanent false positive. Fix: `REVOKE EXECUTE ... FROM anon, authenticated` (trigger functions run as the table owner anyway).
- **Green:** `platform_reviews.rating` appears in `self_writable_trust_columns`, but the `BEFORE INSERT OR UPDATE` trigger derives `role` from `profiles`, requires a `completed` contract, and pins `status` to the old value — a user can only rate **their own** testimonial. **Not a vulnerability; the drift query is over-reporting.** No client-trusted amount, no self-writable money column, no open RLS was found.

### Edge function authentication

35 functions probed unauthenticated: **none returned 200**. That is the correct fail-closed posture.

---

## G. Financial Audit (code-level, no money moved)

No payment was executed, by design. What *was* verified is that the structural guarantees exist in the deployed database: no client-writable money table, no NULL-unsafe auth guard, no anon-reachable money RPC except the trigger-function false positive above. Contract/escrow/invoice counts are 0 because no real payment has ever run — gate **A2**. RazorpayX payouts are still disabled — gate **A1**. The 5% commission and 2% gateway-fee split therefore remain **unverified against a live transaction**.

---

## H. Integration Audit

| Integration | State |
| --- | --- |
| Supabase (DB, RLS, 223 RPCs) | Live, clean drift |
| Razorpay (orders/webhook) | Function deployed; no test order executed |
| RazorpayX payouts | Disabled (A1) |
| PayPal (`paypal`, `paypal-webhook`) | Deployed but **503** — no keys configured (A5). UI correctly shows "Coming Soon" |
| Brevo email | `email-admin` **404**, `brevo-webhook` **404** → admin email console and delivery webhooks are dead in production |
| Exa search | `exa-search` **404** → AI search feature cannot work |
| Notifications | `project-notifications` **404** → project events have no notification worker |
| AI matching | `ai-matching` present, not exercised |

---

## I. UI/UX & Responsive — **NOT TESTED**

No browser session was used for this audit, so 375/390/768/1280/1440 px layouts, modals, tables, touch targets and mobile keyboards are **unverified**. Nothing here should be read as a UI pass. What *was* checked is structural: every route serves real server-rendered HTML (not an empty SPA shell) with a distinct `<title>`.

---

## J. Bug Register

| ID | Sev | Module | Impact | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | **P2** | `client_profiles` RLS | Anon can read GSTIN, business PAN, Udyam of every client | `SELECT *` as anon → 200, columns listed | Revoke anon SELECT on `gst_number`,`business_pan`,`udyam_number` |
| BUG-02 | **P1** | Edge functions | 4 repo functions are **not deployed** → email admin, Brevo webhook, Exa search, notifications silently dead | unauthenticated POST → 404 ×4 | `supabase functions deploy` + verify each returns 401 |
| BUG-03 | **P2** | SEO/privacy | `/login`, `/client/*`, `/dashboard` serve the homepage `<title>`, canonical `/` and `robots: index, follow`; `robots.txt` has no `Disallow` for private routes | live HTML on `/login` and `/client/dashboard` | prerender/static `noindex` for private segments + robots rules |
| BUG-04 | P3 | Canonicalisation | Canonical, robots sitemap and sitemap `<loc>` use apex `growlanzo.com` while the site serves `www` (apex 308 → www) | headers + robots.txt + sitemap | pick one host (A6) and make canonical match it |
| BUG-05 | P3 | SEO | Meta descriptions 25–32 chars on `/about`, `/pricing`, `/privacy`, `/terms` | measured `description_len` | write 120–155 char descriptions |
| BUG-06 | P3 | PayPal | Both functions 503 rather than a clear "not configured" response | status 503 ×2 | return 501/200-with-disabled, or keep flag off |
| BUG-07 | P4 | RPC grants | Anon `EXECUTE` on trigger fn `set_platform_review_fields` | direct call → 404, drift query flags it | `REVOKE EXECUTE` from anon/authenticated |
| BUG-08 | P4 | Repo hygiene | Random-named Google verification HTML sits in `public/` root | `public/AYyZL…bc.html` | allowed, but document it |
| BUG-09 | **P1 (process)** | Test environment | The 20 required test accounts do not exist; DB has 0 projects/contracts/referrals | auth admin API: 7 users, 0 test-domain | approve re-provisioning |
| BUG-10 | P4 | Build reproducibility | A restored workspace needs `npm ci` before any check (node_modules not checkpointed) | `eslint: not found` on first run | documented here |
| BUG-11 | P4 | Test harness | `projectMap.test.ts` fails while any untracked structural file exists (e.g. a temp audit script) | 1 failed / 960 passed | delete temp files before running the suite |

---

## K. Launch Blocker Checklist

1. **BUG-02** — deploy the 4 missing edge functions (email + notifications are customer-facing).
2. **BUG-01** — stop anonymous reads of GST/PAN/Udyam.
3. **A1** — RazorpayX payouts + `RAZORPAY_ACCOUNT_NUMBER` (money cannot leave today).
4. **A2** — one real test-mode payment end-to-end (webhook → escrow → 5% → invoice).
5. **A4** — KYC out of development mode (currently "Coming Soon", correct for beta).
6. **A5** — PayPal keys, or keep `VITE_PAYPAL_ENABLED=false`.
7. **A6** — decide apex vs www (fixes BUG-04 and every email link at once).
8. **A7** — branch protection on `main`.
9. **A8** — real supply: publish services, collect reviews (marketplace is empty).
10. **BUG-09** — provision the 20 test accounts and run the two-sided journeys before inviting real users.

---

## L. Remediation Roadmap

1. **Security/privacy:** BUG-01 (column grant), BUG-07 (revoke execute).
2. **Deploy integrity:** BUG-02 (4 functions), verify each returns 401 unauthenticated.
3. **Money:** A1 + A2 with a real test-mode payment; re-verify 5% and the ₹199 subscription against a live transaction.
4. **Journeys:** BUG-09 → run F01–F10 / C01–C10 end to end, including rejection, cancellation, dispute and revision paths.
5. **Email:** Brevo welcome/verify/reset/proposal/contract notifications with SPF+DKIM verified in the received headers.
6. **Referral/premium:** reward caps, self-referral, duplicate prevention.
7. **SEO:** BUG-03, BUG-04, BUG-05.
8. **UI/responsive:** 375/390/768/1280/1440 pass on both dashboards (not done here).
9. **Performance:** route timings (`/about` was the slowest at 787 ms) and query plans on the large tables.
10. **Final regression:** full suite + this audit re-run, both green.

---

## M. Final Verdict

**NOT READY FOR LAUNCH.** Engineering is not the blocker: 960 tests pass, typecheck/lint/build are clean, 40/40 production routes answer, security headers are correct, and the anonymous attack surface resisted every probe. Launch is blocked by **four undeployed edge functions**, **one real privacy leak in `client_profiles`**, **no live payment ever executed**, **payouts disabled**, and **an empty marketplace with no test accounts to prove the two-sided flow**.

**Closest realistic next state: READY FOR CONTROLLED BETA** — reachable once BUG-01 and BUG-02 are fixed and the 20 test accounts are approved, because the invite-only beta posture documented in `docs/LAUNCH-READINESS.md` does not require real payouts.

---

### Method & reproducibility

| Step | Command / probe |
| --- | --- |
| Ground truth (users, rows) | service-role REST + `auth/v1/admin/users` |
| Local quality gates | `npm ci` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run build` · `npm run preflight` |
| Production routes | `node scripts/e2e/route-smoke.mjs` (40 URLs + 404 negative control) |
| Anon table sweep | 127 tables via anon key, `select=*&limit=3` |
| Drift sweeps | `check_security_drift`, `check_schema_drift`, `client_writable_money_tables`, `anon_reachable_money_rpc`, `null_unsafe_auth_guard`, `self_referential_policy_predicate`, `self_writable_trust_columns` |
| Edge functions | unauthenticated `POST {}` to all 35 |
| Headers/SEO | 7 routes, titles/canonical/robots/descriptions |

Temporary probe scripts were deleted after the run; this document and `CLAUDE.md` status log entry (29) are the only committed artifacts. No production row was created, updated or deleted by this audit.
