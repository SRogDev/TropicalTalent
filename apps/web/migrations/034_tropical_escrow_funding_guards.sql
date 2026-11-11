-- ============================================================================
-- 034  ESCROW: MAKE FUNDING WORK, AND MAKE RELEASE REQUIRE IT
-- ============================================================================
-- Two defects on the one-off (fixed-price) escrow path, both found by
-- scripts/verify-payments.mjs. They compound, which is why they are fixed
-- together: the first stops any payment being recorded, and the second means
-- the money goes out anyway.
--
-- ---------------------------------------------------------------------------
-- 1. tropical_mark_escrow_funded raised 42702 on every call
-- ---------------------------------------------------------------------------
-- 020 changed the return type from `uuid` to a TABLE so the caller could email
-- without a second query. That made `project_id` and `brand_id` plpgsql OUT
-- variables, and two statements in the body still referenced those names
-- unqualified against tables that have columns of the same name:
--
--     SELECT id, project_id, status ... FROM tropical_project_escrows
--     SELECT name, brand_id INTO ...   FROM tropical_projects
--
-- plpgsql reports that at RUN time, not at creation, so the migration applied
-- cleanly and every call since has failed with
--
--     42702  column reference "project_id" is ambiguous
--
-- The blast radius is the whole one-off payment path. POST the former payment webhook
-- returned 500, so payment provider retried the event forever; confirmEscrowReturnAction
-- surfaced the error to the brand on their way back from Checkout. The card
-- was charged, the escrow stayed 'pending', the project stayed
-- 'pending_payment', and the group channel never unlocked.
--
-- 020 hit exactly this bug in tropical_release_role in the same file and fixed it
-- by prefixing the colliding output column `out_project_id` (028 documents the
-- reasoning). tropical_mark_escrow_funded was missed. This applies the same
-- convention here — `out_project_id`, `out_brand_id` — AND qualifies every
-- table reference, so neither half of the mistake can come back on its own.
--
-- The renamed columns change the JSON keys PostgREST returns, so
-- modules/escrow/actions.ts's notifyEscrowFunded() changes with it.
--
-- ---------------------------------------------------------------------------
-- 2. tropical_release_role paid out of a pot that was never funded
-- ---------------------------------------------------------------------------
-- tropical_open_escrow writes the per-role holds BEFORE the brand leaves for
-- payment provider — deliberately, so a completed payment always has something to
-- reconcile against. The consequence is that 'held' holds exist against an
-- escrow that has taken no money, and nothing downstream checked otherwise:
-- release only required the role to be 'delivered' and a hold to be 'held'.
--
-- So: open checkout, abandon it, have the creative confirm delivery, release —
-- and a withdrawable balance is credited for money that was never collected.
-- Verified against the live database: £850 out of an escrow payment provider never
-- charged. releaseRoleAction is a server action, i.e. a public HTTP endpoint,
-- so the UI's own gating was never the boundary.
--
-- The recurring path already had this guard — tropical_release_period refuses
-- anything that is not 'funded' or 'delivered' (028:196). This brings the
-- fixed-price path in line.
--
-- 'partially_released' is allowed alongside 'funded' because that is the status
-- the escrow itself carries once the first of several roles has been paid; a
-- multi-role project would otherwise be releasable exactly once.
--
-- tropical_release_all_delivered delegates to this function (020:600), so it
-- inherits the guard without a change of its own.
--
-- Deliberately NOT changed: tropical_mark_role_delivered still works before
-- funding. Confirming delivery moves no money, and the product supports a
-- brand and creative aligning before escrow is authorised.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. FUNDING
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE cannot rename an output column, so the drop is required
-- rather than tidy. apply.mjs re-runs 020 before this file on every
-- invocation, which recreates the broken definition — this drops it again.

DROP FUNCTION IF EXISTS public.tropical_mark_escrow_funded(text, text);

