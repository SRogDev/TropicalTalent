'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Mail, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { respondToInviteAction } from '@/modules/projects/actions';
import { formatPence } from '@/lib/money';

/**
 * An invitation from a brand, awaiting an answer.
 *
 * Separate from "roles you hold" because an invited role is not held — the
 * brand has made an offer. Listing the two together implied the talent was
 * already committed to work they had never agreed to.
 *
 * The fee IS shown here: it is the material term of the offer, and asking
 * someone to accept work without telling them what it pays is not a decision
 * they can make. It is their own role, so this is not the split leaking.
 */
export function InvitationCard({
  role,
}: {
  role: {
    id: string;
    title: string;
    amount: number;
    deliverables: string | null;
    deadline_date: string | null;
    project: {
      id: string;
      name: string;
      brief: string;
      currency: string;
    } | null;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [answered, setAnswered] = useState(false);

  if (answered) return null;

  const respond = (response: 'accepted' | 'declined') => {
    startTransition(async () => {
      const result = await respondToInviteAction(role.id, response);
      if (result.success !== true) {
        toast({ title: 'Could not respond', description: result.error, variant: 'destructive' });
        return;
      }
      setAnswered(true);
      toast({
        title: response === 'accepted' ? 'Role accepted' : 'Invitation declined',
        description:
          response === 'accepted'
            ? 'The project is now in your sidebar.'
            : 'The brand has been told and the role is open again.',
      });
      router.refresh();
    });
  };

  return (
    <article className='border-accent/40 bg-accent/[0.07] rounded-2xl border p-5'>
      <div className='text-accent flex items-center gap-1.5 text-[11px] tracking-widest uppercase'>
        <Mail size={12} /> Invitation
      </div>

      <h3 className='mt-2 text-base font-semibold'>{role.project?.name}</h3>
      <div className='text-muted-foreground mt-0.5 text-xs tracking-widest uppercase'>
        {role.title}
      </div>

      <p className='text-muted-foreground mt-2 line-clamp-2 text-sm'>{role.project?.brief}</p>

      {role.deliverables && (
        <p className='text-muted-foreground mt-2 line-clamp-2 text-xs'>{role.deliverables}</p>
      )}

      <div className='mt-4 flex items-center justify-between'>
        <span className='text-muted-foreground text-[11px]'>
          {role.deadline_date
            ? `Due ${new Date(role.deadline_date).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
              })}`
            : 'No deadline set'}
        </span>
        <span className='text-gradient-brand text-lg font-semibold tabular-nums'>
          {formatPence(role.amount, role.project?.currency ?? 'GBP')}
        </span>
      </div>

      <div className='mt-4 flex gap-2'>
        <button
          type='button'
          onClick={() => respond('accepted')}
          disabled={pending}
          className='bg-gradient-brand text-on-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium disabled:opacity-40'
        >
          <Check size={14} /> Accept
        </button>
        <button
          type='button'
          onClick={() => respond('declined')}
          disabled={pending}
          className='text-muted-foreground border-foreground/15 hover:text-foreground flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm transition disabled:opacity-40'
        >
          <X size={14} /> Decline
        </button>
      </div>

      {role.project && (
        <Link
          href={`/projects/${role.project.id}`}
          className='text-muted-foreground hover:text-foreground mt-3 inline-block text-xs underline underline-offset-4'
        >
          Open the project first
        </Link>
      )}
    </article>
  );
}
