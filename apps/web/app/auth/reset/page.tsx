import Link from 'next/link';
import type { Metadata } from 'next';
import { ResetForm } from '@/components/waitlist/reset-form';
import { TenantLogo } from '@/components/tropical/tenant-logo';
import { getTenant } from '@/modules/tenancy/queries';
import { TenantStyle } from '@/components/tropical/tenant-style';

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
    title: 'Reset password',
    ...(icon && icon.startsWith('https://') ? { icons: { icon } } : {}),
  };
}

export default async function ResetPage() {
  const tenant = await getTenant();

  return (
    <main className='flex min-h-dvh flex-col items-center justify-center px-6'>
      <TenantStyle />
      <div className='w-full max-w-sm'>
        <Link href='/' className='mb-8 flex items-center justify-center'>
          <TenantLogo
            logoUrl={tenant.branding.logoUrl}
            name={tenant.name}
            size={40}
            priority
            className='h-10 w-10'
          />
        </Link>
        <h1 className='text-center text-2xl font-bold tracking-tight'>Reset your password</h1>
        <p className='text-muted-foreground mt-2 text-center text-sm'>
          We&apos;ll email you a link to set a new one.
        </p>
        <ResetForm />
        <p className='text-muted-foreground mt-6 text-center text-sm'>
          <Link href='/auth/sign-in' className='text-foreground underline underline-offset-4'>
            Back to log in
          </Link>
        </p>
      </div>
    </main>
  );
}
