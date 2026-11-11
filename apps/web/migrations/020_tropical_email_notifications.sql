-- ============================================================================
-- TROPICAL EMAIL NOTIFICATIONS
-- ============================================================================
-- The app has had in-app notifications since 010, but nothing has ever sent
-- an email — this is the schema half of adding that. The application layer
-- (modules/notifications/email.ts) calls Resend directly after the writes
-- below succeed; nothing here talks to a third party, same separation this
-- codebase already keeps for payment provider (calls live in modules/*/actions.ts,
-- never in a migration).
--
-- Three things happen in this file:
--
--   1. tropical_notification_preferences — a new table. The only thing to
--      configure is a master on/off switch; no per-category granularity was
--      asked for. Absence of a row means "on", so no backfill is needed for
--      existing accounts.
--   2. tropical_notifications.kind gains 11 values for events that currently
--      produce no notification at all (disputes, withdrawals, delivery,
--      payout, project completion, membership changes, referrals).
--   3. Five existing SECURITY DEFINER functions are extended to write the
--      new kinds at the point they already have the data — no new queries,
--      just new INSERT statements alongside work the function already does.
--      Disputes, withdrawals, project deletion, application withdrawal and
--      referral redemption have no RPC to extend (they write directly from
--      the client/TS layer already); those five get their notification row
--      written from modules/*/actions.ts via adminDb(), the same way
--      deleteProjectAction already uses adminDb() for a privileged write a
--      user cannot make against their own RLS session.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. EMAIL PREFERENCES — one row per user, master switch only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tropical_notification_preferences (
  user_id       uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_notification_preferences IS
  'Master email on/off switch per user. No row = enabled — only opt-outs are stored.';

ALTER TABLE public.tropical_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tropical_notification_preferences_own" ON public.tropical_notification_preferences;
CREATE POLICY "tropical_notification_preferences_own" ON public.tropical_notification_preferences
  FOR ALL USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 2. NEW NOTIFICATION KINDS
-- ---------------------------------------------------------------------------
-- Setting the allowed notification kinds, replay-safe
-- ---------------------------------------------------------------------------
-- apply.mjs re-runs EVERY migration on every invocation, in order. That makes
-- any migration which NARROWS a constraint a time bomb: this file's list was
-- correct when it was written, 041 added 'complaint_raised' on top of it, and
-- the first complaint anybody raised meant re-running this file tried to
-- re-impose a list that the live data had already outgrown:
--
--   23514 check constraint "tropical_notifications_kind_check" is violated by
--         some row
--
-- The whole migration set then stops at 020 and nothing after it applies.
--
-- So the constraint is rebuilt from the union of the list the caller intends
-- and the kinds already present in the table. Grandfathering what is already
-- there is not a loophole — every one of those rows was written THROUGH this
-- constraint, so it was valid when it was inserted — and it means replaying an
-- old migration can never reject data a newer one legitimised. The newest
-- caller still decides what new kinds are allowed.
--
-- Defined here because this is the first migration that needs it; 041, 044 and
-- 046 call the same function rather than each hand-rolling a drop-and-recreate
-- that has to be kept in sync with every list that came after it.

CREATE OR REPLACE FUNCTION public.tropical_set_notification_kinds(p_kinds text[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r      record;
  v_list text;
BEGIN
  -- Lookup-then-drop: the constraint was declared inline in 010, so Postgres
  -- named it, and a guessed name that is wrong would silently leave the old
  -- constraint in place.
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tropical_notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.tropical_notifications DROP CONSTRAINT %I', r.conname);
  END LOOP;

  SELECT string_agg(quote_literal(k), ', ' ORDER BY k) INTO v_list
  FROM (
    SELECT unnest(p_kinds) AS k
    UNION
    SELECT DISTINCT n.kind FROM public.tropical_notifications n WHERE n.kind IS NOT NULL
  ) s;

  IF v_list IS NULL THEN
    RAISE EXCEPTION 'tropical_set_notification_kinds needs at least one kind';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.tropical_notifications ADD CONSTRAINT tropical_notifications_kind_check CHECK (kind IN (%s))',
    v_list
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_set_notification_kinds(text[]) FROM public;

SELECT public.tropical_set_notification_kinds(ARRAY[
  'application_received', 'application_unlocked', 'application_decided',
  'deliverables_updated', 'contract_updated', 'role_invited', 'escrow_funded',
  'dispute_raised', 'dispute_resolved', 'withdrawal_completed', 'withdrawal_failed',
  'role_delivered', 'role_released', 'project_completed', 'member_removed',
  'project_deleted', 'application_withdrawn', 'referral_redeemed'
]);

-- ============================================================================
-- 3. ESCROW FUNDED — declared since 010, never inserted. Notify the brand
--    (confirmation) and every assigned creative (the group channel just
--    unlocked for them).
--
-- Return type changes from `uuid` to a row that also says whether THIS call
-- was the one that actually performed the transition. Both the webhook and
-- the return-from-checkout action call this, and it was already idempotent
-- for the database writes (the second caller hits the early-return below) —
-- but with no way to tell the two cases apart, the TS layer could not send
-- exactly one email. `just_funded` is that signal: only the caller for whom
-- it's true should also call sendNotificationEmail().
-- ============================================================================
DROP FUNCTION IF EXISTS public.tropical_mark_escrow_funded(text, text);

CREATE OR REPLACE FUNCTION public.tropical_mark_escrow_funded(
  p_checkout_session_id text,
  p_payment_intent_id   text DEFAULT NULL
)
RETURNS TABLE (
  project_id            uuid,
  just_funded           boolean,
  brand_id              uuid,
  project_name          text,
  assigned_creative_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow  uuid;
  v_project uuid;
  v_status  text;
  v_name    text;
  v_brand   uuid;
BEGIN
  SELECT id, project_id, status
    INTO v_escrow, v_project, v_status
  FROM public.tropical_project_escrows
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF v_escrow IS NULL THEN
    RAISE EXCEPTION 'no escrow for checkout session %', p_checkout_session_id
      USING ERRCODE = '22023';
  END IF;

  -- Already processed by whichever of the webhook / return-path got here
  -- first. Return quietly, flagged false, so the other caller neither errors
  -- nor emails a second time.
  IF v_status <> 'pending' THEN
    RETURN QUERY SELECT v_project, false, NULL::uuid, NULL::text, NULL::uuid[];
    RETURN;
  END IF;

  UPDATE public.tropical_project_escrows
  SET status = 'funded',
      payment_intent_id = COALESCE(p_payment_intent_id, payment_intent_id),
      funded_at = now(),
      updated_at = now()
  WHERE id = v_escrow;

  UPDATE public.tropical_projects
  SET status = 'active', updated_at = now()
  WHERE id = v_project;

  SELECT name, brand_id INTO v_name, v_brand FROM public.tropical_projects WHERE id = v_project;

  INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body)
  VALUES (
    v_brand, v_project, 'escrow_funded',
    'Escrow funded - ' || v_name,
    v_name || ' is funded and active. The group channel is open.'
  );

  INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
  SELECT DISTINCT r.assigned_user_id, v_project, 'escrow_funded',
         'Escrow funded - ' || v_name,
         v_name || ' is funded. The group channel is open.',
         v_brand
  FROM public.tropical_project_roles r
  WHERE r.project_id = v_project AND r.assigned_user_id IS NOT NULL;

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

  RETURN QUERY
    SELECT v_project, true, v_brand, v_name,
           COALESCE(array_agg(DISTINCT r.assigned_user_id) FILTER (WHERE r.assigned_user_id IS NOT NULL), '{}')
    FROM public.tropical_project_roles r
    WHERE r.project_id = v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_mark_escrow_funded(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_mark_escrow_funded(text, text) TO service_role;

-- ============================================================================
-- 4. CONTRACT UPDATED, BRAND -> CREATIVE DIRECTION
-- ============================================================================
-- 018 only notified when the creative acted (v_caller = v_assignee). A
-- brand's own edit or acceptance told nobody. Same function bodies, plus the
-- missing branch.
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
    RAISE EXCEPTION 'escrow is paid - this contract is locked' USING ERRCODE = '22023';
  END IF;

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
      'Contract updated - ' || v_title,
      'New terms proposed for ' || v_name || '. Review them in the role chat.',
      v_caller
    );
  ELSIF v_caller = v_brand AND v_assignee IS NOT NULL THEN
    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    VALUES (
      v_assignee, v_project, 'contract_updated',
      'Contract updated - ' || v_title,
      'New terms proposed for ' || v_title || ' on ' || v_name || '. Review them in the role chat.',
      v_caller
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_save_role_contract(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_save_role_contract(uuid, jsonb) TO authenticated;

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
    RAISE EXCEPTION 'escrow is paid - this contract is locked' USING ERRCODE = '22023';
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
      'Contract accepted - ' || v_title,
      'The creative accepted the contract terms for ' || v_name || '.',
      v_caller
    );
  ELSIF v_caller = v_brand AND v_assignee IS NOT NULL THEN
    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    VALUES (
      v_assignee, v_project, 'contract_updated',
      'Contract accepted - ' || v_title,
      'The brand accepted the contract terms for ' || v_title || ' on ' || v_name || '.',
      v_caller
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_accept_role_contract(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_accept_role_contract(uuid) TO authenticated;

-- ============================================================================
-- 5. ROLE DELIVERED — the brand is currently told nothing when a creative
--    confirms their work is done, despite this being exactly the "awaiting
--    your action" moment the notification system exists for.
-- ============================================================================
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
  v_title    text;
  v_brand    uuid;
  v_name     text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, r.assigned_user_id, r.status, r.title, p.brand_id, p.name
    INTO v_project, v_assigned, v_status, v_title, v_brand, v_name
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

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

  INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
  VALUES (
    v_brand, v_project, 'role_delivered',
    'Delivered - ' || v_title,
    'The creative marked ' || v_title || ' on ' || v_name || ' as delivered. Review and release when ready.',
    v_caller
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_mark_role_delivered(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_mark_role_delivered(uuid) TO authenticated;

-- ============================================================================
-- 6. ROLE RELEASED (paid) + PROJECT COMPLETED
-- ============================================================================
-- Return type changes from `void` to a row describing what happened, for the
-- same reason as tropical_mark_escrow_funded above: the TS layer needs enough
-- to email the paid creative, and — only on the one call in a batch that
-- empties the last hold — every project member about completion, without a
-- second round trip back to the database to find out who they are.
DROP FUNCTION IF EXISTS public.tropical_release_role(uuid);

CREATE OR REPLACE FUNCTION public.tropical_release_role(p_role uuid)
RETURNS TABLE (
  creative_id    uuid,
  amount         bigint,
  role_title     text,
  out_project_id uuid,
  project_name   text,
  fully_released boolean,
  member_ids     uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_project     uuid;
  v_brand       uuid;
  v_role_status text;
  v_title       text;
  v_name        text;
  v_hold        uuid;
  v_amount      bigint;
  v_creative    uuid;
  v_escrow      uuid;
  v_fully_released boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.status, r.title, p.name
    INTO v_project, v_brand, v_role_status, v_title, v_name
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

  INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
  VALUES (
    v_creative, v_project, 'role_released',
    'Paid - ' || v_title,
    'You were paid for ' || v_title || ' on ' || v_name || '.',
    v_caller
  );

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

    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    SELECT m.user_id, v_project, 'project_completed',
           'Project complete - ' || v_name,
           v_name || ' is complete. Every role has been approved and paid out.',
           v_caller
    FROM public.tropical_project_members m
    WHERE m.project_id = v_project;
  END IF;

  RETURN QUERY
    SELECT v_creative, v_amount, v_title, v_project, v_name, v_fully_released,
           CASE WHEN v_fully_released THEN (
             SELECT COALESCE(array_agg(m.user_id), '{}'::uuid[])
             FROM public.tropical_project_members m
             WHERE m.project_id = v_project
           ) ELSE '{}'::uuid[] END;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_release_role(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_release_role(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- The brand's "yes to all". Unchanged logic (017_tropical_delivery_confirmation.sql)
-- except RETURN QUERY in place of PERFORM, now that the row it loops over
-- carries data the caller needs — one row per role released, so the TS layer
-- can email each creative, and whichever row has fully_released = true (at
-- most one, the last hold in the project) is also the project-completed
-- signal.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tropical_release_all_delivered(uuid);

CREATE OR REPLACE FUNCTION public.tropical_release_all_delivered(p_project uuid)
RETURNS TABLE (
  creative_id    uuid,
  amount         bigint,
  role_title     text,
  out_project_id uuid,
  project_name   text,
  fully_released boolean,
  member_ids     uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role uuid;
BEGIN
  FOR v_role IN
    SELECT r.id FROM public.tropical_project_roles r
    WHERE r.project_id = p_project AND r.status = 'delivered'
  LOOP
    RETURN QUERY SELECT * FROM public.tropical_release_role(v_role);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_release_all_delivered(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_release_all_delivered(uuid) TO authenticated;

-- ============================================================================
-- 7. MEMBER REMOVED
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tropical_remove_member(p_project uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_status text;
  v_brand  uuid;
  v_name   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status, brand_id, name INTO v_status, v_brand, v_name
  FROM public.tropical_projects WHERE id = p_project;

  IF v_brand IS NULL OR v_brand <> v_caller THEN
    RAISE EXCEPTION 'only the project owner can remove members' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow is funded - members can no longer be removed'
      USING ERRCODE = '22023';
  END IF;

  IF p_user = v_brand THEN
    RAISE EXCEPTION 'the project owner cannot be removed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
  VALUES (
    p_user, p_project, 'member_removed',
    'Removed from ' || v_name,
    'You were removed from ' || v_name || ' by the project owner.',
    v_caller
  );

  -- Free every role they held, so the work goes back on the market.
  UPDATE public.tropical_project_roles
  SET assigned_user_id = NULL, status = 'open', updated_at = now()
  WHERE project_id = p_project AND assigned_user_id = p_user;

  -- Their DM channels go with them; the messages cascade.
  DELETE FROM public.tropical_channels c
  WHERE c.project_id = p_project
    AND c.type = 'dm'
    AND c.role_id IN (
      SELECT r.id FROM public.tropical_project_roles r
      WHERE r.project_id = p_project AND r.assigned_user_id IS NULL
    );

  DELETE FROM public.tropical_project_members
  WHERE project_id = p_project AND user_id = p_user;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_remove_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_remove_member(uuid, uuid) TO authenticated;

COMMIT;
