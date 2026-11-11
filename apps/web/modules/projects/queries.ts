import 'server-only';

import { cache } from 'react';
import { db } from '@/lib/supabase';
import { one } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import type {
  ChannelType,
  ProjectCard,
  ProjectDeleteRequest,
  ProjectRoleWithAssignee,
  ProjectTreeNode,
  Workspace,
} from './types';

/**
 * Project reads.
 *
 * PostgREST resource embedding pulls a project with its roles, members,
 * channels, escrow and every assignee's profile in a single request. The
 * pattern this replaces did one query per project on the /projects grid — a
 * brand with eight projects paid eight full workspace loads to render eight
 * cards.
 */

const WORKSPACE_SELECT = `
  id, brand_id, name, brief, budget, currency, visibility,
  platform_fee_pct, status, kind, deadline_date, created_at,
  roles:tropical_project_roles(
    id, project_id, title, discipline_slug, percentage, amount,
    assigned_user_id, status, deliverables, deadline_date, sort_order,
    assignee:users!tropical_project_roles_assigned_user_id_fkey(id, username, name, avatar)
  ),
  members:tropical_project_members(project_id, user_id, member_role, role_id),
  channels:tropical_channels(id, project_id, type, name, role_id),
  escrow:tropical_project_escrows(status, total_amount, platform_fee, funded_at)
`;

/**
 * Everything the project workspace renders, in one request.
 *
 * Returns null when the project does not exist OR the caller cannot see it.
 * RLS makes those indistinguishable on purpose, so a non-member cannot probe
 * for the existence of a private project.
 */
export const loadWorkspace = cache(async (projectId: string): Promise<Workspace | null> => {
  const supabase = await db();

  const { data, error } = await supabase
    .from('tropical_projects')
    .select(WORKSPACE_SELECT)
    .eq('id', projectId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;

  return {
    id: row.id as string,
    brand_id: row.brand_id as string,
    name: row.name as string,
    brief: row.brief as string,
    budget: row.budget as number,
    currency: row.currency as string,
    visibility: row.visibility as Workspace['visibility'],
    platform_fee_pct: Number(row.platform_fee_pct),
    status: row.status as Workspace['status'],
    // Defaulted rather than asserted: `kind` arrived in 029 and every project
    // written before it is a pot, which is exactly what the column default
    // says too.
    kind: (row.kind as Workspace['kind']) ?? 'pot',
    deadline_date: (row.deadline_date as string | null) ?? null,
    created_at: row.created_at as string,
    roles: ((row.roles as Record<string, unknown>[]) ?? [])
      .map(normaliseRole)
      .sort((a, b) => a.sort_order - b.sort_order),
    members: (row.members as Workspace['members']) ?? [],
    channels: visibleChannels(
      (row.channels as Workspace['channels']) ?? [],
      (row.kind as Workspace['kind']) ?? 'pot',
    ),
    escrow: one(row.escrow as never) as Workspace['escrow'],
  };
});

/**
 * The channels a project actually offers.
 *
 * A retainer is one brand and one person, so its group channel is a room with
 * nobody in it that neither party has a reason to open — the DM already is the
 * conversation. tropical_create_retainer_project still creates the row, so this
 * is a display decision that can be reversed by deleting one line rather than
 * a schema change that would need a backfill to undo.
 *
 * Filtered here rather than in each component so every consumer agrees: the
 * workspace rail, the channel the page opens on, and the sidebar tree were
 * three separate places that each had to remember.
 */
function visibleChannels<T extends { type: ChannelType }>(
  channels: T[],
  kind: Workspace['kind'],
): T[] {
  return kind === 'retainer' ? channels.filter((c) => c.type !== 'group') : channels;
}

function normaliseRole(role: Record<string, unknown>): ProjectRoleWithAssignee {
  return {
    id: role.id as string,
    project_id: role.project_id as string,
    title: role.title as string,
    discipline_slug: (role.discipline_slug as string | null) ?? null,
    percentage: Number(role.percentage),
    amount: role.amount as number,
    assigned_user_id: (role.assigned_user_id as string | null) ?? null,
    status: role.status as ProjectRoleWithAssignee['status'],
    deliverables: (role.deliverables as string | null) ?? null,
    deadline_date: (role.deadline_date as string | null) ?? null,
    sort_order: (role.sort_order as number) ?? 0,
    assignee: one(role.assignee as never),
  };
}

/**
 * Projects the signed-in user belongs to, for the sidebar tree.
 *
 * RLS already restricts this to their own projects, so there is no membership
 * filter here — adding one would let a bug in the filter silently widen access
 * rather than narrow it.
 */
export const loadProjectTree = cache(async (): Promise<ProjectTreeNode[]> => {
  const viewer = await getViewer();
  if (!viewer) return [];

  const supabase = await db();
  const { data, error } = await supabase
    .from('tropical_projects')
    .select('id, name, status, brand_id, kind, channels:tropical_channels(id, type, name, role_id)')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return (data as unknown as Array<ProjectTreeNode & { kind: Workspace['kind'] }>).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    brand_id: row.brand_id,
    channels: visibleChannels(row.channels, row.kind ?? 'pot'),
  }));
});

