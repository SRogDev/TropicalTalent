import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { siteUrl } from '@/lib/urls';
import { ThemeToggleButton } from '@/components/shared/theme-toggle-button';
import { SignUpDialog } from '@/components/waitlist/sign-up-dialog';

/**
 * The landing page.
 *
 * The CTA opens a real sign-up. It reads "Sign up" and the flow it opens
 * creates a Supabase auth account and a real profile instead of a `waitlist`
 * row. The waitlist table is still written to on every sign-up — production
 * reporting reads it and dropping the write would leave a hole in the funnel.
 */

export const dynamic = 'force-static';

const TAGLINE = 'Cuban talent, connected with the world.';

// NEXT_PUBLIC_SITE_URL is sometimes set without a scheme (e.g. "tropicaltalent.dev"),
// which throws in `new URL()` and fails the production build. Normalise it
// instead of trusting it is already absolute.
function resolveSiteUrl(raw: string | undefined, fallback: string): URL {
  const value = raw?.trim() || fallback;
  try {
    return new URL(value);
  } catch {
    return new URL(`https://${value}`);
  }
}

export const metadata: Metadata = {
  title: 'TropicalTalent — Cuban talent, connected with the world',
  description: `${TAGLINE} Sign up to get started.`,
  metadataBase: resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, siteUrl()),
  // Moved down from the root layout, which every tenant inherits. This page is
  // classic-only, so naming TropicalTalent here is a statement about the site
  // actually being served rather than one stamped on a customer's own domain.
  authors: [{ name: 'TropicalTalent' }],
  creator: 'TropicalTalent',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'TropicalTalent — Cuban talent, connected with the world',
    description: `${TAGLINE} Sign up to get started.`,
    url: '/',
    siteName: 'TropicalTalent',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TropicalTalent — Cuban talent, connected with the world',
    description: `${TAGLINE} Sign up to get started.`,
  },
  robots: { index: true, follow: true },
};

export default function LandingPage() {
  return (
    <main className='relative flex min-h-dvh flex-col overflow-x-hidden'>
      <div className='pointer-events-none fixed inset-0 overflow-hidden'>
        <div className='absolute -top-40 left-1/2 h-130 w-130 -translate-x-1/2 rounded-full bg-emerald-400/15 blur-3xl' />
        <div className='absolute top-40 right-5 h-130 w-130 rounded-full bg-lime-400/15 blur-3xl md:right-40' />
        <div className='absolute bottom-1/4 left-0 h-130 w-130 -translate-x-1/3 rounded-full bg-green-400/10 blur-3xl md:-translate-x-1/4' />
      </div>

      <header className='relative z-10 flex items-center justify-between px-6 py-6 md:px-10 md:py-8'>
        <Image
          src='/tropical-talent-logo.svg'
          alt='TropicalTalent'
          width={32}
          height={32}
          priority
          className='h-8 w-8'
        />
        <div className='flex items-center gap-1'>
          {/* The page is force-static, so this stays a plain link rather than
              branching on auth. A signed-in visitor who clicks it is redirected
              from /auth/* straight into the app by the gateway, so "Log in"
              behaves as "open the app" for them without costing the static
              render. */}
          <Button asChild variant='ghost' size='sm' className='text-sm'>
            <Link href='/auth/sign-in'>Log in</Link>
          </Button>
          <ThemeToggleButton />
        </div>
      </header>

      <section className='relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center'>
        {/* The old markup pinned --font-arvo here, which was declared as Inter
            under a second name. Dropping it changes nothing visually and
            removes a duplicate webfont from the critical path. */}
        <h1 className='text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl'>
          <span className='gradient-app-text'>Cuban talent</span>, connected with the world.
        </h1>
        <p className='text-muted-foreground mt-6 max-w-lg text-base sm:text-lg'>{TAGLINE}</p>

        <div className='mt-10'>
          <SignUpDialog
            trigger={
              <Button
                size='lg'
                className='gradient-app text-on-brand h-12 px-8 text-base hover:opacity-90'
              >
                Sign up
              </Button>
            }
          />
        </div>
      </section>

      <footer className='text-muted-foreground relative z-10 flex items-center justify-center gap-2 px-6 pb-8 text-xs'>
        <Image
          src='/tropical-talent-logo.svg'
          alt=''
          width={16}
          height={16}
          className='h-4 w-4'
        />
        <span>&copy; {new Date().getFullYear()} TropicalTalent</span>
      </footer>
    </main>
  );
}
