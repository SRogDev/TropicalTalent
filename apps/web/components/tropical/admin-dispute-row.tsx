'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { adminResolveDisputeAction } from '@/modules/chat/actions';
import type { Dispute, DisputeStatus } from '@/modules/chat/types';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS: { value: DisputeStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
];

const STATUS_COLOR: Record<DisputeStatus, string> = {
  open: 'text-status-pending',
  reviewing: 'text-status-pending',
  resolved: 'text-status-complete',
  rejected: 'text-status-cancelled',
};

/** One complaint, expandable to update its status and record a resolution. */
export function AdminDisputeRow({ dispute }: { dispute: Dispute }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<DisputeStatus>(
    dispute.status === 'open' ? 'reviewing' : dispute.status,
  );
  const [resolution, setResolution] = useState(dispute.resolution ?? '');

  const submit = () => {
    if (status === 'open') return; // not a valid transition target
    startTransition(async () => {
      const result = await adminResolveDisputeAction(dispute.id, {
        status,
        resolution: resolution.trim() || undefined,
      });
      if (result.success !== true) {
        toast({ title: 'Could not update', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Complaint updated' });
      router.refresh();
    });
  };

  return (
    <div id={dispute.id} className='glass rounded-xl px-4 py-3'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='flex w-full items-center justify-between gap-3 text-left'
      >
        <div className='min-w-0'>
          <div className='truncate text-sm font-medium'>{dispute.project_name}</div>
          <div className='text-muted-foreground truncate text-[11px] capitalize'>
            {dispute.category}
            {dispute.role_title ? ` · ${dispute.role_title}` : ''} ·{' '}
            {dispute.raised_by_name ?? dispute.raised_by_username ?? 'Unknown'}
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <span className={cn('text-xs capitalize', STATUS_COLOR[dispute.status])}>
            {dispute.status}
          </span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open && (
        <div className='border-foreground/10 mt-3 space-y-3 border-t pt-3'>
          <p className='text-sm whitespace-pre-wrap'>{dispute.detail}</p>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]'>
            <label className='block'>
              <span className='text-muted-foreground mb-1 block text-[10px] tracking-widest uppercase'>
                Status
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as DisputeStatus)}
                className='border-foreground/10 bg-sunken focus:border-foreground/30 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none'
              >
                {STATUS_OPTIONS.filter((o) => o.value !== 'open').map((o) => (
                  <option key={o.value} value={o.value} className='bg-obsidian-1'>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className='block'>
              <span className='text-muted-foreground mb-1 block text-[10px] tracking-widest uppercase'>
                Resolution note
              </span>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={2}
                placeholder='What was decided.'
                className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none'
              />
            </label>
          </div>

          <button
            type='button'
            onClick={submit}
            disabled={pending}
            className='bg-gradient-brand text-on-brand rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
