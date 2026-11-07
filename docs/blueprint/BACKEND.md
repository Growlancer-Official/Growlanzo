# Growlanzo — Backend Blueprint (Supabase Edge Functions)

**Last verified: 2026-10-20** (working tree `main` @ `2f31d6d` + uncommitted referral work; no backend files uncommitted)
**Scope:** `supabase/functions/**` (33 functions + `_shared/`), the `[functions.*]` block of `supabase/config.toml`, `.github/workflows/backend-deploy.yml`, and the edge-function env contract named in `.env.example`.
**Out of scope:** DB schema/RLS internals (see `DATABASE.md`); frontend call sites (see `FRONTEND.md`). Only the RPCs and tables each function touches are named here.
**Source of truth:** the files cited inline. The repo is the source of truth, not the live DB — a dashboard-only edit is drift, not a change (`CLAUDE.md:142-152`).
**Reading rule:** *configured* = present in the repo; *proven working* = a repo probe/test or a recorded live verification has exercised it (cite given). Everything else is `UNVERIFIED`. No secret values appear in this document — names only.

---

## 1. Runtime contract

### 1.1 Runtime, handler shape, dependencies

| Concern | Reality | Evidence |
|---|---|---|
| Runtime | Deno 2 (`deno_version = 2`) | `supabase/config.toml:404-413` |
| Handler | **Two idioms coexist.** `Deno.serve(async (req) => …)` in 25 functions; `serve()` imported from `https://deno.land/std@0.168.0/http/server.ts` (or `0.177.0`) in 8: `razorpay`, `razorpay-webhook`, `paypal`, `paypal-webhook`, `kyc-submit`, `verify-document`, `milestone-auto-release`, `subscription-billing-cron`. New code uses `Deno.serve`. | grep over `supabase/functions/*/index.ts`; e.g. `withdrawal/index.ts:164`, `razorpay/index.ts:5,129` |
| Supabase SDK | Imported per file from `esm.sh`. **24 files use floating `@2`; 9 pin `2.39.7`.** No `deno.json`/import map/lockfile exists, so a rebuild is not byte-reproducible. | `supabase/functions/**/index.ts:2-6`; no `supabase/functions/deno.json` |
| OPTIONS | Every browser-facing function answers `OPTIONS` first: `new Response('ok', { headers: corsHeaders })` (some return `null`/204). | `admin-data/index.ts:282-284`, `kyc-submit/index.ts:316`, `verify-document/index.ts:145-147` |
| Routing | Body/query discriminated, not path-based: `const { action, data } = body` then `switch (action)` (`razorpay`, `paypal`, `ai-writer`), `if (req.method === 'POST' && action === …)` (`admin-data`), or plain method routing (`withdrawal`, `invoice`, `notifications`). | `razorpay/index.ts:165-235`, `admin-data/index.ts:292-296` |
| Clients per invocation | Usually two: an **anon-key client carrying the caller's `Authorization` header** (identity + RLS) and a **service-role client** for cross-user reads/writes and audit rows. | `razorpay/index.ts:145-156` |

Canonical skeleton (copy this shape):

```ts
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(401, { error: 'Unauthorized' });
    // … rate limit → authorize resource → act …
    return json(200, { success: true, data });
  } catch (err) {
    console.error('[fn-name] unexpected:', err);
    return json(500, { error: 'Internal server error' });
  }
});
```

### 1.2 `verify_jwt` — default true, **six** overrides

The platform default is `verify_jwt = true`; only the entries below are loosened, each because the caller has no Supabase JWT (server-to-server) and each re-authenticates in code. The deploy workflow never passes `--no-verify-jwt`; `config.toml` is the only source of the flag (`backend-deploy.yml:198-214`).

| Function | `verify_jwt` | Caller | In-code check | Evidence |
|---|---|---|---|---|
| `razorpay-webhook` | **false** | Razorpay | HMAC-SHA256 of raw body vs `x-razorpay-signature`, constant-time compare → 401 | `config.toml:451-452`; `razorpay-webhook/index.ts:37-59,168-175` |
| `paypal-webhook` | **false** | PayPal | `POST /v1/notify-webhook/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`; missing ID throws → 403 | `config.toml:454-458`; `paypal-webhook/index.ts:20-60,82-88` |
| `razorpay-payout-webhook` | **false** | RazorpayX | Same HMAC header → 403 | `config.toml:460-463`; `razorpay-payout-webhook/index.ts:20-40` |
| `subscription-billing-cron` | **false** | pg_cron → pg_net | `Authorization: Bearer <CRON_SECRET>` (env, else `cron_settings.cron_secret`) → 401 | `config.toml:468-469`; `subscription-billing-cron/index.ts:182-190` |
| `milestone-auto-release` | **false** | pg_cron → pg_net | Same bearer check → 401 | `config.toml:471-472`; `milestone-auto-release/index.ts:60-69` |
| `security-alert-notify` | **false** | pg_cron → pg_net | Same bearer check → 401 | `config.toml:474-475`; `security-alert-notify/index.ts` (CRON_SECRET guard) |
| `ai-writer` | true (restated) | Browser | Explicit `true` is documentation, not an override — the default already applies | `config.toml:477-482` |

`process-deletion` and `razorpay` (`action: execute_refund`) are cron-invoked but keep `verify_jwt = true` and authenticate with `CRON_SECRET` inside — `process-deletion` uses **`x-cron-secret`**, not a bearer token (`process-deletion/index.ts:19-26`), and `razorpay` accepts the env secret *or* `cron_settings.cron_secret` (`razorpay/index.ts:18-31`).

**`verify_jwt = true` is not an auth gate for public forms.** The platform accepts the project **anon key** as a valid JWT, so a signed-out browser still passes the gateway; identity only appears when the request carries a real user session and the function calls `auth.getUser()` (which returns `null` for the anon key). That is why public endpoints (`newsletter-subscribe`, `internship-applications` POST, `submit-report` anonymous, `admin-data` certificate verification) work with the default flag and must enforce their own checks.

### 1.3 CORS

`supabase/functions/_shared/cors.ts` is the only allow-list. It reflects a known origin, returns `{}` for anything else, never sends `Access-Control-Allow-Credentials`, and allows headers `authorization, x-client-info, apikey, content-type, x-app-version, x-app-name`.

* Exact origins (5): `growlancer.com`, `www.growlancer.com`, `growlancer.vercel.app`, `growlancer-mrkhan154212s-projects.vercel.app`, `http://localhost:5173` (`cors.ts:8-14`).
* Patterns (3): team-scoped Vercel previews `growlancer-*-mrkhan154212s-projects.vercel.app`, `http://localhost:<port>`, `http://127.0.0.1:<port>` (`cors.ts:25-29`) — the narrow loopback/vs-team-slug comment explains why a bare `growlancer-*.vercel.app` would be spoofable (`cors.ts:16-24`).
* **Five functions import no CORS helper on purpose** — `razorpay-webhook`, `paypal-webhook`, `milestone-auto-release`, `subscription-billing-cron`, `security-alert-notify`. All are server-to-server and never send an `Origin` (`cors.test.ts:58-64` asserts the helper returns `{}` for `null`). `razorpay-payout-webhook` imports it even though it is also server-to-server (harmless).
* Guard: `src/test/cors.test.ts:89-118` fails if any function sets `Access-Control-Allow-Origin` itself or keeps a private allow-list — it does **not** require an import, which is why the five above pass.

### 1.4 Env access, responses, errors, logging

