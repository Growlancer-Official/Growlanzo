# DATABASE — Growlanzo Postgres / Supabase layer

**Last verified:** 2026-10-20 · **Scope:** `supabase/migrations/**` (296 files, `20240511_*` → `20270201000000_*`),
`supabase/seed_01_financial.sql`, `supabase/seed_02_invites_proposals.sql`, `.github/workflows/backend-deploy.yml`,
and the DB-reading guards in `src/test/` (`sqlMigrationSyntax`, `ciGuardrails`, `profiles*ColumnGuard`,
`serverOnlyRpcs`, `serviceRoleContextGuard`). **Repo is the source of truth by policy — and not yet a complete
one in fact.** Everything below is *migration-says*; nothing was verified against the live project (read-only
repo access). Two structural facts force that caveat:

1. **30 migration files are 3-byte placeholders** containing only `;` (every file with `Length -le 4`). Their
   versions are applied on the remote, so the drift gate sees them as done, but they carry no DDL. Real bodies
   survive only in git history **before** `a3a5511` (2026-09-17, "reconcile migration history with live DB —
   48 missing files recovered") and in the live database. The list includes the money core:
   `20260922_financial_automation` (invoices, `ledger_entries`, `platform_revenue`, `_book_escrow_release`),
   `20260921_refund_dispute_system`, `20260920_fix_escrow_schema_drift`, `20261220_freelancer_full_payout_model`,
   `20261222_admin_withdrawals`, `20261229_team_projects`, `20260814`/`20260818` (wallet-funded refund fixes).
2. **≈20 live tables have no `CREATE TABLE` anywhere in the repo** (created by those placeholders): `invoices`,
   `ledger_entries`, `platform_revenue`, `refunds`, `refund_requests`, `refund_history`, `payment_audit_logs`,
   `payment_webhook_events`, `cron_settings`, `invoice_seq`, `team_projects`, `team_project_roles`,
   `internship_applications`, `admin_withdrawals`, `dispute_evidence`, `dispute_messages`, `dispute_internal_notes`,
   `newsletter_subscribers`, `hired_proposals`, `ai_usage*`. **`supabase db reset` from this repo cannot reproduce
   production.** Treat the live DB as authoritative for *shape*, the repo for *intent*, and reconcile both before
   trusting either. Never print secrets: `cron_settings.cron_secret` and `admin_credentials.password_hash`.

## 1. Migration system

### 1.1 Naming, ordering, versions
| Rule | Detail |
|---|---|
| Filename / version | `<14-digit timestamp>_<snake_case>.sql`; the leading digits are the `schema_migrations.version` the CLI matches on |
| Apply order | lexicographic filename order. **The last `CREATE OR REPLACE` of an object wins** — the dominant bug class here (§1.7) |
| One file per version | `backend-deploy.yml` maps `version → files` and fails closed on duplicates: `db push` matches by version, so the second file can never apply (measured 2026-10-15: two files shared `20270119000000`; the loser looked permanently unapplied and a forced push died on a `schema_migrations` duplicate key) |
| No tidying | timestamps are not contiguous (`…000031`, then `…000100`…`…000400`); renumbering is a new migration, and applied files are never edited, renamed or deleted. Baseline = `20240511_create_all_tables.sql` (the original 24-table schema); everything later is additive or a repair |

### 1.2 Idempotency (every migration must be safe to re-run)
`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS x ON t; CREATE POLICY x …`,
`DROP CONSTRAINT IF EXISTS …; ADD CONSTRAINT …` for CHECK supersets, and guarded `DO $$ IF EXISTS
(information_schema.columns …) … $$` wherever a column may or may not exist (`20270102000001` backfills
`proposed_rate` from `bid_amount` only when `bid_amount` exists). Functions are always `CREATE OR REPLACE`
**plus re-stated grants**, because `DROP`+`CREATE` resets the ACL to `PUBLIC EXECUTE`.

### 1.3 Fail-closed assertions and controls
Money/security migrations end with `DO $assert$ … $assert$` blocks that `RAISE EXCEPTION` — the migration fails,
`db push` fails, nothing is recorded deployed.

| Kind | Example |
|---|---|
| Object exists / body has the fix | `to_regprocedure('public._release_escrow_internal(uuid)') IS NULL → RAISE` (`20270128000000:94`); `pg_get_functiondef(v_oid) NOT LIKE '%is_service_role_context%' → RAISE` (`:84`) |
| Body lacks the defect | `v_def LIKE '%request.jwt.claim.role%' → RAISE` (`:88`) |
| ACL per role | `has_function_privilege('anon', v_oid,'EXECUTE') → RAISE`, and the positive cases for `authenticated`/`service_role` |
| Detector clean / monitor wired | `EXISTS (SELECT 1 FROM public.null_unsafe_auth_guard()) → RAISE` (`20270130000000:347`); `prosrc NOT LIKE '%authenticated_readable_profile_columns%' → RAISE` (`20270119000025`) |
| Positive / negative control | create a violator in-transaction, demand the detector flags it, `DROP`, demand `0` findings (`20270119000014:179-213`); prose that merely names the banned token must **not** be flagged |

Assertion traps already hit: **resolve signatures by OID / `to_regprocedure`**, never a guessed name+arglist
(`('public.'||fn||'(uuid)')::regprocedure` raised `42883`; the real signature was `(uuid,uuid)` — an assertion
that is wrong about its own schema is not fail-closed, it just fails); **never compare
`pg_get_function_identity_arguments()` to type aliases** (canonical types, no argument names — `20270119000022`
aborted a deploy with `P0001`); **never `count(*)` a scalar function** (`check_security_drift()` returns
`integer`, so it is always `1` — the assertion can never fail); and strip SQL comments before `NOT LIKE`
checks, or the fix's own comments trip the guard.

### 1.4 The `DO $patch$` body-patching pattern
Long bodies are **not retyped**; the migration reads the live definition and does an anchored replacement:

```sql
DO $patch$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='check_security_drift'
     AND pg_get_function_identity_arguments(p.oid)='';
  IF v_src IS NULL THEN RAISE EXCEPTION 'check_security_drift() not found'; END IF;
  IF v_src LIKE '%self_writable_trust_columns%' THEN RETURN; END IF;      -- idempotent re-run
  v_new := replace(v_src, '<anchor>', '<new code>'||chr(10)||'<anchor>');
  IF v_new = v_src THEN RAISE EXCEPTION 'anchor did not match'; END IF;   -- silent no-op = failure
  EXECUTE v_new;
END $patch$;
```
Used to wire detectors into `check_security_drift()` (`20270119000014/16/18/19/24/25/26`), inject NULL-safe
guards (`20270119000016/19`), and whitelist internship uploads (`20270119000000`). Traps: anchors are
**case-sensitive** (a lowercase `begin` anchor missed); some bodies are a **single line**, so whole-line anchors
never match; a trailing `-- comment` on injected code swallows the rest of a one-line body. Current rule:
first word-boundary `BEGIN` (case-insensitive) plus a whole-line cross-check, and injections end with a newline.

### 1.5 Dry-run, lexical guard, and what "good" looks like
Every money migration is executed against the live DB inside `BEGIN; … ROLLBACK;` with assertions allowed to
fire — the only technique that has caught category errors static reading missed (`20270119000012` found 3
defects; `20270119000024`/`…0030` record `DRY_RUN_FULL_OK`; `20270119000022`'s deploy abort was reproduced and
re-proven clean, with zero residue asserted). `src/test/sqlMigrationSyntax.test.ts` lexes every migration in one
pass (`''` escapes, `E'…'`, quoted identifiers, `--`, nested `/* */`, `$tag$` bodies lexed **in place** with a tag
stack) because `20270119000019` shipped a missing quote in a `DO` body: typecheck, lint, build, 213 tests and 9
negative controls passed, and `db push` died on `42601`.
**Never Dashboard-only:** out-of-band objects are invisible to a version-based drift gate. Receipts:
`admin_signup` (anon-callable SECDEF + hardcoded secret) reappeared live; `record_profile_view`'s repo body
referenced a non-existent column while live was hand-fixed (`20270119000023`); `team_projects` existed live while
the repo migration is `;` (§5.8). The 30 placeholders are the accumulated cost.
**Anatomy of a good migration** (`20270130000000`): the header says what was *measured*, the root cause **naming
the migration that caused it**, and the exact fix; the change is the smallest possible (`CREATE OR REPLACE`, same
signature, only auth predicates differ); grants re-stated; fail-closed assertions; alert cleanup only when both
detectors are clean (else `RAISE WARNING`); evidence = filename + dry-run result.

### 1.6 The deploy gate (`backend-deploy.yml`)
```
push touching supabase/** → guard SUPABASE_ACCESS_TOKEN
  → resolve DB URL (SUPABASE_DB_URL, else derive from SUPABASE_DB_PASSWORD)
  → guard pentest secrets (fail-closed, BEFORE anything deploys)
  → drift check mode=pre  → supabase db push  → drift check mode=post
  → redeploy every edge function → pentest-privileges.mjs → surface-audit.mjs
```
`pre` treats only **remote-only** versions (in DB, not in repo) as drift — a pending repo migration is what the
next step pushes, so failing on it made every new migration undeployable. `post` requires both directions empty.
Duplicate versions fail in both modes.

⚠ **Conflict:** CLAUDE.md's 2026-10-16 entry says `--include-all` was added; the committed workflow says
*"Deliberately NOT `--include-all`"* and runs `npx supabase db push --db-url …` (`:168-190`). The workflow is
what runs; the status log is stale on this point.

### 1.7 The dominant bug class: a later `CREATE OR REPLACE` reverts an earlier fix
| Object | Fixed by | Silently reverted by | Consequence |
|---|---|---|---|
| `admin_decide_dispute`, `admin_reverse_escrow` | `20260814`, `20260818` (wallet-funded credit) | `20260920/21/22`, `20261209` re-created from older bodies | client refunds vanished from `balance` (MONEY-001/002) |
| `release_escrow` service-role bypass | `20261211`, then `20270119000018` | `20270124` (applied later, body written earlier) | cron auto-release could not move money: escrow stayed `funded`, credit `0.00`; fixed again in `20270128` |
| NULL-safe guards (`cancel_withdrawal`, `process_withdrawal_complete`, `release_milestone`) | `20270119000016/19` | `20270122` (search_path repair from pre-hardening bodies) | guards reverted to `<> auth.uid()`; fixed again in `20270130` |
| `profiles_private` privilege lock | protections existed on `profiles` | never followed the column to the new table | self-grant of `is_admin` ⇒ full admin proxy (`20270119000013`) |

**Rule:** change a money function only by starting from the current authoritative body, and assert the invariant you
are preserving.

## 2. Schema domains
Repo counts: 92 real `CREATE TABLE`s (94 incl. in-transaction probe tables), 109 `ENABLE ROW LEVEL SECURITY`,
358 `CREATE POLICY`, 377 function definitions (224 distinct names), 81 `CREATE TRIGGER`, 221 `CREATE INDEX`.

| Domain | Key tables | Owner column | RLS posture | Writers | Readers |
|---|---|---|---|---|---|
| **Identity** | `profiles`, `profiles_private`, `freelancer_profiles`, `client_profiles`, `user_mfa_settings`, `recovery_codes`, `push_tokens`, `notification_preferences`, `saved_searches` | `id` = `auth.users.id` | column-granted (never table-granted), owner-scoped, privilege triggers | `ensure_signup_profile` (trigger), `create_user_profile`, `complete_onboarding`, `sync_profile_private`, `protect_*` triggers, `admin-data` | public via FK embeds (11 anon / 14 auth cols), owner, admin |
| **Marketplace** | `projects`, `proposals`, `invites`, `services`, `service_offers`, `portfolio_items`, `project_matches` | `client_id`/`freelancer_id`/`user_id` | owner+participant SELECT, owner write, no anon writes | PostgREST, notification triggers, `ai-matching` (service_role) | anon (catalog/services), participants, admin |
| **Contracts / teams** | `contracts`, `contract_files`, `revision_requests`, `time_entries`, `workspaces`, `workspace_members`, `workspace_tasks/notes/activity_logs`, `team_projects`, `team_project_roles`, `team_invitations` (teams live-only shape) | `contracts.client_id`, `.freelancer_id`; team `client_id` | participants-only SELECT; **no client write** on `contracts`; team hire only via RPC | `create_contract_with_escrow`, `create_team_role_contract`, `accept_invite_create_contract`, `admin_fund_escrow`, `mark_contract_delivered`, `release_*` | both parties, invited freelancer, admin |
| **Escrow / wallet / ledger** | `escrow`, `wallets`, `transactions`, `withdrawals`, `invoices`, `ledger_entries`, `platform_revenue`, `payout_methods`, `saved_payment_cards` | `user_id`/contract parties | **no app-role write policy** (detector-enforced); owner SELECT | `SECURITY DEFINER` RPCs + `withdrawal`/`admin-data` edge | owner, admin, escrow parties |
| **Payments** | `razorpay_orders`, `razorpay_transactions`, `paypal_orders`, `paypal_transactions`, `paypal_disputes`, `payment_webhook_events`, `payment_audit_logs` | `user_id` | owner/admin SELECT; INSERT only by edge (service_role) | `razorpay`, `razorpay-webhook`, `paypal`, `paypal-webhook` | owner, admin |
| **Subscriptions** | `subscriptions`, `subscription_plans`, `subscription_billing_charges` | `user_id` | owner SELECT; client UPDATE guarded by `trg_subscription_client_update_guard` | `create_user_subscription`, `pay_subscription_with_wallet`, billing cron, `is_pro` triggers | owner, admin |
| **Disputes / refunds** | `disputes`, `dispute_evidence`, `dispute_messages`, `dispute_internal_notes`, `refunds`, `refund_requests`, `refund_history`, `fraud_events` | parties / `user_id` | participant SELECT, internal notes admin-only, no client INSERT outside RPCs | `raise_contract_dispute`, `request_contract_refund`, `_refund_*`, `admin_decide_dispute`, `process_pending_refunds` | parties, admin |
| **Reviews / reputation** | `reviews`, `review_replies`, `profiles.rating/total_reviews`, `freelancer_profiles.rating/total_reviews/reputation_score/weighted_rating` | `reviewee_id` | public SELECT; write only for completed-contract parties | `update_reputation_score` is the **only** writer; `trigger_update_reputation` on `reviews` | everyone (merit signals), matching/search |
| **AI** | `ai_matches`, `usage_logs`, `rate_limits` | `user_id`/`project_id` | owner SELECT on matches; `rate_limits` server-only (RPC) | `ai-matching`, `ai-writer`, `ai-assistant`, `generate_project_matches`, `increment_rate_limit` | owner, admin |
| **KYC / verification** | `identity_verifications` (generated `document_hash`), `kyc_provider_config`, `verification_rate_limits`, `skill_certifications`, `credential_*` | `user_id` | owner INSERT/SELECT, admin UPDATE; provider config admin-only | `kyc-submit`, `verify-document`, `kyc_verify_row`, `auto_verify_kyc`, duplicate triggers | owner, admin |
| **Referrals / Grow Coin** | `referrals`, `referral_stats`, `grow_coin_ledger`, `grow_coin_reservations`, `grow_coin_review_flags` | `referrer_id`/`user_id` | ledger own-rows SELECT only, **no** write policy; reservations/flags no client policy | `process_referral`, `complete_referral`, `award_*`, `reserve/redeem/release_grow_coins*` | owner, leaderboard RPC, admin |
| **Contests** | `contests`, `contest_submissions`, `contest_votes`, `contest_comments` | `client_id`/`user_id` | public SELECT on open contests; submit gated by role+deadline | `close_expired_contests`, `award_contest_prizes` | public, participants, admin |
| **Internships / support / notifications** | `internship_applications`, `support_tickets`, `ticket_messages`, `notifications`, `contact_inquiries`, `waitlist`, `user_reports`, `client_errors` | `user_id`/`email` | applicant rows admin-only; tickets owner+admin; notifications owner | `internship-applications`, `submit-report`, notification triggers, `register_push_token` | owner, admin |
| **Admin / security** | `admin_credentials`, `admin_users`, `security_alerts`, `cron_settings`, `deletion_failures`, `signup_profile_failures` | `is_admin` predicate | alerts: admin SELECT + service_role; credentials: authenticated-admin only and **not** realtime-published since `20270127`; `cron_settings` deny-all | `check_security_drift`, `grant_admin_role`, `admin-data`, failure loggers | admin console, `security-alert-notify` |

## 3. Identity model
```
auth.users ──AFTER INSERT──► ensure_signup_profile()  [20270119000026]
   ├─ profiles        (id, role, name, avatar, is_pro, rating, country, verification_status…)
   ├─ profiles_private(email, phone, is_admin, suspended_at/reason/by, banned_at,
   │                   onboarding_completed, referral_code)
   ├─ wallets         (trigger on profiles INSERT → ensure_wallet_for_user)
   └─ notification_preferences (trigger)
auth.users ──AFTER DELETE──► handle_user_deleted() / delete_user_all_data()  [20260925, 20261018]
```
| Concern | Truth |
|---|---|
| Split | `profiles` is public-shaped (`20261221` dropped/moved email, phone, is_admin, bio); `profiles_private` holds PII + privilege + onboarding + referral code |
| anon allowlist (11) | `id, role, name, avatar, is_pro, created_at, updated_at, rating, total_reviews, deleted_at, country` (`20270119000024`) |
| authenticated allowlist (14) | the 11 + `verification_status, kyc_verified_at, name_changed_at` (`20270119000025`). All 14 are required because six call sites use `profiles!fk(*)` and PostgREST expands `*` |
| Table-level SELECT | **revoked** for both roles ⇒ **a new `profiles` column needs `GRANT SELECT (col)` in the same migration** (anon only if genuinely public), else wildcard embeds break — fail-closed by design |
| Roles / admin | `profiles.role ∈ (freelancer, client, admin)`. The **authoritative** admin flag is `profiles_private.is_admin`, read by `is_user_admin()` and by `admin-data`'s `verifyAdminSession` |
| Suspension | `suspended_at/suspend_reason/suspended_by/banned_at`; `is_user_suspended()`; enforced in RPCs and gates |
| Privilege locks | `protect_profiles_private_privilege_columns()` (BEFORE **INSERT and** UPDATE — INSERT too, or a row is born `is_admin=true`), `protect_profiles_privilege_columns()`, `protect_freelancer_profiles_privilege_columns()` |
| Bypass hatch | `app.bypass_privilege_check` read as `COALESCE(NULLIF(current_setting(…,true),''),'false')::boolean`. The `NULLIF` is load-bearing: transaction-local `set_config` leaves `''` after commit on a pooled connection and `''::boolean` raised `22P02` for every later profile write |
| Referral code | server-generated; `20270201000000` (committed `2f31d6d`, applied by `db push` 20 Oct) adds `GRW-XXXX-XXXX` via `generate_referral_code()` + BEFORE INSERT trigger, replacing the role-leaking `GRW-<ROLE>-<4>`; existing codes never rewritten |
| Public-boundary detectors | `anon_readable_profile_columns()`, `authenticated_readable_profile_columns()` — two branches each (table-level grant; non-allowlisted column), swept hourly |
| Ghost accounts | `signup_ghost_accounts()` = `auth.users` rows with no `profiles` row. Signup is fail-soft: `signup_profile_failures` records breakage, never blocks auth |

**Anonymous callers:** `auth.uid()` is `NULL` and `x <> NULL` is `NULL` (falsy), so every historical
`IF p_user_id <> auth.uid()` guard **failed open** for `anon` — that one shape produced the payout-PII leak, the
withdrawal deletion, the default-payout flip, the anon escrow freeze and the withdrawal-cancel credit. Rule:
`auth.uid() IS NULL OR <owner predicate>`, plus the ACL layer.

## 4. RPC catalog
All are `SECURITY DEFINER` unless noted, fully qualified with an explicit `SET search_path` (`''` or
`public, pg_catalog[, auth]`). Grants below are the policy after `20270119000012` (20 server-only + 21 guarded),
`20270119000016` (30 money RPCs off `anon`, by catalog name) and `20270130000000` (re-stated).
**Caller-identity rule:** identity comes from `auth.uid()` / `auth.getUser()`, never a body field; `p_user_id`
survives only for signature compatibility and is ignored or asserted. `is_service_role_context()` probes both
GUC idioms; the legacy singular `request.jwt.claim.role` is banned.

| RPC | Guard | Idempotency | Writes |
|---|---|---|---|
| `create_contract_with_escrow(project,freelancer,proposal,amount,client)` | `p_client_id = auth.uid()` (now NULL-safe) + proposal↔project↔freelancer + project owner | returns existing contract for `proposal_id` | `contracts` (amount from `proposals.proposed_rate`; mismatched client amount rejected), `proposals→hired` |
| `admin_fund_escrow(contract)` / `fund_escrow(contract)` — service_role | none in-body (internal chokepoints) | `IF escrow_funded THEN RETURN TRUE` | `escrow→funded`, `contracts→active`+`start_date`, `projects→in_progress`, `wallets.escrow_balance += amount` |
| `fund_escrow_from_wallet(contract, indices[])` | `auth.uid()` non-null + contract owner + `FOR UPDATE` | `escrow_funded` short-circuit; `UPDATE … WHERE balance >= total` | wallet debit (funding+fee), `admin_fund_escrow`, 2 `transactions` (`escrow`, `platform_fee`) |
| `release_escrow(contract, client)` | `is_service_role_context()` OR (`client_id = auth.uid()` AND contract owner) | escrow must be `funded` | delegates to `_release_escrow_internal` |
| `_release_escrow_internal(contract)` — service_role | none (behind the gate) | `status='funded'` required | `escrow→released`, `contracts→completed`, credit txn, freelancer `balance += net`, client `escrow_balance −= amount`, `_book_escrow_release` |
| `_book_escrow_release(contract, amount)` — service_role | none | `platform_revenue(contract_id,'escrow')` unique; returns existing invoice | `platform_revenue`, `invoices` (`GL-YYYYMM-NNNNNN`), 3 `ledger_entries`, audit+notifications (`EXCEPTION WHEN OTHERS THEN NULL`) |
| `release_milestone(contract, index)` | client-only, NULL-safe, `FOR UPDATE` | rejects already-released index | `contracts.milestones` jsonb; last milestone → `release_escrow` |
| `admin_reverse_escrow(contract)` — service_role | none in-body | status transitions | reverses wallet credit/revenue/invoice, `escrow_balance −= GREATEST(…,0)` |
| `mark_contract_delivered` / `auto_release_contract` | freelancer / cron | `delivered_at`, status | timestamps, release after grace window |
| `request_contract_refund(contract, reason…)` | party, work-started/frozen checks | `_refundable_amount()` = 0 for completed/released | `refund_requests`, may freeze escrow |
| `create_team_role_contract` / `accept_invite_create_contract` | NULL bail + `team_projects` ownership + one-role-one-contract / invite recipient | role→`filled`, unique invite | contract (`project_id NULL`), escrow, notification |
| `pay_subscription_with_wallet(plan)` | `auth.uid()` + `FOR UPDATE` | per-period guard (`20270120`) | wallet debit, `transactions source='subscription'`, `subscriptions` |
| `hold/release_wallet_funds`, `update_wallet_balance`, `process_withdrawal_complete`, `cancel_withdrawal` | **service_role only** for the wallet internals; withdrawal RPCs owner-or-admin, NULL-safe | amount/state checks | `wallets`, `withdrawals`, `transactions` |
| `get_wallet_balance(p_user_id)` / `get/set_default/delete_payout_method` | identity from `auth.uid()`; `p_user_id` **ignored**; payout RPCs owner-only (`(uuid,uuid)` sigs) | read-only / one-default trigger | none / `payout_methods` |

**Disputes/refunds:** `raise_contract_dispute` (party, NULL-safe, **no repo definition** — live-only, patched by
`20270119000016`) freezes escrow; `resolve_contract_dispute`/`admin_decide_dispute(contract,decision,amount,note)`
(admin) support `client_refund|freelancer_payout|split`, wallet credit restored by `20270119000300`;
`admin_assign_dispute`, `appeal_dispute`, `apply_dispute_refund`, `send_dispute_message`,
`attach_dispute_evidence`, `admin_add_internal_note` are party/admin and several are live-only;
`process_pending_refunds()` is service_role/cron `*/2`; `_refund_audit`, `_refund_history_event`,
`_refund_notify` are internal (anon EXECUTE revoked in `20270119000019` after anon inserted audit rows).

**Identity/admin:** `ensure_signup_profile` (service_role, trigger context, fail-soft); `create_user_profile`
(**anon + authenticated** by design — no session right after signup — but may only create the just-signed-up
`auth.users` row, never overwrite); `complete_onboarding` (owner); `update_user_country` (owner-only);
`grant_admin_role` (**service_role only**; admin session *or* service-role context); `is_admin_user` /
`is_user_admin` / `is_user_suspended` (read-only predicates used **inside RLS policies** — must stay grantable);
`admin_grant/revoke_lifetime_premium` (admin); `request/cancel_account_deletion` + `check_deletion_status`
(owner; 64-hex token, NOT NULL columns); `delete_user_all_data` / `process_account_deletion` /
`purge_orphan_user_data` / `process_due_deletions` (service_role); `check_security_drift` / `check_schema_drift`
(service_role); `get_user_email` (service_role, PII).

**KYC:** `auto_verify_kyc` (service_role, cron `*/10`), `kyc_verify_row` (service_role),
`kyc_validate_document_number`, `kyc_reject_duplicate_document/_identity` (trigger fns), `kyc_guard_submit_fn`,
`kyc_sync_profile_status_fn` (syncs `profiles.verification_status`), `admin_set_kyc_mode`,
`admin_set/clear_kyc_provider_config`, `admin_get_kyc_provider_status` (admin). `identity_verifications.document_hash`
is **GENERATED** — writing it raises `428C9` and was a silent "pending forever" cause.
**Referrals/Grow Coin:** `process_referral(code,new_user_id,email)` (authenticated, `p_new_user_id IS DISTINCT
FROM auth.uid()`, inserts `referrals` + upserts `referral_stats`), `complete_referral`,
`award_referral/kyc/first_project_bonus_if_eligible` (service_role, `ON CONFLICT DO NOTHING` on partial uniques),
`reserve/redeem_reserved/release_grow_coin_reservation` (service_role),
`redeem_grow_coins_for_cash(coins,idempotency_key)` / `redeem_grow_coins_for_premium(plan)` (authenticated),
`get_grow_coin_balance`, `get_grow_coin_leaderboard`, `admin_adjust_grow_coins`, `admin_list_grow_coin_flags`.
**Reviews/matching/subscriptions/public:** `update_reputation_score` (service_role; **sole** writer of reputation
columns, run by the review trigger with the bypass flag); `calculate_weighted_rating`, `recompute_seller_level`,
`get_reputation_stats`, `generate_project_matches`/`upsert_project_matches`/`refresh_*` (service_role or guarded);
`create_user_subscription`, `sync_profile_pro_flag` (guarded). Anon by design: `get_public_platform_metrics()`
(marketing pages), `record_profile_view(uuid)` (anon+auth, writes `usage_logs` — vanity counter, flagged),
`get_profile_views`, catalog readers.

## 5. Money architecture
### 5.1 Contract lifecycle
```
pending ──admin_fund_escrow──► active ──mark_contract_delivered──► delivered
   │                             │                                    │
   │                             │  auto_release_contract (auto_release_hours)
   │                             ▼                                    ▼
   └──cancel──► cancelled     disputed ◄──dispute/fraud proof── completed ◄──admin_decide_dispute
```
`contracts.status` CHECK (repo): `pending, active, completed, cancelled, disputed` — widened from the initial
4-value CHECK by `20270125000000`; `projects.status` likewise (the initial CHECK rejected `in_progress`, which
the funding path writes).

### 5.2 Escrow row states
`escrow.status` CHECK: `pending, funded, released, refunded, disputed`. Every money function requires
`status='funded'` to move funds. `20261210000002` writes `UPDATE escrow SET status='frozen'` — **`frozen` is in
no repo CHECK**, so either the live constraint is wider (likely) or that path fails `23514`. Same class:
`contracts.frozen_at` is read in 6 migrations (`20261009`, `20261210`, `20261211`, `20261217`) but **added by
none**; `wallets.is_frozen` is written by `freeze_contract`/`unfreeze_contract` (also live-only) and has **zero
readers**.

### 5.3 Funding sources (all converge on `admin_fund_escrow`)
| Source | Entry point | Client pays | Escrow holds |
|---|---|---|---|
| Wallet | `fund_escrow_from_wallet` | `funding + 5%` debited atomically | `funding` |
| Razorpay / PayPal | `razorpay` or `paypal` edge → `create_order` → webhook → `admin_fund_escrow` | `contract.amount + 5%` (`razorpay_orders.amount` is in **rupees**, not paise) | `contract.amount` |
| Admin/repair | `admin_fund_escrow` (service_role) | — | `escrow.amount` |
| Contest | `fund_contest_prize_from_wallet` | prize pool | contest escrow |
Amounts are always server-derived (`contracts.amount`, `proposals.proposed_rate`, milestone jsonb, plan price);
a mismatched client amount is rejected (`20270102000001`).

### 5.4 Release path
`release_escrow` → gate → `_release_escrow_internal`:
```
v_gross = escrow.amount                      -- includes extra-revision top-ups
v_fee   = contract.platform_fee if v_gross <= contract.amount else ROUND(v_gross*0.05,2)
v_net   = GREATEST(v_gross - v_fee, 0)
escrow → released(at)   contract → completed, escrow_funded=false
transactions (freelancer,'credit',v_net,source 'escrow')
wallets: freelancer.balance += v_net   |   client.escrow_balance −= escrow.amount (GREATEST 0)
_book_escrow_release: platform_revenue(gross,fee,net,'escrow',unique per contract)
  + invoice GL-YYYYMM-NNNNNN (subtotal=net, platform_fee=fee, total=gross, status paid)
  + ledger: escrow debit gross | platform_revenue credit fee | wallet credit net
  + audit & 2 notifications (non-fatal: EXCEPTION WHEN OTHERS THEN NULL)
```

### 5.5 Wallet columns and authority
| Column | Meaning | Authoritative writer |
|---|---|---|
| `balance` | spendable INR | `_release_escrow_internal`, refunds/disputes, `pay_subscription_with_wallet`, withdrawal hold/cancel, `fund_escrow_from_wallet` |
| `pending_balance` | held for an in-flight withdrawal | withdrawal edge (`hold`), `process_withdrawal_complete`, `cancel_withdrawal` |
| `escrow_balance` | client-side aggregate of funds held in escrow (added `20261003000000`; **not** in the original `wallets` DDL) | `admin_fund_escrow` (+), release/refund/dispute (−) |
| `currency` | currency of record | DDL default `'USD'`; almost every path writes `'INR'`; `admin_fund_escrow`'s creation branch still inserts `'USD'` |
| `is_frozen` | read by nothing | `freeze_contract`/`unfreeze_contract` |
No `CHECK (balance >= 0)` / `escrow_balance >= 0` exists in repo DDL; non-negativity is procedural
(`WHERE balance >= total`, `GREATEST(…,0)`). The clamp is double-edged: it prevents negative rows and **hides
over-debits** — how "phantom escrow" leaked across team contracts before `20270119000017`.

### 5.6 Invariants (testable predicates)
| # | Invariant | Enforced by |
|---|---|---|
| I1 | one escrow row per contract; `escrow.amount` = contract amount (+ revisions) | lookup by `contract_id`, `mark_revision_paid`, `_release_escrow_internal` |
| I2 | `wallets.escrow_balance(client) == Σ escrow.amount WHERE status='funded'` | `admin_fund_escrow` (+), release/refund/dispute (−); asserted at runtime by the pentest (`escrow_balance == sum(held)`: 20000=20000, 15000=15000) |
| I3 | `status='funded'` required; exactly one terminal transition | state guard + `FOR UPDATE` in every money RPC |
| I4 | release booked once per contract | `platform_revenue(contract_id,source)` unique + early return |
| I5 | `platform_revenue.freelancer_amount + platform_fee == escrow.amount` | `_book_escrow_release` (V5 query in `20270124000000`) |
| I6 | freelancer `balance` delta == `invoice.subtotal` == `ledger(wallet,credit)` == `platform_revenue.freelancer_amount` | four writes in one function |
| I7 | client wallet debit at funding == `funding + fee`; escrow credit == `funding` | `fund_escrow_from_wallet` + `admin_fund_escrow` |
| I8 | withdrawal: `balance` --hold--> `pending_balance` --complete--> out; `cancel` returns it | withdrawal edge + `cancel_withdrawal`/`process_withdrawal_complete` (`FOR UPDATE`) |
| I9 | Grow Coin balance is never a column: `balance == SUM(grow_coin_ledger.amount)`; a reservation reduces *available* only | `get_grow_coin_balance()`, `grow_coin_reserved_amount()` |
| I10 | one bonus per user per kind; one bonus per referral | partial uniques `uq_grow_coin_kyc_bonus_per_user`, `…first_project_per_user`, `…bonus_per_referral`, `…idempotency` |
| I11 | team isolation: a member's dispute/release/refund touches only its own contract's escrow | every escrow writer is `WHERE contract_id = …`; escrow RLS participants-only; proven by 3-account runtime probe |

### 5.7 Withdrawals
`pending → processing → completed | failed | cancelled`. The **2% fee is not in the database**:
`supabase/functions/withdrawal/index.ts` computes `fee = round(amount*0.02)` for `razorpay_payout` (2.9% for
PayPal) and stores `fee` + `net_amount`; the DB moves `balance → pending_balance`. A queued/failed payout leaves
funds **held, not lost**; `growlancer-stale-withdrawal-recovery` (`*/15`) returns them. The client INSERT/UPDATE
policies on `withdrawals` were dropped in `20270119000016` — the edge (service_role) and `cancel_withdrawal()` are
the only writers, the app only SELECTs.

### 5.8 Refunds, disputes, team isolation
`_refundable_amount(contract)` returns 0 for completed/released/cancelled/frozen/disputed. `request_contract_refund`
(fraud path) freezes escrow, files `refund_requests` and notifies admin (`20261210000002`). `admin_decide_dispute`
supports `client_refund|freelancer_payout|split` and since `20270119000300` restores the **wallet-funded** credit
to `balance` (audit MONEY-001); `admin_reverse_escrow` does the same for the automated path (`20270119000200`,
MONEY-002). Team isolation (`20270119000017`): A's dispute freezes only A's escrow, B's release never touches A/C
rows, cross-member calls refused — after fixing auto-release marking `released` while escrow stayed `funded`,
crediting `0.00` and leaving phantom `escrow_balance`.

### 5.9 Grow Coin
1 coin = 1 INR, integers. 10 coins per qualified referral (first completed contract **or** verified KYC — signup
alone never pays), 10 on verified KYC (real provider only), 20 on first completed project; hard cap 20 paid
bonuses/referrer/month (capped referrals still count for the leaderboard + raise a flag). Redemption ≥100 coins
→ cash (wallet pipeline) or a month of Premium (freelancer) / contract discount (client, reserved at order
creation, debited only on capture). **Ranking/matching/visibility never reads coins.**

## 6. RLS and grants
| Layer | Posture |
|---|---|
| Default | RLS on essentially every table (109 enablements, 358 policies); the monitor alerts `critical` on any `public` table with `relrowsecurity=false` |
| Policy roles / `USING (true)` | new policies must name `TO anon, authenticated` / `TO authenticated` / `TO service_role`; no `TO` ⇒ applies to `PUBLIC`, the defect that exposed `admin_credentials`, `admin_users`, `profiles_private`. `USING (true)` is banned for app roles on data tables — allowed only `TO service_role` or for genuinely public reads (profiles SELECT, plans, catalog) |
| Money tables | **zero** client write policies on `wallets`, `escrow`, `transactions`, `withdrawals`, `refunds`, `refund_requests`, `platform_revenue`, `invoices` — enforced socially (CLAUDE.md §2) **and** mechanically by `client_writable_money_tables()`. The `admin-data` proxy reads many tables and writes column-guarded; `wallets`/`escrow`/`transactions` insert/update/delete return **403** |
| Column grants | `profiles` 11 anon / 14 authenticated; `profiles_private`: only `id, email, phone, referral_code, onboarding_completed, created_at, updated_at` client-writable, table-wide UPDATE/INSERT revoked, `protect_*` triggers as second layer |
| `service_role` | bypasses RLS; used by edge (webhooks, cron, withdrawal, kyc-submit, admin-data) and cron. Every service-role branch must prove itself via `is_service_role_context()`, never a guessed GUC |
| Realtime | `supabase_realtime` carries the workflow/proposal/contract/escrow-notification/chat/admin/KYC/team/grow-coin tables; `admin_credentials` was added `20260801` and **removed** `20270127`. RLS still filters streamed rows |
**New column on `profiles`:** `20270119000025` revoked table-level SELECT from `authenticated` and granted 14
columns because six call sites embed `profiles!fk(*)`. Adding a profile column without `GRANT SELECT (col) … TO
authenticated` (and to `anon` only if public) breaks those embeds at runtime — deliberately fail-closed. Both
allowlists are duplicated inside the two detectors, and `profilesAnonColumnGuard.test.ts` /
`profilesAuthenticatedColumnGuard.test.ts` require grant list and detector allowlist to match **byte-for-byte**.

**Storage buckets** (private by default except public imagery): `avatars`, `portfolio-images`, `company-logos`
(public); `videos`, `verification-documents`, `contract-files`, `dispute-evidence`, `contest-submissions`,
`internship_resumes` (anon INSERT only under `resumes/`, `.pdf` only), `internship_documents` (private).
Provisioning is migration-only (`20270126`); the browser `createBucket(public:true)` helpers were removed.

## 7. Triggers, generated columns, constraints, indexes, cron
| Trigger | Table | Effect |
|---|---|---|
| `on_auth_user_created` → `ensure_signup_profile` | `auth.users` | creates `profiles`+`profiles_private` (fail-soft, logs `signup_profile_failures`) |
| `trigger_ensure_wallet_on_signup` / `on_profile_created` / `on_profile_updated` | `profiles` | wallet (+ `notification_preferences`), and the `profiles_private` mirror (`handle_new_profile_private`, `sync_profile_private`) |
| `protect_profiles_private_privilege_columns`, `protect_profiles_privilege_columns`, `protect_freelancer_profiles_privilege_columns` | profiles tables | BEFORE INSERT/UPDATE guard on `is_admin`/role/suspension/reputation (`P0001`) |
| `trg_kyc_auto_verify`, `trg_kyc_reject_duplicate_document/_identity`, `trg_kyc_sync_profile_status`, `kyc_guard_submit` | `identity_verifications` | KYC state machine + duplicate identity/document blocking |
| `trg_enforce_subscription_trial_guard`, `trg_subscription_client_update_guard`, `sync_profile_pro_flag_trg` | subscriptions/profiles | clients can't forge plan/status; `is_pro` mirrors |
| `trigger_escrow_funded`, `trigger_milestone_released`, `trigger_new_proposal/contract/invite`, `trigger_contract_completion` | domain tables | notification fan-out |
| `trg_grow_coin_award_on_contract_complete`, `…on_kyc_verified` | contracts/KYC | idempotent bonus awards |
| `trg_auto_match_projects/freelancer`, `trg_team_role_suggestions`, `trg_service_match_refresh`, `trigger_new_match` | matches/services | keeps matches warm + notifies |
| `enforce_professional_referral_code` (20 Oct), `trg_track_name_change`, `trg_block_disposable_email_signup` | profiles/auth | referral format, name-change lock, disposable-email block |
| updated_at triggers (`trigger_wallets_updated_at`, `trigger_transactions_updated_at`, `update_*`) | various | timestamps; the transactions one is column-existence-guarded |

`trg_validate_india_phone` was **removed** in `20270101000010` (it fired on every `profiles_private` UPDATE and
blocked onboarding) — do not re-add without phone verification. **Generated columns:**
`identity_verifications.document_hash` is `GENERATED ALWAYS AS (…)`, uniquely indexed, and drives duplicate-identity
checks — **never write it**.

**Constraints that bite:** `contracts.project_id` NOT NULL was dropped in `20270119000017` so team contracts can
exist (before that Team Projects created zero contracts). `contracts.status`, `projects.status`, `escrow.status`,
`withdrawals.method`, `transactions.type`/`source`, `grow_coin_ledger.reason`, reservations/flags statuses are
CHECK-constrained — a new value needs a drop-and-re-add migration or inserts fail `23514` (the `ai_message`
feature_type and `services.status`/`active` toggle bugs were this shape).
`user_deletion_requests.confirm_token`/`confirm_token_expires_at` are NOT NULL without defaults — the RPC must
supply them (`20270119000010`).

**Indexes:** `20260610120000_performance_indexes` covers the hot reads (`contracts`, `escrow(contract_id,status)`,
`proposals`, `services`, `notifications`, `messages`, `invites`, `project_matches`, workspace). Domain:
`idx_referrals_referred_user_id`, `idx_profiles_private_referral_code`, `idx_grow_coin_ledger_user_created`,
partial uniques for bonuses/idempotency, unique `platform_revenue(contract_id,source)`, unique
`subscription_billing_charges` period key, `identity_verifications(document_hash)` and
`(lower(trim(full_name)), date_of_birth)`. Known gap (MONEY-011): `ledger_entries`, `refunds`, `platform_revenue`,
`invoices`, `security_alerts`, `fraud_events` have no FK-supporting indexes in the repo.

**pg_cron**
| Job | Schedule | Calls |
|---|---|---|
| `growlancer-security-drift` | `15 * * * *` | `check_security_drift()` → alerts + pg_net → `security-alert-notify` |
| `growlancer-milestone-auto-release` | `5 * * * *` | `process_milestone_auto_release()` |
| `kyc-auto-verify` | `*/10 * * * *` | `auto_verify_kyc()` |
| `growlancer-stale-withdrawal-recovery` | `*/15 * * * *` | `process_stale_withdrawals()` |
| `growlancer-process-pending-refunds` | `*/2 * * * *` | `process_pending_refunds()` |
| `subscription-billing-daily` | `0 0 * * *` | billing edge/function (`CRON_SECRET`) |
| `growlancer-no-response-auto-dispute` | `0 6 * * *` | `process_no_response_disputes()` |
| `growlancer-process-due-deletions` | `0 4 * * *` | `process_due_deletions()` |
| `growlancer-close-contests` | `0 * * * *` | `close_expired_contests()` |
| `cleanup-verification-rate-limits` / `cleanup-orphaned-data` | `20 3 * * *` / `0 3 * * 0` | `cleanup_verification_rate_limits()`, `cleanup_orphaned_data()` |
`cleanup-rate-limits` exists only as a **commented-out** line in `20260610130000` — if it runs live it was
scheduled out-of-band. Several jobs target functions whose repo definition is absent or a stub
(`process_no_response_disputes`, `process_due_deletions`, `process_stale_withdrawals`) — cron runs live code the
repo cannot rebuild.

## 8. Self-detection: `check_security_drift()`
Hourly, `SECURITY DEFINER`, `SET search_path = public, pg_catalog, storage`, returns `integer` (count of **new**
alerts). Writes `security_alerts(severity,category,detail,source)`, deduped by "already open or resolved within 7
days"; when `v_new > 0` it fires `net.http_post` → `security-alert-notify` edge (Bearer
`cron_settings.cron_secret`) → Brevo email, and the admin dashboard shows rows live via realtime. Best-effort by
design (`EXCEPTION WHEN OTHERS THEN NULL` around the HTTP call).

