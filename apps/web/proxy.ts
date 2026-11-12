import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  LOCALE_COOKIE,
  resolveLocale,
  stripLocalePrefix,
  withLocale,
  type Locale,
} from '@/lib/i18n';

/**
 * Edge gateway. Routing only.
 *
 * ---------------------------------------------------------------------------
 * Why this file looks nothing like the one it replaces
 * ---------------------------------------------------------------------------
 * The previous middleware ran, on EVERY request including every page
 * navigation:
 *
 *   1. supabase.auth.getUser()   — an HTTPS round trip to the Supabase Auth
 *                                  service, ~120-300ms
 *   2. a users row lookup        — to check profile_completed
 *   3. a creative_data lookup    — to check verification status
 *   4. a second users lookup     — to check the admin role
 *   5. four console.log calls    — serialised on the edge runtime
 *
 * That is up to four sequential network round trips before Next.js even began
 * rendering, on top of the render's own queries. It was the dominant term in
 * time-to-first-byte and it scaled with nothing — it was paid on a cache hit,
 * on a static asset that slipped past the matcher, on everything.
 *
 * What replaces it:
 *
 *   * Session state is read from the cookie and decoded LOCALLY. No network.
 *   * getUser() is called only when the access token is at or near expiry,
 *     which is the one case where a refresh has to happen anyway — roughly
 *     once an hour per user instead of once per request.
 *   * Zero database queries. Profile completeness and role are established
 *     once per render by the app-shell layout, which is already loading the
 *     profile for the sidebar.
 *   * The matcher excludes every static path, so assets never enter here.
 *
 * SECURITY NOTE: the locally-decoded token is used ONLY to decide where to
 * send a request. It is never treated as proof of identity. Authorisation is
 * Postgres RLS plus a verified getUser() inside the server components that
 * read data — a forged cookie gets you a redirect to a page whose queries
 * return nothing.
 */

// Both isPublic checks below used to also exempt '/u/' as "public profile
// pages". No app/u route has ever existed in this tree — profiles live at
// /profile/[username] and are gated — so the rule only widened the unauthed
// surface for a path that 404s. Removed rather than pointed at /profile:
// making profiles public is a product decision, not a routing cleanup.
const PUBLIC_PATHS = ['/', '/terms', '/privacy-policy', '/sub-processors', '/unsubscribe'];
// Routes that authenticate themselves and therefore must not be gated on a
// session cookie here.
//
// /api/cron/* with `Authorization: Bearer $CRON_SECRET`. Its caller is not a
// browser and has no cookie, so without the exemption this gateway 401s it
// before its own check ever runs.
//
// That is exactly what happened to the crons. Both entries in vercel.json —
// the weekly check-in and the daily retention run — were being rejected here.
// The routes' own bearer checks were correct the whole time and simply never
// reached. (The recurring pay run and its payment webhook are gone with
// payments in this reference build.)
const PUBLIC_API = ['/api/waitlist', '/api/cron/'];

/**
 * Hosts that serve the classic Cubora app, including its marketing page.
 *
 * Everything NOT on this list is a white-label hostname, and `/` there is
 * redirected to sign-in — see platformHost() below.
 *
 * A prefix list of strings rather than a lookup, because this file makes no
 * database queries by design (see the header). It does not need to know WHICH
 * tenant a host belongs to, only whether it is ours.
 */
// Exact matches only. A SUBdomain of localhost is how a white-label is tested
// locally — northwinds.localhost is a tenant, plain localhost is the platform —
// so matching these as suffixes would make local testing silently impossible.
const PLATFORM_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// Suffixes. Preview deployments only: without this every preview URL would be
// treated as a white-label and its landing page would redirect to sign-in.
const PLATFORM_HOST_SUFFIXES = ['.vercel.app'];

