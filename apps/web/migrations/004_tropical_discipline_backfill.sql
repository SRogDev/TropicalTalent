-- ============================================================================
-- TROPICAL DISCIPLINE BACKFILL
-- ============================================================================
-- Populates tropical_creative_disciplines from the existing creative_data.tags
-- jsonb. Reads creative_data; never writes to it.
--
-- Everything inserted here is source='inferred'. The profile prompt asks the
-- creative to confirm or correct, which flips the row to 'confirmed'. The
-- ON CONFLICT clause below deliberately does NOT touch rows a user has already
-- confirmed or added themselves, so this migration is safe to re-run.
--
-- Expected on current data: 28 of 34 creative profiles gain >= 1 discipline.
-- The remaining 6 have no tags and stay empty until they pick disciplines.
-- ============================================================================

BEGIN;

INSERT INTO public.tropical_creative_disciplines (user_id, discipline_slug, source)
SELECT DISTINCT
  cd.user_id,
  m.discipline_slug,
  'inferred'
FROM public.creative_data cd
-- tags is jsonb and in practice holds a bare array of strings. jsonb_array_elements_text
-- would error on any row storing a scalar or object, so filter to arrays first.
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(cd.tags) = 'array' THEN cd.tags ELSE '[]'::jsonb END
) AS t(tag)
JOIN public.tropical_tag_discipline_map m
  ON m.tag = lower(btrim(t.tag))
WHERE cd.user_id IS NOT NULL
ON CONFLICT (user_id, discipline_slug) DO NOTHING;

-- Mark the highest-signal discipline as primary: the one the creative shares
-- with the fewest others, i.e. their most distinguishing craft. Ties break on
-- slug for determinism.
WITH ranked AS (
  SELECT
    cdisc.id,
    row_number() OVER (
      PARTITION BY cdisc.user_id
      ORDER BY pop.n ASC, cdisc.discipline_slug ASC
    ) AS rn
  FROM public.tropical_creative_disciplines cdisc
  JOIN (
    SELECT discipline_slug, count(*) AS n
    FROM public.tropical_creative_disciplines
    GROUP BY discipline_slug
  ) pop ON pop.discipline_slug = cdisc.discipline_slug
  WHERE cdisc.source = 'inferred'
)
UPDATE public.tropical_creative_disciplines d
SET is_primary = true
FROM ranked
WHERE d.id = ranked.id
  AND ranked.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.tropical_creative_disciplines x
    WHERE x.user_id = d.user_id AND x.is_primary
  );

-- Seed a wallet row for every existing user so the earnings surface never has
-- to branch on "no balance row yet".
INSERT INTO public.tropical_user_balances (user_id)
SELECT id FROM public.users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run after commit)
-- ---------------------------------------------------------------------------
-- SELECT count(DISTINCT user_id) AS creatives_with_disciplines
--   FROM public.tropical_creative_disciplines;                        -- expect 28
-- SELECT d.label, count(*) AS n
--   FROM public.tropical_creative_disciplines c
--   JOIN public.tropical_disciplines d ON d.slug = c.discipline_slug
--  GROUP BY d.label ORDER BY n DESC;                                -- singer 6, ...
-- SELECT count(*) FROM public.tropical_user_balances;                 -- expect 45
