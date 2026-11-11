-- ============================================================================
-- TROPICAL v2 — NEW TABLES AND COLUMNS
-- ============================================================================
-- Everything the cleanup adds:
--
--   * skill-gated applications      (apply first, add the skill after)
--   * project deliverables          (what the brand is actually buying)
--   * per-role draft contracts      (negotiated in each role's DM)
--   * disputes                      (the post-escrow route for disagreements)
--   * favourites                    (the Talent page's saved list)
--   * notifications                 (the updates badge in Project Admin)
--
-- Additive against everything outside the tropical_* family. The two ALTERs are
-- against tropical_applications, which this feature owns.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. SKILL-GATED APPLICATIONS
-- ============================================================================
-- Previously a creative could only apply to a role whose discipline was
-- already on their profile, and nothing explained the absent button. Now they
-- may apply to anything: an application for a skill they do not list is parked
-- as 'pending_skill' and released the moment they add it (see the trigger in
-- 011). The brand never sees a parked application, so their inbox is unchanged.

ALTER TABLE public.tropical_applications
  ADD COLUMN IF NOT EXISTS required_discipline text
    REFERENCES public.tropical_disciplines(slug) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unlocked_at timestamptz;

-- The status CHECK is replaced rather than added to; Postgres has no
-- ALTER CONSTRAINT for CHECK expressions.
--
-- Dropped by lookup rather than by assumed name. The constraint was declared
-- inline on the column in 001, so Postgres named it — and a name guessed wrong
-- would leave the old constraint in place and make every pending_skill insert
-- fail at runtime with a confusing error.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tropical_applications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.tropical_applications DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.tropical_applications
  ADD CONSTRAINT tropical_applications_status_check
  CHECK (status IN ('pending', 'pending_skill', 'accepted', 'rejected', 'withdrawn'));

-- A parked application is only ever looked up by (user, discipline) when that
-- pair lands on a profile. Partial, so it stays tiny.
CREATE INDEX IF NOT EXISTS idx_tropical_applications_pending_skill
  ON public.tropical_applications (user_id, required_discipline)
  WHERE status = 'pending_skill';

COMMENT ON COLUMN public.tropical_applications.required_discipline IS
  'Set only while status = pending_skill: the discipline the creative must add before the brand sees this application.';

-- The bot posts a 'deliverable' message into the group channel when the brand
-- edits deliverables after escrow, so the kind vocabulary has to admit it.
-- Same lookup-then-drop as above.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tropical_channel_messages'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.tropical_channel_messages DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.tropical_channel_messages
  ADD CONSTRAINT tropical_channel_messages_kind_check
  CHECK (kind IN ('text', 'image', 'document', 'system',
                  'contract', 'escrow', 'deliverable', 'application'));

-- ============================================================================
-- 2. DELIVERABLES
-- ============================================================================
-- Project-level, not per role: the brand describes the whole outcome once, and
-- individual role contracts reference it. Editable before escrow; still
-- editable after, but every post-escrow edit posts a notice into the group
-- channel so the crew finds out at edit time rather than at delivery.

CREATE TABLE IF NOT EXISTS public.tropical_deliverables (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description text,
  due_date    timestamptz,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tropical_deliverables_project
  ON public.tropical_deliverables (project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tropical_deliverables_created_by
  ON public.tropical_deliverables (created_by);

-- ============================================================================
-- 3. PER-ROLE DRAFT CONTRACTS
-- ============================================================================
-- Distinct from tropical_contracts, which is the frozen project-wide snapshot
-- written at creation time and superseded (never edited) on renegotiation.
-- This table is the working document the brand and one creative pass back and
-- forth in their DM before escrow.
--
-- The money is NOT duplicated here. amount lives on tropical_project_roles and
-- is joined in for whoever is entitled to see it — storing a second copy would
-- create a figure that can disagree with the one escrow pays out.

CREATE TABLE IF NOT EXISTS public.tropical_role_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  role_id          uuid NOT NULL UNIQUE
                     REFERENCES public.tropical_project_roles(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'agreed', 'locked')),
  -- {scope, deliverables[], revisions, deadline, paymentTerms, notes}
  terms            jsonb NOT NULL DEFAULT '{}'::jsonb,
  brand_accepted   boolean NOT NULL DEFAULT false,
  creative_accepted boolean NOT NULL DEFAULT false,
  updated_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_role_contracts_terms_is_object
    CHECK (jsonb_typeof(terms) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_tropical_role_contracts_project
  ON public.tropical_role_contracts (project_id);
CREATE INDEX IF NOT EXISTS idx_tropical_role_contracts_updated_by
  ON public.tropical_role_contracts (updated_by);

COMMENT ON TABLE public.tropical_role_contracts IS
  'Working draft contract for one role. Both parties may edit until escrow is paid; locked thereafter — changes go through tropical_disputes.';

-- ============================================================================
-- 4. DISPUTES
-- ============================================================================
-- Once escrow is paid the contract stops being editable, so a disagreement has
-- to reach a human. This is that form.

CREATE TABLE IF NOT EXISTS public.tropical_disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  role_id     uuid REFERENCES public.tropical_project_roles(id) ON DELETE SET NULL,
  raised_by   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category    text NOT NULL
              CHECK (category IN ('scope', 'payment', 'quality', 'deadline', 'conduct', 'other')),
  detail      text NOT NULL CHECK (length(detail) BETWEEN 20 AND 4000),
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'reviewing', 'resolved', 'rejected')),
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tropical_disputes_project
  ON public.tropical_disputes (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_disputes_raised_by
  ON public.tropical_disputes (raised_by);
CREATE INDEX IF NOT EXISTS idx_tropical_disputes_role
  ON public.tropical_disputes (role_id);
-- The TropicalTalent team's queue.
CREATE INDEX IF NOT EXISTS idx_tropical_disputes_open
  ON public.tropical_disputes (created_at DESC) WHERE status IN ('open', 'reviewing');

-- ============================================================================
-- 5. FAVOURITES
-- ============================================================================
-- The Talent page's saved list. One row per (brand, creative).

CREATE TABLE IF NOT EXISTS public.tropical_favourites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creative_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_favourites_unique UNIQUE (user_id, creative_id),
  -- Favouriting yourself is meaningless and would pollute the filtered feed.
  CONSTRAINT tropical_favourites_not_self CHECK (user_id <> creative_id)
);

CREATE INDEX IF NOT EXISTS idx_tropical_favourites_user
  ON public.tropical_favourites (user_id);
CREATE INDEX IF NOT EXISTS idx_tropical_favourites_creative
  ON public.tropical_favourites (creative_id);

-- ============================================================================
-- 6. NOTIFICATIONS
-- ============================================================================
-- In-app only. Written by the same transaction as the event that caused them,
-- so a notification cannot exist for something that did not happen.
--
-- Deliberately separate from the pre-existing public.notifications table,
-- which belongs to the old collaborations flow and has a different shape.

CREATE TABLE IF NOT EXISTS public.tropical_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  kind        text NOT NULL
              CHECK (kind IN ('application_received', 'application_unlocked',
                              'application_decided', 'deliverables_updated',
                              'contract_updated', 'role_invited', 'escrow_funded')),
  title       text NOT NULL,
  body        text,
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The badge query: unread, for one user, optionally scoped to a project.
CREATE INDEX IF NOT EXISTS idx_tropical_notifications_unread
  ON public.tropical_notifications (user_id, project_id, created_at DESC)
  WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_tropical_notifications_user
  ON public.tropical_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_notifications_actor
  ON public.tropical_notifications (actor_id);

-- ============================================================================
-- 7. SEARCH SUPPORT
-- ============================================================================
-- The skill and role pickers search with a leading wildcard (`%term%`), which
-- a btree index cannot serve. pg_trgm can.
--
-- The vocabulary is small enough today that the in-memory filter in
-- modules/skills/queries.ts never reaches Postgres; this is here so the
-- server-side path stays flat when it grows.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tropical_disciplines_label_trgm
  ON public.tropical_disciplines USING gin (label gin_trgm_ops);

-- Same for the Talent page's name/handle search.
CREATE INDEX IF NOT EXISTS idx_users_name_trgm
  ON public.users USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm
  ON public.users USING gin (username gin_trgm_ops);

-- The Talent feed pages on created_at within role = 'creative'.
CREATE INDEX IF NOT EXISTS idx_users_creative_feed
  ON public.users (created_at DESC) WHERE role = 'creative';

COMMIT;
