'use server';

import { revalidatePath } from 'next/cache';
import { adminDb, db } from '@/lib/supabase';
import { fail, ok, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { requireAdminScope } from '@/modules/admin/queries';
import { canRequestQuotation, canTransitionNegotiation, isValidNegotiationStatus, parseFeeInput } from './validation';
import type { NegotiationStatus, ProposalStatus } from './types';

/**
 * Commercial operations writes (Phase 4).
 *
 * Two writers, one rule: ops writes go through `adminDb()` behind
 * `requireAdminScope()`; party writes go through the RLS session
 * client (`db()`) as the viewer, so RLS enforces party membership.
 * The one exception is the audit trail: `tropical_operation_events`
 * has no INSERT policy for `authenticated`, so event rows are written
 * through `adminDb()` — only after the action has already established,
 * via a `db()` read, that the caller is a party to the negotiation.
 * That is the same shape as the chat module's privileged bot-message
 * writes.
 *
 * Nothing here touches money movement: fee actions record what ops
 * entered, they do not charge anything (no payment rail in the MVP).
 * Nothing here invents a fee, a release condition, or a contact.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function recordEvent(
  negotiationId: string | null,
  eventType: string,
  actorId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb().from('tropical_operation_events').insert({
      negotiation_id: negotiationId,
      event_type: eventType,
      actor_id: actorId,
      detail,
    });
  } catch {
    // The audit trail must never break the operation it records. A
    // failed event insert is silent by design here, matching the AI
    // service's degrade-gracefully pattern — the operation itself is
    // the source of truth, the event is the trail.
  }
}

async function loadNegotiationAsParty(
  negotiationId: string,
  userId: string,
): Promise<{ consumer_id: string; provider_id: string; status: string } | null> {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_negotiations')
    .select('id, consumer_id, provider_id, status')
    .eq('id', negotiationId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as { consumer_id: string; provider_id: string; status: string };
  if (row.consumer_id === userId) return row;

  const { data: providers } = await supabase
    .from('tropical_providers')
    .select('id')
    .eq('user_id', userId);
  const isProvider = ((providers ?? []) as Array<{ id: string }>).some(
    (p) => p.id === row.provider_id,
  );
  return isProvider ? row : null;
}

// ---------------------------------------------------------------------------
// Party side — opening a negotiation, messaging, proposals
// ---------------------------------------------------------------------------

/**
 * A consumer opens a negotiation directly from a published offer
 * ("request a quotation"). The provider sees it once it exists; the
 * consumer cannot set anything but status 'open' (RLS WITH CHECK).
 */
export async function createNegotiationFromOfferAction(
  offerId: string,
): Promise<ActionResult<string>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in to start a negotiation.');

  const supabase = await db();
  const { data: offer, error } = await supabase
    .from('tropical_offers')
    .select('id, provider_id, status')
    .eq('id', offerId)
    .maybeSingle();
  if (error || !offer) return fail('That offer could not be found.');
  const offerRow = offer as unknown as { id: string; provider_id: string; status: string };

  // The requester needs the consumer capability, a published offer, and
  // an offer that is not their own (see canRequestQuotation). The
  // provider rows come from the RLS session client, so a caller can
  // only ever see their own.
  const { data: providers } = await supabase
    .from('tropical_providers')
    .select('id')
    .eq('user_id', viewer.id);
  const guard = canRequestQuotation({
    canBrand: viewer.canBrand,
    offerStatus: offerRow.status,
    ownProviderIds: ((providers ?? []) as Array<{ id: string }>).map((p) => p.id),
    offerProviderId: offerRow.provider_id,
  });
  if (guard) return fail(guard);

  const { data, error: insertError } = await supabase
    .from('tropical_negotiations')
    .insert({ consumer_id: viewer.id, provider_id: offerRow.provider_id, offer_id: offerRow.id })
    .select('id')
    .single();
  if (insertError || !data) return fail('The negotiation could not be opened.');

  const id = (data as { id: string }).id;
  await recordEvent(id, 'negotiation_opened', viewer.id, { offer_id: offerRow.id });
  revalidatePath('/operations');
  return ok(id);
}

