import 'server-only';

import { cache } from 'react';
import { adminDb, db } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { requireAdminScope } from '@/modules/admin/queries';
import type { ChannelMessage, ContractTerms, Deliverable, Dispute, RoleContract } from './types';
import { EMPTY_TERMS } from './types';

/**
 * Channel, message, deliverable and contract reads.
 *
 * Access control lives entirely in RLS. The bot channel ("Project Admin") is
 * brand-only, the group channel opens when the project is active or
 * completed, and a DM is visible only to the brand and the talent holding
 * that role. Nothing here re-implements those checks — a query that returns
 * no rows is the enforcement working.
 *
 * Phase 4: a project becomes active when Cubora operations activates it
 * for an accepted negotiation (migration 056, activateProjectAction) —
 * NOT when escrow is funded. Escrow funding is stubbed to always refuse
 * in this reference build, so the old "locked until escrow is funded"
 * reading of the group channel could never unlock (audit §4.1); the
 * channel rule itself (status active/completed) is unchanged, the
 * transition that satisfies it is now the operations decision.
 */

export const MESSAGES_PAGE_SIZE = 60;

/**
 * The most recent messages in a channel, oldest-first for rendering.
 *
 * Fetched newest-first so the (channel_id, created_at DESC) index is used and
 * the LIMIT stops early, then reversed in memory. Ordering ascending in SQL
 * would make Postgres sort the whole channel before applying the limit.
 */
export const loadChannelMessages = cache(
  async (channelId: string, before?: string): Promise<ChannelMessage[]> => {
    const supabase = await db();

    let query = supabase
      .from('tropical_channel_messages')
      .select('id, channel_id, project_id, sender_id, kind, content, created_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(MESSAGES_PAGE_SIZE);

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error || !data) return [];
    return (data as unknown as ChannelMessage[]).reverse();
  },
);

/**
 * Every channel's messages for a project, in ONE query.
 *
 * The workspace hands all channels to the client up front so switching
 * channels is a state read with no request behind it. Fetching per channel —
 * even concurrently — meant one round trip per channel just to open a project
 * with a bot channel, a group channel and six DMs.
 *
 * The cap is a whole-project budget rather than a per-channel one. A project
 * that exceeds it pages the active channel with `loadChannelMessages`.
 */
