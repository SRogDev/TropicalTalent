'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { markRoleDeliveredAction, releaseRoleAction } from '@/modules/escrow/actions';
import type { RoleStatus } from '@/modules/projects/types';

/**
 * Delivery confirmation for one role, shown in that role's DM.
 *
 * Separate from the contract above it: the contract is terms both sides
 * agreed before escrow, this is the talent saying the work described in it
 * is actually done. The brand's approval here is what releases that role's
 * pay — see EscrowBanner for the bulk "approve everyone" version of the same
 * action.
 */
export function DeliveryPanel({
  roleId,
  roleStatus,
  escrowPaid,
  isBrand,
  isAssignedCreative,
}: {
  roleId: string;
  roleStatus: RoleStatus;
  escrowPaid: boolean;
  isBrand: boolean;
  isAssignedCreative: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  if (!escrowPaid || (!isBrand && !isAssignedCreative)) return null;
  if (!['accepted', 'delivered', 'released'].includes(roleStatus)) return null;

  if (roleStatus === 'released') {
    return (
      <div className='glass flex items-center gap-2 rounded-2xl px-5 py-4 text-sm'>
        <CheckCircle2 size={15} className='text-status-active shrink-0' />
        Delivered and paid out.
      </div>
    );
  }

  const confirmDelivery = () => {
    startTransition(async () => {
      const result = await markRoleDeliveredAction(roleId);
      if (result.success === true) {
        toast({ title: 'Marked as delivered', description: 'Waiting on the brand to approve.' });
        router.refresh();
      } else {
        toast({
          title: 'Could not confirm delivery',
          description: result.error,
          variant: 'destructive',
        });
      }
    });
  };

  const approve = () => {
    startTransition(async () => {
      const result = await releaseRoleAction(roleId);
      if (result.success === true) {
        toast({ title: 'Approved', description: 'Payment released to the talent member.' });
        router.refresh();
      } else {
        toast({ title: 'Could not approve', description: result.error, variant: 'destructive' });
      }
    });
  };

  return (
    <div className='glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4'>
      <div className='flex items-center gap-2 text-sm'>
        <Clock
          size={15}
          className={roleStatus === 'delivered' ? 'text-status-pending' : 'text-muted-foreground'}
        />
        {roleStatus === 'delivered'
          ? isBrand
            ? 'Talent confirmed delivery - awaiting your approval.'
            : 'Delivered - waiting on the brand to approve.'
          : isAssignedCreative
            ? 'Confirm your work is done to notify the brand.'
            : 'Waiting on the talent member to confirm delivery.'}
      </div>

      {isAssignedCreative && roleStatus === 'accepted' && (
        <button
          type='button'
          onClick={confirmDelivery}
          disabled={pending}
          className='bg-gradient-brand text-on-brand rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40'
        >
          {pending ? 'Confirming…' : 'Confirm delivery'}
        </button>
      )}

      {isBrand && roleStatus === 'delivered' && (
        <button
          type='button'
          onClick={approve}
          disabled={pending}
          className='bg-gradient-brand text-on-brand rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40'
        >
          {pending ? 'Approving…' : 'Approve & pay'}
        </button>
      )}
    </div>
  );
}
