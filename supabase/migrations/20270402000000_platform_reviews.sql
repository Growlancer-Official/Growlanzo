-- ═══════════════════════════════════════════════════════════════════════════
-- Platform reviews — public testimonials shown on the homepage
--
-- One review per user, split by the author's REAL role (derived server-side,
-- never trusted from the client). Only users who have completed at least one
-- contract may publish: the homepage is social proof, not a signup billboard.
--
-- Reads are public (published rows only). Writes are own-row only; the client
-- cannot choose its role or flip `status`.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('client', 'freelancer')),
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 10 AND 600),
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_reviews_one_per_user UNIQUE (user_id)
);

-- ─── Role + eligibility are derived, never client-supplied ────────────────
CREATE OR REPLACE FUNCTION public.set_platform_review_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Identity comes from the session, never the payload.
  NEW.user_id := auth.uid();

  SELECT role INTO v_role FROM public.profiles WHERE id = NEW.user_id;
  IF v_role IS NULL OR v_role NOT IN ('client', 'freelancer') THEN
    RAISE EXCEPTION 'Only clients and freelancers can review the platform';
  END IF;
  NEW.role := v_role;

  -- Credible social proof: at least one completed contract on either side.
  IF NOT EXISTS (
    SELECT 1 FROM public.contracts
    WHERE status = 'completed'
      AND (client_id = NEW.user_id OR freelancer_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'A completed contract is required before reviewing the platform';
  END IF;

  -- Users cannot publish/hide rows; only a service-role admin can change status.
  IF TG_OP = 'UPDATE' THEN
    NEW.status := OLD.status;
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.status := 'published';
  END IF;
  NEW.updated_at := now();

  -- Rating is user-authored feedback (1-5), validated by the column CHECK.
  -- On UPDATE the server locks it so a published review's score can never be
  -- rewritten after the fact (the value the homepage trusts must be immutable
  -- once published).
  IF TG_OP = 'UPDATE' THEN
    NEW.rating := OLD.rating;
  END IF;

  NEW.comment := btrim(NEW.comment);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_platform_review_fields ON public.platform_reviews;
CREATE TRIGGER set_platform_review_fields
  BEFORE INSERT OR UPDATE ON public.platform_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_platform_review_fields();

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.platform_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read published platform reviews" ON public.platform_reviews;
CREATE POLICY "Anyone can read published platform reviews"
  ON public.platform_reviews FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "Users insert own platform review" ON public.platform_reviews;
CREATE POLICY "Users insert own platform review"
  ON public.platform_reviews FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own platform review" ON public.platform_reviews;
CREATE POLICY "Users update own platform review"
  ON public.platform_reviews FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own platform review" ON public.platform_reviews;
CREATE POLICY "Users delete own platform review"
  ON public.platform_reviews FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.platform_reviews TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.platform_reviews TO authenticated;

-- The BEFORE INSERT/UPDATE trigger runs as SECURITY DEFINER, so the function
-- itself must NOT be executable by anon (a NULL-unsafe guard inside it would
-- fail open). Revoke the PUBLIC default and re-grant only to authenticated +
-- service_role (the latter is needed for the trigger to fire).
REVOKE EXECUTE ON FUNCTION public.set_platform_review_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_platform_review_fields() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_platform_reviews_role_recent
  ON public.platform_reviews (role, created_at DESC)
  WHERE status = 'published';

-- ─── Realtime for the homepage sections ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'platform_reviews'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_reviews;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
