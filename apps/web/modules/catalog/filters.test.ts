import { describe, expect, test } from 'bun:test';
import {
  catalogFilterKey,
  isValidAvailability,
  isValidCategory,
  normalizeOfferAttributes,
  parseCatalogFilter,
} from './filters';

/**
 * Unified catalog filters (Phase 2).
 *
 * The catalog filter is pure: URL search params in, a typed filter out.
 * Parsing lives here — not in the page — so the page, the cache key, and
 * the query all agree on what a filter means, and so the rules are testable
 * without a database.
 *
 * Rules under test:
 * - unknown categories / availability values are dropped, never trusted;
 * - comma lists are split, trimmed, deduped, and empty entries dropped;
 * - `verified` / `madeInCuba` are opt-in flags (`1` only);
 * - the cache key is stable under key order and empty values;
 * - offer attributes are whitelisted per category — the provider's
 *   free-form JSON never smuggles a field the UI does not know about,
 *   and a value of the wrong type is dropped, not coerced into a lie.
 */

describe('parseCatalogFilter', () => {
  test('empty params mean an empty filter', () => {
    expect(parseCatalogFilter({})).toEqual({});
  });

  test('parses every supported param', () => {
    expect(
      parseCatalogFilter({
        q: '  coffee  ',
        category: 'products',
        skills: 'ai-engineer, ml-engineer',
        location: 'Havana',
        availability: 'limited',
        verified: '1',
        madeInCuba: '1',
      }),
    ).toEqual({
      search: 'coffee',
      category: 'products',
      skills: ['ai-engineer', 'ml-engineer'],
      location: 'Havana',
      availability: 'limited',
      verifiedOnly: true,
      madeInCubaOnly: true,
    });
  });

  test('an unknown category is dropped, not trusted', () => {
    expect(parseCatalogFilter({ category: 'spaceships' }).category).toBeUndefined();
  });

  test('an unknown availability is dropped, not trusted', () => {
    expect(parseCatalogFilter({ availability: 'someday' }).availability).toBeUndefined();
  });

  test('skill lists are trimmed, deduped, and empties dropped', () => {
    expect(parseCatalogFilter({ skills: 'a,, a ,b,' }).skills).toEqual(['a', 'b']);
  });

  test('verified / madeInCuba need exactly "1"', () => {
    expect(parseCatalogFilter({ verified: 'yes' }).verifiedOnly).toBeUndefined();
    expect(parseCatalogFilter({ madeInCuba: 'true' }).madeInCubaOnly).toBeUndefined();
    expect(parseCatalogFilter({ verified: '0' }).verifiedOnly).toBeUndefined();
  });

  test('blank search and location are dropped', () => {
    expect(parseCatalogFilter({ q: '   ', location: '' })).toEqual({});
  });
});

describe('catalogFilterKey', () => {
  test('empty filter keys to an empty string', () => {
    expect(catalogFilterKey({})).toBe('');
  });

  test('key is stable under skill order', () => {
    expect(catalogFilterKey({ skills: ['b', 'a'] })).toBe(catalogFilterKey({ skills: ['a', 'b'] }));
  });

  test('key round-trips through parseCatalogFilter', () => {
    const filter = parseCatalogFilter({
      q: 'coffee',
      category: 'products',
      madeInCuba: '1',
    });
    expect(parseCatalogFilter(JSON.parse(catalogFilterKey(filter)))).toEqual(filter);
  });
});

describe('isValidCategory / isValidAvailability', () => {
  test('the three catalog categories, and nothing else', () => {
    expect(isValidCategory('talent')).toBe(true);
    expect(isValidCategory('services')).toBe(true);
    expect(isValidCategory('products')).toBe(true);
    expect(isValidCategory('talent ')).toBe(false);
    expect(isValidCategory(undefined)).toBe(false);
  });

  test('the three availability states, and nothing else', () => {
    expect(isValidAvailability('available')).toBe(true);
    expect(isValidAvailability('limited')).toBe(true);
    expect(isValidAvailability('unavailable')).toBe(true);
    expect(isValidAvailability('soon')).toBe(false);
  });
});

describe('normalizeOfferAttributes', () => {
  test('talent keeps only the documented talent keys', () => {
    expect(
      normalizeOfferAttributes('talent', {
        years_experience: 5,
        portfolio_urls: ['https://example.invalid/work'],
        availability: 'Weekdays',
        made_in_cuba: true,
        admin_note: 'smuggled',
      }),
    ).toEqual({
      years_experience: 5,
      portfolio_urls: ['https://example.invalid/work'],
      availability: 'Weekdays',
    });
  });

  test('services keeps scope, deliverables, conditions, pricing_basis', () => {
    expect(
      normalizeOfferAttributes('services', {
        scope: 'Brand audit',
        deliverables: ['Report', 'Workshop'],
        conditions: 'Remote only',
        pricing_basis: 'project',
        price_amount: 500,
      }),
    ).toEqual({
      scope: 'Brand audit',
      deliverables: ['Report', 'Workshop'],
      conditions: 'Remote only',
      pricing_basis: 'project',
    });
  });

  test('products keeps origin, specifications, quality, quantity, availability', () => {
    expect(
      normalizeOfferAttributes('products', {
        origin: 'Santiago de Cuba',
        specifications: { roast: 'medium', weight_kg: 1 },
        quality: 'Export grade',
        quantity: '500 kg / month',
        availability: 'Harvest season',
        verified: true,
      }),
    ).toEqual({
      origin: 'Santiago de Cuba',
      specifications: { roast: 'medium', weight_kg: 1 },
      quality: 'Export grade',
      quantity: '500 kg / month',
      availability: 'Harvest season',
    });
  });

  test('producers use the products shape plus products and documentation', () => {
    expect(
      normalizeOfferAttributes('products', {
        products: ['Coffee', 'Honey'],
        documentation: ['Origin certificate (pending)'],
      }),
    ).toEqual({ products: ['Coffee', 'Honey'], documentation: ['Origin certificate (pending)'] });
  });

  test('a wrong-typed value is dropped, not coerced', () => {
    expect(normalizeOfferAttributes('talent', { years_experience: 'five' })).toEqual({});
    expect(normalizeOfferAttributes('talent', { portfolio_urls: 'https://x.invalid' })).toEqual({});
    expect(normalizeOfferAttributes('services', { deliverables: ['Report', 42, null] })).toEqual({
      deliverables: ['Report'],
    });
  });

  test('non-object input normalizes to an empty object', () => {
    expect(normalizeOfferAttributes('talent', null)).toEqual({});
    expect(normalizeOfferAttributes('talent', 'nope')).toEqual({});
    expect(normalizeOfferAttributes('talent', [])).toEqual({});
  });

  test('an unknown category normalizes to an empty object', () => {
    expect(normalizeOfferAttributes('spaceships', { scope: 'x' })).toEqual({});
  });
});
