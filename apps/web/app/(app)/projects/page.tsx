import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Bell, Plus } from 'lucide-react';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { loadBrandProjects } from '@/modules/projects/queries';
import { TalentAvatar } from '@/components/tropical/talent-avatar';
import { formatPence } from '@/lib/money';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'Your projects and their crews.',
};

/**
 * The brand's project grid.
 *
 * ONE query for the whole page. The previous version called
 * loadProjectWorkspace() once per project — eight projects meant eight full
 * workspace loads (roles + members + channels + escrow + assignee profiles
 * each) to render eight summary cards.
 */
export default async function ProjectsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/projects');
  if (!viewer.canBrand) redirect('/jobs');

  // getTenant is React.cache'd and already resolved by getViewer above, so the
  // Promise.all is for clarity rather than to parallelise a second lookup.
  const [projects, tenant] = await Promise.all([loadBrandProjects(viewer.id), getTenant()]);

  return (
    <div className='mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight sm:text-3xl'>Projects</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            {projects.length === 0
              ? 'Nothing here yet.'
              : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Link
          href='/create'
          className='bg-gradient-brand glow text-on-brand flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium'
        >
          <Plus size={14} /> New brief
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className='glass mt-8 rounded-2xl p-8 text-center sm:p-10'>
          <p className='text-muted-foreground text-sm'>
            Describe a brief and {tenant.name} builds the crew.
          </p>
          <Link
            href='/create'
            className='bg-gradient-brand text-on-brand mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-medium'
          >
            Start a brief
          </Link>
        </div>
      ) : (
        <div className='mt-8 grid gap-4 md:grid-cols-2'>
          {projects.map((project) => {
            const filled = project.roles.filter((r) => r.assignee).length;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className='glass group hover:border-foreground/20 rounded-2xl p-5 transition'
              >
                <div className='flex items-start justify-between gap-3'>
                  <h2 className='text-base font-semibold'>{project.name}</h2>
                  <div className='flex shrink-0 items-center gap-2'>
                    {project.pendingApplications > 0 && (
                      <span
                        className='bg-accent/20 text-accent flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium'
                        title={`${project.pendingApplications} awaiting review`}
                      >
                        <Bell size={9} />
                        {project.pendingApplications}
                      </span>
                    )}
                    <span
                      className={`mt-1.5 h-2 w-2 rounded-full ${statusDot(project.status)}`}
                      title={project.status.replace('_', ' ')}
                    />
                  </div>
                </div>

                <p className='text-muted-foreground mt-2 line-clamp-2 text-sm'>{project.brief}</p>

                <div className='mt-4 flex items-center justify-between'>
                  <div className='flex -space-x-2'>
                    {project.roles.slice(0, 5).map((role) => (
                      <TalentAvatar key={role.id} candidate={role.assignee} size={28} ring />
                    ))}
                  </div>
                  <div className='text-right'>
                    <div className='text-sm font-semibold tabular-nums'>
                      {formatPence(project.budget, project.currency)}
                    </div>
                    <div className='text-muted-foreground text-[11px]'>
                      {filled}/{project.roles.length} filled
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusDot(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-status-active';
    case 'completed':
      return 'bg-status-complete';
    case 'cancelled':
      return 'bg-status-cancelled';
    default:
      return 'bg-status-pending';
  }
}
