'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminDb, db } from '@/lib/supabase';
import { splitPot } from '@/lib/money';
import { fail, ok, one, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { sendNotificationEmail } from '@/modules/notifications/email';
import { getTenant } from '@/modules/tenancy/queries';
import { isEscrowPaid, type Workspace } from './types';
import { loadWorkspace } from './queries';

/**
 * Brand-side project writes.
 *
 * Server actions are public HTTP endpoints, so every one of these
 * re-authenticates and re-validates rather than trusting what the client sent.
 * The budget split in particular is recomputed here and verified again inside
 * `tropical_create_project()` — a client that posted its own role amounts could
 * otherwise fund an escrow that never reconciles.
 */

const roleInput = z.object({
  title: z.string().min(1, 'Every role needs a title').max(80),
  discipline: z.string().max(64).nullable().optional(),
  percentage: z.number().positive('Role share must be above 0').max(100),
  deliverables: z.string().max(2000).nullable().optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
});

/**
 * `platformFeePct` is deliberately NOT here.
 *
 * It used to be, with a default of 15, and it came from the browser. That made
 * a white-label's negotiated fee cosmetic — a tenant on 22% still charged 15 —
 * and a crafted request could post 0 and take the whole pot. The fee belongs to
 * the tenant (tropical_tenants.platform_fee_pct), which is where the recurring
 * pay run has always read it from, and now where this path reads it too.
 */
const createProjectInput = z.object({
  name: z.string().min(1, 'Give the project a name').max(120),
  brief: z.string().max(5000).default(''),
  /** Pence. */
  budget: z.number().int().positive('Budget must be above zero'),
  visibility: z.enum(['public', 'private', 'both']).default('public'),
  deadline: z.string().datetime().nullable().optional(),
  roles: z.array(roleInput).min(1, 'Add at least one role'),
});

export type CreateProjectInput = z.input<typeof createProjectInput>;

export async function createProjectAction(
  raw: CreateProjectInput,
): Promise<ActionResult<{ projectId: string }>> {
  const [viewer, tenant] = await Promise.all([getViewer(), getTenant()]);
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.canBrand) return fail('This account cannot create projects.');
  // The RPC refuses a non-member too. Checked here as well so the answer is a
  // sentence rather than a Postgres error surfaced through `error.message`.
  if (!viewer.belongsToTenant) return fail('Your account is not a member of this workspace.');

  const parsed = createProjectInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');
  const input = parsed.data;

  // The client shows live figures from this same function; these are the ones
  // that get written. The fee is the TENANT's — the same number the RPC
  // recomputes the crew pool from, so the two cannot disagree.
  let split;
  try {
    split = splitPot(
      input.budget,
      input.roles.map((r, i) => ({ id: String(i), percentage: r.percentage })),
      tenant.platformFeePct,
    );
  } catch (err) {
    return fail((err as Error).message);
  }

  const supabase = await db();
  const { data, error } = await supabase.rpc('tropical_create_project', {
    p_name: input.name,
    p_brief: input.brief,
    p_budget: input.budget,
    p_visibility: input.visibility,
    p_deadline: input.deadline ?? null,
    // The tenant whose hostname served this request — not one derived from the
    // account, which may belong to several. Without it the project falls to
    // the classic default and its own creator cannot read it back (RLS in 024).
    p_tenant_id: tenant.id,
    p_roles: input.roles.map((role, i) => ({
      title: role.title,
      discipline: role.discipline ?? null,
      percentage: role.percentage,
      amount: split.roles[i].amount,
      // A public project is an open call: every role is posted for
      // applications and nobody is seated up front. The RPC adds any
      // assigned_user_id to project membership (and so the group chat), so a
      // stale pick from the client must not get through here.
      assigned_user_id: input.visibility === 'public' ? null : (role.assigned_user_id ?? null),
      deliverables: role.deliverables ?? null,
      sort_order: i,
    })),
  });

  if (error || !data) {
    return fail(error?.message ?? 'Could not create the project. Nothing was saved.');
  }

  revalidatePath('/projects');
  revalidatePath('/briefs');
  return ok({ projectId: data as string });
}

