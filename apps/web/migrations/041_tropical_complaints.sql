-- ============================================================================
-- 041 — Complaints
-- ============================================================================
-- A way to reach a human that does not require a project.
--
-- tropical_disputes (010) already exists and is NOT this. A dispute is bound to
-- a role, only opens once escrow is funded, and its outcome moves money. That
-- makes it useless for the three things people actually need to report:
--
--   * another user's conduct, where there may be no project at all — a talent
--     board and a public briefs feed are two places a stranger can reach you
--   * a bug
--   * a question
--
-- Routing them through the dispute table would have meant inventing a project
-- id for each one and putting non-financial reports into the queue that
-- decides who gets paid. This is a separate table with a separate queue, and
-- /admin/complaints renders both.
--
-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
-- tenant_id is NOT NULL and has no default, the same discipline 032 applied to
-- tropical_projects: a complaint that forgets its tenant is a NOT NULL violation
-- rather than a report filed silently into TropicalTalent's queue. A white-label's users
-- reach their own client's admin, not ours.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_complaints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tropical_tenants(id) ON DELETE CASCADE,
  raised_by   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  category    text NOT NULL
              CHECK (category IN ('report_user', 'report_bug', 'general_enquiry', 'other')),

  -- Only meaningful for 'report_user'. SET NULL rather than CASCADE: if the
  -- reported account is closed, the report is exactly the thing that should
  -- survive it.
  subject_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Optional, per the brief. A category alone is a usable signal — "this
  -- profile is a scam" needs no essay — so the form does not insist on prose
  -- that people will pad to get past a validator.
  detail      text CHECK (detail IS NULL OR length(detail) <= 4000),

  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'reviewing', 'resolved', 'rejected')),
  resolution  text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- A report about a user has to say which user.
  CONSTRAINT tropical_complaints_subject_required
    CHECK (category <> 'report_user' OR subject_user_id IS NOT NULL)
);

COMMENT ON TABLE public.tropical_complaints IS
  'Profile-level reports: conduct, bugs, enquiries. Distinct from tropical_disputes, which is role-scoped and moves escrow.';

-- The admin queue, per tenant.
CREATE INDEX IF NOT EXISTS idx_tropical_complaints_queue
  ON public.tropical_complaints (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_complaints_open
  ON public.tropical_complaints (tenant_id, created_at DESC)
  WHERE status IN ('open', 'reviewing');
CREATE INDEX IF NOT EXISTS idx_tropical_complaints_raiser
  ON public.tropical_complaints (raised_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_complaints_subject
  ON public.tropical_complaints (subject_user_id)
  WHERE subject_user_id IS NOT NULL;

ALTER TABLE public.tropical_complaints ENABLE ROW LEVEL SECURITY;

-- Insert your own, into a tenant you belong to. The tenant check is the point:
-- without it a member of one workspace could file into another's queue.
DROP POLICY IF EXISTS "tropical_complaints_insert_own" ON public.tropical_complaints;
CREATE POLICY "tropical_complaints_insert_own" ON public.tropical_complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    raised_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tropical_tenant_members m
      WHERE m.tenant_id = tropical_complaints.tenant_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
    )
  );

-- Read your own, and nothing else. Admins read through the service role, as
-- everywhere else in modules/admin — the person being reported must never be
-- able to see the report, which a policy written around subject_user_id would
-- have handed them.
DROP POLICY IF EXISTS "tropical_complaints_read_own" ON public.tropical_complaints;
CREATE POLICY "tropical_complaints_read_own" ON public.tropical_complaints
  FOR SELECT TO authenticated
  USING (raised_by = (SELECT auth.uid()));

REVOKE ALL ON public.tropical_complaints FROM anon;
REVOKE ALL ON public.tropical_complaints FROM PUBLIC;
GRANT SELECT, INSERT ON public.tropical_complaints TO authenticated;
GRANT ALL ON public.tropical_complaints TO service_role;

-- ============================================================================
-- Notification kind
-- ============================================================================
-- Through 020's helper, which does the lookup-then-drop and unions this list
-- with the kinds already in the table. Replaying an older migration must never
-- reject a kind a newer one legitimised — see its comment there for the
-- failure that taught us.
SELECT public.tropical_set_notification_kinds(ARRAY[
  'application_received', 'application_unlocked', 'application_decided',
  'deliverables_updated', 'contract_updated', 'role_invited', 'escrow_funded',
  'dispute_raised', 'dispute_resolved', 'withdrawal_completed', 'withdrawal_failed',
  'role_delivered', 'role_released', 'project_completed', 'member_removed',
  'project_deleted', 'application_withdrawn', 'referral_redeemed',
  'complaint_raised'
]);

COMMIT;

-- ============================================================================
-- Verify
-- ============================================================================
--   SELECT category, status, count(*) FROM public.tropical_complaints
--   GROUP BY 1, 2;
--
--   -- and that the constraint took:
--   INSERT INTO public.tropical_notifications (user_id, kind, title, body)
--   VALUES ('<uuid>', 'complaint_raised', 't', 'b');
-- ============================================================================
