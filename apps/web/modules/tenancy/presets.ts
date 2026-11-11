import { hasFeature } from './types';
import type { Tenant, TenantArchetype, TenantCapabilities, TenantFeatures } from './types';

/**
 * Archetype presets — what the super-admin console fills the form with.
 *
 * This is the thing that makes onboarding a white-label a form rather than a
 * sprint: the two shapes we sell differ only in which flags are on and which
 * capabilities a new member gets, so neither needs any bespoke code.
 *
 * Presets SEED a tenant; they are not consulted again. Once a tenant row
 * exists, its own `features` and each membership's own `capabilities` are the
 * truth, so a tenant can drift from its archetype without becoming a special
 * case.
 */

/**
 * What this tenant calls the two sides, in running prose.
 *
 * Separate from `signup.label` because that one is a heading on a card ("I'm a
 * Contractor") and these go inside sentences ("posted so contractors can apply
 * to them"). Declared rather than derived: pluralising by rule turns "company"
 * into "companys", and the point of this type is that a customer never sees a
 * word from the wrong industry.
 */
export interface TenantNouns {
  worker: { one: string; many: string };
  payer: { one: string; many: string };
}

export interface ArchetypePreset {
  label: string;
  description: string;
  features: TenantFeatures;
  nouns: TenantNouns;
  /** Capabilities for each kind of account this tenant's sign-up can produce. */
  signup: {
    worker: { label: string; capabilities: TenantCapabilities };
    payer: { label: string; capabilities: TenantCapabilities };
  };
}

const WORK_ONLY: TenantCapabilities = { brand: false, work: true };
const BRAND_ONLY: TenantCapabilities = { brand: true, work: false };
const BOTH: TenantCapabilities = { brand: true, work: true };

export const ARCHETYPE_PRESETS: Record<TenantArchetype, ArchetypePreset> = {
  /**
   * The payroll shape. Contractors are assigned work and paid; they never see
   * a brief feed and never see each other. This is the "cannot see public
   * projects or other talent" requirement, expressed entirely as flags.
   */
  contractors_brands: {
    label: 'Contractors + companies',
    description:
      'Contractors are invited, sign a contract and get paid. Companies hire from this roster only. No public brief feed.',
    features: {
      publicBriefs: false,
      applications: false,
      talentBrowse: true,
      recurring: true,
      selfServeBrands: true,
      referrals: false,
      waitlist: false,
    },
    nouns: {
      worker: { one: 'contractor', many: 'contractors' },
      payer: { one: 'company', many: 'companies' },
    },
    signup: {
      worker: { label: 'Contractor', capabilities: WORK_ONLY },
      payer: { label: 'Company', capabilities: BRAND_ONLY },
    },
  },

  /**
   * The agency/marketplace shape. Adds an internal brief feed — talent can
   * apply to work posted inside their own tenant, not just wait to be invited.
   */
  creatives_brands: {
    label: 'Talent + brands',
    description:
      'A marketplace scoped to one roster: brands post briefs, the agency’s talent applies, and everything stays inside the tenant.',
    features: {
      publicBriefs: true,
      applications: true,
      talentBrowse: true,
      recurring: true,
      selfServeBrands: true,
      referrals: false,
      waitlist: false,
    },
    nouns: {
      worker: { one: 'talent', many: 'talent' },
      payer: { one: 'brand', many: 'brands' },
    },
    signup: {
      worker: { label: 'Talent', capabilities: WORK_ONLY },
      payer: { label: 'Brand', capabilities: BRAND_ONLY },
    },
  },

  /**
   * TropicalTalent itself. Everything on, and every account gets both capabilities —
   * which is what `canBrand: true` hardcoded before tenancy existed.
   */
  classic: {
    label: 'Classic TropicalTalent',
    description: 'The public platform. Every account may both hire and work.',
    features: {
      publicBriefs: true,
      applications: true,
      talentBrowse: true,
      recurring: true,
      selfServeBrands: true,
      referrals: true,
      waitlist: true,
    },
    nouns: {
      worker: { one: 'talent', many: 'talent' },
      payer: { one: 'brand', many: 'brands' },
    },
    signup: {
      worker: { label: 'Talent', capabilities: BOTH },
      payer: { label: 'Brand', capabilities: { brand: true, work: false } },
    },
  },
};

/**
 * Capabilities for a new member, given their tenant's archetype and which side
 * of the marketplace they signed up as.
 *
 * Used by writeProfile() so sign-up and OAuth completion both land on the same
 * answer without either needing to know what an archetype is.
 */
export function capabilitiesForSignup(
  archetype: TenantArchetype,
  role: 'creative' | 'brand',
): TenantCapabilities {
  const preset = ARCHETYPE_PRESETS[archetype] ?? ARCHETYPE_PRESETS.classic;
  return role === 'brand' ? preset.signup.payer.capabilities : preset.signup.worker.capabilities;
}

/**
 * The nouns to use in copy for a tenant, given its archetype.
 *
 * Falls back to classic's, so a row with an unrecognised archetype reads as
 * TropicalTalent rather than rendering "undefined can apply to them".
 */
export function nounsFor(archetype: TenantArchetype): TenantNouns {
  return (ARCHETYPE_PRESETS[archetype] ?? ARCHETYPE_PRESETS.classic).nouns;
}

/**
 * Does this workspace call the people who do the work contractors?
 *
 * Derived from the archetype's own noun rather than compared against the
 * archetype id, so a fourth archetype that also hires contractors gets the
 * right answer without anyone remembering to update a list here.
 *
 * Used to decide who is offered referrals: a contractor was put on a roster by
 * the company that hired them, so "invite a friend and earn a reward" is a
 * mechanic from a different product. Talent and every payer keep it.
 */
export function workerIsContractor(archetype: TenantArchetype): boolean {
  return nounsFor(archetype).worker.one === 'contractor';
}

/**
 * Who is offered referrals on this tenant, by side of the marketplace.
 *
 * Two independent tests, and the audit of 2026-08-27 found only the second one
 * being applied:
 *
 *   features.referrals   Does this tenant run a referral programme AT ALL?
 *                        Off for both live white-labels. This is the gate that
 *                        was missing — the referral step and the profile panel
 *                        consulted the archetype alone, so a payer account on
 *                        a white-label was still handed a code, and codes are
 *                        global (tropical_referrals has no tenant column, so a
 *                        code earned on a client's site spends on TropicalTalent).
 *
 *   workerIsContractor   Within a tenant that DOES run one, contractors are
 *                        still left out, for the reason above.
 *
 * Absent means off, per hasFeature — a tenant row created before the flag
 * existed must not silently gain a rewards programme.
 */
export function referralAudience(tenant: Tenant): { worker: boolean; payer: boolean } {
  const enabled = hasFeature(tenant, 'referrals');
  return {
    worker: enabled && !workerIsContractor(tenant.archetype),
    payer: enabled,
  };
}
