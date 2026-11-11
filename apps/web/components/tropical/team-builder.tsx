'use client';

import { useCallback, useDeferredValue, useMemo, useState, useTransition } from 'react';
import {
  Equal,
  Heart,
  Plus,
  RefreshCw,
  Search,
  UserMinus,
  UserPlus,
  UserSearch,
  X,
} from 'lucide-react';
import { TalentAvatar } from './talent-avatar';
import { CreativePopup } from './creative-card';
import { DisciplineSearch } from './discipline-search';
import { useToast } from '@/components/ui/toast';
import { toggleFavouriteAction } from '@/modules/talent/actions';
import { formatPence, splitPot } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Discipline } from '@/modules/skills/types';
import type { TalentCandidate } from '@/modules/talent/types';
import { useTenantNouns } from './tenant-context';

/**
 * The crew editor: one row per role, showing who holds it, what share of the
 * pot they get, and what that is in pounds.
 *
 * Money is recomputed with the same exact-allocation function the server uses,
 * so what the brand sees here is what gets written.
 *
 * Two additions over the previous builder:
 *
 *   * "Add a role" is a search box, not the whole vocabulary rendered as pills.
 *   * Each role can be filled by NAME as well as by discipline — a brand who
 *     already knows who they want should not have to find them by scrolling
 *     the pool for the right discipline.
 */

export interface BuilderRole {
  key: string;
  title: string;
  discipline: string | null;
  percentage: number;
  /** Index into the candidate pool for this discipline. */
  candidateIndex: number;
  /** A talent picked by name, overriding the discipline pool. */
  pinnedUserId: string | null;
  /** Explicitly cleared by the brand — leave the role open to applications. */
  unassigned: boolean;
}

