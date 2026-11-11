-- ============================================================================
-- TROPICAL CORE SCHEMA
-- ============================================================================
-- Creates the tropical_* table family. Additive only:
--   * No ALTER / DROP against any pre-existing table.
--   * Existing profile tables (users, creative_data, brand_data) are READ-ONLY
--     to this feature set and remain the single source of truth for identity.
--   * Foreign keys reference public.users(id) for referential integrity. This
--     does not modify the users table definition.
--
-- Money is stored in MINOR UNITS (pence), matching escrow_holds.escrow_amount
-- and lib/money.ts, which operates in GBP.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DISCIPLINE TAXONOMY
-- ============================================================================
-- Canonical role vocabulary, derived from the live creative_data.tags corpus
-- rather than the film-crew ROLE_BANK in the tropical prototype.

CREATE TABLE IF NOT EXISTS public.tropical_disciplines (
  slug        text PRIMARY KEY,
  label       text NOT NULL,
  category    text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_disciplines IS
  'Canonical discipline vocabulary for role matching. Seeded in 002.';

-- Which disciplines a creative practises. Replaces free-text tag matching.
CREATE TABLE IF NOT EXISTS public.tropical_creative_disciplines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  discipline_slug  text NOT NULL REFERENCES public.tropical_disciplines(slug) ON DELETE CASCADE,
  -- inferred = derived from creative_data.tags by the 003 backfill, unconfirmed
  -- confirmed = the creative accepted/edited it in the profile prompt
  -- self      = added directly by the creative
  source           text NOT NULL DEFAULT 'self'
                   CHECK (source IN ('inferred', 'confirmed', 'self')),
  is_primary       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_creative_disciplines_unique UNIQUE (user_id, discipline_slug)
);

CREATE INDEX IF NOT EXISTS idx_tropical_creative_disciplines_slug
  ON public.tropical_creative_disciplines (discipline_slug);
CREATE INDEX IF NOT EXISTS idx_tropical_creative_disciplines_user
  ON public.tropical_creative_disciplines (user_id);
-- Partial index: the team builder only ever queries confirmed/self rows first.
CREATE INDEX IF NOT EXISTS idx_tropical_creative_disciplines_trusted
  ON public.tropical_creative_disciplines (discipline_slug)
  WHERE source IN ('confirmed', 'self');

-- ============================================================================
-- 2. PROJECTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tropical_projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  brief             text NOT NULL DEFAULT '',
  budget            bigint NOT NULL CHECK (budget > 0),
  currency          text NOT NULL DEFAULT 'GBP',
  visibility        text NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public', 'private', 'both')),
  platform_fee_pct  numeric(5,2) NOT NULL DEFAULT 15.00
                    CHECK (platform_fee_pct >= 0 AND platform_fee_pct < 100),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_payment', 'active', 'completed', 'cancelled')),
  deadline_date     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tropical_projects IS
  'A brand brief with a budget split across roles. Supersedes the unused public.projects table.';
COMMENT ON COLUMN public.tropical_projects.budget IS 'Total pot in minor units (pence). Includes the platform fee.';

CREATE INDEX IF NOT EXISTS idx_tropical_projects_brand ON public.tropical_projects (brand_id, created_at DESC);
-- Drives the public briefs feed.
CREATE INDEX IF NOT EXISTS idx_tropical_projects_feed
  ON public.tropical_projects (created_at DESC)
  WHERE visibility IN ('public', 'both') AND status IN ('pending_payment', 'active');

-- ---------------------------------------------------------------------------
-- Roles: one slice of the budget, optionally assigned to a creative.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_project_roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  title            text NOT NULL,
  discipline_slug  text REFERENCES public.tropical_disciplines(slug) ON DELETE SET NULL,
  percentage       numeric(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  amount           bigint NOT NULL CHECK (amount >= 0),
  assigned_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'invited', 'accepted', 'declined',
                                     'delivered', 'approved', 'released', 'cancelled')),
  deliverables     text,
  deadline_date    timestamptz,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.tropical_project_roles.amount IS
  'Snapshot of percentage x project budget in pence, fixed at contract time so later budget edits cannot silently reprice accepted roles.';

