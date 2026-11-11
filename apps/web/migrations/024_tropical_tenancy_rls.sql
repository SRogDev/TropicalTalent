-- ============================================================================
-- 024 — Row level security for tenancy
-- ============================================================================
-- The tenant boundary is enforced in Postgres, not in TypeScript. That is the
-- convention this codebase already states out loud: modules/projects/
-- queries.ts:103 declines to add a membership filter to loadProjectTree()
-- because "adding one would let a bug in the filter silently widen access
-- rather than narrow it". Tenancy gets the same treatment — the filters that
-- appear in queries.ts are performance hints, and these policies are the
-- boundary.
--
-- ---------------------------------------------------------------------------
-- Ordering note
-- ---------------------------------------------------------------------------
-- migrations/apply.mjs sorts filenames lexicographically and re-runs every
-- file, so this lands after 002_tropical_rls.sql on every invocation. 002 opens
-- by dropping every policy on tables matching 'tropical\_%' and redefining them;
-- this file therefore redefines tropical_projects_read_members AFTER 002 has
-- restored the pre-tenancy version. The drop below is scoped to the tables
-- this file owns plus that one policy, so re-running does not disturb 002.
--
-- It is numbered 024 and not 023b for a load-bearing reason: apply.mjs:32
-- selects files with /^\d{3}_.*\.sql$/, which requires an underscore directly
-- after three digits. A '023b_' file matches nothing, is silently skipped, and
-- would leave every table in 023 with RLS never enabled — i.e. every tenant
-- membership readable by every signed-in user. Do not use letter suffixes.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. HELPERS  (SECURITY DEFINER — prevents RLS recursion)
-- ============================================================================
-- Same shape and rationale as tropical_is_member / tropical_is_brand in 001:148.
-- A policy ON tropical_tenant_members that asked "is the caller a member of this
-- tenant?" with a plain subquery would evaluate that table's own policy
-- recursively. These bypass RLS deliberately and reveal nothing the caller
-- could not already establish about themselves.

CREATE OR REPLACE FUNCTION public.tropical_is_tenant_member(p_tenant uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tropical_tenant_members m
    WHERE m.tenant_id = p_tenant
      AND m.user_id   = p_user
      AND m.status    = 'active'
  );
$$;

COMMENT ON FUNCTION public.tropical_is_tenant_member(uuid, uuid) IS
  'Active membership only. Suspending a membership is therefore a real kill switch: it removes the person from every tenant-scoped read immediately, including projects they are a member of.';

-- wl_admin of this tenant, or a TropicalTalent super admin — who is implicitly an admin
-- of every tenant. That implicit grant is what lets support sign in to a
-- branded site to reproduce a bug without a second account per tenant.
CREATE OR REPLACE FUNCTION public.tropical_is_tenant_admin(p_tenant uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tropical_tenant_members m
    WHERE m.tenant_id = p_tenant
      AND m.user_id   = p_user
      AND m.role      = 'wl_admin'
      AND m.status    = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user AND u.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.tropical_is_tenant_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.tropical_is_tenant_admin(uuid, uuid)  FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_is_tenant_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tropical_is_tenant_admin(uuid, uuid)  TO authenticated;

-- ============================================================================
-- 2. ENABLE + RESET
-- ============================================================================

ALTER TABLE public.tropical_tenants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tropical_tenant_members ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS. Scoped to this file's own tables so a
-- re-run redefines them cleanly without touching what 002 just created.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tropical_tenants', 'tropical_tenant_domains', 'tropical_tenant_members')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS "tropical_projects_read_members" ON public.tropical_projects;

-- ============================================================================
-- 3. TENANTS
-- ============================================================================
-- You can read a tenant you belong to. Nothing else — the branding a site
-- renders is served by the server component that resolved the host, not by the
-- browser asking PostgREST for a tenant row.

CREATE POLICY "tropical_tenants_read_own" ON public.tropical_tenants
  FOR SELECT USING (
    public.tropical_is_tenant_member(id, (SELECT auth.uid()))
  );

-- Writes are service-role only: creating and configuring a tenant happens in
-- the super-admin console through adminDb(), never as the signed-in user.

-- ============================================================================
-- 4. DOMAINS  — no policy at all
-- ============================================================================
-- RLS on with zero policies denies everything to anon and authenticated. Host
-- resolution runs server-side through the service role before a session even
-- exists, so no signed-in user ever needs to read this table. Same pattern as
-- tropical_referral_reward_fulfillments (021:35).

-- ============================================================================
-- 5. MEMBERSHIPS
-- ============================================================================
-- This single policy is what makes tenant-scoped talent discovery a Postgres
-- boundary rather than a TypeScript filter.
--
-- loadTalent() reads users with an INNER embed on this table:
--
--   .select('..., membership:tropical_tenant_members!inner(tenant_id)')
--   .eq('membership.tenant_id', tenantId)
--
-- PostgREST turns that into a join. Rows this policy hides cannot satisfy the
-- inner join, so a creative in another tenant is pruned by the database even
-- if the .eq() filter were dropped or mistyped.

CREATE POLICY "tropical_tenant_members_read_same_tenant" ON public.tropical_tenant_members
  FOR SELECT USING (
    public.tropical_is_tenant_member(tenant_id, (SELECT auth.uid()))
  );

-- Membership is granted by sign-up (service role, inside writeProfile) or by a
-- WL admin in the console. A user may not enrol themselves.

-- ============================================================================
-- 6. PROJECTS  — tenant predicate
-- ============================================================================
-- Redefines the policy from 002:131. Membership already implies access, so
-- this is defence in depth: it closes the case where a project row and a
-- project_members row disagree about which tenant they belong to, and it makes
-- suspending a membership remove project access immediately.
--
-- It must be the SAME policy rather than an additional one — permissive
-- policies for a command are OR'd together, so a second policy would widen
-- access rather than narrow it.

CREATE POLICY "tropical_projects_read_members" ON public.tropical_projects
  FOR SELECT USING (
    public.tropical_is_tenant_member(tenant_id, (SELECT auth.uid()))
    AND (
      brand_id = (SELECT auth.uid())
      OR public.tropical_is_member(id, (SELECT auth.uid()))
    )
  );

COMMIT;
