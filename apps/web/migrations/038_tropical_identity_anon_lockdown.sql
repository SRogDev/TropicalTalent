-- ============================================================================
-- 038 — Close the anonymous read on the identity tables
-- ============================================================================
-- Audited 2026-08-27 against the live database: an unauthenticated request
-- carrying nothing but the publishable (anon) key returned every row of
-- public.users (49) and public.creative_data (36) — name, username, avatar,
-- bio, location, backstory, tags, availability, verification.
--
--   curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $ANON_KEY"
--
-- Three of those users belong ONLY to a private white-label tenant. They have
-- no classic membership, cannot sign in to TropicalTalent, and their employer's site is
-- `visibility: private` — yet their profile row was served to the open
-- internet. That is the tenant boundary leaking through a table that predates
-- it: modules/talent/queries.ts scopes the roster with an INNER embed on
-- tropical_tenant_members (024), and reading the base table walks straight
-- around that join.
--
-- ---------------------------------------------------------------------------
-- Why grants and not policies
-- ---------------------------------------------------------------------------
-- These are pre-existing identity tables. This codebase reads them and never
-- migrates them, so their policies were written by the predecessor app and are
-- not in this repo — dropping "the anon policy" would mean guessing at names
-- this migration does not own, and a policy added later under a different name
-- would silently reopen the hole.
--
-- A grant is the coarser and more durable switch: with no table privilege the
-- role is refused before RLS is consulted at all, whatever policies exist now
-- or are added later. It is the same instrument 025 used to take
-- tropical_public_briefs away from anon.
--
-- ALL, not just SELECT: probing the live API showed `anon` also holds UPDATE
-- and DELETE on both tables (PostgREST answered 204 to a no-match filter
-- rather than 401, which it only does when the role has the privilege). No
-- code path needs them — every identity write in this app runs through the
-- service role or, for the user's own row, as `authenticated`.
--
-- ---------------------------------------------------------------------------
-- What still works
-- ---------------------------------------------------------------------------
-- Nothing in this app reads a table with the anon key. lib/supabase-browser.ts
-- is used for auth and realtime only (components/waitlist/google-button.tsx,
-- hooks/use-*.ts), and realtime subscribes as the signed-in user. Server reads
-- run as `authenticated` via db() or as the service role via adminDb() — the
-- sign-in and sign-up screens resolve their tenant through adminDb(), and the
-- landing page is force-static and queries nothing.
--
-- `authenticated` is granted explicitly below rather than left to inheritance,
-- because the REVOKE ... FROM PUBLIC that follows would otherwise take the
-- privilege away from every role that only held it through PUBLIC. It keeps
-- SELECT, INSERT and UPDATE — updateProfileAction (modules/identity/
-- actions.ts:817) writes the viewer's own users row and upserts their
-- creative_data as themselves — but not DELETE, which no path performs.
--
-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--   GRANT SELECT ON public.users, public.creative_data TO anon;
--
-- Idempotent: GRANT and REVOKE are declarative, so re-running is a no-op.
-- ============================================================================

BEGIN;

-- 1. Pin what the signed-in app needs, so nothing below can take it away.
GRANT SELECT, INSERT, UPDATE ON public.users         TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.creative_data TO authenticated;

-- The service role bypasses RLS but still needs the table privilege; it is
-- granted by default on Supabase, and this makes that explicit rather than
-- assumed, because adminDb() is the only writer on the sign-up path.
GRANT ALL ON public.users         TO service_role;
GRANT ALL ON public.creative_data TO service_role;

-- 2. Take the tables away from anonymous callers.
--
-- PUBLIC as well as anon: a privilege held through PUBLIC is held by every
-- role, so revoking anon alone would leave the door open if the original grant
-- was written that way.
REVOKE ALL ON public.users         FROM anon;
REVOKE ALL ON public.creative_data FROM anon;
REVOKE ALL ON public.users         FROM PUBLIC;
REVOKE ALL ON public.creative_data FROM PUBLIC;

COMMENT ON TABLE public.users IS
  'Pre-existing identity table, read but never migrated by this app. Not readable by anon since 038: it is cross-tenant, so an anonymous read exposes members of private white-label tenants. Scope every roster read through tropical_tenant_members.';

COMMENT ON TABLE public.creative_data IS
  'Pre-existing creative profile table, cross-tenant like public.users. Not readable by anon since 038.';

COMMIT;

-- ============================================================================
-- Verify (both must be refused, and both must still work signed in)
-- ============================================================================
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     "$SUPABASE_URL/rest/v1/users?select=id&limit=1" -H "apikey: $ANON_KEY"
--   -- expect 401
--
--   npm run verify   # signs in as the seed users and exercises every read
-- ============================================================================
