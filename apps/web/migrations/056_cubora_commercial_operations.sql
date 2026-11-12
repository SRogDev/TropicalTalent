-- ============================================================================
-- 056 — Cubora commercial operations (Phase 4)
-- ============================================================================
-- The internal operations CRM, mediated negotiation, proposals,
-- contact-release approvals, fee records, and compliance reviews
-- (plan §5, §8, §9; spec S23–S31, S44–S47).
--
-- What this migration deliberately does NOT decide (spec OPEN O1–O5 —
-- Roger's decisions, see docs/product/commercial-model.md):
--   * the fee model (fixed / percentage / hybrid) — `tropical_fees`
--     stores type, amount, currency, and basis as NULLABLE, per
--     operation, exactly as ops enters them. No default, no percentage,
--     no amount, no currency anywhere in this file.
--   * what counts as "securing a contact" or when the fee becomes
--     payable — no column encodes a trigger; the fee record is a
--     record, not a charge, and there is no payment rail in the MVP.
--   * the contact-release conditions — `tropical_contact_releases`
--     records what ops attested was met (`conditions_summary`, in ops'
--     own words) and which side's contact was released. It does not
--     define the policy.
--   * the payment/compliance route — there is none in the MVP; custody
--     of funds, escrow, and live payments stay post-MVP (plan §5).
--
-- State machine (Cubora's own — it replaces the escrow-funded
-- transitions the workspace used to key off; audit §4.1/§6):
--   open → proposal → awaiting_acceptance → accepted
--     → contact_released → completed
--   any non-terminal state → blocked → open (unblock) | cancelled
--   completed / cancelled are terminal.
-- Only ops moves a negotiation between states: no UPDATE/DELETE policy
-- for `authenticated` on tropical_negotiations, plus the guard trigger
-- below (same two-layer pattern as 051/052/055). Parties signal intent
-- on proposals (acceptance flags); ops moves the negotiation.
--
-- Contact privacy (plan §5, spec S24/S27): there are NO contact fields
-- on any table in this migration. A party's email/phone lives only in
-- Supabase Auth and is never selected by an app query. What the other
-- party can read pre-release is the negotiation, its messages, and its
-- proposals — never contact details. Contact is revealed only through
-- the server action in modules/commercial/actions.ts, which requires a
-- `tropical_contact_releases` row with that side's flag set.
--
-- Notification delivery (Phase 3 pending rows): the two ALTERs at the
-- bottom add `sent_by` / `sent_note` to tropical_sourcing_notifications
-- so ops can record a manual send (timestamp + channel + who sent it).
-- Nothing here sends email or push — delivery stays a recorded
-- manual step (see docs/product/commercial-model.md §6).
--
-- Group-channel unlock (audit §4.1): the workspace group channel used
-- to unlock when escrow was funded, and escrow funding is stubbed to
-- always refuse — so the group channel could never unlock. The fix is
-- in this file and in modules/commercial/actions.ts: activation is now
-- a Cubora operations decision (negotiation accepted → ops activates
-- the linked project, status pending_payment → active), not a payment
-- event. `tropical_can_access_channel` below is restated with that
-- rule documented; its logic is unchanged (group access keys off
-- project status active/completed). `tropical_projects` gains a
-- `negotiation_id` link so the activation is traceable to the
-- operation that caused it.
--
-- Team Search legacy tables (ai-orchestration.md §4, Phase 4 decision):
-- NOT created here. The graph's project_creator / persuasion_agent
-- nodes are disabled instead; creating `projects` / `project_members` /
-- `connections` / `messages` would resurrect a second project model
-- nothing in the web reads.
--
-- Additive only, except the restated channel function (same logic, new
-- comment) and the two additive ALTERs. No pre-existing table is
-- otherwise altered.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Negotiations — one commercial operation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_negotiations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The sourcing request this negotiation answers, if any. NULL when the
  -- consumer opened the negotiation directly from an offer.
  sourcing_request_id uuid REFERENCES public.tropical_sourcing_requests(id) ON DELETE SET NULL,
  consumer_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider_id          uuid NOT NULL REFERENCES public.tropical_providers(id) ON DELETE CASCADE,
  -- The offer under discussion, if the negotiation started from one.
  offer_id             uuid REFERENCES public.tropical_offers(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'proposal', 'awaiting_acceptance', 'accepted',
                                        'contact_released', 'completed', 'cancelled', 'blocked')),
  -- Workspace opened by ops when the operation was activated, if any.
  activated_project_id uuid REFERENCES public.tropical_projects(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_negotiations IS
  'Cubora commercial operations (Phase 4). One negotiation = one buyer, one provider, optionally one offer or one sourcing request. Status is ops-only (trigger below); parties signal intent on proposals.';
COMMENT ON COLUMN public.tropical_negotiations.status IS
  'open | proposal | awaiting_acceptance | accepted | contact_released | completed | cancelled | blocked. Cubora state machine — replaces escrow-funded transitions; see docs/product/commercial-model.md §3.';

CREATE INDEX IF NOT EXISTS tropical_negotiations_consumer_idx
  ON public.tropical_negotiations (consumer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tropical_negotiations_provider_idx
  ON public.tropical_negotiations (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tropical_negotiations_status_idx
  ON public.tropical_negotiations (status, created_at ASC);

-- ---------------------------------------------------------------------------
-- Mediated messages — the negotiation channel (not a project channel)
-- ---------------------------------------------------------------------------
-- Negotiations happen before any project exists, so they cannot reuse
-- tropical_channels (project-scoped). Messages here are visible only to
-- the two parties and to ops. Contact details must never be pasted into
-- a message to bypass release — ops moderates, and release is the only
-- sanctioned path to contact (see the header note).
CREATE TABLE IF NOT EXISTS public.tropical_negotiation_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.tropical_negotiations(id) ON DELETE CASCADE,
  sender_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_negotiation_messages IS
  'Mediated negotiation messages (Phase 4). Parties + ops only (RLS). No contact details are stored here; contact release goes through tropical_contact_releases.';

CREATE INDEX IF NOT EXISTS tropical_negotiation_messages_negotiation_idx
  ON public.tropical_negotiation_messages (negotiation_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- Proposals / quotations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id     uuid NOT NULL REFERENCES public.tropical_negotiations(id) ON DELETE CASCADE,
  created_by         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_role        text NOT NULL CHECK (author_role IN ('consumer', 'provider', 'ops')),
  title              text NOT NULL,
  summary            text NOT NULL DEFAULT '',
  -- The proposal's own terms (scope, deliverables, price basis/amount as
  -- the author wrote them). Cubora's intermediation fee is NOT here —
  -- it lives on tropical_fees, per operation, as an ops record.
  terms              jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'superseded')),
  consumer_accepted  boolean NOT NULL DEFAULT false,
  provider_accepted  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_proposals IS
  'Commercial proposals / quotations (Phase 4). Status is ops-only (trigger below); parties set only their own acceptance flag, enforced in the action layer.';

CREATE INDEX IF NOT EXISTS tropical_proposals_negotiation_idx
  ON public.tropical_proposals (negotiation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Contact releases — the approval record
-- ---------------------------------------------------------------------------
-- One row per negotiation. The release CONDITIONS are still an OPEN
-- decision (spec O4); this table records what ops attested was met
-- (`conditions_summary`, ops' own words) and which side was released.
-- It does not define the policy, and a release for one side never
-- implies a release for the other.
CREATE TABLE IF NOT EXISTS public.tropical_contact_releases (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id             uuid NOT NULL REFERENCES public.tropical_negotiations(id) ON DELETE CASCADE,
  approved_by                uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conditions_summary         text NOT NULL,
  consumer_contact_released  boolean NOT NULL DEFAULT false,
  provider_contact_released  boolean NOT NULL DEFAULT false,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_contact_releases_negotiation_unique UNIQUE (negotiation_id)
);

COMMENT ON TABLE public.tropical_contact_releases IS
  'Contact-release approvals (Phase 4). One row per negotiation; ops-only writes. conditions_summary records what ops attested — it does not define the release policy (spec OPEN O4).';
COMMENT ON COLUMN public.tropical_contact_releases.conditions_summary IS
  'What ops says was met, in ops own words. The release conditions themselves are still undecided (spec O4).';

-- ---------------------------------------------------------------------------
-- Fee records — nullable type/amount/currency, per operation
-- ---------------------------------------------------------------------------
-- Spec OPEN O1–O3 (fee model, "securing a contact", fee timing) are
-- Roger's decisions. Until they are answered, a fee record stores
-- exactly what ops enters — possibly only a note, possibly nothing at
-- all. `fee_type` uses the plan's own three words and is NULLABLE;
-- there is no default amount, percentage, or currency in this file.
-- A fee record is a record, not a charge: no payment rail exists in
-- the MVP, and nothing here collects money.
CREATE TABLE IF NOT EXISTS public.tropical_fees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.tropical_negotiations(id) ON DELETE CASCADE,
  fee_type     text CHECK (fee_type IS NULL OR fee_type IN ('fixed', 'percentage', 'hybrid')),
  fee_amount   numeric(12, 2) CHECK (fee_amount IS NULL OR fee_amount >= 0),
  fee_currency text,
  -- What the amount/percentage applies to, as ops wrote it
  -- (e.g. "per operation"). Free text, never defaulted.
  fee_basis    text,
  status       text NOT NULL DEFAULT 'recorded'
               CHECK (status IN ('recorded', 'void')),
  recorded_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_fees IS
  'Intermediation fee records (Phase 4). Type, amount, currency, and basis are all nullable — spec OPEN O1–O3 undecided; record only what ops enters. A record is not a charge: no payment rail exists in the MVP.';
COMMENT ON COLUMN public.tropical_fees.fee_type IS
  'fixed | percentage | hybrid (the three words from the plan) or NULL. No default: the fee model is undecided (spec O1).';

CREATE INDEX IF NOT EXISTS tropical_fees_negotiation_idx
  ON public.tropical_fees (negotiation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Compliance reviews / blocked cases
-- ---------------------------------------------------------------------------
-- Ops-only table: no SELECT/INSERT/UPDATE policy for `authenticated`
-- at all, so only the service role (ops) reads or writes it. A blocked
-- negotiation is also visible as status='blocked' on the negotiation
-- itself; this table holds the reason, the review, and the decision.
CREATE TABLE IF NOT EXISTS public.tropical_compliance_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('negotiation', 'provider', 'sourcing_request')),
  entity_id   uuid NOT NULL,
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'reviewing', 'blocked', 'cleared', 'escalated')),
  reason      text NOT NULL,
  notes       text,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

COMMENT ON TABLE public.tropical_compliance_reviews IS
  'Compliance reviews / blocked cases (Phase 4). Ops-only (no RLS policies for authenticated). Spec OPEN O8: which cases require human review is still undecided; this table records the review, it does not define the scope.';

CREATE INDEX IF NOT EXISTS tropical_compliance_reviews_entity_idx
  ON public.tropical_compliance_reviews (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tropical_compliance_reviews_status_idx
  ON public.tropical_compliance_reviews (status, created_at ASC);

-- ---------------------------------------------------------------------------
-- Operation events — audit trail for important commercial events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_operation_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid REFERENCES public.tropical_negotiations(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  actor_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_operation_events IS
  'Audit trail for important commercial events (Phase 4, plan §5 / spec S29). Written by ops actions and party actions via the service role; readable by the negotiation parties.';

CREATE INDEX IF NOT EXISTS tropical_operation_events_negotiation_idx
  ON public.tropical_operation_events (negotiation_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- Sourcing-notification delivery attestation (Phase 3 pending rows)
-- ---------------------------------------------------------------------------
-- Delivery stays a recorded manual step in Phase 4: ops sends the
-- message themselves (email, or another channel the requester gave),
-- then marks the row sent with who sent it and how. `sent_at` already
-- exists (055); these two columns are the attestation. No email or push
-- provider is wired here.
ALTER TABLE public.tropical_sourcing_notifications
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.tropical_sourcing_notifications
  ADD COLUMN IF NOT EXISTS sent_note text;

COMMENT ON COLUMN public.tropical_sourcing_notifications.sent_by IS
  'Ops member who marked this notification sent after sending it manually (Phase 4). Delivery is a recorded manual step — no provider is wired.';
COMMENT ON COLUMN public.tropical_sourcing_notifications.sent_note IS
  'How the requester was reached (e.g. "email to the address on file"), recorded by ops when marking sent.';

-- ---------------------------------------------------------------------------
-- Project ↔ negotiation link (workspace activation traceability)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tropical_projects
  ADD COLUMN IF NOT EXISTS negotiation_id uuid REFERENCES public.tropical_negotiations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tropical_projects_negotiation_idx
  ON public.tropical_projects (negotiation_id)
  WHERE negotiation_id IS NOT NULL;

COMMENT ON COLUMN public.tropical_projects.negotiation_id IS
  'The Cubora negotiation that activated this workspace (Phase 4). Activation is an operations decision (negotiation accepted → ops activates), not a payment event.';

-- ============================================================================
-- RLS — follows the pattern of 002 / 051 / 052 / 055
-- ============================================================================
-- * Negotiations: the consumer and the provider read their own; the
--   consumer may open one (status 'open' only); nobody but ops (service
--   role) changes status — there is no UPDATE/DELETE policy for
--   `authenticated`, and the trigger below is the second layer.
-- * Messages: parties read and post as themselves, only inside their
--   own negotiation.
-- * Proposals: parties read; the author inserts; parties update only
--   their own acceptance flag in practice (the action layer enforces
--   which flag; the trigger below blocks status changes from
--   `authenticated` outright).
-- * Contact releases: parties read their own negotiation's record; no
--   write policy for `authenticated` — ops only, via the service role.
-- * Fees: only the consumer of the operation reads them (plan §9: fee
--   history is on the consumer dashboard, not the provider's); no write
--   policy for `authenticated`.
-- * Compliance reviews: no policies for `authenticated` at all —
--   ops-only.
-- * Operation events: parties read their negotiation's events; no
--   write policy for `authenticated`.
-- ============================================================================

ALTER TABLE public.tropical_negotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_negotiation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_contact_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_operation_events ENABLE ROW LEVEL SECURITY;

-- A negotiation's two parties, as a reusable predicate shape: the
-- consumer by user id, the provider by provider row.
DROP POLICY IF EXISTS "tropical_negotiations_read_parties" ON public.tropical_negotiations;
CREATE POLICY "tropical_negotiations_read_parties" ON public.tropical_negotiations
  FOR SELECT USING (
    consumer_id = (SELECT auth.uid())
    OR provider_id IN (
      SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "tropical_negotiations_insert_consumer" ON public.tropical_negotiations;
CREATE POLICY "tropical_negotiations_insert_consumer" ON public.tropical_negotiations
  FOR INSERT WITH CHECK (
    consumer_id = (SELECT auth.uid())
    AND status = 'open'
  );

DROP POLICY IF EXISTS "tropical_negotiation_messages_read_parties" ON public.tropical_negotiation_messages;
CREATE POLICY "tropical_negotiation_messages_read_parties" ON public.tropical_negotiation_messages
  FOR SELECT USING (
    negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS "tropical_negotiation_messages_insert_own" ON public.tropical_negotiation_messages;
CREATE POLICY "tropical_negotiation_messages_insert_own" ON public.tropical_negotiation_messages
  FOR INSERT WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS "tropical_proposals_read_parties" ON public.tropical_proposals;
CREATE POLICY "tropical_proposals_read_parties" ON public.tropical_proposals
  FOR SELECT USING (
    negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS "tropical_proposals_insert_author" ON public.tropical_proposals;
CREATE POLICY "tropical_proposals_insert_author" ON public.tropical_proposals
  FOR INSERT WITH CHECK (
    created_by = (SELECT auth.uid())
    AND author_role IN ('consumer', 'provider')
    AND negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS "tropical_proposals_update_parties" ON public.tropical_proposals;
CREATE POLICY "tropical_proposals_update_parties" ON public.tropical_proposals
  FOR UPDATE USING (
    negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  )
  WITH CHECK (
    negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS "tropical_contact_releases_read_parties" ON public.tropical_contact_releases;
CREATE POLICY "tropical_contact_releases_read_parties" ON public.tropical_contact_releases
  FOR SELECT USING (
    negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS "tropical_fees_read_consumer" ON public.tropical_fees;
CREATE POLICY "tropical_fees_read_consumer" ON public.tropical_fees
  FOR SELECT USING (
    negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "tropical_operation_events_read_parties" ON public.tropical_operation_events;
CREATE POLICY "tropical_operation_events_read_parties" ON public.tropical_operation_events
  FOR SELECT USING (
    negotiation_id IN (
      SELECT id FROM public.tropical_negotiations
      WHERE consumer_id = (SELECT auth.uid())
         OR provider_id IN (
           SELECT id FROM public.tropical_providers WHERE user_id = (SELECT auth.uid())
         )
    )
  );

-- ---------------------------------------------------------------------------
-- Guard triggers: negotiation status and proposal status are ops-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tropical_negotiations_guard_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated'
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'negotiation status is set by Cubora operations only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_negotiations_guard_status ON public.tropical_negotiations;
CREATE TRIGGER tropical_negotiations_guard_status
  BEFORE UPDATE ON public.tropical_negotiations
  FOR EACH ROW EXECUTE FUNCTION public.tropical_negotiations_guard_status();

CREATE OR REPLACE FUNCTION public.tropical_proposals_guard_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated'
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'proposal status is set by Cubora operations only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_proposals_guard_status ON public.tropical_proposals;
CREATE TRIGGER tropical_proposals_guard_status
  BEFORE UPDATE ON public.tropical_proposals
  FOR EACH ROW EXECUTE FUNCTION public.tropical_proposals_guard_status();

-- ---------------------------------------------------------------------------
-- Group-channel access — restated, same logic, corrected rule
-- ---------------------------------------------------------------------------
-- The rule is unchanged: bot — every member; group — every member once
-- the project is active/completed; dm — brand + role holder. What
-- changes in Phase 4 is what MAKES a project active. It used to be
-- escrow funding, which the reference build stubs to always refuse —
-- so the group channel could never unlock (audit §4.1). Activation is
-- now a Cubora operations decision: a negotiation is accepted, ops
-- activates the linked project (modules/commercial/actions.ts,
-- activateProjectAction), and the channel opens. No payment event is
-- involved; there is no payment rail in the MVP.
CREATE OR REPLACE FUNCTION public.tropical_can_access_channel(p_channel uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project    uuid;
  v_type       text;
  v_role       uuid;
  v_status     text;
  v_assignee   uuid;
BEGIN
  SELECT c.project_id, c.type, c.role_id, p.status
    INTO v_project, v_type, v_role, v_status
  FROM public.tropical_channels c
  JOIN public.tropical_projects p ON p.id = c.project_id
  WHERE c.id = p_channel;

  IF v_project IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.tropical_is_member(v_project, p_user) THEN
    RETURN false;
  END IF;

  -- Group channel opens when the project is active/completed. A project
  -- becomes active when Cubora operations activates it (negotiation
  -- accepted) — NOT when escrow is funded: there is no payment rail in
  -- the MVP, and escrow funding is stubbed to always refuse.
  IF v_type = 'group' AND v_status NOT IN ('active', 'completed') THEN
    RETURN false;
  END IF;

  IF v_type = 'dm' THEN
    IF public.tropical_is_brand(v_project, p_user) THEN
      RETURN true;
    END IF;
    SELECT r.assigned_user_id INTO v_assignee
      FROM public.tropical_project_roles r WHERE r.id = v_role;
    RETURN v_assignee IS NOT DISTINCT FROM p_user;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_can_access_channel(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_can_access_channel(uuid, uuid) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'public'
--     AND table_name IN ('tropical_negotiations',
--       'tropical_negotiation_messages', 'tropical_proposals',
--       'tropical_contact_releases', 'tropical_fees',
--       'tropical_compliance_reviews', 'tropical_operation_events');
--   -- Expect 7 rows. Then:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tropical_sourcing_notifications'
--     AND column_name IN ('sent_by', 'sent_note');
--   -- Expect 2 rows. Then:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tropical_projects' AND column_name = 'negotiation_id';
--   -- Expect 1 row. Then, as the provider role:
--   --   UPDATE tropical_negotiations SET status = 'accepted' must fail
--   --   with 'negotiation status is set by Cubora operations only'.
--   -- A fee row with all of fee_type/fee_amount/fee_currency NULL must
--   -- insert fine; a fee with fee_type = '15%' must fail the CHECK.
--   -- No live DB run yet — migrations are unapplied, as every migration
--   -- in this repo has been so far.
