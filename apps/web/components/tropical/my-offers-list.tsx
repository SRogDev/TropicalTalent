'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { deleteOfferAction, setOfferStatusAction } from '@/modules/catalog/actions';
import { OfferCard } from './offer-card';
import type { Offer } from '@/modules/catalog/types';
import type { VerificationStatus } from '@/modules/catalog/types';
import { cn } from '@/lib/utils';

/**
 * The provider's own offers (Phase 2).
 *
 * Status actions only: publish, back to draft, archive, delete. Editing
 * happens in the OfferForm on the same page (`?edit=<id>`). Verification
 * state is shown, never edited here — it belongs to operations.
 */
export function MyOffersList({ offers }: { offers: Offer[] }) {
  const t = useTranslations('offers');
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const statusLabel: Record<Offer['status'], string> = {
    draft: t('statusDraft'),
    published: t('statusPublished'),
    archived: t('statusArchived'),
  };
  const verificationLabel: Record<VerificationStatus, string> = {
    pending: t('verificationPending'),
    in_review: t('verificationInReview'),
    verified: t('verificationVerified'),
    rejected: t('verificationRejected'),
  };

  const run = (offerId: string, call: Promise<{ success: boolean; error?: string }>) => {
    setBusyId(offerId);
    void call.then((result) => {
      setBusyId(null);
      if (result.success !== true) {
        toast({
          title: t('updateFailed'),
          description: result.error,
          variant: 'destructive',
        });
        return;
      }
      startTransition(() => router.refresh());
    });
  };

  if (offers.length === 0) {
    return (
      <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
        {t('noOffers')}
      </p>
    );
  }

  return (
    <div className='space-y-4'>
      {offers.map((offer) => (
        <div key={offer.id} className='space-y-2'>
          <OfferCard offer={offer} />
          <div className='flex flex-wrap items-center gap-2'>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                offer.status === 'published' &&
                  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
                offer.status === 'draft' &&
                  'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
                offer.status === 'archived' &&
                  'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
              )}
            >
              {statusLabel[offer.status]}
              {offer.verificationStatus !== 'pending' &&
                ` · ${verificationLabel[offer.verificationStatus]}`}
            </span>
            <button
              type='button'
              onClick={() => router.push(`/offers?edit=${offer.id}`)}
              className='rounded-md border px-3 py-1.5 text-sm'
            >
              {t('edit')}
            </button>
            {offer.status !== 'published' && (
              <button
                type='button'
                disabled={busyId === offer.id}
                onClick={() => run(offer.id, setOfferStatusAction(offer.id, 'published'))}
                className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
              >
                {t('publish')}
              </button>
            )}
            {offer.status === 'published' && (
              <button
                type='button'
                disabled={busyId === offer.id}
                onClick={() => run(offer.id, setOfferStatusAction(offer.id, 'draft'))}
                className='rounded-md border px-3 py-1.5 text-sm disabled:opacity-50'
              >
                {t('unpublish')}
              </button>
            )}
            {offer.status !== 'archived' && (
              <button
                type='button'
                disabled={busyId === offer.id}
                onClick={() => run(offer.id, setOfferStatusAction(offer.id, 'archived'))}
                className='rounded-md border px-3 py-1.5 text-sm disabled:opacity-50'
              >
                {t('archive')}
              </button>
            )}
            {confirmDeleteId === offer.id ? (
              <>
                <button
                  type='button'
                  disabled={busyId === offer.id}
                  onClick={() => {
                    setConfirmDeleteId(null);
                    run(offer.id, deleteOfferAction(offer.id));
                  }}
                  className='bg-destructive text-destructive-foreground rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
                >
                  {t('deleteConfirm')}
                </button>
                <button
                  type='button'
                  onClick={() => setConfirmDeleteId(null)}
                  className='rounded-md border px-3 py-1.5 text-sm'
                >
                  {t('keepIt')}
                </button>
              </>
            ) : (
              <button
                type='button'
                onClick={() => setConfirmDeleteId(offer.id)}
                className='border-destructive/50 text-destructive rounded-md border px-3 py-1.5 text-sm'
              >
                {t('delete')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