/**
 * Assigns or clears a role's talent before escrow is paid.
 *
 * Blocked once funded: reassigning a role whose slice is already held would
 * orphan the hold from its payee.
 */
export async function assignRoleAction(
  roleId: string,
  userId: string | null,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();
  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select('id, project_id, title')
    .eq('id', roleId)
    .maybeSingle();

  if (!role) return fail('That role no longer exists.');

  const workspace = await loadWorkspace(role.project_id);
  if (!workspace || workspace.brand_id !== viewer.id) {
    return fail('Only the project owner can change the crew.');
  }
  if (isEscrowPaid(workspace)) {
    return fail('Escrow is already funded - renegotiate the contract to change this role.');
  }

  // One RPC rather than three writes: assigning also opens the role's DM
  // channel and adds project membership, and a half-applied assignment leaves
  // a talent who can see the project but has nowhere to talk.
  const { error } = await supabase.rpc('tropical_assign_role', {
    p_role: roleId,
    p_user: userId,
  });

  if (error) return fail(error.message);

  if (userId) {
    await sendNotificationEmail({
      userId,
      kind: 'role_invited',
      subject: `You're invited - ${role.title}`,
      body: `You were invited to ${role.title} on ${workspace.name}.`,
      path: '/jobs',
    });
  }

  revalidatePath(`/projects/${role.project_id}`);
  return ok(null);
}

/**
 * The talent's answer to an invitation.
 *
 * Assigning a role puts it at `invited`, not `accepted` — the brand picking
 * someone is an offer, not a hiring. Until this runs the role is not theirs,
 * which is why /jobs lists invitations separately from roles held.
 *
 * Declining releases the seat, deletes the DM that existed only for this
 * pairing, and drops their membership unless they hold another role on the
 * same project. All in one transaction.
 */
export async function respondToInviteAction(
  roleId: string,
  response: 'accepted' | 'declined',
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();

  // Fetched before the RPC runs — declining clears the role's membership, so
  // the project's brand_id would no longer be reachable through this role
  // afterwards.
  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select(
      'project_id, title, project:tropical_projects!tropical_project_roles_project_id_fkey(name, brand_id)',
    )
    .eq('id', roleId)
    .maybeSingle();

  const { error } = await supabase.rpc('tropical_respond_to_invite', {
    p_role: roleId,
    p_response: response,
  });

  if (error) return fail(error.message);

  const project = role ? one<{ name: string; brand_id: string }>(role.project) : null;
  if (role && project) {
    await sendNotificationEmail({
      userId: project.brand_id,
      kind: 'application_decided',
      subject: `Invite ${response} - ${role.title}`,
      body: `${viewer.name ?? 'A creative'} ${response} the invitation for ${role.title} on ${project.name}.`,
      path: `/projects/${role.project_id}`,
    });
  }

  revalidatePath('/jobs');
  revalidatePath('/projects', 'layout');
  return ok(null);
}

/**
 * A talent walks away from a role they had accepted.
 *
 * Only while nothing is committed — the RPC (048) refuses once escrow is
 * funded or a retainer has activated, and the UI shows the complaint route
 * instead at that point. Same detach as declining: seat reopened, DM and
 * contract gone, membership kept only if they hold another role here.
 */
export async function leaveRoleAction(roleId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();

  // Read before the RPC, for the same reason respondToInviteAction does:
  // afterwards this role no longer belongs to the caller and RLS on the
  // project may already have closed.
  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select(
      'project_id, title, project:tropical_projects!tropical_project_roles_project_id_fkey(name, brand_id)',
    )
    .eq('id', roleId)
    .maybeSingle();

  const { error } = await supabase.rpc('tropical_leave_role', { p_role: roleId });
  if (error) return fail(error.message);

  const project = role ? one<{ name: string; brand_id: string }>(role.project) : null;
  if (role && project) {
    await sendNotificationEmail({
      userId: project.brand_id,
      kind: 'role_left',
      subject: `${viewer.name ?? 'A creative'} left ${role.title}`,
      body: `${viewer.name ?? 'A creative'} left the ${role.title} role on ${project.name}. The role is open again.`,
      path: `/projects/${role.project_id}`,
    });
  }

  revalidatePath('/jobs');
  revalidatePath('/projects', 'layout');
  return ok(null);
}

