import type { Metadata } from 'next';
import Link from 'next/link';
import { markNotificationSentAction } from '@/modules/commercial/actions';
import { loadPendingNotifications } from '@/modules/commercial/queries';

export const metadata: Metadata = {
  title: 'Notifications — Operations',
  robots: { index: false, follow: false },
};

/**
 * Pending notification delivery (Phase 4; delivers from the Phase 3
 * pending rows).
 *
 * Delivery is a recorded manual step ONLY: ops sends the message
 * themselves — email, or another channel the requester gave — and
 * then marks the row sent, with when, on which channel, and how the
 * requester was reached. This page sends nothing itself; no email or
 * push provider is wired. A notification marked sent without a note
 * is refused by the action.
 */
export default async function NotificationsPage() {
  const rows = await loadPendingNotifications();
  const pending = rows.filter((r) => r.status === 'pending');
  const done = rows.filter((r) => r.status !== 'pending');

  return (
    <div className='space-y-6'>
      <header>
        <h1 className='text-2xl font-bold'>Pending notifications</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Requesters waiting to hear that a real opportunity appeared. Send the message yourself
          first — then mark it sent here, with how you reached them. Nothing on this page sends
          email or push.
        </p>
      </header>

      {pending.length === 0 ? (
        <p className='bg-card text-muted-foreground rounded-lg border p-6 text-center text-sm'>
          Nothing pending. When a sourcing request is matched, its notification waits here.
        </p>
      ) : (
        <div className='space-y-3'>
          {pending.map((row) => (
            <article key={row.id} className='bg-card rounded-lg border p-4'>
              <h2 className='font-medium'>{row.requestQuery ?? 'Sourcing request'}</h2>
              <p className='text-muted-foreground mt-1 text-sm'>
                Channel: {row.channel} · waiting since{' '}
                {new Date(row.createdAt).toLocaleDateString()}
              </p>
              <form
                action={async (form: FormData) => {
                  'use server';
                  await markNotificationSentAction(form);
                }}
                className='mt-3 flex flex-wrap gap-2'
              >
                <input type='hidden' name='notificationId' value={row.id} />
                <input
                  name='channel'
                  defaultValue={row.channel}
                  placeholder='Channel (e.g. email)'
                  className='w-36 rounded-md border px-2 py-1.5 text-sm'
                />
                <input
                  name='sentNote'
                  required
                  placeholder='How was the requester reached? (required)'
                  className='min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm'
                />
                <button
                  type='submit'
                  className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium'
                >
                  Mark sent
                </button>
              </form>
            </article>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <section>
          <h2 className='text-muted-foreground text-xs tracking-widest uppercase'>Sent / failed</h2>
          <ul className='mt-2 space-y-1 text-sm'>
            {done.map((row) => (
              <li
                key={row.id}
                className='bg-card flex flex-wrap justify-between gap-2 rounded-lg border px-4 py-2'
              >
                <span className='truncate'>{row.requestQuery ?? 'Sourcing request'}</span>
                <span className='text-muted-foreground shrink-0'>
                  {row.status}
                  {row.sentAt ? ` · ${new Date(row.sentAt).toLocaleDateString()}` : ''}
                  {row.sentNote ? ` · ${row.sentNote}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className='mt-2 text-sm'>
            <Link href='/admin/operations/requests' className='text-primary hover:underline'>
              Back to the requests queue →
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
