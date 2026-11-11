-- ============================================================================
-- 037 — A vocabulary for work that isn't a photoshoot
-- ============================================================================
-- 003 seeded 34 disciplines, 33 of which are creative-industry. The single
-- technical entry is 'developer'.
--
-- That is fine for a marketplace of film crews and stylists, and wrong for the
-- contractor white-labels the product now sells to. A company typing "full
-- stack project" into the brief composer matched no template, fell through to
-- brief-split's fallback, and was confidently offered a Creative Director, a
-- Photographer and a Content Creator. There was no better answer available:
-- the vocabulary had nothing to propose.
--
-- These are the roles a software or web build is actually staffed with, kept
-- deliberately short. A taxonomy earns its keep by being the words people
-- search for, not by being complete — 'developer' stays as the general term
-- for anyone who does not want to pick a side.
--
-- Categories: 'technical' already exists (003 put 'developer' there), and
-- 'product' is new, for the design and delivery roles that sit beside a build
-- without being visual-arts disciplines.
--
-- sort_order continues from 003's last block. ON CONFLICT DO NOTHING so this
-- is safe on every re-run of apply.mjs, and so a slug someone has already
-- created by hand through the team builder's "add a role" keeps its label.
-- ============================================================================

BEGIN;

INSERT INTO public.tropical_disciplines (slug, label, category, sort_order) VALUES
  -- Engineering
  ('full-stack-developer',  'Full Stack Developer',  'technical',  510),
  ('frontend-developer',    'Frontend Developer',    'technical',  520),
  ('backend-developer',     'Backend Developer',     'technical',  530),
  ('mobile-developer',      'Mobile Developer',      'technical',  540),
  ('devops-engineer',       'DevOps Engineer',       'technical',  550),
  ('data-engineer',         'Data Engineer',         'technical',  560),
  ('qa-engineer',           'QA Engineer',           'technical',  570),
  -- Product & delivery
  ('product-designer',      'Product Designer',      'product',    610),
  ('ux-designer',           'UX Designer',           'product',    620),
  ('ui-designer',           'UI Designer',           'product',    630),
  ('product-manager',       'Product Manager',       'product',    640),
  ('technical-writer',      'Technical Writer',      'product',    650)
ON CONFLICT (slug) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT category, count(*) FROM public.tropical_disciplines GROUP BY category;
--
-- The matching side of this lives in modules/projects/brief-split.ts, which
-- gains 'software' and 'web' templates pointing at these slugs. Adding the
-- vocabulary without the templates would leave the composer still proposing a
-- photographer for a software build.
