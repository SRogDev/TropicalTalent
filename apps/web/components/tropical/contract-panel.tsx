'use client';

import { TalentAvatar } from './talent-avatar';
import { formatPence } from '@/lib/money';
import type { Workspace } from '@/modules/projects/types';

/**
 * The project-wide split.
 *
 * BRAND ONLY. Previously every member saw every role's percentage and amount,
 * on the reasoning that transparency was the point. In practice it means each
 * talent can read what every other talent on the job is being paid, which
 * is not something either side asked for and is not how the rest of the
 * industry works.
 *
 * A talent sees their own figure in their role contract, in their own
 * channel. This panel is not rendered for them at all — the guard is at the
 * call site as well as here, so a future refactor that forgets one still has
 * the other.
 */
export function ContractPanel({
  workspace,
  isBrand,
  funded,
}: {
  workspace: Workspace;
  isBrand: boolean;
  funded: boolean;
}) {
  if (!isBrand) return null;

  const fee = Math.floor((workspace.budget * workspace.platform_fee_pct) / 100);

  return (
    <div className='border-foreground/10 bg-sunken border-b px-4 py-4 sm:px-5'>
      <div className='mb-3 flex flex-wrap items-baseline justify-between gap-2'>
        <h4 className='text-xs tracking-widest uppercase'>Budget split</h4>
        <span className='text-muted-foreground text-[11px] tabular-nums'>
          {formatPence(workspace.budget, workspace.currency)} total ·{' '}
          {formatPence(fee, workspace.currency)} fee
        </span>
      </div>

      <div className='space-y-1.5'>
        {workspace.roles.map((role) => (
          <div
            key={role.id}
            className='border-foreground/10 bg-sunken flex items-center gap-3 rounded-lg border px-3 py-2'
          >
            <TalentAvatar candidate={role.assignee} size={26} />
            <div className='min-w-0 flex-1'>
              <div className='truncate text-xs font-medium'>{role.title}</div>
              <div className='text-muted-foreground truncate text-[11px]'>
                {role.assignee
                  ? (role.assignee.name ?? role.assignee.username)
                  : 'Open to applications'}
              </div>
            </div>
            <div className='text-right'>
              <div className='text-xs font-semibold tabular-nums'>
                {formatPence(role.amount, workspace.currency)}
              </div>
              <div className='text-muted-foreground text-[10px] tabular-nums'>
                {role.percentage}%
              </div>
            </div>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${roleDot(role.status)}`}
              title={role.status}
            />
          </div>
        ))}
      </div>

      <p className='text-muted-foreground mt-3 text-[11px]'>
        {funded
          ? 'Each share is held in escrow and released when that role is approved.'
          : 'Shares are fixed at these amounts once escrow is authorised.'}
      </p>
    </div>
  );
}

function roleDot(status: string): string {
  switch (status) {
    case 'released':
      return 'bg-status-complete';
    case 'accepted':
    case 'approved':
      return 'bg-status-active';
    case 'open':
      return 'bg-status-cancelled';
    default:
      return 'bg-status-pending';
  }
}
