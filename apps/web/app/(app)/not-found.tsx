import Link from 'next/link';
import { getTenant } from '@/modules/tenancy/queries';
import { getViewer } from '@/modules/identity/queries';
import { homePath } from '@/modules/tenancy/types';
import { TenantLogo } from '@/components/tropical/tenant-logo';

/**
 * The 404 inside the signed-in shell — the branded one.
 *
 * Every `notFound()` this app actually raises comes from a route under this
 * segment: a project id that does not exist, or one whose RLS returns nothing
 * because it belongs to another tenant. Those are exactly the 404s a
 * white-label's user sees, so this is where the tenant's own mark belongs.
 *
 * Safe to read the tenant here in a way the root 404 is not: this segment is
 * dynamic (the layout above calls getViewer() on every request), so nothing
 * below is prerendered at build time. See app/not-found.tsx for what went
 * wrong when the root boundary tried the same thing.
 */
export default async function AppNotFound() {
  const [tenant, viewer] = await Promise.all([getTenant(), getViewer()]);

  const home = viewer
    ? homePath({ canBrand: viewer.canBrand, isCreative: viewer.isCreative }, tenant.features)
    : '/';

  return (
    <main className='flex min-h-[60vh] flex-col items-center justify-center px-6 text-center'>
      <TenantLogo
        logoUrl={tenant.branding.logoUrl}
        name={tenant.name}
        size={40}
        className='mb-6 h-10 w-10'
      />
      <h1 className='text-2xl font-bold tracking-tight'>Not found</h1>
      <p className='text-muted-foreground mt-2 max-w-sm text-sm'>
        This page does not exist, or you do not have access to it.
      </p>
      <Link
        href={home}
        className='gradient-app text-on-brand mt-6 rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90'
      >
        Back to {tenant.name}
      </Link>
    </main>
  );
}
