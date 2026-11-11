'use server';

/**
 * Wallet actions — REMOVED in the TropicalTalent reference build.
 *
 * Payments are omitted entirely from this build: no payment provider, no
 * connected payout accounts, no withdrawals. This module keeps the export
 * surface the app was written against so the UI still compiles, but every
 * action refuses with a plain message instead of moving money.
 */
import { fail, type ActionResult } from '@/lib/utils';

const PAYMENTS_OMITTED =
  'Payments are omitted in this reference build — withdrawals are not available.';

export async function withdrawAction(): Promise<ActionResult<{ amount: number }>> {
  return fail(PAYMENTS_OMITTED);
}
