/**
 * The app's own origin.
 *
 * This was four byte-identical private copies — in escrow/actions.ts,
 * identity/actions.ts, notifications/email.ts and the former payment connect route — plus a
 * fifth variant in referrals/tiers.ts that fell back to a different hardcoded
 * host. They are the origin for payment provider return URLs, password-reset links and
 * every link in an outbound email, so a drift between them is a user landing
 * on the wrong domain mid-payment.
 *
 * It lives in lib/ rather than in a module because notifications/email.ts is
 * deliberately not a 'use server' file and so cannot import from the action
 * files that owned the other copies.
 *
 * White-label note: this resolves the PLATFORM origin. A request served on a
 * tenant's host must use that host instead — see modules/tenancy/urls.ts for
 * the per-request version. Anything reached by a signed-in user on a branded
 * domain should prefer the tenant one; this remains correct for the classic
 * app and for contexts with no request (cron, webhooks).
 */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

/**
 * The Terms of Use link moved to lib/legal.ts, which also carries the version
 * string written to tropical_terms_acceptances and the sub-processor list. A URL
 * and the version of the document behind it are one fact, and they were
 * drifting in two files.
 */
export { TERMS_URL } from './legal';
