'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, Sparkles, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { DisciplineSearch } from './discipline-search';
import { OfferCard } from './offer-card';
import { loadMoreCatalogAction } from '@/modules/catalog/actions';
import type { AiSearchShaped } from '@/modules/catalog/ai-search';
import type { CatalogFilter, CatalogPage, Offer, OfferCategory } from '@/modules/catalog/types';
import { AVAILABILITY_STATUSES, OFFER_CATEGORIES } from '@/modules/catalog/filters';
import type { Discipline } from '@/modules/skills/types';
import { cn } from '@/lib/utils';

/**
 * The unified catalog board (Phase 2).
 *
 * Structured search and filtering over the unified catalog — category,
 * skills, location, availability, verification, Made in Cuba — reusing the
 * talent page's shape: filters live in the URL, the server re-renders, and
 * "load more" appends through a server action. The skill picker is the
 * existing DisciplineSearch (same component the team builder and the
 * profile editor use), fed with the re-seeded taxonomy.
 *
 * Semantic search sits below the structured results and is a separate,
 * explicit step: it calls /api/ai-search, which reaches the AI service
 * server-side. It searches talent profiles today — offer-level Pinecone
 * indexing is Phase 3, and the copy under the box says so rather than
 * implying the semantic results cover the whole catalog.
 */