| Detector | Catches | Category / severity |
|---|---|---|
| built-in RLS / open policy | `relrowsecurity=false` on any `public` table; `USING(true)`/`WITH CHECK(true)` on the money & PII tables (wallets, escrow, transactions, withdrawals, payout_methods, saved_payment_cards, identity_verifications, subscriptions, refund_requests, razorpay/paypal orders) | `rls_disabled` / `open_rls_policy` — critical |
| built-in definer / storage / PUBLIC write | no `search_path` in `proconfig`; storage INSERT/ALL policy with no `uid(`/`role(`/`auth.` token (render-aware — `auth.uid()` renders as bare `uid()` here); roles `{public}` + `WITH CHECK true` | `definer_no_search_path`, `open_storage_write`, `open_public_write` — high/critical |
| built-in anon PII | `anon` can SELECT `profiles.email`/`phone` | `anon_pii_select` / critical |
| `self_writable_trust_columns()` | trust-shaped column + `authenticated` UPDATE + owner-scoped policy + **no** `protect_*` trigger — the `is_admin` class | `self_writable_trust_column` / critical for is_admin/role |
| `anon_reachable_money_rpc()` | SECDEF + anon EXECUTE + body touches wallets/escrow/transactions/contracts/refunds/revenue/invoices (excludes `get_public_platform_metrics`) | `anon_reachable_money_rpc` / critical |
| `client_writable_money_tables()` | app-role write policy on a money/ledger table without an `admin` predicate | `client_writable_money_table` / high |
| `null_unsafe_auth_guard()` | `x <> auth.uid()` without an `auth.uid() IS NULL` bail — caught exactly the 5 payout/withdrawal/release functions | `null_unsafe_auth_guard` / critical |
| `self_referential_policy_predicate()` | tautological policy predicate `x.y = x.y` (qualified **and** unqualified) | `self_referential_policy_predicate` / critical |
| `stale_jwt_claim_check()` | body reads legacy singular `request.jwt.claim.role` (comments stripped first) | `stale_jwt_claim_check` / critical |
| `anon_readable_profile_columns()` / `authenticated_readable_profile_columns()` | table-level SELECT **or** a non-allowlisted readable column, per role | `anon_profile_column` / `authenticated_profile_column` — critical |
| `signup_ghost_accounts()` / `check_schema_drift()` | `auth.users` rows with no `profiles` row (ids only, no PII); consolidated baseline drift (`escrow_funded`, `projects.status` CHECK, `transactions` shape, timestamp trigger) | `signup_ghost_account` / `schema-drift` — high |
Each new detector ships with **positive + negative controls inside the migration** (plant a violator, require it
flagged, drop it, require zero; require a lookalike to *not* be flagged). A detector that stops working fails the
deploy instead of passing silently; open `security_alerts` count is a launch signal.