/** Auth routes a SIGNED-IN user is allowed to stay on. */
const AUTHED_AUTH_PATHS = [
  '/auth/callback',
  '/auth/complete',
  '/auth/update-password',
  // Where the bounce below sends them. Exempt, or it redirects to itself.
  '/auth/continue',
  // Reached WITH a session by definition: the (app) layout sends a signed-in
  // user here when they are not a member of the tenant this host resolves to.
  // Without the exemption it loops — the bounce below sends them to
  // /auth/continue, which resolves their home, whose layout sends them back.
  '/auth/no-access',
];

/** Seconds before real expiry at which we proactively refresh. */
const REFRESH_MARGIN_SECONDS = 120;

/**
 * Is this host the classic app rather than a white-label?
 *
 * The apex comes from NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL — whatever
 * Cubora itself is served on — plus local and preview hosts. Anything else got
 * here through a tropical_tenant_domains row, which only a white-label has.
 *
 * Fails toward CLASSIC: an unparseable configuration means every host is
 * treated as the platform, which shows Cubora's own landing page to a
 * white-label's visitor. That is a cosmetic wrong answer. The opposite default
 * would redirect the real marketing site to a login form.
 */
function platformHost(host: string): boolean {
  if (!host) return true;
  const bare = host.toLowerCase().split(':')[0];

  if (PLATFORM_HOSTS.includes(bare)) return true;
  if (PLATFORM_HOST_SUFFIXES.some((suffix) => bare.endsWith(suffix))) return true;

  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
  if (!configured) return true;
  try {
    const apex = new URL(
      configured.startsWith('http') ? configured : `https://${configured}`,
    ).hostname.toLowerCase();
    // The apex itself and `www.` in front of it. A SUBdomain of the apex is a
    // white-label — that is exactly what acme.tropicaltalent.dev is.
    return bare === apex || bare === `www.${apex}`;
  } catch {
    return true;
  }
}

/**
 * An absolute URL on the host the visitor is actually on.
 *
 * Neither `request.nextUrl` nor `new URL(path, request.url)` is reliable here,
 * and — contrary to an earlier comment in this file — they are not different
 * from each other: both are derived from the same base URL that Next hands the
 * proxy. On Vercel's edge runtime that base is the real request URL and carries
 * the tenant subdomain; under a self-hosted `next start` it is built from the
 * server's own hostname and port (next-server.js composes it from
 * `fetchHostname`, not the Host header), so every redirect out of here would
 * point at `http://localhost:3000`.
 *
 * The forwarded headers are the one thing that always describes what the
 * browser asked for, so redirects are built from those and fall back to the
 * incoming URL only when they are absent.
 */
function selfUrl(request: NextRequest, path: string): URL {
  const forwardedHost = first(request.headers.get('x-forwarded-host'));
  const host = forwardedHost || first(request.headers.get('host'));
  if (!host) return new URL(path, request.nextUrl);

  const proto =
    first(request.headers.get('x-forwarded-proto')) ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.includes('.localhost')
      ? 'http'
      : 'https');

  return new URL(path, `${proto}://${host}`);
}

