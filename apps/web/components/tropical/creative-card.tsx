'use client';

import { useState } from 'react';
import { Briefcase, Check, Heart, MapPin, Maximize2, Send, Star, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TalentAvatar } from './talent-avatar';
import { ShowreelPlayer } from './showreel-player';
import { formatPence } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { TalentCandidate } from '@/modules/talent/types';

/**
 * A talent's profile in three sizes: a popover preview, a card, and a full
 * expanded dialog with the showreel playing inside it.
 *
 * Every level renders from data the server already sent — nothing here
 * fetches. The old discover popup queried Supabase on every open, which put a
 * round trip and a spinner between the click and anything appearing.
 *
 * Used by the team builder and the applicant review panel. The Talent page has
 * its own image-led tile (talent-tile.tsx) but opens the same dialog, so a
 * talent reads the same wherever a brand meets them.
 */

export interface CreativeCardActions {
  onFavourite?: () => void;
  /** Current favourite state, for the button in ActionRow. */
  isFavourite?: boolean;
  onInvite?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onSwap?: () => void;
  /** Alternatives available for a swap; disables the control at 0. */
  swapCount?: number;
}

/** A small filled heart next to a name — the same "you've saved this person"
 *  signal the Talent page gives, surfaced wherever a favourite shows up. */
function FavouriteBadge() {
  return (
    <span
      className='text-neon-emerald inline-flex items-center'
      title='Favourited'
      aria-label='Favourited'
    >
      <Heart size={12} fill='currentColor' />
    </span>
  );
}

/** The compact preview shown on hover/click of an avatar. */
export function CreativePopup({
  candidate,
  disciplineLabels,
  roleAmount,
  currency,
  children,
  actions,
}: {
  candidate: TalentCandidate;
  disciplineLabels: Record<string, string>;
  roleAmount?: number;
  currency?: string;
  children: React.ReactNode;
  actions?: CreativeCardActions;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayName = candidate.name || candidate.username || 'Unnamed creative';

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align='start'
          sideOffset={10}
          className='glass border-foreground/10 w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-0'
        >
          <div className='bg-gradient-brand h-16 rounded-t-2xl opacity-80' />

          <div className='px-5 pb-5'>
            <div className='-mt-8 flex items-end gap-3'>
              <TalentAvatar candidate={candidate} size={64} ring />
              <div className='min-w-0 pb-1'>
                <p className='flex items-center gap-1.5 truncate text-base font-semibold'>
                  <span className='truncate'>{displayName}</span>
                  {candidate.isFavourite && <FavouriteBadge />}
                </p>
                {candidate.username && (
                  <p className='text-muted-foreground truncate text-xs'>@{candidate.username}</p>
                )}
              </div>
            </div>

            <div className='mt-4 flex flex-wrap gap-1.5'>
              {candidate.disciplines.slice(0, 4).map((slug) => (
                <span
                  key={slug}
                  className='border-foreground/10 bg-foreground/5 rounded-full border px-2.5 py-1 text-[11px]'
                >
                  {disciplineLabels[slug] ?? slug}
                </span>
              ))}
            </div>

            {candidate.bio && (
              <p className='text-muted-foreground mt-3 line-clamp-3 text-xs leading-relaxed'>
                {candidate.bio}
              </p>
            )}

            <div className='mt-4 grid grid-cols-2 gap-2'>
              <Stat
                icon={<Briefcase size={12} />}
                label='Projects'
                value={String(candidate.jobsDone)}
              />
              {typeof roleAmount === 'number' ? (
                <Stat
                  icon={<Star size={12} />}
                  label='This role'
                  value={formatPence(roleAmount, currency)}
                />
              ) : (
                <Stat
                  icon={<Star size={12} />}
                  label='Match'
                  value={candidate.isPrimaryMatch ? 'Primary' : 'Secondary'}
                />
              )}
            </div>

            {/* The preview is a preview; the full card is one click away, with
                the showreel in it. */}
            <button
              type='button'
              onClick={() => setExpanded(true)}
              className='text-muted-foreground border-foreground/10 hover:text-foreground mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition'
            >
              <Maximize2 size={12} /> View full profile
            </button>

            {actions && <ActionRow actions={actions} compact />}
          </div>
        </PopoverContent>
      </Popover>

      <CreativeDialog
        candidate={candidate}
        disciplineLabels={disciplineLabels}
        roleAmount={roleAmount}
        currency={currency}
        open={expanded}
        onOpenChange={setExpanded}
        actions={actions}
      />
    </>
  );
}

