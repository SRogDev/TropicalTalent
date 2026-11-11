import 'server-only';

/**
 * The recurring billing engine — STUB in the TropicalTalent reference build.
 *
 * Payments are omitted entirely from this build: no charges, no saved
 * payment methods, no pay runs. The cron route that drove this engine
 * (app/api/cron/recurring-billing) is deleted, and the payment webhook that
 * fed it is gone with it. This module keeps the export surface the old engine
 * exposed so any remaining reference still resolves, but every pass is a
 * no-op that reports zero work done.
 */

export interface BillingRunResult {
  funded: number;
  failed: number;
  released: number;
  scheduled: number;
  paused: number;
  notes: string[];
}

function emptyResult(): BillingRunResult {
  return { funded: 0, failed: 0, released: 0, scheduled: 0, paused: 0, notes: [] };
}

export async function markCardSetupFailed(_roleId: string, _reason: string): Promise<void> {
  return;
}

export async function sendCardSavedEmail(_projectId: string): Promise<void> {
  return;
}

export async function fundDuePeriods(_result: BillingRunResult): Promise<void> {
  return;
}

export async function fundDuePeriodsForProject(_projectId: string): Promise<BillingRunResult> {
  return emptyResult();
}

export async function releaseDuePeriods(_result: BillingRunResult): Promise<void> {
  return;
}

export async function scheduleUpcomingPeriods(_result: BillingRunResult): Promise<void> {
  return;
}
