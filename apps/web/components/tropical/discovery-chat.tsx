'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { OfferCard } from '@/components/tropical/offer-card';
import type { Offer } from '@/modules/catalog/types';
import { parseDiscoveryEvent } from '@/modules/discovery/events';

/**
 * Conversational discovery chat (Phase 3).
 *
 * Adapts the existing AI agent chat transport (POST /api/agent, SSE)
 * instead of rebuilding chat: this component talks to the server-side
 * proxy POST /api/discovery, which forwards the signed-in user's JWT.
 * One stream carries structured events, not only plain messages —
 * clarification prompts, inline offer cards, and sourcing-request
 * notices render inside the conversation.
 *
 * Styling follows the repo's own Cubora design system (Phase 1
 * light-green tokens, same card/bubble classes as OfferCard and the
 * catalog board), not a generic palette.
 */

interface AssistantTurn {
  text: string;
  questions: string[];
  offers: Offer[];
  partial: boolean;
  sourcing: { id: string; status: string; query: string } | null;
  error: string | null;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text?: string;
  assistant?: AssistantTurn;
}

function emptyAssistantTurn(): AssistantTurn {
  return { text: '', questions: [], offers: [], partial: false, sourcing: null, error: null };
}

export function DiscoveryChat() {
  const t = useTranslations('discovery');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setInput('');
    setBusy(true);
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }]);

    const assistantIndex = turns.length + 1;
    setTurns((prev) => [...prev, { role: 'assistant', assistant: emptyAssistantTurn() }]);

    const patch = (fn: (turn: AssistantTurn) => AssistantTurn) => {
      setTurns((prev) =>
        prev.map((turn, i) =>
          i === assistantIndex && turn.role === 'assistant' && turn.assistant
            ? { ...turn, assistant: fn(turn.assistant) }
            : turn,
        ),
      );
    };

    let response: Response;
    try {
      response = await fetch('/api/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          ...(conversationId.current ? { conversation_id: conversationId.current } : {}),
        }),
      });
    } catch {
      patch((turn) => ({ ...turn, error: t('unavailable') }));
      setBusy(false);
      return;
    }

    if (!response.ok || !response.body) {
      patch((turn) => ({ ...turn, error: t('unavailable') }));
      setBusy(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const line of part.split('\n')) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('data:')) continue;
            let payload: unknown;
            try {
              payload = JSON.parse(trimmedLine.slice('data:'.length).trim());
            } catch {
              continue;
            }
            const event = parseDiscoveryEvent(payload);
            if (!event) continue;
            switch (event.type) {
              case 'conversation_id':
                conversationId.current = event.content;
                break;
              case 'message':
                patch((turn) => ({ ...turn, text: turn.text + event.content }));
                break;
              case 'clarification':
                patch((turn) => ({
                  ...turn,
                  questions: event.content.questions,
                  offers: event.content.partialOffers,
                  partial: event.content.partialOffers.length > 0,
                }));
                break;
              case 'offers':
                patch((turn) => ({
                  ...turn,
                  offers: event.content.offers,
                  partial: event.content.partial,
                }));
                break;
              case 'sourcing_request':
                patch((turn) => ({ ...turn, sourcing: event.content }));
                break;
              case 'error':
                patch((turn) => ({ ...turn, error: event.content.message }));
                break;
              case 'done':
                break;
              default:
                break;
            }
          }
        }
        scrollToBottom();
      }
    } catch {
      patch((turn) => ({ ...turn, error: turn.error ?? t('unavailable') }));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='space-y-4' aria-live='polite'>
        {turns.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('emptyHint')}</p>
        )}
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className='flex justify-end'>
              <p className='bg-primary text-primary-foreground max-w-[80%] rounded-lg px-3 py-2 text-sm'>
                {turn.text}
              </p>
            </div>
          ) : (
            <div key={i} className='space-y-3'>
              {turn.assistant?.text && (
                <p className='bg-card max-w-[90%] rounded-lg border px-3 py-2 text-sm'>
                  {turn.assistant.text}
                </p>
              )}
              {turn.assistant && turn.assistant.questions.length > 0 && (
                <div className='bg-card max-w-[90%] rounded-lg border px-3 py-2 text-sm'>
                  <ul className='list-disc space-y-1 pl-5'>
                    {turn.assistant.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
              {turn.assistant && turn.assistant.offers.length > 0 && (
                <div className='grid gap-3 sm:grid-cols-2'>
                  {turn.assistant.offers.map((offer) => (
                    <OfferCard key={offer.id} offer={offer} />
                  ))}
                </div>
              )}
              {turn.assistant?.partial && turn.assistant.offers.length > 0 && (
                <p className='text-muted-foreground text-xs'>{t('partialNote')}</p>
              )}
              {turn.assistant?.sourcing && (
                <p className='bg-card max-w-[90%] rounded-lg border px-3 py-2 text-sm'>
                  {t('sourcingCreated', { query: turn.assistant.sourcing.query })}
                </p>
              )}
              {turn.assistant?.error && (
                <p className='text-destructive text-sm'>{turn.assistant.error}</p>
              )}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          disabled={busy}
          className='bg-card min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2'
        />
        <button
          type='submit'
          disabled={busy || input.trim().length === 0}
          className='bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50'
        >
          {t('send')}
        </button>
      </form>
    </div>
  );
}