/** The full profile, showreel included. */
export function CreativeDialog({
  candidate,
  disciplineLabels,
  roleAmount,
  currency,
  open,
  onOpenChange,
  actions,
}: {
  candidate: TalentCandidate;
  disciplineLabels: Record<string, string>;
  roleAmount?: number;
  currency?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: CreativeCardActions;
}) {
  const displayName = candidate.name || candidate.username || 'Unnamed creative';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='tropical glass border-foreground/10 max-h-[85dvh] max-w-lg overflow-y-auto p-0'>
        <DialogTitle className='sr-only'>{displayName}</DialogTitle>
        <DialogDescription className='sr-only'>
          Full profile, skills and showreel for {displayName}
        </DialogDescription>

        <div className='bg-gradient-brand h-24 opacity-80' />

        <div className='-mt-12 px-6 pb-6'>
          <TalentAvatar candidate={candidate} size={80} ring />

          <div className='mt-3'>
            <h2 className='flex items-center gap-2 text-xl font-semibold tracking-tight'>
              <span>{displayName}</span>
              {candidate.isFavourite && <FavouriteBadge />}
            </h2>
            {candidate.username && (
              <p className='text-muted-foreground text-sm'>@{candidate.username}</p>
            )}
            {candidate.locationDisplay && (
              <p className='text-muted-foreground mt-1 flex items-center gap-1.5 text-xs'>
                <MapPin size={12} /> {candidate.locationDisplay}
              </p>
            )}
          </div>

          {candidate.disciplines.length > 0 && (
            <div className='mt-4 flex flex-wrap gap-1.5'>
              {candidate.disciplines.map((slug) => (
                <span
                  key={slug}
                  className='border-foreground/10 bg-foreground/5 rounded-full border px-3 py-1 text-xs'
                >
                  {disciplineLabels[slug] ?? slug}
                </span>
              ))}
            </div>
          )}

          <div className='mt-5 grid grid-cols-2 gap-2'>
            <Stat
              icon={<Briefcase size={12} />}
              label='Projects'
              value={String(candidate.jobsDone)}
            />
            {typeof roleAmount === 'number' ? (
              <Stat
                icon={<Star size={12} />}
                label='This role'
                value={formatPence(roleAmount, currency)}
              />
            ) : (
              <Stat
                icon={<Star size={12} />}
                label='Skills'
                value={String(candidate.disciplines.length)}
              />
            )}
          </div>

          {candidate.bio && (
            <Section title='About'>
              <p className='text-sm leading-relaxed'>{candidate.bio}</p>
            </Section>
          )}

          {candidate.passion && (
            <Section title='What drives them'>
              <p className='text-sm leading-relaxed'>{candidate.passion}</p>
            </Section>
          )}

          {candidate.showreelUrl && (
            <Section title='Showreel'>
              <ShowreelPlayer url={candidate.showreelUrl} />
            </Section>
          )}

          {candidate.tags.length > 0 && (
            <Section title='Skills'>
              <div className='flex flex-wrap gap-1.5'>
                {candidate.tags.map((tag) => (
                  <span
                    key={tag}
                    className='border-foreground/10 bg-foreground/5 rounded-full border px-2.5 py-1 text-[11px]'
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {actions && <ActionRow actions={actions} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionRow({ actions, compact }: { actions: CreativeCardActions; compact?: boolean }) {
  const { onAccept, onReject, onInvite, onSwap, onFavourite, isFavourite, swapCount } = actions;
  if (!onAccept && !onReject && !onInvite && !onSwap && !onFavourite) return null;

  return (
    <div className={cn('flex flex-wrap gap-2', compact ? 'mt-3' : 'mt-6')}>
      {onFavourite && (
        <button
          type='button'
          onClick={onFavourite}
          aria-pressed={isFavourite}
          aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition',
            isFavourite
              ? 'text-neon-emerald border-foreground/10 bg-foreground/5'
              : 'text-muted-foreground border-foreground/10 hover:text-foreground',
          )}
        >
          <Heart size={13} fill={isFavourite ? 'currentColor' : 'none'} />
          {isFavourite ? 'Favourited' : 'Favourite'}
        </button>
      )}
      {onAccept && (
        <button
          type='button'
          onClick={onAccept}
          className='bg-gradient-brand text-on-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium'
        >
          <Check size={13} /> Approve
        </button>
      )}
      {onReject && (
        <button
          type='button'
          onClick={onReject}
          className='text-muted-foreground border-foreground/10 hover:text-foreground flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition'
        >
          <X size={13} /> Reject
        </button>
      )}
      {onInvite && !onAccept && (
        <button
          type='button'
          onClick={onInvite}
          className='bg-gradient-brand text-on-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium'
        >
          <Send size={13} /> Invite to a project
        </button>
      )}
      {onSwap && (
        <button
          type='button'
          onClick={onSwap}
          disabled={!swapCount}
          title={
            swapCount
              ? `${swapCount} other${swapCount === 1 ? '' : 's'} available`
              : 'No one else available for this role'
          }
          className='text-muted-foreground border-foreground/10 hover:text-foreground flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition disabled:opacity-40'
        >
          Swap {swapCount ? swapCount : null}
        </button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='mt-5'>
      <h3 className='text-muted-foreground mb-2 text-[11px] tracking-[0.14em] uppercase'>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className='border-foreground/10 bg-sunken rounded-lg border px-3 py-2'>
      <div className='text-muted-foreground flex items-center gap-1 text-[10px] tracking-widest uppercase'>
        {icon}
        {label}
      </div>
      <div className='mt-0.5 truncate text-sm font-semibold'>{value}</div>
    </div>
  );
}
