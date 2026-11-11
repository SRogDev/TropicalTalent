'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Search and the open/all toggle for the briefs feed.
 *
 * State lives in the URL so a filtered feed is shareable and survives a
 * refresh; the server re-renders it rather than the client re-filtering a list
 * it also has to keep in sync.
 */
export function BriefSearch({ defaultValue, showAll }: { defaultValue: string; showAll: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(defaultValue);

  const go = (next: { q?: string; open?: string }) => {
    const params = new URLSearchParams();
    const q = next.q ?? query;
    if (q.trim()) params.set('q', q.trim());
    const open = next.open ?? (showAll ? 'all' : '');
    if (open === 'all') params.set('open', 'all');

    const search = params.toString();
    startTransition(() => router.push(search ? `/briefs?${search}` : '/briefs', { scroll: false }));
  };

  return (
    <div className='flex flex-col gap-2 sm:flex-row'>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({});
        }}
        className='glass flex flex-1 items-center gap-2 rounded-lg px-3 py-2'
      >
        <Search size={15} className='text-muted-foreground shrink-0' />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search briefs…'
          aria-label='Search briefs'
          className='placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-sm focus:outline-none'
        />
        {query && (
          <button
            type='button'
            onClick={() => {
              setQuery('');
              go({ q: '' });
            }}
            aria-label='Clear search'
            className='text-muted-foreground hover:text-foreground shrink-0'
          >
            <X size={14} />
          </button>
        )}
      </form>

      <div
        className='border-foreground/10 bg-sunken flex items-center rounded-lg border p-0.5'
        role='group'
        aria-label='Brief availability'
      >
        {(
          [
            { value: '', label: 'Open roles' },
            { value: 'all', label: 'All briefs' },
          ] as const
        ).map((option) => {
          const active = (option.value === 'all') === showAll;
          return (
            <button
              key={option.value}
              type='button'
              onClick={() => go({ open: option.value })}
              aria-pressed={active}
              disabled={pending}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs whitespace-nowrap transition sm:flex-none',
                active
                  ? 'bg-gradient-brand text-on-brand'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
