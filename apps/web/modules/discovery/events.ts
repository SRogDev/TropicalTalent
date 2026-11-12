/**
 * Discovery SSE events (Phase 3).
 *
 * The AI streams structured events through POST /api/discovery (the
 * server-side proxy to the AI service's POST /api/agent). The contract
 * is docs/architecture/ai-orchestration.md §2 (spec O12): one SSE line
 * per event, `data: {"type": ..., "content": ...}`.
 *
 * These helpers are the testable part of the seam: they turn unknown
 * wire payloads into typed events, or null. A malformed line never
 * crashes the chat, and an event never invents an offer — an offer
 * that fails validation is dropped, not repaired with invented fields.
 */

import type { Offer, Provider } from '@/modules/catalog/types';

export type DiscoveryEvent =
  | { type: 'conversation_id'; content: string }
  | { type: 'message'; content: string }
  | {
      type: 'clarification';
      content: { questions: string[]; partialOffers: Offer[] };
    }
  | {
      type: 'offers';
      content: { offers: Offer[]; query: string; partial: boolean };
    }
  | {
      type: 'sourcing_request';
      content: { id: string; status: string; query: string };
    }
  | { type: 'profiles'; content: unknown }
  | { type: 'search_log'; content: { log_id: string | null } }
  | { type: 'error'; content: { message: string } }
  | { type: 'done'; content: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate one wire offer into the catalog `Offer` shape. Returns null
 * when a required field is missing or wrong-typed — the caller drops
 * it rather than showing a half-invented card.
 */
function parseOffer(value: unknown): Offer | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (
    value.category !== 'talent' &&
    value.category !== 'services' &&
    value.category !== 'products'
  ) {
    return null;
  }
  if (typeof value.title !== 'string' || value.title.length === 0) return null;
  const provider: Pick<
    Provider,
    'displayName' | 'kind' | 'city' | 'country' | 'languages' | 'verificationStatus'
  > | null = isRecord(value.provider)
    ? {
        displayName:
          typeof value.provider.displayName === 'string'
            ? value.provider.displayName
            : '',
        kind: value.provider.kind === 'business' ? 'business' : 'individual',
        city: typeof value.provider.city === 'string' ? value.provider.city : null,
        country:
          typeof value.provider.country === 'string' ? value.provider.country : 'Cuba',
        languages: Array.isArray(value.provider.languages)
          ? value.provider.languages.filter((l): l is string => typeof l === 'string')
          : [],
        verificationStatus:
          value.provider.verificationStatus === 'verified' ||
          value.provider.verificationStatus === 'in_review' ||
          value.provider.verificationStatus === 'rejected'
            ? value.provider.verificationStatus
            : 'pending',
      }
    : null;
  return {
    id: value.id,
    providerId: typeof value.providerId === 'string' ? value.providerId : '',
    category: value.category,
    status:
      value.status === 'draft' || value.status === 'archived' ? value.status : 'published',
    title: value.title,
    description: typeof value.description === 'string' ? value.description : '',
    skills: Array.isArray(value.skills)
      ? value.skills.filter((s): s is string => typeof s === 'string')
      : [],
    languages: Array.isArray(value.languages)
      ? value.languages.filter((l): l is string => typeof l === 'string')
      : [],
    city: typeof value.city === 'string' ? value.city : null,
    country: typeof value.country === 'string' ? value.country : 'Cuba',
    availabilityStatus:
      value.availabilityStatus === 'limited' || value.availabilityStatus === 'unavailable'
        ? value.availabilityStatus
        : 'available',
    quantityAvailable:
      typeof value.quantityAvailable === 'number' ? value.quantityAvailable : null,
    quantityUnit: typeof value.quantityUnit === 'string' ? value.quantityUnit : null,
    productionCapacity: isRecord(value.productionCapacity) ? value.productionCapacity : null,
    pricingBasis:
      value.pricingBasis === 'hour' ||
      value.pricingBasis === 'project' ||
      value.pricingBasis === 'unit'
        ? value.pricingBasis
        : 'quote',
    priceAmount: typeof value.priceAmount === 'number' ? value.priceAmount : null,
    priceCurrency: typeof value.priceCurrency === 'string' ? value.priceCurrency : 'USD',
    originCountry: typeof value.originCountry === 'string' ? value.originCountry : null,
    originVerified: value.originVerified === true,
    madeInCuba: value.madeInCuba === true,
    verificationStatus:
      value.verificationStatus === 'verified' ||
      value.verificationStatus === 'in_review' ||
      value.verificationStatus === 'rejected'
        ? value.verificationStatus
        : 'pending',
    attributes: isRecord(value.attributes) ? value.attributes : {},
    searchIndexedAt:
      typeof value.searchIndexedAt === 'string' ? value.searchIndexedAt : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    provider,
  };
}

/** Parse one decoded SSE payload into a typed event, or null. */
export function parseDiscoveryEvent(value: unknown): DiscoveryEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const content = value.content;
  switch (value.type) {
    case 'conversation_id':
      return typeof content === 'string' ? { type: 'conversation_id', content } : null;
    case 'message':
      return typeof content === 'string' ? { type: 'message', content } : null;
    case 'done':
      return typeof content === 'string' ? { type: 'done', content } : null;
    case 'error':
      return isRecord(content) && typeof content.message === 'string'
        ? { type: 'error', content: { message: content.message } }
        : null;
    case 'clarification': {
      if (!isRecord(content) || !Array.isArray(content.questions)) return null;
      const questions = content.questions.filter(
        (q): q is string => typeof q === 'string',
      );
      const partialOffers = Array.isArray(content.partial_offers)
        ? content.partial_offers
            .map((o) => parseOffer(o))
            .filter((o): o is Offer => o !== null)
        : [];
      return { type: 'clarification', content: { questions, partialOffers } };
    }
    case 'offers': {
      if (!isRecord(content) || !Array.isArray(content.offers)) return null;
      const offers = content.offers
        .map((o) => parseOffer(o))
        .filter((o): o is Offer => o !== null);
      return {
        type: 'offers',
        content: {
          offers,
          query: typeof content.query === 'string' ? content.query : '',
          partial: content.partial === true,
        },
      };
    }
    case 'sourcing_request':
      return isRecord(content) &&
        typeof content.id === 'string' &&
        typeof content.status === 'string' &&
        typeof content.query === 'string'
        ? {
            type: 'sourcing_request',
            content: { id: content.id, status: content.status, query: content.query },
          }
        : null;
    case 'profiles':
      return { type: 'profiles', content };
    case 'search_log':
      return isRecord(content)
        ? {
            type: 'search_log',
            content: { log_id: typeof content.log_id === 'string' ? content.log_id : null },
          }
        : null;
    default:
      return null;
  }
}

/** Split one raw SSE body into typed events, skipping junk lines. */
export function parseDiscoveryStream(body: string): DiscoveryEvent[] {
  const events: DiscoveryEvent[] = [];
  for (const chunk of body.split('\n\n')) {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed.slice('data:'.length).trim());
        const event = parseDiscoveryEvent(parsed);
        if (event) events.push(event);
      } catch {
        // Malformed JSON line: skip, never crash.
      }
    }
  }
  return events;
}

/** Concatenate the message chunks of a turn, in order. */
export function collectDiscoveryText(events: DiscoveryEvent[]): string {
  return events
    .filter((e): e is { type: 'message'; content: string } => e.type === 'message')
    .map((e) => e.content)
    .join('');
}
