'use server';

import { z } from 'zod';
import { adminDb, db } from '@/lib/supabase';
import { fail, ok, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { sendNotificationEmail } from '@/modules/notifications/email';

/**
 * Raising a complaint.
 *
 * The only write this module has. Everything the row is filed under is
 * re-derived here rather than read off the request:
 *
 *   raised_by  the verified session, never a posted id
 *   tenant_id  the host this request arrived on
 *
 * Those two are exactly what someone would forge — filing in another person's
 * name, or into another customer's admin queue — and this is a public HTTP
 * endpoint like every other server action.
 */

const complaintInput = z.object({
  category: z.enum(['report_user', 'report_bug', 'general_enquiry', 'other']),
  // Optional by design: a category alone is a usable signal, and insisting on
  // prose only produces padding.
  detail: z.string().trim().max(4000, 'Keep it under 4000 characters.').optional(),
  subjectUsername: z.string().trim().max(100).optional(),
});

export async function raiseComplaintAction(
  input: z.infer<typeof complaintInput>,
): Promise<ActionResult<{ id: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const parsed = complaintInput.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');
  }
  const { category, detail, subjectUsername } = parsed.data;

  const tenant = await getTenant();

  // Resolving the reported person by handle rather than by id, because that is
  // what the UI actually has — a profile page knows the username in its route,
  // and a free-text box is the only way to report someone whose profile you
  // are not standing on.
  let subjectUserId: string | null = null;
  if (category === 'report_user') {
    if (!subjectUsername) return fail('Tell us which user this is about.');

    // Through the caller's own session: RLS decides which profiles they can
    // resolve, so this cannot be used to probe for accounts on other tenants.
    const supabase = await db();
    const { data: subject } = await supabase
      .from('users')
      .select('id')
      .eq('username', subjectUsername)
      .maybeSingle();

    if (!subject) return fail(`We could not find a user called "${subjectUsername}".`);
    if (subject.id === viewer.id) return fail('You cannot report your own account.');

    subjectUserId = subject.id as string;
  }

  // The insert runs as the caller, so the RLS policy in 041 is the thing that
  // authorises it — the service role is used below only for the admin
  // notifications, which are writes to other people's rows.
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_complaints')
    .insert({
      tenant_id: tenant.id,
      raised_by: viewer.id,
      category,
      subject_user_id: subjectUserId,
      detail: detail || null,
    })
    .select('id')
    .single();

  if (error) return fail(error.message);

  await notifyAdmins({
    tenantId: tenant.id,
    isClassic: tenant.isClassic,
    category,
    raisedByName: viewer.name,
    actorId: viewer.id,
  });

  return ok({ id: data.id as string });
}

/**
 * Tells whoever runs this workspace that something came in.
 *
 * Who that is depends on the tenant, and getting it wrong is the whole risk:
 * a white-label's report must reach THEIR console, not TropicalTalent'.
 *
 *   a white-label  -> its own wl_admins
 *   classic TropicalTalent  -> every users.role = 'admin'
 *
 * Super admins are deliberately not copied on a white-label's complaints. They
 * can already open that tenant's console when a customer asks them to; mailing
 * every TropicalTalent operator a contractor's conduct report by default is the same
 * mistake requireAdminScope's header comment describes.
 *
 * Never throws. A complaint that is recorded but not announced is a queue that
 * gets read slightly later; a complaint lost because an email failed is gone.
 */
async function notifyAdmins({
  tenantId,
  isClassic,
  category,
  raisedByName,
  actorId,
}: {
  tenantId: string;
  isClassic: boolean;
  category: string;
  raisedByName: string | null;
  actorId: string;
}): Promise<void> {
  try {
    const admin = adminDb();

    const { data: recipients } = isClassic
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

    const label = LABELS[category] ?? 'A complaint';
    const subject = `New complaint - ${label}`;
    const body = `${raisedByName || 'A user'} submitted a complaint: ${label}.`;

    await Promise.all(
      ids.map(async (id) => {
        await admin.from('tropical_notifications').insert({
          user_id: id,
          project_id: null,
          kind: 'complaint_raised',
          title: subject,
          body,
          actor_id: actorId,
        });
        await sendNotificationEmail({
          userId: id,
          kind: 'complaint_raised',
          subject,
          body,
          path: '/admin/complaints',
          tenantId,
        });
      }),
    );
  } catch {
    // See the doc comment: the row is what matters.
  }
}

const LABELS: Record<string, string> = {
  report_user: 'Report a user',
  report_bug: 'Report a bug',
  general_enquiry: 'General enquiry',
  other: 'Something else',
};