## 9. How to add
### 9.1 Table + RLS + grants
`CREATE TABLE IF NOT EXISTS public.x (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), …)`; ownership column
NOT NULL + FK; `ENABLE ROW LEVEL SECURITY`; policies **with** `TO` and a real predicate (write policies only where
the browser truly writes); `REVOKE ALL … FROM PUBLIC, anon, authenticated` then the minimum `GRANT` (column-level
if privileged); if it holds money, add it to `client_writable_money_tables()` and require 0 findings; index the FK
and the filter column.

### 9.2 Column on `profiles` (fail-closed path)
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS foo text;
GRANT SELECT (foo) ON public.profiles TO authenticated;   -- MUST be in the same migration
-- GRANT SELECT (foo) ON public.profiles TO anon;         -- only if genuinely public
```
Then add `'foo'` to the allowlist **inside** `authenticated_readable_profile_columns()` (and the anon one if
public) — the byte-for-byte guard test fails otherwise. Never restore a table-level grant. For `profiles_private`,
add the column and, only if the client may write it, the column GRANT; otherwise leave it server-only.

### 9.3 Money-moving RPC — CLAUDE.md §9, mechanically
1. **Ownership first:** `IF auth.uid() IS NULL THEN … 'Unauthorized'`, then `resource.owner IS DISTINCT FROM auth.uid()` — never `<>`.
2. **Amounts:** read `contracts.amount` / `proposals.proposed_rate` / milestone jsonb / plan price; reject a mismatched client amount.
3. **Idempotency:** state guard (`escrow_funded`, `status='funded'`), unique index + early return, or a client `idempotency_key` with a partial unique index.
4. **Locking:** `SELECT … FOR UPDATE` on contract **and** wallet/escrow; `UPDATE … WHERE balance >= total RETURNING` for debits.
5. **Ledger:** write `transactions` + (`platform_revenue`/`invoices`/`ledger_entries`) in the same transaction; keep `net + fee = gross`.
6. **Grants:** `REVOKE ALL … FROM PUBLIC, anon`; `GRANT EXECUTE … TO authenticated, service_role` (service_role only for internals).
7. **Assertions:** body has `auth.uid() IS NULL`; `anon` cannot execute; `authenticated` still can; `pg_get_functiondef` contains your marker; relevant detector returns zero rows.
8. **Dry-run** live in `BEGIN … ROLLBACK`, then let the pentest drive it over HTTP after deploy.

### 9.4 Non-money RPC and triggers
RPC: NULL-safe owner guard → validate inputs → scoped query → revoke/grant → assertion. If it returns data about
a user, no caller-supplied `p_user_id` may select the row; derive from `auth.uid()`. Trigger: `CREATE OR REPLACE
FUNCTION` (SECDEF, explicit `search_path`, fully qualified body) + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`;
fail-soft only where blocking the user is worse than the gap (signup), log failures to a table, and never let a
trigger become the only writer of money state.

