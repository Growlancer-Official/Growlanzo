# CLAUDE.md — Growlanzo Project Context

Ye file Growlanzo repo ke root me rakho (`/CLAUDE.md`). Claude Code isse automatically padhta
hai har session ke shuru me — isliye ye poora context hamesha available rahega, bina baar-baar
explain kiye.

---

## Project kya hai

Growlanzo — India-first AI-powered freelancing platform. Founder/CEO: Muhammad. Tech stack:
React/Vite frontend, Supabase (Postgres + Auth + Edge Functions + Storage), Razorpay + PayPal
for payments, RazorpayX for payouts.

---

## Business Model (FINAL — ye badalna nahi hai bina explicit confirmation ke)

- **Platform commission: flat 5%** — freelancer ke released payout se kati jaati hai; client
  exactly agreed amount deta hai, checkout par kuch add nahi hota. Koi doosra hidden fee nahi.
- **Freelancer subscription: ₹199/month, single flat plan** — no yearly, no team plans, no
  separate AI-only plan. Purely optional.
- **Packaging (3-tier: Basic/Standard/Premium)** — sabhi freelancers ke liye FREE, kabhi bhi
  subscription ke peeche gate mat karna.
- **Client AI features: free for lifetime** — kabhi bhi paywall na dikhana clients ko, sirf
  backend me fair-use rate-limit se protect karna (abuse-protection, promise nahi todhna).
- **Ranking/matching/search-visibility: 100% merit-based, kabhi bhi subscription/payment se
  influenced nahi.** `is_pro` ya koi bhi paid-flag kabhi bhi scoring/sorting logic me factor
  nahi honi chahiye. Ye non-negotiable hai — "pay-to-win" iss platform ke core-promise ke
  khilaf hai.
- **Withdrawal/payout processing fee (~2%)** — ye Razorpay/PayPal ka actual transfer cost hai,
  platform ka profit nahi. Pricing/legal pages par commission se hamesha ALAG dikhana.
- **Team Projects**: ek client project ke andar multiple INDEPENDENT contracts (ek per
  freelancer/role) — har contract ka apna escrow/milestone/dispute, ek member ka issue doosre
  ko affect nahi karta. 5% commission har individual contract par lagta hai, koi separate
  "team fee" nahi.

---

## Security Principles (poore codebase audit se seekhe gaye — HAMESHA follow karo)

Ye patterns humne kai rounds ke deep security audit se establish kiye hain. Koi bhi naya code
likhte waqt, agar in principles se conflict ho, to ruk ke flag karo, chup-chap continue mat
karo:

1. **Kisi bhi client-sent amount/price/quantity ko kabhi bhi bharosa mat karo agar wo paisa
   move karta hai.** Payment order create karte waqt, ya koi bhi financial value process karte
   waqt, hamesha server-side database se authoritative value fetch karo (contract.amount,
   package.price, etc.) — client sirf ID/reference bheje, value nahi.

2. **Wallet balance, escrow status, subscription status — ye sab SIRF `SECURITY DEFINER` RPCs
   se change hone chahiye, kabhi bhi direct table UPDATE se nahi.** RLS UPDATE policies in
   financial tables (wallets, escrow, contracts, transactions) par bilkul honi hi nahi chahiye
   end-users ke liye — agar koi naya RLS policy likh rahe ho `FOR UPDATE`, ruk ke socho ki
   `WITH CHECK` clause specific columns/values restrict karta hai ya nahi, "USING(true)" jaisi
   universal policy kabhi mat likhna bina `TO service_role` scope kiye.

3. **Webhooks (payment gateway se aane wale) hamesha fail-closed hone chahiye** — agar signing
   secret missing/invalid hai, request reject karo, kabhi bhi processing skip karke aage mat
   badhne do.

4. **Admin-only actions me hamesha server-side role-check ho** (`profiles.role = 'admin'`
   query karke verify karo) — sirf client-side route-guard par kabhi bhi bharosa mat karo.

5. **Scheduled/cron edge functions me hamesha `CRON_SECRET` verify karo** — koi bhi authenticated
   user (ya anon) directly hit na kar sake.

6. **Kabhi bhi request body se `user_id` accept karke uspar operate mat karo** — hamesha
   `auth.getUser()` se mila caller ka apna ID use karo. Agar kisi resource (ticket, contract,
   dispute) par action lena hai, uski ownership caller ke ID se verify karo, request body ke
   kisi field se nahi.

7. **Naye database function/RPC likhte waqt hamesha migration file me commit karo** — kabhi
   bhi sirf Supabase Dashboard/SQL Editor/MCP se directly production database me create mat
   karo bina migration file banaye. Repo hi source-of-truth honi chahiye, live DB nahi.

8. **RLS SELECT policies bhi audit karo, sirf UPDATE nahi** — koi bhi table jisme private/
   sensitive data hai (financial records, match-scores, private submissions), uski SELECT
   policy specific ownership/participant check kare, generic `auth.role() = 'authenticated'`
   se poori table publicly-readable mat chhodo.

9. **Koi bhi naya money-moving RPC likho to check-list follow karo:** (a) caller ki ownership
   verify, (b) amount server-side se derive/verify, (c) idempotency guard (double-execution na
   ho), (d) row-level locking (`FOR UPDATE`) agar balance change ho raha hai, (e) proper
   transaction/ledger entry record ho.

---

## Code Quality Standards

- **Koi bhi khaali `catch {}` block mat likho** — hamesha console.error/log + user-facing
  toast/error-message do. Silent failures kabhi accept nahi.
- **Native `alert()`/`window.confirm()` kabhi use mat karo** — existing `ConfirmModal.tsx` /
  `Toast.tsx` components use karo.
- **Har naye feature ke baad build/test karo**, aur jo pehle se kaam kar raha tha (especially
  escrow/payment/auth flows) usko regression-test karo — kuch tootha nahi ye confirm karke hi
  aage badho.
- **Koi bhi dummy/placeholder/mock data production code me mat chhodo.** Agar koi feature
  incomplete hai, usse clearly TODO/comment se flag karo — silently fake data se cover mat
  karo jo real jaisa lage.
- **Naya edge function banate waqt hamesha check karo**: auth check chahiye ya nahi (agar
  chahiye, `auth.getUser()` call karo), rate-limiting chahiye ya nahi (AI/cost-heavy calls ke
  liye hamesha chahiye), aur CORS config sahi hai.

---

## Kaam karne ka tareeka (behavioral instructions)

- Jab bhi koi naya feature ya fix maanga jaaye, **pehle upar diye security-principles aur
  business-model constraints ke against check karo** — agar koi conflict lage (jaise koi
  suggestion jo ranking ko paid-bias de de, ya koi RLS policy jo bahut open ho), **implement
  karne se pehle flag karo**, chup-chap implement mat karo.
- **Real-time, production-grade code likho har baar** — koi bhi "yahan baad me fix karenge"
  wala shortcut, koi bhi hardcoded/fake response jo asli lage but real na ho — ye explicitly
  mना hai.
- Jab bhi koi naya migration/RPC/edge-function banao, existing patterns (jo upar security
  principles me hain) follow karo — naya alag pattern mat invent karo bina reason ke.
- Agar koi request ambiguous lage ya multiple approaches ho sakte hain, ek reasonable default
  choose karke proceed karo (assumption clearly bata do), poori tarah ruk mat jaao — but agar
  security/money/business-model se related decision hai, to confirm zaroor karo pehle.
- Jab kaam complete ho jaaye, ek chhota summary do ki kya change hua, kya test kiya, aur agar
  koi cheez abhi bhi verify karni baaki hai (jaise dashboard secrets set karna) wo explicitly
  bata do.

---

## Standing Rule: Har Change → Audit → Deploy (MANDATORY — founder ne explicit bola hai)

Har koi bhi change (fix/feature/refactor) complete hone par, HAR BAAR, bina pooche:
1. **Security audit** — full uncommitted diff ko upar diye Security Principles ke against scan karo
   (secrets, money-path client-trust, RLS, webhook fail-open, IDOR, request-body user_id).
   Untracked files bhi check karo (test artifacts me keys/logs ho sakte hain — `tests/e2e-artifacts/`
   aur `.e2e/` gitignored hain, kabhi commit mat karna).
2. **Verify** — `npm run typecheck` + `npm test` + (UI changes par) `npm run build`.
3. **Frontend + Backend DONO push to `origin main` REAL-TIME** — frontend push = Vercel deploy;
   backend changes (`supabase/functions/**`, `supabase/migrations/**`, `supabase/config.toml`) push =
   **`backend-deploy.yml` auto-runs**: migration drift-check (fail-closed) → `db push` → saare edge
   functions redeploy. Matlab frontend aur backend HAMESHA saath deploy hote hain, real-time me.
   "Deploy on GitHub" ka matlab yahi hai: commit hoke push ho gaya to dono deploy ho gaye. User ko
   report me hamesha batao: kya commit hua, push hua ya nahi, aur deploy-abhi-live hai ya pending.

### Backend deploy rules (naya — founder directive: backend bhi all-time real-time push)
- **Repo = source-of-truth, live DB nahi.** Koi bhi DB/RPC/RLS change pehle migration file me,
  phir push (workflow apply karega). Dashboard/SQL-Editor se direct production change KABHI nahi.
- **Backend push se pehle LOCAL drift-check**: `npx supabase migration list` — ek bhi
  local≠remote row = pehle resolve karo, push mat karo (workflow bhi fail-closed gate hai).
- **Functions deploy hamesha repo se** (workflow loop, `_shared` skip). Manual `functions deploy`
  sirf emergency me, uske baad turant commit+push taaki repo wapas source-of-truth ho.
- **Secrets**: functions ke secrets `npx supabase secrets list` se naam-verify hota hai; VALUES
  kabhi print/commit nahi karni. Repo me `SUPABASE_ACCESS_TOKEN` GitHub secret chahiye (one-time).
- **Money-path migration** (escrow/wallet/RLS) push = money-touching change — push se pehle
  Security Principles §2/§9 checklist khud se verify karo, phir hi push.

## Current Status (jaise-jaise fix hote gaye, ye section update karte rehna)

📋 **Launch readiness — founder ke liye single checklist: `docs/LAUNCH-READINESS.md`.** Har baaki
blocker ek owner-action + verification step ke saath hai (A: real money se pehle zaroori config/
supply, B: engineering backlog jo go-ahead mangta hai, C: verified-working cheezein taaki dobara
na ki jaayein). Koi bhi naya blocker mile to usi file me update karo, ye section nahi phulana.

✅ Poora security audit complete — RLS (SELECT/UPDATE/DELETE saari policies), 27+ edge
functions, saari RPC grants — sab verified/fixed (wallet-balance direct-manipulation, escrow
amount-tampering, open RLS policies, webhook fail-open, IDORs — sab close ho chuke).

✅ Business model implement — packaging, ₹299 subscription, pricing-transparency pages,
merit-based ranking confirmed.

✅ Team Projects feature — multi-freelancer, independent-contracts architecture, live.

✅ KYC real-time engine (Sep 2026) — `kyc-submit` edge function, provider abstraction
(Surepass/Deepvue switch via 1 adapter), duplicate-identity protection (DB trigger +
pre-flight), realtime status flips, email gate, rate limits.

⚠️ KYC provider — abhi `kyc_provider_config.mode = 'development'` (admin panel se toggle):
users auto-verify instantly, rows honestly labelled `provider='dev_mode'`. Revenue aate hi
admin → Verification → Production + provider token (SIRF REAL provider se VERIFIED; dev rows
dobara real verify karne honge). `document_hash` live par GENERATED column hai — function se
kabhi write mat karna (428C9 error, silent pending-fail cause tha).

