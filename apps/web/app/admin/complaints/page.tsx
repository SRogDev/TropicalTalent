import type { Metadata } from 'next';
import { loadAllDisputes } from '@/modules/chat/queries';
import { loadAllComplaints } from '@/modules/complaints/queries';
import { AdminDisputeRow } from '@/components/tropical/admin-dispute-row';
import { AdminComplaintRow } from '@/components/tropical/admin-complaint-row';

export const metadata: Metadata = { title: 'Admin - Complaints' };

export default async function AdminComplaintsPage() {
  // Independent reads, so they overlap rather than queue — the convention this
  // codebase keeps for any page that needs more than one thing.
  const [disputes, complaints] = await Promise.all([loadAllDisputes(), loadAllComplaints()]);

  const open = disputes.filter((d) => d.status === 'open' || d.status === 'reviewing');
  const closed = disputes.filter((d) => d.status === 'resolved' || d.status === 'rejected');

  const openReports = complaints.filter((c) => c.status === 'open' || c.status === 'reviewing');
  const closedReports = complaints.filter(
    (c) => c.status === 'resolved' || c.status === 'rejected',
  );

  return (
    <div className='space-y-8'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>Complaints</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Reports raised from a profile, and disputes raised once a project's escrow was paid.
        </p>
      </header>

      {/* Reports first: a dispute is money sitting still, but a conduct report
          can be someone being harassed, and it has no escrow clock to make it
          visible. */}
      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          Reports ({openReports.length})
        </h2>
        {openReports.length === 0 ? (
          <p className='text-muted-foreground mt-3 text-sm'>No open reports.</p>
        ) : (
          <div className='mt-3 space-y-2'>
            {openReports.map((c) => (
              <AdminComplaintRow key={c.id} complaint={c} />
            ))}
          </div>
        )}
      </section>

      {closedReports.length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
            Closed reports ({closedReports.length})
          </h2>
          <div className='mt-3 space-y-2'>
            {closedReports.map((c) => (
              <AdminComplaintRow key={c.id} complaint={c} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          Escrow disputes ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className='text-muted-foreground mt-3 text-sm'>Nothing open right now.</p>
        ) : (
          <div className='mt-3 space-y-2'>
            {open.map((d) => (
              <AdminDisputeRow key={d.id} dispute={d} />
            ))}
          </div>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
            Closed disputes ({closed.length})
          </h2>
          <div className='mt-3 space-y-2'>
            {closed.map((d) => (
              <AdminDisputeRow key={d.id} dispute={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
