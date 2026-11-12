/**
 * Commercial operations types (Phase 4).
 *
 * The Cubora commercial operation is the negotiation. One negotiation is
 * one buyer, one provider, and optionally one offer or one sourcing
 * request — the thing Cubora mediates from first contact to agreed
 * operation. Proposals, contact releases, fees, compliance reviews, and
 * the audit trail all hang off it.
 *
 * What this module deliberately does NOT decide (spec OPEN O1–O5, Roger
 * decides): the fee model (fixed / percentage / hybrid), what counts as
 * "securing a contact", when the fee becomes payable, the contact-release
 * conditions, and the payment/compliance route. The shapes below record
 * what ops enters and what ops attests — fee type and amount are
 * nullable, the release record captures the conditions ops says were
 * met, and nothing here invents the policy. See
 * docs/product/commercial-model.md.
 *
 * Money: there is no payment rail in the MVP (no Stripe, no escrow, no
 * custody of funds). A fee record is a record, not a charge.
 */

export type NegotiationStatus =
  | 'open'
  | 'proposal'
  | 'awaiting_acceptance'
  | 'accepted'
  | 'contact_released'
  | 'completed'
  | 'cancelled'
  | 'blocked';

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'superseded';

/** The plan's own three words for a fee model (spec O1) — or nothing yet. */
export type FeeType = 'fixed' | 'percentage' | 'hybrid';

export type FeeStatus = 'recorded' | 'void';

export type ComplianceStatus = 'open' | 'reviewing' | 'blocked' | 'cleared' | 'escalated';

/** Which side of a negotiation the viewer is on. Ops is neither. */
export type NegotiationSide = 'consumer' | 'provider';

/** One commercial operation (tropical_negotiations). */
export interface Negotiation {
  id: string;
  sourcingRequestId: string | null;
  consumerId: string;
  providerId: string;
  offerId: string | null;
  status: NegotiationStatus;
  /** Workspace opened by ops when the operation was activated, if any. */
  activatedProjectId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Joined context, when the query asked for it. */
  consumerName?: string | null;
  providerDisplayName?: string | null;
  offerTitle?: string | null;
  sourcingQuery?: string | null;
}

/** One message inside a mediated negotiation (tropical_negotiation_messages). */
export interface NegotiationMessage {
  id: string;
  negotiationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  senderName?: string | null;
}

/**
 * One commercial proposal / quotation (tropical_proposals).
 *
 * `terms` is the proposal's own content — scope, deliverables, price
 * basis and amount as the author wrote them — not Cubora's fee. The fee
 * lives on `FeeRecord`, per operation, and is a separate ops decision.
 */
export interface Proposal {
  id: string;
  negotiationId: string;
  createdBy: string;
  authorRole: 'consumer' | 'provider' | 'ops';
  title: string;
  summary: string;
  terms: Record<string, unknown>;
  status: ProposalStatus;
  consumerAccepted: boolean;
  providerAccepted: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The contact-release approval record (tropical_contact_releases).
 *
 * One row per negotiation. `conditionsSummary` is what ops attested was
 * met, in ops' own words — it records the decision, it does not define
 * the policy (spec OPEN O4: the release conditions themselves are still
 * Roger's decision). The two booleans are independent: releasing the
 * consumer's contact does not release the provider's.
 */
export interface ContactRelease {
  id: string;
  negotiationId: string;
  approvedBy: string;
  conditionsSummary: string;
  consumerContactReleased: boolean;
  providerContactReleased: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One intermediation fee record (tropical_fees).
 *
 * Type, amount, currency, and basis are ALL nullable: until Roger
 * decides the fee model (spec O1–O3), a record may carry only a note
 * about what was agreed, or nothing at all. Nothing in this module
 * supplies a default — no percentage, no amount, no currency.
 */
export interface FeeRecord {
  id: string;
  negotiationId: string;
  feeType: FeeType | null;
  feeAmount: number | null;
  feeCurrency: string | null;
  feeBasis: string | null;
  status: FeeStatus;
  recordedBy: string | null;
  notes: string | null;
  createdAt: string;
}

/** One compliance review / blocked case (tropical_compliance_reviews). */
export interface ComplianceReview {
  id: string;
  entityType: 'negotiation' | 'provider' | 'sourcing_request';
  entityId: string;
  status: ComplianceStatus;
  reason: string;
  notes: string | null;
  reviewedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** One audit-trail row for a commercial event (tropical_operation_events). */
export interface OperationEvent {
  id: string;
  negotiationId: string | null;
  eventType: string;
  actorId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** One sourcing request as the ops queue sees it. */
export interface SourcingQueueRow {
  id: string;
  userId: string;
  query: string;
  requirements: Record<string, unknown>;
  status: 'open' | 'matched' | 'notified';
  conversationId: string | null;
  requesterName: string | null;
  createdAt: string;
}

/** One pending "notify when available" row as the ops queue sees it. */
export interface PendingNotificationRow {
  id: string;
  sourcingRequestId: string;
  userId: string;
  channel: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt: string | null;
  sentBy: string | null;
  sentNote: string | null;
  requestQuery: string | null;
  createdAt: string;
}
