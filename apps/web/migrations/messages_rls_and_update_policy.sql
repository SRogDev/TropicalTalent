-- Migration: Add UPDATE RLS policy for pending quote messages
-- Purpose: Allow both participants of a connection to renegotiate (edit) a pending quote
-- Pre-existing SELECT, INSERT, DELETE policies are NOT touched here.
-- Security: WITH CHECK keeps status='pending', blocking escalation to 'paid' at DB level.
-- Note: (SELECT auth.uid()) used instead of auth.uid() for performance (single eval per query)

CREATE POLICY "Connection participants can update pending quote messages"
ON public.messages
FOR UPDATE
USING (
  type = 'quote'
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.id = messages.connection_id
      AND ((SELECT auth.uid()) = c.user_id OR (SELECT auth.uid()) = c.partner_id)
  )
)
WITH CHECK (
  type = 'quote'
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.id = messages.connection_id
      AND ((SELECT auth.uid()) = c.user_id OR (SELECT auth.uid()) = c.partner_id)
  )
);
