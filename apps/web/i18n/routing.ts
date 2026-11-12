import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n';

/**
 * next-intl routing (Phase 1).
 *
 * Locales `en` + `es`, English default, locale prefix always present in the
 * URL (`/en/briefs`, `/es/briefs`). The proxy (`proxy.ts`) performs the
 * redirect from bare paths using the same locale list from `lib/i18n`;
 * this routing object is what the translated navigation helpers and the
 * message loader read.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});
