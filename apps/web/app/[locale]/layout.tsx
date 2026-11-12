import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { ToastProvider } from '@/components/ui/toast';
import { isLocale, LOCALES, type Locale } from '@/lib/i18n';
import './globals.css';

/**
 * Locale layout.
 *
 * Every page lives under here, so every page is served at a locale-prefixed
 * URL (`/en/...`, `/es/...`). An unknown locale segment 404s. Static
 * rendering works because `setRequestLocale` is called here and
 * `generateStaticParams` lists both locales.
 *
 * What used to live in the root layout — the fonts, the theme provider, the
 * toast provider, the default metadata — lives here now, because the
 * language and the translated copy are only known at this segment.
 */

const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
});

// Playfair Display is the display face: the landing tagline and marketing
// headings. The app UI stays Inter throughout — a serif body would hurt
// legibility in dense screens (see docs/architecture/design-system.md).
const playfair = Playfair_Display({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  preload: false,
  fallback: ['Georgia', 'serif'],
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: {
    default: 'Cubora — Born from ingenuity. Built through resilience. Made in Cuba.',
    template: '%s · Cubora',
  },
  description: 'Born from ingenuity. Built through resilience. Made in Cuba.',
  authors: [{ name: 'Cubora' }],
  creator: 'Cubora',
  robots: { index: true, follow: true },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available — capping it is an accessibility regression,
  // and the layouts below do not need it suppressed to behave.
  viewportFit: 'cover' as const,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Enables static rendering for every page under this segment.
  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} ${playfair.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute='class'
            defaultTheme='system'
            enableSystem
            disableTransitionOnChange
          >
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
