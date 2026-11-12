import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { matchSourcingRequestAction } from '@/modules/commercial/actions';
import { loadMatchableOffers, loadSourcingQueue } from '@/modules/commercial/queries';

export const metadata: Metadata = {
  title: 'Requests — Operations',
  robots: { index: false, follow: false },
};

/**
 * The sourcing-request queue (Phase 4; the queue Phase 3 created).
 *
 * Unmatched requests — the no-results turns — wait here until ops
 * matches one to a verified, published offer. Matching opens a
 * negotiation and marks the request matched; the requester is told
 * only after ops marks the pending notification sent (see
 * /admin/operations/notifications). Only verified offers appear in
 * the match picker: matching an unverified or draft offer would
 * present supply Cubora has not verified (plan §4).
 */
export default async function RequestsPage() {
  const [requests, offers] = await Promise.all([loadSourcingQueue(), loadMatchableOffers()]);
  const open = requests.filter((r) => r.status === 'open');
  const done = requests.filter((r) => r.status !== 'open');

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Incoming &amp; unmatched requests</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Sourcing requests from no-results discovery turns. Match an open request to a verified
          offer and a negotiation opens — the requester hears about it only when the notification is
          marked sent.
        </p>
      </header>

      {open.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          No open requests. When a buyer&apos;s search finds nothing, the sourcing request lands
          here.
        </p>
      ) : (
        <div className='space-y-3'>
          {open.map((request) => (
            <article key={request.id} className='bg-card rounded-lg border p-4'>
              <div className='flex flex-wrap items-baseline justify-between gap-2'>
                <h2 className='font-medium'>{request.query}</h2>
                <span className='text-muted-foreground text-xs'>
                  {request.requesterName ?? 'Unknown requester'} ·{' '}
                  {new Date(request.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className='text-muted-foreground mt-1 text-sm'>
                Requirements:{' '}
                <code className='text-xs'>{JSON.stringify(request.requirements)}</code>
              </p>
              {offers.length === 0 ? (
                <p className='text-muted-foreground mt-3 text-sm'>
                  No verified, published offers to match against yet.
                </p>
              ) : (
                <form
                  action={async (form: FormData) => {
                    'use server';
                    await matchSourcingRequestAction(form);
                  }}
                  className='mt-3 flex flex-wrap gap-2'
                >
                  <input type='hidden' name='sourcingRequestId' value={request.id} />
                  <label className='sr-only' htmlFor={`offer-${request.id}`}>
                    Match to offer
                  </label>
                  <select
                    id={`offer-${request.id}`}
                    name='offerId'
                    required
                    defaultValue=''
                    className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
                  >
                    <option value='' disabled>
                      Match to a verified offer…
                    </option>
                    {offers.map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {offer.title} — {offer.providerDisplayName} ({offer.category})
                      </option>
                    ))}
                  </select>
                  <button
                    type='submit'
                    className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
                  >
                    Match &amp; open negotiation
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
            Matched / notified
          </h2>
          <ul className='mt-2 space-y-1 text-sm'>
            {done.map((request) => (
              <li
                key={request.id}
                className='bg-card flex justify-between gap-2 rounded-lg border px-4 py-2'
              >
                <span className='truncate'>{request.query}</span>
                <span className='text-muted-foreground shrink-0'>{request.status}</span>
              </li>
            ))}
          </ul>
          <p className='mt-2 text-sm'>
            <Link href='/admin/operations/notifications' className='text-primary hover:underline'>
              Pending notifications →
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
