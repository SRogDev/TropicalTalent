'use client';

import { useState, useTransition } from 'react';
import { Flag } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { raiseComplaintAction } from '@/modules/complaints/actions';
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from '@/modules/complaints/types';

/**
 * Reporting something, from the bottom of any profile.
 *
 * Placed here rather than behind a support link because of where people
 * actually are when they need it: looking at the profile of the person they
 * want to report. On someone else's page the form opens with "Report a user"
 * already chosen and the subject already filled in, so the common case is two
 * clicks and no typing.
 *
 * `detail` is optional on purpose — the column allows null and the action does
 * not require it. A category alone is a usable signal, and a validator that
 * insists on prose only teaches people to pad.
 */
export function RaiseComplaintPanel({
  subjectUsername,
  subjectName,
}: {
  /** The profile being viewed, when it is not the viewer's own. */
  subjectUsername?: string;
  subjectName?: string | null;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ComplaintCategory>(
    subjectUsername ? 'report_user' : 'general_enquiry',
  );
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const aboutSomeoneElse = Boolean(subjectUsername);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await raiseComplaintAction({
        category,
        detail: detail.trim() || undefined,
        // Only sent when the form is actually about a person, so a stray
        // username on a bug report cannot attach an innocent account to it.
        subjectUsername: category === 'report_user' ? subjectUsername : undefined,
      });

      if (result.success !== true) {
        setError(result.error);
        return;
      }

      setOpen(false);
      setDetail('');
      toast({
        title: 'Thanks - that has been sent',
        description: 'Someone will look at it and get back to you.',
      });
    });
  };

  return (
    <section className='mt-7'>
      <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
        Report a problem
      </h2>

      <div className='glass rounded-2xl p-5'>
        {!open ? (
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <div className='flex min-w-0 items-center gap-3'>
              <span className='text-muted-foreground bg-foreground/5 grid h-9 w-9 shrink-0 place-items-center rounded-lg'>
                <Flag size={15} />
              </span>
              <div className='min-w-0'>
                <div className='text-sm font-medium'>
                  {aboutSomeoneElse ? `Report ${subjectName || 'this user'}` : 'Raise a complaint'}
                </div>
                <p className='text-muted-foreground text-xs'>
                  Report a user, report a bug, or ask us something.
                </p>
              </div>
            </div>
            <button
              type='button'
              onClick={() => setOpen(true)}
              className='glass text-foreground hover:bg-foreground/5 shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition'
            >
              Get in touch
            </button>
          </div>
        ) : (
          <div>
            <fieldset>
              <legend className='text-muted-foreground mb-2.5 text-xs'>What is this about?</legend>
              <div className='grid gap-2 sm:grid-cols-2'>
                {COMPLAINT_CATEGORIES.map((c) => {
                  // Reporting a user needs a user to report. On your own
                  // profile there is nobody in view, so the option would post a
                  // request the action is bound to refuse.
                  const unavailable = c.value === 'report_user' && !aboutSomeoneElse;
                  const selected = category === c.value;

                  return (
                    <button
                      key={c.value}
                      type='button'
                      disabled={unavailable}
                      aria-pressed={selected}
                      onClick={() => setCategory(c.value)}
                      className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${
                        selected
                          ? 'border-foreground/25 bg-foreground/5'
                          : 'border-foreground/10 hover:border-foreground/20'
                      }`}
                    >
                      <span className='block text-sm font-medium'>{c.label}</span>
                      <span className='text-muted-foreground mt-0.5 block text-xs'>
                        {unavailable ? 'Open someone else’s profile to report them.' : c.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {category === 'report_user' && aboutSomeoneElse && (
              <p className='text-muted-foreground mt-3 text-xs'>
                This report is about <span className='text-foreground'>@{subjectUsername}</span>.
              </p>
            )}

            <label className='mt-4 block'>
              <span className='text-muted-foreground text-xs'>
                Anything you want to add{' '}
                <span className='text-muted-foreground/70'>(optional)</span>
              </span>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={4000}
                rows={4}
                placeholder='What happened, and when?'
                className='border-foreground/10 focus:border-foreground/30 mt-1.5 w-full resize-y rounded-xl border bg-transparent p-3 text-sm outline-none'
              />
            </label>

            {error && <p className='text-destructive mt-3 text-xs'>{error}</p>}

            <div className='mt-4 flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                disabled={pending}
                className='glass text-muted-foreground hover:text-foreground rounded-lg px-4 py-2 text-sm disabled:opacity-40'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={submit}
                disabled={pending}
                className='bg-gradient-brand glow text-on-brand rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-40'
              >
                {pending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
