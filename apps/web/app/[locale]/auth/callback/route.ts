import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { sendWelcomeEmail } from '@/modules/notifications/email';
import { getTenant } from '@/modules/tenancy/queries';
import { requestOrigin } from '@/modules/tenancy/urls';
import { homePath } from '@/modules/tenancy/types';

/**
 * OAuth / email-confirmation callback.
 *
 * A route handler rather than a page: exchanging the code sets cookies, and a
 * page component cannot write them — the previous implementation was a client
 * page that ran the exchange in an effect, which meant a visible flash and a
 * second navigation before the session existed.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  // The forwarded host, not request.nextUrl.origin — see /auth/continue for
  // why those differ off Vercel. Getting it wrong here is the worst place to:
  // this handler holds the only session cookies the user will ever have.
  const origin = await requestOrigin();

  // Only relative paths, so a crafted link cannot bounce a freshly
  // authenticated user to another origin.
  const wanted = next?.startsWith('/') && !next.startsWith('//') ? next : null;

  // Supabase reports a refused or expired link as ?error=…&error_description=…
  // with no code at all. Reporting that as `missing_code` sent the user back to
  // the form with a message that described our own plumbing rather than the
  // thing that happened to them — an expired confirmation link, most often.
  const authError = searchParams.get('error_description') ?? searchParams.get('error');
  if (authError) {
    const url = new URL('/auth/sign-in', origin);
    url.searchParams.set('error', authError.slice(0, 200));
    return NextResponse.redirect(url);
  }

  if (!code) {
    return NextResponse.redirect(new URL('/auth/sign-in?error=missing_code', origin));
  }

  // Provisional. Rewritten below once the profile and tenant are known — a
  // caller with no `next` must not be dropped on /briefs, which a contractor
  // tenant does not have.
  const response = NextResponse.redirect(new URL(wanted ?? '/auth/continue', origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/auth/sign-in?error=exchange_failed', origin));
  }

  // An OAuth account arrives with an email, a name and an avatar — but no
  // role, which is the field everything else branches on. Send it to the
  // completion form instead of into an app it cannot use.
  //
  // Read directly rather than through getViewer(): this handler has its own
  // cookie jar (the session was only just written onto `response`), so the
  // request-scoped client would not see the new session yet.
  const userId = data.session?.user.id;
  if (userId) {
    const { data: profile } = await supabase
      .from('users')
      // `name` rides along for the welcome email below rather than costing a
      // second round trip — same reason the role is already here.
      .select('profile_completed, role, name, username')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.profile_completed) {
      const url = new URL('/auth/complete', origin);
      // Preserve where they were headed so the completion form can finish the
      // journey rather than dumping everyone on the same landing screen.
      if (next?.startsWith('/') && !next.startsWith('//')) {
        url.searchParams.set('next', next);
      }
      return redirectPreservingCookies(response, url);
    }

    // The welcome, for the path that actually carries most people.
    //
    // Email confirmation is on, so a password sign-up has no session when
    // signUpAction finishes and cannot be welcomed there. This is the first
    // moment the account is both confirmed and usable. It is also reached on
    // every later sign-in, which is why sendWelcomeEmail claims an insert
    // before it sends anything and no-ops for anyone already welcomed.
    //
    // Only reached once the profile is complete — the branch above returned
    // otherwise. Someone who confirmed but never filled in the form has no role
    // yet and the copy branches on it; they are welcomed from
    // completeProfileAction instead.
    const tenant = await getTenant();
    await sendWelcomeEmail(
      userId,
      profile.name ?? profile.username ?? '',
      profile.role === 'brand' ? 'brand' : 'creative',
      tenant,
    );

    if (!wanted) {
      // Where they land depends on the SITE as well as the account. An admin
      // used to be sent to /briefs unconditionally — a feed a contractor
      // tenant has switched off, so they arrived on a page with no nav link
      // and no content.
      //
      // Capabilities come from the membership rather than being assumed:
      // `canBrand: true` was the pre-tenancy hardcode, and on a white-label it
      // is wrong for every earn-only contractor.
      const { data: membership } = await supabase
        .from('tropical_tenant_members')
        .select('capabilities')
        .eq('tenant_id', tenant.id)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      // No membership on this site: the (app) layout would only bounce them,
      // so answer directly.
      if (!membership) {
        return redirectPreservingCookies(response, new URL('/auth/no-access', origin));
      }

      const caps = (membership.capabilities ?? {}) as Record<string, unknown>;
      const home = homePath(
        { canBrand: caps.brand === true, isCreative: caps.work === true },
        tenant.features,
      );
      return redirectPreservingCookies(response, new URL(home, origin));
    }
  }

  return response;
}

/**
 * Re-targets a redirect without losing the session cookies already written.
 *
 * NextResponse.redirect() builds a fresh response, so the Set-Cookie headers
 * from exchangeCodeForSession would be dropped — and the user would arrive
 * signed out at a page that requires a session, then bounce back to sign-in.
 */
function redirectPreservingCookies(source: NextResponse, url: URL): NextResponse {
  const redirected = NextResponse.redirect(url);
  for (const cookie of source.cookies.getAll()) {
    redirected.cookies.set(cookie);
  }
  return redirected;
}
