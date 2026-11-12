import type { Metadata } from 'next';
import Link from 'next/link';
import {
  openComplianceReviewAction,
  resolveComplianceReviewAction,
} from '@/modules/commercial/actions';
import { loadComplianceQueue } from '@/modules/commercial/queries';

export const metadata: Metadata = {
  title: 'Compliance — Operations',
  robots: { index: false, follow: false },
};

/**
 * Compliance reviews / blocked cases (Phase 4, plan §9, §12).
 *
 * Human review for sensitive or high-risk cases. Opening a review on
 * a negotiation blocks it until the review is cleared. Which cases
 * require human review is still an open product decision (spec O8) —
 * this page records reviews and decisions, it does not define the
 * scope. Nothing here claims legal compliance: Cuba-related sanctions,
 * export controls, and payment restrictions need transaction-specific
 * review by qualified professionals.
 */
export default async function CompliancePage() {
  const reviews = await loadComplianceQueue();
  const open = reviews.filter((r) => r.status !== 'cleared');

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Compliance reviews &amp; blocked cases</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Human review for sensitive or high-risk operations. A review on a negotiation blocks it;
          clearing the review unblocks it.
        </p>
      </header>

      {open.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          No open reviews. Open one from a negotiation, or on a provider or sourcing request below.
        </p>
      ) : (
        <div className='space-y-2'>
          {open.map((review) => (
            <article key={review.id} className='bg-card rounded-lg border p-4'>
              <div className='flex flex-wrap items-baseline justify-between gap-2'>
                <h2 className='text-sm font-medium'>
                  {review.entityType} · {review.status}
                </h2>
                <span className='text-muted-foreground text-xs'>
                  {new Date(review.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className='mt-1 text-sm'>{review.reason}</p>
              {review.notes && <p className='text-muted-foreground mt-1 text-sm'>{review.notes}</p>}
              {review.entityType === 'negotiation' && (
                <Link
                  href={`/admin/operations/negotiations/${review.entityId}`}
                  className='text-primary mt-1 inline-block text-sm hover:underline'
                >
                  Open the negotiation →
                </Link>
              )}
              <form
                action={async (form: FormData) => {
                  'use server';
                  await resolveComplianceReviewAction(form);
                }}
                className='mt-3 flex flex-wrap gap-2'
              >
                <input type='hidden' name='reviewId' value={review.id} />
                <input
                  name='notes'
                  placeholder='Resolution notes (optional)'
                  className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
                />
                <button
                  type='submit'
                  name='status'
                  value='cleared'
                  className='rounded-md border px-3 py-1.5 text-sm font-medium'
                >
                  Clear
                </button>
                <button
                  type='submit'
                  name='status'
                  value='blocked'
                  className='rounded-md border px-3 py-1.5 text-sm font-medium'
                >
                  Keep blocked
                </button>
                <button
                  type='submit'
                  name='status'
                  value='escalated'
                  className='rounded-md border px-3 py-1.5 text-sm font-medium'
                >
                  Escalate
                </button>
              </form>
            </article>
          ))}
        </div>
      )}

      <section className='bg-card space-y-2 rounded-lg border p-4'>
        <h2 className='font-medium'>Open a review</h2>
        <form
          action={async (form: FormData) => {
            'use server';
            await openComplianceReviewAction(form);
          }}
          className='flex flex-wrap gap-2'
        >
          <select
            name='entityType'
            required
            defaultValue='negotiation'
            className='rounded-md border px-2 py-1.5 text-sm'
          >
            <option value='negotiation'>Negotiation</option>
            <option value='provider'>Provider</option>
            <option value='sourcing_request'>Sourcing request</option>
          </select>
          <input
            name='entityId'
            required
            placeholder='Subject id'
            className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
          />
          <input
            name='reason'
            required
            maxLength={2000}
            placeholder='Why does this need human review?'
            className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
          />
          <button
            type='submit'
            className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
          >
            Open review
          </button>
        </form>
      </section>

      {reviews.filter((r) => r.status === 'cleared').length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>Cleared</h2>
          <ul className='mt-2 space-y-1 text-sm'>
            {reviews
              .filter((r) => r.status === 'cleared')
              .map((r) => (
                <li key={r.id} className='bg-card rounded-lg border px-4 py-2'>
                  {r.entityType} — {r.reason}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
