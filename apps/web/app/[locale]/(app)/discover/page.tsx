import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getViewer } from '@/modules/identity/queries';
import { DiscoveryChat } from '@/components/tropical/discovery-chat';

export const metadata: Metadata = {
  title: 'Discover',
  description:
    'Describe what you need in plain language — Cubora finds Cuban talent, services, products, and production, or saves a sourcing request when nothing matches yet.',
};

/**
 * Conversational discovery (Phase 3, plan §4).
 *
 * The main discovery experience: a conversation with integrated
 * results. The chat adapts the existing AI agent transport
 * (POST /api/agent via the /api/discovery proxy) — it is not a second
 * chat system. Offer cards render inline in the conversation, and a
 * no-results turn creates a sourcing request instead of a dead end.
 */
export default async function DiscoverPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/discover');

  const t = await getTranslations('discover');

  return (
    <div className='mx-auto max-w-4xl space-y-6 p-4 sm:p-6'>
      <header>
        <h1 className='text-2xl font-bold'>{t('title')}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>{t('intro')}</p>
      </header>
      <DiscoveryChat />
    </div>
  );
}
