'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react';
import { formatPence } from '@/lib/money';
import { cn } from '@/lib/utils';
import { healthLabel, isBroken } from '@/modules/admin/health';
import type { AdminUserRow } from '@/modules/admin/types';
import {
  arrangeUsers,
  opensAscending,
  type RoleFilter,
  type SortKey,
} from '@/modules/admin/user-table';

/**
 * The accounts table, sortable and filterable.
 *
 * Sorting happens in the browser rather than as a query parameter, which is
 * the opposite of what a table this shape usually wants. Two reasons, both
 * specific to this data:
 *
 *   * `email` and `lastSignInAt` do not come from Postgres. loadAdminUsers()
 *     reads them from the Supabase auth directory and stitches them on, so
 *     there is no column to ORDER BY — a server-side sort could offer five of
 *     the seven headings and would have to explain why.
 *   * the page is already capped at 500 rows and loaded in one trip. Sorting
 *     that in memory is instantaneous, and a round trip per header click would
 *     be slower than the thing it replaced.
 *
 * If the cap is ever raised past a few thousand this has to become a server
 * concern, and at that point the auth fields need denormalising into `users`
 * first — the ordering problem above does not go away by moving it.
 */

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
  { key: 'jobsDone', label: 'Jobs done', numeric: true },
  { key: 'totalRevenue', label: 'Revenue', numeric: true },
  { key: 'createdAt', label: 'Joined' },
  { key: 'lastSignInAt', label: 'Last logged in' },
];

const ROLES: RoleFilter[] = ['all', 'creative', 'brand', 'admin'];

export function AdminUsersTable({ users }: { users: AdminUserRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [ascending, setAscending] = useState(false);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setAscending((a) => !a);
      return;
    }
    setSortKey(key);
    setAscending(opensAscending(key));
  }

  const rows = useMemo(
    () => arrangeUsers(users, { query, role, sortKey, ascending }),
    [users, query, role, sortKey, ascending],
  );

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <label className='relative flex-1 sm:max-w-xs'>
          <Search
            size={14}
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2'
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search name, handle or email…'
            aria-label='Search accounts'
            className='bg-sunken border-foreground/10 focus:border-foreground/25 w-full rounded-lg border py-2 pr-3 pl-9 text-sm outline-none'
          />
        </label>

        <div
          className='border-foreground/10 bg-sunken flex items-center rounded-lg border p-0.5'
          role='group'
          aria-label='Filter by role'
        >
          {ROLES.map((r) => (
            <button
              key={r}
              type='button'
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                role === r ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <span className='text-muted-foreground text-xs tabular-nums'>
          {rows.length === users.length
            ? `${users.length} accounts`
            : `${rows.length} of ${users.length}`}
        </span>
      </div>

      <div className='glass overflow-x-auto rounded-2xl'>
        <table className='w-full text-left text-sm'>
          <thead>
            <tr className='text-muted-foreground border-foreground/10 border-b text-[11px] tracking-widest uppercase'>
              {COLUMNS.map((col) => {
                const active = col.key === sortKey;
                const Icon = active ? (ascending ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <th
                    key={col.key}
                    scope='col'
                    className='px-4 py-3 font-medium'
                    // Read out by screen readers as the current sort, which a
                    // coloured arrow alone does not convey.
                    aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type='button'
                      onClick={() => toggle(col.key)}
                      className={`hover:text-foreground flex items-center gap-1.5 tracking-widest uppercase ${
                        active ? 'text-foreground' : ''
                      }`}
                    >
                      {col.label}
                      <Icon size={12} className={active ? '' : 'opacity-40'} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr
                key={u.id}
                className={`border-foreground/5 border-b last:border-0 ${
                  // Dimmed, not hidden. A closed account still has to be
                  // findable: its projects, payouts and any complaint about it
                  // outlive it, and support needs to see the row to explain
                  // them.
                  u.deletedAt ? 'opacity-60' : ''
                }`}
              >
                <td className='px-4 py-3'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{u.name ?? u.username ?? 'Unnamed'}</span>
                    {u.deletedAt && (
                      <span
                        title={`Deleted ${new Date(u.deletedAt).toLocaleDateString()}`}
                        className='text-destructive border-destructive/30 rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase'
                      >
                        Deleted
                      </span>
                    )}
                  </div>
                  {u.username && (
                    <div className='text-muted-foreground text-[11px]'>@{u.username}</div>
                  )}
                </td>
                <td className='text-muted-foreground px-4 py-3'>{u.email ?? '-'}</td>
                <td className='px-4 py-3'>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${
                      u.role === 'admin'
                        ? 'bg-gradient-brand text-on-brand'
                        : 'text-muted-foreground border-foreground/10 border'
                    }`}
                  >
                    {u.role}
                  </span>
                  {/* One badge per reason, not a single "incomplete".
                   *
                   * The old badge fired on !profileCompleted alone, which was
                   * wrong twice over: closing an account sets that flag back
                   * to false (migration 040 anonymises rather than deletes),
                   * so every deleted account read as an unfinished sign-up;
                   * and a sign-up that broke PART WAY leaves the flag true, so
                   * the genuinely stranded accounts read as healthy. */}
                  {u.health
                    .filter((h) => h !== 'deleted') // the Deleted pill already says so
                    .map((h) => {
                      const { label, title } = healthLabel(h);
                      return (
                        <span
                          key={h}
                          title={title}
                          className={cn(
                            'ml-2 text-[11px]',
                            isBroken([h]) ? 'text-destructive' : 'text-status-pending',
                          )}
                        >
                          {label}
                        </span>
                      );
                    })}
                </td>
                <td className='px-4 py-3 tabular-nums'>{u.jobsDone ?? '-'}</td>
                <td className='px-4 py-3 tabular-nums'>
                  {u.totalRevenue != null ? formatPence(u.totalRevenue) : '-'}
                </td>
                <td className='text-muted-foreground px-4 py-3'>
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB') : '-'}
                </td>
                <td className='text-muted-foreground px-4 py-3'>
                  {u.lastSignInAt
                    ? new Date(u.lastSignInAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Never'}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className='text-muted-foreground px-4 py-10 text-center text-sm'
                >
                  No accounts match that.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
