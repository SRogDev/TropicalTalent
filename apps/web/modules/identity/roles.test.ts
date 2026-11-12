import { describe, expect, test } from 'bun:test';
import {
  activateRole,
  cuboraRolesFor,
  roleHome,
  roleLabel,
  type CuboraRole,
  type RoleCapabilities,
} from './roles';

/**
 * Cubora role model (Phase 1): one account, two roles.
 *
 * The roles are capabilities, not identity: `consumer` (buy / hire — the
 * inherited `brand` capability) and `provider` (offer talent, services,
 * products — the inherited `work` capability). An account holds either or
 * both, picks what to do first at onboarding, and activates the other later.
 * No new database column: the capabilities already live on the tenant
 * membership row; this module is the pure mapping over them.
 */

const both: RoleCapabilities = { canBrand: true, isCreative: true };
const consumerOnly: RoleCapabilities = { canBrand: true, isCreative: false };
const providerOnly: RoleCapabilities = { canBrand: false, isCreative: true };
const neither: RoleCapabilities = { canBrand: false, isCreative: false };

describe('cuboraRolesFor', () => {
  test('both capabilities means both Cubora roles', () => {
    expect(cuboraRolesFor(both)).toEqual(['consumer', 'provider']);
  });

  test('brand capability alone means consumer only', () => {
    expect(cuboraRolesFor(consumerOnly)).toEqual(['consumer']);
  });

  test('work capability alone means provider only', () => {
    expect(cuboraRolesFor(providerOnly)).toEqual(['provider']);
  });

  test('no capability means no role', () => {
    expect(cuboraRolesFor(neither)).toEqual([]);
  });
});

describe('roleLabel', () => {
  test('consumer and provider have distinct labels', () => {
    expect(roleLabel('consumer')).toBe('Consumer');
    expect(roleLabel('provider')).toBe('Provider');
  });
});

describe('roleHome', () => {
  test('consumer lands on projects, provider on briefs', () => {
    expect(roleHome('consumer')).toBe('/projects');
    expect(roleHome('provider')).toBe('/briefs');
  });
});

describe('activateRole', () => {
  test('activating the missing role adds only that capability', () => {
    expect(activateRole(consumerOnly, 'provider')).toEqual({
      canBrand: true,
      isCreative: true,
    });
    expect(activateRole(providerOnly, 'consumer')).toEqual({
      canBrand: true,
      isCreative: true,
    });
  });

  test('activating a role already held is a no-op', () => {
    expect(activateRole(both, 'consumer')).toEqual(both);
    expect(activateRole(both, 'provider')).toEqual(both);
  });

  test('activating from nothing grants only the requested role', () => {
    expect(activateRole(neither, 'provider')).toEqual({
      canBrand: false,
      isCreative: true,
    });
  });
});

describe('role round-trip', () => {
  test('every role maps to a capability and back', () => {
    const roles: CuboraRole[] = ['consumer', 'provider'];
    for (const role of roles) {
      expect(cuboraRolesFor(activateRole(neither, role))).toEqual([role]);
    }
  });
});
