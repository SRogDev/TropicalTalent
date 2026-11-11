'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Heart, MapPin, Maximize2, Play, Send, Sparkles, Star } from 'lucide-react';
import { CreativeDialog } from './creative-card';
import { ShowreelPlayer } from './showreel-player';
import { avatarUrl, cn } from '@/lib/utils';
import type { TalentCandidate } from '@/modules/talent/types';

/**
 * A talent on the Talent page.
 *
 * Image-led rather than text-led: the previous tile put a 48px avatar next to
 * a paragraph of bio, which made a page of talent professionals read like a
 * contact list. Here the portrait IS the card — the work and the face are what
 * a brand is actually scanning for — and the text sits over the bottom of it.
 *
 * Quick actions (favourite, invite, expand) are always visible rather than
 * hover-only: hover does not exist on the phones half this audience browses on.
 */
export function TalentTile({
  candidate,
  disciplineLabels,
  onFavourite,
  onInvite,
}: {
  candidate: TalentCandidate;
  disciplineLabels: Record<string, string>;
  onFavourite: () => void;
  onInvite?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [favourite, setFavourite] = useState(candidate.isFavourite);
  const [, startTransition] = useTransition();

  const name = candidate.name || candidate.username || 'Unnamed creative';
  const portrait = avatarUrl(candidate.avatar);
  const primaryRole =
    candidate.passion ||
    (candidate.disciplines[0] ? disciplineLabels[candidate.disciplines[0]] : null);

  const toggleFavourite = () => {
    // Optimistic — the heart is the whole interaction, and waiting on a round
    // trip to fill it in makes the page feel broken.
    setFavourite((f) => !f);
    startTransition(() => onFavourite());
  };

  return (
    <>
      <article className='glass group hover:border-foreground/25 relative overflow-hidden rounded-2xl transition'>
        {/* --- portrait --- */}
        <button
          type='button'
          onClick={() => setExpanded(true)}
          aria-label={`View ${name}`}
          className='relative block aspect-[4/5] w-full overflow-hidden'
        >
          {portrait ? (
            <Image
              src={portrait}
              alt={name}
              fill
              sizes='(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px'
              className='object-cover transition duration-300 group-hover:scale-[1.03]'
              unoptimized={portrait.includes('?t=')}
            />
          ) : (
            <span className='bg-gradient-brand text-on-brand grid h-full w-full place-items-center text-4xl font-bold'>
              {initials(name)}
            </span>
          )}

          {/* Legibility for the text below, regardless of the photo. */}
          <span className='absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/50 to-transparent' />

          <span className='absolute inset-x-0 bottom-0 p-3 text-left'>
            <span className='block truncate text-sm font-semibold text-white'>{name}</span>
            {primaryRole && (
              <span className='text-accent block truncate text-[11px]'>{primaryRole}</span>
            )}
            {candidate.locationDisplay && (
              <span className='mt-0.5 flex items-center gap-1 truncate text-[10px] text-white/70'>
                <MapPin size={9} className='shrink-0' /> {candidate.locationDisplay}
              </span>
            )}
          </span>

          {candidate.showreelUrl && (
            <span className='absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[9px] text-white backdrop-blur'>
              <Play size={8} fill='currentColor' /> Reel
            </span>
          )}
        </button>

        {/* --- favourite, floating over the portrait --- */}
        <button
          type='button'
          onClick={toggleFavourite}
          aria-pressed={favourite}
          aria-label={favourite ? `Unfavourite ${name}` : `Favourite ${name}`}
          className={cn(
            'absolute top-2 right-2 grid h-9 w-9 place-items-center rounded-full backdrop-blur transition',
            favourite
              ? 'text-neon-emerald bg-black/60'
              : 'bg-black/40 text-white/70 hover:bg-black/60 hover:text-white',
          )}
        >
          <Heart size={15} fill={favourite ? 'currentColor' : 'none'} />
        </button>

        {/* --- quick actions --- */}
        <div className='flex items-center gap-1.5 p-2'>
          <button
            type='button'
            onClick={() => setExpanded(true)}
            className='text-muted-foreground border-foreground/10 hover:text-foreground flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] transition'
          >
            <Maximize2 size={11} /> Profile
          </button>
          {onInvite && (
            <button
              type='button'
              onClick={onInvite}
              className='bg-gradient-brand text-on-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium'
            >
              <Send size={11} /> Invite
            </button>
          )}
        </div>
      </article>

      <CreativeDialog
        candidate={candidate}
        disciplineLabels={disciplineLabels}
        open={expanded}
        onOpenChange={setExpanded}
        actions={{ onFavourite: toggleFavourite, isFavourite: favourite, onInvite }}
      />
    </>
  );
}

/**
 * The spotlight: one talent given the full width at the top of the page.
 *
 * Picked server-side, deterministically per day — a random pick per render
 * would change on every navigation, which reads as a glitch rather than a
 * feature.
 */
export function TalentSpotlight({
  candidate,
  disciplineLabels,
  onFavourite,
  onInvite,
}: {
  candidate: TalentCandidate;
  disciplineLabels: Record<string, string>;
  onFavourite: () => void;
  onInvite?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [favourite, setFavourite] = useState(candidate.isFavourite);
  const [, startTransition] = useTransition();

  const name = candidate.name || candidate.username || 'Unnamed creative';
  const portrait = avatarUrl(candidate.avatar);

  const toggleFavourite = () => {
    setFavourite((f) => !f);
    startTransition(() => onFavourite());
  };

  return (
    <>
      <section className='glass relative overflow-hidden rounded-2xl'>
        <div className='bg-gradient-brand absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-20 blur-3xl' />

        {/* Always a row. A full-width portrait on mobile letterboxed a tall
            photo down to a horizontal band — which on most portraits is torso
            and background, not a face — and pushed the roster below the fold. */}
        <div className='relative flex flex-wrap gap-4 p-4 sm:gap-5 sm:p-6'>
          <button
            type='button'
            onClick={() => setExpanded(true)}
            aria-label={`View ${name}`}
            className='relative h-28 w-28 shrink-0 overflow-hidden rounded-xl sm:h-40 sm:w-40'
          >
            {portrait ? (
              <Image
                src={portrait}
                alt={name}
                fill
                sizes='160px'
                // Centre crop, not object-top. These are phone photos with the
                // subject in the middle of a very tall frame, not studio
                // headshots — anchoring to the top lands on ceiling and sky.
                className='object-cover'
                unoptimized={portrait.includes('?t=')}
              />
            ) : (
              <span className='bg-gradient-brand text-on-brand grid h-full w-full place-items-center text-3xl font-bold'>
                {initials(name)}
              </span>
            )}
          </button>

          <div className='min-w-0 flex-1'>
            <div className='text-accent flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase'>
              <Sparkles size={11} /> Spotlight
            </div>

            <h2 className='mt-1.5 truncate text-xl font-semibold tracking-tight'>{name}</h2>
            {candidate.passion && (
              <p className='text-muted-foreground truncate text-sm'>{candidate.passion}</p>
            )}

            {candidate.bio && (
              <p className='text-muted-foreground mt-2 line-clamp-2 text-xs leading-relaxed'>
                {candidate.bio}
              </p>
            )}

            <div className='mt-3 flex flex-wrap gap-1.5'>
              {candidate.disciplines.slice(0, 4).map((slug) => (
                <span
                  key={slug}
                  className='border-foreground/10 bg-foreground/5 rounded-full border px-2.5 py-1 text-[10px]'
                >
                  {disciplineLabels[slug] ?? slug}
                </span>
              ))}
            </div>

            <div className='text-muted-foreground mt-3 flex items-center gap-4 text-[11px]'>
              <span className='flex items-center gap-1'>
                <Star size={11} className='text-accent' /> {candidate.jobsDone} project
                {candidate.jobsDone === 1 ? '' : 's'}
              </span>
              {candidate.locationDisplay && (
                <span className='flex items-center gap-1'>
                  <MapPin size={11} /> {candidate.locationDisplay}
                </span>
              )}
            </div>

            <div className='mt-4 flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={() => setExpanded(true)}
                className='text-muted-foreground border-foreground/10 hover:text-foreground flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs transition'
              >
                <Maximize2 size={12} /> Full profile
              </button>
              {onInvite && (
                <button
                  type='button'
                  onClick={onInvite}
                  className='bg-gradient-brand text-on-brand flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium'
                >
                  <Send size={12} /> Invite to a brief
                </button>
              )}
              <button
                type='button'
                onClick={toggleFavourite}
                aria-pressed={favourite}
                aria-label={favourite ? `Unfavourite ${name}` : `Favourite ${name}`}
                className={cn(
                  'border-foreground/10 grid h-9 w-9 place-items-center rounded-lg border transition',
                  favourite
                    ? 'text-neon-emerald'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                <Heart size={14} fill={favourite ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          {candidate.showreelUrl && (
            <div className='w-full shrink-0 lg:w-64'>
              <ShowreelPlayer url={candidate.showreelUrl} />
            </div>
          )}
        </div>
      </section>

      <CreativeDialog
        candidate={candidate}
        disciplineLabels={disciplineLabels}
        open={expanded}
        onOpenChange={setExpanded}
        actions={{ onFavourite: toggleFavourite, isFavourite: favourite, onInvite }}
      />
    </>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
