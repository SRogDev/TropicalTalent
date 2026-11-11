import 'server-only';

import { cache } from 'react';

/**
 * Wallet reads — STUB in the TropicalTalent reference build.
 *
 * Payments are omitted entirely from this build, so there are no balances,
 * holds or transactions to read. The /wallet page is a placeholder and no
 * longer calls these, but the export surface is kept so nothing that still
 * references the module breaks. All figures are zero by construction.
 */

export interface WalletSummary {
  available: number;
  pending: number;
  lifetimeEarned: number;
  currency: string;
  canWithdraw: boolean;
  hasConnectedAccount: boolean;
  holds: Array<{
    id: string;
    amount: number;
    status: string;
    roleTitle: string;
    projectName: string;
    projectId: string;
  }>;
  transactions: Array<{
    id: string;
    amount: number;
    type: string;
    status: string;
    created_at: string;
    projectName: string | null;
    failureReason: string | null;
  }>;
}

export const loadWallet = cache(async (_userId: string): Promise<WalletSummary> => {
  return {
    available: 0,
    pending: 0,
    lifetimeEarned: 0,
    currency: 'GBP',
    canWithdraw: false,
    hasConnectedAccount: false,
    holds: [],
    transactions: [],
  };
});

/** What a brand has committed, for the brand-side view of the same page. */
export const loadBrandSpend = cache(async (_brandId: string) => {
  return { projects: [], committed: 0, currency: 'GBP' };
});