/** A party posts a message inside their own negotiation. */
export async function sendNegotiationMessageAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in to send a message.');

  const negotiationId = String(form.get('negotiationId') ?? '');
  const content = String(form.get('content') ?? '').trim();
  if (!negotiationId || content === '') return fail('A message needs text.');
  if (content.length > 5000) return fail('That message is too long.');

  const party = await loadNegotiationAsParty(negotiationId, viewer.id);
  if (!party) return fail('That negotiation is not yours.');
  if (party.status === 'completed' || party.status === 'cancelled') {
    return fail('That negotiation is closed.');
  }

  const supabase = await db();
  const { error } = await supabase.from('tropical_negotiation_messages').insert({
    negotiation_id: negotiationId,
    sender_id: viewer.id,
    content,
  });
  if (error) return fail('The message could not be sent.');

  revalidatePath(`/operations/${negotiationId}`);
  return ok(null);
}

/**
 * A party (or ops) creates a proposal on a negotiation. The author
 * role is derived from who the viewer is — never taken from the form.
 * Terms are the author's own words; the form carries them as JSON and
 * the server only checks the shape is an object.
 */
export async function createProposalAction(form: FormData): Promise<ActionResult<string>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in to send a proposal.');

  const negotiationId = String(form.get('negotiationId') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const summary = String(form.get('summary') ?? '').trim();
  if (!negotiationId || title === '') return fail('A proposal needs a title.');
  if (title.length > 200) return fail('That title is too long.');

  let terms: Record<string, unknown> = {};
  const rawTerms = String(form.get('terms') ?? '').trim();
  if (rawTerms !== '') {
    try {
      const parsed: unknown = JSON.parse(rawTerms);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return fail('Proposal terms must be a JSON object.');
      }
      terms = parsed as Record<string, unknown>;
    } catch {
      return fail('Proposal terms must be valid JSON.');
    }
  }

  const party = await loadNegotiationAsParty(negotiationId, viewer.id);
  const isOps = await isOpsViewer();
  if (!party && !isOps) return fail('That negotiation is not yours.');
  if (party && (party.status === 'completed' || party.status === 'cancelled')) {
    return fail('That negotiation is closed.');
  }

  const authorRole = party?.consumer_id === viewer.id ? 'consumer' : party ? 'provider' : 'ops';
  const client = isOps && !party ? adminDb() : await db();
  const { data, error } = await client
    .from('tropical_proposals')
    .insert({
      negotiation_id: negotiationId,
      created_by: viewer.id,
      author_role: authorRole,
      title,
      summary,
      terms,
      status: 'sent',
    })
    .select('id')
    .single();
  if (error || !data) return fail('The proposal could not be sent.');

  const id = (data as { id: string }).id;
  await recordEvent(negotiationId, 'proposal_sent', viewer.id, { proposal_id: id, title });
  // A first proposal moves the negotiation into the proposal stage; ops
  // records the transition, the party does not flip status directly.
  if (party?.status === 'open') {
    await adminDb()
      .from('tropical_negotiations')
      .update({ status: 'proposal' })
      .eq('id', negotiationId);
  }
  revalidatePath(`/operations/${negotiationId}`);
  revalidatePath(`/admin/operations/negotiations/${negotiationId}`);
  return ok(id);
}

/**
 * A party accepts a proposal — by setting ONLY their own flag. The
 * other side's flag, and the proposal status, are never touched here:
 * status changes are ops-only (migration 056 trigger), and the action
 * layer refuses to set the flag that is not the viewer's.
 */
