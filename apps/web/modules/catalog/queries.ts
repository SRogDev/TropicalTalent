import 'server-only';

import { cache } from 'react';
import { db, adminDb } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { requireAdminScope } from '@/modules/admin/queries';
import type {
  AvailabilityStatus,
  CatalogFilter,
  CatalogPage,
  Offer,
  OfferCategory,
  Provider,
  VerificationEvent,
  VerificationStatus,
} from './types';
import { CATALOG_PAGE_SIZE } from './types';

/**
 * Unified catalog reads (Phase 2).
 *
 * The catalog is deployment-global, not tenant-scoped: `tropical_providers`
 * has no tenant column, and there is no white-label provider-creation path.
 * That matches the current product shape (Cubora is the classic host) and
 * is recorded as a known limitation in docs/architecture/data-model.md —
 * tenant scoping for providers belongs with the tenancy keep-or-cut
 * decision, not with this phase. Inside the catalog, RLS does the
 * visibility work: published offers are public, drafts/archived are
 * owner-only, and provider rows are readable only when verified (or own).
 *
 * One query shape serves the catalog page; the provider's own offers and
 * the admin supplier list are separate shapes because they want different
 * rows (all statuses / every provider) under different authorization.
 */

const PROVIDER_EMBED =
  'provider:tropical_providers(display_name, kind, city, country, languages, verification_status)';

const PROVIDER_EMBED_INNER = 'vprovider:tropical_providers!inner(verification_status)';

const OFFER_SELECT = `
  id, provider_id, category, status, title, description,
  skills, languages, city, country, availability_status,
  quantity_available, quantity_unit, production_capacity,
  pricing_basis, price_amount, price_currency,
  origin_country, origin_verified, made_in_cuba, verification_status,
  attributes, search_indexed_at, created_at, updated_at,
  ${PROVIDER_EMBED}
`;

/**
 * One page of the public catalog.
 *
 * Keyset pagination on created_at, same reasoning as the talent feed:
 * OFFSET makes Postgres walk and discard every skipped row. Every filter
 * is applied in SQL, ahead of the limit — a skill filter used to run in
 * memory after the limit in the old Discover page, and it hid most of the
 * people it should have found.
 */
