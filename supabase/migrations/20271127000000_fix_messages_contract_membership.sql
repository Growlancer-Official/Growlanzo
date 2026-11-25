-- ═══════════════════════════════════════════════════════════════════════════
-- MESSAGES — insert/read must be scoped to the contract, not just the sender
--
-- Found by scripts/e2e/full-sweep.mjs on the live DB (2026-11-25):
--   an authenticated outsider POSTed a row into another client's workspace and
--   got 201. Both the original ("Users can insert messages") and the later
--   ("Contract participants can insert messages") policies accepted
--   `auth.uid() = sender_id` on its own, so anyone could write into any
--   contract simply by naming themselves as the sender. The same shape let that
--   sender read their own injected row.
--
-- The app only ever writes workspace messages through
-- `messages.send(contractId, …)` / the workspace pages, always with a
-- contract_id, so the safe rule is: the sender is the caller, the row belongs
-- to a contract, the caller is a party to that contract, and a named receiver
-- is the other party. Historical rows with a NULL contract_id are none today
-- (verified: 0 rows); a future direct-message surface needs its own policy.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Contract participants can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Contract participants can view messages" ON public.messages;

-- INSERT: caller is the sender AND a party to the contract AND the receiver is
-- the other party (or unset, which the shared send() helper allows).
CREATE POLICY "Contract participants can insert messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND contract_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = messages.contract_id
        AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
        AND (
          messages.receiver_id IS NULL
          OR messages.receiver_id = CASE
               WHEN c.client_id = auth.uid() THEN c.freelancer_id
               ELSE c.client_id
             END
        )
    )
  );

-- SELECT: only contract parties (this also closes the "read my own injected
-- row" path). The sender/receiver clauses remain for any non-contract row.
CREATE POLICY "Contract participants can view messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = messages.contract_id
        AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
    )
    OR (
      contract_id IS NULL
      AND (auth.uid() = sender_id OR auth.uid() = receiver_id)
    )
  );

-- Fail the deploy if the loose policy can still be reached: an outsider must
-- not be able to insert into a contract they are not part of. The assertion
-- checks that at least one INSERT policy exists and every INSERT policy names
-- auth.uid() = sender_id together with a contract lookup.
DO $assert$
DECLARE
  v_insert_policies INT;
  v_loose INT;
BEGIN
  SELECT count(*) INTO v_insert_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'messages' AND cmd = 'INSERT';

  SELECT count(*) INTO v_loose
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'messages' AND cmd = 'INSERT'
     AND (with_check IS NULL OR with_check NOT ILIKE '%contracts%');

  IF v_insert_policies = 0 OR v_loose > 0 THEN
    RAISE EXCEPTION 'messages INSERT policy is not contract-scoped (insert policies: %, unscoped: %)',
      v_insert_policies, v_loose;
  END IF;
END $assert$;

NOTIFY pgrst, 'reload schema';
