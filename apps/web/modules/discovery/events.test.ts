import { describe, expect, test } from 'bun:test';
import {
  collectDiscoveryText,
  parseDiscoveryEvent,
  parseDiscoveryStream,
} from './events';
import type { Offer } from '@/modules/catalog/types';

/**
 * Discovery SSE events (Phase 3).
 *
 * The AI streams structured events (docs/architecture/ai-orchestration.md
 * §2, O12 contract) through POST /api/discovery. The parser below is the
 * testable part of that seam: it turns unknown wire payloads into typed
 * events, or null — a malformed line must never crash the chat, and an
 * event must never invent an offer.
 */

const OFFER: Offer = {
  id: 'offer-1',
  providerId: 'prov-1',
  category: 'products',
  status: 'published',
  title: 'Cuban coffee',
  description: 'Arabica, 500 kg/month.',
  skills: ['coffee'],
  languages: ['es', 'en'],
  city: 'Santiago de Cuba',
  country: 'Cuba',
  availabilityStatus: 'available',
  quantityAvailable: 500,
  quantityUnit: 'kg',
  productionCapacity: { monthly_amount: 500, unit: 'kg' },
  pricingBasis: 'unit',
  priceAmount: 12.5,
  priceCurrency: 'USD',
  originCountry: 'Cuba',
  originVerified: true,
  madeInCuba: true,
  verificationStatus: 'verified',
  attributes: {},
  searchIndexedAt: null,
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  provider: {
    displayName: 'Café Sierra',
    kind: 'business',
    city: 'Santiago de Cuba',
    country: 'Cuba',
    languages: ['es'],
    verificationStatus: 'verified',
  },
};

describe('parseDiscoveryEvent', () => {
  test('parses a conversation_id event', () => {
    expect(parseDiscoveryEvent({ type: 'conversation_id', content: 'conv-1' })).toEqual({
      type: 'conversation_id',
      content: 'conv-1',
    });
  });

  test('parses a message chunk', () => {
    expect(parseDiscoveryEvent({ type: 'message', content: 'Hello' })).toEqual({
      type: 'message',
      content: 'Hello',
    });
  });

  test('parses an offers event into Offer cards', () => {
    const event = parseDiscoveryEvent({
      type: 'offers',
      content: { offers: [OFFER], query: 'coffee', partial: false },
    });
    expect(event?.type).toBe('offers');
    if (event?.type === 'offers') {
      expect(event.content.offers).toHaveLength(1);
      expect(event.content.offers[0].title).toBe('Cuban coffee');
      expect(event.content.partial).toBe(false);
    }
  });

  test('parses a clarification with questions and partial offers', () => {
    const event = parseDiscoveryEvent({
      type: 'clarification',
      content: { questions: ['Talent, service, or product?'], partial_offers: [OFFER] },
    });
    expect(event?.type).toBe('clarification');
    if (event?.type === 'clarification') {
      expect(event.content.questions).toEqual(['Talent, service, or product?']);
      expect(event.content.partialOffers).toHaveLength(1);
    }
  });

  test('parses a sourcing-request event', () => {
    const event = parseDiscoveryEvent({
      type: 'sourcing_request',
      content: { id: 'sr-1', status: 'open', query: 'rare cacao' },
    });
    expect(event).toEqual({
      type: 'sourcing_request',
      content: { id: 'sr-1', status: 'open', query: 'rare cacao' },
    });
  });

  test('parses done and error', () => {
    expect(parseDiscoveryEvent({ type: 'done', content: 'end' })).toEqual({
      type: 'done',
      content: 'end',
    });
    expect(parseDiscoveryEvent({ type: 'error', content: { message: 'boom' } })?.type).toBe(
      'error',
    );
  });

  test('rejects unknown types, wrong shapes, and non-objects', () => {
    expect(parseDiscoveryEvent({ type: 'teleport', content: 1 })).toBeNull();
    expect(parseDiscoveryEvent({ type: 'message', content: 42 })).toBeNull();
    expect(parseDiscoveryEvent({ type: 'offers', content: { offers: 'nope' } })).toBeNull();
    expect(parseDiscoveryEvent(null)).toBeNull();
    expect(parseDiscoveryEvent('data: {}')).toBeNull();
    // A malformed offer is dropped, not fatal: the event survives empty.
    const dropped = parseDiscoveryEvent({
      type: 'offers',
      content: { offers: [{ id: 1 }] },
    });
    expect(dropped?.type).toBe('offers');
    if (dropped?.type === 'offers') expect(dropped.content.offers).toEqual([]);
  });

  test('drops malformed offers instead of inventing them', () => {
    const event = parseDiscoveryEvent({
      type: 'offers',
      content: { offers: [OFFER, { id: 'bad' }], query: 'coffee', partial: false },
    });
    if (event?.type === 'offers') {
      expect(event.content.offers).toHaveLength(1);
    } else {
      throw new Error('expected offers event');
    }
  });
});

describe('parseDiscoveryStream', () => {
  test('splits a raw SSE body into events, skipping heartbeats and junk', () => {
    const body =
      'data: {"type":"message","content":"Hi"}\n\n' +
      ': heartbeat\n\n' +
      'data: not-json\n\n' +
      'data: {"type":"done","content":"end"}\n\n';
    const events = parseDiscoveryStream(body);
    expect(events).toEqual([
      { type: 'message', content: 'Hi' },
      { type: 'done', content: 'end' },
    ]);
  });
});

describe('collectDiscoveryText', () => {
  test('concatenates message chunks in order', () => {
    expect(
      collectDiscoveryText([
        { type: 'message', content: 'Hello ' },
        { type: 'message', content: 'buyer.' },
        { type: 'done', content: 'end' },
      ]),
    ).toBe('Hello buyer.');
  });
});
