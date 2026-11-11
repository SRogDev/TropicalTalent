-- ============================================================================
-- 033 — Reconcile users.role with the capabilities that actually apply
-- ============================================================================
-- Two records of the same fact were allowed to drift apart.
--
-- `users.role` is what someone picked on the sign-up form.
-- `tropical_tenant_members.capabilities` is what they may actually do.
--
-- An invite overrides the form — deliberately, and 031 says why: the terms are
-- "frozen at invite time rather than derived at sign-up from the archetype"
-- because "the person building [the roster] knows which is which". But nothing
-- then updated users.role, so someone on a roster as a worker who chose
-- "I'm a Company" at sign-up ended up as:
--
--     users.role                 = 'brand'
--     membership.capabilities    = {"brand": false, "work": true}
--
-- and different surfaces read different columns. The sidebar calls them a
-- Creative (it reads capabilities), the Talent search excludes them (it reads
-- users.role), and their profile disagrees with both.
--
-- writeProfile() in modules/identity/actions.ts now derives the role from the
-- capabilities at sign-up, so new accounts cannot land in this state. This
-- repairs the ones already in it.
--
-- ---------------------------------------------------------------------------
-- Deliberately narrow
-- ---------------------------------------------------------------------------
-- Only rows where the answer is unambiguous:
--
--   * exactly ONE active membership. `users.role` is a single global column
--     and a person in two tenants with opposite capabilities has no single
--     right answer — that is a structural limitation of reading a per-tenant
--     fact out of a global table, not something an UPDATE can resolve.
--   * exactly one capability set. {brand,work} both true is the classic TropicalTalent
--     shape, where a creative hires as well as works and the two are genuinely
--     independent; those rows are left exactly as they are.
--   * never an admin. users.role = 'admin' is the TropicalTalent super admin and is
--     hand-promoted; nothing here may grant or revoke it.
--
-- Consequently this is a no-op on the classic tenant. 023's backfill gave every
-- existing account {brand: true, work: role IS DISTINCT FROM 'brand'}, so
-- classic creatives hold both capabilities (skipped) and classic brands hold
-- brand-only, which already agrees with their role.
-- ============================================================================

BEGIN;

WITH sole_membership AS (
  SELECT
    m.user_id,
    -- COALESCE, not a bare cast: an absent key yields NULL, and NULL would make
    -- every comparison below unknown and quietly match nothing. Absent reads as
    -- false, the same rule findMembership() applies in identity/queries.ts.
    COALESCE((m.capabilities->>'brand')::boolean, false) AS may_brand,
    COALESCE((m.capabilities->>'work')::boolean, false)  AS may_work
  FROM public.tropical_tenant_members m
  WHERE m.status = 'active'
    -- Exactly one active membership, so there is a single right answer.
    AND (
      SELECT count(*)
      FROM public.tropical_tenant_members m2
      WHERE m2.user_id = m.user_id AND m2.status = 'active'
    ) = 1
),
resolved AS (
  SELECT
    s.user_id,
    CASE
      WHEN s.may_brand AND NOT s.may_work THEN 'brand'
      WHEN s.may_work  AND NOT s.may_brand THEN 'creative'
    END AS should_be
  FROM sole_membership s
)
UPDATE public.users u
SET role = r.should_be
FROM resolved r
WHERE u.id = r.user_id
  -- NULL means both capabilities or neither: nothing to reconcile against.
  AND r.should_be IS NOT NULL
  AND u.role IS DISTINCT FROM r.should_be
  -- Never touch a super admin. Hand-promoted, and not a marketplace side.
  AND u.role <> 'admin';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Nothing should come back after this runs:
--
--   SELECT u.id, u.role, m.capabilities, t.slug
--   FROM public.users u
--   JOIN public.tropical_tenant_members m ON m.user_id = u.id AND m.status = 'active'
--   JOIN public.tropical_tenants t ON t.id = m.tenant_id
--   WHERE u.role <> 'admin'
--     AND (
--       ((m.capabilities->>'brand')::boolean AND NOT (m.capabilities->>'work')::boolean
--          AND u.role <> 'brand')
--       OR
--       ((m.capabilities->>'work')::boolean AND NOT (m.capabilities->>'brand')::boolean
--          AND u.role <> 'creative')
--     )
--     AND (SELECT count(*) FROM public.tropical_tenant_members m2
--          WHERE m2.user_id = u.id AND m2.status = 'active') = 1;
--
-- If a specific person was invited as the wrong SIDE — the roster's worker/payer
-- toggle defaults to worker — the invite itself is what to correct, then their
-- membership. Changing users.role alone would only recreate the drift:
--
--   UPDATE public.tropical_tenant_members
--   SET capabilities = '{"brand": true, "work": false}'::jsonb
--   WHERE user_id = '<uuid>' AND tenant_id = '<uuid>';
--
--   UPDATE public.users SET role = 'brand' WHERE id = '<uuid>';
