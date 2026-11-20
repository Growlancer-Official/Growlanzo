-- ═══════════════════════════════════════════════════════════════════════════
-- CONTRACT ROW: STORE THE FREELANCER'S NET, NOT THE GROSS
--
-- The canonical model (20270203000000) is freelancer-side 5%:
--   client pays contracts.amount (the pool);
--   the freelancer receives amount - 5% when the escrow is released;
--   the platform fee is booked in platform_revenue at release.
--
-- create_contract_with_escrow still wrote `freelancer_amount = amount`, so a
-- ₹5,000 contract displayed/stored ₹5,000 as the freelancer's amount even
-- though the release paid ₹4,750. The release helper (_release_escrow_internal)
-- recomputes from escrow.amount and is NOT changed here — this only makes the
-- contract row truthful for the UI and reporting.
--
-- Client charge is unchanged: Razorpay/fund_escrow use contracts.amount only.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_contract_with_escrow(
  p_project_id uuid,
  p_freelancer_id uuid,
  p_proposal_id uuid,
  p_amount numeric,
  p_client_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_id uuid;
  v_platform_fee numeric;
  v_freelancer_amount numeric;
  v_proposal record;
  v_authoritative_amount numeric;
BEGIN
  -- NULL-safe: an anonymous caller has no auth.uid(), and NULL <> uuid is
  -- NULL (falsy), so a bare inequality never rejects them.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Idempotency: if a contract already exists for this proposal, return it.
  SELECT id INTO v_contract_id
  FROM contracts
  WHERE proposal_id = p_proposal_id
  LIMIT 1;
  IF FOUND THEN
    UPDATE proposals
    SET status = 'hired', updated_at = now()
    WHERE id = p_proposal_id AND status <> 'hired';
    RETURN v_contract_id;
  END IF;

  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = p_proposal_id AND project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found for this project';
  END IF;
  IF v_proposal.freelancer_id <> p_freelancer_id THEN
    RAISE EXCEPTION 'Proposal does not belong to this freelancer';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND client_id = p_client_id
  ) THEN
    RAISE EXCEPTION 'Project does not belong to this client';
  END IF;

  v_authoritative_amount := ROUND(v_proposal.proposed_rate::numeric, 2);
  IF v_authoritative_amount IS NULL OR v_authoritative_amount <= 0 OR v_authoritative_amount > 100000 THEN
    RAISE EXCEPTION 'Invalid contract amount';
  END IF;

  IF p_amount IS NOT NULL AND ROUND(p_amount::numeric, 2) <> v_authoritative_amount THEN
    RAISE EXCEPTION 'Contract amount does not match the proposal amount';
  END IF;

  -- 5% is withheld from the freelancer at release. Store the net so the
  -- contract row never overstates what the freelancer will receive.
  v_platform_fee := ROUND(v_authoritative_amount * 0.05, 2);
  v_freelancer_amount := v_authoritative_amount - v_platform_fee;

  INSERT INTO contracts (
    project_id, proposal_id, freelancer_id, client_id,
    amount, platform_fee, freelancer_amount, status, escrow_funded
  ) VALUES (
    p_project_id, p_proposal_id, p_freelancer_id, p_client_id,
    v_authoritative_amount, v_platform_fee, v_freelancer_amount, 'pending', false
  )
  RETURNING id INTO v_contract_id;

  INSERT INTO escrow (contract_id, client_id, freelancer_id, amount, status)
  VALUES (v_contract_id, p_client_id, p_freelancer_id, v_authoritative_amount, 'pending');

  UPDATE proposals
  SET status = 'hired', updated_at = now()
  WHERE id = p_proposal_id;
  UPDATE proposals
  SET status = 'rejected', updated_at = now()
  WHERE project_id = p_project_id AND status = 'pending' AND id <> p_proposal_id;

  RETURN v_contract_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_contract_with_escrow(uuid, uuid, uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contract_with_escrow(uuid, uuid, uuid, numeric, uuid) TO service_role;

-- Display-only correction for contracts that have not been paid yet. Funded /
-- completed rows keep their historical values; no money movement is touched.
UPDATE public.contracts
SET freelancer_amount = GREATEST(amount - ROUND(amount * 0.05, 2), 0),
    updated_at = now()
WHERE escrow_funded = false
  AND status NOT IN ('completed', 'cancelled')
  AND freelancer_amount >= amount;