### 9.5 New detector + controls
Write a `RETURNS TABLE` reader (server-only: `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO
service_role`), patch it into `check_security_drift()` with the anchored `DO $patch$` pattern, give it a unique
alert category, and ship positive **and** negative controls in the same transaction. Add a test that the patch
anchor exists, so re-creating the monitor cannot silently drop the sweep.

### 9.6 Seed data
`seed_01_financial.sql` / `seed_02_invites_proposals.sql` are **demo fixtures with hardcoded UUIDs** (contract,
wallet, escrow, withdrawals, invites, proposals, notifications) — useful locally, **never for production**: they
write money rows for fixed profile ids and reference live-only columns (e.g. `projects.skills_required`). Real E2E
seeding is `scripts/e2e/create-test-accounts.mjs` (idempotent, service-role, torn down by
`remove-test-accounts.mjs`).

### 9.7 Trap checklist
| Trap | Reality |
|---|---|
| Default `PUBLIC EXECUTE` | Postgres grants it on every new function; re-revoke after each `CREATE`, and 33 definers were still anon-executable in Oct 2026 |
| `auth.uid()` NULL | `x <> NULL` is NULL ⇒ guard skipped. Always `auth.uid() IS NULL OR …` |
| `search_path` / legacy JWT claim | declare the path (`'public, pg_catalog, auth'` as one quoted token makes it **empty** → `42P01`; `= ''` needs fully qualified bodies); `request.jwt.claim.role` is not set by current PostgREST — use `auth.role()` / plural claims / `is_service_role_context()` |
| Generated `document_hash` | `GENERATED ALWAYS` — writing raises `428C9`, insert then silently stays "pending" |
| Identity-argument assertions / one-line bodies | canonical types, no names — compare via OID; whole-line anchors never match a single-line body, so use `DO $patch$` + a change check |
| `count(*)` on a scalar function | always 1 ⇒ vacuous assertion |
| GUC leakage on pooled connections | `set_config(…, true)` leaves `''` after commit; always `NULLIF(current_setting(…, true), '')` |
| `GREATEST(x-n,0)` | hides over-debits; a display fix, not an invariant |
| New status value | needs a CHECK drop/re-add migration, else `23514` (broke AI counters + service deactivation) |
| `--include-all` | hides which file is really live; fix duplicate versions by renumbering |

