-- Migration: Create contracts bucket for contract documents in quotes
-- Public bucket with 20MB max file size
-- Also adds documents column to collaborations table

BEGIN;

-- Step 1: Create the contracts storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  true,
  20971520,  -- 20MB in bytes
  ARRAY[
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Policy - Allow authenticated users to upload contract documents
CREATE POLICY "Authenticated users can upload contract documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'contracts');

-- Step 3: Policy - Allow public read access for contract documents
CREATE POLICY "Public read access for contract documents"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'contracts');

-- Step 4: Policy - Allow users to delete their own contract uploads
CREATE POLICY "Users can delete own contract documents"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Step 5: Add documents column to collaborations table (JSONB for flexibility)
ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS documents JSONB;

COMMIT;

-- Verification queries (run after migration):
/*
-- 1. Verify bucket exists
SELECT * FROM storage.buckets WHERE id = 'contracts';

-- 2. Verify policies exist
SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE '%contract%';

-- 3. Verify documents column exists on collaborations
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'collaborations' AND column_name = 'documents';
*/
