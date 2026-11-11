-- ============================================================================
-- FIX: the locked group channel was invisible, not locked
-- ============================================================================
-- 002 gated tropical_channels SELECT on tropical_can_access_channel(), which
-- returns false for a group channel until the project is funded. That hid the
-- channel ROW from every member, including the brand, so the sidebar could not
-- render "Group Chat" with a padlock — the channel simply did not appear, and
-- the product looked like it had failed to create one.
--
-- The lock belongs on the messages, not on the channel's existence. Members
-- should see that a group channel is there and that it is locked; that is what
-- makes funding escrow feel like it unlocks something.
--
-- Split into two predicates:
--   tropical_can_see_channel    — structure. Membership (and, for a DM, being a
--                               party to it). No project-status gate.
--   tropical_can_access_channel — contents. Everything above, plus the group
--                               channel staying shut until escrow is funded.
-- ============================================================================

BEGIN;

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

  IF v_project IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.tropical_is_member(v_project, p_user) THEN
    RETURN false;
  END IF;

  -- A DM is still only visible to its two parties, funded or not.
  IF v_type = 'dm' THEN
    IF public.tropical_is_brand(v_project, p_user) THEN
      RETURN true;
    END IF;
    SELECT r.assigned_user_id INTO v_assignee
      FROM public.tropical_project_roles r WHERE r.id = v_role;
    RETURN v_assignee IS NOT DISTINCT FROM p_user;
  END IF;

  -- bot and group: visible to every member. The group channel's CONTENTS stay
  -- gated by tropical_can_access_channel below.
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_can_see_channel(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_can_see_channel(uuid, uuid) TO authenticated;

-- Channel rows: structural visibility.
DROP POLICY IF EXISTS "tropical_channels_read" ON public.tropical_channels;
CREATE POLICY "tropical_channels_read" ON public.tropical_channels
  FOR SELECT USING (public.tropical_can_see_channel(id, (SELECT auth.uid())));

-- Messages: unchanged behaviour, still gated on the funded state for groups.
-- Restated here so the pair reads as one unit.
DROP POLICY IF EXISTS "tropical_channel_messages_read" ON public.tropical_channel_messages;
CREATE POLICY "tropical_channel_messages_read" ON public.tropical_channel_messages
  FOR SELECT USING (public.tropical_can_access_channel(channel_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "tropical_channel_messages_insert" ON public.tropical_channel_messages;
CREATE POLICY "tropical_channel_messages_insert" ON public.tropical_channel_messages
  FOR INSERT WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND public.tropical_can_access_channel(channel_id, (SELECT auth.uid()))
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification: as a member of an unfunded project, the group channel row is
-- now visible while its messages are not.
-- ---------------------------------------------------------------------------
