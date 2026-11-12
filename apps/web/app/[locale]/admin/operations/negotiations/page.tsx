import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { loadNegotiationsForOps } from '@/modules/commercial/queries';
import type { NegotiationStatus } from '@/modules/commercial/types';

export const metadata: Metadata = {
  title: 'Negotiations — Operations',
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<NegotiationStatus, string> = {
  open: 'Open',
  proposal: 'Proposal',
  awaiting_acceptance: 'Awaiting acceptance',
  accepted: 'Accepted',
  contact_released: 'Contact released',
  completed: 'Completed',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
};

/**
 * The negotiations list (Phase 4).
 *
 * Every commercial operation Cubora mediates, newest first. The detail
 * page does the work — messages, proposals, release approval, fee
 * records, compliance, workspace activation. Status here is the
 * Cubora state machine (migration 056), driven by ops, not by any
 * payment event.
 */
export default async function NegotiationsPage() {
  const negotiations = await loadNegotiationsForOps();

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Negotiations</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Active and past commercial operations. A negotiation is one buyer, one provider, and
          optionally one offer or sourcing request — Cubora mediates until contact is released.
        </p>
      </header>

      {negotiations.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          No negotiations yet. They open when a consumer requests a quotation on an offer, or when
          ops matches a sourcing request to a verified offer.
        </p>
      ) : (
        <div className='bg-card overflow-x-auto rounded-lg border'>
          <table className='w-full text-left text-sm'>
            <thead>
              <tr className='border-b'>
                <th className='px-4 py-2 font-medium'>Buyer</th>
                <th className='px-4 py-2 font-medium'>Provider</th>
                <th className='px-4 py-2 font-medium'>About</th>
                <th className='px-4 py-2 font-medium'>Status</th>
                <th className='px-4 py-2 font-medium'>Opened</th>
                <th className='px-4 py-2 font-medium' aria-label='Actions' />
              </tr>
            </thead>
            <tbody>
              {negotiations.map((n) => (
                <tr key={n.id} className='border-b last:border-0'>
                  <td className='px-4 py-2'>{n.consumerName ?? '—'}</td>
                  <td className='px-4 py-2'>{n.providerDisplayName ?? '—'}</td>
                  <td className='px-4 py-2'>{n.offerTitle ?? n.sourcingQuery ?? '—'}</td>
                  <td className='px-4 py-2'>{STATUS_LABEL[n.status]}</td>
                  <td className='text-muted-foreground px-4 py-2'>
                    {new Date(n.createdAt).toLocaleDateString()}
                  </td>
                  <td className='px-4 py-2'>
                    <Link
                      href={`/admin/operations/negotiations/${n.id}`}
                      className='text-primary font-medium hover:underline'
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
