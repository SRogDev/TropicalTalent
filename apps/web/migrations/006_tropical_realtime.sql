-- ============================================================================
-- TROPICAL REALTIME
-- ============================================================================
-- Supabase only streams postgres_changes for tables that are members of the
-- supabase_realtime publication. Without this, hooks/tropical/use-project-realtime.ts
-- subscribes successfully and then silently never receives a message — the
-- failure mode is a chat that looks fine until two people use it at once.
--
-- RLS still applies to realtime: each subscriber is only sent rows their
-- policies allow. A member of a project whose escrow is unfunded receives
-- nothing from the group channel, because tropical_can_access_channel() denies
-- it, so the lock is enforced on the stream and not just in the UI.
--
-- REPLICA IDENTITY FULL is required for UPDATE/DELETE payloads to carry the
-- old row. Inserts alone do not need it, but message edits and deletions do,
-- and turning it on later means another migration.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  -- The publication is created by Supabase itself; guard in case a fresh
  -- project has not initialised it yet.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tropical_channel_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tropical_channel_messages;
  END IF;

  -- Role status drives the live team panel (accepted / delivered / released),
  -- so the brand sees a role fill without a refresh.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tropical_project_roles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tropical_project_roles;
  END IF;

  -- Escrow status unlocks the group channel. Streaming it means the channel
  -- opens for every member the moment payment settles, with no polling.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tropical_project_escrows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tropical_project_escrows;
  END IF;
END
$$;

ALTER TABLE public.tropical_channel_messages REPLICA IDENTITY FULL;
ALTER TABLE public.tropical_project_roles     REPLICA IDENTITY FULL;
ALTER TABLE public.tropical_project_escrows   REPLICA IDENTITY FULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime' AND tablename LIKE 'tropical%';
-- Expect: tropical_channel_messages, tropical_project_roles, tropical_project_escrows
