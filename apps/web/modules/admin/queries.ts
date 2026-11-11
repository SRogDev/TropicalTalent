import 'server-only';

import { cache } from 'react';
import { adminDb } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import type { Viewer } from '@/modules/identity/types';
import { accountHealth } from './health';
import { REFERRAL_TIERS, type ReferralAudience } from '@/modules/referrals/tiers';
import type { AdminDeleteRequest } from '@/modules/projects/types';
import type {
  AdminEarnings,
  AdminFulfilledReferralRewardRow,
  AdminOverview,
  AdminProjectRow,
  AdminReferralRewardRow,
  AdminUserRow,
} from './types';

/**
 * Admin reads.
 *
 * Every function here goes through adminDb() — the service-role client — and
 * not the RLS-scoped session client, because the whole point of this module
 * is showing one signed-in user rows that belong to every other user. That is
 * exactly the case lib/supabase.ts reserves adminDb() for, so it is used here
 * rather than widening RLS policies with an admin carve-out on every table.
 *
 * There is ONE gate — requireAdminScope() — and every loader in this file goes
 * through it. It answers both questions at once: may this person see a console
 * at all, and whose data is in it.
 *
 * There used to be a second, requireAdminViewer(), for the two referral loaders
 * "which serve TropicalTalent's own growth programme rather than any tenant's data". That
 * exemption did not survive contact: it meant a super admin standing on
 * acme.tropicaltalent.dev/admin/referrals was shown CLASSIC TropicalTalent's referrers — real
 * names and email addresses belonging to other people, rendered on a customer's
 * own domain. Whether a surface is TropicalTalent's programme or a tenant's is a question
 * about which rows to show, not a reason to skip scoping, and a second gate
 * whose whole purpose was to skip it was always going to be used that way
 * again. Referrals are scoped by membership now, like everything else.
 *
 * The guard lives WITH the query, not just with the layout that renders it, so
 * a page that forgets to check still cannot leak.
 *
 * One caveat worth stating plainly: adminDb() bypasses RLS, so unlike the rest
 * of the app the tenant boundary here is application code, not Postgres. The
 * scoping helpers below exist to make that boundary hard to forget, and
 * scripts/verify-tenancy.mjs asserts it from outside.
 */

/**
 * Who is asking, and which tenant's data they may see.
 *
 * `tenantId: null` means unscoped — every tenant at once. Only a TropicalTalent super
 * admin on the classic host gets that.
 *
 * ---------------------------------------------------------------------------
 * The host decides the scope
 * ---------------------------------------------------------------------------
 * A super admin visiting acme.tropicaltalent.dev/admin sees ACME's console, not a
 * cross-tenant one. That is deliberate and it is the whole "log into any
 * white-label for routine testing" requirement: support reproduces what the
 * customer is looking at, on the customer's own hostname, without a second
 * account. The unscoped view lives on the classic host, where it belongs.
 *
 * A white-label's own admin is pinned to their tenant wherever they are — the
 * check is on their membership, not on the host, so pointing their browser at
 * another tenant's hostname changes nothing.
 *
 * This is the ONLY place that decision is made. Every loader below calls it
 * and applies the filter it returns; none of them re-derive it.
 */
export const requireAdminScope = cache(
  async (): Promise<{ viewer: Viewer; tenantId: string | null }> => {
    const viewer = await getViewer();
    if (!viewer) throw new Error('Admin access required.');

    const tenant = await getTenant();

    if (viewer.isSuperAdmin) {
      return { viewer, tenantId: tenant.isClassic ? null : tenant.id };
    }

    // A white-label admin, on their own tenant's host.
    if (viewer.tenantRole === 'wl_admin' && viewer.belongsToTenant) {
      return { viewer, tenantId: tenant.id };
    }

    throw new Error('Admin access required.');
  },
);

