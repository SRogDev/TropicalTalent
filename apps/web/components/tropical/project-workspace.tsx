'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronLeft,
  Hash,
  Info,
  ListChecks,
  Lock,
  Send,
  Settings,
  Users,
} from 'lucide-react';
import { useProjectRealtime } from '@/hooks/use-project-realtime';
import { useProjectLive } from '@/hooks/use-project-live';
import { markChannelReadAction } from '@/modules/projects/actions';
import { EscrowBanner } from './escrow-banner';
import { RetainerAdminPanel } from './retainer-admin-panel';
import { ProjectStatusPin } from './project-status-pin';
import { TalentAvatar } from './talent-avatar';
import { ContractPanel } from './contract-panel';
import { DeliverablesForm } from './deliverables-form';
import { RoleContractPanel } from './role-contract-panel';
import { RetainerPanel } from './retainer-panel';
import type { BillingProfile, RecurringTerms, RolePeriod } from '@/modules/recurring/types';
import { DeliveryPanel } from './delivery-panel';
import { ApplicantsPanel } from './applicants-panel';
import { ProjectSettingsPanel } from './project-settings-panel';
import { FeedbackPanel } from './feedback-panel';
import { formatDayLabel, formatMessageTime, cn } from '@/lib/utils';
import { formatPence } from '@/lib/money';
import type { ChannelMessage, Deliverable, RoleContract } from '@/modules/chat/types';
import type { ProjectDeleteRequest, Workspace } from '@/modules/projects/types';
import type { Applicant } from '@/modules/briefs/types';

/**
 * The project workspace: channel list, message thread, and the side panels.
 *
 * Every channel's messages are server-rendered and handed over up front, and
 * one realtime subscription covers the whole project. Switching channels is a
 * state read — no request, no spinner.
 *
 * Channel roles:
 *   Project Admin  brand only. Escrow, deliverables, applicants, settings.
 *   Group Chat     everyone, once escrow is funded.
 *   DM             the brand and one talent. Their contract lives here.
 */

type Panel = 'none' | 'deliverables' | 'applicants' | 'settings' | 'split';

