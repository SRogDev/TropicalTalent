'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { AlertTriangle, Calendar, Check, Pause, Play } from 'lucide-react';
import { formatPence } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { approvePeriodAction, setRetainerPausedAction } from '@/modules/recurring/actions';
import {
  chargeDate,
  periodLabel,
  type RecurringTerms,
  type RolePeriod,
} from '@/modules/recurring/types';

/**
 * The schedule on a retainer role.
 *
 * Written for the person earning, first. A contractor treating this as income
 * needs three facts on sight — what lands next, when, and whether anything is
 * wrong — so those are the headline and everything else is history beneath.
 *
 * What this deliberately never shows is a "locked" or "waiting for payment"
 * state for the engagement itself. Period funding and project state are
 * separate by design (see migration 027): a failed charge is a banner here,
 * never a closed chat or a project that looks finished.
 */

const STATUS_COPY: Record<
  RolePeriod['status'],
  { label: string; tone: string; forCreative: string }
> = {
  scheduled: {
    label: 'Scheduled',
    tone: 'text-muted-foreground',
    forCreative: 'Not charged yet - this happens a few days before the period starts.',
  },
  funding: {
    label: 'Charging',
    tone: 'text-status-pending',
    forCreative: 'The payment is going through now.',
  },
  funded: {
    label: 'Funded',
    tone: 'text-status-active',
    forCreative: 'The money for this period is held and will be released to you at the end of it.',
  },
  funding_failed: {
    label: 'Payment failed',
    tone: 'text-destructive',
    forCreative: "This period hasn't been funded yet. We're chasing it - nothing you need to do.",
  },
  delivered: {
    label: 'Awaiting approval',
    tone: 'text-status-pending',
    forCreative: 'Funded and with the client for sign-off.',
  },
  released: {
    label: 'Paid',
    tone: 'text-status-complete',
    forCreative: 'Released to your wallet.',
  },
  skipped: { label: 'Skipped', tone: 'text-muted-foreground', forCreative: 'Not run.' },
  disputed: {
    label: 'On hold',
    tone: 'text-destructive',
    forCreative: 'Held while a complaint is resolved.',
  },
};

export function RetainerPanel({
  roleId,
  roleTitle,
  terms,
  periods,
  currency,
  isBrand,
}: {
  roleId: string;
  roleTitle: string;
  terms: RecurringTerms;
  periods: RolePeriod[];
  currency: string;
  /** The project owner sees the controls; everyone else sees the schedule. */
  isBrand: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const mine = periods.filter((p) => p.roleId === roleId);
  const next = mine.find((p) => p.status === 'scheduled' || p.status === 'funded');
  const failing = mine.find((p) => p.status === 'funding_failed');
  const awaiting = mine.filter((p) => p.status === 'delivered');
  const paused = Boolean(terms.pausedAt);
  /**
   * Never started is not the same as paused, and telling a contractor "your
   * client has paused this engagement" about one that has simply not been set
   * up yet is the worse of the two messages by a distance. Both are paused_at
   * in the database; activated_at is what separates them.
   */
  const activated = Boolean(terms.activatedAt);
  const nextCharge = next ? chargeDate(next.periodStart) : null;

  const cadence = terms.period === 'weekly' ? 'week' : 'month';

  function togglePause() {
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
  }

  function approve(periodId: string) {
    startTransition(async () => {
      const result = await approvePeriodAction(periodId);
      if (result.success === true) {
        toast({ title: 'Approved', description: 'Payment released.' });
        router.refresh();
      } else {
        toast({ title: 'Could not approve', description: result.error, variant: 'destructive' });
      }
    });
  }

  return (
    <section className='glass space-y-4 rounded-2xl p-5'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold'>{roleTitle}</h3>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {terms.periodAmount ? formatPence(terms.periodAmount, currency) : '-'} per {cadence}
            {terms.approval === 'manual' && ' · you approve each period'}
            {terms.endsAt && ` · ends ${formatDate(terms.endsAt)}`}
          </p>
        </div>

        {isBrand && activated && (
          <button
            type='button'
            onClick={togglePause}
            disabled={pending}
            className='border-foreground/10 hover:bg-foreground/5 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-60'
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </header>

      {/* The headline: what happens next. For someone paid on this, it is the
          only thing they came to find out. */}
      {!activated ? (
        <p className='bg-sunken text-muted-foreground rounded-lg px-3 py-2 text-xs'>
          {isBrand
            ? 'Not started yet. Finish the set-up in Project Admin and save a card to schedule the first period.'
            : 'Not started yet. Your client is still setting this up - nothing is scheduled and nothing has been charged.'}
        </p>
      ) : paused ? (
        <p className='bg-sunken text-muted-foreground rounded-lg px-3 py-2 text-xs'>
          Paused. No further periods will be charged.{' '}
          {isBrand ? 'Resume any time.' : 'Your client has paused this engagement.'} Anything
          already funded is unaffected.
        </p>
      ) : next ? (
        <p className='bg-sunken flex items-center gap-2 rounded-lg px-3 py-2 text-xs'>
          <Calendar size={13} className='shrink-0' />
          <span>
            {next.status === 'funded' ? 'Current period' : 'Next period'}{' '}
            <strong>{periodLabel(next)}</strong> ·{' '}
            {formatPence(isBrand ? next.gross : next.net, currency)}
            {/* The charge date, not the period start. They are three days
                apart and it is the brand's statement date. */}
            {isBrand && next.status === 'scheduled' && nextCharge
              ? ` - taken ${formatDate(nextCharge)}`
              : ''}
            {!isBrand && next.status === 'funded' && ' - released to you at the end of it'}
          </span>
        </p>
      ) : null}

      {failing && (
        <p className='text-destructive flex items-start gap-2 text-xs'>
          <AlertTriangle size={13} className='mt-0.5 shrink-0' />
          <span>
            {isBrand
              ? `The payment for ${periodLabel(failing)} didn't go through${
                  failing.failureReason ? ` - ${failing.failureReason}` : ''
                }. Update your card and we'll retry automatically.`
              : STATUS_COPY.funding_failed.forCreative}
          </span>
        </p>
      )}

      {isBrand &&
        awaiting.map((p) => (
          <div
            key={p.id}
            className='border-foreground/10 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2'
          >
            <span className='text-xs'>
              {periodLabel(p)} · {formatPence(p.gross, currency)} - ready to approve
            </span>
            <button
              type='button'
              onClick={() => approve(p.id)}
              disabled={pending}
              className='bg-gradient-brand text-on-brand rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60'
            >
              <Check size={12} className='mr-1 inline' />
              Approve
            </button>
          </div>
        ))}

      {mine.length > 0 && (
        <div className='space-y-1'>
          <p className='text-muted-foreground text-[11px] font-medium'>History</p>
          {mine.slice(0, 8).map((p) => {
            const copy = STATUS_COPY[p.status];
            return (
              <div
                key={p.id}
                className='border-foreground/5 flex items-center justify-between border-b py-1.5 text-xs last:border-0'
                title={isBrand ? undefined : copy.forCreative}
              >
                <span className='text-muted-foreground'>{periodLabel(p)}</span>
                <span className='flex items-center gap-3'>
                  <span className='tabular-nums'>
                    {formatPence(isBrand ? p.gross : p.net, currency)}
                  </span>
                  <span className={cn('w-28 text-right', copy.tone)}>{copy.label}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