/**
 * The brand's project grid — one query, not one per card.
 *
 * The pending-application count is embedded rather than counted client-side so
 * the "3 new applicants" badge does not cost a second round trip.
 */
export const loadBrandProjects = cache(async (brandId: string): Promise<ProjectCard[]> => {
  const supabase = await db();

  const { data, error } = await supabase
    .from('tropical_projects')
    .select(
      `
      id, name, brief, budget, currency, status, created_at,
      roles:tropical_project_roles(
        id, status,
        assignee:users!tropical_project_roles_assigned_user_id_fkey(id, username, name, avatar)
      ),
      escrow:tropical_project_escrows(status),
      applications:tropical_applications(id, status)
    `,
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    brief: row.brief as string,
    budget: row.budget as number,
    currency: row.currency as string,
    status: row.status as ProjectCard['status'],
    created_at: row.created_at as string,
    roles: ((row.roles as Record<string, unknown>[]) ?? []).map((r) => ({
      id: r.id as string,
      status: r.status as ProjectCard['roles'][number]['status'],
      assignee: one(r.assignee as never),
    })),
    escrowStatus:
      (one(row.escrow as never) as { status: ProjectCard['escrowStatus'] } | null)?.status ?? null,
    pendingApplications: ((row.applications as Array<{ status: string }>) ?? []).filter(
      (a) => a.status === 'pending',
    ).length,
  }));
});

/**
 * The workspace plus the viewer's standing in it.
 *
 * The two reads are independent, so they run concurrently rather than the
 * viewer lookup blocking the project load.
 */
export const loadProjectPage = cache(async (projectId: string) => {
  const [viewer, workspace] = await Promise.all([getViewer(), loadWorkspace(projectId)]);
  if (!viewer || !workspace) return null;

  const isBrand = workspace.brand_id === viewer.id;
  const myRole = workspace.roles.find((r) => r.assigned_user_id === viewer.id) ?? null;

  return { viewer, workspace, isBrand, myRole };
});

/**
 * Roles the signed-in talent holds, for "My jobs".
 */
export const loadMyRoles = cache(async (userId: string) => {
  const supabase = await db();

  const { data, error } = await supabase
    .from('tropical_project_roles')
    .select(
      `
      id, title, percentage, amount, status, deadline_date, deliverables,
      pay_model, activated_at,
      project:tropical_projects!tropical_project_roles_project_id_fkey(
        id, name, brief, status, currency, deadline_date, budget, kind
      ),
      contract:tropical_role_contracts!tropical_role_contracts_role_id_fkey(
        status, brand_accepted, creative_accepted
      )
    `,
    )
    .eq('assigned_user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    percentage: Number(row.percentage),
    amount: row.amount as number,
    status: row.status as ProjectRoleWithAssignee['status'],
    deadline_date: (row.deadline_date as string | null) ?? null,
    deliverables: (row.deliverables as string | null) ?? null,
    pay_model: (row.pay_model as 'fixed' | 'recurring' | null) ?? 'fixed',
    activated_at: (row.activated_at as string | null) ?? null,
    project: one(row.project as never) as {
      id: string;
      name: string;
      brief: string;
      status: string;
      currency: string;
      deadline_date: string | null;
      budget: number;
      kind: Workspace['kind'];
    } | null,
    contract: one(row.contract as never) as {
      status: 'draft' | 'agreed' | 'locked';
      brand_accepted: boolean;
      creative_accepted: boolean;
    } | null,
  }));
});

/**
 * The caller's own most recent request to have this project removed.
 *
 * Read through their session, so 044's read policy (`requested_by = auth.uid()`)
 * is what scopes it — a talent on the project gets nothing, which is right:
 * whether their client has asked to delete the workspace is a conversation to
 * have, not a banner to discover.
 *
 * Most recent rather than only-open, because "declined last week" is the thing
 * the settings panel most needs to say before offering the button again.
 */
export const loadDeleteRequest = cache(
  async (projectId: string): Promise<ProjectDeleteRequest | null> => {
    const supabase = await db();
    const { data } = await supabase
      .from('tropical_project_delete_requests')
      .select('id, project_id, status, reason, resolution, created_at, resolved_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    return {
      id: data.id as string,
      projectId: data.project_id as string,
      status: data.status as ProjectDeleteRequest['status'],
      reason: (data.reason as string | null) ?? null,
      resolution: (data.resolution as string | null) ?? null,
      createdAt: data.created_at as string,
      resolvedAt: (data.resolved_at as string | null) ?? null,
    };
  },
);
