-- Migration: expire_quotes_cron
-- Creates a pg_cron job that daily marks expired quote messages as 'expired'.
--
-- Quotes are messages with type = 'quote' and status = 'pending'.
-- A quote expires when the current time passes the completionDeadline stored in
-- the message's content JSONB field (content->>'completionDeadline').
--
-- Prerequisites: pg_cron extension must be enabled in Supabase
-- (Dashboard → Database → Extensions → pg_cron)

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function to expire pending quotes whose completionDeadline has passed
CREATE OR REPLACE FUNCTION expire_pending_quotes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE messages
  SET
    status = 'expired',
    updated_at = NOW()
  WHERE
    type = 'quote'
    AND status = 'pending'
    AND (content->>'completionDeadline') IS NOT NULL
    AND (content->>'completionDeadline')::timestamptz < NOW();
END;
$$;

-- Schedule the function to run daily at 00:05 UTC
SELECT cron.schedule(
  'expire-pending-quotes',   -- job name (unique)
  '5 0 * * *',               -- cron expression: daily at 00:05 UTC
  $$SELECT expire_pending_quotes()$$
);
