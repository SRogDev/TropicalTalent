-- ============================================================================
-- TROPICAL PROJECT CREATION RPC
-- ============================================================================
-- Creating a project writes to six tables: the project, its roles, the brand's
-- membership, the bot and group channels, a DM channel per assigned role, the
-- v1 contract, and the bot's opening message.
--
-- Doing that as separate PostgREST calls is both slow (7+ round trips) and
-- unsafe — a failure halfway leaves a project with roles but no channels,
-- which the workspace cannot render and the brand cannot delete once it is
-- past 'draft'. One function, one transaction, one round trip.
--
-- SECURITY DEFINER is required because tropical_channels has no INSERT policy
-- (channels are structural, never user-created) and because the bot's opening
-- message has sender_id NULL, which the message INSERT policy forbids for
-- ordinary callers. The function pins brand_id to auth.uid() and rejects an
-- anonymous caller, so it cannot be used to create a project on someone
-- else's behalf.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.tropical_create_project(
  p_name             text,
  p_brief            text,
  p_budget           bigint,
  p_visibility       text,
  p_platform_fee_pct numeric,
  p_deadline         timestamptz,
  -- [{title, discipline, percentage, amount, assigned_user_id, deliverables}]
  p_roles            jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user       uuid := auth.uid();
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

  IF p_budget IS NULL OR p_budget <= 0 THEN
    RAISE EXCEPTION 'budget must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_roles) <> 'array' OR jsonb_array_length(p_roles) = 0 THEN
    RAISE EXCEPTION 'a project needs at least one role' USING ERRCODE = '22023';
  END IF;

  IF p_visibility NOT IN ('public', 'private', 'both') THEN
    RAISE EXCEPTION 'invalid visibility %', p_visibility USING ERRCODE = '22023';
  END IF;

  -- The caller computes the split (services/tropical/money.ts owns that maths so
  -- the UI can show live figures). Verify it here rather than trusting it: the
  -- role amounts must exactly equal the crew pool, or escrow would later be
  -- unable to reconcile against the payment.
  v_crew_pool := p_budget - floor(p_budget * p_platform_fee_pct / 100);

  SELECT COALESCE(sum((r->>'amount')::bigint), 0)
    INTO v_crew_total
  FROM jsonb_array_elements(p_roles) AS r;

  IF v_crew_total <> v_crew_pool THEN
    RAISE EXCEPTION
      'role amounts (%) must sum to the crew pool (%)', v_crew_total, v_crew_pool
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tropical_projects
    (brand_id, name, brief, budget, visibility, platform_fee_pct, status, deadline_date)
  VALUES
    (v_user, p_name, COALESCE(p_brief, ''), p_budget, p_visibility,
     COALESCE(p_platform_fee_pct, 15), 'pending_payment', p_deadline)
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
         'platform_fee_pct', COALESCE(p_platform_fee_pct, 15),
         'currency',         'GBP'
       )
     ),
     p_budget, COALESCE(p_platform_fee_pct, 15), 'active', v_user);

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
  text, text, bigint, text, numeric, timestamptz, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_create_project(
  text, text, bigint, text, numeric, timestamptz, jsonb) TO authenticated;

COMMIT;
