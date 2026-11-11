-- ============================================================================
-- 043 — A retainer is set up before it is paid for
-- ============================================================================
-- 035 got the ordering half right: create the engagement paused, take the
-- card, then start it. What it did not do is give the brand anything to look
-- at in between, and three things turned out to be broken in that gap.
--
-- ---------------------------------------------------------------------------
-- 1. A retainer's contract could never be agreed
-- ---------------------------------------------------------------------------
-- tropical_create_retainer_project opens the project 'active' — deliberately,
-- because a retainer has no pot to wait for (029). But both contract RPCs read
-- that same column to decide whether the contract is locked:
--
--     IF v_status IN ('active', 'completed') THEN
--       RAISE EXCEPTION 'escrow is paid - this contract is locked';   -- 020:232
--
-- So every retainer project shipped with its contract locked from the first
-- millisecond. Neither party could draft one, neither could accept one, and
-- the error blamed an escrow payment that does not exist on this kind of
-- project. The lock is right; the thing it was reading was wrong. For a
-- recurring role the equivalent of "the money has been committed" is the
-- engagement having started — paused_at cleared by tropical_activate_retainer —
-- so that is what it now reads.
--
-- ---------------------------------------------------------------------------
-- 2. The group channel opened before anyone had paid
-- ---------------------------------------------------------------------------
-- Same root cause, opposite direction. tropical_can_access_channel opens the
-- group channel whenever the project is 'active' (011:213), which for a
-- retainer is true from creation — before the card exists, before the contract
-- is agreed, before anything is scheduled.
--
-- It cannot key off paused_at either, because 027's invariant is explicit that
-- a funding failure must never close a chat, and a retainer that pauses after
-- three declined charges is exactly that case. So the role records when it was
-- FIRST activated and the channel keys off that. Monotonic: it opens once and
-- a later pause does not shut it.
--
-- ---------------------------------------------------------------------------
-- 3. Nothing recorded what the brand had actually decided
-- ---------------------------------------------------------------------------
-- The set-up checklist needs to distinguish "the default is auto" from "the
-- brand chose auto", and the card status needs to be legible without a payment provider
-- round trip on every render. Hence approval_confirmed_at and the four card
-- columns — display-only copies of what payment provider already told us, never read by
-- anything that charges.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. COLUMNS
-- ============================================================================

-- Enough of the saved card to say "Visa ending 4242" on the screen where the
-- brand is deciding whether their card is connected. The charge itself still
-- goes through default_payment_method and nothing else; these four are a
-- receipt, not a credential.
ALTER TABLE public.tropical_billing_profiles
  ADD COLUMN IF NOT EXISTS card_brand     text,
  ADD COLUMN IF NOT EXISTS card_last4     text,
  ADD COLUMN IF NOT EXISTS card_exp_month smallint,
  ADD COLUMN IF NOT EXISTS card_exp_year  smallint;

ALTER TABLE public.tropical_project_roles
  -- When the brand explicitly confirmed automatic vs manual release. NULL
  -- means they have not looked at it yet, which is not the same as 'auto'
  -- even though 'auto' is what the column already says.
  ADD COLUMN IF NOT EXISTS approval_confirmed_at timestamptz,
  -- When the engagement first started paying. Set once, never cleared — see
  -- the header on why a later pause must not reverse it.
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

COMMENT ON COLUMN public.tropical_project_roles.activated_at IS
  'First time this recurring role was activated (card saved). Monotonic: pausing does not clear it, because 027 forbids a funding failure closing the group channel.';

