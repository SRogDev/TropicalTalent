'use client';

import { useState, useTransition } from 'react';
import { Mail, Megaphone } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { updateEmailPreferencesAction } from '@/modules/notifications/actions';
import type { EmailPreferences } from '@/modules/notifications/queries';

/**
 * The profile page's email switches. Two now, not one.
 *
 * They were a single master toggle, and 020 said as much: "no per-category
 * granularity was asked for." What that meant in practice was that escaping
 * the "we miss you at TropicalTalent" nudge also switched off "your payout completed" —
 * so the opt-out nobody could use was the one the law actually cares about.
 *
 * Kept as immediate-commit actions rather than a draft/save pair, for the same
 * reason as ReferralPanel: these are actions, not fields.
 *
 * Note what is deliberately absent: there is no switch for the emails we have
 * to send about money and security. Those are not a preference, and offering a
 * control that silently does nothing would be worse than not offering one.
 */
export function EmailPreferencesPanel({ initial }: { initial: EmailPreferences }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = useState(initial);

  const toggle = (key: keyof EmailPreferences) => {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next })); // optimistic — reverted below
    startTransition(async () => {
      const result = await updateEmailPreferencesAction({ [key]: next });
      if (result.success !== true) {
        setPrefs((p) => ({ ...p, [key]: !next }));
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
      }
    });
  };

  return (
    <section className='mt-7'>
      <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
        Email
      </h2>

      <div className='glass divide-foreground/5 divide-y rounded-2xl'>
        <Row
          icon={<Mail size={15} />}
          title='About your work'
          hint='Applications, invites, payments, deliveries and more.'
          on={prefs.service}
          pending={pending}
          onToggle={() => toggle('service')}
        />
        <Row
          icon={<Megaphone size={15} />}
          title='News and offers'
          hint='Occasional updates, invitations, and nudges if you have been away.'
          on={prefs.marketing}
          pending={pending}
          onToggle={() => toggle('marketing')}
        />
      </div>

      <p className='text-muted-foreground mt-2.5 text-xs'>
        We will always email you about your money and your account security, whatever these say.
      </p>
    </section>
  );
}

function Row({
  icon,
  title,
  hint,
  on,
  pending,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  on: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <div className='flex items-center justify-between gap-4 p-5'>
      <div className='flex min-w-0 items-center gap-3'>
        <span className='text-muted-foreground bg-foreground/5 grid h-9 w-9 shrink-0 place-items-center rounded-lg'>
          {icon}
        </span>
        <div className='min-w-0'>
          <div className='text-sm font-medium'>{title}</div>
          <p className='text-muted-foreground text-xs'>{hint}</p>
        </div>
      </div>

      <button
        type='button'
        role='switch'
        aria-checked={on}
        aria-label={title}
        onClick={onToggle}
        disabled={pending}
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          on ? 'bg-gradient-brand' : 'bg-foreground/10'
        }`}
      >
        {/* The knob is white only on the brand gradient. Off, the track is a
            pale tint in the light theme and a white knob would disappear into
            it, so it takes a mid tone that reads on either track. */}
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
            on ? 'right-0.5 bg-white' : 'bg-muted-foreground left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
