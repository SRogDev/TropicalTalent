import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

/**
 * Server-side Supabase clients.
 *
 * `db()` is wrapped in React.cache, so every module that asks for a client
 * during one request gets the same instance and the same parsed cookie jar.
 * Without that, ten service calls in a page would each re-read and re-parse
 * the cookie store.
 */
export const db = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to drop.
          }
        },
      },
    },
  );
});

/**
 * Service-role client. Bypasses RLS.
 *
 * Only for operations a signed-in user provably cannot perform as themselves:
 * writing bot messages (sender_id NULL), flipping escrow on a payment provider webhook,
 * and creating auth users during sign-up. Every call site is expected to have
 * already established who the caller is.
 */
export function adminDb() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    },
  );
}
