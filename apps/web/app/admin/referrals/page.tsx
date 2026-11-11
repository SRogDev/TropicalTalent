import type { Metadata } from 'next';
import { loadFulfilledReferralRewards, loadReferralRewards } from '@/modules/admin/queries';
import { AdminReferralRewardRow } from '@/components/tropical/admin-referral-reward-row';

export const metadata: Metadata = { title: 'Admin - Referrals' };

export default async function AdminReferralsPage() {
  const [owed, fulfilled] = await Promise.all([
    loadReferralRewards(),
    loadFulfilledReferralRewards(),
  ]);

  return (
    <div className='space-y-8'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>Referrals</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Reward tiers earned by referring people to TropicalTalent. These are delivered by hand, not by the
          app, so this is the only record of who's still owed one.
        </p>
      </header>

      <section>
        <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
          Awaiting ({owed.length})
        </h2>
        {owed.length === 0 ? (
          <p className='text-muted-foreground mt-3 text-sm'>Nothing outstanding.</p>
        ) : (
          <div className='mt-3 space-y-2'>
            {owed.map((r) => (
              <AdminReferralRewardRow key={`${r.userId}-${r.tier}`} reward={r} />
            ))}
          </div>
        )}
      </section>

      {fulfilled.length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>
            Recently delivered
          </h2>
          <div className='mt-3 space-y-2'>
            {fulfilled.map((f) => (
              <div
                key={`${f.userId}-${f.tier}`}
                className='glass flex items-center justify-between gap-3 rounded-xl px-4 py-3'
              >
                <div className='min-w-0'>
                  <div className='truncate text-sm font-medium'>
                    {f.name ?? f.username ?? 'Unnamed'}
                  </div>
                  <div className='text-muted-foreground truncate text-[11px]'>
                    {f.rewardTitle}
                    {f.note ? ` · ${f.note}` : ''}
                  </div>
                </div>
                <div className='text-muted-foreground shrink-0 text-right text-[11px]'>
                  <div>{new Date(f.fulfilledAt).toLocaleDateString('en-GB')}</div>
                  {f.fulfilledByName && <div>by {f.fulfilledByName}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
