-- 20270303000000_coin_economy_single_reward_table.sql
-- One canonical Grow Coin economy, exactly as specified:
--   * Approved KYC -> 5 coins to the referrer + 5 to the referred user, ONCE
--     per referral relationship.
--   * Every successful project completed by the referred user -> 5 + 5,
--     repeating for life (20270302000000).
--   * No registration reward, no personal KYC milestone, no one-shot
--     "first project" bonus, no monthly bonus cap.
-- Legacy amounts (10 + 10 kickoff, personal 10 KYC, personal 20 first project,
-- 20/month cap) are retired here so the ledger matches the published table.
-- Historical ledger rows are untouched; only future awards change.
BEGIN;

CREATE OR REPLACE FUNCTION public.award_referral_bonus_if_eligible(p_referred_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_coins constant integer := 5;
  v_verified boolean := false;
BEGIN
  IF p_referred_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user');
  END IF;

  SELECT * INTO v_referral
    FROM public.referrals r
   WHERE r.referred_user_id = p_referred_user_id
   ORDER BY r.created_at ASC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_referral');
  END IF;

  IF COALESCE(v_referral.bonus_claimed, false) THEN
    RETURN jsonb_build_object('success', true, 'already_awarded', true, 'coins', 0);
  END IF;

  -- KYC reward only on a genuinely approved verification from a real provider.
  SELECT EXISTS (
    SELECT 1 FROM public.identity_verifications iv
     WHERE iv.user_id = p_referred_user_id
       AND iv.status = 'verified'
       AND COALESCE(iv.verification_provider, 'manual') NOT IN ('dev_mode', 'dev-sandbox')
  ) INTO v_verified;

  IF NOT v_verified THEN
    RETURN jsonb_build_object('success', false, 'reason', 'kyc_not_approved');
  END IF;

  INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
  VALUES
    (p_referred_user_id, v_coins, 'kyc_bonus', v_referral.id,
     jsonb_build_object('role', 'referred', 'rule', 'kyc_referral_reward', 'referral_id', v_referral.id)),
    (v_referral.referrer_id, v_coins, 'kyc_bonus', v_referral.id,
     jsonb_build_object('role', 'referrer', 'rule', 'kyc_referral_reward', 'referral_id', v_referral.id))
  ON CONFLICT DO NOTHING;

  UPDATE public.referrals
     SET bonus_claimed = true,
         status = 'completed'
   WHERE id = v_referral.id;

  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES
    (p_referred_user_id, 'system', 'KYC verified — 5 Grow Coins earned',
     'Your identity verification is approved. You and your referral partner have each earned 5 Growlanzo Coins.',
     '/referrals', jsonb_build_object('coins', v_coins, 'event', 'kyc_referral', 'referral_id', v_referral.id)),
    (v_referral.referrer_id, 'system', 'Your referral passed KYC — 5 Grow Coins earned',
     'KYC verified! You and your referral partner have each earned 5 Growlanzo Coins.',
     '/referrals', jsonb_build_object('coins', v_coins, 'event', 'kyc_referral', 'referral_id', v_referral.id));

  RETURN jsonb_build_object('success', true, 'coins', v_coins, 'referral_id', v_referral.id);
END;
$$;

REVOKE ALL ON FUNCTION public.award_referral_bonus_if_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_bonus_if_eligible(uuid) TO service_role;

-- Retired: personal KYC milestone (the KYC reward belongs to the referral pair).
CREATE OR REPLACE FUNCTION public.award_kyc_bonus_if_eligible(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN jsonb_build_object('success', false, 'reason', 'retired_reward_rule');
END;
$$;

REVOKE ALL ON FUNCTION public.award_kyc_bonus_if_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_kyc_bonus_if_eligible(uuid) TO service_role;

-- Retired: one-shot 20-coin first-project bonus (the referral pair now earns
-- 5 + 5 on every completed project instead).
CREATE OR REPLACE FUNCTION public.award_first_project_bonus_if_eligible(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN jsonb_build_object('success', false, 'reason', 'retired_reward_rule');
END;
$$;

REVOKE ALL ON FUNCTION public.award_first_project_bonus_if_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_first_project_bonus_if_eligible(uuid) TO service_role;

COMMIT;
