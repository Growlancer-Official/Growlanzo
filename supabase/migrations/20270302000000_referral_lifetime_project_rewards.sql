-- 20270302000000_referral_lifetime_project_rewards.sql
--
-- Founder's referral model (master prompt section 4):
--   - Approved KYC  -> 5 coins to the referrer + 5 to the referred user (once).
--   - EVERY successful project completed by the referred user
--     -> 5 coins to the referrer + 5 to the referred user, with no lifetime cap.
--   - Coins are promotional: not cash, not withdrawable, not transferable.
--
-- This migration:
--   1. Creates the auditable per-project reward ledger
--      (referral_project_reward_events) with a hard uniqueness guarantee so a
--      contract can reward each recipient at most once.
--   2. Replaces the one-shot "first project" referral hook with a lifetime,
--      payment-verified award function wired into the contract completion
--      trigger (the 20-coin first-project loyalty bonus stays as its own
--      milestone and is NOT part of the referral programme).
--   3. Disables cash redemption of Grow Coins server-side. The UI already says
--      "coming soon"; until that ships the RPC must not be callable, otherwise
--      the coin policy ("not withdrawable") is contradicted by the database.
--   4. Turns on RLS for internal tables that shipped without it.
--
-- Additive only: no table/column is dropped, no existing ledger row rewritten.
-- Replaced functions keep their signatures and security posture.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RLS for internal tables that shipped without it
--    (service-role / edge-function only; RLS on with no policies = deny all)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.credential_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.credential_version_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reviews_duplicate_archive ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.credential_audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.credential_version_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reviews_duplicate_archive FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ledger reason for the recurring referral project reward
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.grow_coin_ledger'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.grow_coin_ledger DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE public.grow_coin_ledger
  ADD CONSTRAINT grow_coin_ledger_reason_check CHECK (
    reason = ANY (ARRAY[
      'referral_bonus',
      'kyc_bonus',
      'first_project_bonus',
      'referral_project_reward',
      'redemption_premium',
      'redemption_project_discount',
      'withdrawal',
      'admin_adjustment'
    ]::text[])
  );

