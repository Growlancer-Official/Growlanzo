-- ═══════════════════════════════════════════════════════════════════════════
-- Referral integrity fixes (measured live 2026-11-18)
--
-- 1. `award_referral_project_reward` never paid on a wallet escrow release.
--    It required `contracts.escrow_funded = true` AND a completed
--    `transactions` row of type payment/fee. Release sets `escrow_funded` to
--    false, and wallet funding/release write only `debit`/`credit`, so both
--    gates failed and the contract-completed trigger awarded nothing.
--    Settlement is now proven by the authoritative `escrow.status = 'released'`
--    row (with the old payment/fee ledger as a fallback).
--
-- 2. Claiming an already-referred user through a DIFFERENT referrer leaked a
--    raw 23505 on `referrals_referred_email_key`. The duplicate check was
--    scoped to the same (referrer, referee) pair. It now checks the referee.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.process_referral(
  p_referral_code text,
  p_new_user_id uuid,
  p_new_user_email text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_referrer_id UUID;
  v_referrer_code TEXT;
  v_referrer_role TEXT;
  v_referred_role TEXT;
  v_normalized TEXT := public.normalize_referral_code(p_referral_code);
  v_invites_this_month integer;
  v_invite_cap integer := public.referral_monthly_invite_cap();
BEGIN
  IF p_new_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF v_normalized = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'No referral code provided');
  END IF;

  IF p_new_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No user ID provided');
  END IF;

  SELECT pp.id, pp.referral_code, pr.role
    INTO v_referrer_id, v_referrer_code, v_referrer_role
  FROM public.profiles_private pp
  LEFT JOIN public.profiles pr ON pr.id = pp.id
  WHERE public.normalize_referral_code(pp.referral_code) = v_normalized
    AND pp.id != p_new_user_id
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  -- Same-side gate. Fail closed: an unresolvable role on either end rejects
  -- rather than recording a referral the payout gate would later expire.
  IF v_referrer_role IS DISTINCT FROM 'admin' THEN
    SELECT role INTO v_referred_role
      FROM public.profiles WHERE id = p_new_user_id;

    IF v_referrer_role IS NULL
       OR v_referred_role IS NULL
       OR v_referred_role != v_referrer_role THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',
        CASE
          WHEN v_referrer_role = 'freelancer'
            THEN 'This code belongs to a freelancer — freelancers can only refer other freelancers. Create a freelancer account to use it.'
          WHEN v_referrer_role = 'client'
            THEN 'This code belongs to a client — clients can only refer other clients. Create a client account to use it.'
          ELSE 'This referral code cannot be used with this account type.'
        END,
        'error_code', 'role_mismatch'
      );
    END IF;
  END IF;

  -- One claim per referee, regardless of which code is presented. Without the
  -- broad check a second referrer's request hit the unique referee index and
  -- surfaced as a raw 23505 instead of a product error.
  IF EXISTS (
    SELECT 1 FROM public.referrals
    WHERE referred_user_id = p_new_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already referred');
  END IF;

  -- ─── Monthly invite cap (spam protection) ────────────────────────────────
  v_invites_this_month := public.referral_invites_this_month(v_referrer_id);

  IF v_invites_this_month >= v_invite_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'monthly_cap',
      'error', format(
        'This referral code has reached its monthly limit (%s invitations per month). The account was created without a referral.',
        v_invite_cap
      ),
      'cap', v_invite_cap,
      'used_this_month', v_invites_this_month
    );
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_user_id, referred_email, referral_code, status, bonus_claimed)
  VALUES (v_referrer_id, p_new_user_id, p_new_user_email, v_referrer_code, 'pending', false);

  INSERT INTO public.referral_stats (user_id, total_referrals, valid_referrals, points, level, updated_at)
  VALUES (v_referrer_id, 1, 0, 0, 1, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    total_referrals = COALESCE(referral_stats.total_referrals, 0) + 1,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'remaining_this_month', GREATEST(v_invite_cap - v_invites_this_month - 1, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_referral(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_referral(text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.award_referral_project_reward(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_contract public.contracts%ROWTYPE;
  v_party uuid;
  v_referral public.referrals%ROWTYPE;
  v_event_id uuid;
  v_referrer_event_id uuid;
  v_awarded integer := 0;
  v_coins constant integer := 5;
BEGIN
  IF p_contract_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_contract');
  END IF;

  SELECT * INTO v_contract FROM public.contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'contract_not_found');
  END IF;

  IF v_contract.status IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_completed');
  END IF;

  -- Settlement proof: release_escrow sets escrow_funded = false, so that flag
  -- cannot be used here. A released escrow row is the authoritative signal for
  -- wallet payments; completed payment/fee ledger rows cover gateway flows.
  IF NOT EXISTS (
    SELECT 1 FROM public.escrow e
     WHERE e.contract_id = p_contract_id AND e.status = 'released'
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.transactions t
     WHERE t.contract_id = p_contract_id
       AND t.status = 'completed'
       AND t.type IN ('payment', 'fee')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'payment_not_settled');
  END IF;

  -- Either side of the contract may be the referred user.
  FOREACH v_party IN ARRAY ARRAY[v_contract.freelancer_id, v_contract.client_id]
  LOOP
    CONTINUE WHEN v_party IS NULL;

    SELECT * INTO v_referral
      FROM public.referrals r
     WHERE r.referred_user_id = v_party
       AND r.referrer_id IS NOT NULL
       AND r.referrer_id <> v_party
       AND COALESCE(r.status, 'pending') <> 'expired'
     ORDER BY r.created_at ASC NULLS LAST
     LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_event_id := NULL;
    v_referrer_event_id := NULL;

    INSERT INTO public.referral_project_reward_events
      (contract_id, project_id, referrer_id, referred_user_id, recipient_id, coins, metadata)
    VALUES
      (v_contract.id, v_contract.project_id, v_referral.referrer_id, v_party, v_party, v_coins,
       jsonb_build_object('source', 'referral_project', 'referral_id', v_referral.id, 'role', 'referred'))
    ON CONFLICT (contract_id, recipient_id) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
    VALUES (v_party, v_coins, 'referral_project_reward', v_contract.id,
            jsonb_build_object('event_id', v_event_id, 'role', 'referred'));

    INSERT INTO public.referral_project_reward_events
      (contract_id, project_id, referrer_id, referred_user_id, recipient_id, coins, metadata)
    VALUES
      (v_contract.id, v_contract.project_id, v_referral.referrer_id, v_party, v_referral.referrer_id, v_coins,
       jsonb_build_object('source', 'referral_project', 'referral_id', v_referral.id, 'role', 'referrer'))
    ON CONFLICT (contract_id, recipient_id) DO NOTHING
    RETURNING id INTO v_referrer_event_id;

    IF v_referrer_event_id IS NOT NULL THEN
      INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
      VALUES (v_referral.referrer_id, v_coins, 'referral_project_reward', v_contract.id,
              jsonb_build_object('event_id', v_referrer_event_id, 'role', 'referrer'));
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
    VALUES
      (v_party, 'system', 'You earned 5 Grow Coins',
       'Your project is complete. You and your referral partner have each earned 5 Growlanzo Coins.',
       '/dashboard/referrals',
       jsonb_build_object('coins', v_coins, 'event', 'referral_project', 'contract_id', v_contract.id)),
      (v_referral.referrer_id, 'system', 'Your referral completed a project',
       'Congratulations! Your referred user successfully completed another project. You and your referral partner have each earned 5 Growlanzo Coins.',
       '/dashboard/referrals',
       jsonb_build_object('coins', v_coins, 'event', 'referral_project', 'contract_id', v_contract.id));

    v_awarded := v_awarded + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'awarded', v_awarded, 'contract_id', v_contract.id);
END;
$$;

REVOKE ALL ON FUNCTION public.award_referral_project_reward(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_referral_project_reward(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
