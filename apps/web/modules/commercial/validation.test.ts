/**
 * RED tests — Phase 4 commercial validation (modules/commercial).
 *
 * The rules under test, before any implementation exists:
 * - The negotiation status machine allows only the listed transitions, and
 *   ops drives every transition (the DB trigger enforces the ops-only part).
 * - A fee record never invents a type, amount, or currency: all three are
 *   nullable, an empty input stays null, a negative amount is rejected, and
 *   a fee type outside the plan's own three words (fixed / percentage /
 *   hybrid) is rejected. There is no default fee anywhere.
 * - Contact-release visibility is derived from the approval record, never
 *   assumed: without a release row nothing is released; a release for one
 *   side does not release the other side.
 * - A proposal counts as accepted by both parties only when both flags are
 *   set; one flag is not acceptance.
 * - Requesting a quotation needs the consumer capability, a published
 *   offer, and an offer that is not the requester's own — a provider
 *   cannot negotiate with themselves.
 */

import { describe, expect, test } from 'bun:test';

import {
  NEGOTIATION_TRANSITIONS,
  bothPartiesAccepted,
  canRequestQuotation,
  canTransitionNegotiation,
  formatFeeForDisplay,
  parseFeeInput,
  releaseStateFor,
} from './validation';
import type { ContactRelease, FeeRecord, Proposal } from './types';

describe('canTransitionNegotiation', () => {
  test('open can move to proposal, cancelled, or blocked — nothing else', () => {
    expect(canTransitionNegotiation('open', 'proposal')).toBe(true);
    expect(canTransitionNegotiation('open', 'cancelled')).toBe(true);
    expect(canTransitionNegotiation('open', 'blocked')).toBe(true);
    expect(canTransitionNegotiation('open', 'accepted')).toBe(false);
    expect(canTransitionNegotiation('open', 'contact_released')).toBe(false);
    expect(canTransitionNegotiation('open', 'completed')).toBe(false);
  });

  test('a proposal goes to awaiting_acceptance, or back to proposal from it', () => {
    expect(canTransitionNegotiation('proposal', 'awaiting_acceptance')).toBe(true);
    expect(canTransitionNegotiation('awaiting_acceptance', 'accepted')).toBe(true);
    expect(canTransitionNegotiation('awaiting_acceptance', 'proposal')).toBe(true);
    expect(canTransitionNegotiation('awaiting_acceptance', 'contact_released')).toBe(false);
  });

  test('accepted moves to contact_released or completed; completed is terminal', () => {
    expect(canTransitionNegotiation('accepted', 'contact_released')).toBe(true);
    expect(canTransitionNegotiation('accepted', 'completed')).toBe(true);
    expect(canTransitionNegotiation('completed', 'open')).toBe(false);
    expect(canTransitionNegotiation('cancelled', 'open')).toBe(false);
  });

  test('blocked unblocks back to open, or cancels', () => {
    expect(canTransitionNegotiation('blocked', 'open')).toBe(true);
    expect(canTransitionNegotiation('blocked', 'cancelled')).toBe(true);
    expect(canTransitionNegotiation('blocked', 'accepted')).toBe(false);
  });

  test('the transition map lists every status', () => {
    const statuses = [
      'open',
      'proposal',
      'awaiting_acceptance',
      'accepted',
      'contact_released',
      'completed',
      'cancelled',
      'blocked',
    ] as const;
    for (const status of statuses) {
      expect(Object.keys(NEGOTIATION_TRANSITIONS)).toContain(status);
    }
  });
});

