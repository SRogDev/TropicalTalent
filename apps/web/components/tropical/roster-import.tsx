'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/ui/toast';
import { inviteRosterAction } from '@/modules/tenancy/actions';

/**
 * Bulk roster onboarding.
 *
 * Paste a column out of a spreadsheet, a CSV, a mail client's "Name <addr>"
 * list — anything. The action extracts addresses rather than parsing a format,
 * so none of those need explaining to the person doing it.
 *
 * Nothing is emailed. This records who is allowed in; the client sends their
 * own people the sign-in link. Said plainly in the UI, because "invite" in
 * every other product means an email just went out, and an admin who believes
 * that will sit waiting for 600 people to arrive.
 */
export function RosterImport({
  tenantId,
  workerLabel,
  payerLabel,
  signInUrl,
}: {
  tenantId: string;
  workerLabel: string;
  payerLabel: string;
  signInUrl: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [emails, setEmails] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Counted the same way the action does, so the number on the button is the
  // number that will actually be added.
  const detected = (emails.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g) ?? []).length;

  function onSubmit(form: FormData) {
    setError(null);
    form.set('tenantId', tenantId);

    startTransition(async () => {
      const result = await inviteRosterAction(form);
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      const r = result.data;
      toast({
        title: `${r.added} added`,
        description:
          [
            r.emailed > 0 && `${r.emailed} emailed`,
            r.alreadyInvited > 0 && `${r.alreadyInvited} already invited`,
            r.alreadyMembers > 0 && `${r.alreadyMembers} already members`,
          ]
            .filter(Boolean)
            .join(' · ') || 'Everyone on that list can now sign up.',
      });
      setEmails('');
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className='space-y-3'>
      <label className='block space-y-1'>
        <span className='text-xs font-medium'>Roster</span>
        <textarea
          name='emails'
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={8}
          placeholder={'ada@acme.com\ngrace@acme.com\n…'}
          className='bg-sunken border-foreground/10 focus:border-foreground/25 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none'
        />
        <span className='text-muted-foreground block text-xs'>
          Paste a column, a CSV, or a list.{' '}
          {detected > 0 && `${detected} address${detected === 1 ? '' : 'es'} found.`}
        </span>
      </label>

      <div className='flex flex-wrap items-center gap-4'>
        <label className='flex items-center gap-2 text-xs'>
          <span className='text-muted-foreground'>Joining as</span>
          <select
            name='side'
            className='bg-sunken border-foreground/10 rounded-lg border px-2 py-1.5 text-xs'
          >
            <option value='worker'>{workerLabel}</option>
            <option value='payer'>{payerLabel}</option>
          </select>
        </label>

        <label className='flex items-center gap-2 text-xs'>
          <input type='checkbox' name='asAdmin' className='accent-primary' />
          <span className='text-muted-foreground'>Make them workspace admins</span>
        </label>

        {/* Named with the count, because the difference between mailing two
            people and mailing six hundred is the whole reason this is a
            choice and not a side effect of pasting a roster. */}
        <label className='flex items-center gap-2 text-xs'>
          <input type='checkbox' name='notify' defaultChecked className='accent-primary' />
          <span className='text-muted-foreground'>
            Email {detected > 0 ? `${detected} ` : ''}an invite link
          </span>
        </label>
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      <button
        type='submit'
        disabled={pending || detected === 0}
        className='gradient-app text-on-brand rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50'
      >
        {pending ? 'Adding…' : detected > 0 ? `Pre-authorise ${detected}` : 'Pre-authorise'}
      </button>

      <div className='bg-sunken space-y-1 rounded-lg px-3 py-2'>
        <p className='text-muted-foreground text-xs'>
          <strong className='text-foreground'>This records who may join.</strong> With the box
          ticked they also get an emailed link; either way you can send it yourself:
        </p>
        <code className='block text-xs break-all'>{signInUrl}</code>
      </div>
    </form>
  );
}
