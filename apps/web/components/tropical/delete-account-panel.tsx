'use client';

import { useState, useTransition } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { deleteAccountAction } from '@/modules/identity/actions';

/**
 * Closing your own account.
 *
 * Two steps, not one. The first click opens the confirmation; only the second
 * calls the action. The panel is styled apart from everything above it —
 * bordered in the destructive colour rather than sharing the `glass` surface —
 * because it is the one control on this page that cannot be undone, and it
 * should not look like the toggle next to it.
 *
 * The action's own refusals ("you still have money in your wallet") arrive as
 * ordinary failures and are shown in place rather than as a toast: they are
 * instructions for what to go and do, so they need to stay on screen.
 */
export function DeleteAccountPanel() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [blocker, setBlocker] = useState<string | null>(null);

  const remove = () => {
    setBlocker(null);
    startTransition(async () => {
      const result = await deleteAccountAction();
      if (result.success !== true) {
        setBlocker(result.error);
        return;
      }
      toast({ title: 'Your account has been deleted' });
      // A full navigation rather than router.push: the session cookie was
      // cleared server-side, and every cached server component in this tab
      // still holds the signed-in tree.
      window.location.href = '/';
    });
  };

  return (
    <section className='mt-7'>
      <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
        Delete account
      </h2>

      <div className='border-destructive/25 rounded-2xl border p-5'>
        {!confirming ? (
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <div className='min-w-0'>
              <div className='text-sm font-medium'>Delete this account</div>
              <p className='text-muted-foreground text-xs'>
                Removes your profile and signs you out for good.
              </p>
            </div>
            <button
              type='button'
              onClick={() => setConfirming(true)}
              className='text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition'
            >
              Delete account
            </button>
          </div>
        ) : (
          <div>
            <div className='flex gap-3'>
              <span className='text-destructive mt-0.5 shrink-0'>
                <TriangleAlert size={16} />
              </span>
              <div className='min-w-0'>
                <div className='text-sm font-medium'>Are you sure?</div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  This cannot be undone. Your name, photo, bio and skills are erased, and you will
                  not be able to sign in again. Projects you have already worked on keep their
                  contract and payment history, because the people you worked with need it.
                </p>
              </div>
            </div>

            {blocker && (
              <p className='border-destructive/25 bg-destructive/5 text-destructive mt-4 rounded-lg border px-3 py-2.5 text-xs'>
                {blocker}
              </p>
            )}

            <div className='mt-4 flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => {
                  setConfirming(false);
                  setBlocker(null);
                }}
                disabled={pending}
                className='glass text-muted-foreground hover:text-foreground rounded-lg px-4 py-2 text-sm disabled:opacity-40'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={remove}
                disabled={pending}
                className='bg-destructive rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40'
              >
                {pending ? 'Deleting…' : 'Yes, delete my account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
