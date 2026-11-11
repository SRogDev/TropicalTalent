-- ============================================================================
-- 022 — Archive the predecessor app's tables out of `public`
-- ============================================================================
-- This app is a rebuild. The database still carries 25 tables belonging to the
-- app it replaced: nothing in app/, modules/, lib/, hooks/, components/ or
-- scripts/ reads or writes them, and no numbered migration references them as
-- a relation. Two numbered migrations mention two of them in comments, and
-- both comments confirm they are dead ("Supersedes the unused public.projects
-- table" — 001:83; "Deliberately separate from the pre-existing
-- public.notifications table" — 010:207).
--
-- The evidence for every table, and the method, is in docs/table-audit.md.
--
-- ---------------------------------------------------------------------------
-- Why SET SCHEMA and not DROP
-- ---------------------------------------------------------------------------
-- Moving out of `public` achieves the actual goal — PostgREST stops exposing
-- them, so they are no longer an API surface carrying grants and RLS nobody has
-- reviewed. Every row, index and constraint survives, and one command puts any
-- of them back:
--
--   ALTER TABLE archive.<name> SET SCHEMA public;
--
-- Several carry real data (agent_messages 300, messages 100, payments 14).
-- Dropping them is a separate decision for a later quarter; this migration
-- deliberately does not make it.
--
-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------
-- migrations/apply.mjs has no state table and re-runs every file on every
-- invocation, so this must be safe to apply repeatedly. `ALTER TABLE IF EXISTS
-- public.x` is a no-op once x has already moved out of public, which is what
-- makes the second run free.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS archive;

-- Nothing should reach in here over the API. `archive` is a holding pen, not a
-- namespace to query. PostgREST only exposes schemas it is configured for, so
-- this is belt-and-braces on top of that.
REVOKE ALL ON SCHEMA archive FROM anon, authenticated;

-- ============================================================================
-- 1. THE ONE LIVE DEPENDENCY
-- ============================================================================
-- expire_pending_quotes() is SECURITY DEFINER and references `messages`
-- unqualified, and migrations/expire_quotes_cron.sql schedules it daily at
-- 00:05 UTC. Moving `messages` while that job is scheduled would fail the job
-- every night, silently, forever. Unschedule before moving.
--
-- The scheme it implemented — chat messages of type 'quote' expiring at a
-- deadline stored in their JSONB content — has no equivalent in this app.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-pending-quotes')
  THEN
    PERFORM cron.unschedule('expire-pending-quotes');
    RAISE NOTICE 'unscheduled cron job expire-pending-quotes';
  END IF;
EXCEPTION
  -- pg_cron present but cron.job not readable by this role: leave the job
  -- alone and fail loudly rather than moving the table out from under it.
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'cannot inspect cron.job — unschedule expire-pending-quotes by hand first';
END $$;

DROP FUNCTION IF EXISTS public.expire_pending_quotes();

-- ============================================================================
-- 2. MOVE
-- ============================================================================
-- Grouped by origin so the list stays readable. Order does not matter:
-- foreign keys follow their tables across schemas.

DO $$
DECLARE
  t     text;
  moved int := 0;
  legacy CONSTANT text[] := ARRAY[
    -- v1 project system (superseded by tropical_projects and friends)
    'projects', 'project_members', 'project_messages',
    -- v1 chat / connections / collaboration
    'messages', 'connections', 'collaborations', 'revision_events',
    'feedback_messages',
    -- superseded one-for-one by a tropical_ equivalent
    'disputes', 'escrow_holds', 'payments', 'notifications',
    'email_preferences', 'referrals',
    -- superseded by creative_data.backstory
    'portfolio_items',
    -- the removed AI search microservice
    'agent_conversations', 'agent_messages', 'search_logs',
    -- removed routes
    'events', 'accelerations', 'spotlight',
    -- never-shipped subscription billing
    'subscriptions', 'subscription_plans',
    -- removed analytics
    'product_metrics', 'users_events'
  ];
BEGIN
  FOREACH t IN ARRAY legacy LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA archive', t);
      moved := moved + 1;
      RAISE NOTICE 'archived public.%', t;
    END IF;
  END LOOP;

  RAISE NOTICE 'archive complete: % table(s) moved this run', moved;
END $$;

-- ============================================================================
-- 3. NOT ARCHIVED — on purpose
-- ============================================================================
-- public.user_balances stays. It looks as dead as the rest (no code reads it;
-- the app uses tropical_user_balances) but handle_new_public_user() INSERTs into
-- it on every sign-up via the on_public_user_created trigger. Archiving it
-- breaks account creation. Retiring it means changing that trigger, which is a
-- behaviour change and not this migration's business.
--
-- The other identity tables this codebase reads but never migrates — users,
-- creative_data, brand_data, locations, user_stats, connected_payout_accounts,
-- waitlist — stay for the obvious reason.

COMMIT;

-- Verification after applying:
--   npm run verify                      -- every shipping query still passes
--   SELECT tablename FROM pg_tables WHERE schemaname = 'archive' ORDER BY 1;
--   SELECT jobname FROM cron.job;       -- expire-pending-quotes is gone
