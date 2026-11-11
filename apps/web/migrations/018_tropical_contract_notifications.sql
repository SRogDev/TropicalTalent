-- ============================================================================
-- TROPICAL CONTRACT CHANGE NOTIFICATIONS
-- ============================================================================
-- 'contract_updated' has been a valid tropical_notifications.kind since 010,
-- but nothing ever inserted one: saveRoleContractAction wrote directly to
-- tropical_role_contracts from the client (RLS-scoped, no way to also write a
-- notification row — those inserts are server-side only, see 011's policy
-- comment), and tropical_accept_role_contract never wrote one either. A brand
-- had no way to learn a creative had proposed or accepted contract terms
-- short of opening every role's DM.
--
-- tropical_save_role_contract replaces the client's direct upsert so the write
-- and the notification happen in one transaction. tropical_accept_role_contract
-- is extended the same way. Both only notify when the CREATIVE is the one who
-- acted — a brand editing or accepting their own contract does not need to be
-- told about it.
--
-- Both also post a message into the role's DM, from whichever party acted
-- (brand or creative — unlike the notification above, this is not one-sided).
-- Two things fall out of that for free, from machinery that already exists:
-- the channel goes bold for the other party via tropical_unread_counts (any
-- unread message does that, this is not a new mechanism), and the message
-- itself — sender, text, created_at — is a permanent, visible audit trail of
-- who changed the contract and when, right where the contract lives.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.tropical_save_role_contract(p_role uuid, p_terms jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_project  uuid;
  v_brand    uuid;
  v_assignee uuid;
  v_status   text;
  v_title    text;
  v_name     text;
  v_channel  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.assigned_user_id, p.status, r.title, p.name
    INTO v_project, v_brand, v_assignee, v_status, v_title, v_name
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF v_caller NOT IN (v_brand, COALESCE(v_assignee, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'only the two parties can edit this contract' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('active', 'completed') THEN
    RAISE EXCEPTION 'escrow is paid — this contract is locked' USING ERRCODE = '22023';
  END IF;

  -- An edit invalidates the other party's acceptance; the editor is
  -- implicitly agreeing to their own text.
  INSERT INTO public.tropical_role_contracts
    (project_id, role_id, terms, status, brand_accepted, creative_accepted, updated_by, updated_at)
  VALUES
    (v_project, p_role, p_terms, 'draft', v_caller = v_brand, v_caller = v_assignee, v_caller, now())
  ON CONFLICT (role_id) DO UPDATE
  SET terms             = EXCLUDED.terms,
      status             = 'draft',
      brand_accepted     = EXCLUDED.brand_accepted,
      creative_accepted  = EXCLUDED.creative_accepted,
      updated_by         = EXCLUDED.updated_by,
      updated_at         = EXCLUDED.updated_at;

  SELECT id INTO v_channel FROM public.tropical_channels WHERE role_id = p_role AND type = 'dm';
  IF v_channel IS NOT NULL THEN
    INSERT INTO public.tropical_channel_messages (channel_id, project_id, sender_id, kind, content)
    VALUES (
      v_channel, v_project, v_caller, 'contract',
      jsonb_build_object('event', 'contract_updated', 'text', 'Updated the contract terms.')
    );
  END IF;

  IF v_caller = v_assignee THEN
    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    VALUES (
      v_brand, v_project, 'contract_updated',
      'Contract updated — ' || v_title,
      'New terms proposed for ' || v_name || '. Review them in the role chat.',
      v_caller
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_save_role_contract(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_save_role_contract(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Accept: same body as 011, plus a notification when the creative accepts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_accept_role_contract(p_role uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_project  uuid;
  v_brand    uuid;
  v_assignee uuid;
  v_status   text;
  v_title    text;
  v_name     text;
  v_channel  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.assigned_user_id, p.status, r.title, p.name
    INTO v_project, v_brand, v_assignee, v_status, v_title, v_name
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF v_caller NOT IN (v_brand, COALESCE(v_assignee, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'only the two parties can accept this contract' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow is paid — this contract is locked' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_role_contracts
  SET brand_accepted    = brand_accepted    OR (v_caller = v_brand),
      creative_accepted = creative_accepted OR (v_caller = v_assignee),
      status = CASE
        WHEN (brand_accepted    OR v_caller = v_brand)
         AND (creative_accepted OR v_caller = v_assignee)
        THEN 'agreed' ELSE status END,
      updated_at = now()
  WHERE role_id = p_role;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no contract drafted for this role yet' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_channel FROM public.tropical_channels WHERE role_id = p_role AND type = 'dm';
  IF v_channel IS NOT NULL THEN
    INSERT INTO public.tropical_channel_messages (channel_id, project_id, sender_id, kind, content)
    VALUES (
      v_channel, v_project, v_caller, 'contract',
      jsonb_build_object('event', 'contract_accepted', 'text', 'Accepted the contract terms.')
    );
  END IF;

  IF v_caller = v_assignee THEN
    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    VALUES (
      v_brand, v_project, 'contract_updated',
      'Contract accepted — ' || v_title,
      'The creative accepted the contract terms for ' || v_name || '.',
      v_caller
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_accept_role_contract(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_accept_role_contract(uuid) TO authenticated;

COMMIT;
