import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { requestOrigin } from '@/modules/tenancy/urls';
import { homePath } from '@/modules/tenancy/types';

/**
 * "I am already signed in — take me into the app."
 *
 * The gateway used to answer a signed-in visitor on /auth/* by redirecting to
 * `/`, which is the STATIC landing page. So clicking "Log in" on the landing
 * page while already signed in bounced straight back to the landing page and
 * read as a dead button. The landing page cannot branch on auth itself — it is
 * force-static, and making it dynamic would cost every anonymous visitor the
 * session check — so the branch lives here instead, on a route only signed-in
 * visitors are ever sent to.
 *
 * A route handler rather than a page: this renders nothing, and a handler can
 * clear a stale cookie on the way out where a server component cannot.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = searchParams.get('next');

  // The host the visitor is actually on, from the forwarded headers.
  //
  // NOT request.nextUrl.origin. Next builds that from the server's own
  // hostname and port when the app is self-hosted (next-server.js constructs
  // the proxy URL from `fetchHostname`, not the Host header), so every
  // redirect out of this handler would point at the internal origin. On Vercel
  // the two agree; everywhere else this is the difference between landing on
  // the tenant's site and landing nowhere.
  const origin = await requestOrigin();

  // Only relative paths, and never back into /auth/* — that is the loop this
  // route exists to break.
  const wanted =
    next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/auth/') ? next : null;

  const viewer = await getViewer();

  // The gateway routes on a locally-decoded cookie and never verifies it. If
  // it decoded as live but Supabase disagrees, the cookie is stale: drop it,
  // otherwise the gateway keeps sending the visitor here and here keeps
  // sending them back to the form.
  if (!viewer) {
    const signIn = new URL('/auth/sign-in', origin);
    if (wanted) signIn.searchParams.set('next', wanted);

    const response = NextResponse.redirect(signIn);
    for (const cookie of request.cookies.getAll()) {
      if (/^sb-.*-auth-token(\.\d+)?$/.test(cookie.name)) response.cookies.delete(cookie.name);
    }
    return response;
  }

  if (!viewer.profileCompleted) {
    return NextResponse.redirect(new URL('/auth/complete', origin));
  }

  // Signed in, profile complete — but not a member of the site they are on.
  //
  // Without this the deep link below is honoured, the (app) layout finds no
  // membership and redirects to /auth/no-access anyway, one render later.
  // Answering here means the person never sees a flash of a workspace they
  // have no business in.
  if (!viewer.belongsToTenant) {
    return NextResponse.redirect(new URL('/auth/no-access', origin));
  }

  // Their capabilities on this site, against the surfaces this site actually
  // has. The old `role === 'talent' ? '/briefs' : '/create'` split ignored
  // both: a contractor tenant switches the brief feed off, so it sent people to
  // a page that immediately redirects, and an earn-only account to a hiring
  // screen it cannot use.
  const tenant = await getTenant();
  const home =
    wanted ??
    homePath({ canBrand: viewer.canBrand, isCreative: viewer.isCreative }, tenant.features);

  return NextResponse.redirect(new URL(home, origin));
}