export async function acceptProposalAction(proposalId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in to accept a proposal.');

  const supabase = await db();
  const { data: proposal, error } = await supabase
    .from('tropical_proposals')
    .select('id, negotiation_id, status, consumer_accepted, provider_accepted')
    .eq('id', proposalId)
    .maybeSingle();
  if (error || !proposal) return fail('That proposal could not be found.');
  const row = proposal as unknown as {
    id: string;
    negotiation_id: string;
    status: string;
    consumer_accepted: boolean;
    provider_accepted: boolean;
  };
  if (row.status !== 'sent') return fail('Only a sent proposal can be accepted.');

  const party = await loadNegotiationAsParty(row.negotiation_id, viewer.id);
  if (!party) return fail('That proposal is not yours to accept.');

  const side = party.consumer_id === viewer.id ? 'consumer' : 'provider';
  const update = side === 'consumer' ? { consumer_accepted: true } : { provider_accepted: true };
  const { error: updateError } = await supabase
    .from('tropical_proposals')
    .update(update)
    .eq('id', proposalId);
  if (updateError) return fail('The acceptance could not be recorded.');

  const bothAccepted = side === 'consumer' ? row.provider_accepted : row.consumer_accepted;
  await recordEvent(
    row.negotiation_id,
    bothAccepted ? 'proposal_accepted_by_both' : 'proposal_accepted_by_one_side',
    viewer.id,
    { proposal_id: proposalId, side },
  );
  revalidatePath(`/operations/${row.negotiation_id}`);
  revalidatePath(`/admin/operations/negotiations/${row.negotiation_id}`);
  return ok(null);
}

/** A party declines a proposal. Declining is unilateral — unlike
 * acceptance, it invents nothing — so the status flip runs here,
 * through the service role after the party check above, and is
 * recorded as an event. (The same privileged-write shape as the chat
 * module's bot messages: verify as the user, then write as the service
 * role, because the events table has no INSERT policy for
 * `authenticated` and the proposals trigger blocks status changes
 * from that role.) */
export async function declineProposalAction(proposalId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in to decline a proposal.');

  const supabase = await db();
  const { data: proposal, error } = await supabase
    .from('tropical_proposals')
    .select('id, negotiation_id, status')
    .eq('id', proposalId)
    .maybeSingle();
  if (error || !proposal) return fail('That proposal could not be found.');
  const row = proposal as unknown as { id: string; negotiation_id: string; status: string };
  if (row.status !== 'sent') return fail('Only a sent proposal can be declined.');

  const party = await loadNegotiationAsParty(row.negotiation_id, viewer.id);
  if (!party) return fail('That proposal is not yours to decline.');

  const { error: updateError } = await adminDb()
    .from('tropical_proposals')
    .update({ status: 'declined' })
    .eq('id', proposalId);
  if (updateError) return fail('The proposal could not be declined.');

  await recordEvent(row.negotiation_id, 'proposal_declined_by_party', viewer.id, {
    proposal_id: proposalId,
  });
  revalidatePath(`/operations/${row.negotiation_id}`);
  revalidatePath(`/admin/operations/negotiations/${row.negotiation_id}`);
  return ok(null);
}

/**
 * Contact reveal — the only sanctioned path to the other party's
 * contact details. Requires a `tropical_contact_releases` row with
 * this viewer's side released; otherwise it refuses without revealing
 * anything. The contact itself (email from Supabase Auth) is read
 * through the service-role client — it lives nowhere in the app's
 * tables, and no app query selects it.
 */
export async function revealContactAction(
  negotiationId: string,
): Promise<ActionResult<{ name: string | null; email: string | null }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in to see contact details.');

  const party = await loadNegotiationAsParty(negotiationId, viewer.id);
  if (!party) return fail('That negotiation is not yours.');

  const supabase = await db();
  const { data: release } = await supabase
    .from('tropical_contact_releases')
    .select('consumer_contact_released, provider_contact_released')
    .eq('negotiation_id', negotiationId)
    .maybeSingle();
  const releaseRow = release as unknown as {
    consumer_contact_released: boolean;
    provider_contact_released: boolean;
  } | null;

  const viewerIsConsumer = party.consumer_id === viewer.id;
  // The consumer sees the PROVIDER's contact (released by the provider
  // flag); the provider sees the CONSUMER's contact (consumer flag).
  const released = releaseRow
    ? viewerIsConsumer
      ? releaseRow.provider_contact_released
      : releaseRow.consumer_contact_released
    : false;
  if (!released) {
    return fail('Contact has not been released for this operation yet.');
  }

  const admin = adminDb();
  if (viewerIsConsumer) {
    const { data: providers } = await admin
      .from('tropical_providers')
      .select('id, user_id, display_name')
      .eq('id', party.provider_id)
      .maybeSingle();
    const providerRow = providers as unknown as {
      user_id: string;
      display_name: string;
    } | null;
    if (!providerRow) return fail('The provider could not be found.');
    const { data: authUser, error } = await admin.auth.admin.getUserById(providerRow.user_id);
    if (error || !authUser?.user) return fail('The contact could not be retrieved.');
    return ok({ name: providerRow.display_name, email: authUser.user.email ?? null });
  }

  const { data: consumer, error } = await admin
    .from('users')
    .select('id, name')
    .eq('id', party.consumer_id)
    .maybeSingle();
  if (error || !consumer) return fail('The consumer could not be found.');
  const consumerRow = consumer as unknown as { id: string; name: string | null };
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(consumerRow.id);
  if (authError || !authUser?.user) return fail('The contact could not be retrieved.');
  return ok({ name: consumerRow.name, email: authUser.user.email ?? null });
}

