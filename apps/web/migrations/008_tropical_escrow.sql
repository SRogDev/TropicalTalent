-- ============================================================================
-- TROPICAL ESCROW RPCs
-- ============================================================================
-- Two operations, both atomic:
--
--   tropical_open_escrow      — called when the brand starts checkout. Creates
--                             the escrow record and one hold per role.
--   tropical_mark_escrow_funded — called once payment provider confirms payment. Flips the
--                             project to active, which is what unlocks the
--                             group channel (see tropical_can_access_channel).
--
-- Both are SECURITY DEFINER. open_escrow pins to auth.uid() and verifies the
-- caller owns the project. mark_escrow_funded is keyed on the payment provider
-- payment_intent_id and is intended for the service role only, so it does not
-- consult auth.uid() — EXECUTE is granted to service_role alone.
--
-- mark_escrow_funded is idempotent: payment provider delivers webhooks at least once, and
-- the confirm-on-return path can race the webhook for the same payment. Both
-- callers must be able to run it without double-posting bot messages or
-- double-unlocking.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Open escrow: one row per project, one hold per role.
--
-- 016_tropical_escrow_session_id.sql later renames this function's second
-- parameter (p_payment_intent_id -> p_checkout_session_id). Postgres refuses
-- to rename a parameter via CREATE OR REPLACE, so on any replay after 016 has
-- run, this file's own CREATE OR REPLACE below would fail with 42P13 unless
-- the function is dropped first. This DROP is a no-op on a database that has
-- never run 016.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tropical_open_escrow(uuid, text, bigint, bigint);

CREATE OR REPLACE FUNCTION public.tropical_open_escrow(
  p_project           uuid,
  p_payment_intent_id text,
  p_total             bigint,
  p_platform_fee      bigint
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
      (project_id, payment_intent_id, total_amount, platform_fee, status)
    VALUES
      (p_project, p_payment_intent_id, p_total, p_platform_fee, 'pending')
    RETURNING id INTO v_escrow;
  ELSE
    UPDATE public.tropical_project_escrows
    SET payment_intent_id = p_payment_intent_id,
        total_amount      = p_total,
        platform_fee      = p_platform_fee,
        updated_at        = now()
    WHERE id = v_escrow AND status = 'pending';
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

-- ---------------------------------------------------------------------------
-- Mark funded: unlocks the project. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_mark_escrow_funded(
  p_payment_intent_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow  uuid;
  v_project uuid;
  v_status  text;
BEGIN
  SELECT id, project_id, status
    INTO v_escrow, v_project, v_status
  FROM public.tropical_project_escrows
  WHERE payment_intent_id = p_payment_intent_id
  FOR UPDATE;

  IF v_escrow IS NULL THEN
    RAISE EXCEPTION 'no escrow for payment intent %', p_payment_intent_id
      USING ERRCODE = '22023';
  END IF;

  -- Already processed by whichever of the webhook / return-path got here
  -- first. Return quietly so the other caller does not error.
  IF v_status <> 'pending' THEN
    RETURN v_project;
  END IF;

  UPDATE public.tropical_project_escrows
  SET status = 'funded', funded_at = now(), updated_at = now()
  WHERE id = v_escrow;

  UPDATE public.tropical_projects
  SET status = 'active', updated_at = now()
  WHERE id = v_project;

  -- Bot confirmation, and the message that opens the group channel.
  INSERT INTO public.tropical_channel_messages (channel_id, project_id, sender_id, kind, content)
  SELECT c.id, v_project, NULL, 'escrow',
         CASE c.type
           WHEN 'bot' THEN jsonb_build_object(
             'event', 'escrow_funded',
             'text',  'Escrow secured. Group channel unlocked. Production is live.')
           ELSE jsonb_build_object(
             'event', 'group_opened',
             'text',  'Group channel is open. Reviews, standups and delivery happen here.')
         END
  FROM public.tropical_channels c
  WHERE c.project_id = v_project AND c.type IN ('bot', 'group');

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_open_escrow(uuid, text, bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_open_escrow(uuid, text, bigint, bigint) TO authenticated;

-- Service role only: this bypasses ownership checks by design, because the
-- caller is the payment provider's webhook, not a signed-in user.
REVOKE ALL ON FUNCTION public.tropical_mark_escrow_funded(text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_mark_escrow_funded(text) TO service_role;

COMMIT;
