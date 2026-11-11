'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useSelectedLayoutSegments } from 'next/navigation';
import { Bot, Check, ChevronDown, ChevronRight, Hash, Lock, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectTreeNode } from '@/modules/projects/types';

/**
 * Projects and their channels in the sidebar.
 *
 * Status is a coloured dot rather than a word — a project's state is glanceable
 * at a dot but not at a label repeated down a list.
 *
 * The active project/channel is derived from the router here rather than
 * passed down from each page. That is what lets the shell be a layout: a page
 * no longer has to tell the sidebar where it is.
 */

const CHANNEL_ORDER: Record<string, number> = { bot: 0, group: 1, dm: 2 };

export function ProjectTree({
  projects,
  collapsed,
  unreadByChannel = {},
}: {
  projects: ProjectTreeNode[];
  collapsed: boolean;
  /** channel id -> unread count. */
  unreadByChannel?: Record<string, number>;
}) {
  const segments = useSelectedLayoutSegments();
  const searchParams = useSearchParams();

  // /projects/<id> renders as ['projects', '<id>'].
  const activeProjectId = segments[0] === 'projects' ? segments[1] : undefined;
  const activeChannelId = searchParams.get('channel') ?? undefined;

  const [open, setOpen] = useState<Record<string, boolean>>({});

  /** Unread across a project's channels, for the collapsed rail and the row. */
  const projectUnread = (project: ProjectTreeNode) =>
    project.channels.reduce((sum, c) => sum + (unreadByChannel[c.id] ?? 0), 0);

  if (collapsed) {
    // The rail keeps the projects reachable without the tree: one tile each,
    // with a dot when something in it has moved.
    if (projects.length === 0) return <div className='flex-1' />;
    return (
      <div className='flex-1 space-y-1 px-2'>
        {projects.slice(0, 8).map((project) => {
          const unread = projectUnread(project);
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              title={unread > 0 ? `${project.name} - ${unread} unread` : project.name}
              className={cn(
                'relative grid h-9 w-full place-items-center rounded-lg text-[11px] font-semibold transition',
                project.id === activeProjectId
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                unread > 0 && 'text-foreground',
              )}
            >
              {initials(project.name)}
              {unread > 0 && (
                <span className='bg-accent absolute top-1 right-1 h-2 w-2 rounded-full' />
              )}
            </Link>
          );
        })}
      </div>
    );
  }

  if (projects.length === 0) {
    return <p className='text-muted-foreground/70 flex-1 px-5 py-4 text-xs'>No projects yet.</p>;
  }

  return (
    <div className='flex-1 space-y-1 overflow-y-auto px-2 pb-4'>
      {projects.map((project) => {
        const expanded = open[project.id] ?? project.id === activeProjectId;
        const unfunded = project.status === 'pending_payment' || project.status === 'draft';
        const unread = projectUnread(project);

        return (
          <div key={project.id}>
            <button
              type='button'
              onClick={() => setOpen((o) => ({ ...o, [project.id]: !expanded }))}
              className='text-foreground/90 hover:bg-foreground/5 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm'
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span
                className={cn(
                  'flex-1 truncate text-left',
                  unread > 0 ? 'text-foreground font-semibold' : 'font-medium',
                )}
              >
                {project.name}
              </span>
              {/* Collapsed, the count is the only signal that something inside
                  has moved — so it survives the row being shut. */}
              {unread > 0 && !expanded && (
                <span className='bg-accent text-accent-foreground shrink-0 rounded-full px-1.5 text-[9px] font-semibold'>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
              {/* A dot reads as "state" for everything still in motion, but
                  "done" deserves a clearer glyph than a colour a passer-by
                  has to learn — so completed is the one status that gets an
                  icon instead of the dot, same slot, same size. */}
              {project.status === 'completed' ? (
                <Check size={11} className='text-status-complete shrink-0' aria-label='Completed' />
              ) : (
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(project.status)}`}
                  title={project.status.replace('_', ' ')}
                />
              )}
            </button>

            {expanded && (
              // Channels only. An "Overview" entry used to sit here, linking to
              // /projects/<id> with no channel — which just falls through to
              // the default channel, i.e. the first link in this very list.
              // There is no overview screen; the workspace is the project.
              <div className='border-foreground/10 mt-1 ml-3 space-y-0.5 border-l pl-3'>
                {[...project.channels]
                  .sort(
                    (a, b) =>
                      (CHANNEL_ORDER[a.type] ?? 9) - (CHANNEL_ORDER[b.type] ?? 9) ||
                      a.name.localeCompare(b.name),
                  )
                  .map((channel) => {
                    const Icon =
                      channel.type === 'bot'
                        ? Bot
                        : channel.type === 'group'
                          ? Hash
                          : MessageCircle;
                    const isLocked = channel.type === 'group' && unfunded;
                    const isActive =
                      channel.id === activeChannelId && project.id === activeProjectId;
                    // The channel you are looking at is read by definition —
                    // don't badge it while the user is sitting in it.
                    const channelUnread = isActive ? 0 : (unreadByChannel[channel.id] ?? 0);

                    return (
                      <Link
                        key={channel.id}
                        href={`/projects/${project.id}?channel=${channel.id}`}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition',
                          isActive
                            ? 'bg-foreground/10 text-foreground'
                            : channelUnread > 0
                              ? 'text-foreground hover:bg-foreground/[0.04] font-semibold'
                              : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                        )}
                      >
                        <Icon size={12} className={channel.type === 'bot' ? 'text-accent' : ''} />
                        <span className='flex-1 truncate text-left'>{channel.name}</span>
                        {channelUnread > 0 && (
                          <span className='bg-accent h-1.5 w-1.5 shrink-0 rounded-full' />
                        )}
                        {isLocked && <Lock size={10} className='text-status-pending' />}
                      </Link>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
