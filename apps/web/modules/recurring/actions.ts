'use server';

/**
 * Recurring-engagement writes — STUB in the TropicalTalent reference build.
 *
 * Retainers are a billing feature: scheduled periods charged to a saved
 * payment method. Payments are omitted entirely from this build, so no
 * retainer can be created, billed, carded or released. This module keeps the
 * exact export surface (and the input validation schemas) the retainer UI was
 * written against so it still compiles, but every action refuses with a plain
 * message.
 *
 * The pure schedule types and date helpers live on in ./types and ./queries
 * (period labels, dates, reads of the reference schema); only the
 * money-moving writes and the billing engine (./billing) are stubbed.
 */
import { z } from 'zod';
import { fail, type ActionResult } from '@/lib/utils';

const PAYMENTS_OMITTED =
  'Payments are omitted in this reference build — recurring billing is not available.';

const retainerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brief: z.string().trim().max(4000).optional().or(z.literal('')),
  roleTitle: z.string().trim().min(1).max(120),
  discipline: z.string().trim().max(80).optional().or(z.literal('')),
  creativeId: z.string().uuid({ message: 'Pick who this engagement is for.' }),
  period: z.enum(['weekly', 'monthly']),
  periodAmount: z.coerce.number().positive().max(1_000_000),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date.'),
  approval: z.enum(['auto', 'manual']).default('auto'),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an end date.'),
});

const scheduleSchema = z.object({
  roleId: z.string().uuid(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date.'),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a final delivery date.'),
});

const approvalSchema = z.object({
  roleId: z.string().uuid(),
  approval: z.enum(['auto', 'manual']),
});

const pauseSchema = z.object({
  roleId: z.string().uuid(),
  paused: z.boolean(),
});

export async function createRetainerAction(
  _form: FormData,
): Promise<ActionResult<{ projectId: string }>> {
  return fail(PAYMENTS_OMITTED);
}

export async function startRetainerBillingAction(
  _projectId: string,
): Promise<ActionResult<{ mode: 'checkout'; url: string } | { mode: 'activated' }>> {
  return fail(PAYMENTS_OMITTED);
}

export async function confirmRetainerBillingAction(
  _projectId: string,
  _sessionId: string,
): Promise<ActionResult<{ active: boolean }>> {
  return fail(PAYMENTS_OMITTED);
}

export async function updateRetainerCardAction(
  _projectId: string,
): Promise<ActionResult<{ url: string }>> {
  return fail(PAYMENTS_OMITTED);
}

export async function cancelCardSetupAction(_projectId: string): Promise<ActionResult<null>> {
  return fail(PAYMENTS_OMITTED);
}

export async function updateRetainerScheduleAction(
  _input: z.infer<typeof scheduleSchema>,
): Promise<ActionResult<null>> {
  return fail(PAYMENTS_OMITTED);
}

export async function setRetainerApprovalAction(
  _input: z.infer<typeof approvalSchema>,
): Promise<ActionResult<null>> {
  return fail(PAYMENTS_OMITTED);
}

export async function setRetainerPausedAction(
  _input: z.infer<typeof pauseSchema>,
): Promise<ActionResult<null>> {
  return fail(PAYMENTS_OMITTED);
}

export async function approvePeriodAction(_periodId: string): Promise<ActionResult<null>> {
  return fail(PAYMENTS_OMITTED);
}
