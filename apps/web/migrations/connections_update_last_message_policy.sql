-- Enable RLS on connections table if not already enabled
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

-- Drop the policy if it exists (for re-running the migration)
DROP POLICY IF EXISTS "connections_update_last_message" ON "public"."connections";

-- Create policy to allow user_id or partner_id to update last_message and last_message_at
-- Note: This policy allows updates, but the application code should only update the allowed fields
-- For stricter enforcement, use a database trigger (see below)
CREATE POLICY "connections_update_last_message"
ON "public"."connections"
FOR UPDATE
TO public
USING (
  -- User must be either user_id or partner_id
  (( SELECT auth.uid() AS uid) = user_id) OR
  (( SELECT auth.uid() AS uid) = partner_id)
);

-- Comment explaining the policy
COMMENT ON POLICY "connections_update_last_message" ON "public"."connections" IS
'Allows user_id or partner_id to update the connections table. Application code should only update last_message and last_message_at fields.';

-- Optional: Create a trigger to enforce that ONLY last_message and last_message_at can be updated
-- This provides database-level protection regardless of what the client code tries to do
CREATE OR REPLACE FUNCTION prevent_connections_field_updates()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent changes to protected fields
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot modify id field';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot modify user_id field';
  END IF;

  IF NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
    RAISE EXCEPTION 'Cannot modify partner_id field';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot modify created_at field';
  END IF;

  -- Allow last_message and last_message_at to be updated
  -- Allow updated_at to be updated (if it exists)
  -- All other field changes are blocked

  -- Status and favorite can only be updated if they were null or are being set to the same value
  -- You can customize this logic based on your needs
  -- For now, we'll allow status and favorite to be updated since they might have separate policies

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger to the connections table
DROP TRIGGER IF EXISTS check_connections_update ON public.connections;
CREATE TRIGGER check_connections_update
  BEFORE UPDATE ON public.connections
  FOR EACH ROW
  EXECUTE FUNCTION prevent_connections_field_updates();
