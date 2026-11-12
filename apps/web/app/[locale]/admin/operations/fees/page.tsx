import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { voidFeeAction } from '@/modules/commercial/actions';
import { loadFeesForOps } from '@/modules/commercial/queries';
import { formatFeeForDisplay } from '@/modules/commercial/validation';

export const metadata: Metadata = {
  title: 'Fees — Operations',
  robots: { index: false, follow: false },
};

/**
 * Fee tracking (Phase 4, plan §9).
 *
 * Every intermediation fee record, per operation. Type, amount,
 * currency, and basis are nullable — a record that says "Not set"
 * means nothing was agreed yet, not that the fee is zero. The fee
 * model is still Roger's decision (spec O1–O3); this page tracks what
 * ops recorded, it does not collect anything. There is no payment
 * rail in the MVP.
 */
export default async function FeesPage() {
  const fees = await loadFeesForOps();

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Fee tracking</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Intermediation fee records, one per operation. A record is a record, not a charge —
          nothing here collects money.
        </p>
      </header>

      {fees.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          No fee records yet. Ops records a fee from the negotiation detail page, with exactly what
          was agreed — every field optional until the fee model is decided.
        </p>
      ) : (
        <div className='bg-card overflow-x-auto rounded-lg border'>
          <table className='w-full text-left text-sm'>
            <thead>
              <tr className='border-b'>
                <th className='px-4 py-2 font-medium'>Fee</th>
                <th className='px-4 py-2 font-medium'>Notes</th>
                <th className='px-4 py-2 font-medium'>Status</th>
                <th className='px-4 py-2 font-medium'>Recorded</th>
                <th className='px-4 py-2 font-medium' aria-label='Actions' />
              </tr>
            </thead>
            <tbody>
              {fees.map((fee) => (
                <tr key={fee.id} className='border-b last:border-0'>
                  <td className='px-4 py-2 font-medium'>{formatFeeForDisplay(fee)}</td>
                  <td className='px-4 py-2'>{fee.notes ?? '—'}</td>
                  <td className='px-4 py-2'>{fee.status}</td>
                  <td className='text-muted-foreground px-4 py-2'>
                    {new Date(fee.createdAt).toLocaleDateString()}
                  </td>
                  <td className='px-4 py-2'>
                    <div className='flex gap-3'>
                      <Link
                        href={`/admin/operations/negotiations/${fee.negotiationId}`}
                        className='text-primary font-medium hover:underline'
                      >
                        Operation
                      </Link>
                      {fee.status !== 'void' && (
                        <form
                          action={async () => {
                            'use server';
                            await voidFeeAction(fee.id);
                          }}
                        >
                          <button type='submit' className='font-medium hover:underline'>
                            Void
                          </button>
                        </form>
                      )}
                    </div>
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