CREATE OR REPLACE FUNCTION public.tropical_mark_escrow_funded(
  p_checkout_session_id text,
  p_payment_intent_id   text DEFAULT NULL
)
RETURNS TABLE (
  -- out_ prefixed for the reason 028 gives: a RETURNS TABLE column becomes a
  -- plpgsql variable, and a bare `project_id` then collides with the column of
  -- the same name on tropical_project_escrows. Renaming is what makes the
  -- collision impossible rather than merely absent.
  out_project_id        uuid,
  just_funded           boolean,
  out_brand_id          uuid,
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
  SELECT e.id, e.project_id, e.status
    INTO v_escrow, v_project, v_status
  FROM public.tropical_project_escrows e
  WHERE e.checkout_session_id = p_checkout_session_id
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

  UPDATE public.tropical_project_escrows e
  SET status = 'funded',
      payment_intent_id = COALESCE(p_payment_intent_id, e.payment_intent_id),
      funded_at = now(),
      updated_at = now()
  WHERE e.id = v_escrow;

  UPDATE public.tropical_projects p
  SET status = 'active', updated_at = now()
  WHERE p.id = v_project;

  SELECT p.name, p.brand_id INTO v_name, v_brand
  FROM public.tropical_projects p WHERE p.id = v_project;

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
           COALESCE(array_agg(DISTINCT r.assigned_user_id)
                    FILTER (WHERE r.assigned_user_id IS NOT NULL), '{}')
    FROM public.tropical_project_roles r
    WHERE r.project_id = v_project;
END;
$$;

-- Service role only: this bypasses ownership checks by design, because the
-- caller is the payment provider's webhook, not a signed-in user.
REVOKE ALL ON FUNCTION public.tropical_mark_escrow_funded(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_mark_escrow_funded(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. RELEASE
-- ---------------------------------------------------------------------------
-- 028's definition verbatim, plus the escrow-funded guard. Signature and
-- return shape are unchanged, so nothing calling it has to change.

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
  v_caller        uuid := auth.uid();
  v_project       uuid;
  v_brand         uuid;
  v_role_status   text;
  v_title         text;
  v_name          text;
  v_hold          uuid;
  v_amount        bigint;
  v_creative      uuid;
  v_escrow        uuid;
  v_escrow_status text;
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

  SELECT h.id, h.amount, h.creative_id, h.escrow_id
    INTO v_hold, v_amount, v_creative, v_escrow
  FROM public.tropical_escrow_holds h
  WHERE h.role_id = p_role AND h.status = 'held'
  FOR UPDATE;

  IF v_hold IS NULL THEN
    RAISE EXCEPTION 'no held escrow for this role' USING ERRCODE = '22023';
  END IF;
  IF v_creative IS NULL THEN
    RAISE EXCEPTION 'this role has no creative to pay' USING ERRCODE = '22023';
  END IF;

  -- THE GUARD. A hold exists from the moment checkout is STARTED, so its
  -- presence says nothing about whether the brand actually paid. Without this,
  -- an abandoned checkout still credits a withdrawable balance.
  SELECT e.status INTO v_escrow_status
  FROM public.tropical_project_escrows e
  WHERE e.id = v_escrow;

  IF v_escrow_status IS NULL
     OR v_escrow_status NOT IN ('funded', 'partially_released') THEN
    RAISE EXCEPTION
      'escrow for this project has not been funded - nothing can be released yet'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_escrow_holds h
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE h.id = v_hold;

  UPDATE public.tropical_project_roles r
  SET status = 'released', updated_at = now()
  WHERE r.id = p_role;

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
  v_fully_released := NOT EXISTS (
    SELECT 1 FROM public.tropical_escrow_holds h
    WHERE h.escrow_id = v_escrow AND h.status = 'held'
  );

  UPDATE public.tropical_project_escrows e
  SET status = CASE WHEN v_fully_released THEN 'released' ELSE 'partially_released' END,
      updated_at = now()
  WHERE e.id = v_escrow;

  -- Every escrow slice may be paid out while a retainer on the same project
  -- runs for another eleven months. Completing here would close the group
  -- channel (011:213) and tell a working contractor the project is over.
  IF v_fully_released AND NOT public.tropical_has_live_recurring(v_project) THEN
    UPDATE public.tropical_projects p
    SET status = 'completed', updated_at = now()
    WHERE p.id = v_project AND p.status = 'active';

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

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   npm run verify:payments
--
-- The suite covers both halves directly: "webhook accepted the signed payment
-- event" exercises the funding fix, and the "ESCROW · release against an
-- UNFUNDED pot" section exercises the guard.
