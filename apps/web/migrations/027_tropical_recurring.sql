-- ============================================================================
-- 027 — Recurring engagements (retainers)
-- ============================================================================
-- A role can now be paid on a schedule instead of once. Applies to the classic
-- app and to every white-label; the shape is the same either way.
--
-- ---------------------------------------------------------------------------
-- THE INVARIANT: a live engagement never flickers
-- ---------------------------------------------------------------------------
-- Nothing in this file writes tropical_projects.status. That is not a style
-- preference, it is the whole design constraint, and the code makes the reason
-- concrete:
--
--   * tropical_can_access_channel (011:213) closes the GROUP CHANNEL whenever a
--     project's status is not 'active' or 'completed'. A project that dipped
--     out of active between periods would shut its own chat every month.
--
--   * tropical_on_project_activated (011:772) fires bot messages and
--     notifications on every transition INTO active. A project bouncing
--     active -> pending_payment -> active would re-run project onboarding
--     twelve times a year.
--
--   * tropical_release_role (017) sets status = 'completed' once no held escrow
--     remains. On a retainer that is not completion, it is Tuesday.
--
-- So period state lives entirely in tropical_role_periods.status. A funding
-- problem is a banner and an email, never a lockout. Only ends_at, explicit
-- cancellation, or the brand finishing the project moves tropical_projects.
--
-- ---------------------------------------------------------------------------
-- Why periods do not use tropical_escrow_holds
-- ---------------------------------------------------------------------------
-- The escrow tables model one pot split across N roles: fund once, hold a
-- slice per role, release each slice, and when the last slice is gone the pot
-- — and the project — is finished. A retainer is not a pot, it is a stream,
-- and forcing it through that table would drag in exactly the completion logic
-- the invariant above forbids.
--
-- Each period therefore carries its own money and releases straight to the
-- creative's balance. The escrow GUARANTEE survives regardless, because the
-- cron charges the brand before the period starts: a creative never works a
-- period that was not paid for first.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ROLES BECOME SCHEDULABLE
-- ============================================================================

ALTER TABLE public.tropical_project_roles
  ADD COLUMN IF NOT EXISTS pay_model text NOT NULL DEFAULT 'fixed'
    CHECK (pay_model IN ('fixed', 'recurring')),
  ADD COLUMN IF NOT EXISTS period text
    CHECK (period IN ('weekly', 'monthly')),
  -- Gross per period, minor units. The fee comes out of this, same as budget.
  ADD COLUMN IF NOT EXISTS period_amount bigint
    CHECK (period_amount IS NULL OR period_amount > 0),
  ADD COLUMN IF NOT EXISTS approval text NOT NULL DEFAULT 'auto'
    CHECK (approval IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS next_period_start date,
  ADD COLUMN IF NOT EXISTS ends_at date,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;

-- A recurring role without a cadence or an amount is not schedulable, and the
-- cron would skip it silently. Better to make it unrepresentable.
ALTER TABLE public.tropical_project_roles
  DROP CONSTRAINT IF EXISTS tropical_roles_recurring_complete;
ALTER TABLE public.tropical_project_roles
  ADD CONSTRAINT tropical_roles_recurring_complete CHECK (
    pay_model <> 'recurring'
    OR (period IS NOT NULL AND period_amount IS NOT NULL AND next_period_start IS NOT NULL)
  );

-- A recurring role takes no slice of the project pot — it brings its own
-- money — so its percentage is 0. The original CHECK requires percentage > 0,
-- which is right for a fixed role (a share of nothing is not a role) and
-- impossible for a retainer.
--
-- Relaxed conditionally rather than globally: a FIXED role with a zero share
-- is still a mistake, and keeping that unrepresentable is worth the longer
-- constraint.
ALTER TABLE public.tropical_project_roles
  DROP CONSTRAINT IF EXISTS tropical_project_roles_percentage_check;
ALTER TABLE public.tropical_project_roles
  ADD CONSTRAINT tropical_project_roles_percentage_check CHECK (
    percentage <= 100
    AND (
      (pay_model = 'recurring' AND percentage >= 0)
      OR (pay_model <> 'recurring' AND percentage > 0)
    )
  );

COMMENT ON COLUMN public.tropical_project_roles.approval IS
  'auto: the period releases on a schedule once its end passes. manual: the brand approves each one, reusing the fixed-price delivered -> released flow. Default auto — nobody clicks approve 600 times a month.';

-- ============================================================================
-- 2. SAVED PAYMENT METHOD
-- ============================================================================
-- The brand completes Checkout once with setup_future_usage, and the webhook
-- records what came back. Keyed per (tenant, brand): the same person hiring on
-- two white-labels is two billing relationships, and a future per-tenant
-- payment provider account would make them two different customers entirely.

CREATE TABLE IF NOT EXISTS public.tropical_billing_profiles (
  tenant_id              uuid NOT NULL REFERENCES public.tropical_tenants(id) ON DELETE CASCADE,
  brand_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payout_customer_id     text NOT NULL,
  default_payment_method text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, brand_id)
);

