import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { adminDb } from '@/lib/supabase';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { ARCHETYPE_PRESETS } from '@/modules/tenancy/presets';
import type { TenantArchetype } from '@/modules/tenancy/types';
import { RosterImport } from '@/components/tropical/roster-import';
import { TenantSettings } from '@/components/tropical/tenant-settings';

export const metadata: Metadata = { title: 'Tenant' };

/**
 * One tenant: its hosts, its roster, and who has actually arrived.
 *
 * Reachable by a TropicalTalent super admin, or by the tenant's own wl_admin for their
 * own tenant — onboarding a roster is a white-label admin's core job, so this
 * is one of the few admin screens they get.
 */
export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/admin/tenants');

  // On a white-label host you may only ever look at THAT white-label — whoever
  // you are. A super admin standing on northwinds.tropicaltalent.dev has no business
  // pulling up Acme's roster from there, and pinning the id to the host is what
  // makes "sign in to the customer's site to reproduce their bug" safe. The
  // unpinned view lives on classic, alongside the estate list.
  const hostTenant = await getTenant();
  const permitted = hostTenant.isClassic
    ? viewer.isSuperAdmin || (viewer.tenantRole === 'wl_admin' && viewer.tenantId === id)
    : id === hostTenant.id && viewer.isTenantAdmin;

  if (!permitted) redirect('/admin');

  const admin = adminDb();
  const [{ data: tenant }, { data: domains }, { data: invites }, { count: members }] =
    await Promise.all([
      admin
        .from('tropical_tenants')
        .select(
          'id, slug, name, archetype, status, features, branding, theme, platform_fee_pct, partner_share_pct, is_classic',
        )
        .eq('id', id)
        .maybeSingle(),
      admin
        .from('tropical_tenant_domains')
        .select('host, is_primary, verified_at')
        .eq('tenant_id', id)
        .order('is_primary', { ascending: false }),
      admin
        .from('tropical_tenant_invites')
        .select('email, member_role, claimed_at, created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(1000),
      admin
        .from('tropical_tenant_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('tenant_id', id),
    ]);

  // Only for the delete guard's copy — the action re-counts before deleting,
  // so this is a warning, not the control.
  const { count: projectCount } = await admin
    .from('tropical_projects')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', id);

  if (!tenant) notFound();

  const preset =
    ARCHETYPE_PRESETS[tenant.archetype as TenantArchetype] ?? ARCHETYPE_PRESETS.classic;
  const primaryHost = (domains ?? []).find((d) => d.is_primary)?.host ?? domains?.[0]?.host;
  const signInUrl = primaryHost ? `https://${primaryHost}/auth/sign-in` : '(no host yet)';

  const pending = (invites ?? []).filter((i) => !i.claimed_at);
  const claimed = (invites ?? []).filter((i) => i.claimed_at);

  return (
    <div className='space-y-8'>
      <div>
        <Link href='/admin/tenants' className='text-muted-foreground hover:text-foreground text-xs'>
          ← Tenants
        </Link>
        <h1 className='mt-2 text-xl font-semibold tracking-tight'>{tenant.name}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {preset.label} · {tenant.platform_fee_pct}% fee
          {tenant.partner_share_pct > 0 && `, ${tenant.partner_share_pct}% of it to the partner`}
        </p>
      </div>

      <section className='space-y-2'>
        <h2 className='text-sm font-semibold'>Hosts</h2>
        {(domains ?? []).length === 0 ? (
          <p className='text-status-pending text-xs'>
            No host. This tenant cannot be reached until one is added.
          </p>
        ) : (
          <ul className='space-y-1 text-sm'>
            {(domains ?? []).map((d) => (
              <li key={d.host} className='flex items-center gap-2'>
                <code className='text-xs'>{d.host}</code>
                {d.is_primary && <span className='text-muted-foreground text-[11px]'>primary</span>}
                {!d.verified_at && (
                  <span className='text-status-pending text-[11px]'>unverified DNS</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Branding and behaviour. Super admin only: a white-label's own admin
          manages their roster, not their fees or their attribution. */}
      {viewer.isSuperAdmin && !tenant.is_classic && (
        <section className='space-y-3'>
          <h2 className='text-sm font-semibold'>Settings</h2>
          <TenantSettings
            tenantId={tenant.id}
            // Deleting a workspace is an estate operation and the action
            // refuses it from anywhere but the TropicalTalent console.
            canDelete={hostTenant.isClassic}
            initial={{
              name: tenant.name,
              ...(tenant.branding as Record<string, never>),
              ...(tenant.theme as Record<string, never>),
              projectCount: projectCount ?? 0,
            }}
          />
        </section>
      )}

      <section className='space-y-3'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <h2 className='text-sm font-semibold'>Roster</h2>
          <p className='text-muted-foreground text-xs'>
            {members ?? 0} joined · {pending.length} waiting · {claimed.length} claimed
          </p>
        </div>

        {tenant.features?.inviteOnly !== true && (
          // Worth stating: an open sign-up on a hostname the client publishes
          // means anyone who finds the link can create an account inside their
          // workspace.
          <p className='text-status-pending text-xs'>
            Sign-up is open to anyone with the link. Set <code>inviteOnly</code> on this tenant to
            restrict it to the roster below.
          </p>
        )}

        <RosterImport
          tenantId={tenant.id}
          workerLabel={preset.signup.worker.label}
          payerLabel={preset.signup.payer.label}
          signInUrl={signInUrl}
        />
      </section>

      {pending.length > 0 && (
        <section className='space-y-2'>
          <h2 className='text-sm font-semibold'>Not yet signed up ({pending.length})</h2>
          <div className='border-foreground/10 max-h-64 overflow-y-auto rounded-xl border'>
            {pending.slice(0, 500).map((i) => (
              <div
                key={i.email}
                className='border-foreground/5 flex items-center justify-between border-b px-3 py-1.5 text-xs last:border-0'
              >
                <span>{i.email}</span>
                {i.member_role === 'wl_admin' && (
                  <span className='text-muted-foreground text-[11px]'>admin</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
