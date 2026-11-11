import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer } from '@/modules/identity/queries';
import { listDisciplines } from '@/modules/skills/queries';
import { loadCandidatePool } from '@/modules/talent/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { BriefComposer } from '@/components/tropical/brief-composer';
import { CreateSwitch } from '@/components/tropical/create-switch';
import { hasFeature } from '@/modules/tenancy/types';

/**
 * Named TropicalTalent on every white-label. generateMetadata rather than a static
 * object because the tenant is not known until the request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  return {
    title: 'Create',
    description: `Describe the work and ${tenant.name} builds the team.`,
  };
}

/**
 * Brand-side brief creation.
 *
 * The disciplines list and the talent pool are independent, so they load
 * concurrently — and both resolve on the server before the composer renders,
 * so the team builder has everything it needs the moment a crew is generated.
 * No client fetch happens anywhere in this flow.
 */
export default async function CreatePage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/create');
  // Talent have no use for this screen and would only see an empty crew
  // builder they cannot submit.
  if (!viewer.canBrand) redirect('/briefs');

  // getTenant is React.cache'd and already resolved by getViewer above, so this
  // costs nothing beyond making the dependency explicit.
  const [disciplines, pool, tenant] = await Promise.all([
    listDisciplines(),
    loadCandidatePool(viewer.id, viewer.tenantId),
    getTenant(),
  ]);

  // The fee this workspace actually charges. The composer used to show a
  // hardcoded 15% to every tenant, including ones on a different rate.
  const shared = {
    disciplines,
    candidatePool: pool.byDiscipline,
    roster: pool.roster,
    platformFeePct: tenant.platformFeePct,
  };

  // A workspace without `recurring` never sees the choice — offering a branch
  // that its own feature flags switch off would be a dead end, and the
  // fixed-price flow is unchanged for everyone there.
  return hasFeature(tenant, 'recurring') ? (
    <CreateSwitch {...shared} />
  ) : (
    <BriefComposer {...shared} />
  );
}
