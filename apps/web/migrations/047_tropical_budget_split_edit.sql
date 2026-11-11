-- ============================================================================
-- 047 — A brand can reprice a pot before escrow is funded
-- ============================================================================
-- Until now a pot's budget and split were fixed at creation. The only way to
-- change a fee was to remove the creative and re-invite them, which also threw
-- away the contract they had negotiated. Negotiation is the whole point of the
-- pre-escrow phase, and money is the thing most often negotiated.
--
-- So the brand can now change the budget and the percentage split at any time
-- before the pot is funded. The rules that make that safe:
--
--   * Amounts are recomputed HERE, in SQL, with the same largest-remainder
--     allocation as lib/money.ts:splitPot(). The client sends percentages and
--     a budget; it never sends pence. That keeps the invariant every release
--     depends on — fee + sum(role.amount) = budget, exactly.
--
--   * Every role must be in the payload. A split is a partition of the pool;
--     a partial update would leave the untouched roles summing to the wrong
--     total.
--
--   * A role whose amount ACTUALLY CHANGES has its contract re-opened for the
--     creative: creative_accepted goes false, status goes back to 'draft', and
--     they hear about it in the role DM and the bell. A role whose amount does
--     not change — same pence before and after — is left alone. Its creative
--     agreed to a number and that number still stands; pinging them for a
--     change that did not reach them is noise.
--
--   * An abandoned checkout leaves a 'pending' escrow row with one 'held' hold
--     per role at the OLD amounts, and tropical_create_escrow_checkout only
--     inserts holds that are missing. Left as-is those holds would be released
--     at the pre-edit figures. They are repriced here, in the same transaction
--     as the roles they mirror.
--
-- The payment provider side of an abandoned checkout — expiring the session so it cannot
-- be paid at the old total — is the server action's job; SQL cannot reach
-- payment provider. See modules/escrow/actions.ts:updateBudgetSplitAction.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The allocation, ported
-- ---------------------------------------------------------------------------
-- lib/money.ts:allocate(). Given a total in pence and a list of weights,
-- returns one integer share per weight such that the shares sum to the total
-- exactly. Leftover pence go to the largest fractional parts; ties break on
-- the larger share, then on position. Stateless and pure, so it is IMMUTABLE.

