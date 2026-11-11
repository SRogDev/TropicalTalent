import type { AdminUserRow } from './types';

/**
 * Why an account is not in good standing.
 *
 * The console used to answer this with one boolean — `users.profile_completed`
 * — rendered as a single amber "incomplete". That was wrong in both
 * directions, which is why the screen could not be used to diagnose anything:
 *
 *   - Deleting an account sets profile_completed = false (migration 040
 *     anonymises the row rather than removing it), so every closed account read
 *     as an unfinished sign-up and inflated the count.
 *   - A sign-up that died PART WAY leaves profile_completed = true with no
 *     membership or no creative_data row. Those accounts read as healthy while
 *     being the ones actually stranded.
 *
 * So the flag alone is not a verdict, it is one input. These are the others.
 */
export type AccountHealth =
  /** Closed account. Not a fault — it suppresses every other signal. */
  | 'deleted'
  /** Never finished the wizard. Expected attrition, not breakage. */
  | 'unfinished'
  /** Auth user exists but the email was never confirmed: they cannot sign in. */
  | 'unconfirmed'
  /** BROKEN: flagged complete, but belongs to no tenant — stranded on /auth/no-access. */
  | 'no_membership'
  /** BROKEN: flagged complete, but has no creative_data / brand_data row. */
  | 'no_role_row'
  /** A talent with no picture. Brands have no photo step, so they never qualify. */
  | 'no_avatar'
  /** BROKEN: an auth.users row with no public.users row — invisible everywhere else. */
  | 'no_profile_row';

/** The inputs that do not live on the users row itself. */
export interface HealthInputs {
  hasMembership: boolean;
  hasRoleRow: boolean;
  emailConfirmed: boolean;
  hasAvatar: boolean;
}

const LABELS: Record<AccountHealth, { label: string; title: string }> = {
  deleted: {
    label: 'deleted',
    title: 'Account closed. The row survives, anonymised — see migration 040.',
  },
  unfinished: {
    label: 'unfinished',
    title: 'Started the sign-up wizard but never completed it. No action available.',
  },
  unconfirmed: {
    label: 'unconfirmed',
    title: 'Email address was never confirmed — this person cannot sign in.',
  },
  no_membership: {
    label: 'no membership',
    title:
      'Marked complete but belongs to no tenant. Sign-up failed part way; they are stranded on /auth/no-access.',
  },
  no_role_row: {
    label: 'no profile row',
    title:
      'Marked complete but has no creative_data / brand_data row. Sign-up failed part way; invisible to talent search.',
  },
  no_profile_row: {
    label: 'no profile row',
    title:
      'Has credentials but no public.users row at all. Cannot be seen anywhere else in the product; sign-up never wrote a profile.',
  },
  no_avatar: {
    label: 'no photo',
    title:
      'Creative with no profile picture. Either skipped the step or the upload failed silently.',
  },
};

export function healthLabel(h: AccountHealth): { label: string; title: string } {
  return LABELS[h];
}

/** The reasons that mean something is genuinely broken, as opposed to merely absent. */
export const BROKEN: readonly AccountHealth[] = ['no_profile_row', 'no_membership', 'no_role_row'];

export function isBroken(health: readonly AccountHealth[]): boolean {
  return health.some((h) => BROKEN.includes(h));
}

/**
 * Every reason this account is not healthy, most severe first.
 *
 * An empty array means healthy. Two rules shape the result and both exist to
 * stop the screen crying wolf:
 *
 *   1. `deleted` stands alone. A closed account is anonymised on purpose, so
 *      reporting it as also missing a photo and a profile row is noise.
 *   2. The BROKEN reasons are only reported when profile_completed is TRUE.
 *      Someone who abandoned the wizard legitimately has no membership and no
 *      role row — that is what abandoning it means. It is the CONTRADICTION —
 *      flagged complete, yet missing the rows completing it should have
 *      written — that indicates a failed write.
 */
export function accountHealth(
  user: Pick<AdminUserRow, 'role' | 'profileCompleted' | 'deletedAt'>,
  inputs: HealthInputs,
): AccountHealth[] {
  if (user.deletedAt) return ['deleted'];

  if (!user.profileCompleted) {
    return inputs.emailConfirmed ? ['unfinished'] : ['unfinished', 'unconfirmed'];
  }

  const health: AccountHealth[] = [];

  if (!inputs.hasMembership) health.push('no_membership');
  if (!inputs.hasRoleRow) health.push('no_role_row');
  if (!inputs.emailConfirmed) health.push('unconfirmed');

  // Talent only. Brands are never asked for a photo — neither wizard has the
  // step for them — so flagging them would report a deliberate product decision
  // as a fault on every brand account in the database.
  if (user.role === 'creative' && !inputs.hasAvatar) health.push('no_avatar');

  return health;
}
