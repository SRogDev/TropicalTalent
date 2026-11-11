'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Trash2, Users } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { formatPence } from '@/lib/money';
import { cn } from '@/lib/utils';
import { resolveDeleteRequestAction } from '@/modules/admin/actions';
import type { AdminDeleteRequest } from '@/modules/projects/types';

const STATUS_COLOR: Record<AdminDeleteRequest['status'], string> = {
  open: 'text-status-pending',
  approved: 'text-status-cancelled',
  rejected: 'text-muted-foreground',
  withdrawn: 'text-muted-foreground',
};

/**
 * One deletion request, with the two buttons that decide it.
 *
 * Approving is irreversible and takes a whole workspace with it, so it is
 * behind a second click rather than one — the pattern ProjectSettingsPanel
 * already uses for its own delete, for the same reason. The row leads with
 * what would be destroyed (people, money, kind) rather than with the request,
 * because a queue that shows only the ask invites a reflexive yes.
 */
export function AdminDeleteRequestRow({ request }: { request: AdminDeleteRequest }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const decided = request.status !== 'open';
  const requester =
    request.requestedByName ??
    (request.requestedByUsername ? `@${request.requestedByUsername}` : 'Unknown');

  const decide = (decision: 'approve' | 'reject') => {
    startTransition(async () => {
      const result = await resolveDeleteRequestAction({
        requestId: request.id,
        decision,
        note: note.trim() || undefined,
      });
      if (result.success !== true) {
        toast({
          title: 'Could not decide this',
          description: result.error,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: result.data.deleted ? 'Project closed' : 'Request declined',
        description: result.data.deleted
          ? `${request.projectName} is no longer visible to anyone on it. The record is kept here.`
          : 'The brand has been told.',
      });
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <article className='glass rounded-xl p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='bg-foreground/5 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize'>
          {request.projectKind === 'retainer' ? 'Recurring' : 'One-off'}
        </span>
        <span className={cn('text-[11px] capitalize', STATUS_COLOR[request.status])}>
          {request.status}
        </span>
        <span className='text-muted-foreground ml-auto text-[11px]'>
          {new Date(request.createdAt).toLocaleDateString('en-GB')}
        </span>
      </div>

      <h3 className='mt-2.5 text-sm font-medium'>
        {request.projectId ? (
          <Link href={`/projects/${request.projectId}`} className='hover:underline'>
            {request.projectName}
          </Link>
        ) : (
          // Approved: the project is gone and only the record remains.
          <span className='text-muted-foreground line-through'>{request.projectName}</span>
        )}
      </h3>

      <p className='text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
        <span>Requested by {requester}</span>
        <span className='flex items-center gap-1'>
          <Users size={11} />
          {request.memberCount} in the workspace
        </span>
        {request.budget > 0 && <span>{formatPence(request.budget, request.currency)}</span>}
        <span className='capitalize'>{request.projectStatus.replace(/_/g, ' ')}</span>
      </p>

      {request.reason ? (
        <p className='text-muted-foreground mt-2 text-sm whitespace-pre-wrap'>{request.reason}</p>
      ) : (
        <p className='text-muted-foreground/70 mt-2 text-xs italic'>No reason given.</p>
      )}

      {decided ? (
        request.resolution && (
          <p className='border-foreground/10 text-muted-foreground mt-3 border-t pt-3 text-xs'>
            <span className='text-foreground font-medium'>Note:</span> {request.resolution}
          </p>
        )
      ) : (
        <div className='mt-3 space-y-2'>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder='Optional note - sent to the brand either way.'
            className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-lg border px-3 py-2 text-xs focus:outline-none'
          />

          {confirming ? (
            <div className='border-destructive/30 bg-destructive/5 space-y-2 rounded-lg border p-3'>
              <p className='text-destructive flex items-start gap-2 text-xs'>
                <AlertTriangle size={13} className='mt-0.5 shrink-0' />
                <span>
                  This closes {request.projectName} for all {request.memberCount} members - the
                  workspace, its channels and its schedule all stop, and any recurring payments are
                  cancelled. The record is archived rather than erased, so the contracts and the
                  payment history survive for a dispute. It cannot be undone from here.
                </span>
              </p>
              <div className='flex flex-wrap gap-2'>
                <button
                  type='button'
                  onClick={() => decide('approve')}
                  disabled={pending}
                  className='bg-destructive text-destructive-foreground flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40'
                >
                  <Trash2 size={12} />
                  {pending ? 'Closing…' : 'Yes, close it'}
                </button>
                <button
                  type='button'
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className='text-muted-foreground border-foreground/10 hover:text-foreground rounded-lg border px-4 py-2 text-xs'
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className='flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={() => setConfirming(true)}
                disabled={pending}
                className='text-destructive border-destructive/30 hover:bg-destructive/5 flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-40'
              >
                Approve &amp; close
              </button>
              <button
                type='button'
                onClick={() => decide('reject')}
                disabled={pending}
                className='border-foreground/10 hover:bg-foreground/5 flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-40'
              >
                {pending ? 'Saving…' : 'Decline'}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
