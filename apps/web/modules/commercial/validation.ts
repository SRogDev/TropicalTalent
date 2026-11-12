/**
 * Pure commercial validation (Phase 4).
 *
 * No I/O, no database, no defaults invented here. The state machine and
 * the fee parsing are the rules the server actions and the migration
 * enforce together: the actions check them in code, the migration's
 * CHECKs and guard triggers check them at the database.
 */

import type {
  ContactRelease,
  FeeRecord,
  FeeType,
  NegotiationSide,
  NegotiationStatus,
  Proposal,
} from './types';

/**
 * The negotiation state machine (Cubora's own — it replaces the
 * escrow-funded transitions the workspace used to key off; see
 * docs/product/commercial-model.md §3).
 *
 * Ops drives every transition (the 056 trigger rejects status changes
 * from the `authenticated` role). Parties signal intent on proposals —
 * the acceptance flags — and ops moves the negotiation.
 */
export const NEGOTIATION_TRANSITIONS: Record<NegotiationStatus, NegotiationStatus[]> = {
  open: ['proposal', 'cancelled', 'blocked'],
  proposal: ['awaiting_acceptance', 'cancelled', 'blocked'],
  awaiting_acceptance: ['accepted', 'proposal', 'cancelled', 'blocked'],
  accepted: ['contact_released', 'completed', 'cancelled', 'blocked'],
  contact_released: ['completed', 'cancelled', 'blocked'],
  completed: [],
  cancelled: [],
  blocked: ['open', 'cancelled'],
};

export function isValidNegotiationStatus(value: unknown): value is NegotiationStatus {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(NEGOTIATION_TRANSITIONS, value)
  );
}

export function canTransitionNegotiation(from: NegotiationStatus, to: NegotiationStatus): boolean {
  return (NEGOTIATION_TRANSITIONS[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Fee records — everything nullable, nothing defaulted
// ---------------------------------------------------------------------------

export const FEE_TYPES: readonly FeeType[] = ['fixed', 'percentage', 'hybrid'];

export interface FeeInput {
  feeType: FeeType | null;
  feeAmount: number | null;
  feeCurrency: string | null;
  feeBasis: string | null;
  notes: string | null;
}

export type FeeParseResult = { ok: true; value: FeeInput } | { ok: false; error: string };

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Parse what ops typed into a fee record. An absent field stays null —
 * it is never filled with a default type, amount, or currency. A fee
 * type outside the plan's own three words is rejected, as is a negative
 * or non-numeric amount.
 */
export function parseFeeInput(input: {
  feeType?: unknown;
  feeAmount?: unknown;
  feeCurrency?: unknown;
  feeBasis?: unknown;
  notes?: unknown;
}): FeeParseResult {
  const rawType = cleanText(input.feeType);
  if (rawType !== null && !(FEE_TYPES as readonly string[]).includes(rawType)) {
    return { ok: false, error: 'Fee type must be fixed, percentage, or hybrid — or left unset.' };
  }

  const rawAmount = cleanText(input.feeAmount);
  let feeAmount: number | null = null;
  if (rawAmount !== null) {
    feeAmount = Number(rawAmount);
    if (!Number.isFinite(feeAmount) || feeAmount < 0) {
      return { ok: false, error: 'Fee amount must be a number of zero or more, or left unset.' };
    }
  }

  const feeCurrency = cleanText(input.feeCurrency);
  if (feeCurrency !== null && feeCurrency.length > 16) {
    return { ok: false, error: 'Fee currency is too long.' };
  }

  return {
    ok: true,
    value: {
      feeType: (rawType as FeeType | null) ?? null,
      feeAmount,
      feeCurrency,
      feeBasis: cleanText(input.feeBasis),
      notes: cleanText(input.notes),
    },
  };
}

/**
 * What the UI shows for a fee record. A record with nothing set says
 * "Not set" — it never renders a default amount, type, or currency.
 * A void record is labelled void rather than shown as a live fee.
 *
 * The two user-facing words ("Not set", "void") can be supplied in the
 * UI locale; the defaults keep the admin overview — which stays
 * English — unchanged.
 */
export function formatFeeForDisplay(
  fee: FeeRecord,
  labels: { notSet?: string; void?: string } = {},
): string {
  const notSet = labels.notSet ?? 'Not set';
  const voidWord = labels.void ?? 'void';
  if (fee.status === 'void') {
    const type = fee.feeType ?? 'fee';
    return `${type} · ${voidWord}`;
  }
  const parts: string[] = [];
  if (fee.feeType) parts.push(fee.feeType);
  if (fee.feeAmount !== null) {
    parts.push(fee.feeCurrency ? `${fee.feeAmount} ${fee.feeCurrency}` : `${fee.feeAmount}`);
  }
  if (fee.feeBasis) parts.push(`on ${fee.feeBasis}`);
  return parts.length === 0 ? notSet : parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Contact release — derived from the approval record, never assumed
// ---------------------------------------------------------------------------

export type ReleaseState = 'released' | 'not_released';

/**
 * Whether this side's contact is released, from the approval record.
 * No record means nothing is released. One side's release never implies
 * the other's.
 */
export function releaseStateFor(
  release: ContactRelease | null,
  side: NegotiationSide,
): ReleaseState {
  if (!release) return 'not_released';
  const released =
    side === 'consumer' ? release.consumerContactReleased : release.providerContactReleased;
  return released ? 'released' : 'not_released';
}

// ---------------------------------------------------------------------------
// Requesting a quotation — who may open a negotiation from an offer
// ---------------------------------------------------------------------------

/**
 * The guard for opening a negotiation from a published offer.
 *
 * Three checks, in the order the action reports them: the requester
 * holds the consumer capability (buying), the offer is published, and
 * the offer is not the requester's own — a provider negotiating with
 * themselves could accept both sides and drive their own operation
 * through contact release. Returns the user-facing refusal, or null
 * when the request may proceed.
 */
export function canRequestQuotation(input: {
  canBrand: boolean;
  offerStatus: string;
  ownProviderIds: string[];
  offerProviderId: string;
}): string | null {
  if (!input.canBrand) return 'Activate buying before requesting a quotation.';
  if (input.offerStatus !== 'published') {
    return 'Only a published offer can start a negotiation.';
  }
  if (input.ownProviderIds.includes(input.offerProviderId)) {
    return 'You cannot open a negotiation on your own offer.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** Both parties accepted only when both flags are set — one is not enough. */
export function bothPartiesAccepted(proposal: Proposal): boolean {
  return proposal.consumerAccepted && proposal.providerAccepted;
}
