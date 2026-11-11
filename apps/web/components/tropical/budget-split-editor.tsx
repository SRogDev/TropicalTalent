'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { updateBudgetSplitAction } from '@/modules/escrow/actions';
import { formatPence, splitPot } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Workspace } from '@/modules/projects/types';
import type { RoleContract } from '@/modules/chat/types';
import { TalentAvatar } from './talent-avatar';
import { useTenantNouns } from './tenant-context';

/**
 * The brand's pre-escrow repricing form: budget plus one slider per role.
 *
 * Figures shown here come from the same splitPot() the server runs, so the
 * pence a brand sees on a row are the pence the talent will be asked to
 * accept. The server still recomputes — this is display, not authority.
 *
 * Which rows will be re-sent is shown BEFORE the brand commits. The rule is
 * "amount changed", not "slider moved": largest-remainder allocation can move
 * a penny onto a role nobody touched, and that role's talent will be asked
 * to accept again, so the tag has to say so.
 */
export function BudgetSplitEditor({
  workspace,
  roleContracts,
  onDraftChange,
  onClose,
}: {
  workspace: Workspace;
  roleContracts: RoleContract[];
  /** Live budget + split for the tiles above the form. */
  onDraftChange: (draft: { budget: number; crewPool: number; fee: number } | null) => void;
  onClose: () => void;
}) {
  const nouns = useTenantNouns();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [pounds, setPounds] = useState(() => penceToPounds(workspace.budget));
  const [shares, setShares] = useState<Record<string, number>>(() =>
    Object.fromEntries(workspace.roles.map((r) => [r.id, Number(r.percentage)])),
  );

  const budget = poundsToPence(pounds);
  const budgetValid = Number.isInteger(budget) && budget > 0;

  const split = useMemo(() => {
    if (!budgetValid) return null;
    return splitPot(
      budget,
      workspace.roles.map((r) => ({ id: r.id, percentage: shares[r.id] ?? 0 })),
      Number(workspace.platform_fee_pct),
    );
  }, [budget, budgetValid, shares, workspace.roles, workspace.platform_fee_pct]);

  // The tiles above the form track the draft; they go back to the stored
  // figures the moment the editor unmounts, whichever way it closed.
  useEffect(() => {
    onDraftChange(
      split ? { budget: split.budget, crewPool: split.crewPool, fee: split.platformFee } : null,
    );
  }, [split, onDraftChange]);
  useEffect(() => () => onDraftChange(null), [onDraftChange]);

  const setShare = (roleId: string, pct: number) =>
    setShares((current) => ({ ...current, [roleId]: pct }));

  const splitEqually = () => {
    const share = Number((100 / workspace.roles.length).toFixed(2));
    setShares(Object.fromEntries(workspace.roles.map((r) => [r.id, share])));
  };

  const amountFor = (roleId: string) => split?.roles.find((r) => r.id === roleId)?.amount ?? null;

  // A row is "affected" when its pence would change. Only roles with an
  // agreed-or-drafted contract are re-sent; an unassigned role has nobody to
  // ask, and it just takes the new figure.
  const affected = workspace.roles.filter((r) => {
    const next = amountFor(r.id);
    return next !== null && next !== r.amount;
  });
  const resent = affected.filter(
    (r) => r.assigned_user_id && roleContracts.some((c) => c.role_id === r.id),
  );

  const dirty =
    budget !== workspace.budget ||
    workspace.roles.some((r) => (shares[r.id] ?? 0) !== Number(r.percentage));
  const totalPct = workspace.roles.reduce((sum, r) => sum + (shares[r.id] ?? 0), 0);
  const canSave = dirty && budgetValid && totalPct > 0 && !pending;

  const save = () => {
    startTransition(async () => {
      const result = await updateBudgetSplitAction(workspace.id, {
        budget,
        roles: workspace.roles.map((r) => ({ roleId: r.id, percentage: shares[r.id] ?? 0 })),
      });
      if (result.success === true) {
        const n = result.data.notified;
        toast({
          title: 'Budget updated',
          description:
            n === 0
              ? 'No contracts were affected.'
              : `${n} ${n === 1 ? nouns.worker.one : nouns.worker.many} asked to accept the new fee.`,
        });
        onClose();
        router.refresh();
      } else {
        toast({
          title: 'Could not update budget',
          description: result.error,
          variant: 'destructive',
        });
      }
    });
  };

  return (
    <div className='border-foreground/10 bg-sunken mt-5 space-y-4 rounded-xl border p-4'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <label className='block'>
          <span className='text-muted-foreground text-[10px] tracking-widest uppercase'>
            Budget ({workspace.currency})
          </span>
          <input
            type='text'
            inputMode='decimal'
            value={pounds}
            onChange={(e) => setPounds(e.target.value)}
            aria-invalid={!budgetValid}
            className={cn(
              'border-foreground/10 bg-background focus:border-foreground/30 mt-1 block w-40 rounded-lg border px-3 py-1.5 text-sm tabular-nums focus:outline-none',
              !budgetValid && 'border-destructive',
            )}
          />
        </label>
        {workspace.roles.length > 1 && (
          <button
            type='button'
            onClick={splitEqually}
            className='text-accent flex items-center gap-1 text-xs font-medium hover:underline'
          >
            <RefreshCw size={12} /> Split equally
          </button>
        )}
      </div>

      <div className='space-y-2'>
        {workspace.roles.map((role) => {
          const amount = amountFor(role.id);
          const changed = amount !== null && amount !== role.amount;
          const willResend = resent.some((r) => r.id === role.id);
          return (
            <div
              key={role.id}
              className='border-foreground/10 bg-background flex items-center gap-3 rounded-xl border px-3 py-2.5'
            >
              <TalentAvatar candidate={role.assignee} size={32} />
              <div className='min-w-0 flex-1 space-y-1'>
                <div className='flex items-center justify-between gap-2 text-xs'>
                  <span className='truncate'>
                    <span className='font-medium'>{role.title}</span>
                    <span className='text-muted-foreground'>
                      {' · '}
                      {role.assignee
                        ? role.assignee.name || role.assignee.username
                        : role.status === 'invited'
                          ? 'Invited'
                          : 'Open'}
                    </span>
                  </span>
                  <span className='flex shrink-0 items-center gap-2 tabular-nums'>
                    <span className='text-muted-foreground'>{shares[role.id] ?? 0}%</span>
                    <span className={cn('font-semibold', changed && 'text-accent')}>
                      {amount === null ? '—' : formatPence(amount, workspace.currency)}
                    </span>
                  </span>
                </div>
                <input
                  type='range'
                  min={1}
                  max={100}
                  value={shares[role.id] ?? 0}
                  onChange={(e) => setShare(role.id, Number(e.target.value))}
                  className='accent-primary w-full'
                  aria-label={`${role.title} share`}
                />
                {changed && (
                  <div className='text-muted-foreground text-[10px]'>
                    {formatPence(role.amount, workspace.currency)} →{' '}
                    {formatPence(amount as number, workspace.currency)}
                    {willResend && (
                      <span className='text-status-pending'>
                        {' · '}will be sent to {role.assignee?.name || nouns.worker.one} to accept
                        again
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalPct !== 100 && (
        <p className='text-muted-foreground text-xs'>
          Shares total {totalPct}% - they are scaled to the team pool, so the full budget is always
          allocated.
        </p>
      )}

      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={save}
          disabled={!canSave}
          className='bg-gradient-brand text-on-brand rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40'
        >
          {pending
            ? 'Updating…'
            : resent.length > 0
              ? `Update & notify ${resent.length}`
              : 'Update budget'}
        </button>
        <button
          type='button'
          onClick={onClose}
          disabled={pending}
          className='text-muted-foreground hover:text-foreground text-xs'
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(pence % 100 === 0 ? 0 : 2);
}

/** "4,500.50" -> 450050. NaN for anything that is not money. */
function poundsToPence(value: string): number {
  const cleaned = value.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100);
}