export const loadProjectMessages = cache(
  async (projectId: string): Promise<Record<string, ChannelMessage[]>> => {
    const supabase = await db();

    const { data, error } = await supabase
      .from('tropical_channel_messages')
      .select('id, channel_id, project_id, sender_id, kind, content, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(MESSAGES_PAGE_SIZE * 6);

    if (error || !data) return {};

    const byChannel: Record<string, ChannelMessage[]> = {};
    // Rows arrive newest-first; unshift rebuilds each channel oldest-first
    // without a second sort pass.
    for (const message of data as unknown as ChannelMessage[]) {
      (byChannel[message.channel_id] ??= []).unshift(message);
    }
    return byChannel;
  },
);

/**
 * Unread message count per channel.
 *
 * `projectId` omitted means every project the viewer belongs to — one call for
 * the whole sidebar rather than one per project.
 *
 * Returns a plain object rather than a Map so it can cross the server/client
 * boundary in an RSC payload without serialising to `{}`.
 */
export const loadUnreadCounts = cache(
  async (projectId?: string): Promise<Record<string, number>> => {
    const supabase = await db();
    const { data, error } = await supabase.rpc('tropical_unread_counts', {
      p_project: projectId ?? null,
    });

    if (error || !data) return {};

    return Object.fromEntries(
      (data as Array<{ channel_id: string; unread: number }>).map((row) => [
        row.channel_id,
        Number(row.unread) || 0,
      ]),
    );
  },
);

/** The project's deliverables, in display order. */
export const loadDeliverables = cache(async (projectId: string): Promise<Deliverable[]> => {
  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_deliverables')
    .select('id, project_id, title, description, due_date, sort_order, updated_at')
    .eq('project_id', projectId)
    .order('sort_order');

  if (error || !data) return [];
  return data as Deliverable[];
});

/**
 * The per-role draft contracts for a project.
 *
 * `amount` is stripped for anyone who should not see it. RLS restricts the
 * rows themselves to the brand and the role's talent, but a talent IS a
 * member and so can read the contract row for their own role — the filter here
 * is what stops another member's fee appearing in a payload they can reach.
 *
 * See also: the brand always sees every amount; that is the point of the
 * contract panel.
 */
export const loadRoleContracts = cache(
  async (projectId: string, viewerId: string, isBrand: boolean): Promise<RoleContract[]> => {
    const supabase = await db();

    const { data, error } = await supabase
      .from('tropical_role_contracts')
      .select(
        `
        id, project_id, role_id, status, terms, brand_accepted, creative_accepted,
        updated_at, updated_by,
        role:tropical_project_roles!tropical_role_contracts_role_id_fkey(
          title, amount, assigned_user_id
        )
      `,
      )
      .eq('project_id', projectId);

    if (error || !data) return [];

    return (data as unknown as Record<string, unknown>[]).map((row) => {
      const role = one(row.role as never) as {
        title?: string;
        amount?: number;
        assigned_user_id?: string | null;
      } | null;

      const maySeeAmount = isBrand || role?.assigned_user_id === viewerId;

      return {
        id: row.id as string,
        project_id: row.project_id as string,
        role_id: row.role_id as string,
        role_title: role?.title ?? 'Role',
        status: row.status as RoleContract['status'],
        terms: normaliseTerms(row.terms),
        amount: maySeeAmount ? (role?.amount ?? null) : null,
        brand_accepted: Boolean(row.brand_accepted),
        creative_accepted: Boolean(row.creative_accepted),
        updated_at: row.updated_at as string,
        updated_by: (row.updated_by as string | null) ?? null,
      };
    });
  },
);

/**
 * The complaints queue for whoever is asking, scoped to the site they are on.
 *
 * The normal RLS policy on tropical_disputes only lets a reader see their own
 * complaint or (as the brand) one raised on their project; there is no row a
 * non-party is allowed to read. An admin queue needs the opposite, so this
 * goes through adminDb() rather than asking for a policy that would let any
 * signed-in "admin" row read every dispute directly over PostgREST — which
 * makes the guard here the only thing standing between this query and every
 * user's complaint history.
 *
 * ---------------------------------------------------------------------------
 * Two things this used to get wrong
 * ---------------------------------------------------------------------------
 * It gated on `viewer.role !== 'admin'`, so a white-label's own admin — who
 * reaches /admin/complaints perfectly legitimately — got an empty list rather
 * than their customers' complaints.
 *
 * And it applied no tenant filter at all, so a TropicalTalent super admin standing on
 * acme.tropicaltalent.dev/admin/complaints read every OTHER tenant's disputes too. That
 * contradicts the rule requireAdminScope() states out loud ("A super admin
 * visiting acme.tropicaltalent.dev/admin sees ACME's console"), and it is a customer
 * reading another customer's grievances.
 *
 * requireAdminScope() answers both questions at once, and is the only place in
 * the codebase allowed to. It throws for a caller who is neither, which is why
 * this is wrapped rather than checked inline — the page renders an empty queue
 * instead of a stack trace.
 */
export const loadAllDisputes = cache(async (): Promise<Dispute[]> => {
  let tenantId: string | null;
  try {
    ({ tenantId } = await requireAdminScope());
  } catch {
    return [];
  }

  const supabase = adminDb();

  // The embed is written inline rather than shared, and `!inner` is
  // load-bearing: a left join keeps disputes whose project did not match the
  // tenant, which is precisely the set this filter exists to remove.
  let query = supabase
    .from('tropical_disputes')
    .select(
      `
      id, project_id, category, detail, status, resolution, created_at,
      project:tropical_projects!inner!tropical_disputes_project_id_fkey(name, tenant_id),
      role:tropical_project_roles!tropical_disputes_role_id_fkey(title),
      raised_by_user:users!tropical_disputes_raised_by_fkey(name, username)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(500);

  // null means unscoped — a super admin on the classic host, the one caller
  // entitled to the cross-tenant queue.
  if (tenantId) query = query.eq('project.tenant_id', tenantId);

  const { data, error } = await query;

  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[]).map((row) => {
    const project = one(row.project as never) as { name?: string } | null;
    const role = one(row.role as never) as { title?: string } | null;
    const raisedBy = one(row.raised_by_user as never) as {
      name?: string | null;
      username?: string | null;
    } | null;

    return {
      id: row.id as string,
      project_id: row.project_id as string,
      project_name: project?.name ?? 'Unknown project',
      role_title: role?.title ?? null,
      raised_by_name: raisedBy?.name ?? null,
      raised_by_username: raisedBy?.username ?? null,
      category: row.category as Dispute['category'],
      detail: row.detail as string,
      status: row.status as Dispute['status'],
      resolution: (row.resolution as string | null) ?? null,
      created_at: row.created_at as string,
    };
  });
});

/** Fills in fields a contract written by an older version of the form omitted. */
function normaliseTerms(value: unknown): ContractTerms {
  const raw = (value ?? {}) as Partial<ContractTerms>;
  return {
    scope: typeof raw.scope === 'string' ? raw.scope : EMPTY_TERMS.scope,
    deliverables: Array.isArray(raw.deliverables)
      ? raw.deliverables.filter((d): d is string => typeof d === 'string')
      : [],
    revisions: typeof raw.revisions === 'number' ? raw.revisions : EMPTY_TERMS.revisions,
    deadline: typeof raw.deadline === 'string' ? raw.deadline : null,
    paymentTerms:
      typeof raw.paymentTerms === 'string' ? raw.paymentTerms : EMPTY_TERMS.paymentTerms,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}
