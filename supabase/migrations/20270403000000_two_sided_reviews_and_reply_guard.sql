-- ═══════════════════════════════════════════════════════════════════════════
-- Two-sided reviews + reply guard
--
-- BUG (measured live 2026-11-18): `reviews_contract_unique` was UNIQUE
-- (contract_id) and `reviews_contest_unique` was UNIQUE (contest_id). The
-- reviews edge function correctly checks "one review per reviewer", but the
-- second party's insert died with 23505, so a freelancer could never review a
-- client (and a contest winner could never review the client).
--
-- The correct keys already exist:
--   reviews_contract_reviewer_key (contract_id, reviewer_id)
--   reviews_contest_reviewer_key  (contest_id, reviewer_id)
--
-- Also: `review_replies` had a permissive INSERT policy that only checked
-- `user_id = auth.uid()`, so ANY signed-in user could reply to ANY review.
-- Only the reviewee may reply.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP INDEX IF EXISTS public.reviews_contract_unique;
DROP INDEX IF EXISTS public.reviews_contest_unique;

DROP POLICY IF EXISTS "Users can create own replies" ON public.review_replies;
DROP POLICY IF EXISTS "Review participants can insert replies" ON public.review_replies;
DROP POLICY IF EXISTS "Reviewee can reply to own review" ON public.review_replies;

CREATE POLICY "Reviewee can reply to own review"
  ON public.review_replies FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = review_replies.review_id
        AND r.reviewee_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
