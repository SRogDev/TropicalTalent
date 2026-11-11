-- ============================================================================
-- 044 — Deleting a project that has begun is an admin decision
-- ============================================================================
-- Up to now a project was deletable by its owner right up until the money
-- landed, and undeletable by anybody afterwards. Both halves were wrong once a
-- deletion can be disputed:
--
--   * The brand could remove a live workspace unilaterally. Channels, messages,
--     contracts and deliverables all cascade — so the record of what was agreed
--     disappears at the request of exactly one of the two parties to it, and
--     the contractor finds out by the project vanishing.
--
--   * Nobody could remove it afterwards, including the people who arbitrate.
--     A genuine "delete this, we cancelled before anyone started" had no route
--     at all, which is how support requests become database surgery.
--
-- So once a project has begun — escrow funded for a pot, a card saved for a
-- retainer — deletion moves behind the admin console and the brand raises a
-- request instead. Before it begins nothing is committed and no counterparty
-- is relying on the record, so the owner still removes it themselves.
--
-- ---------------------------------------------------------------------------
-- Why a table and not a complaint
-- ---------------------------------------------------------------------------
-- 041 argued the same thing in reverse: a dispute was the wrong home for a bug
-- report because its outcome moves money. This is the mirror image. A deletion
-- request has an outcome that DESTROYS a project, it is bound to exactly one
-- project, and "approve" is a button with a cascade behind it. Putting that in
-- the queue people scan for conduct reports is how one gets clicked by mistake.
--
-- Tenancy follows 032 and 041: tenant_id NOT NULL with no default, so a
-- request that forgets its tenant is a constraint violation rather than a
-- white-label's project quietly queued for TropicalTalent to action.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_project_delete_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL, not CASCADE, and that is the whole point of the column being
  -- nullable: approving a request DELETES the project, and a cascade would
  -- take the record of who asked, why, and who approved it down with the thing
  -- it authorised. The one row that has to outlive a destructive action cannot
  -- be a child of it.
  project_id   uuid REFERENCES public.tropical_projects(id) ON DELETE SET NULL,

  -- Snapshot, so a resolved row still says what was removed once project_id is
  -- gone. Display only — the queue prefers the live project's name while the
  -- project exists, precisely because this one arrived with a request.
  project_name text NOT NULL,

  tenant_id    uuid NOT NULL REFERENCES public.tropical_tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Optional, for the same reason 041 made complaint detail optional: a brand
  -- who has already decided is not helped by a validator demanding prose, and
  -- padding is not context.
  reason       text CHECK (reason IS NULL OR length(reason) <= 4000),

  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'approved', 'rejected', 'withdrawn')),
  resolution   text,
  resolved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_project_delete_requests IS
  'A brand asking for a project that has already begun to be removed. Approving one deletes the project, so it is actioned from /admin/deletions and nowhere else.';

-- One open request per project. A brand clicking twice, or two tabs posting
-- the same form, must not put two rows in front of an admin who then approves
-- one and is left holding the other against a project that no longer exists.
--
-- NULLs are not compared by a unique index, which is exactly right here: a
-- resolved row whose project has been deleted is not competing for anything.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_delete_requests_one_open
  ON public.tropical_project_delete_requests (project_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_tropical_delete_requests_queue
  ON public.tropical_project_delete_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_delete_requests_requester
  ON public.tropical_project_delete_requests (requested_by, created_at DESC);

ALTER TABLE public.tropical_project_delete_requests ENABLE ROW LEVEL SECURITY;

-- Only the project's OWNER may ask, and only into the tenant the project is
-- actually filed under. Both are re-derived from the project row rather than
-- taken from the insert, so a posted tenant_id or project_id belonging to
-- someone else fails the policy rather than the application's good intentions.
--
-- A NULL project_id fails this too — the EXISTS finds nothing — so the column
-- being nullable for the sake of the audit trail does not open a hole at the
-- point where rows are created.
DROP POLICY IF EXISTS "tropical_delete_requests_insert_own" ON public.tropical_project_delete_requests;
CREATE POLICY "tropical_delete_requests_insert_own" ON public.tropical_project_delete_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tropical_projects p
      WHERE p.id = tropical_project_delete_requests.project_id
        AND p.brand_id = (SELECT auth.uid())
        AND p.tenant_id = tropical_project_delete_requests.tenant_id
    )
  );

-- The requester reads their own, so the settings panel can say "requested, with
-- the team" instead of offering the button again. Admins read through the
-- service role, as everywhere else in modules/admin.
DROP POLICY IF EXISTS "tropical_delete_requests_read_own" ON public.tropical_project_delete_requests;
CREATE POLICY "tropical_delete_requests_read_own" ON public.tropical_project_delete_requests
  FOR SELECT TO authenticated
  USING (requested_by = (SELECT auth.uid()));

-- No UPDATE policy, and no UPDATE grant. Withdrawing goes through the service
-- role instead (withdrawProjectDeletionAction), which narrows the write to
-- `status` on the caller's own still-open row.
--
-- The reason is that an RLS UPDATE policy cannot see the OLD row in its WITH
-- CHECK, so a policy permissive enough to let a brand set status = 'withdrawn'
-- is also permissive enough to let them write `resolution` — the column an
-- admin's decision is recorded in, which would then read back as though an
-- admin had written it. The same reasoning tropical_project_roles is left with
-- no brand update policy: widening one column widens the row.
DROP POLICY IF EXISTS "tropical_delete_requests_withdraw_own" ON public.tropical_project_delete_requests;

REVOKE ALL ON public.tropical_project_delete_requests FROM anon;
REVOKE ALL ON public.tropical_project_delete_requests FROM PUBLIC;
GRANT SELECT, INSERT ON public.tropical_project_delete_requests TO authenticated;
GRANT ALL ON public.tropical_project_delete_requests TO service_role;

-- ============================================================================
-- Notification kinds
-- ============================================================================
-- Through 020's helper, which does the lookup-then-drop and unions this list
-- with the kinds already in the table. See its comment there.
SELECT public.tropical_set_notification_kinds(ARRAY[
  'application_received', 'application_unlocked', 'application_decided',
  'deliverables_updated', 'contract_updated', 'role_invited', 'escrow_funded',
  'dispute_raised', 'dispute_resolved', 'withdrawal_completed', 'withdrawal_failed',
  'role_delivered', 'role_released', 'project_completed', 'member_removed',
  'project_deleted', 'application_withdrawn', 'referral_redeemed',
  'complaint_raised', 'project_delete_requested'
]);

COMMIT;

-- ============================================================================
-- Verify
-- ============================================================================
--   SELECT status, count(*) FROM public.tropical_project_delete_requests
--   GROUP BY 1;
--
--   -- and that only one open request per project is possible:
--   INSERT INTO public.tropical_project_delete_requests
--     (project_id, tenant_id, requested_by) VALUES ('<p>', '<t>', '<u>');
--   -- a second identical insert must fail on
--   -- idx_tropical_delete_requests_one_open
-- ============================================================================
