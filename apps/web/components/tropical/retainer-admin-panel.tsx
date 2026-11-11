'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Circle,
  Clock,
  CreditCard,
  Pause,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { formatPence } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { useTenantNouns } from './tenant-context';
import {
  approvePeriodAction,
  cancelCardSetupAction,
  confirmRetainerBillingAction,
  setRetainerApprovalAction,
  setRetainerPausedAction,
  startRetainerBillingAction,
  updateRetainerCardAction,
  updateRetainerScheduleAction,
} from '@/modules/recurring/actions';
import {
  chargeDate,
  earliestStart,
  periodLabel,
  type BillingProfile,
  type RecurringTerms,
  type RolePeriod,
} from '@/modules/recurring/types';
import type { RoleContract } from '@/modules/chat/types';

/**
 * Project Admin for a recurring engagement.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 * A retainer project used to render EscrowBanner here, like every other
 * project. A retainer has no pot — tropical_projects.budget is 0 by design
 * (029) — so a brand who had just committed to £2,000 a month was shown
 * "Escrow secured", a budget of £0, a team pool of £0 and a platform fee of
 * £0. Every figure on the screen was both true and useless.
 *
 * The money on a retainer is per period, so that is what this shows, with the
 * cadence attached to every figure and — the thing brands actually ask — the
 * date their card is next debited, which is FUND_LEAD_DAYS before a period
 * begins and not the day it starts.
 *
 * ---------------------------------------------------------------------------
 * The order of operations
 * ---------------------------------------------------------------------------
 * Everything below the figures is a checklist, and the card is its last item.
 * Creation used to send the brand to payment provider first, before they had seen the
 * fee, agreed the contract or fixed the dates — which is why the card step
 * appeared to ask twice and why nothing could be changed once it had. Dates
 * and contract are editable right up until the card is saved (migration 043
 * enforces that server-side, in both directions) and frozen after it.
 */

/**
 * How many times the page asks payment provider about an unconfirmed card before it
 * stops and says so.
 *
 * Bounded because a SetupIntent that has not confirmed in a minute is not
 * going to while somebody watches, and a checker that runs forever on an
 * abandoned tab is a request every five seconds for as long as it stays open.
 */
const MAX_CARD_CHECKS = 12;

interface Props {
  projectId: string;
  roleId: string;
  roleTitle: string;
  terms: RecurringTerms;
  periods: RolePeriod[];
  currency: string;
  platformFeePct: number;
  billing: BillingProfile;
  contract: RoleContract | null;
  deliverablesCount: number;
  /** The assignee's DM, where their contract lives. Null if unassigned. */
  contractChannelId: string | null;
  /** Jump to that DM with the contract panel already expanded. */
  onOpenContract: () => void;
  onOpenDeliverables: () => void;
}

