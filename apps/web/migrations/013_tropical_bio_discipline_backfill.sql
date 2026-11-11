-- ============================================================================
-- TROPICAL — INFER DISCIPLINES FROM BIO AND PASSION TEXT
-- ============================================================================
-- Migration 004 inferred disciplines from creative_data.tags. Seven creatives
-- had no usable tags and so ended up with no disciplines at all: they show on
-- /talent but the team builder can never propose them, because matching runs
-- on tropical_creative_disciplines.
--
-- Several of them describe their craft plainly in prose instead — "portraiture,
-- nail art and sewing", "Digital Marketing & Brand Storytelling", "I create
-- fashion content". This reads that prose.
--
-- Scope, measured against live data before writing: of the seven, three resolve
-- (sample_user_a, sample_user_b, sample_user_c). The other four have nothing to read —
-- Unluckyluke, Ajike and rebekahdiva have null/empty bio and passion, and
-- Amelia_aulani's bio is the literal string "No bio available". They stay
-- empty until they add a skill themselves, which modules/skills/actions.ts
-- now lets them do.
--
-- Everything inserted is source='inferred', so the profile shows it as a
-- suggestion the creative can correct — same contract as 004. Re-runnable:
-- ON CONFLICT DO NOTHING, and it never touches a discipline someone has
-- already confirmed or added.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- One new discipline, attested by a real profile
-- ---------------------------------------------------------------------------
-- sample_user_c describes herself as a "Nail Artist". Nothing in the seeded
-- taxonomy covers it, and the nearest neighbours (Stylist, Makeup Artist) are
-- different crafts. The taxonomy has always been built from what creatives
-- actually say they do, and the cleanup lets them coin new skills anyway.
INSERT INTO public.tropical_disciplines (slug, label, category, sort_order)
VALUES ('nail-artist', 'Nail Artist', 'styling', 440)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Phrase map
-- ---------------------------------------------------------------------------
-- Inline rather than a table, unlike tropical_tag_discipline_map. That map earns
-- its keep because tags keep arriving from onboarding; free-text inference is
-- a one-off catch-up for people who predate self-service skills, so a
-- permanent table would be one more thing to maintain and drift.
--
-- Deliberately narrow. A wrong discipline is worse than a missing one: it puts
-- someone in front of a brand for work they do not do. Phrases are matched on
-- word boundaries (\y), so "art" does not fire inside "start" and "ad" does
-- not fire inside "already".
WITH phrase_map (phrase, discipline_slug) AS (
  VALUES
    -- strategy / marketing
    ('brand strategy',      'brand-strategist'),
    ('brand storytelling',  'brand-strategist'),
    ('digital marketing',   'brand-strategist'),
    ('marketing',           'brand-strategist'),
    -- content
    ('content creator',     'content-creator'),
    ('fashion content',     'content-creator'),
    ('create content',      'content-creator'),
    ('produce content',     'content-creator'),
    ('ugc',                 'content-creator'),
    ('storytelling',        'content-writer'),
    ('copywriting',         'content-writer'),
    -- visual craft
    ('portraiture',         'illustrator'),
    ('illustration',        'illustrator'),
    ('illustrator',         'illustrator'),
    ('photographer',        'photographer'),
    ('photography',         'photographer'),
    ('videographer',        'videographer'),
    ('video editing',       'video-editor'),
    ('video editor',        'video-editor'),
    -- making
    ('sewing',              'apparel-designer'),
    ('apparel',             'apparel-designer'),
    ('garment',             'apparel-designer'),
    ('stylist',             'stylist'),
    ('styling',             'stylist'),
    ('fashion',             'stylist'),
    ('nail art',            'nail-artist'),
    ('nail artist',         'nail-artist'),
    ('nail technician',     'nail-artist'),
    -- performance
    ('singer',              'singer'),
    ('vocalist',            'singer'),
    ('musician',            'musician')
),

-- Creatives with no discipline at all, and whatever prose they have written.
candidates AS (
  SELECT
    u.id AS user_id,
    lower(btrim(coalesce(u.bio, '') || ' ' || coalesce(cd.passion, ''))) AS blurb
  FROM public.users u
  LEFT JOIN public.creative_data cd ON cd.user_id = u.id
  WHERE u.role = 'creative'
    AND NOT EXISTS (
      SELECT 1 FROM public.tropical_creative_disciplines d WHERE d.user_id = u.id
    )
),

-- Drop placeholder prose. "No bio available" is a default the old onboarding
-- wrote, not something anyone typed about themselves.
readable AS (
  SELECT user_id, blurb
  FROM candidates
  WHERE blurb <> ''
    AND blurb NOT IN ('no bio available', 'n/a', 'none', '-')
),

matched AS (
  SELECT DISTINCT r.user_id, p.discipline_slug
  FROM readable r
  JOIN phrase_map p
    ON r.blurb ~* ('\y' || p.phrase || '\y')
)

INSERT INTO public.tropical_creative_disciplines (user_id, discipline_slug, source)
SELECT user_id, discipline_slug, 'inferred'
FROM matched
ON CONFLICT (user_id, discipline_slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Primary discipline
-- ---------------------------------------------------------------------------
-- Same rule as 004: the discipline they share with the fewest other people,
-- i.e. their most distinguishing craft. Only for users who have no primary yet.
WITH ranked AS (
  SELECT
    d.id,
    row_number() OVER (
      PARTITION BY d.user_id
      ORDER BY pop.n ASC, d.discipline_slug ASC
    ) AS rn
  FROM public.tropical_creative_disciplines d
  JOIN (
    SELECT discipline_slug, count(*) AS n
    FROM public.tropical_creative_disciplines
    GROUP BY discipline_slug
  ) pop ON pop.discipline_slug = d.discipline_slug
  WHERE d.source = 'inferred'
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

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expect 33 creatives with a discipline (was 30), and 4 still without.
--
-- SELECT count(DISTINCT user_id) FROM public.tropical_creative_disciplines;
--
-- SELECT u.username, d.discipline_slug
--   FROM public.users u
--   JOIN public.tropical_creative_disciplines d ON d.user_id = u.id
--  WHERE d.source = 'inferred'
--    AND u.username IN ('sample_user_a', 'sample_user_b', 'sample_user_c')
--  ORDER BY u.username;
--
-- Still empty by design (nothing written to read):
--   Unluckyluke, Ajike, rebekahdiva, Amelia_aulani
