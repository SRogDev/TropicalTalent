-- ============================================================================
-- 023 — Tenancy: white-label tenants, domains, memberships
-- ============================================================================
-- The app becomes multi-tenant: one deployment, one Supabase project, N
-- branded sites resolved from the request's Host header. The classic TropicalTalent app
-- becomes tenant #1 and behaves exactly as it does today.
--
-- ---------------------------------------------------------------------------
-- Why a membership table and not users.tenant_id
-- ---------------------------------------------------------------------------
-- public.users is pre-existing and this codebase reads it but never migrates
-- it (001:5-9). More importantly, Supabase auth emails are unique across the
-- whole project, so one person is one auth identity no matter how many tenants
-- they belong to. A tenant_id COLUMN would mean a TropicalTalent creative who joins a
-- white-label is locked out of one of the two, permanently and unfixably
-- without a migration. A join table costs one embed on a query that already
-- runs and leaves that door open.
--
-- ---------------------------------------------------------------------------
-- Why tenant_id lands only on tropical_projects
-- ---------------------------------------------------------------------------
-- The project is the anchor of the whole domain. Roles, members, channels,
-- messages, applications, escrows, holds, contracts, deliverables and disputes
-- are all reachable from a project by foreign key, and every one of their RLS
-- policies already routes through tropical_is_member()/tropical_is_brand(). Adding
-- the column to twenty tables would mean twenty chances for it to disagree
-- with the project it hangs off. One column, one source of truth.
--
-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- No new value is added to users.role — its CHECK constraint is closed
-- (creative|brand|admin, fix_brand_role_and_table.sql:10-16) and it lives on a
-- table this codebase does not own. Instead:
--
--   TropicalTalent super admin -> users.role = 'admin' (unchanged; hand-promoted)
--   WL admin          -> tropical_tenant_members.role = 'wl_admin'
--   member            -> tropical_tenant_members.role = 'member', with
--                        capabilities deciding whether they hire, work, or both
--
-- A super admin is treated as wl_admin of every tenant by
-- tropical_is_tenant_admin() below — that is the "log into any WL site for
-- routine testing" requirement, without a second account per tenant.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TENANTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tropical_tenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE
                      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),

  -- Exactly one row is the classic TropicalTalent app. Enforced by the unique index
  -- below rather than a CHECK, which cannot see other rows.
  is_classic        boolean NOT NULL DEFAULT false,

  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended')),

  -- Which shape of white-label this is. Seeds features + the capabilities new
  -- members get; every field stays editable afterwards, so this is a starting
  -- point and not a mode the app branches on at runtime.
  archetype         text NOT NULL DEFAULT 'classic'
                      CHECK (archetype IN ('classic', 'contractors_brands', 'creatives_brands')),

  -- Palette, logo/wordmark/from-address, and surface toggles. Read by
  -- modules/tenancy; never interpolated into CSS without a whitelist check.
  theme             jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding          jsonb NOT NULL DEFAULT '{}'::jsonb,
  features          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The whole cut taken from a project pot...
  platform_fee_pct  numeric(5,2) NOT NULL DEFAULT 15.00
                      CHECK (platform_fee_pct >= 0 AND platform_fee_pct < 100),
  -- ...and the share OF THAT FEE owed to the white-label partner. A percentage
  -- of the fee, not of the pot: at 15% fee and 33% share the partner earns
  -- ~5% of the pot, and a fee change cannot accidentally invert the split.
  partner_share_pct numeric(5,2) NOT NULL DEFAULT 0
                      CHECK (partner_share_pct >= 0 AND partner_share_pct <= 100),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tropical_tenants_theme_is_object    CHECK (jsonb_typeof(theme) = 'object'),
  CONSTRAINT tropical_tenants_branding_is_object CHECK (jsonb_typeof(branding) = 'object'),
  CONSTRAINT tropical_tenants_features_is_object CHECK (jsonb_typeof(features) = 'object')
);

COMMENT ON TABLE public.tropical_tenants IS
  'One row per branded site. The is_classic row is TropicalTalent itself.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_tenants_one_classic
  ON public.tropical_tenants ((is_classic)) WHERE is_classic;

-- ============================================================================
-- 2. DOMAINS
-- ============================================================================
-- Host -> tenant. A tenant may have several (acme.tropicaltalent.dev plus a custom
-- talent.acme.com), which is why this is a table and not a column.
-- Host is the primary key: two tenants cannot claim the same hostname.

