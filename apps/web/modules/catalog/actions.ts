'use server';

import { revalidatePath } from 'next/cache';
import { db, adminDb } from '@/lib/supabase';
import { fail, ok, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { requireAdminScope } from '@/modules/admin/queries';
import {
  isValidAvailability,
  isValidCategory,
  isValidPricingBasis,
  normalizeOfferAttributes,
} from './filters';
import { loadCatalog } from './queries';
import type {
  CatalogFilter,
  CatalogPage,
  OfferFormInput,
  ProviderKind,
  VerificationStatus,
} from './types';
import { catalogFilterKey } from './filters';

/**
 * Catalog writes (Phase 2).
 *
 * Two sides, two clients, one rule: the provider writes their own profile
 * and offers through the RLS session client (`db()`), and NEVER touches a
 * verification field — the columns are simply absent from every
 * provider-side write, and the 051/052 triggers reject the change at the
 * database if one ever slips through. Ops writes go through `adminDb()`
 * behind `requireAdminScope()`, and every verification decision also
 * writes a row to `tropical_verification_events`, so the decision is
 * auditable, not just a flag flip.
 *
 * No negotiations, no contact-release, no fees here — those are Phase 4.
 */

// ---------------------------------------------------------------------------
// Provider side
// ---------------------------------------------------------------------------

export interface ProviderFormInput {
  kind: ProviderKind;
  displayName: string;
  legalName: string;
  description: string;
  city: string;
  country: string;
  languages: string[];
}

function cleanStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Create or update the signed-in user's own provider profile. */
export async function upsertProviderAction(
  input: ProviderFormInput,
): Promise<ActionResult<{ providerId: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.isCreative)
    return fail('Activate the provider role before creating a provider profile.');

  const displayName = cleanText(input.displayName, 200);
  if (!displayName) return fail('A display name is required.');
  if (input.kind !== 'individual' && input.kind !== 'business') {
    return fail('Provider kind must be individual or business.');
  }

  const supabase = await db();
  const row = {
    user_id: viewer.id,
    kind: input.kind,
    display_name: displayName,
    legal_name: cleanText(input.legalName, 200) || null,
    description: cleanText(input.description, 2000),
    city: cleanText(input.city, 200) || null,
    country: cleanText(input.country, 200) || 'Cuba',
    languages: cleanStringList(input.languages),
    updated_at: new Date().toISOString(),
  };

  // No verification columns here — see the module header.
  const { data, error } = await supabase
    .from('tropical_providers')
    .upsert(row, { onConflict: 'user_id' })
    .select('id')
    .single();

  if (error || !data) {
    console.error('upsertProviderAction failed:', error?.message ?? 'no row returned');
    return fail('Could not save the provider profile.');
  }

  revalidatePath('/offers');
  revalidatePath('/catalog');
  return ok({ providerId: data.id as string });
}

function cleanOfferInput(
  input: OfferFormInput,
): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  if (!isValidCategory(input.category)) return { ok: false, error: 'Offer category is invalid.' };
  const title = cleanText(input.title, 200);
  if (!title) return { ok: false, error: 'A title is required.' };
  if (!isValidAvailability(input.availabilityStatus)) {
    return { ok: false, error: 'Availability is invalid.' };
  }
  if (!isValidPricingBasis(input.pricingBasis)) {
    return { ok: false, error: 'Pricing basis is invalid.' };
  }
  const priceAmount =
    input.pricingBasis === 'quote'
      ? null
      : typeof input.priceAmount === 'number' &&
          Number.isFinite(input.priceAmount) &&
          input.priceAmount >= 0
        ? input.priceAmount
        : null;
  const quantityAvailable =
    typeof input.quantityAvailable === 'number' &&
    Number.isInteger(input.quantityAvailable) &&
    input.quantityAvailable >= 0
      ? input.quantityAvailable
      : null;

  return {
    ok: true,
    row: {
      category: input.category,
      title,
      description: cleanText(input.description, 5000),
      skills: cleanStringList(input.skills),
      languages: cleanStringList(input.languages),
      city: cleanText(input.city, 200) || null,
      country: cleanText(input.country, 200) || 'Cuba',
      availability_status: input.availabilityStatus,
      quantity_available: quantityAvailable,
      quantity_unit: cleanText(input.quantityUnit, 50) || null,
      production_capacity:
        input.productionCapacity && typeof input.productionCapacity === 'object'
          ? input.productionCapacity
          : null,
      pricing_basis: input.pricingBasis,
      price_amount: priceAmount,
      price_currency: cleanText(input.priceCurrency, 10) || 'USD',
      origin_country: cleanText(input.originCountry, 200) || null,
      attributes: normalizeOfferAttributes(input.category, input.attributes),
      updated_at: new Date().toISOString(),
    },
  };
}

