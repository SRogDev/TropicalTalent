'use client';

import { useState } from 'react';
import { BriefComposer } from './brief-composer';
import { RetainerComposer } from './retainer-composer';
import type { Discipline } from '@/modules/skills/types';
import type { TalentCandidate } from '@/modules/talent/types';

/**
 * One-off or recurring, chosen before anything else.
 *
 * The two branches are genuinely different pieces of work — a pot split across
 * a team, or one person on an ongoing arrangement — so this switches between
 * two composers rather than toggling fields inside one. Keeping them separate
 * is what lets the fixed-price flow stay exactly as it was.
 *
 * Client-side state because nothing about the choice needs a round trip: both
 * composers already have every list they need, resolved once on the server by
 * the page above.
 *
 * Rendered only where the tenant has `recurring` on; a workspace without it
 * gets the brief composer directly and never sees a choice it cannot make.
 */
export function CreateSwitch({
  disciplines,
  candidatePool,
  roster,
  platformFeePct,
}: {
  disciplines: Discipline[];
  candidatePool: Record<string, TalentCandidate[]>;
  roster: TalentCandidate[];
  platformFeePct: number;
}) {
  const [mode, setMode] = useState<'oneoff' | 'recurring'>('oneoff');

  return (
    <div>
      <div className='mx-auto max-w-4xl px-4 pt-8 sm:px-6 sm:pt-10'>
        <div
          className='border-foreground/10 bg-sunken mx-auto flex w-full max-w-xs items-center rounded-lg border p-0.5'
          role='group'
          aria-label='Budget type'
        >
          {(
            [
              ['oneoff', 'One-off'],
              ['recurring', 'Recurring'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type='button'
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                mode === value ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'oneoff' ? (
        <BriefComposer
          disciplines={disciplines}
          candidatePool={candidatePool}
          roster={roster}
          platformFeePct={platformFeePct}
        />
      ) : (
        <RetainerComposer
          roster={roster}
          disciplines={disciplines}
          platformFeePct={platformFeePct}
        />
      )}
    </div>
  );
}
