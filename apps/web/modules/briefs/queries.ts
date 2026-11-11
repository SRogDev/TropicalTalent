import 'server-only';

import { cache } from 'react';
import { db } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { listMyDisciplines } from '@/modules/skills/queries';
import type { Applicant, MyApplication, PublicBrief } from './types';

/**
 * The public briefs feed and the application records either side of it.
 *
 * Everything here reads `tropical_public_briefs`, never the base tables. That
 * view is the only projection that gets past the members-only RLS on
 * `tropical_projects`, and it exposes the total pot and role titles but no
 * per-role split. Querying `tropical_projects` directly would simply return
 * nothing for a non-member, which is the intended failure mode.
 */

export const BRIEFS_PAGE_SIZE = 24;

export interface BriefsFilter {
  search?: string;
  disciplines?: string[];
  minBudget?: number;
  /** Only briefs with at least one unfilled role. */
  openOnly?: boolean;
}

/** Stable React.cache key — an object literal would never hit the cache. */
export function briefsFilterKey(filter: BriefsFilter): string {
  if (!filter || Object.keys(filter).length === 0) return '';
  return JSON.stringify({
    search: filter.search?.trim() || undefined,
    disciplines: filter.disciplines?.slice().sort(),
    minBudget: filter.minBudget,
    openOnly: filter.openOnly,
  });
}

/**
 * One page of the feed.
 *
 * Keyset pagination on created_at rather than OFFSET: OFFSET makes Postgres
 * walk and discard every skipped row, so page 10 of an infinite scroll costs
 * ten times page 1. A cursor stays flat.
 */
