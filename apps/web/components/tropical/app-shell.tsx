'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Briefcase,
  Compass,
  FolderKanban,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { signOutAction } from '@/modules/identity/actions';
import { ThemeToggleButton } from '@/components/shared/theme-toggle-button';
import { cn } from '@/lib/utils';
import type { Viewer } from '@/modules/identity/types';
import type { Tenant, TenantFeatures } from '@/modules/tenancy/types';
import { hasFeature } from '@/modules/tenancy/types';
import { wordmark } from '@/modules/tenancy/theme';
import { TenantLogo } from './tenant-logo';
import { TenantNameProvider } from './tenant-context';
import { nounsFor } from '@/modules/tenancy/presets';
import type { ProjectTreeNode } from '@/modules/projects/types';
import { useLiveNotifications } from '@/hooks/use-live-notifications';
import { ProjectTree } from './project-tree';
import { TalentAvatar } from './talent-avatar';

/**
 * The app shell: navigation, project tree, profile, logout.
 *
 * Three behaviours the previous shell did not have:
 *
 *   1. The sidebar retracts to a 60px icon rail and expands again. The choice
 *      lives in a cookie, NOT localStorage, so the server layout can read it
 *      and render the correct width in the first HTML. localStorage would only
 *      be readable after hydration, which means one frame of expanded sidebar
 *      before it snaps closed.
 *   2. Below `md` the sidebar is a drawer instead of being replaced by a
 *      cramped horizontal strip that hid its labels behind `sr-only`.
 *   3. A logout button sits next to the profile row.
 *
 * It is a client component because all of that is interaction state — but it
 * receives its DATA from the layout above, already resolved on the server, so
 * nothing here fetches.
 */

/*
 * `feature` gates a link on the tenant, where capabilities gate it on the
 * person. Both have to pass. A contractor-only white-label turns publicBriefs
 * off, so "Discover briefs" disappears for everyone there — while on classic
 * the same link is hidden from brands by capability instead. Items with no
 * feature are unconditional.
 *
 * (The old Wallet link lived outside both groups; it is gone with payments —
 * /wallet is a placeholder page in this reference build and is not linked
 * from the shell.)
 */
const HIRING_NAV: NavItem[] = [
  { href: '/create', label: 'Create', icon: Sparkles },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/talent', label: 'Talent', icon: Users, feature: 'talentBrowse' },
];

const WORKING_NAV: NavItem[] = [
  { href: '/briefs', label: 'Discover briefs', icon: Compass, feature: 'publicBriefs' },
  { href: '/jobs', label: 'My jobs', icon: Briefcase },
];

/**
 * The console, for whoever may open it.
 *
 * Gated on `viewer.isTenantAdmin` — a white-label's own wl_admin, or a TropicalTalent
 * super admin, both of whom app/admin/layout.tsx already admits. Until this
 * link existed there was no way IN from the product: a customer's admin could
 * only reach their own roster page by being told the URL, which is not a
 * shipping onboarding flow. The layout and every loader beneath it re-check
 * independently, so this only stops the link being offered.
 */
const ADMIN_NAV: NavItem[] = [{ href: '/admin', label: 'Admin', icon: ShieldCheck }];

/** Read by the server layout; written here. One year, lax, site-wide. */
export const SIDEBAR_COOKIE = 'tropical_sidebar';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * The tenant feature this link needs. Absent means unconditional.
   *
   * Typed here rather than inferred from the arrays: without a shared type the
   * two nav arrays infer incompatible literal types for `feature` and cannot
   * be passed to the same filter.
   */
  feature?: keyof TenantFeatures;
}

function NavLink({
  item: { href, label, icon: Icon },
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-lg py-2 text-sm transition',
        collapsed ? 'justify-center px-2' : 'px-3',
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md',
          active ? 'bg-foreground/10' : 'bg-foreground/5 group-hover:bg-foreground/10',
        )}
      >
        <Icon size={14} />
      </span>
      {!collapsed && <span className='truncate font-medium'>{label}</span>}
    </Link>
  );
}

