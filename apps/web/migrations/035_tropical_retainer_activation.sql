-- ============================================================================
-- 035 — A retainer does not start until its card is saved
-- ============================================================================
-- Two changes, both about the same failure: a recurring engagement that exists
-- but cannot pay anybody.
--
-- ---------------------------------------------------------------------------
-- 1. tropical_create_retainer_project can start an engagement paused
-- ---------------------------------------------------------------------------
-- Every recurring period is charged off-session against a card the brand saved
-- earlier, and until 035 the only place that card could be captured was the
-- escrow Checkout — which a retainer never visits, because it has no pot
-- (budget 0, status 'active', no tropical_project_escrows row). So a retainer
-- created from the UI had no payment method, and every period failed with
-- "No saved payment method" until the role paused itself.
--
-- The fix is an ordering one: create the engagement paused, take the card,
-- then start it. Paused is exactly the right state to build on, because
-- tropical_schedule_period already refuses to schedule for a paused role — so a
-- brand who abandons the payment checkout leaves behind an engagement that has
-- scheduled nothing and charged nothing, rather than one that looks live and
-- fails its first charge three days later.
--
-- A parameter with a default rather than a separate function: every existing
-- caller keeps today's behaviour, and the two paths cannot drift apart the way
-- two copies of this body would.
--
-- ---------------------------------------------------------------------------
-- 2. tropical_schedule_period refuses a role with nobody assigned
-- ---------------------------------------------------------------------------
-- p_user is optional on tropical_create_retainer_project — the role is created
-- 'open' when it is absent. The period it scheduled then copied that NULL into
-- tropical_role_periods.creative_id, which the funding pass is perfectly happy
-- to charge, and which tropical_release_period then refuses to release:
--
--     IF v_p.creative_id IS NULL THEN RETURN; END IF;   -- 028:196
--
-- The brand is billed every period and the money can never reach anyone,
-- because there is nobody to reach. The guard belongs here rather than in the
-- form, for the reason the rest of this schema gives: the UI is not the
-- boundary, and a period that cannot be released must never be created.
--
-- An unassigned recurring role is not an error — a seat can legitimately sit
-- open while the brand looks for someone. It simply schedules nothing until
-- it is filled, which is the same "no work, no charge" position pausing takes.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. SCHEDULING GUARD
-- ---------------------------------------------------------------------------
-- 028's body verbatim, plus the assignee check. Signature unchanged.

