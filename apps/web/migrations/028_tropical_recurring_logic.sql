-- ============================================================================
-- 028 — Recurring: scheduling, funding, release
-- ============================================================================
-- Three RPCs the cron drives, one the brand drives, and one correction to an
-- existing function that would otherwise end a retainer by accident.
--
-- Every function here is SECURITY DEFINER and called with the service role:
-- there is no signed-in user on a cron invocation, and a brand must not be
-- able to mark their own period released.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PERIOD BOUNDARIES
-- ============================================================================
-- One place that knows what "the next month" means, so scheduling, the UI and
-- any backfill cannot disagree. Months are calendar months rather than 30-day
-- blocks: a contractor paid monthly expects the 1st, not a date that drifts
-- backwards through the year.

CREATE OR REPLACE FUNCTION public.tropical_period_end(p_start date, p_period text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_period
    WHEN 'weekly'  THEN p_start + INTERVAL '7 days'
    WHEN 'monthly' THEN p_start + INTERVAL '1 month'
    ELSE p_start + INTERVAL '1 month'
  END::date;
$$;

-- ============================================================================
-- 2. SCHEDULE THE NEXT PERIOD
-- ============================================================================
-- Idempotent by construction: the UNIQUE (role_id, period_start) constraint
-- absorbs a second call, so a cron that runs twice schedules once.

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

-- ============================================================================
-- 3. MARK A PERIOD FUNDED
-- ============================================================================
-- Called by the cron after payment provider confirms the charge, and by the webhook.
-- Both may run for the same payment, so it is idempotent on status.

CREATE OR REPLACE FUNCTION public.tropical_mark_period_funded(
  p_period            uuid,
  p_payment_intent_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.tropical_role_periods WHERE id = p_period FOR UPDATE;

  IF v_status IS NULL THEN RETURN false; END IF;
  -- Already funded, or already past funding. Not an error: the webhook and the
  -- cron both call this for the same charge and exactly one should win.
  IF v_status NOT IN ('scheduled', 'funding', 'funding_failed') THEN RETURN false; END IF;

  UPDATE public.tropical_role_periods
  SET status = 'funded',
      payment_intent_id = COALESCE(p_payment_intent_id, payment_intent_id),
      failure_reason = NULL,
      updated_at = now()
  WHERE id = p_period;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.tropical_mark_period_failed(
  p_period uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tropical_role_periods
  SET status = 'funding_failed',
      failure_reason = left(COALESCE(p_reason, 'unknown'), 500),
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = p_period AND status IN ('scheduled', 'funding', 'funding_failed');
END;
$$;

-- ============================================================================
-- 4. RELEASE A PERIOD
-- ============================================================================
-- Mirrors tropical_release_role's balance credit exactly, and deliberately does
-- NOT mirror its ending: no escrow status, no project status, no completion
-- message. A released period is a payslip, not a finish line.

CREATE OR REPLACE FUNCTION public.tropical_release_period(p_period uuid)
RETURNS TABLE (
  creative_id    uuid,
  amount         bigint,
  role_title     text,
  -- out_ prefix, matching 020's own release_role. A RETURNS TABLE column
  -- becomes a plpgsql variable, and a bare `project_id` then collides with the
  -- column of the same name in the queries below — which plpgsql reports as an
  -- ambiguous reference at runtime, not at creation. 020 hit this and renamed;
  -- so does this.
  out_project_id uuid,
  project_name   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p record;
BEGIN
  SELECT rp.*, r.title AS role_title, p.name AS project_name
    INTO v_p
  FROM public.tropical_role_periods rp
  JOIN public.tropical_project_roles r ON r.id = rp.role_id
  JOIN public.tropical_projects p      ON p.id = rp.project_id
  WHERE rp.id = p_period
  FOR UPDATE OF rp;

  IF v_p IS NULL THEN RETURN; END IF;

  -- Only a funded or delivered period pays out. A period that never funded
  -- must never release: that is the line between "we stop the next period"
  -- and "we paid for work nobody paid us for".
  IF v_p.status NOT IN ('funded', 'delivered') THEN RETURN; END IF;
  IF v_p.creative_id IS NULL THEN RETURN; END IF;

  UPDATE public.tropical_role_periods
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE id = p_period;

  INSERT INTO public.tropical_user_balances (user_id, available, lifetime_earned)
  VALUES (v_p.creative_id, v_p.net, v_p.net)
  ON CONFLICT (user_id) DO UPDATE
    SET available       = public.tropical_user_balances.available + EXCLUDED.available,
        lifetime_earned = public.tropical_user_balances.lifetime_earned + EXCLUDED.lifetime_earned,
        updated_at      = now();

  -- The partial unique index on (period_id) WHERE type = 'period_release' is
  -- what stops a duplicated call crediting twice.
  INSERT INTO public.tropical_balance_transactions
    (user_id, project_id, role_id, period_id, amount, type, status)
  VALUES (v_p.creative_id, v_p.project_id, v_p.role_id, p_period, v_p.net,
          'period_release', 'completed')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tropical_role_events (project_id, role_id, actor_id, event_type, note)
  VALUES (v_p.project_id, v_p.role_id, NULL, 'approved',
          format('Period %s to %s released.', v_p.period_start, v_p.period_end));

  RETURN QUERY SELECT v_p.creative_id, v_p.net, v_p.role_title, v_p.project_id, v_p.project_name;
  -- (v_p.project_id is the record's field, not the OUT variable — unambiguous.)
END;
$$;

-- ============================================================================
-- 5. CORRECTION: a live retainer must not complete a project
-- ============================================================================
-- tropical_release_role (017) marks the PROJECT completed once no held escrow
-- remains. On a project that also carries a recurring role, releasing the last
-- fixed-price slice would complete the project out from under an engagement
-- that is still running — closing the group channel (011:213) and firing a
-- "Project complete" message at someone who is still working.
--
-- The guard is added here rather than by rewriting 017 so the change is
-- visible next to the feature that needs it.

CREATE OR REPLACE FUNCTION public.tropical_has_live_recurring(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tropical_project_roles r
    WHERE r.project_id = p_project
      AND r.pay_model = 'recurring'
      AND r.paused_at IS NULL
      AND (r.ends_at IS NULL OR r.ends_at > CURRENT_DATE)
  );
$$;

-- Re-declared from migration 020, NOT 017.
--
-- 017 defined this function as RETURNS void. 020 then redefined it as
-- RETURNS TABLE(...) so the caller could email everyone who was just paid —
-- modules/escrow/actions.ts passes those rows straight to notifyRolesReleased.
--
-- An earlier version of this file was copied from 017 and failed to apply:
--
--   ERROR: cannot change return type of existing function
--
-- which is the good outcome. Had the signatures happened to match, it would
-- have silently reverted 020 and killed every release notification in the app.
--
-- So this is 020's body verbatim, with one condition added to the completion
-- branch. If 020 is ever revised, this copy has to be revised with it — the
-- duplication is the cost of not editing a historical migration in place.

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

  -- THE CHANGE, and the only one. Every escrow slice may be paid out while a
  -- retainer on the same project runs for another eleven months. Completing
  -- here would close the group channel (011:213) and tell a working
  -- contractor the project is over.
  IF v_fully_released AND NOT public.tropical_has_live_recurring(v_project) THEN
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

-- ============================================================================
-- 6. ADD A ROLE TO A RUNNING PROJECT
-- ============================================================================
-- 011 gates role and member changes on status IN ('draft','pending_payment'),
-- which is right for a fixed pot — reslicing money people have already agreed
-- to is not a thing you do quietly. It also means that on a long-running
-- retainer project you can never add a contractor, which a roster of 600
-- onboarded over weeks requires constantly.
--
-- A recurring role does not touch the pot: it brings its own schedule and its
-- own charges. So it can be added to an active project, and only a recurring
-- role can.

CREATE OR REPLACE FUNCTION public.tropical_add_recurring_role(
  p_project        uuid,
  p_title          text,
  p_discipline     text,
  p_user           uuid,
  p_period         text,
  p_period_amount  bigint,
  p_starts         date,
  p_approval       text DEFAULT 'auto',
  p_ends           date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_brand  uuid;
  v_status text;
  v_role   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT brand_id, status INTO v_brand, v_status
  FROM public.tropical_projects WHERE id = p_project;

  IF v_brand IS NULL OR v_brand <> v_caller THEN
    RAISE EXCEPTION 'only the project owner can add roles' USING ERRCODE = '42501';
  END IF;

  -- Deliberately permits 'active', which the fixed-price path does not.
  IF v_status NOT IN ('draft', 'pending_payment', 'active') THEN
    RAISE EXCEPTION 'this project is % and cannot take new roles', v_status
      USING ERRCODE = '22023';
  END IF;

  IF p_period NOT IN ('weekly','monthly') THEN
    RAISE EXCEPTION 'period must be weekly or monthly' USING ERRCODE = '22023';
  END IF;

  -- RETURNING, not a re-select by title: two roles can share a title, and
  -- "the newest one with this name" is a race waiting to pick the wrong row.
  INSERT INTO public.tropical_project_roles
    (project_id, title, discipline_slug, assigned_user_id, status,
     percentage, amount,
     pay_model, period, period_amount, approval, next_period_start, ends_at)
  VALUES
    (p_project, p_title, p_discipline, p_user,
     CASE WHEN p_user IS NULL THEN 'open' ELSE 'invited' END,
     -- A retainer takes no slice of the pot. Zero here keeps splitPot's
     -- guarantee (fee + sum(roles) = budget) true for the fixed roles; the
     -- percentage CHECK is relaxed for recurring roles in 027.
     0, 0,
     'recurring', p_period, p_period_amount, p_approval, p_starts, p_ends)
  RETURNING id INTO v_role;

  IF p_user IS NOT NULL THEN
    -- The column is member_role, not role.
    INSERT INTO public.tropical_project_members (project_id, user_id, member_role, role_id)
    VALUES (p_project, p_user, 'creative', v_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_schedule_period(uuid) FROM public;
REVOKE ALL ON FUNCTION public.tropical_mark_period_funded(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.tropical_mark_period_failed(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.tropical_release_period(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_add_recurring_role(uuid, text, text, uuid, text, bigint, date, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tropical_has_live_recurring(uuid) TO authenticated;

COMMIT;
