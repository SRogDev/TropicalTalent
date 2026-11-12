'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { createOfferAction, updateOfferAction } from '@/modules/catalog/actions';
import { OFFER_CATEGORIES, AVAILABILITY_STATUSES, PRICING_BASES } from '@/modules/catalog/filters';
import type { Offer, OfferFormInput } from '@/modules/catalog/types';
import { cn } from '@/lib/utils';

/**
 * Create / edit an offer (Phase 2).
 *
 * One form for all three categories: the common fields are always shown,
 * the category-specific ones appear per category (data-model.md §3).
 * The form never sends verification fields — those do not exist here at
 * all, so a provider cannot smuggle a seal or a verified flag into a
 * request. `specifications` (products, free-form JSON) has no form field
 * yet: it is stored when supplied, but there is no honest UI for raw JSON
 * in this phase.
 */

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function attrString(attrs: Record<string, unknown>, key: string): string {
  const v = attrs[key];
  return typeof v === 'string' ? v : '';
}

function attrList(attrs: Record<string, unknown>, key: string): string {
  const v = attrs[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(', ') : '';
}

export function OfferForm({ initial }: { initial?: Offer | null }) {
  const t = useTranslations('offers');
  const tCatalog = useTranslations('catalog');
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attrs = initial?.attributes ?? {};
  const [category, setCategory] = useState<Offer['category']>(initial?.category ?? 'talent');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [skills, setSkills] = useState((initial?.skills ?? []).join(', '));
  const [languages, setLanguages] = useState((initial?.languages ?? []).join(', '));
  const [city, setCity] = useState(initial?.city ?? '');
  const [country, setCountry] = useState(initial?.country ?? 'Cuba');
  const [availability, setAvailability] = useState<Offer['availabilityStatus']>(
    initial?.availabilityStatus ?? 'available',
  );
  const [quantity, setQuantity] = useState(
    initial?.quantityAvailable !== null && initial?.quantityAvailable !== undefined
      ? String(initial.quantityAvailable)
      : '',
  );
  const [quantityUnit, setQuantityUnit] = useState(initial?.quantityUnit ?? '');
  const [capacityAmount, setCapacityAmount] = useState(
    typeof initial?.productionCapacity?.monthly_amount === 'number'
      ? String(initial.productionCapacity.monthly_amount)
      : '',
  );
  const [capacityUnit, setCapacityUnit] = useState(
    typeof initial?.productionCapacity?.unit === 'string'
      ? (initial.productionCapacity.unit as string)
      : '',
  );
  const [capacityLead, setCapacityLead] = useState(
    typeof initial?.productionCapacity?.lead_time_days === 'number'
      ? String(initial.productionCapacity.lead_time_days)
      : '',
  );
  const [pricingBasis, setPricingBasis] = useState<Offer['pricingBasis']>(
    initial?.pricingBasis ?? 'quote',
  );
  const [priceAmount, setPriceAmount] = useState(
    initial?.priceAmount !== null && initial?.priceAmount !== undefined
      ? String(initial.priceAmount)
      : '',
  );
  const [priceCurrency, setPriceCurrency] = useState(initial?.priceCurrency ?? 'USD');
  const [originCountry, setOriginCountry] = useState(initial?.originCountry ?? '');

  // Category-specific attributes.
  const [yearsExperience, setYearsExperience] = useState(
    typeof attrs.years_experience === 'number' ? String(attrs.years_experience) : '',
  );
  const [portfolioUrls, setPortfolioUrls] = useState(attrList(attrs, 'portfolio_urls'));
  const [talentAvailability, setTalentAvailability] = useState(attrString(attrs, 'availability'));
  const [scope, setScope] = useState(attrString(attrs, 'scope'));
  const [deliverables, setDeliverables] = useState(attrList(attrs, 'deliverables'));
  const [conditions, setConditions] = useState(attrString(attrs, 'conditions'));
  const [productOrigin, setProductOrigin] = useState(attrString(attrs, 'origin'));
  const [quality, setQuality] = useState(attrString(attrs, 'quality'));
  const [productAvailability, setProductAvailability] = useState(attrString(attrs, 'availability'));
  const [products, setProducts] = useState(attrList(attrs, 'products'));
  const [documentation, setDocumentation] = useState(attrList(attrs, 'documentation'));

  const categoryLabel: Record<Offer['category'], string> = {
    talent: tCatalog('categoryTalent'),
    services: tCatalog('categoryServices'),
    products: tCatalog('categoryProducts'),
  };
  const availabilityLabel: Record<Offer['availabilityStatus'], string> = {
    available: tCatalog('availabilityAvailable'),
    limited: tCatalog('availabilityLimited'),
    unavailable: tCatalog('availabilityUnavailable'),
  };
  const pricingLabel: Record<Offer['pricingBasis'], string> = {
    hour: t('pricingHour'),
    project: t('pricingProject'),
    unit: t('pricingUnit'),
    quote: t('pricingQuote'),
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const attributes: Record<string, unknown> = {};
    if (category === 'talent') {
      const years = Number(yearsExperience);
      if (yearsExperience.trim() !== '' && Number.isFinite(years))
        attributes.years_experience = years;
      if (portfolioUrls.trim()) attributes.portfolio_urls = splitList(portfolioUrls);
      if (talentAvailability.trim()) attributes.availability = talentAvailability.trim();
    } else if (category === 'services') {
      if (scope.trim()) attributes.scope = scope.trim();
      if (deliverables.trim()) attributes.deliverables = splitList(deliverables);
      if (conditions.trim()) attributes.conditions = conditions.trim();
    } else {
      if (productOrigin.trim()) attributes.origin = productOrigin.trim();
      if (quality.trim()) attributes.quality = quality.trim();
      if (productAvailability.trim()) attributes.availability = productAvailability.trim();
      if (products.trim()) attributes.products = splitList(products);
      if (documentation.trim()) attributes.documentation = splitList(documentation);
    }

    const capacity =
      category === 'products' && capacityAmount.trim() !== ''
        ? {
            monthly_amount: Number(capacityAmount),
            unit: capacityUnit.trim(),
            ...(capacityLead.trim() !== '' ? { lead_time_days: Number(capacityLead) } : {}),
          }
        : null;

    const input: OfferFormInput = {
      category,
      title,
      description,
      skills: splitList(skills),
      languages: splitList(languages),
      city,
      country,
      availabilityStatus: availability,
      quantityAvailable: quantity.trim() !== '' ? Number(quantity) : null,
      quantityUnit,
      productionCapacity: capacity,
      pricingBasis,
      priceAmount: priceAmount.trim() !== '' ? Number(priceAmount) : null,
      priceCurrency,
      originCountry,
      attributes,
    };

    const call = initial ? updateOfferAction(initial.id, input) : createOfferAction(input);

    void call.then((result) => {
      setSaving(false);
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      toast({ title: initial ? t('updatedOffer') : t('createdOffer') });
      startTransition(() => router.push('/offers'));
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className='bg-card space-y-4 rounded-lg border p-4'>
      <h2 className='text-base font-semibold'>{initial ? t('editOffer') : t('newOffer')}</h2>
      {error && <p className='text-destructive text-sm'>{error}</p>}

      <div>
        <label htmlFor='offer-category' className='text-sm font-medium'>
          {t('category')}
        </label>
        <select
          id='offer-category'
          value={category}
          disabled={Boolean(initial)}
          onChange={(e) => setCategory(e.target.value as Offer['category'])}
          className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60'
        >
          {OFFER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel[c]}
            </option>
          ))}
        </select>
        {initial && <p className='text-muted-foreground mt-1 text-xs'>{t('categoryFixed')}</p>}
      </div>

      <Field label={t('title')} htmlFor='offer-title'>
        <input
          id='offer-title'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
        />
      </Field>

      <Field label={t('description')} htmlFor='offer-description'>
        <textarea
          id='offer-description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={5000}
          className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
        />
      </Field>

      <div className='grid gap-4 sm:grid-cols-2'>
        <Field label={t('skills')} htmlFor='offer-skills'>
          <input
            id='offer-skills'
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder={t('skillsPlaceholder')}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </Field>
        <Field label={t('languages')} htmlFor='offer-languages'>
          <input
            id='offer-languages'
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            placeholder={t('languagesPlaceholder')}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </Field>
        <Field label={t('city')} htmlFor='offer-city'>
          <input
            id='offer-city'
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </Field>
        <Field label={t('country')} htmlFor='offer-country'>
          <input
            id='offer-country'
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          />
        </Field>
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <Field label={t('availability')} htmlFor='offer-availability'>
          <select
            id='offer-availability'
            value={availability}
            onChange={(e) => setAvailability(e.target.value as Offer['availabilityStatus'])}
            className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
          >
            {AVAILABILITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {availabilityLabel[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('pricing')} htmlFor='offer-pricing'>
          <span className='mt-1 flex flex-wrap gap-2'>
            <select
              id='offer-pricing'
              value={pricingBasis}
              onChange={(e) => setPricingBasis(e.target.value as Offer['pricingBasis'])}
              className='bg-background rounded-md border px-2 py-2 text-sm'
            >
              {PRICING_BASES.map((b) => (
                <option key={b} value={b}>
                  {pricingLabel[b]}
                </option>
              ))}
            </select>
            <input
              value={priceAmount}
              onChange={(e) => setPriceAmount(e.target.value)}
              inputMode='decimal'
              placeholder={t('priceAmountPlaceholder')}
              disabled={pricingBasis === 'quote'}
              aria-label={t('priceAmountLabel')}
              className='bg-background w-28 rounded-md border px-3 py-2 text-sm disabled:opacity-50'
            />
            <input
              value={priceCurrency}
              onChange={(e) => setPriceCurrency(e.target.value)}
              aria-label={t('priceCurrencyLabel')}
              className='bg-background w-20 rounded-md border px-3 py-2 text-sm'
            />
          </span>
        </Field>
      </div>

      <Field label={t('originCountry')} htmlFor='offer-origin'>
        <input
          id='offer-origin'
          value={originCountry}
          onChange={(e) => setOriginCountry(e.target.value)}
          placeholder={t('originPlaceholder')}
          className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
        />
        <p className='text-muted-foreground mt-1 text-xs'>{t('originNote')}</p>
      </Field>

      {category === 'talent' && (
        <fieldset className='space-y-4 rounded-md border p-3'>
          <legend className='px-1 text-sm font-medium'>{t('talentDetails')}</legend>
          <Field label={t('yearsExperience')} htmlFor='offer-years'>
            <input
              id='offer-years'
              value={yearsExperience}
              onChange={(e) => setYearsExperience(e.target.value)}
              inputMode='numeric'
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
          <Field label={t('portfolioUrls')} htmlFor='offer-portfolio'>
            <input
              id='offer-portfolio'
              value={portfolioUrls}
              onChange={(e) => setPortfolioUrls(e.target.value)}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
          <Field label={t('talentAvailability')} htmlFor='offer-talent-availability'>
            <input
              id='offer-talent-availability'
              value={talentAvailability}
              onChange={(e) => setTalentAvailability(e.target.value)}
              placeholder={t('talentAvailabilityPlaceholder')}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
        </fieldset>
      )}

      {category === 'services' && (
        <fieldset className='space-y-4 rounded-md border p-3'>
          <legend className='px-1 text-sm font-medium'>{t('serviceDetails')}</legend>
          <Field label={t('scope')} htmlFor='offer-scope'>
            <textarea
              id='offer-scope'
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={2}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
          <Field label={t('deliverables')} htmlFor='offer-deliverables'>
            <input
              id='offer-deliverables'
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value)}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
          <Field label={t('conditions')} htmlFor='offer-conditions'>
            <input
              id='offer-conditions'
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder={t('conditionsPlaceholder')}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
        </fieldset>
      )}

      {category === 'products' && (
        <fieldset className='space-y-4 rounded-md border p-3'>
          <legend className='px-1 text-sm font-medium'>{t('productDetails')}</legend>
          <div className='grid gap-4 sm:grid-cols-3'>
            <Field label={t('quantityAvailable')} htmlFor='offer-quantity'>
              <input
                id='offer-quantity'
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode='numeric'
                className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
              />
            </Field>
            <Field label={t('quantityUnit')} htmlFor='offer-quantity-unit'>
              <input
                id='offer-quantity-unit'
                value={quantityUnit}
                onChange={(e) => setQuantityUnit(e.target.value)}
                placeholder={t('quantityUnitPlaceholder')}
                className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
              />
            </Field>
            <Field label={t('leadTime')} htmlFor='offer-lead'>
              <input
                id='offer-lead'
                value={capacityLead}
                onChange={(e) => setCapacityLead(e.target.value)}
                inputMode='numeric'
                className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
              />
            </Field>
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field label={t('monthlyCapacity')} htmlFor='offer-capacity'>
              <input
                id='offer-capacity'
                value={capacityAmount}
                onChange={(e) => setCapacityAmount(e.target.value)}
                inputMode='numeric'
                className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
              />
            </Field>
            <Field label={t('capacityUnit')} htmlFor='offer-capacity-unit'>
              <input
                id='offer-capacity-unit'
                value={capacityUnit}
                onChange={(e) => setCapacityUnit(e.target.value)}
                placeholder={t('capacityUnitPlaceholder')}
                className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
              />
            </Field>
          </div>
          <Field label={t('originDetail')} htmlFor='offer-product-origin'>
            <input
              id='offer-product-origin'
              value={productOrigin}
              onChange={(e) => setProductOrigin(e.target.value)}
              placeholder={t('originDetailPlaceholder')}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field label={t('qualityNote')} htmlFor='offer-quality'>
              <input
                id='offer-quality'
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
              />
            </Field>
            <Field label={t('productAvailability')} htmlFor='offer-product-availability'>
              <input
                id='offer-product-availability'
                value={productAvailability}
                onChange={(e) => setProductAvailability(e.target.value)}
                placeholder={t('productAvailabilityPlaceholder')}
                className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
              />
            </Field>
          </div>
          <Field label={t('products')} htmlFor='offer-products'>
            <input
              id='offer-products'
              value={products}
              onChange={(e) => setProducts(e.target.value)}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
          <Field label={t('documentation')} htmlFor='offer-documentation'>
            <input
              id='offer-documentation'
              value={documentation}
              onChange={(e) => setDocumentation(e.target.value)}
              placeholder={t('documentationPlaceholder')}
              className='bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm'
            />
          </Field>
          <p className='text-muted-foreground text-xs'>{t('productsNote')}</p>
        </fieldset>
      )}

      <button
        type='submit'
        disabled={saving}
        className={cn(
          'bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium',
          saving && 'opacity-50',
        )}
      >
        {saving ? t('saving') : initial ? t('saveChanges') : t('createDraft')}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className='text-sm font-medium'>
        {label}
      </label>
      {children}
    </div>
  );
}
