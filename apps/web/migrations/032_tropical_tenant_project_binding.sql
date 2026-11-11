-- ============================================================================
-- 032 — Bind project creation to the tenant that served the request
-- ============================================================================
-- 023 added tropical_projects.tenant_id and gave it a DEFAULT pointing at the
-- classic tenant, with a comment saying so out loud:
--
--   "It is a migration-window crutch, not the end state. When
--    tropical_create_project is rewritten to take p_tenant_id explicitly, drop
--    the default in the same migration: a default silently filing a
--    white-label's project under TropicalTalent is exactly the kind of quiet wrong
--    answer this column exists to prevent."
--
-- That rewrite never happened, so every project created on a white-label has
-- been filed under TropicalTalent. It is not a reporting inconvenience — it breaks the
-- product outright:
--
--   * tropical_projects_read_members (024) requires
--     tropical_is_tenant_member(tenant_id, auth.uid()). A white-label brand is
--     not a member of classic, so the SELECT that follows their own INSERT
--     returns nothing: they create a project and it vanishes.
--   * tropical_public_briefs (025) filters on the caller's tenants, so the brief
--     never appears on the site it was posted to.
--   * the escrow inherits the classic tenant, so a partner's revenue lands in
--     TropicalTalent's column.
--
-- Nothing detected it because scripts/verify-tenancy.mjs inserts its fixture
-- projects through the service role with tenant_id set by hand, which is the
-- one path that does not go through this function.
--
-- ---------------------------------------------------------------------------
-- Why p_platform_fee_pct is gone rather than kept
-- ---------------------------------------------------------------------------
-- It was supplied by the browser. modules/projects/actions.ts read it from the
-- posted body with a default of 15, so a white-label on a negotiated 22% still
-- charged 15 — and a crafted request could post 0 and take the whole pot. The
-- fee is a property of the tenant, recorded on tropical_tenants.platform_fee_pct
-- and already treated that way by the recurring pay run (028:75). This function
-- now reads it from there, which makes the client's copy display-only in the
-- same way every other money figure in this codebase already is.
--
-- The crew pool is therefore derived here too. A caller whose role amounts were
-- computed against a different fee fails the existing sum check with a message
-- naming the fee that actually applies.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PROJECT CREATION
-- ============================================================================
-- DROP rather than CREATE OR REPLACE: the argument list changes, and REPLACE
-- cannot do that — it would leave the old function in place as an overload,
-- which is worse than not fixing it at all. The tenant-less signature has to
-- stop existing, or any authenticated caller can still reach it directly over
-- PostgREST and file a project under classic.
--
-- migrations/apply.mjs re-runs every file in order on each invocation, so 007
-- recreates the old signature and this drops it again. That is why the drop is
-- unconditional rather than guarded.

DROP FUNCTION IF EXISTS public.tropical_create_project(
  text, text, bigint, text, numeric, timestamptz, jsonb);