async function ownProviderId(viewerId: string): Promise<string | null> {
  const supabase = await db();
  const { data } = await supabase
    .from('tropical_providers')
    .select('id')
    .eq('user_id', viewerId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Create an offer as a draft. Publishing is a separate, explicit step. */
export async function createOfferAction(
  input: OfferFormInput,
): Promise<ActionResult<{ offerId: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.isCreative) return fail('Activate the provider role before creating offers.');

  const providerId = await ownProviderId(viewer.id);
  if (!providerId) return fail('Create a provider profile first.');

  const cleaned = cleanOfferInput(input);
  if (cleaned.ok === false) return fail(cleaned.error);

  const supabase = await db();
  // status defaults to 'draft' in the database; verification / seal
  // columns are never set here (RLS + trigger enforce that).
  const { data, error } = await supabase
    .from('tropical_offers')
    .insert({ ...cleaned.row, provider_id: providerId })
    .select('id')
    .single();

  if (error || !data) {
    console.error('createOfferAction failed:', error?.message ?? 'no row returned');
    return fail('Could not create the offer.');
  }

  revalidatePath('/offers');
  return ok({ offerId: data.id as string });
}

/** Edit an offer the caller owns. Verification fields are never touched. */
export async function updateOfferAction(
  offerId: string,
  input: OfferFormInput,
): Promise<ActionResult<{ offerId: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.isCreative) return fail('Activate the provider role before managing offers.');

  const providerId = await ownProviderId(viewer.id);
  if (!providerId) return fail('Create a provider profile first.');

  const cleaned = cleanOfferInput(input);
  if (cleaned.ok === false) return fail(cleaned.error);

  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_offers')
    .update(cleaned.row)
    .eq('id', offerId)
    .eq('provider_id', providerId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('updateOfferAction failed:', error.message);
    return fail('Could not update the offer.');
  }
  if (!data) return fail('Offer not found.');

  revalidatePath('/offers');
  revalidatePath('/catalog');
  return ok({ offerId: data.id as string });
}

/** Publish, unpublish (back to draft), or archive an offer the caller owns. */
export async function setOfferStatusAction(
  offerId: string,
  status: 'draft' | 'published' | 'archived',
): Promise<ActionResult<{ offerId: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.isCreative) return fail('Activate the provider role before managing offers.');
  if (!['draft', 'published', 'archived'].includes(status)) {
    return fail('Offer status is invalid.');
  }

  const providerId = await ownProviderId(viewer.id);
  if (!providerId) return fail('Create a provider profile first.');

  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_offers')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', offerId)
    .eq('provider_id', providerId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('setOfferStatusAction failed:', error.message);
    return fail('Could not update the offer status.');
  }
  if (!data) return fail('Offer not found.');

  revalidatePath('/offers');
  revalidatePath('/catalog');
  return ok({ offerId: data.id as string });
}

/** Delete an offer the caller owns. Drafts and published offers alike. */
export async function deleteOfferAction(
  offerId: string,
): Promise<ActionResult<{ offerId: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!viewer.isCreative) return fail('Activate the provider role before managing offers.');

  const providerId = await ownProviderId(viewer.id);
  if (!providerId) return fail('Create a provider profile first.');

  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_offers')
    .delete()
    .eq('id', offerId)
    .eq('provider_id', providerId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('deleteOfferAction failed:', error.message);
    return fail('Could not delete the offer.');
  }
  if (!data) return fail('Offer not found.');

  revalidatePath('/offers');
  revalidatePath('/catalog');
  return ok({ offerId });
}

/** The next page of the catalog board (same shape as loadMoreTalentAction). */
export async function loadMoreCatalogAction(
  cursor: string,
  filter: CatalogFilter,
): Promise<ActionResult<CatalogPage>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  // Rebuild the filter from its parts rather than trusting it as given.
  const page = await loadCatalog(
    cursor,
    catalogFilterKey({
      search: typeof filter?.search === 'string' ? filter.search : undefined,
      category: isValidCategory(filter?.category) ? filter.category : undefined,
      skills: Array.isArray(filter?.skills)
        ? filter.skills.filter((s): s is string => typeof s === 'string')
        : undefined,
      location: typeof filter?.location === 'string' ? filter.location : undefined,
      availability: isValidAvailability(filter?.availability) ? filter.availability : undefined,
      verifiedOnly: filter?.verifiedOnly === true,
      madeInCubaOnly: filter?.madeInCubaOnly === true,
    }),
  );

  return ok(page);
}

