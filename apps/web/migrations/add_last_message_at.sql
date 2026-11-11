-- Add last_message_at column to connections table
ALTER TABLE public.connections
ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

-- Create an index on last_message_at for faster sorting
CREATE INDEX IF NOT EXISTS connections_last_message_at_idx
ON public.connections(last_message_at DESC);

-- Update existing connections with a default timestamp (created_at)
UPDATE public.connections
SET last_message_at = created_at
WHERE last_message_at IS NULL;

-- Optional: Update last_message_at based on actual messages
-- This query finds the latest message timestamp for each connection
UPDATE public.connections c
SET last_message_at = (
  SELECT MAX(m.created_at)
  FROM public.messages m
  WHERE m.connection_id = c.id
)
WHERE EXISTS (
  SELECT 1
  FROM public.messages m
  WHERE m.connection_id = c.id
);

-- For connections without messages, use created_at
UPDATE public.connections
SET last_message_at = created_at
WHERE last_message_at IS NULL;
