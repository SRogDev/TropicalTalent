-- Prevent multiple active collaborations per connection
-- This ensures only ONE collaboration with status 'in_progress' can exist per connection_id
-- Multiple completed/cancelled collaborations for the same connection are allowed

CREATE UNIQUE INDEX IF NOT EXISTS collaborations_connection_active_unique_idx
ON public.collaborations(connection_id)
WHERE status = 'in_progress';
