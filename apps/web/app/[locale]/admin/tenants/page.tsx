import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer } from '@/modules/identity/queries';
import { getTenant, listTenants, tenantMemberCounts } from '@/modules/tenancy/queries';
import { ARCHETYPE_PRESETS } from '@/modules/tenancy/presets';

export const metadata: Metadata = { title: 'Tenants' };

/**
 * Every white-label, and the button that makes another one.
 *
 * Super admin AND the classic host — both, not either.
 *
 * Being a super admin was the whole test until it turned out that support
 * signing in to acme.tropicaltalent.dev to reproduce a customer's bug was then shown
 * every OTHER customer's name, hostname, platform fee and partner split, on
 * Acme's own domain. The estate is TropicalTalent's business and it belongs on TropicalTalent's
 * host; the same rule requireAdminScope() applies to every other loader in the
 * console.
 *
 * The layout hides the link too, but a hidden link is not a control, and the
 * actions behind this page check again independently because a server action
 * is a public endpoint.
 */
export default async function TenantsPage() {
  const [viewer, tenant] = await Promise.all([getViewer(), getTenant()]);
  if (!viewer?.isSuperAdmin || !tenant.isClassic) redirect('/admin');

  const [tenants, memberCounts] = await Promise.all([listTenants(), tenantMemberCounts()]);

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>Tenants</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            {tenants.length} site{tenants.length === 1 ? '' : 's'} on this deployment. A new one is
            live as soon as it is saved - no deploy, no migration.
          </p>
        </div>
        <Link
          href='/admin/tenants/new'
          className='gradient-app text-on-brand rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90'
        >
          New tenant
        </Link>
      </div>

      <div className='border-foreground/10 overflow-x-auto rounded-xl border'>
        <table className='w-full min-w-[720px] text-sm'>
          <thead className='text-muted-foreground border-foreground/10 border-b text-left text-xs'>
            <tr>
              <th className='px-4 py-3 font-medium'>Tenant</th>
              <th className='px-4 py-3 font-medium'>Shape</th>
              <th className='px-4 py-3 font-medium'>Hosts</th>
              <th className='px-4 py-3 text-right font-medium'>Members</th>
              <th className='px-4 py-3 text-right font-medium'>Fee</th>
              <th className='px-4 py-3 text-right font-medium'>Partner</th>
              <th className='px-4 py-3 font-medium'>Status</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className='border-foreground/5 border-b last:border-0'>
                <td className='px-4 py-3'>
                  <Link href={`/admin/tenants/${t.id}`} className='font-medium hover:underline'>
                    {t.name}
                  </Link>
                  <div className='text-muted-foreground text-xs'>
                    {t.slug}
                    {t.isClassic && ' · classic'}
                  </div>
                </td>
                <td className='text-muted-foreground px-4 py-3 text-xs'>
                  {ARCHETYPE_PRESETS[t.archetype]?.label ?? t.archetype}
                </td>
                <td className='px-4 py-3 text-xs'>
                  {t.hosts.length === 0 ? (
                    // The classic tenant legitimately has none: it is whatever
                    // host did not match anything else.
                    <span className='text-muted-foreground'>
                      {t.isClassic ? 'fallback for any host' : '- unreachable'}
                    </span>
                  ) : (
                    t.hosts.map((h) => <div key={h}>{h}</div>)
                  )}
                </td>
                <td className='px-4 py-3 text-right tabular-nums'>{memberCounts[t.id] ?? 0}</td>
                <td className='px-4 py-3 text-right tabular-nums'>{t.platformFeePct}%</td>
                <td className='px-4 py-3 text-right tabular-nums'>
                  {t.partnerSharePct > 0 ? `${t.partnerSharePct}% of fee` : '-'}
                </td>
                <td className='px-4 py-3'>
                  <span
                    className={
                      t.status === 'active'
                        ? 'text-status-active text-xs'
                        : 'text-status-cancelled text-xs'
                    }
                  >
                    {t.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* A tenant with no hostname resolves to nothing and its members would
          land on the classic app and fail the membership check — worth saying
          out loud rather than leaving someone to work out from an empty cell. */}
      {tenants.some((t) => !t.isClassic && t.hosts.length === 0) && (
        <p className='text-status-pending text-xs'>
          A tenant with no host cannot be reached. Add one before inviting anybody to it.
        </p>
      )}
    </div>
  );
}
