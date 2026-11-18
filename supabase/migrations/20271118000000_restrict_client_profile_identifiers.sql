-- ─────────────────────────────────────────────────────────────────────────────
-- Audit 2026-11-18 — BUG-01 + BUG-07
--
-- BUG-01 (P2, privacy/compliance). `client_profiles` carried a TABLE-level
-- SELECT grant for `anon`, and its policy "Clients can read all" is
-- `USING (true)`, so anyone holding the public anon key could read every
-- client's `gst_number`, `business_pan` and `udyam_number`. Those are tax and
-- business-registration identifiers, not marketing data.
--   Measured before this migration (anon key, no session):
--     GET /rest/v1/client_profiles?select=gst_number,business_pan,udyam_number
--     → 200 with a row.
--
-- Fix: PostgREST needs the table-level grant for `select=*`, so replace it with
-- an explicit column list that omits the three identifiers. Public business
-- identity (company name, industry, website, size, location, description, logo)
-- stays readable exactly as before — the RLS policy is unchanged, so anon keeps
-- reading the columns it is granted and stops seeing the rest with 42501.
-- `authenticated` keeps the full table grant: the client's own settings page,
-- the KYC flow and the invoice function read the identifiers after sign-in, and
-- the owner-only UPDATE policy still scopes writes to `auth.uid() = user_id`.
--
-- BUG-07 (P4). EXECUTE on the trigger function
-- public.set_platform_review_fields() was granted to anon/authenticated. A
-- direct RPC call already failed (PGRST202 — no matching signature), so it was
-- never exploitable, but the grant is unnecessary: a trigger function runs as
-- the table owner and checks no caller privilege. Revoking it also clears the
-- standing false positive in the `anon_reachable_money_rpc` drift query.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- BUG-01 — column-level SELECT for anonymous visitors.
REVOKE SELECT ON TABLE public.client_profiles FROM anon;

GRANT SELECT (
    id,
    user_id,
    company_name,
    industry,
    website,
    size,
    location,
    description,
    created_at,
    updated_at,
    company_logo,
    account_type
) ON TABLE public.client_profiles TO anon;

-- BUG-07 — the review trigger needs no caller EXECUTE privilege.
REVOKE EXECUTE ON FUNCTION public.set_platform_review_fields() FROM anon, authenticated;

COMMIT;
