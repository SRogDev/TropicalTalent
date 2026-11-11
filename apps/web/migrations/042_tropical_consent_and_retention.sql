-- ============================================================================
-- 042 — Terms acceptance, marketing consent, retention
-- ============================================================================
-- The schema half of three promises the published policy now makes and the
-- code could not keep:
--
--   1. that people accept the Terms, and that we can show what they accepted
--   2. that turning off marketing does not turn off the emails about your money
--   3. that data has a retention period and something enforces it
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TERMS ACCEPTANCE
-- ============================================================================
-- The sign-up dialog has had a checkbox since 2026-08-27, and it gates the
-- button — but `agreedToTerms` is React state that never leaves the browser.
-- Nothing is written down, so the honest answer to "what did this person agree
-- to, and when" was: we don't know. That is the half that matters, because the
-- Terms it gates now govern escrow, a continuous payment authority and a
-- liability cap.
--
-- One row per acceptance, not one per user: the Terms change, and a person who
-- accepted v2.0 and later v2.1 has agreed to two different documents. Keeping
-- the history is the point — superseding a row would destroy the evidence of
-- what applied to a project funded in between.
--
-- A tropical_ table rather than users.terms_version for the reason 040 gives at
-- length: public.users is read, never migrated, by this codebase.

CREATE TABLE IF NOT EXISTS public.tropical_terms_acceptances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Which document, and which version of it. Free text rather than an enum:
  -- the version string lives in TS (lib/legal.ts) and a CHECK here would mean
  -- a migration every time the wording changes, which is exactly the friction
  -- that stops people versioning documents at all.
  document    text NOT NULL DEFAULT 'terms'
              CHECK (document IN ('terms', 'privacy')),
  version     text NOT NULL,
  -- The site they accepted it on. A white-label's users accepted it there.
  tenant_id   uuid REFERENCES public.tropical_tenants(id) ON DELETE SET NULL,
  -- 'signup' | 'oauth_complete' | 're_accept'
  source      text NOT NULL DEFAULT 'signup',
  accepted_at timestamptz NOT NULL DEFAULT now(),

  -- One acceptance per user per version of a document. A double-submitted form
  -- must not read as two separate agreements.
  CONSTRAINT tropical_terms_acceptances_once UNIQUE (user_id, document, version)
);

COMMENT ON TABLE public.tropical_terms_acceptances IS
  'Evidence of who accepted which version of which document, and when. Append-only: never update or delete a row, or the record of what applied at the time is gone.';

CREATE INDEX IF NOT EXISTS idx_tropical_terms_acceptances_user
  ON public.tropical_terms_acceptances (user_id, accepted_at DESC);

ALTER TABLE public.tropical_terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Read your own, so a person can be shown what they agreed to. No UPDATE and
-- no DELETE policy at all, for anyone: this table is append-only by design and
-- the absence of a policy is what enforces it.
DROP POLICY IF EXISTS "tropical_terms_acceptances_read_own" ON public.tropical_terms_acceptances;
CREATE POLICY "tropical_terms_acceptances_read_own" ON public.tropical_terms_acceptances
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.tropical_terms_acceptances FROM anon;
REVOKE ALL ON public.tropical_terms_acceptances FROM PUBLIC;
GRANT SELECT ON public.tropical_terms_acceptances TO authenticated;
GRANT ALL    ON public.tropical_terms_acceptances TO service_role;

-- ============================================================================
-- 2. MARKETING CONSENT, SEPARATE FROM SERVICE EMAIL
-- ============================================================================
-- 020 created ONE switch and said so: "The only thing to configure is a master
-- on/off switch; no per-category granularity was asked for."
--
-- What that means in practice is that a person who does not want the "we miss
-- you at TropicalTalent" nudge has to turn off "your payout completed" to escape it.
-- Under PECR that is not a working opt-out, and under GDPR it means the
-- consent we rely on for marketing is bundled with something the person cannot
-- refuse — which is not freely given, and so is not consent.
--
-- ALTER is fine here where it would not be on public.users: this is a
-- tropical_ table, created by 020, owned by this app.
--
-- Default true preserves today's behaviour exactly for every existing row: a
-- person who never opted out stays opted in, and the soft opt-in this relies
-- on is the same one they were relying on before.

ALTER TABLE public.tropical_notification_preferences
  ADD COLUMN IF NOT EXISTS marketing_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tropical_notification_preferences.email_enabled IS
  'Optional SERVICE email — role assigned, work delivered, payout completed. Never gates marketing; see marketing_enabled.';
COMMENT ON COLUMN public.tropical_notification_preferences.marketing_enabled IS
  'Marketing and re-engagement email only. sendBulkEmail reads this and nothing else. An unsubscribe sets this false and must never touch email_enabled.';

-- Anyone who had already opted out of everything meant it. Carry that across
-- rather than silently opting them back in to marketing on the way past.
UPDATE public.tropical_notification_preferences
SET marketing_enabled = false
WHERE email_enabled = false AND marketing_enabled = true;

-- ============================================================================
-- 3. RETENTION
-- ============================================================================
-- The policy now names a period per category. Nothing enforced any of them,
-- which makes a published schedule worse than none.
--
-- This function does only what is unambiguously ours to delete and safe to
-- delete on a schedule. Deliberately NOT here:
--
--   waitlist              Pre-existing, and production reporting reads it.
--                         The 24-month period is real but purging it is a
--                         decision for whoever owns that reporting, not a
--                         side effect of this migration.
--   project data,
--   contracts, messages   Six years, and the other party has an equal
--                         interest. Far too long to hang off a nightly job
--                         written today.
--   payments, escrow,
--   wallet                Seven years and legally required. Never deleted.
--
-- Returns a row per table so the cron can report what it actually did.

CREATE OR REPLACE FUNCTION public.tropical_run_retention()
RETURNS TABLE (target text, removed bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n bigint;
BEGIN
  -- Read notifications older than a year. The in-app bell is a live surface,
  -- not an archive; the underlying events survive in the tables that own them.
  DELETE FROM public.tropical_notifications
  WHERE read = true AND created_at < now() - interval '12 months';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  target := 'tropical_notifications (read, >12mo)'; removed := v_n; RETURN NEXT;

  -- Invitations that were never taken up. An unclaimed roster row is an email
  -- address we are holding on a customer's behalf for a sign-up that is not
  -- going to happen.
  DELETE FROM public.tropical_tenant_invites
  WHERE claimed_at IS NULL AND created_at < now() - interval '12 months';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  target := 'tropical_tenant_invites (unclaimed, >12mo)'; removed := v_n; RETURN NEXT;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_run_retention() FROM public;
REVOKE ALL ON FUNCTION public.tropical_run_retention() FROM anon;
REVOKE ALL ON FUNCTION public.tropical_run_retention() FROM authenticated;

COMMIT;

-- ============================================================================
-- Verify
-- ============================================================================
--   SELECT document, version, count(*) FROM public.tropical_terms_acceptances
--   GROUP BY 1, 2;
--
--   SELECT email_enabled, marketing_enabled, count(*)
--   FROM public.tropical_notification_preferences GROUP BY 1, 2;
--
--   SELECT * FROM public.tropical_run_retention();   -- service role only
-- ============================================================================
