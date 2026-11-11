/**
 * Tenancy domain types.
 *
 * A "tenant" is one branded site. The classic TropicalTalent app is a tenant like any
 * other (`isClassic: true`), which is what keeps the code path singular —
 * nothing anywhere asks "are we in white-label mode?", it just reads the
 * tenant it was given.
 *
 * Client-safe: no server imports here, so components may take these as props.
 */

/**
 * Which shape of white-label this is.
 *
 * Seeds `features` and the capabilities new members receive. It is a starting
 * point recorded for provenance, NOT a mode the app branches on — every
 * surface reads `features` and `capabilities` directly, so a tenant that
 * later wants one thing from the other archetype just toggles that flag.
 */
export type TenantArchetype = 'classic' | 'contractors_brands' | 'creatives_brands';

export type TenantMemberRole = 'member' | 'wl_admin';

/**
 * What a member may do inside one tenant.
 *
 * Replaces the hardcoded `canBrand: true` in modules/identity/queries.ts:53.
 * The two are independent on purpose — a classic TropicalTalent talent has both,
 * a white-label contractor has `work` only, a payer company has `brand` only.
 */
export interface TenantCapabilities {
  /** May commission work: create projects, fund escrow, invite, hire. */
  brand: boolean;
  /** May earn: accept invites, sign contracts, hold roles, get paid. */
  work: boolean;
}

/**
 * Surface toggles.
 *
 * Absent means "off" for anything a white-label should opt into, which is why
 * every reader goes through `hasFeature()` rather than reading the object —
 * a tenant row created before a flag existed must not silently gain it.
 */
export interface TenantFeatures {
  /** The /briefs discovery feed. Off for pure contractor tenants. */
  publicBriefs?: boolean;
  /** The /talent roster. Scoped to the tenant either way. */
  talentBrowse?: boolean;
  /** Talent may apply to briefs rather than only being invited. */
  applications?: boolean;
  referrals?: boolean;
  waitlist?: boolean;
  /** Recurring/retainer roles. */
  recurring?: boolean;
  /** Payer companies may sign themselves up rather than being invited. */
  selfServeBrands?: boolean;
  /**
   * Only pre-authorised emails may sign up.
   *
   * A white-label's sign-in link lives on the client's own public website, so
   * without this anyone who finds it can create an account inside their
   * workspace. Off by default; on for any tenant onboarding a known roster.
   */
  inviteOnly?: boolean;
}

/** Logo, wordmark, sender address, attribution. */
export interface TenantBranding {
  logoUrl?: string;
  wordmark?: string;
  /** Falls back to `Name via TropicalTalent <RESEND_FROM_EMAIL>` until DNS is verified. */
  fromEmail?: string;
  tagline?: string;
  /**
   * "Powered by TropicalTalent" in the sidebar, auth pages and email footer.
   *
   * Defaults ON for every tenant except the classic one, and is editable only
   * by a TropicalTalent super admin — never by a white-label's own admin. That makes it
   * a commercial lever later without a code change.
   */
  poweredBy?: boolean;
}

/** Palette overrides. Validated against a whitelist before ever reaching CSS. */
export interface TenantTheme {
  primary?: string;
  accent?: string;
  /** Two or three stops for the brand gradient. */
  gradient?: string[];
  /** The foreground that sits on the gradient — see --gradient-brand-foreground. */
  gradientForeground?: string;
  /** Named font from the build-time set; next/font cannot load per-request. */
  font?: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  isClassic: boolean;
  status: 'active' | 'suspended';
  archetype: TenantArchetype;
  theme: TenantTheme;
  branding: TenantBranding;
  features: TenantFeatures;
  platformFeePct: number;
  /** Share OF the platform fee owed onward to the partner, not of the pot. */
  partnerSharePct: number;
  /**
   * Whether this tenant's PEOPLE are part of classic TropicalTalent as well.
   *
   * private — they exist only here, and cannot sign in to classic. The default,
   *           and what a customer who onboarded their own workforce expects.
   * public  — they are classic members too, so they appear on TropicalTalent's Talent
   *           board and can work on TropicalTalent projects.
   *
   * Separate from the DATA boundary, which is always enforced: 025's RLS keeps
   * projects, briefs and rosters inside their tenant whatever this says.
   */
  visibility: TenantVisibility;
}

export type TenantVisibility = 'private' | 'public';

/** One person's standing inside one tenant. */
export interface TenantMembership {
  tenantId: string;
  role: TenantMemberRole;
  capabilities: TenantCapabilities;
  status: 'active' | 'suspended';
}

/** Reads a feature flag with an explicit default of off. */
export function hasFeature(tenant: Tenant, key: keyof TenantFeatures): boolean {
  return tenant.features[key] === true;
}

/**
 * Whether attribution renders.
 *
 * Classic never shows it. Everyone else shows it unless a super admin has
 * explicitly turned it off, so a tenant created without the field set still
 * carries it — the safe default is the one that credits TropicalTalent.
 */
export function showsPoweredBy(tenant: Tenant): boolean {
  return !tenant.isClassic && tenant.branding.poweredBy !== false;
}

/**
 * Where an account should land after signing in.
 *
 * Capabilities decide what they may do; the tenant's features decide what
 * exists on this site. Both matter, and getting it wrong is very visible: an
 * admin arriving on a contractor tenant was being sent to /briefs, a feed that
 * tenant has switched off — a page with no nav link, no content, and no
 * explanation.
 *
 * Order is deliberate. Someone who works is shown work first; only an account
 * that cannot work at all is sent to the hiring side.
 */
export function homePath(
  caps: { canBrand: boolean; isCreative: boolean },
  features: TenantFeatures,
): string {
  if (caps.isCreative) {
    if (features.publicBriefs === true) return '/briefs';
    return '/jobs';
  }
  return caps.canBrand ? '/projects' : '/jobs';
}
