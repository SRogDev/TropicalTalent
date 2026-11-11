import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Compass } from 'lucide-react';
import { getViewer } from '@/modules/identity/queries';
import { briefsFilterKey, loadBriefsPage } from '@/modules/briefs/queries';
import { disciplineLabels } from '@/modules/skills/queries';
import { BriefCard } from '@/components/tropical/brief-card';
import { BriefSearch } from '@/components/tropical/brief-search';
import { getTenant } from '@/modules/tenancy/queries';
import { hasFeature } from '@/modules/tenancy/types';

export const metadata: Metadata = {
  title: 'Briefs',
  description: 'Public project briefs looking for crew.',
};

/** The public briefs feed — the talent-side discovery surface. */
export default async function BriefsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; open?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/briefs');
  if (!viewer.isCreative) redirect('/projects');

  // The tenant may not have a brief feed at all. Gating the nav is not enough:
  // the post-auth redirect, a bookmark, or a link in an old email all arrive
  // here directly, and an empty feed on a site that never had one reads as a
  // broken page rather than a disabled feature.
  const tenant = await getTenant();
  if (!hasFeature(tenant, 'publicBriefs')) redirect('/jobs');

  const { q, open } = await searchParams;
  const filterKey = briefsFilterKey({ search: q, openOnly: open !== 'all' });

  const [page, labels] = await Promise.all([loadBriefsPage(filterKey), disciplineLabels()]);
  if (!page) redirect('/auth/sign-in?next=/briefs');

  return (
    <div className='mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10'>
      <header className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <div className='glass text-accent inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] tracking-[0.18em] uppercase'>
            <Compass size={12} /> Open briefs
          </div>
          <h1 className='mt-4 text-2xl font-semibold tracking-tight sm:text-3xl'>
            Work tuned to <span className='text-gradient-brand'>you</span>.
          </h1>
        </div>
        {page.myDisciplines.length > 0 && (
          <p className='text-muted-foreground hidden text-xs md:block'>
            Matching{' '}
            {page.myDisciplines
              .slice(0, 3)
              .map((s) => labels[s] ?? s)
              .join(' · ')}
          </p>
        )}
      </header>

      <div className='mt-6'>
        <BriefSearch defaultValue={q ?? ''} showAll={open === 'all'} />
      </div>

      {page.briefs.length === 0 ? (
        <div className='glass mt-8 rounded-2xl p-8 text-center sm:p-10'>
          <p className='text-muted-foreground text-sm'>
            {q
              ? 'No briefs match that search.'
              : 'No open briefs right now. New work appears here as brands post it.'}
          </p>
        </div>
      ) : (
        <div className='mt-6 gap-5 [column-fill:_balance] md:columns-2 lg:columns-3'>
          {page.briefs.map((brief) => (
            <BriefCard
              key={brief.id}
              brief={brief}
              myDisciplines={page.myDisciplines}
              appliedRoles={page.appliedRoles}
              disciplineLabels={labels}
            />
          ))}
        </div>
      )}
    </div>
  );
}
