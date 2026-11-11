'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserDb } from '@/lib/supabase-browser';
import { useToast } from '@/components/ui/toast';

/**
 * Live notifications for the signed-in user.
 *
 * Mounted once in the app shell. One subscription filtered on `user_id`, which
 * RLS also enforces — a user is only ever sent their own rows.
 *
 * This is what makes invitations, applications, contract edits and deliverable
 * changes arrive without a refresh. Before it, `tropical_notifications` was
 * written by triggers that nothing on the client ever read: the sidebar showed
 * a count that only updated on a full page load.
 *
 * On arrival it does two things — surfaces a toast, and calls router.refresh()
 * so the server components re-render with the new state. refresh() is a
 * targeted RSC re-fetch, not a reload: it keeps scroll position, focus, and
 * every piece of client state on the page.
 */

interface LiveNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  project_id: string | null;
}

export function useLiveNotifications(userId: string, initialUnread: number) {
  const router = useRouter();
  const { toast } = useToast();
  const [unread, setUnread] = useState(initialUnread);

  // A refresh triggers a server render, which sends a new initialUnread down.
  // Sync to it so the badge cannot drift from the server's count.
  useEffect(() => setUnread(initialUnread), [initialUnread]);

  // Bursts are common — accepting an application writes several rows at once.
  // Coalesce them into one refresh instead of one per row.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = browserDb();

    const channel = supabase
      .channel(`tropical:notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tropical_notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: unknown }) => {
          const notification = payload.new as LiveNotification;

          setUnread((n) => n + 1);
          toast({
            title: notification.title,
            description: notification.body ?? undefined,
          });

          if (pending.current) clearTimeout(pending.current);
          pending.current = setTimeout(() => router.refresh(), 300);
        },
      )
      .subscribe();

    return () => {
      if (pending.current) clearTimeout(pending.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, router, toast]);

  return unread;
}