CREATE TABLE IF NOT EXISTS public.tropical_tenant_domains (
  host        text PRIMARY KEY CHECK (host = lower(host)),
  tenant_id   uuid NOT NULL REFERENCES public.tropical_tenants(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  -- NULL until a custom domain's DNS is confirmed. Subdomains of our own
  -- wildcard are verified on creation.
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tropical_tenant_domains_tenant
  ON public.tropical_tenant_domains (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tropical_tenant_domains_one_primary
  ON public.tropical_tenant_domains (tenant_id) WHERE is_primary;

-- ============================================================================
-- 3. MEMBERSHIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tropical_tenant_members (
  tenant_id    uuid NOT NULL REFERENCES public.tropical_tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  role         text NOT NULL DEFAULT 'member'
                 CHECK (role IN ('member', 'wl_admin')),

  -- What this person may do inside this tenant.
  --   brand -> may commission work (create projects, fund escrow, hire)
  --   work  -> may earn (accept invites, sign contracts, get paid)
  -- The classic tenant grants both to everyone, which is what makes classic
  -- behaviour identical to today: viewer.canBrand was hardcoded true.
  -- A WL contractor is {brand:false, work:true}; a WL payer company is
  -- {brand:true, work:false}.
  capabilities jsonb NOT NULL DEFAULT '{"brand": true, "work": true}'::jsonb,

  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended')),
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT tropical_tenant_members_caps_is_object CHECK (jsonb_typeof(capabilities) = 'object')
);

-- The PK covers (tenant_id, user_id). getViewer() asks the other way round —
-- "every membership for this user" — on every single request, so it gets its
-- own index rather than a sequential scan.
CREATE INDEX IF NOT EXISTS idx_tropical_tenant_members_user
  ON public.tropical_tenant_members (user_id);

-- Talent discovery joins members -> users filtered by tenant and ordered by
-- the users.created_at keyset, so the tenant side of that join wants its own
-- covering index.
CREATE INDEX IF NOT EXISTS idx_tropical_tenant_members_tenant_active
  ON public.tropical_tenant_members (tenant_id, user_id) WHERE status = 'active';

-- ============================================================================
-- 4. SEED THE CLASSIC TENANT AND BACKFILL
-- ============================================================================
-- Everything that exists today belongs to TropicalTalent. Both statements are
-- idempotent, which matters because apply.mjs re-runs every file.

INSERT INTO public.tropical_tenants (slug, name, is_classic, archetype, features, branding)
VALUES (
  'tropicaltalent', 'TropicalTalent', true, 'classic',
  jsonb_build_object(
    'publicBriefs', true, 'talentBrowse', true, 'applications', true,
    'referrals', true, 'waitlist', true, 'recurring', true, 'selfServeBrands', true
  ),
  -- Attribution is for white-labels. TropicalTalent does not carry "Powered by TropicalTalent".
  jsonb_build_object('poweredBy', false)
)
ON CONFLICT (slug) DO NOTHING;

-- Give every PRE-TENANCY account a home on classic.
--
-- ---------------------------------------------------------------------------
-- Why this is guarded, and what it did before it was
-- ---------------------------------------------------------------------------
-- migrations/apply.mjs re-runs every file in order on EVERY invocation, so
-- this statement is not a one-time backfill — it ran again on every
-- `npm run migrate`. ON CONFLICT DO NOTHING stopped it duplicating rows, but
-- not from granting new ones: any account created since the previous run got a
-- classic membership, whoever they actually belonged to.
--
-- The result was a cross-tenant leak. A contractor who signed up on a
-- customer's own branded site became a member of classic TropicalTalent at the next
-- migrate, and then appeared in classic's Talent board and could be hired into
-- classic projects. By the time this guard was added, every account in the
-- database was a classic member — including white-label-only ones.
--
-- Two conditions, both required:
--
--   * no white-label exists yet. Once one customer is live this backfill is
--     historical, and re-running it can only ever be wrong.
--   * the account belongs nowhere else. Someone already placed in a tenant has
--     been assigned deliberately, by sign-up or by an admin, and this
--     statement has no business overriding that.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tropical_tenants WHERE NOT is_classic) THEN
    RAISE NOTICE 'tenancy is live - skipping the classic membership backfill';
    RETURN;
  END IF;

  INSERT INTO public.tropical_tenant_members (tenant_id, user_id, role, capabilities)
  SELECT
    t.id,
    u.id,
    CASE WHEN u.role = 'admin' THEN 'wl_admin' ELSE 'member' END,
    -- Mirrors modules/identity/queries.ts today: every account may hire
    -- (canBrand was hardcoded true), and brands do not work.
    jsonb_build_object('brand', true, 'work', u.role IS DISTINCT FROM 'brand')
  FROM public.users u
  CROSS JOIN public.tropical_tenants t
  WHERE t.is_classic
    AND NOT EXISTS (
      SELECT 1 FROM public.tropical_tenant_members m WHERE m.user_id = u.id
    )
  ON CONFLICT (tenant_id, user_id) DO NOTHING;
END $$;

-- ============================================================================
-- 5. TENANT ON PROJECTS
-- ============================================================================

ALTER TABLE public.tropical_projects
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tropical_tenants(id);

UPDATE public.tropical_projects p
SET tenant_id = (SELECT id FROM public.tropical_tenants WHERE is_classic)
WHERE p.tenant_id IS NULL;

-- The column defaults to the classic tenant, and that default is load-bearing
-- RIGHT NOW rather than a convenience.
--
-- tropical_create_project() (007) inserts into this table without naming
-- tenant_id. The moment the NOT NULL below lands, every project creation would
-- fail with a not-null violation — on the deployed app, before any new code
-- ships. The default keeps that path working and puts new classic projects in
-- the right tenant.
--
-- It is a migration-window crutch, not the end state. When tropical_create_project
-- is rewritten to take p_tenant_id explicitly, drop the default in the same
-- migration: a default silently filing a white-label's project under TropicalTalent is
-- exactly the kind of quiet wrong answer this column exists to prevent.
DO $$
DECLARE
  v_classic uuid;
BEGIN
  SELECT id INTO v_classic FROM public.tropical_tenants WHERE is_classic;
  EXECUTE format(
    'ALTER TABLE public.tropical_projects ALTER COLUMN tenant_id SET DEFAULT %L',
    v_classic
  );
END $$;

ALTER TABLE public.tropical_projects ALTER COLUMN tenant_id SET NOT NULL;

COMMENT ON COLUMN public.tropical_projects.tenant_id IS
  'The branded site this project belongs to. Every child row (roles, members, channels, escrows, contracts) inherits tenancy through here rather than carrying its own copy.';

-- The brief feed and the admin project list both read "this tenant, newest
-- first", which is exactly this index.
CREATE INDEX IF NOT EXISTS idx_tropical_projects_tenant_created
  ON public.tropical_projects (tenant_id, created_at DESC);

-- ============================================================================
-- 6. REVENUE ATTRIBUTION ON ESCROW
-- ============================================================================
-- platform_fee is already recorded per escrow, but with one implicit recipient
-- (TropicalTalent). A reseller needs to know which tenant produced the fee and how much
-- of it is owed onward. Both are recorded at funding time and frozen, so a
-- later fee change cannot silently reprice historical revenue.

ALTER TABLE public.tropical_project_escrows
  ADD COLUMN IF NOT EXISTS tenant_id   uuid REFERENCES public.tropical_tenants(id),
  ADD COLUMN IF NOT EXISTS partner_fee bigint NOT NULL DEFAULT 0
    CHECK (partner_fee >= 0);

UPDATE public.tropical_project_escrows e
SET tenant_id = p.tenant_id
FROM public.tropical_projects p
WHERE e.project_id = p.id AND e.tenant_id IS NULL;

COMMENT ON COLUMN public.tropical_project_escrows.partner_fee IS
  'Minor units of platform_fee owed to the white-label partner. Zero on the classic tenant. Payable out of band; no second payment provider transfer leg exists yet.';

CREATE INDEX IF NOT EXISTS idx_tropical_project_escrows_tenant
  ON public.tropical_project_escrows (tenant_id);

-- tropical_open_escrow() (008, re-keyed in 016) is the only insert path and it
-- does not name tenant_id. Left alone, every escrow funded from now until that
-- RPC is rewritten would carry NULL and drop out of per-tenant revenue — a
-- silent hole in the numbers rather than a visible failure.
--
-- Deriving it from the project here means the column is right no matter which
-- path writes the row, including one written by hand in the SQL editor. The
-- escrow's tenant is not an independent fact: it is the project's tenant, and
-- a trigger says so in the one place that cannot drift.
CREATE OR REPLACE FUNCTION public.tropical_escrow_inherit_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT p.tenant_id INTO NEW.tenant_id
    FROM public.tropical_projects p
    WHERE p.id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tropical_escrow_tenant ON public.tropical_project_escrows;
CREATE TRIGGER tropical_escrow_tenant
  BEFORE INSERT ON public.tropical_project_escrows
  FOR EACH ROW
  EXECUTE FUNCTION public.tropical_escrow_inherit_tenant();

COMMIT;
