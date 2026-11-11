-- Migration: Add status column to messages table
-- Purpose: Fix quote status persistence bug by moving status out of JSONB content
-- The bug was: .update({ content: { status: 'paid' } }) replaces entire JSONB, losing title/amount/time/info

BEGIN;

-- Step 1: Add status column to messages table
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT NULL;

-- Step 2: Add check constraint for valid status values
-- For quotes: pending, paid, expired, cancelled
-- For text messages: read, unread (future use for read receipts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_status_check'
  ) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_status_check
    CHECK (status IS NULL OR status IN ('pending', 'paid', 'expired', 'cancelled', 'read', 'unread'));
  END IF;
END $$;

-- Step 3: Create index for efficient status queries
CREATE INDEX IF NOT EXISTS idx_messages_type_status
ON public.messages(type, status)
WHERE status IS NOT NULL;

-- Step 4: Data migration - Extract status from content JSONB for quote messages
-- Handle both valid quotes and corrupted quotes (those with only status in content)
UPDATE public.messages
SET status = CASE
  -- If content has status field, extract it
  WHEN content ? 'status' THEN content->>'status'
  -- If it's a quote without status field, set to 'pending'
  WHEN type = 'quote' AND NOT (content ? 'status') THEN 'pending'
  -- Otherwise leave NULL (for text messages)
  ELSE NULL
END
WHERE type = 'quote' AND status IS NULL;

-- Step 5: Remove status field from content JSONB for quotes
-- This ensures data consistency (status is only in the status column)
UPDATE public.messages
SET content = content - 'status'
WHERE type = 'quote' AND content ? 'status';

COMMIT;

-- Verification queries (run these after migration):
/*
-- 1. Verify column exists and all quotes have status
SELECT id, type, status, content FROM messages WHERE type = 'quote' LIMIT 10;

-- 2. Verify no status remains in content JSONB
SELECT COUNT(*) FROM messages WHERE type = 'quote' AND content ? 'status';
-- Should return 0

-- 3. Check status distribution
SELECT status, COUNT(*) FROM messages WHERE type = 'quote' GROUP BY status;

-- 4. Verify index exists
SELECT indexname FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_type_status';
*/
