-- ============================================================================
-- 040 — Account deletion
-- ============================================================================
-- Gives every account a self-serve way out, and gives the admin console a
-- record that it happened. Closes the gap the 2026-08-27 privacy audit found:
-- the published policy grants a right to erasure and there was no code path
-- anywhere that could execute one.
--
-- ---------------------------------------------------------------------------
-- Why this ANONYMISES rather than DELETEs
-- ---------------------------------------------------------------------------
-- `DELETE FROM public.users WHERE id = ...` is not available to us, and the
-- reason is one line in 001:
--
--   tropical_projects.brand_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
--
-- Removing a brand's row therefore removes every project they ever created —
-- and cascading from there, the roles, the channels, every message in them,
-- the escrows and the holds. Those rows are not only theirs. A creative who
-- worked six roles for that brand would lose the contract that priced them,
-- the delivery trail that evidences the work, and the balance transactions
-- that explain their own earnings. One person exercising erasure would erase
-- other people's records with it.
--
-- The same objection applies more sharply to money: 015's withdrawal ledger
-- and 008's escrow rows are financial records that UK tax law requires be kept
-- for six years. They cannot be deleted on request, and the privacy policy now
-- says so in as many words.
--
-- So deletion here means what it can defensibly mean:
--
--   * the person can no longer sign in           (auth user removed, in TS)
--   * their name, handle, photo, bio and free
--     text are gone from public.users and
--     creative_data                              (this function)
--   * their memberships are suspended, so they
--     vanish from every roster and search        (this function)
--   * the financial and contractual rows survive
--     under a pseudonymous id, readable by
--     nobody who did not already have them
--
-- ---------------------------------------------------------------------------
-- Why a tropical_ table and not a users.deleted_at column
-- ---------------------------------------------------------------------------
-- public.users is a pre-existing identity table. The rule this codebase has
-- kept since 001 is that it is READ, never migrated — no ALTER, ever, because
-- the predecessor app and its live triggers still own that shape. A deletion
-- flag is new state belonging to this app, so it lives in a table this app
-- owns. UPDATEing rows is a data write, not a schema change, and is what
-- updateProfileAction already does.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. THE RECORD
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tropical_deleted_accounts (
  user_id      uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  -- The tenant they were standing on when they closed the account. The admin
  -- console is scoped per tenant, so without this a white-label's console
  -- could not tell its own closures from anyone else's.
  tenant_id    uuid REFERENCES public.tropical_tenants(id) ON DELETE SET NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  -- What the account was called, so the admin table reads as "Ada Okafor —
  -- deleted" rather than a bare uuid. Deliberately NOT the email address:
  -- keeping a contactable identifier would defeat the erasure this row exists
  -- to record. A name alone cannot be used to reach anyone.
  display_name text,
  reason       text CHECK (reason IS NULL OR length(reason) <= 500)
);

COMMENT ON TABLE public.tropical_deleted_accounts IS
  'One row per closed account. The users row survives, anonymised, because tropical_projects.brand_id cascades — see the header of migration 040.';

CREATE INDEX IF NOT EXISTS idx_tropical_deleted_accounts_tenant
  ON public.tropical_deleted_accounts (tenant_id, deleted_at DESC);

-- RLS on with no policies at all: the same instrument 024 used for
-- tropical_tenant_domains. Nothing a signed-in user does needs to read this
-- table — the admin console reads it through the service role, which bypasses
-- RLS, and the person who closed the account no longer has a session.
ALTER TABLE public.tropical_deleted_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tropical_deleted_accounts FROM anon;
REVOKE ALL ON public.tropical_deleted_accounts FROM PUBLIC;
GRANT ALL  ON public.tropical_deleted_accounts TO service_role;

