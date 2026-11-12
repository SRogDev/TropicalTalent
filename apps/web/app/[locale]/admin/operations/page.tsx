import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { loadOpsOverview } from '@/modules/commercial/queries';

export const metadata: Metadata = {
  title: 'Operations',
  robots: { index: false, follow: false },
};

/**
 * Internal operations CRM — the overview (Phase 4, plan §9, spec S47).
 *
 * One coherent ops section, not a separate app: it reuses the admin
 * console shell and the requireAdminScope() gate. Each card is a queue
 * with a count and a link to the page that works it — incoming and
 * unmatched requests, active negotiations, proposals awaiting
 * acceptance, contact-release approvals, fee tracking, compliance
 * reviews, and pending notifications. The supplier verification queue
 * stays on /admin/suppliers (Phase 2 flow, extended with a status
 * filter in this phase); this page links to it rather than duplicating
 * it.
 *
 * Fee lines show what was recorded — "Not set" when a record carries
 * no type or amount. The fee model is still Roger's decision (spec
 * O1–O3); nothing here invents one.
 */
export default async function OperationsPage() {
  const overview = await loadOpsOverview();

  const queues = [
    {
      href: '/admin/operations/requests',
      label: 'Incoming & unmatched requests',
      count: overview.openRequests,
      hint: 'Sourcing requests waiting for a verified offer to be matched.',
    },
    {
      href: '/admin/operations/negotiations',
      label: 'Active negotiations',
      count: overview.openNegotiations,
      hint: 'Open commercial operations, from first contact to agreed operation.',
    },
    {
      href: '/admin/operations/negotiations',
      label: 'Proposals awaiting acceptance',
      count: overview.proposalsAwaitingAcceptance,
      hint: 'Sent proposals neither party has answered yet.',
    },
    {
      href: '/admin/operations/releases',
      label: 'Contact-release approvals',
      count: overview.pendingReleases,
      hint: 'Accepted negotiations with no contact released yet.',
    },
    {
      href: '/admin/operations/fees',
      label: 'Fee tracking',
      count: overview.feeRecords,
      hint: 'Fee records per operation. A record is not a charge.',
    },
    {
      href: '/admin/operations/compliance',
      label: 'Compliance reviews & blocked cases',
      count: overview.openCompliance,
      hint: 'Open, reviewing, or blocked reviews.',
    },
    {
      href: '/admin/operations/notifications',
      label: 'Pending notifications',
      count: overview.pendingNotifications,
      hint: 'Requesters waiting to hear about a match — sent manually, then marked sent.',
    },
    {
      href: '/admin/suppliers',
      label: 'Supplier discovery & verification',
      count: null,
      hint: 'Provider onboarding and verification (Phase 2 flow).',
    },
  ];

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Operations</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Cubora&apos;s internal operations CRM: every request, negotiation, proposal, release, fee
          record, and review in one place. Ops coordinates the commercial relationship — buyers and
          providers never exchange contact details here; contact is released only through an
          explicit approval record (see Contact-release approvals).
        </p>
      </header>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        {queues.map((queue) => (
          <Link
            key={queue.label}
            href={queue.href}
            className='bg-card hover:border-foreground/20 rounded-lg border p-4 transition'
          >
            <div className='flex items-baseline justify-between gap-2'>
              <h2 className='font-medium'>{queue.label}</h2>
              {queue.count !== null && <span className='text-2xl font-bold'>{queue.count}</span>}
            </div>
            <p className='text-muted-foreground mt-1 text-sm'>{queue.hint}</p>
          </Link>
        ))}
      </div>

      {overview.feeLines.length > 0 && (
        <section className='bg-card rounded-lg border p-4'>
          <h2 className='font-medium'>Latest fee records</h2>
          <ul className='text-muted-foreground mt-2 space-y-1 text-sm'>
            {overview.feeLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <p className='text-muted-foreground mt-2 text-xs'>
            Fee type and amount are decided per operation by Roger (spec O1–O3). A record that says
            &ldquo;Not set&rdquo; means nothing was agreed yet — not that the fee is zero.
          </p>
        </section>
      )}
    </div>
  );
}
