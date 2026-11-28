-- ═══════════════════════════════════════════════════════════════════════════
-- 20271128 — FINAL PRE-LAUNCH: referral earning caps, client custom-project
--             reward, and the verification section locked to "Coming Soon".
--
-- Founder rules implemented here (nothing else changes):
--   1. Referral EARNINGS are capped per calendar month:
--        • freelancer / admin → 199 coins
--        • client             → 100 coins
--      The cap is an earning cap, not an invitation cap. The old
--      "5 invitations per month" limit is removed: a freelancer may refer
--      enough people to reach 199 coins, and a client enough to reach 100.
--      The cap is computed from the ledger for the current calendar month, so
--      it resets automatically on the 1st with no cron and no stored counter.
--   2. A client can redeem exactly 100 coins for ONE custom-project posting
--      credit. The credit is consumed by create_custom_project_with_reward(),
--      in the same transaction that inserts the project, so it can never be
--      reused and cannot be spent twice by concurrent requests.
--   3. Freelancer Premium redemption (199 coins) already exists in
--      20270129000000; this file only re-asserts it and caps referral
--      earnings that feed it.
--   4. The verification section is Coming Soon for BOTH roles. Every
--      submission RPC is revoked from app roles (historical rows stay
--      readable/auditable). No document, OTP or status write can be invoked
--      by a browser after this migration.
--
-- Additive / reversible: no table, column or historical row is deleted.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Referral earning caps — one source of truth, evaluated per month
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.referral_monthly_earning_cap(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
           WHEN COALESCE(
                  (SELECT p.role FROM public.profiles p WHERE p.id = p_user_id),
                  'freelancer'
                ) = 'client'
             THEN 100
             ELSE 199
         END
$$;

REVOKE ALL ON FUNCTION public.referral_monthly_earning_cap(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_monthly_earning_cap(uuid) TO authenticated, service_role;

-- Positive referral-earning rows only. Referee bonuses are intentionally NOT
-- counted: the cap protects the referrer's earning, not what a referred user
-- was paid for being referred.
CREATE OR REPLACE FUNCTION public.referral_coins_earned_this_month(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(SUM(l.amount), 0)::integer
    FROM public.grow_coin_ledger l
   WHERE l.user_id = p_user_id
     AND l.amount > 0
     AND l.created_at >= date_trunc('month', now())
     AND (
       l.reason = 'referral_bonus'
       OR l.reason = 'referee_referral_bonus' AND COALESCE(l.metadata->>'role', 'referrer') = 'referrer'
       OR l.reason = 'kyc_bonus' AND COALESCE(l.metadata->>'role', 'referrer') = 'referrer'
       OR l.reason = 'referral_project_reward' AND COALESCE(l.metadata->>'role', 'referrer') = 'referrer'
     )
$$;

REVOKE ALL ON FUNCTION public.referral_coins_earned_this_month(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_coins_earned_this_month(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.referral_remaining_monthly_cap(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT GREATEST(
           public.referral_monthly_earning_cap(p_user_id)
             - public.referral_coins_earned_this_month(p_user_id),
           0
         )
$$;

REVOKE ALL ON FUNCTION public.referral_remaining_monthly_cap(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_remaining_monthly_cap(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Remove the 5-invitations-per-month spam cap
--    The cap was an invitation cap, not the founder's 199/100 earning cap.
--    Keeping it at 5 made the 199-coin ceiling unreachable (5 coins × 5).
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_enforce_referral_monthly_cap ON public.referrals;

DROP FUNCTION IF EXISTS public.enforce_referral_monthly_cap();

-- process_referral: the 20270403000003 body (latest) without the invite cap.
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

  -- One claim per referee, regardless of which code is presented.
  IF EXISTS (
    SELECT 1 FROM public.referrals
    WHERE referred_user_id = p_new_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already referred');
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
    'monthly_cap', public.referral_monthly_earning_cap(v_referrer_id),
    'remaining_this_month', public.referral_remaining_monthly_cap(v_referrer_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_referral(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_referral(text, uuid, text) TO authenticated, service_role;

-- Keep both helpers callable (older deployed objects may still reference
-- them) but neutralise the retired 5-invite rule: the ceiling is now the
-- earning cap, so no stale caller can cap a user at five invitations.
CREATE OR REPLACE FUNCTION public.referral_monthly_invite_cap()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 1000000
$$;

REVOKE ALL ON FUNCTION public.referral_monthly_invite_cap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_monthly_invite_cap() TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. KYC referral award — same body as 20271126000000 + monthly earning cap
--    (and the same-side payout gate that was lost in that rewrite).
-- ───────────────────────────────────────────────────────────────────────────
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
  v_paid integer := 0;
  v_referrer_role text;
  v_referred_role text;
  v_remaining integer;
  v_referrer_paid integer := 0;
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

  -- Same-side gate at payout, fail closed.
  SELECT referrer.role, referee.role
    INTO v_referrer_role, v_referred_role
    FROM public.profiles referrer
    LEFT JOIN public.profiles referee ON referee.id = p_referred_user_id
   WHERE referrer.id = v_referral.referrer_id;

  IF v_referrer_role IS DISTINCT FROM 'admin'
     AND (v_referrer_role IS NULL
          OR v_referred_role IS NULL
          OR v_referrer_role != v_referred_role) THEN
    UPDATE public.referrals SET status = 'expired' WHERE id = v_referral.id;
    RETURN jsonb_build_object('success', false, 'reason', 'role_mismatch', 'referral_id', v_referral.id);
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

  -- The referee is always paid their own 5 coins for completing KYC.
  INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
  VALUES
    (p_referred_user_id, v_coins, 'kyc_bonus', v_referral.id,
     jsonb_build_object('role', 'referred', 'rule', 'kyc_referral_reward', 'referral_id', v_referral.id))
  ON CONFLICT DO NOTHING;

  -- The referrer is paid only while their monthly earning cap allows it.
  v_remaining := public.referral_remaining_monthly_cap(v_referral.referrer_id);

  IF v_remaining > 0 THEN
    INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
    VALUES
      (v_referral.referrer_id, LEAST(v_coins, v_remaining), 'kyc_bonus', v_referral.id,
       jsonb_build_object('role', 'referrer', 'rule', 'kyc_referral_reward', 'referral_id', v_referral.id,
                          'monthly_cap', public.referral_monthly_earning_cap(v_referral.referrer_id)))
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_referrer_paid = ROW_COUNT;
  ELSE
    INSERT INTO public.grow_coin_review_flags (user_id, kind, details)
    VALUES (v_referral.referrer_id, 'monthly_earning_cap',
            jsonb_build_object('referral_id', v_referral.id,
                               'cap', public.referral_monthly_earning_cap(v_referral.referrer_id),
                               'rule', 'kyc_referral_reward'));
  END IF;

  UPDATE public.referrals
     SET bonus_claimed = true,
         status = 'completed',
         activated_at = COALESCE(activated_at, now())
   WHERE id = v_referral.id;

  IF v_referrer_paid > 0 THEN
    UPDATE public.referral_stats
       SET valid_referrals = COALESCE(valid_referrals, 0) + 1,
           points = COALESCE(points, 0) + v_coins,
           updated_at = now()
     WHERE user_id = v_referral.referrer_id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES
    (p_referred_user_id, 'system', 'KYC verified — 5 Grow Coins earned',
     'Your identity verification is approved. You and your referral partner have each earned 5 Growlanzo Coins.',
     CASE WHEN v_referred_role = 'client' THEN '/client/referrals' ELSE '/referrals' END,
     jsonb_build_object('coins', v_coins, 'event', 'kyc_referral', 'referral_id', v_referral.id)),
    (v_referral.referrer_id, 'system',
     CASE WHEN v_referrer_paid > 0
          THEN 'Your referral passed KYC — 5 Grow Coins earned'
          ELSE 'Your referral passed KYC — monthly cap reached'
     END,
     CASE WHEN v_referrer_paid > 0
          THEN 'KYC verified! You and your referral partner have each earned 5 Growlanzo Coins.'
          ELSE 'Your referral is counted, but this month''s referral earning cap is already reached. It resets on the 1st.'
     END,
     CASE WHEN v_referrer_role = 'client' THEN '/client/referrals' ELSE '/referrals' END,
     jsonb_build_object('coins', CASE WHEN v_referrer_paid > 0 THEN v_coins ELSE 0 END,
                        'capped', v_referrer_paid = 0,
                        'event', 'kyc_referral', 'referral_id', v_referral.id));

  RETURN jsonb_build_object(
    'success', true,
    'coins', CASE WHEN v_referrer_paid > 0 THEN v_coins ELSE 0 END,
    'referee_coins', v_coins,
    'capped', v_referrer_paid = 0,
    'referral_id', v_referral.id,
    'stats_updated', v_referrer_paid > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_referral_bonus_if_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_bonus_if_eligible(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Project referral award — same body as 20270403000003 + monthly cap on
--    the referrer side. The referee keeps their full reward.
-- ───────────────────────────────────────────────────────────────────────────
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
  v_remaining integer;
  v_referrer_coins integer;
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

  -- Settlement proof: a released escrow row is authoritative for wallet
  -- payments; completed payment/fee ledger rows cover gateway flows.
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

    -- Referrer side: capped by the calendar-month earning limit.
    v_remaining := public.referral_remaining_monthly_cap(v_referral.referrer_id);
    v_referrer_coins := LEAST(v_coins, v_remaining);

    IF v_referrer_coins > 0 THEN
      INSERT INTO public.referral_project_reward_events
        (contract_id, project_id, referrer_id, referred_user_id, recipient_id, coins, metadata)
      VALUES
        (v_contract.id, v_contract.project_id, v_referral.referrer_id, v_party, v_referral.referrer_id, v_referrer_coins,
         jsonb_build_object('source', 'referral_project', 'referral_id', v_referral.id, 'role', 'referrer',
                            'monthly_cap', public.referral_monthly_earning_cap(v_referral.referrer_id)))
      ON CONFLICT (contract_id, recipient_id) DO NOTHING
      RETURNING id INTO v_referrer_event_id;

      IF v_referrer_event_id IS NOT NULL THEN
        INSERT INTO public.grow_coin_ledger (user_id, amount, reason, reference_id, metadata)
        VALUES (v_referral.referrer_id, v_referrer_coins, 'referral_project_reward', v_contract.id,
                jsonb_build_object('event_id', v_referrer_event_id, 'role', 'referrer'));
      END IF;
    ELSE
      INSERT INTO public.grow_coin_review_flags (user_id, kind, details)
      VALUES (v_referral.referrer_id, 'monthly_earning_cap',
              jsonb_build_object('contract_id', v_contract.id, 'referral_id', v_referral.id,
                                 'cap', public.referral_monthly_earning_cap(v_referral.referrer_id),
                                 'rule', 'referral_project_reward'));
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
    VALUES
      (v_party, 'system', 'You earned 5 Grow Coins',
       'Your project is complete. You and your referral partner have each earned 5 Growlanzo Coins.',
       '/dashboard/referrals',
       jsonb_build_object('coins', v_coins, 'event', 'referral_project', 'contract_id', v_contract.id)),
      (v_referral.referrer_id, 'system',
       CASE WHEN v_referrer_coins > 0
            THEN 'Your referral completed a project'
            ELSE 'Your referral completed a project — monthly cap reached'
       END,
       CASE WHEN v_referrer_coins > 0
            THEN 'Congratulations! Your referred user successfully completed another project. You and your referral partner have each earned 5 Growlanzo Coins.'
            ELSE 'Your referral completed another project. It is counted, but this month''s referral earning cap is already reached; it resets on the 1st.'
       END,
       '/dashboard/referrals',
       jsonb_build_object('coins', v_referrer_coins, 'event', 'referral_project', 'contract_id', v_contract.id));

    v_awarded := v_awarded + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'awarded', v_awarded, 'contract_id', v_contract.id);
END;
$$;

REVOKE ALL ON FUNCTION public.award_referral_project_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_project_reward(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Client custom-project reward (100 coins → one project posting)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.grow_coin_ledger DROP CONSTRAINT IF EXISTS grow_coin_ledger_reason_check;
ALTER TABLE public.grow_coin_ledger
  ADD CONSTRAINT grow_coin_ledger_reason_check CHECK (
    reason = ANY (ARRAY[
      'referral_bonus',
      'referee_referral_bonus',
      'kyc_bonus',
      'first_project_bonus',
      'referral_project_reward',
      'redemption_premium',
      'redemption_custom_project',
      'redemption_project_discount',
      'withdrawal',
      'admin_adjustment'
    ]::text[])
  );

CREATE TABLE IF NOT EXISTS public.custom_project_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used')),
  coins integer NOT NULL DEFAULT 100 CHECK (coins > 0),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_project_reward_idempotency
  ON public.custom_project_rewards (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One live credit at a time: a second redemption is refused until the first
-- is spent, so a user can never stack multiple unused credits.
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_project_reward_unused
  ON public.custom_project_rewards (user_id)
  WHERE status = 'unused';

CREATE INDEX IF NOT EXISTS idx_custom_project_rewards_user
  ON public.custom_project_rewards (user_id, created_at DESC);

ALTER TABLE public.custom_project_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own custom project rewards" ON public.custom_project_rewards;
CREATE POLICY "Users can view own custom project rewards"
  ON public.custom_project_rewards FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.custom_project_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.custom_project_rewards TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_grow_coins_for_custom_project(p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_cost constant integer := 100;
  v_balance integer;
  v_reserved integer;
  v_existing public.grow_coin_ledger%ROWTYPE;
  v_reward_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role IS DISTINCT FROM 'client' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'The custom project reward is for client accounts only.'
    );
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.grow_coin_ledger
     WHERE user_id = v_user_id
       AND idempotency_key = p_idempotency_key
       AND reason = 'redemption_custom_project'
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true, 'already_processed', true, 'coins', ABS(v_existing.amount)
      );
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.custom_project_rewards
     WHERE user_id = v_user_id AND status = 'unused'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have an unused custom project reward. Post that project first.'
    );
  END IF;

  SELECT COALESCE(SUM(amount), 0)::integer INTO v_balance
    FROM public.grow_coin_ledger WHERE user_id = v_user_id;
  v_reserved := public.grow_coin_reserved_amount(v_user_id);

  IF v_balance - v_reserved < v_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient Grow Coins',
      'required', v_cost,
      'available', GREATEST(v_balance - v_reserved, 0)
    );
  END IF;

  INSERT INTO public.grow_coin_ledger (
    user_id, amount, reason, reference_id, idempotency_key, metadata
  ) VALUES (
    v_user_id, -v_cost, 'redemption_custom_project', NULL, p_idempotency_key,
    jsonb_build_object('coins_per_inr', 1, 'reward', 'custom_project')
  );

  INSERT INTO public.custom_project_rewards (user_id, coins, idempotency_key)
  VALUES (v_user_id, v_cost, p_idempotency_key)
  RETURNING id INTO v_reward_id;

  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES (
    v_user_id, 'system', 'Custom project reward unlocked',
    '100 Grow Coins were redeemed for one custom project posting. Post your project from the referrals page.',
    '/client/referrals',
    jsonb_build_object('coins', v_cost, 'reward_id', v_reward_id, 'event', 'custom_project_reward')
  );

  RETURN jsonb_build_object(
    'success', true, 'coins', v_cost, 'reward_id', v_reward_id,
    'balance', (SELECT COALESCE(SUM(amount), 0)::integer FROM public.grow_coin_ledger WHERE user_id = v_user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_grow_coins_for_custom_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_grow_coins_for_custom_project(uuid) TO authenticated;

-- Atomic: consumes the credit, inserts the project, links them, and records the
-- project on the original redemption ledger row. Any failure rolls all of it
-- back, so a credit can never be burned without a project (or vice versa).
CREATE OR REPLACE FUNCTION public.create_custom_project_with_reward(
  p_idempotency_key uuid,
  p_title text,
  p_description text,
  p_budget numeric,
  p_category text DEFAULT NULL,
  p_skills text[] DEFAULT '{}',
  p_deadline date DEFAULT NULL,
  p_experience_level text DEFAULT 'intermediate',
  p_industry text DEFAULT NULL,
  p_visibility text DEFAULT 'public'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_reward public.custom_project_rewards%ROWTYPE;
  v_project_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role IS DISTINCT FROM 'client' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only client accounts can post projects.');
  END IF;

  IF COALESCE(btrim(p_title), '') = '' OR COALESCE(btrim(p_description), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A title and description are required.');
  END IF;

  IF p_budget IS NULL OR p_budget < 500 OR p_budget > 100000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Budget must be between 500 and 100000.');
  END IF;

  IF p_experience_level NOT IN ('entry', 'intermediate', 'expert') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid experience level.');
  END IF;

  IF p_visibility NOT IN ('public', 'private', 'invite_only') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid visibility.');
  END IF;

  SELECT * INTO v_reward
    FROM public.custom_project_rewards
   WHERE user_id = v_user_id AND status = 'unused'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No custom project reward available. Redeem 100 Grow Coins first.'
    );
  END IF;

  INSERT INTO public.projects (
    client_id, title, description, budget_min, budget_max,
    skills_required, deadline, category, industry,
    experience_level, visibility, status
  ) VALUES (
    v_user_id, btrim(p_title), btrim(p_description), p_budget, p_budget,
    COALESCE(p_skills, '{}'), p_deadline, p_category, p_industry,
    p_experience_level, p_visibility, 'open'
  )
  RETURNING id INTO v_project_id;

  UPDATE public.custom_project_rewards
     SET status = 'used', project_id = v_project_id, used_at = now(),
         metadata = metadata || jsonb_build_object('project_id', v_project_id)
   WHERE id = v_reward.id;

  -- Tie the ledger redemption to the project for an auditable trail.
  UPDATE public.grow_coin_ledger
     SET metadata = metadata || jsonb_build_object('project_id', v_project_id)
   WHERE user_id = v_user_id
     AND reason = 'redemption_custom_project'
     AND (idempotency_key IS NOT DISTINCT FROM v_reward.idempotency_key)
     AND metadata->>'project_id' IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'project_id', v_project_id,
    'reward_id', v_reward.id,
    'coins', v_reward.coins
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_custom_project_with_reward(uuid, text, text, numeric, text, text[], date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_custom_project_with_reward(uuid, text, text, numeric, text, text[], date, text, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Verification section: Coming Soon for BOTH roles
--    Historical identity_verifications rows stay intact for audit. Every
--    write/submission path is closed to app roles; service_role keeps access
--    for admin tooling and historical maintenance.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.refresh_light_kyc(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.refresh_light_kyc(TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.refresh_light_kyc(TEXT) TO service_role;
  END IF;

  IF to_regprocedure('public.request_phone_otp(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.request_phone_otp(TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.request_phone_otp(TEXT) TO service_role;
  END IF;

  IF to_regprocedure('public.verify_phone_otp(text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.verify_phone_otp(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.verify_phone_otp(TEXT, TEXT) TO service_role;
  END IF;

  IF to_regclass('public.identity_verifications') IS NOT NULL THEN
    REVOKE INSERT, UPDATE ON public.identity_verifications FROM authenticated, anon;
    COMMENT ON TABLE public.identity_verifications IS
      'COMING SOON (launch): verification submissions are closed for both roles. Historical rows are retained read-only for audit.';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Fail-closed assertions (deploy refuses if a rule is lost)
-- ───────────────────────────────────────────────────────────────────────────
DO $launch_guards$
DECLARE
  v_def text;
BEGIN
  IF public.referral_monthly_earning_cap(NULL) IS DISTINCT FROM 199 THEN
    -- A NULL id resolves the default role branch; this also proves the
    -- function is callable by the migration owner.
    NULL;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'award_referral_bonus_if_eligible';
  IF v_def IS NULL OR v_def NOT LIKE '%monthly_earning_cap%' THEN
    RAISE EXCEPTION 'launch migration failed: KYC referral award has no monthly earning cap';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'award_referral_project_reward';
  IF v_def IS NULL OR v_def NOT LIKE '%monthly_earning_cap%' THEN
    RAISE EXCEPTION 'launch migration failed: project referral award has no monthly earning cap';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'process_referral';
  IF v_def IS NULL OR v_def LIKE '%invite_cap%' THEN
    RAISE EXCEPTION 'launch migration failed: the retired invite cap is still enforced';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_enforce_referral_monthly_cap' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'launch migration failed: the retired invite-cap trigger still exists';
  END IF;

  IF has_function_privilege('authenticated', 'public.redeem_grow_coins_for_custom_project(uuid)', 'EXECUTE') = false THEN
    RAISE EXCEPTION 'launch migration failed: clients cannot redeem the custom project reward';
  END IF;

  IF has_function_privilege('authenticated', 'public.refresh_light_kyc(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'launch migration failed: the verification submission RPC is still callable by clients';
  END IF;
END;
$launch_guards$;

NOTIFY pgrst, 'reload schema';

COMMIT;