-- ============================================================================
-- 2. THE OPERATION
-- ============================================================================
-- Returns NULL when the account was closed, or a sentence explaining why it
-- could not be. Returning the refusal rather than raising it is deliberate:
-- every one of these is a thing the user can actually go and fix, so it is a
-- message for them, not an error for the log.
--
-- SECURITY DEFINER and pinned to auth.uid(): there is no p_user argument, so
-- there is nothing to forge. Granted to `authenticated` only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tropical_delete_account(p_reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_tenant uuid;
  v_name   text;
  v_avail  bigint;
  v_pend   bigint;
  v_n      integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Already closed. Idempotent rather than an error: the confirm dialog can be
  -- submitted twice from a stale tab, and the second one should agree with the
  -- first rather than alarm anyone.
  IF EXISTS (SELECT 1 FROM public.tropical_deleted_accounts WHERE user_id = v_user) THEN
    RETURN NULL;
  END IF;

  -- ---------------------------------------------------------------------
  -- Guards. Each is money or an obligation that closing the account would
  -- strand, and each names the thing to go and do about it.
  -- ---------------------------------------------------------------------
  SELECT available, pending INTO v_avail, v_pend
  FROM public.tropical_user_balances WHERE user_id = v_user;

  IF COALESCE(v_avail, 0) > 0 OR COALESCE(v_pend, 0) > 0 THEN
    RETURN 'You still have money in your wallet. Withdraw it first, then close your account.';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.tropical_escrow_holds
  WHERE creative_id = v_user AND status = 'held';

  IF v_n > 0 THEN
    RETURN 'You have ' || v_n || ' role(s) with payment still held in escrow. Those need to be released or refunded first.';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.tropical_project_roles
  WHERE assigned_user_id = v_user
    AND status IN ('accepted', 'delivered', 'approved');

  IF v_n > 0 THEN
    RETURN 'You are still contracted on ' || v_n || ' role(s). Finish or leave them first.';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.tropical_projects
  WHERE brand_id = v_user AND status IN ('pending_payment', 'active');

  IF v_n > 0 THEN
    RETURN 'You have ' || v_n || ' live project(s). Complete or cancel them first.';
  END IF;

  -- ---------------------------------------------------------------------
  -- Closing.
  -- ---------------------------------------------------------------------
  SELECT name INTO v_name FROM public.users WHERE id = v_user;

  -- Whichever tenant they are actually a member of. A person in several keeps
  -- the first by join date, which is the one they signed up on.
  SELECT tenant_id INTO v_tenant
  FROM public.tropical_tenant_members
  WHERE user_id = v_user
  ORDER BY created_at NULLS LAST
  LIMIT 1;

  INSERT INTO public.tropical_deleted_accounts (user_id, tenant_id, display_name, reason)
  VALUES (v_user, v_tenant, v_name, NULLIF(btrim(COALESCE(p_reason, '')), ''));

  -- The identity itself. username keeps a value because it carries a UNIQUE
  -- constraint and is a route parameter — a null would break /profile/[username]
  -- for anyone still holding a link. The uuid makes it collision-proof.
  UPDATE public.users
  SET name              = 'Deleted account',
      username          = 'deleted_' || left(replace(v_user::text, '-', ''), 16),
      bio               = NULL,
      avatar            = NULL,
      location          = NULL,
      profile_completed = false
  WHERE id = v_user;

  -- The creative profile's free text. The row stays because user_stats and the
  -- discipline tables key off it; everything a person wrote goes.
  UPDATE public.creative_data
  SET name      = NULL,
      tags      = NULL,
      passion   = NULL,
      video     = NULL,
      backstory = NULL
  WHERE user_id = v_user;

  -- Out of every roster, every search and every talent board. The membership
  -- rows are kept rather than deleted so a tenant admin's historic project
  -- pages still resolve who was on them.
  UPDATE public.tropical_tenant_members
  SET status = 'suspended'
  WHERE user_id = v_user;

  -- Nothing further should be sent to an address that is about to stop
  -- existing.
  INSERT INTO public.tropical_notification_preferences (user_id, email_enabled)
  VALUES (v_user, false)
  ON CONFLICT (user_id) DO UPDATE SET email_enabled = false, updated_at = now();

  -- Their own disciplines and favourites carry no value to anyone else.
  DELETE FROM public.tropical_creative_disciplines WHERE user_id = v_user;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_delete_account(text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_delete_account(text) TO authenticated;

COMMIT;

-- ============================================================================
-- Verify
-- ============================================================================
--   SELECT user_id, display_name, deleted_at FROM public.tropical_deleted_accounts;
--   -- and, signed in as a seed account with a zero balance:
--   SELECT public.tropical_delete_account('testing');   -- expect NULL
-- ============================================================================
