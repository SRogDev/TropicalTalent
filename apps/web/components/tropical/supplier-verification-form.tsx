'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import {
  recordVerificationEvidenceAction,
  setOfferVerificationAction,
  setProviderVerificationAction,
} from '@/modules/catalog/actions';
import type {
  Offer,
  Provider,
  VerificationEvent,
  VerificationStatus,
} from '@/modules/catalog/types';
import { cn } from '@/lib/utils';

/**
 * Supplier verification controls (Phase 2, admin only).
 *
 * Three forms, one rule: every decision is recorded. Setting a status
 * writes a `tropical_verification_events` row alongside the flag flip,
 * so the queue page can show what happened last and the history below can
 * show the whole trail. Nothing here negotiates, releases contacts, or
 * touches fees — that is Phase 4.
 *
 * The Made in Cuba seal needs verified origin first. The action checks
 * that and the database CHECK backs it up, so the checkbox pair cannot
 * produce a sealed-but-unverified offer even if the UI is bypassed.
 */
export function SupplierVerificationForms({
  provider,
  offers,
  events,
}: {
  provider: Provider;
  offers: Offer[];
  events: VerificationEvent[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const [status, setStatus] = useState<VerificationStatus>(provider.verificationStatus);
  const [notes, setNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const [evidenceKind, setEvidenceKind] = useState<'document' | 'note'>('document');
  const [evidenceOfferId, setEvidenceOfferId] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [savingEvidence, setSavingEvidence] = useState(false);

  const [offerStates, setOfferStates] = useState<
    Record<
      string,
      { originVerified: boolean; madeInCuba: boolean; verificationStatus: VerificationStatus }
    >
  >(
    Object.fromEntries(
      offers.map((o) => [
        o.id,
        {
          originVerified: o.originVerified,
          madeInCuba: o.madeInCuba,
          verificationStatus: o.verificationStatus,
        },
      ]),
    ),
  );
  const [savingOfferId, setSavingOfferId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  const saveStatus = (e: React.FormEvent) => {
    e.preventDefault();
    setSavingStatus(true);
    setFormError(null);
    void setProviderVerificationAction(provider.id, status, notes).then((result) => {
      setSavingStatus(false);
      if (result.success !== true) {
        setFormError(result.error);
        return;
      }
      toast({ title: `Provider marked ${status}` });
      setNotes('');
      refresh();
    });
  };

  const saveEvidence = (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEvidence(true);
    setFormError(null);
    void recordVerificationEvidenceAction(provider.id, {
      offerId: evidenceOfferId || null,
      kind: evidenceKind,
      reference: evidenceReference,
      note: evidenceNote,
    }).then((result) => {
      setSavingEvidence(false);
      if (result.success !== true) {
        setFormError(result.error);
        return;
      }
      toast({ title: 'Evidence recorded' });
      setEvidenceReference('');
      setEvidenceNote('');
      refresh();
    });
  };

  const saveOffer = (offerId: string) => {
    const state = offerStates[offerId];
    if (!state) return;
    setSavingOfferId(offerId);
    setFormError(null);
    void setOfferVerificationAction(offerId, state).then((result) => {
      setSavingOfferId(null);
      if (result.success !== true) {
        setFormError(result.error);
        return;
      }
      toast({ title: 'Offer verification updated' });
      refresh();
    });
  };

  return (
    <div className='space-y-6'>
      {formError && <p className='text-destructive text-sm'>{formError}</p>}

      {/* ---- Provider status ---- */}
      <form onSubmit={saveStatus} className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='text-base font-semibold'>Verification status</h2>
        <p className='text-muted-foreground text-sm'>
          Current:{' '}
          <span className='text-foreground font-medium'>{provider.verificationStatus}</span>
          {provider.verifiedAt &&
            ` · verified ${new Date(provider.verifiedAt).toLocaleDateString()}`}
        </p>
        <div className='flex flex-wrap gap-2'>
          {(['pending', 'in_review', 'verified', 'rejected'] as VerificationStatus[]).map((s) => (
            <button
              key={s}
              type='button'
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium',
                status === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor='verification-notes' className='text-sm font-medium'>
            Notes (what was checked, what is still missing)
          </label>
          <textarea
            id='verification-notes'
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder='e.g. Identity document seen; business registration still missing.'
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </div>
        <button
          type='submit'
          disabled={savingStatus}
          className='bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50'
        >
          {savingStatus ? 'Saving…' : 'Set status'}
        </button>
      </form>

      {/* ---- Evidence ---- */}
      <form onSubmit={saveEvidence} className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='text-base font-semibold'>Record evidence</h2>
        <p className='text-muted-foreground text-sm'>
          A document reference (Storage path or external identifier — never a secret) or a note
          about what was seen. Evidence is the audit trail; the status above is the decision.
        </p>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div>
            <label htmlFor='evidence-kind' className='text-sm font-medium'>
              Kind
            </label>
            <select
              id='evidence-kind'
              value={evidenceKind}
              onChange={(e) => setEvidenceKind(e.target.value as 'document' | 'note')}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            >
              <option value='document'>Document</option>
              <option value='note'>Note</option>
            </select>
          </div>
          <div>
            <label htmlFor='evidence-offer' className='text-sm font-medium'>
              Offer (optional — leave blank for provider-level evidence)
            </label>
            <select
              id='evidence-offer'
              value={evidenceOfferId}
              onChange={(e) => setEvidenceOfferId(e.target.value)}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            >
              <option value=''>Provider-level</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor='evidence-reference' className='text-sm font-medium'>
            Reference
          </label>
          <input
            id='evidence-reference'
            value={evidenceReference}
            onChange={(e) => setEvidenceReference(e.target.value)}
            placeholder='e.g. verification/id-document.pdf'
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </div>
        <div>
          <label htmlFor='evidence-note' className='text-sm font-medium'>
            Note
          </label>
          <textarea
            id='evidence-note'
            value={evidenceNote}
            onChange={(e) => setEvidenceNote(e.target.value)}
            rows={2}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </div>
        <button
          type='submit'
          disabled={savingEvidence}
          className='bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50'
        >
          {savingEvidence ? 'Saving…' : 'Record evidence'}
        </button>
      </form>

      {/* ---- Per-offer verification ---- */}
      <section className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='text-base font-semibold'>Offers — origin & seal</h2>
        {offers.length === 0 ? (
          <p className='text-muted-foreground text-sm'>This provider has no offers yet.</p>
        ) : (
          offers.map((offer) => {
            const state = offerStates[offer.id] ?? {
              originVerified: offer.originVerified,
              madeInCuba: offer.madeInCuba,
              verificationStatus: offer.verificationStatus,
            };
            return (
              <div key={offer.id} className='space-y-2 rounded-md border p-3'>
                <p className='font-medium'>{offer.title}</p>
                <p className='text-muted-foreground text-xs'>
                  {offer.category} · {offer.status} · origin: {offer.originCountry ?? 'unstated'}
                </p>
                <div className='flex flex-wrap items-center gap-4 text-sm'>
                  <label className='inline-flex items-center gap-1.5'>
                    <input
                      type='checkbox'
                      checked={state.originVerified}
                      onChange={(e) =>
                        setOfferStates((cur) => ({
                          ...cur,
                          [offer.id]: { ...state, originVerified: e.target.checked },
                        }))
                      }
                    />
                    Origin verified
                  </label>
                  <label className='inline-flex items-center gap-1.5'>
                    <input
                      type='checkbox'
                      checked={state.madeInCuba}
                      disabled={!state.originVerified}
                      onChange={(e) =>
                        setOfferStates((cur) => ({
                          ...cur,
                          [offer.id]: { ...state, madeInCuba: e.target.checked },
                        }))
                      }
                    />
                    Made in Cuba seal
                  </label>
                  <select
                    value={state.verificationStatus}
                    onChange={(e) =>
                      setOfferStates((cur) => ({
                        ...cur,
                        [offer.id]: {
                          ...state,
                          verificationStatus: e.target.value as VerificationStatus,
                        },
                      }))
                    }
                    aria-label='Offer verification status'
                    className='bg-background rounded-md border px-2 py-1.5 text-sm'
                  >
                    {(['pending', 'in_review', 'verified', 'rejected'] as VerificationStatus[]).map(
                      (s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ),
                    )}
                  </select>
                  <button
                    type='button'
                    disabled={savingOfferId === offer.id}
                    onClick={() => saveOffer(offer.id)}
                    className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
                  >
                    {savingOfferId === offer.id ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* ---- History ---- */}
      <section className='bg-card space-y-2 rounded-lg border p-4'>
        <h2 className='text-base font-semibold'>Verification history</h2>
        {events.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No verification events recorded yet.</p>
        ) : (
          <ul className='space-y-2 text-sm'>
            {events.map((event) => (
              <li key={event.id} className='rounded-md border p-3'>
                <p className='font-medium'>
                  {event.kind}
                  {event.statusAfter ? ` → ${event.statusAfter}` : ''}
                  <span className='text-muted-foreground ml-2 font-normal'>
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </p>
                {event.reference && (
                  <p className='text-muted-foreground'>Reference: {event.reference}</p>
                )}
                {event.note && <p>{event.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