/** The first entry of a possibly comma-separated forwarded header. */
function first(value: string | null): string {
  return value?.split(',')[0].trim() ?? '';
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Locale handling (Phase 1, next-intl).
  //
  // Every page lives under /[locale]/, so `bare` is the path the existing
  // checks below were written against and `locale` is the segment they
  // redirect to. `locale` comes from the URL prefix when present, otherwise
  // from the NEXT_LOCALE cookie and then Accept-Language.
  //
  // Paths that live OUTSIDE the locale segment — /api/* and the root
  // /unsubscribe handler — never get a prefix; everything else bare is
  // redirected to its locale-prefixed form, preserving the query string.
  const { locale: prefixLocale, path: bare } = stripLocalePrefix(pathname);
  const locale: Locale =
    prefixLocale ??
    resolveLocale({
      cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get('accept-language'),
    });

  // A white-label's root is its front door, not Cubora's shop window.
  //
  // The customer puts this hostname on their own website, so a visitor landing
  // on `/` is one of their people trying to sign in. Serving them Cubora's
  // marketing page — a Cubora logo and a Cubora sign-up — is the single most visible way a white-label
  // stops looking like the customer's own product.
  //
  // Handled here rather than in app/[locale]/page.tsx because that page is
  // `force-static`: it never reads the request, which is what keeps the real
  // marketing site fast. This costs one string comparison and no query.
  if (bare === '/' && !platformHost(request.headers.get('host') ?? '')) {
    // selfUrl(), so the tenant's hostname survives the redirect. The search
    // string is carried over deliberately: a ?ref= share link lands on `/` and
    // the sign-up dialog on the other side reads the code out of the URL.
    const url = selfUrl(request, withLocale('/auth/sign-in', locale));
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url);
  }

  // A Supabase auth code can land on any path if the dashboard's Site URL is
  // misconfigured. Funnel it to the callback rather than 404ing the user.
  const code = request.nextUrl.searchParams.get('code');
  if (code && bare !== '/auth/callback') {
    const url = selfUrl(request, withLocale('/auth/callback', locale));
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url);
  }

  // Bare page paths redirect to their locale-prefixed form. API routes and
  // the root unsubscribe handler live outside the locale segment and are
  // exempt. The cookie records the choice so the next bare visit resolves
  // the same way without re-reading Accept-Language.
  const LOCALELESS = ['/api/', '/unsubscribe'];
  if (!prefixLocale && !LOCALELESS.some((p) => bare === p || bare.startsWith(p))) {
    const url = selfUrl(request, withLocale(bare, locale));
    url.search = request.nextUrl.search;
    const response = NextResponse.redirect(url);
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
    });
    return response;
  }

  const session = readSessionFromCookies(request);

  // Refresh only when the token is spent. This is the sole path that can make
  // a network call, and it fires about once an hour per signed-in user.
  if (session.present && session.expiresWithin(REFRESH_MARGIN_SECONDS)) {
    return refreshAndContinue(request);
  }

  const signedIn = session.present && !session.expiresWithin(0);

  if (bare.startsWith('/api/')) {
    if (PUBLIC_API.some((p) => bare.startsWith(p))) return NextResponse.next();
    if (!signedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.next();
  }

  // A signed-in visitor on an auth page wants the app, not the form.
  //
  // This used to redirect to `/`, which is the static landing page — so the
  // landing page's own "Log in" button sent a signed-in visitor back to the
  // landing page and appeared to do nothing. /auth/continue resolves the
  // account's home instead; it is the only place that can, because the role
  // lives in the database and this gateway deliberately makes no queries.
  //
  // /auth/callback and /auth/complete are exempt: both are reached WITH a
  // session by design. Bouncing them would put an OAuth user in a loop —
  // callback signs them in, redirects to complete, gateway sees a session and
  // sends them to the app, app sees an incomplete profile and sends them back.
  // /auth/update-password is exempt for the same reason: the reset link signs
  // the user in and then needs the form.
  if (signedIn && bare.startsWith('/auth/') && !AUTHED_AUTH_PATHS.some((p) => bare.startsWith(p))) {
    const url = selfUrl(request, withLocale('/auth/continue', locale));
    // A deep link that bounced through sign-in keeps its destination.
    const wanted = request.nextUrl.searchParams.get('next');
    if (wanted) url.searchParams.set('next', wanted);
    return NextResponse.redirect(url);
  }

  const isPublic = PUBLIC_PATHS.includes(bare) || bare.startsWith('/auth/');

  if (!isPublic && !signedIn) {
    const url = selfUrl(request, withLocale('/auth/sign-in', locale));
    url.searchParams.set('next', withLocale(bare, locale) + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * The one path that talks to Supabase. getUser() rotates the refresh token and
 * hands back new cookies, which are written onto the response so the browser
 * carries the fresh session forward.
 */
async function refreshAndContinue(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Same locale split as proxy(): the checks below read the bare path and
  // the redirects carry the locale prefix.
  const { locale: prefixLocale, path: bare } = stripLocalePrefix(pathname);
  const locale: Locale =
    prefixLocale ??
    resolveLocale({
      cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get('accept-language'),
    });
  const isPublic =
    PUBLIC_PATHS.includes(bare) ||
    bare.startsWith('/auth/') ||
    PUBLIC_API.some((p) => bare.startsWith(p));

  if (!user && !isPublic) {
    if (bare.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = selfUrl(request, withLocale('/auth/sign-in', locale));
    url.searchParams.set('next', withLocale(bare, locale) + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Same bounce as the fast path above, for the once-an-hour request that
  // lands here instead. The refreshed cookies are copied onto the redirect:
  // dropping them would throw away a rotated refresh token and sign the user
  // out on the very navigation that was meant to keep them in.
  if (user && bare.startsWith('/auth/') && !AUTHED_AUTH_PATHS.some((p) => bare.startsWith(p))) {
    const url = selfUrl(request, withLocale('/auth/continue', locale));
    const wanted = request.nextUrl.searchParams.get('next');
    if (wanted) url.searchParams.set('next', wanted);

    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

// ---------------------------------------------------------------------------
// Local cookie decoding
// ---------------------------------------------------------------------------

interface SessionProbe {
  present: boolean;
  /** true when the access token expires within `seconds` from now. */
  expiresWithin: (seconds: number) => boolean;
}

const ABSENT: SessionProbe = { present: false, expiresWithin: () => true };

/**
 * Reads the Supabase session cookie without verifying its signature.
 *
 * @supabase/ssr stores the session as `sb-<ref>-auth-token`, base64-prefixed
 * JSON, and splits it across `.0`, `.1`, … chunks when it exceeds the cookie
 * size limit. Both shapes are handled here.
 *
 * An unparseable or malformed cookie is treated as "signed in but unknown
 * expiry", which routes into refreshAndContinue() — the network path verifies
 * it properly. Failing open to a *verified* check is the safe direction.
 */
function readSessionFromCookies(request: NextRequest): SessionProbe {
  const chunks: Array<{ name: string; value: string }> = [];
  let whole: string | null = null;

  for (const cookie of request.cookies.getAll()) {
    if (!/^sb-.*-auth-token(\.\d+)?$/.test(cookie.name)) continue;
    if (cookie.name.includes('code-verifier')) continue;
    if (/\.\d+$/.test(cookie.name)) chunks.push(cookie);
    else whole = cookie.value;
  }

  let raw = whole;
  if (!raw && chunks.length > 0) {
    raw = chunks
      .sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()))
      .map((c) => c.value)
      .join('');
  }
  if (!raw) return ABSENT;

  const expiresAt = readExpiry(raw);
  if (expiresAt === null) {
    // Present but unreadable — force the verified path.
    return { present: true, expiresWithin: () => true };
  }

  return {
    present: true,
    expiresWithin: (seconds) => expiresAt - Date.now() / 1000 <= seconds,
  };
}

/** Unix seconds at which the access token expires, or null if undecodable. */
function readExpiry(raw: string): number | null {
  try {
    const json = raw.startsWith('base64-')
      ? new TextDecoder().decode(base64UrlDecode(raw.slice('base64-'.length)))
      : decodeURIComponent(raw);

    const session = JSON.parse(json);

    if (typeof session?.expires_at === 'number') return session.expires_at;

    // Older shapes omit expires_at; fall back to the access token's own claim.
    const token: unknown = session?.access_token;
    if (typeof token === 'string') {
      const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(token.split('.')[1])));
      if (typeof payload?.exp === 'number') return payload.exp;
    }
  } catch {
    // fall through
  }
  return null;
}

function base64UrlDecode(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const config = {
  // Static assets, the image optimiser and Next's own chunks never reach this
  // function. The previous matcher let anything without a known file extension
  // through, so RSC payload requests paid the full auth round trip too.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