// ---------------------------------------------------------------------------
// Ops side
// ---------------------------------------------------------------------------

async function isOpsViewer(): Promise<boolean> {
  try {
    await requireAdminScope();
    return true;
  } catch {
    return false;
  }
}

/** Ops matches an unmatched sourcing request to a verified offer. */
export async function matchSourcingRequestAction(form: FormData): Promise<ActionResult<string>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const sourcingRequestId = String(form.get('sourcingRequestId') ?? '');
  const offerId = String(form.get('offerId') ?? '');
  if (!sourcingRequestId || !offerId) return fail('A request and an offer are both needed.');

  const admin = adminDb();
  const [{ data: request }, { data: offer }] = await Promise.all([
    admin
      .from('tropical_sourcing_requests')
      .select('id, user_id, status')
      .eq('id', sourcingRequestId)
      .maybeSingle(),
    admin
      .from('tropical_offers')
      .select('id, provider_id, status, verification_status')
      .eq('id', offerId)
      .maybeSingle(),
  ]);
  const requestRow = request as unknown as { id: string; user_id: string; status: string } | null;
  const offerRow = offer as unknown as {
    id: string;
    provider_id: string;
    status: string;
    verification_status: string;
  } | null;
  if (!requestRow) return fail('That sourcing request could not be found.');
  if (requestRow.status !== 'open') return fail('That request is no longer open.');
  if (!offerRow) return fail('That offer could not be found.');
  // Only a real, verified, published offer from a verified provider may
  // answer a sourcing request — never an unverified or draft one
  // (plan §4: never fabricate supply, availability, or verification).
  if (offerRow.status !== 'published' || offerRow.verification_status !== 'verified') {
    return fail('Only a verified, published offer can answer a sourcing request.');
  }
  const { data: provider } = await admin
    .from('tropical_providers')
    .select('id, verification_status')
    .eq('id', offerRow.provider_id)
    .maybeSingle();
  const providerRow = provider as unknown as { verification_status: string } | null;
  if (!providerRow || providerRow.verification_status !== 'verified') {
    return fail('Only an offer from a verified provider can answer a sourcing request.');
  }

  const { data, error } = await admin
    .from('tropical_negotiations')
    .insert({
      sourcing_request_id: requestRow.id,
      consumer_id: requestRow.user_id,
      provider_id: offerRow.provider_id,
      offer_id: offerRow.id,
      status: 'open',
    })
    .select('id')
    .single();
  if (error || !data) return fail('The negotiation could not be opened.');

  const id = (data as { id: string }).id;
  await admin
    .from('tropical_sourcing_requests')
    .update({ status: 'matched' })
    .eq('id', requestRow.id);
  await recordEvent(id, 'sourcing_request_matched', viewer.id, {
    sourcing_request_id: requestRow.id,
    offer_id: offerRow.id,
  });
  revalidatePath('/admin/operations/requests');
  revalidatePath('/admin/operations/negotiations');
  return ok(id);
}

