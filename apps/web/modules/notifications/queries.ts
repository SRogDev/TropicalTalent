import 'server-only';

import { cache } from 'react';
import { db } from '@/lib/supabase';

/**
 * In-app notifications, plus the email preference gating email.ts reads
 * before sending anything.
 *
 * The in-app row is still written by the same transaction that caused the
 * event (an application landing, a skill unlocking a held application, a
 * deliverable being edited after escrow) and read on the surface where it
 * matters — the Project Admin channel's updates badge. Email is a separate,
 * best-effort side effect on top of that row, not a replacement for it — see
 * modules/notifications/email.ts.
 */

export type NotificationKind =
  | 'application_received'
  | 'application_unlocked'
  | 'application_decided'
  | 'deliverables_updated'
  | 'contract_updated'
  | 'role_invited'
  | 'escrow_funded'
  | 'dispute_raised'
  | 'dispute_resolved'
  | 'withdrawal_completed'
  | 'withdrawal_failed'
  | 'role_delivered'
  | 'role_released'
  | 'project_completed'
  | 'member_removed'
  | 'project_deleted'
  | 'application_withdrawn'
  | 'referral_redeemed'
  | 'complaint_raised'
  | 'project_delete_requested'
  | 'card_saved'
  | 'role_left'
  // Email-only — the periodic active-project digest (app/api/cron/project-
  // checkins) is not an event, so it never writes a tropical_notifications row
  // and this value never appears in the database's kind CHECK constraint.
  | 'project_checkin'
  // Email-only, same reason: a welcome is the absence of events, not one of
  // them, and an in-app bell that says "welcome" the moment you arrive is
  // noise. Never written to tropical_notifications, so it is NOT in the kind
  // CHECK constraint and must not be inserted there.
  | 'welcome';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  project_id: string | null;
  read: boolean;
  created_at: string;
}

export const loadNotifications = cache(
  async (userId: string, projectId?: string): Promise<Notification[]> => {
    const supabase = await db();

    let query = supabase
      .from('tropical_notifications')
      .select('id, kind, title, body, project_id, read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;
    if (error || !data) return [];
    return data as Notification[];
  },
);

export const countUnread = cache(async (userId: string, projectId?: string): Promise<number> => {
  const supabase = await db();

  let query = supabase
    .from('tropical_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (projectId) query = query.eq('project_id', projectId);

  const { count } = await query;
  return count ?? 0;
});

/** Whether this user wants notification email. No row means enabled — only
 *  opt-outs are stored (see 020_tropical_email_notifications.sql). */
export interface EmailPreferences {
  /** Optional service email: role assigned, work delivered, payout completed. */
  service: boolean;
  /** Marketing and re-engagement only. */
  marketing: boolean;
}

/**
 * Both switches. Absent row means opted into neither explicitly and out of
 * nothing — the default since 020, preserved by 042's DEFAULT true.
 */
export const loadEmailPreference = cache(async (userId: string): Promise<EmailPreferences> => {
  const supabase = await db();
  // select('*') rather than naming the columns: naming marketing_enabled makes
  // this whole read fail on a database where 042 has not been applied, and a
  // failed read here silently reports both switches as ON — telling someone
  // they are opted in to marketing they had actually opted out of.
  const { data } = await supabase
    .from('tropical_notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const row = (data ?? {}) as { email_enabled?: boolean; marketing_enabled?: boolean };

  return {
    service: row.email_enabled ?? true,
    // Before 042 the single switch governed both, so mirror it rather than
    // claiming a consent the person never gave.
    marketing: row.marketing_enabled ?? row.email_enabled ?? true,
  };
});
