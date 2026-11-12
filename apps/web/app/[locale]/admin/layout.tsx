import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { hasFeature, homePath, type TenantFeatures } from '@/modules/tenancy/types';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

interface AdminNavItem {
  href: string;
  label: string;
  /**
   * A view of the ESTATE rather than of one customer.
   *
   * Shown only to a super admin standing on the classic host. Being a super
   * admin is not enough on its own — see the note on NAV below.
   */
  crossTenantOnly?: boolean;
  /** Shown only when the tenant has this surface switched on. */
  feature?: keyof TenantFeatures;
}

/**
 * `crossTenantOnly` marks a screen that is about every customer at once.
 * /admin/tenants is the only one: it lists every white-label on the
 * deployment — their names, hostnames, platform fees and partner splits.
 *
 * ---------------------------------------------------------------------------
 * Why the host matters and not just the role
 * ---------------------------------------------------------------------------
 * This was gated on `viewer.isSuperAdmin` alone, which reads as correct and is
 * not. A TropicalTalent super admin signing in to acme.tropicaltalent.dev to reproduce a
 * customer's bug — the workflow tropical_is_tenant_admin() exists to support —
 * got the full customer list rendered on Acme's own domain, one commercial
 * relationship visible from inside another.
 *
 * requireAdminScope() already states the rule this needs to follow: "A super
 * admin visiting acme.tropicaltalent.dev/admin sees ACME's console, not a cross-tenant
 * one. The unscoped view lives on the classic host, where it belongs." The
 * estate is the most cross-tenant thing in the console, so it follows that rule
 * hardest. The pages behind it enforce the same test independently — a hidden
 * link is not a control.
 *
 * Referrals is deliberately NOT among these. TropicalTalent fulfils the rewards by hand,
 * but a white-label that switches the feature on runs its own scheme and its
 * admin needs to see who is owed what. Those rows are scoped by membership in
 * modules/admin/queries.ts, so a customer sees their own referrers and nobody
 * else's; the flag only decides whether the tab is worth offering, since it is
 * off in both white-label archetypes.
 */
const NAV: AdminNavItem[] = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/operations', label: 'Operations' },
  { href: '/admin/users', label: 'Accounts' },
  { href: '/admin/suppliers', label: 'Suppliers' },
  { href: '/admin/projects', label: 'Projects' },
  { href: '/admin/earnings', label: 'Earnings' },
  { href: '/admin/complaints', label: 'Complaints' },
  { href: '/admin/deletions', label: 'Deletions' },
  { href: '/admin/referrals', label: 'Referrals', feature: 'referrals' },
  { href: '/admin/comms', label: 'User comms' },
  { href: '/admin/tenants', label: 'Tenants', crossTenantOnly: true },
];

/**
 * The admin shell.
 *
 * Deliberately not built on the (app) route group's AppShell — that layout's
 * nav and home route branch on brand vs. talent, neither of which an admin
 * is, and it fetches the project-tree sidebar data no admin screen needs.
 * This is a second, much smaller shell for a third audience.
 *
 * Authorisation is two-layered by design: proxy.ts already required a signed-
 * in session to reach anything outside PUBLIC_PATHS, and this layout is the
 * one place that checks the role. Every query and action under /admin
 * re-checks it again independently (see modules/admin/queries.ts) — a page
 * that forgot to sit under this layout would still refuse to return data.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [viewer, tenant] = await Promise.all([getViewer(), getTenant()]);
  if (!viewer) redirect('/auth/sign-in?next=/admin');

  // isTenantAdmin, not role === 'admin'. A white-label's own admin reaches
  // this console too, scoped to their tenant by requireAdminScope() in every
  // loader beneath. A TropicalTalent super admin satisfies it everywhere by definition.
  //
  // Sent to their own home rather than `/`: on a white-label `/` is redirected
  // to the sign-in form by the gateway, which then bounces a signed-in visitor
  // to /auth/continue and back into the app — three hops to reach a page this
  // layout could have named directly.
  if (!viewer.isTenantAdmin) {
    redirect(
      homePath({ canBrand: viewer.canBrand, isCreative: viewer.isCreative }, tenant.features),
    );
  }

  // Unscoped only for a super admin on the classic host. The same rule
  // requireAdminScope() applies to the data, restated here so the chrome
  // cannot claim a breadth the queries will not deliver.
  const crossTenant = viewer.isSuperAdmin && tenant.isClassic;

  /**
   * The nav this admin gets, on this host.
   *
   * `crossTenantOnly` items need the estate view; `feature` items only exist
   * where the tenant has switched the surface on. The pages refuse
   * independently either way.
   */
  const nav = NAV.filter(
    (item) =>
      (!item.crossTenantOnly || crossTenant) && (!item.feature || hasFeature(tenant, item.feature)),
  );

  /**
   * The way into ONE workspace's page — its roster, its branding, its hosts.
   *
   * Offered on every white-label host, to a customer's own admin and to a TropicalTalent
   * super admin inspecting it alike. Two different people needed it for the
   * same reason: /admin/tenants/<id> is where the roster is loaded, which the
   * runbook calls a white-label admin's core onboarding job, and the estate
   * list that used to be the only route to it is not shown here any more.
   *
   * Not offered on classic, where "Tenants" already lists every workspace and a
   * second link to one of them would be noise.
   *
   * Labelled "Workspace" rather than "Tenants": there is one, it is theirs, and
   * "tenant" is our word for it, not the customer's.
   */
  const workspaceHref = tenant.isClassic ? null : `/admin/tenants/${tenant.id}`;

  return (
    <div className='min-h-screen'>
      <header className='border-foreground/10 border-b'>
        <div className='mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 sm:px-6'>
          <Link href='/admin' className='text-sm font-semibold tracking-tight'>
            {tenant.name} <span className='text-muted-foreground font-normal'>/ Admin</span>
          </Link>
          {/* The scope, stated rather than implied. An admin looking at this
              console must never have to guess whether the numbers cover one
              customer or all of them. */}
          <span className='text-muted-foreground border-foreground/10 hidden rounded-full border px-2 py-0.5 text-[11px] sm:inline'>
            {crossTenant ? 'All tenants' : tenant.name}
          </span>
          <nav className='flex flex-1 items-center gap-1 overflow-x-auto'>
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className='text-muted-foreground hover:text-foreground hover:bg-foreground/5 shrink-0 rounded-lg px-3 py-1.5 text-sm transition'
              >
                {item.label}
              </Link>
            ))}
            {workspaceHref && (
              <Link
                href={workspaceHref}
                className='text-muted-foreground hover:text-foreground hover:bg-foreground/5 shrink-0 rounded-lg px-3 py-1.5 text-sm transition'
              >
                Workspace
              </Link>
            )}
          </nav>
          <Link href='/' className='text-muted-foreground hover:text-foreground shrink-0 text-xs'>
            Back to app
          </Link>
        </div>
      </header>
      <main className='mx-auto max-w-6xl px-4 py-8 sm:px-6'>{children}</main>
    </div>
  );
}
