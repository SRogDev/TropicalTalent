-- Migration: add reengagement_sent_at to public.users
-- Purpose: Track which users have already received the reengagement email (send-once dedup)
-- Run in: Supabase SQL Editor

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS reengagement_sent_at TIMESTAMPTZ;

-- Partial index for fast lookup of users who haven't been sent the email yet
CREATE INDEX IF NOT EXISTS users_reengagement_unsent_idx
  ON public.users (id)
  WHERE reengagement_sent_at IS NULL;

COMMENT ON COLUMN public.users.reengagement_sent_at IS
  'Timestamp when the reengagement email was sent. NULL means eligible to receive it.';
