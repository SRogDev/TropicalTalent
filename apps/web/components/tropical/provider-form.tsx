'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { upsertProviderAction, type ProviderFormInput } from '@/modules/catalog/actions';
import type { Provider } from '@/modules/catalog/types';
import { cn } from '@/lib/utils';

/**
 * The provider profile form (Phase 2).
 *
 * One profile per account, individual or business. Verification status is
 * not in this form at all — it is set by Cubora operations, never by the
 * provider, and the form cannot submit it.
 */
export function ProviderForm({ initial }: { initial?: Provider | null }) {
  const t = useTranslations('offers');
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Provider['kind']>(initial?.kind ?? 'individual');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [legalName, setLegalName] = useState(initial?.legalName ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [country, setCountry] = useState(initial?.country ?? 'Cuba');
  const [languages, setLanguages] = useState((initial?.languages ?? []).join(', '));

  const verificationLabel: Record<Provider['verificationStatus'], string> = {
    pending: t('verificationPending'),
    in_review: t('verificationInReview'),
    verified: t('verificationVerified'),
    rejected: t('verificationRejected'),
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const input: ProviderFormInput = {
      kind,
      displayName,
      legalName,
      description,
      city,
      country,
      languages: [
        ...new Set(
          languages
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
    };

    void upsertProviderAction(input).then((result) => {
      setSaving(false);
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      toast({ title: initial ? t('updatedProfile') : t('createdProfile') });
      startTransition(() => router.refresh());
    });
  };

  return (
    <form onSubmit={submit} className='bg-card space-y-4 rounded-lg border p-4'>
      <h2 className='text-base font-semibold'>
        {initial ? t('profileTitle') : t('createProfileTitle')}
      </h2>
      {initial && (
        <p className='text-muted-foreground text-sm'>
          {t('verificationStatus')}{' '}
          <span className='text-foreground font-medium'>
            {verificationLabel[initial.verificationStatus]}
          </span>
          {initial.verificationStatus === 'pending' && t('verificationPendingNote')}
          {initial.verificationNotes && (
            <>
              <br />
              <span className='text-xs'>
                {t('verificationNoteFromOps', { note: initial.verificationNotes })}
              </span>
            </>
          )}
        </p>
      )}
      {error && <p className='text-destructive text-sm'>{error}</p>}

      <div>
        <label htmlFor='provider-kind' className='text-sm font-medium'>
          {t('offerAs')}
        </label>
        <select
          id='provider-kind'
          value={kind}
          onChange={(e) => setKind(e.target.value as Provider['kind'])}
          className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
        >
          <option value='individual'>{t('offerAsIndividual')}</option>
          <option value='business'>{t('offerAsBusiness')}</option>
        </select>
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div>
          <label htmlFor='provider-name' className='text-sm font-medium'>
            {t('displayName')}
          </label>
          <input
            id='provider-name'
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={200}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </div>
        <div>
          <label htmlFor='provider-legal' className='text-sm font-medium'>
            {t('legalName')} {kind === 'individual' ? t('legalNameOptional') : ''}
          </label>
          <input
            id='provider-legal'
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            maxLength={200}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </div>
        <div>
          <label htmlFor='provider-city' className='text-sm font-medium'>
            {t('city')}
          </label>
          <input
            id='provider-city'
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </div>
        <div>
          <label htmlFor='provider-country' className='text-sm font-medium'>
            {t('country')}
          </label>
          <input
            id='provider-country'
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </div>
      </div>

      <div>
        <label htmlFor='provider-description' className='text-sm font-medium'>
          {t('description')}
        </label>
        <textarea
          id='provider-description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t('descriptionPlaceholder')}
          className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
        />
      </div>

      <div>
        <label htmlFor='provider-languages' className='text-sm font-medium'>
          {t('languagesProvider')}
        </label>
        <input
          id='provider-languages'
          value={languages}
          onChange={(e) => setLanguages(e.target.value)}
          className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
        />
      </div>

      <button
        type='submit'
        disabled={saving}
        className={cn(
          'bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium',
          saving && 'opacity-50',
        )}
      >
        {saving ? t('saving') : initial ? t('saveProfile') : t('createProfile')}
      </button>
    </form>
  );
}
