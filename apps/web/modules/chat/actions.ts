'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminDb, db } from '@/lib/supabase';
import { fail, ok, one, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { loadWorkspace } from '@/modules/projects/queries';
import { notifyProjectMembers, sendNotificationEmail } from '@/modules/notifications/email';
import type { ContractTerms, Deliverable, DisputeStatus } from './types';

/**
 * Deliverables, per-role contracts and disputes.
 *
 * The escrow-paid boundary shows up three times in this file and means the
 * same thing every time: before payment both sides are still negotiating;
 * after payment the terms are what the money was released against, so they
 * stop being editable and disagreements go to the TropicalTalent team instead.
 *
 * Deliverables are the one exception — a brand may still edit them after
 * escrow, because scope genuinely changes mid-production. Every post-escrow
 * edit posts a notice into the group channel so the crew sees it rather than
 * discovering it at delivery.
 */

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

const deliverableInput = z.object({
  title: z.string().min(1, 'Give the deliverable a name').max(160),
  description: z.string().max(2000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export type DeliverableInput = z.infer<typeof deliverableInput>;

export async function saveDeliverablesAction(
  projectId: string,
  items: DeliverableInput[],
): Promise<ActionResult<Deliverable[]>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const parsed = z.array(deliverableInput).max(40).safeParse(items);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const workspace = await loadWorkspace(projectId);
  if (!workspace) return fail('Project not found.');
  if (workspace.brand_id !== viewer.id) {
    return fail('Only the project owner can set deliverables.');
  }

  // One RPC: replace the set, and — when escrow is already funded — post the
  // change notice to the group channel in the same transaction. A notice that
  // could fail independently of the edit would be worse than no notice.
  const supabase = await db();
  const { data, error } = await supabase.rpc('tropical_save_deliverables', {
    p_project: projectId,
    p_items: parsed.data.map((item, i) => ({
      title: item.title,
      description: item.description ?? null,
      due_date: item.dueDate || null,
      sort_order: i,
    })),
  });

  if (error) return fail(error.message);

  const saved = (data ?? []) as Deliverable[];

  // Mirrors the RPC's own gate as closely as an extra query is worth here:
  // the in-app row only writes post-escrow, so the email only fires then too.
  if ((workspace.status === 'active' || workspace.status === 'completed') && saved.length > 0) {
    await notifyProjectMembers({
      projectId,
      excludeUserId: viewer.id,
      kind: 'deliverables_updated',
      subject: `Deliverables updated - ${workspace.name}`,
      body: `The deliverables for ${workspace.name} were just updated. Open the project to see what changed.`,
    });
  }

  revalidatePath(`/projects/${projectId}`);
  return ok(saved);
}

// ---------------------------------------------------------------------------
// Per-role contracts
// ---------------------------------------------------------------------------

const termsInput = z.object({
  scope: z.string().max(4000).default(''),
  deliverables: z.array(z.string().min(1).max(300)).max(30).default([]),
  revisions: z.number().int().min(0).max(20).default(2),
  deadline: z.string().nullable().optional(),
  paymentTerms: z.string().max(1000).default(''),
  notes: z.string().max(2000).default(''),
});

/**
 * Creates or edits the draft contract for one role.
 *
 * Either party may edit until escrow is paid — this is a negotiation, not a
 * brand-issued document. Each edit clears the other side's acceptance, so an
 * "agreed" contract always reflects text both parties saw.
 *
 * Goes through an RPC rather than a direct upsert so a talent's edit can
 * also notify the brand in the same transaction — a client-side write has no
 * way to do that, since tropical_notifications inserts are server-side only.
 */
export async function saveRoleContractAction(
  roleId: string,
  terms: ContractTerms,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const parsed = termsInput.safeParse(terms);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const supabase = await db();
  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select('id, project_id')
    .eq('id', roleId)
    .maybeSingle();

  if (!role) return fail('That role no longer exists.');

  const { error } = await supabase.rpc('tropical_save_role_contract', {
    p_role: roleId,
    p_terms: parsed.data,
  });

  if (error) return fail(error.message);

  await notifyOtherContractParty(supabase, roleId, viewer.id, 'proposed');

  revalidatePath(`/projects/${role.project_id}`);
  return ok(null);
}

/** Accepting the current text. When both sides have accepted the contract
 *  moves to 'agreed'; the RPC decides that so the two flags are never read
 *  and written across separate statements. */
export async function acceptRoleContractAction(roleId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();
  const { error } = await supabase.rpc('tropical_accept_role_contract', { p_role: roleId });
  if (error) return fail(error.message);

  await notifyOtherContractParty(supabase, roleId, viewer.id, 'accepted');

  revalidatePath('/projects', 'layout');
  return ok(null);
}

/**
 * Emails whichever party didn't just act — the RPC already wrote the in-app
 * row (018_tropical_contract_notifications.sql, extended in 020 to cover both
 * directions); this resolves the same "other party" so the email matches it.
 */
async function notifyOtherContractParty(
  supabase: Awaited<ReturnType<typeof db>>,
  roleId: string,
  actorId: string,
  verb: 'proposed' | 'accepted',
): Promise<void> {
  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select(
      'project_id, title, assigned_user_id, project:tropical_projects!tropical_project_roles_project_id_fkey(name, brand_id)',
    )
    .eq('id', roleId)
    .maybeSingle();

  const project = role ? one<{ name: string; brand_id: string }>(role.project) : null;
  if (!role || !project) return;

  const recipient = actorId === project.brand_id ? role.assigned_user_id : project.brand_id;
  if (!recipient) return;

  const subject =
    verb === 'proposed' ? `Contract updated - ${role.title}` : `Contract accepted - ${role.title}`;
  const body =
    verb === 'proposed'
      ? `New contract terms were proposed for ${role.title} on ${project.name}. Review them in the role chat.`
      : `The contract terms for ${role.title} on ${project.name} were accepted.`;

  await sendNotificationEmail({
    userId: recipient,
    kind: 'contract_updated',
    subject,
    body,
    path: `/projects/${role.project_id}`,
  });
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

const disputeInput = z.object({
  category: z.enum(['scope', 'payment', 'quality', 'deadline', 'conduct', 'other']),
  detail: z.string().min(20, 'Give the TropicalTalent team enough detail to act on').max(4000),
});

/**
 * The post-escrow route for a disagreement.
 *
 * Once money has been paid in, neither party can quietly rewrite the terms —
 * so the complaint form is the only way the contract changes, and it goes to
 * the TropicalTalent team rather than to the other party.
 */
export async function raiseDisputeAction(
  roleId: string,
  input: z.infer<typeof disputeInput>,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const parsed = disputeInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const supabase = await db();
  const { data: role } = await supabase
    .from('tropical_project_roles')
    .select('id, project_id, title, assigned_user_id')
    .eq('id', roleId)
    .maybeSingle();

  if (!role) return fail('That role no longer exists.');

  const { error } = await supabase.from('tropical_disputes').insert({
    project_id: role.project_id,
    role_id: roleId,
    raised_by: viewer.id,
    category: parsed.data.category,
    detail: parsed.data.detail,
  });

  if (error) return fail(error.message);

  // No single "admin" user — the recipients are every account with that
  // role, which is outside what the raiser's own RLS session can read, so
  // this goes through adminDb() like the rest of the privileged, cross-user
  // notification writes in this file.
  const admin = adminDb();
  const [{ data: admins }, { data: project }] = await Promise.all([
    admin.from('users').select('id').eq('role', 'admin'),
    admin.from('tropical_projects').select('name').eq('id', role.project_id).maybeSingle(),
  ]);

  const subject = `New complaint - ${role.title}`;
  const body = `${viewer.name ?? 'A user'} raised a ${parsed.data.category} complaint on ${project?.name ?? 'a project'}, role ${role.title}.`;

  await Promise.all(
    (admins ?? []).map((a) =>
      admin
        .from('tropical_notifications')
        .insert({
          user_id: a.id,
          project_id: role.project_id,
          kind: 'dispute_raised',
          title: subject,
          body,
          actor_id: viewer.id,
        })
        .then(() =>
          sendNotificationEmail({
            userId: a.id,
            kind: 'dispute_raised',
            subject,
            body,
            path: '/admin/complaints',
          }),
        ),
    ),
  );

  revalidatePath(`/projects/${role.project_id}`);
  return ok(null);
}

const resolveDisputeInput = z.object({
  status: z.enum(['reviewing', 'resolved', 'rejected']),
  resolution: z.string().max(4000).optional(),
});

/**
 * The TropicalTalent team's side of a dispute: move it through the queue and record
 * what was decided.
 *
 * Admin-only — re-checked here rather than assumed from the page it was
 * called from, same as every other action in this codebase. Uses adminDb()
 * because tropical_disputes has no RLS policy letting anyone update a row that
 * is not theirs, and it should not gain one just so a normal session client
 * can do this update — the privileged path stays contained to this function.
 */
export async function adminResolveDisputeAction(
  disputeId: string,
  input: z.infer<typeof resolveDisputeInput>,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') return fail('Admin access required.');

  const parsed = resolveDisputeInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const supabase = adminDb();
  const { data: dispute } = await supabase
    .from('tropical_disputes')
    .select('id, project_id, raised_by, category')
    .eq('id', disputeId)
    .maybeSingle();

  if (!dispute) return fail('That complaint no longer exists.');

  const { error } = await supabase
    .from('tropical_disputes')
    .update({
      status: parsed.data.status satisfies DisputeStatus,
      resolution: parsed.data.resolution ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', disputeId);

  if (error) return fail(error.message);

  // 'reviewing' is an internal housekeeping status, not a verdict — only a
  // final resolved/rejected is worth telling the person who raised it about.
  if (parsed.data.status === 'resolved' || parsed.data.status === 'rejected') {
    const subject = `Complaint ${parsed.data.status} - ${dispute.category}`;
    const body =
      parsed.data.resolution?.trim() ||
      `Your ${dispute.category} complaint was marked ${parsed.data.status}.`;

    await supabase.from('tropical_notifications').insert({
      user_id: dispute.raised_by,
      project_id: dispute.project_id,
      kind: 'dispute_resolved',
      title: subject,
      body,
      actor_id: viewer.id,
    });
    await sendNotificationEmail({
      userId: dispute.raised_by,
      kind: 'dispute_resolved',
      subject,
      body,
      path: `/projects/${dispute.project_id}`,
    });
  }

  revalidatePath('/admin/complaints');
  revalidatePath(`/projects/${dispute.project_id}`);
  return ok(null);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Server-side send, used only by surfaces that are not already holding a
 * realtime connection.
 *
 * The workspace sends through the browser client instead (see
 * hooks/use-project-realtime), because that path can generate the message id
 * up front and reconcile the realtime echo against it. Routing sends through
 * a server action would add a round trip to every keystroke-to-screen path
 * without removing one anywhere else.
 */
export async function sendMessageAction(
  channelId: string,
  projectId: string,
  text: string,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const body = text.trim();
  if (!body) return fail('Nothing to send.');
  if (body.length > 4000) return fail('That message is too long.');

  const supabase = await db();
  const { error } = await supabase.from('tropical_channel_messages').insert({
    channel_id: channelId,
    project_id: projectId,
    sender_id: viewer.id,
    kind: 'text',
    content: { text: body },
  });

  if (error) return fail(error.message);
  return ok(null);
}

// ---------------------------------------------------------------------------
// Contract documents
// ---------------------------------------------------------------------------

/**
 * Attaches a document to a role contract.
 *
 * Uploads go to a PRIVATE bucket (`contract-docs`, migration 030) under
 * `<project_id>/<contract_id>/<uuid>-<filename>`. The project id leads so the
 * storage policy can authorise on membership from the path alone, and the uuid
 * prefix means two people uploading "contract.pdf" do not overwrite each
 * other — object paths are unique, not a namespace to be tidy in.
 *
 * Service role for the write, following the avatar upload
 * (modules/identity/actions.ts:485): the caller has been checked here, and the
 * storage policy is the second layer rather than the only one.
 */
export async function uploadContractDocumentAction(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const contractId = String(form.get('contractId') ?? '');
  const kind = String(form.get('kind') ?? 'other');
  const file = form.get('file');

  if (!contractId) return fail('Missing contract.');
  if (!(file instanceof File) || file.size === 0) return fail('Choose a file to upload.');
  if (file.size > 20 * 1024 * 1024) return fail('That file is larger than 20MB.');

  const ALLOWED = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/png',
    'image/jpeg',
  ];
  if (!ALLOWED.includes(file.type)) {
    return fail('Upload a PDF, a Word document, or an image.');
  }

  const supabase = await db();

  // Read through the caller's own session: RLS on tropical_role_contracts only
  // returns a contract they are a party to, so a contract id they are not
  // entitled to simply is not found.
  const { data: contract } = await supabase
    .from('tropical_role_contracts')
    .select('id, project_id, status')
    .eq('id', contractId)
    .maybeSingle();

  if (!contract) return fail('That contract could not be found.');

  const admin = adminDb();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const path = `${contract.project_id}/${contractId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from('contract-docs')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return fail(uploadError.message);

  const { data, error } = await admin
    .from('tropical_contract_documents')
    .insert({
      contract_id: contractId,
      project_id: contract.project_id,
      storage_path: path,
      filename: file.name.slice(0, 255),
      mime_type: file.type,
      size_bytes: file.size,
      kind: ['agreement', 'nda', 'sow', 'compliance', 'other'].includes(kind) ? kind : 'other',
      uploaded_by: viewer.id,
    })
    .select('id')
    .single();

  if (error) {
    // Do not leave an orphan object behind that nothing points at.
    await admin.storage.from('contract-docs').remove([path]);
    return fail(error.message);
  }

  revalidatePath(`/projects/${contract.project_id}`);
  return ok({ id: data.id as string });
}

/**
 * A short-lived link to one document.
 *
 * The bucket is private, so this is the only way to read one. Minted per
 * request rather than stored: a URL that lives in the page source forever is
 * a public bucket with extra steps.
 */
export async function contractDocumentUrlAction(
  documentId: string,
): Promise<ActionResult<{ url: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();

  // RLS on tropical_contract_documents restricts this to contract parties, so a
  // document belonging to someone else's engagement is not found rather than
  // refused — the same non-answer RLS gives everywhere else.
  const { data: doc } = await supabase
    .from('tropical_contract_documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle();

  if (!doc) return fail('That document could not be found.');

  const { data, error } = await adminDb()
    .storage.from('contract-docs')
    .createSignedUrl(doc.storage_path as string, 60);

  if (error || !data) return fail(error?.message ?? 'Could not open that document.');
  return ok({ url: data.signedUrl });
}
