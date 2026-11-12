import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { loadProvidersForAdmin } from '@/modules/catalog/queries';

export const metadata: Metadata = {
  title: 'Suppliers',
  robots: { index: false, follow: false },
};

/**
 * Supplier onboarding — the list (Phase 2).
 *
 * The minimal internal onboarding flow (plan §7, spec S40): register a
 * supplier, record verification evidence, set verification status. This
 * page is the queue — every provider, their verification state, their
 * offers, and the last verification event. The detail page does the work.
 *
 * This is NOT the Phase 4 CRM: no negotiations, no contact-release, no
 * fees, no quotations. Those stay out until OPEN O1–O5 are answered.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const rows = await loadProvidersForAdmin();
  // Verification queue filter (Phase 4): ops triages by status instead
  // of scanning the whole list. The filter is a query param, not a new
  // page — the supplier flow itself is unchanged.
  const statuses = ['pending', 'in_review', 'verified', 'rejected'] as const;
  const activeStatus = statuses.includes(status as (typeof statuses)[number])
    ? (status as (typeof statuses)[number])
    : null;
  const visible = activeStatus
    ? rows.filter((row) => row.provider.verificationStatus === activeStatus)
    : rows;

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Suppliers</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Provider onboarding and verification. Suppliers register themselves from My offers;
          operations verifies them here — evidence first, status second, and the Made in Cuba seal
          only with verified origin. What counts as &ldquo;verified&rdquo; is still an open product
          decision (spec O6); until it is answered, record what you saw and who decided.
        </p>
      </header>

      <nav className='flex flex-wrap gap-2 text-sm' aria-label='Filter by verification status'>
        <Link
          href='/admin/suppliers'
          className={`rounded-full border px-3 py-1 ${activeStatus === null ? 'bg-primary text-primary-foreground' : ''}`}
        >
          All ({rows.length})
        </Link>
        {statuses.map((s) => {
          const count = rows.filter((row) => row.provider.verificationStatus === s).length;
          return (
            <Link
              key={s}
              href={`/admin/suppliers?status=${s}`}
              className={`rounded-full border px-3 py-1 ${activeStatus === s ? 'bg-primary text-primary-foreground' : ''}`}
            >
              {s} ({count})
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          {activeStatus
            ? `No providers with status “${activeStatus}”.`
            : 'No providers yet. Providers appear here once an account creates a provider profile.'}
        </p>
      ) : (
        <div className='bg-card overflow-x-auto rounded-lg border'>
          <table className='w-full text-left text-sm'>
            <thead>
              <tr className='border-b'>
                <th className='px-4 py-2 font-medium'>Provider</th>
                <th className='px-4 py-2 font-medium'>Kind</th>
                <th className='px-4 py-2 font-medium'>Location</th>
                <th className='px-4 py-2 font-medium'>Verification</th>
                <th className='px-4 py-2 font-medium'>Offers</th>
                <th className='px-4 py-2 font-medium'>Last event</th>
                <th className='px-4 py-2 font-medium' aria-label='Actions' />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ provider, offerCount, publishedCount, latestEvent }) => (
                <tr key={provider.id} className='border-b last:border-0'>
                  <td className='px-4 py-2 font-medium'>{provider.displayName}</td>
                  <td className='px-4 py-2'>{provider.kind}</td>
                  <td className='px-4 py-2'>
                    {[provider.city, provider.country].filter(Boolean).join(', ')}
                  </td>
                  <td className='px-4 py-2'>{provider.verificationStatus}</td>
                  <td className='px-4 py-2'>
                    {offerCount} ({publishedCount} published)
                  </td>
                  <td className='text-muted-foreground px-4 py-2'>
                    {latestEvent
                      ? `${latestEvent.kind}${latestEvent.statusAfter ? ` → ${latestEvent.statusAfter}` : ''} · ${new Date(latestEvent.createdAt).toLocaleDateString()}`
                      : '—'}
                  </td>
                  <td className='px-4 py-2'>
                    <Link
                      href={`/admin/suppliers/${provider.id}`}
                      className='text-primary font-medium hover:underline'
                    >
                      Review
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
