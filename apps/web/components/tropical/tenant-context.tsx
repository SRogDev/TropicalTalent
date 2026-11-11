'use client';

import { createContext, useContext, useMemo } from 'react';
import { nounsFor, type TenantNouns } from '@/modules/tenancy/presets';

/**
 * The tenant's NAME and its nouns, for client components.
 *
 * Server components call getTenant() directly. Client components cannot, and
 * threading a `tenantName` prop through every dialog and panel that mentions
 * the brand by name would be a lot of plumbing for one string.
 *
 * The provider is mounted once, in AppShell, which already receives the
 * resolved tenant from the layout — so this adds no fetch, no request, and no
 * hydration cost beyond the strings themselves.
 *
 * ---------------------------------------------------------------------------
 * Why the nouns live here too
 * ---------------------------------------------------------------------------
 * This started as name-only, on the reasoning that colours belong in CSS and
 * features belong on the server. Both still hold. The nouns are neither: they
 * are copy, and copy is exactly what a client component renders.
 *
 * Without them the app tells a contractor platform's customers that "talent
 * apply to them" — a word from a different industry, on the screen where they
 * post work. Hardcoding the marketplace's vocabulary is the same class of
 * mistake as hardcoding its colours, and it is more noticeable, because people
 * read the words.
 *
 * Still deliberately NOT the whole tenant object: putting features in here
 * would invite client code to branch on decisions the server already made.
 */
interface TenantCopy {
  name: string;
  nouns: TenantNouns;
}

const CLASSIC: TenantCopy = { name: 'TropicalTalent', nouns: nounsFor('classic') };

const TenantCopyContext = createContext<TenantCopy>(CLASSIC);

export function TenantNameProvider({
  name,
  nouns,
  children,
}: {
  name: string;
  nouns: TenantNouns;
  children: React.ReactNode;
}) {
  // Memoised: AppShell re-renders on every navigation, and a fresh object
  // identity here would re-render every consumer with it for two strings that
  // never change within a request.
  const value = useMemo(() => ({ name, nouns }), [name, nouns]);

  return <TenantCopyContext.Provider value={value}>{children}</TenantCopyContext.Provider>;
}

/**
 * The current tenant's name.
 *
 * Defaults to 'TropicalTalent' when no provider is above it — true for the auth screens
 * and the landing page, which sit outside the app shell and are TropicalTalent's own
 * surfaces anyway.
 */
export function useTenantName(): string {
  return useContext(TenantCopyContext).name;
}

/**
 * What this tenant calls the people on each side of the marketplace.
 *
 * `nouns.worker.many` is "contractors" on a contractor platform and
 * "talent" on classic. Use it anywhere copy would otherwise have to pick
 * one industry's vocabulary and impose it on the other's customers.
 */
export function useTenantNouns(): TenantNouns {
  return useContext(TenantCopyContext).nouns;
}
