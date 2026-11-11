'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { browserDb } from '@/lib/supabase-browser';

/**
 * Live project state other than messages.
 *
 * Messages have their own subscription with optimistic sends and echo
 * reconciliation (see use-project-realtime). Everything ELSE in a project —
 * contract drafts, deliverables, role status, escrow — is server-rendered, so
 * the way to keep it live is to re-render the server components when the row
 * changes.
 *
 * This closes the "draft contract edits don't happen async" gap: one party
 * saving a draft used to sit invisible on the other party's screen until they
 * manually refreshed.
 *
 * router.refresh() is an RSC re-fetch, not a page reload — scroll position,
 * focus, the message list and any open panel all survive it.
 *
 * All four tables share one subscription and one debounce. Accepting an
 * application, for instance, writes a role, a member and a channel at once;
 * without coalescing that is three refreshes for one action.
 */
export function useProjectLive(projectId: string) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = browserDb();

    const refresh = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => router.refresh(), 250);
    };

    const filter = `project_id=eq.${projectId}`;

    const channel = supabase
      .channel(`tropical:project-state:${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tropical_role_contracts', filter },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tropical_deliverables', filter },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tropical_project_roles', filter },
        refresh,
      )
      .on(
        'postgres_changes',
        // tropical_project_escrows keys on project_id too, so the same filter
        // works — this is what unlocks the group channel live on funding.
        { event: '*', schema: 'public', table: 'tropical_project_escrows', filter },
        refresh,
      )
      .subscribe();

    return () => {
      if (pending.current) clearTimeout(pending.current);
      void supabase.removeChannel(channel);
    };
  }, [projectId, router]);
}
