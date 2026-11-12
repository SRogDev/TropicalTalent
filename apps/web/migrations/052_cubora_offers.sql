-- ============================================================================
-- 052 — Cubora unified offers (Phase 2)
-- ============================================================================
-- One catalog, three categories (plan §3, spec S13): talent, services,
-- products & production. One provider holds many offers. Category-specific
-- detail lives in `attributes` (jsonb, shape per category documented in
-- docs/architecture/data-model.md); everything the catalog filters on
-- (category, skills, location, availability, verification, Made in Cuba)
-- is a typed column so it is filterable in SQL.
--
-- Made in Cuba: `made_in_cuba` is set ONLY by the admin/ops verification
-- flow (same trigger rule as 051), and the CHECK below forbids the seal
-- without verified origin. Origin verification is separate from quality
-- certification (plan §2, spec S11): nothing in this table is a quality
-- claim. Spec OPEN O6 still governs what "verified" means.
--
-- Never imply export/payment/delivery (plan §7, spec S42): no column here
-- promises any of those. `availability_status` describes the provider's
-- stated availability only.
--
-- Additive only. Also adds the offer_id link to the 051 verification-events
-- table, which could not reference this table before it existed.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_offers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          uuid NOT NULL REFERENCES public.tropical_providers(id) ON DELETE CASCADE,
  -- The three principal categories (plan §3). "products" covers physical
  -- goods AND producers/production capacity — a producer's offer describes
  -- what they can produce, with capacity in production_capacity.
  category             text NOT NULL
                       CHECK (category IN ('talent', 'services', 'products')),
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'published', 'archived')),
  title                text NOT NULL,
  description          text NOT NULL DEFAULT '',
  -- Searchable, category-crossing fields.
  skills               text[] NOT NULL DEFAULT '{}',
  languages            text[] NOT NULL DEFAULT '{}',
  city                 text,
  country              text NOT NULL DEFAULT 'Cuba',
  availability_status  text NOT NULL DEFAULT 'available'
                       CHECK (availability_status IN ('available', 'limited', 'unavailable')),
  -- Products & production: stock / capacity. NULL means "not applicable"
  -- (talent/services) or "unstated" — never invent a number.
  quantity_available   integer CHECK (quantity_available IS NULL OR quantity_available >= 0),
  quantity_unit        text,
  -- e.g. {"monthly_amount": 500, "unit": "kg", "lead_time_days": 14}.
  -- NULL = unstated, not zero.
  production_capacity  jsonb,
  -- Pricing basis, not a promise: hour | project | unit | quote.
  -- `quote` means "price on request". Amount is NULL for quote.
  pricing_basis        text NOT NULL DEFAULT 'quote'
                       CHECK (pricing_basis IN ('hour', 'project', 'unit', 'quote')),
  price_amount         numeric(12, 2) CHECK (price_amount IS NULL OR price_amount >= 0),
  price_currency       text NOT NULL DEFAULT 'USD',
  -- Origin & verification. `made_in_cuba` is ops-only (trigger below) and
  -- requires origin_verified (CHECK below). Neither is a quality claim.
  origin_country       text,
  origin_verified      boolean NOT NULL DEFAULT false,
  made_in_cuba         boolean NOT NULL DEFAULT false,
  verification_status  text NOT NULL DEFAULT 'pending'
                       CHECK (verification_status IN ('pending', 'in_review', 'verified', 'rejected')),
  -- Category-specific attributes (see data-model.md for the shape per
  -- category). Free-form by design: the categories evolve faster than the
  -- schema should.
  attributes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When the offer was last indexed for semantic search (Pinecone). NULL =
  -- never indexed. Written by the indexing seam, not by the provider.
  search_indexed_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_offers_made_in_cuba_needs_origin
    CHECK (NOT made_in_cuba OR origin_verified)
);

