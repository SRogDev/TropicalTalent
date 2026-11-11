-- ============================================================================
-- TROPICAL WITHDRAWAL FAILURE REASON
-- ============================================================================
-- A failed withdrawal was already handled correctly — 015's
-- tropical_finalize_withdrawal marks the transaction 'failed' and credits the
-- balance back — but the actual payment provider error (why it failed) only ever
-- reached a toast in the browser. Once that toast closed, the reason was
-- gone: the transaction row itself has no field for it, so there was no way
-- to look back and see why a specific withdrawal didn't go through.
--
-- Adds a `failure_reason` column and threads the payment provider's error message into it
-- via a new parameter on tropical_finalize_withdrawal.
-- ============================================================================

BEGIN;

ALTER TABLE public.tropical_balance_transactions
  ADD COLUMN IF NOT EXISTS failure_reason text;

DROP FUNCTION IF EXISTS public.tropical_finalize_withdrawal(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.tropical_finalize_withdrawal(
  p_transaction    uuid,
  p_succeeded      boolean,
  p_payout_ref     text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_user   uuid;
  v_amount bigint;
  v_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, amount, status INTO v_user, v_amount, v_status
  FROM public.tropical_balance_transactions
  WHERE id = p_transaction AND type = 'withdrawal'
  FOR UPDATE;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no such withdrawal' USING ERRCODE = '22023';
  END IF;

  IF v_caller <> v_user THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'pending' THEN
    RETURN;
  END IF;

  IF p_succeeded THEN
    UPDATE public.tropical_balance_transactions
    SET status = 'completed', payout_ref = p_payout_ref
    WHERE id = p_transaction;
  ELSE
    UPDATE public.tropical_balance_transactions
    SET status = 'failed', failure_reason = p_failure_reason
    WHERE id = p_transaction;

    -- v_amount is negative (withdrawal); subtracting it credits the balance
    -- back by the positive amount that was debited in begin_withdrawal.
    UPDATE public.tropical_user_balances
    SET available = available - v_amount, updated_at = now()
    WHERE user_id = v_user;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_finalize_withdrawal(uuid, boolean, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_finalize_withdrawal(uuid, boolean, text, text) TO authenticated;

COMMIT;
