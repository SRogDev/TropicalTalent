-- ============================================================================
-- TROPICAL DISCIPLINE TAXONOMY + TAG MAP
-- ============================================================================
-- The taxonomy is derived from the live creative_data.tags corpus (74 distinct
-- tags across 34 profiles), not from the tropical prototype's film-crew
-- ROLE_BANK. Only 4 of that prototype's 10 titles appear in the real data,
-- which would have left most of the talent pool unmatchable.
--
-- Measured coverage of this mapping: 28/34 profiles gain at least one
-- discipline; the other 6 have no tags at all. Every tagged profile matches.
-- All 33 disciplines below are attested by at least one real profile.
-- ============================================================================

BEGIN;

INSERT INTO public.tropical_disciplines (slug, label, category, sort_order) VALUES
  -- Film & photo
  ('photographer',         'Photographer',          'film',        10),
  ('videographer',         'Videographer',          'film',        20),
  ('filmmaker',            'Filmmaker',             'film',        30),
  ('cinematographer',      'Cinematographer',       'film',        40),
  ('video-editor',         'Video Editor',          'film',        50),
  ('colorist',             'Colorist',              'film',        60),
  ('vfx-artist',           'VFX Artist',            'film',        70),
  ('motion-designer',      'Motion Designer',       'film',        80),
  -- Direction & production
  ('creative-director',    'Creative Director',     'direction',  110),
  ('art-director',         'Art Director',          'direction',  120),
  ('producer',             'Producer',              'direction',  130),
  ('project-manager',      'Project Manager',       'direction',  140),
  ('brand-strategist',     'Brand Strategist',      'direction',  150),
  -- Events
  ('event-designer',       'Event Designer',        'events',     210),
  ('event-manager',        'Event Manager',         'events',     220),
  -- Performance & music
  ('singer',               'Singer',                'performance',310),
  ('musician',             'Musician',              'performance',320),
  ('songwriter',           'Songwriter',            'performance',330),
  ('actor',                'Actor',                 'performance',340),
  ('voice-actor',          'Voice Actor',           'performance',350),
  ('model',                'Model',                 'performance',360),
  ('poet',                 'Poet / Spoken Word',    'performance',370),
  -- Styling & beauty
  ('stylist',              'Stylist',               'styling',    410),
  ('hair-stylist',         'Hair Stylist',          'styling',    420),
  ('makeup-artist',        'Makeup Artist',         'styling',    430),
  -- Design
  ('graphic-designer',     'Graphic Designer',      'design',     510),
  ('illustrator',          'Illustrator',           'design',     520),
  ('apparel-designer',     'Apparel Designer',      'design',     530),
  -- Words & content
  ('copywriter',           'Copywriter',            'content',    610),
  ('content-writer',       'Content Writer',        'content',    620),
  ('content-creator',      'Content Creator',       'content',    630),
  ('social-media-manager', 'Social Media Manager',  'content',    640),
  -- Technical
  ('developer',            'Developer',             'technical',  710)
ON CONFLICT (slug) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- Tag -> discipline map
-- ---------------------------------------------------------------------------
-- Kept as a table rather than inlined in the backfill so that new signups
-- writing free-text tags can be mapped on the same rules, and so the
-- inferences are auditable and correctable without a code deploy.

CREATE TABLE IF NOT EXISTS public.tropical_tag_discipline_map (
  tag              text PRIMARY KEY,
  discipline_slug  text NOT NULL REFERENCES public.tropical_disciplines(slug) ON DELETE CASCADE
);

ALTER TABLE public.tropical_tag_discipline_map ENABLE ROW LEVEL SECURITY;

-- Dropped first so this file is re-runnable on its own, independent of the
-- blanket policy drop in 002.
DROP POLICY IF EXISTS "tropical_tag_discipline_map_read" ON public.tropical_tag_discipline_map;
CREATE POLICY "tropical_tag_discipline_map_read" ON public.tropical_tag_discipline_map
  FOR SELECT USING (true);

INSERT INTO public.tropical_tag_discipline_map (tag, discipline_slug) VALUES
  ('photographer','photographer'),
  ('event photography','photographer'),
  ('christian photography','photographer'),
  ('portrait photography','photographer'),
  ('portraits','photographer'),
  ('videographer','videographer'),
  ('filmmaker','filmmaker'),
  ('film and television','filmmaker'),
  ('director','filmmaker'),
  ('cinematographer','cinematographer'),
  ('cinematic','cinematographer'),
  ('video editor','video-editor'),
  ('color grading','colorist'),
  ('vfx artist','vfx-artist'),
  ('motion design','motion-designer'),
  ('creative director','creative-director'),
  ('creative strategy','creative-director'),
  ('art director','art-director'),
  ('producer','producer'),
  ('artist manager','producer'),
  ('project manager','project-manager'),
  ('branding','brand-strategist'),
  ('marketing','brand-strategist'),
  ('event designer','event-designer'),
  ('experience designer','event-designer'),
  ('event manager','event-manager'),
  ('event producer','event-manager'),
  ('events','event-manager'),
  ('singer','singer'),
  ('musician','musician'),
  ('rapper','musician'),
  ('songwriter','songwriter'),
  ('actor','actor'),
  ('voice actor','voice-actor'),
  ('model','model'),
  ('poet','poet'),
  ('spoken word','poet'),
  ('stylist','stylist'),
  ('fashion','stylist'),
  ('hair stylist','hair-stylist'),
  ('hairstylist','hair-stylist'),
  ('hairstyling','hair-stylist'),
  ('braiding','hair-stylist'),
  ('hair art','hair-stylist'),
  ('beauty','makeup-artist'),
  ('graphic designer','graphic-designer'),
  ('design','graphic-designer'),
  ('illustration','illustrator'),
  ('art','illustrator'),
  ('portrait artist','illustrator'),
  ('apparel design','apparel-designer'),
  ('merch design','apparel-designer'),
  ('copywriter','copywriter'),
  ('content writer','content-writer'),
  ('storyteller','content-writer'),
  ('content creator','content-creator'),
  ('vlog','content-creator'),
  ('food content','content-creator'),
  ('social media','content-creator'),
  ('social media manager','social-media-manager'),
  ('developer','developer')
ON CONFLICT (tag) DO UPDATE SET discipline_slug = EXCLUDED.discipline_slug;

-- Deliberately unmapped, for the record: captivating, community, creative,
-- faith, fitness, freelance, 'in person specialist', 'mental health',
-- professional, running, timeless, vibrant, worship. These describe vibe,
-- values or availability rather than a craft, and must not become disciplines.

COMMIT;
