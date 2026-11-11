import type { AdminUserRow } from './types';

/**
 * Sorting and filtering for the accounts table.
 *
 * Pure, and deliberately not inside the client component that uses it. The
 * ordering rules here are the fiddly part — null handling, mixed types, which
 * direction a column opens in — and keeping them out of the JSX is what makes
 * them testable without a DOM.
 *
 * This is presentation logic, not a query: see AdminUsersTable for why the
 * accounts table sorts in the browser rather than in Postgres.
 */

export type SortKey =
  | 'name'
  | 'email'
  | 'role'
  | 'jobsDone'
  | 'totalRevenue'
  | 'createdAt'
  | 'lastSignInAt';

export type RoleFilter = 'all' | 'creative' | 'brand' | 'admin';

/** The value a column sorts on. Null means "no value" and always sinks. */
export function sortValue(u: AdminUserRow, key: SortKey): string | number | null {
  switch (key) {
    case 'name':
      return (u.name ?? u.username ?? '').toLowerCase() || null;
    case 'email':
      return u.email?.toLowerCase() ?? null;
    case 'role':
      return u.role;
    case 'jobsDone':
      return u.jobsDone;
    case 'totalRevenue':
      return u.totalRevenue;
    case 'createdAt':
      return u.createdAt ? Date.parse(u.createdAt) : null;
    case 'lastSignInAt':
      return u.lastSignInAt ? Date.parse(u.lastSignInAt) : null;
  }
}

/**
 * Which direction a column should open in when first clicked.
 *
 * Text reads best A–Z. Counts, money and dates are almost always asked for
 * biggest-or-newest first — "who earned the most", "who joined recently" —
 * so those open descending and save everyone a second click.
 */
export function opensAscending(key: SortKey): boolean {
  return key === 'name' || key === 'email' || key === 'role';
}

export function matchesFilters(u: AdminUserRow, term: string, role: RoleFilter): boolean {
  if (role !== 'all' && u.role !== role) return false;
  if (!term) return true;
  return [u.name, u.username, u.email].some((v) => v?.toLowerCase().includes(term));
}

/**
 * Filtered and sorted, as one pass.
 *
 * Sorts a copy: the input is React state owned by the caller, and sorting in
 * place would mutate it and make the result depend on render order.
 */
export function arrangeUsers(
  users: AdminUserRow[],
  {
    query,
    role,
    sortKey,
    ascending,
  }: {
    query: string;
    role: RoleFilter;
    sortKey: SortKey;
    ascending: boolean;
  },
): AdminUserRow[] {
  const term = query.trim().toLowerCase();

  return [...users.filter((u) => matchesFilters(u, term, role))].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);

    // Missing values sink to the bottom in BOTH directions. An account with no
    // revenue is not "the smallest revenue" — it has none, and floating those
    // to the top of a descending sort buries exactly what was asked for.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;

    const order =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));

    return ascending ? order : -order;
  });
}