/**
 * Scoping helpers.
 *
 * Each returns the query untouched when tenantId is null, so the unscoped
 * super-admin path costs nothing and reads identically to before tenancy.
 *
 * They exist so the filter is written once per shape rather than once per
 * loader — a tenant filter that is correct in five places and forgotten in the
 * sixth is the failure mode worth engineering out.
 */

/** Anything carrying tenant_id directly — projects, escrows. */
function byTenant<T>(query: T, tenantId: string | null): T {
  if (!tenantId) return query;
  const q = query as { eq: (col: string, val: string) => T };
  return q.eq('tenant_id', tenantId);
}

/** Rows that reach a tenant only through their project — holds, disputes. */
function byTenantViaProject<T>(query: T, tenantId: string | null): T {
  if (!tenantId) return query;
  const q = query as { eq: (col: string, val: string) => T };
  return q.eq('project.tenant_id', tenantId);
}

/*
 * The embeds these helpers filter on are written inline at each call site
 * rather than shared as constants: supabase-js infers the row type from the
 * select string LITERAL, and interpolating a constant erases the type.
 *
 * `!inner` is the load-bearing part. A left join keeps rows whose embed
 * matched nothing — for a tenant filter, precisely the rows meant to be
 * excluded.
 */

export const loadAdminOverview = cache(async (): Promise<AdminOverview> => {
  const { tenantId } = await requireAdminScope();
  const supabase = adminDb();

  // Every count and total below is scoped by the same tenantId, or by nothing
  // at all when a super admin is on the classic host. The head:true counts
  // still cost one round trip each, but they run concurrently and none of them
  // transfers rows.
  // Two whole queries rather than one with a conditional select string.
  // supabase-js derives the row type from the select LITERAL, so a ternary
  // hands it a union of two strings that it cannot parse and the result type
  // collapses to ParserError.
  //
  // They are also not equivalent: the membership join is INNER, so the scoped
  // form would drop a user with no membership row. That is right when scoping
  // to a tenant and wrong for a platform-wide count, which must include an
  // account that exists but has not been placed in a tenant yet.
  const userCount = (role: string) =>
    tenantId
      ? supabase
          .from('users')
          .select(`id, membership:tropical_tenant_members!inner(tenant_id)`, {
            count: 'exact',
            head: true,
          })
          .eq('role', role)
          .eq('membership.tenant_id', tenantId)
      : supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', role);

  const [
    { count: creatives },
    { count: brands },
    { count: admins },
    { count: projects },
    { count: activeProjects },
    { count: openDisputes },
    { data: escrows },
    { data: holds },
  ] = await Promise.all([
    userCount('creative'),
    userCount('brand'),
    userCount('admin'),
    byTenant(
      supabase.from('tropical_projects').select('id', { count: 'exact', head: true }),
      tenantId,
    ),
    byTenant(
      supabase
        .from('tropical_projects')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      tenantId,
    ),
    // The project embed is always present, scoped or not: tropical_disputes.
    // project_id is NOT NULL, so an inner join can never drop a row and the
    // unscoped count is unaffected. One literal select keeps the row type.
    byTenantViaProject(
      supabase
        .from('tropical_disputes')
        .select('id, project:tropical_projects!inner(tenant_id)', { count: 'exact', head: true })
        .in('status', ['open', 'reviewing']),
      tenantId,
    ),
    byTenant(
      supabase.from('tropical_project_escrows').select('total_amount, currency, status'),
      tenantId,
    ),
    // Same reasoning: tropical_escrow_holds.project_id is NOT NULL.
    byTenantViaProject(
      supabase
        .from('tropical_escrow_holds')
        .select('amount, status, project:tropical_projects!inner(tenant_id)'),
      tenantId,
    ),
  ]);

  const currency = escrows?.[0]?.currency ?? 'GBP';
  const funded = (escrows ?? [])
    .filter((e) => e.status !== 'pending' && e.status !== 'cancelled')
    .reduce((sum, e) => sum + e.total_amount, 0);
  const released = (holds ?? [])
    .filter((h) => h.status === 'released')
    .reduce((sum, h) => sum + h.amount, 0);
  const held = (holds ?? [])
    .filter((h) => h.status === 'held')
    .reduce((sum, h) => sum + h.amount, 0);

  return {
    counts: {
      creatives: creatives ?? 0,
      brands: brands ?? 0,
      admins: admins ?? 0,
      projects: projects ?? 0,
      activeProjects: activeProjects ?? 0,
      openDisputes: openDisputes ?? 0,
    },
    escrow: { funded, released, held, currency },
  };
});