## 10. Migration timeline (the ones a newcomer must know)
| # | Migration | Why it matters |
|---|---|---|
| 1 | `20240511_create_all_tables` | baseline: profiles/contracts/escrow/transactions/withdrawals/referrals/reviews/services |
| 2 | `20240515_add_triggers_and_functions` | first triggers/stats RPCs; `contracts.escrow_funded`, `usage_logs` |
| 3 | `20260525170000_wallets` | wallet table, auto-create trigger, and the open UPDATE policy later removed |
| 4 | `20260617_fix_escrow_auth_and_add_transactions` | `transactions` rebuilt; first "later migration overwrote a fix" incident |
| 5 | `20260620000000_fix_referral_system` | `process_referral`; live `referred_user_id`/`bonus_claimed`/`referral_stats` shape |
| 6 | `20260901` + `20260904` | milestone release with `FOR UPDATE`; `admin_users` + the no-`TO` policy (closed later) |
| 7 | `20261003000000_restore_razorpay` | Razorpay restored after the Cashfree experiment; `wallets.escrow_balance` added |
| 8 | `20261028000000_fund_escrow_from_wallet` | the wallet→escrow funding path (atomic, server-priced) |
| 9 | `20261103000000_withdrawal_trial_verification` | `withdrawals.method` CHECK widened; trial guard |
| 10 | `20261209000000_security_hardening_v5_rls` | dispute/milestone freeze + RLS sweep |
| 11 | `20261214000000_security_drift_monitor` | `security_alerts` + `check_security_drift()` + hourly cron + email |
| 12 | `20261215000000_close_anon_pii_and_admin_users` | `REVOKE ALL` on `profiles` for anon + the 11-column grant (allowlist origin) |
| 13 | `20261217000000_full_contract_auto_release` | `delivered_at`, `auto_release_hours`, `mark_contract_delivered`, `auto_release_contract` |
| 14 | `20261221000000_fix_profiles_pii_leak` | `profiles_private` created; PII/admin/onboarding/referral moved out |
| 15 | `20270101000013_security_hardening_audit` | drops open wallet UPDATE, closes referral/payment write holes |
| 16 | `20270102_contract_amount_from_proposal` | contract amount stops being client-trusted |
| 17 | `20270119000013_lock_profiles_private_privileges` | column grants + `protect_*` triggers for is_admin/suspension/reputation |
| 18 | `20270119000016_money_path_pentest_fixes` | 30 money RPCs off `anon`; NULL-safe guards; withdrawals write policies dropped; 2 detectors |
| 19 | `20270119000019_surface_audit_authorization_fixes` | payout PII leak closed, workspace RLS recursion fixed, `null_unsafe_auth_guard` + `self_referential_policy_predicate` |
| 20 | `20270124` → `20270128` → `20270130` | the release/withdrawal saga: fee base, service-role detection, NULL-safe guards — and three regressions in between |
| 21 | `20270129000000_grow_coin_referral_rewards` | Grow Coin ledger/reservations/bonuses/redemption + anti-fraud |
| 22 | `20270119000024/25/26` | profiles column-allowlist boundary made self-detecting (anon + authenticated); `ensure_signup_profile` on `auth.users`, ghost detector, backfill |
| 23 | `20270201000000_professional_referral_codes` **(committed `2f31d6d`, applied by `db push` 20 Oct)** | `GRW-XXXX-XXXX` generator/normalizer + insert trigger + normalized `process_referral` |

