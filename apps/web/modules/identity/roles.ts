/**
 * The Cubora role model (Phase 1).
 *
 * One account, two roles — consumer and provider — as capabilities, not
 * identity. The capabilities already exist on the tenant membership row
 * (`tropical_tenant_members.capabilities`: `brand` and `work`); this module
 * is the pure mapping between those stored flags and the Cubora vocabulary,
 * so the rule "one account can be both" has exactly one definition.
 *
 * Mapping (inherited, not invented):
 *   consumer = may buy / hire / request   ← capability `brand`
 *   provider = may offer talent, services, products ← capability `work`
 *
 * The onboarding question "what do you want to do first?" picks the role
 * the sign-up form records; `activateRole` is what the profile's
 * "activate the other role" action applies to the membership row. No new
 * database column: activation only ever ADDS a capability, never removes
 * one, so it cannot lock an account out of a side it already had.
 */

export type CuboraRole = 'consumer' | 'provider';

/** The two capability flags, as `modules/identity/types.ts` names them. */
export interface RoleCapabilities {
  canBrand: boolean;
  isCreative: boolean;
}

export const CUBORA_ROLES: CuboraRole[] = ['consumer', 'provider'];

export function roleLabel(role: CuboraRole): string {
  return role === 'consumer' ? 'Consumer' : 'Provider';
}

/** The roles an account currently holds, in a stable order. */
export function cuboraRolesFor(capabilities: RoleCapabilities): CuboraRole[] {
  const roles: CuboraRole[] = [];
  if (capabilities.canBrand) roles.push('consumer');
  if (capabilities.isCreative) roles.push('provider');
  return roles;
}

/** Where a role's work starts: the consumer's projects, the provider's briefs. */
export function roleHome(role: CuboraRole): string {
  return role === 'consumer' ? '/projects' : '/briefs';
}

/**
 * The capabilities after activating a role.
 *
 * Pure and additive: activating a role that is already held returns the
 * input unchanged, and activating from nothing grants only that role.
 */
export function activateRole(capabilities: RoleCapabilities, role: CuboraRole): RoleCapabilities {
  if (role === 'consumer') return { ...capabilities, canBrand: true };
  return { ...capabilities, isCreative: true };
}
