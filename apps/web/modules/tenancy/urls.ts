import 'server-only';

import { headers } from 'next/headers';
import { cache } from 'react';
import { adminDb } from '@/lib/supabase';
import { siteUrl } from '@/lib/urls';

/**
 * The origin to build links against, for the request being served.
 *
 * lib/urls.ts returns the PLATFORM origin from an env var, which is right for
 * anything with no request behind it — a cron, a webhook, a payment provider return URL
 * built server-side for the classic app. It is wrong for anything a
 * white-label's user will click.
 *
 * The failure it causes is not subtle. A password reset requested on
 * acme.tropicaltalent.dev whose link points at tropicaltalent.dev drops a customer's
 * contractor onto a brand they have never seen, and the token was issued for a
 * different origin so it does not work either.
 *
 * ---------------------------------------------------------------------------
 * This is only half the fix
 * ---------------------------------------------------------------------------
 * Supabase silently REWRITES any redirect that is not on its allowlist back to
 * the project's Site URL. So a correct URL here still lands on the classic
 * domain until `https://*.tropicaltalent.dev/**` (and each custom domain) is added under
 * Authentication → URL Configuration → Redirect URLs. See
 * docs/white-label-runbook.md.
 */
export async function requestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return siteUrl();

    // Behind a proxy the original scheme is only in the forwarded header; a
    // local host is http. Anything else is https — a tenant domain served over
    // plain http is a misconfiguration, not a case to support.
    const proto =
      h.get('x-forwarded-proto') ??
      (host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.includes('.localhost')
        ? 'http'
        : 'https');

    // A proxy chain sets a comma-separated list; the first entry is the client
    // -facing one. `new URL()` accepts "a.com, b.com" as a hostname and builds
    // a link nobody can follow, so this is not cosmetic.
    return `${first(proto)}://${first(host)}`;
  } catch {
    // No request context — a cron or a build step. The platform origin is the
    // only sensible answer there.
    return siteUrl();
  }
}

/** An absolute URL on the requesting host. */
export async function requestUrl(path: string): Promise<string> {
  const origin = await requestOrigin();
  return new URL(path, origin).toString();
}

/**
 * The origin for a TENANT, with no request needed.
 *
 * requestOrigin() answers "which site is this person looking at", which is the
 * right question for anything a user just triggered. It is the wrong question
 * — and returns the wrong answer — for work that runs without a browser in
 * front of it:
 *
 *   * the weekly check-in and the recurring pay run are Vercel crons, so the
 *     Host header is the deployment's own and resolves to classic
 *   * a payment provider webhook arrives on whatever host payment provider was configured with
 *
 * Both send email. Before this, every one of those emails linked a white-label
 * contractor to tropicaltalent.dev — a domain they have never signed in to,
 * where the link 404s or bounces them to /auth/no-access.
 *
 * Falls back to the platform origin for the classic tenant, for a tenant whose
 * domain row has not been created yet, and for any lookup failure. That
 * fallback is the pre-existing behaviour, so this can only ever improve a
 * link, never break one that worked.
 */
export const tenantOrigin = cache(async (tenantId: string | null): Promise<string> => {
  if (!tenantId) return siteUrl();

  try {
    const { data } = await adminDb()
      .from('tropical_tenant_domains')
      .select('host, is_primary')
      .eq('tenant_id', tenantId);

    const rows = data ?? [];
    if (rows.length === 0) return siteUrl();

    // is_primary is the host the customer wants to appear in outbound links —
    // the runbook says so explicitly. Any host is better than the wrong brand,
    // so an unset flag falls through to the first row rather than to classic.
    const host = (rows.find((d) => d.is_primary) ?? rows[0]).host as string;
    if (!host) return siteUrl();

    const local = host.startsWith('localhost') || host.includes('.localhost');
    return `${local ? 'http' : 'https'}://${host}`;
  } catch {
    return siteUrl();
  }
});

/** An absolute URL on a tenant's own host. */
export async function tenantUrl(tenantId: string | null, path: string): Promise<string> {
  return new URL(path, await tenantOrigin(tenantId)).toString();
}

/** The first entry of a possibly comma-separated forwarded header. */
function first(value: string): string {
  return value.split(',')[0].trim();
}
