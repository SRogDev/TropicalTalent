import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getViewer } from '@/modules/identity/queries';
import {
  acceptProposalAction,
  createProposalAction,
  declineProposalAction,
  sendNegotiationMessageAction,
} from '@/modules/commercial/actions';
import { loadNegotiationForParty } from '@/modules/commercial/queries';
import type { NegotiationStatus, ProposalStatus } from '@/modules/commercial/types';
import { formatFeeForDisplay, releaseStateFor } from '@/modules/commercial/validation';
import { RevealContactButton } from '@/components/tropical/reveal-contact-button';

export const metadata: Metadata = {
  title: 'Negotiation',
  robots: { index: false, follow: false },
};

/**
 * One negotiation, as a party sees it (Phase 4, plan §9, spec S45/S46).
 *
 * The mediated conversation, the proposals with accept/decline, the
 * contact-release state, and — for the consumer — the fee records.
 * Contact details never appear here unprompted: the reveal button
 * asks the server, which checks the release record first.
 */
export default async function PartyNegotiationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/operations');
  const { id } = await params;

  const t = await getTranslations('operations');
  const locale = await getLocale();

  const statusLabel: Record<NegotiationStatus, string> = {
    open: t('statusOpen'),
    proposal: t('statusProposal'),
    awaiting_acceptance: t('statusAwaitingAcceptance'),
    accepted: t('statusAccepted'),
    contact_released: t('statusContactReleased'),
    completed: t('statusCompleted'),
    cancelled: t('statusCancelled'),
    blocked: t('statusBlocked'),
  };
  const proposalStatusLabel: Record<ProposalStatus, string> = {
    draft: t('proposalStatusDraft'),
    sent: t('proposalStatusSent'),
    accepted: t('proposalStatusAccepted'),
    declined: t('proposalStatusDeclined'),
    superseded: t('proposalStatusSuperseded'),
  };
  const authorLabel: Record<string, string> = {
    consumer: t('authorConsumer'),
    provider: t('authorProvider'),
    ops: t('authorOps'),
  };

  const detail = await loadNegotiationForParty(id, viewer.id);
  if (!detail) {
    return (
      <div className='mx-auto max-w-2xl space-y-4 px-4 py-8'>
        <h1 className='text-2xl font-bold'>{t('notFoundTitle')}</h1>
        <p className='text-muted-foreground text-sm'>{t('notFoundIntro')}</p>
        <Link href='/operations' className='text-primary text-sm hover:underline'>
          ← {t('backToOperations')}
        </Link>
      </div>
    );
  }

  const { negotiation, messages, proposals, release, fees, events } = detail;
  const side = negotiation.consumerId === viewer.id ? 'consumer' : 'provider';
  const releaseState = releaseStateFor(release, side);
  const closed = negotiation.status === 'completed' || negotiation.status === 'cancelled';
  const feeLabels = { notSet: t('feeNotSet'), void: t('feeVoid') };

  return (
    <div className='mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6'>
      <header>
        <Link href='/operations' className='text-primary text-sm hover:underline'>
          ← {t('backToOperations')}
        </Link>
        <h1 className='mt-2 text-2xl font-bold'>
          {negotiation.offerTitle ?? negotiation.sourcingQuery ?? t('negotiationFallback')}
        </h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t('statusLabel')} <strong>{statusLabel[negotiation.status]}</strong> ·{' '}
          {side === 'consumer' ? t('youAreBuyer') : t('youAreProvider')} ·{' '}
          {t('opened', { date: new Date(negotiation.createdAt).toLocaleDateString(locale) })}
        </p>
      </header>

      {negotiation.status === 'blocked' && (
        <p className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950'>
          {t('blockedNotice')}
        </p>
      )}

      {/* ---- contact release ---- */}
      <section className='bg-card space-y-2 rounded-lg border p-4'>
        <h2 className='font-medium'>{t('contactTitle')}</h2>
        {releaseState === 'released' ? (
          <>
            <p className='text-sm'>
              {t('contactReleased')}
              {release ? ` — “${release.conditionsSummary}”` : ''}.
            </p>
            <RevealContactButton negotiationId={negotiation.id} />
          </>
        ) : (
          <p className='text-muted-foreground text-sm'>{t('contactHidden')}</p>
        )}
      </section>

      {/* ---- messages ---- */}
      <section className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='font-medium'>{t('conversationTitle')}</h2>
        {messages.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('conversationEmpty')}</p>
        ) : (
          <ul className='space-y-2 text-sm'>
            {messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-md border px-3 py-2 ${m.senderId === viewer.id ? 'bg-primary/5' : ''}`}
              >
                <span className='text-muted-foreground text-xs'>
                  {m.senderId === viewer.id ? t('you') : t('otherParty')} ·{' '}
                  {new Date(m.createdAt).toLocaleString(locale)}
                </span>
                <p className='mt-0.5 whitespace-pre-wrap break-words'>{m.content}</p>
              </li>
            ))}
          </ul>
        )}
        {!closed && (
          <form
            action={async (form: FormData) => {
              'use server';
              await sendNegotiationMessageAction(form);
            }}
            className='flex flex-wrap gap-2'
          >
            <input type='hidden' name='negotiationId' value={negotiation.id} />
            <input
              name='content'
              required
              maxLength={5000}
              placeholder={t('messagePlaceholder')}
              className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
            />
            <button
              type='submit'
              className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
            >
              {t('send')}
            </button>
          </form>
        )}
      </section>

      {/* ---- proposals ---- */}
      <section className='bg-card space-y-3 rounded-lg border p-4'>
        <h2 className='font-medium'>{t('proposalsTitle')}</h2>
        {proposals.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('proposalsEmpty')}</p>
        ) : (
          <ul className='space-y-3'>
            {proposals.map((p) => {
              const myAccepted = side === 'consumer' ? p.consumerAccepted : p.providerAccepted;
              const otherAccepted = side === 'consumer' ? p.providerAccepted : p.consumerAccepted;
              return (
                <li key={p.id} className='rounded-md border p-3'>
                  <div className='flex flex-wrap items-baseline justify-between gap-2'>
                    <strong className='text-sm'>{p.title}</strong>
                    <span className='text-muted-foreground text-xs'>
                      {proposalStatusLabel[p.status]} · {t('proposalBy')}{' '}
                      {authorLabel[p.authorRole] ?? p.authorRole} ·{' '}
                      {myAccepted ? t('proposalYouAccepted') : t('proposalYouPending')} ·{' '}
                      {otherAccepted ? t('proposalOtherAccepted') : t('proposalOtherPending')}
                    </span>
                  </div>
                  {p.summary && <p className='mt-1 text-sm'>{p.summary}</p>}
                  {Object.keys(p.terms).length > 0 && (
                    <p className='text-muted-foreground mt-1 text-xs break-all'>
                      <code>{JSON.stringify(p.terms)}</code>
                    </p>
                  )}
                  {p.status === 'sent' && !closed && (
                    <div className='mt-2 flex flex-wrap gap-2'>
                      {!myAccepted && (
                        <form
                          action={async () => {
                            'use server';
                            await acceptProposalAction(p.id);
                          }}
                        >
                          <button
                            type='submit'
                            className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium'
                          >
                            {t('accept')}
                          </button>
                        </form>
                      )}
                      <form
                        action={async () => {
                          'use server';
                          await declineProposalAction(p.id);
                        }}
                      >
                        <button
                          type='submit'
                          className='rounded-md border px-3 py-1.5 text-xs font-medium'
                        >
                          {t('decline')}
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!closed && (
          <form
            action={async (form: FormData) => {
              'use server';
              await createProposalAction(form);
            }}
            className='space-y-2 rounded-md border p-3'
          >
            <h3 className='text-sm font-medium'>{t('sendProposalTitle')}</h3>
            <input type='hidden' name='negotiationId' value={negotiation.id} />
            <input
              name='title'
              required
              maxLength={200}
              placeholder={t('proposalTitlePlaceholder')}
              className='w-full rounded-md border px-2 py-1.5 text-sm'
            />
            <textarea
              name='summary'
              placeholder={t('proposalSummaryPlaceholder')}
              className='w-full rounded-md border px-2 py-1.5 text-sm'
            />
            <input
              name='terms'
              placeholder={t('proposalTermsPlaceholder')}
              className='w-full rounded-md border px-2 py-1.5 text-sm'
            />
            <button
              type='submit'
              className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
            >
              {t('sendProposal')}
            </button>
          </form>
        )}
      </section>

      {/* ---- fees (consumer only) ---- */}
      {side === 'consumer' && (
        <section className='bg-card rounded-lg border p-4'>
          <h2 className='font-medium'>{t('feesTitle')}</h2>
          {fees.length === 0 ? (
            <p className='text-muted-foreground mt-2 text-sm'>{t('feesEmptyDetail')}</p>
          ) : (
            <ul className='mt-2 space-y-1 text-sm'>
              {fees.map((f) => (
                <li key={f.id} className='flex justify-between gap-2'>
                  <span>{formatFeeForDisplay(f, feeLabels)}</span>
                  <span className='text-muted-foreground shrink-0'>
                    {f.status === 'void' ? t('feeVoid') : t('feeRecorded')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- audit trail ---- */}
      <section className='bg-card rounded-lg border p-4'>
        <h2 className='font-medium'>{t('historyTitle')}</h2>
        {events.length === 0 ? (
          <p className='text-muted-foreground mt-2 text-sm'>{t('historyEmpty')}</p>
        ) : (
          <ul className='mt-2 space-y-1 text-sm'>
            {events.map((e) => (
              <li key={e.id} className='flex justify-between gap-2'>
                <span className='break-all'>{e.eventType}</span>
                <span className='text-muted-foreground shrink-0'>
                  {new Date(e.createdAt).toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
