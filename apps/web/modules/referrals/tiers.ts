/**
 * The referral reward ladder.
 *
 * Same thresholds for everyone — 1, 5, 10 — but the reward at each rung
 * differs by which side of the marketplace you are on. A talent wants an
 * audit of their craft and access to brands; a brand wants their story
 * sharpened and access to talent. The same words for both would be wrong for
 * one of them.
 *
 * The top rung is deliberately the commercial one: it is the reward that costs
 * TropicalTalent real revenue, so it sits behind the most work.
 *
 * Thresholds and labels are duplicated in SQL — `tropical_referral_tier()` and
 * the `reward_unlocked` CASE in migration 014 — because the team reads
 * `tropical_referral_stats` directly in the Supabase dashboard and needs the tier
 * resolved there without the app. That is the one place the scheme is stated
 * twice; change both together, and the migration's comment points back here.
 *
 * Pure data with no imports, so it is safe on the client and in the RSC layer.
 */

import { siteUrl } from '@/lib/urls';

export type ReferralAudience = 'creative' | 'brand';

interface TierCopy {
  title: string;
  description: string;
}

export interface ReferralTier {
  /** 1, 2, 3. Tier 0 is "no reward yet" and has no entry. */
  tier: number;
  /** Referrals needed to unlock. */
  threshold: number;
  creative: TierCopy;
  brand: TierCopy;
}

export const REFERRAL_TIERS: ReferralTier[] = [
  {
    tier: 1,
    threshold: 1,
    creative: {
      title: 'Free creative director audit',
      description: 'A senior creative director reviews your profile and your work, one to one.',
    },
    brand: {
      title: 'Complimentary brand story audit',
      description: 'A senior creative director reviews how your brand tells its story, one to one.',
    },
  },
  {
    tier: 2,
    threshold: 5,
    creative: {
      title: 'Personal intros to our brand partners',
      description: 'We introduce you directly to the brands we work with in your location.',
    },
    brand: {
      title: 'Personal intros to top creatives',
      description: 'We introduce you directly to the best creatives on TropicalTalent in your location.',
    },
  },
  {
    tier: 3,
    threshold: 10,
    creative: {
      title: 'No commission on your first 2 projects',
      description: 'TropicalTalent waives its platform fee on the next two projects you complete.',
    },
    brand: {
      title: 'No commission on your first 2 projects',
      description: 'TropicalTalent waives its platform fee on the next two projects you run.',
    },
  },
];

/** A tier with the copy for one audience already resolved. */
export interface ResolvedTier {
  tier: number;
  threshold: number;
  title: string;
  description: string;
}

export function tiersFor(audience: ReferralAudience): ResolvedTier[] {
  return REFERRAL_TIERS.map((t) => ({
    tier: t.tier,
    threshold: t.threshold,
    ...t[audience],
  }));
}

/** Which tier a count has reached. 0 means none yet. Audience-independent. */
export function tierFor(count: number): number {
  let reached = 0;
  for (const t of REFERRAL_TIERS) if (count >= t.threshold) reached = t.tier;
  return reached;
}

/** The next tier to aim at, or null once the ladder is finished. */
export function nextTier(count: number, audience: ReferralAudience): ResolvedTier | null {
  return tiersFor(audience).find((t) => count < t.threshold) ?? null;
}

/** How many more referrals until the next reward. 0 when the ladder is done. */
export function referralsToNext(count: number): number {
  const next = REFERRAL_TIERS.find((t) => count < t.threshold);
  return next ? next.threshold - count : 0;
}

/** The share URL carrying a code. Used for the copy button and native share. */
export function referralLink(code: string, origin?: string): string {
  const base = origin ?? siteUrl();
  const root = base.startsWith('http') ? base : `https://${base}`;
  return `${root.replace(/\/$/, '')}/?ref=${encodeURIComponent(code)}`;
}