/** Records that the viewer has seen a channel, clearing its unread badge. */
export async function markChannelReadAction(channelId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();
  const { error } = await supabase.rpc('tropical_mark_channel_read', { p_channel: channelId });
  if (error) return fail(error.message);

  return ok(null);
}

// ---------------------------------------------------------------------------
// Project settings
// ---------------------------------------------------------------------------

/**
 * Removes a project from the workspace. Only before its money is committed.
 *
 * ARCHIVES rather than deletes, since migration 045: the row stays, and the
 * SELECT policy stops returning it. A project is the record of an agreement
 * between two parties — contracts, deliverables, the whole conversation — and
 * destroying it at one party's request removes the evidence the other would
 * need in exactly the dispute this is meant to avoid. It is invisible to
 * everyone either way; the difference only shows up when somebody asks what
 * happened.
 *
 * "Committed" is not the same question for both kinds of project, and reading
 * escrow for both made a retainer permanently undeletable: a retainer project
 * opens 'active' (029), so isEscrowPaid is true from creation and this refused
 * with "Escrow is funded" on a project that has no escrow and has never taken
 * a penny. A retainer commits when it starts paying, which is what
 * activated_at records. hasBegun() below is the one place that decision lives.
 *
 * Afterwards the owner asks instead of acting — requestProjectDeletionAction,
 * and an admin decides. See migration 044 for why a live workspace is not one
 * party's to remove.
 */
export async function deleteProjectAction(projectId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const workspace = await loadWorkspace(projectId);
  if (!workspace) return fail('Project not found.');
  if (workspace.brand_id !== viewer.id) return fail('Only the project owner can delete it.');

  if (await hasBegun(workspace)) {
    return fail(
      workspace.kind === 'retainer'
        ? 'This engagement has started - ask an admin to remove it instead.'
        : 'Escrow is funded - ask an admin to remove it instead.',
    );
  }

  // Anyone invited-but-not-yet-declined loses that invite silently once the
  // project is gone, so tell them first — tropical_notifications.project_id
  // cascades on project delete, so this row is written with project_id NULL
  // to survive it, and written (and emailed) BEFORE the delete rather than
  // after, since there would be nothing left to join back to afterwards.
  const invited = workspace.roles.filter((r) => r.status === 'invited' && r.assigned_user_id);
  const admin = adminDb();
  await Promise.all(
    invited.map(async (r) => {
      const subject = `Project cancelled - ${workspace.name}`;
      const body = `${workspace.name} was deleted before you accepted your invite for ${r.title}.`;
      await admin.from('tropical_notifications').insert({
        user_id: r.assigned_user_id,
        project_id: null,
        kind: 'project_deleted',
        title: subject,
        body,
        actor_id: viewer.id,
      });
      await sendNotificationEmail({
        userId: r.assigned_user_id!,
        kind: 'project_deleted',
        subject,
        body,
        path: '/jobs',
      });
    }),
  );

  // Service role: the RPC is granted to service_role only, and the ownership
  // and money checks above (plus its own, which are the authoritative ones)
  // are the real gate. It also stops any recurring schedule deliberately
  // rather than relying on a cascade to take the rows out from under the cron.
  const { error } = await admin.rpc('tropical_archive_project', {
    p_project: projectId,
    p_actor: viewer.id,
    p_reason: 'Removed by the project owner before it began.',
  });
  if (error) return fail(error.message);

  revalidatePath('/projects', 'layout');
  return ok(null);
}

