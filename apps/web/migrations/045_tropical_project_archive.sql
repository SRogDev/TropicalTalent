-- ============================================================================
-- 045 — Removing a project archives it, and settles it first
-- ============================================================================
-- 044 gave an admin an approve button whose implementation was
-- `DELETE FROM tropical_projects`. Two things were wrong with that, and the
-- second one is a money bug.
--
-- ---------------------------------------------------------------------------
-- 1. A cascade is not a way to stop paying people
-- ---------------------------------------------------------------------------
-- Deleting a project cascades tropical_project_escrows, tropical_escrow_holds and
-- tropical_role_periods. So the question "does removing a project stop the money"
-- had an answer that only looked like yes:
--
--   * FUTURE recurring charges did stop — but only as a side effect of the
--     rows the pay run reads no longer existing. Nothing decided to stop them.
--
--   * Money ALREADY TAKEN was silently orphaned. A funded escrow is a real
--     PaymentIntent against a real card; deleting the project destroys the only
--     record the platform has of what that charge was for, refunds nothing, and
--     leaves a held slice that a creative had delivered against with no claim
--     and no trace. A `funded` role period is the same thing on the recurring
--     side: charged, undelivered, gone.
--
-- The one piece that survived was the ledger — tropical_balance_transactions
-- points at the project with ON DELETE SET NULL — so balances stayed correct
-- while everything explaining them disappeared.
--
-- So archiving now REFUSES while money is outstanding, and stops the recurring
-- schedule deliberately rather than incidentally: it pauses every recurring
-- role and skips every period that has not been charged, which is what makes
-- the pay run's own filters (billing.ts) decline to pick them up.
--
-- ---------------------------------------------------------------------------
-- 2. Archived, not erased
-- ---------------------------------------------------------------------------
-- A project is the record of an agreement between two parties: contracts,
-- deliverables, the whole conversation. Destroying it at one party's request —
-- even with an admin approving — removes the evidence the other party would
-- need in exactly the dispute this flow exists to prevent.
--
-- The boundary is Postgres, not TypeScript, per this codebase's rule: the
-- SELECT policy below excludes archived rows, so every user-facing query loses
-- them at once without a single call site being changed. Admin reads go through
-- the service role and still see everything, which is the point.
-- ============================================================================

BEGIN;

ALTER TABLE public.tropical_projects
  ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;

COMMENT ON COLUMN public.tropical_projects.archived_at IS
  'Set instead of deleting the row. Excluded from the members SELECT policy, so an archived project is invisible to every user-facing query while remaining intact for admins and for any later dispute.';

CREATE INDEX IF NOT EXISTS idx_tropical_projects_archived
  ON public.tropical_projects (tenant_id, archived_at)
  WHERE archived_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The SELECT policy
-- ---------------------------------------------------------------------------
-- 024's body verbatim, plus the archived clause. The SAME policy rather than an
-- additional one, for the reason 024 states: permissive policies are OR'd, so a
-- second one would widen access rather than narrow it.

