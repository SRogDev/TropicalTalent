'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Globe, Wand2 } from 'lucide-react';
import { TeamBuilder, type BuilderRole } from './team-builder';
import { splitBrief } from '@/modules/projects/brief-split';
import { formatPence, poundsToPence } from '@/lib/money';
import { createProjectAction } from '@/modules/projects/actions';
import { useToast } from '@/components/ui/toast';
import { useTenantName, useTenantNouns } from './tenant-context';
import type { Discipline } from '@/modules/skills/types';
import type { TalentCandidate } from '@/modules/talent/types';

/**
 * What each visibility choice actually means, in the brand's own terms.
 *
 * The three-way toggle is not self-explanatory — "both" in particular reads as
 * a setting rather than a workflow — so the choice is spelled out in one line
 * directly above the team, which is the thing the choice changes.
 *
 * Two things were hardcoded here and both were wrong on a white-label. "the
 * TropicalTalent community" named the wrong company on the customer's own domain, and a
 * brief on a white-label is posted to THEIR roster and never leaves it. And
 * "talent apply to them" is a word from one industry: a contractor platform
 * does not have talent, it has contractors, and its customers noticed.
 */
const visibilityBlurb = (
  community: string,
  workers: string,
): Record<'public' | 'private' | 'both', string> => ({
  public: `This is a public project. Every role is posted to the ${community} community so anyone there can apply to them.`,
  private: `This is a private project. You pick the ${workers} for each role yourself and it is never listed publicly.`,
  both: `This is a public & private project. You can specify roles and open the rest up for the ${community} community.`,
});

/**
 * Brief -> crew -> project, in one screen.
 *
 * The crew is proposed synchronously by splitBrief(), a deterministic rules
 * engine that runs in under a millisecond. There is no request in this path
 * and therefore no loading state: the crew appears on the same frame as the
 * click.
 */
