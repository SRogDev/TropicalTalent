'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { saveDeliverablesAction } from '@/modules/chat/actions';
import type { Deliverable } from '@/modules/chat/types';

/**
 * The deliverables form, in the Project Admin channel.
 *
 * The brand writes what they are actually buying. Editable freely before
 * escrow; still editable after, because scope genuinely changes mid-production
 * — but a post-escrow save posts a notice into the group channel and notifies
 * every member, so nobody discovers a changed brief at delivery.
 *
 * The warning below is shown BEFORE the save, not after, so the brand knows
 * the crew will be told before they decide to press it.
 */

interface Draft {
  key: string;
  title: string;
  description: string;
  dueDate: string;
}

export function DeliverablesForm({
  projectId,
  deliverables,
  groupLive,
  canEdit,
}: {
  projectId: string;
  deliverables: Deliverable[];
  /**
   * Whether the group channel is open, which is what decides whether saving
   * announces itself to the crew.
   *
   * Was `escrowPaid`, which is the same thing on a pot and wrong on a
   * retainer: a retainer project is 'active' from creation, so this claimed
   * the crew had been notified in a channel that was still shut.
   */
  groupLive: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const [draft, setDraft] = useState<Draft[]>(() => toDraft(deliverables));

  const patch = (key: string, next: Partial<Draft>) =>
    setDraft((current) => current.map((d) => (d.key === key ? { ...d, ...next } : d)));

  const add = () =>
    setDraft((current) => [
      ...current,
      { key: `d_${Date.now()}_${current.length}`, title: '', description: '', dueDate: '' },
    ]);

  const save = () => {
    const items = draft
      .filter((d) => d.title.trim())
      .map((d) => ({
        title: d.title.trim(),
        description: d.description.trim() || null,
        dueDate: d.dueDate || null,
      }));

    startTransition(async () => {
      const result = await saveDeliverablesAction(projectId, items);
      if (result.success !== true) {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
        return;
      }
      // Reconcile against what the server stored rather than keeping the local
      // draft as truth — that divergence is where stale state comes from.
      setDraft(toDraft(result.data));
      setEditing(false);
      toast({
        title: 'Deliverables saved',
        description: groupLive ? 'The crew has been notified in the group channel.' : undefined,
      });
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <div className='glass rounded-2xl p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <h3 className='text-sm font-semibold'>Deliverables</h3>
            <p className='text-muted-foreground text-xs'>
              {deliverables.length === 0
                ? 'Nothing listed yet.'
                : `${deliverables.length} item${deliverables.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {canEdit && (
            <button
              type='button'
              onClick={() => {
                setDraft(toDraft(deliverables));
                setEditing(true);
              }}
              className='text-muted-foreground border-foreground/10 hover:text-foreground shrink-0 rounded-lg border px-3 py-1.5 text-xs transition'
            >
              {deliverables.length === 0 ? 'Add' : 'Edit'}
            </button>
          )}
        </div>

        {deliverables.length > 0 && (
          <ol className='mt-4 space-y-2'>
            {deliverables.map((item, index) => (
              <li
                key={item.id}
                className='border-foreground/10 bg-sunken flex gap-3 rounded-lg border px-3 py-2.5'
              >
                <span className='text-muted-foreground mt-0.5 text-[11px] tabular-nums'>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className='min-w-0 flex-1'>
                  <div className='text-sm font-medium'>{item.title}</div>
                  {item.description && (
                    <p className='text-muted-foreground mt-0.5 text-xs leading-relaxed'>
                      {item.description}
                    </p>
                  )}
                </div>
                {item.due_date && (
                  <span className='text-muted-foreground shrink-0 text-[11px] tabular-nums'>
                    {new Date(item.due_date).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div className='glass rounded-2xl p-5'>
      <h3 className='text-sm font-semibold'>Deliverables</h3>
      <p className='text-muted-foreground mt-0.5 text-xs'>What the crew is delivering, and when.</p>

      {groupLive && (
        <div className='border-status-pending/30 bg-status-pending/10 text-status-pending mt-4 flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs'>
          <AlertTriangle size={14} className='mt-px shrink-0' />
          <span>
            The group channel is open. Saving posts an update to it so everyone can see what
            changed.
          </span>
        </div>
      )}

      <div className='mt-4 space-y-2'>
        {draft.map((item, index) => (
          <div
            key={item.key}
            className='border-foreground/10 bg-sunken flex gap-2 rounded-lg border p-3'
          >
            <GripVertical size={14} className='text-muted-foreground/40 mt-2 shrink-0' />
            <div className='min-w-0 flex-1 space-y-2'>
              <input
                value={item.title}
                onChange={(e) => patch(item.key, { title: e.target.value })}
                placeholder={`Deliverable ${index + 1}`}
                aria-label={`Deliverable ${index + 1} title`}
                className='placeholder:text-muted-foreground/50 w-full bg-transparent text-sm font-medium focus:outline-none'
              />
              <textarea
                value={item.description}
                onChange={(e) => patch(item.key, { description: e.target.value })}
                placeholder='Detail - format, length, usage rights…'
                rows={2}
                aria-label={`Deliverable ${index + 1} detail`}
                className='placeholder:text-muted-foreground/50 w-full resize-none bg-transparent text-xs focus:outline-none'
              />
              <input
                type='date'
                value={item.dueDate}
                onChange={(e) => patch(item.key, { dueDate: e.target.value })}
                aria-label={`Deliverable ${index + 1} due date`}
                className='text-muted-foreground bg-transparent text-xs focus:outline-none'
              />
            </div>
            <button
              type='button'
              onClick={() => setDraft((current) => current.filter((d) => d.key !== item.key))}
              aria-label={`Remove deliverable ${index + 1}`}
              className='text-muted-foreground hover:bg-foreground/10 hover:text-foreground h-9 w-9 shrink-0 rounded-md transition'
            >
              <Trash2 size={13} className='mx-auto' />
            </button>
          </div>
        ))}
      </div>

      <button
        type='button'
        onClick={add}
        className='text-muted-foreground border-foreground/15 hover:text-foreground mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2.5 text-xs'
      >
        <Plus size={13} /> Add a deliverable
      </button>

      <div className='mt-4 flex justify-end gap-2'>
        <button
          type='button'
          onClick={() => {
            setDraft(toDraft(deliverables));
            setEditing(false);
          }}
          disabled={pending}
          className='text-muted-foreground hover:text-foreground rounded-lg px-4 py-2 text-xs disabled:opacity-40'
        >
          Cancel
        </button>
        <button
          type='button'
          onClick={save}
          disabled={pending}
          className='bg-gradient-brand text-on-brand flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40'
        >
          <Save size={12} /> {pending ? 'Saving…' : 'Save deliverables'}
        </button>
      </div>
    </div>
  );
}

function toDraft(items: Deliverable[]): Draft[] {
  if (items.length === 0) {
    return [{ key: 'd_0', title: '', description: '', dueDate: '' }];
  }
  return items.map((item) => ({
    key: item.id,
    title: item.title,
    description: item.description ?? '',
    // <input type="date"> only accepts yyyy-mm-dd.
    dueDate: item.due_date ? item.due_date.slice(0, 10) : '',
  }));
}
