import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SignInForm } from '@/components/waitlist/sign-in-form';
import { GoogleButton, OrDivider } from '@/components/waitlist/google-button';
import { TenantLogo } from '@/components/tropical/tenant-logo';
import { getTenant } from '@/modules/tenancy/queries';
import { TenantStyle } from '@/components/tropical/tenant-style';
import { ThemeToggleButton } from '@/components/shared/theme-toggle-button';
import { SignUpDialog } from '@/components/waitlist/sign-up-dialog';
import { ARCHETYPE_PRESETS, referralAudience } from '@/modules/tenancy/presets';

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
  const t = await getTranslations('auth');
  return {
    title: t('signIn'),
    ...(icon && icon.startsWith('https://') ? { icons: { icon } } : {}),
  };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const tenant = await getTenant();

  const { next, error } = await searchParams;
  const t = await getTranslations('auth');

  // The wizard's own copy, in this site's words. Only reached from here on a
  // white-label — the gateway sends `/` straight to this screen — so this is
  // the one place that has to know, and app/page.tsx stays force-static
  // because it passes nothing and gets TropicalTalent.
  const preset = ARCHETYPE_PRESETS[tenant.archetype] ?? ARCHETYPE_PRESETS.classic;
  const signUpTenant = {
    name: tenant.name,
    workerLabel: preset.signup.worker.label,
    payerLabel: preset.signup.payer.label,
    // The card copy under the payer heading names the OTHER side: "Discover and
    // book verified contractors".
    workerPlural: preset.nouns.worker.many,
    allowPayer: tenant.features.selfServeBrands !== false,
    referrals: referralAudience(tenant),
  };

  return (
    <main className='relative flex min-h-dvh flex-col items-center justify-center overflow-x-hidden px-6'>
      <TenantStyle />

      {/* Light/dark, before signing in.
       *
       * The toggle already exists in the app shell, but a white-label's users
       * land here first and may never have seen the shell — and on a WL there
       * is no landing page to have set the preference on either, since `/`
       * redirects straight to this screen. next-themes persists the choice, so
       * setting it here carries into the app. */}
      <ThemeToggleButton className='text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground absolute top-4 right-4 z-20 h-9 w-9 rounded-lg' />
      <div className='pointer-events-none fixed inset-0 overflow-hidden'>
        {/* Tinted from the tenant's own palette rather than a fixed green.
            These two orbs are most of what the eye reads as "the
            background colour", so leaving them hardcoded meant a lime
            white-label still sat on TropicalTalent's green wash — the single
            most visible thing left after the buttons were themed.
            color-mix keeps them faint; var() falls back to the TropicalTalent hues when
            a tenant sets no palette. */}
        <div
          className='absolute -top-40 left-1/2 h-130 w-130 -translate-x-1/2 rounded-full blur-3xl'
          style={{
            background:
              'color-mix(in oklab, var(--tenant-primary, oklch(0.62 0.2 155)) 15%, transparent)',
          }}
        />
        <div
          className='absolute right-0 bottom-1/4 h-130 w-130 translate-x-1/3 rounded-full blur-3xl'
          style={{
            background:
              'color-mix(in oklab, var(--tenant-accent, oklch(0.72 0.19 130)) 15%, transparent)',
          }}
        />
      </div>

      <div className='relative z-10 w-full max-w-sm'>
        <Link href='/' className='mb-8 flex items-center justify-center'>
          <TenantLogo
            logoUrl={tenant.branding.logoUrl}
            name={tenant.name}
            size={40}
            priority
            className='h-10 w-10'
          />
        </Link>

        <h1 className='text-center text-2xl font-bold tracking-tight'>{t('signInTitle')}</h1>
        <p className='text-muted-foreground mt-2 text-center text-sm'>{t('signInIntro')}</p>

        {/* Whatever went wrong on the way here.
         *
         * /auth/callback redirects with ?error= when a confirmation or reset
         * link is expired, already used, or refused. It was being written into
         * the URL and then rendered nowhere, so the user saw the login form
         * again with no explanation and no reason to think anything had
         * happened. */}
        {error && (
          <p className='border-destructive/30 bg-destructive/5 text-destructive mt-6 rounded-lg border px-3 py-2 text-center text-sm'>
            {friendlyAuthError(error)}
          </p>
        )}

        <div className='mt-8 space-y-4'>
          <GoogleButton mode='login' next={next} />
          <OrDivider />
        </div>

        <SignInForm next={next ?? ''} />

        <p className='text-muted-foreground mt-6 text-center text-sm'>
          {t('noAccount')}{' '}
          {/* The dialog itself, not a link to the landing page.
           *
           * On a white-label there IS no landing page — proxy.ts redirects `/`
           * straight back to this screen — so the old link was a loop. On
           * classic it was a detour: it sent you to the marketing page to
           * click the same button. */}
          <SignUpDialog
            tenant={signUpTenant}
            trigger={
              <button type='button' className='text-foreground underline underline-offset-4'>
                {t('signUp')}
              </button>
            }
          />
        </p>
      </div>
    </main>
  );
}

/**
 * Turns a callback's `?error=` into something a person can act on.
 *
 * The two internal codes are ours; anything else is Supabase's own
 * error_description, which is already written for a human, so it is passed
 * through rather than mapped to a generic line that would lose the detail.
 */
function friendlyAuthError(code: string): string {
  if (code === 'missing_code') return 'That link is missing its sign-in code. Ask for a new one.';
  if (code === 'exchange_failed') {
    return 'That link has expired or was already used. Request a new one and open it on this site.';
  }
  return code;
}
