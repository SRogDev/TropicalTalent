-- ============================================================================
-- TROPICAL FOREIGN KEY INDEXES + JSONB SHAPE CONSTRAINTS
-- ============================================================================
-- PostgreSQL does not create an index for a foreign key's referencing column.
-- Without one, every ON DELETE CASCADE / SET NULL on the parent does a
-- sequential scan of the child and takes a heavier lock. 001 indexed the
-- columns the app filters on; this covers the FKs it missed.
--
-- Several FKs in 001 are backed only by PARTIAL unique indexes (for example
-- tropical_escrow_holds.role_id WHERE status = 'held'). A partial index cannot
-- serve the planner's FK-enforcement lookup, so those get full indexes here.
-- ============================================================================

BEGIN;

-- tropical_project_roles.discipline_slug -> tropical_disciplines (SET NULL)
-- 001 indexed this only WHERE status = 'open'.
CREATE INDEX IF NOT EXISTS idx_tropical_project_roles_discipline_fk
  ON public.tropical_project_roles (discipline_slug);

-- tropical_project_members.role_id -> tropical_project_roles (SET NULL)
CREATE INDEX IF NOT EXISTS idx_tropical_project_members_role_fk
  ON public.tropical_project_members (role_id);

-- tropical_channels.role_id -> tropical_project_roles (CASCADE)
-- 001 indexed this only WHERE type = 'dm'.
CREATE INDEX IF NOT EXISTS idx_tropical_channels_role_fk
  ON public.tropical_channels (role_id);

-- tropical_channel_messages.sender_id -> users (SET NULL)
-- Deleting a user must not seq-scan the largest table in the schema.
CREATE INDEX IF NOT EXISTS idx_tropical_channel_messages_sender_fk
  ON public.tropical_channel_messages (sender_id);

-- tropical_applications.project_id -> tropical_projects (CASCADE)
CREATE INDEX IF NOT EXISTS idx_tropical_applications_project_fk
  ON public.tropical_applications (project_id);

-- tropical_contracts.created_by -> users (SET NULL)
CREATE INDEX IF NOT EXISTS idx_tropical_contracts_created_by_fk
  ON public.tropical_contracts (created_by);

-- tropical_contract_signatures: UNIQUE (contract_id, user_id) covers contract_id
-- as the leftmost prefix, but leaves user_id and role_id unindexed.
CREATE INDEX IF NOT EXISTS idx_tropical_contract_signatures_user_fk
  ON public.tropical_contract_signatures (user_id);
CREATE INDEX IF NOT EXISTS idx_tropical_contract_signatures_role_fk
  ON public.tropical_contract_signatures (role_id);

-- tropical_escrow_holds.escrow_id -> tropical_project_escrows (CASCADE)
CREATE INDEX IF NOT EXISTS idx_tropical_escrow_holds_escrow_fk
  ON public.tropical_escrow_holds (escrow_id);
-- role_id had only the partial "one live hold" unique index.
CREATE INDEX IF NOT EXISTS idx_tropical_escrow_holds_role_fk
  ON public.tropical_escrow_holds (role_id);

-- tropical_role_events: idx on (role_id, created_at) covers role_id.
CREATE INDEX IF NOT EXISTS idx_tropical_role_events_project_fk
  ON public.tropical_role_events (project_id);
CREATE INDEX IF NOT EXISTS idx_tropical_role_events_actor_fk
  ON public.tropical_role_events (actor_id);

-- tropical_balance_transactions: idx on (user_id, created_at) covers user_id.
CREATE INDEX IF NOT EXISTS idx_tropical_balance_transactions_project_fk
  ON public.tropical_balance_transactions (project_id);
CREATE INDEX IF NOT EXISTS idx_tropical_balance_transactions_role_fk
  ON public.tropical_balance_transactions (role_id);
-- hold_id had only the partial "credit a hold once" unique index.
CREATE INDEX IF NOT EXISTS idx_tropical_balance_transactions_hold_fk
  ON public.tropical_balance_transactions (hold_id);

-- ---------------------------------------------------------------------------
-- JSONB shape constraints
-- ---------------------------------------------------------------------------
-- Both columns are always written as objects. Without these, a stray array or
-- bare scalar would be accepted and only fail later at render time.
-- No GIN indexes: neither column is ever queried by containment or key
-- existence — messages are read by channel, contracts by project.

-- ADD CONSTRAINT has no IF NOT EXISTS, so these are guarded to keep the file
-- re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tropical_channel_messages_content_is_object'
  ) THEN
    ALTER TABLE public.tropical_channel_messages
      ADD CONSTRAINT tropical_channel_messages_content_is_object
      CHECK (jsonb_typeof(content) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tropical_contracts_terms_is_object'
  ) THEN
    ALTER TABLE public.tropical_contracts
      ADD CONSTRAINT tropical_contracts_terms_is_object
      CHECK (jsonb_typeof(terms) = 'object');
  END IF;
END
$$;

COMMIT;