-- ---------------------------------------------------------------------------
-- Backfilling activated_at
-- ---------------------------------------------------------------------------
-- Every retainer that predates this migration and is either running or has
-- already billed was, by definition, activated. Without this their group
-- channel would close the moment the new rule below lands.
--
-- "Has already billed" means a period that money actually reached — NOT merely
-- the existence of a period row. A retainer created before 035 scheduled its
-- first period at creation whether or not a card was ever saved, and periods
-- sitting at scheduled / funding_failed / skipped are the proof that nobody
-- ever paid, not evidence that somebody did. Counting those marked engagements
-- as live that had never taken a penny, which then presented them as running:
-- group channel open, contract locked, set-up checklist gone.
--
-- The first statement undoes exactly that, for the first cut of this migration
-- and for any future rerun. It is deliberately narrow: a role is only unstamped
-- when it is paused AND no period ever took money AND its brand has no saved
-- card for the tenant. Activation cannot happen without a billing profile
-- (tropical_activate_retainer runs only after one is written), so a role with one
-- is genuinely activated and is left alone even when it is currently paused.
UPDATE public.tropical_project_roles r
SET activated_at = NULL
FROM public.tropical_projects p
WHERE p.id = r.project_id
  AND r.pay_model = 'recurring'
  AND r.activated_at IS NOT NULL
  AND r.paused_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tropical_role_periods rp
    WHERE rp.role_id = r.id
      AND rp.status IN ('funding', 'funded', 'delivered', 'released', 'disputed')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.tropical_billing_profiles b
    WHERE b.tenant_id = p.tenant_id
      AND b.brand_id = p.brand_id
      AND b.default_payment_method IS NOT NULL
  );

UPDATE public.tropical_project_roles r
SET activated_at = COALESCE(r.activated_at, r.updated_at, r.created_at)
WHERE r.pay_model = 'recurring'
  AND r.activated_at IS NULL
  AND (
    r.paused_at IS NULL
    OR EXISTS (
      SELECT 1 FROM public.tropical_role_periods p
      WHERE p.role_id = r.id
        AND p.status IN ('funding', 'funded', 'delivered', 'released', 'disputed')
    )
  );

