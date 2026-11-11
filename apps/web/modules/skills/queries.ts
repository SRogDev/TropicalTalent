import 'server-only';

import { cache } from 'react';
import { db } from '@/lib/supabase';
import type { Discipline } from './types';

/**
 * The discipline vocabulary.
 *
 * The whole active list is a few hundred short rows — smaller than one avatar
 * — so it is fetched once per request and every search, filter and picker runs
 * against it in memory. That is what makes the skill and role search feel
 * instant: there is no request between the keystroke and the result.
 *
 * Revisit if the vocabulary passes a few thousand entries; at that point the
 * pickers should call `searchDisciplines()` against Postgres instead.
 */
export const listDisciplines = cache(async (): Promise<Discipline[]> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_disciplines')
    .select('slug, label, category')
    .eq('is_active', true)
    .order('sort_order')
    .order('label');

  if (error || !data) return [];
  return data as Discipline[];
});

/**
 * Server-side discipline search, for the case where the in-memory list is not
 * available (or grows past the point where shipping it is sensible).
 *
 * Case-insensitive on the label. `ilike` with a leading wildcard cannot use a
 * btree index, which is fine at this table's size and is why 011 adds a
 * trigram index for when it is not.
 */
export const searchDisciplines = cache(async (term: string, limit = 20): Promise<Discipline[]> => {
  const query = term.trim();
  if (!query) return [];

  const supabase = await db();
  const { data } = await supabase
    .from('tropical_disciplines')
    .select('slug, label, category')
    .eq('is_active', true)
    .ilike('label', `%${query}%`)
    .order('label')
    .limit(limit);

  return (data ?? []) as Discipline[];
});

/** Discipline slugs the signed-in creative holds. Drives brief matching. */
export const listMyDisciplines = cache(async (userId: string): Promise<string[]> => {
  const supabase = await db();
  const { data } = await supabase
    .from('tropical_creative_disciplines')
    .select('discipline_slug')
    .eq('user_id', userId);

  return (data ?? []).map((d) => d.discipline_slug as string);
});

/** slug -> label, for rendering a stored slug without another lookup. */
export async function disciplineLabels(): Promise<Record<string, string>> {
  const list = await listDisciplines();
  return Object.fromEntries(list.map((d) => [d.slug, d.label]));
}
