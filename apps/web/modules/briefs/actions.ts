'use server';

import { revalidatePath } from 'next/cache';
import { adminDb, db } from '@/lib/supabase';
import { fail, ok, one, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { listMyDisciplines } from '@/modules/skills/queries';
import { sendNotificationEmail } from '@/modules/notifications/email';

/**
 * Applying to a brief, and the brand's response to it.
 *
 * ---------------------------------------------------------------------------
 * Skill gating
 * ---------------------------------------------------------------------------
 * Previously the Apply button only rendered for roles whose discipline was
 * already on the talent's profile. Anyone whose profile lagged behind their
 * actual skills simply could not apply, and nothing told them why.
 *
 * Now a talent may apply to any open role. If they do not list the role's
 * discipline, the application is stored as `pending_skill` with the discipline
 * recorded on it — the brand does not see it yet, and the talent is prompted
 * to add the skill.
 *
 * The release is not polled. A trigger on `tropical_creative_disciplines`
 * (migration 011) fires the moment the skill lands on their profile, flips
 * every matching `pending_skill` row to `pending`, and notifies the brand.
 * That works no matter how the skill was added — profile editor, sign-up, or
 * a future import.
 */
export async function applyToRoleAction(
  projectId: string,
  roleId: string,
  note?: string,
): Promise<ActionResult<{ applicationId: string; status: 'pending' | 'pending_skill' }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in to apply.');
  if (!viewer.isCreative) return fail('Brand accounts cannot apply to briefs.');

  const supabase = await db();

  // Validate against the public view — the only project data a non-member may
  // read. Going to tropical_projects here would return nothing and look like the
  // brief did not exist.
  const { data: brief } = await supabase
    .from('tropical_public_briefs')
    .select('id, name, roles, brand_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!brief) return fail('That brief is no longer open.');
  if (brief.brand_id === viewer.id) return fail('You cannot apply to your own brief.');

  const role = (
    brief.roles as Array<{ id: string; title: string; status: string; discipline: string | null }>
  ).find((r) => r.id === roleId);

  if (!role) return fail('That role is not part of this brief.');
  if (role.status !== 'open') return fail('That role has already been filled.');

  const myDisciplines = await listMyDisciplines(viewer.id);
  const hasSkill = !role.discipline || myDisciplines.includes(role.discipline);

  const { data, error } = await supabase
    .from('tropical_applications')
    .insert({
      project_id: projectId,
      role_id: roleId,
      user_id: viewer.id,
      note: note?.trim() || null,
      status: hasSkill ? 'pending' : 'pending_skill',
      required_discipline: hasSkill ? null : role.discipline,
    })
    .select('id, status')
    .single();

  if (error) {
    // The unique index on (role_id, user_id) is what makes double-applying
    // impossible; surface it as a plain message, not a constraint name.
    if (error.code === '23505') return fail('You have already applied for this role.');
    return fail(error.message);
  }

  if (data.status === 'pending') {
    await sendNotificationEmail({
      userId: brief.brand_id,
      kind: 'application_received',
      subject: `New application - ${role.title}`,
      body: `${viewer.name ?? 'A creative'} applied for ${role.title} on ${brief.name}.`,
      path: `/projects/${projectId}`,
    });
  }

  revalidatePath('/briefs');
  revalidatePath('/jobs');
  return ok({ applicationId: data.id, status: data.status });
}

export async function withdrawApplicationAction(
  applicationId: string,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();
  const { data: updated, error } = await supabase
    .from('tropical_applications')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('user_id', viewer.id)
    .select('project_id, role_id')
    .maybeSingle();

  if (error) return fail(error.message);

  // 'application_withdrawn' has no RPC of its own — the brand is not a
  // member of RLS terms an applicant can write for, so this goes through
  // adminDb() the same way deleteProjectAction does for its own privileged
  // write. The applicant's own row above still went through the ordinary
  // RLS-scoped client.
  if (updated) {
    const admin = adminDb();
    const [{ data: project }, { data: role }] = await Promise.all([
      admin
        .from('tropical_projects')
        .select('name, brand_id')
        .eq('id', updated.project_id)
        .maybeSingle(),
      admin.from('tropical_project_roles').select('title').eq('id', updated.role_id).maybeSingle(),
    ]);

    if (project) {
      const title = `Application withdrawn - ${role?.title ?? 'a role'}`;
      const body = `${viewer.name ?? 'A creative'} withdrew their application for ${role?.title ?? 'a role'} on ${project.name}.`;

      await admin.from('tropical_notifications').insert({
        user_id: project.brand_id,
        project_id: updated.project_id,
        kind: 'application_withdrawn',
        title,
        body,
        actor_id: viewer.id,
      });
      await sendNotificationEmail({
        userId: project.brand_id,
        kind: 'application_withdrawn',
        subject: title,
        body,
        path: `/projects/${updated.project_id}`,
      });
    }
  }

  revalidatePath('/briefs');
  revalidatePath('/jobs');
  return ok(null);
}

/**
 * The brand accepting an applicant.
 *
 * Acceptance does five things — set the application, assign the role, add
 * project membership, open the role's DM channel, and reject the other
 * applicants for that role. Doing that as five PostgREST calls would leave a
 * half-hired talent behind any failure, so it is one RPC and one
 * transaction.
 */
export async function decideApplicationAction(
  applicationId: string,
  decision: 'accepted' | 'rejected',
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();

  // Fetched before the RPC runs so the applicant is still identifiable
  // afterwards for the email — the RPC itself only writes the in-app row.
  const { data: application } = await supabase
    .from('tropical_applications')
    .select(
      'user_id, role:tropical_project_roles!tropical_applications_role_id_fkey(title, project:tropical_projects!tropical_project_roles_project_id_fkey(name))',
    )
    .eq('id', applicationId)
    .maybeSingle();

  const { error } = await supabase.rpc('tropical_decide_application', {
    p_application: applicationId,
    p_decision: decision,
  });

  if (error) return fail(error.message);

  if (application) {
    const role = one<{ title: string; project: { name: string } | { name: string }[] | null }>(
      application.role,
    );
    const project = role ? one<{ name: string }>(role.project) : null;
    const roleTitle = role?.title ?? 'the role';

    await sendNotificationEmail({
      userId: application.user_id,
      kind: 'application_decided',
      subject:
        decision === 'accepted' ? `You're in - ${roleTitle}` : `Application update - ${roleTitle}`,
      body:
        decision === 'accepted'
          ? `You were accepted for ${roleTitle} on ${project?.name ?? 'the project'}.`
          : `Your application for ${roleTitle} on ${project?.name ?? 'the project'} was not taken forward this time.`,
      path: '/jobs',
    });
  }

  revalidatePath('/projects', 'layout');
  return ok(null);
}