/** How many accounts the console shows. */
const ADMIN_USER_PAGE = 500;

/**
 * Emails and last-sign-in for a specific set of user ids.
 *
 * Walks the auth directory in pages and stops as soon as every id asked for
 * has been found, so the cost tracks the size of the page on screen rather
 * than the size of the project. A hard page ceiling keeps a pathological case
 * (ids that no longer exist in auth) from walking the whole directory.
 */
async function resolveAuthIdentities(wanted: Set<string>): Promise<{
  emailById: Map<string, string | null>;
  lastSignInById: Map<string, string | null>;
  confirmedById: Map<string, boolean>;
}> {
  const emailById = new Map<string, string | null>();
  const lastSignInById = new Map<string, string | null>();
  // Whether the address was ever confirmed. Rides along on a call that was
  // already being made: an account whose email is unconfirmed cannot sign in
  // at all, and until now nothing on the console said so — sign-up writes
  // profile_completed with the SERVICE ROLE before confirmation, so those
  // accounts rendered as complete.
  const confirmedById = new Map<string, boolean>();
  if (wanted.size === 0) return { emailById, lastSignInById, confirmedById };

  const supabase = adminDb();
  const PER_PAGE = 200;
  const MAX_PAGES = 20;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    const batch = data?.users ?? [];
    if (error || batch.length === 0) break;

    for (const u of batch) {
      if (!wanted.has(u.id)) continue;
      emailById.set(u.id, u.email ?? null);
      lastSignInById.set(u.id, u.last_sign_in_at ?? null);
      confirmedById.set(u.id, Boolean(u.email_confirmed_at ?? u.confirmed_at));
    }

    // Everyone on screen is accounted for, or the directory is exhausted.
    if (emailById.size >= wanted.size || batch.length < PER_PAGE) break;
  }

  return { emailById, lastSignInById, confirmedById };
}

/**
 * Accounts, newest first, scoped to the caller's tenant.
 *
 * Email and last-sign-in both live only in Supabase Auth, not on
 * public.users, so they are matched by id from a second call — Supabase
 * already maintains last_sign_in_at on every sign-in, so this needs no column
 * of our own.
 *
 * ---------------------------------------------------------------------------
 * Why the auth lookup is now driven by the page, not the whole project
 * ---------------------------------------------------------------------------
 * This used to call listUsers({ page: 1, perPage: 1000 }) — a scan of every
 * auth user in the project, on every render of the accounts screen, to attach
 * emails to at most 1000 profile rows. It survived because the seed database
 * has 50 users. A single white-label onboarding 600 contractors puts it past
 * 650, and a second one puts it over the cap, at which point emails silently
 * stop resolving for whoever falls off the end.
 *
 * getUserById per row would be an N+1. Instead the page of profiles is fetched
 * first and the auth directory is walked only as far as it takes to resolve
 * that page — the same call, but bounded by what is on screen rather than by
 * how many accounts exist.
 */
