-- ============================================================================
-- TROPICAL v2 — RLS, VIEWS, RPCs AND TRIGGERS
-- ============================================================================
-- The behaviour behind the tables in 010, plus three changes to existing
-- rules:
--
--   * "TropicalTalent Bot" becomes "Project Admin" and is restricted to the brand.
--   * Applicants can see the job they applied to (name, brief, status) —
--     never the money.
--   * Authenticated users may add a discipline to the shared vocabulary.
--
-- Every multi-table operation in this file is one function and one
-- transaction. Assigning a role, for instance, writes the role, the
-- membership and the DM channel; as three PostgREST calls a failure between
-- them leaves a creative who can see a project but has nowhere to talk.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. RLS ON THE NEW TABLES
-- ============================================================================

ALTER TABLE public.tropical_deliverables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_role_contracts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_disputes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_favourites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_notifications   ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS, so drop first to keep this file
-- genuinely re-runnable.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tropical_deliverables', 'tropical_role_contracts', 'tropical_disputes',
                        'tropical_favourites', 'tropical_notifications', 'tropical_disciplines')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- --- Deliverables: every member reads, only the brand writes ---------------
CREATE POLICY "tropical_deliverables_read" ON public.tropical_deliverables
  FOR SELECT USING (public.tropical_is_member(project_id, (SELECT auth.uid())));

CREATE POLICY "tropical_deliverables_brand_write" ON public.tropical_deliverables
  FOR ALL USING (public.tropical_is_brand(project_id, (SELECT auth.uid())))
  WITH CHECK (public.tropical_is_brand(project_id, (SELECT auth.uid())));

-- --- Role contracts: the two parties only ----------------------------------
-- Not every member: a contract is between the brand and ONE creative, and the
-- other creatives on the project have no business reading it.
CREATE OR REPLACE FUNCTION public.tropical_is_contract_party(p_role uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tropical_project_roles r
    JOIN public.tropical_projects p ON p.id = r.project_id
    WHERE r.id = p_role
      AND (p.brand_id = p_user OR r.assigned_user_id = p_user)
  );
$$;

