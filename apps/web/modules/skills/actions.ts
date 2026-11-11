'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/supabase';
import { fail, ok, one, slugify, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { sendNotificationEmail } from '@/modules/notifications/email';
import type { Discipline } from './types';

/**
 * Skill writes.
 *
 * A talent member can add a skill that is not yet in the vocabulary. The new
 * discipline goes into `tropical_disciplines` as well as onto their profile —
 * that is deliberate, because the vocabulary is what the team builder and the
 * brief matcher search, so a skill that existed only on one profile would be
 * invisible to every brand.
 *
 * Migration 011 adds the INSERT policy that lets an authenticated user do this
 * (previously the table was read-only to everyone but the service role).
 */

/**
 * Adds a skill to the signed-in talent member's profile, creating the discipline
 * if it is new.
 *
 * Returns the resolved discipline so the caller can render the confirmed row
 * rather than the text that was typed — slugging can collapse "Motion
 * Designer" and "motion designer" onto one existing entry, and the UI should
 * show the canonical label when that happens.
 */
export async function addSkillAction(
  labelOrSlug: string,
  options: { isPrimary?: boolean } = {},
): Promise<ActionResult<Discipline>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const label = labelOrSlug.trim();
  if (!label) return fail('Give the skill a name.');
  if (label.length > 60) return fail('Keep skill names under 60 characters.');

  const slug = slugify(label);
  if (!slug) return fail('That skill name has no usable characters.');

  const supabase = await db();

  // Existing discipline wins, so casing and punctuation variants converge.
  const { data: existing } = await supabase
    .from('tropical_disciplines')
    .select('slug, label, category')
    .eq('slug', slug)
    .maybeSingle();

  let discipline = existing as Discipline | null;

  if (!discipline) {
    const { data: created, error } = await supabase
      .from('tropical_disciplines')
      .insert({ slug, label, category: 'other', is_active: true })
      .select('slug, label, category')
      .maybeSingle();

    // 23505 means another request created it between the read and the write.
    // Not an error — take theirs.
    if (error && error.code !== '23505') return fail(error.message);
    discipline =
      (created as Discipline | null) ?? ({ slug, label, category: 'other' } as Discipline);
  }

  const { error: linkError } = await supabase.from('tropical_creative_disciplines').upsert(
    {
      user_id: viewer.id,
      discipline_slug: discipline.slug,
      source: 'self',
      is_primary: options.isPrimary ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,discipline_slug' },
  );

  if (linkError) return fail(linkError.message);

  // Adding a skill can unblock applications that were parked waiting for it.
  // Read which ones BEFORE the RPC flips their status — mirrors the RPC's own
  // WHERE clause (011_tropical_v2_logic.sql) so the email set matches exactly
  // what it unlocks, since the RPC itself only returns a count.
  const { data: unlocking } = await supabase
    .from('tropical_applications')
    .select('role_id')
    .eq('user_id', viewer.id)
    .eq('status', 'pending_skill')
    .eq('required_discipline', discipline.slug);

  // The RPC is idempotent and returns how many it released.
  await supabase.rpc('tropical_release_skill_gated_applications', {
    p_user: viewer.id,
    p_discipline: discipline.slug,
  });

  if (unlocking && unlocking.length > 0) {
    const { data: roles } = await supabase
      .from('tropical_project_roles')
      .select(
        'project_id, title, status, project:tropical_projects!tropical_project_roles_project_id_fkey(name, brand_id)',
      )
      .in(
        'id',
        unlocking.map((a) => a.role_id),
      );

    await Promise.all(
      (roles ?? [])
        .filter((r) => r.status === 'open')
        .map((r) => {
          const project = one<{ name: string; brand_id: string }>(r.project);
          if (!project) return;
          return sendNotificationEmail({
            userId: project.brand_id,
            kind: 'application_unlocked',
            subject: `${viewer.name ?? 'A talent member'} applied to ${project.name}`,
            body: `${r.title} - the application is now visible.`,
            path: `/projects/${r.project_id}`,
          });
        }),
    );
  }

  revalidatePath('/profile/[username]', 'page');
  revalidatePath('/briefs');
  revalidatePath('/jobs');

  return ok(discipline);
}

export async function removeSkillAction(slug: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();
  const { error } = await supabase
    .from('tropical_creative_disciplines')
    .delete()
    .eq('user_id', viewer.id)
    .eq('discipline_slug', slug);

  if (error) return fail(error.message);

  revalidatePath('/profile/[username]', 'page');
  return ok(null);
}

/** Promotes one discipline to primary and demotes the rest. Primary is what
 *  ranks a candidate first in the team builder. */
export async function setPrimarySkillAction(slug: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();

  // Two statements, but they must not interleave with each other — demote
  // first so the partial state is "no primary" rather than "two primaries".
  const { error: demoteError } = await supabase
    .from('tropical_creative_disciplines')
    .update({ is_primary: false })
    .eq('user_id', viewer.id);
  if (demoteError) return fail(demoteError.message);

  const { error } = await supabase
    .from('tropical_creative_disciplines')
    .update({ is_primary: true })
    .eq('user_id', viewer.id)
    .eq('discipline_slug', slug);

  if (error) return fail(error.message);

  revalidatePath('/profile/[username]', 'page');
  return ok(null);
}
