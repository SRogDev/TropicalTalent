'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/supabase';
import { fail, ok, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';

/** Marks a viewer's notifications read — all of them, or one project's. */
export async function markNotificationsReadAction(projectId?: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();
  let query = supabase
    .from('tropical_notifications')
    .update({ read: true })
    .eq('user_id', viewer.id)
    .eq('read', false);

  if (projectId) query = query.eq('project_id', projectId);

  const { error } = await query;
  if (error) return fail(error.message);

  revalidatePath('/projects', 'layout');
  return ok(null);
}

/**
 * The profile page's master email switch. Same shape as identity's
 * updateProfileAction: re-authenticate, write through the RLS-scoped client
 * (the own-row policy on tropical_notification_preferences is what makes this
 * safe, same as tropical_favourites_own), revalidate the profile page.
 */
export async function updateEmailPreferencesAction(patch: {
  service?: boolean;
  marketing?: boolean;
}): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  if (patch.service === undefined && patch.marketing === undefined) {
    return fail('Nothing to change.');
  }

  // Only the switch that was touched. Sending both every time would mean a
  // stale tab could quietly reinstate a marketing opt-out the person had
  // already cleared from somewhere else — an unsubscribe link in their inbox,
  // most likely, which writes the same row from outside any session.
  const supabase = await db();
  const { error } = await supabase.from('tropical_notification_preferences').upsert(
    {
      user_id: viewer.id,
      ...(patch.service !== undefined ? { email_enabled: patch.service } : {}),
      ...(patch.marketing !== undefined ? { marketing_enabled: patch.marketing } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) return fail(error.message);

  revalidatePath('/profile/[username]', 'page');
  return ok(null);
}