REVOKE ALL ON FUNCTION public.tropical_is_contract_party(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_is_contract_party(uuid, uuid) TO authenticated;

CREATE POLICY "tropical_role_contracts_party_read" ON public.tropical_role_contracts
  FOR SELECT USING (public.tropical_is_contract_party(role_id, (SELECT auth.uid())));

-- Either party may write, but only while escrow is unpaid. The application
-- layer checks this too; enforcing it here means a direct PostgREST call
-- cannot bypass the lock.
CREATE POLICY "tropical_role_contracts_party_write" ON public.tropical_role_contracts
  FOR ALL USING (
    public.tropical_is_contract_party(role_id, (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.tropical_projects p
      WHERE p.id = project_id AND p.status IN ('draft', 'pending_payment')
    )
  )
  WITH CHECK (
    public.tropical_is_contract_party(role_id, (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.tropical_projects p
      WHERE p.id = project_id AND p.status IN ('draft', 'pending_payment')
    )
  );

-- --- Disputes: raise your own, read your own or your project's -------------
CREATE POLICY "tropical_disputes_read" ON public.tropical_disputes
  FOR SELECT USING (
    raised_by = (SELECT auth.uid())
    OR public.tropical_is_brand(project_id, (SELECT auth.uid()))
  );

CREATE POLICY "tropical_disputes_insert_own" ON public.tropical_disputes
  FOR INSERT WITH CHECK (
    raised_by = (SELECT auth.uid())
    AND public.tropical_is_member(project_id, (SELECT auth.uid()))
  );

-- --- Favourites: strictly own rows -----------------------------------------
CREATE POLICY "tropical_favourites_own" ON public.tropical_favourites
  FOR ALL USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- --- Notifications: read and mark your own; writes are server-side ---------
CREATE POLICY "tropical_notifications_read_own" ON public.tropical_notifications
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "tropical_notifications_mark_own" ON public.tropical_notifications
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- --- Disciplines: public read, authenticated may extend the vocabulary -----
-- A creative adding a skill that does not exist yet has to be able to create
-- it, otherwise the skill lives on their profile alone and no brand's search
-- can ever find it. Updates and deletes stay closed: renaming a discipline
-- would silently retitle it on every profile that holds it.
CREATE POLICY "tropical_disciplines_read" ON public.tropical_disciplines
  FOR SELECT USING (true);

CREATE POLICY "tropical_disciplines_insert" ON public.tropical_disciplines
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND length(label) BETWEEN 1 AND 60
    AND length(slug) BETWEEN 1 AND 64
    AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  );

-- ============================================================================
-- 2. PROJECT ADMIN — the bot channel becomes brand-only
-- ============================================================================
-- The channel was a shared bot thread. It now carries the brand's controls —
-- deliverables, applicant review, project settings — so it is the brand's
-- private channel. Creatives get the group channel and their own DM.

UPDATE public.tropical_channels
SET name = 'Project Admin'
WHERE type = 'bot' AND name IN ('TropicalTalent Bot', 'TropicalTalent Agent');

CREATE OR REPLACE FUNCTION public.tropical_can_see_channel(p_channel uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project  uuid;
  v_type     text;
  v_role     uuid;
  v_assignee uuid;
BEGIN
  SELECT c.project_id, c.type, c.role_id
    INTO v_project, v_type, v_role
  FROM public.tropical_channels c
  WHERE c.id = p_channel;

  IF v_project IS NULL THEN RETURN false; END IF;
  IF NOT public.tropical_is_member(v_project, p_user) THEN RETURN false; END IF;

  -- Project Admin: the brand only.
  IF v_type = 'bot' THEN
    RETURN public.tropical_is_brand(v_project, p_user);
  END IF;

  -- A DM is only visible to its two parties, funded or not.
  IF v_type = 'dm' THEN
    IF public.tropical_is_brand(v_project, p_user) THEN RETURN true; END IF;
    SELECT r.assigned_user_id INTO v_assignee
      FROM public.tropical_project_roles r WHERE r.id = v_role;
    RETURN v_assignee IS NOT DISTINCT FROM p_user;
  END IF;

  -- group: visible to every member. Its CONTENTS stay gated below.
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.tropical_can_access_channel(p_channel uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
  v_type    text;
  v_status  text;
BEGIN
  IF NOT public.tropical_can_see_channel(p_channel, p_user) THEN
    RETURN false;
  END IF;

  SELECT c.project_id, c.type, p.status
    INTO v_project, v_type, v_status
  FROM public.tropical_channels c
  JOIN public.tropical_projects p ON p.id = c.project_id
  WHERE c.id = p_channel;

  -- The group channel stays shut until escrow is funded.
  IF v_type = 'group' AND v_status NOT IN ('active', 'completed') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_can_see_channel(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.tropical_can_access_channel(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_can_see_channel(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tropical_can_access_channel(uuid, uuid) TO authenticated;

-- ============================================================================
-- 3. APPLICANT VISIBILITY
-- ============================================================================
-- An applicant is not a project member, so members-only RLS gave them nothing
-- but the fact that they had applied. They could not see the job title, the
-- brief, or whether the project was still alive.
--
-- This view is the sanctioned projection: enough to follow the job, and no
-- money. security_invoker = false is the mechanism, not an oversight — the
-- WHERE clause below is what scopes it to the caller's own applications.

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
WHERE a.user_id = (SELECT auth.uid());

COMMENT ON VIEW public.tropical_my_applications IS
  'A creative''s own applications with the job attached. Carries no percentage or amount — an applicant is not a member and must not see the split.';

GRANT SELECT ON public.tropical_my_applications TO authenticated;

-- ============================================================================
-- 4. ROLE ASSIGNMENT
-- ============================================================================
-- Assign, unassign, invite and accept-an-application all converge here.

CREATE OR REPLACE FUNCTION public.tropical_assign_role(p_role uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_project  uuid;
  v_title    text;
  v_previous uuid;
  v_status   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, r.title, r.assigned_user_id, p.status
    INTO v_project, v_title, v_previous, v_status
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.tropical_is_brand(v_project, v_caller) THEN
    RAISE EXCEPTION 'only the project owner can change the crew' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow is funded — renegotiate to change this role'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_project_roles
  SET assigned_user_id = p_user,
      status           = CASE WHEN p_user IS NULL THEN 'open' ELSE 'invited' END,
      updated_at       = now()
  WHERE id = p_role;

  -- The previous holder loses their membership unless they hold another role
  -- on the same project.
  IF v_previous IS NOT NULL AND v_previous IS DISTINCT FROM p_user THEN
    DELETE FROM public.tropical_project_members m
    WHERE m.project_id = v_project
      AND m.user_id = v_previous
      AND m.member_role = 'creative'
      AND NOT EXISTS (
        SELECT 1 FROM public.tropical_project_roles r2
        WHERE r2.project_id = v_project
          AND r2.assigned_user_id = v_previous
          AND r2.id <> p_role
      );
  END IF;

  IF p_user IS NOT NULL THEN
    -- A DM channel per assigned role. The partial unique index on
    -- (role_id) WHERE type = 'dm' makes a duplicate impossible, so a
    -- re-assignment reuses the existing thread rather than orphaning it.
    INSERT INTO public.tropical_channels (project_id, type, name, role_id)
    VALUES (v_project, 'dm', v_title, p_role)
    ON CONFLICT DO NOTHING;

    UPDATE public.tropical_channels SET name = v_title
    WHERE role_id = p_role AND type = 'dm';

    INSERT INTO public.tropical_project_members (project_id, user_id, member_role, role_id)
    VALUES (v_project, p_user, 'creative', p_role)
    ON CONFLICT (project_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id;

    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    SELECT p_user, v_project, 'role_invited',
           'You have been added to ' || p.name,
           'Role: ' || v_title,
           v_caller
    FROM public.tropical_projects p WHERE p.id = v_project;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_assign_role(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_assign_role(uuid, uuid) TO authenticated;

-- ============================================================================
-- 5. MEMBER REMOVAL  (project settings)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tropical_remove_member(p_project uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_status text;
  v_brand  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status, brand_id INTO v_status, v_brand
  FROM public.tropical_projects WHERE id = p_project;

  IF v_brand IS NULL OR v_brand <> v_caller THEN
    RAISE EXCEPTION 'only the project owner can remove members' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow is funded — members can no longer be removed'
      USING ERRCODE = '22023';
  END IF;

  IF p_user = v_brand THEN
    RAISE EXCEPTION 'the project owner cannot be removed' USING ERRCODE = '22023';
  END IF;

  -- Free every role they held, so the work goes back on the market.
  UPDATE public.tropical_project_roles
  SET assigned_user_id = NULL, status = 'open', updated_at = now()
  WHERE project_id = p_project AND assigned_user_id = p_user;

  -- Their DM channels go with them; the messages cascade.
  DELETE FROM public.tropical_channels c
  WHERE c.project_id = p_project
    AND c.type = 'dm'
    AND c.role_id IN (
      SELECT r.id FROM public.tropical_project_roles r
      WHERE r.project_id = p_project AND r.assigned_user_id IS NULL
    );

  DELETE FROM public.tropical_project_members
  WHERE project_id = p_project AND user_id = p_user;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_remove_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_remove_member(uuid, uuid) TO authenticated;

-- ============================================================================
-- 6. APPLICATION DECISIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tropical_decide_application(
  p_application uuid,
  p_decision    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project uuid;
  v_role    uuid;
  v_user    uuid;
  v_status  text;
  v_name    text;
  v_title   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision USING ERRCODE = '22023';
  END IF;

  SELECT a.project_id, a.role_id, a.user_id, a.status, p.name, r.title
    INTO v_project, v_role, v_user, v_status, v_name, v_title
  FROM public.tropical_applications a
  JOIN public.tropical_projects      p ON p.id = a.project_id
  JOIN public.tropical_project_roles r ON r.id = a.role_id
  WHERE a.id = p_application
  FOR UPDATE OF a;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'application not found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.tropical_is_brand(v_project, v_caller) THEN
    RAISE EXCEPTION 'only the project owner can decide applications' USING ERRCODE = '42501';
  END IF;

  -- A parked application is invisible to the brand, so reaching one here means
  -- a stale client. Refuse rather than hiring someone who has not yet claimed
  -- the skill the role needs.
  IF v_status = 'pending_skill' THEN
    RAISE EXCEPTION 'that application is still waiting on the creative''s profile'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_applications
  SET status = p_decision, updated_at = now()
  WHERE id = p_application;

  IF p_decision = 'accepted' THEN
    PERFORM public.tropical_assign_role(v_role, v_user);

    -- Everyone else applying for that role is out. Doing this in the same
    -- transaction is what stops two accepted applicants for one seat.
    UPDATE public.tropical_applications
    SET status = 'rejected', updated_at = now()
    WHERE role_id = v_role
      AND id <> p_application
      AND status IN ('pending', 'pending_skill');
  END IF;

  INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
  VALUES (
    v_user, v_project, 'application_decided',
    CASE WHEN p_decision = 'accepted'
         THEN 'You got the role on ' || v_name
         ELSE 'Update on your application to ' || v_name END,
    v_title, v_caller
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_decide_application(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_decide_application(uuid, text) TO authenticated;

-- ============================================================================
-- 7. SKILL-GATED APPLICATION RELEASE
-- ============================================================================
-- Called explicitly by the skill editor AND fired by a trigger, so it works
-- whichever way the skill lands on the profile. Idempotent.

CREATE OR REPLACE FUNCTION public.tropical_release_skill_gated_applications(
  p_user       uuid,
  p_discipline text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released integer := 0;
BEGIN
  WITH released AS (
    UPDATE public.tropical_applications a
    SET status              = 'pending',
        required_discipline = NULL,
        unlocked_at         = now(),
        updated_at          = now()
    FROM public.tropical_project_roles r
    WHERE a.role_id = r.id
      AND a.user_id = p_user
      AND a.status = 'pending_skill'
      AND a.required_discipline = p_discipline
      -- Only if the seat is still free.
      AND r.status = 'open'
    RETURNING a.id, a.project_id, a.role_id
  ),
  notified AS (
    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    SELECT p.brand_id, rel.project_id, 'application_unlocked',
           COALESCE(u.name, u.username, 'A creative') || ' applied to ' || p.name,
           r.title, p_user
    FROM released rel
    JOIN public.tropical_projects      p ON p.id = rel.project_id
    JOIN public.tropical_project_roles r ON r.id = rel.role_id
    JOIN public.users                u ON u.id = p_user
    RETURNING 1
  )
  SELECT count(*) INTO v_released FROM released;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_release_skill_gated_applications(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_release_skill_gated_applications(uuid, text)
  TO authenticated, service_role;

-- The asynchronous half: adding a discipline to a profile releases every
-- application that was waiting on it, from any code path.
CREATE OR REPLACE FUNCTION public.tropical_on_discipline_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.tropical_release_skill_gated_applications(NEW.user_id, NEW.discipline_slug);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_discipline_added ON public.tropical_creative_disciplines;
CREATE TRIGGER tropical_discipline_added
  AFTER INSERT ON public.tropical_creative_disciplines
  FOR EACH ROW
  EXECUTE FUNCTION public.tropical_on_discipline_added();

-- ============================================================================
-- 8. BRAND ALERT ON APPLICATION
-- ============================================================================
-- A trigger rather than an application-layer write: the notification and the
-- application must land together or not at all, and applications arrive from
-- more than one path.

CREATE OR REPLACE FUNCTION public.tropical_on_application_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid;
  v_name  text;
  v_title text;
  v_who   text;
BEGIN
  -- A parked application is invisible to the brand, so it must not alert them.
  -- The release function raises the alert when it unparks.
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT p.brand_id, p.name INTO v_brand, v_name
  FROM public.tropical_projects p WHERE p.id = NEW.project_id;

  SELECT r.title INTO v_title
  FROM public.tropical_project_roles r WHERE r.id = NEW.role_id;

  SELECT COALESCE(u.name, u.username, 'A creative') INTO v_who
  FROM public.users u WHERE u.id = NEW.user_id;

  IF v_brand IS NOT NULL THEN
    INSERT INTO public.tropical_notifications
      (user_id, project_id, kind, title, body, actor_id)
    VALUES
      (v_brand, NEW.project_id, 'application_received',
       v_who || ' applied to ' || v_name, v_title, NEW.user_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_application_created ON public.tropical_applications;
CREATE TRIGGER tropical_application_created
  AFTER INSERT ON public.tropical_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.tropical_on_application_created();

-- ============================================================================
-- 9. DELIVERABLES
-- ============================================================================
-- Replace-the-set semantics: the form posts the whole list, so a removed row
-- is a row the brand deleted. Post-escrow edits announce themselves in the
-- group channel in the same transaction.

CREATE OR REPLACE FUNCTION public.tropical_save_deliverables(
  p_project uuid,
  p_items   jsonb
)
RETURNS SETOF public.tropical_deliverables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_status text;
  v_brand  uuid;
  v_before integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status, brand_id INTO v_status, v_brand
  FROM public.tropical_projects WHERE id = p_project;

  IF v_brand IS NULL OR v_brand <> v_caller THEN
    RAISE EXCEPTION 'only the project owner can set deliverables' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_before FROM public.tropical_deliverables WHERE project_id = p_project;

  DELETE FROM public.tropical_deliverables WHERE project_id = p_project;

  INSERT INTO public.tropical_deliverables
    (project_id, title, description, due_date, sort_order, created_by)
  SELECT
    p_project,
    item->>'title',
    NULLIF(item->>'description', ''),
    NULLIF(item->>'due_date', '')::timestamptz,
    COALESCE((item->>'sort_order')::int, 0),
    v_caller
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item;

  -- After escrow the crew is already working to these, so a change is news.
  IF v_status IN ('active', 'completed') AND v_before > 0 THEN
    INSERT INTO public.tropical_channel_messages (channel_id, project_id, sender_id, kind, content)
    SELECT c.id, p_project, NULL, 'deliverable',
           jsonb_build_object(
             'event', 'deliverables_updated',
             'text',  'The deliverables have been updated. Open the project to see what changed.',
             'count', jsonb_array_length(COALESCE(p_items, '[]'::jsonb))
           )
    FROM public.tropical_channels c
    WHERE c.project_id = p_project AND c.type = 'group';

    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    SELECT m.user_id, p_project, 'deliverables_updated',
           'Deliverables updated', p.name, v_caller
    FROM public.tropical_project_members m
    JOIN public.tropical_projects p ON p.id = p_project
    WHERE m.project_id = p_project AND m.user_id <> v_caller;
  END IF;

  RETURN QUERY
    SELECT * FROM public.tropical_deliverables
    WHERE project_id = p_project ORDER BY sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_save_deliverables(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_save_deliverables(uuid, jsonb) TO authenticated;

-- ============================================================================
-- 10. ROLE CONTRACT ACCEPTANCE
-- ============================================================================
-- Read-then-write on two boolean flags. As two PostgREST calls, simultaneous
-- acceptance by both parties can leave the contract in 'draft' with both flags
-- set; here it is one statement.

CREATE OR REPLACE FUNCTION public.tropical_accept_role_contract(p_role uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_project  uuid;
  v_brand    uuid;
  v_assignee uuid;
  v_status   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.assigned_user_id, p.status
    INTO v_project, v_brand, v_assignee, v_status
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF v_caller NOT IN (v_brand, COALESCE(v_assignee, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'only the two parties can accept this contract' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow is paid — this contract is locked' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_role_contracts
  SET brand_accepted    = brand_accepted    OR (v_caller = v_brand),
      creative_accepted = creative_accepted OR (v_caller = v_assignee),
      status = CASE
        WHEN (brand_accepted    OR v_caller = v_brand)
         AND (creative_accepted OR v_caller = v_assignee)
        THEN 'agreed' ELSE status END,
      updated_at = now()
  WHERE role_id = p_role;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no contract drafted for this role yet' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_accept_role_contract(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_accept_role_contract(uuid) TO authenticated;

-- Escrow funding locks every draft. Kept as a trigger on the project's status
-- so it cannot be forgotten by whichever path funds the escrow.
CREATE OR REPLACE FUNCTION public.tropical_on_project_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE public.tropical_role_contracts
    SET status = 'locked', updated_at = now()
    WHERE project_id = NEW.id AND status <> 'locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_project_activated ON public.tropical_projects;
CREATE TRIGGER tropical_project_activated
  AFTER UPDATE OF status ON public.tropical_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.tropical_on_project_activated();

-- ============================================================================
-- 11. ROLE RELEASE
-- ============================================================================
-- Approving a role's work moves its escrow slice into the creative's internal
-- balance. Transfer to their bank happens at withdrawal, which is where payment provider
-- Connect becomes required — gating approval on Connect onboarding would block
-- almost every creative on the platform.

-- 017_tropical_delivery_confirmation.sql and 020_tropical_email_notifications.sql
-- both later redefine this function — 017 keeps `RETURNS void`, but 020
-- changes it to a TABLE so the caller can email without a second query.
-- Postgres refuses to change a function's return type via CREATE OR REPLACE,
-- so on any replay after 020 has run, this file's own definition below would
-- fail with 42P13 unless the function is dropped first. No-op on a database
-- that has never run 020.
DROP FUNCTION IF EXISTS public.tropical_release_role(uuid);

CREATE OR REPLACE FUNCTION public.tropical_release_role(p_role uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_project  uuid;
  v_brand    uuid;
  v_hold     uuid;
  v_amount   bigint;
  v_creative uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id INTO v_project, v_brand
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_brand IS NULL OR v_brand <> v_caller THEN
    RAISE EXCEPTION 'only the project owner can release funds' USING ERRCODE = '42501';
  END IF;

  SELECT h.id, h.amount, h.creative_id INTO v_hold, v_amount, v_creative
  FROM public.tropical_escrow_holds h
  WHERE h.role_id = p_role AND h.status = 'held'
  FOR UPDATE;

  IF v_hold IS NULL THEN
    RAISE EXCEPTION 'no held escrow for this role' USING ERRCODE = '22023';
  END IF;
  IF v_creative IS NULL THEN
    RAISE EXCEPTION 'this role has no creative to pay' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_escrow_holds
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE id = v_hold;

  UPDATE public.tropical_project_roles
  SET status = 'released', updated_at = now()
  WHERE id = p_role;

  INSERT INTO public.tropical_user_balances (user_id, available, lifetime_earned)
  VALUES (v_creative, v_amount, v_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET available       = public.tropical_user_balances.available + EXCLUDED.available,
        lifetime_earned = public.tropical_user_balances.lifetime_earned + EXCLUDED.lifetime_earned,
        updated_at      = now();

  -- The partial unique index on (hold_id) WHERE type = 'escrow_release' is
  -- what stops a duplicated call crediting twice.
  INSERT INTO public.tropical_balance_transactions
    (user_id, project_id, role_id, hold_id, amount, type, status)
  VALUES (v_creative, v_project, p_role, v_hold, v_amount, 'escrow_release', 'completed')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tropical_role_events (project_id, role_id, actor_id, event_type, note)
  VALUES (v_project, p_role, v_caller, 'approved', 'Escrow released to the creative.');

  -- All slices released -> the escrow itself is done.
  UPDATE public.tropical_project_escrows e
  SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.tropical_escrow_holds h
          WHERE h.escrow_id = e.id AND h.status = 'held'
        ) THEN 'released' ELSE 'partially_released' END,
      updated_at = now()
  WHERE e.project_id = v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_release_role(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_release_role(uuid) TO authenticated;

-- ============================================================================
-- 12. REALTIME
-- ============================================================================
-- Notifications stream so the Project Admin updates badge lights up without
-- polling. RLS applies to realtime, so a user is only ever sent their own.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'tropical_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tropical_notifications;
  END IF;
END $$;

ALTER TABLE public.tropical_notifications REPLICA IDENTITY FULL;

COMMIT;
