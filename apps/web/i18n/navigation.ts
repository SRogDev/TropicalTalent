import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Translated navigation helpers (Phase 1, next-intl).
 *
 * `Link`, `redirect`, `usePathname` and `useRouter` from here behave like
 * their `next/navigation` counterparts, except they keep the current locale
 * in the URL (`/es/briefs` stays `/es/...` when navigating). New and
 * touched components import from here; untouched components keep plain
 * `next/link` and still work, because the proxy redirects bare paths to
 * their locale-prefixed form (see docs/architecture/screen-architecture.md).
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