export const loadCatalog = cache(
  async (cursor: string | null, filterKey: string): Promise<CatalogPage> => {
    const filter: CatalogFilter = filterKey ? JSON.parse(filterKey) : {};
    const supabase = await db();

    const verifiedOnly = filter.verifiedOnly === true;

    let query = supabase
      .from('tropical_offers')
      .select(verifiedOnly ? `${OFFER_SELECT}, ${PROVIDER_EMBED_INNER}` : OFFER_SELECT)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(CATALOG_PAGE_SIZE + 1);

    if (cursor) query = query.lt('created_at', cursor);
    if (filter.category) query = query.eq('category', filter.category);
    if (filter.skills?.length) query = query.overlaps('skills', filter.skills);
    if (filter.availability) query = query.eq('availability_status', filter.availability);
    if (filter.madeInCubaOnly) query = query.eq('made_in_cuba', true);
    if (verifiedOnly) query = query.eq('vprovider.verification_status', 'verified');
    if (filter.location?.trim()) {
      const term = `%${filter.location.trim()}%`;
      query = query.or(`city.ilike.${term},country.ilike.${term}`);
    }
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      query = query.or(`title.ilike.${term},description.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error || !data) return { offers: [], nextCursor: null, hasMore: false };

    const rows = data as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > CATALOG_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, CATALOG_PAGE_SIZE) : rows;
    const offers = page.map(toOffer);
    const nextCursor = hasMore
      ? ((page[page.length - 1]?.created_at as string | undefined) ?? null)
      : null;

    return { offers, nextCursor, hasMore: hasMore && nextCursor !== null };
  },
);

/** One offer by id — a published offer for anyone, any status for its owner. */
export const loadOfferById = cache(async (id: string): Promise<Offer | null> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_offers')
    .select(OFFER_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toOffer(data as unknown as Record<string, unknown>);
});

/** The signed-in user's own provider profile, if they have one. */
export const loadMyProvider = cache(async (userId: string): Promise<Provider | null> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_providers')
    .select(
      'id, user_id, kind, display_name, legal_name, description, city, country, languages, verification_status, verified_at, verified_by, verification_notes, created_at, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return toProvider(data as unknown as Record<string, unknown>);
});

/** The signed-in user's own offers, every status, newest first. */
export const loadMyOffers = cache(async (userId: string): Promise<Offer[]> => {
  const provider = await loadMyProvider(userId);
  if (!provider) return [];

  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_offers')
    .select(OFFER_SELECT)
    .eq('provider_id', provider.id)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toOffer);
});

/** Count of the signed-in user's own offers, for the profile "My offers" link. */
export const countMyOffers = cache(async (userId: string): Promise<number> => {
  const provider = await loadMyProvider(userId);
  if (!provider) return 0;

  const supabase = await db();
  const { count, error } = await supabase
    .from('tropical_offers')
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', provider.id);

  if (error || count === null) return 0;
  return count;
});

/** A provider's published offers, for their public profile. */
export const loadProviderOffers = cache(async (providerId: string): Promise<Offer[]> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_offers')
    .select(OFFER_SELECT)
    .eq('provider_id', providerId)
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toOffer);
});

// ---------------------------------------------------------------------------
// Admin / ops reads (supplier onboarding). Service-role, behind
// requireAdminScope() — the same gate every admin loader uses. Providers
// have no tenant column, so a white-label admin (scoped tenantId) sees an
// empty list: supplier onboarding is a classic-host ops surface until the
// tenancy decision lands. A super admin on the classic host is unscoped.
// ---------------------------------------------------------------------------

export interface AdminProviderRow {
  provider: Provider;
  offerCount: number;
  publishedCount: number;
  latestEvent: VerificationEvent | null;
}

export const loadProvidersForAdmin = cache(async (): Promise<AdminProviderRow[]> => {
  const { tenantId } = await requireAdminScope();
  // Scoped (white-label) admins have no providers in their tenant.
  if (tenantId !== null) return [];

  const supabase = adminDb();
  const { data, error } = await supabase
    .from('tropical_providers')
    .select(
      'id, user_id, kind, display_name, legal_name, description, city, country, languages, verification_status, verified_at, verified_by, verification_notes, created_at, updated_at',
    )
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  const providers = (data as unknown as Array<Record<string, unknown>>).map(toProvider);
  const ids = providers.map((p) => p.id);
  if (ids.length === 0) return [];

  const [{ data: offers }, { data: events }] = await Promise.all([
    supabase.from('tropical_offers').select('provider_id, status').in('provider_id', ids),
    supabase
      .from('tropical_verification_events')
      .select(
        'id, provider_id, offer_id, kind, reference, note, status_after, recorded_by, created_at',
      )
      .in('provider_id', ids)
      .order('created_at', { ascending: false }),
  ]);

  const offerRows = (offers ?? []) as Array<{ provider_id: string; status: string }>;
  const eventRows = (events ?? []) as Array<Record<string, unknown>>;

  return providers.map((provider) => {
    const mine = offerRows.filter((o) => o.provider_id === provider.id);
    const latest = eventRows.find((e) => e.provider_id === provider.id);
    return {
      provider,
      offerCount: mine.length,
      publishedCount: mine.filter((o) => o.status === 'published').length,
      latestEvent: latest ? toVerificationEvent(latest) : null,
    };
  });
});

/** Verification history for one provider, newest first. Admin only. */
export const loadVerificationEvents = cache(
  async (providerId: string): Promise<VerificationEvent[]> => {
    const { tenantId } = await requireAdminScope();
    if (tenantId !== null) return [];

    const supabase = adminDb();
    const { data, error } = await supabase
      .from('tropical_verification_events')
      .select(
        'id, provider_id, offer_id, kind, reference, note, status_after, recorded_by, created_at',
      )
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(toVerificationEvent);
  },
);

/** One provider + their offers, for the admin supplier detail page. */
export const loadProviderForAdmin = cache(
  async (providerId: string): Promise<{ provider: Provider; offers: Offer[] } | null> => {
    const { tenantId } = await requireAdminScope();
    if (tenantId !== null) return null;

    const supabase = adminDb();
    const { data, error } = await supabase
      .from('tropical_providers')
      .select(
        'id, user_id, kind, display_name, legal_name, description, city, country, languages, verification_status, verified_at, verified_by, verification_notes, created_at, updated_at',
      )
      .eq('id', providerId)
      .maybeSingle();

    if (error || !data) return null;
    const provider = toProvider(data as unknown as Record<string, unknown>);

    const { data: offerData } = await supabase
      .from('tropical_offers')
      .select(OFFER_SELECT)
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    return {
      provider,
      offers: ((offerData ?? []) as unknown as Array<Record<string, unknown>>).map(toOffer),
    };
  },
);

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toProvider(row: Record<string, unknown>): Provider {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: row.kind as Provider['kind'],
    displayName: row.display_name as string,
    legalName: (row.legal_name as string | null) ?? null,
    description: (row.description as string) ?? '',
    city: (row.city as string | null) ?? null,
    country: (row.country as string) ?? 'Cuba',
    languages: Array.isArray(row.languages)
      ? (row.languages as unknown[]).filter((l): l is string => typeof l === 'string')
      : [],
    verificationStatus: row.verification_status as VerificationStatus,
    verifiedAt: (row.verified_at as string | null) ?? null,
    verifiedBy: (row.verified_by as string | null) ?? null,
    verificationNotes: (row.verification_notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toOffer(row: Record<string, unknown>): Offer {
  const provider = one(row.provider as never) as Record<string, unknown> | null;
  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    category: row.category as OfferCategory,
    status: row.status as Offer['status'],
    title: row.title as string,
    description: (row.description as string) ?? '',
    skills: Array.isArray(row.skills)
      ? (row.skills as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    languages: Array.isArray(row.languages)
      ? (row.languages as unknown[]).filter((l): l is string => typeof l === 'string')
      : [],
    city: (row.city as string | null) ?? null,
    country: (row.country as string) ?? 'Cuba',
    availabilityStatus: row.availability_status as AvailabilityStatus,
    quantityAvailable: typeof row.quantity_available === 'number' ? row.quantity_available : null,
    quantityUnit: (row.quantity_unit as string | null) ?? null,
    productionCapacity:
      row.production_capacity && typeof row.production_capacity === 'object'
        ? (row.production_capacity as Record<string, unknown>)
        : null,
    pricingBasis: row.pricing_basis as Offer['pricingBasis'],
    priceAmount: typeof row.price_amount === 'number' ? row.price_amount : null,
    priceCurrency: (row.price_currency as string) ?? 'USD',
    originCountry: (row.origin_country as string | null) ?? null,
    originVerified: row.origin_verified === true,
    madeInCuba: row.made_in_cuba === true,
    verificationStatus: row.verification_status as VerificationStatus,
    attributes:
      row.attributes && typeof row.attributes === 'object'
        ? (row.attributes as Record<string, unknown>)
        : {},
    searchIndexedAt: (row.search_indexed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    provider: provider
      ? {
          displayName: provider.display_name as string,
          kind: provider.kind as Provider['kind'],
          city: (provider.city as string | null) ?? null,
          country: (provider.country as string) ?? 'Cuba',
          languages: Array.isArray(provider.languages)
            ? (provider.languages as unknown[]).filter((l): l is string => typeof l === 'string')
            : [],
          verificationStatus: provider.verification_status as VerificationStatus,
        }
      : null,
  };
}

function toVerificationEvent(row: Record<string, unknown>): VerificationEvent {
  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    offerId: (row.offer_id as string | null) ?? null,
    kind: row.kind as VerificationEvent['kind'],
    reference: (row.reference as string | null) ?? null,
    note: (row.note as string) ?? '',
    statusAfter: (row.status_after as VerificationStatus | null) ?? null,
    recordedBy: row.recorded_by as string,
    createdAt: row.created_at as string,
  };
}

