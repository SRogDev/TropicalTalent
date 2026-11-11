-- Allow participants (buyer or creative) to update their collaboration
-- The API layer enforces who can do what (buyer completes, creative cancels)

CREATE POLICY "Participants can update collaboration"
ON public.collaborations
FOR UPDATE
USING (
  (SELECT auth.uid()) = creative_id OR
  (SELECT auth.uid()) = buyer_id
);
