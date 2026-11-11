-- Fix connected_payout_accounts.id to auto-generate UUID
-- The column exists but lacks a DEFAULT, causing null constraint violations on insert

ALTER TABLE public.connected_payout_accounts
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
