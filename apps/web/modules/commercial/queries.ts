import 'server-only';

import { cache } from 'react';
import { adminDb, db } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { requireAdminScope } from '@/modules/admin/queries';
import type {
  ComplianceReview,
  ContactRelease,
  FeeRecord,
  Negotiation,
  NegotiationMessage,
  OperationEvent,
  PendingNotificationRow,
  Proposal,
  SourcingQueueRow,
} from './types';
import { formatFeeForDisplay } from './validation';

/**
 * Commercial operations reads (Phase 4).
 *
 * Two sides, two clients, same rule as the catalog (modules/catalog):
 * ops reads go through `adminDb()` behind `requireAdminScope()`; party
 * reads go through the RLS session client (`db()`), so a consumer or
 * provider only ever sees their own negotiations. The RLS policies in
 * migration 056 are the enforcement; these loaders only shape rows.
 *
 * Scoped (white-label) admins get empty queues, like the supplier list:
 * providers and negotiations are deployment-global, not tenant-scoped
 * (data-model.md §6), so a scoped admin sees nothing rather than
 * another tenant's operations.
 */

const NEGOTIATION_SELECT =
  'id, sourcing_request_id, consumer_id, provider_id, offer_id, status, activated_project_id, created_at, updated_at';

const PROPOSAL_SELECT =
  'id, negotiation_id, created_by, author_role, title, summary, terms, status, consumer_accepted, provider_accepted, created_at, updated_at';

const FEE_SELECT =
  'id, negotiation_id, fee_type, fee_amount, fee_currency, fee_basis, status, recorded_by, notes, created_at';

