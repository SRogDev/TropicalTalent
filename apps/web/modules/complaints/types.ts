/**
 * Complaint domain types.
 *
 * Client-safe: no server imports, so the profile form and the admin row may
 * both take these as props.
 */

/**
 * What the person is telling us.
 *
 * `report_user` is the only one that carries a subject, and the CHECK
 * constraint in migration 041 enforces that rather than trusting the form.
 */
export type ComplaintCategory = 'report_user' | 'report_bug' | 'general_enquiry' | 'other';

export type ComplaintStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';

/**
 * The picker's copy, in one place, so the form, the admin queue and the
 * notification email all name a category the same way.
 *
 * Ordered as the form shows them: the two that need acting on first, then the
 * two that are conversation.
 */
export const COMPLAINT_CATEGORIES: Array<{
  value: ComplaintCategory;
  label: string;
  hint: string;
}> = [
  {
    value: 'report_user',
    label: 'Report a user',
    hint: 'Conduct, spam, impersonation, or anything that felt unsafe.',
  },
  {
    value: 'report_bug',
    label: 'Report a bug',
    hint: 'Something is broken or behaving oddly.',
  },
  {
    value: 'general_enquiry',
    label: 'General enquiry',
    hint: 'A question about your account, a project, or a payment.',
  },
  {
    value: 'other',
    label: 'Something else',
    hint: "Anything that doesn't fit the three above.",
  },
];

export function complaintCategoryLabel(value: ComplaintCategory): string {
  return COMPLAINT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** One row in the admin queue. */
export interface ComplaintRow {
  id: string;
  category: ComplaintCategory;
  status: ComplaintStatus;
  detail: string | null;
  resolution: string | null;
  createdAt: string;
  raisedByName: string | null;
  raisedByUsername: string | null;
  /** Populated only for `report_user`. */
  subjectName: string | null;
  subjectUsername: string | null;
}
