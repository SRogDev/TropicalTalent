-- ============================================================================
-- 055 — Cubora sourcing requests (Phase 3)
-- ============================================================================
-- The no-results workflow (plan §4, spec S21): when no suitable offer
-- exists, the discovery graph creates a structured sourcing request
-- and registers it in Cubora's internal operations system — which, per
-- spec assumption, is the Phase 4 lightweight CRM. The request is
-- searchable by ops: a GIN index on `requirements` plus a
-- (status, created_at) index for the unmatched-requests queue.
--
-- Status vocabulary is exactly open | matched | notified. Only ops
-- moves a request out of `open` (Phase 4 CRM, service role): the
-- trigger at the bottom raises if a write running as role
-- `authenticated` changes `status`, following the 051/052 guard
-- pattern. The requester can create and read their own requests.
--
-- Notification DELIVERY is a stub in this phase (see
-- apps/ai/app/services/sourcing_requests.py): a row in
-- tropical_sourcing_notifications with status `pending` records that
-- the requester must be told when a real opportunity appears. Nothing
-- is sent — no email, no push. Delivery, matching, and verification
-- of candidates belong to Phase 4.
--
-- O13 (spec) — sourcing-request timing — is OPEN in the spec. This
-- migration takes the documented default, marked ASSUMES in
-- docs/architecture/ai-orchestration.md §5: a request stays `open`
-- until a match is recorded (or the requester withdraws it in Phase
-- 4); the notification fires on the FIRST verified match; there is no
-- expiry threshold in the MVP.
--
-- Also in this file, one additive column the re-enabled Team Search
-- route needs: `agent_conversations.mode` ('agent' | 'team_search').
-- The route inserts it (app/routes/team_search.py); migration 053
-- created the table without it. Additive only; no other table is
-- altered.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Sourcing requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_sourcing_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The buyer's own words, verbatim. Never rewritten by the platform.
  query           text NOT NULL,
  -- Structured requirements, e.g.
  -- {"query": "...", "category": "products", "terms": ["coffee"],
  --  "location": null, "passion": null}. Written by the discovery
  -- graph (apps/ai/app/services/sourcing_requests.py).
  requirements    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'matched', 'notified')),
  -- The discovery conversation that created the request, if any.
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_sourcing_requests IS
  'Cubora sourcing requests (Phase 3). One row per no-results discovery turn. Status is open | matched | notified; only ops moves a request out of open. Spec OPEN O13: no expiry threshold in the MVP (see ai-orchestration.md §5).';
COMMENT ON COLUMN public.tropical_sourcing_requests.requirements IS
  'Structured requirements as JSONB, searchable via the GIN index below.';

CREATE INDEX IF NOT EXISTS tropical_sourcing_requests_user_created_idx
  ON public.tropical_sourcing_requests (user_id, created_at DESC);
-- The ops queue: unmatched requests, oldest first.
CREATE INDEX IF NOT EXISTS tropical_sourcing_requests_status_created_idx
  ON public.tropical_sourcing_requests (status, created_at ASC);
-- "Register it as searchable": ops can search inside requirements
-- (category, terms, location) without a full table scan.
CREATE INDEX IF NOT EXISTS tropical_sourcing_requests_requirements_gin_idx
  ON public.tropical_sourcing_requests USING GIN (requirements);

-- ---------------------------------------------------------------------------
-- Pending notifications (delivery stub — see header)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_sourcing_notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_request_id  uuid NOT NULL REFERENCES public.tropical_sourcing_requests(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Channel the requester should be reached on when a match appears.
  -- 'email' is the only channel named in the MVP; the row is a queue
  -- entry, not a sent message.
  channel              text NOT NULL DEFAULT 'email',
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_sourcing_notifications IS
  'Pending "notify when available" records (Phase 3 stub). A row means the requester must be told; it does NOT mean anything was sent. Delivery is Phase 4 work.';

CREATE INDEX IF NOT EXISTS tropical_sourcing_notifications_request_idx
  ON public.tropical_sourcing_notifications (sourcing_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tropical_sourcing_notifications_pending_idx
  ON public.tropical_sourcing_notifications (status, created_at ASC)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- agent_conversations.mode — needed by the re-enabled Team Search route
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS mode text;

COMMENT ON COLUMN public.agent_conversations.mode IS
  'Which flow owns the conversation: NULL (default agent chat) or team_search. Written by app/routes/team_search.py; added by migration 055 (Phase 3).';

-- ============================================================================
-- RLS (following 051/052)
-- ============================================================================
ALTER TABLE public.tropical_sourcing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_sourcing_notifications ENABLE ROW LEVEL SECURITY;

-- The requester reads their own requests.
DROP POLICY IF EXISTS "tropical_sourcing_requests_read_own" ON public.tropical_sourcing_requests;
CREATE POLICY "tropical_sourcing_requests_read_own" ON public.tropical_sourcing_requests
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- The requester creates their own requests (via the AI service, which
-- runs as service_role; this policy governs direct PostgREST access).
DROP POLICY IF EXISTS "tropical_sourcing_requests_insert_own" ON public.tropical_sourcing_requests;
CREATE POLICY "tropical_sourcing_requests_insert_own" ON public.tropical_sourcing_requests
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- No UPDATE/DELETE policy for authenticated: only ops (service_role)
-- moves a request out of `open`. The trigger below is the second layer.
DROP POLICY IF EXISTS "tropical_sourcing_notifications_read_own" ON public.tropical_sourcing_notifications;
CREATE POLICY "tropical_sourcing_notifications_read_own" ON public.tropical_sourcing_notifications
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- Status guard (following 051/052): only ops changes `status`
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tropical_sourcing_requests_guard_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated'
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'sourcing request status is set by Cubora operations only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_sourcing_requests_guard_status ON public.tropical_sourcing_requests;
CREATE TRIGGER tropical_sourcing_requests_guard_status
  BEFORE UPDATE ON public.tropical_sourcing_requests
  FOR EACH ROW EXECUTE FUNCTION public.tropical_sourcing_requests_guard_status();

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'public'
--     AND table_name IN ('tropical_sourcing_requests',
--       'tropical_sourcing_notifications');
--   -- Expect 2 rows. Then:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'agent_conversations' AND column_name = 'mode';
--   -- Expect 1 row. No live DB run yet — migrations are unapplied, as
--   -- every migration in this repo has been so far.
