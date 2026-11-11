'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, type ActionResult } from '@/lib/utils';
import { adminDb } from '@/lib/supabase';
import { requireAdminScope } from './queries';
import type { Viewer } from '@/modules/identity/types';
import {
  sendBulkEmail,
  sendNotificationEmail,
  type BulkEmailResult,
} from '@/modules/notifications/email';
import { BROADCAST_TEMPLATES } from './broadcast-templates';

const sendBroadcastInput = z.object({
  templateId: z.enum(['inactivity', 'pulse_check', 'creative_audit', 'brand_audit']),
  userIds: z.array(z.string().uuid()).min(1, 'Select at least one recipient').max(2000),
});

/**
 * Sends one of the four canned outreach emails to a chosen set of users.
 *
 * The template is looked up server-side by id rather than trusting a
 * subject/body the client posted — the client only ever chooses WHICH of the
 * four to send, never what they say.
 */
export async function sendAdminBroadcastAction(
  input: z.infer<typeof sendBroadcastInput>,
): Promise<ActionResult<BulkEmailResult>> {
  // requireAdminScope throws for anyone who is neither a super admin nor a
  // white-label admin, and returns the tenant the caller is allowed to act on.
  let scope: { tenantId: string | null };
  try {
    scope = await requireAdminScope();
  } catch {
    return fail('Admin access required.');
  }

  const parsed = sendBroadcastInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const template = BROADCAST_TEMPLATES.find((t) => t.id === parsed.data.templateId);
  if (!template) return fail('Unknown template.');

  // The recipient list arrives from the client, so it is re-derived here
  // rather than trusted. A white-label admin posting ids from outside their
  // tenant — whether by tampering or by a stale page — must not be able to
  // mail another customer's users, and this is the only thing standing
  // between them and a mass send.
  //
  // Intersect rather than reject: a partially stale list should send to the
  // valid part, not fail the whole broadcast with nothing to act on.
  const recipients = await allowedRecipients(parsed.data.userIds, scope.tenantId);
  if (recipients.length === 0) {
    return fail('None of those recipients are in your tenant.');
  }

  const result = await sendBulkEmail({
    userIds: recipients,
    subject: template.subject,
    body: template.body,
  });

  return ok(result);
}

/**
 * The subset of `userIds` the caller may actually mail.
 *
 * Unscoped (a TropicalTalent super admin on the classic host) means everyone, so the
 * list is returned as given.
 */
