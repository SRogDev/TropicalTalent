import 'server-only';

import { cache } from 'react';
import { db } from '@/lib/supabase';
import { one } from '@/lib/utils';
import type { TalentCandidate, TalentFilter, TalentPage } from './types';

/**
 * Talent discovery and matching.
 *
 * One query shape serves both surfaces — the Talent page and the team
 * builder's candidate pool — because they want the same thing: talent,
 * with their skills and their showreel, ranked. Having two near-identical
 * queries drift apart is how the old Discover page ended up showing a
 * different set of people from the one the builder proposed.
 */

export const TALENT_PAGE_SIZE = 24;

export function talentFilterKey(filter: TalentFilter): string {
  if (!filter || Object.keys(filter).length === 0) return '';
  return JSON.stringify({
    search: filter.search?.trim().toLowerCase() || undefined,
    disciplines: filter.disciplines?.slice().sort(),
    favouritesOnly: filter.favouritesOnly || undefined,
  });
}

/**
 * `membership` is an INNER embed and it is the tenant boundary, not a
 * convenience. PostgREST turns it into a join, and the SELECT policy on
 * tropical_tenant_members (migration 024) only exposes rows for tenants the
 * caller belongs to — so a talent in another tenant cannot satisfy the join
 * and is pruned by Postgres. The `.eq('membership.tenant_id', ...)` in the
 * query builders below narrows it to ONE tenant when the caller is in several;
 * dropping or mistyping that filter would widen the result to the caller's own
 * tenants and no further, never to a stranger's.
 */
const TENANT_MEMBERSHIP_EMBED = 'membership:tropical_tenant_members!inner(tenant_id)';

const TALENT_SELECT = `
  id, username, name, avatar, bio, created_at,
  ${TENANT_MEMBERSHIP_EMBED},
  creative:creative_data(tags, passion, video, verification),
  stats:user_stats(jobs_done),
  disciplines:tropical_creative_disciplines(discipline_slug, is_primary),
  place:locations(city, county, country)
`;

/**
 * The same select with a second, aliased embed of the discipline table marked
 * `!inner`, so a filter on `match.discipline_slug` filters the PARENT rows.
 *
 * `disciplines` stays as it is because an inner embed only returns the rows
 * that matched the filter — a talent found by "videographer" would come back
 * claiming that is the only discipline they have, and their tile would lose
 * the rest. The two embeds cost one join each and keep both facts true.
 */
const TALENT_SELECT_BY_DISCIPLINE = `${TALENT_SELECT},
  match:tropical_creative_disciplines!inner(discipline_slug)
`;

/**
 * One page of talent.
 *
 * Keyset pagination on created_at, same reasoning as the briefs feed: OFFSET
 * makes Postgres walk and discard every skipped row. `created_at` is unique
 * enough to key on here — it is set by the auth trigger at sign-up, to
 * microsecond precision.
 *
 * The favourites filter is applied as an `in` on the viewer's favourite ids
 * rather than by joining, so the common case (no filter) costs nothing.
 *
 * Every filter is applied in SQL. Discipline filtering used to run in memory
 * AFTER the 24-row limit, which meant the page was cut to whoever happened to
 * be in the newest 24 rows and the cursor was then read from the wrong index —
 * a skill filter could hide most of the people it should have found, and
 * paging past the first screen skipped rows outright.
 */