export const loadBriefs = cache(
  async (cursor: string | null, filterKey: string, tenantId: string, excludeBrandId?: string) => {
    const filter: BriefsFilter = filterKey ? JSON.parse(filterKey) : {};
    const supabase = await db();

    let query = supabase
      .from('tropical_public_briefs')
      .select('*')
      // The view (025) already restricts rows to tenants the caller belongs
      // to — that is the security boundary, and it lives there because the
      // view is security_invoker = false and RLS does not apply to it.
      //
      // This narrows that to the ONE tenant whose hostname served the request.
      // Someone who is a contractor at Acme and also a TropicalTalent talent belongs
      // to two tenants, and must not see Acme's briefs while on tropicaltalent.dev
      // or vice versa. Worst case if this line were dropped: they see their own
      // tenants' briefs mixed together, never a stranger's.
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(BRIEFS_PAGE_SIZE + 1); // one extra row tells us if there is more

    // Your own brief is not a job you can take — applying to it is refused in
    // applyToRoleAction. Excluded in SQL rather than after the fetch so a page
    // of 25 stays a page of 25 once a talent posts work of their own.
    if (excludeBrandId) query = query.neq('brand_id', excludeBrandId);

    if (cursor) query = query.lt('created_at', cursor);
    if (filter.minBudget) query = query.gte('budget', filter.minBudget);
    if (filter.openOnly) query = query.gt('open_roles', 0);
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      query = query.or(`name.ilike.${term},brief.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error || !data) return { briefs: [] as PublicBrief[], nextCursor: null, hasMore: false };

    let briefs = data as unknown as PublicBrief[];

    // Discipline filtering happens here rather than in SQL: `roles` is a jsonb
    // aggregate inside the view, so filtering it server-side would need a
    // lateral join that costs more than filtering a page of 25 rows in memory.
    if (filter.disciplines?.length) {
      const wanted = new Set(filter.disciplines);
      briefs = briefs.filter((b) =>
        b.roles.some((r) => r.discipline && wanted.has(r.discipline) && r.status === 'open'),
      );
    }

    const hasMore = briefs.length > BRIEFS_PAGE_SIZE;
    const page = hasMore ? briefs.slice(0, BRIEFS_PAGE_SIZE) : briefs;

    return {
      briefs: page,
      nextCursor: page.length > 0 ? page[page.length - 1].created_at : null,
      hasMore,
    };
  },
);

/**
 * First render of /briefs: the feed, the viewer's disciplines, and the roles
 * they have already applied to — all concurrently.
 *
 * Fetching the applied set after the feed would be a textbook waterfall, and
 * it is what decides whether a card shows "Apply" or "Applied".
 */
export const loadBriefsPage = cache(async (filterKey: string) => {
  const viewer = await getViewer();
  if (!viewer) return null;

  const supabase = await db();
  const [page, myDisciplines, { data: applications }] = await Promise.all([
    loadBriefs(null, filterKey, viewer.tenantId, viewer.id),
    listMyDisciplines(viewer.id),
    supabase
      .from('tropical_applications')
      .select('role_id, status')
      .eq('user_id', viewer.id)
      .in('status', ['pending', 'pending_skill', 'accepted']),
  ]);

  return {
    viewer,
    ...page,
    myDisciplines,
    /** role_id -> status, so a card can distinguish "applied" from "waiting
     *  on you to add the skill". */
    appliedRoles: Object.fromEntries(
      (applications ?? []).map((a) => [a.role_id as string, a.status as string]),
    ),
  };
});

/**
 * The talent's own applications, with the project detail attached.
 *
 * Reads `tropical_my_applications`, a view added in migration 011. Before it,
 * an applicant could see that they had applied but nothing about the job —
 * RLS on tropical_projects is members-only and an applicant is not a member
 * until they are accepted. The view carries name, brief, status and deadline
 * and deliberately carries no amounts.
 */
export const loadMyApplications = cache(async (userId: string): Promise<MyApplication[]> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_my_applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as unknown as MyApplication[];
});

/**
 * Everyone who has applied to a project, with enough profile for the brand to
 * judge without opening another screen.
 *
 * One embedded query. The applicant list, their profile, their skills and
 * their showreel all arrive together, which is what lets the review popup
 * expand into a full card with no fetch on open.
 */
export const loadApplicants = cache(async (projectId: string): Promise<Applicant[]> => {
  const supabase = await db();

  const { data, error } = await supabase
    .from('tropical_applications')
    .select(
      `
      id, status, created_at, note, role_id,
      role:tropical_project_roles!tropical_applications_role_id_fkey(title),
      user:users!tropical_applications_user_id_fkey(
        id, username, name, avatar, bio,
        creative:creative_data(tags, passion, video),
        stats:user_stats(jobs_done),
        disciplines:tropical_creative_disciplines(discipline_slug)
      )
    `,
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[]).map((row) => {
    const user = one(row.user as never) as Record<string, unknown> | null;
    const creative = one(user?.creative as never) as Record<string, unknown> | null;
    const stats = one(user?.stats as never) as { jobs_done?: number } | null;

    return {
      id: row.id as string,
      status: row.status as Applicant['status'],
      created_at: row.created_at as string,
      note: (row.note as string | null) ?? null,
      role_id: row.role_id as string,
      role_title: (one(row.role as never) as { title?: string } | null)?.title ?? 'Role',
      user: {
        id: (user?.id as string) ?? '',
        username: (user?.username as string | null) ?? null,
        name: (user?.name as string | null) ?? null,
        avatar: (user?.avatar as string | null) ?? null,
        bio: (user?.bio as string | null) ?? null,
        passion: (creative?.passion as string | null) ?? null,
        tags: Array.isArray(creative?.tags)
          ? (creative.tags as unknown[]).filter((t): t is string => typeof t === 'string')
          : [],
        showreelUrl: (creative?.video as string | null) ?? null,
        disciplines: ((user?.disciplines as Array<{ discipline_slug: string }>) ?? []).map(
          (d) => d.discipline_slug,
        ),
        jobsDone: stats?.jobs_done ?? 0,
      },
    };
  });
});

/** Pending applicant count per project, for the sidebar and the info badge. */
export const countPendingApplications = cache(async (projectId: string): Promise<number> => {
  const supabase = await db();
  const { count } = await supabase
    .from('tropical_applications')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'pending');

  return count ?? 0;
});
