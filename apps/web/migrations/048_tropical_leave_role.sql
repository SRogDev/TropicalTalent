-- ============================================================================
-- 048 — A creative can leave a role before the money is committed
-- ============================================================================
-- Until now the only way out of an ACCEPTED role was to ask the brand to
-- remove you, or to have never accepted in the first place. Declining an
-- invitation detached a creative cleanly (012), but once they had said yes
-- there was no door — even though nothing had been paid and the brand could
-- still swap them out on a whim with tropical_assign_role.
--
-- So a creative can now leave, with exactly the decline semantics: the seat
-- goes back on the market, their DM for it goes, and their membership goes
-- unless another role on the project keeps them there. The gate is the same
-- one every other pre-commitment write uses — a pot before escrow is funded,
-- a retainer role before it activates. After that, money has been taken
-- against these terms, and the route out is the complaint form, where a
-- human decides who is owed what.
--
-- ---------------------------------------------------------------------------
-- The contract goes with them
-- ---------------------------------------------------------------------------
-- tropical_role_contracts is one row per ROLE, not per pairing. When a role
-- changes hands the old row survived: the replacement creative inherited the
-- leaver's negotiated scope, their acceptance flag, and — if both sides had
-- accepted — an 'agreed' status they had never seen. Leaving deletes the
-- role's contract, and tropical_assign_role is amended below to do the same
-- whenever the assignee actually changes, since that was the same bug from
-- the brand's side.
--
-- ---------------------------------------------------------------------------
-- The hold goes with them too
-- ---------------------------------------------------------------------------
-- tropical_open_escrow writes one hold per role, with the creative's id
-- snapshotted, the moment checkout STARTS — and on a retry only inserts the
-- holds that are missing. So a brand who opens checkout, closes the tab, and
-- comes back after the seat changed hands (a leaver, a decline, a swap) pays
-- against a hold that still names the previous creative, and
-- tropical_release_role pays whoever the hold names. Section 4 makes a re-open
-- bring every existing held hold back in line with its role. 047 did the
-- amounts from the budget editor's side; this is the same fix from the
-- checkout's side, and covers who as well as how much.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The notification kind — 046's list plus 'role_left', through 020's helper
-- ---------------------------------------------------------------------------
SELECT public.tropical_set_notification_kinds(ARRAY[
  'application_received', 'application_unlocked', 'application_decided',
  'deliverables_updated', 'contract_updated', 'role_invited', 'escrow_funded',
  'dispute_raised', 'dispute_resolved', 'withdrawal_completed', 'withdrawal_failed',
  'role_delivered', 'role_released', 'project_completed', 'member_removed',
  'project_deleted', 'application_withdrawn', 'referral_redeemed',
  'complaint_raised', 'project_delete_requested', 'card_saved',
  'role_left'
]);

