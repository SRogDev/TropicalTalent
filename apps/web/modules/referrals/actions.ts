'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminDb } from '@/lib/supabase';
import { fail, ok, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';

const fulfillInput = z.object({
  userId: z.string().uuid(),
  tier: z.number().int().min(1).max(3),
  note: z.string().max(1000).optional(),
});

/**
 * Marks one referral reward tier as delivered.
 *
 * Admin-only, same re-check pattern as adminResolveDisputeAction — and for
 * the same reason uses adminDb() rather than a client RLS policy:
 * tropical_referral_reward_fulfillments has no policy letting anyone but this
 * function touch it, on purpose. The (user_id, tier) primary key makes a
 * duplicate mark-as-fulfilled a no-op rather than an error.
 */
export async function adminFulfillReferralRewardAction(
  input: z.infer<typeof fulfillInput>,
): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'admin') return fail('Admin access required.');

  const parsed = fulfillInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');

  const { error } = await adminDb()
    .from('tropical_referral_reward_fulfillments')
    .upsert(
      {
        user_id: parsed.data.userId,
        tier: parsed.data.tier,
        fulfilled_by: viewer.id,
        fulfilled_at: new Date().toISOString(),
        note: parsed.data.note?.trim() || null,
      },
      { onConflict: 'user_id,tier' },
    );

  if (error) return fail(error.message);

  revalidatePath('/admin/referrals');
  return ok(null);
}
