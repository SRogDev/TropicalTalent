-- Migration: Create chat-media bucket for images and documents in chat
-- Public bucket with 20MB max file size

BEGIN;

-- Step 1: Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  true,
  20971520,  -- 20MB in bytes
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Policy - Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload chat media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-media');

-- Step 3: Policy - Allow public read access
CREATE POLICY "Public read access for chat media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'chat-media');

-- Step 4: Policy - Allow users to delete their own uploads (optional, for cleanup)
CREATE POLICY "Users can delete own chat media"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'chat-media' AND auth.uid()::text = (storage.foldername(name))[1]);

COMMIT;

-- Verification queries (run after migration):
/*
-- 1. Verify bucket exists
SELECT * FROM storage.buckets WHERE id = 'chat-media';

-- 2. Verify policies exist
SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE '%chat media%';
*/
