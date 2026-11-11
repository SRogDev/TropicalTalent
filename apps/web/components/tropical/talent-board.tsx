'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Heart, Search, Users, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { TalentSpotlight, TalentTile } from './talent-tile';
import { DisciplineSearch } from './discipline-search';
import { useToast } from '@/components/ui/toast';
import {
  inviteToRoleAction,
  loadMoreTalentAction,
  toggleFavouriteAction,
} from '@/modules/talent/actions';
import { cn } from '@/lib/utils';
import type { Discipline } from '@/modules/skills/types';
import type { TalentCandidate, TalentPage } from '@/modules/talent/types';
import { useTenantNouns } from './tenant-context';

interface InvitableProject {
  id: string;
  name: string;
  openRoles: Array<{ id: string; title: string; discipline: string | null }>;
}

/**
 * The Talent board: search, discipline filters, a favourites-only toggle, and
 * an invite flow into any of the brand's open roles.
 *
 * Search and filters write to the URL and let the server re-render. Holding
 * them in component state would mean a second source of truth that the back
 * button cannot reach.
 */
export function TalentBoard({
  initialPage,
  disciplines,
  projects,
  filter,
  spotlight,
}: {
  initialPage: TalentPage;
  disciplines: Discipline[];
  projects: InvitableProject[];
  filter: { search?: string; disciplines?: string[]; favouritesOnly?: boolean };
  /** Chosen server-side so it is stable across navigations. */
  spotlight: TalentCandidate | null;
}) {
  const nouns = useTenantNouns();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [navigating, startNavigation] = useTransition();

  const [searchDraft, setSearchDraft] = useState(filter.search ?? '');
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [inviting, setInviting] = useState<TalentCandidate | null>(null);

  // Pages fetched on this screen, after the one the server rendered.
  const [extra, setExtra] = useState<TalentCandidate[]>([]);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  // Changing a filter re-renders the server page, which makes everything
  // appended under the OLD filter wrong. Resetting during render rather than
  // in an effect means the stale names never reach the screen.
  const serverKey = JSON.stringify(filter);
  const [renderedKey, setRenderedKey] = useState(serverKey);
  if (renderedKey !== serverKey) {
    setRenderedKey(serverKey);
    setExtra([]);
    setCursor(initialPage.nextCursor);
    setHasMore(initialPage.hasMore);
  }

  const candidates = useMemo(
    () => [...initialPage.candidates, ...extra],
    [initialPage.candidates, extra],
  );

  const loadMore = () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void loadMoreTalentAction(cursor, filter).then((result) => {
      setLoadingMore(false);
      if (result.success !== true) {
        toast({ title: 'Could not load more', description: result.error, variant: 'destructive' });
        return;
      }
      // Belt and braces against a duplicate key if a page boundary shifts
      // under us — someone signing up mid-scroll moves everyone down one.
      setExtra((current) => {
        const seen = new Set([...initialPage.candidates, ...current].map((c) => c.id));
        return [...current, ...result.data.candidates.filter((c) => !seen.has(c.id))];
      });
      setCursor(result.data.nextCursor);
      setHasMore(result.data.hasMore);
    });
  };

  const disciplineLabels = useMemo(
    () => Object.fromEntries(disciplines.map((d) => [d.slug, d.label])),
    [disciplines],
  );

  const activeSkills = filter.disciplines ?? [];

  const setParams = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    startNavigation(() => router.push(`/talent?${params}`, { scroll: false }));
  };

  const toggleSkill = (slug: string) => {
    const next = activeSkills.includes(slug)
      ? activeSkills.filter((s) => s !== slug)
      : [...activeSkills, slug];
    setParams({ skills: next.join(',') || null });
  };

  const favourite = (candidate: TalentCandidate) => {
    void toggleFavouriteAction(candidate.id).then((result) => {
      if (result.success !== true) {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
      }
    });
  };

  return (
    <div className='mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10'>
      <header>
        <div className='glass text-accent inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] tracking-[0.18em] uppercase'>
          <Users size={12} /> Talent
        </div>
        <h1 className='mt-4 text-2xl font-semibold tracking-tight sm:text-3xl'>
          Find your <span className='text-gradient-brand'>people</span>.
        </h1>
      </header>

      {/* --- controls --- */}
      <div className='mt-6 space-y-3'>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setParams({ q: searchDraft.trim() || null });
            }}
            className='glass flex flex-1 items-center gap-2 rounded-lg px-3 py-2'
          >
            <Search size={15} className='text-muted-foreground shrink-0' />
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder='Search by name, handle or bio…'
              aria-label={`Search ${nouns.worker.many}`}
              className='placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-sm focus:outline-none'
            />
            {searchDraft && (
              <button
                type='button'
                onClick={() => {
                  setSearchDraft('');
                  setParams({ q: null });
                }}
                aria-label='Clear search'
                className='text-muted-foreground hover:text-foreground shrink-0'
              >
                <X size={14} />
              </button>
            )}
          </form>

          <button
            type='button'
            onClick={() => setParams({ favourites: filter.favouritesOnly ? null : '1' })}
            aria-pressed={filter.favouritesOnly}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm transition',
              filter.favouritesOnly
                ? 'bg-gradient-brand text-on-brand border-transparent'
                : 'text-muted-foreground border-foreground/10 hover:text-foreground',
            )}
          >
            <Heart size={14} fill={filter.favouritesOnly ? 'currentColor' : 'none'} />
            Favourites
          </button>
        </div>

        {activeSkills.length > 0 && (
          <div className='flex flex-wrap items-center gap-1.5'>
            {activeSkills.map((slug) => (
              <button
                key={slug}
                type='button'
                onClick={() => toggleSkill(slug)}
                className='bg-gradient-brand text-on-brand flex items-center gap-1.5 rounded-full px-3 py-1 text-xs'
              >
                {disciplineLabels[slug] ?? slug}
                <X size={11} />
              </button>
            ))}
            <button
              type='button'
              onClick={() => setParams({ skills: null })}
              className='text-muted-foreground hover:text-foreground px-2 text-xs'
            >
              clear
            </button>
          </div>
        )}

        {showSkillPicker ? (
          <div className='border-foreground/15 rounded-xl border border-dashed p-3'>
            <DisciplineSearch
              disciplines={disciplines}
              selected={activeSkills}
              maxResults={20}
              placeholder='Filter by skill…'
              onCancel={() => setShowSkillPicker(false)}
              onSelect={({ slug }) => {
                toggleSkill(slug);
                setShowSkillPicker(false);
              }}
            />
          </div>
        ) : (
          <button
            type='button'
            onClick={() => setShowSkillPicker(true)}
            className='text-muted-foreground hover:text-foreground text-xs underline underline-offset-4'
          >
            Filter by skill
          </button>
        )}
      </div>

      {/* --- spotlight ---
          Suppressed while filtering: a spotlight that ignores the active
          search reads as a result that does not match. */}
      {spotlight && !filter.search && !filter.favouritesOnly && !activeSkills.length && (
        <div className='mt-6'>
          <TalentSpotlight
            candidate={spotlight}
            disciplineLabels={disciplineLabels}
            onFavourite={() => favourite(spotlight)}
            onInvite={projects.length > 0 ? () => setInviting(spotlight) : undefined}
          />
        </div>
      )}

      {/* --- results --- */}
      {candidates.length === 0 ? (
        <div className='glass mt-8 rounded-2xl p-8 text-center sm:p-10'>
          <p className='text-muted-foreground text-sm'>
            {filter.favouritesOnly
              ? 'No favourites yet. Tap the heart on a creative to save them here.'
              : `No ${nouns.worker.many} match that. Try a broader search.`}
          </p>
        </div>
      ) : (
        <div
          className={cn(
            // Two across on the smallest screens: these are portraits, and one
            // per row turns a roster of 37 into a very long scroll.
            'mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4',
            navigating && 'opacity-60 transition-opacity',
          )}
        >
          {candidates.map((candidate) => (
            <TalentTile
              key={candidate.id}
              candidate={candidate}
              disciplineLabels={disciplineLabels}
              onFavourite={() => favourite(candidate)}
              onInvite={projects.length > 0 ? () => setInviting(candidate) : undefined}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className='mt-8 flex justify-center'>
          <button
            type='button'
            onClick={loadMore}
            disabled={loadingMore}
            className='glass hover:border-foreground/25 rounded-lg px-6 py-2.5 text-sm transition disabled:opacity-50'
          >
            {loadingMore ? 'Loading…' : `Show more ${nouns.worker.many}`}
          </button>
        </div>
      )}

      <InviteDialog candidate={inviting} projects={projects} onClose={() => setInviting(null)} />
    </div>
  );
}

/**
 * Pick an open role to invite a talent into.
 *
 * Roles whose discipline the talent already holds are marked, so the brand
 * can tell a natural fit from a stretch without opening the profile again.
 */
function InviteDialog({
  candidate,
  projects,
  onClose,
}: {
  candidate: TalentCandidate | null;
  projects: InvitableProject[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const invite = (roleId: string) => {
    if (!candidate) return;
    startTransition(async () => {
      const result = await inviteToRoleAction(roleId, candidate.id);
      if (result.success === true) {
        toast({
          title: 'Invitation sent',
          description: `${candidate.name || candidate.username} has been added to the project.`,
        });
        onClose();
        return;
      }
      toast({ title: 'Could not invite', description: result.error, variant: 'destructive' });
    });
  };

  return (
    <Dialog open={candidate !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='tropical glass border-foreground/10 max-w-md'>
        <DialogTitle>Invite {candidate?.name || candidate?.username}</DialogTitle>
        <DialogDescription className='text-muted-foreground text-sm'>
          Pick an open role. They join the project and get their own channel straight away.
        </DialogDescription>

        <div className='max-h-80 space-y-4 overflow-y-auto'>
          {projects.map((project) => (
            <div key={project.id}>
              <div className='text-muted-foreground mb-1.5 text-[11px] tracking-widest uppercase'>
                {project.name}
              </div>
              <div className='space-y-1'>
                {project.openRoles.map((role) => {
                  const fits = role.discipline
                    ? candidate?.disciplines.includes(role.discipline)
                    : false;
                  return (
                    <button
                      key={role.id}
                      type='button'
                      disabled={pending}
                      onClick={() => invite(role.id)}
                      className='border-foreground/10 hover:border-foreground/25 hover:bg-foreground/5 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition disabled:opacity-40'
                    >
                      <span className='truncate'>{role.title}</span>
                      {fits && (
                        <span className='bg-status-active/20 text-status-active shrink-0 rounded-full px-2 py-0.5 text-[10px]'>
                          match
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