CREATE INDEX IF NOT EXISTS idx_tropical_project_roles_project
  ON public.tropical_project_roles (project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tropical_project_roles_assigned
  ON public.tropical_project_roles (assigned_user_id) WHERE assigned_user_id IS NOT NULL;
-- Open-role lookup for the briefs feed and matching.
CREATE INDEX IF NOT EXISTS idx_tropical_project_roles_open
  ON public.tropical_project_roles (discipline_slug) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Membership: denormalised so RLS can authorise without walking roles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_project_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role  text NOT NULL DEFAULT 'creative' CHECK (member_role IN ('brand', 'creative')),
  role_id      uuid REFERENCES public.tropical_project_roles(id) ON DELETE SET NULL,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_project_members_unique UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tropical_project_members_user
  ON public.tropical_project_members (user_id);

-- ============================================================================
-- 3. MEMBERSHIP HELPERS  (SECURITY DEFINER — prevents RLS recursion)
-- ============================================================================
-- Policies on projects/roles/channels all need "is this user a member?".
-- Expressing that as a subquery inside a policy makes tropical_project_members
-- evaluate its own policy recursively. These bypass RLS deliberately and read
-- nothing the caller could not already establish about themselves.

CREATE OR REPLACE FUNCTION public.tropical_is_member(p_project uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tropical_project_members m
    WHERE m.project_id = p_project AND m.user_id = p_user
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
    WHERE p.id = p_project AND p.brand_id = p_user
  );
$$;

REVOKE ALL ON FUNCTION public.tropical_is_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.tropical_is_brand(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_is_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tropical_is_brand(uuid, uuid) TO authenticated;

-- ============================================================================
-- 4. CHANNELS & MESSAGES
-- ============================================================================
-- One unified channel model: bot (pinned, per project), group (escrow-gated),
-- and one dm per assigned role. Existing connections/messages stay untouched
-- and continue to serve pre-project 1:1 chat.

CREATE TABLE IF NOT EXISTS public.tropical_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('bot', 'group', 'dm')),
  name        text NOT NULL,
  role_id     uuid REFERENCES public.tropical_project_roles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Exactly one bot and one group channel per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_channels_singleton
  ON public.tropical_channels (project_id, type) WHERE type IN ('bot', 'group');
CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_channels_dm_role
  ON public.tropical_channels (role_id) WHERE type = 'dm';
CREATE INDEX IF NOT EXISTS idx_tropical_channels_project
  ON public.tropical_channels (project_id);

CREATE TABLE IF NOT EXISTS public.tropical_channel_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid NOT NULL REFERENCES public.tropical_channels(id) ON DELETE CASCADE,
  -- Denormalised so RLS and the realtime filter never join back to channels.
  project_id  uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,  -- NULL = TropicalTalent Bot
  kind        text NOT NULL DEFAULT 'text'
              CHECK (kind IN ('text', 'image', 'document', 'system',
                              'contract', 'escrow', 'application')),
  content     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Primary read path: newest messages in a channel.
CREATE INDEX IF NOT EXISTS idx_tropical_channel_messages_channel
  ON public.tropical_channel_messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_channel_messages_project
  ON public.tropical_channel_messages (project_id, created_at DESC);

-- ============================================================================
-- 5. APPLICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tropical_applications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES public.tropical_project_roles(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_applications_unique UNIQUE (role_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tropical_applications_role
  ON public.tropical_applications (role_id, status);
CREATE INDEX IF NOT EXISTS idx_tropical_applications_user
  ON public.tropical_applications (user_id, created_at DESC);

-- ============================================================================
-- 6. CONTRACTS  (versioned — supports renegotiation)
-- ============================================================================
-- A contract is an immutable snapshot of the role split at the moment it was
-- agreed. Renegotiation writes a NEW version rather than mutating the old one,
-- so the audit trail survives and members can diff what changed.

CREATE TABLE IF NOT EXISTS public.tropical_contracts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  version           integer NOT NULL DEFAULT 1,
  terms             jsonb NOT NULL,
  total_budget      bigint NOT NULL,
  platform_fee_pct  numeric(5,2) NOT NULL,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('draft', 'active', 'superseded', 'completed', 'cancelled')),
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_contracts_version_unique UNIQUE (project_id, version)
);

COMMENT ON COLUMN public.tropical_contracts.terms IS
  'Frozen snapshot, always a JSON object so it stays extensible: {"roles": [{role_id, title, discipline, percentage, amount, assigned_user_id, deliverables, deadline}], "meta": {...}}. Enforced by tropical_contracts_terms_is_object in 005.';

-- At most one active contract per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_contracts_one_active
  ON public.tropical_contracts (project_id) WHERE status = 'active';

-- Each member signs off on a contract version. Renegotiation resets signatures.
CREATE TABLE IF NOT EXISTS public.tropical_contract_signatures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid NOT NULL REFERENCES public.tropical_contracts(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id      uuid REFERENCES public.tropical_project_roles(id) ON DELETE SET NULL,
  decision     text NOT NULL DEFAULT 'pending'
               CHECK (decision IN ('pending', 'accepted', 'rejected')),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_contract_signatures_unique UNIQUE (contract_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tropical_contract_signatures_contract
  ON public.tropical_contract_signatures (contract_id);

-- ============================================================================
-- 7. ESCROW
-- ============================================================================
-- One PaymentIntent funds the whole pot (tropical_project_escrows); the pot is
-- carved into one hold per role so releases, refunds and disputes stay
-- role-isolated. Mirrors the shape of the existing escrow_holds table, which
-- is keyed to 1:1 collaborations and is left untouched.

CREATE TABLE IF NOT EXISTS public.tropical_project_escrows (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL UNIQUE REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  payment_intent_id  text UNIQUE,
  total_amount       bigint NOT NULL CHECK (total_amount > 0),
  platform_fee       bigint NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  currency           text NOT NULL DEFAULT 'GBP',
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'funded', 'partially_released',
                                       'released', 'refunded', 'cancelled')),
  funded_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tropical_escrow_holds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id     uuid NOT NULL REFERENCES public.tropical_project_escrows(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES public.tropical_project_roles(id) ON DELETE CASCADE,
  -- NULL while the role is unfilled. The slice stays held either way, so the
  -- brand can refill, redistribute, or refund just this slice.
  creative_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  amount        bigint NOT NULL CHECK (amount >= 0),
  creative_fee  bigint NOT NULL DEFAULT 0 CHECK (creative_fee >= 0),
  status        text NOT NULL DEFAULT 'held'
                CHECK (status IN ('held', 'released', 'refunded', 'cancelled')),
  transfer_id     text,
  released_at     timestamptz,
  refunded_at     timestamptz,
  release_reason  text,
  refund_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A role can only have one live hold at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_escrow_holds_role_active
  ON public.tropical_escrow_holds (role_id) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_tropical_escrow_holds_project
  ON public.tropical_escrow_holds (project_id);
CREATE INDEX IF NOT EXISTS idx_tropical_escrow_holds_creative
  ON public.tropical_escrow_holds (creative_id) WHERE creative_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Delivery / approval / dispute trail, per role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tropical_role_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES public.tropical_project_roles(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type  text NOT NULL
              CHECK (event_type IN ('delivered', 'approved', 'revision_requested',
                                    'disputed', 'dispute_resolved', 'cancelled')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tropical_role_events_role
  ON public.tropical_role_events (role_id, created_at DESC);

-- ============================================================================
-- 8. WALLET
-- ============================================================================
-- Creatives can accept roles without a connected payout accounts account. On release the
-- money credits an internal balance; withdrawal requires Connect onboarding.

CREATE TABLE IF NOT EXISTS public.tropical_user_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  available       bigint NOT NULL DEFAULT 0,
  pending         bigint NOT NULL DEFAULT 0,
  lifetime_earned bigint NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'GBP',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tropical_balance_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.tropical_projects(id) ON DELETE SET NULL,
  role_id     uuid REFERENCES public.tropical_project_roles(id) ON DELETE SET NULL,
  hold_id     uuid REFERENCES public.tropical_escrow_holds(id) ON DELETE SET NULL,
  amount      bigint NOT NULL,  -- signed: credit positive, withdrawal negative
  type        text NOT NULL
              CHECK (type IN ('escrow_release', 'withdrawal', 'fee', 'refund', 'adjustment')),
  status      text NOT NULL DEFAULT 'completed'
              CHECK (status IN ('pending', 'completed', 'failed')),
  payout_ref  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tropical_balance_transactions_user
  ON public.tropical_balance_transactions (user_id, created_at DESC);
-- Guards against a duplicated webhook crediting the same hold twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_balance_transactions_hold_once
  ON public.tropical_balance_transactions (hold_id)
  WHERE hold_id IS NOT NULL AND type = 'escrow_release';

COMMIT;