## 11. Known debt, gaps and conflicts
### 11.1 Structural debt
1. **30 placeholder migrations** (header) — the largest risk here: no gate can see it, because drift compares versions and every placeholder's version is applied. **≈20 tables have no repo DDL** (the entire invoice/ledger/revenue core, dispute-detail tables, team projects, internships, `cron_settings`).
2. **Live-only functions** referenced but never defined in the repo: `raise_contract_dispute`, `freeze_contract`, `unfreeze_contract`, `apply_dispute_refund`, `appeal_dispute`, `send_dispute_message`, `attach_dispute_evidence`, `admin_add_internal_note`, `admin_assign_dispute`, `_refund_audit`, `_refund_history_event`, `_refund_notify`, `_mark_revenue_refunded`, `insert_payment_audit_log`, `get_finance_stats`, `get_admin_commission_balance`, `process_due_deletions`, `process_no_response_disputes`. Several are patched by `DO $patch$` — the repo mutates bodies it cannot create.
3. **Dead trust columns** flagged, not fixed: `certifications.verified`, `freelancer_skills.is_verified`, `payout_methods.is_verified`, `services.rating` — owner-updatable, no guard, zero readers.
4. **Column/status gaps:** `contracts.frozen_at`, `wallets.is_frozen`, `escrow.status='frozen'` are used but undefined; **no `CHECK (balance >= 0)`** on wallets, so non-negativity is procedural.
5. **Currency:** DDL default `'USD'`, most paths `'INR'`, and `20261226_inr_currency_consistency` is a **stub** — the repo does not actually enforce INR. No FK indexes on the newer financial/audit tables (MONEY-011). `subscription_plans` has three seeded shapes (`20260525`, `20260616`, `20260619`) plus a cleanup migration — live rows, not seeds, are truth.

