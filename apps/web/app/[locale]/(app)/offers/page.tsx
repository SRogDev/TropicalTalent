import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { getViewer } from '@/modules/identity/queries';
import { activateRoleAction } from '@/modules/identity/actions';
import { loadMyOffers, loadMyProvider, loadOfferById } from '@/modules/catalog/queries';
import { Link } from '@/i18n/navigation';
import { loadMyNegotiations } from '@/modules/commercial/queries';
import type { NegotiationStatus } from '@/modules/commercial/types';
import type { VerificationStatus } from '@/modules/catalog/types';
import { ProviderForm } from '@/components/tropical/provider-form';
import { OfferForm } from '@/components/tropical/offer-form';
import { MyOffersList } from '@/components/tropical/my-offers-list';

export const metadata: Metadata = {
  title: 'My offers',
  description: 'Manage your provider profile and your offers — talent, services, products.',
};

/**
 * Provider offer management (Phase 2).
 *
 * The "My offers" surface the provider dashboard needs (plan §9, spec
 * S46): the provider profile, the offer list with publish/archive/delete,
 * and the create/edit form. There was no equivalent screen — the profile
 * page shows a talent profile, not offers, and the briefs feed shows other
 * people's briefs — so this page is new rather than a duplicate.
 *
 * A consumer-only account reaches this page through the role switcher:
 * activating the provider role is a form post to the existing
 * activateRoleAction, not a new flow.
 */
export default async function MyOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/offers');

  const t = await getTranslations('offers');
  const tOps = await getTranslations('operations');
  const tNav = await getTranslations('nav');
  const locale = await getLocale();

  const statusLabel: Record<NegotiationStatus, string> = {
    open: tOps('statusOpen'),
    proposal: tOps('statusProposal'),
    awaiting_acceptance: tOps('statusAwaitingAcceptance'),
    accepted: tOps('statusAccepted'),
    contact_released: tOps('statusContactReleased'),
    completed: tOps('statusCompleted'),
    cancelled: tOps('statusCancelled'),
    blocked: tOps('statusBlocked'),
  };
  const verificationLabel: Record<VerificationStatus, string> = {
    pending: t('verificationPending'),
    in_review: t('verificationInReview'),
    verified: t('verificationVerified'),
    rejected: t('verificationRejected'),
  };

  if (!viewer.isCreative) {
    return (
      <div className='mx-auto max-w-2xl space-y-4 p-4 sm:p-6'>
        <h1 className='text-2xl font-bold'>{t('title')}</h1>
        <p className='text-muted-foreground text-sm'>{t('activateIntro')}</p>
        <form
          action={async (form: FormData) => {
            'use server';
            await activateRoleAction(form);
          }}
        >
          <input type='hidden' name='role' value='provider' />
          <button
            type='submit'
            className='bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium'
          >
            {tNav('activateProvider')}
          </button>
        </form>
      </div>
    );
  }

  const [provider, offers] = await Promise.all([
    loadMyProvider(viewer.id),
    loadMyOffers(viewer.id),
  ]);
  // Provider dashboard (Phase 4, spec S46): negotiations on this
  // provider's offers, with verification status alongside. The full
  // commercial view lives on /operations; this section keeps the
  // opportunity next to the offer it concerns.
  const negotiations = provider
    ? (await loadMyNegotiations(viewer.id)).filter((n) => n.providerId === provider.id)
    : [];

  const { edit } = await searchParams;
  const editing =
    edit && provider ? (offers.find((o) => o.id === edit) ?? (await loadOfferById(edit))) : null;
  const editingOwn = editing && editing.providerId === provider?.id ? editing : null;

  return (
    <div className='mx-auto max-w-6xl space-y-6 p-4 sm:p-6'>
      <header>
        <h1 className='text-2xl font-bold'>{t('title')}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>{t('intro')}</p>
      </header>

      <ProviderForm initial={provider} />

      {provider && (
        <>
          <section className='bg-card rounded-lg border p-4'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <h2 className='font-medium'>{t('verificationStatus')}</h2>
              <span className='text-sm'>{verificationLabel[provider.verificationStatus]}</span>
            </div>
            <p className='text-muted-foreground mt-1 text-sm'>{t('verificationIntro')}</p>
          </section>

          <section>
            <h2 className='font-medium'>{t('negotiationsTitle')}</h2>
            {negotiations.length === 0 ? (
              <p className='text-muted-foreground mt-2 text-sm'>{t('negotiationsEmpty')}</p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {negotiations.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/operations/${n.id}`}
                      className='bg-card hover:border-foreground/20 flex flex-wrap justify-between gap-2 rounded-lg border px-4 py-3 text-sm transition'
                    >
                      <span className='truncate'>
                        {n.offerTitle ?? n.sourcingQuery ?? tOps('negotiationFallback')}
                      </span>
                      <span className='text-muted-foreground shrink-0'>
                        {statusLabel[n.status]} ·{' '}
                        {new Date(n.createdAt).toLocaleDateString(locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <MyOffersList offers={offers} />
          <OfferForm initial={editingOwn} />
          {editing && !editingOwn && (
            <p className='text-destructive text-sm'>{t('offerNotYours')}</p>
          )}
          {!editing && offers.length > 0 && (
            <p className='text-muted-foreground text-sm'>{t('editHint')}</p>
          )}
        </>
      )}
    </div>
  );
}
