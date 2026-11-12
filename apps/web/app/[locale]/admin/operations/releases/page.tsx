import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { loadNegotiationsForOps } from '@/modules/commercial/queries';

export const metadata: Metadata = {
  title: 'Contact releases — Operations',
  robots: { index: false, follow: false },
};

/**
 * The contact-release approvals queue (Phase 4, plan §9, spec S24/S27).
 *
 * Accepted negotiations with no release yet are the queue: ops reviews
 * the operation, records what conditions were met, and approves the
 * release from the negotiation detail page. The release conditions
 * themselves are still Roger's decision (spec O4) — this page lists
 * what is waiting, it does not define the policy.
 */
export default async function ReleasesPage() {
  const negotiations = await loadNegotiationsForOps();
  const awaiting = negotiations.filter((n) => n.status === 'accepted');
  const released = negotiations.filter((n) => n.status === 'contact_released');

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Contact-release approvals</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Contact details are released only after the required conditions are satisfied — and only
          through an explicit approval record. A release for one side never releases the other side.
        </p>
      </header>

      {awaiting.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          Nothing awaiting release. Accepted negotiations appear here.
        </p>
      ) : (
        <div className='space-y-2'>
          {awaiting.map((n) => (
            <Link
              key={n.id}
              href={`/admin/operations/negotiations/${n.id}`}
              className='bg-card hover:border-foreground/20 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition'
            >
              <span className='min-w-0'>
                <span className='block truncate text-sm font-medium'>
                  {n.consumerName ?? 'Buyer'} ↔ {n.providerDisplayName ?? 'Provider'}
                </span>
                <span className='text-muted-foreground block truncate text-xs'>
                  {n.offerTitle ?? n.sourcingQuery ?? 'Negotiation'} · opened{' '}
                  {new Date(n.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span className='text-primary shrink-0 text-sm font-medium'>Review →</span>
            </Link>
          ))}
        </div>
      )}

      {released.length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
            Already released
          </h2>
          <ul className='mt-2 space-y-1 text-sm'>
            {released.map((n) => (
              <li
                key={n.id}
                className='bg-card flex justify-between gap-2 rounded-lg border px-4 py-2'
              >
                <span className='truncate'>
                  {n.consumerName ?? 'Buyer'} ↔ {n.providerDisplayName ?? 'Provider'}
                </span>
                <Link
                  href={`/admin/operations/negotiations/${n.id}`}
                  className='text-primary shrink-0 hover:underline'
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