export const loadTalent = cache(
  async (
    viewerId: string,
    tenantId: string,
    cursor: string | null,
    filterKey: string,
  ): Promise<TalentPage> => {
    const filter: TalentFilter = filterKey ? JSON.parse(filterKey) : {};
    const supabase = await db();

    const favouriteIds = await loadFavouriteIds(viewerId);

    if (filter.favouritesOnly && favouriteIds.length === 0) {
      return { candidates: [], nextCursor: null, hasMore: false };
    }

    const byDiscipline = (filter.disciplines?.length ?? 0) > 0;

    let query = supabase
      .from('users')
      .select(byDiscipline ? TALENT_SELECT_BY_DISCIPLINE : TALENT_SELECT)
      .eq('role', 'creative')
      // The tenant boundary. Ahead of the limit, so paging walks the tenant's
      // own roster rather than slicing the global one and then filtering.
      .eq('membership.tenant_id', tenantId)
      .eq('membership.status', 'active')
      .neq('id', viewerId)
      .order('created_at', { ascending: false })
      // One extra row is the "is there another page" probe. It is dropped
      // before the page is returned.
      .limit(TALENT_PAGE_SIZE + 1);

    if (cursor) query = query.lt('created_at', cursor);
    if (filter.favouritesOnly) query = query.in('id', favouriteIds);
    if (byDiscipline) query = query.in('match.discipline_slug', filter.disciplines!);
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      // Case-insensitive across the fields a brand actually types into:
      // a person's name, their handle, and how they describe themselves.
      query = query.or(`name.ilike.${term},username.ilike.${term},bio.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error || !data) return { candidates: [], nextCursor: null, hasMore: false };

    const rows = data as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > TALENT_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, TALENT_PAGE_SIZE) : rows;

    const favourites = new Set(favouriteIds);
    // The Talent page lists by recency, not by rank() — recommend rates only
    // matter to the /create pool below, so this stays a plain, cheap lookup.
    const candidates = page.map((row) => toCandidate(row, favourites, EMPTY_RATES));

    // The cursor is the last row of the page the caller is being given, not of
    // the probe row, or the next page would start one person too late.
    const nextCursor = hasMore
      ? ((page[page.length - 1]?.created_at as string | undefined) ?? null)
      : null;

    return { candidates, nextCursor, hasMore: hasMore && nextCursor !== null };
  },
);

export interface CandidatePool {
  /** discipline slug -> ranked candidates. Drives auto-assignment and swap. */
  byDiscipline: Record<string, TalentCandidate[]>;
  /**
   * EVERY talent, including those with no discipline on their profile.
   *
   * This exists because `byDiscipline` is built by iterating each talent's
   * discipline rows — so a talent with none appears in no bucket and is
   * invisible to anything derived from it. On the live roster that is 4 of 37
   * people: profiles with no tags and no passion, which the tag backfill had
   * nothing to work from. Deriving the by-name search from `byDiscipline`
   * meant a brand who knew one of them by name still could not add them.
   */
  roster: TalentCandidate[];
}

/**
 * The candidate pool for the team builder.
 *
 * Ranked within each discipline, best first:
 *   1. primary discipline over secondary — someone who calls themselves a
 *      Videographer first beats someone who lists it fourth
 *   2. favourited by this brand
 *   3. completed jobs
 *   4. has an avatar — a face makes the crew read as real
 *   5. username, for a stable order
 *
 * One query serves both shapes. Re-rolling a role or searching by name walks
 * the result in memory, so both are instant and need no spinner.
 */
export const loadCandidatePool = cache(
  async (viewerId: string, tenantId: string): Promise<CandidatePool> => {
    const supabase = await db();

    const [{ data, error }, favouriteIds] = await Promise.all([
      supabase
        .from('users')
        .select(TALENT_SELECT)
        .eq('role', 'creative')
        // Same tenant scoping as loadTalent. This file's header warns that the
        // two query shapes must not drift; the boundary is the one place where
        // drifting would be a leak rather than an inconsistency.
        .eq('membership.tenant_id', tenantId)
        .eq('membership.status', 'active')
        .neq('id', viewerId)
        .order('created_at', { ascending: false }),
      loadFavouriteIds(viewerId),
    ]);

    if (error || !data) return { byDiscipline: {}, roster: [] };

    const favourites = new Set(favouriteIds);
    const rates = await loadRecommendRates(
      (data as unknown as Record<string, unknown>[]).map((row) => row.id as string),
    );
    const byDiscipline: Record<string, TalentCandidate[]> = {};
    const roster: TalentCandidate[] = [];

    for (const row of data as unknown as Record<string, unknown>[]) {
      // One object per talent for the roster, so identity is stable and the
      // name search does not hand back a different instance than the pool.
      roster.push(toCandidate(row, favourites, rates));

      const rawDisciplines =
        (row.disciplines as Array<{ discipline_slug: string; is_primary: boolean }>) ?? [];

      for (const { discipline_slug, is_primary } of rawDisciplines) {
        const candidate = toCandidate(row, favourites, rates);
        candidate.isPrimaryMatch = Boolean(is_primary);
        (byDiscipline[discipline_slug] ??= []).push(candidate);
      }
    }

    for (const list of Object.values(byDiscipline)) {
      list.sort(rank);
    }
    roster.sort(rank);

    return { byDiscipline, roster };
  },
);

/**
 * Recommend rate is a light tiebreaker, not a filter: it only ever decides
 * between two candidates who are otherwise tied on favourite status, and only
 * once each has enough feedback for the rate to mean something. A talent
 * with one "don't recommend" should not sink below everyone with none.
 */
const MIN_FEEDBACK_FOR_RANKING = 2;

function rank(a: TalentCandidate, b: TalentCandidate): number {
  if (a.isPrimaryMatch !== b.isPrimaryMatch) return a.isPrimaryMatch ? -1 : 1;
  if (a.isFavourite !== b.isFavourite) return a.isFavourite ? -1 : 1;
  if (
    a.feedbackCount >= MIN_FEEDBACK_FOR_RANKING &&
    b.feedbackCount >= MIN_FEEDBACK_FOR_RANKING &&
    a.recommendRate !== b.recommendRate
  ) {
    return (b.recommendRate ?? 0) - (a.recommendRate ?? 0);
  }
  if (a.jobsDone !== b.jobsDone) return b.jobsDone - a.jobsDone;
  const av = a.avatar ? 1 : 0;
  const bv = b.avatar ? 1 : 0;
  if (av !== bv) return bv - av;
  return (a.username ?? '').localeCompare(b.username ?? '');
}

/**
 * The spotlight talent.
 *
 * Picked from candidates with an avatar and something to say — a spotlight
 * with a blank tile and no bio undersells both the person and the feature.
 *
 * The choice rotates daily and is derived from the date, not from Math.random:
 * a random pick would land on a different person on every navigation, which
 * reads as a glitch rather than a feature, and would differ between the server
 * render and any re-render.
 */
export function pickSpotlight(
  candidates: TalentCandidate[],
  today = new Date(),
): TalentCandidate | null {
  const eligible = candidates.filter((c) => c.avatar && (c.bio || c.passion));
  const pool = eligible.length > 0 ? eligible : candidates;
  if (pool.length === 0) return null;

  const dayIndex = Math.floor(today.getTime() / 86_400_000);
  return pool[dayIndex % pool.length];
}

/** The viewer's favourited talent ids. */
export const loadFavouriteIds = cache(async (viewerId: string): Promise<string[]> => {
  const supabase = await db();
  const { data } = await supabase
    .from('tropical_favourites')
    .select('creative_id')
    .eq('user_id', viewerId);

  return (data ?? []).map((f) => f.creative_id as string);
});

type RecommendRates = Map<string, { rate: number; count: number }>;
const EMPTY_RATES: RecommendRates = new Map();

/**
 * Aggregate recommend rate per talent, across every brand who has left
 * feedback — via tropical_recommend_rates(), a SECURITY DEFINER function that
 * returns only a rate and a count, never who gave it. See migration 019.
 */
async function loadRecommendRates(creativeIds: string[]): Promise<RecommendRates> {
  if (creativeIds.length === 0) return EMPTY_RATES;

  const supabase = await db();
  const { data } = await supabase.rpc('tropical_recommend_rates', { p_creative_ids: creativeIds });

  const rates: RecommendRates = new Map();
  for (const row of (data ?? []) as Array<{
    creative_id: string;
    recommend_rate: number;
    feedback_count: number;
  }>) {
    rates.set(row.creative_id, { rate: Number(row.recommend_rate), count: row.feedback_count });
  }
  return rates;
}

/**
 * A brand's own feedback on a completed project, keyed by talent id.
 *
 * Private by construction — RLS on tropical_creative_feedback already scopes
 * this to rows the brand wrote, so no explicit brand filter is needed here.
 */
export const loadProjectFeedback = cache(
  async (projectId: string): Promise<Record<string, boolean>> => {
    const supabase = await db();
    const { data } = await supabase
      .from('tropical_creative_feedback')
      .select('creative_id, recommend')
      .eq('project_id', projectId);

    return Object.fromEntries(
      (data ?? []).map((f) => [f.creative_id as string, f.recommend as boolean]),
    );
  },
);

/**
 * The brand's projects that still have an open role, for the invite menu.
 *
 * Narrow on purpose: the menu shows a project name and its open role titles,
 * so pulling budgets and briefs here would be dead weight in the RSC payload.
 */
export const loadInvitableProjects = cache(async (brandId: string) => {
  const supabase = await db();
  const { data } = await supabase
    .from('tropical_projects')
    .select('id, name, status, roles:tropical_project_roles(id, title, status, discipline_slug)')
    .eq('brand_id', brandId)
    .in('status', ['draft', 'pending_payment', 'active'])
    .order('created_at', { ascending: false });

  return (data ?? [])
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      openRoles: (
        (p.roles as Array<{
          id: string;
          title: string;
          status: string;
          discipline_slug: string;
        }>) ?? []
      )
        .filter((r) => r.status === 'open')
        .map((r) => ({ id: r.id, title: r.title, discipline: r.discipline_slug })),
    }))
    .filter((p) => p.openRoles.length > 0);
});

function toCandidate(
  row: Record<string, unknown>,
  favourites: Set<string>,
  rates: RecommendRates,
): TalentCandidate {
  const creative = one(row.creative as never) as Record<string, unknown> | null;
  const stats = one(row.stats as never) as { jobs_done?: number } | null;
  const place = one(row.place as never) as {
    city?: string;
    county?: string;
    country?: string;
  } | null;
  const feedback = rates.get(row.id as string);

  return {
    id: row.id as string,
    username: (row.username as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    avatar: (row.avatar as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    passion: (creative?.passion as string | null) ?? null,
    tags: Array.isArray(creative?.tags)
      ? (creative.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    disciplines: ((row.disciplines as Array<{ discipline_slug: string }>) ?? []).map(
      (d) => d.discipline_slug,
    ),
    showreelUrl: (creative?.video as string | null) ?? null,
    locationDisplay: place
      ? [place.city, place.county, place.country].filter(Boolean).join(', ')
      : null,
    jobsDone: stats?.jobs_done ?? 0,
    isFavourite: favourites.has(row.id as string),
    isPrimaryMatch: false,
    recommendRate: feedback?.rate ?? null,
    feedbackCount: feedback?.count ?? 0,
  };
}