COMMENT ON TABLE public.tropical_offers IS
  'Cubora unified catalog (Phase 2). Three categories: talent, services, products (& production). made_in_cuba is ops-only and requires origin_verified; it is an origin seal, never a quality claim.';
COMMENT ON COLUMN public.tropical_offers.attributes IS
  'Category-specific detail as JSON. Shapes per category are documented in docs/architecture/data-model.md; never invent fields the provider did not supply.';
COMMENT ON COLUMN public.tropical_offers.search_indexed_at IS
  'Last semantic-search indexing time (Pinecone). NULL = never indexed. Offer-level indexing lands in Phase 3; until then the web semantic path searches talent profiles via the AI /search endpoint.';

CREATE INDEX IF NOT EXISTS idx_tropical_offers_provider
  ON public.tropical_offers (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_offers_catalog
  ON public.tropical_offers (category, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_offers_skills
  ON public.tropical_offers USING gin (skills);
CREATE INDEX IF NOT EXISTS idx_tropical_offers_made_in_cuba
  ON public.tropical_offers (made_in_cuba)
  WHERE status = 'published' AND made_in_cuba = true;

-- Offer link on the 051 verification-events table.
ALTER TABLE public.tropical_verification_events
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.tropical_offers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tropical_verification_events_offer
  ON public.tropical_verification_events (offer_id, created_at DESC)
  WHERE offer_id IS NOT NULL;

-- ============================================================================
-- RLS — follows the pattern of 002 / 051
-- ============================================================================
-- * Published offers are readable by any signed-in user (the catalog is
--   the discovery surface). Drafts and archived offers are visible only
--   to their provider and to ops.
-- * A provider writes only their own offers. The trigger below blocks the
--   verification/seal fields from provider-side writes, as in 051.
-- * `search_indexed_at` is written by the indexing seam through adminDb.
-- ============================================================================

ALTER TABLE public.tropical_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tropical_offers_read" ON public.tropical_offers;
CREATE POLICY "tropical_offers_read" ON public.tropical_offers
  FOR SELECT USING (
    status = 'published'
    OR provider_id IN (
      SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "tropical_offers_insert_own" ON public.tropical_offers;
CREATE POLICY "tropical_offers_insert_own" ON public.tropical_offers
  FOR INSERT WITH CHECK (
    provider_id IN (
      SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
    )
    AND verification_status = 'pending'
    AND origin_verified = false
    AND made_in_cuba = false
  );

DROP POLICY IF EXISTS "tropical_offers_update_own" ON public.tropical_offers;
CREATE POLICY "tropical_offers_update_own" ON public.tropical_offers
  FOR UPDATE USING (
    provider_id IN (
      SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    provider_id IN (
      SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "tropical_offers_delete_own" ON public.tropical_offers;
CREATE POLICY "tropical_offers_delete_own" ON public.tropical_offers
  FOR DELETE USING (
    provider_id IN (
      SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Trigger: verification / seal fields are ops-only (same rule as 051)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_offers_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated'
    AND (
      NEW.origin_verified IS DISTINCT FROM OLD.origin_verified
      OR NEW.made_in_cuba IS DISTINCT FROM OLD.made_in_cuba
      OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
      OR NEW.search_indexed_at IS DISTINCT FROM OLD.search_indexed_at
    ) THEN
    RAISE EXCEPTION 'origin, seal, verification and indexing fields are set by Cubora operations only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_offers_guard_verification ON public.tropical_offers;
CREATE TRIGGER tropical_offers_guard_verification
  BEFORE UPDATE ON public.tropical_offers
  FOR EACH ROW EXECUTE FUNCTION public.tropical_offers_guard_verification();

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT count(*) FROM public.tropical_offers;
--   -- As the provider role: INSERT with made_in_cuba = true must fail (RLS),
--   -- and UPDATE setting made_in_cuba must fail (trigger).
--   -- As ops (service role): set origin_verified + made_in_cuba on a product
--   -- offer, and confirm the CHECK rejects made_in_cuba without origin.
