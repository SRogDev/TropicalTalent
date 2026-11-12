import Link from 'next/link';
import type { Metadata } from 'next';
import { getTenant } from '@/modules/tenancy/queries';
import { signOutAction } from '@/modules/identity/actions';
import { pendingTenantInvite } from '@/modules/identity/queries';
import { TenantStyle } from '@/components/tropical/tenant-style';
import { JoinWithInvite } from '@/components/tropical/join-with-invite';

/**
 * The tab icon has to be set per route.
 *
 * app/icon.svg is Next's file convention and applies to every page, so a
 * white-label's visitor sees the TropicalTalent mark in their tab even on a fully
 * branded screen. Only an explicit `icons` entry displaces it, and it has to
 * be generateMetadata rather than a static object because the tenant is not
 * known until the request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const icon = tenant.branding.logoUrl;
  return {
    title: 'No access',
    ...(icon && icon.startsWith('https://') ? { icons: { icon } } : {}),
  };
}

/**
 * Signed in, but not a member of this site.
 *
 * Reachable only from the (app) layout's membership check. One Supabase
 * identity can hold memberships in several tenants, so "authenticated" and
 * "belongs here" are different questions — this page is the answer to the
 * second one being no.
 *
 * It deliberately does not name the tenants the account DOES belong to.
 * Telling someone who guessed a hostname which other workspaces exist would
 * leak the customer list one probe at a time.
 *
 * The one case where this is NOT a dead end: an admin has already put this
 * person's address on the roster and they simply signed up somewhere else
 * first. An invite could only be redeemed during sign-up, so an existing
 * account had no way to reach one — it sat pending in the console while its
 * owner looked at this page. pendingTenantInvite() matches on the verified
 * session address and this host alone, so the offer appears only for someone
 * who was genuinely invited and reveals nothing to anyone who was not.
 *
 * NOTE: '/auth/no-access' must stay in proxy.ts's AUTHED_AUTH_PATHS. Every
 * other /auth/* path bounces a signed-in visitor to /auth/continue, and doing
 * that here would loop — continue resolves their home, the app layout finds no
 * membership, and sends them straight back.
 */
export default async function NoAccessPage() {
  const [tenant, invite] = await Promise.all([getTenant(), pendingTenantInvite()]);

  return (
    <main className='flex min-h-dvh flex-col items-center justify-center px-6'>
      <TenantStyle />
      <div className='w-full max-w-sm text-center'>
        <h1 className='text-2xl font-bold tracking-tight'>
          {invite
            ? `You've been invited to ${tenant.name}`
            : `You don't have access to ${tenant.name}`}
        </h1>
        <p className='text-muted-foreground mt-3 text-sm'>
          {invite
            ? `Your account isn't a member of this workspace yet, but your email address is on the list. Join to finish setting it up.`
            : `Your account is signed in, but it isn't a member of this workspace. If you were expecting access, ask whoever invited you to add you - otherwise sign in with the account you use here.`}
        </p>

        <div className='mt-8 flex flex-col items-center gap-3'>
          {invite && <JoinWithInvite tenantName={tenant.name} />}

          {/* A form post, like the shell's log-out control: works without JS
              and cannot be fired by a link prefetch. */}
          <form action={signOutAction} className='w-full'>
            <button
              type='submit'
              className={
                invite
                  ? 'border-foreground/15 hover:bg-sunken h-11 w-full rounded-lg border text-sm font-medium'
                  : 'gradient-app text-on-brand h-11 w-full rounded-lg text-sm font-medium hover:opacity-90'
              }
            >
              Sign in as someone else
            </button>
          </form>
          <Link
            href='/'
            className='text-muted-foreground hover:text-foreground text-sm underline underline-offset-4'
          >
            Back to {tenant.name}
          </Link>
        </div>
      </div>
    </main>
  );
}