DROP POLICY IF EXISTS "tropical_projects_read_members" ON public.tropical_projects;
CREATE POLICY "tropical_projects_read_members" ON public.tropical_projects
  FOR SELECT USING (
    archived_at IS NULL
    AND public.tropical_is_tenant_member(tenant_id, (SELECT auth.uid()))
    AND (
      brand_id = (SELECT auth.uid())
      OR public.tropical_is_member(id, (SELECT auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- The membership predicates
-- ---------------------------------------------------------------------------
-- Hiding the project row is not on its own enough. Every child table —
-- channels, messages, roles, contracts, deliverables, periods — writes its
-- policy in terms of tropical_is_member() / tropical_is_brand(), which read
-- tropical_project_members and never look at the project at all. Without this,
-- an archived project vanishes from every screen while its messages remain
-- readable to anyone who kept an id.
--
-- Teaching the two predicates about archiving closes all of them at once, and
-- closes writes with them: an archived project should not accept a new message
-- either. That is the same argument 045's header makes about the SELECT
-- policy — one place, not thirty call sites.
--
-- Service-role callers (the pay run, every admin loader, the archive function
-- itself) bypass RLS and are unaffected.

CREATE OR REPLACE FUNCTION public.tropical_is_member(p_project uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tropical_project_members m
    JOIN public.tropical_projects p ON p.id = m.project_id
    WHERE m.project_id = p_project
      AND m.user_id = p_user
      AND p.archived_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.tropical_is_brand(p_project uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tropical_projects p
    WHERE p.id = p_project
      AND p.brand_id = p_user
      AND p.archived_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.tropical_is_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.tropical_is_brand(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_is_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tropical_is_brand(uuid, uuid) TO authenticated;

-- ============================================================================
-- ARCHIVING
-- ============================================================================
-- Service role only. Both callers have already decided who is allowed:
-- deleteProjectAction (the owner, before the project began) and
-- resolveDeleteRequestAction (an admin, scoped to their tenant). This function
-- decides the one thing neither of them can: whether the money is settled.

CREATE OR REPLACE FUNCTION public.tropical_archive_project(
  p_project uuid,
  p_actor   uuid DEFAULT NULL,
  p_reason  text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project    record;
  v_held       bigint;
  v_in_flight  bigint;
BEGIN
  SELECT id, archived_at INTO v_project
  FROM public.tropical_projects
  WHERE id = p_project
  FOR UPDATE;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: two admins clicking, or a retry, must not double-pause
  -- anything or overwrite the original reason.
  IF v_project.archived_at IS NOT NULL THEN
    RETURN 'already_archived';
  END IF;

  -- ---------------------------------------------------------------------
  -- Money first. This is the check whose absence made deletion a data loss
  -- rather than a state change.
  -- ---------------------------------------------------------------------
  -- A held slice is a real charge sitting against a real card, earmarked for
  -- somebody who may already have delivered. There is no refund path in the
  -- app today, so the honest thing is to refuse and say so: the release or the
  -- payment provider refund happens first, then the project can be archived.
  --
  -- The join is what makes this a money check rather than a paperwork one.
  -- tropical_open_escrow writes the per-role holds BEFORE the brand leaves for
  -- payment provider, so a project whose owner opened checkout and closed the tab has
  -- 'held' rows against an escrow that never took a penny. Blocking on those
  -- would strand exactly the projects that are safest to archive.
  SELECT count(*) INTO v_held
  FROM public.tropical_escrow_holds h
  JOIN public.tropical_project_escrows e ON e.id = h.escrow_id
  WHERE h.project_id = p_project
    AND h.status = 'held'
    AND e.status IN ('funded', 'partially_released');

  IF v_held > 0 THEN
    RAISE EXCEPTION
      'escrow still holds % slice(s) for this project - release or refund them before archiving',
      v_held
      USING ERRCODE = '22023';
  END IF;

  -- The recurring equivalent: charged, not yet paid out. 'funding' is a charge
  -- mid-flight, so it counts too — archiving underneath it would strand a
  -- PaymentIntent whose row nobody is watching any more.
  SELECT count(*) INTO v_in_flight
  FROM public.tropical_role_periods
  WHERE project_id = p_project
    AND status IN ('funding', 'funded', 'delivered');

  IF v_in_flight > 0 THEN
    RAISE EXCEPTION
      '% period(s) on this project have been charged but not released - settle them before archiving',
      v_in_flight
      USING ERRCODE = '22023';
  END IF;

  -- ---------------------------------------------------------------------
  -- Stop the schedule, deliberately.
  -- ---------------------------------------------------------------------
  -- Both halves matter, and they guard different passes of the pay run:
  -- pausing the role stops scheduleUpcomingPeriods creating the NEXT period,
  -- and skipping the uncharged ones stops fundDuePeriods charging the periods
  -- that already exist. Doing only one leaves the other pass working.
  UPDATE public.tropical_project_roles
  SET paused_at = COALESCE(paused_at, now()), updated_at = now()
  WHERE project_id = p_project AND pay_model = 'recurring';

  UPDATE public.tropical_role_periods
  SET status = 'skipped', updated_at = now()
  WHERE project_id = p_project
    AND status IN ('scheduled', 'funding_failed');

  UPDATE public.tropical_projects
  SET archived_at    = now(),
      archived_by    = p_actor,
      archive_reason = p_reason,
      updated_at     = now()
  WHERE id = p_project;

  RETURN 'archived';
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_archive_project(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_archive_project(uuid, uuid, text) TO service_role;

COMMIT;

-- ============================================================================
-- Verify
-- ============================================================================
--   -- an archived project is invisible to its own members:
--   SET LOCAL ROLE authenticated;
--   SELECT count(*) FROM public.tropical_projects WHERE id = '<archived>';  -- 0
--
--   -- and refuses to archive while money is outstanding:
--   SELECT public.tropical_archive_project('<project with a held slice>');
-- ============================================================================
