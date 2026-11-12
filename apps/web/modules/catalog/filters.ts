/**
 * Unified catalog filters (Phase 2).
 *
 * Pure functions: URL search params in, a typed filter out; offer
 * attributes in, the whitelisted per-category shape out. No database, no
 * session — so the page, the cache key, and the query all agree on what a
 * filter means, and the rules are testable without a live database.
 *
 * Two rules matter most:
 * - Nothing from the URL is trusted: unknown categories / availability
 *   values are dropped, and `verified` / `madeInCuba` need exactly "1".
 * - Attributes are whitelisted per category (data-model.md §3). A value
 *   of the wrong type is dropped, not coerced — a coerced value would be
 *   a claim the provider never made.
 */

import type { AvailabilityStatus, CatalogFilter, OfferCategory, PricingBasis } from './types';

export const OFFER_CATEGORIES: OfferCategory[] = ['talent', 'services', 'products'];

export const AVAILABILITY_STATUSES: AvailabilityStatus[] = ['available', 'limited', 'unavailable'];

export const PRICING_BASES: PricingBasis[] = ['hour', 'project', 'unit', 'quote'];

export function isValidCategory(value: unknown): value is OfferCategory {
  return typeof value === 'string' && (OFFER_CATEGORIES as string[]).includes(value);
}

export function isValidAvailability(value: unknown): value is AvailabilityStatus {
  return typeof value === 'string' && (AVAILABILITY_STATUSES as string[]).includes(value);
}

export function isValidPricingBasis(value: unknown): value is PricingBasis {
  return typeof value === 'string' && (PRICING_BASES as string[]).includes(value);
}

function cleanList(value: string | string[] | boolean | undefined): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const items = [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
  return items.length > 0 ? items : undefined;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Parse the /catalog query string into a typed filter.
 *
 * Accepts the flat shape the page reads from searchParams (the cache-key
 * round-trip in the test uses the same keys, so a key parsed back yields
 * the same filter).
 */
export function parseCatalogFilter(
  params: Record<string, string | string[] | boolean | undefined>,
): CatalogFilter {
  const first = (v: string | string[] | boolean | undefined): string | undefined => {
    const raw = Array.isArray(v) ? v[0] : v;
    return typeof raw === 'string' ? raw : undefined;
  };
  const firstRaw = (v: string | string[] | boolean | undefined): string | boolean | undefined =>
    Array.isArray(v) ? v[0] : v;

  const filter: CatalogFilter = {};
  // `q` is the URL param; `search` is the cache-key name. Both parse.
  const search = cleanText(first(params.q) ?? first(params.search));
  if (search) filter.search = search;
  const category = first(params.category);
  if (isValidCategory(category)) filter.category = category;
  const skills = cleanList(params.skills);
  if (skills) filter.skills = skills;
  const location = cleanText(first(params.location));
  if (location) filter.location = location;
  const availability = first(params.availability);
  if (isValidAvailability(availability)) filter.availability = availability;
  // URL uses `verified` / `madeInCuba` = "1"; the cache key uses the
  // boolean-ish names. Both parse, so a key round-trips to the same filter.
  const verified = firstRaw(params.verified) ?? firstRaw(params.verifiedOnly);
  if (verified === '1' || verified === true) filter.verifiedOnly = true;
  const madeInCuba = firstRaw(params.madeInCuba) ?? firstRaw(params.madeInCubaOnly);
  if (madeInCuba === '1' || madeInCuba === true) filter.madeInCubaOnly = true;
  return filter;
}

/**
 * Stable cache key for a filter (same shape as talentFilterKey).
 * Empty filter keys to ''.
 */
export function catalogFilterKey(filter: CatalogFilter): string {
  if (!filter || Object.keys(filter).length === 0) return '';
  return JSON.stringify({
    search: filter.search?.trim().toLowerCase() || undefined,
    category: filter.category || undefined,
    skills: filter.skills?.slice().sort(),
    location: filter.location?.trim().toLowerCase() || undefined,
    availability: filter.availability || undefined,
    verifiedOnly: filter.verifiedOnly || undefined,
    madeInCubaOnly: filter.madeInCubaOnly || undefined,
  });
}

/**
 * Per-category attribute whitelist (data-model.md §3).
 *
 * `products` covers both goods and producers: a producer's offer uses the
 * products shape plus `products` / `documentation`. The value is the
 * expected runtime type; `record` means a plain JSON object.
 */
const ATTRIBUTE_SHAPES: Record<
  OfferCategory,
  Record<string, 'string' | 'number' | 'string[]' | 'record'>
> = {
  talent: {
    years_experience: 'number',
    portfolio_urls: 'string[]',
    availability: 'string',
  },
  services: {
    scope: 'string',
    deliverables: 'string[]',
    conditions: 'string',
    pricing_basis: 'string',
  },
  products: {
    origin: 'string',
    specifications: 'record',
    quality: 'string',
    quantity: 'string',
    availability: 'string',
    products: 'string[]',
    documentation: 'string[]',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanValue(kind: 'string' | 'number' | 'string[]' | 'record', value: unknown): unknown {
  switch (kind) {
    case 'string':
      return typeof value === 'string' && value.trim() !== '' ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'string[]': {
      if (!Array.isArray(value)) return undefined;
      const items = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
      return items.length > 0 ? items : undefined;
    }
    case 'record':
      return isRecord(value) ? value : undefined;
  }
}

/**
 * Keep only the documented keys for the category, dropping unknown keys
 * and wrong-typed values. Non-object input (or an unknown category)
 * normalizes to {}.
 */
export function normalizeOfferAttributes(
  category: OfferCategory | string,
  input: unknown,
): Record<string, unknown> {
  if (!isValidCategory(category) || !isRecord(input)) return {};
  const shape = ATTRIBUTE_SHAPES[category];
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(shape)) {
    const cleaned = cleanValue(kind, input[key]);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}
