'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/supabase';
import { fail, ok, one, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { sendNotificationEmail } from '@/modules/notifications/email';
import { loadTalent, talentFilterKey } from './queries';
import type { TalentFilter, TalentPage } from './types';

/**
 * Favouriting, paging and inviting.
 *
 * Favourite and invite are brand-side actions from the Talent page. Neither
 * touches money, so neither is gated on escrow — an invitation is a request,
 * and the talent still has to accept it.
 */

/**
 * The next page of the Talent board.
 *
 * The board rendered only the first page and had no way to ask for a second,
 * so on a roster of 37 talent, 13 of them were unreachable — the missing
 * people were not filtered out, they were simply never requested.
 *
 * An action rather than a URL cursor because appending to the list is what the
 * user means: a `?cursor=` navigation would replace the page they are looking
 * at with the one after it, and the back button would then walk them through
 * every page they had scrolled past.
 */
export async function loadMoreTalentAction(
  cursor: string,
  filter: TalentFilter,
): Promise<ActionResult<TalentPage>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.canBrand) return fail('Only brands can browse talent.');

  // The filter is rebuilt from its parts rather than trusted as given — this
  // is a public endpoint, and talentFilterKey is what the query reads.
  const page = await loadTalent(
    viewer.id,
    viewer.tenantId,
    cursor,
    talentFilterKey({
      search: typeof filter?.search === 'string' ? filter.search : undefined,
      disciplines: Array.isArray(filter?.disciplines)
        ? filter.disciplines.filter((d): d is string => typeof d === 'string')
        : undefined,
      favouritesOnly: filter?.favouritesOnly === true,
    }),
  );

  return ok(page);
}

export async function toggleFavouriteAction(
  creativeId: string,
): Promise<ActionResult<{ isFavourite: boolean }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (creativeId === viewer.id) return fail('You cannot favourite yourself.');

  const supabase = await db();

  const { data: existing } = await supabase
    .from('tropical_favourites')
    .select('id')
    .eq('user_id', viewer.id)
    .eq('creative_id', creativeId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('tropical_favourites').delete().eq('id', existing.id);
    if (error) return fail(error.message);
    revalidatePath('/talent');
    return ok({ isFavourite: false });
  }

  const { error } = await supabase
    .from('tropical_favourites')
    .insert({ user_id: viewer.id, creative_id: creativeId });

  // 23505 means a parallel click already inserted it. The end state is what
  // the user asked for, so report success rather than a constraint error.
  if (error && error.code !== '23505') return fail(error.message);

  revalidatePath('/talent');
  return ok({ isFavourite: true });
}

/**
 * Recommend / don't recommend a talent on a completed project.
 *
 * One verdict per (project, talent) — working together again opens a fresh
 * one rather than overwriting the last. `recommend: null` clears it.
 *
 * Re-checks everything the UI already gates on, since this is a public HTTP
 * endpoint: the caller must be the project's brand, the project must be
 * completed, and the talent must actually hold a released role on it — a
 * brand cannot leave feedback for someone they never worked with.
 */
export async function setFeedbackAction(
  projectId: string,
  creativeId: string,
  recommend: boolean | null,
): Promise<ActionResult<{ recommend: boolean | null }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();

  const { data: project } = await supabase
    .from('tropical_projects')
    .select('id, brand_id, status')
    .eq('id', projectId)
    .maybeSingle();

  if (!project || project.brand_id !== viewer.id) return fail('Project not found.');
  if (project.status !== 'completed') {
    return fail('Feedback opens once the project is complete.');
  }

  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select('id')
    .eq('project_id', projectId)
    .eq('assigned_user_id', creativeId)
    .eq('status', 'released')
    .maybeSingle();

  if (!role) return fail('This creative did not complete a role on this project.');

  if (recommend === null) {
    const { error } = await supabase
      .from('tropical_creative_feedback')
      .delete()
      .eq('project_id', projectId)
      .eq('creative_id', creativeId);
    if (error) return fail(error.message);
    revalidatePath(`/projects/${projectId}`);
    return ok({ recommend: null });
  }

  const { error } = await supabase.from('tropical_creative_feedback').upsert(
    {
      project_id: projectId,
      brand_id: viewer.id,
      creative_id: creativeId,
      recommend,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,creative_id' },
  );

  if (error) return fail(error.message);

  revalidatePath(`/projects/${projectId}`);
  return ok({ recommend });
}

/**
 * Invites a talent onto an open role.
 *
 * Assigning also opens the role's DM channel and adds project membership, so
 * it goes through the same RPC the accept-application path uses — one
 * transaction, no half-invited state.
 */
export async function inviteToRoleAction(
  roleId: string,
  creativeId: string,
): Promise<ActionResult<{ projectId: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.canBrand) return fail('This account cannot invite creatives.');
  // Reachable now that talent hire too. Assigning yourself a role on your
  // own project would have you fund escrow to yourself and collect your own
  // budget back minus the fee, which is not a job — it is a round trip.
  if (creativeId === viewer.id) {
    return fail('You cannot assign yourself to a role on your own project.');
  }

  const supabase = await db();

  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select(
      'id, project_id, status, title, project:tropical_projects!tropical_project_roles_project_id_fkey(name, tenant_id)',
    )
    .eq('id', roleId)
    .maybeSingle();

  if (!role) return fail('That role no longer exists.');
  if (role.status !== 'open') return fail('That role has already been filled.');

  // The invitee has to be a member of the project's own workspace.
  //
  // The Talent board only ever offers same-tenant people, but a server action
  // is a public HTTP endpoint and tropical_assign_role is SECURITY DEFINER — so
  // the board is not the boundary. Without this, any id pasted into the request
  // could be pulled into a customer's project, past the RLS that exists to keep
  // tenants apart. Migration 032 enforces the same rule for roles pre-assigned
  // at project creation.
  const projectRow = one<{ name: string; tenant_id: string }>(role.project);
  const { data: memberOfTenant } = await supabase.rpc('tropical_is_tenant_member', {
    p_tenant: projectRow?.tenant_id,
    p_user: creativeId,
  });
  if (memberOfTenant !== true) {
    return fail('That person is not a member of this workspace.');
  }

  const { error } = await supabase.rpc('tropical_assign_role', {
    p_role: roleId,
    p_user: creativeId,
  });

  if (error) return fail(error.message);

  await sendNotificationEmail({
    userId: creativeId,
    kind: 'role_invited',
    subject: `You're invited - ${role.title}`,
    body: `You were invited to ${role.title} on ${projectRow?.name ?? 'a project'}.`,
    path: '/jobs',
  });

  revalidatePath('/talent');
  revalidatePath(`/projects/${role.project_id}`);
  return ok({ projectId: role.project_id as string });
}