/** Ops moves a negotiation along the state machine — only valid transitions. */
export async function updateNegotiationStatusAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const negotiationId = String(form.get('negotiationId') ?? '');
  const to = form.get('status');
  if (!negotiationId || !isValidNegotiationStatus(to)) {
    return fail('A valid target status is needed.');
  }

  const admin = adminDb();
  const { data, error } = await admin
    .from('tropical_negotiations')
    .select('id, status')
    .eq('id', negotiationId)
    .maybeSingle();
  if (error || !data) return fail('That negotiation could not be found.');
  const row = data as unknown as { id: string; status: NegotiationStatus };
  if (!canTransitionNegotiation(row.status, to)) {
    return fail(`A negotiation cannot move from ${row.status} to ${to}.`);
  }

  const { error: updateError } = await admin
    .from('tropical_negotiations')
    .update({ status: to })
    .eq('id', negotiationId);
  if (updateError) return fail('The status could not be updated.');

  await recordEvent(negotiationId, 'negotiation_status_changed', viewer.id, {
    from: row.status,
    to,
  });
  revalidatePath('/admin/operations/negotiations');
  revalidatePath(`/admin/operations/negotiations/${negotiationId}`);
  revalidatePath('/operations');
  return ok(null);
}

/** Ops records a proposal's status (accepted / declined / superseded). */
export async function setProposalStatusAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const proposalId = String(form.get('proposalId') ?? '');
  const to = String(form.get('status') ?? '');
  const valid: ProposalStatus[] = ['accepted', 'declined', 'superseded', 'draft', 'sent'];
  if (!proposalId || !valid.includes(to as ProposalStatus)) {
    return fail('A valid proposal status is needed.');
  }

  const admin = adminDb();
  const { data, error } = await admin
    .from('tropical_proposals')
    .select('id, negotiation_id, status, consumer_accepted, provider_accepted')
    .eq('id', proposalId)
    .maybeSingle();
  if (error || !data) return fail('That proposal could not be found.');
  const row = data as unknown as {
    id: string;
    negotiation_id: string;
    status: string;
    consumer_accepted: boolean;
    provider_accepted: boolean;
  };

  // 'accepted' requires both parties' flags — ops records the fact, it
  // does not invent acceptance.
  if (to === 'accepted' && !(row.consumer_accepted && row.provider_accepted)) {
    return fail('Both parties must accept before ops marks a proposal accepted.');
  }

  const { error: updateError } = await admin
    .from('tropical_proposals')
    .update({ status: to })
    .eq('id', proposalId);
  if (updateError) return fail('The proposal status could not be updated.');

  await recordEvent(row.negotiation_id, 'proposal_status_set', viewer.id, {
    proposal_id: proposalId,
    from: row.status,
    to,
  });

  // A proposal both parties accepted moves the negotiation forward:
  // ops records the acceptance here, in the same step, rather than
  // leaving the negotiation behind the proposal.
  if (to === 'accepted') {
    const { data: negotiation } = await admin
      .from('tropical_negotiations')
      .select('id, status')
      .eq('id', row.negotiation_id)
      .maybeSingle();
    const negRow = negotiation as unknown as { id: string; status: NegotiationStatus } | null;
    if (negRow && canTransitionNegotiation(negRow.status, 'accepted')) {
      await admin
        .from('tropical_negotiations')
        .update({ status: 'accepted' })
        .eq('id', row.negotiation_id);
      await recordEvent(row.negotiation_id, 'negotiation_status_changed', viewer.id, {
        from: negRow.status,
        to: 'accepted',
      });
    }
  }

  revalidatePath(`/admin/operations/negotiations/${row.negotiation_id}`);
  revalidatePath(`/operations/${row.negotiation_id}`);
  return ok(null);
}

/**
 * Ops approves a contact release. `conditionsSummary` is REQUIRED and
 * free text: it is what ops attests was met, in ops' own words. The
 * release conditions themselves are still Roger's decision (spec O4)
 * — this action records the decision, it does not define the policy.
 */
