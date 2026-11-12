import type { Metadata } from 'next';
import { loadDeleteRequests } from '@/modules/admin/queries';
import { AdminDeleteRequestRow } from '@/components/tropical/admin-delete-request-row';

export const metadata: Metadata = { title: 'Admin - Deletions' };

/**
 * The deletion queue.
 *
 * Its own screen rather than a section of /admin/complaints, for the reason
 * migration 044 gives: approving one of these destroys a project, and that
 * button does not belong in the list people scan for conduct reports.
 */
export default async function AdminDeletionsPage() {
  const requests = await loadDeleteRequests();

  const open = requests.filter((r) => r.status === 'open');
  const decided = requests.filter((r) => r.status !== 'open');

  return (
    <div className='space-y-8'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>Deletions</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Brands asking for a project that has already begun to be removed. Once escrow is funded or
          a retainer&apos;s card is saved, only this screen can delete one.
        </p>
      </header>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          Waiting on you ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className='text-muted-foreground mt-3 text-sm'>Nothing to decide right now.</p>
        ) : (
          <div className='mt-3 space-y-2'>
            {open.map((r) => (
              <AdminDeleteRequestRow key={r.id} request={r} />
            ))}
          </div>
        )}
      </section>

      {decided.length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
            Decided ({decided.length})
          </h2>
          {/* Kept after the project is gone — the row is the record of what was
              removed, who asked and who approved it. */}
          <div className='mt-3 space-y-2'>
            {decided.map((r) => (
              <AdminDeleteRequestRow key={r.id} request={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