-- ============================================================================
-- 3. PERIODS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tropical_role_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id      uuid NOT NULL REFERENCES public.tropical_project_roles(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.tropical_projects(id) ON DELETE CASCADE,
  creative_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,

  period_start date NOT NULL,
  period_end   date NOT NULL,

  -- Frozen at scheduling time, never recomputed. A fee change must not
  -- reprice a period that has already been charged — 007:150 freezes the fee
  -- into the contract for the same reason.
  gross        bigint NOT NULL CHECK (gross > 0),
  platform_fee bigint NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  partner_fee  bigint NOT NULL DEFAULT 0 CHECK (partner_fee >= 0),
  net          bigint NOT NULL CHECK (net >= 0),

  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','funding','funded','funding_failed',
                      'delivered','released','skipped','disputed')),

  payment_intent_id text,
  failure_reason    text,
  attempts          integer NOT NULL DEFAULT 0,

  released_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CHECK (period_end > period_start),
  CHECK (platform_fee + net <= gross),

  -- THE idempotency key. The cron is not transactional across payment provider, so a
  -- retry, an overlapping run, or a replayed webhook must not be able to
  -- charge a brand twice for the same month. This constraint is what makes
  -- that impossible rather than merely unlikely.
  CONSTRAINT tropical_role_periods_unique_period UNIQUE (role_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_tropical_role_periods_due
  ON public.tropical_role_periods (status, period_start);
CREATE INDEX IF NOT EXISTS idx_tropical_role_periods_role
  ON public.tropical_role_periods (role_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_role_periods_project
  ON public.tropical_role_periods (project_id);

-- A period's release is a balance credit like any other, but it is not an
-- escrow release and must not be counted as one.
ALTER TABLE public.tropical_balance_transactions
  ADD COLUMN IF NOT EXISTS period_id uuid REFERENCES public.tropical_role_periods(id) ON DELETE SET NULL;

ALTER TABLE public.tropical_balance_transactions
  DROP CONSTRAINT IF EXISTS tropical_balance_transactions_type_check;
ALTER TABLE public.tropical_balance_transactions
  ADD CONSTRAINT tropical_balance_transactions_type_check
    CHECK (type IN ('escrow_release','period_release','withdrawal','fee','refund','adjustment'));

-- Same guarantee the escrow path gets from its own partial index: a repeated
-- release cannot credit the same period twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_balance_tx_period_once
  ON public.tropical_balance_transactions (period_id)
  WHERE type = 'period_release';

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public.tropical_role_periods      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_billing_profiles  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tropical_role_periods','tropical_billing_profiles')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Both parties see the schedule. The creative especially: the entire value of
-- a retainer to them is knowing what lands and when, and hiding it behind the
-- brand's view would make this a worse product than a fixed-price job.
CREATE POLICY "tropical_role_periods_read_parties" ON public.tropical_role_periods
  FOR SELECT USING (
    creative_id = (SELECT auth.uid())
    OR public.tropical_is_brand(project_id, (SELECT auth.uid()))
    OR public.tropical_is_member(project_id, (SELECT auth.uid()))
  );

-- Writes are service-role only: the cron schedules, funds and releases, and
-- the RPCs below are SECURITY DEFINER. Nobody edits their own pay run.

-- Billing profiles hold a payment provider customer id. Read by the brand who owns it,
-- written only by the webhook.
CREATE POLICY "tropical_billing_profiles_read_own" ON public.tropical_billing_profiles
  FOR SELECT USING (brand_id = (SELECT auth.uid()));

COMMIT;
