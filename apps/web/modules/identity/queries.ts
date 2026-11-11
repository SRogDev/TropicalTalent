import 'server-only';

import { cache } from 'react';
import { adminDb, db } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { getTenant } from '@/modules/tenancy/queries';
import type { TenantCapabilities, TenantMemberRole } from '@/modules/tenancy/types';
import type { CreativeProfile, UserRole, Viewer } from './types';

/**
 * Identity reads.
 *
 * `getViewer()` is the single entry point for "who is asking". It is called by
 * the app-shell layout and by most pages; React.cache collapses all of those
 * into one auth check and one profile query per request.
 */

/**
 * The signed-in user, with the profile fields the UI branches on.
 *
 * Returns null when signed out. auth.getUser() validates the token against
 * Supabase — the middleware's local cookie decode is for routing only and is
 * deliberately not trusted here.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await db();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // The profile read and the host->tenant lookup are independent, so they run
  // concurrently rather than in sequence. Tenancy therefore costs no added
  // latency: the memberships ride along as an embed on the users query that
  // already ran, and the tenant lookup overlaps it.
  const [{ data: profile }, tenant] = await Promise.all([
    supabase
      .from('users')
      // One string literal, not a concatenation: supabase-js infers the row
      // type from the select's literal type, and a `+` expression collapses it
      // to GenericStringError and loses every field.
      .select(
        `id, username, name, avatar, role, profile_completed,
         memberships:tropical_tenant_members(tenant_id, role, capabilities, status)`,
      )
      .eq('id', user.id)
      .maybeSingle(),
    getTenant(),
  ]);

  // The live users_role_check allows 'talent' | 'brand' | 'admin'. A row
  // that predates the organiser->brand rename would fail that constraint, so
  // anything unrecognised falls back to talent (the least-privileged view).
  const role: UserRole =
    profile?.role === 'brand' || profile?.role === 'admin' ? profile.role : 'creative';

  // users.role = 'admin' is the TropicalTalent super admin. There is no sign-up path to
  // it — rows are promoted by hand — and it is deliberately NOT a per-tenant
  // concept: a super admin is an implicit wl_admin of every tenant, which is
  // what lets support sign in to any branded site to reproduce a bug without
  // holding a separate account per customer. tropical_is_tenant_admin() in
  // migration 024 encodes the same rule on the database side.
  const isSuperAdmin = role === 'admin';

  const membership = findMembership(profile?.memberships, tenant.id);

  // Capabilities come from the membership, replacing what used to be a
  // hardcoded `canBrand: true` for every account on the planet. The classic
  // tenant's backfill (023) grants {brand:true, work:role!=='brand'} to every
  // existing user, so classic behaviour is byte-identical to before.
  //
  // A super admin with no row still gets both, or they could not inspect the
  // tenant they just signed in to.
  const capabilities =
    membership?.capabilities ?? (isSuperAdmin ? { brand: true, work: true } : null);

  return {
    id: user.id,
    email: user.email ?? null,
    username: profile?.username ?? null,
    name: profile?.name ?? null,
    avatar: profile?.avatar ?? null,
    role,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantRole: membership?.role ?? (isSuperAdmin ? 'wl_admin' : null),
    isSuperAdmin,
    isTenantAdmin: isSuperAdmin || membership?.role === 'wl_admin',
    // False means "signed in, but not on this site". The (app) layout turns
    // that into /auth/no-access rather than rendering an empty shell — see the
    // comment there for why it is not a silent pass.
    belongsToTenant: Boolean(membership) || isSuperAdmin,
    canBrand: capabilities?.brand === true,
    // Brands do not work: they stay out of /briefs, /jobs, and — because
    // loadTalent filters on users.role — out of Talent search.
    isCreative: capabilities?.work === true,
    profileCompleted: Boolean(profile?.profile_completed),
  };
});

interface MembershipRow {
  tenant_id: string;
  role: string;
  capabilities: unknown;
  status: string;
}

/** The caller's active membership of one tenant, out of the embedded list. */
function findMembership(
  rows: unknown,
  tenantId: string,
): { role: TenantMemberRole; capabilities: TenantCapabilities } | null {
  if (!Array.isArray(rows)) return null;

  const row = (rows as MembershipRow[]).find(
    (m) => m?.tenant_id === tenantId && m?.status === 'active',
  );
  if (!row) return null;

  const caps = row.capabilities;
  const shape = caps && typeof caps === 'object' ? (caps as Record<string, unknown>) : {};

  return {
    role: row.role === 'wl_admin' ? 'wl_admin' : 'member',
    // Absent reads as false. A membership written before a capability existed
    // must not silently acquire it.
    capabilities: { brand: shape.brand === true, work: shape.work === true },
  };
}

