-- ============================================================================
-- 046 — A card save is a state the server knows about
-- ============================================================================
-- 043 gave the set-up screen a "pending" state, and it was client-side only:
-- a React flag set when the return from Checkout came back unconfirmed. Two
-- consequences, both of which a brand experienced as "I have no idea whether
-- that worked".
--
--   * Refreshing, or coming back later, lost it. The screen fell back to
--     "Save a card" — which is the exact message that made a brand who had
--     just saved one believe it had failed, and the reason they saved a
--     second.
--
--   * A save that genuinely FAILED looked identical to one never attempted.
--     setup_intent.setup_failed was not handled at all, so a declined or
--     abandoned authorisation left no trace anywhere.
--
-- So the attempt is recorded when the brand is sent to payment provider, and it lives
-- until something resolves it: activation clears it, a failure marks it. The
-- screen then reads a fact instead of remembering one.
--
-- On the role rather than on tropical_billing_profiles, because the profile row
-- only exists once a card has successfully saved — the whole window this needs
-- to describe is the one where there is no profile yet. The role is also what
-- the brand is looking at: "did my card save" is only ever asked about a
-- particular engagement that is waiting to start.
-- ============================================================================

BEGIN;

ALTER TABLE public.tropical_project_roles
  -- The Checkout session, so the return leg and any later re-check can ask
  -- payment provider about this specific attempt rather than guessing from the profile.
  ADD COLUMN IF NOT EXISTS card_setup_session_id text,
  ADD COLUMN IF NOT EXISTS card_setup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS card_setup_status text
    CHECK (card_setup_status IS NULL OR card_setup_status IN ('pending', 'failed')),
  ADD COLUMN IF NOT EXISTS card_setup_error text;

COMMENT ON COLUMN public.tropical_project_roles.card_setup_status IS
  'pending: the brand was sent to payment provider and nothing has resolved it yet. failed: payment provider told us it did not work. NULL: no attempt outstanding — either none was made, or one succeeded and tropical_activate_retainer cleared it.';

-- ============================================================================
-- ACTIVATION CLEARS THE ATTEMPT
-- ============================================================================
-- 043's body, plus the reset. Doing it here rather than at the two call sites
-- is what makes it impossible for an engagement to be running while its own
-- set-up screen still claims a card save is outstanding: whichever path
-- activates — the brand's return leg or the webhook — clears it in the same
-- statement that unpauses the role.

CREATE OR REPLACE FUNCTION public.tropical_activate_retainer(p_role uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role record;
BEGIN
  SELECT r.id, r.paused_at, r.pay_model, r.assigned_user_id
    INTO v_role
  FROM public.tropical_project_roles r
  WHERE r.id = p_role
  FOR UPDATE;

  IF v_role IS NULL OR v_role.pay_model <> 'recurring' THEN RETURN false; END IF;

  -- Already running. Not an error: the webhook and the return leg both call
  -- this for the same Checkout and exactly one should win. Returning false is
  -- also what stops the confirmation email being sent twice.
  IF v_role.paused_at IS NULL THEN RETURN false; END IF;

  UPDATE public.tropical_project_roles
  SET paused_at             = NULL,
      activated_at          = COALESCE(activated_at, now()),
      card_setup_session_id = NULL,
      card_setup_started_at = NULL,
      card_setup_status     = NULL,
      card_setup_error      = NULL,
      updated_at            = now()
  WHERE id = p_role;

  -- Now that it is unpaused, the first period can exist. Absorbed by the
  -- UNIQUE (role_id, period_start) constraint if one somehow already does.
  PERFORM public.tropical_schedule_period(p_role);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_activate_retainer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_activate_retainer(uuid) TO service_role;

-- ============================================================================
-- Notification kind
-- ============================================================================
-- The confirmation the brand asked for: an email that says the card is saved,
-- rather than a button they have to keep looking at. Through 020's helper, as
-- 041 and 044 do.
SELECT public.tropical_set_notification_kinds(ARRAY[
  'application_received', 'application_unlocked', 'application_decided',
  'deliverables_updated', 'contract_updated', 'role_invited', 'escrow_funded',
  'dispute_raised', 'dispute_resolved', 'withdrawal_completed', 'withdrawal_failed',
  'role_delivered', 'role_released', 'project_completed', 'member_removed',
  'project_deleted', 'application_withdrawn', 'referral_redeemed',
  'complaint_raised', 'project_delete_requested', 'card_saved'
]);

COMMIT;