export function AppShell({
  viewer,
  tenant,
  projects,
  unreadCount,
  unreadByChannel,
  defaultCollapsed,
  children,
}: {
  viewer: Viewer;
  /** Resolved from the Host header by the layout. Classic TropicalTalent is one of these. */
  tenant: Tenant;
  projects: ProjectTreeNode[];
  unreadCount: number;
  unreadByChannel: Record<string, number>;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const unread = useLiveNotifications(viewer.id, unreadCount);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const toggleCollapsed = useCallback(
    () => setCollapsedPersisted(!collapsed),
    [collapsed, setCollapsedPersisted],
  );

  /**
   * A project workspace collapses the sidebar.
   *
   * The workspace has its own channel rail, so an expanded sidebar puts two
   * navigation columns side by side and squeezes the thread. Collapsing hands
   * that width to the conversation, which is what the screen is for.
   *
   * Only on the way IN — the user can expand it again while staying on the
   * page, and this must not fight them for it. `wasInProject` tracks the edge
   * rather than the state.
   */
  const wasInProject = useRef(false);
  useEffect(() => {
    const inProject = /^\/projects\/[^/]+/.test(pathname);
    if (inProject && !wasInProject.current) setCollapsedPersisted(true);
    wasInProject.current = inProject;
  }, [pathname, setCollapsedPersisted]);

  // Any navigation closes the drawer. Without this, tapping a link on mobile
  // leaves the overlay covering the page you just navigated to.
  useEffect(() => setDrawerOpen(false), [pathname]);

  // Headers only earn their space when there is more than one group to tell
  // apart — see the note on HIRING_NAV.
  // Capability decides whether the group belongs to this person; the tenant's
  // feature flags decide whether each link exists on this site at all. A group
  // left with no links is dropped rather than rendered as an empty header.
  const allowed = (items: typeof HIRING_NAV) =>
    items.filter((i) => !('feature' in i) || !i.feature || hasFeature(tenant, i.feature));

  const groups = [
    viewer.canBrand ? { label: 'Hiring', items: allowed(HIRING_NAV) } : null,
    viewer.isCreative ? { label: 'Working', items: allowed(WORKING_NAV) } : null,
  ].filter(
    (g): g is { label: string; items: typeof HIRING_NAV } => g !== null && g.items.length > 0,
  );

  const showGroupLabels = groups.length > 1;

  // A talent lands on their working home; a brand-only account on its
  // projects. On a tenant with no brief feed the working home is /jobs, or a
  // contractor would land on a page that does not exist for them.
  /**
   * What to call this person, in this tenant's words.
   *
   * Was `viewer.isCreative ? 'Talent' : 'Brand'` — TropicalTalent's vocabulary imposed
   * on every white-label, so a contractor platform's company saw "Talent" or
   * "Brand" and neither was a word their site uses.
   *
   * Reads the capabilities rather than users.role because capabilities are what
   * decide what the account can do, and writeProfile() now keeps the role in
   * step with them. An account holding both — the classic TropicalTalent shape, where a
   * talent hires as well as works — is named for the side it works, since
   * that is the one it is discoverable as.
   */
  const nouns = nounsFor(tenant.archetype);
  const roleLabel = capitalise(
    viewer.isCreative ? nouns.worker.one : viewer.canBrand ? nouns.payer.one : 'member',
  );

  const home = viewer.isCreative
    ? hasFeature(tenant, 'publicBriefs')
      ? '/briefs'
      : '/jobs'
    : '/projects';

  const sidebar = (
    <>
      {/* Logo left, collapse control right — the two ends of the same row.
          It used to sit pinned at the very bottom, below the profile, which is
          the last place you look for a control that governs the whole panel. */}
      <div
        className={cn(
          'flex shrink-0 items-center',
          // At 60px wide there is no room for both on one row, so they stack —
          // which needs the fixed h-14 dropped, not overflowed.
          collapsed ? 'flex-col gap-1 px-1 py-2' : 'h-14 justify-between pr-2 pl-5',
        )}
      >
        <Link href={home} className='flex items-center gap-2'>
          <TenantLogo
            logoUrl={tenant.branding.logoUrl}
            name={tenant.name}
            size={24}
            priority
            className='h-6 w-6'
          />
          {!collapsed && (
            <span className='text-sm font-semibold tracking-tight'>{wordmark(tenant)}</span>
          )}
        </Link>

        <button
          type='button'
          onClick={toggleCollapsed}
          className='text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground hidden h-9 w-9 shrink-0 place-items-center rounded-lg transition md:grid'
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className={cn('py-2', collapsed ? 'px-2' : 'px-3')}>
        {groups.map((group, i) => (
          <div
            key={group.label}
            className={cn('space-y-1', i > 0 && 'mt-4')}
            // Labelled even when the heading is hidden (collapsed rail, or a
            // single-group account) so the grouping survives for a screen
            // reader wherever it is only implied visually.
            role={showGroupLabels ? 'group' : undefined}
            aria-label={showGroupLabels ? group.label : undefined}
          >
            {/* Collapsed to a 60px rail there is no room for a text header,
                and a divider carries the same "these are separate" meaning. */}
            {showGroupLabels &&
              (collapsed ? (
                i > 0 && <div className='border-foreground/10 mx-2 mb-3 border-t' />
              ) : (
                <div
                  aria-hidden='true'
                  className='text-muted-foreground/70 px-3 pb-1 text-[10px] tracking-[0.18em] uppercase'
                >
                  {group.label}
                </div>
              ))}
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
            ))}
          </div>
        ))}

        <div className={cn('space-y-1', showGroupLabels ? 'mt-4' : 'mt-1')}>
          {viewer.isTenantAdmin &&
            ADMIN_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
            ))}
        </div>
      </nav>

      {!collapsed && (
        <div className='text-muted-foreground/70 px-5 pt-4 pb-2 text-[10px] tracking-[0.18em] uppercase'>
          Projects
        </div>
      )}
      <ProjectTree projects={projects} collapsed={collapsed} unreadByChannel={unreadByChannel} />

      <div className='border-foreground/10 mt-auto border-t'>
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1 p-2' : 'gap-1 p-2')}>
          <Link
            href={`/profile/${viewer.username ?? viewer.id}`}
            className={cn(
              'hover:bg-foreground/[0.04] flex min-w-0 items-center gap-3 rounded-lg px-2 py-2',
              collapsed ? 'justify-center' : 'flex-1',
            )}
            title={collapsed ? 'Your profile' : undefined}
          >
            <TalentAvatar candidate={viewer} size={30} />
            {!collapsed && (
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-xs font-medium'>
                  {viewer.name || viewer.username || 'Your profile'}
                </span>
                <span className='text-muted-foreground block text-[10px]'>
                  {roleLabel}
                  {unread > 0 && ` · ${unread} new`}
                </span>
              </span>
            )}
          </Link>

          {/* Light/dark lives here rather than only on the landing page: the
              app is where people spend the day, and the toggle out front used
              to stop working the moment they signed in. */}
          <ThemeToggleButton className='text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground h-9 w-9 shrink-0 rounded-lg' />

          {/* Sits adjacent to the profile row, per the brief. A form post so
              it works with JS disabled and cannot be triggered by a prefetch. */}
          <form action={signOutAction}>
            <button
              type='submit'
              title='Log out'
              aria-label='Log out'
              className='text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground grid h-9 w-9 place-items-center rounded-lg transition'
            >
              <LogOut size={15} />
            </button>
          </form>
        </div>
      </div>
    </>
  );

  return (
    // TenantNameProvider wraps the shell, not the app: every client component
    // that names the brand lives under here, and the auth screens outside it
    // are TropicalTalent's own surfaces where the default is correct.
    <TenantNameProvider name={tenant.name} nouns={nouns}>
      <div className='tropical flex h-dvh overflow-hidden'>
        {/* Desktop rail */}
        <aside
          className={cn(
            'glass border-foreground/10 hidden shrink-0 flex-col border-r transition-[width] duration-200 md:flex',
            collapsed ? 'w-[60px]' : 'w-64',
          )}
        >
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className='fixed inset-0 z-50 md:hidden'>
            <button
              type='button'
              aria-label='Close menu'
              onClick={() => setDrawerOpen(false)}
              className='absolute inset-0 bg-black/60 backdrop-blur-sm'
            />
            <aside className='glass animate-in slide-in-from-left border-foreground/10 absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r duration-200'>
              <button
                type='button'
                onClick={() => setDrawerOpen(false)}
                aria-label='Close menu'
                className='text-muted-foreground hover:text-foreground absolute top-3 right-3 z-10 grid h-9 w-9 place-items-center rounded-lg'
              >
                <X size={16} />
              </button>
              {sidebar}
            </aside>
          </div>
        )}

        <div className='flex min-w-0 flex-1 flex-col'>
          {/* Mobile top bar. Just a menu button and the logo — the nav itself
            lives in the drawer, where the labels are readable. */}
          <header className='glass border-foreground/10 flex h-14 shrink-0 items-center gap-3 border-b px-3 md:hidden'>
            <button
              type='button'
              onClick={() => setDrawerOpen(true)}
              aria-label='Open menu'
              className='text-muted-foreground hover:text-foreground grid h-10 w-10 place-items-center rounded-lg'
            >
              <Menu size={18} />
            </button>
            <Link href={home} className='flex items-center gap-2'>
              <TenantLogo
                logoUrl={tenant.branding.logoUrl}
                name={tenant.name}
                size={22}
                className='h-5.5 w-5.5'
              />
              <span className='text-sm font-semibold tracking-tight'>{wordmark(tenant)}</span>
            </Link>
          </header>

          <main className='min-h-0 flex-1 overflow-y-auto'>{children}</main>
        </div>
      </div>
    </TenantNameProvider>
  );
}

/** Sentence case for a noun that is stored lowercase for use mid-sentence. */
function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