-- ============================================================================
-- 2. THE CONTRACT LOCK
-- ============================================================================
-- 020's bodies verbatim (018's, plus the brand -> creative notification), with
-- one condition replaced in each. A recurring role reads its own paused_at;
-- everything else keeps reading the project status, so the fixed-price flow is
-- bit-for-bit unchanged.

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
  v_model    text;
  v_paused   timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.assigned_user_id, p.status, r.title, p.name,
         r.pay_model, r.paused_at
    INTO v_project, v_brand, v_assignee, v_status, v_title, v_name, v_model, v_paused
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF v_caller NOT IN (v_brand, COALESCE(v_assignee, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'only the two parties can edit this contract' USING ERRCODE = '42501';
  END IF;

  IF v_model = 'recurring' THEN
    -- A running engagement is the retainer's equivalent of paid escrow: money
    -- has been committed against these terms, so they stop being negotiable.
    IF v_paused IS NULL THEN
      RAISE EXCEPTION 'this engagement is running - its contract is locked'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_status IN ('active', 'completed') THEN
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
  v_model    text;
  v_paused   timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.assigned_user_id, p.status, r.title, p.name,
         r.pay_model, r.paused_at
    INTO v_project, v_brand, v_assignee, v_status, v_title, v_name, v_model, v_paused
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF v_caller NOT IN (v_brand, COALESCE(v_assignee, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'only the two parties can accept this contract' USING ERRCODE = '42501';
  END IF;

  IF v_model = 'recurring' THEN
    IF v_paused IS NULL THEN
      RAISE EXCEPTION 'this engagement is running - its contract is locked'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_status NOT IN ('draft', 'pending_payment') THEN
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
-- 3. THE GROUP CHANNEL
-- ============================================================================
-- 011's body, with the retainer branch added. A pot project is unaffected.

CREATE OR REPLACE FUNCTION public.tropical_can_access_channel(p_channel uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
  v_type    text;
  v_status  text;
  v_kind    text;
BEGIN
  IF NOT public.tropical_can_see_channel(p_channel, p_user) THEN
    RETURN false;
  END IF;

  SELECT c.project_id, c.type, p.status, p.kind
    INTO v_project, v_type, v_status, v_kind
  FROM public.tropical_channels c
  JOIN public.tropical_projects p ON p.id = c.project_id
  WHERE c.id = p_channel;

  IF v_type = 'group' THEN
    IF v_kind = 'retainer' THEN
      -- A retainer is 'active' from creation, so status says nothing about
      -- whether anybody has paid. activated_at does. Never cleared, so a
      -- funding failure later cannot shut a channel that is already open —
      -- see 027's invariant.
      RETURN EXISTS (
        SELECT 1 FROM public.tropical_project_roles r
        WHERE r.project_id = v_project
          AND r.pay_model = 'recurring'
          AND r.activated_at IS NOT NULL
      );
    END IF;

    -- The group channel stays shut until escrow is funded.
    IF v_status NOT IN ('active', 'completed') THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_can_access_channel(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_can_access_channel(uuid, uuid) TO authenticated;

-- ============================================================================
-- 4. ACTIVATION STAMPS THE ROLE
-- ============================================================================
-- 035's body, plus activated_at. COALESCE rather than a bare assignment: this
-- function is called by both the webhook and the return leg, and an engagement
-- that is paused and resumed later must keep its original activation date —
-- that date is what holds the group channel open.

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
  -- this for the same Checkout and exactly one should win.
  IF v_role.paused_at IS NULL THEN RETURN false; END IF;

  UPDATE public.tropical_project_roles
  SET paused_at    = NULL,
      activated_at = COALESCE(activated_at, now()),
      updated_at   = now()
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
-- 5. CREATION RECORDS THE DELIVERY DATE
-- ============================================================================
-- 035's body, with one line added: the end of the engagement IS the project's
-- final delivery date, so it is written to the column every other screen
-- already reads (the status pin, the project card, the role deadline) instead
-- of living only on the role where nothing else looks.
--
-- p_ends stays nullable here. The form makes it compulsory — an open-ended
-- retainer with no delivery date is what produced a project admin screen with
-- nothing on it to confirm — but the RPC is also called by the verification
-- script and by any future caller with a genuinely open-ended engagement, and
-- a NOT NULL here would be a schema change to the wrong layer.

CREATE OR REPLACE FUNCTION public.tropical_create_retainer_project(
  p_name           text,
  p_brief          text,
  p_role_title     text,
  p_discipline     text,
  p_user           uuid,
  p_period         text,
  p_period_amount  bigint,
  p_starts         date,
  p_tenant_id      uuid,
  p_approval       text DEFAULT 'auto',
  p_ends           date DEFAULT NULL,
  p_visibility     text DEFAULT 'private',
  p_start_paused   boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_project uuid;
  v_role    uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'a retainer needs a tenant' USING ERRCODE = '22023';
  END IF;

  IF NOT public.tropical_is_tenant_member(p_tenant_id, v_user) THEN
    RAISE EXCEPTION 'not a member of that workspace' USING ERRCODE = '42501';
  END IF;

  IF p_user IS NOT NULL
     AND NOT public.tropical_is_tenant_member(p_tenant_id, p_user) THEN
    RAISE EXCEPTION 'that person is not a member of this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('weekly', 'monthly') THEN
    RAISE EXCEPTION 'period must be weekly or monthly' USING ERRCODE = '22023';
  END IF;
  IF p_period_amount IS NULL OR p_period_amount <= 0 THEN
    RAISE EXCEPTION 'a retainer needs an amount per period' USING ERRCODE = '22023';
  END IF;
  IF p_starts IS NULL THEN
    RAISE EXCEPTION 'a retainer needs a start date' USING ERRCODE = '22023';
  END IF;
  IF p_ends IS NOT NULL AND p_ends <= p_starts THEN
    RAISE EXCEPTION 'the end date has to be after the start date' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tropical_projects
    (brand_id, tenant_id, name, brief, budget, visibility, kind, status, deadline_date)
  VALUES
    (v_user, p_tenant_id, p_name, COALESCE(p_brief, ''), 0, p_visibility,
     'retainer', 'active', p_ends)
  RETURNING id INTO v_project;

  INSERT INTO public.tropical_project_members (project_id, user_id, member_role)
  VALUES (v_project, v_user, 'brand');

  INSERT INTO public.tropical_channels (project_id, type, name)
  VALUES (v_project, 'bot', 'Project Admin'), (v_project, 'group', 'Group Chat');

  INSERT INTO public.tropical_project_roles
    (project_id, title, discipline_slug, percentage, amount,
     assigned_user_id, status,
     pay_model, period, period_amount, approval, next_period_start, ends_at,
     deadline_date, paused_at)
  VALUES
    (v_project, p_role_title, NULLIF(p_discipline, ''), 0, 0,
     p_user,
     CASE WHEN p_user IS NULL THEN 'open' ELSE 'invited' END,
     'recurring', p_period, p_period_amount, p_approval, p_starts, p_ends,
     p_ends,
     CASE WHEN p_start_paused THEN now() ELSE NULL END)
  RETURNING id INTO v_role;

  IF p_user IS NOT NULL THEN
    INSERT INTO public.tropical_channels (project_id, type, name, role_id)
    VALUES (v_project, 'dm', p_role_title, v_role);

    INSERT INTO public.tropical_project_members (project_id, user_id, member_role, role_id)
    VALUES (v_project, p_user, 'creative', v_role)
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;

  -- Schedule the first period immediately so the pay run has something to
  -- fund. A paused engagement schedules nothing — that is the whole point of
  -- the flag — but the call is left unconditional because
  -- tropical_schedule_period is the one place allowed to decide.
  PERFORM public.tropical_schedule_period(v_role);

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, uuid, text, date, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, uuid, text, date, text, boolean) TO authenticated;

-- ============================================================================
-- 6. THE SET-UP CHECKLIST'S TWO WRITES
-- ============================================================================
-- Both are brand-only and both are refused once the engagement has started.
-- They exist as RPCs rather than table updates because tropical_project_roles
-- has no update policy for a brand (setRetainerPausedAction goes through the
-- service role for exactly that reason), and widening one would open every
-- column on the table — including period_amount, which decides what a card
-- gets charged.

CREATE OR REPLACE FUNCTION public.tropical_update_retainer_schedule(
  p_role   uuid,
  p_starts date,
  p_ends   date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project uuid;
  v_brand   uuid;
  v_model   text;
  v_active  timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.project_id, p.brand_id, r.pay_model, r.activated_at
    INTO v_project, v_brand, v_model, v_active
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;
  IF v_caller <> v_brand THEN
    RAISE EXCEPTION 'only the project owner can change these dates' USING ERRCODE = '42501';
  END IF;
  IF v_model <> 'recurring' THEN
    RAISE EXCEPTION 'that role is not a retainer' USING ERRCODE = '22023';
  END IF;

  -- Once a card is saved the schedule is a commitment, not a draft: periods
  -- exist, one of them may already be charged, and moving the start date under
  -- a funded period would silently reprice work somebody has begun.
  IF v_active IS NOT NULL THEN
    RAISE EXCEPTION 'this engagement has already started' USING ERRCODE = '22023';
  END IF;

  IF p_starts IS NULL OR p_ends IS NULL THEN
    RAISE EXCEPTION 'both dates are required' USING ERRCODE = '22023';
  END IF;
  IF p_ends <= p_starts THEN
    RAISE EXCEPTION 'the end date has to be after the start date' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tropical_project_roles
  SET next_period_start = p_starts,
      ends_at           = p_ends,
      deadline_date     = p_ends,
      updated_at        = now()
  WHERE id = p_role;

  -- The engagement's end IS the project's final delivery date. Kept in step
  -- here rather than left to the caller, so the two cannot disagree.
  UPDATE public.tropical_projects
  SET deadline_date = p_ends, updated_at = now()
  WHERE id = v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_update_retainer_schedule(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_update_retainer_schedule(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.tropical_set_retainer_approval(
  p_role     uuid,
  p_approval text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project uuid;
  v_brand   uuid;
  v_model   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_approval NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'approval must be auto or manual' USING ERRCODE = '22023';
  END IF;

  SELECT r.project_id, p.brand_id, r.pay_model
    INTO v_project, v_brand, v_model
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;
  IF v_caller <> v_brand THEN
    RAISE EXCEPTION 'only the project owner can change this' USING ERRCODE = '42501';
  END IF;
  IF v_model <> 'recurring' THEN
    RAISE EXCEPTION 'that role is not a retainer' USING ERRCODE = '22023';
  END IF;

  -- Unlike the dates, this stays editable for the life of the engagement.
  -- Switching from automatic release to "I approve each one" is a change of
  -- mind about oversight, not a change to what anybody is owed.
  UPDATE public.tropical_project_roles
  SET approval              = p_approval,
      approval_confirmed_at = now(),
      updated_at            = now()
  WHERE id = p_role;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_set_retainer_approval(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_set_retainer_approval(uuid, text) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   npm run verify:payments   -- covers the recurring lifecycle end to end