export async function approveContactReleaseAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const negotiationId = String(form.get('negotiationId') ?? '');
  const conditionsSummary = String(form.get('conditionsSummary') ?? '').trim();
  const notes = String(form.get('notes') ?? '').trim();
  const releaseConsumer = form.get('releaseConsumer') === 'on';
  const releaseProvider = form.get('releaseProvider') === 'on';
  if (!negotiationId) return fail('A negotiation is needed.');
  if (conditionsSummary === '') {
    return fail(
      'Record what conditions were met — a release without an attestation is not recorded.',
    );
  }
  if (conditionsSummary.length > 2000) return fail('That attestation is too long.');
  if (!releaseConsumer && !releaseProvider) {
    return fail('Release at least one side, or do not approve a release.');
  }

  const admin = adminDb();
  const { data, error } = await admin
    .from('tropical_negotiations')
    .select('id, status')
    .eq('id', negotiationId)
    .maybeSingle();
  if (error || !data) return fail('That negotiation could not be found.');
  const row = data as unknown as { id: string; status: NegotiationStatus };
  if (row.status !== 'accepted' && row.status !== 'contact_released') {
    return fail('Contact is released only once a negotiation is accepted.');
  }

  const { error: upsertError } = await admin.from('tropical_contact_releases').upsert(
    {
      negotiation_id: negotiationId,
      approved_by: viewer.id,
      conditions_summary: conditionsSummary,
      consumer_contact_released: releaseConsumer,
      provider_contact_released: releaseProvider,
      notes: notes === '' ? null : notes,
    },
    { onConflict: 'negotiation_id' },
  );
  if (upsertError) return fail('The release could not be recorded.');

  if (row.status === 'accepted') {
    await admin
      .from('tropical_negotiations')
      .update({ status: 'contact_released' })
      .eq('id', negotiationId);
  }
  await recordEvent(negotiationId, 'contact_released', viewer.id, {
    consumer: releaseConsumer,
    provider: releaseProvider,
    conditions_summary: conditionsSummary,
  });
  revalidatePath('/admin/operations/releases');
  revalidatePath(`/admin/operations/negotiations/${negotiationId}`);
  revalidatePath(`/operations/${negotiationId}`);
  return ok(null);
}

/** Ops records a fee — exactly what was entered, possibly nothing at all. */
export async function recordFeeAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const negotiationId = String(form.get('negotiationId') ?? '');
  if (!negotiationId) return fail('A negotiation is needed.');

  const parsed = parseFeeInput({
    feeType: form.get('feeType'),
    feeAmount: form.get('feeAmount'),
    feeCurrency: form.get('feeCurrency'),
    feeBasis: form.get('feeBasis'),
    notes: form.get('notes'),
  });
  if (parsed.ok === false) return fail(parsed.error);

  const admin = adminDb();
  const { data, error } = await admin
    .from('tropical_negotiations')
    .select('id')
    .eq('id', negotiationId)
    .maybeSingle();
  if (error || !data) return fail('That negotiation could not be found.');

  const { error: insertError } = await admin.from('tropical_fees').insert({
    negotiation_id: negotiationId,
    fee_type: parsed.value.feeType,
    fee_amount: parsed.value.feeAmount,
    fee_currency: parsed.value.feeCurrency,
    fee_basis: parsed.value.feeBasis,
    recorded_by: viewer.id,
    notes: parsed.value.notes,
  });
  if (insertError) return fail('The fee record could not be saved.');

  await recordEvent(negotiationId, 'fee_recorded', viewer.id, {
    fee_type: parsed.value.feeType,
    fee_amount: parsed.value.feeAmount,
    fee_currency: parsed.value.feeCurrency,
  });
  revalidatePath('/admin/operations/fees');
  revalidatePath(`/admin/operations/negotiations/${negotiationId}`);
  return ok(null);
}

/** Ops voids a fee record (the row stays, as an audit trail). */
export async function voidFeeAction(feeId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const admin = adminDb();
  const { data, error } = await admin
    .from('tropical_fees')
    .select('id, negotiation_id, status')
    .eq('id', feeId)
    .maybeSingle();
  if (error || !data) return fail('That fee record could not be found.');
  const row = data as unknown as { id: string; negotiation_id: string; status: string };
  if (row.status === 'void') return fail('That fee record is already void.');

  const { error: updateError } = await admin
    .from('tropical_fees')
    .update({ status: 'void' })
    .eq('id', feeId);
  if (updateError) return fail('The fee record could not be voided.');

  await recordEvent(row.negotiation_id, 'fee_voided', viewer.id, { fee_id: feeId });
  revalidatePath('/admin/operations/fees');
  return ok(null);
}