/** Throws-free assertion helper for pages that already redirect on null. */
export const requireViewer = cache(async (): Promise<Viewer> => {
  const viewer = await getViewer();
  if (!viewer) throw new Error('not authenticated');
  return viewer;
});

/**
 * A full talent/brand profile, by username or id.
 *
 * Four independent reads under one Promise.all. The previous implementation
 * chained them, which cost four sequential round trips to render one page.
 */
export const getProfile = cache(async (handle: string): Promise<CreativeProfile | null> => {
  const supabase = await db();

  // handle may be a username or a uuid — one query covers both rather than
  // probing for a uuid shape and branching.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handle);

  const { data: user } = await supabase
    .from('users')
    .select('id, username, name, avatar, bio, role, location')
    .eq(isUuid ? 'id' : 'username', handle)
    .maybeSingle();

  if (!user) return null;

  const [{ data: creative }, { data: stats }, { data: disciplines }, { data: location }] =
    await Promise.all([
      supabase
        .from('creative_data')
        .select('tags, passion, backstory, video, verification')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('user_stats')
        .select('jobs_done, total_revenue')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('tropical_creative_disciplines')
        .select('discipline_slug, is_primary, tropical_disciplines(label)')
        .eq('user_id', user.id),
      user.location
        ? supabase
            .from('locations')
            .select('city, county, country')
            .eq('id', user.location)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const loc = location as { city?: string; county?: string; country?: string } | null;

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar: user.avatar,
    bio: user.bio,
    role: (user.role as UserRole) ?? 'creative',
    locationDisplay: loc ? [loc.city, loc.county, loc.country].filter(Boolean).join(', ') : null,
    passion: creative?.passion ?? null,
    tags: normaliseTags(creative?.tags),
    showreelUrl: creative?.video ?? null,
    backstoryUrl: creative?.backstory ?? null,
    verification: creative?.verification ?? null,
    disciplines: (disciplines ?? []).map((d) => ({
      slug: d.discipline_slug as string,
      label: (one<{ label: string }>(d.tropical_disciplines as never)?.label ??
        d.discipline_slug) as string,
      is_primary: Boolean(d.is_primary),
    })),
    stats: {
      jobsDone: stats?.jobs_done ?? 0,
      totalRevenue: stats?.total_revenue ?? 0,
    },
  };
});

/**
 * Profile refs for a set of ids, in one query.
 *
 * Message threads and applicant lists both need "resolve these N users". Doing
 * it per row is the classic N+1; this is the only sanctioned way to do it.
 */
export const getProfileRefs = cache(async (idsKey: string) => {
  const ids = idsKey.split(',').filter(Boolean);
  if (ids.length === 0) return {} as Record<string, ProfileRefRow>;

  const supabase = await db();
  const { data } = await supabase.from('users').select('id, username, name, avatar').in('id', ids);

  return Object.fromEntries((data ?? []).map((p) => [p.id, p as ProfileRefRow]));
});

export interface ProfileRefRow {
  id: string;
  username: string | null;
  name: string | null;
  avatar: string | null;
}

/** Stable React.cache key for getProfileRefs — an array literal would never hit. */
export function profileRefsKey(ids: Array<string | null | undefined>): string {
  return Array.from(new Set(ids.filter(Boolean) as string[]))
    .sort()
    .join(',');
}

/** creative_data.tags is jsonb and has historically held both shapes. */
function normaliseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * An unclaimed invite for the signed-in viewer, on the site they are looking at.
 *
 * Answers the one question /auth/no-access could not: "am I supposed to be
 * here?" Before this, an invite was only ever redeemable during sign-up
 * (writeProfile is its single caller), so someone who already had a TropicalTalent
 * account — the common case for a contractor a client also uses elsewhere —
 * had no path to their invite at all. Signing up again is not that path: the
 * address is taken, so it is refused.
 *
 * adminDb() deliberately. RLS on tropical_tenant_invites restricts SELECT to the
 * tenant's own admins, because a roster of 600 addresses is the customer's
 * commercial information — and the viewer here is by definition not a member,
 * let alone an admin. The service role is scoped to a single row by tenant AND
 * the viewer's own verified address, so all it can ever reveal is whether YOUR
 * address was invited to the site you are already on. That leaks nothing about
 * the roster and nothing about other tenants.
 *
 * Returns null for an already-claimed invite: claimed means a membership was
 * granted, so a viewer still seeing no-access with one has a different problem
 * and must not be offered a button that cannot help.
 */
export const pendingTenantInvite = cache(async (): Promise<PendingTenantInvite | null> => {
  const viewer = await getViewer();
  if (!viewer?.email || viewer.belongsToTenant) return null;

  const { data } = await adminDb()
    .from('tropical_tenant_invites')
    .select('member_role, capabilities, claimed_at')
    .eq('tenant_id', viewer.tenantId)
    .eq('email', viewer.email.trim().toLowerCase())
    .maybeSingle();

  if (!data || data.claimed_at) return null;

  return {
    memberRole: data.member_role === 'wl_admin' ? 'wl_admin' : 'member',
    capabilities: {
      brand: (data.capabilities as Record<string, unknown>)?.brand === true,
      work: (data.capabilities as Record<string, unknown>)?.work === true,
    },
  };
});

export interface PendingTenantInvite {
  memberRole: TenantMemberRole;
  capabilities: TenantCapabilities;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export interface MyWorkspace {
  tenantId: string;
  name: string;
  slug: string;
  isClassic: boolean;
  /** True for the site this request is being served on. */
  isCurrent: boolean;
  /** Whether this workspace has admins other than TropicalTalent's own operators. */
  hasOwnAdmins: boolean;
  joinedAt: string | null;
}

/**
 * Every branded site this account belongs to.
 *
 * Exists because two things were true and neither was ever said out loud:
 *
 *   * a workspace's own admins can read their members' email address, last
 *     sign-in, total earnings and the full text of any complaint they raise —
 *     and if those members are a client's contractors, that is their employer;
 *   * signing up on a white-label whose visibility is 'public' ALSO enrols the
 *     account into classic TropicalTalent, putting the profile on the TropicalTalent talent
 *     board. That decision belongs to the customer who configured the
 *     workspace, but the consequence lands on the person.
 *
 * Neither is wrong. Both are undisclosed, which is the problem. This is the
 * read behind the panel that discloses them.
 *
 * `hasOwnAdmins` drives the wording rather than isClassic: what matters to the
 * person reading it is whether some other organisation's staff can see their
 * row, not which archetype the tenant was seeded from.
 */
export const loadMyWorkspaces = cache(async (): Promise<MyWorkspace[]> => {
  const viewer = await getViewer();
  if (!viewer) return [];

  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_tenant_members')
    .select('tenant_id, created_at, tenant:tropical_tenants!inner(id, name, slug, is_classic)')
    .eq('user_id', viewer.id)
    .eq('status', 'active');

  if (error || !data) return [];

  const rows = data.map((row) => {
    const tenant = one<{ id: string; name: string; slug: string; is_classic: boolean }>(
      row.tenant as never,
    );
    return {
      tenantId: row.tenant_id as string,
      name: tenant?.name ?? 'Unknown workspace',
      slug: tenant?.slug ?? '',
      isClassic: Boolean(tenant?.is_classic),
      isCurrent: row.tenant_id === viewer.tenantId,
      hasOwnAdmins: false,
      joinedAt: (row.created_at as string) ?? null,
    };
  });

  // Which of these actually have a wl_admin. Through the service role: a
  // member cannot enumerate other members' roles under RLS, and the honest
  // answer to "can anyone here see my earnings" needs that count.
  //
  // A failure means we cannot tell, and the safe answer to a disclosure
  // question is the one that discloses — so it falls back to true for every
  // non-classic workspace rather than quietly claiming nobody is watching.
  const ids = rows.map((r) => r.tenantId);
  if (ids.length > 0) {
    const { data: admins, error: adminError } = await adminDb()
      .from('tropical_tenant_members')
      .select('tenant_id')
      .in('tenant_id', ids)
      .eq('role', 'wl_admin')
      .eq('status', 'active');

    const withAdmins = new Set((admins ?? []).map((a) => a.tenant_id as string));
    for (const row of rows) {
      row.hasOwnAdmins = adminError ? !row.isClassic : withAdmins.has(row.tenantId);
    }
  }

  // The one they are standing on first, then classic, then by name — so the
  // list opens on the workspace the page they are reading belongs to.
  return rows.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.isClassic !== b.isClassic) return a.isClassic ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
});