| Topic | Contract |
|---|---|
| Env | `Deno.env.get('NAME') ?? ''` (browser-safe, empty → explicit fail-closed branch) or `Deno.env.get('NAME')!` in cron/AI functions (`ai-writer/index.ts:5-6`, `milestone-auto-release/index.ts:23-24`). Missing `SUPABASE_URL`/key in a `!` path throws at module scope → the whole function boot-fails (visible as 500/`BOOT_ERROR`), which is intended for crons. |
| Response helper | **None is shared.** Each function builds `new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })`. The only named helper is `jsonResponse()` inside `razorpay-webhook/index.ts:20-25`. |
| Success shape | `{ success: true, data: … }` (`razorpay`, `withdrawal`, `paypal`), `{ success: true, … }` flattened (`ai-writer`, `kyc-submit`), or a bare resource (`notifications`, `invoice`). No single envelope. |
| Error shape | `{ error: string }` is universal; variants add context: `{ success: false, error }` (`withdrawal`, `admin-signup`), `{ success: false, status: 'rejected', error }` (`kyc-submit:384-403`), `{ error, message, isPro, used, limit }` (`ai-writer:238-249`). |
| Status codes in use | 200, 204 (OPTIONS in `kyc-submit`/`verify-document`), 400, 401, 403, 404, 405, 429, 500, 502 (`ai-writer:283,289` for gateway failures). |
| Error sanitisation | **`_shared/errors.ts` exists but no function imports it** (grep: only self-references). Several functions therefore return raw `error.message` — e.g. `razorpay/index.ts:1396`, `withdrawal/index.ts:494` (upstream Razorpay text). See §9. |
| Logging | `console.error` for failures, `console.log` for operational events, `console.warn` for deprecations. Newer functions prefix `[fn-name]` (`razorpay-webhook`, `ai-writer`, `kyc-submit`); older ones log bare strings (`withdrawal:492`, `milestone-auto-release:56`). Recipient emails are deliberately not logged (`brevo.ts:35`). |

---

## 2. Shared modules (`supabase/functions/_shared/`)

