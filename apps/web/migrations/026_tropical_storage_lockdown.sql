-- ============================================================================
-- 026 — Lock the predecessor app's public storage buckets
-- ============================================================================
-- Split out of 025 on purpose. storage.buckets is owned by
-- supabase_storage_admin, so this UPDATE can fail on permissions depending on
-- which role runs the migration. Keeping it in its own transaction means such
-- a failure costs only this file — the tenant isolation fix in 025 has already
-- committed and stays committed.
--
-- If this file fails with "permission denied for table buckets", run the same
-- statements from the Supabase SQL editor, which executes as an owner.
-- ============================================================================

BEGIN;

-- Live bucket audit, same method as docs/table-audit.md: a bucket is locked
-- only if nothing in app/modules/lib/hooks/components references it AND no
-- column in users/creative_data/waitlist holds a URL pointing at it.
--
--   avatars           38 references in users.avatar          -> STAYS PUBLIC
--   user_backstories   4 references in creative_data         -> STAYS PUBLIC
--   waitlist-photos    2 references in waitlist              -> UNCHANGED
--   pitch_decks        already private, empty                -> UNCHANGED
--
--   chat-media         0 refs, 5 objects   -> lock (predecessor's chat)
--   contracts          0 refs, 3 objects   -> lock (predecessor's contracts)
--   portfolios         0 refs, 5 objects   -> lock (portfolio_items archived)
--   events_image       0 refs, 5 objects   -> lock (events archived)
--
-- Flipping `public` to false does not delete anything. It stops
-- /storage/v1/object/public/<bucket>/... resolving for anonymous callers,
-- which is the actual exposure. Reversible:
--
--   UPDATE storage.buckets SET public = true WHERE id = '<bucket>';
--
-- chat-media mattered most: its INSERT policy was `bucket_id = 'chat-media'`
-- with no path constraint, so any authenticated user could write to any path
-- in it, and its SELECT policy granted read TO public. Under white-label that
-- is one tenant's client material readable by anyone holding a URL.

UPDATE storage.buckets
SET public = false
WHERE id IN ('chat-media', 'contracts', 'portfolios', 'events_image');

-- The permissive policies those buckets carried are what allowed anonymous
-- read and unscoped write. Private buckets still consult storage.objects
-- policies for the authenticated endpoint, so the policies have to go too.
DROP POLICY IF EXISTS "Public read access for chat media"        ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own chat media"           ON storage.objects;

COMMIT;

-- Verification after applying:
--   SELECT id, public FROM storage.buckets ORDER BY id;
--   -- avatars and user_backstories MUST still be public: users.avatar and
--   -- creative_data.backstory hold public URLs rendered straight into <img>.
