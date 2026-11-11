-- ============================================================================
-- 025 — Close the cross-tenant read surfaces
-- ============================================================================
-- 023/024 gave the schema a tenant dimension and put RLS on it. Two things sit
-- outside that boundary by construction and have to be closed by hand:
--
--   1. tropical_public_briefs — a view declared security_invoker = false, so it
--      runs as its owner and RLS on tropical_projects does not apply to it. It
--      is the sanctioned hole through the members-only policy, and it is
--      granted to anon. Without the predicate added below, every white-label's
--      brief feed is readable by every other tenant AND by the public.
--
--      This is the single highest-risk object in the schema for multi-tenancy,
--      and it cannot be fixed in modules/briefs/queries.ts: a filter in
--      TypeScript is not a boundary when the view bypasses RLS.
--
-- Storage buckets left public by the predecessor app are handled separately,
-- in 026. They are deliberately NOT in this transaction: storage.buckets is
-- owned by supabase_storage_admin, so an UPDATE against it can fail on
-- permissions depending on which role runs the migration — and if it did, it
-- would roll back the briefs fix above with it. The critical change must not
-- be hostage to the cosmetic one.
--
-- NOT changed here: tropical_my_applications (011:239). It is also
-- security_invoker = false, but its WHERE clause is already
-- `a.user_id = (SELECT auth.uid())` — you can only ever see your own
-- applications, which is inherently tenant-safe. It is granted to
-- authenticated only, never anon. Left alone deliberately rather than churned.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. THE BRIEFS FEED
-- ============================================================================
-- Identical projection to 002:287 — same columns, same money discipline (total
-- pot and role titles, never the per-role split) — plus tenant_id, plus the
-- membership predicate.
--
-- auth.uid() reads the request's JWT claim, not the current database role, so
-- it still resolves correctly inside a security_invoker = false view. That is
-- what makes the predicate work here at all.

-- DROP then CREATE, not CREATE OR REPLACE: replacing a view may only APPEND
-- columns, and tenant_id belongs next to brand_id rather than bolted on the
-- end. 011:237 does the same thing to tropical_my_applications for the same
-- reason. Dropping discards the view's grants, which are re-issued below.
DROP VIEW IF EXISTS public.tropical_public_briefs;

CREATE VIEW public.tropical_public_briefs
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.brand_id,
  p.tenant_id,
  p.name,
  p.brief,
  p.budget,
  p.currency,
  p.status,
  p.deadline_date,
  p.created_at,
  u.username     AS brand_username,
  u.avatar       AS brand_avatar,
  u.name         AS brand_name,
  (SELECT count(*) FROM public.tropical_project_roles r WHERE r.project_id = p.id)
    AS total_roles,
  (SELECT count(*) FROM public.tropical_project_roles r
    WHERE r.project_id = p.id AND r.status = 'open')
    AS open_roles,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id',         r.id,
             'title',      r.title,
             'discipline', r.discipline_slug,
             'status',     r.status
           ) ORDER BY r.sort_order)
    FROM public.tropical_project_roles r
    WHERE r.project_id = p.id
  ), '[]'::jsonb) AS roles
FROM public.tropical_projects p
JOIN public.users u ON u.id = p.brand_id
WHERE p.visibility IN ('public', 'both')
  AND p.status IN ('pending_payment', 'active')
  -- The tenant boundary. A signed-out caller has no auth.uid(), so this
  -- subquery is empty and the feed returns nothing — which is the correct
  -- answer now that the anon grant is gone.
  AND p.tenant_id IN (
    SELECT m.tenant_id
    FROM public.tropical_tenant_members m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.status  = 'active'
  );

COMMENT ON VIEW public.tropical_public_briefs IS
  'Briefs feed, scoped to the caller''s tenants. Total budget and role titles only — never the per-role split. security_invoker = false is the mechanism, so the tenant predicate lives in the WHERE clause and not in RLS.';

-- ---------------------------------------------------------------------------
-- Drop the anon grant
-- ---------------------------------------------------------------------------
-- 002:325 granted SELECT to anon as well as authenticated. Nothing shipping
-- reads this view unauthenticated — /briefs sits behind proxy.ts's gate and
-- calls it as the signed-in user — so the grant bought nothing and, under
-- tenancy, is a way to enumerate every tenant's briefs without an account.
-- The predicate above already returns nothing for anon; withholding the grant
-- as well means two independent things have to fail before anything leaks.
--
-- The DROP above already discarded every grant, so the REVOKE is belt-and-
-- braces against this file being edited later to use CREATE OR REPLACE.
REVOKE SELECT ON public.tropical_public_briefs FROM anon;
GRANT  SELECT ON public.tropical_public_briefs TO   authenticated;

COMMIT;

-- Verification after applying:
--   npm run verify
--   -- as a signed-in creative, the feed still returns their own tenant's briefs
--   -- as anon, GET /rest/v1/tropical_public_briefs returns 401/empty
