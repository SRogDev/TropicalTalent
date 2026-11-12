import type { Metadata } from 'next';
import { loadAdminUsers } from '@/modules/admin/queries';
import { AdminUsersTable } from '@/components/tropical/admin-users-table';

export const metadata: Metadata = { title: 'Admin - Accounts' };

/**
 * The accounts table.
 *
 * The page stays a server component and does the one query; sorting and
 * filtering are the table's own business, in the browser. See the note in
 * AdminUsersTable for why they are not query parameters — two of the seven
 * columns are stitched on from the Supabase auth directory and have no column
 * in Postgres to order by.
 */
export default async function AdminUsersPage() {
  const users = await loadAdminUsers();
  const deleted = users.filter((u) => u.deletedAt).length;

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>Accounts</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {users.length} total
          {deleted > 0 && `, ${deleted} deleted`}. Click a column to sort.
        </p>
      </header>

      <AdminUsersTable users={users} />
    </div>
  );
}