export const loadAdminUsers = cache(async (): Promise<AdminUserRow[]> => {
  const { tenantId } = await requireAdminScope();
  const supabase = adminDb();

  const { data: users } = await (tenantId
    ? supabase
        .from('users')
        .select(
          `
        id, name, username, avatar, role, created_at, profile_completed,
        membership:tropical_tenant_members!inner(tenant_id),
        creative_data(user_id, verification),
        brand_data(user_id),
        user_stats(jobs_done, total_revenue)
      `,
        )
        .eq('membership.tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(ADMIN_USER_PAGE)
    : supabase
        .from('users')
        .select(
          `
        id, name, username, avatar, role, created_at, profile_completed,
        memberships:tropical_tenant_members(tenant_id),
        creative_data(user_id, verification),
        brand_data(user_id),
        user_stats(jobs_done, total_revenue)
      `,
        )
        .order('created_at', { ascending: false })
        .limit(ADMIN_USER_PAGE));

  const wanted = new Set((users ?? []).map((u) => u.id as string));
  const [{ emailById, lastSignInById, confirmedById }, deletedAtById] = await Promise.all([
    resolveAuthIdentities(wanted),
    resolveDeletions(wanted),
  ]);

  const rows: AdminUserRow[] = (users ?? []).map((u) => {
    const creative = one<{ user_id: string; verification: string | null }>(u.creative_data);
    const brand = one<{ user_id: string }>(u.brand_data);
    const stats = one<{ jobs_done: number | null; total_revenue: number | null }>(u.user_stats);
    const role = (u.role as AdminUserRow['role']) ?? 'creative';
    const deletedAt = deletedAtById.get(u.id as string) ?? null;
    const profileCompleted = Boolean(u.profile_completed);

    // On the tenant-scoped query the membership embed is `!inner`, so every row
    // returned is a member by construction and `no_membership` cannot arise.
    // Only the unscoped (super admin) query can observe it — see the note on
    // the orphan pass below for the same boundary.
    const hasMembership = tenantId
      ? true
      : Array.isArray(u.memberships) && u.memberships.length > 0;

    return {
      id: u.id,
      name: u.name,
      username: u.username,
      email: emailById.get(u.id) ?? null,
      role,
      createdAt: u.created_at,
      lastSignInAt: lastSignInById.get(u.id) ?? null,
      profileCompleted,
      health: accountHealth(
        { role, profileCompleted, deletedAt },
        {
          hasMembership,
          hasRoleRow: role === 'brand' ? Boolean(brand) : Boolean(creative),
          // Absent from the auth directory walk (it stops early once the page
          // is resolved) reads as confirmed rather than inventing a fault.
          emailConfirmed: confirmedById.get(u.id) ?? true,
          hasAvatar: Boolean(u.avatar),
        },
      ),
      verification: creative?.verification ?? null,
      jobsDone: stats?.jobs_done ?? null,
      totalRevenue: stats?.total_revenue ?? null,
      deletedAt,
    };
  });

  return tenantId ? rows : [...rows, ...(await orphanedAuthRows(wanted))];
});

/**
 * Accounts that exist in auth.users with no public.users row at all.
 *
 * These are invisible everywhere else in the product, and the reason is that
 * every screen — this one included — starts FROM public.users. A sign-up whose
 * profile write never landed leaves a person holding working credentials and no
 * profile, and nothing on any roster ever mentions them. The live database has
 * twelve.
 *
 * Super admin only. With no profile row there is no membership, so there is no
 * way to attribute one of these to a tenant, and showing them on a white-label
 * console would leak another customer's stranded sign-ups. The caller passes
 * tenantId === null for the platform view.
 *
 * Synthetic rows: no name, no username, no role, no stats. `role` is filled in
 * as 'talent' because AdminUserRow demands one and it is the least
 * privileged; the `no_profile_row` badge is what the screen actually reads.
 */
async function orphanedAuthRows(known: Set<string>): Promise<AdminUserRow[]> {
  const supabase = adminDb();
  const rows: AdminUserRow[] = [];
  const PER_PAGE = 200;
  const MAX_PAGES = 20;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    const batch = data?.users ?? [];
    if (error || batch.length === 0) break;

    for (const u of batch) {
      if (known.has(u.id)) continue;
      rows.push({
        id: u.id,
        name: null,
        username: null,
        email: u.email ?? null,
        role: 'creative',
        createdAt: u.created_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        profileCompleted: false,
        health: ['no_profile_row'],
        verification: null,
        jobsDone: null,
        totalRevenue: null,
        deletedAt: null,
      });
    }

    if (batch.length < PER_PAGE) break;
  }

  return rows;
}

