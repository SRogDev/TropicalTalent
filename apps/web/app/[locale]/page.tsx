import Image from 'next/image';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Briefcase, Package, Search, ShieldCheck, MessagesSquare, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { siteUrl } from '@/lib/urls';
import { ThemeToggleButton } from '@/components/shared/theme-toggle-button';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { MadeInCubaBadge } from '@/components/tropical/made-in-cuba-badge';
import { SignUpDialog } from '@/components/waitlist/sign-up-dialog';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/lib/i18n';

/**
 * The Cubora landing page.
 *
 * Brand: Cubora. Tagline: "Born from ingenuity. Built through resilience.
 * Made in Cuba." Contemporary and minimal, light green as the primary brand
 * colour, no tourist clichés, no stereotypical imagery.
 *
 * The CTA opens a real sign-up. It reads "Sign up" and the flow it opens
 * creates a Supabase auth account and a real profile instead of a `waitlist`
 * row. The waitlist table is still written to on every sign-up — production
 * reporting reads it and dropping the write would leave a hole in the funnel.
 *
 * No testimonials: there are no real buyers to quote yet, and inventing
 * quotes would fabricate the trust this page is trying to establish.
 */

export const dynamic = 'force-static';

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: 'landing' });
  const title = `Cubora — ${t('tagline')}`;
  const description = `${t('description')} ${t('tagline')}`;
  return {
    title,
    description,
    metadataBase: resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, siteUrl()),
    authors: [{ name: 'Cubora' }],
    creator: 'Cubora',
    alternates: { canonical: '/' },
    openGraph: {
      title,
      description,
      url: '/',
      siteName: 'Cubora',
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

const CATEGORIES = [
  { key: 'talent', icon: Users },
  { key: 'services', icon: Briefcase },
  { key: 'products', icon: Package },
] as const;

const STEPS = [
  { key: 'howStep1', icon: Search },
  { key: 'howStep2', icon: ShieldCheck },
  { key: 'howStep3', icon: MessagesSquare },
] as const;

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('landing');

  return (
    <main className='relative flex min-h-dvh flex-col overflow-x-hidden'>
      <div className='pointer-events-none fixed inset-0 overflow-hidden'>
        <div className='absolute -top-40 left-1/2 h-130 w-130 -translate-x-1/2 rounded-full bg-emerald-400/15 blur-3xl' />
        <div className='absolute top-40 right-5 h-130 w-130 rounded-full bg-lime-400/15 blur-3xl md:right-40' />
        <div className='absolute bottom-1/4 left-0 h-130 w-130 -translate-x-1/3 rounded-full bg-green-400/10 blur-3xl md:-translate-x-1/4' />
      </div>

      <header className='relative z-10 flex items-center justify-between px-6 py-6 md:px-10 md:py-8'>
        <Link href='/' className='flex items-center gap-2.5' aria-label='Cubora'>
          <Image
            src='/cubora-logo.svg'
            alt='Cubora'
            width={32}
            height={32}
            priority
            className='h-8 w-8'
          />
          <span className='text-lg font-semibold tracking-tight'>Cubora</span>
        </Link>
        <div className='flex items-center gap-1'>
          <LocaleSwitcher />
          {/* The page is force-static, so this stays a plain link rather than
              branching on auth. A signed-in visitor who clicks it is redirected
              from /auth/* straight into the app by the gateway, so "Log in"
              behaves as "open the app" for them without costing the static
              render. */}
          <Button asChild variant='ghost' size='sm' className='text-sm'>
            <Link href='/auth/sign-in'>{t('login')}</Link>
          </Button>
          <ThemeToggleButton />
        </div>
      </header>

      <section className='relative z-10 flex flex-1 flex-col items-center justify-center px-6 pt-16 pb-24 text-center'>
        <p className='bg-foreground/5 border-foreground/10 rounded-full border px-4 py-1.5 text-xs font-medium tracking-wide'>
          {t('badge')}
        </p>
        <h1 className='mt-8 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl'>
          <span className='gradient-app-text'>{t('titleA')}</span> {t('titleB')}
        </h1>
        {/* The tagline in the display face (Playfair Display): the one
            editorial moment on the page. Everything else is Inter. */}
        <p className='font-display mt-6 max-w-xl text-xl font-medium text-balance sm:text-2xl'>
          {t('tagline')}
        </p>
        <p className='text-muted-foreground mt-6 max-w-lg text-base sm:text-lg'>
          {t('description')}
        </p>

        <div className='mt-10 flex flex-col items-center gap-3 sm:flex-row'>
          <SignUpDialog
            trigger={
              <Button
                size='lg'
                className='gradient-app text-on-brand h-12 px-8 text-base hover:opacity-90'
              >
                {t('ctaSignup')}
              </Button>
            }
          />
          <Button asChild size='lg' variant='outline' className='h-12 px-8 text-base'>
            <a href='#how-it-works'>{t('ctaExplore')}</a>
          </Button>
        </div>
      </section>

      <section className='relative z-10 px-6 py-24 md:px-10'>
        <div className='mx-auto max-w-5xl'>
          <h2 className='text-center text-2xl font-bold tracking-tight sm:text-3xl'>
            {t('categoriesTitle')}
          </h2>
          <p className='text-muted-foreground mx-auto mt-4 max-w-2xl text-center text-base'>
            {t('categoriesIntro')}
          </p>
          <div className='mt-12 grid gap-6 md:grid-cols-3'>
            {CATEGORIES.map(({ key, icon: Icon }) => (
              <article
                key={key}
                className='glass rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5'
              >
                <span className='bg-primary/10 text-primary grid h-11 w-11 place-items-center rounded-xl'>
                  <Icon size={22} aria-hidden='true' />
                </span>
                <h3 className='mt-5 text-lg font-semibold'>{t(`${key}Title`)}</h3>
                <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
                  {t(`${key}Text`)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id='how-it-works' className='relative z-10 scroll-mt-16 px-6 py-24 md:px-10'>
        <div className='mx-auto max-w-5xl'>
          <h2 className='text-center text-2xl font-bold tracking-tight sm:text-3xl'>
            {t('howTitle')}
          </h2>
          <ol className='mt-12 grid gap-6 md:grid-cols-3'>
            {STEPS.map(({ key, icon: Icon }, i) => (
              <li key={key} className='relative rounded-2xl p-6'>
                <span className='text-muted-foreground flex items-center gap-3 text-sm font-semibold'>
                  <span className='bg-primary/10 text-primary grid h-11 w-11 shrink-0 place-items-center rounded-xl'>
                    <Icon size={22} aria-hidden='true' />
                  </span>
                  <span aria-hidden='true'>0{i + 1}</span>
                </span>
                <h3 className='mt-5 text-lg font-semibold'>{t(`${key}Title`)}</h3>
                <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
                  {t(`${key}Text`)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className='relative z-10 px-6 py-24 md:px-10'>
        <div className='glass mx-auto flex max-w-5xl flex-col items-center gap-8 rounded-2xl p-8 text-center md:flex-row md:p-12 md:text-left'>
          <MadeInCubaBadge size={120} showLabel={false} className='shrink-0' />
          <div>
            <h2 className='text-2xl font-bold tracking-tight sm:text-3xl'>{t('sealTitle')}</h2>
            <p className='text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed'>
              {t('sealText')}
            </p>
          </div>
        </div>
      </section>

      <footer className='text-muted-foreground relative z-10 flex flex-col items-center justify-center gap-2 px-6 pb-8 text-center text-xs'>
        <Image src='/cubora-logo.svg' alt='' width={16} height={16} className='h-4 w-4' />
        <span>&copy; {new Date().getFullYear()} Cubora</span>
        <span className='max-w-md'>{t('footerNote')}</span>
      </footer>
    </main>
  );
}
