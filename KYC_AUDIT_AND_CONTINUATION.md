# KYC Audit and Continuation Plan

> **SUPERSEDED (Beta launch, Nov 2026).** Full KYC is **deferred** for the Beta
> release. Do **not** configure a KYC provider and do **not** re-enable document
> collection from this plan. The Beta ships account verification only (name +
> confirmed email + confirmed phone) and shows KYC as "Coming Soon"
> (`KYC_VERIFICATION_ENABLED = false` in `src/lib/featureFlags.ts`). The legacy
> document flow is deactivated non-destructively by
> `supabase/migrations/20270405000000_defer_full_kyc_beta.sql`; historical rows
> are retained. This document is kept for historical context only.

*Based on code and migration inspection — READ ONLY, no modifications made*

---

## KYC System Overview

The KYC (Know Your Customer) system in Growlanzo implements a two-mode verification framework:

### Modes
- **`production`** (DEFAULT, fail-safe): Without a configured provider token, submissions fail-safe into manual review. With a token, the real provider runs verification.
- **`development`**: Deterministic automated verification with `provider='dev_mode'` recorded honestly on every row, so the audit trail can never be confused with a real provider verdict. Users can later be re-verified for real when a provider is configured.

### Key Tables
| Table | Purpose |
|-------|---------|
| `public.kyc_provider_config` | Stores provider configuration and current mode (admin-only) |
| `public.profiles` | Contains KYC-derived columns: `kyc_name`, `phone_verified_at`, `kyc_last_checked_at`, `kyc_method`, `kyc_verified_at` |
| `public.identity_verifications` | Stores detailed verification state per user |

### Key RPCs
| RPC | Purpose |
|-----|---------|
| `refresh_light_kyc(p_full_name TEXT DEFAULT NULL)` | Derives `verification_status` from the 4 light-KYC columns + existing `kyc_verified_at` |
| `admin_set_kyc_mode(p_mode TEXT)` | Switch between production/development mode (admin only) |
| `admin_set_kyc_provider_config(p_token TEXT, p_provider TEXT)` | Configure provider token and name (admin only) |
| `admin_get_kyc_provider_status` | Returns current KYC provider config and mode |
| `admin_clear_kyc_provider_config` | Clear provider config (admin only) |
| `kyc_validate_document_number` | Document number validation RPC |
| `kyc_verify_row(p_id UUID)` | Verify a specific KYC row (triggered by trigger) |

### Key Triggers
| Trigger | Purpose |
|---------|---------|
| `kyc_guard_submit` | Blocks new identity verification rows while a 24-hour cooldown exists |
| `kyc_auto_verify_trigger_fn` (SECURITY DEFINER) | Processes pending rows via `kyc_verify_row` — handles automated verification in development mode |

### KYC Bonus
- **5 Grow Coins** awarded when KYC is verified (`growCoins.test.ts` confirms `kycBonus: 5`)
- Awarded via trigger `trg_grow_coin_award_on_kyc_verified`
- One-time per user via unique constraint `uq_grow_coin_kyc_bonus_per_user`

### Frontend KYC Flow
1. **IdentityVerificationPage** (`src/pages/dashboard/IdentityVerificationPage.tsx`): User submits full name
2. **kyc-submit edge function**: Processes the submission
3. **`requireKycForAction`** (from `src/lib/kycGate.ts`): Checks verification status before allowing actions (posting projects, accessing wallet, etc.)
4. **Redirection**: unverified users redirected to `/client/verification` or `/dashboard/identity-verification` depending on role
5. **Realtime sync**: `realtimeChannels.profiles('header-kyc')` updates header KYC badge

### KYC Column Grantary (Critical)
The light-KYC migration `20270211000000_light_kyc_profile_grants.sql` grants `SELECT` on 4 new columns to `authenticated` role only:
- `kyc_name` — legal name user confirmed
- `phone_verified_at` — when OTP was confirmed (verified badge)
- `kyc_last_checked_at` — bookkeeping
- `kyc_method` — provider name

**anon role MUST NOT read these columns** — the migration includes a fail-closed check function `authenticated_readable_profile_columns()` that raises an exception if anon can read them.