/**
 * When each of these accounts was closed, for the ones that were.
 *
 * A SEPARATE query rather than an embed on the users select, and that is the
 * whole point of it. As an embed, one missing relationship takes the entire
 * accounts page with it: PostgREST rejects the request, `data` comes back
 * null, and the console renders "0 total" for a database full of people. That
 * is exactly what happened between this table being written and migration 040
 * being applied.
 *
 * A deletion record is decoration on this page — a pill beside a name. It must
 * never be able to decide whether the page has any content, so its failure is
 * swallowed and every account simply reads as live.
 *
 * Costs one round trip, run concurrently with the auth directory walk, so it
 * adds no latency to a page that was already making two calls.
 */
async function resolveDeletions(userIds: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.size === 0) return out;

  const { data, error } = await adminDb()
    .from('tropical_deleted_accounts')
    .select('user_id, deleted_at')
    .in('user_id', [...userIds]);

  // Missing table, missing column, anything at all: the page still renders.
  if (error || !data) return out;

  for (const row of data) {
    out.set(row.user_id as string, row.deleted_at as string);
  }
  return out;
}

export const loadAdminProjects = cache(async (): Promise<AdminProjectRow[]> => {
  const { tenantId } = await requireAdminScope();
  const supabase = adminDb();

  const { data } = await byTenant(
    supabase
      .from('tropical_projects')
      .select(
        `
      id, name, status, visibility, budget, currency, created_at, archived_at,
      brand:users!tropical_projects_brand_id_fkey(name, username),
      roles:tropical_project_roles(id, assigned_user_id),
      escrow:tropical_project_escrows(status)
    `,
      )
      .order('created_at', { ascending: false })
      .limit(1000),
    tenantId,
  );

  return (data ?? []).map((p) => {
    const brand = one<{ name: string | null; username: string | null }>(p.brand);
    const escrow = one<{ status: string }>(p.escrow);
    const roles = (p.roles ?? []) as Array<{ id: string; assigned_user_id: string | null }>;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      visibility: p.visibility as AdminProjectRow['visibility'],
      budget: p.budget,
      currency: p.currency,
      brandName: brand?.name ?? brand?.username ?? null,
      roleCount: roles.length,
      filledRoleCount: roles.filter((r) => r.assigned_user_id).length,
      escrowStatus: escrow?.status ?? null,
      createdAt: p.created_at,
      archivedAt: p.archived_at ?? null,
    };
  });
});

