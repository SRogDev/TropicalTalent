'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Lock,
  Plus,
  Save,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import {
  acceptRoleContractAction,
  raiseDisputeAction,
  saveRoleContractAction,
} from '@/modules/chat/actions';
import { formatPence } from '@/lib/money';
import { EMPTY_TERMS, type ContractTerms, type RoleContract } from '@/modules/chat/types';
import { useTenantName } from './tenant-context';
import { LeaveRoleButton } from './leave-role-button';

/**
 * The draft contract for one role, shown inside that role's DM.
 *
 * Both parties can write it and both have to accept it, until escrow is paid.
 * After that it is locked and the only route to a change is the complaint
 * form, which goes to the TropicalTalent team rather than to the other party.
 *
 * `amount` arrives already filtered by the server — a talent reading this
 * sees their own fee and nothing about anyone else's. There is no
 * `isBrand ? show : hide` here on purpose: a field that never reaches the
 * client cannot leak through a render bug.
 */
export function RoleContractPanel({
  roleId,
  roleTitle,
  amount,
  contract,
  locked: lockedByProject,
  currency,
  canEdit,
  defaultOpen = false,
  lockedNote = 'Locked. Escrow is paid against these terms.',
  leave,
}: {
  roleId: string;
  roleTitle: string;
  /**
   * The role's fee, from the role row — NOT from the contract. A contract
   * row only exists once somebody drafts terms, and the fee is agreed the
   * moment the seat is offered, so it has to be visible in the DM from the
   * first message, draft or no draft. Null when the reader is not entitled
   * to it (a member reading somebody else's role).
   */
  amount: number | null;
  contract: RoleContract | null;
  /**
   * Whether the money behind this contract has been committed.
   *
   * Passed in rather than derived from `escrowPaid` here, because the answer
   * is not the same for both kinds of project: a pot commits when escrow is
   * funded, a retainer when its card is saved and the engagement starts. A
   * retainer project is 'active' from creation, so reading escrow here locked
   * every retainer contract before either party could touch it.
   */
  locked: boolean;
  currency: string;
  /** False for a member who is neither the brand nor this role's talent. */
  canEdit: boolean;
  /** Opened on arrival when something sent the reader here to act on it. */
  defaultOpen?: boolean;
  lockedNote?: string;
  /**
   * Present when the reader is this role's talent and may still walk away
   * — the seat is accepted and its money is not committed. Once `locked` the
   * complaint button below is their route, and this is never passed.
   */
  leave?: { projectName: string };
}) {
  const tenantName = useTenantName();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [terms, setTerms] = useState<ContractTerms>(contract?.terms ?? EMPTY_TERMS);

  // Collapsed by default: the contract sits above the thread, and an expanded
  // one pushes the conversation off screen every time the channel is opened.
  // The header stays visible so its state is always readable at a glance.
  // `defaultOpen` is the exception — something sent the reader here to act on
  // it, and landing them on a collapsed header would look like a dead link.
  const [open, setOpen] = useState(defaultOpen);

  const locked = lockedByProject || contract?.status === 'locked';
  const bothAccepted = Boolean(contract?.brand_accepted && contract?.creative_accepted);

  /**
   * Adopt the server's terms when they change underneath us.
   *
   * The other party editing arrives as a realtime-driven re-render with new
   * props. Without this the local `terms` — seeded once at mount — would keep
   * showing the stale draft, and the next save would silently overwrite their
   * edit with it. Skipped while editing, so it cannot yank text out from under
   * someone mid-sentence.
   */
  const serverTerms = contract?.terms;
  useEffect(() => {
    if (!editing && serverTerms) setTerms(serverTerms);
  }, [serverTerms, editing]);

  const save = () => {
    startTransition(async () => {
      const result = await saveRoleContractAction(roleId, terms);
      if (result.success !== true) {
        toast({ title: 'Could not save', description: result.error, variant: 'destructive' });
        return;
      }
      setEditing(false);
      toast({
        title: 'Contract saved',
        description: 'The other party has to accept the new text.',
      });
      router.refresh();
    });
  };

  const accept = () => {
    startTransition(async () => {
      const result = await acceptRoleContractAction(roleId);
      if (result.success !== true) {
        toast({ title: 'Could not accept', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Accepted' });
      router.refresh();
    });
  };

  return (
    <div className='glass rounded-2xl'>
      {/* The whole header is the toggle — a 4px chevron is not a touch target. */}
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className='flex w-full items-start justify-between gap-3 p-5 text-left'
      >
        <div className='min-w-0'>
          <h3 className='flex items-center gap-2 text-sm font-semibold'>
            <FileText size={14} className='text-accent shrink-0' />
            Contract - {roleTitle}
          </h3>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {locked
              ? lockedNote
              : bothAccepted
                ? 'Agreed by both parties. Either side can still revise it until the money is committed.'
                : 'Draft. Both parties need to accept.'}
          </p>
        </div>

        <div className='flex shrink-0 items-center gap-2'>
          {amount !== null && (
            <span className='text-sm font-semibold tabular-nums'>
              {formatPence(amount, currency)}
            </span>
          )}
          {locked && <Lock size={13} className='text-status-pending' />}
          <span className='text-muted-foreground'>
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </div>
      </button>

      {!open ? null : (
        <div className='px-5 pb-5'>
          {locked ? (
            <>
              <ContractReadout terms={contract?.terms ?? EMPTY_TERMS} />
              <button
                type='button'
                onClick={() => setDisputing(true)}
                className='text-status-pending border-status-pending/30 hover:bg-foreground/[0.04] mt-4 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition'
              >
                <ShieldAlert size={13} /> Raise a complaint with the {tenantName} team
              </button>
            </>
          ) : editing ? (
            <div className='mt-4 space-y-3'>
              <Field label='Scope of work'>
                <textarea
                  value={terms.scope}
                  onChange={(e) => setTerms((t) => ({ ...t, scope: e.target.value }))}
                  rows={3}
                  placeholder='What is being made, in what format, for what use.'
                  className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none'
                />
              </Field>

              <Field label='Deliverables'>
                <DeliverableList
                  items={terms.deliverables}
                  onChange={(deliverables) => setTerms((t) => ({ ...t, deliverables }))}
                />
              </Field>

              <div className='grid gap-3 sm:grid-cols-2'>
                <Field label='Revisions included'>
                  <input
                    type='number'
                    min={0}
                    max={20}
                    value={terms.revisions}
                    onChange={(e) =>
                      setTerms((t) => ({
                        ...t,
                        revisions: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className='border-foreground/10 bg-sunken focus:border-foreground/30 w-full rounded-lg border px-3 py-2 text-sm tabular-nums focus:outline-none'
                  />
                </Field>
                <Field label='Deadline'>
                  <input
                    type='date'
                    value={terms.deadline?.slice(0, 10) ?? ''}
                    onChange={(e) => setTerms((t) => ({ ...t, deadline: e.target.value || null }))}
                    className='border-foreground/10 bg-sunken focus:border-foreground/30 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none'
                  />
                </Field>
              </div>

              <Field label='Payment terms'>
                <input
                  value={terms.paymentTerms}
                  onChange={(e) => setTerms((t) => ({ ...t, paymentTerms: e.target.value }))}
                  className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none'
                />
              </Field>

              <Field label='Notes'>
                <textarea
                  value={terms.notes}
                  onChange={(e) => setTerms((t) => ({ ...t, notes: e.target.value }))}
                  rows={2}
                  placeholder='Anything else you have agreed.'
                  className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none'
                />
              </Field>

              <div className='flex justify-end gap-2 pt-1'>
                <button
                  type='button'
                  onClick={() => {
                    setTerms(contract?.terms ?? EMPTY_TERMS);
                    setEditing(false);
                  }}
                  disabled={pending}
                  className='text-muted-foreground hover:text-foreground rounded-lg px-4 py-2 text-xs disabled:opacity-40'
                >
                  Cancel
                </button>
                <button
                  type='button'
                  onClick={save}
                  disabled={pending}
                  className='bg-gradient-brand text-on-brand flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40'
                >
                  <Save size={12} /> {pending ? 'Saving…' : 'Save draft'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <ContractReadout terms={contract?.terms ?? EMPTY_TERMS} />

              {canEdit && (
                <div className='mt-4 flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={() => {
                      setTerms(contract?.terms ?? EMPTY_TERMS);
                      setEditing(true);
                    }}
                    className='text-muted-foreground border-foreground/10 hover:text-foreground flex-1 rounded-lg border px-3 py-2.5 text-xs transition'
                  >
                    {contract ? 'Edit draft' : 'Draft the contract'}
                  </button>
                  {contract && !bothAccepted && (
                    <button
                      type='button'
                      onClick={accept}
                      disabled={pending}
                      className='bg-gradient-brand text-on-brand flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium disabled:opacity-40'
                    >
                      <Check size={13} /> Accept
                    </button>
                  )}
                </div>
              )}

              {contract && (
                <div className='text-muted-foreground mt-3 flex gap-4 text-[11px]'>
                  <span className='flex items-center gap-1'>
                    {contract.brand_accepted ? (
                      <Check size={11} className='text-status-active' />
                    ) : (
                      <X size={11} className='text-status-cancelled' />
                    )}
                    Brand
                  </span>
                  <span className='flex items-center gap-1'>
                    {contract.creative_accepted ? (
                      <Check size={11} className='text-status-active' />
                    ) : (
                      <X size={11} className='text-status-cancelled' />
                    )}
                    Creative
                  </span>
                </div>
              )}

              {leave && !locked && (
                <div className='border-foreground/10 mt-4 border-t pt-3'>
                  <LeaveRoleButton
                    roleId={roleId}
                    roleTitle={roleTitle}
                    projectName={leave.projectName}
                    afterLeave='go-to-jobs'
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <DisputeDialog
        roleId={roleId}
        roleTitle={roleTitle}
        open={disputing}
        onOpenChange={setDisputing}
      />
    </div>
  );
}

function ContractReadout({ terms }: { terms: ContractTerms }) {
  const empty = !terms.scope && terms.deliverables.length === 0 && !terms.notes && !terms.deadline;

  if (empty) {
    return <p className='text-muted-foreground/70 mt-4 text-xs'>Nothing drafted yet.</p>;
  }

  return (
    <dl className='mt-4 space-y-3 text-xs'>
      {terms.scope && (
        <Row label='Scope'>
          <p className='leading-relaxed'>{terms.scope}</p>
        </Row>
      )}
      {terms.deliverables.length > 0 && (
        <Row label='Deliverables'>
          <ul className='list-inside list-disc space-y-0.5'>
            {terms.deliverables.map((item, i) => (
              <li key={`${item}-${i}`}>{item}</li>
            ))}
          </ul>
        </Row>
      )}
      <Row label='Revisions'>{terms.revisions}</Row>
      {terms.deadline && (
        <Row label='Deadline'>
          {new Date(terms.deadline).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Row>
      )}
      {terms.paymentTerms && <Row label='Payment'>{terms.paymentTerms}</Row>}
      {terms.notes && <Row label='Notes'>{terms.notes}</Row>}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className='text-muted-foreground text-[10px] tracking-widest uppercase'>{label}</dt>
      <dd className='mt-0.5'>{children}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className='block'>
      <span className='text-muted-foreground mb-1 block text-[10px] tracking-widest uppercase'>
        {label}
      </span>
      {children}
    </label>
  );
}

function DeliverableList({
  items,
  onChange,
}: {
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft('');
  };

  return (
    <div className='space-y-1.5'>
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          className='border-foreground/10 bg-sunken flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm'
        >
          <span className='min-w-0 flex-1 truncate'>{item}</span>
          <button
            type='button'
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            aria-label={`Remove ${item}`}
            className='text-muted-foreground hover:text-foreground shrink-0'
          >
            <X size={12} />
          </button>
        </div>
      ))}

      <div className='flex gap-2'>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder='e.g. 3 × 60s edits, 4K ProRes'
          aria-label='Add a deliverable'
          className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm focus:outline-none'
        />
        <button
          type='button'
          onClick={add}
          aria-label='Add deliverable'
          className='text-muted-foreground border-foreground/10 hover:text-foreground grid h-9 w-9 shrink-0 place-items-center rounded-lg border'
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

const CATEGORIES = [
  { value: 'scope', label: 'Scope disagreement' },
  { value: 'payment', label: 'Payment' },
  { value: 'quality', label: 'Quality of work' },
  { value: 'deadline', label: 'Missed deadline' },
  { value: 'conduct', label: 'Conduct' },
  { value: 'other', label: 'Something else' },
] as const;

function DisputeDialog({
  roleId,
  roleTitle,
  open,
  onOpenChange,
}: {
  roleId: string;
  roleTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tenantName = useTenantName();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('scope');
  const [detail, setDetail] = useState('');

  const submit = () => {
    startTransition(async () => {
      const result = await raiseDisputeAction(roleId, { category, detail });
      if (result.success !== true) {
        toast({ title: 'Could not submit', description: result.error, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Complaint submitted',
        description: `The ${tenantName} team will be in touch.`,
      });
      setDetail('');
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='tropical glass border-foreground/10 max-w-md'>
        <DialogTitle>Raise a complaint</DialogTitle>
        <DialogDescription className='text-muted-foreground text-sm'>
          Escrow is paid, so this contract is locked. Tell the {tenantName} team what needs to
          change and they will mediate - {roleTitle}.
        </DialogDescription>

        <div className='space-y-3'>
          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[10px] tracking-widest uppercase'>
              What is this about
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className='border-foreground/10 bg-sunken focus:border-foreground/30 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none'
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value} className='bg-obsidian-1'>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className='block'>
            <span className='text-muted-foreground mb-1 block text-[10px] tracking-widest uppercase'>
              Detail
            </span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={5}
              placeholder='What was agreed, what happened, and what outcome you are asking for.'
              className='placeholder:text-muted-foreground/50 border-foreground/10 bg-sunken focus:border-foreground/30 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none'
            />
            <span className='text-muted-foreground mt-1 block text-[11px]'>
              {detail.trim().length < 20
                ? `${20 - detail.trim().length} more characters needed`
                : 'Ready to send'}
            </span>
          </label>
        </div>

        <button
          type='button'
          onClick={submit}
          disabled={pending || detail.trim().length < 20}
          className='bg-gradient-brand text-on-brand w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40'
        >
          {pending ? 'Submitting…' : 'Submit complaint'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
