import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfileRefs, getViewer, profileRefsKey } from '@/modules/identity/queries';
import { loadDeleteRequest, loadProjectPage } from '@/modules/projects/queries';
import { isEscrowPaid } from '@/modules/projects/types';
import {
  loadDeliverables,
  loadProjectMessages,
  loadRoleContracts,
  loadUnreadCounts,
} from '@/modules/chat/queries';
import { loadApplicants } from '@/modules/briefs/queries';
import { disciplineLabels } from '@/modules/skills/queries';
import { loadFavouriteIds, loadProjectFeedback } from '@/modules/talent/queries';
import {
  loadBillingProfile,
  loadProjectPeriods,
  loadRecurringTerms,
} from '@/modules/recurring/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { ProjectWorkspaceView } from '@/components/tropical/project-workspace';

/** What a talent is handed instead of the brand's billing details. */
const EMPTY_BILLING = {
  hasCard: false,
  cardBrand: null,
  cardLast4: null,
  cardExpMonth: null,
  cardExpYear: null,
  updatedAt: null,
};

export const metadata: Metadata = {
  title: 'Project',
  description: 'Project workspace - crew, contracts and channels.',
};

/**
 * The project workspace.
 *
 * Two rounds of concurrency:
 *
 *   1. The project and the viewer, together.
 *   2. Then everything that needs the project id — messages, deliverables,
 *      contracts, applicants, discipline labels — all at once.
 *
 * Messages for EVERY channel arrive in one query rather than one per channel,
 * so switching channels in the UI costs nothing.
 *
 * Applicants are loaded only for the brand: a talent cannot read them (RLS
 * would return nothing) and the query would be a wasted round trip.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  const [{ id }, { channel }] = await Promise.all([params, searchParams]);

  const viewer = await getViewer();
  if (!viewer) redirect(`/auth/sign-in?next=/projects/${id}`);

  const page = await loadProjectPage(id);
  // RLS makes "does not exist" and "not a member" indistinguishable, which is
  // deliberate — a non-member must not be able to probe for private projects.
  if (!page) notFound();

  const { workspace, isBrand } = page;
  const escrowPaid = isEscrowPaid(workspace);

  // Feedback and favourites are brand-only and only ever needed once the
  // project is complete — no sense paying for either read otherwise.
  const feedbackEligible = isBrand && workspace.status === 'completed';

  const [
    initialMessages,
    deliverables,
    roleContracts,
    applicants,
    labels,
    unreadByChannel,
    feedback,
    favouriteIds,
    periods,
    recurringTerms,
    billing,
    deleteRequest,
  ] = await Promise.all([
    loadProjectMessages(workspace.id),
    loadDeliverables(workspace.id),
    loadRoleContracts(workspace.id, viewer.id, isBrand),
    isBrand ? loadApplicants(workspace.id) : Promise.resolve([]),
    disciplineLabels(),
    loadUnreadCounts(workspace.id),
    feedbackEligible ? loadProjectFeedback(workspace.id) : Promise.resolve({}),
    feedbackEligible ? loadFavouriteIds(viewer.id) : Promise.resolve([]),
    // Joins the round already in flight rather than adding a second one. Both
    // return nothing for a project with no retainer, which is every project
    // that existed before migration 027.
    loadProjectPeriods(workspace.id),
    loadRecurringTerms(workspace.id),
    // Brand-only: whether their card is on file is the question the retainer
    // set-up screen exists to answer, and it is none of a talent's business.
    // getTenant is React.cache'd and already resolved, so this is one query.
    isBrand
      ? getTenant().then((tenant) => loadBillingProfile(viewer.id, tenant.id))
      : Promise.resolve(EMPTY_BILLING),
    // Brand-only. 044's read policy would return nothing for anyone else, so
    // this skips a round trip rather than adding a guard the database already
    // enforces.
    isBrand ? loadDeleteRequest(workspace.id) : Promise.resolve(null),
  ]);

  // Profiles for message authors and crew, resolved once rather than per row.
  const profilesById = await getProfileRefs(
    profileRefsKey([
      ...Object.values(initialMessages)
        .flat()
        .map((m) => m.sender_id),
      ...workspace.members.map((m) => m.user_id),
    ]),
  );

  const botChannel = workspace.channels.find((c) => c.type === 'bot');
  const initialChannelId =
    (channel && workspace.channels.some((c) => c.id === channel) ? channel : null) ??
    // A talent has no Project Admin channel, so they land on their own DM
    // (or the group channel once it opens) rather than an empty selection.
    botChannel?.id ??
    workspace.channels.find((c) => c.type === 'dm')?.id ??
    workspace.channels[0]?.id ??
    '';

  return (
    <ProjectWorkspaceView
      workspace={workspace}
      initialMessages={initialMessages}
      currentUserId={viewer.id}
      isBrand={isBrand}
      initialChannelId={initialChannelId}
      profilesById={profilesById}
      deliverables={deliverables}
      roleContracts={roleContracts}
      applicants={applicants}
      disciplineLabels={labels}
      escrowPaid={escrowPaid}
      unreadByChannel={unreadByChannel}
      feedback={feedback}
      favouriteIds={favouriteIds}
      periods={periods}
      recurringTerms={recurringTerms}
      billing={billing}
      deleteRequest={deleteRequest}
    />
  );
}