export const loadAdminEarnings = cache(async (): Promise<AdminEarnings> => {
  const { tenantId } = await requireAdminScope();
  const supabase = adminDb();

  const [{ data: escrows }, { data: holds }, { data: transactions }, { data: balances }] =
    await Promise.all([
      // partner_fee comes along so a white-label's console can show what its
      // own share of the platform fee has amounted to, not just what TropicalTalent
      // took. Zero on the classic tenant.
      byTenant(
        supabase
          .from('tropical_project_escrows')
          .select('total_amount, platform_fee, partner_fee, currency, status'),
        tenantId,
      ),
      byTenantViaProject(
        supabase
          .from('tropical_escrow_holds')
          .select('amount, status, project:tropical_projects!inner(tenant_id)'),
        tenantId,
      ),
      byTenantViaProject(
        supabase
          .from('tropical_balance_transactions')
          .select(
            `
          id, amount, type, status, created_at,
          user:users!tropical_balance_transactions_user_id_fkey(name, username),
          project:tropical_projects!inner(name, tenant_id)
        `,
          )
          .order('created_at', { ascending: false })
          .limit(50),
        tenantId,
      ),
      // Top earners. A balance reaches a tenant only through its user, so the
      // scope goes through the membership embed on the joined user rather than
      // through the balance row, which carries no tenant of its own.
      tenantId
        ? supabase
            .from('tropical_user_balances')
            .select(
              `user_id, lifetime_earned,
               user:users!tropical_user_balances_user_id_fkey!inner(
                 name, username, membership:tropical_tenant_members!inner(tenant_id)
               )`,
            )
            .eq('user.membership.tenant_id', tenantId)
            .order('lifetime_earned', { ascending: false })
            .limit(10)
        : supabase
            .from('tropical_user_balances')
            .select(
              'user_id, lifetime_earned, user:users!tropical_user_balances_user_id_fkey(name, username)',
            )
            .order('lifetime_earned', { ascending: false })
            .limit(10),
    ]);

  const currency = escrows?.[0]?.currency ?? 'GBP';
  const funded = (escrows ?? [])
    .filter((e) => e.status !== 'pending' && e.status !== 'cancelled')
    .reduce((sum, e) => sum + e.total_amount, 0);
  const platformFees = (escrows ?? [])
    .filter((e) => e.status !== 'pending' && e.status !== 'cancelled')
    .reduce((sum, e) => sum + e.platform_fee, 0);
  // What of that fee is owed onward to a white-label partner. Always 0 on the
  // classic tenant, and 0 everywhere until rev-share is switched on for a
  // tenant — recorded per escrow at funding time so a later fee change cannot
  // reprice history.
  const partnerFees = (escrows ?? [])
    .filter((e) => e.status !== 'pending' && e.status !== 'cancelled')
    .reduce((sum, e) => sum + (e.partner_fee ?? 0), 0);
  const released = (holds ?? [])
    .filter((h) => h.status === 'released')
    .reduce((sum, h) => sum + h.amount, 0);
  const held = (holds ?? [])
    .filter((h) => h.status === 'held')
    .reduce((sum, h) => sum + h.amount, 0);
  const refunded = (holds ?? [])
    .filter((h) => h.status === 'refunded')
    .reduce((sum, h) => sum + h.amount, 0);

  return {
    totals: { funded, released, held, refunded, platformFees, partnerFees, currency },
    recentTransactions: (transactions ?? []).map((t) => {
      const user = one<{ name: string | null; username: string | null }>(t.user);
      const project = one<{ name: string | null }>(t.project);
      return {
        id: t.id,
        userName: user?.name ?? user?.username ?? null,
        projectName: project?.name ?? null,
        amount: t.amount,
        type: t.type,
        status: t.status,
        createdAt: t.created_at,
      };
    }),
    topEarners: (balances ?? [])
      .filter((b) => b.lifetime_earned > 0)
      .map((b) => {
        const user = one<{ name: string | null; username: string | null }>(b.user);
        return {
          userId: b.user_id,
          name: user?.name ?? null,
          username: user?.username ?? null,
          lifetimeEarned: b.lifetime_earned,
        };
      }),
  };
});

/**
 * Every referral reward tier a user has earned but the TropicalTalent team has not yet
 * delivered — the thing there was previously no way to see at all. Tiers are
 * perks handed out by hand (an audit, an intro, a fee waiver), not something
 * the app grants automatically, so "earned" and "delivered" are genuinely two
 * different states and this is the gap between them.
 *
 * Computed rather than stored: confirmed referral counts per user, run
 * through the same REFERRAL_TIERS ladder the profile page's ReferralPanel
 * uses, minus whatever's already in tropical_referral_reward_fulfillments.
 * Someone with 12 referrals owes three separate rewards (tiers 1, 2 and 3),
 * each fulfilled independently — the loop below expands that correctly.
 */
