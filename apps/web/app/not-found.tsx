import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * The root 404. Deliberately static, and deliberately unbranded.
 *
 * This boundary is rendered while `/` is statically generated, and `/` is
 * `force-static` — so anything this component reads, the BUILD reads. It used
 * to call getTenant(), which meant `next build` opened a database connection
 * and then threw "No classic tenant row" from getClassicTenant() whenever
 * Supabase was unreachable. A deploy failed on an error message pointing at a
 * migration that had in fact been applied, and nothing else in the build talks
 * to the database at all.
 *
 * It could not have been branded anyway: a page prerendered at build time has
 * no Host header, so `getTenant()` there can only ever return the classic
 * tenant — every white-label's 404 said "TropicalTalent" regardless.
 *
 * The branded 404 lives at app/(app)/not-found.tsx instead, inside the
 * signed-in shell, where the tenant is already resolved per request. That is
 * also where the 404s that matter happen: an anonymous visitor on a
 * white-label who hits an unknown path is sent to the sign-in form by the
 * gateway before this page is ever reached.
 */
// Unbranded, for the reason above, and explicit so that no page depends on a
// default title in the root layout.
export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className='flex min-h-dvh flex-col items-center justify-center px-6 text-center'>
      <h1 className='text-2xl font-bold tracking-tight'>Not found</h1>
      <p className='text-muted-foreground mt-2 max-w-sm text-sm'>
        This page does not exist, or you do not have access to it.
      </p>
      <Link
        href='/'
        className='gradient-app text-on-brand mt-6 rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90'
      >
        Back to home
      </Link>
    </main>
  );
}