export function TeamBuilder({
  roles,
  onRolesChange,
  budget,
  platformFeePct,
  currency = 'GBP',
  disciplines,
  candidatePool,
  roster,
  publicMode = false,
}: {
  roles: BuilderRole[];
  onRolesChange: (roles: BuilderRole[]) => void;
  budget: number;
  platformFeePct: number;
  currency?: string;
  disciplines: Discipline[];
  /** discipline slug -> ranked candidates, prefetched server-side. */
  candidatePool: Record<string, TalentCandidate[]>;
  /**
   * Every talent, including those with no discipline listed.
   *
   * The by-name search used to derive this from `candidatePool`, which is
   * keyed by discipline - so anyone without one was unfindable even when the
   * brand knew their name. On the live roster that was 4 of 37 people.
   */
  roster: TalentCandidate[];
  /**
   * A public brief: roles are posted for anyone to apply to, so there is no
   * candidate to show or pick. Hides the avatar, swap and by-name search
   * controls and leaves every role open.
   */
  publicMode?: boolean;
}) {
  const nouns = useTenantNouns();
  const [addingRole, setAddingRole] = useState(false);
  const [nameSearchFor, setNameSearchFor] = useState<string | null>(null);
  const { toast } = useToast();
  const [, startFavouriteTransition] = useTransition();

  // Local, optimistic — the roster and candidatePool are server-rendered
  // props and do not re-fetch when a favourite changes mid-session.
  const [favouriteIds, setFavouriteIds] = useState(
    () => new Set(roster.filter((c) => c.isFavourite).map((c) => c.id)),
  );

  const toggleFavourite = useCallback(
    (candidateId: string) => {
      setFavouriteIds((prev) => {
        const next = new Set(prev);
        if (next.has(candidateId)) next.delete(candidateId);
        else next.add(candidateId);
        return next;
      });
      startFavouriteTransition(() => {
        void toggleFavouriteAction(candidateId).then((result) => {
          if (result.success !== true) {
            toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
          }
        });
      });
    },
    [toast],
  );

  const disciplineLabels = useMemo(
    () => Object.fromEntries(disciplines.map((d) => [d.slug, d.label])),
    [disciplines],
  );

  const split = useMemo(() => {
    if (roles.length === 0 || budget <= 0) return null;
    try {
      return splitPot(
        budget,
        roles.map((r) => ({ id: r.key, percentage: r.percentage })),
        platformFeePct,
      );
    } catch {
      return null;
    }
  }, [roles, budget, platformFeePct]);

  const amountFor = useCallback(
    (key: string) => split?.roles.find((r) => r.id === key)?.amount ?? 0,
    [split],
  );

  const candidateFor = useCallback(
    (role: BuilderRole): TalentCandidate | null => {
      if (role.unassigned) return null;
      if (role.pinnedUserId) {
        return roster.find((c) => c.id === role.pinnedUserId) ?? null;
      }
      if (!role.discipline) return null;
      const pool = candidatePool[role.discipline] ?? [];
      if (pool.length === 0) return null;
      return pool[role.candidateIndex % pool.length] ?? null;
    },
    [candidatePool, roster],
  );

  const patch = useCallback(
    (key: string, next: Partial<BuilderRole>) => {
      onRolesChange(roles.map((r) => (r.key === key ? { ...r, ...next } : r)));
    },
    [roles, onRolesChange],
  );

  const reroll = useCallback(
    (role: BuilderRole) => {
      const pool = role.discipline ? (candidatePool[role.discipline] ?? []) : [];
      if (pool.length === 0) return;
      patch(role.key, {
        candidateIndex: (role.candidateIndex + 1) % pool.length,
        pinnedUserId: null,
        unassigned: false,
      });
    },
    [candidatePool, patch],
  );

  const totalPct = roles.reduce((sum, r) => sum + r.percentage, 0);

  const splitEqually = useCallback(() => {
    if (roles.length === 0) return;
    const share = Number((100 / roles.length).toFixed(2));
    onRolesChange(roles.map((r) => ({ ...r, percentage: share })));
  }, [roles, onRolesChange]);

  return (
    <div className='space-y-4'>
      <header className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h2 className='text-lg font-semibold'>Your team</h2>
          <p className='text-muted-foreground text-xs'>
            {publicMode
              ? `Posted publicly - ${nouns.worker.many} apply, and you choose who joins.`
              : 'Tap a face to see who they are, or search someone by name.'}
          </p>
        </div>
        {split && (
          <div className='text-right'>
            <div className='text-gradient-brand text-2xl font-semibold tabular-nums'>
              {formatPence(split.crewPool, currency)}
            </div>
            <div className='text-muted-foreground text-[11px]'>
              team pool · {formatPence(split.platformFee, currency)} fee
            </div>
          </div>
        )}
      </header>

      {roles.length > 1 && (
        <div className='flex justify-end'>
          <button
            type='button'
            onClick={splitEqually}
            className='text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition'
          >
            <Equal size={12} /> Split pay equally
          </button>
        </div>
      )}

      <div className='space-y-2.5'>
        {roles.map((role) => {
          const candidate = candidateFor(role);
          const pool = role.discipline ? (candidatePool[role.discipline] ?? []) : [];
          const amount = amountFor(role.key);

          return (
            <div
              key={role.key}
              className='glass hover:border-foreground/20 rounded-xl p-3.5 transition-colors'
            >
              <div className='flex flex-col gap-3 md:flex-row md:items-center'>
                <div className='flex min-w-0 items-center gap-3 md:w-56'>
                  {publicMode ? (
                    <div
                      className='text-muted-foreground border-foreground/20 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-dashed'
                      aria-hidden
                    >
                      <UserPlus size={16} />
                    </div>
                  ) : candidate ? (
                    <CreativePopup
                      candidate={{ ...candidate, isFavourite: favouriteIds.has(candidate.id) }}
                      disciplineLabels={disciplineLabels}
                      roleAmount={amount}
                      currency={currency}
                      actions={{
                        onSwap: () => reroll(role),
                        swapCount: Math.max(0, pool.length - 1),
                        onFavourite: () => toggleFavourite(candidate.id),
                        isFavourite: favouriteIds.has(candidate.id),
                      }}
                    >
                      <button
                        type='button'
                        className='focus-visible:ring-foreground/40 relative rounded-full focus-visible:ring-2 focus-visible:outline-none'
                        aria-label={`View ${candidate.name || candidate.username}`}
                      >
                        <TalentAvatar candidate={candidate} size={44} ring />
                        {favouriteIds.has(candidate.id) && (
                          <span
                            className='text-neon-emerald bg-background absolute -top-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full'
                            aria-hidden
                          >
                            <Heart size={9} fill='currentColor' />
                          </span>
                        )}
                      </button>
                    </CreativePopup>
                  ) : (
                    <button
                      type='button'
                      onClick={() => patch(role.key, { unassigned: false, candidateIndex: 0 })}
                      disabled={pool.length === 0}
                      className='text-muted-foreground border-foreground/20 hover:text-foreground grid h-11 w-11 shrink-0 place-items-center rounded-full border border-dashed disabled:opacity-40'
                      aria-label={pool.length === 0 ? 'Nobody available yet' : 'Assign someone'}
                      title={
                        pool.length === 0
                          ? 'Nobody with this discipline yet - leave it open for applications'
                          : 'Assign someone'
                      }
                    >
                      <UserPlus size={16} />
                    </button>
                  )}

                  <div className='min-w-0'>
                    <div className='truncate text-sm font-medium'>{role.title}</div>
                    <div className='text-muted-foreground truncate text-xs'>
                      {publicMode
                        ? 'Open to applications'
                        : candidate
                          ? candidate.name || candidate.username
                          : pool.length === 0
                            ? 'Open - no one yet'
                            : 'Open to applications'}
                    </div>
                  </div>
                </div>

                <div className='flex-1 space-y-1'>
                  <div className='flex items-center justify-between text-xs'>
                    <span className='text-muted-foreground tabular-nums'>{role.percentage}%</span>
                    <span className='font-semibold tabular-nums'>
                      {formatPence(amount, currency)}
                    </span>
                  </div>
                  <input
                    type='range'
                    min={1}
                    max={100}
                    value={role.percentage}
                    onChange={(e) => patch(role.key, { percentage: Number(e.target.value) })}
                    className='accent-primary w-full'
                    aria-label={`${role.title} share`}
                  />
                </div>

                <div className='flex items-center gap-1'>
                  {!publicMode && (
                    <>
                      <IconButton
                        icon={<UserSearch size={14} />}
                        label={`Find someone by name for ${role.title}`}
                        active={nameSearchFor === role.key}
                        onClick={() =>
                          setNameSearchFor((current) => (current === role.key ? null : role.key))
                        }
                      />
                      <IconButton
                        icon={<RefreshCw size={14} />}
                        label={`Swap ${role.title}`}
                        disabled={pool.length < 2}
                        title={
                          pool.length < 2
                            ? 'No alternatives available'
                            : `Swap - ${pool.length - 1} other${pool.length === 2 ? '' : 's'}`
                        }
                        onClick={() => reroll(role)}
                      />
                      <IconButton
                        icon={<UserMinus size={14} />}
                        label={`Leave ${role.title} open`}
                        disabled={!candidate}
                        title='Leave this role open for applications'
                        onClick={() => patch(role.key, { unassigned: true, pinnedUserId: null })}
                      />
                    </>
                  )}
                  <IconButton
                    icon={<X size={14} />}
                    label={`Remove ${role.title}`}
                    title='Remove role'
                    onClick={() => {
                      onRolesChange(roles.filter((r) => r.key !== role.key));
                      setNameSearchFor((current) => (current === role.key ? null : current));
                    }}
                  />
                </div>
              </div>

              {!publicMode && nameSearchFor === role.key && (
                <div className='border-foreground/10 mt-3 border-t pt-3'>
                  <NameSearch
                    candidates={roster}
                    favouriteIds={favouriteIds}
                    onPick={(candidateId) => {
                      patch(role.key, {
                        pinnedUserId: candidateId,
                        unassigned: false,
                      });
                      setNameSearchFor(null);
                    }}
                    onCancel={() => setNameSearchFor(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className='border-foreground/15 rounded-xl border border-dashed p-3'>
        {addingRole ? (
          <DisciplineSearch
            disciplines={disciplines}
            maxResults={20}
            allowCreate
            placeholder='Search roles…'
            onCancel={() => setAddingRole(false)}
            onSelect={({ slug, label }) => {
              const available = (candidatePool[slug] ?? []).length;
              onRolesChange([
                ...roles,
                {
                  key: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  title: label,
                  discipline: slug,
                  percentage: Math.max(1, Math.round(100 / (roles.length + 1) / 2)),
                  candidateIndex: 0,
                  pinnedUserId: null,
                  // A public brief posts every role for applications — never
                  // seat someone silently behind the "Open to applications" label.
                  unassigned: publicMode || available === 0,
                },
              ]);
              setAddingRole(false);
            }}
          />
        ) : (
          <button
            type='button'
            onClick={() => setAddingRole(true)}
            className='text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-2 py-1.5 text-sm'
          >
            <Plus size={14} /> Add a role
          </button>
        )}
      </div>

      {totalPct !== 100 && roles.length > 0 && (
        <p className='text-muted-foreground text-xs'>
          Shares total {totalPct}% - they are scaled to the team pool, so the full budget is always
          allocated.
        </p>
      )}
    </div>
  );
}

/**
 * Find a specific talent by name for a role.
 *
 * Filters the pool the server already sent, so it is instant. Deferred so the
 * input stays responsive while the result list re-renders.
 */
function NameSearch({
  candidates,
  favouriteIds,
  onPick,
  onCancel,
}: {
  candidates: TalentCandidate[];
  favouriteIds: Set<string>;
  onPick: (candidateId: string) => void;
  onCancel: () => void;
}) {
  const nouns = useTenantNouns();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    const term = deferred.trim().toLowerCase();
    const matches = term
      ? candidates.filter((c) => {
          const name = (c.name ?? '').toLowerCase();
          const username = (c.username ?? '').toLowerCase();
          return name.includes(term) || username.includes(term);
        })
      : candidates;

    // Favourites lead the list — a light nudge, not a hard filter, so a
    // typed name still surfaces someone who isn't one.
    return [...matches]
      .sort((a, b) => Number(favouriteIds.has(b.id)) - Number(favouriteIds.has(a.id)))
      .slice(0, 8);
  }, [deferred, candidates, favouriteIds]);

  return (
    <div className='space-y-2'>
      <div className='bg-sunken flex items-center gap-2 rounded-lg px-3 py-2'>
        <Search size={14} className='text-muted-foreground shrink-0' />
        <input
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && results[0]) {
              e.preventDefault();
              onPick(results[0].id);
            }
          }}
          placeholder={`Search ${nouns.worker.many} by name…`}
          aria-label={`Search ${nouns.worker.many} by name`}
          className='placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-sm focus:outline-none'
        />
        <button
          type='button'
          onClick={onCancel}
          className='text-muted-foreground hover:text-foreground shrink-0 text-xs'
        >
          cancel
        </button>
      </div>

      {results.length === 0 ? (
        <p className='text-muted-foreground px-1 text-xs'>No one matches that name.</p>
      ) : (
        <div className='space-y-0.5'>
          {results.map((candidate) => (
            <button
              key={candidate.id}
              type='button'
              onClick={() => onPick(candidate.id)}
              className='hover:bg-foreground/5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition'
            >
              <TalentAvatar candidate={candidate} size={28} />
              <span className='min-w-0 flex-1'>
                <span className='flex items-center gap-1 truncate text-xs font-medium'>
                  <span className='truncate'>{candidate.name || candidate.username}</span>
                  {favouriteIds.has(candidate.id) && (
                    <Heart size={10} className='text-neon-emerald shrink-0' fill='currentColor' />
                  )}
                </span>
                {/* Say so when a profile carries nothing, rather than leaving a
                    blank line that reads as a rendering fault. These are real
                    people on the roster who never filled anything in. */}
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

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-md transition disabled:opacity-30',
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
      )}
    >
      {icon}
    </button>
  );
}
