'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { revealContactAction } from '@/modules/commercial/actions';

/**
 * Contact reveal button (Phase 4).
 *
 * Calls the only sanctioned path to the other party's contact
 * details. Before release the action refuses — and this button shows
 * that refusal, not the contact. After release it shows the name and
 * email once. The contact is never in the page payload before the
 * click: the server action fetches it from Supabase Auth only after
 * checking the release record.
 */
export function RevealContactButton({ negotiationId }: { negotiationId: string }) {
  const t = useTranslations('operations');
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'shown'; name: string | null; email: string | null }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function reveal() {
    setState({ kind: 'loading' });
    const result = await revealContactAction(negotiationId);
    if (result.success !== true) {
      setState({ kind: 'error', message: result.error });
      return;
    }
    setState({ kind: 'shown', name: result.data.name, email: result.data.email });
  }

  if (state.kind === 'shown') {
    return (
      <p className='rounded-md border px-3 py-2 text-sm'>
        {t('revealReleased')} <strong>{state.name ?? t('revealUnknown')}</strong>
        {state.email ? (
          <>
            {' — '}
            <a href={`mailto:${state.email}`} className='text-primary hover:underline'>
              {state.email}
            </a>
          </>
        ) : (
          ` — ${t('revealNoEmail')}`
        )}
      </p>
    );
  }

  return (
    <div className='space-y-1'>
      <button
        type='button'
        onClick={reveal}
        disabled={state.kind === 'loading'}
        className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
      >
        {state.kind === 'loading' ? t('revealChecking') : t('revealShow')}
      </button>
      {state.kind === 'error' && <p className='text-destructive text-sm'>{state.message}</p>}
    </div>
  );
}