### 11.2 Conflicts between migrations (flag, do not silently pick)
| Conflict | Evidence | Consequence |
|---|---|---|
| **5% fee taken twice / freelancer shorted** — ✅ **RESOLVED 2026-10-21 by `20270203000000_commission_freelancer_side.sql`** (Option B: client funds the contract amount only; 5% withheld once at release; invoice `platform_fee = 0`). The evidence below is the historical conflict, kept so nobody re-creates the old bodies | `20270102000001:121-124` says the fee is charged to the client **on top** and "the freelancer receives 100% of the contract amount"; `20270124000000:93-95` (later, authoritative) pays `v_net = v_gross − v_fee` from the pool and books the fee as revenue. Wallet funding also debits `funding + fee` (`20261028000000:82-98`) and records a `platform_fee` transaction with **no** revenue row | Wallet: client pays 105, escrow holds 100, freelancer gets 95, platform books 5 ⇒ 5 collected and unbooked. Razorpay: client pays 105, freelancer gets 95 ⇒ 95%, contradicting "flat 5% from the client, above the price". Needs a founder decision; **unverified live** (no offline reconciliation) |
| `--include-all` | CLAUDE.md (2026-10-16) says added; `backend-deploy.yml:168-190` says deliberately **not** used | The workflow is what runs; the status log is wrong |
| `escrow.status='frozen'` | written `20261210000002:148`; repo CHECK allows only pending/funded/released/refunded/disputed | If the live CHECK was not widened out-of-band, the fraud freeze fails `23514` |
| `release_escrow` service-role detection | fixed `20270119000018`, reverted `20270124000000:157`, fixed `20270128000000:47` | Correct only because `20270128` sorts later; any re-create from a pre-28 body restores "auto-release pays 0.00" |
| NULL-safe guards | fixed `20270119000016/19`, reverted `20270122000000`, fixed `20270130000000` | Same fragility; `null_unsafe_auth_guard()` now catches it hourly |
| Referral code shape | `create_user_profile` writes a client-generated code (may get a `-xxxx` suffix) while the 20 Oct trigger also generates one | The same user's code can change after sharing — product call, unresolved |
| Team contract `project_id` | RPC sends NULL; `contracts.project_id` was NOT NULL until `20270119000017` | Team Projects created **zero** contracts before that fix |
| `transactions.type` CHECK | DDL allows `payment, withdrawal, refund, fee, bonus`; money code inserts `'credit'`/`'debit'` | Live CHECK must be wider, or those inserts fail — repo cannot prove it |

