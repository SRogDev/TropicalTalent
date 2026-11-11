'use client';

import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { cn, slugify } from '@/lib/utils';
import type { Discipline } from '@/modules/skills/types';

/**
 * A searchable discipline picker.
 *
 * Two surfaces use it and both used to render the ENTIRE vocabulary as a wall
 * of pills — the team builder's "Add a role" list and the profile's skill
 * editor. With a few hundred disciplines that is unusable: you scroll, you do
 * not find, you give up.
 *
 * Design decisions:
 *
 *   * Filtering is in memory over the list the server already sent. No request
 *     between the keystroke and the result.
 *   * `useDeferredValue` keeps typing responsive on a long list: the input
 *     updates on every keystroke, the (heavier) result list is allowed to lag
 *     a frame behind rather than blocking it.
 *   * A hard cap on rendered results. `maxResults` is 20 for the team
 *     builder's quick-add — the brief asked for a short list, not a paginated
 *     view of the vocabulary.
 *   * No holder counts. The team builder used to append a database count to
 *     every pill, which was noise next to the actual decision.
 *   * When nothing matches, the typed text becomes a create option. That is
 *     what makes "add a skill that isn't in the list" work.
 */

export interface DisciplineSearchProps {
  disciplines: Discipline[];
  onSelect: (discipline: { slug: string; label: string; isNew: boolean }) => void;
  onCancel?: () => void;
  /** Slugs already chosen — shown as selected, and not re-offered. */
  selected?: string[];
  /** Cap on rendered results. */
  maxResults?: number;
  /** Allow creating a discipline that does not exist yet. */
  allowCreate?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export function DisciplineSearch({
  disciplines,
  onSelect,
  onCancel,
  selected = [],
  maxResults = 20,
  allowCreate = false,
  placeholder = 'Search roles…',
  autoFocus = true,
}: DisciplineSearchProps) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  const chosen = useMemo(() => new Set(selected), [selected]);

  const results = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    const available = disciplines.filter((d) => !chosen.has(d.slug));

    if (!term) return available.slice(0, maxResults);

    // Case-insensitive on the label, and on the slug so "video-editor" finds
    // "Video Editor". Prefix matches sort above contains-matches, because a
    // search for "photo" should surface "Photographer" before "Food
    // Photography Assistant".
    const scored: Array<{ discipline: Discipline; rank: number }> = [];
    for (const discipline of available) {
      const label = discipline.label.toLowerCase();
      const index = label.indexOf(term);
      if (index === 0) scored.push({ discipline, rank: 0 });
      else if (index > 0) scored.push({ discipline, rank: 1 });
      else if (discipline.slug.includes(term)) scored.push({ discipline, rank: 2 });
    }

    return scored
      .sort((a, b) => a.rank - b.rank || a.discipline.label.localeCompare(b.discipline.label))
      .slice(0, maxResults)
      .map((s) => s.discipline);
  }, [deferredQuery, disciplines, chosen, maxResults]);

  const trimmed = query.trim();
  const exactExists =
    trimmed !== '' &&
    disciplines.some(
      (d) => d.label.toLowerCase() === trimmed.toLowerCase() || d.slug === slugify(trimmed),
    );
  const canCreate = allowCreate && trimmed.length > 1 && !exactExists;

  const choose = (slug: string, label: string, isNew: boolean) => {
    onSelect({ slug, label, isNew });
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <div className='space-y-3'>
      <div className='glass flex items-center gap-2 rounded-lg px-3 py-2'>
        <Search size={14} className='text-muted-foreground shrink-0' />
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (query) setQuery('');
              else onCancel?.();
            }
            // Enter takes the top result, or creates when there is none.
            if (e.key === 'Enter') {
              e.preventDefault();
              if (results.length > 0) {
                choose(results[0].slug, results[0].label, false);
              } else if (canCreate) {
                choose(slugify(trimmed), trimmed, true);
              }
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className='placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-sm focus:outline-none'
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
        {onCancel && (
          <button
            type='button'
            onClick={onCancel}
            className='text-muted-foreground hover:text-foreground shrink-0 text-xs'
          >
            cancel
          </button>
        )}
      </div>

      <div className='flex flex-wrap gap-1.5'>
        {results.map((discipline) => (
          <button
            key={discipline.slug}
            type='button'
            onClick={() => choose(discipline.slug, discipline.label, false)}
            className='hover:bg-gradient-brand bg-foreground/5 hover:text-on-brand rounded-full px-3 py-1.5 text-xs transition'
          >
            {discipline.label}
          </button>
        ))}

        {canCreate && (
          <button
            type='button'
            onClick={() => choose(slugify(trimmed), trimmed, true)}
            className={cn(
              'border-accent/40 text-accent flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-xs transition',
              'hover:bg-accent/10',
            )}
          >
            <Plus size={11} /> Add &ldquo;{trimmed}&rdquo;
          </button>
        )}

        {results.length === 0 && !canCreate && (
          <p className='text-muted-foreground py-1 text-xs'>
            {trimmed ? 'Nothing matches that.' : 'Nothing left to add.'}
          </p>
        )}
      </div>
    </div>
  );
}
