/**
 * Unified catalog types (Phase 2).
 *
 * One catalog, three categories (plan §3): talent, services, products &
 * production. A provider holds many offers. See
 * docs/architecture/data-model.md for the full design.
 */

export type OfferCategory = 'talent' | 'services' | 'products';
export type OfferStatus = 'draft' | 'published' | 'archived';
export type AvailabilityStatus = 'available' | 'limited' | 'unavailable';
export type VerificationStatus = 'pending' | 'in_review' | 'verified' | 'rejected';
export type ProviderKind = 'individual' | 'business';
export type PricingBasis = 'hour' | 'project' | 'unit' | 'quote';

/** A Cubora provider profile (tropical_providers). */
export interface Provider {
  id: string;
  userId: string;
  kind: ProviderKind;
  displayName: string;
  legalName: string | null;
  description: string;
  city: string | null;
  country: string;
  languages: string[];
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One catalog offer (tropical_offers). */
export interface Offer {
  id: string;
  providerId: string;
  category: OfferCategory;
  status: OfferStatus;
  title: string;
  description: string;
  skills: string[];
  languages: string[];
  city: string | null;
  country: string;
  availabilityStatus: AvailabilityStatus;
  quantityAvailable: number | null;
  quantityUnit: string | null;
  /** e.g. { monthly_amount: 500, unit: 'kg', lead_time_days: 14 } */
  productionCapacity: Record<string, unknown> | null;
  pricingBasis: PricingBasis;
  priceAmount: number | null;
  priceCurrency: string;
  originCountry: string | null;
  /** Ops-only: verified origin. Never set by the provider. */
  originVerified: boolean;
  /** Ops-only: the Made in Cuba seal. Requires originVerified. */
  madeInCuba: boolean;
  verificationStatus: VerificationStatus;
  /** Category-specific detail; shape per category in data-model.md §3. */
  attributes: Record<string, unknown>;
  searchIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Joined provider, when the query asked for it. */
  provider?: Pick<
    Provider,
    'displayName' | 'kind' | 'city' | 'country' | 'languages' | 'verificationStatus'
  > | null;
}

/** One verification evidence / decision row (tropical_verification_events). */
export interface VerificationEvent {
  id: string;
  providerId: string;
  offerId: string | null;
  kind: 'document' | 'note' | 'status_change';
  reference: string | null;
  note: string;
  statusAfter: VerificationStatus | null;
  recordedBy: string;
  createdAt: string;
}

/** Structured catalog filter — what the /catalog page accepts. */
export interface CatalogFilter {
  search?: string;
  category?: OfferCategory;
  skills?: string[];
  location?: string;
  availability?: AvailabilityStatus;
  /** Only offers from verified providers. */
  verifiedOnly?: boolean;
  /** Only offers carrying the Made in Cuba seal. */
  madeInCubaOnly?: boolean;
}

export interface CatalogPage {
  offers: Offer[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const CATALOG_PAGE_SIZE = 24;

/** Offer form input — what the provider submits; the server validates it. */
export interface OfferFormInput {
  category: OfferCategory;
  title: string;
  description: string;
  skills: string[];
  languages: string[];
  city: string;
  country: string;
  availabilityStatus: AvailabilityStatus;
  quantityAvailable: number | null;
  quantityUnit: string;
  productionCapacity: Record<string, unknown> | null;
  pricingBasis: PricingBasis;
  priceAmount: number | null;
  priceCurrency: string;
  originCountry: string;
  /** Category-specific detail, normalized server-side (see filters.ts). */
  attributes: Record<string, unknown>;
}
