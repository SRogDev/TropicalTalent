import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Briefcase, FileText } from 'lucide-react';
import { getViewer } from '@/modules/identity/queries';
import { loadMyRoles } from '@/modules/projects/queries';
import { loadMyApplications } from '@/modules/briefs/queries';
import { disciplineLabels } from '@/modules/skills/queries';
import { ApplicationCard } from '@/components/tropical/application-card';
import { InvitationCard } from '@/components/tropical/invitation-card';
import { LeaveRoleButton } from '@/components/tropical/leave-role-button';
import { formatPence } from '@/lib/money';

export const metadata: Metadata = {
  title: 'Jobs',
  description: 'Roles you hold and applications you have sent.',
};

/**
 * The talent's own work.
 *
 * Roles they hold, and — the change — full detail on every job they have
 * APPLIED to. Previously an applicant could see only that they had applied:
 * RLS on tropical_projects is members-only and an applicant is not a member
 * until accepted, so the project name, brief, status and deadline were all
 * invisible to them. The tropical_my_applications view (migration 011) is the
 * sanctioned projection that carries the job detail without the money.
 */
export default async function JobsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/auth/sign-in?next=/jobs');

  const [roles, applications, labels] = await Promise.all([
    loadMyRoles(viewer.id),
    loadMyApplications(viewer.id),
    disciplineLabels(),
  ]);

  // An 'invited' role is an OFFER, not a role held. Listing the two together
  // implied the talent had committed to work they had never agreed to — and
  // there was no way to answer from anywhere in the app.
  const invitations = roles.filter((r) => r.status === 'invited');
  const held = roles.filter((r) => r.status !== 'invited');

  // Roles already appear above; an application that produced one would
  // otherwise be listed twice.
  const heldRoleIds = new Set(roles.map((r) => r.id));
  const openApplications = applications.filter(
    (a) => !heldRoleIds.has(a.role_id) && a.status !== 'withdrawn',
  );

  const empty = held.length === 0 && invitations.length === 0 && openApplications.length === 0;

  return (
    <div className='mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10'>
      <header>
        <div className='glass text-accent inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] tracking-[0.18em] uppercase'>
          <Briefcase size={12} /> Active work
        </div>
        <h1 className='mt-4 text-2xl font-semibold tracking-tight sm:text-3xl'>My jobs</h1>
      </header>

      {empty ? (
        <div className='glass mt-8 rounded-2xl p-8 text-center sm:p-10'>
          <p className='text-muted-foreground text-sm'>
            No roles yet. Apply from open briefs to get started.
          </p>
          <Link
            href='/briefs'
            className='bg-gradient-brand text-on-brand mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-medium'
          >
            Browse briefs
          </Link>
        </div>
      ) : (
        <>
          {invitations.length > 0 && (
            <section className='mt-8'>
              <h2 className='text-accent text-[11px] tracking-widest uppercase'>Waiting on you</h2>
              <div className='mt-3 grid gap-4 md:grid-cols-2'>
                {invitations.map((role) => (
                  <InvitationCard key={role.id} role={role} />
                ))}
              </div>
            </section>
          )}

          {held.length > 0 && (
            <section className='mt-8'>
              <h2 className='text-muted-foreground text-[11px] tracking-widest uppercase'>
                Roles you hold
              </h2>
              <div className='mt-3 grid gap-4 md:grid-cols-2'>
                {held.map((role) => (
                  <div
                    key={role.id}
                    className='glass hover:border-foreground/20 flex flex-col rounded-2xl transition'
                  >
                    <Link href={`/projects/${role.project?.id}`} className='flex-1 p-5'>
                      <div className='text-muted-foreground text-xs tracking-widest uppercase'>
                        {role.title}
                      </div>
                      <h3 className='mt-1 text-base font-semibold'>{role.project?.name}</h3>
                      <p className='text-muted-foreground mt-2 line-clamp-2 text-sm'>
                        {role.project?.brief}
                      </p>

                      {role.deliverables && (
                        <p className='text-muted-foreground mt-2 line-clamp-2 text-xs'>
                          {role.deliverables}
                        </p>
                      )}

                      <p className='text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]'>
                        <FileText size={11} className='shrink-0' />
                        {contractLabel(role.contract)}
                      </p>

                      <div className='mt-4 flex items-center justify-between'>
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] tracking-widest uppercase ${roleTone(role.status)}`}
                        >
                          {role.status}
                        </span>
                        {/* A held role's own fee is the talent's business — it
                            is their contract. Other roles' fees are not shown
                            anywhere they can reach. */}
                        <span className='text-sm font-semibold tabular-nums'>
                          {formatPence(role.amount, role.project?.currency ?? 'GBP')}
                        </span>
                      </div>

                      {role.deadline_date && (
                        <p className='text-muted-foreground mt-2 text-[11px]'>
                          Due{' '}
                          {new Date(role.deadline_date).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'long',
                          })}
                        </p>
                      )}
                    </Link>

                    {/* Outside the link on purpose: a button inside an anchor
                        is a click that does two things. */}
                    {canLeave(role) && role.project && (
                      <div className='border-foreground/10 border-t px-5 py-3'>
                        <LeaveRoleButton
                          roleId={role.id}
                          roleTitle={role.title}
                          projectName={role.project.name}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {openApplications.length > 0 && (
            <section className='mt-8'>
              <h2 className='text-muted-foreground text-[11px] tracking-widest uppercase'>
                Applications
              </h2>
              <div className='mt-3 grid gap-4 md:grid-cols-2'>
                {openApplications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    disciplineLabels={labels}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Whether the door is still open. Mirrors tropical_leave_role's gate (048): an
 * accepted seat whose money is not committed — a pot before escrow funds, a
 * retainer role before it activates. Past that the DM offers the complaint
 * form instead, and the RPC would refuse regardless.
 */
function canLeave(role: {
  status: string;
  pay_model: 'fixed' | 'recurring';
  activated_at: string | null;
  project: { status: string } | null;
}): boolean {
  if (role.status !== 'accepted' || !role.project) return false;
  if (role.pay_model === 'recurring') return role.activated_at === null;
  return role.project.status === 'draft' || role.project.status === 'pending_payment';
}

function contractLabel(
  contract: {
    status: 'draft' | 'agreed' | 'locked';
    brand_accepted: boolean;
    creative_accepted: boolean;
  } | null,
): string {
  if (!contract) return 'Contract not drafted yet';
  if (contract.status === 'locked') return 'Contract locked - escrow paid';
  if (contract.status === 'agreed') return 'Contract agreed';
  if (contract.creative_accepted) return 'You accepted - waiting on the brand';
  if (contract.brand_accepted) return 'Brand accepted - your turn';
  return 'Contract not yet accepted';
}

function roleTone(status: string): string {
  switch (status) {
    case 'released':
      return 'bg-status-complete/20 text-status-complete';
    case 'accepted':
    case 'approved':
      return 'bg-status-active/20 text-status-active';
    default:
      return 'bg-status-pending/20 text-status-pending';
  }
}
