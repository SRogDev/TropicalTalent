import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { TenantForm } from '@/components/tropical/tenant-form';

export const metadata: Metadata = { title: 'New tenant' };

/**
 * Stand up a white-label.
 *
 * Two rows and no deploy: the tenant and its first hostname. Everything the
 * form collects is data the app already reads at request time, so the site is
 * live the moment it saves.
 */
export default async function NewTenantPage() {
  // Classic host as well as super admin — see app/admin/tenants/page.tsx.
  // Creating a customer from inside another customer's domain is the same
  // cross-tenant mistake as listing them there.
  const [viewer, tenant] = await Promise.all([getViewer(), getTenant()]);
  if (!viewer?.isSuperAdmin || !tenant.isClassic) redirect('/admin');

  return (
    <div className='space-y-6'>
      <div>
        <Link href='/admin/tenants' className='text-muted-foreground hover:text-foreground text-xs'>
          ← Tenants
        </Link>
        <h1 className='mt-2 text-xl font-semibold tracking-tight'>New tenant</h1>
      </div>
      <TenantForm />
    </div>
  );
}
