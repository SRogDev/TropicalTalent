export type MessageKind =
  | 'text'
  | 'image'
  | 'document'
  | 'system'
  | 'contract'
  | 'escrow'
  | 'deliverable'
  | 'application';

export interface ChannelMessage {
  id: string;
  channel_id: string;
  project_id: string;
  /** null means Project Admin (the bot) authored it. */
  sender_id: string | null;
  kind: MessageKind;
  content: Record<string, unknown>;
  created_at: string;
}

/** One line of work the brand is buying. Project-level, not per role. */
export interface Deliverable {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  sort_order: number;
  updated_at: string;
}

export type ContractStatus = 'draft' | 'agreed' | 'locked';

export interface ContractTerms {
  scope: string;
  deliverables: string[];
  revisions: number;
  deadline: string | null;
  paymentTerms: string;
  notes: string;
}

/**
 * The per-role contract negotiated in that role's DM.
 *
 * `amount` is present only when the reader is entitled to it — the brand
 * always, the assigned talent for their own role. A talent reading another
 * role's contract never receives the field, because the query that populates
 * it filters on membership before the value leaves the server.
 */
export interface RoleContract {
  id: string;
  project_id: string;
  role_id: string;
  role_title: string;
  status: ContractStatus;
  terms: ContractTerms;
  amount: number | null;
  brand_accepted: boolean;
  creative_accepted: boolean;
  updated_at: string;
  updated_by: string | null;
}

export type DisputeCategory = 'scope' | 'payment' | 'quality' | 'deadline' | 'conduct' | 'other';
export type DisputeStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';

/**
 * The post-escrow complaint form's row, joined with enough context for the
 * admin queue to act on it without a second trip back to the project.
 */
export interface Dispute {
  id: string;
  project_id: string;
  project_name: string;
  role_title: string | null;
  raised_by_name: string | null;
  raised_by_username: string | null;
  category: DisputeCategory;
  detail: string;
  status: DisputeStatus;
  resolution: string | null;
  created_at: string;
}

export const EMPTY_TERMS: ContractTerms = {
  scope: '',
  deliverables: [],
  revisions: 2,
  deadline: null,
  paymentTerms: 'Released from escrow on approval of the delivered work.',
  notes: '',
};
