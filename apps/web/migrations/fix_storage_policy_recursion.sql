-- Migration: Fix infinite recursion in storage policies
-- Date: 2026-02-03
-- Problem: The user_backstories upload policy has a subquery that causes infinite recursion
-- Solution: Use the same pattern as avatars bucket (SELECT/INSERT/UPDATE/DELETE without recursive queries)

BEGIN;

-- Step 1: Drop the problematic policy that has recursive subquery
DROP POLICY IF EXISTS "Users can upload one PDF to their own folder in user_backstories"
ON storage.objects;

-- Step 2: Create READ policy - Public read access for user_backstories
CREATE POLICY "backstories_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'user_backstories'::text);

-- Step 3: Create INSERT policy - Users can upload PDFs only to their own folder
CREATE POLICY "backstories_user_write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'user_backstories'::text
  AND (storage.foldername(name))[1] = (auth.uid())::text
  AND lower(storage.extension(name)) = 'pdf'
);

-- Step 4: Create UPDATE policy - Users can update/replace their own PDF (this allows replacing the single backstory)
CREATE POLICY "backstories_user_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'user_backstories'::text
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'user_backstories'::text
  AND (storage.foldername(name))[1] = (auth.uid())::text
  AND lower(storage.extension(name)) = 'pdf'
);

-- Step 5: Create DELETE policy - Users can delete their own PDFs
CREATE POLICY "backstories_user_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'user_backstories'::text
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

COMMIT;

-- Verification queries:
-- SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE '%backstories%' ORDER BY policyname;
-- SELECT * FROM storage.buckets WHERE id = 'user_backstories';