CREATE OR REPLACE FUNCTION public.tropical_schedule_period(p_role uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     record;
  v_tenant   record;
  v_start    date;
  v_end      date;
  v_fee      bigint;
  v_partner  bigint;
  v_period   uuid;
BEGIN
  SELECT r.*, p.tenant_id, p.brand_id
    INTO v_role
  FROM public.tropical_project_roles r
  JOIN public.tropical_projects p ON p.id = r.project_id
  WHERE r.id = p_role;

  IF v_role IS NULL OR v_role.pay_model <> 'recurring' THEN
    RETURN NULL;
  END IF;

  -- Paused or finished engagements schedule nothing. Neither touches the
  -- project, the chat, or anything the creative can see beyond the schedule.
  IF v_role.paused_at IS NOT NULL THEN RETURN NULL; END IF;

  -- THE GUARD. A period with no creative_id can be funded but never released
  -- (028:196), so scheduling one bills the brand for work nobody can be paid
  -- for. An open seat waits instead; filling it resumes the schedule.
  IF v_role.assigned_user_id IS NULL THEN RETURN NULL; END IF;

  v_start := v_role.next_period_start;
  IF v_start IS NULL THEN RETURN NULL; END IF;
  IF v_role.ends_at IS NOT NULL AND v_start >= v_role.ends_at THEN RETURN NULL; END IF;

  v_end := public.tropical_period_end(v_start, v_role.period);

  SELECT platform_fee_pct, partner_share_pct INTO v_tenant
  FROM public.tropical_tenants WHERE id = v_role.tenant_id;

  -- Fee frozen into the row now, not read at release time. Changing a tenant's
  -- fee must never reprice a period that has already been agreed or charged.
  v_fee     := floor(v_role.period_amount * COALESCE(v_tenant.platform_fee_pct, 15) / 100);
  v_partner := floor(v_fee * COALESCE(v_tenant.partner_share_pct, 0) / 100);

  INSERT INTO public.tropical_role_periods
    (role_id, project_id, creative_id, period_start, period_end,
     gross, platform_fee, partner_fee, net, status)
  VALUES
    (p_role, v_role.project_id, v_role.assigned_user_id, v_start, v_end,
     v_role.period_amount, v_fee, v_partner, v_role.period_amount - v_fee, 'scheduled')
  ON CONFLICT ON CONSTRAINT tropical_role_periods_unique_period DO NOTHING
  RETURNING id INTO v_period;

  -- Roll the role forward whether or not this call created the row, so a
  -- double run does not leave next_period_start pointing at a period that
  -- already exists.
  UPDATE public.tropical_project_roles
  SET next_period_start = v_end, updated_at = now()
  WHERE id = p_role AND next_period_start = v_start;

  RETURN v_period;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. CREATE PAUSED
-- ---------------------------------------------------------------------------
-- 032's body verbatim, plus p_start_paused. Adding a parameter with a default
-- creates an overload rather than replacing the function, so the 032 signature
-- is dropped first — and because apply.mjs re-runs 032 before this file on
-- every invocation, it is dropped again on every run.

DROP FUNCTION IF EXISTS public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, uuid, text, date, text);

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
  -- Created paused, so nothing is scheduled and nothing is charged until the
  -- caller has a payment method to charge. Defaulted false: every existing
  -- caller behaves exactly as it did before this migration.
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

  INSERT INTO public.tropical_projects
    (brand_id, tenant_id, name, brief, budget, visibility, kind, status)
  VALUES
    (v_user, p_tenant_id, p_name, COALESCE(p_brief, ''), 0, p_visibility,
     'retainer', 'active')
  RETURNING id INTO v_project;

  INSERT INTO public.tropical_project_members (project_id, user_id, member_role)
  VALUES (v_project, v_user, 'brand');

  INSERT INTO public.tropical_channels (project_id, type, name)
  VALUES (v_project, 'bot', 'Project Admin'), (v_project, 'group', 'Group Chat');

  INSERT INTO public.tropical_project_roles
    (project_id, title, discipline_slug, percentage, amount,
     assigned_user_id, status,
     pay_model, period, period_amount, approval, next_period_start, ends_at,
     paused_at)
  VALUES
    (v_project, p_role_title, NULLIF(p_discipline, ''), 0, 0,
     p_user,
     CASE WHEN p_user IS NULL THEN 'open' ELSE 'invited' END,
     'recurring', p_period, p_period_amount, p_approval, p_starts, p_ends,
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
  -- fund. Without this the engagement sits idle until the roll-forward pass
  -- happens to catch it, which on a start date inside the lead window is
  -- already too late to charge before the period begins.
  --
  -- A paused engagement schedules nothing — that is the whole point of the
  -- flag — but the call is left unconditional because tropical_schedule_period
  -- is the one place allowed to decide, and it already returns NULL for a
  -- paused role and for an unassigned one.
  PERFORM public.tropical_schedule_period(v_role);

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, uuid, text, date, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_create_retainer_project(
  text, text, text, text, uuid, text, bigint, date, uuid, text, date, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. ACTIVATION
-- ---------------------------------------------------------------------------
-- Turning a paused, card-less engagement into a running one. Called from the
-- return leg of the payment checkout AND from the setup_intent.succeeded webhook,
-- so it has to be idempotent: whichever arrives second must be a no-op.
--
-- Service role only. The caller is a webhook with no session, and the return
-- leg goes through an action that has already checked ownership.

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
  SET paused_at = NULL, updated_at = now()
  WHERE id = p_role;

  -- Now that it is unpaused, the first period can exist. Absorbed by the
  -- UNIQUE (role_id, period_start) constraint if one somehow already does.
  PERFORM public.tropical_schedule_period(p_role);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_activate_retainer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_activate_retainer(uuid) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   npm run verify:payments   -- covers the recurring lifecycle end to end
