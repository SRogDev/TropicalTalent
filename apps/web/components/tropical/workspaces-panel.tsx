'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Eye } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { leaveWorkspaceAction } from '@/modules/identity/actions';
import type { MyWorkspace } from '@/modules/identity/queries';

/**
 * Which sites this account belongs to, what their admins can see, and the way
 * out.
 *
 * Three disclosures that were all true and none of which were made anywhere:
 *
 *   * a workspace's own admins read their members' email address, last
 *     sign-in, completed jobs, total earnings and the full written detail of
 *     any complaint they raise. Where those members are a client's
 *     contractors, that is their employer reading it.
 *   * a public white-label enrols its people into classic TropicalTalent as well, so a
 *     profile created for one company's work is visible to Clients across the
 *     marketplace.
 *   * there was no way to undo either.
 *
 * The list is the disclosure. Saying "administrators may access your data" in
 * a policy nobody opens is not the same as showing someone the three names and
 * what each of them can see.
 */
export function WorkspacesPanel({ workspaces }: { workspaces: MyWorkspace[] }) {
  if (workspaces.length === 0) return null;

  return (
    <section className='mt-7'>
      <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
        Where your profile appears
      </h2>

      <div className='glass divide-foreground/5 divide-y rounded-2xl'>
        {workspaces.map((w) => (
          <WorkspaceRow key={w.tenantId} workspace={w} canLeave={workspaces.length > 1} />
        ))}
      </div>

      <p className='text-muted-foreground mt-2.5 text-xs'>
        Leaving a workspace hides your profile from it. Work you have already done there keeps its
        contract and payment history, because the people you worked with need it.
      </p>
    </section>
  );
}

function WorkspaceRow({ workspace, canLeave }: { workspace: MyWorkspace; canLeave: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [blocker, setBlocker] = useState<string | null>(null);

  const leave = () => {
    setBlocker(null);
    startTransition(async () => {
      const result = await leaveWorkspaceAction(workspace.tenantId);
      if (result.success !== true) {
        setBlocker(result.error);
        return;
      }
      setConfirming(false);
      toast({ title: `You have left ${workspace.name}` });
      router.refresh();
    });
  };

  return (
    <div className='p-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='text-muted-foreground bg-foreground/5 grid h-9 w-9 shrink-0 place-items-center rounded-lg'>
            <Building2 size={15} />
          </span>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-sm font-medium'>{workspace.name}</span>
              {workspace.isCurrent && (
                <span className='text-muted-foreground border-foreground/15 rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase'>
                  You are here
                </span>
              )}
            </div>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {workspace.isClassic
                ? 'Clients across the TropicalTalent marketplace can find your profile here.'
                : 'Members and clients of this workspace can find your profile here.'}
            </p>
          </div>
        </div>

        {canLeave && !confirming && (
          <button
            type='button'
            onClick={() => setConfirming(true)}
            className='text-muted-foreground hover:text-foreground border-foreground/10 hover:border-foreground/25 shrink-0 rounded-lg border px-3 py-1.5 text-xs transition'
          >
            Leave
          </button>
        )}
      </div>

      {/* The disclosure proper. Rendered for every workspace, including
          classic — TropicalTalent's own operators can read the same fields, and a panel
          that named only other people's admins would be quietly flattering. */}
      <div className='text-muted-foreground border-foreground/5 mt-3 flex gap-2.5 border-t pt-3 text-xs'>
        <span className='mt-0.5 shrink-0'>
          <Eye size={13} />
        </span>
        {/* "The administrators of X" rather than "X's administrators": the
            name is a tenant's, so it can end in an s — "Acme Contractors's"
            — and there is no possessive form that is right for every name a
            customer might choose. Sidestepping it beats special-casing it. */}
        <p>
          {workspace.hasOwnAdmins ? `The administrators of ${workspace.name}` : 'The TropicalTalent team'}{' '}
          can see your name, email address, when you joined, when you last signed in, the projects
          you are on, what you have earned here, and the detail of any complaint you raise. They
          cannot see your activity in other workspaces.
        </p>
      </div>

      {confirming && (
        <div className='border-foreground/10 mt-3 rounded-xl border p-4'>
          <p className='text-xs'>
            Leave <span className='font-medium'>{workspace.name}</span>? Your profile stops
            appearing there and its clients can no longer find or hire you.
          </p>

          {blocker && (
            <p className='border-destructive/25 bg-destructive/5 text-destructive mt-3 rounded-lg border px-3 py-2 text-xs'>
              {blocker}
            </p>
          )}

          <div className='mt-3 flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => {
                setConfirming(false);
                setBlocker(null);
              }}
              disabled={pending}
              className='glass text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5 text-xs disabled:opacity-40'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={leave}
              disabled={pending}
              className='bg-foreground text-background rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40'
            >
              {pending ? 'Leaving…' : 'Leave workspace'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