export function BriefComposer({
  disciplines,
  candidatePool,
  roster,
  platformFeePct,
}: {
  disciplines: Discipline[];
  candidatePool: Record<string, TalentCandidate[]>;
  roster: TalentCandidate[];
  /**
   * The tenant's fee, resolved server-side by the page.
   *
   * Display only, like every other money figure on the client — the same
   * number is read again from tropical_tenants inside tropical_create_project, and
   * the role amounts are checked against it there. Passing it in rather than
   * importing a constant is what stops a white-label on 22% being shown 15%.
   */
  platformFeePct: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const community = useTenantName();
  const nouns = useTenantNouns();
  const blurbs = useMemo(
    () => visibilityBlurb(community, nouns.worker.many),
    [community, nouns.worker.many],
  );

  const [brief, setBrief] = useState('');
  const [name, setName] = useState('');
  const [budgetInput, setBudgetInput] = useState('10000');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'both'>('public');
  const [roles, setRoles] = useState<BuilderRole[] | null>(null);

  const budget = useMemo(() => {
    try {
      return poundsToPence(budgetInput);
    } catch {
      return 0;
    }
  }, [budgetInput]);

  // A public brief is an open call - the brand is posting roles for anyone to
  // apply to, not pre-selecting who fills them. Private and "both" projects
  // still get the usual candidate proposal.
  const isPublic = visibility === 'public';

  const generate = useCallback(() => {
    if (!brief.trim()) return;
    const { roles: proposed } = splitBrief(brief);

    setRoles(
      proposed.map((r, i) => ({
        key: `r_${i}_${r.discipline}`,
        title: r.title,
        discipline: r.discipline,
        percentage: r.percentage,
        candidateIndex: 0,
        pinnedUserId: null,
        // Leave the role open when nobody holds that discipline yet, rather
        // than showing an empty seat that looks broken - and always leave it
        // open for a public brief, since it is posted for applications.
        unassigned: isPublic || (candidatePool[r.discipline] ?? []).length === 0,
      })),
    );

    if (!name.trim()) {
      setName(
        brief
          .split(/[.,\n]/)[0]
          .slice(0, 60)
          .trim(),
      );
    }
  }, [brief, name, candidatePool, isPublic]);

  const submit = useCallback(() => {
    if (!roles?.length || !name.trim() || budget <= 0) return;

    startTransition(async () => {
      const result = await createProjectAction({
        name: name.trim(),
        brief: brief.trim(),
        budget,
        visibility,
        deadline: null,
        roles: roles.map((r) => {
          const pool = r.discipline ? (candidatePool[r.discipline] ?? []) : [];
          // A public project has no pre-assigned crew, full stop. `unassigned`
          // is only stamped when the team is built, so a role built under
          // private/both and then switched to public still carries a
          // candidate the builder no longer shows — and the RPC would put
          // that person in the group chat.
          const assigned =
            isPublic || r.unassigned
              ? null
              : (r.pinnedUserId ?? pool[r.candidateIndex % Math.max(1, pool.length)]?.id ?? null);

          return {
            title: r.title,
            discipline: r.discipline,
            percentage: r.percentage,
            assigned_user_id: assigned,
          };
        }),
      });

      if (result.success === true) {
        router.push(`/projects/${result.data.projectId}`);
        return;
      }

      toast({
        title: 'Could not create the project',
        description: result.error,
        variant: 'destructive',
      });
    });
  }, [roles, name, budget, brief, visibility, isPublic, candidatePool, router, toast]);

  return (
    <div className='mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6 sm:py-10'>
      <header>
        <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
          What are we <span className='text-gradient-brand'>making</span>?
        </h1>
        {/* Named the wrong company on every white-label. The tenant IS the
            thing building the team here — that is what they are paying us
            for — so it says so. */}
        <p className='text-muted-foreground mt-2 text-sm'>
          Describe the work. {community} builds the team and splits the budget.
        </p>
      </header>

      <div className='glass rounded-2xl p-1'>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder='Launch film for a perfume drop - moody, neon-noir, 60 seconds…'
          rows={4}
          aria-label='Project brief'
          className='placeholder:text-muted-foreground/60 w-full resize-none bg-transparent px-4 py-4 text-base focus:outline-none sm:px-5'
        />

        <div className='border-foreground/10 flex flex-wrap items-center gap-2 border-t p-3 sm:gap-3'>
          <label className='bg-sunken flex items-center gap-2 rounded-lg px-3 py-2'>
            <span className='text-muted-foreground text-xs'>Budget</span>
            <span className='text-muted-foreground'>£</span>
            <input
              inputMode='decimal'
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className='w-20 bg-transparent text-sm font-medium tabular-nums focus:outline-none sm:w-24'
              aria-label='Project budget in pounds'
            />
          </label>

          <div
            className='border-foreground/10 bg-sunken flex items-center rounded-lg border p-0.5'
            role='group'
            aria-label='Brief visibility'
          >
            {(['public', 'private', 'both'] as const).map((v) => {
              const Icon = v === 'public' ? Globe : v === 'private' ? EyeOff : Eye;
              return (
                <button
                  key={v}
                  type='button'
                  onClick={() => setVisibility(v)}
                  aria-pressed={visibility === v}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs capitalize transition sm:px-3 ${
                    visibility === v
                      ? 'bg-gradient-brand text-on-brand'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon size={11} />
                  {v}
                </button>
              );
            })}
          </div>

          <div className='hidden flex-1 sm:block' />

          <button
            type='button'
            onClick={generate}
            disabled={!brief.trim()}
            className='bg-gradient-brand glow text-on-brand flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-40 sm:w-auto'
          >
            <Wand2 size={14} /> Build team
          </button>
        </div>
      </div>

      <p className='text-muted-foreground -mt-4 text-center text-xs sm:text-sm'>
        {blurbs[visibility]}
      </p>

      {roles && (
        <>
          <TeamBuilder
            roles={roles}
            onRolesChange={setRoles}
            budget={budget}
            platformFeePct={platformFeePct}
            disciplines={disciplines}
            candidatePool={candidatePool}
            roster={roster}
            publicMode={isPublic}
          />

          <div className='glass flex flex-col gap-3 rounded-xl p-4 md:flex-row md:items-center'>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Project name'
              aria-label='Project name'
              className='placeholder:text-muted-foreground/60 flex-1 bg-transparent text-base font-medium focus:outline-none'
            />
            <button
              type='button'
              onClick={submit}
              disabled={pending || !name.trim() || roles.length === 0 || budget <= 0}
              className='bg-gradient-brand glow text-on-brand flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium disabled:opacity-40'
            >
              {pending
                ? 'Creating…'
                : isPublic
                  ? `Post project to ${community} ${nouns.worker.many}`
                  : 'Set up project'}
              {!pending && <ArrowRight size={14} />}
            </button>
          </div>

          {budget > 0 && (
            <p className='text-muted-foreground text-center text-xs'>
              {formatPence(budget)} total · escrow is authorised on the next screen
            </p>
          )}
        </>
      )}
    </div>
  );
}