/**
 * Ops marks a pending notification as sent — AFTER sending it manually.
 * This action sends nothing itself: no email, no push. It records that
 * ops sent the message, when, on which channel, and who sent it. If the
 * sourcing request was matched, it also moves it to 'notified'.
 */
export async function markNotificationSentAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const notificationId = String(form.get('notificationId') ?? '');
  const channel = String(form.get('channel') ?? '').trim() || 'email';
  const sentNote = String(form.get('sentNote') ?? '').trim();
  if (!notificationId) return fail('A notification is needed.');
  if (sentNote === '') {
    return fail(
      'Record how the requester was reached — a sent mark without a note is not recorded.',
    );
  }

  const admin = adminDb();
  const { data, error } = await admin
    .from('tropical_sourcing_notifications')
    .select('id, sourcing_request_id, status')
    .eq('id', notificationId)
    .maybeSingle();
  if (error || !data) return fail('That notification could not be found.');
  const row = data as unknown as { id: string; sourcing_request_id: string; status: string };
  if (row.status !== 'pending') return fail('That notification is no longer pending.');

  const { error: updateError } = await admin
    .from('tropical_sourcing_notifications')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_by: viewer.id,
      sent_note: sentNote,
      channel,
    })
    .eq('id', notificationId);
  if (updateError) return fail('The notification could not be marked sent.');

  const { data: request } = await admin
    .from('tropical_sourcing_requests')
    .select('id, status')
    .eq('id', row.sourcing_request_id)
    .maybeSingle();
  const requestRow = request as unknown as { id: string; status: string } | null;
  if (requestRow?.status === 'matched') {
    await admin
      .from('tropical_sourcing_requests')
      .update({ status: 'notified' })
      .eq('id', requestRow.id);
  }
  revalidatePath('/admin/operations/notifications');
  revalidatePath('/admin/operations/requests');
  return ok(null);
}

/** Ops opens a compliance review on a negotiation, provider, or request. */
export async function openComplianceReviewAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const entityType = String(form.get('entityType') ?? '');
  const entityId = String(form.get('entityId') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  const validTypes = ['negotiation', 'provider', 'sourcing_request'];
  if (!validTypes.includes(entityType) || !entityId) {
    return fail('A review needs a valid subject.');
  }
  if (reason === '') return fail('A review needs a reason.');
  if (reason.length > 2000) return fail('That reason is too long.');

  const admin = adminDb();
  const { error } = await admin.from('tropical_compliance_reviews').insert({
    entity_type: entityType,
    entity_id: entityId,
    status: 'open',
    reason,
    reviewed_by: viewer.id,
  });
  if (error) return fail('The review could not be opened.');

  if (entityType === 'negotiation') {
    const { data: negotiation } = await admin
      .from('tropical_negotiations')
      .select('id, status')
      .eq('id', entityId)
      .maybeSingle();
    const negRow = negotiation as unknown as { id: string; status: NegotiationStatus } | null;
    if (negRow && canTransitionNegotiation(negRow.status, 'blocked')) {
      await admin.from('tropical_negotiations').update({ status: 'blocked' }).eq('id', entityId);
      await recordEvent(entityId, 'negotiation_status_changed', viewer.id, {
        from: negRow.status,
        to: 'blocked',
        reason: 'compliance review opened',
      });
    }
  }
  revalidatePath('/admin/operations/compliance');
  return ok(null);
}

