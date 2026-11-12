/**
 * Locale routing helpers (Phase 1, next-intl).
 *
 * The supported locales and the default live here, not in the proxy, so the
 * proxy, the locale layout, and the tests all read one list. Every function
 * is pure — no request, no cookies — so `lib/i18n.test.ts` covers them
 * without a server.
 *
 * `next-intl` itself owns message loading (`i18n/request.ts`) and the
 * translated navigation helpers (`i18n/navigation.ts`); this file owns the
 * string-level routing the proxy needs before any of that runs.
 */

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** The cookie next-intl's locale handling reads and writes. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Splits a pathname into its locale prefix (when present) and the bare path.
 *
 * Only an exact two-letter first segment counts — `/english/briefs` is not
 * a locale, it is a (nonexistent) route.
 */
export function stripLocalePrefix(pathname: string): { locale: Locale | null; path: string } {
  const segments = pathname.split('/');
  const candidate = segments[1] ?? '';
  if (isLocale(candidate)) {
    const rest = segments.slice(2).join('/');
    return { locale: candidate, path: rest ? `/${rest}` : '/' };
  }
  return { locale: null, path: pathname };
}

/** Prefixes a path with a locale, replacing any prefix already there. */
export function withLocale(path: string, locale: Locale): string {
  const { path: bare } = stripLocalePrefix(path);
  return bare === '/' ? `/${locale}` : `/${locale}${bare}`;
}

/**
 * Which locale a request should get, from the explicit cookie first and
 * then the Accept-Language header.
 *
 * Only the primary language subtag is read (`es-CU` → `es`); quality values
 * are ignored, because the choice is between two locales and the first
 * supported one in the header wins. Anything unrecognised falls back to the
 * default rather than guessing.
 */
export function resolveLocale(input: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (input.cookieLocale && isLocale(input.cookieLocale)) return input.cookieLocale;

  const header = input.acceptLanguage ?? '';
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    const primary = tag.split('-')[0];
    if (primary && isLocale(primary)) return primary;
  }

  return DEFAULT_LOCALE;
}
