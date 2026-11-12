import type { Metadata } from 'next';
import Link from 'next/link';
import {
  activateProjectAction,
  approveContactReleaseAction,
  createProposalAction,
  openComplianceReviewAction,
  recordFeeAction,
  resolveComplianceReviewAction,
  setProposalStatusAction,
  updateNegotiationStatusAction,
  voidFeeAction,
} from '@/modules/commercial/actions';
import { loadNegotiationDetailForOps } from '@/modules/commercial/queries';
import type { NegotiationStatus } from '@/modules/commercial/types';
import { NEGOTIATION_TRANSITIONS, formatFeeForDisplay } from '@/modules/commercial/validation';

export const metadata: Metadata = {
  title: 'Negotiation — Operations',
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<NegotiationStatus, string> = {
  open: 'Open',
  proposal: 'Proposal',
  awaiting_acceptance: 'Awaiting acceptance',
  accepted: 'Accepted',
  contact_released: 'Contact released',
  completed: 'Completed',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
};

/**
 * One negotiation, as ops works it (Phase 4).
 *
 * Everything in one place: the mediated messages, the proposals with
 * their acceptance flags, the contact-release approval, the fee
 * records, compliance reviews, workspace activation, and the audit
 * trail. Status moves only along the Cubora state machine, and only
 * from here — parties signal intent on proposals, ops records the
 * transitions.
 */
export default async function NegotiationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadNegotiationDetailForOps(id);

  if (!detail) {
    return (
      <div className='space-y-4'>
        <h1 className='text-2xl font-bold'>Negotiation not found</h1>
        <Link
          href='/admin/operations/negotiations'
          className='text-primary text-sm hover:underline'
        >
          ← All negotiations
        </Link>
      </div>
    );
  }

  const { negotiation, messages, proposals, release, fees, events, compliance } = detail;
  const nextStatuses = NEGOTIATION_TRANSITIONS[negotiation.status];
  const bothAcceptedProposal = proposals.find(
    (p) => p.status === 'sent' && p.consumerAccepted && p.providerAccepted,
  );

  return (
    <div className='space-y-6'>
      <header>
        <Link
          href='/admin/operations/negotiations'
          className='text-primary text-sm hover:underline'
        >
          ← All negotiations
        </Link>
        <h1 className='mt-2 text-2xl font-bold'>
          {negotiation.consumerName ?? 'Buyer'} ↔ {negotiation.providerDisplayName ?? 'Provider'}
        </h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Status: <strong>{STATUS_LABEL[negotiation.status]}</strong> · Opened{' '}
          {new Date(negotiation.createdAt).toLocaleDateString()}
          {negotiation.activatedProjectId && <> · Workspace: {negotiation.activatedProjectId}</>}
        </p>
      </header>

      {bothAcceptedProposal && (
        <p className='rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-800 dark:bg-emerald-950'>
          Both parties accepted “{bothAcceptedProposal.title}”. Mark the proposal accepted below and
          the negotiation moves to Accepted.
        </p>
      )}

      {/* ---- status ---- */}
      <section className='bg-card rounded-lg border p-4'>
        <h2 className='font-medium'>Move status</h2>
        {nextStatuses.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>
            {STATUS_LABEL[negotiation.status]} is terminal — this negotiation is closed.
          </p>
        ) : (
          <form
            action={async (form: FormData) => {
              'use server';
              await updateNegotiationStatusAction(form);
            }}
            className='mt-2 flex flex-wrap gap-2'
          >
            <input type='hidden' name='negotiationId' value={negotiation.id} />
            <select
              name='status'
              required
              defaultValue=''
              className='rounded-md border px-2 py-1.5 text-sm'
            >
              <option value='' disabled>
                Move to…
              </option>
              {nextStatuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button
              type='submit'
              className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
            >
              Move
            </button>
          </form>
        )}
      </section>

      {/* ---- messages ---- */}
      <section className='bg-card rounded-lg border p-4'>
        <h2 className='font-medium'>Mediated messages</h2>
        {messages.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>No messages yet.</p>
        ) : (
          <ul className='mt-2 space-y-2 text-sm'>
            {messages.map((m) => (
              <li key={m.id} className='rounded-md border px-3 py-2'>
                <span className='text-muted-foreground text-xs'>
                  {m.senderName ?? 'Unknown'} · {new Date(m.createdAt).toLocaleString()}
                </span>
                <p className='mt-0.5 whitespace-pre-wrap'>{m.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- proposals ---- */}
      <section className='bg-card space-y-4 rounded-lg border p-4'>
        <h2 className='font-medium'>Proposals &amp; quotations</h2>
        {proposals.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No proposals yet.</p>
        ) : (
          <ul className='space-y-3'>
            {proposals.map((p) => (
              <li key={p.id} className='rounded-md border p-3'>
                <div className='flex flex-wrap items-baseline justify-between gap-2'>
                  <strong className='text-sm'>{p.title}</strong>
                  <span className='text-muted-foreground text-xs'>
                    {p.status} · by {p.authorRole} · consumer{' '}
                    {p.consumerAccepted ? 'accepted' : 'pending'} · provider{' '}
                    {p.providerAccepted ? 'accepted' : 'pending'}
                  </span>
                </div>
                {p.summary && <p className='mt-1 text-sm'>{p.summary}</p>}
                {Object.keys(p.terms).length > 0 && (
                  <p className='text-muted-foreground mt-1 text-xs'>
                    <code>{JSON.stringify(p.terms)}</code>
                  </p>
                )}
                {p.status === 'sent' && (
                  <form
                    action={async (form: FormData) => {
                      'use server';
                      await setProposalStatusAction(form);
                    }}
                    className='mt-2 flex flex-wrap gap-2'
                  >
                    <input type='hidden' name='proposalId' value={p.id} />
                    <button
                      type='submit'
                      name='status'
                      value='accepted'
                      className='rounded-md border px-2 py-1 text-xs font-medium'
                    >
                      Mark accepted
                    </button>
                    <button
                      type='submit'
                      name='status'
                      value='declined'
                      className='rounded-md border px-2 py-1 text-xs font-medium'
                    >
                      Mark declined
                    </button>
                    <button
                      type='submit'
                      name='status'
                      value='superseded'
                      className='rounded-md border px-2 py-1 text-xs font-medium'
                    >
                      Mark superseded
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          action={async (form: FormData) => {
            'use server';
            await createProposalAction(form);
          }}
          className='space-y-2 rounded-md border p-3'
        >
          <h3 className='text-sm font-medium'>Send a proposal as ops</h3>
          <input type='hidden' name='negotiationId' value={negotiation.id} />
          <input
            name='title'
            required
            maxLength={200}
            placeholder='Proposal title'
            className='w-full rounded-md border px-2 py-1.5 text-sm'
          />
          <textarea
            name='summary'
            placeholder='Summary (what is being offered, in plain words)'
            className='w-full rounded-md border px-2 py-1.5 text-sm'
          />
          <input
            name='terms'
            placeholder='Terms as JSON, e.g. {"scope": "…"} (optional)'
            className='w-full rounded-md border px-2 py-1.5 text-sm'
          />
          <button
            type='submit'
            className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
          >
            Send proposal
          </button>
        </form>
      </section>

      {/* ---- contact release ---- */}
      <section className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='font-medium'>Contact release</h2>
        {release ? (
          <p className='text-sm'>
            Approved — consumer contact{' '}
            <strong>{release.consumerContactReleased ? 'released' : 'not released'}</strong>,
            provider contact{' '}
            <strong>{release.providerContactReleased ? 'released' : 'not released'}</strong>.
            Attested: “{release.conditionsSummary}”
          </p>
        ) : (
          <p className='text-muted-foreground text-sm'>
            No release approved yet. Contact details stay hidden from both parties until ops
            approves a release here.
          </p>
        )}
        {(negotiation.status === 'accepted' || negotiation.status === 'contact_released') && (
          <form
            action={async (form: FormData) => {
              'use server';
              await approveContactReleaseAction(form);
            }}
            className='space-y-2 rounded-md border p-3'
          >
            <h3 className='text-sm font-medium'>Approve a release</h3>
            <input type='hidden' name='negotiationId' value={negotiation.id} />
            <textarea
              name='conditionsSummary'
              required
              maxLength={2000}
              placeholder='What conditions were met — in your own words. This is the attestation; the release policy itself is still undecided (spec O4).'
              className='w-full rounded-md border px-2 py-1.5 text-sm'
              defaultValue={release?.conditionsSummary ?? ''}
            />
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                name='releaseConsumer'
                defaultChecked={release?.consumerContactReleased ?? false}
              />
              Release the consumer&apos;s contact to the provider
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                name='releaseProvider'
                defaultChecked={release?.providerContactReleased ?? false}
              />
              Release the provider&apos;s contact to the consumer
            </label>
            <input
              name='notes'
              placeholder='Notes (optional)'
              defaultValue={release?.notes ?? ''}
              className='w-full rounded-md border px-2 py-1.5 text-sm'
            />
            <button
              type='submit'
              className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
            >
              Record release approval
            </button>
          </form>
        )}
      </section>

      {/* ---- fees ---- */}
      <section className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='font-medium'>Fee records</h2>
        {fees.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            No fee recorded for this operation yet. A record that says “Not set” means nothing was
            agreed — not that the fee is zero.
          </p>
        ) : (
          <ul className='space-y-2 text-sm'>
            {fees.map((f) => (
              <li
                key={f.id}
                className='flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2'
              >
                <span>
                  {formatFeeForDisplay(f)}
                  {f.notes ? ` — ${f.notes}` : ''}
                  <span className='text-muted-foreground'>
                    {' '}
                    · {new Date(f.createdAt).toLocaleDateString()}
                  </span>
                </span>
                {f.status !== 'void' && (
                  <form
                    action={async () => {
                      'use server';
                      await voidFeeAction(f.id);
                    }}
                  >
                    <button type='submit' className='rounded-md border px-2 py-1 text-xs'>
                      Void
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          action={async (form: FormData) => {
            'use server';
            await recordFeeAction(form);
          }}
          className='space-y-2 rounded-md border p-3'
        >
          <h3 className='text-sm font-medium'>Record a fee</h3>
          <p className='text-muted-foreground text-xs'>
            Record exactly what was agreed for this operation. Every field is optional until Roger
            decides the fee model (spec O1–O3) — leave blank what was not agreed.
          </p>
          <input type='hidden' name='negotiationId' value={negotiation.id} />
          <div className='flex flex-wrap gap-2'>
            <select
              name='feeType'
              defaultValue=''
              className='rounded-md border px-2 py-1.5 text-sm'
            >
              <option value=''>Fee type — not set</option>
              <option value='fixed'>Fixed</option>
              <option value='percentage'>Percentage</option>
              <option value='hybrid'>Hybrid</option>
            </select>
            <input
              name='feeAmount'
              inputMode='decimal'
              placeholder='Amount (optional)'
              className='w-36 rounded-md border px-2 py-1.5 text-sm'
            />
            <input
              name='feeCurrency'
              placeholder='Currency (optional)'
              maxLength={16}
              className='w-32 rounded-md border px-2 py-1.5 text-sm'
            />
            <input
              name='feeBasis'
              placeholder='Applies to… (optional)'
              className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
            />
          </div>
          <input
            name='notes'
            placeholder='Notes (optional)'
            className='w-full rounded-md border px-2 py-1.5 text-sm'
          />
          <button
            type='submit'
            className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
          >
            Record fee
          </button>
        </form>
      </section>

      {/* ---- compliance ---- */}
      <section className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='font-medium'>Compliance reviews</h2>
        {compliance.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No reviews on this negotiation.</p>
        ) : (
          <ul className='space-y-2 text-sm'>
            {compliance.map((r) => (
              <li key={r.id} className='rounded-md border px-3 py-2'>
                <strong>{r.status}</strong> — {r.reason}
                {r.notes ? ` (${r.notes})` : ''}
                {r.status !== 'cleared' && (
                  <form
                    action={async (form: FormData) => {
                      'use server';
                      await resolveComplianceReviewAction(form);
                    }}
                    className='mt-2 flex flex-wrap gap-2'
                  >
                    <input type='hidden' name='reviewId' value={r.id} />
                    <input
                      name='notes'
                      placeholder='Resolution notes (optional)'
                      className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs'
                    />
                    <button
                      type='submit'
                      name='status'
                      value='cleared'
                      className='rounded-md border px-2 py-1 text-xs font-medium'
                    >
                      Clear
                    </button>
                    <button
                      type='submit'
                      name='status'
                      value='blocked'
                      className='rounded-md border px-2 py-1 text-xs font-medium'
                    >
                      Keep blocked
                    </button>
                    <button
                      type='submit'
                      name='status'
                      value='escalated'
                      className='rounded-md border px-2 py-1 text-xs font-medium'
                    >
                      Escalate
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          action={async (form: FormData) => {
            'use server';
            await openComplianceReviewAction(form);
          }}
          className='flex flex-wrap gap-2'
        >
          <input type='hidden' name='entityType' value='negotiation' />
          <input type='hidden' name='entityId' value={negotiation.id} />
          <input
            name='reason'
            required
            maxLength={2000}
            placeholder='Open a review — why does this need human review?'
            className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
          />
          <button type='submit' className='rounded-md border px-3 py-1.5 text-sm font-medium'>
            Open review
          </button>
        </form>
      </section>

      {/* ---- workspace activation ---- */}
      {(negotiation.status === 'accepted' || negotiation.status === 'contact_released') &&
        !negotiation.activatedProjectId && (
          <section className='bg-card space-y-2 rounded-lg border p-4'>
            <h2 className='font-medium'>Activate workspace</h2>
            <p className='text-muted-foreground text-sm'>
              Once a negotiation is accepted, ops activates the project workspace — this is what
              opens the group channel. Activation is a Cubora operations decision, not a payment
              event: there is no payment rail in the MVP.
            </p>
            <form
              action={async (form: FormData) => {
                'use server';
                await activateProjectAction(form);
              }}
              className='flex flex-wrap gap-2'
            >
              <input type='hidden' name='negotiationId' value={negotiation.id} />
              <input
                name='projectId'
                required
                placeholder='Project id (from /admin/projects)'
                className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
              />
              <button
                type='submit'
                className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
              >
                Activate workspace
              </button>
            </form>
          </section>
        )}

      {/* ---- audit trail ---- */}
      <section className='bg-card rounded-lg border p-4'>
        <h2 className='font-medium'>Audit trail</h2>
        {events.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>No events recorded yet.</p>
        ) : (
          <ul className='mt-2 space-y-1 text-sm'>
            {events.map((e) => (
              <li key={e.id} className='flex justify-between gap-2'>
                <span>{e.eventType}</span>
                <span className='text-muted-foreground shrink-0'>
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
