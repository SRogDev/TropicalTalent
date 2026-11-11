'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Gift } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { adminFulfillReferralRewardAction } from '@/modules/referrals/actions';
import type { AdminReferralRewardRow as RewardRow } from '@/modules/admin/types';

/** One earned-but-undelivered referral reward, expandable to mark it done. */
export function AdminReferralRewardRow({ reward }: { reward: RewardRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');

  const submit = () => {
    startTransition(async () => {
      const result = await adminFulfillReferralRewardAction({
        userId: reward.userId,
        tier: reward.tier,
        note: note.trim() || undefined,
      });
      if (result.success !== true) {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Reward marked delivered' });
      router.refresh();
    });
  };

  return (
    <div className='glass rounded-xl px-4 py-3'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='flex w-full items-center justify-between gap-3 text-left'
      >
        <div className='flex min-w-0 items-center gap-3'>
          <span className='text-accent bg-foreground/5 grid h-9 w-9 shrink-0 place-items-center rounded-lg'>
            <Gift size={15} />
          </span>
          <div className='min-w-0'>
            <div className='truncate text-sm font-medium'>
              {reward.name ?? reward.username ?? 'Unnamed'}
            </div>
            <div className='text-muted-foreground truncate text-[11px]'>
              {reward.email ?? '@' + (reward.username ?? 'unknown')} · {reward.referralCount}{' '}
              referral{reward.referralCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <span className='text-status-pending text-xs capitalize'>Tier {reward.tier}</span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open && (
        <div className='border-foreground/10 mt-3 space-y-3 border-t pt-3'>
          <p className='text-sm'>{reward.rewardTitle}</p>
          <p className='text-muted-foreground text-xs'>
            Unlocked at {reward.threshold} referral{reward.threshold === 1 ? '' : 's'} · currently
            at {reward.referralCount}.
          </p>

          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[10px] tracking-widest uppercase'>
              Note (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder='How it was delivered, e.g. who ran the audit.'
              className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none'
            />
          </label>

          <button
            type='button'
            onClick={submit}
            disabled={pending}
            className='bg-gradient-brand text-on-brand rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'
          >
            {pending ? 'Saving…' : 'Mark delivered'}
          </button>
        </div>
      )}
    </div>
  );
}