✅ Pre-launch E2E hardening (Sep 16, 2026) — device-matrix + fullsite sweeps (13 devices /
41 routes), auth+nav flow harness (`scripts/e2e/`), mobile viewport-meta launch-blocker,
SPA-fallback hydration (#418) fix (`vite.config.ts` boot-splash), `server.js` static-first
fallback, ~40 a11y/heading fixes. Report: `docs/PRE-LAUNCH-TEST-REPORT.md`. Test artifacts
`tests/e2e-artifacts/` gitignored (console captures me anon-key JWTs ho sakte hain).

✅ Element-level UI audit (Sep 16-18, 2026) — `scripts/e2e/element-audit.mjs` (111 URLs ×
375/768/1280, 5 groups) + interactive checks + **authenticated sweep** (real session per role).
Defect log: 12 entries — 2 High (waitlist fake-success; CORS allow-list blocked every
browser edge-function call outside `localhost:5173`), 4 Medium, 2 Low fixed; 2 Low open
(dashboard card headers H3-directly-under-H1 → tracked refactor; cookie-consent banner
overlaps the dashboard sidebar's Homepage/Logout until dismissed → design call, flagged
not changed). The 5 raw-noise classes from the authenticated pass were harness
false-positives and were fixed IN the harness, not silenced. Post-fix: 336 authenticated
loads, 0 issues; logout-flow 5/5 × 3 roles. Full detail: `docs/UI-ELEMENT-AUDIT-REPORT.md`
§4 + §8.
Report: `docs/UI-ELEMENT-AUDIT-REPORT.md`. dashboard/SupportTicketsPage ab routed hai
(`/dashboard/support-tickets` + `/client/support-tickets`, dono sidebars) — orphan defect fixed.
Authenticated runs (LIVE in CI since `a3cb3a5`, Sep 17): 3 permanent E2E test-accounts
(`scripts/e2e/create-test-accounts.mjs` — idempotent; emails in gitignored `.env.e2e`,
secrets `E2E_*_EMAIL/_PASSWORD` in repo; admin profile role server-side 'admin' via
bypass-hook one-off migration, repaired out of history) → CI builds with real (public)
`VITE_SUPABASE_URL`/`_ANON_KEY` secrets so `login.mjs` reaches the live backend →
authenticated element-audit per role-group + `logout-flow.mjs` (back-button security).
GitHub Actions log me credentials `***`-masked print hote hain — logs share karna safe. CI: `.github/workflows/ci.yml` (typecheck+tests+build+
element-audit on every push/PR) — **first green full run: #413** (`28a0e86`). CI strict-audit
debugging: failures surface as `::error::` annotations (check-runs API se public-readable,
logs/artifacts admin-token-gated hain); runner uses Linux DejaVu fonts → header/nav layouts
jo Windows par fit hain wahan overflow kar sakte hain (fixed: nav apna scroll-container).
Expected-error console noise is downgraded to `console.warn` in lib code so strict-audit
stays green.

✅ Profiles-PII fallout sweep (Sep 20, 2026) — migration `20261221000000` ne `email`,
`onboarding_completed`, `suspended_at`, `is_admin` aur `bio` `profiles` se hata diye the, par kuch
call-sites peeche reh gaye the → poore admin console ke tables khaali aa rahe the (metrics, users,
projects, contracts, payments, subscriptions, certificates), aur `subscription-billing-cron`,
`milestone-auto-release`, `email-notifications`, `ai-matching` bhi chup-chaap fail ho rahe the.
Fix: naya shared helper `src/lib/adminProfileDirectory.ts` (naam `profiles` se, email
`profiles_private` se) + `admin-data` me `profiles_private` allow (column-guard ke saath: `is_admin`
/ `email` / `phone` proxy se write nahi ho sakte). CORS recurrence bhi close hui — 16 edge
functions apni purani private allowlist (sirf `localhost:5173` + prod) chal rahe the aur `kyc-submit`
/ `verify-document` `*` wildcard de rahe the; sab `_shared/cors.ts` par aa gaye, aur
`src/test/cors.test.ts` ab fail karta hai agar koi dobara apna CORS likhe. Admin a11y ke 5 inputs +
2 icon-buttons fix, `login.mjs` tokenless session likhne se mana karta hai, CSP me
`cdn.fontshare.com` add. Real data render hone par 3 aur galat column-name nikle (`projects.skills`,
`subscriptions.end_date`, aur `invoices` allow-list me hi nahi tha) — teeno live schema ke against fix.
Verify (dono backend deploys ke baad, LIVE): typecheck + 150 tests + build clean; dashboard 72/0,
client 72/0, **admin 51 loads par 0 raw flags** (real rows ke saath); admin-data probes 200+, `is_admin`
write 403 (column guard hold karta hai), CORS preflight matrix sahi, login 3/3 roles. Deploy: `511da5e`
+ `f6b61a4` pushed to main (Backend Deploy ✓, drift-check clean). Details:
`docs/UI-ELEMENT-AUDIT-REPORT.md` §9.

✅ Stale-profile-column cleanup + launch-data wipe (Sep 20, 2026, `20270119000009`) — pichhle
sweep ke baad bhi 9 DB functions `profiles` ke un columns ko padh rahe the jo `20261221000000` ne
`profiles_private` me bhej diye the. Sab runtime par 42703 dete the, aur `EXCEPTION WHEN OTHERS`
me chhup jaate the: `process_referral` har referral code reject karta tha;
`request_account_deletion` / `process_account_deletion` chalti hi nahi thi (account deletion shuru hi
nahi hota); `delete_user_all_data` ek hi statement me role+email padhta tha apne handler ke andar →
dono NULL → role-specific row aur saari email-scoped PII (waitlist/newsletter/contact/internship)
deletion ke baad bachi rehti thi; `purge_orphan_user_data` har run fail; `is_admin_user` /
`is_user_suspended` dead-but-broken; `admin_signup` (anon-callable SECURITY DEFINER + hardcoded
secret) live wapas aa gaya tha; `handle_new_user` / `handle_new_profile_private` orphaned. Do grant
holes bhi band: `process_account_deletion` PUBLIC ko granted tha bina caller-check ke (jaan-boojh ke
delete), aur dono admin checks anon-executable the. Migration me 3 fail-closed assertions hain, aur
lambi bodies retype karne ke bajaye patch ki gayi hain (anchor mismatch = migration fail, silent no-op
nahi). `db push` ne dava diya tha ki `process_referral`/`request_account_deletion` ke DEFAULTs
drop nahi kiye ja sakte (42P13) — isliye wo defaults waise hi rakhe gaye.

⚠️ CI ka drift-gate bug (fix ho gaya): pre-push check har naye migration file ko "local-only drift"
maan ke fail kar deta tha — matlab repo ke through koi naya migration deploy hi nahi ho sakta tha
(silently). Ab `pre` mode me sirf **remote-only** (DB me hai, repo me nahi) hi drift hai aur pending
migration pass ho jaata hai; `db push` ke baad naya `post` step dono direction check karta hai.

✅ Live launch data clean (Sep 20, 2026) — 8 test accounts (`qafreelancer`, `qaclient`, `playtest`,
`freelancer.test@mydomain.com`, `client.test@mydomain.com`, 3 `e2e.*@growlancer-test.com`)
`delete_user_all_data` se fully cascade karke delete kiye (har ek `errors: []`, aur `email_scoped` step
chala = upar wala fix proven). Ab live: contracts/escrow/reviews/projects/services/transactions
**0**, aur `get_public_platform_metrics()` → `{escrow: 0, reviews: 0, satisfaction: null, countries: 2}`.
Bache 6 profiles real accounts hain (founder + signups), isliye About/Home aise dikhte hain:
**Members 6 · Escrow ₹0 · Satisfaction "New" · Countries 2** — sab DB-backed, koi fake number nahi.
About ka real-time canvas ab **har typing cycle par fresh DB values** padhta hai (`LiveCodeTerminal`
`onCycle` → `refresh()`, aur pehle `countries` hook me hardcoded `null` tha → "— countries" print hota
tha). Realtime channel sirf un tables par hai jo anonymous visitor sach me padh sakta hai (profiles,
reviews) — escrow ki RLS policy sirf contract parties ko deti hai, isliye wo ab public page par
subscribe nahi hota (warna unauthorized console error). Marketing copy se "join thousands of
clients" claim bhi hata diya.

✅ CI self-seeding + fail-closed guard (Sep 23, 2026 — `src/test/ciGuardrails.test.ts`) — test
accounts production me permanently nahi rehte: CI job unhe start par seed karti hai aur `always()`
teardown step se hata deti hai (`scripts/e2e/remove-test-accounts.mjs`, idempotent,
"already_absent" par safe). Ab guard **self-skip nahi karta** — dekho neeche wala ✅ entry: missing
secret = job RED, aur founder ke paas sirf **ek** secret add karna hai (`SUPABASE_SERVICE_ROLE_KEY`;
`SUPABASE_URL` ab `VITE_SUPABASE_URL` se fallback leta hai, aur chhe `E2E_*` secrets already set hain
— `gh secret list` se verified).

✅ Launch-readiness closure (Sep 20, 2026, `20270119000010`) — `request_account_deletion` ne
`pg_proc` reading ke baad BHI kaam nahi kiya: ek real user se chalane par `23502` aaya, kyunki
`user_deletion_requests.confirm_token` / `confirm_token_expires_at` NOT NULL hain bina default ke aur
INSERT dono nahi de raha tha (aur `notifications.link` likh raha tha, jo column exist hi nahi karta —
sahi naam `action_url` hai). Matlab account deletion pehle se hi **kabhi** start nahi ho sakta tha.
Ab token 64-hex-char UUID entropy ke saath generate hota hai + fail-closed assertion NOT NULL columns
check karta hai. Asli user bankar end-to-end verify kiya (create → sign-in → profile → referral →
deletion request → full cascade): **9/9 checks**, `delete_user_all_data` `errors: []` aur
`email_scoped` step chala; throwaway account `finally` me khud ko delete kar deta hai. **Lesson:** do
round catalog-reading ne wo constraint nahi dekha jo ek asli call ne turant pakad liya — schema
introspection write-time rejection nahi dikha sakti.

✅ Signup silent-failure band — signup ke peeche ab koi DB trigger nahi hai (`handle_new_user`
orphaned tha, drop kar diya), isliye profile row sirf browser ke `create_user_profile` call se banti
hai — aur wo failure `devWarn` tha jab user ko "Account created successfully" dikh raha tha. Ab dono
fallbacks `console.error` karte hain aur user ko saaf message milta hai (auth account sach me banta
hai, isliye failure report karna galat hota aur email occupied hone ki wajah se user phas jaata).

✅ `admin-data` money-path band (defect #22 closed) — `wallets` / `escrow` / `transactions` par
insert/update/delete ab 403, read jaise tha waise. In rows ko sirf SECURITY DEFINER RPCs se badalna
hota hai (Security Principle §2); app ka har call-site read ya realtime subscription hai, isliye koi
capability nahi gayi.

✅ Cookie banner overlap fix — first-visit banner `fixed bottom-0` hai aur dashboard/client sidebar
full-height, isliye Homepage/Logout live consent tak unreachable the. Ab banner apni **measured**
height `--consent-banner-h` me publish karta hai (ResizeObserver, narrow screens ke wrap ke liye) aur
dono sidebars `100vh` se subtract karte hain — unset = `0px`, yaani jinhone already answer kar diya
unke liye layout bilkul same. 3 tests contract lock karte hain.

✅ CI gate theek — authenticated audit ab seed-capability par gated hai (service key + teeno
passwords), `E2E_FREELANCER_EMAIL` par nahi. Stale secret gate kholé rakhta tha aur accounts gone the
→ job credentials par fail hota tha, product par nahi. **UPDATE (Sep 23, 2026):** ye "missing config
= pass skip" policy ab ULAT di gayi hai — neeche wali fail-closed entry dekho. Silent skip hi
asli defect tha: green check ek aise guardrail ke upar baith raha tha jo kabhi chala hi nahi.

✅ Country stat + ownership fix (Sep 20, 2026, `20270119000011`) — "Countries with members" 1 hi
country ko 2 dikha raha tha: OAuth country-gate `IN` bhejta hai, onboarding `India`, aur
count(DISTINCT) dono ko alag gin raha tha. Ab `normalize_country()` reference table se canonical
name store karta hai (dono paths converge), purani rows backfill, metric normalized value ginta hai.
Saath me `update_user_country` arbitrary `p_user_id` accept kar raha tha bina caller check ke (koi bhi
user kisi ka bhi country badal sakta tha) — ab owner-only. Verify: do throwaway accounts se 6/6
(owner `IN` → `India`; cross-user write → Unauthorized, victim untouched); live: 6 profiles,
stored `India`, metric `{countries: 1}`, About `6 / ₹0 / New / 1`.

✅ Authorization hardening + signup repair (Sep 22, 2026, `20270119000012`) — systematic IDOR +
EXECUTE-grant audit: **21 functions** ko caller-ownership/admin guard mila (13 notification/push/
wallet-read/match RPCs arbitrary `p_user_id` le rahe the → koi bhi kisi ka bhi notifications/push
tokens/wallet balance padh sakta tha; `create_user_profile` anon-callable tha aur kisi ka bhi profile
overwrite kar sakta tha; `get_team_role_contract`, `generate_project_matches`/`upsert_project_matches`,
`generate_credential_token`, aur credential audit writers bina check ke). **20 functions server-only**
(anon+authenticated se EXECUTE revoke, service_role re-granted + asserted) — including
`update_wallet_balance` (owner-branch se self-credit ho raha tha), `hold/release_wallet_funds` +
`process_withdrawal_complete` (withdrawal edge ab apne service-role client se call karta hai),
payment/webhook internals, cron/maintenance, `get_user_email` (PII). `cleanup_verification_rate_limits`
bhi server-only (uska 15-min DELETE hi public verify ka live window tha) → `cleanup-verification-rate-limits`
cron add hua; shared `cleanup_expired_rate_limits` jaan-boojh ke callable rakha (24h se purani rows hi
delete karta hai, ~16 edge functions use karte hain). `create_user_profile` par `anon` grant bacha
(email confirmation on hone par signUp ke turant baad session nahi hota) — guard sirf just-signed-up
auth row ko create karne deta hai, existing profile overwrite nahi. Saath me real bug fix:
`create_user_profile` `referral_code` `profiles` se padh raha tha (42703 since `20261221000000`) — yaani
har real signup RPC par fail ho kar browser ke fallback par ja raha tha.
**Dry-run ne 3 defects pakde** (rolled-back transaction, live DB par): lowercase `begin` par case-
sensitive anchor fail; `get_wallet_balance_v2` ka poora body single line me hai (whole-line anchor nahi
milta); aur single-line body par guard ka trailing `-- comment` baaki body ko kha jaata tha. Ab anchor =
verbatim body me pehla word-boundary BEGIN (case-insensitive) + whole-line cross-check, aur injection
newline ke saath band hota hai. Verify: catalog-confirmed grants, 10 functional probes (owner pass /
cross-user Unauthorized / anon signup-create pass / service_role pass / admin-only pass) + poora
assertion block (21/20/19 counts) live par rolled-back transaction me chala; typecheck + 178 tests +
build clean; naya `src/test/serverOnlyRpcs.test.ts` list migration se padh kar enforce karta hai ki koi
app code server-only RPC ka naam dobara na likhe.

✅ Privilege-column lock (Sep 22, 2026, `20270119000013`) — independent deep-audit pass ne `20270119000012`
ke BAAD ek aur class pakdi: **self-writable trust columns**. (a) `profiles_private.is_admin` —
`20261221000000` ne flag ko `profiles` se yahan move kiya, par naye table ko na column-locked RLS policy
mili (sirf `USING/WITH CHECK (auth.uid() = id)`) na protect-trigger, aur ACL table-wide UPDATE/INSERT
deta tha → probe me self `is_admin=true` **ALLOWED rows=1**. Impact sirf flag-flip nahi: `admin-data` ka
`verifyAdminSession` **sirf** `profiles_private.is_admin` padhta hai, yaani ek PATCH = poora admin proxy
(saare users ki email/PII, payments, escrow, contracts, suspension writes). Saath hi
`suspended_at`/`suspend_reason`/`banned_at` bhi self-writable the → suspended/banned user khud apna ban
hata sakta tha (ALLOWED rows=1). (b) **Reputation columns**: `profiles.rating`/`total_reviews` aur
`freelancer_profiles.rating`/`total_reviews`/`reputation_score`/`weighted_rating` kisi guard me nahi the →
self `rating=5.0, total_reviews=999` **ALLOWED rows=1**; ye wahi numbers hain jo client-side search,
matches, proposals, invites aur "top rated" gate render karte hain → merit-based ranking promise ka direct
break. Fix (dono layers, codebase ke existing patterns): table-wide UPDATE/INSERT revoke + sirf
client-write columns (`id, email, phone, referral_code, onboarding_completed, created_at, updated_at`) ka
column-grant, plus `protect_profiles_private_privilege_columns()` BEFORE INSERT OR UPDATE trigger
(INSERT bhi, warna naya row `is_admin=true` ke saath aata hai); reputation ke liye dono purane guard
extend hue aur `update_reputation_score` (in columns ka **akela** legitimate writer, review-trigger se
chalta hai) ko `app.bypass_privilege_check` flag mila. Legit paths intact (dry run): service_role admin
suspend ALLOWED, signup-shape INSERT ALLOWED, email update ALLOWED, `complete_onboarding()` definer path
ALLOWED, `update_reputation_score` ALLOWED; self-writes BLOCKED (ACL 42501, aur ACL jaan-boojh kar wapas
kholne par trigger P0001). **Dry-run ne 2 harness bugs bhi pakde** (stale `app.bypass_privilege_check`
phases ke beech leak ho raha tha; test ka lazy regex zero-width match kar ke vacuous pass de raha tha) —
dono fix hue aur negative-control se prove hue. Verify: typecheck + 185 tests (7 naye
`src/test/profilesPrivatePrivilegeGuard.test.ts`) + build clean. Details: report §13.

✅ Runtime pentest + self-detecting drift monitor (Sep 22, 2026, `20270119000014`) — §13 ne SQL-level
(rolled-back) probes se locks prove kiye the; browser PostgREST/RLS/ACL ke through aata hai, isliye
ab **real HTTP pentest** bhi hai: `scripts/e2e/pentest-privileges.mjs` ek throwaway account banata hai
(service-role admin API, `email_confirm`), uske real JWT se 8 escapes try karta hai, phir usi
full-cascade path se account delete karta hai (`finally` me, isliye interrupted run bhi kuch nahi
chhodta). Result: `is_admin` self-grant / suspension self-lift / INSERT-with-is_admin → 403 `42501`;
`profiles.rating` + `freelancer_profiles` reputation inflate → 400 `P0001`; wallet self-credit +
`hold_wallet_funds` → 403 `42501`; `grant_admin_role` non-admin → Unauthorized; values unchanged
(is_admin/suspension/rating/role/balance sab), legit paths (`create_user_profile`, onboarding flag,
`complete_onboarding()`, profile name) intact, teardown 0 leftovers (live counts wapas 6). **Probe ne
apni hi ek galti pakdi** (same trap as §13.6): `HTTP 200 []` ko failure samajh raha tha, jabki wo
"0 rows matched" hai — account ke paas `freelancer_profiles` row hi nahi thi, isliye guard reach hi
nahi hua; ab script pehle row banata hai aur escape ka faisla **rows-changed** se karta hai, HTTP
status se nahi. Saath me class **self-detecting** ho gayi: naya server-only
`self_writable_trust_columns()` (trust-shaped column + `authenticated` UPDATE + owner-scoped policy +
koi `protect_*` trigger nahi) aur `check_security_drift()` usko hourly sweep karta hai
(`self_writable_trust_column` alert, admin/role ke liye `critical`) — koi naya cron nahi, existing
alert-email path hi use hota hai. Migration **positive control** ke saath aata hai: apne transaction me
ek violator table banata hai, detector se usse flag karwata hai, drop karta hai, phir live schema se
**0 findings** maangta hai — yaani detector toota ho to deploy fail hota hai. Dry run (live DB,
rolled back): positive control flagged, baseline 0, `check_security_drift()` 0 return, 0 alerts.
Negative control (exception list me chupke `profiles_private.is_admin` daalna) unit test fail karta
hai. Verify: `npm run typecheck` + **188 tests** (10 `profilesPrivatePrivilegeGuard.test.ts` me) +
build clean. Details: report §14 (runtime table + drift monitor).

✅ Member count honest + ghosts gone (Sep 23, 2026, `20270119000015`) — jo 2 **ghost profiles**
(`pemin@` / `piveme@growlancer.com`, Aug 28) flagged the, wo migration ke andar hi
`purge_orphan_user_data()` se hat gaye (idempotent, fail par poora rollback, aur post-purge assertion
ki koi orphan bacha nahi). Saath me `get_public_platform_metrics()` ab `memberCount` deta hai = living
profiles ⋈ `auth.users` (yaani jo abhi bhi sign-in kar sakte hain), `profiles.count` nahi — live ab
**4** (pehle 6). Hook ka purana `profiles` count-query bhi hata diya: members ab usi RPC ke
`memberCount` se aata hai, isliye ek hi source-of-truth hai. **Regression jo isi pass me pakdi gayi:**
us hook me `.join('auth.users', …)` likha gaya tha, jo supabase-js me exist hi nahi karta (typecheck
fail) — ab hata diya.

✅ Escrow money-path runtime pentest + 3 live fixes (Sep 23, 2026, `20270119000016`) — §14 ka harness
gaye ab **teen** throwaway accounts (client + freelancer + ek non-party) ke saath poora money path
real HTTP par drive karta hai: `create_contract_with_escrow` → fund → release → dispute → withdraw,
har step par cross-party / non-admin / **anonymous** attempt (refuse hona chahiye) + owner path
(kaam karna chahiye). 72 checks, 34 escape attempts. Pehle run me 7 failures:
**(a) HIGH** — `raise_contract_dispute` `anon` ke liye EXECUTE-granted tha aur uska guard
`auth.uid() NOT IN (…)` NULL-safe nahi (anon ke liye `NULL NOT IN` = NULL = falsy, guard fire h
i nahi karta) → ek unauthenticated request kisi bhi contract ka escrow freeze kar sakta tha; wahi shape
`create_contract_with_escrow` (`p_client_id <> auth.uid()`, anon ne **contract bana diya**) aur
`cancel_withdrawal` (held funds balance me wapas) me bhi thi. Fix do layer me: 30 money/contract RPCs
se `PUBLIC, anon` ke grants revoke (`authenticated` + `service_role` re-grant; `get_public_platform_metrics`
jaan-boojh kar chhoda — public marketing pages usi se chalte hain), PLUS teeno guards ko `auth.uid()
IS NULL` se NULL-safe banaya. **(b) HIGH** — `withdrawals` par `authenticated` ki INSERT + UPDATE
dono policies thi (`UPDATE` me `WITH CHECK` hi nahi tha): user khud ka `completed` withdrawal row
forge kar sakta tha aur amount `999999` likh sakta tha — dono probe ne production par lande. Dono
policies drop (writer sirf withdrawal edge fn = service_role, aur owner-guarded `cancel_withdrawal()`
RPC; app sirf SELECT karta hai, capability koi nahi gayi). **(c) CRITICAL regression** —
`should_bypass_privilege_check()` flag ko `current_setting('app.bypass_privilege_check', true)::boolean`
se padhta tha; transaction-local `set_config` **pooled connection** par commit ke baad placeholder ko
empty string chhod jata hai, aur agli request par `''::boolean` → `22P02` → us connection par profile
writes 400 ho jaate the (`complete_onboarding`, subscription/KYC/admin-grant — sab ye flag set karte
hain). Harness me 5/5 reproduce hua; `NULLIF(current_setting(…, true), '')` se fix. Iske saath hi
class **self-detecting** hai: hourly `check_security_drift()` ab `anon_reachable_money_rpc()` (0
baseline) aur `client_writable_money_tables()` (0 baseline) sweep karta hai, dono ke **positive
control** migration ke andar hi (planted violator flag hona chahiye, warna deploy fail), aur poora
migration live par rolled-back transactions me dry-run hua. Verify: typecheck + 188 tests + build
clean; deploy ke baad pentest **72/72 pass**. Details: report §15.

✅ Team Projects contract isolation (Sep 23, 2026, `20270119000017`) — verify kiya ki ek member ka
dispute / refund / milestone outcome doosre member ke escrow ko touch nahi karta. Pehle saare live
`escrow` writers (17 `UPDATE escrow` sites) padhe: design contract-scoped hai (`WHERE contract_id = …`)
aur escrow RLS participants-only — par 3-role runtime probe ne **teen real defects** nikaale:
**F1 BLOCKER** — team contract **kabhi ban hi nahi sakta tha**: `create_team_role_contract` design se
`project_id = NULL` bhejta hai, par `contracts.project_id` NOT NULL tha → har call `23502`, yaani Team
Projects ne aaj tak kisi ko hire hi nahi kiya tha (team tables live bane the, repo migration
`20261229000000` ek-character stub hai, isliye drift pakda nahi gaya). **F2 HIGH** — koi bhi signed-in
user kisi aur ke team project par contract attach kar sakta tha (SECURITY DEFINER, `team_projects`
ownership check hi nahi; guard NULL-unsafe) + arbitrary freelancer ko fake "You've been hired!"
notification. Ab `auth.uid() IS NULL` bail-out + explicit ownership check + **one role = one contract**
(role → `filled`). **F3 HIGH** — hourly auto-release milestone ko `released` mark karta tha par escrow
`funded` reh jaata tha aur freelancer ko **0.00** credit hota tha, client ke aggregate `escrow_balance`
me phantom funds chhoot jaate the — jo doosre contracts ke release `GREATEST(…, 0)` se kaat-te the;
yahi ek jagah thi jahan ek member ka outcome doosre ke accounting tak pahunch sakta tha. Runtime par
ab proven: A ka dispute sirf A ka escrow freeze karta hai (B/C `funded` + `active`), B ka release A/C
rows ko chhoota hi nahi, C ka refund A/C ko nahi, cross-member release/dispute/refund/milestone sab
refused, B A ka escrow padh nahi sakta. **Flagged, not changed:** `freeze_contract`/`unfreeze_contract`
dono parties ka `wallets.is_frozen` set karte hain (team project me wo shared client wallet hai) — par
us column ka koi reader nahi hai, isliye semantics nahi badle. Details: report §16.

✅ Cron ka service-role check legacy GUC padh raha tha (Sep 23, 2026, `20270119000018`) — §16 ka F3
fix bhi actually kaam **nahi** kar raha tha: `release_escrow` ne service-role branch ko legacy singular
`current_setting('request.jwt.claim.role', …)` se probe kiya, jo current PostgREST set hi nahi karta
(plural `request.jwt.claims` JSON set hota hai; Supabase ka `auth.role()` dono padhta hai). Cron ke
liye bhi probe `''` → `Unauthorized` → milestone `released`, wallet **0.00**, escrow `funded`. Wahi
stale probe `auto_release_contract` (delivered-but-unpaid path, pehle koi probe nahi tha) me bhi thi.
Catalog sweep: schema me sirf yahi **2** functions legacy singular parameter padhte the. Fix: shared
`is_service_role_context()` dono idioms probe karta hai (`current_setting('role')` + `auth.role()`,
NULL-safe — plain session `none` deta hai), aur dono functions usi ko use karte hain. Saath me naya
server-only detector `stale_jwt_claim_check()` (match se pehle SQL comments strip karta hai, warna
fix ke apne comments hi flag ho jate) ab hourly `check_security_drift()` me sweep hota hai — fix se
pehle baseline par usne **exactly wahi 2 toote functions** flag kiye, aur migration me **positive**
(planted violator flag hona chahiye) + **negative** (sirf prose me naam ho to flag nahi) dono controls
hain. Harness ke escrow aggregates ab hard-coded nahi hain, live invariant hain:
`escrow_balance == sum(escrows still held)` — koi bhi cross-member leak isko tod dega. Is pass me apne
hi 2 defects pakde: (i) `count(*) FROM public.check_security_drift()` **hamesha 1** deta hai (function
scalar `integer` return karta hai) — assertion kabhi fail ho hi nahi sakti thi; ab direct call +
`src/test/serviceRoleContextGuard.test.ts`; (ii) hard-coded `3 × rate` expectation galat thi; aur
(iii) reason-based probe ka predicate `errorCode()` par bana tha, jo `code || message` deta hai —
SQLSTATE ke saath message drop ho jata hai, isliye "refusal ne apni wajah batayi" wali assertion
kabhi pass ho hi nahi sakti thi (escape har run me sahi refuse ho raha tha, probe use failure bata
raha tha); ab `errorReason()` helper. Sab live DB par rolled-back transactions me dry-run hua.
Verify (Backend Deploy **#20** ke baad, LIVE): typecheck + **193 tests** + build clean; pentest
**103 checks / 40 escapes / 0 failures** — service-role milestone leg ab escrow release karke
freelancer ko **5000.00 credit** karta hai (pehle `false` / `0.00`), aur teeno jagah
`escrow_balance == sum(held escrows)` hold karta hai (20000=20000, 20000=20000, 15000=15000); live
schema: dono functions helper use karte hain, legacy singular parameter kahin nahi,
`stale_jwt_claim_check()` = **0** findings, monitor usse sweep karta hai, `anon` dono naye functions
execute nahi kar sakta, open alerts 0. Details: report §17.

✅ Ek poora Razorpay chain real test-mode me drive kiya (Sep 23, 2026) — naya
`scripts/e2e/razorpay-chain.mjs`: throwaway client + freelancer + real contract, phir gateway chain,
aur **wahi step report karta hai jahan chain rukti hai**. Script **live keys par chalne se mana karta
hai** (`key_id_mode === 'test'` hona zaroori), kyunki live run sach me paisa move kar sakta hai.
Nateeja: deployed credentials **configured aur authenticating** hain, mode = `test`; `create_order`
ne **asli gateway order** diya (`order_TfORNMzB0QuleL`), amount server-side DB se aaya (₹5000 contract
+ ₹250 flat 5% = ₹5250, client koi price nahi bhejta); forged `verify_payment` signature → `Invalid
payment signature`; unsigned webhook → `401`, aur escrow `pending` hi raha (fail-closed). Escrow
funding (wallet path) + milestone release kaam karte hain — freelancer ko **₹5000.00 credit** hua.
**Do break points, dono honest:** (1) **payment authorization interactive hai** — Razorpay ke hosted
checkout me hi hoti hai, koi script complete nahi kar sakti (ye gap nahi, sahi posture hai: forged
signature aur unsigned webhook dono refuse hote hain) — isliye **webhook → escrow-funding leg** sirf
ek real (test-mode) human payment se exercise ho sakta hai, aur wo abhi tak production me kabhi chala
nahi; (2) **last mile:** `POST /v1/payouts` → **404 `The requested URL was not found on the server`**
= RazorpayX Payouts product account par enabled nahi hai (function ise config/not-ready maan ke
**queue** karta hai, hard-fail nahi) — isliye aaj **platform se paisa bahar nahi ja sakta**: release
wallet credit karta hai, withdrawal queue hoti hai. Money integrity hold kari: queued withdrawal ne
wallet `balance 4000 / pending 1000` chhoda (funds **held, lost nahi**), retry cron
(`growlancer-stale-withdrawal-recovery`, har 15 min) maujood hai, teardown clean (`errors: []`), aur
`--keep` se bache 6 accounts bhi usi cascade se hat gaye. Probe ke 4 apne defects bhi pakde/fix kiye
(order-id ka path `data.razorpay_order.id`; `razorpay_orders.amount` **rupees** me hai paise me nahi;
`razorpay_payout_id` + `failure_reason` column naam; client wallet zero + `payout_methods.details`
NOT NULL) — inme se 3 wrong-column/wrong-unit galtiyan thi, logic error nahi. Details: report §18.

✅ AI providers live-verified (Sep 23, 2026) — naya `scripts/e2e/ai-providers.mjs` real signed-in session se
poochta hai ki teen AI functions sach me model call kar rahe hain ya chup-chaap deterministic par gir rahe
hain. Ye zaroori tha kyunki teeno **alag tareeke se** fail hote hain: `ai-assistant`/`ai-writer` key
missing par 500 "AI service is not configured" dete hain (fail closed), `ai-writer` gateway reject par
**502** deta hai, par `ai-matching` **hamesha 200 `success`** deta hai — key na ho ya dead ho to sirf
`ai_enhanced: false` aata hai, jo bahar se bilkul healthy dikhta hai. Probe pehle poori prerequisite
state seed karta hai (throwaway client + aisa throwaway freelancer jiska category+skills project se
match kare + project) warna `candidates.length === 0` ki wajah se `ai_enhanced` false aata hai
credentials ki wajah se nahi. **Nateeja: teeno WORKING** — `ai-assistant` live SSE me
`model="deepseek/deepseek-chat-v3-0324"` ke saath asli output ("PONG"), `ai-writer` asli text
("Landing Page Design for Small Bakery Business"), `ai-matching` `ai_enhanced=true` + model-authored
`ai_score=100` / reason. **Vacuous pass nahi:** anonymous call teeno par **401** deta hai (agar 200
aata to verdict bekaar hota). Teardown clean, DB baseline par wapas (4 profiles, 0 projects,
0 ai_matches, 0 orphans). Probe ke 3 apne defects bhi pakde/fix kiye: `create_user_profile` ke param
naam (`p_id/p_email/p_name/p_role/p_referral_code` — galat naam par PostgREST **404** deta hai, aur
response ignore karne se missing profile baad me FK violation bankar nikla), `delete_user_all_data`
me extra args (wahi 404), aur pehla version unfalsifiable tha (isi liye 401 boundary check add hua).
Details: report §20.

✅ Whole-surface runtime audit — payout PII leak band (Sep 25, 2026, `20270119000019`) — naya
`scripts/e2e/surface-audit.mjs` poore surface par chalta hai (113 tables, 233 functions, 298
policies): anon-executable SECDEF helpers caller-supplied id ke saath, 22 owner-scoped tables
do signed-in users ke beech, 47 private tables anon ke saamne, cross-tenant workspaces (positive
control ke saath), aur DB invariants. **10 real failures mile**, teen CRITICAL: (a)
`get_payout_methods(p_user_id)` ne ek **anon** caller ko doosre user ki poora payout details de
diye (upi_id, bank, IFSC, holder name, masked account, email, phone) — runtime par `LEAKED 4
payout row(s)`; (b) `delete_payout_method` ne anon se victim ka payout method **delete kar diya**
(`{"success":true}`); (c) `set_default_payout_method` ne anon se default flip kar diya. Root cause:
guard `IF p_user_id <> auth.uid()` tha — anon ke liye `auth.uid()` NULL hai, to comparison NULL, to
branch chala hi nahi. Class ab **paanch** functions me thi (usme `release_milestone` aur
`process_withdrawal_complete` bhi, jo aaj reachable nahi par wahi accident par depend karte the) —
isi liye ab one-off fix ke bajaye detector hai. Saath me: `update_reputation_score` (merit-ranking
columns ka akela writer) anon-callable tha, `_refund_audit`/`_refund_history_event`/`_refund_notify`
bina guard ke anon-callable the (anon ne payment audit row **insert** kar li), aur **workspace RLS
toota hua tha** — `42P17 infinite recursion detected in policy for workspace_members` (har
authenticated read HTTP 500) aur usi clause me `wm.workspace_id = wm.workspace_id` ta utology (sirf
recursion fix karna cross-tenant leak deta). Membership test ab `is_workspace_member(ws, user)`
SECURITY DEFINER helper me — ids **arguments** se — jo dono ek saath band karta hai; rolled-back
transaction me 2 seeded workspaces par prove: own members/logs/workspace = 1, doosre ka = 0.
`service_offers` insert check aur ek dead `razorpay_transactions` policy bhi theek. Naye detectors
`null_unsafe_auth_guard()` + `self_referential_policy_predicate()` (dono me positive **aur**
negative control migration ke andar) ab hourly sweep me hain. Harness ke **5 apne defects** bhi
fix hue (PostgREST insert ka khaali body → null ids, shared row ordering, invalid `role: 'owner'`,
HTTP 500 ko "blocked" ginna, aur FK error ko refusal samajhna). Verify: typecheck + lint + **213
tests** + build clean; 9 negative controls RED/GREEN; risky parts live par rolled-back
transactions me dry-run. Details: report §21 (+ §21.9 neeche).

✅ Deploy blocker clear + usi deploy ne apni hi ek defect pakdi (Sep 25, 2026) — pehle
`SUPABASE_SERVICE_ROLE_KEY` repo secret set hua (local `.env.local` se stdin ke through, value kabhi
print/commit nahi hui), phir Backend Deploy re-run: fail-closed guard ✓, drift check ✓ — aur
**`db push` FAIL** hua: `syntax error at or near "' || chr(10) ||" (SQLSTATE 42601)`, statement 17.
Wajah: `20270119000019` ke `DO $patch_guards$` body me ek quote kam thi (`''Unauthorized');` ki jagah
`''Unauthorized'');` chahiye tha) → literal ek token pehle band, `' || chr(10) ||` naya literal ban
gaya. Ye typecheck + lint + build + **213 tests** + 10 guard tests + 9 negative controls sab pass
karke nikla — kyunki wo sab migration ko TEXT ki tarah padhte hain; kisi ne parser se nahi poocha
(wahi §18/§13.6 lesson, ek level gehra).

✅ Naya lexical guard — `src/test/sqlMigrationSyntax.test.ts` (5 tests) poore **269 migrations** ko ek
asli single-pass lexer se check karta hai (single-quoted literals + `''`, `E'…'` escape strings — repo
inka use karta hai, double-quoted identifiers, `--` aur nested `/* */`, aur `$tag$` bodies jo **in
place** lex hote hain — tag STACK, recursion+offset nahi — isliye `DO` body ke andar ka stray quote
apni asli line par pakda jaata hai, jahan ye defect tha). Har finding ka `line` aur `snippet` ek hi
number se aate hain. Guard banate waqt 3 cheezein seekhi: (a) pehla version toote migration ko
**clean** batata tha — `$tag$` bodies opaque the aur uska synthetic control isliye pass ho gaya tha ki
usme COMMENT line nahi thi (`line-comment` ka reset `switch` me likha tha jahan newline branch
`continue` kar chuki hoti hai → pehle `--` ke baad lexer hamesha "comment me" reh kar sab kuch pass
kar deta tha, yaani chup-chaap guard karna band — bilkul isi session wali class); (b) valid SQL bhi
reject ho raha tha: repo legit `'{` … `}'::jsonb` multi-line JSON templates likhta hai (4) aur
`$g$…$g$` strings jinme closing tag se pehle `-- comment` hota hai (21) — inke liye rule: **jo tag
body ko band karta hai wo us body ka content nahi ho sakta**, isliye body ke andar comment state se
closing tag jeetta hai; (c) recursion ke offset se line numbers ek se off ho rahe the → poora offset
arithmetic hata diya. **Controls:** asli defect asli migration me wapas daala → **RED, line 287 par**
(sahi line); restore → **GREEN**, file byte-identical. Verify: typecheck + lint + **218 tests** (17
files) clean; 269 migrations lexically clean. Details: report §21.9.

✅ `20270119000019` LIVE (Sep 25, 2026) — secret add hone ke baad deploy ne **apne aap 3 defect**
nikaale, ek-ek karke: (1) `db push` par `syntax error ... 42601` (ek quote kam, `DO` body me) → fix +
naya lexer guard; (2) phir migration ka **apna positive control** fail hua: `self_referential_policy_predicate()`
sirf qualified spelling (`x.y = x.y`) match karta tha, planted `owner_id = owner_id` chhoot raha tha →
dono spellings add, control ab **dono** plant karke dono demand karta hai (`v_count <> 2` = deploy fail);
(3) phir `has_function_privilege('anon', ('public.'||fn||'(uuid)')::regprocedure, ...)` par
`function "public.delete_payout_method(uuid)" does not exist` (42883) — asli signature `(uuid, uuid)`
hai, yaani **fail-closed assertion jo apne schema ke baare me galat ho wo fail-closed nahi hota, sirf
fail hota hai** → ab OID se resolve hota hai (pg_proc.oid), naam+arglist guess nahi. Teeno fix push karne
se pehle live par read-only verify kiye gaye (baseline: trio ke 3 anon grants, internals ke 4 app-role
grants, `null_unsafe_auth_guard()` baseline = theek wahi 5 functions jo ye migration patch karti hai,
post-rewrite detector 0, koi overload nahi). **Deploy ke baad LIVE:** `db push` ✓, drift-check ✓, saare
edge functions redeploy ✓, pentest ✓, aur naya **whole-surface audit 110 checks / 0 failure / 3 vacuous**
(pehle 10 failures the — 9 fix ho gaye, aur 10th `get_profile_views` ko **public-by-design** reclassify
kiya: public freelancer profile page visitor ko count dikhata hai; harness me ab explicit
`PUBLIC_BY_DESIGN` allowlist hai jiski membership khud check hoti hai, aur probe ab bhi fail karega agar
wo counter ki jagah rows/PII lautaye). **Flagged (product call, fail nahi kiya):** `record_profile_view`
bhi anon-callable hai aur **likhta** hai — koi bhi bina login kisi bhi freelancer ka public view-counter
badha sakta hai (vanity metric, data leak nahi) — harness me `observe` note ke roop me dikhta hai. Details:
report §21.10 + §21.11.

✅ Browser layer pehli baar poora chala — aur uske ne teen fixture defects pakde (Sep 26, 2026,
`20270119000020` + `20270119000021`) — secret add hone ke baad CI ka element-audit job pehli baar
*actually* chala: anonymous strict 336 loads/0 flags, seed ✓, login 3/3, authenticated dashboard 72/0,
client 72/0, admin 51/0 — phir logout-flow freelancer ke pehle step par fail hua ("login reaches
dashboard — still at /"). Teeno defects ek hi shape ke the: **fixture wo state prove nahi kar sakta tha
jo audit maanta hai.** (a) **CRITICAL** — `create-test-accounts.mjs` account lookup
`GET /auth/v1/admin/users?email=…` se karta tha, jise **GoTrue chup-chaap ignore** karta hai (page 1
lauta deta hai; live par bogus email aur real email bilkul same response dete hain) → `users[0]` ek **asli
user** nikla aur seed ne uske upar `PUT /admin/users/<id>` (password reset) + `create_user_profile`
(name/email overwrite) chalaya; `grant_admin_role` refuse hua to `is_admin` false hi raha (20270119000013
ka guard hold kiya). Evidence: `profiles.name_changed_at` = 2026-09-25T09:57:52Z (seed step ki pehli
second), `auth.users.updated_at` same date; victim GitHub OAuth signup tha (password uska login path nahi).
(b) **`grant_admin_role`** service-role caller ko `200` + `{"success":false,"error":"Unauthorized: admins
only"}` deta tha (auth.uid() NULL) → admin sweep admin **login screen** ko "admin" ginne wala tha; ab
`is_service_role_context()` (§17 helper) accept karta hai, admin-check intact, OID se asserted; seed
`is_admin` REST se read-back karta hai aur `login.mjs` admin **console** maangta hai (stored session kaafi
nahi). (c) Seeded accounts `onboarding_completed=false`/`country=null` the — `getPostAuthPath()` aise
profile ko `/onboarding` bhejta hai, isliye "login reaches dashboard" kabhi pass ho hi nahi sakta tha; ab
seed wahi do values likhta hai jo app ka onboarding likhta hai + read-back. **Repair:** `20270119000020`
ne victim ka `name`/`email` wapas kiya (app ke apne rule se: `user_metadata.name` → email local part) aur
seed ka chhoda hua `name_changed_at` clear kiya, narrow predicate + fail-closed assertions ke saath; live
verify: `mdmirankhan78` / `mdmirankhan78@gmail.com` / `leaks=0`. Leaked password hash se restore nahi ho
sakta tha, isliye admin API se fresh random value se replace kiya (value kabhi print nahi hui; account
GitHub se sign-in karta hai). Local browser layer (same accounts, production build): logout-security
**5/5 × 3 roles**, dashboard 72/0, client 72/0; 6 naye guardrail tests + negative controls (dono defect
wapas daal ke RED, restore par GREEN). Details: report §22.

**Final green run `36237099675` (Sep 26, CI #green):** anonymous 336/0, authenticated dashboard 72/0 + client 72/0 + admin 51/0, logout 5/5 × 3 roles, teardown `removed=3 failed=0` — pehli baar poora browser layer (guard → seed → login → sweeps → logout-security → cleanup) ek hi run me green hua.

✅ ai-matching ownership band (Sep 26, 2026, `78e5f43`) — pichhla ⚠️ ab history hai: jo user project
ka client nahi hai wo pehle `200 success` + `ai_enhanced=true` + asli match list paata tha (runtime par
proven), yaani koi bhi signed-in account kisi ko bhi project-id par real AI spend karwa sakta tha aur
uske `ai_matches` rows likhwa sakta tha — wahi class jo `20270119000012` ne 21 doosre functions me band
ki thi. Ab project fetch WHERE clause me hi owner-scoped hai (`client_id = authData.user.id`, identity
verified JWT se, request body se nahi) aur rate-limit insert, AI gateway spend aur `ai_matches` rewrite
— teeno se PEHLE chalta hai; non-owner ko `404 Project not found` milta hai. Reorder ne ek subtle
doosra hole bhi band kiya: per-minute rate-limit `project_id` par keyed thi, yaani non-owner kisi ka
bucket flood karke owner ka matching 429-block kar sakta tha. Runtime proof (Backend Deploy
`36253003395` ke baad live probe): non-owner → *ENFORCED, HTTP 404*, owner path `ai_enhanced=true`
(model-authored scores), teardown clean. Probe ab hard assert karta hai (`not_enforced` = run RED), aur
`src/test/aiMatchingOwnership.test.ts` (7 tests, negative control ke saath) source-level guard hai.
Suite: **232 tests / 19 files**.

✅ AI quota engine LIVE-fix (Oct 5, 2026, `20270119000022` + `20270119000023`) — founder report: "freelancer dashboard me AI assistant ka rate limit real time me kaam nahi kar raha". Poora AI-quota layer chup-chaap toota tha, teen alag jagah: **(a)** `ai-assistant` freelancer usage `feature_type='ai_message'` likhta tha, par live CHECK constraint sirf ai_chat/ai_matching/ai_assistant/profile_view allow karta hai → HAR insert 23514 fail (error unchecked, silent) → usage kabhi nahi badha, 10/month limit kabhi fire nahi hui, meter hamesha 0/10. Fix: `ai_assistant` constant + row-per-message insert (race-free, sum-read) + LOUD error logging; teeno readers (edge + AIChatSupport + subscriptionHelpers) aligned, meter ab har message ke baad refresh hota hai aur Pro users par hidden hai (0/10 jhooth hota). **(b)** `ai-writer` daily cap puri tarah DECORATIVE thi: `rate_limits` par UNIQUE(identifier,route,window_start) hai aur edge `{count:1}` upsert karta tha → har generation counter ko 1 par RESET; gate bhi ROW-count par tha (hamesha ≤1) → Free 5/day / Pro 100/day kabhi block nahi hui. Fix: naya server-only SECURITY DEFINER RPC `increment_rate_limit` (atomic count+1 RETURNING, anon/authenticated revoke + fail-closed assertions), edge ab `count` COLUMN par gate karta hai. **(c)** `AIGenerateModal` functions.invoke ka error body `data` se padhta tha — is supabase-js me non-2xx par `data=null` hota hai (body `error.context` Response par) → har 429/5xx generic "AI generation failed" ban jaata tha (isliye "title aata hai, description nahi") — ab real payload + meter update. **(d) Services bonus fix:** deactivate toggle sirf `status` likhta tha jabki catalog/homepage/profile/ai-matching `active=true` filter karte the → deactivated service publicly listed reh jaata tha; ab toggle dono columns sync karta hai aur public surfaces `status='active'` padhte hain (+ homepage realtime UPDATE channel). **(e) Drift band:** repo ka `record_profile_view` body non-existent `count` column reference karta tha (live DB out-of-band fixed tha) — `20270119000023` repo ko live ke working body par align karta hai (fresh envs ab tootenge nahi). Verify: typecheck + **269 tests** (18 naye `src/test/aiQuotaTracking.test.ts`, includes SQL lexer over the 2 new migrations) + build clean; live-verified via read-only MCP queries (constraint def, empty-writer data, unique key, no naming conflict).

✅ AI-quota + services fixes LIVE — aur usi deploy ne do apni hi galtiyan pakdi (Oct 6, 2026: `d7dcc1f` + `d816a0e` + `baa5f50`) — upar wala ⚠️ DEPLOY PENDING ab history hai. Teeno commits `origin/main` par hain; **Backend Deploy `37422385073` green** (drift-check → `db push` → saare 33 edge functions redeploy → privilege/money-path pentest → whole-surface audit, sab success). Live verify (read-only MCP): `20270119000022`/`23` applied; `increment_rate_limit(text,text,timestamptz)` maujood aur **anon=false / authenticated=false / service_role=true**; `record_profile_view` abhi bhi anon-callable (public counter by design); RPC functionally test kiya — lagataar 3 call par 1→2→3 return (atomic accumulate), probe row cleanup ke baad `rate_limits` baseline 50 rows wapas.

**Defect (a) — deploy abort:** `20270119000022` ka apna fail-closed assertion `pg_get_function_identity_arguments(p.oid)` ko `'… p_window_start timestamptz'` se compare kar raha tha, par Postgres canonical naam print karta hai (`timestamp with time zone`) aur us output me argument **names hote hi nahi** → assertion har run par fail, `db push` SQLSTATE `P0001` par ruk gaya. Ab OID se resolve hota hai (`to_regprocedure('…(text,text,timestamptz)')` — wahi pattern jo `20270119000009` use karta hai); **live par rolled-back transaction me poora migration dry-run kiya (DRY_RUN_OK) aur phir confirm kiya ki kuch persist nahi hua**. Class ab self-detecting: `src/test/sqlMigrationSyntax.test.ts` me naya guard — koi bhi migration identity-args ko normalized type alias (`int4`/`varchar`/`bool`/`timestamptz`/…) ke against assert nahi kar sakta, inline negative control ke saath.

**Defect (b) — homepage par fake social proof:** hero `Trusted by 1000+ members across India` hardcode kar raha tha jabki live count 4 tha (honest-metrics rule ka direct break); ab wahi single source-of-truth (`get_public_platform_metrics` via `useAboutPageMetrics`) se aata hai aur real number aane tak line render hi nahi hoti. Live verify (growlancer.vercel.app, fresh load): **"Trusted by 5 members across 1 country"**, `1000+` gayab, 0 console errors. Pehla version hero ko apna hook instance de raha tha → homepage par 2 instances (2× RPC + 2× realtime subscription) ban gaye the; `baa5f50` me ek hi instance HomePage root par hai (hero ko members/countries, client cards ko stats props se) — live par fresh load par `get_public_platform_metrics` **exactly 1** call. Naya guard: `src/test/publicMetricsHonesty.test.ts` (4 tests, negative control ke saath). Verify: typecheck + **275 tests / 22 files** + build clean.

✅ `profiles` public SELECT boundary harden (Oct 6, 2026, `20270119000024`) — task ne `public_profiles` VIEW maanga tha taaki "USING(true) bina TO clause" wala hole band ho. **Live schema par measure karne par teen cheezein different nikli:** (a) anon ke paas `profiles` par **table-level SELECT grant hi nahi hai** — sirf 11 allowlisted columns par column-level grant (`20261215000000_close_anon_pii_and_admin_users.sql` ka `REVOKE ALL` + column GRANT), matlab naya sensitive column anon ko automatically expose nahi hota; (b) `profiles` par `bio` column exist hi nahi karta (`42703`) → proposed view create hi nahi hota; (c) public browsing `profiles` ko **sirf PostgREST FK embeds** se padhti hai (`services→profiles`, `reviews→reviewer/reviewee`, `freelancer_profiles→profile`) aur view embed target nahi ban sakta → view lagane se homepage rail, catalog, search, public profile page aur reviews **toot jaate**, protection milti hi nahi. Isliye wahi intent sahi mechanism se: policy ab **`FOR SELECT TO anon, authenticated`** (pehle roles={PUBLIC} tha → jo bhi role aage table privileges paata usko permissive read mil jaata; is DB me `authenticator`/`dashboard_user`/`supabase_privileged_role` already use hote hain), anon allowlist repo se re-assert, aur allowlist ab **self-detecting**: naya server-only `anon_readable_profile_columns()` (a) table-level anon grant (yaani "saare aane wale columns exposed" case) aur (b) koi bhi non-allowlisted readable column — dono flag karta hai, aur hourly `check_security_drift()` usko sweep karta hai. Migration me policy ko **role-set se** assert kiya (naam se nahi — galat naam ke saath roles={PUBLIC} hi asli defect tha), 11-column allowlist exact assert ki, dono detector branches ke **positive controls** + ek **negative control** (allowlisted `avatar` flag nahi hona chahiye), aur `check_security_drift()` scalar trap avoid karke direct call se 0 maanga. **Dry-run live par rolled-back transaction me (DRY_RUN_FULL_OK)**, phir deploy ke baad LIVE verify: policy = "Public profiles are viewable by anon and authenticated" (2 roles), `anon_table_select=false`, anon 11 columns, detector server-only, sweep wired, **detector 0 findings, open alerts 0**; logged-out browsing (homepage rail, `/freelancers`, `/freelancer/:id` — reviews embed + avatar 200, `/status` DB operational) sab working. Naya guard `src/test/profilesAnonColumnGuard.test.ts` (9 tests) — grant list aur detector allowlist **byte-for-byte match** karni hi chahiye (diverge = test RED), aur "view dobara mat banana" assertion. Verify: typecheck + **284 tests / 23 files** + build clean.

✅ `authenticated` profiles grant bhi explicit allowlist par (Oct 6, 2026, `20270119000025`) — upar wala ⚠️ founder decision ke baad close hua: `authenticated` ka **table-level SELECT** hata diya aur saare **14 current columns** explicit grant kiye. Saare 14 isliye ki **6 authenticated call sites** `profiles!fk(*)` wildcard embeds use karte hain (WorkspacePage, ContractsPage, dataService, disputeService) aur PostgREST `*` ko saare columns me expand karta hai — ek column chhoota to contracts/workspace/proposals/disputes runtime par toot jaate. Behaviour aaj identical hai (live verify: `authenticated` ke liye `select * from profiles` pre- aur post-change dono me 1 row, `auth_cols = 14 = total_cols`), par naya column ab automatically visible nahi hoga. **Follow-up obligation (yaad rakho):** aage koi bhi migration `profiles` par column ADD kare to usi migration me `GRANT SELECT (new_col) ... TO authenticated` (aur anon ko sirf tab jab wo sach me public ho) dena hoga — warna wildcard embeds fail-closed tootenge, jo jaan-boojh ke chuna gaya behaviour hai. Naya server-only `authenticated_readable_profile_columns()` (anon detector jaisa hi do-branch: table-level grant, aur allowlist ke bahar koi readable column) hourly `check_security_drift()` me sweep hota hai, aur migration assert karti hai ki patch ke baad **anon sweep bhi bacha rahe**. Controls: table-level grant flagged, transactional **probe column** se branch 2 flagged (real DDL, phir drop), allowlisted column NOT flagged, baseline + drift 0. Guard `src/test/profilesAuthenticatedColumnGuard.test.ts` (6 tests) — grant list aur detector allowlist byte-for-byte match karni hi chahiye. Verify: typecheck + **290 tests / 24 files** + build clean.

✅ Site-URL ek hi jagah + founder-runbook (Oct 7, 2026) — founder ne poocha "jaha tak ho sake founder ka
kaam bhi tu kar de real-time me, phir step-by-step batao Razorpay/PayPal/.com ke liye". Code side par jo
founder ke bina bhi ho sakta tha, wo kiya:
**(a)** `supabase/functions/_shared/site.ts` — **akela `APP_URL` reader** (`SITE_URL`, `siteUrl(path)`,
`FALLBACK_SITE_URL`, missing par `console.warn` — value kabhi log nahi hoti). **12 edge functions**
codemod hue (`ai.ts` HTTP-Referer; `submit-report` / `newsletter-subscribe` / `email-notifications` /
`internship-applications` / `proposal-notifications` ke templates + logo; `security-alert-notify`;
`withdrawal`; `paypal` return/cancel URLs; `admin-data` (3 per-action re-declarations hate);
`milestone-auto-release` + `subscription-billing-cron` ke hardcoded `https://growlancer.com` links) —
yaani domain switch ab **ek secret** ka kaam hai, code change nahi. Sirf `_shared/cors.ts`
(multi-domain allow-list **by design**) aur `site.ts` (documented fallback) me origin bacha — grep-verified.
**(b)** `src/test/siteUrlGuard.test.ts` (10 tests) — koi edge function origin hardcode kare ya `APP_URL`
seedha padhe to build RED; mailbox strings (`support@growlancer.com`) deliberately match nahi hote;
**negative control proven**: `submit-report/index.ts` me origin wapas plant → RED, restore → GREEN
(file byte-identical).
**(c) asli latent bug pakda:** local `.env` me `APP_URL=growlancer.vercel.app` **scheme ke bina** tha,
aur `scripts/push_redirect_urls.mjs` usi value se live Supabase auth `site_url` likhta hai → production
me toota value chala jaata. Ab dono operator scripts (`push_redirect_urls.mjs`, `check_providers.mjs`)
ek hi helper se origin resolve karte hain aur non-absolute value par **fail-closed** (`exit 1`);
`.env.example` = `https://growlancer.com`.
**(d)** `scripts/founder-preflight.mjs` (`npm run preflight`, read-only, `--strict` = exit 1) — secret
inventory + digest-verify (`APP_URL` / `PAYPAL_SANDBOX`; na values na digests print hote hain), frontend
env + local `APP_URL` absolute-url check, live anonymous state, `.com` readiness. Live run: **2 blockers**
(`RAZORPAY_ACCOUNT_NUMBER` missing; local `APP_URL` scheme-less) + 7 warnings = exactly A1 + A6.
**(e)** `docs/FOUNDER-RUNBOOK.md` (§0–§10) — ordered operator playbook: A1 RazorpayX, A2 ek real
test-mode payment (+5 verification SQL), A5 PayPal **atomic** switch (pehle server secrets +
`PAYPAL_SANDBOX=false`, phir `VITE_PAYPAL_ENABLED=true` + Vercel redeploy — Vite `VITE_*` ko build-time
inline karta hai, warna sandbox paisa real escrow fund kar deta), A4 KYC (`document_hash` GENERATED —
kahte hi 428C9), **§5 poora `.com` switch** (ordered table + "kya change NAHI karna" table + cosmetic +
verification), A7 branch protection (exact `gh api -X PUT` JSON), A8 supply, recurring ops.
`docs/LAUNCH-READINESS.md` bhi update (300 tests, A6 me resolver+preflight, runbook link, top par
`npm run preflight`).
Verify: 13/13 edge+script files `npx esbuild` se syntax-clean, typecheck + lint + **300 tests / 25
files** + build clean; `--strict` ka exit 1 proven (Deno locally nahi hai, isliye edge functions
`deno check` nahi hue — sirf esbuild).

✅ Money-in chain ab **proven** (Oct 7, 2026) + webhook secret repo me commit tha (dono ek hi pass me) —
**(a) CRITICAL, ab fix (rotation founder ka kaam)**: `RAZORPAY_TESTING_GUIDE.md` me payment webhook ka
**signing secret plain text** me tha, aur ye **guess nahi** — us value se signed event deployed function
ne accept kiya (`200 unknown_order`), yaani committed value = **live secret**. Isse koi bhi repo-reader
`payment.captured` forge karke **unpaid** order ko captured bana sakta tha → escrow bina paise fund →
release se wallet credit (payouts enable hote hi real money-out). Ab: literal tree se hata diya (16-digit
RazorpayX source account number bhi placeholder), aur naya `src/test/noCommittedSecrets.test.ts` (9
tests) build RED karta hai agar 64-hex literal ya `*_SECRET/TOKEN/PASSWORD/KEY` assignment me
real-looking value kisi bhi tracked file me aaye (control: plant → RED with the exact line, restore →
byte-identical; allowlist sirf `docs/LAUNCH-READINESS.md` ka documented public `APP_URL` digest, aur wo
bhi sirf jab line me credential-word na ho). **Deletion rotation nahi hai** — value git history me hai,
isliye Razorpay dashboard se regenerate + `supabase secrets set RAZORPAY_WEBHOOK_SECRET` karna hi bom hai
(LAUNCH-READINESS **A0**, runbook §0.5).
**(b) Chain verified**: naya `scripts/e2e/razorpay-webhook-rehearsal.mjs` (`npm run rehearse:webhook`)
Razorpay ke asli tarike se sign kiya hua `payment.captured` deployed function ko bhejta hai: escrow
funded → contract active → project in_progress → order captured → capture txn → event processed → dono
parties notified → **replay ignored (no double-fund)** → release → **5% commission (₹250) + invoice
₹5250 + 3 ledger rows + freelancer wallet ₹5000 + client escrow_balance 0**. Throwaway accounts, full
cascade, aur start me liya gaya row-count baseline assert: **33 checks / 0 failures**. Teen anti-vacuity
controls: forged signature → 401; valid signature + unknown order → funds nothing; replay → no second
capture row. Live keys par chalne se mana karta hai, aur secret na ho to **fail-closed** (exit 1) — wrong
secret se run karke bhi verify kiya (401 + honest message + clean teardown).
**(c) Isi pass me apne 2 defects pakde**: (i) runbook/LAUNCH-READINESS ka A2 **galat** tha —
`admin_fund_escrow` (funding) koi invoice/commission book **nahi** karta (live function bodies se
verified); 5% row + invoice + teen ledger rows `_book_escrow_release` se **release ke waqt** aate hain,
`escrow.amount` = contract amount, aur contract+5% `razorpay_orders.amount` me hota hai — ab dono docs
corrected (galat instruction founder ko already-sahi path "fix" karne bhej deti). (ii) `ledger_entries`
`delete_user_all_data` se cascade **nahi** hote (entity_type/entity_id text), isliye CI ka
`pentest-privileges.mjs` har run **3 rows chhod deta hai** — live table 147 rows, sabb probes, jabki
`platform_revenue` 0 → rehearsal apne rows clean + baseline assert karta hai; pentest/chain scripts ke
liye ⚠️ backlog B9 me flag kiya (chup-chaap CI pentest badalna risky tha, verified script ko waise hi
rakha).

⚠️ Flagged (follow-up pass, is money-path change me mass-revoke nahi kiya): **33** SECURITY DEFINER
functions abhi bhi `anon` ko EXECUTE-granted hain — PUBLIC default ACL har `DROP`+`CREATE` par wapas
aa jata hai, isliye pehle ke hardening ke baad bhi ye wapas aa gaye. Zyadatar NULL-safe hain
(`grant_admin_role` → "Unauthorized: admins only"), par bina session reachable nahi hone chahiye.
`20270119000016` ne money-touching waale revoke kar diye; baaki account/MFA/referral helpers report §15.7
me listed hain. Dhyan: `is_user_admin()` ko grant **rakhna hi** hai — wo RLS policy
(`user_reports_admin_all`) ke andar evaluate hota hai, revoke karne se policy hi toot jayegi.

✅ CI pentest wired (Sep 23, 2026) — `backend-deploy.yml` me `db push` + functions deploy ke BAAD
ek step `scripts/e2e/pentest-privileges.mjs` chalata hai (throwaway accounts, real JWTs, real HTTP).
`SUPABASE_URL` project-ref se derive hota hai (REST/edge endpoint — pooler DSN **nahi**, wo sirf
migration steps ke liye hai). **UPDATE (Sep 23, 2026):** is step ka `::notice::` + `exit 0` skip path
hata diya gaya hai — ab missing secret par deploy **RED** hota hai (aur pre-flight guard ke wajah se
kuch deploy hone se PEHLE hi fail ho jaata hai). Details neeche wali fail-closed entry me.

✅ Guardrails ab fail-closed hain — skipped guardrail green nahi dikhta (Sep 23, 2026) — asli defect
status-reporting ka tha, code ka nahi: authenticated element-audit + logout-security pass
`can_seed_e2e` par gated the, aur privilege pentest ka apna `::notice:: ... SKIPPED; exit 0` tha.
Secret missing = step chup-chaap skip + job SUCCESS = green check ek aise guardrail ke upar jo kabhi
chala hi nahi (aur isi wajah se CI ke "dashboard/client/admin sweeps kabhi fail nahi hue" — wo chalte
hi nahi the). Ab: (a) `ci.yml` me ek pehla **Guard — authenticated-audit secrets present (fail-closed)**
step hai jo Chrome download/build se PEHLE har required secret assert karta hai aur missing par
`::error::` ke saath `exit 1` deta hai (naam ke saath, plus one-line setup instructions) — `can_seed_e2e`
gate poori tarah hata diya; (b) `login.mjs` ko `--require-all` mila — creds missing ya login fail hon
to throw + non-zero (pehle `return null` se role chup-chaap drop hota tha, aur step me
`if [ -f .e2e/<role>.json ]` wrappers the isliye aadha-adhoora sweep bhi green ho jaata tha) — ab teenon
storage states on-disk assert hote hain, teenon audits + teenon logout flows unconditional; (c)
`backend-deploy.yml` me **Guard — pentest secrets present (fail-closed)** pre-flight step hai jo
`db push`/functions deploy se PEHLE fail karta hai (jis deploy ki security verification nahi chali wo
successful deploy count nahi hoga) aur pentest step me skip path hi nahi bacha. Sirf ek honest skip
tolerated hai: **fork PR** (GitHub fork-triggered workflows ko repo secrets deta hi nahi) — wo bhi
`::warning::` ke saath "NOT RUN" bolta hai, aur `pull_request` event + fork flag dono check hote hain
isliye push run par wo bypass nahi ban sakta (verified). **Founder action: sirf ek secret chahiye —
`SUPABASE_SERVICE_ROLE_KEY`** (baaki sab `gh secret list` me maujood hai; `SUPABASE_URL` ab
`secrets.SUPABASE_URL || secrets.VITE_SUPABASE_URL` se aata hai). Jab tak wo nahi hai, main par CI ka
element-audit job aur backend deploy **jaan-boojh kar RED** rahenge — yahi feature hai. Verify: 10
naye `src/test/ciGuardrails.test.ts` assertions (job-env ke har credential ka guard me hona,
`exit 0` sirf fork branch me, deploy guard ka ordering, koi `continue-on-error` nahi), **4 negative
controls** (guard ka `exit 1`→`exit 0`, `can_seed_e2e` wapas, pentest ka skip wapas, deploy guard
hatana — chaaron par test RED hua aur file byte-restore hui), aur dono guards ka bash logic **chala ke**
verify kiya (8/8: present→pass, koi bhi secret missing→fail naam ke saath, fork PR→honest skip,
fork flag push run par ignore). Negative assertion comments strip karke lagti hai (warna "purana gate
kyun hataya" wala comment hi test fail kar deta) — wahi §18 lesson.

⚠️ Flagged (chhota, dead-column hygiene — is pass me nahi chhua): `certifications.verified`,
`freelancer_skills.is_verified`, `payout_methods.is_verified`, `services.rating` bhi owner-update policy
+ no trigger ke saath self-writable hain, LEKIN poore app/edge codebase me inhe koi padhta hi nahi (4
columns = 0 readers) — isliye blast-radius badhane ke bajaye flag kiya. Jab in tables ko koi use kare,
`20270119000013` ka pattern laga dena (ACL column-grant ya guard + assertion).

⚠️ Pending (jaan-boojh ke chhoda, plan report §11.6 me): heading hierarchy (defect #11) — 89 `<h3>`
hain dashboard/client/admin pages me aur wo ek hi construct nahi (kuch card headers = H2 hone chahiye,
kuch card ke andar ke sub-headings jinme H3-under-H2 sahi hai). Class signature se distinguish nahi hota
aur audit artifacts sirf skip count rakhte hain, selectors nahi — isliye blind promotion accepted
cosmetic skip ko galat outline se badal sakta hai. Per-page review chahiye, wahi jo originally log
hua tha.

⚠️ Pending (chhote items): currency-consistency prep (multi-currency future ke liye), team-
project freelancer notification/accept-step.

✅ CI element-audit job ka purana red band (Sep 26, 2026) — pehle wali "`E2E_FREELANCER_*` secret
stale" wajah ab history hai: `--rotate --push-secrets` ne email+password dono repo secrets ko seed ke
hardcoded emails se align kar diya, aur uske baad ka fail (logout-flow step 1) asli fixture defect tha
(`onboarding_completed=false`), jo `20270119000020`/seed fix ke saath gaya. E2E accounts ab CI ke apne
seed/teardown cycle me rehte hain (production me permanently nahi). Details: report §9.3 + §22.

⚠️ Flagged (founder ka call chahiye): `admin-data` proxy `wallets` / `escrow` / `transactions` par
bhi direct write karta hai — money tables Security Principle §2 ke hisaab se sirf SECURITY DEFINER
RPCs se change hone chahiye. UI in write-paths ko use karta nazar nahi aata, par ye money-path
decision hai — chup-chaap change nahi kiya (report §9.2).

Jab in dono ka fix aaye, ye status-section update kar dena taaki future sessions ko pata rahe.

✅ GitHub/LinkedIn signup ka real root cause band (Oct 11, 2026, `20270119000026`) — founder report:
"user real time me linkedin and github se signup nahi kar pa raha". Deep dive ne do asli defects nikaale,
dono ek hi symptom dete the ("signup ke baad Authentication failed / login hi nahi hota"):

**(a) Signup ka profile leg poori tarah browser-driven tha.** Provider leg theek hai — live par GitHub
+ LinkedIn OIDC dono enabled hain aur `/authorize` sach me provider ko redirect karta hai. Par profile
row sirf ek browser RPC call (`create_user_profile`) se banti thi, kyunki aakhri `auth.users` trigger
`20270119000009` me drop ho gaya tha. Live proof: LinkedIn signup (Oct 10, 16:26:17Z) ne `auth.users`
row banayi aur `profiles` / `profiles_private` / `wallets` — teeno MISSING, 13 ghante baad bhi; usi
window me postgrest log `Warp server error: Thread killed by timeout manager` (16:27:13Z) aur client
har request 15s par abort karta hai. Matlab us few-second window me koi bhi hiccup (slow backend, tab
band, mobile network, refresh) account ko permanently todh deta tha aur server-side koi repair nahi thi.
Fix: naya `AFTER INSERT ON auth.users` trigger → `ensure_signup_profile()` (SECURITY DEFINER,
server-only) `profiles` + `profiles_private` likhta hai (profiles ke existing triggers se wallet +
notification_preferences), fail-soft + `signup_profile_failures` me record (raaste se signup kabhi
block nahi hota), plus **backfill** (live ke 3 ghosts repair) + naya hourly detector
`signup_ghost_accounts()` `check_security_drift()` me wired — class ab self-detecting hai.

**(b) Benign duplicate-callback error ko fatal mana ja raha tha.** `AuthCallbackPage` `error` param
dekh kar turant "Authentication failed" dikhata tha — chahe session valid ho. Live me GoTrue ka
`/callback` do baar hit hota hai (pehla 15s+ latakta hai, user refresh karta hai) → replay
`?error=invalid_request&error_code=bad_oauth_state` laata hai, **jabki signup already succeed ho chuka
hota hai** (`user_signedup` + `Login` logs me maujood) — aur page chhodne se in-flight profile creation
bhi mar jaati thi. Ab `recoverEstablishedSession()` pehle chalta hai: valid session ho to error param
ignore (log ke saath), warna error screen waisi hi. Aage badhne ke liye ek naya rule: **session > error
param**, kyunki error param sirf ek request batata hai, session actual auth state hai.

Verify — naya live harness `npm run e2e:oauth-signup` (throwaway account; Admin API se wahi auth.users
insert jo GoTrue provider signup par karta hai — koi human card/provider login nahi; fail-closed config;
full cascade teardown): fix se PEHLE leg A red tha (auth insert ke baad koi profile nahi), deploy ke baad
**17/17 green** — yaani ab auth.users insert akela profiles + profiles_private + wallet + deterministic
referral code bana deta hai. **LIVE (Backend Deploy `38116424354` ke baad, read-only SQL):** trigger +
teeno functions maujood, `ghost_accounts` **3 → 0**, aur **8 users = 8 profiles = 8 profiles_private =
8 wallets** — matlab founder ka LinkedIn account (`mirankhan1542@gmail.com`) wapas usable hai (profile +
wallet, role freelancer) aur do purane ghosts bhi repair ho gaye; open `signup_ghost_account` alerts 0.
Browser proof do level par: (i) local production build par before/after (same probe, same URL, **real
session**) — pre-fix build → "Authentication failed — OAuth state parameter is invalid", fixed build →
country gate/onboarding + profile bani (wallet ke saath); (ii) **deployed site par bhi** (headless
Playwright, real session, wahi benign-error URL): "Authentication failed" nahi aaya, session intact,
country gate par route hua, throwaway account delete — **5/5**. Migration live par rolled-back
transaction me dry-run (drift anchor exactly 1 baar mila + patched body re-parsed OK, probe auth.users
insert chala) aur dry-run ke baad 0 residue. typecheck + lint + **323 tests** (28 files; 14 naye —
`signupProfileTrigger.test.ts` + `authCallbackSessionBeatsError.test.ts`, dono negative controls ke saath)
+ build clean; CI `5840592` green. Harness ka apna ek defect bhi pakda gaya (referral-code assertion RPC
ke documented collision-suffix `-xxxx` ko failure maan raha tha) — assertion theek ki (+ trigger ke
deterministic code ka assertion add hua), dhaanch nahi.

⚠️ Isi fix se ek chhota observation (product call, fail nahi kiya): `create_user_profile` ka upsert
`referral_code` ko client-generated value se **overwrite** karta hai, aur collision par suffix `-xxxx`
laga deta hai — isliye ek hi user ka code dobara likhne par badal sakta hai (agar usne link share kar
diya ho to woh link toot sakta hai). Ab trigger kabhi-kabhi pehle se deterministic code bhi likh deta
hai, jo browser ke pehle call par replace ho jaata hai. Referral semantics ka faisla founder ka hai,
isliye yahan sirf note kiya gaya hai.
✅ Icons ek hi pack par + onboarding country India-first (Oct 13, 2026, `9ae6492`) — founder report: "bahot
jagah icons proper/professional nahi", "onboarding me country India rakho, baqi sab hata do, A→Z 'Coming
Soon' ke saath professional dropdown". Haath se banaye gaye inline SVG icons `lucide-react` par consolidate
(8 files: MainLayout, ErrorBoundary, ProtectedRoute, AdminSupportTicketsPage, AdminDashboardLayout,
ProfessionalProfilePage, HomePage, AboutPage) — page-justifying swaps ke saath (Contests → Trophy, Dashboard
→ LayoutDashboard). Jaan-boojh ke chhode gaye: 12 official brand marks (GitHub/LinkedIn/PayPal/Razorpay/
Mastercard/X/WhatsApp/Google) + certificate ka animated seal — brand identity ko generic glyph se badalna
galat hota. Live production build par per-page count: `/` **95 lucide / 3 raw**, `/freelancers` **158/3**,
`/about` **18/3** — har raw SVG sirf footer ka payment brand mark. `CountrySelect` ab India ko "Currently
Available" me pin karta hai (AVAILABLE badge) aur baqi **196** countries A→Z "Coming Soon" me dikhata hai par
**display-only** (`aria-disabled`) — click aur keyboard Enter dono se select nahi hota; India aur
"Remote / Online" select hote hain. Guards: `src/test/iconPackConsolidation.test.ts` (brand-mark allowlist
ke saath) + `src/test/countrySelectContract.test.tsx` (9 tests). Real-browser proof — naya throwaway probe,
asli credential exchange, post-auth `/onboarding` par: **16/16** (196 countries A→Z, coming-soon click +
Enter dono refuse, India selectable, storage label badalta hai, **0 product console errors**), teardown
clean (live **8 profiles** wapas). CI `9ae6492` green (Regression Guard + Element Audit, 22m26s).

✅ Design typography band — fonts production me kabhi apply hi nahi ho rahe the (Oct 13, 2026) — founder
report: "fonts unprofessional lag rahe hain, corporate nahi". Live measure karne par poora kaaran-chain
nikla, **teen alag defects** ek saath:
**(a) Asli kaaran:** `pages/+Head.tsx` (jo **React** render karta hai) font stylesheets ko `media="print"
onLoad="this.media='all'"` trick se load kar raha tha — par **React SSR event handlers serialise nahi
karta**, isliye prerendered HTML me `onload` hi nahi tha (`dist/index.html` me **0** occurrences) → CSS
hamesha print-mode me atki rahi aur **koi design font apply nahi hua**. Browser me `document.fonts` **khaali**,
`cdn.fontshare.com` **kabhi contact nahi hua** — yaani production ke saare prerendered pages system-ui me
render ho rahe the, bina kisi error ke. Ab plain stylesheet links (fonts `display=swap` use karte hain,
isliye cost visible nahi).
**(b)** Font declarations **teen** jagah thi (`pages/+Head.tsx`, `index.html`, `scripts/build.mjs`) aur unke
weight sets alag the — matlab konsa route kaunsa font dikhayega ye serving path decide kar raha tha.
**(c)** Fontshare **HTTP 200** deta hai par jo weight us family me nahi hai use **chup-chaap drop** kar deta
hai (Satoshi sirf **400/500/700/900** publish karta hai — 600/800 nahi), aur ek combined
`f[]=cabinet-grotesk@…&f[]=satoshi@…` URL **200 par sirf EK family** serve karta hai (live verified, dono
orders me) — isliye `font-display font-black` (54 headings) ka asli heavy face kabhi load hi nahi hua aur sab
700 par render ho rahe the. Fix: **per family ek request** — Cabinet Grotesk `@400,500,700,800,900` +
Satoshi `@400,500,700,900` (= exactly jo families publish karti hain), teeno declarations byte-identical,
unused **Inter** (kahin bhi `font-family: 'Inter'` nahi) hataya, aur `cdn.fontshare.com` (asli woff2 host) ka
preconnect add hua — CSP dono ko already allow karta hai. Guard: `src/test/typographyFonts.test.ts`
(**18 tests**) — teeno declarations ka drift, print-mode/`onload` park, tailwind ↔ loaded family match, aur
"har `font-*` weight ka asli face maujood ho" (heaviest display weight exact publish hona chahiye). Sab pure
functions + negative controls; **asli historical declaration wapas daal ke RED prove hua** (2 tests fail),
restore par GREEN. Live verify (local production build, 2 prerendered routes): `document.fonts` me **9 faces
parsed / 9 loaded**, Cabinet Grotesk 500/700/800/900 ke advance widths ab **alag-alag** (pehle 700=800=900
identical the), `font-display font-black` element weight **900** render karta hai, **0 Google-Fonts request**,
no horizontal overflow, koi font/CSP error nahi. **Lesson (is session ki teesri baar, ek level aur gehra):**
typecheck + lint + 365 tests + build sab green the jabki production me fonts kabhi load hi nahi hue —
`document.fonts` / per-weight advance widths **browser me actually measure** karne se hi pata chala; aur
`scripts/build.mjs` ka template-literal syntax break sirf `npm run build` ne pakda (source-level guard usko
text ki tarah padhta hai).

✅ Dashboard section-label truth + client/freelancer header crowding + Team-Project AI + unanswered-OAuth honesty
(Oct 14, 2026) — founder report (mobile screenshots): "linkedin se signup nahi hora error", "ek section ke icons ka
kuch text buttons ka [issue]", "dusra section alag hai lekin workspace name aa raha", "freelancer dashboard me bhi
ish type ke issues honge", aur "multi project wale section me AI title + description add karo, universal limit 100
rahegi par show mat karna".

**1. LinkedIn/GitHub signup — live evidence, aur jo humara tha wo fix hua.** GoTrue logs (2026-10-14 09:06:30/36/54Z)
me teen `302 → linkedin.com` hain aur uske baad **koi `/callback` nahi** (usi din 07:15:43 par GitHub ka callback
aaya + Login hua). `auth.users` me 4 hi users hain, 3 LinkedIn attempts se koi row nahi bani; aur founder ke account
ki `linkedin_oidc` identity **2026-10-13** ki hai — matlab flow ek din pehle chala tha. Machine-checkable sab legs
pass hain (`node scripts/check_providers.mjs`: provider ENABLED, LinkedIn consent page serve karta hai, aur ek
banaya hua `redirect_uri` **reject** hota hai = hamara Supabase callback URL registered hai). Matlab stop **human
consent leg** par tha (prompt band / redirect blocked / network) — provider ke apne page par, hamare code me nahi.
Jo humara tha wo theek hua: pehle ye failure **chup-chaap** hota tha. Ab `signInWithOAuth` provider par jaane se pehle
ek breadcrumb likhta hai (`src/lib/oauthDiagnostics.ts`) aur wapas aane par session na ho to `OAuthReturnNotice`
imandaari se batata hai — provider ka naam, **"kuch create/change nahi hua"**, retry + doosra provider; callback ke
`error` codes ab asli wajah me map hote hain (cancel kiya / email share nahi hui / handshake replay / config) instead
of generic "Authentication failed". Negative control bhi test me hai: naya (in-flight) attempt par notice **nahi**
aata. `scripts/check_providers.mjs` ka purana bug bhi mila: module-level `const URL` global `URL` constructor ko
shadow kar raha tha, isliye script har run par fail-closed "APP_URL is not an absolute URL" print karke chup ho jata
tha (isi liye pata nahi chala).

**2. Mobile header galat section name** — dono shells sidebar groups ko search karke hardcoded `'Workspace'` par gir
jaate the, isliye har wo route jo sidebar me nahi hai ("Post a Project", "Verification", "Post a Team Project",
"Create Service", "Skill Test", "Support Tickets" …) apne aap ko **"Workspace"** keh raha tha. Ab ek hi honest
resolver (`src/lib/dashboardSection.ts`) route se naam nikalta hai: exact → deepest prefix → `:param` route →
nav-link → **URL se derived** naam (kyunki guess karna hi defect tha). Root `/client`/`/dashboard` sirf exact match
karte hain, warna unknown child "Overview" ban jaata (wahi jhooth, naya roop).

**3. Header crowding** — jinke header row non-responsive the (`flex items-center justify-between`) unko stack kiya:
client Invites + Proposals (founder ke screenshots), dashboard Portfolio / Professional Profile / Identity
Verification, aur 5 admin pages; saath me CTA/badge par `shrink-0 whitespace-nowrap`.

**4. Team Projects (multi-role = multi-contract) me AI** — `ClientPostProjectPage` jaisa hi `AIGenerateModal`
(`clientFree`) title + description par, context me roles/skills/budget. Saath me `CLIENT_FAIR_USE_DAILY_LIMIT`
**60 → 100** (universal), aur woh client surface par **kabhi counter ki tarah render nahi hota** (copy "free for
you — no limits", over-cap message neutral) — founder ka exact instruction.

**Verify (production build + real sessions, local `PORT=4174 node server.js`):** typecheck + lint + **423 tests / 36 files**
(26 naye: `dashboardSection.test.ts` 12 + `oauthDiagnostics.test.ts` 14, dono me negative controls) + build clean;
`.e2e/verify-ui-fixes.mjs` **24/24** (client + freelancer, 375px, fail-closed auth check — role brand + landing
path, warna logged-out page par jhoothi green aati); element-audit **72 client + 72 dashboard loads, 0 overflow
offenders**, baaki sab 0; OAuth chain harness **17/17** (signup backend leg intact).

**Flagged (naya, §B10/§B11 in `docs/LAUNCH-READINESS.md`):** LinkedIn stop provider-side hai — recurs ho to LinkedIn
page par kya dikha (error text ya kuch nahi) note karo aur ek baar desktop Chrome incognito (mobile network ke bahar)
try karo. Aur ek **pre-existing intermittent React #418 + `insertBefore` crash**: audit ke 2 runs me har baar 1–2 of
72 loads (har baar **different route**, jinme wo routes bhi the jo humne chhue hi nahi) par logout chrome gayab ho
gaya, jabki **saare 72 loads ki GoTrue session check SUCCESS** thi aur 0 rejected — yaani session theek, render race.
3 direct loads par reproduce nahi hua. Aaj ke change se nahi aaya (random route per run), par apne aap me real hai.
✅ Dark theme poora sitewide + Backend Deploy ka 23-second fail — dono ek hi pass me (Oct 16, 2026) — founder
report: "dark mode me site tooti lagti hai". Diagnosis me do alag cheezein nikli, dono measured: **(a) theme aap hi
apply nahi hoti thi** — `darkMode: 'class'` + `ThemeContext` + `ThemeToggle` (3 layouts) already `0131b3a` me the,
par poora system `globals.css` ke **palette remap** par khada hai (`.dark :where(.bg-white) …`), aur `dark:` sirf 3
files me tha; **(b) pre-paint guard kabhi ship hi nahi hota tha** — guard `index.html` me tha, jo Vike ka document
nahi hai (measured: built `dist/index.html` aur prerendered pages me uska koi marker nahi, `growlancer-theme` 0
baar) → dark visitor ko cream body + **cream boot splash** dikhta tha, phir React aake dark karta tha. Fix: guard ab
`vite.config.ts` ke `boot-splash-inject` plugin se **har built page ke `<head>` me** inject hota hai (single source;
`scripts/build.mjs` ka fallback SPA shell bhi wahi guard lagata hai, dono ke beech byte-check test), splash par
`html.dark` background, aur `index.html` ki dead copy hata di (duplicate wapas aaye to test fail).
  • **Phase-1 leftovers**: `CertificateVerifyPage` ka apna `gl-verify-theme` hook + `matchMedia` hata ke shared
    `useTheme()` (wo khud `.dark` class likh raha tha — do source ek hi element par); `AdminInternshipsPage` ka
    `[color-scheme:dark]` → shared `.on-dark-surface`; admin header me bhi toggle (hint ke saath, kyunki admin
    console jaan-boojh ke dono themes me dark hai).
  • **Naya self-detecting guard** `src/test/darkThemeCoverage.test.ts` (11 tests): globals.css ke remap selectors aur
    `src/` ke saare colour-utilities scan karta hai; har light-rendering token ya remapped ho ya naam-le-ke excused —
    stale excuse aur "excuse jo remap me already hai" dono fail. Isne 8 real leftover pakde: category chips ka
    `bg-stone-100`/`bg-neutral-100` + `text`/`ring` (remap me sirf slate tha), aur **gradient stops**: homepage hero
    ka `via-white to-white` **poore hero ko grey-wash** kar raha tha aur ~10 pages ke tinted panels (`from-*-50
    to-white`) white tiles the — ye browser screenshot se pakda gaya, phir guard me gradient stops add kiye taaki
    class dobara chhup na sake.
  • **Hydration bug (asli)**: chrome components JS theme-state par branch kar rahe the (icon/label/colors) — server wo
    state jaan hi nahi sakta → **React #418 har dark-mode load par** (built site par reproduce). Fix: `ThemeToggle`
    mount tak neutral (system) render karta hai, aur `CertificateVerifyPage` ke HeaderBar/FooterBar ke saare colours
    `dark:` classes + sun/moon CSS se (CSS mismatch nahi kar sakta). Guard: `themeProvider.test.tsx` me
    `renderToString(dark) === renderToString(light)` — negative control me mounted-gating hataya → RED, restore →
    GREEN. **Ye wahi #418 family hai jo pichhle entry me "intermittent" flag hua tha** — wahan cause proven nahi
    tha; ab ek deterministic reproduction + fix hai. Agli authenticated run me dekho ki wo occasional missing-chrome
    bhi gaya ya nahi (abhi assert nahi kar sakta).
  • **CI fix (isi pass me)**: Backend Deploy `38719764730` 23s par fail — step "Apply pending migrations". Log:
    `Found local migration files to be inserted before the last migration on remote database. Rerun with
    --include-all`. Wajah: commit `a3a5511` ne 48 migration files live DB se recover kiye, jinme se
    `20270119000000_harden_internship_auth_policy_and_monitor.sql` un migrations se **pehle sort** karta hai jo baad
    me apply hui thi → `db push` bina `--include-all` har baar exit 1 karta tha. Ab flag laga hai (drift gate still
    fail-closed), aur `ciGuardrails.test.ts` me 2 naye assertions (flag + uski wajah comment me). **Live DB isi wajah
    se 15 migrations peeche thi** — push hote hi workflow unhe apply karega.
  • **Verification**: typecheck + **487 tests / 42 files** + build clean. Built artifact par: 62/66 HTML me guard
    `<head>` ke andar (bache 4 sirf 55–96-byte verification-token files hain). Production build (`npm start`) real
    browser me: dark me `bg-white` card → `rgb(15,23,42)`, body `#070b14`, hero gradient `#0f172a`, toggle click →
    light→dark + localStorage persist; **light mode byte-identical** (cream `#FFF8EE`, pure white cards, koi `.dark`
    class nahi). **Naya themed sweep** `element-audit.mjs --theme=dark|light` (fail-closed: guard served HTML me na
    ho ya page wrong theme par ho to run RED): dark public **105 loads / 0 flags / 105 guard shipped**, dark auth
    **24/24**, light public **105 loads / 0 flags / 0 dark**. **Negative control**: dist se guard strip karke wahi
    route → 3/3 loads flagged + `::error::theme integrity` (restore → 0/3). Ek check apne aap red ho kar dikhaya:
    pehla "pre-paint" proxy (`dark` class at DOMContentLoaded) stripped build par bhi true aa raha tha (module scripts
    DOMContentLoaded se pehle chalte hain) → usko evidence-only kar diya aur failure trigger **served-HTML check**
    bana diya, jo sach me fail hota hai.
  • **Remaining (jaan-boojh ke nahi kiya)**: authenticated dark sweep (dashboard/client/admin) — uske liye CI ke
    seeded test accounts chahiye; local `.e2e/*.json` sessions stale hain aur production me accounts seed/delete
    nahi kiye. Command: `node scripts/e2e/element-audit.mjs --base=<prod> --group=dashboard --theme=dark
    --storage=.e2e/freelancer.json`.
- **2026-11-01 — realtime + AI quota + Pro priority support**: live complaints ("ticket/AI/referral real time me update nahi
  ho raha", "free AI limit trigger nahi hoti", "AI late reply deta hai"). Root cause ek hi tha: `support_tickets`,
  `ticket_messages`, `referral_stats`, `referrals`, `usage_logs`, `grow_coin_ledger` kabhi `supabase_realtime` publication me
  add nahi hui thi → har `postgres_changes` subscription silent no-op. Migration
  `20270304000000_realtime_ai_quota_priority_support.sql`: guarded publication ADD + REPLICA IDENTITY FULL;
  `consume_ai_message()` (advisory-locked, check+record ek hi transaction, service_role only) se free 10/month ab us exact
  message par fire hota hai jo limit cross kare; `ai_support_entitlement()` (authenticated, read-only) meter ka single source;
  `user_has_active_pro()` trial-expiry aware; Pro ticket insert par 'high' escalate (user ka 'urgent' kabhi downgrade nahi).
  Edge functions: `ai-assistant` DB quota use karta hai (duplicate insert hata), pehla SSE frame live used/limit bhejta hai,
  Pro lane `sort: latency` + 800 tokens + 120/min (free 30/min); `ai-ticket-responder` priority lane + 25s budget
  (1800-token non-streaming wait hataya). UI: chat meter realtime (usage_logs + subscriptions), Pro "Priority support
  active" chip, limit par send block; tickets page Pro default 'high'; referral hook `referral_project_reward_events` +
  `grow_coin_ledger` subscribe. Mobile: AI Matches / Team Projects header tiles `shrink-0` + shared emerald (flex me
  squash ho rahe the). Copy: "Guaranteed Funding Lock", "Instant Release", "guarantees a clear flow" hataye; AI system
  prompt ka "All AI features are free and unlimited" (galat — freelancer free 10/month) correct kiya.
  **Verified**: typecheck 0, lint 0, build 0 (34.8s), focused 110/110, full suite 856/857 — bacha hua `projectMap` sirf
  stale INVENTORY tha, `npm run docs:map` ke baad us file par 2/2 green. **Pending**: `supabase db push` (live DB par
  migration apply hone tak realtime/quota fix live nahi hoga) + real Razorpay/KYC keys + two-account E2E (credentials nahi).

- **2026-11-01 — commission docs reconciled + coin ledger CHECK restored**: `PROJECT-BLUEPRINT.md`
  (§1 table, §7 money path, §14.1), `docs/blueprint/DATABASE.md` §11.2 and `LAUNCH-READINESS` A12 still
  described the retired client-side 5% and called the double charge "open". Verified against
  `20270203000000_commission_freelancer_side.sql` that Option B is what actually runs: order =
  `contract.amount` (no fee on top), `platform_commission()` withholds 5% at release, invoice
  `platform_fee = 0`. Docs corrected, incl. the wrong migration filename A12 cited.
  **Real defect fixed:** `20270302`'s rebuilt `grow_coin_ledger` reason CHECK dropped
  `referee_referral_bonus`; `ALTER TABLE ADD CONSTRAINT` validates existing rows, so one historical
  row would hard-fail `db push`. Value restored + guard in `src/test/growCoins.test.ts`.
  **Verified:** typecheck 0, lint 0, full suite **858/858** on Node 24.22.2 (VM default is Node 26,
  where jsdom `localStorage` is undefined and 69 storage/DOM tests fail — environment, not code),
  build clean, `docs:check` current. **Not pushed / not deployed:** no Supabase credentials in this
  environment, so the migration could not be dry-run; §8 forbids deploying an unverified migration.

- **2026-11-01 — referral/AI realtime correctness + client header alignment**: two live-state defects
  were provable in code. (a) `useReferralsData` subscribed to `referral_project_reward_events`, which is
  `REVOKE ALL` + RLS with no policies — a `postgres_changes` channel there can never deliver, and
  granting reads just to make it fire would expose other users' rows; it now subscribes only to
  `grow_coin_ledger` (own-row policy) and re-reads on focus/visibility, so rewards written while the tab
  was backgrounded are never shown as pending. The guard test that DEMANDED the unreadable subscription
  was corrected (it now asserts the ledger channel and the absence of the service-role-only one).
  (b) `AIChatSupport`'s meter only moved on mount/after a send, so a free freelancer's count looked stale
  until reload; it now re-syncs on focus/visibility against `ai_support_entitlement()`, the same source
  the edge function enforces. Also aligned the Team Projects header wrapper with AI Matches (the 40px
  emerald tiles were already identical; the flex wrappers were not).
  **Verified:** typecheck 0, lint 0, **858/858 tests** (Node 24.22.2), build 0.
  **Owner-blocked:** realtime for `usage_logs`/referral tables only fires after `20270304000000` is
  applied to the live DB; Pro-vs-free support tiers need a server-side policy (Premium is
  freelancer-only, so clients must keep support).

- **2026-11-01 (2) — freelancer support tiers enforced, AI latency routing, escrow wording de-risked**:
  (a) new `20270305000000_freelancer_support_tier.sql` — a BEFORE INSERT trigger on `support_tickets`
  rejects a freelancer's ticket unless `user_has_active_pro()`, while clients (no Premium plan) and
  service-role/system inserts are untouched; free freelancers keep in-app support (AI + Help Center).
  Fail-closed assertions check the function, the trigger and the Pro RPC. (b) `_shared/ai.ts` now routes
  BOTH lanes by `sort: 'latency'` — the standard lane used `throughput`, which bought nothing for short
  chat answers and made replies feel slow; same model, same token ceiling, no cost change.
  (c) Overclaiming copy fixed: "lock funds in escrow to guarantee payment" (Philosophy), "funds are
  held by Growlanzo" (Help Center now says internal escrow ledger, not a bank/licensed escrow),
  "released instantly" (contest), and two "Growlanzo Escrow" phrasings (Safety, Workspace).
  **Not changed:** login routing — `/login` already redirects through `resumeDestination` and an OAuth
  provider round-trip cannot be removed; needs a real URL trace. Client AI Matches / Team Projects tiles
  were already identical, so only the wrapper was aligned earlier. Coin cash redemption stays blocked.
  **Verified:** docs:map/check, typecheck 0, lint 0, full suite, build — see commit.

- **2026-11-01 (3) — closed a bypass in my own support-tier guard**: `20270305` gated on `NEW.user_role`,
  a browser-supplied field the insert policy does not constrain (`user_id = auth.uid()` only), so a free
  freelancer could POST `user_role:'client'` and never meet the Pro requirement. `20270306` replaces the
  decision input with `profiles.role` (the same source ProtectedRoute and the admin RPCs use), corrects the
  stored label when the derived role is one the CHECK accepts, fails closed when the profile row is missing,
  and asserts at deploy time that the trigger exists, is enabled, and that its body reads `public.profiles`.
  **Verified in WASM Postgres (PGlite), not live**: 20270304 → 20270305 → 20270306 apply in order and an
  11-case decision table passes with the *expected rejection reason* asserted — spoofed label, expired
  trial, cross-user insert, missing profile, service-role path, and label auto-correction. The first run of
  that harness reported 5/11 "passing" for the wrong reason (a missing SELECT grant, not the guard), which
  is exactly why each rejection now matches on message. Live DB unverified: no credentials in this sandbox.
  **Open finding, not fixed:** `authenticated` still holds table-level UPDATE on `profiles` and the privilege
  trigger only blocks escalation to `admin`, so a freelancer can set their own role to `client`. Ticket
  gating is not the weakest link there, and closing it changes onboarding (OnboardingPage writes
  `profiles.role` directly) — founder decision.

- **2026-11-01 (4) — the free/Pro split is now visible, and the icon mismatch was real**: the gate from
  `20270306` was enforced only in the database, so a free freelancer still saw a working-looking "New
  Ticket" form that would fail on submit. `SupportTicketsPage` now hides the form and the empty-state
  button for `freelancer && !isPro` and shows what the free plan actually includes — AI assistant, Help
  Center, and where Premium sits — while clients and Pro are untouched and existing tickets stay readable.
  **Icon defect found, not guessed**: `ClientMatchesPage` has three headers, and the project-detail one
  used `w-8 h-8 rounded-lg … emerald-500→600 shadow-md` with a `w-4` icon while the landing state and
  Team Projects use `w-10 h-10 rounded-xl … emerald-500→700 shadow-lg`. Opening one project's matches
  changed the icon — that is the inconsistency reported. All three now share the 40px tile.
  **Routing checked, not assumed**: `docs/UI-ELEMENT-AUDIT-REPORT.md` still claims the tickets page is an
  unrouted orphan; `App.tsx:358` (freelancer) and `:405` (client) both mount it, so the doc is stale and
  nothing was changed. Login landing left alone: `/auth/callback` already calls `redirectAfterAuth` →
  role dashboard with no intermediate hop, and the provider page itself cannot be removed from OAuth.
  Verify: typecheck 0, lint 0, full suite, build 0.

- **2026-11-01 (5) — two stale money promises removed from the referral surface**: the shipped programme is
  5 + 5 (KYC approval, once per relationship) and 5 + 5 again for every project the referred user completes,
  with no cap (`20270303000000`). Two places still described the retired one-shot economy. (a)
  `ReferralsPage` listed a "First Project Completed" validation rule and a "first project → rewards" empty
  state, and credited "10 points" per referral — tiers actually count confirmed referrals at 3 / 10 / 25.
  (b) `TermsPage` §14 — a **legal** document — promised "10 coins when your identity is verified", "20 coins
  when your first project completes" and "capped at 20 paid bonuses per month". All three are retired, so the
  terms described payouts the code cannot make. Rewritten to state the 5 + 5 / no-cap rule and the real
  verification gate; nothing else in §14 (Premium at 199 coins, client checkout discount from 100, cash
  withdrawal still closed, no-expiry, no-ranking-influence, clawback) was changed. **Founder review wanted**
  on the Terms wording — it is legal copy, but it now matches the implemented rule instead of contradicting it.
  Verify: typecheck 0, lint 0, 858/858 tests, build 0.

- **2026-11-06 (1) — security-header drift fixed at the source (payment-impacting)**: `server.js` and
  `vercel.json` each carried a hand-maintained copy of the CSP/header set, and `server.js` said in a comment
  that it "must stay in sync" — it had not. The Express/VPS copy dropped every Razorpay checkout host
  (`checkout-static-next`, `cdn`, `express`, `lumberjack`, `api-dark`) from `script-src`/`connect-src`/
  `frame-src` and shipped `payment=()`, while production allows them. Anything served by `server.js`
  (self-hosted/VPS, and the webhook-rehearsal flow) would have failed checkout in the browser — invisible to
  typecheck/tests/build, because a CSP is enforced by the browser at runtime. **Fix:** values now live in
  `security-headers.json`, `server.js` applies that file, and two guards keep it honest —
  `src/test/securityHeadersParity.test.ts` (new: JSON ⇄ `vercel.json`, every key, exact value, plus
  `object-src 'none'` / `base-uri 'self'` / real checkout hosts) and `cspFontAllowList.test.ts` (its third
  copy is now `security-headers.json`, not `server.js`; assertion tightened, not loosened). Verified live:
  served response now contains `checkout-static-next`/`lumberjack`/`api-dark` and the payment allow-list.
  **Residual, founder decision (unchanged today):** `profiles.role` stays self-writable between
  `freelancer` and `client` by design (`20270101000002`), and `admin` escalation is still blocked — but that
  means a free freelancer can flip to `client` and reach the client-side support form, so the Pro-only
  freelancer ticket gate is advisory, not enforced. Closing it needs a DB decision (block role changes once
  onboarding is complete, or move role assignment into a SECURITY DEFINER RPC) and a live dry-run; not
  shipped blind.

- **2026-11-06 (2) — claims sweep of all public pages + a blind spot in the honesty guard**: rendered all
  25 public routes through the production server and scanned the visible text for claims the product cannot
  honour (guaranteed/insured/bank-grade/100%-safe/RBI-SEBI-ISO/instant-payout/risk-free/custody/stale
  ₹299). **Result: 25/25 rendered, 3 hits, all three are honest disclaimers** ("Growlanzo provides no
  cross-freelancer coordination or delivery guarantee — only payment protection"), so public copy holds.
  The one bad line was inside the in-app support library, which `truthfulPlanClaims.test.ts` already scans:
  `supportTopics.ts` said *"That's the Growlanzo guarantee — safe for you, safe for the client"*. The
  guard's patterns require `guarantee` directly before secure/payment/deliverables, so an em-dash phrasing
  named the **company** as guarantor and slipped through. Escrow holds money; a dispute can still refund
  the client. Fixed the copy (now describes the mechanism, not a promise) and widened the pattern to
  `/\b(?:growlanzo|platform|our)\s+guarantee\b/i` — proven with a negative control on the retired wording
  (matches) and on both correct strings (does not match). Also refreshed `AGENTS.md` §11, which still
  claimed "~541 tests" as of 2026-10-20 and did not warn that a cloud workspace cannot verify the DB (no
  Supabase credentials, no `gh`), so a future session knows to run the pentests in CI instead of claiming
  a live result.
  Verify: typecheck 0, lint 0, **73/73 test files**, build 0, 25 public pages at 375/1280 with 0 overflow.

- **2026-11-06 (3) — the feature-flag switch was decorative (silently dead in the bundle)**: `isFeatureEnabled`
  read `import.meta.env?.[`VITE_FEATURE_${feature.toUpperCase()}_ENABLED`]`. Vike replaces a **bare** env
  expression (the object itself, no property access after it) with `null` at build time — it printed that
  warning on every build and nobody acted on it — so the lookup evaluated `null?.[key]` → `undefined` for
  all three features, and every flag stayed on its fail-closed default. The documented way to enable a module
  (`VITE_FEATURE_CONTESTS_ENABLED=true`) therefore did nothing in the shipped app. Fixed with per-feature
  explicit property access (statically replaced by Vite) plus `src/test/featureFlagsEnv.test.ts` (6 tests:
  default OFF, exact `'true'` ON, explicit `'false'`, non-exact values ignored, a real flip changing
  `isDeferredRoute('/contests')` without swallowing `/client/contracts`, and a source guard against the bare
  expression). **Proven end-to-end, not just in unit tests:** built with the flag on → `/contests` renders
  "Compete. Create. Win." while `/certificate` and `/internships` still render the early-access notice. The
  build warning is gone too — it had been matching the literal token inside the explanatory comment I wrote.
  **Open, measured locally and NOT fixed:** Vike prerender still does not run here — `dist/client` contains a
  single `index.html` and all 25 public URLs serve the same `<title>`, i.e. `scripts/build.mjs` falls back to
  the documented SPA shell. That decides whether crawlers and link previews get per-page titles, so it needs
  checking on the Vercel build (or CI) before launch; the cause is not proven and changing the build blind
  would risk a red deploy.

- **2026-11-06 (4) — per-page titles never reached the browser (RouteHead was never mounted)**: measured on
  the built site, 19 rendered public routes produced **1 distinct `<title>` and 0 canonical tags** — every
  page advertised itself as the homepage, so search results and link previews could not tell them apart.
  Cause: `src/components/RouteHead.tsx` (title, description, canonical, OG/Twitter, `noindex` for private
  surfaces) was complete and correct but **not rendered anywhere** — no import, no `<RouteHead />`. Mounting
  it exposed a second, older bug in the same file: three rules were written `test: exact('/a') || exact('/b')`.
  Those are two FUNCTION values, so `||` returns the first function and the second path is never tested —
  `/careers`, `/verify-certificate` and `/auth/verify-email` silently fell through to the not-found metadata,
  which is `noindex` on public pages. Fixed with a `oneOf(...paths)` helper and a separate dynamic rule for
  `/certificate/:code`; `/certificate` itself had no exact rule at all. `Payment`'s description was the
  placeholder "Payment status." (15 chars) and is now a real sentence.
  New guard `src/test/routeHeadCoverage.test.ts` (6 tests) checks BOTH that `App.tsx` mounts `<RouteHead />`
  (a coverage-only test would have passed while the component was dead) and that every
  `PUBLIC_PRERENDER_URLS` entry resolves to its own indexable title with a usable description.
  **Verified in the browser:** 10 public routes hard-loaded → 10 distinct titles, 9 canonicals, correct
  `robots`, e.g. `/pricing` → "Pricing · Growlanzo" + canonical `https://growlanzo.com/pricing`.
  Verify: typecheck 0, lint 0, **75/75 test files**, build 0, docs map/check 0.
  **Observed, not explained:** a hard load of `/` shows no canonical/robots tag, while in-app navigation to
  `/` sets both and hard loads of the other 9 routes work. Both tags default safely (no robots tag = indexable,
  no canonical = self-canonical), so this is a cosmetic gap, not a blocker; nothing in the repo removes head
  nodes. Also added the missing `VITE_FEATURE_*`, `VITE_AI_MODEL` entries to `.env.example` — the flags were
  documented in source but absent from the only file a new deploy reads.

- **2026-11-06 (5) — prerendering had never run: every route shipped the homepage's static head**: the build
  printed `⚠ Vike prerender did not run — dist/client/index.html missing` on every run and fell back to the
  SPA shell, so **1 HTML file existed for 31 public URLs** and every one of them carried
  `<title>Growlanzo — AI-Powered…</title>` and `canonical="https://growlanzo.com/"`. Root cause: `scripts/build.mjs`
  invoked `npx vite build`, and **under Vite 8 the Vite CLI no longer fires Vike's prerender hook** — it exits 0,
  prints "built in 647ms", and writes zero HTML. `npx vike build` with the same config prerenders all 33 pages
  (66 files). Fixes:
  1. build script runs `vike build`; `staticShellIntegrity.test.ts` now asserts that string **and** that
     `npx vite build` is absent, so the regression cannot come back silently (it caught this one).
  2. The route metadata moved out of the React component into dependency-free `src/lib/routeMeta.ts`, consumed by
     new `pages/+title.ts` and `pages/+description.ts` (Vike config functions of `pageContext`) and by
     `pages/+Head.tsx` for canonical/robots/og:url. **Before this, only the client knew the rules** — that is why
     the prerendered `/pricing` advertised itself as the homepage. `src/components/RouteHead.tsx` stays as the
     client-navigation applier (Vike never sees in-app react-router navigations) and re-exports the helpers.
     `title`/`description` were removed from `pages/+config.ts`: a constant there overrides the per-URL functions.
  3. `server.js` serves `express.static(..., { redirect: false })`, because prerendered pages live at
     `dist/<route>/index.html` and express was 301-ing `/pricing` → `/pricing/` while the page's canonical said
     `/pricing`.
  **Verified:** 66 HTML files; raw `curl` (JS disabled) returns `200` with the right head for `/`, `/pricing`,
  `/terms`, `/careers`, `/help-center`, `/verify-certificate` (e.g. `/pricing` → "Pricing · Growlanzo" +
  `canonical https://growlanzo.com/pricing`); exactly 1 `<title>`, 1 `og:title`, 1 `meta[name=description]`,
  1 canonical per file; 8 routes hard-loaded in a real browser with **0 hydration errors** (no React #418) and
  correct `<h1>` content, and in-app navigation to `/pricing` still updates title + canonical.
  Verify: typecheck 0, lint 0, **75/75 test files**, build 0, docs map/check 0.

- **2026-11-06 (6) — static-page audit of the 33 prerendered pages**: once prerendering was real, the built HTML
  could finally be audited as shipped (not as rendered). Two defects and one duplicate-content problem:
  1. `/auth/email-confirm` had **no `<h1>` at all** (every state used `<h2>`, so the page's only headings were
     sub-headings — bad for screen-reader outline and for the prerendered document). Promoted the three state
     headings to `<h1>`; each state renders exactly one, so the outline stays single-h1.
  2. `/certificate` and `/verify-certificate` shipped byte-identical heads, as did `/internships` and `/careers`
     (each pair is the same component). Added `canonicalPath` to `RouteMeta` and made `canonicalUrl()` resolve it,
     so the alias collapses onto the primary URL in the **static** HTML: `/certificate` →
     `canonical=https://growlanzo.com/verify-certificate`, `/internships` → `.../careers`. New assertions in
     `routeHeadCoverage.test.ts` (canonical must point at a prerendered page; both aliases pinned).
  Audited across all 31 prerendered pages: 0 missing files, 0 multi-`h1`, 0 non-Growlanzo canonicals, and the
  remaining duplicate title pairs are the two `noindex` auth/payment pairs (intentionally unindexed).
  Verify: typecheck 0, lint 0, **75/75 test files**, build 0 (66 HTML), docs map/check 0.

- **2026-11-06 (7) — the sitemap contradicted the page metadata**: `/report` is `noindex` yet was submitted in
  `public/sitemap.xml`, and `/internships` was submitted even though its canonical now points at `/careers` —
  a sitemap entry that says "index me" next to a page that says "don't" gets one of the two ignored. Removed both
  (24 → 22 URLs). New `src/test/sitemapConsistency.test.ts` (5 tests) parses the sitemap and fails if any listed
  URL is noindex, canonicalises to a different path, is missing from `PUBLIC_PRERENDER_URLS`, is duplicated, or
  if a core page (`/`, `/pricing`, `/about`, `/terms`, `/privacy`) disappears from it.
  Also audited the 31 prerendered documents for markup defects: **73 `<img>` with 0 missing `alt`**, 0 `href="#"`,
  0 `http://` links, 0 `target="_blank"` without `noopener`. The 7 `console.log` calls in `src/` are all inside
  `import.meta.env.DEV`/`isDev` guards, so they do not ship — left alone deliberately.
  Verify: typecheck 0, lint 0, **76/76 test files**, build 0 (66 HTML), docs map/check 0.

- **2026-11-07 (1) — Brevo transactional email system (4 senders, routed events, delivery tracking, admin console)**:
  Added a single email pipeline instead of one-off `fetch` calls per function.
  1. `supabase/functions/_shared/emailSenders.ts` — the four verified identities (`security@`, `support@`,
     `hello@`, `info@growlanzo.com`), resolved from `BREVO_FROM_*` with those as defaults and a one-time warning
     when overridden, so a typo cannot silently send from an unverified address.
  2. `emailTemplates.ts` — one 600px responsive layout (preheader, branded header, rows, CTA, footer with
     website/support plus **X, Instagram, LinkedIn "Follow us"**), `escapeHtml` for every interpolation,
     `htmlToText()` for the plain-text alternative, and a ~34-event catalogue mapping event → sender/subject/body.
  3. `emailService.ts` — `sendTransactionalEmail({event, recipient, data, idempotencyKey})`: render → insert the
     `email_logs` row (idempotency unique index) → send with 3 attempts (400 ms/1200 ms backoff) → update status.
     `sent` means **Brevo accepted**, never "delivered".
  4. `brevo.ts` extended (not replaced) with `sendEmailDetailed`; the legacy `sendEmail()` boolean contract that 8
     existing callers use is unchanged.
  5. `brevo-webhook` — Brevo does not HMAC-sign transactional webhooks, so the endpoint requires
     `BREVO_WEBHOOK_SECRET` (query token / `x-brevo-webhook-secret` / basic-auth) compared in constant time,
     **fails closed** (503 unset, 401 mismatch), and is idempotent via `email_log_events(brevo_message_id,event,event_at)`
     with a monotonic status rank so `delivered` is only ever written by a real webhook.
  6. `email-admin` — stats/list/detail/retry/test behind a server-side `profiles_private.is_admin` check; `test`
     always sends to the calling admin's own address (cannot be used as a relay); 30 sends/hour per admin.
     UI at `/admin/emails` (`AdminEmailsPage.tsx`, `src/lib/emailAdmin.ts`).
  7. Migration `20270307000000_email_logs.sql`: `email_logs` (every required column, `metadata`, timestamps,
     status CHECK), unique partial index on `idempotency_key`, `email_log_events`, RLS enabled with **no policies**
     plus `REVOKE ALL` from anon/authenticated (logs hold recipient PII), and `get_email_log_stats()` is
     `SECURITY DEFINER` + admin-gated.
  8. `email-notifications` and `proposal-notifications` now send through `sendLoggedEmail` with per-reference
     idempotency keys, so registration/proposal mails are logged and cannot double-send.
  Events whose workflow does not exist yet (payouts, refunds, some review flows) are catalogued but **not wired**.
  Verify: typecheck 0, lint 0 (1 pre-existing `RouteHead.tsx` react-refresh warning), build 0, docs map/check 0.
  **Not verified here:** migration not applied, functions not deployed, no live send/webhook/delivery proof —
  this workspace has no Supabase or Brevo credentials, and Brevo DNS auth + the webhook URL are owner-only.
  Pre-existing red: 12 test files / 80 tests fail on `main` (domain-guard tests still pinned to the older
  `growlancer.com` / `growlanzo.vercel.app` URLs, plus 3 jsdom `localStorage`-undefined files); reproduced
  unchanged on a clean checkout of `HEAD`, so they are not from this change.

- **2026-11-07 (2) — the 12 red test files are green (881/881)**: the suite had been red since the domain
  round-trip, and the failures were real regressions, not stale tests:
  1. `scripts/push_redirect_urls.mjs` had been rewritten into a hard-coded `growlanzo.com` list (15 duplicate
     entries) by a blind find/replace. Restored the APP_URL-derived version: `site_url` comes from `APP_URL` and
     fails closed ("refusing to guess the site_url", "APP_URL is not an absolute URL"), apex + www redirect
     entries are derived from `new URL(SITE_URL).host`, and the only literals left are the live Vercel origin.
     A domain switch is one env var again, not an edit to a URL list that silently misses the new domain.
  2. `supabase/functions/_shared/cors.ts` was mangled the same way — four identical `https://growlanzo.com`
     entries and a fabricated `growlancer.mrkhan154212s-projects.vercel.app` host. Restored the real allowlist
     (growlanzo.com + www, the Vercel project origin, `growlancer.vercel.app`, `growlanzo.vercel.app`, the two
     former-brand hosts until they 301) with the patterns unchanged. This was a live bug: a browser on the
     Vercel origin could not read an edge-function response.
  3. `src/test/setup.ts` now restores jsdom's Storage. Node 22+ installs its own experimental Web Storage getter
     (`internal/webstorage`) on the jsdom window, shadowing jsdom's instance (kept at `window._localStorage`),
     so bare `localStorage` was `undefined` and every consent/theme test threw before asserting anything.
     Repaired in setup, not by editing assertions — no app code changed.
  4. `SiteFooter` gained three social brand marks, so the icon allowlist moves 3 → 6 (still an exact pin, not a
     floor), and the six new light-on-dark utilities (`hover:bg-sky-50/pink-50`, `hover:ring-sky|pink|blue|
     emerald-300`) got real `.dark` remaps in `globals.css` instead of excuses.
  5. `providerMismatchAndIdleTimeout` asserted the old `import { sendEmail } from '../_shared/brevo.ts'`; it now
     asserts the logged path (`sendLoggedEmail`) and that the bare Brevo import is gone — same intent (the
     function really sends), current implementation.
  Verify: **76/76 test files, 881/881 tests**, typecheck 0, lint 0 (1 pre-existing warning), build 0, docs map 0.

- **2026-11-07 (3) — pushed to main: CI green, Backend Deploy blocked at the drift gate**: `385ed5b..d894cbc`
  pushed to `main`. Runs on `d894cbc`:
  * **CI — Regression Guard + Element Audit #42350944614 → success** (typecheck, lint, unit tests + production
    build, element audit 375/768/1280 all green — the first green CI since the suite went red).
  * **Code Quality: Push on main #42350944240 → success**.
  * **Backend Deploy (Supabase) #42350944530 → failure at step 8 "Migration drift check (repo vs live DB —
    fail-closed)"**, so steps 9–12 (`db push`, post-push verify, functions deploy, pentest) were **skipped**:
    the `email_logs` migration is **not** applied and `brevo-webhook` / `email-admin` are **not** deployed.
    `pre` mode only fails on a remote-only version or a duplicate repo version; there are **no duplicate
    versions** in the repo (checked), so the live DB almost certainly holds a migration the repo does not —
    i.e. pre-existing drift, not this change. Confirmed pre-existing: run #42242614080 on `385ed5b`
    (2026-11-06, before the email system existed) failed at the **same** step 8.
  Owner action: `npx supabase migration list --db-url <live>` → for each version in the remote column with no
  repo file, either `npx supabase migration fetch` (adopt what is live) or
  `npx supabase migration repair --status reverted <version>` if it was a dashboard experiment; then re-run
  Backend Deploy. The exact version is only in the Actions log (needs an authenticated `gh` token — this
  workspace has none and the unauthenticated API rate limit was exhausted).