async function allowedRecipients(userIds: string[], tenantId: string | null): Promise<string[]> {
  if (!tenantId) return userIds;

  const { data } = await adminDb()
    .from('tropical_tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .in('user_id', userIds);

  return (data ?? []).map((r) => r.user_id as string);
}

// ---------------------------------------------------------------------------
// Project deletion requests
// ---------------------------------------------------------------------------

const resolveDeletionInput = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Deciding a brand's request to remove a project that has already begun.
 *
 * Approving ARCHIVES the project: it disappears for everyone on it, its
 * recurring schedule is stopped deliberately, and the row survives for anyone
 * who later has to ask what was agreed. That is the reason this lives here and
 * not on the brand's own settings panel — a live workspace is a record two
 * parties are relying on, and one of them should not be able to remove it
 * alone.
 *
 * It can also REFUSE. tropical_archive_project will not archive a project whose
 * escrow still holds a slice, or whose recurring periods have been charged and
 * not released: that money has been taken from a real card and is owed to a
 * real person, and there is no refund path in the app to undo it. The error
 * says which, and is surfaced to the admin rather than swallowed — a queue
 * that reports success while stranding a payment is worse than one that says
 * "settle this first".
 *
 * Two guards, both necessary. requireAdminScope answers "may this person
 * decide anything"; re-reading the request under the same tenant filter
 * answers "may they decide THIS one" — without it a white-label admin could
 * approve another customer's deletion by posting its id, since adminDb()
 * bypasses RLS and would happily fetch it.
 */
export async function resolveDeleteRequestAction(
  input: z.infer<typeof resolveDeletionInput>,
): Promise<ActionResult<{ deleted: boolean }>> {
  let scope: { viewer: Viewer; tenantId: string | null };
  try {
    scope = await requireAdminScope();
  } catch {
    return fail('Admin access required.');
  }

  const parsed = resolveDeletionInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const admin = adminDb();

  let lookup = admin
    .from('tropical_project_delete_requests')
    .select('id, project_id, project_name, tenant_id, requested_by, status')
    .eq('id', parsed.data.requestId)
    .eq('status', 'open');

  // The scope filter, applied to the row rather than assumed from the console
  // the click came from.
  if (scope.tenantId) lookup = lookup.eq('tenant_id', scope.tenantId);

  const { data: request } = await lookup.maybeSingle();
  if (!request) return fail('That request is no longer open.');

  const projectId = request.project_id as string | null;
  const projectName = request.project_name as string;

  if (parsed.data.decision === 'reject') {
    const { error } = await admin
      .from('tropical_project_delete_requests')
      .update({
        status: 'rejected',
        resolution: parsed.data.note || null,
        resolved_by: scope.viewer.id,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.id as string)
      .eq('status', 'open');

    if (error) return fail(error.message);

    await tellRequester({
      userId: request.requested_by as string,
      tenantId: request.tenant_id as string,
      subject: `Deletion declined - ${projectName}`,
      body: `Your request to remove ${projectName} was not approved.${
        parsed.data.note ? ` ${parsed.data.note}` : ''
      }`,
      path: projectId ? `/projects/${projectId}` : '/projects',
    });

    revalidatePath('/admin/deletions');
    return ok({ deleted: false });
  }

  if (!projectId) return fail('That project no longer exists.');

  // The archive runs FIRST, and the request is only marked approved if it
  // succeeded. The other order marks a decision that did not happen: the RPC
  // refuses outright when escrow still holds a slice or a charged period has
  // not been released, and an admin who saw "approved" against a project still
  // sitting there would reasonably assume the queue was broken rather than
  // that they had money to settle.
  const { data: outcome, error: archiveError } = await admin.rpc('tropical_archive_project', {
    p_project: projectId,
    p_actor: scope.viewer.id,
    p_reason: parsed.data.note || 'Approved from the deletion queue.',
  });

  if (archiveError) return fail(archiveError.message);

  // Told after the fact rather than before, unlike a hard delete: nothing was
  // destroyed, so there is no last chance to read it and no ordering to
  // protect. The row also still exists to link back to for an admin.
  const { data: members } = await admin
    .from('tropical_project_members')
    .select('user_id')
    .eq('project_id', projectId);

  await Promise.all(
    (members ?? []).map((m) =>
      tellRequester({
        userId: m.user_id as string,
        tenantId: request.tenant_id as string,
        subject: `Project closed - ${projectName}`,
        body: `${projectName} has been closed at the client's request and is no longer in your workspace.${
          parsed.data.note ? ` ${parsed.data.note}` : ''
        }`,
        path: '/projects',
      }),
    ),
  );

  const { error: markError } = await admin
    .from('tropical_project_delete_requests')
    .update({
      status: 'approved',
      resolution: parsed.data.note || null,
      resolved_by: scope.viewer.id,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', request.id as string);

  if (markError) return fail(markError.message);

  revalidatePath('/admin/deletions');
  revalidatePath('/admin/projects');
  revalidatePath('/projects', 'layout');
  return ok({ deleted: outcome !== 'already_archived' });
}

/** One in-app row plus one best-effort email, branded for the right tenant. */
async function tellRequester({
  userId,
  tenantId,
  subject,
  body,
  path,
}: {
  userId: string;
  tenantId: string;
  subject: string;
  body: string;
  path: string;
}): Promise<void> {
  try {
    await adminDb().from('tropical_notifications').insert({
      user_id: userId,
      project_id: null,
      kind: 'project_deleted',
      title: subject,
      body,
    });
    await sendNotificationEmail({ userId, kind: 'project_deleted', subject, body, path, tenantId });
  } catch {
    // Telling someone late is recoverable; failing the decision is not.
  }
}
