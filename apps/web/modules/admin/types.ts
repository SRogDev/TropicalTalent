import type { AccountHealth } from './health';

export interface AdminOverview {
  counts: {
    creatives: number;
    brands: number;
    admins: number;
    projects: number;
    activeProjects: number;
    openDisputes: number;
  };
  escrow: {
    funded: number;
    released: number;
    held: number;
    currency: string;
  };
}

export interface AdminUserRow {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  role: 'creative' | 'brand' | 'admin';
  createdAt: string | null;
  lastSignInAt: string | null;
  profileCompleted: boolean;
  /**
   * Every reason this account is not in good standing, most severe first.
   *
   * Empty means healthy. Derived by accountHealth() rather than stored —
   * profile_completed alone was both over- and under-reporting, see health.ts.
   */
  health: AccountHealth[];
  verification: string | null;
  jobsDone: number | null;
  totalRevenue: number | null;
  /**
   * When this account was closed, or null if it is live.
   *
   * The users row survives a deletion, anonymised — migration 040 explains why
   * it has to — so without this the console would show a closed account as an
   * ordinary member called "Deleted account" and nobody could tell the
   * difference between that and a very odd display name.
   */
  deletedAt: string | null;
}

export interface AdminProjectRow {
  id: string;
  name: string;
  status: string;
  visibility: 'public' | 'private' | 'both';
  budget: number;
  currency: string;
  brandName: string | null;
  roleCount: number;
  filledRoleCount: number;
  escrowStatus: string | null;
  createdAt: string;
  /** Set when the project was archived. Archived rows are invisible to every
   *  user-facing query (migration 045) but remain here, which is the point. */
  archivedAt: string | null;
}

export interface AdminEarnings {
  totals: {
    funded: number;
    released: number;
    held: number;
    refunded: number;
    platformFees: number;
    /** Share of platformFees owed onward to a white-label partner. 0 on classic. */
    partnerFees: number;
    currency: string;
  };
  recentTransactions: Array<{
    id: string;
    userName: string | null;
    projectName: string | null;
    amount: number;
    type: string;
    status: string;
    createdAt: string;
  }>;
  topEarners: Array<{
    userId: string;
    name: string | null;
    username: string | null;
    lifetimeEarned: number;
  }>;
}

export interface AdminDisputeRow {
  id: string;
  projectId: string;
  projectName: string;
  roleTitle: string | null;
  raisedByName: string | null;
  raisedByUsername: string | null;
  category: string;
  detail: string;
  status: string;
  resolution: string | null;
  createdAt: string;
}

/** A tier a user has earned but the TropicalTalent team has not yet delivered. */
export interface AdminReferralRewardRow {
  userId: string;
  name: string | null;
  username: string | null;
  email: string | null;
  role: 'creative' | 'brand';
  tier: number;
  threshold: number;
  rewardTitle: string;
  referralCount: number;
}

export interface AdminFulfilledReferralRewardRow {
  userId: string;
  name: string | null;
  username: string | null;
  tier: number;
  rewardTitle: string;
  fulfilledAt: string;
  fulfilledByName: string | null;
  note: string | null;
}
