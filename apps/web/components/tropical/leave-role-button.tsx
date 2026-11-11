'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { leaveRoleAction } from '@/modules/projects/actions';
import { cn } from '@/lib/utils';

/**
 * "Leave this project", for a talent holding an accepted role whose money
 * is not yet committed. Rendered on the /jobs card and inside the role's DM.
 *
 * Confirms first: leaving reopens the seat and discards the contract they
 * negotiated, and there is no undo short of the brand inviting them back.
 * After the money commits the caller renders the complaint route instead —
 * this button is never shown for a locked role, and the RPC refuses anyway.
 */
export function LeaveRoleButton({
  roleId,
  roleTitle,
  projectName,
  afterLeave = 'stay',
  className,
}: {
  roleId: string;
  roleTitle: string;
  projectName: string;
  /** From inside the project the page they are on stops existing for them. */
  afterLeave?: 'stay' | 'go-to-jobs';
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const leave = () => {
    startTransition(async () => {
      const result = await leaveRoleAction(roleId);
      if (result.success !== true) {
        toast({ title: 'Could not leave', description: result.error, variant: 'destructive' });
        return;
      }
      setOpen(false);
      toast({
        title: `Left ${projectName}`,
        description: 'The brand has been told and the role is open again.',
      });
      if (afterLeave === 'go-to-jobs') router.push('/jobs');
      router.refresh();
    });
  };

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className={cn(
          'text-muted-foreground hover:text-destructive flex items-center gap-1.5 text-xs transition',
          className,
        )}
      >
        <LogOut size={12} /> Leave project
      </button>

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogTitle>Leave {projectName}?</DialogTitle>
          <DialogDescription>
            Your {roleTitle} role goes back on the market and the contract you negotiated for it is
            discarded. The brand will be notified. You can only be brought back by a new invitation.
          </DialogDescription>
          <div className='mt-4 flex flex-wrap items-center justify-end gap-3'>
            <button
              type='button'
              onClick={() => setOpen(false)}
              disabled={pending}
              className='text-muted-foreground hover:text-foreground text-xs'
            >
              Stay
            </button>
            <button
              type='button'
              onClick={leave}
              disabled={pending}
              className='bg-destructive text-destructive-foreground rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40'
            >
              {pending ? 'Leaving…' : 'Leave project'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
