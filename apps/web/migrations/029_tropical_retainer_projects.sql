-- ============================================================================
-- 029 — Retainer-only projects
-- ============================================================================
-- 027/028 let a retainer be ADDED to an existing project. This lets one exist
-- on its own, which is the shape a contractor platform actually needs: a
-- company engages one person on a monthly rate, and there is no pot, no crew,
-- and no split.
--
-- Two things stood in the way:
--
--   1. tropical_projects.budget CHECK (budget > 0). A retainer has no pot, and
--      inventing one — the first month's rate, an annualised guess — would put
--      a wrong number on every screen that shows a project's value.
--
--   2. tropical_create_project (007) requires role amounts to sum exactly to the
--      crew pool. With no pool, every retainer role fails that check.
--
-- So a project now declares which kind it is, and gets the rules that go with
-- it, rather than every project pretending to be a pot.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PROJECTS DECLARE THEIR KIND
-- ============================================================================

ALTER TABLE public.tropical_projects
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pot'
    CHECK (kind IN ('pot', 'retainer'));

COMMENT ON COLUMN public.tropical_projects.kind IS
  'pot: one budget split across roles, funded once by escrow. retainer: no pot; each role bills on its own schedule. Everything existing is a pot.';

-- Relaxed only for retainers. A POT project with a zero budget is still
-- nonsense and stays unrepresentable.
ALTER TABLE public.tropical_projects
  DROP CONSTRAINT IF EXISTS tropical_projects_budget_check;
ALTER TABLE public.tropical_projects
  ADD CONSTRAINT tropical_projects_budget_check CHECK (
    (kind = 'retainer' AND budget >= 0) OR (kind <> 'retainer' AND budget > 0)
  );

-- ============================================================================
-- 2. CREATE ONE
-- ============================================================================
-- Mirrors tropical_create_project's setup — membership, both structural
-- channels, a DM for the assignee — and drops everything that belongs to a
-- pot: no budget arithmetic, no escrow, no contract split.
--
-- Status goes straight to 'active'. A pot project waits in pending_payment
-- until escrow funds, because until then there is no money and the group
-- channel must stay shut (011:213). A retainer's money arrives per period
-- instead, and the first charge happens before the first period starts — so
-- there is nothing to wait for, and waiting would only mean the contractor
-- cannot talk to anyone on day one.
--
-- This is also the single place a retainer project's status is ever set. The
-- pay run never touches it. See the header of 027.

CREATE OR REPLACE FUNCTION public.tropical_create_retainer_project(
  p_name           text,
  p_brief          text,
  p_role_title     text,
  p_discipline     text,
  p_user           uuid,
  p_period         text,
  p_period_amount  bigint,
  p_starts         date,
  p_approval       text DEFAULT 'auto',
  p_ends           date DEFAULT NULL,
  p_visibility     text DEFAULT 'private'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_tenant  uuid;
  v_project uuid;
  v_role    uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('weekly', 'monthly') THEN
    RAISE EXCEPTION 'period must be weekly or monthly' USING ERRCODE = '22023';
  END IF;
  IF p_period_amount IS NULL OR p_period_amount <= 0 THEN
    RAISE EXCEPTION 'a retainer needs an amount per period' USING ERRCODE = '22023';
  END IF;
  IF p_starts IS NULL THEN
    RAISE EXCEPTION 'a retainer needs a start date' USING ERRCODE = '22023';
  END IF;

  -- The tenant the creator belongs to. A retainer created on a white-label
  -- must land in that white-label, and the column defaults to classic — which
  -- would quietly file a customer's engagement under TropicalTalent.
  SELECT m.tenant_id INTO v_tenant
  FROM public.tropical_tenant_members m
  WHERE m.user_id = v_user AND m.status = 'active'
  ORDER BY m.created_at
  LIMIT 1;

  INSERT INTO public.tropical_projects
    (brand_id, tenant_id, name, brief, budget, visibility, kind, status)
  VALUES
    (v_user, COALESCE(v_tenant, (SELECT id FROM public.tropical_tenants WHERE is_classic)),
     p_name, COALESCE(p_brief, ''), 0, p_visibility, 'retainer', 'active')
  RETURNING id INTO v_project;

  INSERT INTO public.tropical_project_members (project_id, user_id, member_role)
  VALUES (v_project, v_user, 'brand');

  INSERT INTO public.tropical_channels (project_id, type, name)
  VALUES (v_project, 'bot', 'Project Admin'), (v_project, 'group', 'Group Chat');

  INSERT INTO public.tropical_project_roles
    (project_id, title, discipline_slug, percentage, amount,
     assigned_user_id, status,
     pay_model, period, period_amount, approval, next_period_start, ends_at)
  VALUES
    (v_project, p_role_title, NULLIF(p_discipline, ''), 0, 0,
     p_user,
     CASE WHEN p_user IS NULL THEN 'open' ELSE 'invited' END,
     'recurring', p_period, p_period_amount, p_approval, p_starts, p_ends)
  RETURNING id INTO v_role;

  IF p_user IS NOT NULL THEN
    INSERT INTO public.tropical_channels (project_id, type, name, role_id)
    VALUES (v_project, 'dm', p_role_title, v_role);

    INSERT INTO public.tropical_project_members (project_id, user_id, member_role, role_id)
    VALUES (v_project, p_user, 'creative', v_role)
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;

  -- Schedule the first period immediately so the pay run has something to
  -- fund. Without this the engagement sits idle until the roll-forward pass
  -- happens to catch it, which on a start date inside the lead window is
  -- already too late to charge before the period begins.
  PERFORM public.tropical_schedule_period(v_role);

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, text, date, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, text, date, text) TO authenticated;

COMMIT;
