-- ============================================================================
-- 036 — A tenant's people are private unless its owner says otherwise
-- ============================================================================
-- The missing half of tenancy. 023-025 made a tenant's DATA private — its
-- projects, briefs and rosters are invisible across the boundary, and 025's
-- RLS is what enforces it. What was never modelled is whether the tenant's
-- PEOPLE are also part of classic TropicalTalent.
--
-- Until now the answer was "always yes", by accident rather than by design:
-- 023's backfill re-ran on every `npm run migrate` and granted a classic
-- membership to every account in the database (see the note there). A
-- contractor who only ever signed up on a customer's branded site turned up in
-- classic's Talent board, and could be hired into classic projects.
--
-- Visibility makes that a decision instead of a side effect:
--
--   private  the default, and what a white-label customer expects. Its people
--            exist only inside it. Signing in to classic TropicalTalent with that
--            account gets /auth/no-access — joining TropicalTalent means opening a
--            TropicalTalent account, which is the honest answer for a workforce the
--            customer onboarded themselves.
--   public   the tenant's people are ALSO classic members, so they appear on
--            TropicalTalent's Talent board and can work on TropicalTalent projects. A deliberate
--            choice for a partner who wants their roster to reach the wider
--            marketplace.
--
-- Default private, because the failure directions are not symmetrical: a
-- private tenant wrongly made public leaks a customer's roster to a public
-- marketplace, and a public one wrongly kept private is a support ticket.
--
-- Classic itself is public. It is the marketplace the flag is describing.
--
-- NOTE: this migration adds the COLUMN and the default only. It deliberately
-- does not delete anybody's existing classic membership — that decides who can
-- still log in where, and is done from the console with the affected accounts
-- named, not silently by a migration nobody watches.
-- ============================================================================

BEGIN;

ALTER TABLE public.tropical_tenants
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tropical_tenants_visibility_check'
  ) THEN
    ALTER TABLE public.tropical_tenants
      ADD CONSTRAINT tropical_tenants_visibility_check
      CHECK (visibility IN ('private', 'public'));
  END IF;
END $$;

-- Classic is the marketplace, not a customer's private workspace.
UPDATE public.tropical_tenants SET visibility = 'public' WHERE is_classic;

COMMENT ON COLUMN public.tropical_tenants.visibility IS
  'private: this tenant''s people are members of it alone, and cannot sign in to classic TropicalTalent. public: they are also classic members and appear on the TropicalTalent Talent board. Set at tenant creation; changing it later does not retroactively add or remove memberships.';

-- ---------------------------------------------------------------------------
-- Who is a classic member who should not be
-- ---------------------------------------------------------------------------
-- A view rather than a DELETE, for the reason in the header: this names people
-- who would lose access to classic TropicalTalent, and that is a decision to take with
-- the list in front of you.
--
-- "Should not be" means: a member of classic, a member of at least one PRIVATE
-- white-label, and with nothing of their own on classic — no project they own,
-- no membership of a classic project, and no balance history. Someone who has
-- actually worked or hired on TropicalTalent is a real TropicalTalent account regardless of where
-- else they belong, and is excluded.

CREATE OR REPLACE VIEW public.tropical_misplaced_classic_members AS
SELECT
  u.id            AS user_id,
  u.username,
  u.role,
  cm.created_at   AS classic_member_since,
  cm.capabilities AS classic_capabilities,
  array_agg(DISTINCT wt.slug) AS private_tenants
FROM public.users u
JOIN public.tropical_tenant_members cm ON cm.user_id = u.id
JOIN public.tropical_tenants ct       ON ct.id = cm.tenant_id AND ct.is_classic
JOIN public.tropical_tenant_members wm ON wm.user_id = u.id
JOIN public.tropical_tenants wt        ON wt.id = wm.tenant_id
                                    AND NOT wt.is_classic
                                    AND wt.visibility = 'private'
WHERE NOT EXISTS (
        SELECT 1 FROM public.tropical_projects p
        WHERE p.brand_id = u.id AND p.tenant_id = ct.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.tropical_project_members pm
        JOIN public.tropical_projects p2 ON p2.id = pm.project_id AND p2.tenant_id = ct.id
        WHERE pm.user_id = u.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.tropical_balance_transactions bt WHERE bt.user_id = u.id)
GROUP BY u.id, u.username, u.role, cm.created_at, cm.capabilities;

REVOKE ALL ON public.tropical_misplaced_classic_members FROM public, authenticated, anon;
GRANT SELECT ON public.tropical_misplaced_classic_members TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT * FROM public.tropical_misplaced_classic_members;
--
-- Every row is an account that would lose access to classic TropicalTalent if its
-- classic membership were removed. Nothing here removes one.
