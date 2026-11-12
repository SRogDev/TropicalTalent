import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  resolveLocale,
  stripLocalePrefix,
  withLocale,
} from './i18n';
import enMessages from '../messages/en.json';
import esMessages from '../messages/es.json';

/** Every leaf key, dotted: `catalog.search`, `offers.title`. */
function messageKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    messageKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locale message parity', () => {
  test('en and es carry the same keys — a string translated in one locale exists in the other', () => {
    expect(messageKeys(esMessages).sort()).toEqual(messageKeys(enMessages).sort());
  });

  test('every message value is a non-empty string', () => {
    for (const messages of [enMessages, esMessages]) {
      const walk = (value: unknown): void => {
        if (typeof value === 'string') {
          expect(value.length).toBeGreaterThan(0);
          return;
        }
        Object.values(value as Record<string, unknown>).forEach(walk);
      };
      walk(messages);
    }
  });
});

/**
 * Locale routing helpers (Phase 1, next-intl).
 *
 * Pure functions, so they are testable without a request: the proxy strips
 * the locale prefix before its existing auth checks, and redirects bare
 * paths to their locale-prefixed form. Nothing here touches the network.
 */

describe('isLocale', () => {
  test('en and es are locales, everything else is not', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('EN')).toBe(false);
    expect(isLocale('')).toBe(false);
  });
});

describe('LOCALES / DEFAULT_LOCALE', () => {
  test('English and Spanish, English default', () => {
    expect(LOCALES).toEqual(['en', 'es']);
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

describe('stripLocalePrefix', () => {
  test('strips a leading locale segment', () => {
    expect(stripLocalePrefix('/en/briefs')).toEqual({ locale: 'en', path: '/briefs' });
    expect(stripLocalePrefix('/es/auth/sign-in')).toEqual({ locale: 'es', path: '/auth/sign-in' });
  });

  test('a bare locale path strips to /', () => {
    expect(stripLocalePrefix('/en')).toEqual({ locale: 'en', path: '/' });
    expect(stripLocalePrefix('/es/')).toEqual({ locale: 'es', path: '/' });
  });

  test('a path without a locale prefix reports no locale', () => {
    expect(stripLocalePrefix('/briefs')).toEqual({ locale: null, path: '/briefs' });
    expect(stripLocalePrefix('/')).toEqual({ locale: null, path: '/' });
  });

  test('/english is not a locale — only exact two-letter segments count', () => {
    expect(stripLocalePrefix('/english/briefs')).toEqual({
      locale: null,
      path: '/english/briefs',
    });
  });
});

describe('withLocale', () => {
  test('prefixes a bare path', () => {
    expect(withLocale('/briefs', 'es')).toBe('/es/briefs');
    expect(withLocale('/', 'en')).toBe('/en');
  });

  test('replaces an existing locale prefix instead of doubling it', () => {
    expect(withLocale('/en/briefs', 'es')).toBe('/es/briefs');
  });
});

describe('resolveLocale', () => {
  test('an explicit cookie locale wins', () => {
    expect(resolveLocale({ cookieLocale: 'es', acceptLanguage: 'en-US,en;q=0.9' })).toBe('es');
  });

  test('an invalid cookie locale falls through to Accept-Language', () => {
    expect(resolveLocale({ cookieLocale: 'fr', acceptLanguage: 'es-ES,es;q=0.9' })).toBe('es');
  });

  test('Spanish Accept-Language resolves to es', () => {
    expect(resolveLocale({ acceptLanguage: 'es-CU,es;q=0.8,en;q=0.5' })).toBe('es');
    expect(resolveLocale({ acceptLanguage: 'es' })).toBe('es');
  });

  test('anything else resolves to the default', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-FR,fr;q=0.9' })).toBe('en');
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ acceptLanguage: null })).toBe('en');
  });
});
