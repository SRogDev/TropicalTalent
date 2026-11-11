-- ============================================================================
-- TROPICAL WITHDRAWALS
-- ============================================================================
-- Two operations, mirroring the open/confirm shape of 008_tropical_escrow.sql:
--
--   tropical_begin_withdrawal    — debits `available` and opens a 'pending'
--                                withdrawal transaction, before the payment provider
--                                transfer is attempted.
--   tropical_finalize_withdrawal — marks that transaction 'completed' with the
--                                transfer id, or 'failed' and credits the
--                                balance back if the payment provider call errored.
--
-- The debit happens first (not after a successful transfer) so a request
-- that dies between the payment provider call and the response can never be replayed
-- against a balance that has already moved — there is exactly one pending
-- transaction row per attempt, and finalize is the only thing that can close
-- it, in either direction.
--
-- Both are SECURITY DEFINER, pinned to auth.uid(), and granted to
-- `authenticated` only — a withdrawal is always initiated and finalized by
-- the creative it belongs to, in the same request, unlike escrow funding
-- which has a service-role webhook path.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Begin: debit available, open a pending withdrawal transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_begin_withdrawal(p_amount bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_available bigint;
  v_tx        uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'withdrawal amount must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT available INTO v_available
  FROM public.tropical_user_balances
  WHERE user_id = v_user
  FOR UPDATE;

  IF v_available IS NULL OR v_available < p_amount THEN
    RAISE EXCEPTION 'insufficient balance' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_user_balances
  SET available = available - p_amount, updated_at = now()
  WHERE user_id = v_user;

  INSERT INTO public.tropical_balance_transactions (user_id, amount, type, status)
  VALUES (v_user, -p_amount, 'withdrawal', 'pending')
  RETURNING id INTO v_tx;

  RETURN v_tx;
END;
$$;

-- ---------------------------------------------------------------------------
-- Finalize: close a pending withdrawal, in either direction. Idempotent —
-- a retried finalize call on an already-closed transaction is a no-op.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_finalize_withdrawal(
  p_transaction uuid,
  p_succeeded   boolean,
  p_payout_ref  text DEFAULT NULL
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
    SET status = 'failed'
    WHERE id = p_transaction;

    -- v_amount is negative (withdrawal); subtracting it credits the balance
    -- back by the positive amount that was debited in begin_withdrawal.
    UPDATE public.tropical_user_balances
    SET available = available - v_amount, updated_at = now()
    WHERE user_id = v_user;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_begin_withdrawal(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_begin_withdrawal(bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.tropical_finalize_withdrawal(uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_finalize_withdrawal(uuid, boolean, text) TO authenticated;

COMMIT;
