/**
 * The four canned re-engagement/outreach emails the admin dashboard can send.
 *
 * Pure data, no imports — safe on the client (the comms panel renders the
 * subject/body as a preview before sending) and on the server (the action
 * looks the chosen one up by id rather than trusting a subject/body the
 * client posted).
 */

export type BroadcastTemplateId = 'inactivity' | 'pulse_check' | 'creative_audit' | 'brand_audit';

export interface BroadcastTemplate {
  id: BroadcastTemplateId;
  label: string;
  /** Who this is written for — 'all' means no role restriction. */
  audience: 'all' | 'creative' | 'brand';
  subject: string;
  body: string;
}

export const BROADCAST_TEMPLATES: BroadcastTemplate[] = [
  {
    id: 'inactivity',
    label: 'Inactivity nudge',
    audience: 'all',
    subject: 'We miss you at TropicalTalent',
    body: "Hey, we noticed you haven't logged into TropicalTalent in a while. Our most active members log in weekly and tend to get the most out of it. If there's anything we can do to improve your experience, just reply and let us know.",
  },
  {
    id: 'pulse_check',
    label: 'Pulse check',
    audience: 'all',
    subject: 'Your TropicalTalent pulse check',
    body: "There's exciting activity happening on TropicalTalent right now. Log in to see what's new.",
  },
  {
    id: 'creative_audit',
    label: 'Creative portfolio audit',
    audience: 'creative',
    subject: 'A free portfolio audit, on us',
    body: "You're invited to a complimentary creative director audit of your portfolio. Reply yes to this email and we'll reach out with the details.",
  },
  {
    id: 'brand_audit',
    label: 'Brand profile audit',
    audience: 'brand',
    subject: 'A free brand audit, on us',
    body: "You're invited to a complimentary audit of your brand profile, plus direct intros to creatives in your location. Reply yes to this email and we'll reach out with the details.",
  },
];
