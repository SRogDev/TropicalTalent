-- ============================================================================
-- 051 — Cubora providers (Phase 2)
-- ============================================================================
-- One provider profile per account, individual or business. A provider may
-- hold many offers (migration 052). This table is the Cubora replacement for
-- the split legacy profile shape (creative_data for talent, brand_data for
-- consumers): it carries the fields the plan requires for BOTH sides —
-- identity/business info, description, location, languages, verification
-- status, documentation refs (plan §6, spec S37).
--
-- Verification is NOT self-asserted. `verification_status` and the audit
-- columns below are written ONLY by the admin/ops verification actions
-- (modules/catalog/actions.ts, behind requireAdminScope() + adminDb()).
-- That rule is enforced twice: the action layer never touches those columns
-- from a provider-side call, AND the trigger at the bottom of this file
-- raises if an `authenticated` role tries to change them. Provider-side
-- writes go through RLS as `authenticated`; ops writes go through the
-- service-role client as `service_role`, which the trigger allows.
-- Spec OPEN O6 (what "verified" means) is still unanswered: until Roger
-- answers it, the workflow records evidence and a human decision, and
-- nothing in this migration defines what evidence is sufficient.
--
-- Additive only: no ALTER / DROP against any pre-existing table. FKs
-- reference public.users(id) for referential integrity, as 001 does.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_providers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- individual = a person offering their own work; business = a company,
  -- cooperative, or other legal entity offering work, services, or goods.
  kind                 text NOT NULL DEFAULT 'individual'
                       CHECK (kind IN ('individual', 'business')),
  display_name         text NOT NULL,
  legal_name           text,
  description          text NOT NULL DEFAULT '',
  -- Free-text location. The legacy locations table is UK-flavoured and has
  -- no Cuba content; a structured location model is Phase 5 geography work.
  city                 text,
  country              text NOT NULL DEFAULT 'Cuba',
  languages            text[] NOT NULL DEFAULT '{}',
  -- Verification. Default pending; only the admin verification flow moves
  -- it. See the header note — never set from a provider-side action.
  verification_status  text NOT NULL DEFAULT 'pending'
                       CHECK (verification_status IN ('pending', 'in_review', 'verified', 'rejected')),
  verified_at          timestamptz,
  verified_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verification_notes   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_providers_user_unique UNIQUE (user_id)
);

COMMENT ON TABLE public.tropical_providers IS
  'Cubora provider profiles (Phase 2). One per account; individual or business. verification_status is written only by the admin/ops verification flow, never by the provider.';
COMMENT ON COLUMN public.tropical_providers.verification_status IS
  'pending | in_review | verified | rejected. Set only via the admin verification actions. Spec OPEN O6: what counts as verified is still undecided.';
COMMENT ON COLUMN public.tropical_providers.languages IS
  'Languages the provider works in (ISO 639-1 codes, e.g. es, en). Plan §11 / spec S57.';

CREATE INDEX IF NOT EXISTS idx_tropical_providers_user
  ON public.tropical_providers (user_id);
CREATE INDEX IF NOT EXISTS idx_tropical_providers_verification
  ON public.tropical_providers (verification_status);

-- ---------------------------------------------------------------------------
-- Verification evidence / audit trail
-- ---------------------------------------------------------------------------
-- Every verification decision records what was seen and who decided it.
-- `reference` is a storage path or an external identifier, never a secret;
-- documents themselves live in Supabase Storage, not in this table.
-- `offer_id` is added by 052 (offers do not exist yet at this point in the
-- migration order); it is NULL for provider-level evidence and set for
-- offer-level evidence (e.g. origin proof for a Made in Cuba product).
CREATE TABLE IF NOT EXISTS public.tropical_verification_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES public.tropical_providers(id) ON DELETE CASCADE,
  -- document | note | status_change
  kind           text NOT NULL DEFAULT 'note'
                 CHECK (kind IN ('document', 'note', 'status_change')),
  reference      text,
  note           text NOT NULL DEFAULT '',
  -- The verification status that resulted from this event, if any.
  status_after   text CHECK (status_after IN ('pending', 'in_review', 'verified', 'rejected')),
  recorded_by    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_verification_events IS
  'Audit trail for supplier verification (Phase 2, internal onboarding). One row per evidence item or status decision. Never written by the provider.';

CREATE INDEX IF NOT EXISTS idx_tropical_verification_events_provider
  ON public.tropical_verification_events (provider_id, created_at DESC);

-- ============================================================================
-- RLS — follows the pattern of 002
-- ============================================================================
-- * A provider reads and writes only their own row. They can never read
--   another provider's verification notes.
-- * Any signed-in user may read a VERIFIED provider (discovery needs it);
--   pending/in_review/rejected providers are visible only to themselves
--   and to ops (adminDb).
-- * Verification events are readable only by the provider they concern;
--   they are never insertable through RLS (adminDb only).
-- * The trigger below is the second half of the verification rule: RLS
--   alone cannot stop a row's owner from changing a column, so the trigger
--   blocks verification-field changes from the `authenticated` role.
-- ============================================================================

ALTER TABLE public.tropical_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_verification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tropical_providers_read" ON public.tropical_providers;
CREATE POLICY "tropical_providers_read" ON public.tropical_providers
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR verification_status = 'verified'
  );

DROP POLICY IF EXISTS "tropical_providers_insert_own" ON public.tropical_providers;
CREATE POLICY "tropical_providers_insert_own" ON public.tropical_providers
  FOR INSERT WITH CHECK (
    user_id = (SELECT auth.uid())
    AND verification_status = 'pending'
  );

DROP POLICY IF EXISTS "tropical_providers_update_own" ON public.tropical_providers;
CREATE POLICY "tropical_providers_update_own" ON public.tropical_providers
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "tropical_verification_events_read_own" ON public.tropical_verification_events;
CREATE POLICY "tropical_verification_events_read_own" ON public.tropical_verification_events
  FOR SELECT USING (
    provider_id IN (
      SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Trigger: verification fields are ops-only
-- ---------------------------------------------------------------------------
-- PostgREST runs provider-side writes as role `authenticated` and
-- service-role writes as role `service_role`. A provider UPDATE that
-- touches any verification field is rejected here even if it passed RLS,
-- so the "never self-asserted" rule holds at the database, not just in
-- the action layer. Ops writes (service_role) pass through.
CREATE OR REPLACE FUNCTION public.tropical_providers_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated'
    AND (
      NEW.verification_status IS DISTINCT FROM OLD.verification_status
      OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
      OR NEW.verification_notes IS DISTINCT FROM OLD.verification_notes
    ) THEN
    RAISE EXCEPTION 'verification fields are set by Cubora operations only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_providers_guard_verification ON public.tropical_providers;
CREATE TRIGGER tropical_providers_guard_verification
  BEFORE UPDATE ON public.tropical_providers
  FOR EACH ROW EXECUTE FUNCTION public.tropical_providers_guard_verification();

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT count(*) FROM public.tropical_providers;
--   SELECT count(*) FROM public.tropical_verification_events;
--   -- As the provider role: an UPDATE that sets verification_status must fail
--   -- with 'verification fields are set by Cubora operations only'.
--   -- As ops (service role): set verification_status + insert an event row.
