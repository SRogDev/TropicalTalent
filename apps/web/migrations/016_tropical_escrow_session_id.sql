-- ============================================================================
-- TROPICAL ESCROW: KEY ON CHECKOUT SESSION ID, NOT PAYMENT INTENT
-- ============================================================================
-- 008_tropical_escrow.sql assumed `session.payment_intent` is populated the
-- moment a Checkout Session is created. That was true for static payment
-- method lists, but this app leaves `payment_method_types` unset so payment provider
-- can offer wallets/local methods dynamically — and for dynamic payment
-- methods, payment provider defers creating the PaymentIntent until the customer
-- actually submits a payment method on the Checkout page. `session.payment_intent`
-- is null right after `checkout.sessions.create`, which made
-- createEscrowCheckoutAction's `!session.payment_intent` guard reject every
-- attempt to authorise escrow.
--
-- Fix: track the escrow by `checkout_session_id`, which is always present
-- immediately (it's in the Session object at creation, in the success_url
-- redirect, and on the checkout.session.completed webhook payload). The
-- PaymentIntent id is still recorded, but only once funding actually
-- confirms it exists.
-- ============================================================================

BEGIN;

ALTER TABLE public.tropical_project_escrows
  ADD COLUMN IF NOT EXISTS checkout_session_id text UNIQUE;

ALTER TABLE public.tropical_project_escrows
  ALTER COLUMN payment_intent_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Open escrow: same shape as 008's version, keyed on the session id instead.
-- Signature is unchanged (uuid, text, bigint, bigint) but the second
-- parameter's name changes, and Postgres does not allow CREATE OR REPLACE to
-- rename a parameter — it has to be dropped first.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tropical_open_escrow(uuid, text, bigint, bigint);

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
-- Mark funded: looked up by session id now; payment_intent_id is filled in
-- here, once it's known to exist. Idempotent.
--
-- 020_tropical_email_notifications.sql later changes this same (text, text)
-- signature's return type from `uuid` to a TABLE, so the caller can email
-- without a second query. CREATE OR REPLACE cannot change a return type, so
-- on any replay after 020 has run, this file's own definition below would
-- fail with 42P13 unless dropped first. No-op on a database that has never
-- run 020.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tropical_mark_escrow_funded(text, text);

CREATE OR REPLACE FUNCTION public.tropical_mark_escrow_funded(
  p_checkout_session_id text,
  p_payment_intent_id   text DEFAULT NULL
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
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF v_escrow IS NULL THEN
    RAISE EXCEPTION 'no escrow for checkout session %', p_checkout_session_id
      USING ERRCODE = '22023';
  END IF;

  -- Already processed by whichever of the webhook / return-path got here
  -- first. Return quietly so the other caller does not error.
  IF v_status <> 'pending' THEN
    RETURN v_project;
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

-- tropical_mark_escrow_funded's signature changed from (text) to (text, text),
-- which CREATE OR REPLACE treats as a new overload rather than a replacement.
-- Drop the old one explicitly so it can't still be called with one argument.
DROP FUNCTION IF EXISTS public.tropical_mark_escrow_funded(text);

REVOKE ALL ON FUNCTION public.tropical_open_escrow(uuid, text, bigint, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_open_escrow(uuid, text, bigint, bigint) TO authenticated;

-- Service role only: this bypasses ownership checks by design, because the
-- caller is the payment provider's webhook, not a signed-in user.
REVOKE ALL ON FUNCTION public.tropical_mark_escrow_funded(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_mark_escrow_funded(text, text) TO service_role;

COMMIT;
