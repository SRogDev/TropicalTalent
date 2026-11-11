'use client';

import { Info } from 'lucide-react';
import { formatPence } from '@/lib/money';
import type { Workspace } from '@/modules/projects/types';
import type { RoleContract } from '@/modules/chat/types';

/**
 * The project funding banner — PLACEHOLDER in the TropicalTalent reference
 * build.
 *
 * Payments are omitted entirely from this build, so there is no escrow to
 * fund, release or return. This keeps the same props the workspace renders
 * it with and shows the project's budget as a plain figure, plus a note that
 * funding is not available here. The old banner's checkout, release and
 * budget-edit actions are gone with modules/escrow/actions.
 */
export function EscrowBanner({
  workspace,
  isBrand,
  funded,
  roleContracts,
  deliverablesCount,
  onOpenDeliverables,
}: {
  workspace: Workspace;
  isBrand: boolean;
  funded: boolean;
  roleContracts: RoleContract[];
  deliverablesCount: number;
  onOpenDeliverables: () => void;
}) {
  const deliveredRoles = workspace.roles.filter((r) => r.status === 'delivered');
  void isBrand;
  void funded;
  void roleContracts;
  void onOpenDeliverables;

  return (
    <div className='glass rounded-2xl p-5'>
      <div className='flex items-start gap-3'>
        <Info size={16} className='text-muted-foreground mt-0.5 shrink-0' />
        <div className='min-w-0'>
          <div className='text-sm font-medium'>Payments are omitted in this reference build</div>
          <p className='text-muted-foreground mt-1 text-sm'>
            Project funding, escrow and payouts are not available here. Budgets are shown as
            agreed figures only — no money moves.
          </p>
          <div className='text-muted-foreground mt-3 text-xs tracking-widest uppercase'>
            Agreed budget
          </div>
          <div className='text-gradient-brand mt-1 text-2xl font-semibold tabular-nums'>
            {formatPence(workspace.budget, workspace.currency)}
          </div>
          <p className='text-muted-foreground mt-2 text-xs'>
            {deliveredRoles.length} of {workspace.roles.length} roles marked delivered ·{' '}
            {deliverablesCount} deliverables
          </p>
        </div>
      </div>
    </div>
  );
}
