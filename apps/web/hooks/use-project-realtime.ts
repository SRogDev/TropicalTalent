'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase-browser';
import type { ChannelMessage } from '@/modules/chat/types';

/**
 * ONE realtime subscription per project.
 *
 * The chat this replaces opened a subscription per conversation, so a user in
 * a project with an admin channel, a group channel and six DMs held eight
 * websocket subscriptions — eight connection setups, and eight reconnect
 * storms on a flaky network.
 *
 * Here a single subscription is filtered on project_id and fans messages out
 * to the right channel in memory. Switching channels in the UI is then a state
 * read with zero network cost.
 *
 * RLS applies to realtime, so the server only sends rows this user may see. A
 * locked group channel emits nothing until escrow is funded, and the Project
 * Admin channel emits nothing to a talent.
 */

interface Options {
  projectId: string;
  /** Server-rendered messages keyed by channel id. Seeds the store so the
   *  first paint needs no client fetch. */
  initialMessages: Record<string, ChannelMessage[]>;
  currentUserId: string;
}

export interface ProjectRealtime {
  getMessages: (channelId: string) => ChannelMessage[];
  sendMessage: (channelId: string, text: string) => Promise<void>;
  connected: boolean;
}

export function useProjectRealtime({
  projectId,
  initialMessages,
  currentUserId,
}: Options): ProjectRealtime {
  const [messagesByChannel, setMessagesByChannel] =
    useState<Record<string, ChannelMessage[]>>(initialMessages);
  const [connected, setConnected] = useState(false);

  /**
   * Ids this client has already applied.
   *
   * The message id is generated on the CLIENT and sent with the insert, so the
   * optimistic row, the insert response and the realtime echo all share one
   * id. That removes a race: realtime can deliver the INSERT before insert()
   * returns, and any scheme that reconciles on a server-assigned id renders
   * the message twice when it does. This is the duplication fix.
   */
  const seenIds = useRef<Set<string>>(new Set());

  // Seeded once. Re-running this on every `initialMessages` identity change
  // (which a server re-render produces) is harmless for correctness but the
  // ref is the only thing that needs it, so it is cheap either way.
  useEffect(() => {
    for (const list of Object.values(initialMessages)) {
      for (const message of list) seenIds.current.add(message.id);
    }
  }, [initialMessages]);

  // A server re-render (router.refresh() after an action) brings authoritative
  // messages. Merge rather than replace, so anything realtime delivered in the
  // meantime is not dropped.
  useEffect(() => {
    setMessagesByChannel((prev) => {
      const next: Record<string, ChannelMessage[]> = { ...prev };
      for (const [channelId, list] of Object.entries(initialMessages)) {
        const existing = next[channelId] ?? [];
        const byId = new Map(existing.map((m) => [m.id, m]));
        for (const message of list) byId.set(message.id, message);
        next[channelId] = Array.from(byId.values()).sort(byCreatedAt);
      }
      return next;
    });
  }, [initialMessages]);

  const applyIncoming = useCallback((message: ChannelMessage) => {
    if (seenIds.current.has(message.id)) return;
    seenIds.current.add(message.id);

    setMessagesByChannel((prev) => ({
      ...prev,
      [message.channel_id]: [...(prev[message.channel_id] ?? []), message].sort(byCreatedAt),
    }));
  }, []);

  useEffect(() => {
    const supabase = browserDb();

    const channel = supabase
      .channel(`tropical:project:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tropical_channel_messages',
          filter: `project_id=eq.${projectId}`,
        },
        (payload: { new: unknown }) => applyIncoming(payload.new as ChannelMessage),
      )
      .subscribe((status: string) => setConnected(status === 'SUBSCRIBED'));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, applyIncoming]);

  const sendMessage = useCallback(
    async (channelId: string, text: string) => {
      const body = text.trim();
      if (!body) return;

      const id = crypto.randomUUID();
      const optimistic: ChannelMessage = {
        id,
        channel_id: channelId,
        project_id: projectId,
        sender_id: currentUserId,
        kind: 'text',
        content: { text: body },
        created_at: new Date().toISOString(),
      };

      // Render immediately, and mark it seen so the echo is a no-op.
      seenIds.current.add(id);
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: [...(prev[channelId] ?? []), optimistic],
      }));

      const { error } = await browserDb()
        .from('tropical_channel_messages')
        .insert({
          id,
          channel_id: channelId,
          project_id: projectId,
          sender_id: currentUserId,
          kind: 'text',
          content: { text: body },
        });

      if (error) {
        // Roll the optimistic message back out rather than leaving something
        // on screen that no one else can see.
        seenIds.current.delete(id);
        setMessagesByChannel((prev) => ({
          ...prev,
          [channelId]: (prev[channelId] ?? []).filter((m) => m.id !== id),
        }));
        throw error;
      }
    },
    [projectId, currentUserId],
  );

  const getMessages = useCallback(
    (channelId: string) => messagesByChannel[channelId] ?? [],
    [messagesByChannel],
  );

  return useMemo(
    () => ({ getMessages, sendMessage, connected }),
    [getMessages, sendMessage, connected],
  );
}

function byCreatedAt(a: ChannelMessage, b: ChannelMessage): number {
  // Ties break on id so the order is stable when two messages land in the same
  // millisecond — otherwise a re-sort can visibly swap them.
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}
