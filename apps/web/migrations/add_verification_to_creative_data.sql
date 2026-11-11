-- Migration: Add verification column to creative_data table
-- Purpose: Enables the admin verification flow for creatives
-- Status values: 'pending' (default for new creatives), 'approved', 'rejected'

BEGIN;

-- Add verification column with default 'pending' and check constraint
ALTER TABLE public.creative_data
  ADD COLUMN IF NOT EXISTS verification TEXT NOT NULL DEFAULT 'pending'
  CHECK (verification IN ('pending', 'approved', 'rejected'));

-- Index for efficient queries (get pending list, feed filtering, proxy check)
CREATE INDEX IF NOT EXISTS idx_creative_data_verification
  ON public.creative_data(verification);

COMMIT;

-- Verification queries (run after migration):
/*
-- 1. Confirm column exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'creative_data' AND column_name = 'verification';

-- 2. Check distribution of existing records (all should be 'pending')
SELECT verification, COUNT(*) FROM creative_data GROUP BY verification;

-- 3. Confirm index
SELECT indexname FROM pg_indexes WHERE tablename = 'creative_data' AND indexname = 'idx_creative_data_verification';
*/