function toNegotiation(row: Record<string, unknown>): Negotiation {
  return {
    id: row.id as string,
    sourcingRequestId: (row.sourcing_request_id as string | null) ?? null,
    consumerId: row.consumer_id as string,
    providerId: row.provider_id as string,
    offerId: (row.offer_id as string | null) ?? null,
    status: row.status as Negotiation['status'],
    activatedProjectId: (row.activated_project_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toProposal(row: Record<string, unknown>): Proposal {
  return {
    id: row.id as string,
    negotiationId: row.negotiation_id as string,
    createdBy: row.created_by as string,
    authorRole: row.author_role as Proposal['authorRole'],
    title: row.title as string,
    summary: (row.summary as string) ?? '',
    terms: (row.terms as Record<string, unknown>) ?? {},
    status: row.status as Proposal['status'],
    consumerAccepted: Boolean(row.consumer_accepted),
    providerAccepted: Boolean(row.provider_accepted),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toFee(row: Record<string, unknown>): FeeRecord {
  return {
    id: row.id as string,
    negotiationId: row.negotiation_id as string,
    feeType: (row.fee_type as FeeRecord['feeType']) ?? null,
    feeAmount: row.fee_amount === null ? null : Number(row.fee_amount),
    feeCurrency: (row.fee_currency as string | null) ?? null,
    feeBasis: (row.fee_basis as string | null) ?? null,
    status: row.status as FeeRecord['status'],
    recordedBy: (row.recorded_by as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function toContactRelease(row: Record<string, unknown>): ContactRelease {
  return {
    id: row.id as string,
    negotiationId: row.negotiation_id as string,
    approvedBy: row.approved_by as string,
    conditionsSummary: row.conditions_summary as string,
    consumerContactReleased: Boolean(row.consumer_contact_released),
    providerContactReleased: Boolean(row.provider_contact_released),
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toComplianceReview(row: Record<string, unknown>): ComplianceReview {
  return {
    id: row.id as string,
    entityType: row.entity_type as ComplianceReview['entityType'],
    entityId: row.entity_id as string,
    status: row.status as ComplianceReview['status'],
    reason: row.reason as string,
    notes: (row.notes as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    createdAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
  };
}

function toOperationEvent(row: Record<string, unknown>): OperationEvent {
  return {
    id: row.id as string,
    negotiationId: (row.negotiation_id as string | null) ?? null,
    eventType: row.event_type as string,
    actorId: (row.actor_id as string | null) ?? null,
    detail: (row.detail as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  };
}

/** The two parties of a negotiation, by user id, for display names. */
async function loadPartyNames(
  negotiations: Negotiation[],
): Promise<Map<string, { consumerName: string | null; providerName: string | null }>> {
  const out = new Map<string, { consumerName: string | null; providerName: string | null }>();
  if (negotiations.length === 0) return out;

  const supabase = adminDb();
  const consumerIds = [...new Set(negotiations.map((n) => n.consumerId))];
  const providerIds = [...new Set(negotiations.map((n) => n.providerId))];

  const [{ data: users }, { data: providers }] = await Promise.all([
    supabase.from('users').select('id, name').in('id', consumerIds),
    supabase.from('tropical_providers').select('id, display_name').in('id', providerIds),
  ]);

  const userNames = new Map(
    ((users ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name]),
  );
  const providerNames = new Map(
    ((providers ?? []) as Array<{ id: string; display_name: string }>).map((p) => [
      p.id,
      p.display_name,
    ]),
  );

  for (const n of negotiations) {
    out.set(n.id, {
      consumerName: userNames.get(n.consumerId) ?? null,
      providerName: providerNames.get(n.providerId) ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ops overview
// ---------------------------------------------------------------------------

export interface OpsOverview {
  openRequests: number;
  openNegotiations: number;
  proposalsAwaitingAcceptance: number;
  pendingReleases: number;
  pendingNotifications: number;
  openCompliance: number;
  feeRecords: number;
  /** Human-readable fee lines for the overview; "Not set" when undecided. */
  feeLines: string[];
}

/** The CRM overview counts (plan §9: one coherent ops section). */
export const loadOpsOverview = cache(async (): Promise<OpsOverview> => {
  const { tenantId } = await requireAdminScope();
  if (tenantId !== null) {
    return {
      openRequests: 0,
      openNegotiations: 0,
      proposalsAwaitingAcceptance: 0,
      pendingReleases: 0,
      pendingNotifications: 0,
      openCompliance: 0,
      feeRecords: 0,
      feeLines: [],
    };
  }

  const supabase = adminDb();
  const [
    { count: openRequests },
    { count: openNegotiations },
    { count: proposalsAwaiting },
    { count: pendingNotifications },
    { count: openCompliance },
    { data: fees },
    { data: acceptedNegotiations },
  ] = await Promise.all([
    supabase
      .from('tropical_sourcing_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
    supabase
      .from('tropical_negotiations')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(completed,cancelled)'),
    supabase
      .from('tropical_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent'),
    supabase
      .from('tropical_sourcing_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('tropical_compliance_reviews')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'reviewing', 'blocked']),
    supabase.from('tropical_fees').select(FEE_SELECT).order('created_at', { ascending: false }),
    supabase.from('tropical_negotiations').select('id').eq('status', 'accepted'),
  ]);

  // Negotiations accepted but with no release record yet are the
  // contact-release queue. A release row with both sides unreleased
  // counts too — approval was recorded but nothing was released.
  const { data: releases } = await supabase
    .from('tropical_contact_releases')
    .select('negotiation_id, consumer_contact_released, provider_contact_released')
    .in(
      'negotiation_id',
      (acceptedNegotiations ?? []).map((n) => (n as { id: string }).id),
    );
  const releasedIds = new Set(
    (
      (releases ?? []) as Array<{
        negotiation_id: string;
        consumer_contact_released: boolean;
        provider_contact_released: boolean;
      }>
    )
      .filter((r) => r.consumer_contact_released || r.provider_contact_released)
      .map((r) => r.negotiation_id),
  );
  const pendingReleases = (acceptedNegotiations ?? []).filter(
    (n) => !releasedIds.has((n as { id: string }).id),
  ).length;

  const feeRows = ((fees ?? []) as Array<Record<string, unknown>>).map(toFee);

  return {
    openRequests: openRequests ?? 0,
    openNegotiations: openNegotiations ?? 0,
    proposalsAwaitingAcceptance: proposalsAwaiting ?? 0,
    pendingReleases,
    pendingNotifications: pendingNotifications ?? 0,
    openCompliance: openCompliance ?? 0,
    feeRecords: feeRows.length,
    feeLines: feeRows.slice(0, 5).map((fee) => formatFeeForDisplay(fee)),
  };
});

// ---------------------------------------------------------------------------
// Ops queues
// ---------------------------------------------------------------------------

/** Unmatched sourcing requests, oldest first — the Phase 3 queue, now with a UI. */
export const loadSourcingQueue = cache(async (): Promise<SourcingQueueRow[]> => {
  const { tenantId } = await requireAdminScope();
  if (tenantId !== null) return [];

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_sourcing_requests')
    .select('id, user_id, query, requirements, status, conversation_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) return [];

  const rows = data as unknown as Array<Record<string, unknown>>;
  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
  const names = new Map(
    ((users ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name]),
  );

  return rows.map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    query: r.query as string,
    requirements: (r.requirements as Record<string, unknown>) ?? {},
    status: r.status as SourcingQueueRow['status'],
    conversationId: (r.conversation_id as string | null) ?? null,
    requesterName: names.get(r.user_id as string) ?? null,
    createdAt: r.created_at as string,
  }));
});

/** Verified, published offers ops can match a sourcing request to. */
export interface MatchableOffer {
  id: string;
  title: string;
  category: string;
  providerId: string;
  providerDisplayName: string;
}

export const loadMatchableOffers = cache(async (): Promise<MatchableOffer[]> => {
  const { tenantId } = await requireAdminScope();
  if (tenantId !== null) return [];

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_offers')
    .select(
      'id, title, category, provider_id, provider:tropical_providers!inner(display_name, verification_status)',
    )
    .eq('status', 'published')
    .eq('verification_status', 'verified')
    .eq('provider.verification_status', 'verified')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) return [];

  return (data as unknown as Array<Record<string, unknown>>).map((row) => {
    const provider = one(row.provider as never) as { display_name?: string } | null;
    return {
      id: row.id as string,
      title: row.title as string,
      category: row.category as string,
      providerId: row.provider_id as string,
      providerDisplayName: provider?.display_name ?? 'Unknown provider',
    };
  });
});

/** All negotiations, newest first, with party names. */
export const loadNegotiationsForOps = cache(async (): Promise<Negotiation[]> => {
  const { tenantId } = await requireAdminScope();
  if (tenantId !== null) return [];

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_negotiations')
    .select(NEGOTIATION_SELECT)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data) return [];

  const negotiations = (data as unknown as Array<Record<string, unknown>>).map(toNegotiation);
  const names = await loadPartyNames(negotiations);
  const offerIds = negotiations.map((n) => n.offerId).filter((id): id is string => id !== null);
  const sourcingIds = negotiations
    .map((n) => n.sourcingRequestId)
    .filter((id): id is string => id !== null);
  const [{ data: offers }, { data: requests }] = await Promise.all([
    offerIds.length > 0
      ? supabase.from('tropical_offers').select('id, title').in('id', offerIds)
      : Promise.resolve({ data: [] }),
    sourcingIds.length > 0
      ? supabase.from('tropical_sourcing_requests').select('id, query').in('id', sourcingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const offerTitles = new Map(
    ((offers ?? []) as Array<{ id: string; title: string }>).map((o) => [o.id, o.title]),
  );
  const requestQueries = new Map(
    ((requests ?? []) as Array<{ id: string; query: string }>).map((r) => [r.id, r.query]),
  );

  return negotiations.map((n) => ({
    ...n,
    consumerName: names.get(n.id)?.consumerName ?? null,
    providerDisplayName: names.get(n.id)?.providerName ?? null,
    offerTitle: n.offerId ? (offerTitles.get(n.offerId) ?? null) : null,
    sourcingQuery: n.sourcingRequestId ? (requestQueries.get(n.sourcingRequestId) ?? null) : null,
  }));
});

/** One negotiation with everything ops needs: messages, proposals, release, fees, events. */
export interface NegotiationDetail {
  negotiation: Negotiation;
  messages: NegotiationMessage[];
  proposals: Proposal[];
  release: ContactRelease | null;
  fees: FeeRecord[];
  events: OperationEvent[];
  compliance: ComplianceReview[];
}

export const loadNegotiationDetailForOps = cache(
  async (negotiationId: string): Promise<NegotiationDetail | null> => {
    const { tenantId } = await requireAdminScope();
    if (tenantId !== null) return null;

    const supabase = adminDb();
    const { data, error } = await supabase
      .from('tropical_negotiations')
      .select(NEGOTIATION_SELECT)
      .eq('id', negotiationId)
      .maybeSingle();
    if (error || !data) return null;

    const negotiation = toNegotiation(data as unknown as Record<string, unknown>);
    const names = await loadPartyNames([negotiation]);
    negotiation.consumerName = names.get(negotiation.id)?.consumerName ?? null;
    negotiation.providerDisplayName = names.get(negotiation.id)?.providerName ?? null;

    const [
      { data: messages },
      { data: proposals },
      { data: release },
      { data: fees },
      { data: events },
      { data: compliance },
    ] = await Promise.all([
      supabase
        .from('tropical_negotiation_messages')
        .select('id, negotiation_id, sender_id, content, created_at')
        .eq('negotiation_id', negotiationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('tropical_proposals')
        .select(PROPOSAL_SELECT)
        .eq('negotiation_id', negotiationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('tropical_contact_releases')
        .select(
          'id, negotiation_id, approved_by, conditions_summary, consumer_contact_released, provider_contact_released, notes, created_at, updated_at',
        )
        .eq('negotiation_id', negotiationId)
        .maybeSingle(),
      supabase
        .from('tropical_fees')
        .select(FEE_SELECT)
        .eq('negotiation_id', negotiationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('tropical_operation_events')
        .select('id, negotiation_id, event_type, actor_id, detail, created_at')
        .eq('negotiation_id', negotiationId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('tropical_compliance_reviews')
        .select(
          'id, entity_type, entity_id, status, reason, notes, reviewed_by, created_at, resolved_at',
        )
        .eq('entity_type', 'negotiation')
        .eq('entity_id', negotiationId)
        .order('created_at', { ascending: false }),
    ]);

    const messageRows = (messages ?? []) as Array<Record<string, unknown>>;
    const senderIds = [...new Set(messageRows.map((m) => m.sender_id as string))];
    const { data: senders } =
      senderIds.length > 0
        ? await supabase.from('users').select('id, name').in('id', senderIds)
        : { data: [] };
    const senderNames = new Map(
      ((senders ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name]),
    );

    return {
      negotiation,
      messages: messageRows.map((m) => ({
        id: m.id as string,
        negotiationId: m.negotiation_id as string,
        senderId: m.sender_id as string,
        content: m.content as string,
        createdAt: m.created_at as string,
        senderName: senderNames.get(m.sender_id as string) ?? null,
      })),
      proposals: ((proposals ?? []) as Array<Record<string, unknown>>).map(toProposal),
      release: release ? toContactRelease(release as unknown as Record<string, unknown>) : null,
      fees: ((fees ?? []) as Array<Record<string, unknown>>).map(toFee),
      events: ((events ?? []) as Array<Record<string, unknown>>).map(toOperationEvent),
      compliance: ((compliance ?? []) as Array<Record<string, unknown>>).map(toComplianceReview),
    };
  },
);

/** Fee tracking across all operations, newest first. */
export const loadFeesForOps = cache(
  async (): Promise<Array<FeeRecord & { negotiationId: string }>> => {
    const { tenantId } = await requireAdminScope();
    if (tenantId !== null) return [];

    const supabase = adminDb();
    const { data, error } = await supabase
      .from('tropical_fees')
      .select(FEE_SELECT)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(toFee);
  },
);

/** Compliance reviews / blocked cases, open first. */
export const loadComplianceQueue = cache(async (): Promise<ComplianceReview[]> => {
  const { tenantId } = await requireAdminScope();
  if (tenantId !== null) return [];

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_compliance_reviews')
    .select(
      'id, entity_type, entity_id, status, reason, notes, reviewed_by, created_at, resolved_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toComplianceReview);
});

/** Pending "notify when available" rows — the manual delivery queue. */
export const loadPendingNotifications = cache(async (): Promise<PendingNotificationRow[]> => {
  const { tenantId } = await requireAdminScope();
  if (tenantId !== null) return [];

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_sourcing_notifications')
    .select(
      'id, sourcing_request_id, user_id, channel, status, sent_at, sent_by, sent_note, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data) return [];

  const rows = data as unknown as Array<Record<string, unknown>>;
  const requestIds = [...new Set(rows.map((r) => r.sourcing_request_id as string))];
  const { data: requests } =
    requestIds.length > 0
      ? await supabase.from('tropical_sourcing_requests').select('id, query').in('id', requestIds)
      : { data: [] };
  const queries = new Map(
    ((requests ?? []) as Array<{ id: string; query: string }>).map((r) => [r.id, r.query]),
  );

  return rows.map((r) => ({
    id: r.id as string,
    sourcingRequestId: r.sourcing_request_id as string,
    userId: r.user_id as string,
    channel: r.channel as string,
    status: r.status as PendingNotificationRow['status'],
    sentAt: (r.sent_at as string | null) ?? null,
    sentBy: (r.sent_by as string | null) ?? null,
    sentNote: (r.sent_note as string | null) ?? null,
    requestQuery: queries.get(r.sourcing_request_id as string) ?? null,
    createdAt: r.created_at as string,
  }));
});

// ---------------------------------------------------------------------------
// Party reads (consumer / provider dashboards)
// ---------------------------------------------------------------------------

/** The signed-in user's negotiations, both as consumer and as provider. */
export const loadMyNegotiations = cache(async (userId: string): Promise<Negotiation[]> => {
  const supabase = await db();

  const { data: providers } = await supabase
    .from('tropical_providers')
    .select('id')
    .eq('user_id', userId);
  const providerIds = ((providers ?? []) as Array<{ id: string }>).map((p) => p.id);

  const [asConsumer, asProvider] = await Promise.all([
    supabase
      .from('tropical_negotiations')
      .select(NEGOTIATION_SELECT)
      .eq('consumer_id', userId)
      .order('created_at', { ascending: false }),
    providerIds.length > 0
      ? supabase
          .from('tropical_negotiations')
          .select(NEGOTIATION_SELECT)
          .in('provider_id', providerIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  const rows = [
    ...((asConsumer.data ?? []) as Array<Record<string, unknown>>),
    ...((asProvider.data ?? []) as Array<Record<string, unknown>>),
  ];
  const negotiations = rows.map(toNegotiation);
  // RLS already scoped both queries; the merge only needs de-duping when
  // the same account is both sides (possible: one account, both roles).
  const seen = new Set<string>();
  const mine = negotiations.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });

  // What each negotiation is about, for the dashboard list.
  const offerIds = mine.map((n) => n.offerId).filter((id): id is string => id !== null);
  const sourcingIds = mine
    .map((n) => n.sourcingRequestId)
    .filter((id): id is string => id !== null);
  const [{ data: offers }, { data: requests }] = await Promise.all([
    offerIds.length > 0
      ? supabase.from('tropical_offers').select('id, title').in('id', offerIds)
      : Promise.resolve({ data: [] }),
    sourcingIds.length > 0
      ? supabase.from('tropical_sourcing_requests').select('id, query').in('id', sourcingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const offerTitles = new Map(
    ((offers ?? []) as Array<{ id: string; title: string }>).map((o) => [o.id, o.title]),
  );
  const requestQueries = new Map(
    ((requests ?? []) as Array<{ id: string; query: string }>).map((r) => [r.id, r.query]),
  );
  return mine.map((n) => ({
    ...n,
    offerTitle: n.offerId ? (offerTitles.get(n.offerId) ?? null) : null,
    sourcingQuery: n.sourcingRequestId ? (requestQueries.get(n.sourcingRequestId) ?? null) : null,
  }));
});

/** The signed-in user's sourcing requests (their own no-results turns). */
export const loadMySourcingRequests = cache(async (userId: string): Promise<SourcingQueueRow[]> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_sourcing_requests')
    .select('id, user_id, query, requirements, status, conversation_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    query: r.query as string,
    requirements: (r.requirements as Record<string, unknown>) ?? {},
    status: r.status as SourcingQueueRow['status'],
    conversationId: (r.conversation_id as string | null) ?? null,
    requesterName: null,
    createdAt: r.created_at as string,
  }));
});

/** The signed-in consumer's fee records across their operations. */
export const loadMyFees = cache(async (userId: string): Promise<FeeRecord[]> => {
  const supabase = await db();
  const { data: negotiations } = await supabase
    .from('tropical_negotiations')
    .select('id')
    .eq('consumer_id', userId);
  const ids = ((negotiations ?? []) as Array<{ id: string }>).map((n) => n.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('tropical_fees')
    .select(FEE_SELECT)
    .in('negotiation_id', ids)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toFee);
});

/**
 * One negotiation for a party — null unless the viewer is the consumer
 * or the provider. Messages, proposals, the release record, and (for
 * the consumer) the fee records come with it.
 */
export const loadNegotiationForParty = cache(
  async (negotiationId: string, userId: string): Promise<NegotiationDetail | null> => {
    const supabase = await db();
    const { data, error } = await supabase
      .from('tropical_negotiations')
      .select(NEGOTIATION_SELECT)
      .eq('id', negotiationId)
      .maybeSingle();
    if (error || !data) return null;

    const negotiation = toNegotiation(data as unknown as Record<string, unknown>);
    const isConsumer = negotiation.consumerId === userId;

    const { data: providers } = await supabase
      .from('tropical_providers')
      .select('id')
      .eq('user_id', userId);
    const isProvider = ((providers ?? []) as Array<{ id: string }>).some(
      (p) => p.id === negotiation.providerId,
    );
    if (!isConsumer && !isProvider) return null;

    const [{ data: messages }, { data: proposals }, { data: release }, { data: events }] =
      await Promise.all([
        supabase
          .from('tropical_negotiation_messages')
          .select('id, negotiation_id, sender_id, content, created_at')
          .eq('negotiation_id', negotiationId)
          .order('created_at', { ascending: true }),
        supabase
          .from('tropical_proposals')
          .select(PROPOSAL_SELECT)
          .eq('negotiation_id', negotiationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('tropical_contact_releases')
          .select(
            'id, negotiation_id, approved_by, conditions_summary, consumer_contact_released, provider_contact_released, notes, created_at, updated_at',
          )
          .eq('negotiation_id', negotiationId)
          .maybeSingle(),
        supabase
          .from('tropical_operation_events')
          .select('id, negotiation_id, event_type, actor_id, detail, created_at')
          .eq('negotiation_id', negotiationId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

    // Fees are consumer-visible only (plan §9). A provider asking gets
    // an empty list from RLS anyway; the branch keeps the intent explicit.
    const fees = isConsumer ? await loadMyFees(userId) : [];
    const myFees = fees.filter((f) => f.negotiationId === negotiationId);

    return {
      negotiation,
      messages: ((messages ?? []) as Array<Record<string, unknown>>).map((m) => ({
        id: m.id as string,
        negotiationId: m.negotiation_id as string,
        senderId: m.sender_id as string,
        content: m.content as string,
        createdAt: m.created_at as string,
        senderName: null,
      })),
      proposals: ((proposals ?? []) as Array<Record<string, unknown>>).map(toProposal),
      release: release ? toContactRelease(release as unknown as Record<string, unknown>) : null,
      fees: myFees,
      events: ((events ?? []) as Array<Record<string, unknown>>).map(toOperationEvent),
      compliance: [],
    };
  },
);
