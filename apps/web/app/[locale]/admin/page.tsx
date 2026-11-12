import Link from 'next/link';
import type { Metadata } from 'next';
import { loadAdminOverview } from '@/modules/admin/queries';
import { loadAllDisputes } from '@/modules/chat/queries';
import { formatPence } from '@/lib/money';

export const metadata: Metadata = { title: 'Admin overview' };

export default async function AdminOverviewPage() {
  const [overview, disputes] = await Promise.all([loadAdminOverview(), loadAllDisputes()]);
  const openDisputes = disputes.filter((d) => d.status === 'open' || d.status === 'reviewing');

  return (
    <div className='space-y-8'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>Overview</h1>
        <p className='text-muted-foreground mt-1 text-sm'>Platform-wide activity and earnings.</p>
      </header>

      <section className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <Stat label='Talent' value={String(overview.counts.creatives)} />
        <Stat label='Brands' value={String(overview.counts.brands)} />
        <Stat label='Projects' value={String(overview.counts.projects)} />
        <Stat label='Active projects' value={String(overview.counts.activeProjects)} />
      </section>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>Escrow</h2>
        <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <Stat
            label='Funded (all time)'
            value={formatPence(overview.escrow.funded, overview.escrow.currency)}
          />
          <Stat
            label='Released to talent'
            value={formatPence(overview.escrow.released, overview.escrow.currency)}
          />
          <Stat
            label='Currently held'
            value={formatPence(overview.escrow.held, overview.escrow.currency)}
          />
        </div>
      </section>

      <section>
        <div className='flex items-center justify-between'>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
            Open complaints
          </h2>
          <Link href='/admin/complaints' className='text-xs underline underline-offset-2'>
            View all
          </Link>
        </div>

        {openDisputes.length === 0 ? (
          <p className='text-muted-foreground mt-3 text-sm'>Nothing open right now.</p>
        ) : (
          <div className='mt-3 space-y-2'>
            {openDisputes.slice(0, 5).map((d) => (
              <Link
                key={d.id}
                href={`/admin/complaints#${d.id}`}
                className='glass hover:border-foreground/20 flex items-center justify-between gap-3 rounded-xl px-4 py-3 transition'
              >
                <div className='min-w-0'>
                  <div className='truncate text-sm font-medium'>{d.project_name}</div>
                  <div className='text-muted-foreground truncate text-[11px] capitalize'>
                    {d.category} · {d.raised_by_name ?? d.raised_by_username ?? 'Unknown'}
                  </div>
                </div>
                <span className='text-status-pending shrink-0 text-xs capitalize'>{d.status}</span>
              </Link>
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