CREATE OR REPLACE FUNCTION public.tropical_allocate(p_total bigint, p_weights numeric[])
RETURNS bigint[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sum       numeric := 0;
  v_n         int := COALESCE(array_length(p_weights, 1), 0);
  v_exact     numeric[];
  v_out       bigint[];
  v_remainder bigint;
  v_i         int;
  v_idx       int;
BEGIN
  IF v_n = 0 THEN RETURN '{}'::bigint[]; END IF;

  FOR v_i IN 1..v_n LOOP v_sum := v_sum + p_weights[v_i]; END LOOP;
  IF v_sum <= 0 THEN
    RETURN array_fill(0::bigint, ARRAY[v_n]);
  END IF;

  v_exact := ARRAY[]::numeric[];
  v_out   := ARRAY[]::bigint[];
  FOR v_i IN 1..v_n LOOP
    v_exact := v_exact || ((p_total * p_weights[v_i]) / v_sum);
    v_out   := v_out   || floor(v_exact[v_i])::bigint;
  END LOOP;

  v_remainder := p_total;
  FOR v_i IN 1..v_n LOOP v_remainder := v_remainder - v_out[v_i]; END LOOP;

  -- Hand the leftover pence out one at a time in tie-broken order, cycling
  -- if there are more pence than entries (cannot happen for floor(), but the
  -- JS original loops the same way and the port should not be cleverer).
  WHILE v_remainder > 0 LOOP
    FOR v_idx IN
      SELECT i
      FROM unnest(v_exact) WITH ORDINALITY AS t(value, i)
      ORDER BY (value - floor(value)) DESC, value DESC, i ASC
    LOOP
      EXIT WHEN v_remainder <= 0;
      v_out[v_idx] := v_out[v_idx] + 1;
      v_remainder  := v_remainder - 1;
    END LOOP;
  END LOOP;

  RETURN v_out;
END;
$$;

-- lib/money.ts:formatPence(), near enough for a chat message: "£1,250" when
-- whole pounds, "£1,250.50" otherwise; a non-GBP pot gets its ISO code.
CREATE OR REPLACE FUNCTION public.tropical_format_money(p_pence bigint, p_currency text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN upper(coalesce(p_currency, 'GBP')) = 'GBP' THEN '£' ELSE upper(p_currency) || ' ' END
      || CASE WHEN p_pence % 100 = 0
              THEN to_char(p_pence / 100, 'FM999,999,999,990')
              ELSE to_char(p_pence / 100.0, 'FM999,999,999,990.00')
         END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The edit
-- ---------------------------------------------------------------------------
-- p_roles: [{ "role_id": uuid, "percentage": number }, ...] — every role on
-- the project, each once.
--
-- Returns one row per role whose pence amount changed and which has someone
-- assigned, so the caller can email exactly those people and nobody else.

CREATE OR REPLACE FUNCTION public.tropical_update_budget_split(
  p_project uuid,
  p_budget  bigint,
  p_roles   jsonb
)
RETURNS TABLE (
  out_role_id    uuid,
  out_user_id    uuid,
  out_role_title text,
  old_amount     bigint,
  new_amount     bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_brand     uuid;
  v_status    text;
  v_kind      text;
  v_name      text;
  v_currency  text;
  v_fee_pct   numeric;
  v_fee       bigint;
  v_pool      bigint;
  v_role_ids  uuid[];
  v_weights   numeric[];
  v_amounts   bigint[];
  v_count     int;
  v_i         int;
  v_escrow    uuid;
  v_channel   uuid;
  v_old       bigint;
  v_user      uuid;
  v_title     text;
  v_had_contract boolean;
  -- The roles whose pence changed, collected as we go: one entry per role in
  -- v_role_ids order.
  v_changed   boolean[] := '{}';
  v_olds      bigint[]  := '{}';
  v_users     uuid[]    := '{}';
  v_titles    text[]    := '{}';
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_budget IS NULL OR p_budget <= 0 THEN
    RAISE EXCEPTION 'budget must be above zero' USING ERRCODE = '22023';
  END IF;

  SELECT p.brand_id, p.status, p.kind, p.name, p.platform_fee_pct, p.currency
    INTO v_brand, v_status, v_kind, v_name, v_fee_pct, v_currency
  FROM public.tropical_projects p
  WHERE p.id = p_project
  FOR UPDATE;

  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = '22023';
  END IF;
  IF v_brand <> v_caller THEN
    RAISE EXCEPTION 'only the project owner can change the budget' USING ERRCODE = '42501';
  END IF;
  IF v_kind <> 'pot' THEN
    RAISE EXCEPTION 'a retainer has no pot to split' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'escrow is paid - the budget is locked' USING ERRCODE = '22023';
  END IF;

  -- Every role, once. The join against the project's own roles is what stops
  -- a role id from another project riding in on the payload.
  SELECT array_agg(r.id ORDER BY r.sort_order, r.id),
         array_agg((x.percentage)::numeric ORDER BY r.sort_order, r.id),
         count(*)
    INTO v_role_ids, v_weights, v_count
  FROM public.tropical_project_roles r
  JOIN jsonb_to_recordset(p_roles) AS x(role_id uuid, percentage numeric)
    ON x.role_id = r.id
  WHERE r.project_id = p_project;

  IF v_count IS DISTINCT FROM (SELECT count(*) FROM public.tropical_project_roles WHERE project_id = p_project)
     OR v_count IS DISTINCT FROM jsonb_array_length(p_roles)
     OR v_count IS DISTINCT FROM (SELECT count(DISTINCT role_id) FROM jsonb_to_recordset(p_roles) AS y(role_id uuid)) THEN
    RAISE EXCEPTION 'every role must be in the split exactly once' USING ERRCODE = '22023';
  END IF;

  FOR v_i IN 1..v_count LOOP
    IF v_weights[v_i] IS NULL OR v_weights[v_i] <= 0 OR v_weights[v_i] > 100 THEN
      RAISE EXCEPTION 'each share must be between 0 and 100' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Same arithmetic as splitPot(): the fee rounds DOWN so the crew never pays
  -- for the rounding, and the pool is what the shares partition.
  v_fee     := floor((p_budget * v_fee_pct) / 100)::bigint;
  v_pool    := p_budget - v_fee;
  v_amounts := public.tropical_allocate(v_pool, v_weights);

  UPDATE public.tropical_projects
  SET budget = p_budget, updated_at = now()
  WHERE id = p_project;

  -- Read each role's before-figure in the same loop that overwrites it, so
  -- "changed" is judged against exactly what the creative had agreed to.
  FOR v_i IN 1..v_count LOOP
    SELECT amount, assigned_user_id, title
      INTO v_old, v_user, v_title
    FROM public.tropical_project_roles
    WHERE id = v_role_ids[v_i];

    UPDATE public.tropical_project_roles
    SET percentage = v_weights[v_i],
        amount     = v_amounts[v_i],
        updated_at = now()
    WHERE id = v_role_ids[v_i];

    v_changed := v_changed || (v_old <> v_amounts[v_i]);
    v_olds    := v_olds    || v_old;
    v_users   := v_users   || v_user;
    v_titles  := v_titles  || v_title;
  END LOOP;

  -- An abandoned checkout's escrow row and holds mirror the roles; keep them
  -- true. Only 'pending' — anything else is past the point this function is
  -- allowed to run, and the status check above already refused it.
  SELECT id INTO v_escrow
  FROM public.tropical_project_escrows
  WHERE project_id = p_project AND status = 'pending';

  IF v_escrow IS NOT NULL THEN
    UPDATE public.tropical_project_escrows
    SET total_amount = p_budget, platform_fee = v_fee, updated_at = now()
    WHERE id = v_escrow;

    UPDATE public.tropical_escrow_holds h
    SET amount = r.amount, updated_at = now()
    FROM public.tropical_project_roles r
    WHERE h.role_id = r.id
      AND h.escrow_id = v_escrow
      AND h.status = 'held'
      AND h.amount <> r.amount;
  END IF;

  -- Every repriced role with someone in it hears about it: a message in the
  -- role DM from the brand, and a bell row. If a contract exists it is
  -- re-opened for the creative — the brand made this change, so their own
  -- acceptance stands; the creative's is what the new number needs. If no
  -- contract has been drafted yet there is nothing to re-open, and the message
  -- says so rather than asking them to accept a document that is not there.
  FOR v_i IN 1..v_count LOOP
    CONTINUE WHEN NOT v_changed[v_i] OR v_users[v_i] IS NULL;

    UPDATE public.tropical_role_contracts
    SET creative_accepted = false,
        brand_accepted    = true,
        status            = 'draft',
        updated_by        = v_caller,
        updated_at        = now()
    WHERE role_id = v_role_ids[v_i];
    v_had_contract := FOUND;

    SELECT id INTO v_channel
    FROM public.tropical_channels
    WHERE role_id = v_role_ids[v_i] AND type = 'dm';

    IF v_channel IS NOT NULL THEN
      INSERT INTO public.tropical_channel_messages (channel_id, project_id, sender_id, kind, content)
      VALUES (
        v_channel, p_project, v_caller, 'contract',
        jsonb_build_object(
          'event',      'fee_updated',
          'old_amount', v_olds[v_i],
          'new_amount', v_amounts[v_i],
          'text',       'Updated the fee for ' || v_titles[v_i] || ' from '
                        || public.tropical_format_money(v_olds[v_i], v_currency) || ' to '
                        || public.tropical_format_money(v_amounts[v_i], v_currency) || '.'
                        || CASE WHEN v_had_contract
                                THEN ' Please review and accept the contract again.'
                                ELSE '' END
        )
      );
    END IF;

    INSERT INTO public.tropical_notifications (user_id, project_id, kind, title, body, actor_id)
    VALUES (
      v_users[v_i], p_project, 'contract_updated',
      'Fee updated - ' || v_titles[v_i],
      'Your fee for ' || v_titles[v_i] || ' on ' || v_name || ' is now '
        || public.tropical_format_money(v_amounts[v_i], v_currency)
        || CASE WHEN v_had_contract
                THEN '. Review and accept the contract in the role chat.'
                ELSE '.' END,
      v_caller
    );
  END LOOP;

  RETURN QUERY
  SELECT v_role_ids[i], v_users[i], v_titles[i], v_olds[i], v_amounts[i]
  FROM generate_series(1, v_count) AS i
  WHERE v_changed[i] AND v_users[i] IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_update_budget_split(uuid, bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_update_budget_split(uuid, bigint, jsonb) TO authenticated;

COMMENT ON FUNCTION public.tropical_update_budget_split(uuid, bigint, jsonb) IS
  'Brand reprices a pot before escrow: recomputes every role amount with the same allocation as splitPot(), reprices a pending escrow''s holds, and re-opens the contracts of the roles whose amount changed. Returns those roles so the caller can email exactly them.';

COMMIT;
