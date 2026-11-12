/**
 * Next config for tropical.
 *
 * Deliberately small. The previous config carried a Sentry wrapper, a webpack
 * override to silence OpenTelemetry warnings, PostHog CSP entries and a
 * `typescript.ignoreBuildErrors: true` escape hatch. All of that is gone:
 * the instrumentation is no longer installed, and type errors now fail the
 * build rather than shipping.
 */

import createNextIntlPlugin from 'next-intl/plugin';

// next-intl needs this wrapper: it aliases the `next-intl/config` import to
// ./i18n/request.ts, which is how getTranslations()/getMessages() find the
// message loader. Without it the build fails at prerender time with
// "Couldn't find next-intl config file".
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
  } catch {
    return '*.supabase.co';
  }
})();

// One source of truth for the CSP. Only the origins this app actually talks to:
// Supabase (REST, storage, realtime websocket). No payment provider is used in
// this reference build, so no payment origins appear here.
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next's inline bootstrap script; 'unsafe-eval'
  // only in dev, where React refresh needs it.
  `script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' blob: data: https://${supabaseHost} https://*.supabase.co`,
  `media-src 'self' blob: https://${supabaseHost} https://*.supabase.co`,
  `connect-src 'self' https://${supabaseHost} https://*.supabase.co wss://${supabaseHost} wss://*.supabase.co`,
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
]
  .filter(Boolean)
  .join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,

  // lucide-react ships one module per icon. Without this every icon import
  // pulls the whole barrel into the dev compile graph, which was a large part
  // of the local build lag.
  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{kebabCase member}}',
    },
  },

  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
