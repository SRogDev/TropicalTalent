-- ============================================================================
-- TROPICAL ROW LEVEL SECURITY
-- ============================================================================
-- Access model:
--   * Contract detail (per-role percentages and amounts) is MEMBERS ONLY.
--   * Non-members browsing the briefs feed see the total budget and the open
--     role titles, and nothing else.
--
-- RLS is row-level, so it cannot hide the amount column from a non-member who
-- is allowed to see the row at all. The base tables are therefore locked to
-- members outright, and the public feed is served by the projection view
-- tropical_public_briefs, which simply never selects the sensitive columns.
--
-- Membership predicates go through the SECURITY DEFINER helpers from 001 so
-- that policies on tropical_project_members do not recurse into themselves.
-- ============================================================================

BEGIN;

-- CREATE POLICY has no IF NOT EXISTS, so re-running this file would abort on
-- the first duplicate and poison the transaction for everything after it.
-- Dropping the tropical policies first makes the file genuinely re-runnable:
-- policies are declarative and fully redefined below, so this is a no-op on a
-- first run and a clean redefinition on any later one.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'tropical\_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END
$$;

ALTER TABLE public.tropical_disciplines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_creative_disciplines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_projects                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_project_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_project_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_channels                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_channel_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_applications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_contracts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_contract_signatures     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_project_escrows         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_escrow_holds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_role_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_user_balances           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_balance_transactions    ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- CHANNEL ACCESS HELPER
-- ============================================================================
-- Encodes the tropical channel rules:
--   bot   — every project member
--   group — every member, but only once escrow is funded (project active)
--   dm    — the brand and the creative assigned to that role

CREATE OR REPLACE FUNCTION public.tropical_can_access_channel(p_channel uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project    uuid;
  v_type       text;
  v_role       uuid;
  v_status     text;
  v_assignee   uuid;
BEGIN
  SELECT c.project_id, c.type, c.role_id, p.status
    INTO v_project, v_type, v_role, v_status
  FROM public.tropical_channels c
  JOIN public.tropical_projects p ON p.id = c.project_id
  WHERE c.id = p_channel;

  IF v_project IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.tropical_is_member(v_project, p_user) THEN
    RETURN false;
  END IF;

  IF v_type = 'group' AND v_status NOT IN ('active', 'completed') THEN
    RETURN false;  -- group channel stays locked until escrow is funded
  END IF;

  IF v_type = 'dm' THEN
    IF public.tropical_is_brand(v_project, p_user) THEN
      RETURN true;
    END IF;
    SELECT r.assigned_user_id INTO v_assignee
      FROM public.tropical_project_roles r WHERE r.id = v_role;
    RETURN v_assignee IS NOT DISTINCT FROM p_user;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_can_access_channel(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_can_access_channel(uuid, uuid) TO authenticated;

-- ============================================================================
-- DISCIPLINES  — public read, admin write
-- ============================================================================

CREATE POLICY "tropical_disciplines_read" ON public.tropical_disciplines
  FOR SELECT USING (true);

-- Creative disciplines are public profile data (they drive discovery), but
-- only the owner may change them.
CREATE POLICY "tropical_creative_disciplines_read" ON public.tropical_creative_disciplines
  FOR SELECT USING (true);

CREATE POLICY "tropical_creative_disciplines_write" ON public.tropical_creative_disciplines
  FOR ALL USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- PROJECTS  — members only (public discovery goes through the view)
-- ============================================================================

CREATE POLICY "tropical_projects_read_members" ON public.tropical_projects
  FOR SELECT USING (
    brand_id = (SELECT auth.uid())
    OR public.tropical_is_member(id, (SELECT auth.uid()))
  );

CREATE POLICY "tropical_projects_insert" ON public.tropical_projects
  FOR INSERT WITH CHECK (brand_id = (SELECT auth.uid()));

CREATE POLICY "tropical_projects_update" ON public.tropical_projects
  FOR UPDATE USING (brand_id = (SELECT auth.uid()))
  WITH CHECK (brand_id = (SELECT auth.uid()));

-- Only removable while still a draft; once money or members are attached the
-- project must be cancelled rather than deleted.
CREATE POLICY "tropical_projects_delete_draft" ON public.tropical_projects
  FOR DELETE USING (brand_id = (SELECT auth.uid()) AND status = 'draft');

-- ============================================================================
-- ROLES  — the money split. Members only.
-- ============================================================================

CREATE POLICY "tropical_project_roles_read" ON public.tropical_project_roles
  FOR SELECT USING (
    public.tropical_is_member(project_id, (SELECT auth.uid()))
    OR public.tropical_is_brand(project_id, (SELECT auth.uid()))
  );

CREATE POLICY "tropical_project_roles_brand_write" ON public.tropical_project_roles
  FOR ALL USING (public.tropical_is_brand(project_id, (SELECT auth.uid())))
  WITH CHECK (public.tropical_is_brand(project_id, (SELECT auth.uid())));

-- ============================================================================
-- MEMBERS
-- ============================================================================

CREATE POLICY "tropical_project_members_read" ON public.tropical_project_members
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR public.tropical_is_member(project_id, (SELECT auth.uid()))
  );

CREATE POLICY "tropical_project_members_brand_write" ON public.tropical_project_members
  FOR ALL USING (public.tropical_is_brand(project_id, (SELECT auth.uid())))
  WITH CHECK (public.tropical_is_brand(project_id, (SELECT auth.uid())));

-- ============================================================================
-- CHANNELS & MESSAGES
-- ============================================================================

CREATE POLICY "tropical_channels_read" ON public.tropical_channels
  FOR SELECT USING (public.tropical_can_access_channel(id, (SELECT auth.uid())));

CREATE POLICY "tropical_channel_messages_read" ON public.tropical_channel_messages
  FOR SELECT USING (public.tropical_can_access_channel(channel_id, (SELECT auth.uid())));

-- Senders may only post as themselves, into a channel they can reach.
-- Bot messages (sender_id NULL) are written server-side with the service role.
CREATE POLICY "tropical_channel_messages_insert" ON public.tropical_channel_messages
  FOR INSERT WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND public.tropical_can_access_channel(channel_id, (SELECT auth.uid()))
  );

