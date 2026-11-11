import 'server-only';

import { cache } from 'react';
import { adminDb } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { requireAdminScope } from '@/modules/admin/queries';
import type { ComplaintCategory, ComplaintRow, ComplaintStatus } from './types';

/**
 * The admin queue.
 *
 * Same shape as loadAllDisputes in modules/chat: requireAdminScope() answers
 * both "may this person see a console" and "whose rows are in it", and a
 * caller who is neither a super admin nor this tenant's wl_admin gets an empty
 * list rather than a stack trace on the page.
 *
 * Service role, because the whole point is showing one signed-in person rows
 * raised by everyone else — the RLS policy in 041 deliberately restricts
 * `authenticated` to their own.
 *
 * tenant_id is on the row itself here, unlike disputes which reach a tenant
 * only through their project, so the filter is a plain equality and there is
 * no !inner embed to get wrong.
 */
export const loadAllComplaints = cache(async (): Promise<ComplaintRow[]> => {
  let tenantId: string | null;
  try {
    ({ tenantId } = await requireAdminScope());
  } catch {
    return [];
  }

  const supabase = adminDb();

  let query = supabase
    .from('tropical_complaints')
    .select(
      `
      id, category, detail, status, resolution, created_at,
      raised_by_user:users!tropical_complaints_raised_by_fkey(name, username),
      subject_user:users!tropical_complaints_subject_user_id_fkey(name, username)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(500);

  // null means unscoped — a super admin on the classic host, the only caller
  // entitled to every tenant's queue at once.
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[]).map((row) => {
    const raisedBy = one(row.raised_by_user as never) as {
      name?: string | null;
      username?: string | null;
    } | null;
    const subject = one(row.subject_user as never) as {
      name?: string | null;
      username?: string | null;
    } | null;

    return {
      id: row.id as string,
      category: row.category as ComplaintCategory,
      status: row.status as ComplaintStatus,
      detail: (row.detail as string | null) ?? null,
      resolution: (row.resolution as string | null) ?? null,
      createdAt: row.created_at as string,
      raisedByName: raisedBy?.name ?? null,
      raisedByUsername: raisedBy?.username ?? null,
      subjectName: subject?.name ?? null,
      subjectUsername: subject?.username ?? null,
    };
  });
});
