import type { Metadata } from 'next';
import Link from 'next/link';
import { SUB_PROCESSORS, PRIVACY_URL } from '@/lib/legal';
import { HOSTING_REGIONS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Sub-processors',
  description: 'Every company that processes personal data on behalf of Cubora.',
  robots: { index: true, follow: true },
};

/**
 * The published sub-processor list.
 *
 * Static, public, and outside the app shell, because two different audiences
 * need it without an account: a user reading the privacy policy, and a
 * white-label customer's procurement team, who will ask for exactly this list
 * before they sign anything.
 *
 * Force-static for the same reason as the landing page — it queries nothing,
 * and it should still be there if the database is not.
 *
 * The privacy policy names this page, so the two have to agree. The list is in
 * lib/legal.ts rather than inline here so the policy, this page and anything
 * else that needs it read from one array.
 */
export const dynamic = 'force-static';

export default function SubProcessorsPage() {
  return (
    <main className='mx-auto max-w-3xl px-5 py-16 sm:px-8'>
      <Link
        href='/'
        className='text-muted-foreground hover:text-foreground text-xs underline underline-offset-4'
      >
        Back
      </Link>

      <h1 className='mt-8 text-3xl font-semibold tracking-tight'>Sub-processors</h1>
      <p className='text-muted-foreground mt-3 max-w-prose text-sm leading-relaxed'>
        These companies process personal data on our behalf so that Cubora can work. Each one is
        under a written contract that restricts it to acting on our instructions and requires
        appropriate security. We do not sell personal data, and we share none of it for advertising.
      </p>

      <div className='mt-10 space-y-4'>
        {SUB_PROCESSORS.map((p) => (
          <section key={p.name} className='border-foreground/10 rounded-2xl border p-5'>
            <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
              <h2 className='text-base font-medium'>{p.name}</h2>
              <span className='text-muted-foreground text-xs'>{p.region}</span>
              {p.independentController && (
                <span className='text-muted-foreground border-foreground/15 rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase'>
                  Also its own controller
                </span>
              )}
            </div>
            <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>{p.purpose}</p>
            <a
              href={p.privacyUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-muted-foreground hover:text-foreground mt-2.5 inline-block text-xs underline underline-offset-4'
            >
              Their privacy policy
            </a>
          </section>
        ))}
      </div>

      <h2 className='mt-12 text-sm font-medium'>Where your data is held</h2>
      <p className='text-muted-foreground mt-2 max-w-prose text-sm leading-relaxed'>
        Our database, file storage and authentication run in {HOSTING_REGIONS.data}. The application
        is served from {HOSTING_REGIONS.app}. Resend processes data in the United States; where data
        leaves the UK or EEA we rely on an adequacy decision, or on the UK International Data
        Transfer Addendum together with the European Commission&rsquo;s Standard Contractual
        Clauses.
      </p>

      <h2 className='mt-8 text-sm font-medium'>Changes to this list</h2>
      <p className='text-muted-foreground mt-2 max-w-prose text-sm leading-relaxed'>
        We update this page when a sub-processor is added or removed. If you are a workspace
        customer and want advance notice of changes, tell us and we will add you to the list of
        people we write to.
      </p>

      <p className='text-muted-foreground mt-10 text-xs'>
        This page supports our{' '}
        <a
          href={PRIVACY_URL}
          target='_blank'
          rel='noopener noreferrer'
          className='underline underline-offset-4'
        >
          Privacy Policy
        </a>
        .
      </p>
    </main>
  );
}