-- ---------------------------------------------------------------------------
-- 3. Auditable per-project reward events
--    unique(contract_id, recipient_id) is the idempotency backstop: even if the
--    completion trigger fires twice, a recipient is paid once per contract.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_project_reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  project_id uuid,
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coins integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'awarded' CHECK (status IN ('awarded', 'reversed')),
  ledger_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_project_reward_coins_positive CHECK (coins > 0),
  CONSTRAINT referral_project_reward_once UNIQUE (contract_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_project_reward_referrer
  ON public.referral_project_reward_events (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_project_reward_referred
  ON public.referral_project_reward_events (referred_user_id, created_at DESC);

ALTER TABLE public.referral_project_reward_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.referral_project_reward_events FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Lifetime award function - service-role only
--    Eligibility (section 4-D): completed contract + funded escrow + a
--    completed payment/fee settlement row. Cancelled, refunded, unpaid or
--    disputed contracts never reach this path.
-- ---------------------------------------------------------------------------
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

  IF NOT COALESCE(v_contract.escrow_funded, false) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'payment_not_settled');
  END IF;

  IF NOT EXISTS (
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

    -- Already rewarded for this contract -> idempotent no-op.
    IF v_event_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
    VALUES (v_party, v_coins, 'referral_project_reward', v_contract.id,
            jsonb_build_object('event_id', v_event_id, 'role', 'referred'));

    -- Guard the referrer side BEFORE its ledger write: one referrer can have
    -- referred both parties of the same contract, and without this check that
    -- referrer would be credited twice for one project.
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

REVOKE ALL ON FUNCTION public.award_referral_project_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_project_reward(uuid) TO service_role;

-- The completion trigger is (re)created here as well so the reward is wired
-- even on a database where an earlier migration's trigger was dropped or the
-- function body was swapped without the trigger.
DROP TRIGGER IF EXISTS trg_grow_coin_award_on_contract_complete ON public.contracts;
CREATE TRIGGER trg_grow_coin_award_on_contract_complete
  AFTER UPDATE OF status ON public.contracts
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.grow_coin_award_trigger_fn();

-- ---------------------------------------------------------------------------
-- 5. Contract completion trigger - unchanged referral/KYC/first-project
--    behaviour plus the recurring project reward.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grow_coin_award_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_second_user_id uuid := NULL;
BEGIN
  IF TG_TABLE_NAME = 'contracts' THEN
    v_user_id := NEW.freelancer_id;
    v_second_user_id := NEW.client_id;
  ELSE
    v_user_id := NEW.user_id;
  END IF;

  BEGIN
    PERFORM public.award_referral_bonus_if_eligible(v_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'grow_coin: referral award failed for % (%): %', v_user_id, SQLSTATE, SQLERRM;
  END;

  BEGIN
    PERFORM public.award_kyc_bonus_if_eligible(v_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'grow_coin: KYC bonus failed for % (%): %', v_user_id, SQLSTATE, SQLERRM;
  END;

  BEGIN
    PERFORM public.award_first_project_bonus_if_eligible(v_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'grow_coin: first-project bonus failed for % (%): %', v_user_id, SQLSTATE, SQLERRM;
  END;

  IF v_second_user_id IS NOT NULL AND v_second_user_id <> v_user_id THEN
    BEGIN
      PERFORM public.award_first_project_bonus_if_eligible(v_second_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'grow_coin: first-project bonus failed for % (%): %', v_second_user_id, SQLSTATE, SQLERRM;
    END;
  END IF;

  IF TG_TABLE_NAME = 'contracts' THEN
    BEGIN
      PERFORM public.award_referral_project_reward(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'grow_coin: project referral reward failed for contract % (%): %', NEW.id, SQLSTATE, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.grow_coin_award_trigger_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grow_coin_award_trigger_fn() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Coins are not cash: server-side lock on cash redemption
--    (UI already presents withdrawal as "coming soon" for both roles.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_grow_coins_for_cash(
  p_amount_coins integer,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'code', 'coming_soon',
    'error', 'Grow Coin cash withdrawal is coming soon. Coins are promotional rewards - they are not cash and cannot be withdrawn yet.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_grow_coins_for_cash(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_grow_coins_for_cash(integer, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Admin reversal with an auditable reason (mirrors admin_adjust_grow_coins)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reverse_referral_project_reward(
  p_event_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_event public.referral_project_reward_events%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT (pp.is_admin = true OR p.role = 'admin') INTO v_is_admin
    FROM public.profiles p
    LEFT JOIN public.profiles_private pp ON pp.id = p.id
   WHERE p.id = v_caller;

  IF NOT COALESCE(v_is_admin, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: admins only');
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reversal reason is required');
  END IF;

  SELECT * INTO v_event
    FROM public.referral_project_reward_events
   WHERE id = p_event_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reward event not found');
  END IF;

  IF v_event.status = 'reversed' THEN
    RETURN jsonb_build_object('success', true, 'already_reversed', true);
  END IF;

  INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
  VALUES (v_event.recipient_id, -v_event.coins, 'admin_adjustment', v_event.contract_id,
          jsonb_build_object('reversal_of_event', v_event.id, 'reason', p_reason, 'admin_id', v_caller));

  UPDATE public.referral_project_reward_events
     SET status = 'reversed',
         reversal_reason = p_reason,
         metadata = metadata || jsonb_build_object('reversed_by', v_caller, 'reversed_at', now())
   WHERE id = v_event.id;

  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES (v_event.recipient_id, 'system', 'Grow Coins reversed',
          'A referral project reward of ' || v_event.coins || ' Grow Coins was reversed by Growlanzo support.',
          '/dashboard/referrals',
          jsonb_build_object('coins', v_event.coins, 'event', 'referral_project_reversal', 'reason', p_reason));

  RETURN jsonb_build_object('success', true, 'reversed_event', v_event.id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reverse_referral_project_reward(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reverse_referral_project_reward(uuid, text) TO authenticated, service_role;

COMMIT;