export function RetainerAdminPanel({
  projectId,
  roleId,
  roleTitle,
  terms,
  periods,
  currency,
  platformFeePct,
  billing,
  contract,
  deliverablesCount,
  contractChannelId,
  onOpenContract,
  onOpenDeliverables,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const nouns = useTenantNouns();

  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  /**
   * The Checkout session, kept after its id is stripped from the URL.
   *
   * Set only when the first confirmation came back unconfirmed, and it is what
   * makes the waiting state able to DO something: re-asking payment provider about this
   * session activates the engagement the moment the SetupIntent succeeds,
   * without waiting on a webhook that may never reach this environment.
   */
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const [editingDates, setEditingDates] = useState(false);
  const [startDraft, setStartDraft] = useState(terms.nextPeriodStart?.slice(0, 10) ?? '');
  const [endDraft, setEndDraft] = useState(terms.endsAt?.slice(0, 10) ?? '');

  // The soonest a period may start: its money is taken FUND_LEAD_DAYS ahead.
  const earliest = earliestStart();

  const mine = periods.filter((p) => p.roleId === roleId);
  const activated = Boolean(terms.activatedAt);
  const paused = Boolean(terms.pausedAt);
  const cadence = terms.period === 'weekly' ? 'week' : 'month';

  // ---------------------------------------------------------------------
  // Money. Per period, never a pot.
  // ---------------------------------------------------------------------
  // Taken from the next real period row when one exists, because its fee was
  // frozen at scheduling time (027) and a tenant whose rate changed since must
  // not have that change appear retroactively on a period already agreed.
  // Oldest first. loadProjectPeriods returns newest-first for the history list,
  // which is the wrong order for every "what happens next" question below.
  const chrono = [...mine].sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  /**
   * The period whose money is already taken, and the next one that is not.
   *
   * These were one variable — the first period that was `scheduled` OR
   * `funded` — and collapsing them is what put a date in the past on the
   * screen. Once the current period is funded its charge has HAPPENED, so
   * deriving "next payment taken" from it reported the day the money already
   * left: a live weekly engagement that started on the 30th sat there saying
   * "Next payment taken 27 August".
   */
  const current = chrono.find(
    (p) => p.status === 'funded' || p.status === 'delivered' || p.status === 'funding',
  );
  const nextUncharged = chrono.find(
    (p) => p.status === 'scheduled' || p.status === 'funding_failed',
  );

  const priced = current ?? nextUncharged;
  const gross = priced?.gross ?? terms.periodAmount ?? 0;
  const fee = priced?.platformFee ?? Math.floor((gross * platformFeePct) / 100);
  const net = priced?.net ?? gross - fee;

  /**
   * When money next LEAVES the card.
   *
   * An uncharged period if one exists; otherwise the period the role will
   * schedule next — which before activation is the only answer there is, and
   * after it is the honest one. Null once the engagement has run out of
   * periods to bill, where the old code would have kept advertising one.
   */
  const nextChargeStart =
    nextUncharged?.periodStart ??
    (terms.nextPeriodStart && (!terms.endsAt || terms.nextPeriodStart < terms.endsAt)
      ? terms.nextPeriodStart
      : null);
  const nextCharge = nextChargeStart ? chargeDate(nextChargeStart) : null;

  // ---------------------------------------------------------------------
  // The return from payment provider
  // ---------------------------------------------------------------------
  // Mounted here rather than in a banner of its own: the success_url has no
  // channel, so the brand lands on their default channel, which for a project
  // owner is always Project Admin. The webhook is still the authoritative
  // path — tropical_activate_retainer is idempotent and both are expected to run.
  const billingParam = params.get('billing');
  const sessionId = params.get('session_id');

  // Guards the effect against StrictMode's double invocation in development:
  // state has not committed by the second pass, so a state flag in the
  // dependency array would not stop it.
  const confirmed = useRef(false);

  useEffect(() => {
    if (billingParam !== 'return' || !sessionId || confirmed.current) return;
    confirmed.current = true;
    setConfirming(true);

    startTransition(async () => {
      const result = await confirmRetainerBillingAction(projectId, sessionId);
      if (result.success === true) {
        // Strip the payment provider params either way, so a refresh cannot replay this.
        router.replace(`/projects/${projectId}`);
        router.refresh();
        // Not an error: payment provider has the card but has not finished confirming
        // it. Showing "save a card" again here is what made a brand who had
        // just saved one believe it had not worked.
        if (!result.data.active) setPendingSession(sessionId);
      } else {
        toast({
          title: 'Could not confirm the card',
          description: result.error,
          variant: 'destructive',
        });
      }
      setConfirming(false);
    });
  }, [billingParam, sessionId, projectId, router, toast, startTransition]);

  const cancelled = useRef(false);
  useEffect(() => {
    if (billingParam !== 'cancelled' || cancelled.current) return;
    cancelled.current = true;
    toast({
      title: 'Card step cancelled',
      description: 'The engagement is paused until a card is saved. Nothing has been charged.',
    });
    // Clears the outstanding attempt recorded before the redirect. Without
    // this the screen would sit on "waiting on payment provider" for a Checkout the
    // brand deliberately walked away from.
    void cancelCardSetupAction(projectId).then(() => router.refresh());
    router.replace(`/projects/${projectId}`);
  }, [billingParam, projectId, router, toast]);

  /**
   * Re-asking payment provider while a confirmation is outstanding.
   *
   * This used to call router.refresh() on a timer and tell the brand the page
   * would sort itself out. It could not: refresh only re-reads the database,
   * and the database only changes when the setup_intent.succeeded webhook
   * arrives. In any environment where that webhook is not being delivered —
   * local development, a misconfigured endpoint — the loop spun, nothing
   * moved, and the copy promised a resolution that was never coming.
   *
   * confirmRetainerBillingAction goes to payment provider itself and activates on a
   * succeeded SetupIntent, so re-running it is a check that resolves on its
   * own. `checks` is in the dependency array deliberately: each attempt
   * re-runs the effect and schedules the next, which a single interval could
   * not do without also fighting the re-render.
   */
  const recheck = useCallback(() => {
    // No session in hand — this tab was reloaded, or the state came from the
    // server rather than from a return leg. Re-reading is then the only honest
    // thing "Check now" can do, and it is not nothing: the webhook may have
    // resolved it since. A button that silently does nothing is the same
    // problem in a different place.
    if (!pendingSession) {
      startTransition(() => router.refresh());
      return;
    }
    startTransition(async () => {
      const result = await confirmRetainerBillingAction(projectId, pendingSession);
      if (result.success === true && result.data.active) {
        setPendingSession(null);
        router.refresh();
        return;
      }
      setChecks((n) => {
        // A payment provider error is not the same as "not confirmed yet", and going
        // quiet about it for a minute and then giving up tells the brand
        // nothing. Surfaced once, on the attempt that stops.
        if (result.success !== true && n + 1 >= MAX_CARD_CHECKS) {
          toast({
            title: 'Could not reach our payment provider',
            description: result.error,
            variant: 'destructive',
          });
        }
        return n + 1;
      });
    });
  }, [pendingSession, projectId, router, toast, startTransition]);

  useEffect(() => {
    // Activation can also arrive from the webhook under a refresh, in which
    // case there is nothing left to wait for.
    if (activated && pendingSession) {
      setPendingSession(null);
      return;
    }
    if (!pendingSession || checks >= MAX_CARD_CHECKS) return;

    const timer = setTimeout(recheck, 5000);
    return () => clearTimeout(timer);
  }, [pendingSession, checks, activated, recheck]);

  // ---------------------------------------------------------------------
  // The checklist
  // ---------------------------------------------------------------------
  /**
   * Dates are only "set" if the start is still bookable.
   *
   * The 3-day rule is checked when the engagement is created, but the period
   * is not scheduled until the card is saved — and nothing forces those to be
   * the same day. A brand who creates on the 1st for a start on the 4th and
   * comes back on the 10th would otherwise activate straight into a period
   * that began a week ago, charged after it started, which is the exact thing
   * the lead time exists to prevent. Re-checking here un-ticks the item and
   * re-locks the card button until they pick a start that still works.
   */
  const startBookable =
    Boolean(terms.nextPeriodStart) && (terms.nextPeriodStart as string) >= earliest;
  const datesSet = Boolean(terms.nextPeriodStart && terms.endsAt) && startBookable;
  const contractAgreed = Boolean(contract?.brand_accepted && contract?.creative_accepted);
  const approvalConfirmed = Boolean(terms.approvalConfirmedAt);
  const readyForCard = datesSet && contractAgreed && approvalConfirmed;

  const saveDates = () => {
    startTransition(async () => {
      const result = await updateRetainerScheduleAction({
        roleId,
        startsOn: startDraft,
        endsOn: endDraft,
      });
      if (result.success === true) {
        setEditingDates(false);
        toast({ title: 'Dates updated', description: 'The delivery date moved with it.' });
        router.refresh();
      } else {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
      }
    });
  };

  const chooseApproval = (approval: 'auto' | 'manual') => {
    startTransition(async () => {
      const result = await setRetainerApprovalAction({ roleId, approval });
      if (result.success === true) {
        router.refresh();
      } else {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
      }
    });
  };

  const saveCard = () => {
    startTransition(async () => {
      const result = await startRetainerBillingAction(projectId);
      if (result.success !== true) {
        toast({ title: 'Could not continue', description: result.error, variant: 'destructive' });
        return;
      }
      if (result.data.mode === 'checkout') {
        // External origin, so window.location rather than the router — the
        // same treatment the escrow Checkout gets.
        window.location.href = result.data.url;
        return;
      }
      // A card was already on file for this workspace, so there was nothing to
      // go to payment provider for.
      toast({
        title: 'Engagement started',
        description: `Using the card you already have saved${
          billing.cardLast4 ? ` (ending ${billing.cardLast4})` : ''
        }.`,
      });
      router.refresh();
    });
  };

  const replaceCard = () => {
    startTransition(async () => {
      const result = await updateRetainerCardAction(projectId);
      if (result.success === true) {
        window.location.href = result.data.url;
        return;
      }
      toast({
        title: 'Could not open the payment page',
        description: result.error,
        variant: 'destructive',
      });
    });
  };

  const togglePause = () => {
    startTransition(async () => {
      const result = await setRetainerPausedAction({ roleId, paused: !paused });
      if (result.success === true) {
        toast({
          title: paused ? 'Engagement resumed' : 'Engagement paused',
          description: paused
            ? 'The next period will be scheduled as normal.'
            : 'No further periods will be charged. Anything already funded is unaffected.',
        });
        router.refresh();
      } else {
        toast({
          title: 'Could not change this',
          description: result.error,
          variant: 'destructive',
        });
      }
    });
  };

  const approve = useCallback(
    (periodId: string) => {
      startTransition(async () => {
        const result = await approvePeriodAction(periodId);
        if (result.success === true) {
          toast({ title: 'Approved', description: 'Payment released.' });
          router.refresh();
        } else {
          toast({ title: 'Could not approve', description: result.error, variant: 'destructive' });
        }
      });
    },
    [router, toast],
  );

  const awaitingApproval = mine.filter((p) => p.status === 'delivered');
  const failing = mine.find((p) => p.status === 'funding_failed');

  return (
    <div className='glass border-foreground/10 relative overflow-hidden rounded-2xl border p-5 sm:p-6'>
      <div className='bg-gradient-brand absolute -top-20 -right-20 h-64 w-64 rounded-full opacity-20 blur-3xl' />

      <div className='relative'>
        <div className='text-accent flex items-center gap-2 text-[11px] tracking-widest uppercase'>
          {activated ? <ShieldCheck size={12} /> : <CalendarClock size={12} />}
          {activated ? `Recurring · ${cadence}ly` : 'Recurring · setup'}
        </div>

        <div className='mt-2 flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h3 className='text-lg font-semibold sm:text-xl'>
              {activated
                ? paused
                  ? 'Engagement paused.'
                  : 'Engagement running.'
                : 'Engagement created.'}
            </h3>
            <p className='text-muted-foreground mt-1 max-w-lg text-sm'>
              {activated
                ? paused
                  ? 'No further periods will be charged. Anything already funded is unaffected.'
                  : terms.approval === 'manual'
                    ? `${roleTitle} - charged every ${cadence}, held for the period, and released once you approve it.`
                    : `${roleTitle} - charged every ${cadence}, held for the period, released automatically at the end of it.`
                : 'Nothing has been charged. Finish the checklist below and save a card to start it.'}
            </p>
          </div>

          {activated && (
            <button
              type='button'
              onClick={togglePause}
              disabled={pending}
              className='border-foreground/10 hover:bg-foreground/5 flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-60'
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>

        {/* Every figure carries its cadence. "£2,000" on a retainer means
            nothing without it, and this is the screen where a brand decides
            whether the arrangement is affordable. */}
        <div className='mt-5 grid grid-cols-3 gap-2 sm:gap-3'>
          <Stat label='Budget' value={formatPence(gross, currency)} sub={`per ${cadence}`} />
          <Stat
            label={`${nouns.worker.one} pool`}
            value={formatPence(net, currency)}
            sub={`per ${cadence}`}
          />
          <Stat
            label='Platform fee'
            value={formatPence(fee, currency)}
            sub={`${platformFeePct}% per ${cadence}`}
          />
        </div>

        {/* The date the card is actually debited — always, running or not.
            This is the single most-asked question about a retainer and the one
            the old screen could not answer. */}
        <div className='border-foreground/10 bg-sunken mt-3 space-y-2 rounded-xl border px-3 py-2.5'>
          {/* What has already been paid for, stated separately from what is
              coming. One line trying to be both is what produced a "next
              payment" date that had already passed. */}
          {current && (
            <div className='flex items-start gap-2.5'>
              <Check size={14} className='text-status-active mt-0.5 shrink-0' />
              <div className='min-w-0 text-xs'>
                <div className='font-medium'>
                  This {cadence} is paid for - {periodLabel(current)}
                </div>
                <div className='text-muted-foreground mt-0.5'>
                  {formatPence(current.gross, currency)} is held.{' '}
                  {terms.approval === 'manual'
                    ? `It reaches the ${nouns.worker.one} once you approve it, from ${formatDate(current.periodEnd)}.`
                    : `It reaches the ${nouns.worker.one} automatically on ${formatDate(current.periodEnd)}.`}
                </div>
              </div>
            </div>
          )}

          <div className='flex items-start gap-2.5'>
            <CalendarClock size={14} className='text-accent mt-0.5 shrink-0' />
            <div className='min-w-0 text-xs'>
              <div className='font-medium'>
                {paused
                  ? 'No payment scheduled'
                  : !activated
                    ? 'First payment once a card is saved'
                    : nextCharge
                      ? `Next payment taken ${formatDate(nextCharge)}`
                      : 'No further payments scheduled'}
              </div>
              <div className='text-muted-foreground mt-0.5'>
                {paused
                  ? 'Resume the engagement to schedule the next period.'
                  : !activated
                    ? `Then every ${cadence}, three days before each period begins.`
                    : nextChargeStart
                      ? `For the ${cadence} beginning ${formatDate(nextChargeStart)}. Money is taken three days ahead so the ${nouns.worker.one} never works a period nobody paid for.`
                      : `This engagement ends ${terms.endsAt ? formatDate(terms.endsAt) : 'soon'}, so nothing further will be charged.`}
              </div>
            </div>
          </div>
        </div>

        {failing && (
          <p className='text-destructive mt-3 flex items-start gap-2 text-xs'>
            <AlertTriangle size={13} className='mt-0.5 shrink-0' />
            <span>
              The payment for {periodLabel(failing)} didn&apos;t go through
              {failing.failureReason ? ` - ${failing.failureReason}` : ''}. Update your card and
              we&apos;ll retry automatically.
            </span>
          </p>
        )}

        {/* ---- the set-up checklist, before the card ---- */}
        {!activated && (
          <div className='mt-5 space-y-2'>
            <ChecklistItem done={datesSet} label='Start date and final delivery date confirmed'>
              <span className='text-muted-foreground mt-0.5 block text-[11px]'>
                {datesSet
                  ? `${formatDate(terms.nextPeriodStart as string)} to ${formatDate(terms.endsAt as string)}`
                  : terms.nextPeriodStart && !startBookable
                    ? `The start date has passed. Pick one from ${formatDate(earliest)} onwards - payment is taken three days before a period begins.`
                    : 'Both dates are needed before a card can be saved.'}
              </span>

              {editingDates ? (
                <div className='mt-2 flex flex-wrap items-center gap-2'>
                  <input
                    type='date'
                    value={startDraft}
                    min={earliest}
                    onChange={(e) => setStartDraft(e.target.value)}
                    aria-label='First period starts'
                    className='border-foreground/10 bg-sunken focus:border-foreground/30 rounded-lg border px-3 py-1.5 text-xs focus:outline-none'
                  />
                  <input
                    type='date'
                    value={endDraft}
                    min={startDraft || earliest}
                    onChange={(e) => setEndDraft(e.target.value)}
                    aria-label='Final delivery date'
                    className='border-foreground/10 bg-sunken focus:border-foreground/30 rounded-lg border px-3 py-1.5 text-xs focus:outline-none'
                  />
                  <button
                    type='button'
                    onClick={saveDates}
                    disabled={
                      pending ||
                      !startDraft ||
                      !endDraft ||
                      endDraft <= startDraft ||
                      startDraft < earliest
                    }
                    className='text-accent text-xs font-medium disabled:opacity-40'
                  >
                    {pending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      setStartDraft(terms.nextPeriodStart?.slice(0, 10) ?? '');
                      setEndDraft(terms.endsAt?.slice(0, 10) ?? '');
                      setEditingDates(false);
                    }}
                    className='text-muted-foreground hover:text-foreground text-xs'
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type='button'
                  onClick={() => {
                    // Seeded on open, not at mount: after a save the server's
                    // dates are the truth, and reopening with the drafts this
                    // component was constructed with would offer to put the
                    // old ones back.
                    setStartDraft(terms.nextPeriodStart?.slice(0, 10) ?? '');
                    setEndDraft(terms.endsAt?.slice(0, 10) ?? '');
                    setEditingDates(true);
                  }}
                  className='text-accent mt-1 block text-[11px] font-medium hover:underline'
                >
                  {datesSet ? 'Change dates' : 'Set the dates'}
                </button>
              )}
            </ChecklistItem>

            <ChecklistItem done={contractAgreed} label='Contract agreed'>
              <span className='text-muted-foreground mt-0.5 block text-[11px]'>
                {contractAgreed
                  ? 'Agreed by both parties.'
                  : !contract
                    ? 'No terms drafted yet.'
                    : contract.brand_accepted
                      ? `Waiting on the ${nouns.worker.one} to accept.`
                      : 'Waiting on you to accept the current terms.'}
              </span>
              {contractChannelId && (
                <button
                  type='button'
                  onClick={onOpenContract}
                  className='text-accent mt-1 block text-[11px] font-medium hover:underline'
                >
                  {contract ? 'Open the contract' : 'Add a contract'}
                </button>
              )}
            </ChecklistItem>

            <ChecklistItem done={approvalConfirmed} label='Payment preference confirmed'>
              <span className='text-muted-foreground mt-0.5 block text-[11px]'>
                {approvalConfirmed
                  ? terms.approval === 'manual'
                    ? `Each ${cadence}'s payment is released after you approve it.`
                    : `Each ${cadence}'s payment is released automatically at the end of the period.`
                  : 'Choose how each period is released to them.'}
              </span>
              <div className='mt-2'>
                <ApprovalToggle
                  value={terms.approval}
                  pending={pending}
                  onChoose={chooseApproval}
                />
              </div>
            </ChecklistItem>

            {/* Optional — never part of readyForCard. Deliverables help the
                person doing the work know what "done" looks like, but nothing
                blocks on them. */}
            <ChecklistItem done={deliverablesCount > 0} label='Project deliverables (optional)'>
              <span className='text-muted-foreground mt-0.5 block text-[11px]'>
                {deliverablesCount > 0
                  ? `${deliverablesCount} added`
                  : `Not required, but helps the ${nouns.worker.one} know what "done" looks like.`}
              </span>
              <button
                type='button'
                onClick={onOpenDeliverables}
                className='text-accent mt-1 block text-[11px] font-medium hover:underline'
              >
                {deliverablesCount > 0 ? 'View deliverables' : 'Add project deliverables'}
              </button>
            </ChecklistItem>
          </div>
        )}

        {/* ---- the card ---- */}
        <div className='mt-4'>
          <CardStep
            activated={activated}
            billing={billing}
            confirming={confirming}
            /* Server state, so a refresh cannot turn "waiting on payment provider"
               back into "save a card". The client session only decides
               whether we are actively re-checking right now. */
            setupStatus={terms.cardSetupStatus}
            setupError={terms.cardSetupError}
            checking={Boolean(pendingSession)}
            checks={checks}
            onCheckNow={recheck}
            pending={pending}
            ready={readyForCard}
            onSave={saveCard}
            onReplace={replaceCard}
          />
        </div>

        {/* ---- manual approvals, once running ---- */}
        {activated && awaitingApproval.length > 0 && (
          <div className='mt-5'>
            <div className='text-muted-foreground mb-2 text-[11px] tracking-widest uppercase'>
              Awaiting your approval
            </div>
            <div className='space-y-2'>
              {awaitingApproval.map((p) => (
                <div
                  key={p.id}
                  className='border-foreground/10 bg-sunken flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5'
                >
                  <span className='flex items-center gap-2 text-xs'>
                    <Clock size={13} className='text-status-pending shrink-0' />
                    {periodLabel(p)} · {formatPence(p.gross, currency)}
                  </span>
                  <button
                    type='button'
                    onClick={() => approve(p.id)}
                    disabled={pending}
                    className='bg-gradient-brand text-on-brand shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40'
                  >
                    Approve &amp; pay
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The set-up checklist carried this and vanished at activation, which
            left the running screen with no statement of how periods are
            released and a headline that described the automatic case whatever
            had been chosen. It stays visible and stays changeable: switching
            between the two is a change of mind about oversight, not about what
            anybody is owed. */}
        {activated && (
          <div className='border-foreground/10 mt-5 border-t pt-4'>
            <div className='text-muted-foreground text-[11px] tracking-widest uppercase'>
              Releasing each {cadence}
            </div>
            <p className='text-muted-foreground mt-1 text-xs'>
              {terms.approval === 'manual'
                ? `Held for the period, then released to the ${nouns.worker.one} once you approve it.`
                : `Held for the period, then released to the ${nouns.worker.one} automatically when it ends.`}
            </p>
            <div className='mt-2'>
              <ApprovalToggle value={terms.approval} pending={pending} onChoose={chooseApproval} />
            </div>
            {terms.approval === 'manual' && awaitingApproval.length === 0 && (
              <p className='text-muted-foreground mt-2 text-xs'>
                {/* The period you are IN is the one that will ask for approval,
                    and it asks when it ENDS. Naming the next period's start
                    date here pointed at the wrong week entirely. */}
                Nothing is waiting on you right now
                {current
                  ? ` - ${periodLabel(current)} appears here on ${formatDate(current.periodEnd)}.`
                  : ' - each period appears here once it ends.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The card button and everything it is allowed to say.
 *
 * Four states, because the old two ("save a card" / nothing) could not express
 * the one that actually happens: payment provider has the card, the webhook has not
 * landed, and the brand is looking at the screen. That gap is what "it still
 * prompts me to save a card when I already did" was.
 */
function CardStep({
  activated,
  billing,
  confirming,
  setupStatus,
  setupError,
  checking,
  checks,
  pending,
  ready,
  onSave,
  onReplace,
  onCheckNow,
}: {
  activated: boolean;
  billing: BillingProfile;
  confirming: boolean;
  /** The outstanding attempt as the SERVER knows it — survives a refresh. */
  setupStatus: RecurringTerms['cardSetupStatus'];
  setupError: string | null;
  /** Whether this tab is actively re-asking payment provider right now. */
  checking: boolean;
  /** Attempts so far — not shown, only used to decide which of the two
   *  waiting messages is true. */
  checks: number;
  pending: boolean;
  ready: boolean;
  onSave: () => void;
  onReplace: () => void;
  onCheckNow: () => void;
}) {
  const card = billing.hasCard
    ? `${billing.cardBrand ? titleCase(billing.cardBrand) : 'Card'}${
        billing.cardLast4 ? ` ending ${billing.cardLast4}` : ''
      }`
    : null;

  if (confirming) {
    return (
      <div className='border-foreground/10 bg-sunken flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm'>
        <Clock size={15} className='text-status-pending mt-0.5 shrink-0' />
        <span className='text-muted-foreground'>
          Confirming your card - a few seconds. Please don&apos;t refresh the page.
        </span>
      </div>
    );
  }

  if (activated) {
    return (
      <div className='border-status-active/30 bg-sunken flex items-start gap-2.5 rounded-xl border px-4 py-3'>
        <Check size={15} className='text-status-active mt-0.5 shrink-0' />
        <div className='min-w-0 text-sm'>
          <div className='font-medium'>Payment method complete</div>
          <div className='text-muted-foreground mt-0.5 text-xs'>
            {card ? `${card} is connected` : 'A card is connected'} and will be charged
            automatically before each period.
          </div>
          {/* The way out of a card that has expired or started declining.
              "Update your card and we'll retry" was the advice on a failed
              charge, with nothing to click. */}
          <button
            type='button'
            onClick={onReplace}
            disabled={pending}
            className='text-accent mt-1 text-[11px] font-medium hover:underline disabled:opacity-40'
          >
            Use a different card
          </button>
        </div>
      </div>
    );
  }

  // payment provider told us it did not work. Said plainly, and NOT by reverting to
  // "Save a card" — that reads as though the attempt never happened, which is
  // precisely the ambiguity that had a brand entering their card twice.
  if (setupStatus === 'failed') {
    return (
      <div className='border-destructive/30 bg-sunken flex items-start gap-2.5 rounded-xl border px-4 py-3'>
        <AlertTriangle size={15} className='text-destructive mt-0.5 shrink-0' />
        <div className='min-w-0 text-sm'>
          <div className='font-medium'>Card wasn&apos;t saved</div>
          <div className='text-muted-foreground mt-0.5 text-xs'>
            {setupError ?? 'Our payment provider could not authorise that card.'} Nothing has been
            charged and the engagement has not started.
          </div>
          <button
            type='button'
            onClick={onSave}
            disabled={pending}
            className='bg-gradient-brand text-on-brand mt-2.5 rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40'
          >
            {pending ? 'Opening…' : 'Try another card'}
          </button>
        </div>
      </div>
    );
  }

  if (setupStatus === 'pending') {
    const givenUp = checking && checks >= MAX_CARD_CHECKS;

    return (
      <div className='border-status-pending/30 bg-sunken flex items-start gap-2.5 rounded-xl border px-4 py-3'>
        <Clock size={15} className='text-status-pending mt-0.5 shrink-0' />
        <div className='min-w-0 text-sm'>
          <div className='font-medium'>Payment method pending</div>

          {/* The two messages differ on one thing only: whether leaving this
              page costs anything. While this tab is the one asking, it does —
              closing it drops back to waiting on the webhook. Once the fast
              checks are done, or the tab was reloaded and never had them,
              nothing here is load-bearing and the email is the notification. */}
          <div className='text-muted-foreground mt-0.5 text-xs'>
            {checking && !givenUp
              ? 'We are confirming your details with our payment provider - please wait before you refresh or close this page.'
              : "Waiting on our payment provider to confirm your details. You can safely leave this page, we'll email you the moment it's saved."}
          </div>

          <div className='mt-1.5 flex flex-wrap items-center gap-3'>
            <button
              type='button'
              onClick={onCheckNow}
              disabled={pending}
              className='text-accent text-[11px] font-medium hover:underline disabled:opacity-40'
            >
              {pending ? 'Checking…' : 'Check now'}
            </button>
            <button
              type='button'
              onClick={onSave}
              disabled={pending}
              className='text-muted-foreground hover:text-foreground text-[11px] disabled:opacity-40'
            >
              Start over with another card
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type='button'
        onClick={onSave}
        disabled={pending || !ready}
        className={cn(
          'bg-gradient-brand text-on-brand w-full rounded-xl px-5 py-3 text-sm font-medium disabled:animate-none disabled:opacity-50 sm:w-auto',
          ready && 'animate-pulse-glow',
        )}
      >
        {pending ? 'Opening…' : billing.hasCard ? 'Start with my saved card' : 'Save a card'}
      </button>
      <p className='text-muted-foreground mt-2 text-xs'>
        {!ready && 'Finish the checklist above to unlock this. '}
        {billing.hasCard ? (
          <>
            {/* Answering "is my card connected" before they ask it. The old
                screen showed nothing either way, so a brand had no way to know
                whether their first save had worked. */}
            <CreditCard size={11} className='-mt-0.5 mr-1 inline' />
            {card} is already saved for this workspace - nothing to re-enter.
          </>
        ) : (
          'Nothing is charged now. The first payment is taken three days before the first period begins.'
        )}
      </p>
    </>
  );
}

/**
 * Automatic vs. approve-each-one.
 *
 * Always shows the CURRENT value as selected, confirmed or not. It used to
 * highlight only once approval_confirmed_at was set, so an engagement created
 * as "I approve each one" arrived at the set-up screen with BOTH buttons
 * looking unselected — which reads as "nothing chosen yet" and invites a
 * re-pick that silently overwrites the choice already made on the create form.
 */
function ApprovalToggle({
  value,
  pending,
  onChoose,
}: {
  value: RecurringTerms['approval'];
  pending: boolean;
  onChoose: (approval: 'auto' | 'manual') => void;
}) {
  return (
    <div
      className='border-foreground/10 bg-background flex max-w-xs items-center rounded-lg border p-0.5'
      role='group'
      aria-label='Payment preference'
    >
      {(
        [
          ['auto', 'Automatic'],
          ['manual', 'I approve each one'],
        ] as const
      ).map(([option, label]) => (
        <button
          key={option}
          type='button'
          onClick={() => onChoose(option)}
          disabled={pending}
          aria-pressed={value === option}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-60',
            value === option
              ? 'bg-gradient-brand text-on-brand'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ChecklistItem({
  done,
  label,
  children,
}: {
  done: boolean;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className='border-foreground/10 bg-sunken flex items-start gap-2.5 rounded-xl border px-3 py-2.5'>
      {done ? (
        <Check size={14} className='text-status-active mt-0.5 shrink-0' />
      ) : (
        <Circle size={14} className='text-muted-foreground/50 mt-0.5 shrink-0' />
      )}
      <div className='min-w-0 flex-1'>
        <div
          className={cn('text-xs font-medium', done ? 'text-foreground' : 'text-muted-foreground')}
        >
          {label}
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className='border-foreground/10 bg-sunken rounded-xl border px-3 py-3 sm:px-4'>
      <div className='text-muted-foreground text-[10px] tracking-widest uppercase'>{label}</div>
      <div className='mt-0.5 text-base font-semibold tabular-nums sm:text-lg'>{value}</div>
      {sub && <div className='text-accent text-[10px]'>{sub}</div>}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
