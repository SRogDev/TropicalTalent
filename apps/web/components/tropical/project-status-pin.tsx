import { Calendar } from 'lucide-react';
import type { ProjectStatus } from '@/modules/projects/types';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Draft',
  pending_payment: 'Awaiting payment',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_DOT: Record<ProjectStatus, string> = {
  draft: 'bg-status-cancelled',
  pending_payment: 'bg-status-pending',
  active: 'bg-status-active',
  completed: 'bg-status-complete',
  cancelled: 'bg-status-cancelled',
};

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * `toLocaleDateString` was here before and caused a hydration mismatch: en-GB
 * short-month formatting renders "Sept" in Node's ICU data and "Sep" in the
 * browser's. UTC getters rather than local ones because a delivery date is a
 * calendar date, not an instant — reading it in the viewer's timezone could
 * shift it a day either way.
 */
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Delivery date and project status, pinned above every channel's thread
 * rather than posted as a message — a message would scroll away, and every
 * member needs this visible for the life of the project regardless of which
 * channel they're in.
 */
export function ProjectStatusPin({
  status,
  deadlineDate,
}: {
  status: ProjectStatus;
  deadlineDate: string | null;
}) {
  return (
    <div className='border-foreground/10 bg-sunken flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-[11px] sm:px-5'>
      <span className='flex items-center gap-1.5'>
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
        <span className='text-muted-foreground'>Status</span>
        <span className='text-foreground font-medium'>{STATUS_LABEL[status]}</span>
      </span>
      <span className='flex items-center gap-1.5'>
        <Calendar size={11} className='text-muted-foreground' />
        <span className='text-muted-foreground'>Delivery</span>
        <span className='text-foreground font-medium'>
          {deadlineDate ? formatDeadline(deadlineDate) : 'Not set'}
        </span>
      </span>
    </div>
  );
}