### 11.3 UNVERIFIED (needs live introspection — do not quote as fact)
1. Any row counts or current values; `wallets.balance` / `escrow_balance` aggregates; real ledger reconciliation per contract (`net + fee == gross`, and `client_charged == net + fee`).
2. Final live bodies of `raise_contract_dispute`, `freeze_contract`/`unfreeze_contract`, `_refund_*`, `insert_payment_audit_log`, `admin_signup` (dropped or not), `admin_decide_dispute`, `admin_reverse_escrow`.
3. Whether the live `escrow.status` / `transactions.type` CHECKs are wider than the repo's, and whether `contracts.frozen_at`, `wallets.is_frozen`, `escrow.status='frozen'` exist live.
4. Actual grants: the repo's last explicit `GRANT` can predate a later catalog-name `REVOKE/GRANT` loop, and out-of-band changes are invisible — verify with `has_function_privilege` per role.
5. Whether `profiles` has any column outside the 14/11 allowlists, and whether `admin_credentials` still holds real bcrypt hashes and is out of the realtime publication.
6. Current open `security_alerts`, `signup_profile_failures`, `deletion_failures`, `grow_coin_review_flags`.
7. Whether the 20 Oct signup probe confirms the professional-code trigger rewrites a legacy insert in production (the migration was applied by `db push`; the runtime path has not been exercised).
8. Storage bucket `public` flags and final per-bucket policy text.
12. Which pg_cron jobs are actually scheduled (`cron.job`), and whether any job runs a function whose repo body is a stub.
