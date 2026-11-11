export type UserRole = 'creative' | 'brand' | 'admin';

/** The minimum needed to render an avatar and a name. Read constantly. */
export interface ProfileRef {
  id: string;
  username: string | null;
  name: string | null;
  avatar: string | null;
  bio?: string | null;
}

/**
 * The signed-in user plus the fields every surface branches on.
 *
 * `canBrand` and `isCreative` are CAPABILITIES, not identity — they answer
 * "may this account do X", and both are true at once for a talent, who
 * hires as well as works. Do not reintroduce a single `isBrand` flag here:
 * it conflated the two, so opening the brand pages to talent also read as
 * "not a talent" and shut them out of briefs and Talent.
 *
 * Note that a project workspace computes its OWN `isBrand` from
 * `brand_id === viewer.id` (see modules/projects/queries.ts). That one is a
 * per-project relationship and is unrelated to these — a talent is the
 * brand on the projects they own and a talent on the ones they work.
 */
export interface Viewer {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  avatar: string | null;
  role: UserRole;

  /** The branded site this request resolved to. Classic TropicalTalent is one of these. */
  tenantId: string;
  tenantSlug: string;
  /** Standing inside THIS tenant. Null when they are not a member of it. */
  tenantRole: 'member' | 'wl_admin' | null;
  /** users.role === 'admin'. Implicitly a wl_admin of every tenant. */
  isSuperAdmin: boolean;
  /** May open /admin for this tenant: its own wl_admin, or a super admin. */
  isTenantAdmin: boolean;
  /**
   * False = signed in, but has no business on this site. One Supabase identity
   * can hold memberships in several tenants, so being authenticated says
   * nothing about belonging here; the (app) layout turns false into
   * /auth/no-access instead of rendering an empty shell.
   */
  belongsToTenant: boolean;

  /**
   * May create projects, browse Talent, and invite.
   *
   * Was hardcoded true for every account before tenancy. Now read from the
   * membership's capabilities, which is what lets a white-label contractor be
   * earn-only and a payer company be hire-only.
   */
  canBrand: boolean;
  /** May apply to briefs, hold roles, and appear in Talent search. */
  isCreative: boolean;
  profileCompleted: boolean;
}

export interface CreativeProfile {
  id: string;
  username: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  role: UserRole;
  locationDisplay: string | null;
  passion: string | null;
  /** Free-text skills from creative_data.tags. Distinct from disciplines. */
  tags: string[];
  /** Showreel URL — YouTube, Vimeo, or a direct video file. */
  showreelUrl: string | null;
  backstoryUrl: string | null;
  verification: string | null;
  disciplines: Array<{ slug: string; label: string; is_primary: boolean }>;
  stats: { jobsDone: number; totalRevenue: number };
}
