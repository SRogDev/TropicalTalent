-- ============================================================================
-- TROPICAL CREATIVE FEEDBACK
-- ============================================================================
-- A brand's private verdict on a creative they worked with: recommend or
-- don't recommend, one row per (project, creative) so working together again
-- opens a fresh verdict rather than overwriting the last project's.
--
-- The row itself is private — RLS scopes it strictly to the brand who wrote
-- it, same shape as tropical_favourites in 010/011. Nobody, not even the
-- creative, can read who said what.
--
-- What IS shared platform-wide is a per-creative aggregate: how often brands
-- would recommend them. tropical_recommend_rates() is SECURITY DEFINER so it can
-- read across every brand's rows, but it only ever returns a creative_id and a
-- rate — never a project_id or a brand_id — so the aggregate cannot be
-- reverse-engineered into "who said what". modules/talent's rank() uses it as
-- a light tiebreaker in the /create candidate pool.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_creative_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  brand_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creative_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recommend    boolean NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_creative_feedback_unique UNIQUE (project_id, creative_id),
  CONSTRAINT tropical_creative_feedback_not_self CHECK (brand_id <> creative_id)
);

COMMENT ON TABLE public.tropical_creative_feedback IS
  'A brand''s private recommend/don''t-recommend verdict on a creative, per completed project.';

CREATE INDEX IF NOT EXISTS idx_tropical_creative_feedback_creative
  ON public.tropical_creative_feedback (creative_id);
CREATE INDEX IF NOT EXISTS idx_tropical_creative_feedback_brand
  ON public.tropical_creative_feedback (brand_id, project_id);

ALTER TABLE public.tropical_creative_feedback ENABLE ROW LEVEL SECURITY;

-- Strictly own rows — mirrors tropical_favourites_own in 011.
CREATE POLICY "tropical_creative_feedback_own" ON public.tropical_creative_feedback
  FOR ALL USING (brand_id = (SELECT auth.uid()))
  WITH CHECK (brand_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Aggregate recommend rate per creative, for ranking.
--
-- Runs as the function owner so it can see every brand's rows, but the
-- SELECT list is deliberately narrow: creative_id, a rate, and a count. No
-- project_id, no brand_id — there is no column here that identifies who gave
-- the feedback, so granting this to every authenticated user does not leak
-- the private verdicts the table itself protects.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_recommend_rates(p_creative_ids uuid[])
RETURNS TABLE(creative_id uuid, recommend_rate numeric, feedback_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT f.creative_id,
         AVG(CASE WHEN f.recommend THEN 1 ELSE 0 END)::numeric AS recommend_rate,
         COUNT(*)::integer AS feedback_count
  FROM public.tropical_creative_feedback f
  WHERE f.creative_id = ANY(p_creative_ids)
  GROUP BY f.creative_id;
$$;

REVOKE ALL ON FUNCTION public.tropical_recommend_rates(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_recommend_rates(uuid[]) TO authenticated;

COMMIT;
