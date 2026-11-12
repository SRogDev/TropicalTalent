-- ============================================================================
-- 054 — Taxonomy re-seed: tech / marketing / products & production first
-- ============================================================================
-- Cubora sells tech, marketing, products, and production capacity first
-- (plan §3, §13); the inherited taxonomy is film/music-first (003) with a
-- technical graft (037). This migration re-seeds the vocabulary so the
-- primary categories sort first in every picker and filter that orders by
-- sort_order (modules/skills/queries.ts).
--
-- NO rows are deleted. Existing disciplines keep their slugs, labels, and
-- relative order; only their sort_order shifts by +1000 to make room at the
-- top. New rows are inserted with ON CONFLICT DO NOTHING (037's pattern),
-- so a slug someone already created by hand keeps its label.
--
-- New categories: 'marketing' and 'production'. Tech rows reuse the
-- existing 'technical' category (003/037). 'production' covers producers
-- and production roles — the people behind the Products & Production
-- catalog category — not the film 'producer' already in 'direction'.
-- ============================================================================

BEGIN;

-- Make room at the top. Relative order of everything already seeded is
-- unchanged; only the absolute numbers move.
UPDATE public.tropical_disciplines
SET sort_order = sort_order + 1000;

INSERT INTO public.tropical_disciplines (slug, label, category, sort_order) VALUES
  -- Tech — the 'technical' category already exists (003/037)
  ('ai-engineer',           'AI Engineer',            'technical',  10),
  ('ml-engineer',           'ML Engineer',            'technical',  20),
  ('data-scientist',        'Data Scientist',         'technical',  30),
  ('data-analyst',          'Data Analyst',           'technical',  40),
  ('ai-product-engineer',   'AI Product Engineer',    'technical',  50),
  ('automation-engineer',   'Automation Engineer',    'technical',  60),
  -- Marketing
  ('digital-marketer',      'Digital Marketer',       'marketing', 110),
  ('growth-marketer',       'Growth Marketer',        'marketing', 120),
  ('performance-marketer',  'Performance Marketer',   'marketing', 130),
  ('seo-specialist',        'SEO Specialist',         'marketing', 140),
  ('content-strategist',    'Content Strategist',     'marketing', 150),
  ('brand-manager',         'Brand Manager',          'marketing', 160),
  ('email-marketer',        'Email Marketer',         'marketing', 170),
  ('social-media-strategist','Social Media Strategist','marketing', 180),
  -- Products & production — the people behind the catalog's third category
  ('agricultural-producer', 'Agricultural Producer',  'production', 210),
  ('food-producer',         'Food Producer',          'production', 220),
  ('artisan-producer',      'Artisan Producer',       'production', 230),
  ('manufacturer',          'Manufacturer',           'production', 240),
  ('production-manager',    'Production Manager',     'production', 250),
  ('quality-controller',    'Quality Controller',     'production', 260),
  ('export-manager',        'Export Manager',         'production', 270),
  ('supply-chain-coordinator','Supply Chain Coordinator','production',280)
ON CONFLICT (slug) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT category, count(*) FROM public.tropical_disciplines GROUP BY category;
--   -- Expect: technical +6, marketing 8, production 8; every pre-existing
--   -- category still present with the same row count, sort_order +1000.
--   SELECT slug, sort_order FROM public.tropical_disciplines
--     WHERE sort_order < 1000 ORDER BY sort_order;
--   -- Expect exactly the 22 rows above, tech first, then marketing, then production.
