-- ============================================================================
-- 031 — Pre-authorised tenant invites
-- ============================================================================
-- How a white-label onboards a roster it already has.
--
-- ---------------------------------------------------------------------------
-- Why not just email 600 invitations
-- ---------------------------------------------------------------------------
-- Supabase's auth invite endpoint sends a mail per address and is rate limited;
-- 600 of them is a queue, a deliverability problem, and a support thread for
-- everyone whose link expired before they got to it. It also puts TropicalTalent in the
-- middle of a conversation between a client and their own contractors.
--
-- So nothing is emailed from here. The admin pastes the roster, which records
-- who is ALLOWED to join and on what terms; the client puts the sign-in link
-- on their own website — which is how they described wanting it — and their
-- people sign up when they get to it. The invite is matched by email at
-- sign-up and applies the role and capabilities it was created with.
--
-- The side effect worth having: with `inviteOnly` set, a white-label's sign-up
-- page stops being open to the public without needing a separate gate.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_tenant_invites (
  tenant_id  uuid NOT NULL REFERENCES public.tropical_tenants(id) ON DELETE CASCADE,

  -- Stored lowercase. Email comparison is case-insensitive in practice and a
  -- roster pasted out of a spreadsheet will not be consistent about it.
  email      text NOT NULL CHECK (email = lower(email) AND position('@' in email) > 1),

  member_role text NOT NULL DEFAULT 'member'
    CHECK (member_role IN ('member', 'wl_admin')),

  -- Frozen at invite time rather than derived at sign-up from the archetype.
  -- A roster is often mixed — contractors and a couple of their managers — and
  -- the person building it knows which is which; re-deriving later would lose
  -- that and silently hand everyone the same capabilities.
  capabilities jsonb NOT NULL DEFAULT '{"brand": false, "work": true}'::jsonb,

  note       text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  claimed_at timestamptz,
  claimed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  PRIMARY KEY (tenant_id, email),
  CONSTRAINT tropical_tenant_invites_caps_is_object CHECK (jsonb_typeof(capabilities) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_tropical_tenant_invites_pending
  ON public.tropical_tenant_invites (tenant_id) WHERE claimed_at IS NULL;

-- Sign-up matches on email alone, before any tenant context exists on the row.
CREATE INDEX IF NOT EXISTS idx_tropical_tenant_invites_email
  ON public.tropical_tenant_invites (email);

ALTER TABLE public.tropical_tenant_invites ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tropical_tenant_invites'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tropical_tenant_invites', r.policyname);
  END LOOP;
END $$;

-- Only a tenant's own admins can see who has been invited to it. A roster of
-- 600 contractor email addresses is the customer's commercial information, and
-- an ordinary member of the same tenant has no business reading it.
CREATE POLICY "tropical_tenant_invites_read_admins" ON public.tropical_tenant_invites
  FOR SELECT USING (
    public.tropical_is_tenant_admin(tenant_id, (SELECT auth.uid()))
  );

-- Writes are service-role only, through the console. Sign-up claims an invite
-- via the SECURITY DEFINER function below rather than by writing directly,
-- because at that moment the caller has no session and no membership.

-- ============================================================================
-- CLAIMING
-- ============================================================================
-- Called from writeProfile() during sign-up, with the service role.
--
-- Returns the membership terms to apply, or NULL when there is no invite. The
-- caller decides what NULL means: on an inviteOnly tenant it refuses the
-- sign-up; everywhere else it falls back to the archetype defaults.
--
-- Marking claimed is not a security control — membership is — but it is what
-- lets an admin see who has actually turned up out of a roster of 600, which
-- is the only progress signal they have.

CREATE OR REPLACE FUNCTION public.tropical_claim_invite(
  p_tenant uuid,
  p_email  text,
  p_user   uuid
)
RETURNS TABLE (member_role text, capabilities jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_row   record;
BEGIN
  SELECT i.member_role, i.capabilities, i.claimed_at
    INTO v_row
  FROM public.tropical_tenant_invites i
  WHERE i.tenant_id = p_tenant AND i.email = v_email
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  -- An already-claimed invite still returns its terms. Someone who deleted
  -- their account and signed up again should land back where they were, and
  -- refusing here would strand them on /auth/no-access with no way forward.
  IF v_row.claimed_at IS NULL THEN
    UPDATE public.tropical_tenant_invites
    SET claimed_at = now(), claimed_by = p_user
    WHERE tenant_id = p_tenant AND email = v_email;
  END IF;

  RETURN QUERY SELECT v_row.member_role, v_row.capabilities;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_claim_invite(uuid, text, uuid) FROM public;

COMMIT;
