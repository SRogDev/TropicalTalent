import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { loadProviderForAdmin, loadVerificationEvents } from '@/modules/catalog/queries';
import { SupplierVerificationForms } from '@/components/tropical/supplier-verification-form';

export const metadata: Metadata = {
  title: 'Supplier review',
  robots: { index: false, follow: false },
};

/**
 * Supplier onboarding — the detail page (Phase 2).
 *
 * One provider, their offers, and the verification trail. Operations
 * records evidence, sets the provider status, and awards origin
 * verification / the Made in Cuba seal per offer. Nothing here is a
 * commercial workflow — no negotiation, no contact release, no fee.
 */
export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, events] = await Promise.all([
    loadProviderForAdmin(id),
    loadVerificationEvents(id),
  ]);
  if (!detail) notFound();

  const { provider, offers } = detail;

  return (
    <div className='space-y-6'>
      <header>
        <Link href='/admin/suppliers' className='text-primary text-sm hover:underline'>
          ← All suppliers
        </Link>
        <h1 className='mt-2 text-2xl font-bold'>{provider.displayName}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {provider.kind} · {[provider.city, provider.country].filter(Boolean).join(', ')}
          {provider.legalName ? ` · ${provider.legalName}` : ''} · Languages:{' '}
          {provider.languages.length > 0 ? provider.languages.join(', ') : 'unstated'}
        </p>
        {provider.description && <p className='mt-2 text-sm'>{provider.description}</p>}
        {provider.verificationNotes && (
          <p className='text-muted-foreground mt-2 text-sm'>
            Operations notes: {provider.verificationNotes}
          </p>
        )}
      </header>

      <SupplierVerificationForms provider={provider} offers={offers} events={events} />
    </div>
  );
}