describe('parseFeeInput', () => {
  test('empty input records nothing — no invented type, amount, or currency', () => {
    const parsed = parseFeeInput({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.feeType).toBeNull();
    expect(parsed.value.feeAmount).toBeNull();
    expect(parsed.value.feeCurrency).toBeNull();
    expect(parsed.value.feeBasis).toBeNull();
  });

  test('records exactly what ops entered, and nothing else', () => {
    const parsed = parseFeeInput({
      feeType: 'fixed',
      feeAmount: '250',
      feeCurrency: 'USD',
      feeBasis: 'per operation',
      notes: 'Agreed on the call.',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      feeType: 'fixed',
      feeAmount: 250,
      feeCurrency: 'USD',
      feeBasis: 'per operation',
      notes: 'Agreed on the call.',
    });
  });

  test('a percentage fee without an amount is still a valid record', () => {
    const parsed = parseFeeInput({ feeType: 'percentage', feeAmount: '' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.feeType).toBe('percentage');
    expect(parsed.value.feeAmount).toBeNull();
  });

  test('rejects a negative amount', () => {
    expect(parseFeeInput({ feeAmount: '-5' }).ok).toBe(false);
  });

  test('rejects a non-numeric amount', () => {
    expect(parseFeeInput({ feeAmount: 'soon' }).ok).toBe(false);
  });

  test('rejects a fee type outside the plan’s own three words', () => {
    expect(parseFeeInput({ feeType: 'commission' }).ok).toBe(false);
    expect(parseFeeInput({ feeType: '15%' }).ok).toBe(false);
  });

  test('blank strings become null, never an empty-string record', () => {
    const parsed = parseFeeInput({ feeCurrency: '  ', feeBasis: '' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.feeCurrency).toBeNull();
    expect(parsed.value.feeBasis).toBeNull();
  });
});

describe('formatFeeForDisplay', () => {
  test('a fee with nothing set says so — it never shows a default', () => {
    const fee: FeeRecord = {
      id: 'fee-1',
      negotiationId: 'neg-1',
      feeType: null,
      feeAmount: null,
      feeCurrency: null,
      feeBasis: null,
      status: 'recorded',
      recordedBy: null,
      notes: null,
      createdAt: '2026-11-12T00:00:00Z',
    };
    expect(formatFeeForDisplay(fee)).toBe('Not set');
  });

  test('shows what was recorded, in the order type · amount currency', () => {
    const fee: FeeRecord = {
      id: 'fee-1',
      negotiationId: 'neg-1',
      feeType: 'fixed',
      feeAmount: 250,
      feeCurrency: 'USD',
      feeBasis: null,
      status: 'recorded',
      recordedBy: null,
      notes: null,
      createdAt: '2026-11-12T00:00:00Z',
    };
    expect(formatFeeForDisplay(fee)).toBe('fixed · 250 USD');
  });

  test('a void fee is labelled void', () => {
    const fee: FeeRecord = {
      id: 'fee-1',
      negotiationId: 'neg-1',
      feeType: 'percentage',
      feeAmount: null,
      feeCurrency: null,
      feeBasis: 'operation value',
      status: 'void',
      recordedBy: null,
      notes: null,
      createdAt: '2026-11-12T00:00:00Z',
    };
    expect(formatFeeForDisplay(fee)).toBe('percentage · void');
  });

  test('the not-set and void words can be supplied in the UI locale', () => {
    const empty: FeeRecord = {
      id: 'fee-1',
      negotiationId: 'neg-1',
      feeType: null,
      feeAmount: null,
      feeCurrency: null,
      feeBasis: null,
      status: 'recorded',
      recordedBy: null,
      notes: null,
      createdAt: '2026-11-12T00:00:00Z',
    };
    expect(formatFeeForDisplay(empty, { notSet: 'Sin definir', void: 'anulado' })).toBe(
      'Sin definir',
    );
    const voidFee: FeeRecord = { ...empty, feeType: 'fixed', status: 'void' };
    expect(formatFeeForDisplay(voidFee, { notSet: 'Sin definir', void: 'anulado' })).toBe(
      'fixed · anulado',
    );
  });
});

describe('releaseStateFor', () => {
  const base: ContactRelease = {
    id: 'rel-1',
    negotiationId: 'neg-1',
    approvedBy: 'ops-1',
    conditionsSummary: 'Both parties accepted the proposal in writing.',
    consumerContactReleased: true,
    providerContactReleased: false,
    notes: null,
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
  };

  test('no release row means nothing is released for either side', () => {
    expect(releaseStateFor(null, 'consumer')).toBe('not_released');
    expect(releaseStateFor(null, 'provider')).toBe('not_released');
  });

  test('a release for the consumer does not release the provider', () => {
    expect(releaseStateFor(base, 'consumer')).toBe('released');
    expect(releaseStateFor(base, 'provider')).toBe('not_released');
  });

  test('both sides released only when both flags are set', () => {
    const both = { ...base, providerContactReleased: true };
    expect(releaseStateFor(both, 'consumer')).toBe('released');
    expect(releaseStateFor(both, 'provider')).toBe('released');
  });
});

describe('canRequestQuotation', () => {
  const base = {
    canBrand: true,
    offerStatus: 'published',
    ownProviderIds: ['prov-me'],
    offerProviderId: 'prov-other',
  };

  test('a consumer requesting a quotation on someone else’s published offer passes', () => {
    expect(canRequestQuotation(base)).toBeNull();
  });

  test('a provider-only account cannot request a quotation', () => {
    expect(canRequestQuotation({ ...base, canBrand: false })).toBe(
      'Activate buying before requesting a quotation.',
    );
  });

  test('only a published offer can start a negotiation', () => {
    expect(canRequestQuotation({ ...base, offerStatus: 'draft' })).toBe(
      'Only a published offer can start a negotiation.',
    );
  });

  test('a provider cannot open a negotiation on their own offer', () => {
    expect(canRequestQuotation({ ...base, offerProviderId: 'prov-me' })).toBe(
      'You cannot open a negotiation on your own offer.',
    );
  });
});

describe('bothPartiesAccepted', () => {
  const proposal = (overrides: Partial<Proposal>): Proposal => ({
    id: 'prop-1',
    negotiationId: 'neg-1',
    createdBy: 'user-1',
    authorRole: 'ops',
    title: 'Proposal',
    summary: '',
    terms: {},
    status: 'sent',
    consumerAccepted: false,
    providerAccepted: false,
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    ...overrides,
  });

  test('one flag is not acceptance', () => {
    expect(bothPartiesAccepted(proposal({ consumerAccepted: true }))).toBe(false);
    expect(bothPartiesAccepted(proposal({ providerAccepted: true }))).toBe(false);
  });

  test('both flags set is acceptance', () => {
    expect(bothPartiesAccepted(proposal({ consumerAccepted: true, providerAccepted: true }))).toBe(
      true,
    );
  });
});