-- ---------------------------------------------------------------------------
-- 2. Leaving
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tropical_leave_role(p_role uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_project   uuid;
  v_brand     uuid;
  v_holder    uuid;
  v_status    text;
  v_title     text;
  v_name      text;
  v_pstatus   text;
  v_model     text;
  v_activated timestamptz;
  v_escrow    text;
  v_who       text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, r.assigned_user_id, r.status, r.title, r.pay_model, r.activated_at,
         p.brand_id, p.name, p.status
    INTO v_project, v_holder, v_status, v_title, v_model, v_activated,
         v_brand, v_name, v_pstatus
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role
  FOR UPDATE OF r;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF v_holder IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'this role is not yours' USING ERRCODE = '42501';
  END IF;

  -- An invitation is answered with tropical_respond_to_invite; everything past
  -- 'accepted' means work has been delivered or paid against this seat.
  IF v_status = 'invited' THEN
    RAISE EXCEPTION 'decline the invitation instead' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'accepted' THEN
    RAISE EXCEPTION 'this role can no longer be left' USING ERRCODE = '22023';
  END IF;

  -- The commitment gate, both shapes. A pot's status flips to 'active' when
  -- escrow funds; the escrow row is checked as well so a payment the webhook
  -- has recorded but the project status has not yet caught up with cannot
  -- slip through.
  IF v_model = 'recurring' THEN
    IF v_activated IS NOT NULL THEN
      RAISE EXCEPTION 'this engagement is running - raise a complaint to leave it'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT e.status INTO v_escrow
    FROM public.tropical_project_escrows e
    WHERE e.project_id = v_project;

    IF v_pstatus NOT IN ('draft', 'pending_payment')
       OR v_escrow IN ('funded', 'partially_released', 'released') THEN
      RAISE EXCEPTION 'escrow is funded - raise a complaint to leave this project'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(u.name, u.username, 'The creative') INTO v_who
  FROM public.users u WHERE u.id = v_caller;

  UPDATE public.tropical_project_roles
  SET assigned_user_id = NULL, status = 'open', updated_at = now()
  WHERE id = p_role;

  DELETE FROM public.tropical_role_contracts WHERE role_id = p_role;

  DELETE FROM public.tropical_channels
  WHERE role_id = p_role AND type = 'dm';

  DELETE FROM public.tropical_project_members m
  WHERE m.project_id = v_project
    AND m.user_id = v_caller
    AND m.member_role = 'creative'
    AND NOT EXISTS (
      SELECT 1 FROM public.tropical_project_roles r2
      WHERE r2.project_id = v_project
        AND r2.assigned_user_id = v_caller
        AND r2.id <> p_role
    );

  INSERT INTO public.tropical_notifications
    (user_id, project_id, kind, title, body, actor_id)
  VALUES (
    v_brand, v_project, 'role_left',
    v_who || ' left ' || v_title,
    v_name || ' - the role is open again.',
    v_caller
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_leave_role(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_leave_role(uuid) TO authenticated;

COMMENT ON FUNCTION public.tropical_leave_role(uuid) IS
  'A creative leaves an accepted role before escrow (or the retainer) commits: seat reopened, contract and DM removed, membership kept only if they hold another role. Notifies the brand.';

-- ---------------------------------------------------------------------------
-- 3. tropical_assign_role — 011's body, plus: a change of hands drops the
--    previous contract.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tropical_assign_role(p_role uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_project  uuid;
  v_title    text;
  v_previous uuid;
  v_status   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, r.title, r.assigned_user_id, p.status
    INTO v_project, v_title, v_previous, v_status
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.tropical_is_brand(v_project, v_caller) THEN
    RAISE EXCEPTION 'only the project owner can change the crew' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow is funded — renegotiate to change this role'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_project_roles
  SET assigned_user_id = p_user,
      status           = CASE WHEN p_user IS NULL THEN 'open' ELSE 'invited' END,
      updated_at       = now()
  WHERE id = p_role;

  -- The previous holder loses their membership unless they hold another role
  -- on the same project — and the contract they negotiated goes with them.
  -- It was between the brand and THEM; the next person starts from blank.
  IF v_previous IS NOT NULL AND v_previous IS DISTINCT FROM p_user THEN
    DELETE FROM public.tropical_role_contracts WHERE role_id = p_role;

    DELETE FROM public.tropical_project_members m
    WHERE m.project_id = v_project
      AND m.user_id = v_previous
      AND m.member_role = 'creative'
      AND NOT EXISTS (
        SELECT 1 FROM public.tropical_project_roles r2
        WHERE r2.project_id = v_project
          AND r2.assigned_user_id = v_previous
          AND r2.id <> p_role
      );
  END IF;

  IF p_user IS NOT NULL THEN
    -- A DM channel per assigned role. The partial unique index on
    -- (role_id) WHERE type = 'dm' makes a duplicate impossible, so a
    -- re-assignment reuses the existing thread rather than orphaning it.
    INSERT INTO public.tropical_channels (project_id, type, name, role_id)
    VALUES (v_project, 'dm', v_title, p_role)
    ON CONFLICT DO NOTHING;

    UPDATE public.tropical_channels SET name = v_title
    WHERE role_id = p_role AND type = 'dm';

    INSERT INTO public.tropical_project_members (project_id, user_id, member_role, role_id)
    VALUES (v_project, p_user, 'creative', p_role)
    ON CONFLICT (project_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id;

    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    SELECT p_user, v_project, 'role_invited',
           'You have been added to ' || p.name,
           'Role: ' || v_title,
           v_caller
    FROM public.tropical_projects p WHERE p.id = v_project;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_assign_role(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_assign_role(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. tropical_open_escrow — 016's body, plus: a re-open re-syncs the holds that
--    already exist to the roles as they are NOW.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tropical_open_escrow(
  p_project             uuid,
  p_checkout_session_id text,
  p_total               bigint,
  p_platform_fee        bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_escrow uuid;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status
  FROM public.tropical_projects
  WHERE id = p_project AND brand_id = v_user;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'project not found or not yours' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow already handled for this project' USING ERRCODE = '22023';
  END IF;

  -- Reuse the existing escrow row if the brand abandoned a previous checkout
  -- and came back, rather than stacking orphaned escrows against one project.
  SELECT id INTO v_escrow
  FROM public.tropical_project_escrows
  WHERE project_id = p_project;

  IF v_escrow IS NULL THEN
    INSERT INTO public.tropical_project_escrows
      (project_id, checkout_session_id, total_amount, platform_fee, status)
    VALUES
      (p_project, p_checkout_session_id, p_total, p_platform_fee, 'pending')
    RETURNING id INTO v_escrow;
  ELSE
    UPDATE public.tropical_project_escrows
    SET checkout_session_id = p_checkout_session_id,
        total_amount        = p_total,
        platform_fee        = p_platform_fee,
        updated_at          = now()
    WHERE id = v_escrow AND status = 'pending';

    -- Holds left by the abandoned attempt mirror the roles as they WERE. The
    -- roles are what the brand is about to pay for, so the holds follow them:
    -- who is in the seat, and for how much.
    UPDATE public.tropical_escrow_holds h
    SET creative_id = r.assigned_user_id,
        amount      = r.amount,
        updated_at  = now()
    FROM public.tropical_project_roles r
    WHERE h.role_id = r.id
      AND h.escrow_id = v_escrow
      AND h.status = 'held'
      AND (h.creative_id IS DISTINCT FROM r.assigned_user_id OR h.amount <> r.amount);
  END IF;

  -- One hold per role. The partial unique index on (role_id) WHERE
  -- status = 'held' makes a second live hold for a role impossible, so a
  -- retried checkout cannot duplicate the split.
  INSERT INTO public.tropical_escrow_holds
    (escrow_id, project_id, role_id, creative_id, amount, status)
  SELECT v_escrow, p_project, r.id, r.assigned_user_id, r.amount, 'held'
  FROM public.tropical_project_roles r
  WHERE r.project_id = p_project
    AND NOT EXISTS (
      SELECT 1 FROM public.tropical_escrow_holds h
      WHERE h.role_id = r.id AND h.status = 'held'
    );

  RETURN v_escrow;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_open_escrow(uuid, text, bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_open_escrow(uuid, text, bigint, bigint) TO authenticated;

COMMIT;
