import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Wallet } from 'lucide-react';
import { getViewer } from '@/modules/identity/queries';

export const metadata: Metadata = {
  title: 'Wallet',
  description: 'Payments are omitted in this reference build.',
};

/**
 * The wallet — PLACEHOLDER in the TropicalTalent reference build.
 *
 * Payments are omitted entirely from this build: no balances, no escrow
 * holds, no payouts. The route stays so old links and the shell do not 404,
 * but it renders only this note. See modules/wallet/* (stubs) and
 * modules/escrow/actions (stub).
 */
export default async function WalletPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/wallet');

  return (
    <div className='mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10'>
      <header className='flex flex-wrap items-center justify-between gap-4'>
        <h1 className='text-2xl font-semibold tracking-tight sm:text-3xl'>Wallet</h1>
      </header>

      <div className='glass mt-8 rounded-3xl p-6 text-center sm:p-10'>
        <Wallet size={28} className='text-muted-foreground mx-auto' />
        <p className='mt-4 text-sm font-medium'>Payments are omitted in this reference build</p>
        <p className='text-muted-foreground mx-auto mt-2 max-w-md text-sm'>
          There are no balances, escrow holds or payouts here. TropicalTalent is a reference
          base for connecting Cuban talent with the world — money movement is out of scope for
          this build.
        </p>
        <Link
          href='/briefs'
          className='bg-gradient-brand text-on-brand mt-6 inline-flex rounded-lg px-4 py-2 text-sm font-medium'
        >
          Browse briefs
        </Link>
      </div>
    </div>
  );
}
