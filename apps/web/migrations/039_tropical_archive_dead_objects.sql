-- ============================================================================
-- 039 — Archive the two dead tropical_* tables
-- ============================================================================
-- 022 cleared the predecessor app's 25 tables out of `public`. The 2026-08-27
-- audit found two more, both belonging to this app rather than the old one:
--
--   tropical_contract_signatures  0 rows. Nothing writes it — no .from() in the
--                               codebase and no INSERT in any migration. The
--                               v1 signature model; the shipping one is
--                               tropical_role_contracts, written by
--                               tropical_save_role_contract() /
--                               tropical_accept_role_contract().
--
--   tropical_tag_discipline_map   61 rows, all of them seed data from 003. Read
--                               only by the 004 backfill. Runtime never
--                               touches it, and it is one of the handful of
--                               objects anon can read.
--
-- Same rule as 022: ARCHIVE, NEVER DROP. `ALTER TABLE ... SET SCHEMA archive`
-- keeps every row, index and constraint, takes the table out of PostgREST's
-- exposed surface — the actual goal — and is reversible with one command:
--
--   ALTER TABLE archive.<name> SET SCHEMA public;
--
-- Deliberately NOT archived, though a grep would call them dead:
--
--   tropical_contracts     Written by tropical_create_project() (007:141, 032:216)
--                        on every project, in every tenant. No reader — but a
--                        table the live RPC inserts into is not dead, it is
--                        write-only, and stopping the write is a change to the
--                        RPC every project creation depends on. Separate
--                        decision, deliberately not taken here.
--   tropical_role_events   Written by six RPCs (011, 017, 020, 028) and read by
--                        nothing. Same reasoning: it is an audit trail that
--                        currently has no reader, not an unused table.
--   user_balances        Written by handle_new_public_user() on every sign-up.
--                        Archiving it breaks account creation. See 022 and
--                        docs/table-audit.md.
--
-- ---------------------------------------------------------------------------
-- Why this file also drops, and why that is not a contradiction
-- ---------------------------------------------------------------------------
-- migrations/apply.mjs has no state table: it re-runs every file, in order, on
-- every invocation. Both tables are CREATEd by earlier files — 001:273 creates
-- tropical_contract_signatures, 003:70 creates tropical_tag_discipline_map and
-- reseeds its 61 rows — so a plain SET SCHEMA would be undone by the very next
-- `npm run migrate`, which would leave a fresh empty copy sitting in `public`
-- again with 002's policies re-applied to it.
--
-- The alternative is editing 001/002/003/004 to skip tables they own, which
-- rewrites applied history in four files. This file reconciles instead, the
-- way 022 reconciled the cron job: it runs LAST, after those files have
-- recreated whatever they recreate, and removes the recreated copy — but only
-- once the archived original is safely in place, and only when the copy holds
-- nothing that the archived original does not already have.
--
-- Read the DROP as "delete the duplicate 001/003 just made", never as "drop
-- the table": the data is in `archive` before either DROP can run, and a
-- public copy carrying unexpected rows is left alone and reported instead.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS archive;
REVOKE ALL ON SCHEMA archive FROM anon, authenticated;

-- ============================================================================
-- 1. tropical_contract_signatures
-- ============================================================================
DO $$
BEGIN
  -- First run: move the original, rows and all.
  IF to_regclass('archive.tropical_contract_signatures') IS NULL THEN
    IF to_regclass('public.tropical_contract_signatures') IS NOT NULL THEN
      ALTER TABLE public.tropical_contract_signatures SET SCHEMA archive;
      RAISE NOTICE '039: tropical_contract_signatures archived';
    END IF;

  -- Later runs: 001 has recreated an empty copy in public. Remove it, unless
  -- something actually wrote to it since — in which case say so and stop
  -- touching it, because that would mean the table is not dead after all.
  ELSIF to_regclass('public.tropical_contract_signatures') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.tropical_contract_signatures) THEN
      RAISE WARNING '039: public.tropical_contract_signatures has rows and was NOT removed — something is writing to a table this migration considers dead. Investigate before re-running.';
    ELSE
      DROP TABLE public.tropical_contract_signatures;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 2. tropical_tag_discipline_map
-- ============================================================================
-- The public copy here is always exactly 003's seed list, so a recreated copy
-- is a duplicate by construction and is removed whether or not it has rows.
-- 004's backfill still joins the copy 003 just made, earlier in the same run;
-- it has never depended on the table surviving the run.
DO $$
BEGIN
  IF to_regclass('archive.tropical_tag_discipline_map') IS NULL THEN
    IF to_regclass('public.tropical_tag_discipline_map') IS NOT NULL THEN
      ALTER TABLE public.tropical_tag_discipline_map SET SCHEMA archive;
      RAISE NOTICE '039: tropical_tag_discipline_map archived';
    END IF;
  ELSIF to_regclass('public.tropical_tag_discipline_map') IS NOT NULL THEN
    -- Keep any tag 003 has since learned that the archived copy is missing, so
    -- re-running never silently loses seed data added to that file later.
    INSERT INTO archive.tropical_tag_discipline_map (tag, discipline_slug)
    SELECT m.tag, m.discipline_slug
    FROM public.tropical_tag_discipline_map m
    ON CONFLICT (tag) DO NOTHING;

    DROP TABLE public.tropical_tag_discipline_map;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verify
-- ============================================================================
--   SELECT table_schema, table_name
--   FROM information_schema.tables
--   WHERE table_name IN ('tropical_contract_signatures', 'tropical_tag_discipline_map');
--   -- expect both in `archive`, neither in `public`
--
--   npm run migrate && npm run verify
--   -- a full re-run must leave them in `archive` and every query passing
-- ============================================================================
