'use client';

import { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarClock, Search, X } from 'lucide-react';
import { formatPence, poundsToPence } from '@/lib/money';
import { useToast } from '@/components/ui/toast';
import { useTenantNouns } from './tenant-context';
import { DisciplineSearch } from './discipline-search';
import { TalentAvatar } from './talent-avatar';
import { createRetainerAction } from '@/modules/recurring/actions';
import { FUND_LEAD_DAYS, earliestStart } from '@/modules/recurring/types';
import type { Discipline } from '@/modules/skills/types';
import type { TalentCandidate } from '@/modules/talent/types';

/**
 * Setting up a recurring engagement.
 *
 * Deliberately not the brief composer with a switch flipped. The two are
 * different shapes of work, not two settings of one shape: a pot is a team and
 * a budget split between them, and a retainer is one person on an ongoing
 * arrangement. There is nothing to split, so there is no team builder, no
 * percentage slider and no brief-splitting — the fields here are the ones
 * tropical_create_retainer_project actually takes.
 *
 * Submitting creates a PAUSED engagement and lands the brand on its Project
 * Admin channel. It no longer redirects to payment provider: the card is the last step
 * of the set-up checklist there, not the first thing a brand is asked for. See
 * createRetainerAction for why that ordering changed.
 */
export function RetainerComposer({
  roster,
  disciplines,
  platformFeePct,
}: {
  roster: TalentCandidate[];
  disciplines: Discipline[];
  /** Display only — the same figure is read again from the tenant row when
   *  each period is scheduled, and frozen onto it there. */
  platformFeePct: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const nouns = useTenantNouns();

  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [disciplineLabel, setDisciplineLabel] = useState('');
  const [creative, setCreative] = useState<TalentCandidate | null>(null);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('monthly');
  const [amountInput, setAmountInput] = useState('2000');
  // The soonest bookable start, not today: the first payment is taken
  // FUND_LEAD_DAYS before the period begins, so anything sooner would be
  // charged after it had already started.
  const earliest = useMemo(() => earliestStart(), []);
  const [startsOn, setStartsOn] = useState(earliest);
  const [endsOn, setEndsOn] = useState('');
  const [approval, setApproval] = useState<'auto' | 'manual'>('auto');

  const amount = useMemo(() => {
    try {
      return poundsToPence(amountInput);
    } catch {
      return 0;
    }
  }, [amountInput]);

  // The same arithmetic tropical_schedule_period freezes onto each period row.
  // Shown because "what do they actually receive" is the question a brand asks
  // at this screen, and a fee discovered later reads as a surprise.
  const fee = Math.floor((amount * platformFeePct) / 100);
  const net = amount - fee;

  const startTooSoon = Boolean(startsOn) && startsOn < earliest;
  const datesValid = Boolean(startsOn && endsOn && endsOn > startsOn) && !startTooSoon;
  const ready = Boolean(name.trim() && roleTitle.trim() && creative && amount > 0 && datesValid);

  function submit() {
    if (!ready || !creative) return;
    startTransition(async () => {
      const form = new FormData();
      form.set('name', name.trim());
      form.set('roleTitle', roleTitle.trim());
      form.set('discipline', discipline);
      form.set('creativeId', creative.id);
      form.set('period', period);
      // Pounds here, pence in the action. One conversion, one place.
      form.set('periodAmount', String(amount / 100));
      form.set('startsOn', startsOn);
      form.set('endsOn', endsOn);
      form.set('approval', approval);

      const result = await createRetainerAction(form);
      if (result.success !== true) {
        toast({ title: 'Could not start it', description: result.error, variant: 'destructive' });
        return;
      }
      // Into the workspace, not off to payment provider. router.push rather than
      // window.location: this is our own origin and the workspace is already
      // server-rendered by the time the transition settles.
      router.push(`/projects/${result.data.projectId}`);
    });
  }

  const field =
    'bg-sunken border-foreground/10 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-foreground/25';

  return (
    <div className='mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6 sm:py-10'>
      <header>
        <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
          Set up a <span className='text-gradient-brand'>retainer</span>
        </h1>
        <p className='text-muted-foreground mt-2 text-sm'>
          One {nouns.worker.one}, paid the same amount every period. Nothing is charged now - you
          will confirm the dates and the contract on the next screen, and save a card there.
        </p>
      </header>

      <div className='glass space-y-4 rounded-2xl p-5'>
        <label className='block space-y-1'>
          <span className='text-xs font-medium'>Engagement name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Ongoing video production'
            className={field}
          />
        </label>

        <div className='grid gap-4 sm:grid-cols-2'>
          <label className='block space-y-1'>
            <span className='text-xs font-medium'>Role</span>
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder='Lead videographer'
              className={field}
            />
          </label>

          {/* A search, not a select. The taxonomy is a few hundred entries
              long and growing — the same reason the team builder and the
              profile editor use this component rather than rendering the
              whole vocabulary. allowCreate is what lets a company hire for
              something the list has never heard of, which on a contractor
              workspace is most of it. */}
          <div className='space-y-1'>
            <span className='text-xs font-medium'>Discipline (optional)</span>
            {discipline ? (
              <div className='bg-sunken border-foreground/10 flex items-center justify-between gap-2 rounded-lg border px-3 py-2'>
                <span className='text-sm'>{disciplineLabel}</span>
                <button
                  type='button'
                  onClick={() => {
                    setDiscipline('');
                    setDisciplineLabel('');
                  }}
                  className='text-muted-foreground hover:text-foreground text-xs'
                >
                  Change
                </button>
              </div>
            ) : (
              <DisciplineSearch
                disciplines={disciplines}
                maxResults={8}
                allowCreate
                autoFocus={false}
                placeholder='Search or add a discipline…'
                onSelect={({ slug, label }) => {
                  setDiscipline(slug);
                  setDisciplineLabel(label);
                  // Prefill the role title from the discipline when it is
                  // still empty — on a retainer the two are usually the same
                  // word, and typing it twice is friction for no decision.
                  setRoleTitle((current) => current || label);
                }}
              />
            )}
          </div>
        </div>

        {/* Required, unlike the underlying RPC's optional assignee. A recurring
            role with nobody on it schedules periods that can be charged and
            never released — migration 035 refuses to schedule them, and this
            stops the form asking in the first place. */}
        <div className='space-y-1'>
          <span className='text-xs font-medium'>Who is it for</span>
          <PersonPicker
            roster={roster}
            selected={creative}
            onSelect={setCreative}
            onClear={() => setCreative(null)}
          />
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <label className='block space-y-1'>
            <span className='text-xs font-medium'>Amount per period</span>
            <div className='bg-sunken border-foreground/10 flex items-center gap-2 rounded-lg border px-3 py-2'>
              <span className='text-muted-foreground text-sm'>£</span>
              <input
                inputMode='decimal'
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className='w-full bg-transparent text-sm font-medium tabular-nums outline-none'
                aria-label='Amount per period in pounds'
              />
            </div>
          </label>

          <div className='space-y-1'>
            <span className='text-xs font-medium'>Every</span>
            <div
              className='border-foreground/10 bg-sunken flex items-center rounded-lg border p-0.5'
              role='group'
              aria-label='Billing period'
            >
              {(['weekly', 'monthly'] as const).map((p) => (
                <button
                  key={p}
                  type='button'
                  onClick={() => setPeriod(p)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                    period === p ? 'bg-background shadow-sm' : 'text-muted-foreground'
                  }`}
                >
                  {p === 'weekly' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <label className='block space-y-1'>
            <span className='text-xs font-medium'>First period starts</span>
            <input
              type='date'
              value={startsOn}
              min={earliest}
              onChange={(e) => setStartsOn(e.target.value)}
              className={field}
            />
            {startTooSoon ? (
              <span className='text-destructive block text-[11px]'>
                The earliest you can start is {formatDay(earliest)} - payment is taken{' '}
                {FUND_LEAD_DAYS} days before a period begins.
              </span>
            ) : (
              <span className='text-muted-foreground block text-[11px]'>
                Earliest {formatDay(earliest)}, so the first payment clears before it begins.
              </span>
            )}
          </label>

          {/* Compulsory, and it becomes the project's final delivery date.
              Open-ended was the default before, which left the workspace with
              no deadline to show and the set-up checklist with nothing to
              confirm — and an engagement nobody had agreed an end to. Both
              dates stay editable until the card is saved. */}
          <label className='block space-y-1'>
            <span className='text-xs font-medium'>Final delivery date</span>
            <input
              type='date'
              value={endsOn}
              min={startsOn || earliest}
              onChange={(e) => setEndsOn(e.target.value)}
              className={field}
            />
            {endsOn && !datesValid && (
              <span className='text-destructive block text-[11px]'>
                This has to be after the start date.
              </span>
            )}
          </label>
        </div>

        <div className='space-y-1'>
          <span className='text-xs font-medium'>Releasing each period</span>
          <div
            className='border-foreground/10 bg-sunken flex items-center rounded-lg border p-0.5'
            role='group'
            aria-label='Approval mode'
          >
            {(
              [
                ['auto', 'Automatically'],
                ['manual', 'After I approve'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type='button'
                onClick={() => setApproval(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  approval === value ? 'bg-background shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The timing is the thing brands get wrong about retainers, so it is
          stated rather than left to be discovered on the first invoice. */}
      {amount > 0 && (
        <div className='bg-sunken text-muted-foreground space-y-1 rounded-xl px-4 py-3 text-xs'>
          <p className='flex items-center gap-2'>
            <CalendarClock size={13} />
            <span>
              You&apos;re charged {formatPence(amount)} three days before each{' '}
              {period === 'weekly' ? 'week' : 'month'} begins. It&apos;s held for the whole period
              and released at the end of it.
            </span>
          </p>
          <p>
            {formatPence(net)} reaches the {nouns.worker.one} each period, after the{' '}
            {platformFeePct}% fee.
          </p>
        </div>
      )}

      <button
        type='button'
        onClick={submit}
        disabled={pending || !ready}
        className='bg-gradient-brand glow text-on-brand flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-medium disabled:opacity-40'
      >
        {pending ? 'Setting up…' : 'Create the engagement'}
        {!pending && <ArrowRight size={14} />}
      </button>
    </div>
  );
}

/** Short, unambiguous day label for the date hints. */
function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * Choosing who the engagement is for.
 *
 * A search over the roster the server already sent, not a `<select>` of
 * everybody. On a roster of any size the dropdown is unusable — you scroll a
 * list of every contractor in the workspace looking for one name — and it is
 * the same problem, with the same answer, as the team builder's by-name search
 * and the discipline picker: filter in memory, cap the results, show a face.
 */
function PersonPicker({
  roster,
  selected,
  onSelect,
  onClear,
}: {
  roster: TalentCandidate[];
  selected: TalentCandidate | null;
  onSelect: (candidate: TalentCandidate) => void;
  onClear: () => void;
}) {
  const nouns = useTenantNouns();
  const [query, setQuery] = useState('');
  // Keeps typing responsive while the (heavier) result list re-renders, the
  // same treatment DisciplineSearch gives a few hundred entries.
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    const term = deferred.trim().toLowerCase();
    const matches = term
      ? roster.filter((c) => {
          const name = (c.name ?? '').toLowerCase();
          const username = (c.username ?? '').toLowerCase();
          const passion = (c.passion ?? '').toLowerCase();
          return name.includes(term) || username.includes(term) || passion.includes(term);
        })
      : roster;

    // Favourites first — a nudge, not a filter, so a typed name still finds
    // someone who is not one.
    return [...matches].sort((a, b) => Number(b.isFavourite) - Number(a.isFavourite)).slice(0, 6);
  }, [deferred, roster]);

  if (selected) {
    return (
      <div className='bg-sunken border-foreground/10 flex items-center gap-2.5 rounded-lg border px-3 py-2'>
        <TalentAvatar candidate={selected} size={28} />
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-sm font-medium'>
            {selected.name || selected.username}
          </span>
          <span className='text-muted-foreground block truncate text-[11px]'>
            {selected.passion || `No skills listed yet`}
          </span>
        </span>
        <button
          type='button'
          onClick={() => {
            onClear();
            setQuery('');
          }}
          className='text-muted-foreground hover:text-foreground shrink-0 text-xs'
        >
          Change
        </button>
      </div>
    );
  }

  if (roster.length === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        Nobody on your roster yet - invite someone first.
      </p>
    );
  }

  return (
    <div className='space-y-2'>
      <div className='bg-sunken border-foreground/10 flex items-center gap-2 rounded-lg border px-3 py-2'>
        <Search size={14} className='text-muted-foreground shrink-0' />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            if (e.key === 'Enter' && results[0]) {
              e.preventDefault();
              onSelect(results[0]);
            }
          }}
          placeholder={`Search ${nouns.worker.many} by name…`}
          aria-label={`Search ${nouns.worker.many} by name`}
          className='placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-sm outline-none'
        />
        {query && (
          <button
            type='button'
            onClick={() => setQuery('')}
            aria-label='Clear search'
            className='text-muted-foreground hover:text-foreground shrink-0'
          >
            <X size={13} />
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <p className='text-muted-foreground px-1 text-xs'>No one matches that name.</p>
      ) : (
        <div className='space-y-0.5'>
          {results.map((candidate) => (
            <button
              key={candidate.id}
              type='button'
              onClick={() => onSelect(candidate)}
              className='hover:bg-foreground/5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition'
            >
              <TalentAvatar candidate={candidate} size={28} />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-xs font-medium'>
                  {candidate.name || candidate.username}
                </span>
                {/* Say so when a profile carries nothing, rather than leaving
                    a blank line that reads as a rendering fault. */}
                <span className='text-muted-foreground block truncate text-[10px]'>
                  {candidate.passion ||
                    (candidate.disciplines.length === 0
                      ? 'No skills listed yet'
                      : candidate.disciplines.slice(0, 2).join(' · '))}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
