'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { createNegotiationFromOfferAction } from '@/modules/commercial/actions';

/**
 * "Request a quotation" on an offer card (Phase 4).
 *
 * Opens a negotiation with the offer's provider — the consumer-side
 * start of the commercial workflow (plan §5). The provider sees the
 * negotiation once it exists; no contact details change hands here,
 * and the negotiation itself is where the quotation is discussed.
 */
export function RequestQuotationButton({ offerId }: { offerId: string }) {
  const t = useTranslations('catalog');
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'opened'; negotiationId: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function request() {
    setState({ kind: 'loading' });
    const result = await createNegotiationFromOfferAction(offerId);
    if (result.success !== true) {
      setState({ kind: 'error', message: result.error });
      return;
    }
    setState({ kind: 'opened', negotiationId: result.data });
  }

  if (state.kind === 'opened') {
    return (
      <Link
        href={`/operations/${state.negotiationId}`}
        className='text-primary text-sm font-medium hover:underline'
      >
        {t('requestQuotationOpened')}
      </Link>
    );
  }

  return (
    <span className='inline-flex flex-col gap-1'>
      <button
        type='button'
        onClick={request}
        disabled={state.kind === 'loading'}
        className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
      >
        {state.kind === 'loading' ? t('requestQuotationOpening') : t('requestQuotation')}
      </button>
      {state.kind === 'error' && <span className='text-destructive text-xs'>{state.message}</span>}
    </span>
  );
}
