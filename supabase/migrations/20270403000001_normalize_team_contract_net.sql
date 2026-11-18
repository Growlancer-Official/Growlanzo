-- ═══════════════════════════════════════════════════════════════════════════
-- Team-role contracts stored the GROSS in `freelancer_amount`
--
-- `create_team_role_contract` inserted `freelancer_amount = p_amount` while
-- `release_escrow` pays `escrow.amount - platform_commission(escrow.amount)`.
-- Result (measured live 2026-11-18): a ₹6,000 role paid the freelancer ₹5,700
-- but the contract row claimed ₹6,000, so the contract workspace displayed the
-- wrong payout and the documented invariant
-- `freelancer_amount + platform_fee == escrow.amount` was broken.
--
-- Every other contract-creation RPC already stores the net. Normalise at the
-- table boundary so any future team-contract insert path stays correct.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_team_contract_net()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.team_project_id IS NOT NULL AND NEW.platform_fee IS NOT NULL THEN
    NEW.freelancer_amount := GREATEST(COALESCE(NEW.amount, 0) - NEW.platform_fee, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_team_contract_net ON public.contracts;
CREATE TRIGGER trg_normalize_team_contract_net
  BEFORE INSERT OR UPDATE OF amount, platform_fee ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_team_contract_net();

-- Repair any team contract already stored with the gross.
UPDATE public.contracts
   SET freelancer_amount = GREATEST(COALESCE(amount, 0) - COALESCE(platform_fee, 0), 0)
 WHERE team_project_id IS NOT NULL
   AND platform_fee IS NOT NULL
   AND freelancer_amount <> GREATEST(COALESCE(amount, 0) - COALESCE(platform_fee, 0), 0);

NOTIFY pgrst, 'reload schema';

COMMIT;
