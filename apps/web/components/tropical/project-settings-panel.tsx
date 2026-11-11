'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Lock, Settings, Trash2, UserMinus } from 'lucide-react';
import { TalentAvatar } from './talent-avatar';
import { useToast } from '@/components/ui/toast';
import {
  deleteProjectAction,
  removeMemberAction,
  requestProjectDeletionAction,
  withdrawProjectDeletionAction,
} from '@/modules/projects/actions';
import type { ProjectDeleteRequest, Workspace } from '@/modules/projects/types';
import { useTenantNouns } from './tenant-context';

/**
 * Project settings, opened from the gear icon in Project Admin.
 *
 * Both destructive actions are disabled once escrow is paid. That is enforced
 * in three places on purpose: here (so the buttons are visibly dead and say
 * why), in the server actions, and in the RPCs themselves. The UI state is a
 * courtesy; the RPC is the rule.
 */
export function ProjectSettingsPanel({
  workspace,
  locked,
  deletable,
  deleteRequest = null,
  lockedNote = 'Escrow is funded. Members and the project itself are locked - money is committed against this crew. Use the complaint form in a role\u2019s channel to change things.',
  profilesById,
}: {
  workspace: Workspace;
  /**
   * Whether the money behind this project is committed.
   *
   * A pot commits when escrow funds; a retainer when its card is saved and the
   * engagement starts. Passing it in rather than reading escrow here is what
   * stops a retainer being told "escrow is funded" before anyone has paid.
   */
  locked: boolean;
  /**
   * Whether the project can still be removed outright.
   *
   * Usually the inverse of `locked`, but not always: a retainer paused after a
   * run of failed charges is negotiable again (nothing is committed for the
   * period ahead) and still must not be deleted, because periods behind it
   * have already been charged and paid.
   */
  deletable?: boolean;
  /** The owner's own latest deletion request, if they have made one. */
  deleteRequest?: ProjectDeleteRequest | null;
  lockedNote?: string;
  profilesById: Record<
    string,
    { name: string | null; username: string | null; avatar: string | null }
  >;
}) {
  const nouns = useTenantNouns();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [reason, setReason] = useState('');

  const crew = workspace.members.filter((m) => m.member_role === 'creative');

  const removeMember = (userId: string) => {
    startTransition(async () => {
      const result = await removeMemberAction(workspace.id, userId);
      if (result.success !== true) {
        toast({ title: 'Could not remove', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Removed', description: 'Their role is open again.' });
      router.refresh();
    });
  };

  const deleteProject = () => {
    startTransition(async () => {
      const result = await deleteProjectAction(workspace.id);
      if (result.success !== true) {
        toast({ title: 'Could not delete', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Project deleted' });
      router.push('/projects');
    });
  };

  const canDelete = deletable ?? !locked;
  const awaitingDecision = deleteRequest?.status === 'open';

  const requestDeletion = () => {
    startTransition(async () => {
      const result = await requestProjectDeletionAction({
        projectId: workspace.id,
        reason: reason.trim() || undefined,
      });
      if (result.success !== true) {
        toast({ title: 'Could not send that', description: result.error, variant: 'destructive' });
        return;
      }
      setRequesting(false);
      setReason('');
      toast({
        title: 'Request sent',
        description: 'An admin will review it. Nothing has been removed.',
      });
      router.refresh();
    });
  };

  const withdrawRequest = () => {
    if (!deleteRequest) return;
    startTransition(async () => {
      const result = await withdrawProjectDeletionAction(deleteRequest.id);
      if (result.success !== true) {
        toast({
          title: 'Could not withdraw it',
          description: result.error,
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Request withdrawn' });
      router.refresh();
    });
  };

  return (
    <div className='glass rounded-2xl p-5'>
      <h3 className='flex items-center gap-2 text-sm font-semibold'>
        <Settings size={14} className='text-accent' />
        Project settings
      </h3>

      {locked && (
        <div className='border-status-pending/30 bg-status-pending/10 text-status-pending mt-4 flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs'>
          <Lock size={14} className='mt-px shrink-0' />
          <span>{lockedNote}</span>
        </div>
      )}

      {/* --- crew --- */}
      <section className='mt-5'>
        <h4 className='text-muted-foreground text-[10px] tracking-widest uppercase'>
          {nouns.worker.many}
        </h4>

        {crew.length === 0 ? (
          <p className='text-muted-foreground/70 mt-2 text-xs'>No talent on the project yet.</p>
        ) : (
          <div className='mt-2 space-y-1'>
            {crew.map((member) => {
              const profile = profilesById[member.user_id] ?? null;
              const role = workspace.roles.find((r) => r.id === member.role_id);

              return (
                <div
                  key={member.user_id}
                  className='border-foreground/10 bg-sunken flex items-center gap-3 rounded-lg border px-3 py-2'
                >
                  <TalentAvatar candidate={profile} size={28} />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-xs font-medium'>
                      {profile?.name || profile?.username || 'Talent'}
                    </div>
                    {role && (
                      <div className='text-muted-foreground truncate text-[11px]'>{role.title}</div>
                    )}
                  </div>
                  <button
                    type='button'
                    onClick={() => removeMember(member.user_id)}
                    disabled={locked || pending}
                    title={
                      locked
                        ? 'The money is committed - members can no longer be removed'
                        : 'Remove from project'
                    }
                    aria-label={`Remove ${profile?.name || profile?.username || 'member'}`}
                    className='text-muted-foreground hover:bg-foreground/10 hover:text-foreground grid h-9 w-9 shrink-0 place-items-center rounded-md transition disabled:pointer-events-none disabled:opacity-30'
                  >
                    <UserMinus size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* --- danger zone --- */}
      <section className='border-foreground/10 mt-6 border-t pt-5'>
        <h4 className='text-muted-foreground text-[10px] tracking-widest uppercase'>
          Remove project
        </h4>
        <p className='text-muted-foreground mt-1 text-xs'>
          {canDelete
            ? 'Takes it out of your workspace and everyone else\u2019s. The record is archived rather than erased, so anything already agreed can still be produced later. This cannot be undone.'
            : 'This project has begun, so removing it is an admin decision. Everything on it - the contracts, the messages, the payment record - belongs to everyone working here, not just to you.'}
        </p>

        {/* Once the money is committed the owner asks instead of acting. See
            migration 044: a live workspace is a record both parties rely on,
            and a cascade at one party's click is how a dispute starts. */}
        {!canDelete ? (
          awaitingDecision ? (
            <div className='border-foreground/10 bg-sunken mt-3 rounded-lg border px-3 py-2.5'>
              <p className='text-xs font-medium'>Deletion requested</p>
              <p className='text-muted-foreground mt-0.5 text-[11px]'>
                Sent {new Date(deleteRequest.createdAt).toLocaleDateString('en-GB')}. An admin will
                review it - nothing has been removed.
              </p>
              <button
                type='button'
                onClick={withdrawRequest}
                disabled={pending}
                className='text-accent mt-1.5 text-[11px] font-medium hover:underline disabled:opacity-40'
              >
                {pending ? 'Withdrawing…' : 'Withdraw the request'}
              </button>
            </div>
          ) : requesting ? (
            <div className='mt-3 space-y-2'>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder='Why should this be removed? Optional, but it is what the admin decides on.'
                className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-lg border px-3 py-2 text-xs focus:outline-none'
              />
              <div className='flex flex-wrap gap-2'>
                <button
                  type='button'
                  onClick={requestDeletion}
                  disabled={pending}
                  className='bg-gradient-brand text-on-brand flex-1 rounded-lg px-3 py-2.5 text-xs font-medium disabled:opacity-40'
                >
                  {pending ? 'Sending…' : 'Send the request'}
                </button>
                <button
                  type='button'
                  onClick={() => {
                    setReason('');
                    setRequesting(false);
                  }}
                  disabled={pending}
                  className='text-muted-foreground border-foreground/10 hover:text-foreground rounded-lg border px-4 py-2.5 text-xs'
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {deleteRequest?.status === 'rejected' && (
                <p className='text-muted-foreground mt-3 text-[11px]'>
                  A previous request was declined
                  {deleteRequest.resolution ? `: ${deleteRequest.resolution}` : '.'}
                </p>
              )}
              <button
                type='button'
                onClick={() => setRequesting(true)}
                className='text-muted-foreground border-foreground/10 hover:text-foreground mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition'
              >
                <Trash2 size={13} /> Request deletion
              </button>
            </>
          )
        ) : confirmingDelete ? (
          <div className='mt-3 flex flex-wrap gap-2'>
            <button
              type='button'
              onClick={deleteProject}
              disabled={pending}
              className='bg-destructive text-destructive-foreground flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium disabled:opacity-40'
            >
              <AlertTriangle size={13} />
              {pending ? 'Removing…' : `Yes, remove “${workspace.name}”`}
            </button>
            <button
              type='button'
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
              className='text-muted-foreground border-foreground/10 hover:text-foreground rounded-lg border px-4 py-2.5 text-xs'
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type='button'
            onClick={() => setConfirmingDelete(true)}
            className='text-destructive border-destructive/30 hover:bg-foreground/[0.04] mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition disabled:pointer-events-none disabled:opacity-30'
          >
            <Trash2 size={13} /> Remove this project
          </button>
        )}
      </section>
    </div>
  );
}
