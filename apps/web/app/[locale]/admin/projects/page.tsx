import Link from 'next/link';
import type { Metadata } from 'next';
import { loadAdminProjects } from '@/modules/admin/queries';
import { formatPence } from '@/lib/money';

export const metadata: Metadata = { title: 'Admin - Projects' };

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-muted-foreground',
  pending_payment: 'text-status-pending',
  active: 'text-status-active',
  completed: 'text-status-complete',
  cancelled: 'text-status-cancelled',
};

export default async function AdminProjectsPage() {
  const projects = await loadAdminProjects();
  const archived = projects.filter((p) => p.archivedAt).length;

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>Projects</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {projects.length} total
          {archived > 0 && (
            <>
              {' · '}
              {/* Archived projects are invisible to everyone in the app
                  (migration 045). This console is the only place they exist,
                  which is the whole reason they were not deleted. */}
              {archived} archived, visible only here
            </>
          )}
          .
        </p>
      </header>

      <div className='glass overflow-x-auto rounded-2xl'>
        <table className='w-full text-left text-sm'>
          <thead>
            <tr className='text-muted-foreground border-foreground/10 border-b text-[11px] tracking-widest uppercase'>
              <th className='px-4 py-3 font-medium'>Project</th>
              <th className='px-4 py-3 font-medium'>Brand</th>
              <th className='px-4 py-3 font-medium'>Status</th>
              <th className='px-4 py-3 font-medium'>Visibility</th>
              <th className='px-4 py-3 font-medium'>Roles</th>
              <th className='px-4 py-3 font-medium'>Budget</th>
              <th className='px-4 py-3 font-medium'>Escrow</th>
              <th className='px-4 py-3 font-medium'>Created</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr
                key={p.id}
                className='border-foreground/5 border-b last:border-0'
                // Dimmed rather than hidden: an admin looking for a project
                // that "disappeared" should find it here, not conclude it is
                // gone.
                data-archived={p.archivedAt ? 'true' : undefined}
              >
                <td className='px-4 py-3'>
                  {p.archivedAt ? (
                    <span className='text-muted-foreground font-medium'>{p.name}</span>
                  ) : (
                    <Link href={`/projects/${p.id}`} className='font-medium hover:underline'>
                      {p.name}
                    </Link>
                  )}
                </td>
                <td className='text-muted-foreground px-4 py-3'>{p.brandName ?? '-'}</td>
                <td className='px-4 py-3'>
                  <span
                    className={`text-xs capitalize ${
                      p.archivedAt ? 'text-muted-foreground' : (STATUS_COLOR[p.status] ?? '')
                    }`}
                  >
                    {p.archivedAt ? 'archived' : p.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className='text-muted-foreground px-4 py-3 text-xs capitalize'>
                  {p.visibility}
                </td>
                <td className='px-4 py-3 tabular-nums'>
                  {p.filledRoleCount}/{p.roleCount}
                </td>
                <td className='px-4 py-3 tabular-nums'>{formatPence(p.budget, p.currency)}</td>
                <td className='text-muted-foreground px-4 py-3 text-xs capitalize'>
                  {p.escrowStatus?.replace(/_/g, ' ') ?? 'none'}
                </td>
                <td className='text-muted-foreground px-4 py-3'>
                  {new Date(p.createdAt).toLocaleDateString('en-GB')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