CREATE OR REPLACE FUNCTION public.tropical_create_project(
  p_name       text,
  p_brief      text,
  p_budget     bigint,
  p_visibility text,
  p_deadline   timestamptz,
  -- [{title, discipline, percentage, amount, assigned_user_id, deliverables}]
  p_roles      jsonb,
  -- The tenant whose hostname served the request. Not derived from the caller:
  -- one identity can hold memberships in several tenants, and the site they are
  -- looking at is the only thing that says which one this project belongs to.
  p_tenant_id  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_fee_pct    numeric;
  v_project    uuid;
  v_role       jsonb;
  v_role_id    uuid;
  v_crew_total bigint := 0;
  v_crew_pool  bigint;
  v_terms      jsonb := '[]'::jsonb;
  v_assignee   uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'a project needs a tenant' USING ERRCODE = '22023';
  END IF;

  -- The caller must belong to the tenant they are creating in. SECURITY
  -- DEFINER means this function bypasses RLS, so without this check a crafted
  -- request could post a project into another customer's workspace.
  IF NOT public.tropical_is_tenant_member(p_tenant_id, v_user) THEN
    RAISE EXCEPTION 'not a member of that workspace' USING ERRCODE = '42501';
  END IF;

  SELECT t.platform_fee_pct INTO v_fee_pct
  FROM public.tropical_tenants t
  WHERE t.id = p_tenant_id AND t.status = 'active';

  IF v_fee_pct IS NULL THEN
    RAISE EXCEPTION 'that workspace is not active' USING ERRCODE = '22023';
  END IF;

  IF p_budget IS NULL OR p_budget <= 0 THEN
    RAISE EXCEPTION 'budget must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_roles) <> 'array' OR jsonb_array_length(p_roles) = 0 THEN
    RAISE EXCEPTION 'a project needs at least one role' USING ERRCODE = '22023';
  END IF;

  IF p_visibility NOT IN ('public', 'private', 'both') THEN
    RAISE EXCEPTION 'invalid visibility %', p_visibility USING ERRCODE = '22023';
  END IF;

  -- The caller computes the split (lib/money.ts owns that maths so the UI can
  -- show live figures). Verify it here rather than trusting it: the role
  -- amounts must exactly equal the crew pool, or escrow would later be unable
  -- to reconcile against the payment.
  v_crew_pool := p_budget - floor(p_budget * v_fee_pct / 100);

  SELECT COALESCE(sum((r->>'amount')::bigint), 0)
    INTO v_crew_total
  FROM jsonb_array_elements(p_roles) AS r;

  IF v_crew_total <> v_crew_pool THEN
    RAISE EXCEPTION
      'role amounts (%) must sum to the crew pool (%) at this workspace''s % percent fee',
      v_crew_total, v_crew_pool, v_fee_pct
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tropical_projects
    (brand_id, tenant_id, name, brief, budget, visibility,
     platform_fee_pct, status, deadline_date)
  VALUES
    (v_user, p_tenant_id, p_name, COALESCE(p_brief, ''), p_budget, p_visibility,
     v_fee_pct, 'pending_payment', p_deadline)
  RETURNING id INTO v_project;

  INSERT INTO public.tropical_project_members (project_id, user_id, member_role)
  VALUES (v_project, v_user, 'brand');

  -- Structural channels. 'Project Admin' is the brand's private control
  -- channel (renamed from 'TropicalTalent Bot' and restricted to the brand in 011).
  -- The group channel exists from the start but RLS keeps it unreadable until
  -- the project goes active (escrow funded).
  INSERT INTO public.tropical_channels (project_id, type, name)
  VALUES (v_project, 'bot', 'Project Admin'), (v_project, 'group', 'Group Chat');

  FOR v_role IN SELECT * FROM jsonb_array_elements(p_roles)
  LOOP
    v_assignee := NULLIF(v_role->>'assigned_user_id', '')::uuid;

    -- A creative from another workspace cannot be pre-assigned. The Talent
    -- board only ever offers same-tenant people, but this function is reached
    -- over PostgREST and the board is not the boundary.
    IF v_assignee IS NOT NULL
       AND NOT public.tropical_is_tenant_member(p_tenant_id, v_assignee) THEN
      RAISE EXCEPTION 'assigned creative is not a member of that workspace'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.tropical_project_roles
      (project_id, title, discipline_slug, percentage, amount,
       assigned_user_id, status, deliverables, sort_order)
    VALUES
      (v_project,
       v_role->>'title',
       NULLIF(v_role->>'discipline', ''),
       (v_role->>'percentage')::numeric,
       (v_role->>'amount')::bigint,
       v_assignee,
       CASE WHEN v_assignee IS NULL THEN 'open' ELSE 'invited' END,
       NULLIF(v_role->>'deliverables', ''),
       COALESCE((v_role->>'sort_order')::int, 0))
    RETURNING id INTO v_role_id;

    -- A pre-assigned creative gets a DM channel and project membership up
    -- front, so the brand can start aligning before escrow is funded.
    IF v_assignee IS NOT NULL THEN
      INSERT INTO public.tropical_channels (project_id, type, name, role_id)
      VALUES (v_project, 'dm', v_role->>'title', v_role_id);

      INSERT INTO public.tropical_project_members (project_id, user_id, member_role, role_id)
      VALUES (v_project, v_assignee, 'creative', v_role_id)
      ON CONFLICT (project_id, user_id) DO NOTHING;
    END IF;

    v_terms := v_terms || jsonb_build_object(
      'role_id',          v_role_id,
      'title',            v_role->>'title',
      'discipline',       NULLIF(v_role->>'discipline', ''),
      'percentage',       (v_role->>'percentage')::numeric,
      'amount',           (v_role->>'amount')::bigint,
      'assigned_user_id', v_assignee,
      'deliverables',     NULLIF(v_role->>'deliverables', ''),
      'deadline',         p_deadline
    );
  END LOOP;

  -- v1 of the contract, frozen. Renegotiation supersedes this rather than
  -- editing it, so the original terms remain auditable.
  INSERT INTO public.tropical_contracts
    (project_id, version, terms, total_budget, platform_fee_pct, status, created_by)
  VALUES
    (v_project, 1,
     jsonb_build_object(
       'roles', v_terms,
       'meta', jsonb_build_object(
         'generated_at',     now(),
         'budget',           p_budget,
         'platform_fee_pct', v_fee_pct,
         'currency',         'GBP'
       )
     ),
     p_budget, v_fee_pct, 'active', v_user);

  INSERT INTO public.tropical_channel_messages (channel_id, project_id, sender_id, kind, content)
  SELECT c.id, v_project, NULL, 'escrow',
         jsonb_build_object(
           'event',  'project_created',
           'budget', p_budget,
           'text',   'Project initiated. Authorise escrow to unlock the group channel.'
         )
  FROM public.tropical_channels c
  WHERE c.project_id = v_project AND c.type = 'bot';

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_create_project(
  text, text, bigint, text, timestamptz, jsonb, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_create_project(
  text, text, bigint, text, timestamptz, jsonb, uuid) TO authenticated;

-- ============================================================================
-- 2. RETAINER CREATION
-- ============================================================================
-- 029 already knew the column default was wrong and worked around it by
-- picking the caller's OLDEST membership. That is right for someone who
-- belongs to one tenant and wrong for the exact case tenancy exists to
-- support: a TropicalTalent creative who also joins a white-label has an older classic
-- membership, so a retainer they set up on the white-label was filed under
-- TropicalTalent. Same fix as above — the request's tenant, passed in.

DROP FUNCTION IF EXISTS public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, text, date, text);

CREATE OR REPLACE FUNCTION public.tropical_create_retainer_project(
  p_name           text,
  p_brief          text,
  p_role_title     text,
  p_discipline     text,
  p_user           uuid,
  p_period         text,
  p_period_amount  bigint,
  p_starts         date,
  p_tenant_id      uuid,
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
  v_project uuid;
  v_role    uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'a retainer needs a tenant' USING ERRCODE = '22023';
  END IF;

  IF NOT public.tropical_is_tenant_member(p_tenant_id, v_user) THEN
    RAISE EXCEPTION 'not a member of that workspace' USING ERRCODE = '42501';
  END IF;

  IF p_user IS NOT NULL
     AND NOT public.tropical_is_tenant_member(p_tenant_id, p_user) THEN
    RAISE EXCEPTION 'that person is not a member of this workspace'
      USING ERRCODE = '42501';
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

  INSERT INTO public.tropical_projects
    (brand_id, tenant_id, name, brief, budget, visibility, kind, status)
  VALUES
    (v_user, p_tenant_id, p_name, COALESCE(p_brief, ''), 0, p_visibility,
     'retainer', 'active')
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
  text, text, text, text, uuid, text, bigint, date, uuid, text, date, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, uuid, text, date, text) TO authenticated;

-- ============================================================================
-- 3. DROP THE CLASSIC DEFAULT
-- ============================================================================
-- Both insert paths now name the tenant, so the crutch comes out. A forgotten
-- tenant_id is a NOT NULL violation from here on — a loud failure at the point
-- of the mistake instead of a project quietly filed under the wrong customer
-- and discovered weeks later in someone's revenue report.

ALTER TABLE public.tropical_projects ALTER COLUMN tenant_id DROP DEFAULT;

-- ============================================================================
-- 4. PARTNER FEE ON ONE-OFF ESCROW
-- ============================================================================
-- 023 added tropical_project_escrows.partner_fee and nothing has ever written
-- it, so every white-label's partner revenue reads as zero on a one-off
-- project. The recurring pay run does compute it (028:81) — this is the same
-- arithmetic on the other path.
--
-- It goes in the trigger that already derives tenant_id rather than into
-- tropical_open_escrow, for the reason 023 gave for putting tenant_id there:
-- the value is not an independent fact, and a trigger is the one place that
-- cannot drift from whichever path writes the row.
--
-- Frozen once funded. The UPDATE arm only fires while the escrow is still
-- pending, so a fee change can never reprice money that has already moved.

CREATE OR REPLACE FUNCTION public.tropical_escrow_inherit_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share     numeric;
  v_recompute boolean;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT p.tenant_id INTO NEW.tenant_id
    FROM public.tropical_projects p
    WHERE p.id = NEW.project_id;
  END IF;

  -- Branches rather than one OR'd condition: SQL does not promise to
  -- short-circuit, and OLD is unassigned on INSERT — reading it there raises.
  IF TG_OP = 'INSERT' THEN
    v_recompute := true;
  ELSIF NEW.status = 'pending' AND NEW.platform_fee IS DISTINCT FROM OLD.platform_fee THEN
    v_recompute := true;
  ELSE
    v_recompute := false;
  END IF;

  IF v_recompute THEN
    SELECT t.partner_share_pct INTO v_share
    FROM public.tropical_tenants t
    WHERE t.id = NEW.tenant_id;

    -- A share OF THE FEE, not of the pot. 15% fee with a 33% share is
    -- roughly 5% of the project value going to the partner.
    NEW.partner_fee := floor(COALESCE(NEW.platform_fee, 0) * COALESCE(v_share, 0) / 100);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_escrow_tenant ON public.tropical_project_escrows;
CREATE TRIGGER tropical_escrow_tenant
  BEFORE INSERT OR UPDATE OF platform_fee, tenant_id ON public.tropical_project_escrows
  FOR EACH ROW
  EXECUTE FUNCTION public.tropical_escrow_inherit_tenant();

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   npm run verify:tenancy   -- now creates its fixture project through the
--                            -- RPC, so it fails if this regresses
--
--   -- nothing should come back:
--   SELECT id, tenant_id FROM public.tropical_projects
--   WHERE tenant_id = (SELECT id FROM public.tropical_tenants WHERE is_classic)
--     AND brand_id IN (
--       SELECT user_id FROM public.tropical_tenant_members
--       WHERE tenant_id <> (SELECT id FROM public.tropical_tenants WHERE is_classic)
--     )
--     AND brand_id NOT IN (
--       SELECT user_id FROM public.tropical_tenant_members m
--       JOIN public.tropical_tenants t ON t.id = m.tenant_id AND t.is_classic
--     );
