import 'server-only';

import { cache } from 'react';
import { db } from '@/lib/supabase';
import { tierFor } from './tiers';

/**
 * The signed-in user's referral standing.
 *
 * One RPC returns the code, the confirmed count and the tier together —
 * `tropical_my_referrals()` resolves all three server-side so the panel does not
 * fetch a code, then a count, then compute a tier.
 */

export interface ReferralSummary {
  code: string | null;
  confirmed: number;
  tier: number;
}

export const loadMyReferrals = cache(async (): Promise<ReferralSummary> => {
  const supabase = await db();
  const { data, error } = await supabase.rpc('tropical_my_referrals');

  // A missing RPC (migration 014 not applied) must not break the profile page.
  // No code means the panel renders its "not available yet" state.
  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return { code: null, confirmed: 0, tier: 0 };
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    referral_code: string | null;
    confirmed: number | string;
    tier: number;
  };

  const confirmed = Number(row.confirmed) || 0;

  return {
    code: row.referral_code,
    confirmed,
    // Trust the database's tier, but fall back to the shared TS ladder if the
    // RPC ever returns it null.
    tier: typeof row.tier === 'number' ? row.tier : tierFor(confirmed),
  };
});

/** Who the user has brought in, for the list under the panel. */
export const loadReferredUsers = cache(async (userId: string) => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_referrals')
    .select(
      `
      id, created_at, referred_role, status,
      referred:users!tropical_referrals_referred_id_fkey(id, username, name, avatar)
    `,
    )
    .eq('referrer_id', userId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return data as unknown as Array<{
    id: string;
    created_at: string;
    referred_role: string | null;
    status: string;
    referred: {
      id: string;
      username: string | null;
      name: string | null;
      avatar: string | null;
    } | null;
  }>;
});
