import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';
import { isLocale } from '@/lib/i18n';

/**
 * Message loader (Phase 1, next-intl).
 *
 * One JSON file per locale under `messages/`. An unknown locale falls back
 * to the default rather than 404ing — the proxy only ever routes known
 * locales here, so this is a guard, not a path.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested ?? '') ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
