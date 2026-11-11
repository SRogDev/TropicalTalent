import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer } from '@/modules/identity/queries';
import { listDisciplines } from '@/modules/skills/queries';
import {
  loadInvitableProjects,
  loadTalent,
  pickSpotlight,
  talentFilterKey,
} from '@/modules/talent/queries';
import { TalentBoard } from '@/components/tropical/talent-board';
import { getTenant } from '@/modules/tenancy/queries';
import { hasFeature } from '@/modules/tenancy/types';

export const metadata: Metadata = {
  title: 'Talent',
  description: 'Find talent, save your favourites, and invite them to your briefs.',
};

/**
 * The Talent page — the brand-side discovery surface, reintroduced from the
 * archived Discover page and rebuilt on the tropical data model.
 *
 * Filters live in the URL rather than in component state: a filtered view is
 * shareable, survives a refresh, and re-renders on the server without the
 * client holding a second copy of the query.
 */
export default async function TalentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; skills?: string; favourites?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/talent');
  if (!viewer.canBrand) redirect('/projects');

  // Same reasoning as /briefs: a tenant with talentBrowse off has no roster
  // screen, however you arrive at the URL.
  const tenant = await getTenant();
  if (!hasFeature(tenant, 'talentBrowse')) redirect('/projects');

  const { q, skills, favourites } = await searchParams;

  const filter = {
    search: q,
    disciplines: skills ? skills.split(',').filter(Boolean) : undefined,
    favouritesOnly: favourites === '1',
  };

  const [page, disciplines, projects] = await Promise.all([
    loadTalent(viewer.id, viewer.tenantId, null, talentFilterKey(filter)),
    listDisciplines(),
    loadInvitableProjects(viewer.id),
  ]);

  // Drawn from the first page rather than a second query — the spotlight is a
  // presentation choice, not a reason to hit the database again.
  const spotlight = pickSpotlight(page.candidates);

  return (
    <TalentBoard
      initialPage={page}
      disciplines={disciplines}
      projects={projects}
      filter={filter}
      spotlight={spotlight}
    />
  );
}