CREATE POLICY "tropical_channel_messages_update_own" ON public.tropical_channel_messages
  FOR UPDATE USING (sender_id = (SELECT auth.uid()))
  WITH CHECK (sender_id = (SELECT auth.uid()));

-- ============================================================================
-- APPLICATIONS
-- ============================================================================
-- An applicant sees their own applications; the brand sees everything on its
-- own project.

CREATE POLICY "tropical_applications_read" ON public.tropical_applications
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR public.tropical_is_brand(project_id, (SELECT auth.uid()))
  );

CREATE POLICY "tropical_applications_insert_own" ON public.tropical_applications
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- Applicant can withdraw; brand can accept/reject.
CREATE POLICY "tropical_applications_update" ON public.tropical_applications
  FOR UPDATE USING (
    user_id = (SELECT auth.uid())
    OR public.tropical_is_brand(project_id, (SELECT auth.uid()))
  );

-- ============================================================================
-- CONTRACTS  — visible to every member, mutable only by the brand
-- ============================================================================

CREATE POLICY "tropical_contracts_read" ON public.tropical_contracts
  FOR SELECT USING (public.tropical_is_member(project_id, (SELECT auth.uid())));

CREATE POLICY "tropical_contracts_brand_write" ON public.tropical_contracts
  FOR ALL USING (public.tropical_is_brand(project_id, (SELECT auth.uid())))
  WITH CHECK (public.tropical_is_brand(project_id, (SELECT auth.uid())));

CREATE POLICY "tropical_contract_signatures_read" ON public.tropical_contract_signatures
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tropical_contracts c
      WHERE c.id = contract_id
        AND public.tropical_is_member(c.project_id, (SELECT auth.uid()))
    )
  );

-- Members sign for themselves only.
CREATE POLICY "tropical_contract_signatures_sign_own" ON public.tropical_contract_signatures
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- ESCROW  — read-only to members; every mutation is server-side (service role)
-- ============================================================================

CREATE POLICY "tropical_project_escrows_read" ON public.tropical_project_escrows
  FOR SELECT USING (public.tropical_is_member(project_id, (SELECT auth.uid())));

CREATE POLICY "tropical_escrow_holds_read" ON public.tropical_escrow_holds
  FOR SELECT USING (public.tropical_is_member(project_id, (SELECT auth.uid())));

CREATE POLICY "tropical_role_events_read" ON public.tropical_role_events
  FOR SELECT USING (public.tropical_is_member(project_id, (SELECT auth.uid())));

CREATE POLICY "tropical_role_events_insert" ON public.tropical_role_events
  FOR INSERT WITH CHECK (
    actor_id = (SELECT auth.uid())
    AND public.tropical_is_member(project_id, (SELECT auth.uid()))
  );

-- ============================================================================
-- WALLET  — strictly own-rows. Credits are written server-side.
-- ============================================================================

CREATE POLICY "tropical_user_balances_read_own" ON public.tropical_user_balances
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "tropical_balance_transactions_read_own" ON public.tropical_balance_transactions
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- PUBLIC BRIEFS VIEW
-- ============================================================================
-- The only tropical surface a non-member can read. Deliberately omits
-- percentage and amount: the card shows the total pot and the open role
-- titles, never the split.
--
-- security_invoker = false is intentional. The view is the sanctioned
-- projection past the members-only policies above; Supabase's linter flags
-- this pattern, and here it is the mechanism, not an oversight.
--
-- DROP then CREATE, not CREATE OR REPLACE. apply.mjs re-runs every file on
-- every invocation, and migration 025 adds tenant_id to this view — so on the
-- second run CREATE OR REPLACE was being asked to remove a column from an
-- existing view, which Postgres refuses outright:
--
--   42P16 cannot drop columns from view
--
-- That aborted 002 and skipped every migration after it. Dropping first makes
-- the file re-runnable regardless of what later migrations reshape this into;
-- 025 runs afterwards in the same pass and restores the tenant-scoped
-- definition, so the end state is unchanged.
--
-- 011 and 014 already create their views this way for the same reason.
DROP VIEW IF EXISTS public.tropical_public_briefs;

CREATE VIEW public.tropical_public_briefs
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.brand_id,
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
  AND p.status IN ('pending_payment', 'active');

COMMENT ON VIEW public.tropical_public_briefs IS
  'Public briefs feed. Total budget and role titles only — never the per-role split.';

GRANT SELECT ON public.tropical_public_briefs TO anon, authenticated;

COMMIT;
