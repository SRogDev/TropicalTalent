/**
 * Recurring engagements.
 *
 * A retainer is a role that pays on a schedule instead of once. The money
 * model is deliberately NOT the escrow pot — see the header of migration 027
 * for why — but the guarantee is the same: the brand is charged before a
 * period starts, so a talent never works a period nobody paid for.
 */

export type PayModel = 'fixed' | 'recurring';
export type PeriodCadence = 'weekly' | 'monthly';

/** auto releases on the schedule; manual waits for the brand. */
export type PeriodApproval = 'auto' | 'manual';

/**
 * Where one period is up to.
 *
 * `scheduled`      exists, not yet charged
 * `funding`        a charge is in flight
 * `funded`         money taken and held — the talent may work it
 * `funding_failed` the charge did not clear; the brand has been told
 * `delivered`      manual-approval only: waiting on the brand
 * `released`       paid to the talent's balance
 * `skipped`        deliberately not run (paused mid-cycle)
 * `disputed`       held back pending a complaint
 *
 * None of these ever appear on tropical_projects.status. That separation is the
 * invariant the whole feature rests on.
 */
export type PeriodStatus =
  | 'scheduled'
  | 'funding'
  | 'funded'
  | 'funding_failed'
  | 'delivered'
  | 'released'
  | 'skipped'
  | 'disputed';

export interface RolePeriod {
  id: string;
  roleId: string;
  projectId: string;
  creativeId: string | null;
  periodStart: string;
  periodEnd: string;
  gross: number;
  platformFee: number;
  partnerFee: number;
  net: number;
  status: PeriodStatus;
  failureReason: string | null;
  attempts: number;
  releasedAt: string | null;
}

/** The schedule attached to a role, as the UI needs it. */
export interface RecurringTerms {
  payModel: PayModel;
  period: PeriodCadence | null;
  periodAmount: number | null;
  approval: PeriodApproval;
  nextPeriodStart: string | null;
  endsAt: string | null;
  pausedAt: string | null;
  /**
   * When the brand explicitly chose automatic or manual release.
   *
   * Distinct from `approval` being 'auto', which is only the column default.
   * The set-up checklist needs "they have decided", not "the database has a
   * value", or every engagement would arrive with that box already ticked.
   */
  approvalConfirmedAt: string | null;
  /**
   * When the engagement first started paying, i.e. when a card was saved.
   *
   * Never cleared. A retainer that pauses after three declined charges has
   * still been activated, and 027's invariant is explicit that a funding
   * failure must not close the group channel — so this, not `pausedAt`, is
   * what the channel and the set-up screen key off.
   */
  activatedAt: string | null;
  /**
   * An outstanding card save, as the server knows it.
   *
   * 'pending' from the moment the brand is sent to payment provider until something
   * resolves it; 'failed' when payment provider told us it did not work; null when there
   * is nothing outstanding. Held on the server rather than in React state, so
   * refreshing the page does not turn "we are waiting on payment provider" back into
   * "save a card" — which is what made a brand save a second one.
   */
  cardSetupStatus: 'pending' | 'failed' | null;
  cardSetupStartedAt: string | null;
  cardSetupError: string | null;
}

/**
 * The card on file for one (tenant, brand), as the UI needs it.
 *
 * Everything here is a display copy of what payment provider told us at save time. The
 * charge itself uses `default_payment_method` on the row and nothing else, so
 * a stale brand or last4 misreports a card, it never mischarges one.
 */
export interface BillingProfile {
  hasCard: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  updatedAt: string | null;
}

/**
 * How many days before a period starts we take the money.
 *
 * This lead time is what makes "we stop the next period" a workable
 * escalation. A failed charge is discovered before the talent has begun
 * working that period, so the answer is to pause — never to claw back work
 * already delivered.
 */
export const FUND_LEAD_DAYS = 3;

/**
 * Consecutive failures before the engagement pauses itself.
 *
 * Not zero, because a card declining once is routine and a retainer that
 * stops on the first blip is worse than useless. Not unbounded, because
 * accruing unpaid periods forever is how a contractor ends up working three
 * months for free.
 */
export const MAX_FUNDING_ATTEMPTS = 3;

/** Human wording for a period, used in the UI and in emails. */
export function periodLabel(p: Pick<RolePeriod, 'periodStart' | 'periodEnd'>): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(p.periodStart)} – ${fmt(p.periodEnd)}`;
}

/**
 * The day a period's money actually leaves the brand's card.
 *
 * FUND_LEAD_DAYS before the period starts, which is the fact brands are
 * surprised by — they read "monthly from the 1st" and expect the 1st. Stated
 * on every screen that shows a schedule rather than discovered on a statement.
 */
/**
 * The earliest start date a brand may book.
 *
 * FUND_LEAD_DAYS out, because that is when the money for a period is taken. A
 * period starting sooner than the lead time is one the pay run charges on or
 * after the day it begins — which is the one thing the whole schedule exists to
 * prevent: "a talent never works a period nobody paid for". Booking one for
 * tomorrow does not make the money arrive faster, it just moves the charge to
 * the wrong side of the start.
 *
 * Deliberately NOT enforced in tropical_create_retainer_project. Backdating is
 * legitimate for the engine — a dev script creates periods that
 * have already ended so the release pass has something to exercise — so this is
 * a rule about what a brand may book, not an invariant about what a period may
 * be.
 */
export function earliestStart(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + FUND_LEAD_DAYS);
  return d.toISOString().slice(0, 10);
}

export function chargeDate(periodStart: string): string {
  const d = new Date(`${periodStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - FUND_LEAD_DAYS);
  return d.toISOString().slice(0, 10);
}
