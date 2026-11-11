'use server';

/**
 * Escrow — REMOVED in the TropicalTalent reference build.
 *
 * Payments are omitted entirely from this build: no payment provider, no
 * checkout, no escrow funding, no releases, no payouts. This module keeps the
 * exact export surface the rest of the app was written against so the
 * workspace, delivery and budget UI still compile, but every action refuses
 * with a plain message instead of moving money.
 *
 * The historical escrow migrations (008, 015–017, 034, 046, 047) remain in
 * migrations/ as reference schema only; nothing in this build calls them to
 * fund or release anything.
 */
import { z } from 'zod';
import { fail, type ActionResult } from '@/lib/utils';

const PAYMENTS_OMITTED =
  'Payments are omitted in this reference build — escrow, funding and payouts are not available.';

const splitInput = z.object({
  budget: z.number().int().positive('Budget must be above zero'),
  roles: z
    .array(
      z.object({
        roleId: z.string().uuid(),
        percentage: z.number().positive('Role share must be above 0').max(100),
      }),
    )
    .min(1, 'A project needs at least one role'),
});

export type BudgetSplitInput = z.infer<typeof splitInput>;

export async function createEscrowCheckoutAction(
  _projectId: string,
): Promise<ActionResult<{ url: string }>> {
  return fail(PAYMENTS_OMITTED);
}

export async function updateBudgetSplitAction(
  _projectId: string,
  _input: BudgetSplitInput,
): Promise<ActionResult<{ notified: number }>> {
  return fail(PAYMENTS_OMITTED);
}

export async function confirmEscrowReturnAction(
  _projectId: string,
  _sessionId: string,
): Promise<ActionResult<{ funded: boolean }>> {
  return fail(PAYMENTS_OMITTED);
}

export async function notifyEscrowFunded(
  _result:
    | {
        out_project_id: string;
        just_funded: boolean;
        out_brand_id: string | null;
        project_name: string | null;
        assigned_creative_ids: string[] | null;
      }
    | undefined,
): Promise<void> {
  return;
}

export async function releaseRoleAction(_roleId: string): Promise<ActionResult<null>> {
  return fail(PAYMENTS_OMITTED);
}

export async function markRoleDeliveredAction(_roleId: string): Promise<ActionResult<null>> {
  return fail(PAYMENTS_OMITTED);
}

export async function releaseAllDeliveredRolesAction(
  _projectId: string,
): Promise<ActionResult<{ count: number }>> {
  return fail(PAYMENTS_OMITTED);
}