/** Ops resolves a compliance review (cleared / blocked / escalated). */
export async function resolveComplianceReviewAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const reviewId = String(form.get('reviewId') ?? '');
  const to = String(form.get('status') ?? '');
  const notes = String(form.get('notes') ?? '').trim();
  const valid = ['cleared', 'blocked', 'escalated'];
  if (!reviewId || !valid.includes(to)) return fail('A valid resolution is needed.');

  const admin = adminDb();
  const { data, error } = await admin
    .from('tropical_compliance_reviews')
    .select('id, entity_type, entity_id, status')
    .eq('id', reviewId)
    .maybeSingle();
  if (error || !data) return fail('That review could not be found.');
  const row = data as unknown as {
    id: string;
    entity_type: string;
    entity_id: string;
    status: string;
  };
  if (row.status === 'cleared') return fail('That review is already cleared.');

  const { error: updateError } = await admin
    .from('tropical_compliance_reviews')
    .update({
      status: to,
      notes: notes === '' ? null : notes,
      reviewed_by: viewer.id,
      resolved_at: to === 'cleared' ? new Date().toISOString() : null,
    })
    .eq('id', reviewId);
  if (updateError) return fail('The review could not be resolved.');

  // Clearing the review unblocks the negotiation it blocked.
  if (to === 'cleared' && row.entity_type === 'negotiation') {
    const { data: negotiation } = await admin
      .from('tropical_negotiations')
      .select('id, status')
      .eq('id', row.entity_id)
      .maybeSingle();
    const negRow = negotiation as unknown as { id: string; status: NegotiationStatus } | null;
    if (negRow && canTransitionNegotiation(negRow.status, 'open')) {
      await admin.from('tropical_negotiations').update({ status: 'open' }).eq('id', row.entity_id);
      await recordEvent(row.entity_id, 'negotiation_status_changed', viewer.id, {
        from: negRow.status,
        to: 'open',
        reason: 'compliance review cleared',
      });
    }
  }
  revalidatePath('/admin/operations/compliance');
  return ok(null);
}

/**
 * Ops activates a workspace for an accepted negotiation.
 *
 * This is the Cubora state machine replacing escrow funding (audit
 * §4.1): the group channel used to unlock when escrow was funded, and
 * escrow funding is stubbed to always refuse — so the group channel
 * could never unlock. Now a project becomes 'active' when ops activates
 * it for an accepted negotiation. No payment event is involved.
 */
export async function activateProjectAction(form: FormData): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('Sign in.');
  try {
    await requireAdminScope();
  } catch {
    return fail('Operations only.');
  }

  const negotiationId = String(form.get('negotiationId') ?? '');
  const projectId = String(form.get('projectId') ?? '');
  if (!negotiationId || !projectId) return fail('A negotiation and a project are both needed.');

  const admin = adminDb();
  const [{ data: negotiation }, { data: project }] = await Promise.all([
    admin
      .from('tropical_negotiations')
      .select('id, consumer_id, status, activated_project_id')
      .eq('id', negotiationId)
      .maybeSingle(),
    admin
      .from('tropical_projects')
      .select('id, brand_id, status')
      .eq('id', projectId)
      .maybeSingle(),
  ]);
  const negRow = negotiation as unknown as {
    id: string;
    consumer_id: string;
    status: NegotiationStatus;
    activated_project_id: string | null;
  } | null;
  const projectRow = project as unknown as {
    id: string;
    brand_id: string;
    status: string;
  } | null;
  if (!negRow) return fail('That negotiation could not be found.');
  if (!projectRow) return fail('That project could not be found.');
  if (negRow.status !== 'accepted' && negRow.status !== 'contact_released') {
    return fail('A workspace is activated only once a negotiation is accepted.');
  }
  if (negRow.activated_project_id) {
    return fail('That negotiation already has an activated workspace.');
  }
  if (projectRow.status !== 'pending_payment') {
    return fail('Only a project waiting for activation can be activated.');
  }
  if (projectRow.brand_id !== negRow.consumer_id) {
    return fail('That project belongs to a different buyer.');
  }

  const { error: updateError } = await admin
    .from('tropical_projects')
    .update({ status: 'active', negotiation_id: negotiationId })
    .eq('id', projectId);
  if (updateError) return fail('The workspace could not be activated.');

  await admin
    .from('tropical_negotiations')
    .update({ activated_project_id: projectId })
    .eq('id', negotiationId);
  await recordEvent(negotiationId, 'workspace_activated', viewer.id, {
    project_id: projectId,
  });
  revalidatePath(`/admin/operations/negotiations/${negotiationId}`);
  return ok(null);
}
