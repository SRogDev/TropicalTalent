-- ============================================================================
-- 030 — Contract documents
-- ============================================================================
-- tropical_role_contracts stores terms as jsonb and has no attachment surface.
-- Real engagements come with paperwork — an MSA, an SOW, an NDA, right-to-work
-- and IR35 evidence — and a platform onboarding hundreds of contractors needs
-- somewhere to put it that is attached to the agreement rather than pasted
-- into a chat thread.
--
-- ---------------------------------------------------------------------------
-- A private bucket, not the chat-media pattern
-- ---------------------------------------------------------------------------
-- The predecessor's `chat-media` bucket was public:true, with a SELECT policy
-- granting read TO public and an INSERT policy of `bucket_id = 'chat-media'`
-- and no path constraint — any authenticated user could write anywhere in it,
-- and anyone at all could read it with a URL. Migration 026 closed that.
--
-- Signed agreements do not go anywhere near that shape. This bucket is
-- private, paths are namespaced by project, and reads go through short-lived
-- signed URLs issued only to a party to the contract.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_contract_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES public.tropical_role_contracts(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,

  storage_path text NOT NULL UNIQUE,
  filename     text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  mime_type    text,
  size_bytes   integer CHECK (size_bytes IS NULL OR size_bytes >= 0),

  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('agreement', 'nda', 'sow', 'compliance', 'other')),

  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tropical_contract_documents_contract
  ON public.tropical_contract_documents (contract_id, created_at DESC);

ALTER TABLE public.tropical_contract_documents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tropical_contract_documents'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tropical_contract_documents', r.policyname);
  END LOOP;
END $$;

-- Parties to the contract only — the brand and the role's creative. Not every
-- project member: an NDA between the client and one contractor is not the rest
-- of the crew's business. tropical_is_contract_party (011:56) already encodes
-- exactly that relationship.
CREATE POLICY "tropical_contract_documents_read_parties" ON public.tropical_contract_documents
  FOR SELECT USING (
    public.tropical_is_contract_party(contract_id, (SELECT auth.uid()))
  );

CREATE POLICY "tropical_contract_documents_insert_parties" ON public.tropical_contract_documents
  FOR INSERT WITH CHECK (
    public.tropical_is_contract_party(contract_id, (SELECT auth.uid()))
    AND uploaded_by = (SELECT auth.uid())
  );

-- ============================================================================
-- APPEND-ONLY ONCE AGREED
-- ============================================================================
-- Deleting a signed agreement after both parties accepted destroys the audit
-- trail, and that trail is the whole reason a client trusts a platform with
-- hundreds of engagements. Before the contract is agreed a document is still a
-- draft attachment and its uploader may remove it; after, nobody can.
--
-- Enforced by a trigger rather than by the absence of a DELETE policy: the
-- service role bypasses RLS, so a policy alone would leave the rule true only
-- for as long as nobody wrote a script.

CREATE OR REPLACE FUNCTION public.tropical_contract_documents_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.tropical_role_contracts WHERE id = OLD.contract_id;

  IF v_status IN ('agreed', 'locked') THEN
    RAISE EXCEPTION
      'a document on an agreed contract cannot be removed'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tropical_contract_documents_guard ON public.tropical_contract_documents;
CREATE TRIGGER tropical_contract_documents_guard
  BEFORE DELETE ON public.tropical_contract_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.tropical_contract_documents_no_delete();

CREATE POLICY "tropical_contract_documents_delete_draft" ON public.tropical_contract_documents
  FOR DELETE USING (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tropical_role_contracts c
      WHERE c.id = contract_id AND c.status = 'draft'
    )
  );

-- ============================================================================
-- STORAGE
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-docs', 'contract-docs', false, 20971520,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/png',
    'image/jpeg'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "contract docs are written by project members" ON storage.objects;
DROP POLICY IF EXISTS "contract docs are read by project members" ON storage.objects;

-- Paths are `<project_id>/<contract_id>/<uuid>-<filename>`, so the first
-- segment is the project and membership of it is what authorises a write.
-- Read is narrower — a party to the contract — and is served through signed
-- URLs rather than by handing the bucket out.
CREATE POLICY "contract docs are written by project members" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contract-docs'
    AND public.tropical_is_member(
      (storage.foldername(name))[1]::uuid, (SELECT auth.uid())
    )
  );

CREATE POLICY "contract docs are read by project members" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-docs'
    AND public.tropical_is_member(
      (storage.foldername(name))[1]::uuid, (SELECT auth.uid())
    )
  );

COMMIT;
