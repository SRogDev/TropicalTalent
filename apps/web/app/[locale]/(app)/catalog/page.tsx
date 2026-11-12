import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getViewer } from '@/modules/identity/queries';
import { listDisciplines } from '@/modules/skills/queries';
import { loadCatalog } from '@/modules/catalog/queries';
import { catalogFilterKey, parseCatalogFilter } from '@/modules/catalog/filters';
import { CatalogBoard } from '@/components/tropical/catalog-board';

export const metadata: Metadata = {
  title: 'Catalog',
  description:
    'One catalog for Cuban talent, services, products, and production — search, filter, and discover.',
};

/**
 * The unified catalog page (Phase 2).
 *
 * One consistent discovery experience for all three categories (plan §3,
 * spec S14), with contextual filters and category-specific information on
 * each card. Filters live in the URL, like the Talent page: a filtered
 * view is shareable, survives a refresh, and re-renders on the server.
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    skills?: string;
    location?: string;
    availability?: string;
    verified?: string;
    madeInCuba?: string;
  }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/catalog');

  const t = await getTranslations('catalog');
  const params = await searchParams;
  const filter = parseCatalogFilter(params);

  const [page, disciplines] = await Promise.all([
    loadCatalog(null, catalogFilterKey(filter)),
    listDisciplines(),
  ]);

  return (
    <div className='mx-auto max-w-6xl space-y-6 p-4 sm:p-6'>
      <header>
        <h1 className='text-2xl font-bold'>{t('title')}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>{t('intro')}</p>
      </header>
      <CatalogBoard initialPage={page} disciplines={disciplines} filter={filter} />
    </div>
  );
}
