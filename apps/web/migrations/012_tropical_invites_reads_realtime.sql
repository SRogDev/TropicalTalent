-- ============================================================================
-- TROPICAL — INVITES, READ TRACKING, AND THE REST OF REALTIME
-- ============================================================================
-- Three gaps this closes:
--
--   1. An invited creative had no way to answer. tropical_assign_role set the
--      role to 'invited' and wrote a notification, but nothing consumed it and
--      no accept/decline path existed — so an invitation was a dead end, and
--      /jobs listed it under "Roles you hold" as though it were already
--      agreed.
--
--   2. Unread state was not tracked at all, so the channel list could not show
--      what had moved since you last looked.
--
--   3. tropical_role_contracts and tropical_deliverables were not in the realtime
--      publication, so a contract edit by one party sat invisible to the other
--      until a manual refresh.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. INVITE RESPONSES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tropical_respond_to_invite(
  p_role     uuid,
  p_response text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project uuid;
  v_brand   uuid;
  v_holder  uuid;
  v_status  text;
  v_title   text;
  v_name    text;
  v_who     text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'invalid response %', p_response USING ERRCODE = '22023';
  END IF;

  SELECT r.project_id, r.assigned_user_id, r.status, r.title, p.brand_id, p.name
    INTO v_project, v_holder, v_status, v_title, v_brand, v_name
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role
  FOR UPDATE OF r;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  -- Only the person actually invited may answer.
  IF v_holder IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'this invitation is not yours' USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'invited' THEN
    RAISE EXCEPTION 'this invitation has already been answered' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(u.name, u.username, 'The creative') INTO v_who
  FROM public.users u WHERE u.id = v_caller;

  IF p_response = 'accepted' THEN
    UPDATE public.tropical_project_roles
    SET status = 'accepted', updated_at = now()
    WHERE id = p_role;
  ELSE
    -- Declining puts the seat back on the market and detaches them entirely:
    -- role, membership, and the DM that only existed for this pairing.
    UPDATE public.tropical_project_roles
    SET assigned_user_id = NULL, status = 'open', updated_at = now()
    WHERE id = p_role;

    DELETE FROM public.tropical_channels
    WHERE role_id = p_role AND type = 'dm';

    -- Keep membership only if they hold another role on the same project.
    DELETE FROM public.tropical_project_members m
    WHERE m.project_id = v_project
      AND m.user_id = v_caller
      AND m.member_role = 'creative'
      AND NOT EXISTS (
        SELECT 1 FROM public.tropical_project_roles r2
        WHERE r2.project_id = v_project
          AND r2.assigned_user_id = v_caller
          AND r2.id <> p_role
      );
  END IF;

  INSERT INTO public.tropical_notifications
    (user_id, project_id, kind, title, body, actor_id)
  VALUES (
    v_brand, v_project, 'application_decided',
    v_who || CASE WHEN p_response = 'accepted' THEN ' accepted ' ELSE ' declined ' END || v_title,
    v_name, v_caller
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_respond_to_invite(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_respond_to_invite(uuid, text) TO authenticated;

-- ============================================================================
-- 2. READ TRACKING
-- ============================================================================
-- One row per (user, channel) holding the timestamp they last looked. Unread
-- is then "messages newer than that", computed at read time — which cannot
-- drift the way a stored counter does when a message is deleted or arrives
-- out of order.

CREATE TABLE IF NOT EXISTS public.tropical_channel_reads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel_id   uuid NOT NULL REFERENCES public.tropical_channels(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_channel_reads_unique UNIQUE (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_tropical_channel_reads_user
  ON public.tropical_channel_reads (user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tropical_channel_reads_channel
  ON public.tropical_channel_reads (channel_id);

ALTER TABLE public.tropical_channel_reads ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tropical_channel_reads'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tropical_channel_reads', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "tropical_channel_reads_own" ON public.tropical_channel_reads
  FOR ALL USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

/**
 * Marks a channel read. Called when the user opens it.
 *
 * A function rather than a client-side upsert so the timestamp is the
 * database's, not the browser's — a device with a skewed clock would otherwise
 * mark future messages read, and they would never show as unread.
 */
CREATE OR REPLACE FUNCTION public.tropical_mark_channel_read(p_channel uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.tropical_can_access_channel(p_channel, v_caller) THEN
    RAISE EXCEPTION 'no access to that channel' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project FROM public.tropical_channels WHERE id = p_channel;

  INSERT INTO public.tropical_channel_reads (user_id, channel_id, project_id, last_read_at)
  VALUES (v_caller, p_channel, v_project, now())
  ON CONFLICT (user_id, channel_id)
  DO UPDATE SET last_read_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_mark_channel_read(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_mark_channel_read(uuid) TO authenticated;

/**
 * Unread count per channel.
 *
 * p_project NULL means every project the caller belongs to — which is what the
 * sidebar needs, and doing it as one call rather than one per project is the
 * difference between a single round trip and one for every project in the
 * tree.
 *
 * Messages the caller sent themselves never count as unread. A channel with no
 * read row at all is treated as fully unread, which is what makes a brand-new
 * DM announce itself.
 */
CREATE OR REPLACE FUNCTION public.tropical_unread_counts(p_project uuid DEFAULT NULL)
RETURNS TABLE (channel_id uuid, project_id uuid, unread bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id,
         c.project_id,
         count(m.id) FILTER (
           WHERE m.created_at > COALESCE(rd.last_read_at, '-infinity'::timestamptz)
             AND m.sender_id IS DISTINCT FROM auth.uid()
         ) AS unread
  FROM public.tropical_channels c
  LEFT JOIN public.tropical_channel_reads rd
         ON rd.channel_id = c.id AND rd.user_id = auth.uid()
  LEFT JOIN public.tropical_channel_messages m
         ON m.channel_id = c.id
  WHERE (p_project IS NULL OR c.project_id = p_project)
    AND public.tropical_can_access_channel(c.id, auth.uid())
  GROUP BY c.id, c.project_id;
$$;

REVOKE ALL ON FUNCTION public.tropical_unread_counts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_unread_counts(uuid) TO authenticated;

-- ============================================================================
-- 3. REALTIME COVERAGE
-- ============================================================================
-- Contracts and deliverables now stream, so an edit by one party lands on the
-- other's screen without a refresh. RLS still applies to the stream: a
-- contract only reaches its two parties.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tropical_role_contracts',
    'tropical_deliverables',
    'tropical_project_members'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.tropical_role_contracts  REPLICA IDENTITY FULL;
ALTER TABLE public.tropical_deliverables    REPLICA IDENTITY FULL;
ALTER TABLE public.tropical_project_members REPLICA IDENTITY FULL;

COMMIT;