| File | Purpose | Imported by | Invariants / gotchas |
|---|---|---|---|
| `cors.ts` (58 l) | Origin allow-list + header builder | 28 of 33 functions | Single source; never reflect unknown origins; no credentials header; patterns are team-scoped on purpose. Guarded by `src/test/cors.test.ts`. |
| `site.ts` (46 l) | `SITE_URL`, `siteUrl(path)`, `FALLBACK_SITE_URL` from `APP_URL` | 11 functions: `admin-data`, `email-notifications`, `internship-applications`, `milestone-auto-release`, `newsletter-subscribe`, `paypal`, `proposal-notifications`, `security-alert-notify`, `submit-report`, `subscription-billing-cron`, `withdrawal` | Only reader of `APP_URL`; falls back to `https://growlancer.vercel.app` and `console.warn`s (never logs the value). Guarded by `src/test/siteUrlGuard.test.ts` (10 tests) — no hardcoded origin, no direct `APP_URL` read. |
| `brevo.ts` (97 l) | `sendEmail(opts)` transactional email | `admin-data`, `email-notifications`, `internship-applications`, `milestone-auto-release`, `newsletter-subscribe`, `proposal-notifications`, `security-alert-notify`, `submit-report`, `subscription-billing-cron`, `withdrawal` | **Never throws**; returns `false` when `BREVO_API_KEY` is absent (`:39-43`) — email is best-effort by design. Sender is `EMAIL_FROM` (default `Growlanzo Notifications <info@growlanzo.com>` when unset — never the owner's private Gmail), `replyTo` from `EMAIL_REPLY_TO`. Supports `{name,url}` or `{name,content}` attachments. |
| `ai.ts` (60 l) | `callAI(messages, {stream,maxTokens})`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | `ai-assistant`, `ai-matching`, `ai-ticket-responder`, `ai-writer` | OpenAI-compatible `POST {base}/chat/completions`; defaults `https://openrouter.ai/api/v1` + `deepseek/deepseek-chat-v3-0324`, temp 0.7, max_tokens 8192, top_p 0.95. Adds `HTTP-Referer`/`X-Title` only for openrouter. Key never leaves the server; a missing key is each caller's decision (500 vs deterministic fallback). |
| `urlGuard.ts` (209 l) | SSRF guard: `assertSafeOutboundUrl[Resolved]`, `isSafeOutboundUrl`, `UnsafeUrlError` | **Nobody.** Dead code — grep finds only self-references. | Would reject non-HTTPS, loopback/RFC1918/link-local/metadata literals, single-label hosts, and DNS-resolved private IPs. Its absence means SSRF defence is per-function: `verify-document` has its own host-pinned check (`verify-document/index.ts:83-117`); `internship-applications` fetches admin-supplied letter URLs unvalidated (`internship-applications/index.ts:59-77`). |
| `errors.ts` (51 l) | `clientError(err, fallback)`, `logServerError` — log full detail, return a generic message | **Nobody.** Dead code. | Because it is unused, "log server-side, return generic" is not enforced; raw Postgres/PostgREST/gateway text can reach clients (§9). |

There is **no shared rate-limit helper and no shared auth helper.** Each function re-implements `checkRateLimit` (and `verifyAdminSession` exists only inside `admin-data`). That duplication is the single largest source of behavioural drift in this layer (compare §3 rate-limit column).

---

## 3. Function inventory (33)

`JWT` = platform `verify_jwt`. "Money" = moves/credits/holds money or escrow. Failure mode = the most consequential thing that goes wrong, not every error branch.

| # | Function | Purpose | Caller / auth model | JWT | External | Rate limit | Idempotency | Money | Notable failure mode |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `admin-data` | Admin console proxy: `counts`, `query`, `insert`, `PATCH` update, `DELETE` over a 64-table allow-list; `storage_upload`, `issue_certificate`, QR tokens, admin/welcome emails, `purge_orphans`. Public: certificate + credential-QR verification | User JWT → `verifyAdminSession` (`profiles_private.is_admin`, with an **email fallback**); `send_welcome_email` = any signed-in user, own email only; 2 public verify actions | true | Brevo, Storage, 4 RPCs | failed admin auth 10/15 min/IP; public verify 10/15 min/IP | n/a (direct CRUD) | adjacent — writes to `wallets`/`escrow`/`transactions` return 403 (`:48-62`) | Any regression here is whole-console PII/payment exposure; `is_admin`/`email`/`phone` writes blocked by a column allow-list (`:70-78`) |
| 2 | `admin-signup` | Creates an admin: verifies `ADMIN_SIGNUP_SECRET`, then `grant_admin_role(auth uid)` | Signed-in user + shared secret in body | true | none | 5/15 min/IP | secret compare is constant-time; role grant is idempotent in SQL | no | missing secret → 500; wrong secret → 401; uses the **JWT** uid, never a body id (`:88-92`) |
| 3 | `admin-withdrawal` | Withdraws platform 5% commission to the admin's bank/UPI via RazorpayX | User JWT + `profiles.role='admin'` or `profiles_private.is_admin` (`:130-143`) | true | RazorpayX | 5/hour | `create_admin_withdrawal` books server-side against the commission ledger; `finalize_admin_withdrawal` after payout | **yes** | Config-like payout errors (404/credentials) → `queued:true` 200 with the row `pending`; real payout failure → `failed` + 500 with provider text; insufficient commission → 400 (`:174-279`) |
| 4 | `ai-assistant` | Streaming AI chat (SSE) for freelancers/clients | User JWT (`:299-306`) | true | OpenRouter | 60/min + client 100/day | usage rows append-only, summed per month | no | `user_role` is taken from the **body** and drives the free/Pro gate (§9) |
| 5 | `ai-matching` | Deterministic skill scoring + LLM re-score; writes `ai_matches` | User JWT; project fetched `WHERE client_id = authData.user.id` **before** spend (`:270-277`) | true | OpenRouter | 60/min + 100/day | full rewrite of `ai_matches` for the project | no | Gateway fail → still 200 with `ai_enhanced:false` (looks healthy); non-owner now 404 |
| 6 | `ai-ticket-responder` | Drafts/resolves support-ticket replies with prompt-injection defanging | User JWT (ticket owner or admin) (`:186-254`) | true | OpenRouter | 20/min | n/a | no | Ticket text is attacker-controlled; sanitiser + truncation is the only barrier |
| 7 | `ai-writer` | Generates project/service/cover-letter text | User JWT; role + Pro read from `profiles` (`:198-215`) | true | OpenRouter | Free 5/day, Pro 100/day, client fields 100/day fair-use; atomic `increment_rate_limit` | `rate_limits` unique `(identifier,route,window_start)` + atomic RPC | no | Gateway failure → 502 (not a silent fallback); missing key → 500/502 on first call |
| 8 | `avatar-upload` | Avatar upload to the `avatars` bucket + profile URL | User JWT | true | Storage | 20/min | overwrite by filename (`{userId}/…`) | no | Upload then profile update; storage object rolled back on update failure (`:164-166`) |
| 9 | `delete-account` | **Immediate** full-cascade deletion (`delete_user_all_data`) + storage sweep | User JWT | true | Storage (9 buckets) | 3/hour | RPC is transactional; storage best-effort | no | Storage cleanup is best-effort and never blocks deletion (`:123-139`) |
| 10 | `email-notifications` | Sends 10 branded transactional emails (withdrawal, dispute, escrow, milestone, KYC, suspension, ticket) | User JWT; recipient must be a contract counterparty, else admin (`:512-583`) | true | Brevo | 10/hour **in-memory** per user | none | no | In-memory limiter resets per instance; missing Brevo key = silent no-op (200) |
| 11 | `file-upload` | Workspace deliverables to private `contract-files`; list via signed URL; delete | User JWT + contract participant check (`:160-172`); delete re-checks (`:250-259`) | true | Storage | 30/min | filename-based; DB row + object | no | 25 MB cap; bucket is private, URLs signed for 3600 s |
| 12 | `internship-applications` | `POST` public application; `GET` list + `PATCH` status/offer letters (admin only) | POST public; GET/PATCH admin (`:1008-1020`) | true | Brevo, Storage | 30/min/IP (best-effort try/catch) | DB row per applicant | no | Public POST is a spam surface; admin branch carries full applicant PII |
| 13 | `invoice` | Renders a print-ready HTML invoice (or JSON) for participants | User JWT; **RLS** decides access (`:43-56`) → 404 for non-participants | true | none | none | read-only | no | A plain browser tab carries no `Authorization` header → 401 unless the client fetches with the JWT (§9) |
| 14 | `kyc-submit` | Real-time KYC: resolves pending row, provider PAN check, writes verdict | User JWT; row ownership re-checked (`:338-347`) | true | Surepass (or dev adapters) | 5/hour | pending row + duplicate-identity pre-flight; one active row per user | no (audit row only) | Provider missing → `review`, never verified; `document_hash` is GENERATED — never write it (`:495`) |
| 15 | `milestone-auto-release` | Hourly cron: auto-release delivered milestones/full contracts, send 12 h reminders | `CRON_SECRET` bearer (env or DB) | **false** | Brevo | none (cron) | SQL re-verifies the elapsed window; reminder dedupe by notification metadata | **yes** (escrow) | Releases go through `auto_release_milestone`/`auto_release_contract`; the 0-credit milestone bug was fixed in `20270119000018` — a regression would mark milestones paid with no wallet credit |
| 16 | `newsletter-subscribe` | Public waitlist/newsletter signup + Brevo welcome | **Public** (service-role client) | true (but no identity check) | Brevo | 5/hour **in-memory** per IP | `join_waitlist` RPC; disposable-domain check | no | Unauthenticated write path; protection is the RPC guard + in-memory limiter |
| 17 | `notification-preferences` | Get/set per-category channel preferences | User JWT; `p_user_id = user.id` | true | none | 30/min | upsert semantics | no | RPCs are owner-guarded (`get/set_notification_preferences`) |
| 18 | `notifications` | List/archive/restore notifications; register/unregister push tokens | User JWT | true | none | 30/min | RPC-guarded writes | no | Push tokens are stored but **no push provider is called** anywhere |
| 19 | `paypal` | PayPal order create/capture/refund/cancel/get | User JWT + resource ownership | true | PayPal Orders v2 | 20/min | PayPal status (`COMPLETED` → `already_captured`) + idempotent `fund_escrow` | **yes** | Defaults to `currency='USD'` while amount comes from INR rows, and adds **no** 5% fee (§9) |
| 20 | `paypal-webhook` | PayPal events: capture, refund, disputes, subscriptions, payouts | Signature via PayPal API | **false** | PayPal verify API | none | No event table — relies on `paypal_orders` status + idempotent RPCs | **yes** | Replay is only partially deduped; `fund_escrow` error is not checked (`:149-153`) |
| 21 | `process-deletion` | Processes deletion requests past the 7-day cooldown | `x-cron-secret` **or** admin JWT (`:19-67`) | true | none | none | `process_account_deletion` per request; status filter | no | Header name differs from every other cron (`x-cron-secret`, not Bearer) |
| 22 | `proposal-notifications` | Emails/in-app notifications on proposal accept/reject | User JWT; caller must own the project (or admin) (`:274-279`) | true | Brevo | 20/hour **in-memory** | none | no | Recipient address derived server-side; body email never trusted |
| 23 | `razorpay` | Orders (`create_order` 7 types, `verify_payment`, refunds, saved cards, fund accounts, payouts) + cron `execute_refund` | User JWT (ownership per resource) or `CRON_SECRET` for `execute_refund` | true | Razorpay, RazorpayX | 20/min per user | order status `captured` guard, Grow-Coin reservation, refund-request state | **yes** | All domain errors return **500** with raw message (`:1394-1398`) — including auth failures |
| 24 | `razorpay-payout-webhook` | RazorpayX payout status → `withdrawals`/`transactions` | HMAC signature | **false** | none | none | terminal-state skip (`:89-96`) | **yes** | `importKey(..., ['verify'])` then `sign()` (`:29-30`) — likely throws → 500; completed path never calls `process_withdrawal_complete` |
| 25 | `razorpay-webhook` | Payment/refund events → escrow funding, wallet credit, refund reconciliation | HMAC signature | **false** | none | none | `payment_webhook_events` unique `event_id`; status guard; dup txn check | **yes** | Missing secret → 500 (fail closed); unknown order → 200 acknowledged |
| 26 | `request-deletion` | Starts/cancels a 7-day deletion request, status lookup | User JWT | true | none | 3/hour | `request_account_deletion` token + status machine | no | RPC historically failed on NOT NULL `confirm_token` (fixed `20270119000010`) |
| 27 | `reviews` | Create/update/delete reviews; contract or contest participant only | User JWT; reviewee must be the counterparty (`:153-162`) | true | none | 20/min | one review per reviewer+contract (`:166-176`) | no | Reputation writes flow through triggers/`update_reputation_score` |
| 28 | `security-alert-notify` | Emails unresolved `security_alerts` to the admin | `CRON_SECRET` bearer | **false** | Brevo | none | none (email per run) | no | Alert email is the only signal; a Brevo outage silences drift notifications |
| 29 | `submit-report` | Bug/feature/feedback/security report → `user_reports` + company inbox | JWT **or anonymous** (user optional, `:148-149`); rate limit keyed by IP | true | Brevo | 5/15 min/IP | none | no | Anonymous report form; body `name`/`email` are user-supplied (no identity claim) |
| 30 | `subscription-billing-cron` | Daily 00:00 UTC: expire trials, renew actives with a real saved-card charge, reminders | `CRON_SECRET` bearer | **false** | Razorpay payments | none | `saved_payment_cards` + subscription status transitions; no charge idempotency key | **yes** | No saved card / no keys → `past_due`, never a free renewal (`:87-116`) |
| 31 | `twofa-management` | TOTP MFA status/enable/disable + recovery codes | User JWT; all RPCs keyed to `user.id` | true | none (Supabase Auth MFA) | 10/min | RPC state machine | no | `enable_user_mfa` is called with an empty TOTP secret (`:214`) — enrolment semantics are RPC-side |
| 32 | `verify-document` | AI vision check + OCR of an ID document before KYC submission | User JWT; URL must be the caller's own `verification-documents` object (`:83-122`) | true | OpenRouter vision (`openai/gpt-4o-mini`) | 10/min | stateless | no | PII (document images) goes to the AI gateway; no result is persisted here |
| 33 | `withdrawal` | Freelancer payout: RazorpayX `/v1/payouts` (PayPal path hard-blocked), history | User JWT; fund account resolved server-side (`:239-259`) | true | RazorpayX, PayPal (blocked), Brevo | 10/hour | rate limit + wallet hold; no client-supplied idempotency key | **yes** | Config-like provider errors → **queue** (`pending`, funds held); real errors → rollback; raw provider text returned |

---

## 4. Deep dives

### 4.1 Razorpay — `create_order` (`razorpay/index.ts:237-593`)

1. Reject if `RAZORPAY_KEY_ID`/`_SECRET` are unset **before touching the body** → 500 "Payment service is not configured" (`:137-142`).
2. Parse `{action, data}`; missing/non-string action → 400 (`:165-170`).
3. `auth.getUser()` on the caller's JWT. `test_auth` is a rate-limited diagnostic that returns only `{ok, key_id_prefix, key_id_mode}` — never the raw Razorpay payload (`:177-207`).
4. Rate limit 20/min per `user.id` (IP fallback). Cron `execute_refund` skips it (`:224-231`).
5. **Amount is recomputed, never read from the body** (`:255-437`), per `order_type`:
   * `contract_escrow`: contract fetched with `client_id`; `client_id !== user.id` → error. `metadata.milestone_indices` selects milestones, but their amounts come from `contracts.milestones`; fee = stored `platform_fee` (full funding) or `round(amount*0.05,2)`.
   * `subscription`: `subscriptions.user_id` must match; price from `subscription_plans.price`.
   * `service_purchase`: tier + addon **IDs** only; prices from `services.packages`/`addons`; an accepted `service_offers` row owned by the caller may replace the tier price (bounded 50 … max(2×list, 5000)); tip only if `accepts_tips`; +5% fee.
   * `card_verification`: fixed ₹1. `wallet_topup`: ₹50–₹1,00,000. `contest_prize`: pool from `contests` + 5%, refuses if `prize_funded`. `revision_payment`: `revision_requests.total_amount` with `status='accepted'`.
6. Grow Coins: integer ≥ 100, balance from `get_grow_coin_balance`, 1 coin = ₹1, capped at `floor(amount)-1`, only on `contract_escrow`/`service_purchase` (`:439-475`).
7. `validAmount ≤ 100000`, converted to paise; `POST /orders` with `receipt` + `notes` (`:477-501`).
8. Insert `razorpay_orders` (`status:'created'`), **stripping client coin fields** from `metadata` and writing back only server-computed ones (`:503-529`).
9. `reserve_grow_coins_for_order` via service role; on failure mark the order `failed` and throw (`:553-563`).
10. `insert_payment_audit_log('order_created')`; return `{order, razorpay_order, razorpay_key_id, amount, currency, grow_coins_used}`.

**Idempotency:** none at order creation (each call = a new gateway order). The money-safety property is that the amount cannot be influenced by the caller.

### 4.2 Razorpay — `verify_payment` (`:640-925`)

1. Require `razorpay_order_id | razorpay_payment_id | razorpay_signature` (400-class error, surfaced as 500).
2. HMAC-SHA256(`${order_id}|${payment_id}`) keyed by `RAZORPAY_KEY_SECRET`, hex-compared (`:651-671`). Mismatch → "Invalid payment signature".
3. Load `razorpay_orders`; `user_id !== user.id` → "Unauthorized to verify this order" (`:673-681`).
4. **Idempotency #1:** `status === 'captured'` → return `{already_processed: true}` without side effects (`:683-693`).
5. Fetch `/payments/{id}`; reject if `paidAmount < orderAmount - 0.01` (`:695-703`).
6. Service-role update to `captured` + `razorpay_payment_id/captured_at/signature` (`:708-720`).
7. Grow Coins: `redeem_reserved_grow_coins(order id)`; on failure insert a `grow_coin_review_flags` row (`redemption_shortfall`) — loud, human-visible, never silently dropped (`:722-736`).
8. Insert `razorpay_transactions` (`transaction_type:'capture'`).
9. Branch by order type, each guarded by the single-use `captured` transition:
   * contract → `fund_escrow(contract_id, user.id)` in the **user** session (`:753-758`), then notify both parties;
   * subscription → service-role `subscriptions.status='active'` (`:784-792`);
   * service purchase → `create_service_purchase_contract` (service role, recomputes prices) then `fund_escrow` in the user session, then `increment_service_orders` (`:799-858`);
   * revision → `mark_revision_paid`; wallet top-up → `update_wallet_balance` + a `transactions` credit row (`:864-904`).
10. `insert_payment_audit_log('payment_captured')`.

**Money invariant:** the `captured` status is the idempotency key; every credit path is reachable exactly once per order, and the webhook respects the same transition.

### 4.3 Razorpay webhook (`razorpay-webhook/index.ts`)

1. Missing `RAZORPAY_WEBHOOK_SECRET` → **500, no processing** (`:160-162`). Missing signature → 400. Invalid HMAC → 401 (`:164-175`). Raw body is used, never re-encoded.
2. `eventKey = "${event}|${orderId}|${paymentId}|${refundId}"` (`:62-76,186`).
3. Look up `payment_webhook_events.event_id`; duplicate → mark `replayed`, return 200 `duplicate_event` (`:198-210`). Otherwise insert with `status:'processed'`; insert failure → 500 so Razorpay retries.
4. `order.paid` / `payment.captured`: unknown order → audit + 200 `unknown_order`; already captured → **self-healing** path calls `redeem_reserved_grow_coins` and retries `admin_fund_escrow` (`:260-294`).
5. First capture: update order → dedupe `razorpay_transactions` by `payment_id`+`type` → redeem coins → `admin_fund_escrow` → notify → activate subscription → `increment_service_orders` / `mark_revision_paid` / `admin_fund_contest_prize` / `update_wallet_balance` + `transactions` (`:296-491`).
6. `payment.failed` → order `failed` + notify (never downgrades a captured order). `payment.authorized` → audit only, no funding. `refund.created` → notify + audit. `refund.processed` → order `refunded`, `refunds`/`refund_requests` completed, `_refund_history_event`, `admin_reverse_escrow`, an informational `transactions` row (idempotent by `metadata->>razorpay_refund_id`) (`:597-755`).
7. Unhandled events → audit + 200 so Razorpay stops retrying. Any thrown error → event row `failed` + 500 (`:765-771`).

### 4.4 PayPal (`paypal/index.ts`, `paypal-webhook/index.ts`)

* **Create** (`:293-433`): mirrors the Razorpay amount-derivation structure (contract/subscription/contest/service) with the same ownership checks, but `contract_escrow` charges `contract.amount` **without the 5% fee** (`:324`) and the default currency is `USD` (`:296`). `paypal_orders` row stores order id, amount, currency, metadata.
* **Capture** (`:434-525`): ownership check → `GET /v2/checkout/orders/{id}`; `COMPLETED` → `already_captured`; `APPROVED` → capture, update order `captured`, insert `paypal_transactions`, `fund_escrow`, activate subscription.
* **Refund / cancel subscription / get order** follow the same ownership pattern (`:527-690`).
* **Webhook**: verifies through PayPal's verify-webhook-signature API with `PAYPAL_WEBHOOK_ID`; missing ID **throws** → 403 (`:20-60,82-88`). Handles capture completion, refunds (`admin_reverse_escrow` + visibility row), disputes, subscription lifecycle, and PayPal **payout** events for withdrawals (`release_wallet_funds` on failure). There is **no `payment_webhook_events` equivalent** — replay safety rests on resource status and idempotent RPCs.

### 4.5 Payout webhook + withdrawal

**`withdrawal` (in-app):**
1. JWT → 401; rate limit 10/hour (`:185-205`).
2. `withdrawal_method`: `razorpay_payout` (default) or `paypal` — **PayPal is hard-blocked** with 400 because the wallet holds INR and the payout call would label it USD (`:219-227`).
3. Fund account resolved **server-side** from `payout_methods` (`id + user_id`), falling back to the stored `razorpay_fund_account_id` or the UPI VPA; never trusts a body `fund_account_id` (`:233-259`).
4. Balance from `get_wallet_balance`; `available = balance - pending_balance`; insufficient → 400 with both numbers (`:262-270`).
5. Fee 2% (`razorpay_payout`) / 2.9% (unreachable PayPal); insert `withdrawals` row (`pending`) → `hold_wallet_funds` (service role; failure deletes the row) → `transactions` debit `pending` (`:272-298`).
6. `POST /v1/payouts` with `reference_id: wd_<id12>`, `queue_if_low_balance:true`. Map `processed/completed` → completed, `failed/cancelled` → failed, else processing; store `razorpay_payout_id`; on synchronous completion call `process_withdrawal_complete` (`:307-348`).
7. On provider error: if the message looks config-like (404 "URL was not found", invalid credentials, payouts not enabled), keep the row **`pending` with funds held** and return `{queued:true}` (`:398-433`). Otherwise `rollbackWithdrawal` → `release_wallet_funds` + `failed` + transaction failed, email the user, return 500 (`:435-450`).

**`razorpay-payout-webhook`:** HMAC verify → find withdrawal by `razorpay_payout_id` → skip if already `completed`/`failed` → `failed`: `release_wallet_funds` + transaction failed; `completed`: transaction completed only → update status (`:89-124`).

**Accounting gap:** the document's own comment says `process_withdrawal_complete` is what deducts `pending_balance`, but the webhook's completed branch never calls it, and the function now rejects callers with no `auth.uid()` (§9). Net effect: a payout confirmed only by webhook can leave funds in `pending_balance`.

### 4.6 Escrow / milestone cron (`milestone-auto-release/index.ts`)

* Triggered hourly at `:05` by `cron.job growlancer-milestone-auto-release` → `process_milestone_auto_release()` → `net.http_post` with `Authorization: Bearer <cron_settings.cron_secret>` (`20261211000001_schedule_milestone_auto_release.sql:10-38`).
* Auth: `CRON_SECRET` env **or** `cron_settings.cron_secret`; no bearer → 401 (`:60-69`).
* Scan: contracts in `active|in_progress|submitted|approved|revision_requested`; skip `disputed` or `frozen_at` (`:79-104`). Per milestone (`status='delivered'`, `delivered_at`), window = `auto_release_hours` (default 10). Milestone-less contracts use contract-level `delivered_at` (`:106-170`).
* Release: `auto_release_milestone(contract_id, index)` / `auto_release_contract(contract_id)`; a `success:false` is logged as `SKIP-…`, not treated as success (`:172-185`).
* Reminders: last 12 h, deduped by an existing notification with `metadata->>event='auto_release_reminder'` + contract (+ milestone index); email resolved from `profiles_private` (`:187-260`).
* **Defence in depth:** the SQL re-verifies the elapsed window and is the only writer of escrow — the edge function never updates escrow directly.

### 4.7 AI quota / rate limiting

* **Per-minute abuse guard** (all AI functions): `rate_limits` row **count** in a sliding window (`ai-assistant:85-113`, `ai-matching:93-124`, `ai-writer` legacy, `ai-ticket-responder`). Fails **open** if the count query errors (`ai-matching:110-113` returns `true`).
* **Daily allowances**: `ai-writer` stores one row per `(user, route, UTC day)` and gates on the `count` **column**, incremented atomically by `increment_rate_limit` (server-only `SECURITY DEFINER`, `20270119000022`); Free 5, Pro 100, client fields 100 fair-use. `ai-assistant` counts `usage_logs` rows (SUM) for the month — Free 10 messages, Pro unlimited, clients unlimited (`ai-assistant:128-174`), and appends `feature_type='ai_assistant'` per message (`:120,385-390`).
* **Pro detection**: `ai-assistant` reads `subscriptions` (`active|trial`); `ai-writer` reads `profiles.is_pro` + `profiles.role`. Two different sources of truth for "is this user paying" (§9).
* **Business model:** client AI is never paywalled — the 429 body for client fields is a neutral "try again later", with `freeForClients:true` (`ai-writer:237-249`).

### 4.8 KYC (`kyc-submit/index.ts`)

1. Browser creates its own `identity_verifications` **pending** row (RLS), then calls the function with `verification_id` (400 if absent).
2. JWT → 401; row must exist (404) and belong to the caller (403) (`:323-347`).
3. Cooldown / attempt cap (429, row updated to `rejected`), then **email gate**: `user.email_confirmed_at` must be set, else 400 and the row is rejected with `failure_category='email_unverified'` (`:395-403`).
4. PAN/name validation before spending money (`:433-448`); rate limit 5/hour (`:405-414`).
5. Provider config: `kyc_provider_config(api_token, mode)` from the DB wins, else `SUREPASS_API_TOKEN` env, else `null` → outcome `review`, `failure_category='provider_error'`, reason `provider_not_configured` — **never verified** (`:60-80,459`).
6. Adapter selection: DB `mode='development'` → deterministic `dev_mode` adapter (row `provider='dev_mode'`); env sandbox requires `KYC_DEV_MODE=true` + token + **project-ref match**; otherwise Surepass PAN Comprehensive with a 20 s timeout (`:42-49,148-259`).
7. Duplicate identity pre-flight (hash + name/DOB among verified rows of other users) → `duplicate_identity` (`:462-470`).
8. Service-role update of the row; `document_hash` is a **GENERATED** column — the function must not write it (`:495`). Audit row in `payment_audit_logs` (`action:'kyc_verification_attempt'`). Realtime pushes the verdict to the user's open page.

### 4.9 `admin-data` proxy

* Order matters: **public** actions first (`verify_certificate`, `verify_credential_qr`), then `send_welcome_email` (JWT + own-email+ IP limit), then `verifyAdminSession` for everything else (`:296-560`).
* `verifyAdminSession`: Bearer token → anon client `auth.getUser()` → `profiles_private.is_admin` by id; **if not found, retries by `user.email`** (`:245-266`) → returns `{user_id,email}` or `null` (401 downstream). Failed attempts only are rate-limited (10/15 min/IP).
* Reads/writes: `ALLOWED_TABLES` (64 entries) gates `query`/`insert`/`PATCH`/`DELETE`; `WRITE_BLOCKED_TABLES = ['wallets','escrow','transactions']` returns 403 with an explanatory message (`:14-62`); `profiles_private` writes are narrowed to `id, suspended_at, suspend_reason, suspended_by, banned_at, onboarding_completed` (`:70-78`).
* Side actions: `storage_upload` (service role, auto-creates a private bucket), `issue_certificate` (`generate_certificate_code`), `generate_qr_token`, `counts`, `test_email`, `send_admin_notification`, `send_certificate_email`, `purge_orphans` (`purge_orphan_user_data`).

### 4.10 Email notifications (`email-notifications/index.ts`)

* JWT → 401; in-memory 10/hour per user (`:24-38,468-483`); `type` + `data` required (400).
* Caller role from `profiles`, email from `profiles_private` (`:512-516`). Admin may send any supported type; a non-admin is restricted to types where `recipient` is the **other party of a shared contract** (`:530-580`) — mismatch → 403 and a `console.warn` naming the caller and target.
* Templates are inline HTML with `escapeHtml`; `sendEmail` failure is non-fatal (returns `false`), so the endpoint can return 200 while nothing was delivered.

---

### 4.11 AI gateway (Respan) — local routing for every AI workflow

Guide: https://github.com/respanai/respan-gateway?utm_source=freebuff&utm_medium=paid&utm_campaign=respan-gateway&bfcid=bfc_1.eyJpZCI6ImI1YTk2MzVkLWFlNzUtNDY1OS04MDM2LWE0NDA3YjllZjBhMyIsImMiOiIyMDM2ODZkZS1mMzg0LTQ4NTQtYmViNC1hYzBiYWRmNmM1NTUiLCJrIjoiM2IxMGE4YmUtNzgyOS00MmJhLWFmNmEtYmI0YWUxZTRhY2Y4IiwiaWF0IjoxNzk0MDQxODQ3fQ.yjjIR7hYgX35iCwTEFlvPqHdm-dmbXd3aGhRRBwlCiU

* **What it is:** [`respan-gateway`](https://github.com/respanai/respan-gateway) 0.3.0, the open-source LLM router (Python 3.10+, wheels for macOS/Linux x64+arm64, Windows x64), run locally as an OpenAI-compatible server. Not a dependency of the app: no hosted account, credits or tracing export is involved — it spends the developer's existing provider key.
* **Wiring:** `_shared/ai.ts` is still one `POST {base}/chat/completions`. With `AI_GATEWAY_URL` set (loopback, e.g. `http://127.0.0.1:8080`) the base URL becomes `{AI_GATEWAY_URL}/v1` and the app asks for the logical routes **`growlanzo-chat`** / **`growlanzo-priority`** instead of a vendor slug; `AI_MODEL` / `AI_PRIORITY_MODEL` still override. Unset (the production default) is byte-identical to before: `AI_BASE_URL` + `AI_MODEL` + the OpenRouter `provider: {sort:'latency'}` hint, which is **not** forwarded in gateway mode because it is an OpenRouter-only field.
* **Why:** provider order, retries (`tries`/`backoff`) and hedging (`hedge`) live in `gateway.toml` instead of each edge function, so a stalled or failing provider is retried in-process rather than surfacing as a dead chat reply (`docs/blueprint/BACKEND.md` §4.7 covers the quota side, unchanged).
* **Files:** `gateway.toml` — providers + routes, listens `127.0.0.1:8080`, **no `client_keys`**, therefore loopback only and never to be bound publicly; the provider key is `env:AI_API_KEY`, i.e. the existing secret, so there is no second credential to rotate. `requirements-gateway.txt` — the pinned `respan-gateway==0.3.0` (wheel-only). `scripts/e2e/respan-gateway-smoke.mjs` — the check below.
* **Run it:**

  ```bash
  python3 -m venv .venv
  .venv/bin/python -m pip install --only-binary=:all: -r requirements-gateway.txt
  .venv/bin/python -m respan_gateway -c gateway.toml   # http://127.0.0.1:8080, web UI at /ui/
  # then, for the edge functions that serve the app:
  #   AI_GATEWAY_URL=http://127.0.0.1:8080  (supabase secrets / functions env)
  ```

  Stop with Ctrl-C. Restart command: `.venv/bin/python -m respan_gateway -c gateway.toml`. `respan-gateway check -c gateway.toml` validates the config without calling a provider.
* **Verified (2026-11-07, `npm run e2e:gateway`, 18/18 checks):** the real `callAI()` ran against a gateway started with a throwaway loopback provider fixture. Observed: route `growlanzo-chat` → `fixture/broken-chat` twice (HTTP 500) → `fixture/fixture-chat` HTTP 200, reply `gateway-fixture-ok via fixture-chat`; the streaming Pro lane returned SSE ending `[DONE]` with the full text; no `provider` field was forwarded; the gateway was stopped afterwards (exit confirmed); with `AI_GATEWAY_URL` unset the module still defaults to `https://openrouter.ai/api/v1` + `deepseek/deepseek-chat-v3-0324`.
* **NOT verified:** a live model request. There is no provider key in this environment, so no provider was billed and no real completion was produced; the smoke check proves routing, retry, streaming and the app contract, not model output. Production is unaffected while `AI_GATEWAY_URL` is empty (Supabase Cloud cannot reach a developer's loopback).

---

## 5. Auth & authorization

| Mechanism | Implementation | Evidence |
|---|---|---|
| Caller identity | `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: req.headers.get('Authorization') } } })` then `auth.getUser()`. The returned `user.id` is the only accepted identity. | `razorpay:145-172`, `ai-assistant:299-306`, `withdrawal:174-195` |
| Service role | Second client with `SUPABASE_SERVICE_ROLE_KEY` used for: notifications, audit logs, cross-user reads, `profiles_private`, storage admin, and RPCs revoked from `anon/authenticated`. Never constructed from request input. | `razorpay:152-156`, `kyc-submit:37-40`, `withdrawal:29-32` |
| Admin (edge) | `verifyAdminSession` in `admin-data` only. Other admin-ish functions read `profiles.role='admin'` **or** `profiles_private.is_admin` (`admin-withdrawal:136-143`, `razorpay:959-968`), `process-deletion:57-67`, or `profiles.role` alone (`email-notifications:517`, `ai-ticket-responder:251`, `proposal-notifications:274`). | as cited |
| Cron | `Authorization: Bearer <CRON_SECRET>` for `razorpay/execute_refund`, `milestone-auto-release`, `subscription-billing-cron`, `security-alert-notify`; env secret **or** `cron_settings.cron_secret` (rotation safety). `process-deletion` uses `x-cron-secret`. | `razorpay:18-31`, `milestone-auto-release:32-45`, `process-deletion:19-26` |
| Webhook | HMAC of the **raw** body (`razorpay`, `razorpay-payout-webhook`, constant-time) or PayPal's verify API. Secrets missing ⇒ reject, never "skip verification". | `razorpay-webhook:37-59,160-175`, `paypal-webhook:20-60` |
| Failure posture | Auth failures are 401 (`403` when the caller is known but not allowed). **Exception:** `razorpay` maps every thrown error, including "Unauthorized…" and "Invalid payment signature", to **500** with the raw message (`:1394-1398`). | as cited |

**"Never trust request-body `user_id`/`amount`" — as implemented**

| Rule | Where it holds | Evidence |
|---|---|---|
| Amount/price derived server-side | `razorpay` create_order (all 7 types), `paypal` create_order, `admin-withdrawal` (commission ledger), `subscription-billing-cron` (plan price), `withdrawal` (fee from its own rate) | `razorpay:255-437`, `paypal:309-375`, `admin-withdrawal:175-186` |
| Path/resource params re-scoped to the caller | `ai-matching` (`client_id = auth.uid`), `kyc-submit` (row owner), `withdrawal` (`payout_methods.id + user_id`), `file-upload` (contract participant), `invoice` (RLS) | `:272`, `:338-347`, `:241-246`, `:160-172`, `:49-56` |
| Body `user_id` ignored | `ai-assistant` (`user_id = authUser.id`), `admin-signup` (`userId = user.id`), `delete-account`, `twofa-management`, all notification RPCs use `user.id` | `ai-assistant:306`, `admin-signup:91-92`, `twofa:106+` |
| Body **role/flag** trusted (deviation) | `ai-assistant` takes `user_role` from the body and uses it to skip the 10/month freelancer cap (`:318-335`) — a freelancer can send `user_role:'client'`; `submit-report` takes `name`/`email` from the body for the email (no privilege attached) | `ai-assistant:318-335`, `submit-report:157-160` |

---

## 6. External integrations

| Integration | Env names (values never printed) | Mode switches | What fails closed |
|---|---|---|---|
| Razorpay Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | key prefix `rzp_test_`/`rzp_live_` only *reported* (`test_auth`), never enforced | Keys missing → 500 before body parse (`razorpay:137-142`); webhook secret missing → 500 (no processing) |
| RazorpayX Payouts | `RAZORPAY_ACCOUNT_NUMBER` (+ same key pair) | `payout_mode` (default `UPI`) | Provider errors classified config-like ⇒ **queue with funds held**, real errors ⇒ rollback; withdrawal is blocked entirely for PayPal |
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX` (`'true'` → sandbox host), `PAYPAL_WEBHOOK_ID` | `VITE_PAYPAL_ENABLED` (frontend, currently `false`) | Webhook ID missing → 403; credentials missing → logged + API calls fail; **payout path blocked in code** (`withdrawal:225-227`) |
| Brevo email | `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | none | **Not** fail-closed by design: missing key = `false` + log, request still succeeds (`brevo.ts:39-43`) |
| AI gateway | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`; optional `AI_GATEWAY_URL` → local Respan Gateway (`gateway.toml`) | OpenRouter defaults; `AI_BASE_URL` allows any OpenAI-compatible gateway, `AI_GATEWAY_URL` switches to the gateway's `growlanzo-chat` / `growlanzo-priority` routes | `ai-assistant`/`ai-writer`/`verify-document` → 500/502; `ai-matching` degrades to deterministic scores with `ai_enhanced:false` |
| KYC provider | `KYC_PROVIDER` (`surepass`), `SUREPASS_API_TOKEN`, `SUREPASS_BASE_URL`; sandbox `KYC_DEV_MODE`, `KYC_DEV_TOKEN`, `KYC_DEV_PROJECT_REF` | DB `kyc_provider_config.mode` = `production` or `development` (admin-toggled, audited) | No token → row `review`, never `verified`; dev mode needs three independent gates |
| Storage | `SUPABASE_URL` + service role | buckets: `avatars`, `profile-pictures`, `company-logos`, `portfolio-images`, `contract-files`, `verification-documents`, `certificate_documents`, `internship_documents`, `internship_resumes`, `videos` | Private buckets are served via 1 h signed URLs; deletion sweep is best-effort |
| Supabase Auth email | Dashboard-managed SMTP (`config.toml:272-274`, `enable_confirmations = false` locally) | Custom SMTP **off** | N/A — not an edge-function dependency |
| Sentry / APM | **No server-side Sentry.** Only `VITE_SENTRY_DSN` (frontend) exists in `.env.example`. | — | Observability = `console.*` + `payment_audit_logs` / `security_alerts` / `payment_webhook_events` tables |
| App URL | `APP_URL` (only `_shared/site.ts` reads it) | Secret switch = domain change with no code edit | Falls back to `https://growlancer.vercel.app` + `console.warn` |

---

## 7. Deploy & operations

### 7.1 `backend-deploy.yml` (push to `main` touching `supabase/**` or the workflow; also `workflow_dispatch`)

| Stage | Behaviour | Evidence |
|---|---|---|
| 1. Access-token guard | `SUPABASE_ACCESS_TOKEN` missing → `::error::` + exit 1 | `:39-46` |
| 2. DB connection | `SUPABASE_DB_URL` if set, else derive the session-pooler URL from `SUPABASE_DB_PASSWORD`; neither → fail. Value never echoed | `:52-69` |
| 3. Pentest-secret guard (fail-closed) | `SUPABASE_SERVICE_ROLE_KEY` + `VITE_SUPABASE_ANON_KEY` missing → fail **before** deploying | `:76-89` |
| 4. Drift check `pre` | Remote-only migrations (live but not in repo) and **duplicate version numbers** fail; repo-only pending migrations pass | `:101-166` |
| 5. `db push` | `npx supabase db push --db-url …`, deliberately **no** `--include-all` (comment explains the 2026-10-15 duplicate-version incident) | `:185-190` |
| 6. Drift check `post` | Both directions must be empty → proves the push landed | `:192-196` |
| 7. Function loop | `for dir in supabase/functions/*/` → skip `_shared` → `functions deploy <name> --project-ref $SUPABASE_PROJECT_REF`; any failure sets exit 1 after trying the rest | `:198-214` |
| 8. Pentest | `scripts/e2e/pentest-privileges.mjs` (throwaway accounts, real JWTs, escape attempts) | `:228-241` |
| 9. Whole-surface audit | `scripts/e2e/surface-audit.mjs` (anon reads, cross-user reads, invariants) | `:254-264` |

Secrets the workflow needs: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`, and one of `SUPABASE_DB_URL` / `SUPABASE_DB_PASSWORD`.

### 7.2 Local dev & manual commands

```bash
supabase start                     # local stack (API 54321, DB 54322, Studio 54323, Inbucket 54324)
supabase functions serve <name> --env-file .env.local
supabase functions deploy <name> --project-ref zttwsjehcgaicziqyxpq   # emergency only, then commit
supabase migration list            # local vs remote; must agree before any push
supabase secrets list              # NAMES only — never print values
```

Local `config.toml` auth URLs are localhost-only by design; `supabase config push` must never be run with `site_url = http://localhost:5173` or every live verification/reset link breaks (`config.toml:157-163`). The live Auth URL list is written by `scripts/push_redirect_urls.mjs` from `APP_URL`.

### 7.3 Naming, packaging, rotation

* **Naming:** lowercase kebab-case directories that equal the URL slug (`/functions/v1/<dir>`); one `index.ts` per function; no shared code outside `_shared`.
* **`_shared` exclusion:** it is a directory in `supabase/functions/` but is *never* deployed — it has no `index.ts`, and both the loop and the platform treat it as an import target only. Adding `_shared/index.ts` would make it deployable and is a mistake.
* **Deploy unit:** every push redeploys **all 33** deployable functions, not only the changed ones. A function whose secret was removed fails at runtime, not at deploy time — the workflow cannot detect that.
* **Rotation:** rotate `CRON_SECRET` in both places (`supabase secrets` and `cron_settings.cron_secret`) or use the dual-read fallback; rotate `RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` in the gateway dashboard *and* secrets (a mismatch means webhooks 401 and refund verification fails); `ADMIN_SIGNUP_SECRET` rotation invalidates in-flight admin signups only. Values are never committed, printed, or logged.
* The cron secret is stored **in plaintext** in `cron_settings` and is therefore visible in `cron.job.command` for every job that embeds it — acceptable for this threat model, but it means DB read access ≈ cron invocation.

---

## 8. Playbook

### 8.1 Adding an edge function

1. **Decide auth first** (this determines everything else): user JWT → leave `verify_jwt` default; webhook → `verify_jwt = false` **plus** signature verification; cron → `verify_jwt = false` **plus** `CRON_SECRET`; public → no identity, so rate-limit and validate hard.
2. Create `supabase/functions/<kebab-name>/index.ts`; use `Deno.serve`, import `getCorsHeaders` from `../_shared/cors.ts`, and `SITE_URL` from `../_shared/site.ts` for any link (never hardcode an origin — `src/test/siteUrlGuard.test.ts` fails the build).
3. Authenticate: anon client with the caller's `Authorization` → `auth.getUser()` → 401. Never read `user_id` from the body. For a resource, re-query it with the caller's id in the `WHERE` clause and 404/403 before doing any work.
4. Rate limit: DB-backed (`rate_limits` + `cleanup_expired_rate_limits`) mirroring the nearest function; use the atomic `increment_rate_limit` RPC whenever the window has a unique key per user/route/window. In-memory Maps are per-instance only — do not use them for money paths.
5. Money: derive every amount from the DB, take only IDs from the client, call a `SECURITY DEFINER` RPC (never a direct table update), and gate on a state transition for idempotency. Webhooks: verify the **raw body**, record an event key in `payment_webhook_events`, return 2xx only after processing (or 4xx for bad signatures).
6. Errors: log full detail server-side with a `[fn-name]` prefix; return `{ error }` with a real status (400/401/403/404/429/500). Do **not** return `error.message` from upstream — either adopt `_shared/errors.ts` or sanitise manually.
7. Tests/guards: add a source-level guard in `src/test/` if the invariant can regress silently (the repo already guards CORS, site URLs, AI ownership, migration SQL). Exercise the function against the local stack or a throwaway-account probe.
8. `config.toml`: add a `[functions.<name>]` block **only if** `verify_jwt` must be `false` — and write the reason in a comment next to it. Never add `--no-verify-jwt` to the workflow.
9. `npm run docs:map` (new structural file), then push; watch the Backend Deploy run: drift `pre` → `db push` → drift `post` → 33-function loop → pentest → surface audit, and report the run id.

### 8.2 Modifying a money or webhook function safely

1. Read the **RPC** it calls, not only the edge code — the guard may already be NULL-safe or service-role-aware (or not). Check `pg_get_functiondef` semantics in the latest migration that defines it.
2. Keep the amount derivation server-side and the state-transition idempotency key intact; if you add a branch, add it to **both** the verify path and the webhook path (they must agree, or one silently under-credits).
3. Check the **service-role vs user-session** requirement of each RPC: `fund_escrow` accepts service role, `process_withdrawal_complete` currently does **not** (§9), wallet hold/release tolerate `auth.uid() IS NULL`.
4. Webhooks: never re-encode the body before HMAC; keep the "secret missing ⇒ reject" branch; keep the event log insert before side effects; return 500 on processing failure so the provider retries.
5. Migration + assertions: any new/changed RPC goes in a migration with fail-closed assertions and the SQL lexer guard (`src/test/sqlMigrationSyntax.test.ts`) must pass.
6. Dry-run on the live DB in a rolled-back transaction, then push and confirm the pentest/surface audit steps actually ran (they fail closed now).

---

## 9. Known gaps, contradictions, and risks

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | **`process_withdrawal_complete` rejects service-role callers.** Latest body returns `Unauthorized` when `auth.uid()` is NULL, while `withdrawal` calls it with the service-role client and ignores the result. Effect: a synchronously completed payout never deducts `pending_balance` (the exact bug the comment claims to fix). Latent today because RazorpayX payouts 404 → queued. | **High (money, latent)** | `20270130000000_restore_null_safe_money_guards.sql:98,106-109`; `withdrawal/index.ts:341-343`; grants still include `service_role` (`:306-307`) |
| 2 | **`razorpay-payout-webhook` imports the HMAC key with `['verify']` then calls `crypto.subtle.sign`** — WebCrypto rejects a `sign` with a verify-only key, so the handler likely throws into its catch and returns 500 for every payout event. | **High (webhook never processes)** | `razorpay-payout-webhook/index.ts:29-30,130-136` |
| 3 | **Webhook-completed payouts do not finalise the wallet**: the `completed` branch only flips `transactions`, never calls `process_withdrawal_complete`, so `pending_balance` can stay inflated. | **High (accounting)** | `razorpay-payout-webhook/index.ts:109-124` |
| 4 | **Queued withdrawals are not retried.** `withdrawal` tells the user the payout "will be processed as soon as the payout service is configured", but `process_stale_withdrawals` actually marks them `failed` after 72 h and refunds the wallet. No migration schedules that function, `CLAUDE.md`'s "every 15 min retry cron" has no repo counterpart, and `admin_withdrawals` is not covered by the stale sweep at all. | **High (docs/behaviour)** | `withdrawal/index.ts:402-432`; `20261003000000_restore_razorpay.sql:68-120`; `admin-withdrawal:243-261`; no `cron.schedule` for it |
| 5 | **PayPal omits the 5% platform fee and defaults to USD** while prices come from INR rows — Razorpay's comment claims "parity with the PayPal path". UI-disabled today (`VITE_PAYPAL_ENABLED=false`), so latent, but enabling PayPal without fixing this under-charges (and mislabels currency). | **High if enabled** | `paypal/index.ts:296,324,372`; `razorpay/index.ts:268-269`; `.env.example:38-43` |
| 6 | **`ai-assistant` trusts `user_role` from the request body** for the freelancer 10/month cap; a freelancer sending `'client'` bypasses it (and clients are promised free AI, so there is no money loss — quota integrity only). | Medium | `ai-assistant/index.ts:318-335` |
| 7 | **Two sources of truth for "Pro"**: `ai-assistant` reads `subscriptions`, `ai-writer` reads `profiles.is_pro`. A desync changes what a paying user is allowed to do. | Medium | `ai-assistant:139-149`; `ai-writer:198-215` |
| 8 | **`_shared/errors.ts` and `_shared/urlGuard.ts` are dead code.** Raw upstream/PostgREST messages reach clients (`razorpay`, `withdrawal`, `admin-withdrawal`), and user-influenced outbound fetches rely on per-function checks. | Medium | grep: no importers; `razorpay:1396`, `withdrawal:494`, `internship-applications:59-77` |
| 9 | **`verifyAdminSession` falls back to matching `profiles_private.email`** when the id lookup misses. That converts any future duplicate/stale email row into an admin grant on the whole console. | Medium | `admin-data/index.ts:245-266` |
| 10 | **`razorpay` returns 500 for authorization and validation failures** with `error.message`, so 401/403/400 cannot be distinguished by clients or probes. | Medium | `razorpay/index.ts:1394-1398` |
| 11 | **Cron auth is inconsistent**: `x-cron-secret` (`process-deletion`) vs `Authorization: Bearer` (all others); `process-deletion` also accepts an admin JWT, so it is not purely a cron endpoint. | Low | `process-deletion:19-26`; `milestone-auto-release:62-63` |
| 12 | **In-memory rate limits** (`email-notifications`, `proposal-notifications`, `newsletter-subscribe`) reset per instance and are not shared across regions — weaker than the DB-backed ones. | Low | `email-notifications:24-38`; `proposal-notifications:27-42`; `newsletter-subscribe:50-67` |
| 13 | **No push provider**: `notifications` stores FCM-style tokens but nothing sends a push. | Low | `notifications/index.ts:192-230` (no FCM/APNs call anywhere in `supabase/functions/`) |
| 14 | **`invoice` requires an `Authorization` header**, so the "opens in the browser" comment only holds if the SPA fetches it with a JWT (a bare tab navigation is 401). | Low | `invoice/index.ts:1-6,40-56` |
| 15 | **`internship-applications` POST is public** with a best-effort limiter inside a `try/catch` that swallows DB errors — `docs/AUDIT_ARCHITECTURE_MAP.md` still calls `newsletter-subscribe` "the only fully public function". | Low (stale doc) | `internship-applications/index.ts:975-995,1008-1020` |
| 16 | **No reproducible dependency graph**: 24 functions float on `@2`, 9 pin `2.39.7`, no import map or lockfile. Two deploys of the same commit can resolve different SDK builds. | Medium (supply chain) | imports across `supabase/functions/**/index.ts` |
| 17 | **`docs/AUDIT_ARCHITECTURE_MAP.md` §3 is stale**: lists 3 shared modules (there are 6), says the workflow deploys with `supabase functions deploy --no-verify-jwt` (it passes no such flag — `config.toml` governs), calls `newsletter-subscribe` "the only fully public function" (internship POST and `admin-data`'s two verify actions are also unauthenticated), and omits `verify-document`'s host-pinned SSRF guard. | Doc bug | `AUDIT_ARCHITECTURE_MAP.md:139-188` vs `backend-deploy.yml:198-214`, `config.toml:451-475`, `internship-applications:1008-1020` |
| 18 | Customer-facing email templates and the test-email default previously referenced the private owner Gmail (`growlanzo.own@gmail.com`) as a From/contact address; those are now routed to the four verified @growlanzo.com senders and the monitored support inbox. The owner Gmail remains the PRIVATE RECIPIENT for internal admin alerts only (security-alert-notify, internship-applications, proposal-notifications `ADMIN_EMAIL`, admin-data `send_admin_notification`). Changing the ops inbox is still a code change for the internal-alert recipients. | Low | `email-notifications/index.ts`; `admin-data/index.ts:test_email`; `submit-report/index.ts`; `security-alert-notify/index.ts`; `internship-applications/index.ts`; `proposal-notifications/index.ts` |
| 19 | `email-notifications` header still says "email service currently disabled" although delivery is live through Brevo when the key is set — stale comment that invites wrong assumptions. | Low | `email-notifications/index.ts:1-11`; `_shared/brevo.ts:39-43` |
| 20 | **`razorpay` `test_auth` is reachable without a session** (it is handled before the `!user` guard) and returns the key-id prefix, `test`/`live` mode, and whether the credentials authenticate. Only rate-limited, not authenticated. | Low (info disclosure) | `razorpay/index.ts:177-207` (compare `:217-221`) |

### UNVERIFIED (cannot be proven from the repo)

* Whether the six `verify_jwt=false` flags are actually applied on the live project (repo config is the only evidence).
* Whether each function's runtime secrets are set on the project — CI checks only its own three secrets, not the edge-function secret store; `supabase secrets list` (names) was not run here.
* Runtime effect of findings #1–#3 on live data (pending balances, payout webhook statuses). They are static-reading conclusions; no live DB/service was queried.
* Whether any `cron.job` exists for `process_stale_withdrawals` / `process_pending_refunds` outside the repo's migrations (the live `cron.job` table was not inspected).
* Actual Brevo deliverability (sender verification, IP restriction) — `docs/LAUNCH-READINESS.md` A9 claims a blocker; the repo only shows the code path.
* RazorpayX Payouts availability on the account (live 404 was recorded on 2026-09-23 in `CLAUDE.md`; not re-tested here).
* Whether `razorpay` `execute_refund` is currently scheduled (the DB functions exist; the schedule is not in this repo).
* Real latency/timeouts of the AI gateway and Surepass under production load (timeouts are coded: 9 s matching, 20 s KYC, none for `ai-writer`/`ai-assistant`).
