import { describe, expect, test } from 'bun:test';
import { arrangeUsers, opensAscending, sortValue } from './user-table';
import type { AdminUserRow } from './types';

/**
 * The accounts table's ordering rules.
 *
 * Worth testing without a DOM because the fiddly parts are all data: where
 * missing values land, how mixed types compare, and which way each column
 * opens. `bun test` is already wired up in package.json.
 */

const user = (overrides: Partial<AdminUserRow> = {}): AdminUserRow => ({
  id: crypto.randomUUID(),
  name: 'Ada Vale',
  username: 'ada',
  email: 'ada@example.com',
  role: 'creative',
  createdAt: '2026-01-01T00:00:00Z',
  lastSignInAt: '2026-06-01T00:00:00Z',
  profileCompleted: true,
  health: [],
  verification: null,
  jobsDone: 3,
  totalRevenue: 5000,
  deletedAt: null,
  ...overrides,
});

const names = (rows: AdminUserRow[]) => rows.map((r) => r.name ?? r.username ?? 'Unnamed');

describe('sortValue', () => {
  test('falls back to the handle when there is no display name', () => {
    expect(sortValue(user({ name: null, username: 'Zed' }), 'name')).toBe('zed');
  });

  test('an account with neither name nor handle has no value to sort on', () => {
    expect(sortValue(user({ name: null, username: null }), 'name')).toBeNull();
  });

  test('dates compare as numbers, not strings', () => {
    const early = sortValue(user({ createdAt: '2026-01-02T00:00:00Z' }), 'createdAt');
    const late = sortValue(user({ createdAt: '2026-11-01T00:00:00Z' }), 'createdAt');
    expect(typeof early).toBe('number');
    expect(Number(late)).toBeGreaterThan(Number(early));
  });

  test('never signed in reads as no value rather than the epoch', () => {
    expect(sortValue(user({ lastSignInAt: null }), 'lastSignInAt')).toBeNull();
  });
});

describe('opensAscending', () => {
  test('text opens A to Z', () => {
    expect(opensAscending('name')).toBe(true);
    expect(opensAscending('email')).toBe(true);
  });

  test('counts, money and dates open biggest or newest first', () => {
    expect(opensAscending('totalRevenue')).toBe(false);
    expect(opensAscending('jobsDone')).toBe(false);
    expect(opensAscending('createdAt')).toBe(false);
  });
});

describe('arrangeUsers', () => {
  const base = { query: '', role: 'all' as const, sortKey: 'name' as const, ascending: true };

  test('sorts text alphabetically', () => {
    const rows = arrangeUsers(
      [user({ name: 'Zoe' }), user({ name: 'Ada' }), user({ name: 'Mia' })],
      base,
    );
    expect(names(rows)).toEqual(['Ada', 'Mia', 'Zoe']);
  });

  test('reverses on descending', () => {
    const rows = arrangeUsers([user({ name: 'Zoe' }), user({ name: 'Ada' })], {
      ...base,
      ascending: false,
    });
    expect(names(rows)).toEqual(['Zoe', 'Ada']);
  });

  test('missing values sink to the bottom ascending AND descending', () => {
    const input = [
      user({ name: 'No revenue', totalRevenue: null }),
      user({ name: 'Small', totalRevenue: 100 }),
      user({ name: 'Big', totalRevenue: 90_000 }),
    ];

    const asc = arrangeUsers(input, { ...base, sortKey: 'totalRevenue', ascending: true });
    expect(names(asc)).toEqual(['Small', 'Big', 'No revenue']);

    const desc = arrangeUsers(input, { ...base, sortKey: 'totalRevenue', ascending: false });
    expect(names(desc)).toEqual(['Big', 'Small', 'No revenue']);
  });

  test('money sorts numerically, not as text', () => {
    // 9 > 10 as strings; the whole point of the numeric branch.
    const rows = arrangeUsers(
      [user({ name: 'Ten', totalRevenue: 1000 }), user({ name: 'Nine', totalRevenue: 900 })],
      { ...base, sortKey: 'totalRevenue', ascending: true },
    );
    expect(names(rows)).toEqual(['Nine', 'Ten']);
  });

  test('filters by role', () => {
    const rows = arrangeUsers(
      [user({ name: 'A', role: 'creative' }), user({ name: 'B', role: 'brand' })],
      { ...base, role: 'brand' },
    );
    expect(names(rows)).toEqual(['B']);
  });

  test('search matches name, handle or email, case-insensitively', () => {
    const input = [
      user({ name: 'Ada Vale', username: 'ada', email: 'ada@example.com' }),
      user({ name: 'Ren Okafor', username: 'ren', email: 'ren@studio.io' }),
    ];
    expect(names(arrangeUsers(input, { ...base, query: 'OKAF' }))).toEqual(['Ren Okafor']);
    expect(names(arrangeUsers(input, { ...base, query: 'studio.io' }))).toEqual(['Ren Okafor']);
    expect(names(arrangeUsers(input, { ...base, query: 'ada' }))).toEqual(['Ada Vale']);
  });

  test('a search matching nothing returns nothing rather than everything', () => {
    expect(arrangeUsers([user()], { ...base, query: 'zzzz' })).toHaveLength(0);
  });

  test('does not mutate the array it was given', () => {
    const input = [user({ name: 'Zoe' }), user({ name: 'Ada' })];
    const before = names(input);
    arrangeUsers(input, base);
    expect(names(input)).toEqual(before);
  });
});