export function ProjectWorkspaceView({
  workspace,
  initialMessages,
  currentUserId,
  isBrand,
  initialChannelId,
  profilesById,
  deliverables,
  roleContracts,
  applicants,
  disciplineLabels,
  escrowPaid,
  unreadByChannel,
  feedback,
  favouriteIds,
  periods,
  recurringTerms,
  billing,
  deleteRequest,
}: {
  workspace: Workspace;
  initialMessages: Record<string, ChannelMessage[]>;
  currentUserId: string;
  isBrand: boolean;
  initialChannelId: string;
  profilesById: Record<
    string,
    { name: string | null; username: string | null; avatar: string | null }
  >;
  deliverables: Deliverable[];
  roleContracts: RoleContract[];
  applicants: Applicant[];
  disciplineLabels: Record<string, string>;
  escrowPaid: boolean;
  /** channel id -> unread count, server-rendered. */
  unreadByChannel: Record<string, number>;
  /** talent id -> the brand's existing recommend verdict, brand-only. */
  feedback: Record<string, boolean>;
  /** talent ids the brand already favourites, brand-only. */
  favouriteIds: string[];
  /** Every period on this project. Empty for a fixed-price project. */
  periods: RolePeriod[];
  /** role id -> its schedule, for recurring roles only. */
  recurringTerms: Record<string, RecurringTerms>;
  /** The brand's saved card for this workspace. Empty for a talent, who has
   *  no business knowing whether their client's card is on file. */
  billing: BillingProfile;
  /** The owner's own latest request to have this project removed. */
  deleteRequest: ProjectDeleteRequest | null;
}) {
  // Project Admin is brand-only and deliverables are what the whole crew
  // works to, so that panel opens by default there rather than needing a
  // click every time the channel opens.
  const botChannelId = workspace.channels.find((c) => c.type === 'bot')?.id;

  // The project's retainer role, if it has one. A retainer project carries
  // exactly one recurring role today (tropical_create_retainer_project makes one
  // and nothing else adds a second), so the first key is the whole answer.
  const retainerRole = Object.keys(recurringTerms)[0];
  const retainerTerms = retainerRole ? recurringTerms[retainerRole] : null;
  const isRetainer = workspace.kind === 'retainer';

  // Where the retainer's contract lives — the DM the set-up checklist links to.
  const retainerDmChannelId =
    workspace.channels.find((c) => c.type === 'dm' && c.role_id === retainerRole)?.id ?? null;

  /**
   * Whether the group channel is open, and whether contracts are still
   * negotiable — the two questions a pot answers with "has escrow been paid".
   *
   * Phase 4: for a Cubora operation the "paid" side is now Cubora
   * operations activating the workspace (negotiation accepted →
   * activateProjectAction, migration 056), not a payment event — there
   * is no payment rail in the MVP, and escrow funding is stubbed to
   * always refuse, so nothing here can unlock on escrow alone.
   * `isEscrowPaid` is still the predicate (it is true when the project
   * status is active/completed), but the transition that makes it true
   * is the operations decision, recorded in the negotiation's audit trail.
   *
   * A retainer project is 'active' from creation (029), so isEscrowPaid is
   * true for it before anybody has paid anything. Left alone, that opened the
   * group channel on day zero and locked the contract in the same breath, which
   * is why a retainer's contract could never be agreed. Both now read the
   * engagement's own state, matching what migration 043 enforces server-side.
   */
  const retainerActivated = Boolean(retainerTerms?.activatedAt);
  const groupOpen = isRetainer ? retainerActivated : escrowPaid;
  const contractsLocked = isRetainer ? !retainerTerms?.pausedAt : escrowPaid;

  const [activeId, setActiveId] = useState(initialChannelId);
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState<Panel>(
    initialChannelId === botChannelId ? 'deliverables' : 'none',
  );
  // Below lg the rail and the thread share the screen; this decides which.
  const [showRail, setShowRail] = useState(false);
  /**
   * Set when the set-up checklist sends the brand to the contract.
   *
   * RoleContractPanel is collapsed by default — an expanded contract pushes
   * the conversation off screen every time a DM is opened — so a "add the
   * contract" link that merely switched channel would land on a collapsed
   * header and look like it had done nothing.
   */
  const [expandContract, setExpandContract] = useState(false);

  const { getMessages, sendMessage, connected } = useProjectRealtime({
    projectId: workspace.id,
    initialMessages,
    currentUserId,
  });

  // Contracts, deliverables, role status and escrow all re-render live.
  useProjectLive(workspace.id);

  /**
   * Unread badges, seeded from the server and cleared locally on open.
   *
   * Clearing locally as well as server-side matters: markChannelReadAction is
   * a round trip, and the badge on the channel you are reading has to go the
   * moment you click it, not a beat later.
   */
  const [unread, setUnread] = useState(unreadByChannel);
  useEffect(() => setUnread(unreadByChannel), [unreadByChannel]);

  const openChannel = useCallback(
    (channelId: string) => {
      setActiveId(channelId);
      setPanel(channelId === botChannelId ? 'deliverables' : 'none');
      setShowRail(false);
      setExpandContract(false);
      setUnread((current) => (current[channelId] ? { ...current, [channelId]: 0 } : current));
      void markChannelReadAction(channelId);
    },
    [botChannelId],
  );

  /**
   * The conversation opens itself the moment the engagement starts.
   *
   * Activation can arrive from three places — the return from payment provider, the
   * webhook landing under a refresh, or a saved card being reused with no
   * Checkout at all — so this watches the state rather than hanging off any
   * one of them. Seeded from the first render so arriving at an already-live
   * engagement does not pull the reader off whatever channel they asked for.
   *
   * The DM, not the group channel: a retainer is one brand and one person, so
   * it no longer offers one. Sending them to the room where the other party
   * actually is was always the point.
   */
  const wasActivated = useRef(retainerActivated);
  useEffect(() => {
    if (retainerActivated === wasActivated.current) return;
    wasActivated.current = retainerActivated;
    if (!retainerActivated || !retainerDmChannelId) return;
    openChannel(retainerDmChannelId);
  }, [retainerActivated, retainerDmChannelId, openChannel]);

  // The channel showing on arrival is being read too — otherwise a deep link
  // into a channel leaves its own badge lit.
  const markedInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || markedInitial.current === activeId) return;
    markedInitial.current = activeId;
    setUnread((current) => (current[activeId] ? { ...current, [activeId]: 0 } : current));
    void markChannelReadAction(activeId);
  }, [activeId]);

  const active = workspace.channels.find((c) => c.id === activeId) ?? workspace.channels[0];
  const locked = active?.type === 'group' && !groupOpen;
  const messages = getMessages(active?.id ?? '');

  const pendingApplicants = applicants.filter((a) => a.status === 'pending').length;

  const orderedChannels = useMemo(
    () =>
      [...workspace.channels].sort(
        (a, b) =>
          ({ bot: 0, group: 1, dm: 2 })[a.type] - { bot: 0, group: 1, dm: 2 }[b.type] ||
          a.name.localeCompare(b.name),
      ),
    [workspace.channels],
  );

  // Scroll to the newest message on channel switch and on arrival. `messages`
  // by identity rather than length so an edited-in-place list still lands.
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, activeId, panel]);

  const send = async () => {
    const body = draft.trim();
    if (!body || locked || !active) return;
    setDraft('');
    try {
      await sendMessage(active.id, body);
    } catch {
      setDraft(body); // put it back rather than losing what they typed
    }
  };

  // The DM's role and its contract — the panel below the thread.
  const activeRole = active?.role_id
    ? (workspace.roles.find((r) => r.id === active.role_id) ?? null)
    : null;
  const activeContract = activeRole
    ? (roleContracts.find((c) => c.role_id === activeRole.id) ?? null)
    : null;

  return (
    <div className='flex h-full min-h-0'>
      {/* ---- channel rail ---- */}
      <div
        className={cn(
          'border-foreground/10 w-full shrink-0 flex-col border-r lg:flex lg:w-52',
          showRail ? 'flex' : 'hidden',
        )}
      >
        <div className='px-4 py-3'>
          <div className='truncate text-sm font-semibold'>{workspace.name}</div>
          <div className='text-muted-foreground text-[11px] tabular-nums'>
            {/* A talent should not read the pot off the sidebar of every
                project they are on — and a retainer has no pot at all, so
                `budget` is 0 and printing it told the brand their engagement
                was worth nothing. The rate is the equivalent fact, and it
                needs its cadence to mean anything. */}
            {isBrand
              ? isRetainer
                ? `${formatPence(retainerTerms?.periodAmount ?? 0, workspace.currency)} per ${
                    retainerTerms?.period === 'weekly' ? 'week' : 'month'
                  }`
                : `${formatPence(workspace.budget, workspace.currency)} · ${workspace.roles.length} roles`
              : `${workspace.roles.length} role${workspace.roles.length === 1 ? '' : 's'}`}
          </div>
        </div>

        <div className='min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2'>
          {orderedChannels.map((channel) => {
            const Icon = channel.type === 'bot' ? Bot : channel.type === 'group' ? Hash : null;
            const isLocked = channel.type === 'group' && !groupOpen;
            const role = workspace.roles.find((r) => r.id === channel.role_id);

            return (
              <button
                key={channel.id}
                type='button'
                onClick={() => openChannel(channel.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs transition',
                  channel.id === active?.id
                    ? 'bg-foreground/10 text-foreground'
                    : (unread[channel.id] ?? 0) > 0
                      ? 'text-foreground hover:bg-foreground/5 font-semibold'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                {Icon ? (
                  <Icon size={12} className={channel.type === 'bot' ? 'text-accent' : ''} />
                ) : (
                  <TalentAvatar candidate={role?.assignee ?? null} size={16} />
                )}
                <span className='flex-1 truncate text-left'>{channel.name}</span>
                {channel.type === 'bot' && pendingApplicants > 0 && (
                  <span className='bg-accent text-accent-foreground rounded-full px-1.5 text-[9px] font-semibold'>
                    {pendingApplicants}
                  </span>
                )}
                {channel.id !== active?.id && (unread[channel.id] ?? 0) > 0 && (
                  <span className='bg-accent h-1.5 w-1.5 shrink-0 rounded-full' />
                )}
                {isLocked && <Lock size={10} className='text-status-pending' />}
              </button>
            );
          })}
        </div>

        {isBrand && !isRetainer && (
          <div className='p-3'>
            <button
              type='button'
              onClick={() => setPanel((p) => (p === 'split' ? 'none' : 'split'))}
              className='text-muted-foreground border-foreground/10 hover:text-foreground flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs'
            >
              <Users size={13} /> {panel === 'split' ? 'Hide' : 'View'} budget split
            </button>
          </div>
        )}
      </div>

      {/* ---- thread ---- */}
      <div className={cn('min-w-0 flex-1 flex-col', showRail ? 'hidden lg:flex' : 'flex')}>
        <header className='border-foreground/10 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-5'>
          <div className='flex min-w-0 items-center gap-2'>
            <button
              type='button'
              onClick={() => setShowRail(true)}
              aria-label='Show channels'
              className='text-muted-foreground hover:text-foreground grid h-9 w-9 shrink-0 place-items-center rounded-lg lg:hidden'
            >
              <ChevronLeft size={16} />
            </button>
            {active?.type === 'bot' && <Bot size={15} className='text-accent shrink-0' />}
            <div className='min-w-0'>
              <div className='truncate text-sm font-semibold'>{active?.name}</div>
              <div className='text-muted-foreground text-[11px]'>
                {active?.type === 'group'
                  ? 'Everyone on the project'
                  : active?.type === 'dm'
                    ? 'Private'
                    : 'Brand only'}
              </div>
            </div>
          </div>

          <div className='flex shrink-0 items-center gap-1'>
            {/* Updates and settings, per the brief — next to the composer's
                send button conceptually, but placed in the header so they do
                not move when the keyboard opens on mobile. */}
            {/* Deliverables are what the whole crew is working to, so the
                control belongs on the group channel and each creative's own
                DM too — read-only everywhere but Project Admin, since only
                the brand may change scope, and only from there. */}
            {(active?.type === 'group' ||
              active?.type === 'dm' ||
              (isBrand && active?.type === 'bot')) && (
              <HeaderButton
                icon={<ListChecks size={15} />}
                label={
                  isBrand && active?.type === 'bot' ? 'Deliverables' : 'Deliverables (view only)'
                }
                active={panel === 'deliverables'}
                badge={active?.type === 'group' ? deliverables.length : undefined}
                onClick={() => setPanel((p) => (p === 'deliverables' ? 'none' : 'deliverables'))}
              />
            )}

            {isBrand && active?.type === 'bot' && (
              <>
                <HeaderButton
                  icon={<Info size={15} />}
                  label={
                    pendingApplicants > 0
                      ? `${pendingApplicants} new application${pendingApplicants === 1 ? '' : 's'}`
                      : 'Applications'
                  }
                  active={panel === 'applicants'}
                  badge={pendingApplicants}
                  onClick={() => setPanel((p) => (p === 'applicants' ? 'none' : 'applicants'))}
                />
                <HeaderButton
                  icon={<Settings size={15} />}
                  label='Project settings'
                  active={panel === 'settings'}
                  onClick={() => setPanel((p) => (p === 'settings' ? 'none' : 'settings'))}
                />
              </>
            )}
            <span
              className={`ml-1 h-1.5 w-1.5 rounded-full ${connected ? 'bg-status-active' : 'bg-status-cancelled'}`}
              title={connected ? 'Live' : 'Reconnecting'}
            />
          </div>
        </header>

        {panel === 'split' && (
          <ContractPanel workspace={workspace} isBrand={isBrand} funded={escrowPaid} />
        )}

        {(active?.type === 'group' || active?.type === 'bot' || active?.type === 'dm') && (
          <ProjectStatusPin status={workspace.status} deadlineDate={workspace.deadline_date} />
        )}

        <div
          ref={threadRef}
          className='relative min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5'
        >
          {/* Project Admin is the brand's screen, and a retainer's version of
              it is a different screen: per-period money instead of a pot, a
              set-up checklist instead of an escrow prompt, and the card as its
              last step. EscrowBanner rendered here showed a retainer £0 across
              the board and called it "Escrow secured". */}
          {active?.type === 'bot' &&
            (isRetainer && retainerRole && retainerTerms ? (
              isBrand && (
                <RetainerAdminPanel
                  projectId={workspace.id}
                  roleId={retainerRole}
                  roleTitle={
                    workspace.roles.find((r) => r.id === retainerRole)?.title ?? 'Retainer'
                  }
                  terms={retainerTerms}
                  periods={periods}
                  currency={workspace.currency}
                  platformFeePct={workspace.platform_fee_pct}
                  billing={billing}
                  contract={roleContracts.find((c) => c.role_id === retainerRole) ?? null}
                  deliverablesCount={deliverables.length}
                  contractChannelId={retainerDmChannelId}
                  onOpenContract={() => {
                    if (!retainerDmChannelId) return;
                    openChannel(retainerDmChannelId);
                    setExpandContract(true);
                  }}
                  onOpenDeliverables={() => setPanel('deliverables')}
                />
              )
            ) : (
              <EscrowBanner
                workspace={workspace}
                isBrand={isBrand}
                funded={escrowPaid}
                roleContracts={roleContracts}
                deliverablesCount={deliverables.length}
                onOpenDeliverables={() => setPanel('deliverables')}
              />
            ))}

          {active?.type === 'bot' && isBrand && workspace.status === 'completed' && (
            <FeedbackPanel workspace={workspace} feedback={feedback} favouriteIds={favouriteIds} />
          )}

          {panel === 'deliverables' && (
            <DeliverablesForm
              projectId={workspace.id}
              deliverables={deliverables}
              // A retainer has no group channel any more, so nothing here may
              // claim an update was posted to one. tropical_save_deliverables
              // still writes that message and the member emails still go out —
              // it is only the channel notice that now lands out of sight.
              groupLive={groupOpen && !isRetainer}
              // Only the brand, and only from their own channel. A talent
              // opening this on the group channel reads it.
              canEdit={isBrand && active?.type === 'bot'}
            />
          )}

          {panel === 'applicants' && isBrand && (
            <ApplicantsPanel applicants={applicants} disciplineLabels={disciplineLabels} />
          )}

          {panel === 'settings' && isBrand && (
            <ProjectSettingsPanel
              workspace={workspace}
              locked={contractsLocked}
              // A retainer stays deletable until it has actually started
              // paying — being paused mid-run is not the same as never having
              // begun, and only the second is safe to remove.
              deletable={isRetainer ? !retainerActivated : !escrowPaid}
              deleteRequest={deleteRequest}
              lockedNote={
                isRetainer
                  ? 'The engagement is running. Members and the project itself are locked - money is committed against this arrangement. Use the complaint form in a role\u2019s channel to change things.'
                  : undefined
              }
              profilesById={profilesById}
            />
          )}

          {/* The DM's contract, for both parties. */}
          {active?.type === 'dm' && activeRole && (
            <>
              {/* A retainer's schedule sits ABOVE the contract, because on a
                  recurring engagement "when am I next paid" is asked far more
                  often than "what did we agree". Renders only when this role
                  actually has a schedule, so nothing changes for fixed-price
                  work. */}
              {recurringTerms[activeRole.id] && (
                <RetainerPanel
                  roleId={activeRole.id}
                  roleTitle={activeRole.title}
                  terms={recurringTerms[activeRole.id]}
                  periods={periods}
                  currency={workspace.currency}
                  isBrand={isBrand}
                />
              )}
              <RoleContractPanel
                roleId={activeRole.id}
                roleTitle={activeRole.title}
                // The two parties to this role see its fee; another member
                // opening the thread does not.
                amount={
                  isBrand || activeRole.assigned_user_id === currentUserId
                    ? activeRole.amount
                    : null
                }
                contract={activeContract}
                locked={contractsLocked}
                currency={workspace.currency}
                canEdit={isBrand || activeRole.assigned_user_id === currentUserId}
                defaultOpen={expandContract && activeRole.id === retainerRole}
                lockedNote={
                  isRetainer
                    ? 'Locked. The engagement is running against these terms.'
                    : 'Locked. Escrow is paid against these terms.'
                }
                // The door out, for this role's own talent while nothing is
                // committed. A retainer keys off activation rather than the
                // contract lock: a paused engagement unlocks its terms but has
                // still taken money, so leaving it is a complaint.
                leave={
                  !isBrand &&
                  activeRole.assigned_user_id === currentUserId &&
                  activeRole.status === 'accepted' &&
                  (recurringTerms[activeRole.id]
                    ? !recurringTerms[activeRole.id].activatedAt
                    : !escrowPaid)
                    ? { projectName: workspace.name }
                    : undefined
                }
              />
              {/* Delivery is the fixed-price flow: mark delivered once, get
                  released once. A retainer has no single delivery moment, and
                  showing this next to a schedule would offer a button that
                  ends an engagement that is meant to continue. */}
              {!recurringTerms[activeRole.id] && (
                <DeliveryPanel
                  roleId={activeRole.id}
                  roleStatus={activeRole.status}
                  escrowPaid={escrowPaid}
                  isBrand={isBrand}
                  isAssignedCreative={activeRole.assigned_user_id === currentUserId}
                />
              )}
            </>
          )}

          <MessageList
            messages={messages}
            currentUserId={currentUserId}
            profilesById={profilesById}
          />

          {locked && (
            <div className='bg-background/70 absolute inset-0 grid place-items-center backdrop-blur-md'>
              <div className='max-w-sm px-6 text-center'>
                <span className='bg-gradient-brand glow mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full'>
                  <Lock className='text-on-brand' size={22} />
                </span>
                <h3 className='text-lg font-semibold'>Group channel locked</h3>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {isRetainer
                    ? 'It opens for everyone the moment the engagement starts.'
                    : 'It opens for everyone the moment escrow is funded.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className='border-foreground/10 shrink-0 border-t p-3 sm:p-4'>
          <div className='glass flex items-center gap-2 rounded-xl py-2 pr-2 pl-4'>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={locked}
              placeholder={locked ? 'Channel locked' : `Message ${active?.name ?? ''}`}
              aria-label='Message'
              className='placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-sm focus:outline-none disabled:opacity-40'
            />
            <button
              type='button'
              onClick={() => void send()}
              disabled={locked || !draft.trim()}
              className='bg-gradient-brand text-on-brand grid h-9 w-9 shrink-0 place-items-center rounded-lg disabled:opacity-30'
              aria-label='Send'
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The thread.
 *
 * Every message carries a timestamp, and a date separator is inserted whenever
 * the day changes. Consecutive messages from the same author within five
 * minutes are grouped — the avatar and name appear once, and each subsequent
 * line still gets its own time on hover-free display, so the timestamp
 * requirement holds without a wall of repeated metadata.
 */
function MessageList({
  messages,
  currentUserId,
  profilesById,
}: {
  messages: ChannelMessage[];
  currentUserId: string;
  profilesById: Record<
    string,
    { name: string | null; username: string | null; avatar: string | null }
  >;
}) {
  const GROUP_WINDOW_MS = 5 * 60 * 1000;

  return (
    <>
      {messages.map((message, index) => {
        const previous = index > 0 ? messages[index - 1] : null;
        const mine = message.sender_id === currentUserId;
        const bot = message.sender_id === null;
        const author = message.sender_id ? profilesById[message.sender_id] : null;

        const newDay =
          !previous ||
          new Date(previous.created_at).toDateString() !==
            new Date(message.created_at).toDateString();

        const grouped =
          !newDay &&
          previous?.sender_id === message.sender_id &&
          new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() <
            GROUP_WINDOW_MS;

        const text =
          typeof (message.content as { text?: unknown })?.text === 'string'
            ? (message.content as { text: string }).text
            : JSON.stringify(message.content);

        const systemLike =
          message.kind === 'escrow' || message.kind === 'system' || message.kind === 'deliverable';

        return (
          <div key={message.id}>
            {newDay && (
              <div className='my-4 flex items-center gap-3'>
                <span className='bg-foreground/10 h-px flex-1' />
                <span className='text-muted-foreground text-[10px] tracking-widest uppercase'>
                  {formatDayLabel(message.created_at)}
                </span>
                <span className='bg-foreground/10 h-px flex-1' />
              </div>
            )}

            {systemLike && bot ? (
              <div className='flex justify-center'>
                <div className='text-muted-foreground border-foreground/10 bg-sunken flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px]'>
                  <Bot size={11} className='text-accent' />
                  <span>{text}</span>
                  <time dateTime={message.created_at} className='tabular-nums opacity-60'>
                    {formatMessageTime(message.created_at)}
                  </time>
                </div>
              </div>
            ) : (
              <div className={cn('flex gap-3', mine && 'justify-end', grouped && 'mt-1')}>
                {!mine &&
                  (grouped ? (
                    <span className='w-8 shrink-0' aria-hidden />
                  ) : bot ? (
                    <span className='bg-gradient-brand text-on-brand grid h-8 w-8 shrink-0 place-items-center rounded-full'>
                      <Bot size={14} />
                    </span>
                  ) : (
                    <TalentAvatar candidate={author} size={32} />
                  ))}

                <div className={cn('max-w-[80%] sm:max-w-[65%]', mine && 'text-right')}>
                  {!grouped && (
                    <div
                      className={cn(
                        'text-muted-foreground mb-0.5 flex items-baseline gap-2 text-[10px]',
                        mine && 'justify-end',
                      )}
                    >
                      <span>
                        {mine
                          ? 'You'
                          : bot
                            ? 'Project Admin'
                            : (author?.name ?? author?.username ?? '')}
                      </span>
                      <time dateTime={message.created_at} className='tabular-nums opacity-70'>
                        {formatMessageTime(message.created_at)}
                      </time>
                    </div>
                  )}

                  <div
                    className={cn(
                      'inline-block rounded-2xl px-4 py-2 text-sm break-words',
                      mine
                        ? 'bg-gradient-brand text-on-brand rounded-br-sm'
                        : 'bg-foreground/[0.06] rounded-bl-sm',
                    )}
                  >
                    {text}
                  </div>

                  {/* Grouped lines keep their own timestamp, small and quiet,
                      so every message is individually stamped. */}
                  {grouped && (
                    <time
                      dateTime={message.created_at}
                      className={cn(
                        'text-muted-foreground/60 mt-0.5 block text-[9px] tabular-nums',
                        mine ? 'text-right' : 'text-left',
                      )}
                    >
                      {formatMessageTime(message.created_at)}
                    </time>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function HeaderButton({
  icon,
  label,
  onClick,
  active,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active: boolean;
  badge?: number;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative grid h-9 w-9 place-items-center rounded-lg transition',
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className='bg-accent text-accent-foreground absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold'>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}