/**
 * Removes a talent from a project. Only before escrow is paid.
 *
 * Clears their role assignment as well as their membership, so the role goes
 * back to open and can be filled again.
 */
export async function removeMemberAction(
  projectId: string,
  userId: string,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const workspace = await loadWorkspace(projectId);
  if (!workspace) return fail('Project not found.');
  if (workspace.brand_id !== viewer.id) return fail('Only the project owner can remove members.');
  if (isEscrowPaid(workspace)) {
    return fail('Escrow is funded - members can no longer be removed.');
  }
  if (userId === workspace.brand_id) return fail('The project owner cannot be removed.');

  const supabase = await db();
  const { error } = await supabase.rpc('tropical_remove_member', {
    p_project: projectId,
    p_user: userId,
  });

  if (error) return fail(error.message);

  await sendNotificationEmail({
    userId,
    kind: 'member_removed',
    subject: `Removed from ${workspace.name}`,
    body: `You were removed from ${workspace.name} by the project owner.`,
    path: '/briefs',
  });

  revalidatePath(`/projects/${projectId}`);
  return ok(null);
}

/** Edits the brief text, name, visibility or delivery date. Allowed at any
 *  time — none of these change the money. */
export async function updateProjectAction(
  projectId: string,
  patch: {
    name?: string;
    brief?: string;
    visibility?: 'public' | 'private' | 'both';
    deadline?: string | null;
  },
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const parsed = z
    .object({
      name: z.string().min(1).max(120).optional(),
      brief: z.string().max(5000).optional(),
      visibility: z.enum(['public', 'private', 'both']).optional(),
      deadline: z.coerce.date().nullable().optional(),
    })
    .safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const { deadline, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (deadline !== undefined) update.deadline_date = deadline?.toISOString() ?? null;

  const supabase = await db();
  const { error } = await supabase
    .from('tropical_projects')
    .update(update)
    .eq('id', projectId)
    .eq('brand_id', viewer.id);

  if (error) return fail(error.message);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/briefs');
  return ok(null);
}

// ---------------------------------------------------------------------------
// Deleting a project that has already begun
// ---------------------------------------------------------------------------

/**
 * Whether a project's money is committed.
 *
 * The single definition of "begun", used by the delete gate and by the request
 * route that replaces it. A pot commits when escrow funds; a retainer when its
 * card is saved and the engagement starts, which is what activated_at records
 * and what paused_at deliberately does not — an engagement paused after a run
 * of failed charges has still taken money for the periods behind it.
 */
async function hasBegun(workspace: Workspace): Promise<boolean> {
  if (workspace.kind !== 'retainer') return isEscrowPaid(workspace);

  const { data: role } = await adminDb()
    .from('tropical_project_roles')
    .select('activated_at')
    .eq('project_id', workspace.id)
    .eq('pay_model', 'recurring')
    .maybeSingle();

  return Boolean(role?.activated_at);
}

const deleteRequestInput = z.object({
  projectId: z.string().uuid(),
  reason: z.string().trim().max(4000, 'Keep it under 4000 characters.').optional(),
});

/**
 * Asking an admin to remove a project that has already begun.
 *
 * Deliberately does not delete anything, and deliberately is not offered
 * before the project begins — a brand who can still delete it themselves does
 * not need a queue, and routing them through one would turn a reversible
 * decision into a support ticket.
 *
 * The row is filed under the project's OWN tenant rather than the request
 * host's. They are the same on classic and the RLS policy in 044 checks the
 * pair anyway, but reading it from the project is what makes that check a
 * confirmation rather than the only line of defence.
 */
export async function requestProjectDeletionAction(
  input: z.infer<typeof deleteRequestInput>,
): Promise<ActionResult<{ id: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const parsed = deleteRequestInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const workspace = await loadWorkspace(parsed.data.projectId);
  if (!workspace) return fail('Project not found.');
  if (workspace.brand_id !== viewer.id) {
    return fail('Only the project owner can request this.');
  }
  if (!(await hasBegun(workspace))) {
    return fail('This project has not started yet - you can delete it yourself.');
  }

  const { data: project } = await adminDb()
    .from('tropical_projects')
    .select('tenant_id')
    .eq('id', parsed.data.projectId)
    .maybeSingle();

  const tenantId = (project?.tenant_id as string | null) ?? viewer.tenantId;

  // Inserted as the caller, so 044's policy is what authorises it. A duplicate
  // is a unique-index violation on the one-open-request index rather than a
  // second row in front of an admin, and is reported as the ordinary thing it
  // is: they already asked.
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_project_delete_requests')
    .insert({
      project_id: parsed.data.projectId,
      // Snapshot for the audit trail, which outlives the project it names.
      project_name: workspace.name,
      tenant_id: tenantId,
      requested_by: viewer.id,
      reason: parsed.data.reason || null,
    })
    .select('id')
    .single();

  if (error) {
    return fail(
      error.code === '23505'
        ? 'You have already asked for this project to be removed.'
        : error.message,
    );
  }

  await notifyAdminsOfDeleteRequest({
    tenantId,
    projectName: workspace.name,
    requestedBy: viewer.name,
    actorId: viewer.id,
  });

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return ok({ id: data.id as string });
}

/**
 * Taking the request back.
 *
 * Service role, with the ownership and status narrowed in the filter rather
 * than by a policy. 044 grants `authenticated` no UPDATE at all: an RLS UPDATE
 * policy cannot see the OLD row in its WITH CHECK, so one permissive enough to
 * allow "withdrawn" would also let a brand write `resolution` — the column an
 * admin's decision is recorded in. Narrowing here keeps the write to the one
 * column and the one row that should move.
 */
export async function withdrawProjectDeletionAction(
  requestId: string,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const { data, error } = await adminDb()
    .from('tropical_project_delete_requests')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('requested_by', viewer.id)
    .eq('status', 'open')
    .select('project_id')
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail('That request is no longer open.');

  revalidatePath(`/projects/${data.project_id as string}`);
  return ok(null);
}

/**
 * Tells whoever runs this workspace that a deletion is waiting on them.
 *
 * Same routing as a complaint — a white-label's request reaches THEIR console,
 * classic reaches every users.role = 'admin' — and never throws, for the same
 * reason: a request recorded but not announced is read slightly later, one
 * lost to a failed email is gone.
 */
async function notifyAdminsOfDeleteRequest({
  tenantId,
  projectName,
  requestedBy,
  actorId,
}: {
  tenantId: string;
  projectName: string;
  requestedBy: string | null;
  actorId: string;
}): Promise<void> {
  try {
    const admin = adminDb();
    const { data: tenant } = await admin
      .from('tropical_tenants')
      .select('is_classic')
      .eq('id', tenantId)
      .maybeSingle();

    const { data: recipients } = tenant?.is_classic
      ? await admin.from('users').select('id').eq('role', 'admin')
      : await admin
          .from('tropical_tenant_members')
          .select('user_id')
          .eq('tenant_id', tenantId)
          .eq('role', 'wl_admin')
          .eq('status', 'active');

    const ids = (recipients ?? []).map((r) =>
      'id' in r ? (r.id as string) : (r.user_id as string),
    );
    if (ids.length === 0) return;

    const subject = `Deletion requested - ${projectName}`;
    const body = `${requestedBy || 'A brand'} asked for ${projectName} to be removed. Approving it deletes the project and everything in it.`;

    await Promise.all(
      ids.map(async (id) => {
        await admin.from('tropical_notifications').insert({
          user_id: id,
          project_id: null,
          kind: 'project_delete_requested',
          title: subject,
          body,
          actor_id: actorId,
        });
        await sendNotificationEmail({
          userId: id,
          kind: 'project_delete_requested',
          subject,
          body,
          path: '/admin/deletions',
          tenantId,
        });
      }),
    );
  } catch {
    // See the doc comment: the row is what matters.
  }
}
