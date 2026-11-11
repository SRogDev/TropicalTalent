import type { RoleStatus, ProjectStatus } from '@/modules/projects/types';

/**
 * A row from `tropical_public_briefs`.
 *
 * Deliberately has no percentage or amount fields — non-members see the total
 * pot and the role titles, never the split. The view is what enforces that;
 * this type exists so the compiler enforces it too.
 */
export interface PublicBrief {
  id: string;
  brand_id: string;
  name: string;
  brief: string;
  budget: number;
  currency: string;
  status: ProjectStatus;
  deadline_date: string | null;
  created_at: string;
  brand_username: string | null;
  brand_name: string | null;
  brand_avatar: string | null;
  total_roles: number;
  open_roles: number;
  roles: Array<{
    id: string;
    title: string;
    discipline: string | null;
    status: RoleStatus;
  }>;
}

export type ApplicationStatus =
  /** Waiting on the brand. */
  | 'pending'
  /** Submitted for a role the talent does not yet list the skill for. Held
   *  until they add it; released automatically when they do. */
  | 'pending_skill'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

/** The talent's own view of an application — no money in it. */
export interface MyApplication {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  note: string | null;
  required_discipline: string | null;
  project_id: string;
  project_name: string;
  project_brief: string;
  project_status: ProjectStatus;
  project_deadline: string | null;
  brand_name: string | null;
  brand_username: string | null;
  brand_avatar: string | null;
  role_id: string;
  role_title: string;
  role_status: RoleStatus;
}

/** The brand's view of who applied, with enough profile to decide. */
export interface Applicant {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  note: string | null;
  role_id: string;
  role_title: string;
  user: {
    id: string;
    username: string | null;
    name: string | null;
    avatar: string | null;
    bio: string | null;
    passion: string | null;
    tags: string[];
    showreelUrl: string | null;
    disciplines: string[];
    jobsDone: number;
  };
}