/**
 * The user ids that belong to one tenant, or null for the unscoped view.
 *
 * The referral tables carry a user id and no tenant column — a referral is
 * between two people, not inside a workspace — so scoping them means resolving
 * membership first. One query per request, and skipped entirely when tenantId
 * is null.
 */
async function tenantMemberIds(tenantId: string | null): Promise<Set<string> | null> {
  if (!tenantId) return null;
  const { data } = await adminDb()
    .from('tropical_tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');

  return new Set((data ?? []).map((m) => m.user_id as string));
}

export const loadReferralRewards = cache(async (): Promise<AdminReferralRewardRow[]> => {
  // Scoped like every other console loader: the HOST decides whose referrals
  // these are. This used to be unscoped, so a super admin standing on
  // acme.tropicaltalent.dev/admin/referrals was shown classic TropicalTalent's referrers — other
  // people's names and email addresses, on a customer's own domain.
  //
  // Still requireAdminScope() rather than requireAdminViewer(): a white-label
  // that has switched referrals on runs its own scheme and its admin should see
  // it. The page itself is only offered to them when the feature is on.
  const { tenantId } = await requireAdminScope();
  const supabase = adminDb();

  const [{ data: referrals }, { data: fulfillments }, memberIds] = await Promise.all([
    supabase.from('tropical_referrals').select('referrer_id').eq('status', 'confirmed'),
    supabase.from('tropical_referral_reward_fulfillments').select('user_id, tier'),
    tenantMemberIds(tenantId),
  ]);

  const counts = new Map<string, number>();
  for (const r of referrals ?? []) {
    // The referrer has to be one of this tenant's people. Filtering on the
    // referrer rather than the referred is deliberate: the reward is owed to
    // whoever did the referring, so they are the row's owner.
    if (memberIds && !memberIds.has(r.referrer_id)) continue;
    counts.set(r.referrer_id, (counts.get(r.referrer_id) ?? 0) + 1);
  }

  const fulfilled = new Set((fulfillments ?? []).map((f) => `${f.user_id}:${f.tier}`));

  const owed: Array<{ userId: string; tier: number; count: number }> = [];
  for (const [userId, count] of counts) {
    for (const t of REFERRAL_TIERS) {
      if (count >= t.threshold && !fulfilled.has(`${userId}:${t.tier}`)) {
        owed.push({ userId, tier: t.tier, count });
      }
    }
  }

  if (owed.length === 0) return [];

  const [{ data: users }, { data: authUsers }] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, username, role')
      .in('id', [...new Set(owed.map((o) => o.userId))]),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]));

  return owed
    .map((o) => {
      const u = userById.get(o.userId);
      const audience: ReferralAudience = u?.role === 'brand' ? 'brand' : 'creative';
      const tierInfo = REFERRAL_TIERS.find((t) => t.tier === o.tier);
      return {
        userId: o.userId,
        name: u?.name ?? null,
        username: u?.username ?? null,
        email: emailById.get(o.userId) ?? null,
        role: audience,
        tier: o.tier,
        threshold: tierInfo?.threshold ?? 0,
        rewardTitle: tierInfo?.[audience].title ?? 'Reward',
        referralCount: o.count,
      };
    })
    .sort((a, b) => b.tier - a.tier || b.referralCount - a.referralCount);
});

