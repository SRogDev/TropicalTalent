'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock, Sparkles, X } from 'lucide-react';
import { TalentAvatar } from './talent-avatar';
import { useToast } from '@/components/ui/toast';
import { withdrawApplicationAction } from '@/modules/briefs/actions';
import { addSkillAction } from '@/modules/skills/actions';
import { cn } from '@/lib/utils';
import type { MyApplication } from '@/modules/briefs/types';

/**
 * One of the talent's applications, with the job attached.
 *
 * Carries the project name, brief, status and deadline — everything except the
 * money, which an applicant has no claim to see until they are on the crew.
 *
 * A held (`pending_skill`) application gets an inline "add the skill" action,
 * so the fix is where the problem is stated rather than three screens away in
 * the profile editor.
 */
export function ApplicationCard({
  application,
  disciplineLabels,
}: {
  application: MyApplication;
  disciplineLabels: Record<string, string>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const held = application.status === 'pending_skill';
  const skillLabel = application.required_discipline
    ? (disciplineLabels[application.required_discipline] ?? application.required_discipline)
    : null;

  const addSkill = () => {
    if (!skillLabel) return;
    startTransition(async () => {
      const result = await addSkillAction(skillLabel);
      if (result.success !== true) {
        toast({ title: 'Could not add skill', description: result.error, variant: 'destructive' });
        return;
      }
      toast({
        title: `${skillLabel} added`,
        description: 'Your application has been sent to the brand.',
      });
      router.refresh();
    });
  };

  const withdraw = () => {
    startTransition(async () => {
      const result = await withdrawApplicationAction(application.id);
      if (result.success !== true) {
        toast({ title: 'Could not withdraw', description: result.error, variant: 'destructive' });
        return;
      }
      setDismissed(true);
      toast({ title: 'Application withdrawn' });
      router.refresh();
    });
  };

  return (
    <article
      className={cn(
        'rounded-2xl border p-5',
        held ? 'border-accent/30 bg-accent/[0.06]' : 'border-foreground/15 border-dashed',
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-muted-foreground text-xs tracking-widest uppercase'>
            {application.role_title}
          </div>
          <h3 className='mt-1 truncate text-base font-semibold'>{application.project_name}</h3>
        </div>
        <TalentAvatar
          candidate={{
            avatar: application.brand_avatar,
            name: application.brand_name,
            username: application.brand_username,
          }}
          size={28}
        />
      </div>

      <p className='text-muted-foreground mt-2 line-clamp-2 text-sm'>{application.project_brief}</p>

      <div className='mt-3 flex flex-wrap items-center gap-2 text-[11px]'>
        <StatusPill status={application.status} />
        <span className='text-muted-foreground'>
          Project {application.project_status.replace('_', ' ')}
        </span>
        {application.project_deadline && (
          <span className='text-muted-foreground'>
            · due{' '}
            {new Date(application.project_deadline).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        )}
      </div>

      {held && skillLabel && (
        <div className='border-accent/30 bg-sunken mt-4 rounded-lg border p-3'>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            This role wants <strong className='text-foreground'>{skillLabel}</strong>. Add it to
            your profile and the brand sees your application straight away.
          </p>
          <button
            type='button'
            onClick={addSkill}
            disabled={pending}
            className='bg-gradient-brand text-on-brand mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40'
          >
            <Sparkles size={12} />
            {pending ? 'Adding…' : `Add ${skillLabel} to my profile`}
          </button>
        </div>
      )}

      {(application.status === 'pending' || held) && (
        <button
          type='button'
          onClick={withdraw}
          disabled={pending}
          className='text-muted-foreground hover:text-foreground mt-3 text-xs underline underline-offset-4 disabled:opacity-40'
        >
          Withdraw application
        </button>
      )}
    </article>
  );
}

function StatusPill({ status }: { status: MyApplication['status'] }) {
  const config = {
    pending: {
      label: 'Awaiting the brand',
      icon: Clock,
      tone: 'bg-status-pending/20 text-status-pending',
    },
    pending_skill: { label: 'Held - add the skill', icon: Clock, tone: 'bg-accent/20 text-accent' },
    accepted: { label: 'Accepted', icon: Check, tone: 'bg-status-active/20 text-status-active' },
    rejected: { label: 'Not selected', icon: X, tone: 'bg-foreground/5 text-muted-foreground' },
    withdrawn: { label: 'Withdrawn', icon: X, tone: 'bg-foreground/5 text-muted-foreground' },
  }[status];

  const Icon = config.icon;

  return (
    <span className={cn('flex items-center gap-1 rounded-full px-2 py-1', config.tone)}>
      <Icon size={10} />
      {config.label}
    </span>
  );
}
