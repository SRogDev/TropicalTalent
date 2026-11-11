-- ============================================================================
-- 049 — An archived project leaves the briefs feed
-- ============================================================================
-- 045 made deletion a soft delete: archived_at is stamped, the projects SELECT
-- policy hides the row, and tropical_is_member / tropical_is_brand return false
-- for it so every child table closes with it. That covered every read that
-- goes through RLS.
--
-- Two reads do not. tropical_public_briefs (the Discover feed) and
-- tropical_my_applications (a creative's own applications) are both declared
-- security_invoker = false — deliberately, because an applicant is not a
-- member and members-only RLS would show them nothing. The cost of bypassing
-- RLS is that every predicate RLS would have applied has to be written into
-- the view's own WHERE clause, and 045 added its predicate to the policy but
-- not to the views. So a brand deleted a brief and every other account kept
-- seeing it on Discover, could still apply to it, and the application landed
-- on a project nobody could open.
--
-- Both views are re-created verbatim from their last definition (025 and 011)
-- with the one missing clause. DROP + CREATE rather than CREATE OR REPLACE, as
-- 025 does, so the grants are re-stated explicitly below and anon does not
-- quietly regain SELECT.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- tropical_public_briefs — 025's body, plus archived_at IS NULL
-- ---------------------------------------------------------------------------

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
  -- 045's soft delete. The policy on tropical_projects has this clause; a view
  -- that bypasses the policy has to carry it itself.
  AND p.archived_at IS NULL
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
  'Briefs feed, scoped to the caller''s tenants and excluding archived projects. Total budget and role titles only — never the per-role split. security_invoker = false is the mechanism, so the tenant and archive predicates live in the WHERE clause and not in RLS.';

REVOKE SELECT ON public.tropical_public_briefs FROM anon;
GRANT  SELECT ON public.tropical_public_briefs TO   authenticated;

-- ---------------------------------------------------------------------------
-- tropical_my_applications — 011's body, plus archived_at IS NULL
-- ---------------------------------------------------------------------------
-- An application to a project that no longer exists is not something the
-- creative can act on, and the card would link to a project RLS now hides.

DROP VIEW IF EXISTS public.tropical_my_applications;

CREATE VIEW public.tropical_my_applications
WITH (security_invoker = false) AS
SELECT
  a.id,
  a.user_id,
  a.status,
  a.created_at,
  a.note,
  a.required_discipline,
  p.id            AS project_id,
  p.name          AS project_name,
  p.brief         AS project_brief,
  p.status        AS project_status,
  p.deadline_date AS project_deadline,
  u.name          AS brand_name,
  u.username      AS brand_username,
  u.avatar        AS brand_avatar,
  r.id            AS role_id,
  r.title         AS role_title,
  r.status        AS role_status
FROM public.tropical_applications a
JOIN public.tropical_projects     p ON p.id = a.project_id
JOIN public.tropical_project_roles r ON r.id = a.role_id
JOIN public.users               u ON u.id = p.brand_id
WHERE a.user_id = (SELECT auth.uid())
  AND p.archived_at IS NULL;

COMMENT ON VIEW public.tropical_my_applications IS
  'A creative''s own applications with the job attached, excluding archived projects. Carries no percentage or amount — an applicant is not a member and must not see the split.';

GRANT SELECT ON public.tropical_my_applications TO authenticated;

COMMIT;
