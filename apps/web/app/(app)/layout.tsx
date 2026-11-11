import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { themeCss } from '@/modules/tenancy/theme';
import { loadProjectTree } from '@/modules/projects/queries';
import { countUnread } from '@/modules/notifications/queries';
import { loadUnreadCounts } from '@/modules/chat/queries';
import { AppShell, SIDEBAR_COOKIE } from '@/components/tropical/app-shell';

/**
 * The signed-in shell.
 *
 * This being a LAYOUT rather than a component each page renders is the single
 * biggest navigation win in the rebuild. Previously every page called
 * <AppShell> itself, so moving from /projects to /briefs re-ran the auth
 * check, the profile query and the project-tree query — three round trips to
 * redraw a sidebar that had not changed.
 *
 * As a layout, Next keeps it mounted across navigations between the routes
 * beneath it. The sidebar's data is fetched once per full page load.
 *
 * The reads here are independent and run concurrently.
 */
/**
 * Tab title and favicon for the signed-in app.
 *
 * Scoped to this segment rather than the root layout on purpose: the root
 * layout also covers the landing page, which is `force-static`, and a
 * generateMetadata there that reads the Host header would force every route
 * — marketing included — to render dynamically.
 *
 * Pages set their own single-word titles ("Wallet", "Talent") against the
 * template, so `default` is only what shows on a page that sets none.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const icon = tenant.branding.logoUrl;

  return {
    title: { default: tenant.name, template: '%s' },
    ...(icon && icon.startsWith('https://') ? { icons: { icon } } : {}),
  };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in');

  // An OAuth account that never finished the profile form has no role, so
  // every surface below would render for the wrong audience. The callback
  // normally routes them, but this catches a bookmark, a back-button, or a
  // second device — and it costs nothing: profileCompleted is already on the
  // viewer we just loaded.
  if (!viewer.profileCompleted) redirect('/auth/complete');

  // Signed in, but not a member of the tenant this hostname resolves to.
  //
  // Not a silent pass, and not a redirect to the classic app either. One
  // Supabase identity can hold memberships in several tenants, so being
  // authenticated says nothing about belonging HERE — a contractor with an
  // Acme login who opens beta.othercorp.com must be told, not quietly shown an
  // empty shell whose every query returns zero rows and reads as a bug.
  //
  // It also means a session cookie that somehow spanned two hosts grants
  // nothing: RLS would return nothing anyway, and this makes the failure
  // legible instead of mysterious.
  if (!viewer.belongsToTenant) redirect('/auth/no-access');

  const [projects, unread, unreadByChannel, cookieStore, tenant] = await Promise.all([
    loadProjectTree(),
    countUnread(viewer.id),
    // One call covers every project in the tree, not one per project.
    loadUnreadCounts(),
    cookies(),
    // Already resolved and React.cache'd by getViewer above, so this is free —
    // it is in the Promise.all to make the dependency explicit rather than to
    // parallelise a second lookup.
    getTenant(),
  ]);

  const brandCss = themeCss(tenant);

  return (
    <>
      {/* The tenant palette, server-rendered ahead of the shell.
       *
       * In the HTML rather than in a client effect on purpose: the override
       * has to be in the first paint or the user sees TropicalTalent's green resolve
       * into their own brand colour, which is exactly the tell a white-label
       * is sold to avoid. Empty string for the classic tenant, so this costs
       * nothing on tropicaltalent.dev.
       *
       * themeCss() allowlists both the property names and the values — see
       * modules/tenancy/theme.ts. Nothing from the database reaches this
       * string unvalidated. */}
      {brandCss ? <style dangerouslySetInnerHTML={{ __html: brandCss }} /> : null}
      <AppShell
        viewer={viewer}
        tenant={tenant}
        projects={projects}
        unreadCount={unread}
        unreadByChannel={unreadByChannel}
        defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === '1'}
      >
        {children}
      </AppShell>
    </>
  );
}