---

## Current Development Status (Evidence-Based)

### Completed KYC Work
- ✅ Light-KYC migration `20270210000000_light_kyc_three_criteria.sql` — added 4 columns to `profiles`
- ✅ Grant SELECT on 4 KYC columns to `authenticated` only (migration `20270211000000`)
- ✅ Fail-closed detector function `authenticated_readable_profile_columns()`
- ✅ KYC mode switch migration `20270112000000_kyc_mode_switch.sql` — production/development modes
- ✅ `kyc-submit` edge function exists and is wired
- ✅ `refresh_light_kyc` RPC derives verification status
- ✅ KYC bonus of 5 coins integrated (awarded on `kyc_verified_at` set)
- ✅ `requireKycForAction` guard in `kycGate.ts` checks verification before allowing actions
- ✅ Frontend KYC pages: `IdentityVerificationPage`, `AdminIdentityVerificationPage`
- ✅ KYC-related test files: `kycLightVerification.test.ts`, `profilesAuthenticatedColumnGuard.test.ts`, `profilesAnonColumnGuard.test.ts`

### Incomplete / Blocked KYC Work
- ⚠️ **Provider not configured** — No external KYC provider token set; platform stuck in `production` mode which fail-safes into manual review
- ⚠️ **Development mode not activated** — `development` mode available but not turned on (requires founder decision)
- ⚠️ **Admin KYC panel** — `AdminIdentityVerificationPage` exists but provider not configured
- ⚠️ **Live KYC verification** — Without provider token, all submissions go to manual review; no automated verification running
- ⚠️ **KYC onboarding gating** — `mailer_autoconfirm: false` means signup requires confirmation link; this was blocking KYC flow last session

---

## Continuation Plan — KYC Work

### Step 1: Configure KYC Provider (Founder Action)
The KYC system needs a provider configured to move beyond manual review.

**Options:**
1. **Configure development mode** (recommended for testing/development):
   ```sql
   -- Set mode to development
   CALL public.admin_set_kyc_mode('development');
   
   -- Configure a dev provider
   CALL public.admin_set_kyc_provider_config(
     p_token: 'dev-token-string',
     p_provider: 'dev_mode'
   );
   ```
   - This enables deterministic automated verification
   - Records `provider='dev_mode'` honestly on every row
   - Users can later be re-verified for real when a production provider is configured

2. **Configure production provider** (for launch):
   - Obtain KYC provider API keys/tokens (e.g., Surepass, Jumio, etc.)
   - Configure via admin panel or RPC
   - Set mode to `production`
   - Real verification runs; failed submissions go to manual review

### Step 2: Test KYC Flow End-to-End
After provider configuration:

1. **Test development mode**:
   - Submit KYC verification through `IdentityVerificationPage`
   - Verify `verification_status` derives to `verified` 
   - Check 5 Grow Coins awarded to wallet
   - Verify KYC badge shows in header

2. **Test production mode** (once provider configured):
   - Submit real KYC documents
   - Verify provider returns verification status
   - Check `kyc_verified_at` gets populated
   - Verify workflow continues (onboarding complete, wallet unrestricted)

### Step 3: Verify Column Grants and RLS
Ensure the KYC column grants are correct:

1. Run the fail-closed check:
   ```sql
   SELECT * FROM public.authenticated_readable_profile_columns();
   ```
   - Should return 0 rows (no unlisted columns readable by authenticated)
   - Should verify anon cannot read KYC columns

2. Verify the 4 light-KYC columns are SELECT-able by authenticated:
   ```sql
   SELECT kyc_name, phone_verified_at, kyc_last_checked_at, kyc_method 
   FROM public.profiles 
   LIMIT 1;
   ```

### Step 4: Clean Up Test Data
From the audit log, test KYC data was cleaned (22 test users deleted, wallets reset). Ensure:

1. No orphan KYC verification rows remain
2. No test `kyc_verified_at` values in production profiles
3. `referral_stats` and `referral` tables clean of KYC-related test data

### Step 5: Update Documentation
- Update `docs/LAUNCH-READINESS.md` KYC gate (currently tracked as owner action)
- Update `CLAUDE.md` development log with KYC completion
- Ensure `docs/FOUNDER-RUNBOOK.md` reflects KYC provider configuration

