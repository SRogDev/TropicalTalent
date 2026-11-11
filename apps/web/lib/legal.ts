/**
 * The legal documents, and which version of them is current.
 *
 * One source of truth for three things that were drifting apart: where the
 * documents live, what we call the version a person accepted, and what the
 * sub-processor page has to list.
 *
 * The URL was declared twice — once here (as lib/urls.ts:TERMS_URL) and again
 * as a private const in components/waitlist/sign-up-dialog.tsx. Two copies of
 * a link that appears next to a tick-box is exactly the drift worth removing:
 * the day the terms move to a hosted page, one of them would have been left
 * pointing at a Google Doc.
 *
 * ---------------------------------------------------------------------------
 * On the version strings
 * ---------------------------------------------------------------------------
 * These are what get written to tropical_terms_acceptances, so they are evidence
 * rather than decoration. Bump the version WHENEVER the document changes in a
 * way that affects anyone's rights — and when you do, existing users have not
 * accepted the new one, which is the whole point of recording it per version.
 */

export const TERMS_URL =
  'https://docs.google.com/document/d/1ZV3XhkOoeUVdl-RD8J-BmOvh14jQuRz22g2DZCX8zAA/edit?usp=sharing';

export const PRIVACY_URL =
  'https://docs.google.com/document/d/1jwmtE0g2qHXTshWXDm-V0V_fTsxurweFd196xujCd8w/edit?usp=sharing';

/** Bump on any change that affects a user's rights. See the note above. */
export const TERMS_VERSION = '2026-08-01';
export const PRIVACY_VERSION = '2026-08-01';

/**
 * Everyone who processes personal data on our behalf.
 *
 * Published at /sub-processors, and named in the privacy policy, because
 * "third-party service providers" is not a disclosure — and because a
 * white-label customer's procurement will ask for exactly this list.
 *
 * Kept beside the CSP allowlist in next.config.mjs in spirit: if a new origin
 * appears there, it almost certainly belongs here too.
 */
export interface SubProcessor {
  name: string;
  purpose: string;
  region: string;
  privacyUrl: string;
  /** True where they decide their own purposes too, not only ours. */
  independentController?: boolean;
}

export const SUB_PROCESSORS: SubProcessor[] = [
  {
    name: 'Supabase',
    purpose: 'Database, authentication, file storage and realtime messaging.',
    region: 'See the note below',
    privacyUrl: 'https://supabase.com/privacy',
  },
  {
    name: 'Vercel',
    purpose: 'Application hosting and content delivery.',
    region: 'Global edge network; primary region below',
    privacyUrl: 'https://vercel.com/legal/privacy-policy',
  },
  {
    name: 'Resend',
    purpose: 'Sending service and marketing email.',
    region: 'US',
    privacyUrl: 'https://resend.com/legal/privacy-policy',
  },
  {
    name: 'Google',
    purpose: 'Sign-in, where you choose to use a Google account.',
    region: 'Global',
    privacyUrl: 'https://policies.google.com/privacy',
    independentController: true,
  },
  {
    name: 'YouTube and Vimeo',
    purpose:
      'Showreel playback. Nothing loads from either until you press play, so neither sets a cookie before then.',
    region: 'Global',
    privacyUrl: 'https://policies.google.com/privacy',
    independentController: true,
  },
];

/**
 * Where the data actually lives.
 *
 * Named here rather than written into the privacy policy prose because both
 * the policy and /sub-processors have to say the same thing, and because a
 * vague answer to "which region" is the one thing a procurement review will
 * not accept.
 *
 * NOT derivable from NEXT_PUBLIC_SUPABASE_URL — the project ref in that
 * hostname does not encode a region. Read it off the Supabase dashboard
 * (Project Settings -> General -> Region) and the Vercel project's region,
 * and put the answers here.
 */
export const HOSTING_REGIONS = {
  data: '[CONFIRM: your Supabase project region]',
  app: '[CONFIRM: your Vercel region]',
} as const;
