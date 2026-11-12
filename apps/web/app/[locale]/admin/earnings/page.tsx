import type { Metadata } from 'next';
import { loadAdminEarnings } from '@/modules/admin/queries';
import { formatPence } from '@/lib/money';

export const metadata: Metadata = { title: 'Admin - Earnings' };

export default async function AdminEarningsPage() {
  const earnings = await loadAdminEarnings();
  const { totals } = earnings;

  return (
    <div className='space-y-8'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>Earnings</h1>
        <p className='text-muted-foreground mt-1 text-sm'>Platform-wide money movement.</p>
      </header>

      <section className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <Stat label='Total funded' value={formatPence(totals.funded, totals.currency)} />
        <Stat label='Released' value={formatPence(totals.released, totals.currency)} />
        <Stat label='Held in escrow' value={formatPence(totals.held, totals.currency)} />
        <Stat label='Platform fees' value={formatPence(totals.platformFees, totals.currency)} />
        {/* Only meaningful once a tenant has a rev-share, so it stays out of
            the way entirely on classic rather than showing a permanent zero. */}
        {totals.partnerFees > 0 && (
          <Stat label='Owed to partner' value={formatPence(totals.partnerFees, totals.currency)} />
        )}
      </section>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>Top earners</h2>
        {earnings.topEarners.length === 0 ? (
          <p className='text-muted-foreground mt-3 text-sm'>No payouts yet.</p>
        ) : (
          <div className='mt-3 space-y-2'>
            {earnings.topEarners.map((e) => (
              <div
                key={e.userId}
                className='glass flex items-center justify-between gap-3 rounded-xl px-4 py-3'
              >
                <div className='truncate text-sm font-medium'>
                  {e.name ?? e.username ?? 'Unnamed'}
                </div>
                <span className='shrink-0 text-sm font-semibold tabular-nums'>
                  {formatPence(e.lifetimeEarned, totals.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          Recent transactions
        </h2>
        {earnings.recentTransactions.length === 0 ? (
          <p className='text-muted-foreground mt-3 text-sm'>Nothing yet.</p>
        ) : (
          <div className='mt-3 space-y-2'>
            {earnings.recentTransactions.map((t) => (
              <div
                key={t.id}
                className='glass flex items-center justify-between gap-3 rounded-xl px-4 py-3'
              >
                <div className='min-w-0'>
                  <div className='truncate text-sm capitalize'>{t.type.replace(/_/g, ' ')}</div>
                  <div className='text-muted-foreground truncate text-[11px]'>
                    {t.userName ?? 'Unknown'}
                    {t.projectName ? ` · ${t.projectName}` : ''}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    t.amount >= 0 ? 'text-status-active' : 'text-muted-foreground'
                  }`}
                >
                  {t.amount >= 0 ? '+' : ''}
                  {formatPence(t.amount, totals.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='border-foreground/10 bg-sunken rounded-xl border px-4 py-3'>
      <div className='text-muted-foreground text-[10px] tracking-widest uppercase'>{label}</div>
      <div className='mt-0.5 text-lg font-semibold tabular-nums'>{value}</div>
    </div>
  );
}