---

## KYC Checklist for Continuation

### ✅ Completed
- [x] Light-KYC columns added to profiles (4 columns)
- [x] SELECT grants to `authenticated` only (migration `20270211000000`)
- [x] Fail-closed detector function
- [x] KYC mode switch migration (production/development)
- [x] `kyc-submit` edge function wired
- [x] `refresh_light_kyc` RPC
- [x] 5-coin KYC bonus integrated
- [x] `requireKycForAction` guard frontend
- [x] KYC frontend pages (`IdentityVerificationPage`)
- [x] KYC test files written and passing

### ⚠️ Pending
- [ ] **Configure KYC provider** — either dev mode for testing or production provider for launch
- [ ] **Test KYC flow end-to-end** with real submissions
- [ ] **Verify 5-coin bonus awarded** after KYC verification
- [ ] **Verify RLS column grants** are clean (fail-closed check passes)
- [ ] **Admin KYC panel** functional with provider configured
- [ ] **Development mode** activated if keeping dev environment separate
- [ ] **KYC onboarding gating** resolved (mailer_autoconfirm status)

### 📋 Founder Decisions Needed
1. **KYC provider** — Obtain and configure external KYC provider, OR keep development mode with `provider='dev_mode'`
2. **KYC mode** — Keep `production` (fail-safe, manual review) OR switch to `development` (automated, dev_mode)
3. **mailer_autoconfirm** — Set to `true` to allow KYC flow without confirmation mailbox, OR control a mailbox for the confirmation link
4. **KYC in launch gate** — Update `LAUNCH-READINESS.md` A-item once KYC is live

---

## Immediate Action Items

### If continuing with Development Mode (recommended for next development sprint):
```sql
-- 1. Set mode to development (admin only)
CALL public.admin_set_kyc_mode('development');

-- 2. Configure dev provider
CALL public.admin_set_kyc_provider_config(
  p_token: 'dev-growlanzo-token',
  p_provider: 'dev_mode'
);

-- 3. Test: submit KYC verification through frontend
-- 4. Verify verification_status derives to 'verified'
-- 5. Check 5 Grow Coins awarded to wallet
-- 6. Verify KYC badge shows in header (realtime channel)
```

### If waiting for Production Provider:
1. Obtain KYC provider API keys/tokens
2. Configure via `admin_set_kyc_provider_config` with production provider name
3. Set mode to `production` (default, already set)
4. Test fail-safe path: submissions go to manual review when no token
5. Test real provider path: with token, live verification runs

### Verification Commands
```bash
-- Check current KYC provider status
SELECT * FROM public.admin_get_kyc_provider_status();

-- Verify mode is set correctly
SELECT mode FROM public.kyc_provider_config LIMIT 1;

-- Test light KYC derivation for a user
SELECT * FROM public.refresh_light_kyc(NULL);

-- Verify column grants are clean
SELECT count(*) FROM public.authenticated_readable_profile_columns();
-- Should return 0

-- Verify anon cannot read KYC columns
-- (The migration includes a check for this)
```

---

## Dependencies on Other Systems

### KYC ➡️ Other Modules
- **Wallet**: KYC verified → 5 coins awarded → wallet balance increases
- **Onboarding**: `requireKycForAction` blocks project posting/wallet access until KYC verified
- **Referrals**: KYC bonus (5 coins) integrations with referral system
- **Admin**: `AdminIdentityVerificationPage` manages KYC provider and mode
- **Payments**: KYC may be prerequisite for live payment gateway (Razorpay verification)

### Other Modules ➡️ KYC
- **Auth**: `mailer_autoconfirm` status affects KYC onboarding flow
- **Database**: KYC columns and grants must remain consistent with migrations
- **Frontend**: `IdentityVerificationPage` and `requireKycForAction` must stay in sync with backend
- **Edge functions**: `kyc-submit` must remain compatible with provider API

---

*This document is read-only audit output. No source code, database, or schema modifications were made. For actual KYC configuration, use the SQL commands above with proper admin access, or configure through the Supabase dashboard.*