import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

/**
 * Root layout.
 *
 * What is NOT here, compared to the previous one: a Suspense boundary wrapping
 * the entire tree (which made every page a client-side waterfall behind a null
 * fallback), a PostHog/Sentry/Vercel-Analytics client-providers bundle, and a
 * second Google font that was Inter under a different variable name.
 */

const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
});

/**
 * Only what is true for every tenant.
 *
 * The title, description, authors and creator that used to live here were
 * TropicalTalent's own, and metadata is inherited — so a white-label's every page served
 * `<meta name="author" content="TropicalTalent">` and TropicalTalent's tagline as its description,
 * on the customer's own domain. That copy now lives on app/page.tsx, which is
 * the classic marketing page and the only place it describes the site being
 * served (a white-label's `/` is redirected to its sign-in form by the
 * gateway, so it never renders that page).
 *
 * Deliberately not fixed by making this tenant-aware: a generateMetadata here
 * reads the Host header, which would force every route — the force-static
 * marketing page included — to render dynamically. `app/(app)/layout.tsx`
 * already explains that trade-off, and the per-segment generateMetadata it
 * describes is where tenant branding belongs. Every page now sets its own
 * title, so nothing falls back to a default here.
 */
export const metadata: Metadata = {
  title: {
    default: 'TropicalTalent — Cuban talent, connected with the world',
    template: '%s · TropicalTalent',
  },
  description: 'Cuban talent, connected with the world.',
  authors: [{ name: 'TropicalTalent' }],
  creator: 'TropicalTalent',
  robots: { index: true, follow: true },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available — capping it is an accessibility regression,
  // and the layouts below do not need it suppressed to behave.
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