/** Recently delivered rewards — the audit trail for the list above. */
export const loadFulfilledReferralRewards = cache(
  async (): Promise<AdminFulfilledReferralRewardRow[]> => {
    // Same scope as the owed list above — an audit trail that showed rows the
    // list itself excludes would be worse than no audit trail.
    const { tenantId } = await requireAdminScope();
    const supabase = adminDb();

    const [{ data }, memberIds] = await Promise.all([
      supabase
        .from('tropical_referral_reward_fulfillments')
        .select(
          `
        user_id, tier, fulfilled_at, note,
        user:users!tropical_referral_reward_fulfillments_user_id_fkey(name, username, role),
        fulfilled_by_user:users!tropical_referral_reward_fulfillments_fulfilled_by_fkey(name, username)
      `,
        )
        .order('fulfilled_at', { ascending: false })
        .limit(100),
      tenantMemberIds(tenantId),
    ]);

    return (data ?? [])
      .filter((f) => !memberIds || memberIds.has(f.user_id as string))
      .map((f) => {
        const user = one<{ name: string | null; username: string | null; role: string | null }>(
          f.user,
        );
        const fulfilledByUser = one<{ name: string | null; username: string | null }>(
          f.fulfilled_by_user,
        );
        const audience: ReferralAudience = user?.role === 'brand' ? 'brand' : 'creative';
        const tierInfo = REFERRAL_TIERS.find((t) => t.tier === f.tier);
        return {
          userId: f.user_id,
          name: user?.name ?? null,
          username: user?.username ?? null,
          tier: f.tier,
          rewardTitle: tierInfo?.[audience].title ?? 'Reward',
          fulfilledAt: f.fulfilled_at,
          fulfilledByName: fulfilledByUser?.name ?? fulfilledByUser?.username ?? null,
          note: f.note,
        };
      });
  },
);

/**
 * The deletion queue.
 *
 * Approving one of these destroys a project and everything that cascades from
 * it, so the row carries what an admin needs to refuse: which project, whose,
 * how much money it represents, and how many people are standing in it. A
 * queue that shows only "Acme wants this gone" invites a reflexive yes.
 *
 * Service role and tenant-scoped through requireAdminScope, exactly like every
 * other loader in this file — a white-label admin sees their own customers'
 * requests and nobody else's.
 */
export const loadDeleteRequests = cache(async (): Promise<AdminDeleteRequest[]> => {
  let tenantId: string | null;
  try {
    ({ tenantId } = await requireAdminScope());
  } catch {
    return [];
  }

  const { data } = await byTenant(
    adminDb()
      .from('tropical_project_delete_requests')
      .select(
        `
      id, project_id, project_name, status, reason, resolution, created_at, resolved_at,
      requester:users!tropical_project_delete_requests_requested_by_fkey(name, username),
      project:tropical_projects(
        name, kind, status, budget, currency,
        members:tropical_project_members(user_id)
      )
    `,
      )
      .order('created_at', { ascending: false })
      .limit(500),
    tenantId,
  );

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const requester = one(row.requester as never) as {
      name?: string | null;
      username?: string | null;
    } | null;
    const project = one(row.project as never) as {
      name: string;
      kind: AdminDeleteRequest['projectKind'];
      status: AdminDeleteRequest['projectStatus'];
      budget: number;
      currency: string;
      members?: Array<{ user_id: string }>;
    } | null;

    return {
      id: row.id as string,
      // Null once approved: the project is gone and the row is the record of
      // it. A LEFT join rather than !inner for that reason — an inner one would
      // hide every request that was actually carried out. Tenant scoping does
      // not depend on the join, because the request carries its own tenant_id.
      projectId: (row.project_id as string | null) ?? null,
      status: row.status as AdminDeleteRequest['status'],
      reason: (row.reason as string | null) ?? null,
      resolution: (row.resolution as string | null) ?? null,
      createdAt: row.created_at as string,
      resolvedAt: (row.resolved_at as string | null) ?? null,
      // The live name while there is one — a snapshot arrived with the
      // request, and the request is the one thing here the brand wrote.
      projectName: project?.name ?? (row.project_name as string),
      projectKind: project?.kind ?? 'pot',
      projectStatus: project?.status ?? 'active',
      budget: project?.budget ?? 0,
      currency: project?.currency ?? 'GBP',
      requestedByName: requester?.name ?? null,
      requestedByUsername: requester?.username ?? null,
      memberCount: project?.members?.length ?? 0,
    };
  });
});
