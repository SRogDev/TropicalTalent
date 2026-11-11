-- ============================================================================
-- TROPICAL DELIVERY CONFIRMATION
-- ============================================================================
-- The 'delivered' and 'approved' role_status/event_type values have existed
-- since 001, but nothing ever wrote them: tropical_release_role let a brand
-- release a role's escrow at any time, with no creative-side confirmation
-- that the work was actually done first.
--
-- This adds the missing handshake, kept separate per creative on purpose:
--
--   tropical_mark_role_delivered — the assigned creative confirms their own
--                                role is done. One role, one creative.
--   tropical_release_role        — unchanged signature, but now requires the
--                                role to be 'delivered' first. The brand's
--                                "yes" for ONE creative.
--   tropical_release_all_delivered — the brand's "yes" for every creative who
--                                has confirmed, in one call.
--
-- When the last held slice is released, the project itself flips to
-- 'completed' — this was a separate gap (tropical_projects.status could reach
-- 'completed' per its CHECK constraint, but nothing ever set it).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Creative confirms their role is done.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_mark_role_delivered(p_role uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_project  uuid;
  v_assigned uuid;
  v_status   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT project_id, assigned_user_id, status INTO v_project, v_assigned, v_status
  FROM public.tropical_project_roles
  WHERE id = p_role;

  IF v_assigned IS NULL OR v_assigned <> v_caller THEN
    RAISE EXCEPTION 'only the assigned creative can confirm delivery' USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'accepted' THEN
    RAISE EXCEPTION 'this role is not awaiting delivery' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_project_roles
  SET status = 'delivered', updated_at = now()
  WHERE id = p_role;

  INSERT INTO public.tropical_role_events (project_id, role_id, actor_id, event_type, note)
  VALUES (v_project, p_role, v_caller, 'delivered', 'Confirmed delivered by the creative.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Release one role's slice to its creative. Now requires the creative's
-- delivery confirmation first — previously this had no precondition beyond
-- an open hold, so a brand could release before any work was confirmed done.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_release_role(p_role uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_project     uuid;
  v_brand       uuid;
  v_role_status text;
  v_hold        uuid;
  v_amount      bigint;
  v_creative    uuid;
  v_escrow      uuid;
  v_fully_released boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.status INTO v_project, v_brand, v_role_status
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_brand IS NULL OR v_brand <> v_caller THEN
    RAISE EXCEPTION 'only the project owner can release funds' USING ERRCODE = '42501';
  END IF;

  IF v_role_status <> 'delivered' THEN
    RAISE EXCEPTION 'the creative has not confirmed delivery yet' USING ERRCODE = '22023';
  END IF;

  SELECT h.id, h.amount, h.creative_id INTO v_hold, v_amount, v_creative
  FROM public.tropical_escrow_holds h
  WHERE h.role_id = p_role AND h.status = 'held'
  FOR UPDATE;

  IF v_hold IS NULL THEN
    RAISE EXCEPTION 'no held escrow for this role' USING ERRCODE = '22023';
  END IF;
  IF v_creative IS NULL THEN
    RAISE EXCEPTION 'this role has no creative to pay' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_escrow_holds
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE id = v_hold;

  UPDATE public.tropical_project_roles
  SET status = 'released', updated_at = now()
  WHERE id = p_role;

  INSERT INTO public.tropical_user_balances (user_id, available, lifetime_earned)
  VALUES (v_creative, v_amount, v_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET available       = public.tropical_user_balances.available + EXCLUDED.available,
        lifetime_earned = public.tropical_user_balances.lifetime_earned + EXCLUDED.lifetime_earned,
        updated_at      = now();

  -- The partial unique index on (hold_id) WHERE type = 'escrow_release' is
  -- what stops a duplicated call crediting twice.
  INSERT INTO public.tropical_balance_transactions
    (user_id, project_id, role_id, hold_id, amount, type, status)
  VALUES (v_creative, v_project, p_role, v_hold, v_amount, 'escrow_release', 'completed')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tropical_role_events (project_id, role_id, actor_id, event_type, note)
  VALUES (v_project, p_role, v_caller, 'approved', 'Escrow released to the creative.');

  -- All slices released -> the escrow itself is done, and so is the project.
  SELECT id INTO v_escrow FROM public.tropical_project_escrows WHERE project_id = v_project;

  v_fully_released := NOT EXISTS (
    SELECT 1 FROM public.tropical_escrow_holds h
    WHERE h.escrow_id = v_escrow AND h.status = 'held'
  );

  UPDATE public.tropical_project_escrows
  SET status = CASE WHEN v_fully_released THEN 'released' ELSE 'partially_released' END,
      updated_at = now()
  WHERE id = v_escrow;

  IF v_fully_released THEN
    UPDATE public.tropical_projects
    SET status = 'completed', updated_at = now()
    WHERE id = v_project AND status = 'active';

    INSERT INTO public.tropical_channel_messages (channel_id, project_id, sender_id, kind, content)
    SELECT c.id, v_project, NULL, 'system',
           jsonb_build_object(
             'event', 'project_completed',
             'text',  'Project complete. Every role has been approved and paid out.')
    FROM public.tropical_channels c
    WHERE c.project_id = v_project AND c.type IN ('bot', 'group');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Release every delivered role on a project in one call — the brand's "yes
-- to all". Loops the single-role path above so ownership, the delivery
-- check, and the completion check all still apply per role.
--
-- 020_tropical_email_notifications.sql later changes this function's return
-- type from `integer` to a TABLE, mirroring tropical_release_role. Same
-- CREATE OR REPLACE restriction, same fix: drop first, no-op pre-020.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tropical_release_all_delivered(uuid);

CREATE OR REPLACE FUNCTION public.tropical_release_all_delivered(p_project uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  uuid;
  v_count integer := 0;
BEGIN
  FOR v_role IN
    SELECT r.id FROM public.tropical_project_roles r
    WHERE r.project_id = p_project AND r.status = 'delivered'
  LOOP
    PERFORM public.tropical_release_role(v_role);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_mark_role_delivered(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_mark_role_delivered(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tropical_release_all_delivered(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_release_all_delivered(uuid) TO authenticated;

COMMIT;
