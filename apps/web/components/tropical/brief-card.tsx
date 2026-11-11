'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock, Sparkles, Users } from 'lucide-react';
import { TalentAvatar } from './talent-avatar';
import { useToast } from '@/components/ui/toast';
import { applyToRoleAction } from '@/modules/briefs/actions';
import { addSkillAction } from '@/modules/skills/actions';
import { formatPence } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { PublicBrief } from '@/modules/briefs/types';

/**
 * A public brief in the discovery feed.
 *
 * Shows the total pot and the open role titles — never the per-role split.
 * That restriction is enforced by the tropical_public_briefs view, which does
 * not select those columns; this component could not display them if it tried.
 *
 * The apply logic is the change: EVERY open role gets an apply button, not
 * just the ones matching the talent's listed skills. Applying to a role
 * whose skill they do not list is accepted and held, with an inline prompt to
 * add the skill. Adding it releases the application to the brand
 * automatically — the trigger in migration 011 does that, so it also works if
 * they add the skill later from their profile.
 */
export function BriefCard({
  brief,
  myDisciplines,
  appliedRoles,
  disciplineLabels,
}: {
  brief: PublicBrief;
  myDisciplines: string[];
  /** role_id -> application status. */
  appliedRoles: Record<string, string>;
  disciplineLabels: Record<string, string>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [needsSkill, setNeedsSkill] = useState<{ slug: string; label: string } | null>(null);

  const mine = new Set(myDisciplines);
  const openRoles = brief.roles.filter((r) => r.status === 'open');

  // Any application on this brief, in any state.
  const existing = brief.roles
    .map((r) => ({ role: r, status: appliedRoles[r.id] }))
    .find((entry) => entry.status);

  const apply = (roleId: string, discipline: string | null) => {
    startTransition(async () => {
      const result = await applyToRoleAction(brief.id, roleId);

      if (result.success !== true) {
        toast({ title: 'Could not apply', description: result.error, variant: 'destructive' });
        return;
      }

      if (result.data.status === 'pending_skill' && discipline) {
        setNeedsSkill({ slug: discipline, label: disciplineLabels[discipline] ?? discipline });
        toast({
          title: 'Application held',
          description: 'Add the skill to your profile and it goes straight to the brand.',
        });
      } else {
        toast({ title: 'Applied', description: 'The brand has been notified.' });
      }
      router.refresh();
    });
  };

  const addSkill = () => {
    if (!needsSkill) return;
    startTransition(async () => {
      const result = await addSkillAction(needsSkill.label);
      if (result.success !== true) {
        toast({ title: 'Could not add skill', description: result.error, variant: 'destructive' });
        return;
      }
      setNeedsSkill(null);
      toast({
        title: `${needsSkill.label} added`,
        description: 'Your application has been sent to the brand.',
      });
      router.refresh();
    });
  };

  return (
    <article className='glass hover:border-foreground/20 mb-5 break-inside-avoid rounded-2xl p-5 transition'>
      <div className='flex items-start justify-between gap-3'>
        <h3 className='text-base leading-snug font-semibold'>{brief.name}</h3>
        <TalentAvatar
          candidate={{
            avatar: brief.brand_avatar,
            name: brief.brand_name,
            username: brief.brand_username,
          }}
          size={28}
        />
      </div>

      <p className='text-muted-foreground mt-2 line-clamp-3 text-sm'>{brief.brief}</p>

      <div className='mt-4 flex items-baseline gap-2'>
        <span className='text-gradient-brand text-xl font-semibold tabular-nums'>
          {formatPence(brief.budget, brief.currency)}
        </span>
        <span className='text-muted-foreground text-xs'>total pot</span>
      </div>

      <div className='mt-3 flex flex-wrap gap-1.5'>
        {brief.roles.map((role) => {
          const isMine = role.discipline && mine.has(role.discipline);
          const isOpen = role.status === 'open';
          return (
            <span
              key={role.id}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px]',
                isOpen && isMine
                  ? 'border-primary/40 bg-primary/15 text-foreground'
                  : isOpen
                    ? 'border-foreground/10 bg-foreground/5'
                    : 'text-muted-foreground border-foreground/5 bg-sunken line-through',
              )}
              title={isOpen ? 'Open' : 'Filled'}
            >
              {role.discipline ? (disciplineLabels[role.discipline] ?? role.title) : role.title}
            </span>
          );
        })}
      </div>

      <div className='text-muted-foreground mt-3 flex items-center gap-1.5 text-[11px]'>
        <Users size={11} />
        {brief.open_roles} of {brief.total_roles} roles open
      </div>

      <div className='mt-4'>
        {needsSkill ? (
          <div className='border-accent/30 bg-accent/10 rounded-lg border p-3'>
            <p className='text-accent flex items-center gap-1.5 text-xs font-medium'>
              <Clock size={12} /> Waiting on your profile
            </p>
            <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
              This role wants <strong className='text-foreground'>{needsSkill.label}</strong>, which
              is not on your profile yet. Add it and your application goes to the brand immediately.
            </p>
            <div className='mt-3 flex gap-2'>
              <button
                type='button'
                onClick={addSkill}
                disabled={pending}
                className='bg-gradient-brand text-on-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40'
              >
                <Sparkles size={12} />
                {pending ? 'Adding…' : `Add ${needsSkill.label}`}
              </button>
              <button
                type='button'
                onClick={() => setNeedsSkill(null)}
                className='text-muted-foreground hover:text-foreground rounded-lg px-3 py-2 text-xs'
              >
                Later
              </button>
            </div>
          </div>
        ) : existing ? (
          <div
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm',
              existing.status === 'pending_skill' ? 'bg-accent/15 text-accent' : 'bg-foreground/10',
            )}
          >
            {existing.status === 'pending_skill' ? (
              <>
                <Clock size={14} /> Held - add the skill to send it
              </>
            ) : (
              <>
                <Check size={14} className='text-status-active' /> Applied
              </>
            )}
          </div>
        ) : openRoles.length > 0 ? (
          <div className='flex flex-wrap gap-2'>
            {/* Matching roles first, then the rest — a talent can apply to
                anything, but what they already qualify for leads. */}
            {[...openRoles]
              .sort((a, b) => {
                const am = a.discipline && mine.has(a.discipline) ? 0 : 1;
                const bm = b.discipline && mine.has(b.discipline) ? 0 : 1;
                return am - bm;
              })
              .slice(0, 3)
              .map((role) => {
                const isMine = role.discipline && mine.has(role.discipline);
                return (
                  <button
                    key={role.id}
                    type='button'
                    onClick={() => apply(role.id, role.discipline)}
                    disabled={pending}
                    className={cn(
                      'flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40',
                      isMine
                        ? 'bg-gradient-brand text-on-brand'
                        : 'text-muted-foreground border-foreground/15 hover:text-foreground border',
                    )}
                    title={
                      isMine
                        ? undefined
                        : 'Not on your profile yet - you can still apply, then add the skill'
                    }
                  >
                    {pending ? 'Applying…' : `Apply - ${role.title}`}
                  </button>
                );
              })}
          </div>
        ) : (
          <div className='text-muted-foreground bg-foreground/5 rounded-lg px-3 py-2 text-center text-xs'>
            Crew complete
          </div>
        )}
      </div>
    </article>
  );
}
