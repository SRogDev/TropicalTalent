import { describe, expect, test } from 'bun:test';
import { accountHealth, isBroken, type HealthInputs } from './health';

/**
 * The account-health derivation.
 *
 * Worth testing without a DOM because every rule here is a judgement about
 * what NOT to report. The old screen said "incomplete" whenever one boolean
 * was false, and got two whole categories wrong; these cases pin the
 * distinctions that replaced it.
 */

const healthy: HealthInputs = {
  hasMembership: true,
  hasRoleRow: true,
  emailConfirmed: true,
  hasAvatar: true,
};

const creative = { role: 'creative' as const, profileCompleted: true, deletedAt: null };
const brand = { role: 'brand' as const, profileCompleted: true, deletedAt: null };

describe('accountHealth', () => {
  test('a complete account with every row present is healthy', () => {
    expect(accountHealth(creative, healthy)).toEqual([]);
  });

  test('a deleted account is NOT reported as incomplete', () => {
    // The regression this whole module exists for: tropical_delete_account sets
    // profile_completed = false, so the old badge called every closed account
    // an unfinished sign-up and inflated the count by the number of deletions.
    const deleted = { role: 'creative' as const, profileCompleted: false, deletedAt: '2026-01-01' };
    expect(accountHealth(deleted, { ...healthy, hasRoleRow: false, hasAvatar: false })).toEqual([
      'deleted',
    ]);
  });

  test('deleted suppresses every other signal', () => {
    const deleted = { role: 'creative' as const, profileCompleted: true, deletedAt: '2026-01-01' };
    const result = accountHealth(deleted, {
      hasMembership: false,
      hasRoleRow: false,
      emailConfirmed: false,
      hasAvatar: false,
    });
    expect(result).toEqual(['deleted']);
  });

  test('an unfinished wizard is not reported as broken', () => {
    // Someone who abandoned the wizard legitimately has no membership and no
    // role row. Reporting those as faults would drown the real breakage.
    const unfinished = { role: 'creative' as const, profileCompleted: false, deletedAt: null };
    const result = accountHealth(unfinished, {
      hasMembership: false,
      hasRoleRow: false,
      emailConfirmed: true,
      hasAvatar: false,
    });
    expect(result).toEqual(['unfinished']);
    expect(isBroken(result)).toBe(false);
  });

  test('unfinished AND unconfirmed are both reported', () => {
    const unfinished = { role: 'creative' as const, profileCompleted: false, deletedAt: null };
    expect(accountHealth(unfinished, { ...healthy, emailConfirmed: false })).toEqual([
      'unfinished',
      'unconfirmed',
    ]);
  });

  test('complete but no membership is broken', () => {
    // The contradiction that indicates a half-failed write: flagged done, yet
    // missing the rows finishing it should have created.
    const result = accountHealth(creative, { ...healthy, hasMembership: false });
    expect(result).toContain('no_membership');
    expect(isBroken(result)).toBe(true);
  });

  test('complete but no role row is broken', () => {
    const result = accountHealth(creative, { ...healthy, hasRoleRow: false });
    expect(result).toContain('no_role_row');
    expect(isBroken(result)).toBe(true);
  });

  test('a creative with no avatar is flagged', () => {
    expect(accountHealth(creative, { ...healthy, hasAvatar: false })).toEqual(['no_avatar']);
  });

  test('a BRAND with no avatar is NOT flagged', () => {
    // Neither wizard offers brands a photo step, so flagging them would report
    // a deliberate product decision as a fault on every brand in the database.
    expect(accountHealth(brand, { ...healthy, hasAvatar: false })).toEqual([]);
  });

  test('reasons come back most severe first', () => {
    const result = accountHealth(creative, {
      hasMembership: false,
      hasRoleRow: false,
      emailConfirmed: false,
      hasAvatar: false,
    });
    expect(result).toEqual(['no_membership', 'no_role_row', 'unconfirmed', 'no_avatar']);
  });

  test('no_profile_row counts as broken', () => {
    expect(isBroken(['no_profile_row'])).toBe(true);
  });
});
