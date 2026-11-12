import type { ProfileRef } from '@/modules/identity/types';

export type ProjectStatus = 'draft' | 'pending_payment' | 'active' | 'completed' | 'cancelled';
export type ProjectVisibility = 'public' | 'private' | 'both';

export type RoleStatus =
  | 'open'
  | 'invited'
  | 'accepted'
  | 'declined'
  | 'delivered'
  | 'approved'
  | 'released'
  | 'cancelled';

export type ChannelType = 'bot' | 'group' | 'dm';

/**
 * pot: one budget split across roles, funded once by escrow.
 * retainer: no pot; each role bills on its own schedule (migration 029).
 *
 * Read by every screen that would otherwise show a retainer a £0 budget and an
 * escrow banner for money that does not exist.
 */
export type ProjectKind = 'pot' | 'retainer';

export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'partially_released'
  | 'released'
  | 'refunded'
  | 'cancelled';

export interface ProjectRole {
  id: string;
  project_id: string;
  title: string;
  discipline_slug: string | null;
  /** 0–100, two decimal places. Share of the crew pool. */
  percentage: number;
  /** Pence. Snapshot at contract time — not derived from the live budget. */
  amount: number;
  assigned_user_id: string | null;
  status: RoleStatus;
  deliverables: string | null;
  deadline_date: string | null;
  sort_order: number;
}

export interface ProjectRoleWithAssignee extends ProjectRole {
  assignee: ProfileRef | null;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  member_role: 'brand' | 'creative';
  role_id: string | null;
}

export interface Channel {
  id: string;
  project_id: string;
  type: ChannelType;
  name: string;
  role_id: string | null;
}

export interface Project {
  id: string;
  brand_id: string;
  name: string;
  brief: string;
  /** Pence. The whole pot, inclusive of the platform fee. */
  budget: number;
  currency: string;
  visibility: ProjectVisibility;
  platform_fee_pct: number;
  status: ProjectStatus;
  kind: ProjectKind;
  deadline_date: string | null;
  created_at: string;
}

export interface ProjectEscrow {
  status: EscrowStatus;
  total_amount: number;
  platform_fee: number;
  funded_at: string | null;
}

/** Everything the workspace renders, fetched in ONE request. */
export interface Workspace extends Project {
  roles: ProjectRoleWithAssignee[];
  members: ProjectMember[];
  channels: Channel[];
  escrow: ProjectEscrow | null;
}

/** Project card data for the /projects grid. */
export interface ProjectCard {
  id: string;
  name: string;
  brief: string;
  budget: number;
  currency: string;
  status: ProjectStatus;
  created_at: string;
  roles: Array<{ id: string; status: RoleStatus; assignee: ProfileRef | null }>;
  escrowStatus: EscrowStatus | null;
  pendingApplications: number;
}

/** Sidebar tree entry. Deliberately narrow — the sidebar shows a name, a dot
 *  and a channel list, so budgets and briefs here would be dead RSC payload. */
export interface ProjectTreeNode {
  id: string;
  name: string;
  status: ProjectStatus;
  brand_id: string;
  channels: Array<{ id: string; type: ChannelType; name: string; role_id: string | null }>;
}

/**
 * Escrow is "paid" once the money has actually landed. Everything that locks
 * after payment — contract editing, member removal, project deletion — keys
 * off this one predicate so the rules cannot drift apart.
 *
 * Phase 4: in this reference build escrow funding is stubbed to always
 * refuse, so the status arm is the one that can actually make this true:
 * a project becomes 'active' when Cubora operations activates it for an
 * accepted negotiation (migration 056, activateProjectAction). The
 * predicate is unchanged; the transition that satisfies it is now the
 * Cubora operations decision, not a payment event.
 */
export function isEscrowPaid(project: {
  status: ProjectStatus;
  escrow?: ProjectEscrow | null;
}): boolean {
  if (project.status === 'active' || project.status === 'completed') return true;
  const s = project.escrow?.status;
  return s === 'funded' || s === 'partially_released' || s === 'released';
}

/** Where a request to delete an already-begun project has got to. */
export type DeleteRequestStatus = 'open' | 'approved' | 'rejected' | 'withdrawn';

/**
 * A brand asking for a project that has already begun to be removed.
 *
 * Once escrow is funded (a pot) or a card is saved (a retainer), the owner can
 * no longer delete the workspace out from under the people working in it —
 * every channel, message and contract cascades, and that record belongs to
 * both parties. They ask instead, and an admin decides. See migration 044.
 */
export interface ProjectDeleteRequest {
  id: string;
  projectId: string;
  status: DeleteRequestStatus;
  reason: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** One row in the admin deletion queue, with enough context to decide. */
export interface AdminDeleteRequest extends Omit<ProjectDeleteRequest, 'projectId'> {
  /** Null once the request was approved and the project deleted. */
  projectId: string | null;
  projectName: string;
  projectKind: ProjectKind;
  projectStatus: ProjectStatus;
  budget: number;
  currency: string;
  requestedByName: string | null;
  requestedByUsername: string | null;
  /** How many people are in the workspace that approving this would remove. */
  memberCount: number;
}