export function CatalogBoard({
  initialPage,
  disciplines,
  filter,
}: {
  initialPage: CatalogPage;
  disciplines: Discipline[];
  filter: CatalogFilter;
}) {
  const t = useTranslations('catalog');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [navigating, startNavigation] = useTransition();

  const [searchDraft, setSearchDraft] = useState(filter.search ?? '');
  const [locationDraft, setLocationDraft] = useState(filter.location ?? '');
  const [showSkillPicker, setShowSkillPicker] = useState(false);

  const [extra, setExtra] = useState<Offer[]>([]);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const serverKey = JSON.stringify(filter);
  const [renderedKey, setRenderedKey] = useState(serverKey);
  if (renderedKey !== serverKey) {
    setRenderedKey(serverKey);
    setExtra([]);
    setCursor(initialPage.nextCursor);
    setHasMore(initialPage.hasMore);
  }

  const offers = useMemo(() => [...initialPage.offers, ...extra], [initialPage.offers, extra]);

  const [semanticQuery, setSemanticQuery] = useState('');
  const [semantic, setSemantic] = useState<AiSearchShaped | null>(null);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);

  const disciplineLabels = useMemo(
    () => Object.fromEntries(disciplines.map((d) => [d.slug, d.label])),
    [disciplines],
  );
  const activeSkills = filter.skills ?? [];

  const categoryLabel: Record<OfferCategory, string> = {
    talent: t('categoryTalent'),
    services: t('categoryServices'),
    products: t('categoryProducts'),
  };
  const availabilityLabel: Record<string, string> = {
    available: t('availabilityAvailable'),
    limited: t('availabilityLimited'),
    unavailable: t('availabilityUnavailable'),
  };

  const setParams = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    startNavigation(() => router.push(`/catalog?${params}`, { scroll: false }));
  };

  const toggleSkill = (slug: string) => {
    const next = activeSkills.includes(slug)
      ? activeSkills.filter((s) => s !== slug)
      : [...activeSkills, slug];
    setParams({ skills: next.length > 0 ? next.join(',') : null });
  };

  const loadMore = () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void loadMoreCatalogAction(cursor, filter).then((result) => {
      setLoadingMore(false);
      if (result.success !== true) {
        toast({ title: t('loadMoreFailed'), description: result.error, variant: 'destructive' });
        return;
      }
      setExtra((current) => {
        const seen = new Set([...initialPage.offers, ...current].map((o) => o.id));
        return [...current, ...result.data.offers.filter((o) => !seen.has(o.id))];
      });
      setCursor(result.data.nextCursor);
      setHasMore(result.data.hasMore);
    });
  };

  const runSemanticSearch = async () => {
    const q = semanticQuery.trim();
    if (q.length < 3) {
      setSemanticError(t('semanticMinLength'));
      return;
    }
    setSemanticLoading(true);
    setSemanticError(null);
    try {
      const response = await fetch(`/api/ai-search?q=${encodeURIComponent(q)}`);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setSemanticError(
          (payload as { error?: string } | null)?.error ?? t('semanticUnavailable'),
        );
        setSemantic(null);
        return;
      }
      setSemantic(payload as AiSearchShaped);
    } catch {
      setSemanticError(t('semanticUnavailable'));
      setSemantic(null);
    } finally {
      setSemanticLoading(false);
    }
  };

  const setCategory = (category: OfferCategory | null) => setParams({ category });

  return (
    <div className='space-y-6'>
      {/* ---- Structured filters ---- */}
      <section aria-label={t('filtersLabel')} className='bg-card space-y-3 rounded-lg border p-4'>
        <form
          className='flex flex-wrap gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: searchDraft.trim() || null, location: locationDraft.trim() || null });
          }}
        >
          <label className='sr-only' htmlFor='catalog-search'>
            {t('searchLabel')}
          </label>
          <input
            id='catalog-search'
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className='bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm'
          />
          <label className='sr-only' htmlFor='catalog-location'>
            {t('locationLabel')}
          </label>
          <input
            id='catalog-location'
            value={locationDraft}
            onChange={(e) => setLocationDraft(e.target.value)}
            placeholder={t('locationPlaceholder')}
            className='bg-background w-36 rounded-md border px-3 py-2 text-sm'
          />
          <button
            type='submit'
            disabled={navigating}
            className='bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50'
          >
            {t('search')}
          </button>
        </form>

        <div className='flex flex-wrap gap-2' role='group' aria-label={t('categoryLabel')}>
          <FilterChip active={!filter.category} onClick={() => setCategory(null)} label={t('all')} />
          {OFFER_CATEGORIES.map((category) => (
            <FilterChip
              key={category}
              active={filter.category === category}
              onClick={() => setCategory(category)}
              label={categoryLabel[category]}
            />
          ))}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <label htmlFor='catalog-availability' className='text-muted-foreground text-sm'>
            {t('availabilityLabel')}
          </label>
          <select
            id='catalog-availability'
            value={filter.availability ?? ''}
            onChange={(e) => setParams({ availability: e.target.value || null })}
            className='bg-background rounded-md border px-2 py-1.5 text-sm'
          >
            <option value=''>{t('availabilityAny')}</option>
            {AVAILABILITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {availabilityLabel[status] ?? status}
              </option>
            ))}
          </select>
          <label className='inline-flex items-center gap-1.5 text-sm'>
            <input
              type='checkbox'
              checked={filter.verifiedOnly === true}
              onChange={(e) => setParams({ verified: e.target.checked ? '1' : null })}
            />
            {t('verifiedOnly')}
          </label>
          <label className='inline-flex items-center gap-1.5 text-sm'>
            <input
              type='checkbox'
              checked={filter.madeInCubaOnly === true}
              onChange={(e) => setParams({ madeInCuba: e.target.checked ? '1' : null })}
            />
            {t('madeInCubaOnly')}
          </label>
        </div>

        <div>
          <button
            type='button'
            onClick={() => setShowSkillPicker((v) => !v)}
            className='text-primary text-sm font-medium underline-offset-4 hover:underline'
            aria-expanded={showSkillPicker}
          >
            {showSkillPicker ? t('hideSkillFilter') : t('filterBySkill')}
          </button>
          {activeSkills.length > 0 && (
            <div className='mt-2 flex flex-wrap gap-1.5'>
              {activeSkills.map((slug) => (
                <button
                  key={slug}
                  type='button'
                  onClick={() => toggleSkill(slug)}
                  className='bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium'
                  aria-label={t('removeSkill', { label: disciplineLabels[slug] ?? slug })}
                >
                  {disciplineLabels[slug] ?? slug}
                  <X className='h-3 w-3' aria-hidden />
                </button>
              ))}
            </div>
          )}
          {showSkillPicker && (
            <div className='mt-2'>
              <DisciplineSearch
                disciplines={disciplines}
                selected={activeSkills}
                allowCreate={false}
                autoFocus={false}
                onSelect={({ slug }) => toggleSkill(slug)}
                onCancel={() => setShowSkillPicker(false)}
              />
            </div>
          )}
        </div>
      </section>

      {/* ---- Structured results ---- */}
      {offers.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          {t('noResults')}
        </p>
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} />
          ))}
        </div>
      )}

      {hasMore && (
        <div className='flex justify-center'>
          <button
            type='button'
            onClick={loadMore}
            disabled={loadingMore}
            className='rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50'
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}

      {/* ---- Semantic search (AI) ---- */}
      <section
        aria-label={t('semanticTitle')}
        className='bg-card space-y-3 rounded-lg border p-4'
      >
        <h2 className='inline-flex items-center gap-2 text-base font-semibold'>
          <Sparkles className='text-primary h-4 w-4' aria-hidden />
          {t('semanticTitle')}
        </h2>
        <p className='text-muted-foreground text-sm'>{t('semanticIntro')}</p>
        <form
          className='flex flex-wrap gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            void runSemanticSearch();
          }}
        >
          <label className='sr-only' htmlFor='semantic-search'>
            {t('semanticTitle')}
          </label>
          <input
            id='semantic-search'
            value={semanticQuery}
            onChange={(e) => setSemanticQuery(e.target.value)}
            placeholder={t('semanticPlaceholder')}
            className='bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm'
          />
          <button
            type='submit'
            disabled={semanticLoading}
            className='bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50'
          >
            <Search className='h-4 w-4' aria-hidden />
            {semanticLoading ? t('searching') : t('search')}
          </button>
        </form>
        {semanticError && <p className='text-destructive text-sm'>{semanticError}</p>}
        {semantic && (
          <div className='space-y-2'>
            {semantic.suggestion && (
              <p className='text-muted-foreground text-sm'>{semantic.suggestion}</p>
            )}
            {semantic.results.length === 0 ? (
              <p className='text-muted-foreground text-sm'>{t('semanticNoResults')}</p>
            ) : (
              <ul className='space-y-2'>
                {semantic.results.map((result) => (
                  <li key={result.userId} className='rounded-md border p-3'>
                    <Link
                      href={`/profile/${result.username || result.userId}`}
                      className='text-primary font-medium hover:underline'
                    >
                      {result.username || t('talentProfile')}
                    </Link>
                    {result.bio && (
                      <p className='text-muted-foreground mt-0.5 line-clamp-2 text-sm'>
                        {result.bio}
                      </p>
                    )}
                    {result.tags.length > 0 && (
                      <p className='text-muted-foreground mt-1 text-xs'>
                        {result.tags.slice(0, 6).join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-3 py-1 text-sm font-medium',
        active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
      )}
    >
      {label}
    </button>
  );
}
