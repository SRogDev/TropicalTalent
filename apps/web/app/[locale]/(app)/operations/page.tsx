import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getViewer } from '@/modules/identity/queries';
import {
  loadMyFees,
  loadMyNegotiations,
  loadMySourcingRequests,
} from '@/modules/commercial/queries';
import type { NegotiationStatus } from '@/modules/commercial/types';
import type { SourcingQueueRow } from '@/modules/commercial/types';
import { formatFeeForDisplay } from '@/modules/commercial/validation';

export const metadata: Metadata = {
  title: 'My operations',
  description: 'Your requests, negotiations, proposals, and agreed operations on Cubora.',
};

/**
 * Consumer + provider dashboard (Phase 4, plan §9, spec S45/S46).
 *
 * "My requests / negotiations / proposals / agreed operations" for the
 * buyer, "my offers / opportunities / negotiations / verification
 * status" for the provider — in one page because one account can be
 * both. The offer list itself stays on /offers (improved in this
 * phase with a negotiations section); verification status stays on
 * the provider profile there. This page is the commercial view: what
 * is moving, what is agreed, and what fees were recorded.
 */
export default async function MyOperationsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/operations');

  const t = await getTranslations('operations');
  const locale = await getLocale();

  const statusLabel: Record<NegotiationStatus, string> = {
    open: t('statusOpen'),
    proposal: t('statusProposal'),
    awaiting_acceptance: t('statusAwaitingAcceptance'),
    accepted: t('statusAccepted'),
    contact_released: t('statusContactReleased'),
    completed: t('statusCompleted'),
    cancelled: t('statusCancelled'),
    blocked: t('statusBlocked'),
  };
  const requestStatusLabel: Record<SourcingQueueRow['status'], string> = {
    open: t('requestStatusOpen'),
    matched: t('requestStatusMatched'),
    notified: t('requestStatusNotified'),
  };
  const feeLabels = { notSet: t('feeNotSet'), void: t('feeVoid') };

  const [requests, negotiations, fees] = await Promise.all([
    loadMySourcingRequests(viewer.id),
    loadMyNegotiations(viewer.id),
    loadMyFees(viewer.id),
  ]);

  const asConsumer = negotiations.filter((n) => n.consumerId === viewer.id);
  const asProvider = negotiations.filter((n) => n.consumerId !== viewer.id);
  const agreed = negotiations.filter(
    (n) =>
      n.status === 'accepted' || n.status === 'contact_released' || n.status === 'completed',
  );

  return (
    <div className='mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight sm:text-3xl'>{t('title')}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>{t('intro')}</p>
      </header>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          {t('requestsTitle')}
        </h2>
        {requests.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>{t('requestsEmpty')}</p>
        ) : (
          <ul className='mt-2 space-y-2'>
            {requests.map((r) => (
              <li
                key={r.id}
                className='bg-card flex flex-wrap justify-between gap-2 rounded-lg border px-4 py-3 text-sm'
              >
                <span className='truncate'>{r.query}</span>
                <span className='text-muted-foreground shrink-0'>
                  {requestStatusLabel[r.status]} ·{' '}
                  {new Date(r.createdAt).toLocaleDateString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          {t('negotiationsBuyer')}
        </h2>
        {asConsumer.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>{t('negotiationsBuyerEmpty')}</p>
        ) : (
          <ul className='mt-2 space-y-2'>
            {asConsumer.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/operations/${n.id}`}
                  className='bg-card hover:border-foreground/20 flex flex-wrap justify-between gap-2 rounded-lg border px-4 py-3 text-sm transition'
                >
                  <span className='truncate'>
                    {n.offerTitle ?? n.sourcingQuery ?? t('negotiationFallback')}
                  </span>
                  <span className='text-muted-foreground shrink-0'>
                    {statusLabel[n.status]} · {new Date(n.createdAt).toLocaleDateString(locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          {t('negotiationsProvider')}
        </h2>
        {asProvider.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>{t('negotiationsProviderEmpty')}</p>
        ) : (
          <ul className='mt-2 space-y-2'>
            {asProvider.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/operations/${n.id}`}
                  className='bg-card hover:border-foreground/20 flex flex-wrap justify-between gap-2 rounded-lg border px-4 py-3 text-sm transition'
                >
                  <span className='truncate'>
                    {n.offerTitle ?? n.sourcingQuery ?? t('negotiationFallback')}
                  </span>
                  <span className='text-muted-foreground shrink-0'>
                    {statusLabel[n.status]} · {new Date(n.createdAt).toLocaleDateString(locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          {t('agreedTitle')}
        </h2>
        {agreed.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>{t('agreedEmpty')}</p>
        ) : (
          <ul className='mt-2 space-y-2'>
            {agreed.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/operations/${n.id}`}
                  className='bg-card hover:border-foreground/20 flex flex-wrap justify-between gap-2 rounded-lg border px-4 py-3 text-sm transition'
                >
                  <span className='truncate'>
                    {n.offerTitle ?? n.sourcingQuery ?? t('negotiationFallback')}
                  </span>
                  <span className='text-muted-foreground shrink-0'>{statusLabel[n.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          {t('feesTitle')}
        </h2>
        {fees.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>{t('feesEmpty')}</p>
        ) : (
          <ul className='mt-2 space-y-2'>
            {fees.map((f) => (
              <li
                key={f.id}
                className='bg-card flex flex-wrap justify-between gap-2 rounded-lg border px-4 py-3 text-sm'
              >
                <span>{formatFeeForDisplay(f, feeLabels)}</span>
                <span className='text-muted-foreground shrink-0'>
                  {f.status === 'void' ? t('feeVoid') : t('feeRecorded')} ·{' '}
                  {new Date(f.createdAt).toLocaleDateString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
