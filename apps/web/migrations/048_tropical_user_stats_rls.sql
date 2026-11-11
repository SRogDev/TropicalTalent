-- ============================================================================
-- 048 — Give user_stats a read policy, and pin two mutable search_paths
-- ============================================================================
-- public.user_stats has had RLS ENABLED and ZERO POLICIES. RLS with no policy
-- is deny-all for everything except the service role, so every read through the
-- user's own client returned nothing — silently, because PostgREST renders a
-- blocked embed as null rather than raising.
--
-- Three shipping reads were affected, and all three simply showed blanks:
--   modules/identity/queries.ts:168   the profile's own Projects / Earned stats
--   modules/talent/queries.ts:45      stats:user_stats(jobs_done) per talent card
--   modules/briefs/queries.ts:183     the same embed on the briefs feed
--
-- The 50 rows were there the whole time; nothing could read them.
--
-- The policy mirrors creative_data's, which is the closest analogue and is
-- already the shape the app assumes: readable by all, writable by nobody.
-- There is deliberately NO insert/update/delete policy — these are DERIVED
-- figures maintained by server-side code holding the service role (which
-- bypasses RLS), and a user must never be able to write their own job count or
-- lifetime earnings.
--
-- NOTE for whoever applies this: read-all makes user_stats.total_revenue
-- fetchable by any caller via PostgREST. The profile UI already rendered an
-- "Earned" figure on OTHER people's profiles (profile-view.tsx:288) — it was
-- just always blank because of this very bug, so nobody had noticed. The same
-- commit gates that stat to isOwnProfile, so fixing the blank does not become
-- an accidental disclosure of everyone's earnings.
-- ============================================================================

BEGIN;

CREATE POLICY user_stats_read_all
  ON public.user_stats
  FOR SELECT
  USING (true);

COMMIT;

-- Verification after applying:
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname='public' AND tablename='user_stats';   -- 1
