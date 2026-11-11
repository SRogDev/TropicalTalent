'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Inbox, Maximize2, X } from 'lucide-react';
import { TalentAvatar } from './talent-avatar';
import { CreativeDialog } from './creative-card';
import { useToast } from '@/components/ui/toast';
import { decideApplicationAction } from '@/modules/briefs/actions';
import { formatMessageTime } from '@/lib/utils';
import type { Applicant } from '@/modules/briefs/types';
import type { TalentCandidate } from '@/modules/talent/types';

/**
 * The applicant inbox, opened from the updates icon in Project Admin.
 *
 * The brand gets a preview row per applicant and can expand any of them into
 * the full profile card — showreel included — without leaving the channel.
 * Everything is already in memory: `loadApplicants` embeds the profile, the
 * skills and the showreel in the same query as the applications.
 */
export function ApplicantsPanel({
  applicants,
  disciplineLabels,
}: {
  applicants: Applicant[];
  disciplineLabels: Record<string, string>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Applicant | null>(null);

  const decide = (applicant: Applicant, decision: 'accepted' | 'rejected') => {
    startTransition(async () => {
      const result = await decideApplicationAction(applicant.id, decision);
      if (result.success !== true) {
        toast({ title: 'Could not update', description: result.error, variant: 'destructive' });
        return;
      }
      toast({
        title: decision === 'accepted' ? 'Applicant approved' : 'Applicant rejected',
        description:
          decision === 'accepted'
            ? `${applicant.user.name || applicant.user.username} now holds ${applicant.role_title}.`
            : undefined,
      });
      setExpanded(null);
      router.refresh();
    });
  };

  const pendingApplicants = applicants.filter((a) => a.status === 'pending');
  const decided = applicants.filter((a) => a.status === 'accepted' || a.status === 'rejected');

  return (
    <div className='glass rounded-2xl p-5'>
      <h3 className='flex items-center gap-2 text-sm font-semibold'>
        <Inbox size={14} className='text-accent' />
        Applications
      </h3>
      <p className='text-muted-foreground mt-0.5 text-xs'>
        {pendingApplicants.length === 0
          ? 'Nothing waiting on you.'
          : `${pendingApplicants.length} awaiting your decision`}
      </p>

      <div className='mt-4 space-y-2'>
        {pendingApplicants.map((applicant) => (
          <div key={applicant.id} className='border-foreground/10 bg-sunken rounded-xl border p-3'>
            <div className='flex items-start gap-3'>
              <button
                type='button'
                onClick={() => setExpanded(applicant)}
                aria-label={`View ${applicant.user.name || applicant.user.username}`}
                className='focus-visible:ring-foreground/40 shrink-0 rounded-full focus-visible:ring-2 focus-visible:outline-none'
              >
                <TalentAvatar candidate={applicant.user} size={40} ring />
              </button>

              <div className='min-w-0 flex-1'>
                <button
                  type='button'
                  onClick={() => setExpanded(applicant)}
                  className='block max-w-full truncate text-left text-sm font-medium hover:underline'
                >
                  {applicant.user.name || applicant.user.username}
                </button>
                <p className='text-muted-foreground text-xs'>
                  {applicant.role_title} · {applicant.user.jobsDone} project
                  {applicant.user.jobsDone === 1 ? '' : 's'}
                </p>
                {applicant.note && (
                  <p className='text-muted-foreground mt-1.5 line-clamp-2 text-xs italic'>
                    “{applicant.note}”
                  </p>
                )}
              </div>

              <span className='text-muted-foreground shrink-0 text-[10px] tabular-nums'>
                {formatMessageTime(applicant.created_at)}
              </span>
            </div>

            <div className='mt-3 flex gap-2'>
              <button
                type='button'
                onClick={() => setExpanded(applicant)}
                className='text-muted-foreground border-foreground/10 hover:text-foreground flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition'
              >
                <Maximize2 size={12} /> Profile
              </button>
              <button
                type='button'
                onClick={() => decide(applicant, 'accepted')}
                disabled={pending}
                className='bg-gradient-brand text-on-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40'
              >
                <Check size={12} /> Approve
              </button>
              <button
                type='button'
                onClick={() => decide(applicant, 'rejected')}
                disabled={pending}
                className='text-muted-foreground border-foreground/10 hover:text-foreground flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition disabled:opacity-40'
              >
                <X size={12} /> Reject
              </button>
            </div>
          </div>
        ))}

        {pendingApplicants.length === 0 && applicants.length === 0 && (
          <p className='text-muted-foreground/70 text-xs'>
            Nobody has applied yet. Public briefs appear in every matching talent member&apos;s feed.
          </p>
        )}

        {decided.length > 0 && (
          <details className='pt-2'>
            <summary className='text-muted-foreground hover:text-foreground cursor-pointer text-xs'>
              {decided.length} already decided
            </summary>
            <div className='mt-2 space-y-1'>
              {decided.map((applicant) => (
                <div
                  key={applicant.id}
                  className='flex items-center gap-2.5 rounded-lg px-2 py-1.5'
                >
                  <TalentAvatar candidate={applicant.user} size={24} />
                  <span className='min-w-0 flex-1 truncate text-xs'>
                    {applicant.user.name || applicant.user.username}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                      applicant.status === 'accepted'
                        ? 'bg-status-active/20 text-status-active'
                        : 'text-muted-foreground bg-foreground/5'
                    }`}
                  >
                    {applicant.status}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {expanded && (
        <CreativeDialog
          candidate={toCandidate(expanded)}
          disciplineLabels={disciplineLabels}
          open
          onOpenChange={(open) => !open && setExpanded(null)}
          actions={{
            onAccept: () => decide(expanded, 'accepted'),
            onReject: () => decide(expanded, 'rejected'),
          }}
        />
      )}
    </div>
  );
}

/** The applicant's embedded profile, in the shape the shared card renders. */
function toCandidate(applicant: Applicant): TalentCandidate {
  return {
    id: applicant.user.id,
    username: applicant.user.username,
    name: applicant.user.name,
    avatar: applicant.user.avatar,
    bio: applicant.user.bio,
    passion: applicant.user.passion,
    tags: applicant.user.tags,
    disciplines: applicant.user.disciplines,
    showreelUrl: applicant.user.showreelUrl,
    locationDisplay: null,
    jobsDone: applicant.user.jobsDone,
    isFavourite: false,
    isPrimaryMatch: false,
    recommendRate: null,
    feedbackCount: 0,
  };
}
