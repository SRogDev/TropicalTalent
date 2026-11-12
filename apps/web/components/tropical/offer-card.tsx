'use client';

import { BadgeCheck, MapPin, Package, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { Offer } from '@/modules/catalog/types';
import { RequestQuotationButton } from './request-quotation-button';

/**
 * One catalog offer.
 *
 * New in Phase 2 — there was no offer card in the tree (talent-tile is a
 * person, brief-card is a brief). The card shows everything a buyer needs
 * for a first judgement: what it is, who offers it, where, whether it is
 * available, what it costs (or that the price is on request), and the two
 * trust signals — provider verification and the Made in Cuba seal.
 *
 * The seal marks ORIGIN, not quality (data-model.md §2): it renders only
 * when `made_in_cuba` is true, which the database only allows with
 * verified origin, and it is labelled as origin, never as quality.
 * Availability is the provider's stated availability only — the card never
 * implies a product can be exported, paid for, or delivered (plan §7).
 */

export function OfferCard({ offer }: { offer: Offer }) {
  const t = useTranslations('catalog');
  const tSeal = useTranslations('seal');
  const provider = offer.provider;

  const categoryLabel: Record<Offer['category'], string> = {
    talent: t('offerCategoryTalent'),
    services: t('offerCategoryServices'),
    products: t('offerCategoryProducts'),
  };
  const availabilityLabel: Record<Offer['availabilityStatus'], string> = {
    available: t('offerAvailabilityAvailable'),
    limited: t('offerAvailabilityLimited'),
    unavailable: t('offerAvailabilityUnavailable'),
  };
  const pricingLabel: Record<Offer['pricingBasis'], string> = {
    hour: t('pricingPerHour'),
    project: t('pricingPerProject'),
    unit: t('pricingPerUnit'),
    quote: t('pricingQuote'),
  };

  const priceLabel = (): string => {
    if (offer.pricingBasis === 'quote' || offer.priceAmount === null) return t('pricingQuote');
    return `${offer.priceCurrency} ${offer.priceAmount.toFixed(2)} ${pricingLabel[offer.pricingBasis]}`;
  };

  const capacityLabel = (): string | null => {
    const capacity = offer.productionCapacity;
    if (!capacity) return null;
    const amount = capacity.monthly_amount;
    const unit = capacity.unit;
    if (typeof amount !== 'number' || typeof unit !== 'string') return null;
    const lead =
      typeof capacity.lead_time_days === 'number'
        ? t('capacityLead', { days: capacity.lead_time_days })
        : '';
    return t('capacity', { amount, unit }) + lead;
  };

  return (
    <article className='bg-card rounded-lg border p-4 shadow-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-medium'>
          {categoryLabel[offer.category]}
        </span>
        {offer.madeInCuba && (
          <span
            className='inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100'
            title={tSeal('verifiedOrigin')}
          >
            <Sparkles className='h-3 w-3' aria-hidden />
            {tSeal('label')}
          </span>
        )}
        <span
          className={cn(
            'ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium',
            offer.availabilityStatus === 'available' &&
              'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
            offer.availabilityStatus === 'limited' &&
              'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
            offer.availabilityStatus === 'unavailable' &&
              'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
          )}
        >
          {availabilityLabel[offer.availabilityStatus]}
        </span>
      </div>

      <h3 className='mt-3 text-base font-semibold'>{offer.title}</h3>
      {offer.description && (
        <p className='text-muted-foreground mt-1 line-clamp-3 text-sm'>{offer.description}</p>
      )}

      <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
        {provider && (
          <span className='inline-flex items-center gap-1 font-medium'>
            {provider.displayName}
            {provider.verificationStatus === 'verified' && (
              <BadgeCheck className='h-4 w-4 text-emerald-600' aria-label={t('verifiedProvider')} />
            )}
          </span>
        )}
        {(offer.city || offer.country) && (
          <span className='text-muted-foreground inline-flex items-center gap-1'>
            <MapPin className='h-3.5 w-3.5' aria-hidden />
            {[offer.city, offer.country].filter(Boolean).join(', ')}
          </span>
        )}
        <span className='font-medium'>{priceLabel()}</span>
      </div>

      {offer.category === 'products' && (
        <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
          <span className='inline-flex items-center gap-1'>
            <Package className='h-3.5 w-3.5' aria-hidden />
            {offer.quantityAvailable !== null
              ? t('offerQuantityAvailable', {
                  amount: offer.quantityAvailable,
                  unit: offer.quantityUnit ? ` ${offer.quantityUnit}` : '',
                })
              : t('offerQuantityOnRequest')}
          </span>
          {capacityLabel() && <span>{capacityLabel()}</span>}
          {offer.originCountry && <span>{t('offerOrigin', { country: offer.originCountry })}</span>}
        </div>
      )}

      {offer.skills.length > 0 && (
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {offer.skills.slice(0, 6).map((skill) => (
            <span
              key={skill}
              className='bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs'
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {offer.provider?.verificationStatus === 'pending' && (
        <p className='text-muted-foreground mt-3 text-xs'>{t('offerVerificationPending')}</p>
      )}

      {/* Request a quotation — opens a mediated negotiation (Phase 4).
          Only on published offers: drafts render through MyOffersList,
          not this card, and the action refuses anything unpublished. */}
      {offer.status === 'published' && (
        <div className='mt-3'>
          <RequestQuotationButton offerId={offer.id} />
        </div>
      )}
    </article>
  );
}
