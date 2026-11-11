'use client';

import { useState, useTransition } from 'react';
import { Heart, ThumbsDown, ThumbsUp } from 'lucide-react';
import { TalentAvatar } from './talent-avatar';
import { useToast } from '@/components/ui/toast';
import { setFeedbackAction, toggleFavouriteAction } from '@/modules/talent/actions';
import { cn } from '@/lib/utils';
import type { Workspace } from '@/modules/projects/types';
import type { ProfileRef } from '@/modules/identity/types';

/**
 * Post-project feedback, shown in Project Admin once every role is paid out.
 *
 * One row per talent who actually completed a role — 'released' is the
 * only role status that means paid, see tropical_release_role in migration 017.
 * A brand rates each one thumbs up/down and can favourite them in the same
 * place, rather than needing a separate trip to the Talent page.
 *
 * Verdicts are private: setFeedbackAction writes to tropical_creative_feedback,
 * which RLS scopes to the brand who wrote it. They only ever surface again as
 * a platform-wide aggregate rank() uses as a light tiebreaker in /create — see
 * migration 019 and modules/talent/queries.ts.
 */
export function FeedbackPanel({
  workspace,
  feedback,
  favouriteIds,
}: {
  workspace: Workspace;
  /** talent id -> the brand's existing verdict for this project. */
  feedback: Record<string, boolean>;
  /** talent ids the brand already favourites. */
  favouriteIds: string[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [verdicts, setVerdicts] = useState(feedback);
  const [favourites, setFavourites] = useState(() => new Set(favouriteIds));

  const crew = new Map<string, ProfileRef>();
  for (const role of workspace.roles) {
    if (role.status === 'released' && role.assignee) crew.set(role.assignee.id, role.assignee);
  }

  if (workspace.status !== 'completed' || crew.size === 0) return null;

  const setVerdict = (creativeId: string, recommend: boolean | null) => {
    // Optimistic — same reasoning as the favourite heart elsewhere: this IS
    // the interaction, and a round trip before the button updates reads as
    // broken.
    setVerdicts((prev) => {
      const next = { ...prev };
      if (recommend === null) delete next[creativeId];
      else next[creativeId] = recommend;
      return next;
    });
    startTransition(async () => {
      const result = await setFeedbackAction(workspace.id, creativeId, recommend);
      if (result.success !== true) {
        toast({
          title: 'Could not save feedback',
          description: result.error,
          variant: 'destructive',
        });
      }
    });
  };

  const toggleFavourite = (creativeId: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(creativeId)) next.delete(creativeId);
      else next.add(creativeId);
      return next;
    });
    startTransition(async () => {
      const result = await toggleFavouriteAction(creativeId);
      if (result.success !== true) {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
      }
    });
  };

  return (
    <div className='glass rounded-2xl p-5'>
      <h3 className='text-sm font-semibold'>Rate your crew</h3>
      <p className='text-muted-foreground mt-0.5 text-xs'>
        Private to you - this only shapes who TropicalTalent suggests you next time.
      </p>

      <div className='mt-4 space-y-2'>
        {[...crew.values()].map((creative) => {
          const verdict = verdicts[creative.id];
          const isFavourite = favourites.has(creative.id);

          return (
            <div
              key={creative.id}
              className='border-foreground/10 bg-sunken flex items-center gap-3 rounded-xl border px-3 py-2.5'
            >
              <TalentAvatar candidate={creative} size={36} />
              <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                {creative.name || creative.username}
              </span>

              <button
                type='button'
                onClick={() => toggleFavourite(creative.id)}
                disabled={pending}
                aria-pressed={isFavourite}
                aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                className={cn(
                  'border-foreground/10 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition disabled:opacity-40',
                  isFavourite ? 'text-neon-emerald' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Heart size={13} fill={isFavourite ? 'currentColor' : 'none'} />
              </button>

              <button
                type='button'
                onClick={() => setVerdict(creative.id, verdict === true ? null : true)}
                disabled={pending}
                aria-pressed={verdict === true}
                aria-label='Recommend'
                title='Recommend'
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition disabled:opacity-40',
                  verdict === true
                    ? 'border-status-active/40 bg-status-active/20 text-status-active'
                    : 'text-muted-foreground border-foreground/10 hover:text-foreground',
                )}
              >
                <ThumbsUp size={13} />
              </button>

              <button
                type='button'
                onClick={() => setVerdict(creative.id, verdict === false ? null : false)}
                disabled={pending}
                aria-pressed={verdict === false}
                aria-label="Don't recommend"
                title="Don't recommend"
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition disabled:opacity-40',
                  verdict === false
                    ? 'border-status-cancelled/40 bg-status-cancelled/20 text-status-cancelled'
                    : 'text-muted-foreground border-foreground/10 hover:text-foreground',
                )}
              >
                <ThumbsDown size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
