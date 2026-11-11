-- Add deliverables, revisions, and usage columns to collaborations table
-- These columns store the quote details when a quote is accepted

ALTER TABLE public.collaborations
ADD COLUMN IF NOT EXISTS deliverables TEXT,
ADD COLUMN IF NOT EXISTS revisions TEXT,
ADD COLUMN IF NOT EXISTS usage TEXT;

COMMENT ON COLUMN public.collaborations.deliverables IS 'What is included in this quote/collaboration';
COMMENT ON COLUMN public.collaborations.revisions IS 'Terms regarding revisions and changes';
COMMENT ON COLUMN public.collaborations.usage IS 'Usage rights and conditions';