// ---------------------------------------------------------------------------
// Admin / ops side — supplier onboarding (internal flow, Phase 2)
// ---------------------------------------------------------------------------

export interface VerificationEvidenceInput {
  offerId?: string | null;
  kind: 'document' | 'note';
  reference: string;
  note: string;
}

/** Record one piece of verification evidence for a provider (or an offer). */
export async function recordVerificationEvidenceAction(
  providerId: string,
  input: VerificationEvidenceInput,
): Promise<ActionResult<{ eventId: string }>> {
  const { viewer } = await requireAdminScope();
  if (input.kind !== 'document' && input.kind !== 'note') {
    return fail('Evidence kind is invalid.');
  }

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_verification_events')
    .insert({
      provider_id: providerId,
      offer_id: input.offerId ?? null,
      kind: input.kind,
      reference: cleanText(input.reference, 500) || null,
      note: cleanText(input.note, 2000),
      recorded_by: viewer.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('recordVerificationEvidenceAction failed:', error?.message ?? 'no row returned');
    return fail('Could not record the evidence.');
  }

  revalidatePath('/admin/suppliers');
  return ok({ eventId: data.id as string });
}

/** Set a provider's verification status. Ops only; always audited. */
export async function setProviderVerificationAction(
  providerId: string,
  status: VerificationStatus,
  notes: string,
): Promise<ActionResult<{ providerId: string }>> {
  const { viewer } = await requireAdminScope();
  if (!['pending', 'in_review', 'verified', 'rejected'].includes(status)) {
    return fail('Verification status is invalid.');
  }

  const supabase = adminDb();
  const { error } = await supabase
    .from('tropical_providers')
    .update({
      verification_status: status,
      verified_at: status === 'verified' ? new Date().toISOString() : null,
      verified_by: status === 'verified' ? viewer.id : null,
      verification_notes: cleanText(notes, 2000) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', providerId);

  if (error) {
    console.error('setProviderVerificationAction failed:', error.message);
    return fail('Could not set the verification status.');
  }

  await supabase.from('tropical_verification_events').insert({
    provider_id: providerId,
    kind: 'status_change',
    note: cleanText(notes, 2000),
    status_after: status,
    recorded_by: viewer.id,
  });

  revalidatePath('/admin/suppliers');
  revalidatePath('/catalog');
  return ok({ providerId });
}

export interface OfferVerificationInput {
  originVerified: boolean;
  madeInCuba: boolean;
  verificationStatus: VerificationStatus;
}

/**
 * Set an offer's origin / seal / verification state. Ops only; audited.
 *
 * The database CHECK already forbids the seal without verified origin;
 * the action checks first so the operator gets a readable error instead
 * of a constraint message.
 */
export async function setOfferVerificationAction(
  offerId: string,
  input: OfferVerificationInput,
): Promise<ActionResult<{ offerId: string }>> {
  const { viewer } = await requireAdminScope();
  if (input.madeInCuba && !input.originVerified) {
    return fail('The Made in Cuba seal requires verified origin first.');
  }
  if (!['pending', 'in_review', 'verified', 'rejected'].includes(input.verificationStatus)) {
    return fail('Verification status is invalid.');
  }

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_offers')
    .update({
      origin_verified: input.originVerified,
      made_in_cuba: input.madeInCuba,
      verification_status: input.verificationStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)
    .select('id, provider_id')
    .maybeSingle();

  if (error) {
    console.error('setOfferVerificationAction failed:', error.message);
    return fail('Could not set the offer verification.');
  }
  if (!data) return fail('Offer not found.');

  await supabase.from('tropical_verification_events').insert({
    provider_id: data.provider_id as string,
    offer_id: offerId,
    kind: 'status_change',
    note: `Origin verified: ${input.originVerified ? 'yes' : 'no'}; Made in Cuba: ${input.madeInCuba ? 'yes' : 'no'}.`,
    status_after: input.verificationStatus,
    recorded_by: viewer.id,
  });

  revalidatePath('/admin/suppliers');
  revalidatePath('/catalog');
  return ok({ offerId });
}
