import { complaintCategoryLabel, type ComplaintRow } from '@/modules/complaints/types';

/**
 * One profile-level complaint in the admin queue.
 *
 * A server component with no actions on it, unlike AdminDisputeRow — a dispute
 * has an outcome that moves escrow, and this does not. Triage happens outside
 * the app for now; the row's job is to make the report legible.
 */
export function AdminComplaintRow({ complaint }: { complaint: ComplaintRow }) {
  const reporter =
    complaint.raisedByName ??
    (complaint.raisedByUsername ? `@${complaint.raisedByUsername}` : 'Unknown');

  return (
    <article className='glass rounded-xl p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='bg-foreground/5 rounded-full px-2.5 py-0.5 text-[11px] font-medium'>
          {complaintCategoryLabel(complaint.category)}
        </span>
        <span className='text-muted-foreground text-[11px] capitalize'>{complaint.status}</span>
        <span className='text-muted-foreground ml-auto text-[11px]'>
          {new Date(complaint.createdAt).toLocaleDateString()}
        </span>
      </div>

      <p className='mt-2.5 text-sm'>
        <span className='text-muted-foreground'>From</span> {reporter}
        {complaint.subjectUsername && (
          <>
            <span className='text-muted-foreground'> · about </span>
            {complaint.subjectName ?? `@${complaint.subjectUsername}`}
            <span className='text-muted-foreground text-xs'> (@{complaint.subjectUsername})</span>
          </>
        )}
      </p>

      {complaint.detail ? (
        <p className='text-muted-foreground mt-2 text-sm whitespace-pre-wrap'>{complaint.detail}</p>
      ) : (
        <p className='text-muted-foreground/70 mt-2 text-xs italic'>No further detail given.</p>
      )}

      {complaint.resolution && (
        <p className='border-foreground/10 text-muted-foreground mt-3 border-t pt-3 text-xs'>
          <span className='text-foreground font-medium'>Resolution:</span> {complaint.resolution}
        </p>
      )}
    </article>
  );
}
