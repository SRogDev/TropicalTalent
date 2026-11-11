import 'server-only';

import { headers } from 'next/headers';
import { cache } from 'react';
import { adminDb } from '@/lib/supabase';
import type { Tenant, TenantArchetype, TenantBranding, TenantFeatures, TenantTheme } from './types';

/**
 * Tenant resolution.
 *
 * Which branded site is this request for? Answered from the Host header, once
 * per request, and passed down. Nothing else in the app asks the question.
 *
 * ---------------------------------------------------------------------------
 * Why this does not cost a round trip
 * ---------------------------------------------------------------------------
 * React.cache collapses every caller in a request into one execution, the same
 * way getViewer() and db() already work. The layout then runs getTenant()
 * inside its existing Promise.all rather than awaiting it first, so the lookup
 * overlaps the sidebar reads and adds concurrency, not latency. That keeps the
 * "one round trip per screen" rule honest — the rule is about sequential
 * awaits, and this adds none.
 *
 * A cross-request cache would remove even that, since tenant rows change
 * roughly never. The natural mechanism is Next 16's `'use cache'` with
 * cacheTag('tenant:' + host), invalidated by the admin console's revalidateTag.
 * It is deliberately NOT used yet: it needs the cacheComponents flag in
 * next.config.mjs, which changes caching semantics app-wide, and that is not
 * something tenancy should switch on as a side effect. The split needed for it
 * is already in place below — resolveTenantByHost() takes the host as an
 * argument and reads no request state — so adopting it later is a one-line
 * change to that function and nothing else.
 *
 * ---------------------------------------------------------------------------
 * Unknown hosts fall back to classic
 * ---------------------------------------------------------------------------
 * A host with no tropical_tenant_domains row serves the classic TropicalTalent app. That
 * covers localhost, Vercel preview URLs, and the production apex today, so
 * this whole change is inert until a domain row exists.
 *
 * The failure direction matters: an unrecognised host can only ever fall back
 * to CLASSIC, never to some other customer's tenant. Reaching a white-label
 * requires an exact, deliberately created host match. A typo cannot land a
 * visitor inside Acme's site.
 */

const TENANT_SELECT =
  'id, slug, name, is_classic, status, archetype, theme, branding, features, platform_fee_pct, partner_share_pct, visibility';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  is_classic: boolean;
  status: string;
  archetype: string;
  theme: unknown;
  branding: unknown;
  features: unknown;
  platform_fee_pct: number | string;
  partner_share_pct: number | string;
  visibility?: string | null;
}

/**
 * The tenant for the current request.
 *
 * Never null: an unresolvable host resolves to the classic tenant, and a
 * database with no classic row is a broken deployment rather than a runtime
 * condition worth branching on everywhere.
 */
export const getTenant = cache(async (): Promise<Tenant> => {
  const host = await currentHost();
  return resolveTenantByHost(host);
});

/** The request's hostname, lowercased and without its port. */
export const currentHost = cache(async (): Promise<string> => {
  const h = await headers();
  // x-forwarded-host is what a proxy in front of Next sets; host is the direct
  // value. Prefer the forwarded one so a tenant domain terminated upstream
  // still resolves.
  const raw = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  return normaliseHost(raw);
});

export function normaliseHost(raw: string): string {
  // Strip port, strip a trailing dot (fully-qualified form), lowercase.
  return raw.trim().toLowerCase().split(':')[0].replace(/\.$/, '');
}

/**
 * Host -> tenant. Takes the host rather than reading it, so this stays a pure
 * function of its argument and can be wrapped in a cross-request cache later
 * without touching any caller.
 *
 * Reads through the service role: tropical_tenant_domains carries RLS with no
 * policies at all (024), because host resolution happens before a session
 * exists and no signed-in user ever needs to enumerate domains.
 */
const resolveTenantByHost = cache(async (host: string): Promise<Tenant> => {
  const admin = adminDb();

  if (host) {
    const { data } = await admin
      .from('tropical_tenant_domains')
      .select(`tenant:tropical_tenants!inner(${TENANT_SELECT})`)
      .eq('host', host)
      .maybeSingle();

    // PostgREST returns an embedded to-one as an object, but types it as
    // possibly-array; `one()` is the codebase's helper for exactly this.
    const row = (Array.isArray(data?.tenant) ? data?.tenant[0] : data?.tenant) as
      | TenantRow
      | undefined;

    // A suspended tenant is treated as unresolvable rather than served in a
    // half-state: falling through to classic means its users land on TropicalTalent and
    // fail the membership check, which is a comprehensible dead end.
    if (row && row.status === 'active') return toTenant(row);
  }

  return getClassicTenant();
});

/** The classic TropicalTalent tenant. Seeded by migration 023 and expected to exist. */
export const getClassicTenant = cache(async (): Promise<Tenant> => {
  const { data } = await adminDb()
    .from('tropical_tenants')
    .select(TENANT_SELECT)
    .eq('is_classic', true)
    .maybeSingle();

  if (!data) {
    throw new Error(
      'No classic tenant row. Apply migration 023_tropical_tenancy.sql — every request resolves through it.',
    );
  }
  return toTenant(data as TenantRow);
});

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isClassic: Boolean(row.is_classic),
    status: row.status === 'suspended' ? 'suspended' : 'active',
    archetype: normaliseArchetype(row.archetype),
    theme: asObject<TenantTheme>(row.theme),
    branding: asObject<TenantBranding>(row.branding),
    features: asObject<TenantFeatures>(row.features),
    // numeric(5,2) arrives as a string over PostgREST, not a number. Reading
    // it as-is would make fee arithmetic silently concatenate.
    platformFeePct: Number(row.platform_fee_pct),
    partnerSharePct: Number(row.partner_share_pct),
    // Absent reads as private. A row written before 036 added the column, or a
    // value nobody recognises, must not silently expose a customer's roster to
    // the public marketplace — the safe answer is the closed one.
    visibility: row.visibility === 'public' ? 'public' : 'private',
  };
}

function normaliseArchetype(value: string): TenantArchetype {
  return value === 'contractors_brands' || value === 'creatives_brands' ? value : 'classic';
}

/** jsonb columns are `unknown` until proven otherwise; never trust the shape. */
function asObject<T>(value: unknown): T {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : ({} as T);
}

/**
 * Every tenant, for the super-admin console.
 *
 * Deliberately not gated here — the caller is, and it is the only caller.
 * Kept in queries.ts rather than actions.ts because it is a read: it is the
 * console's list, not a mutation.
 */
export const listTenants = cache(async (): Promise<Array<Tenant & { hosts: string[] }>> => {
  const { data } = await adminDb()
    .from('tropical_tenants')
    .select(`${TENANT_SELECT}, domains:tropical_tenant_domains(host, is_primary)`)
    .order('is_classic', { ascending: false })
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => ({
    ...toTenant(row as unknown as TenantRow),
    hosts: ((row.domains ?? []) as Array<{ host: string; is_primary: boolean }>)
      .slice()
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((d) => d.host),
  }));
});

/** Headline numbers per tenant, for the console's list. */
export const tenantMemberCounts = cache(async (): Promise<Record<string, number>> => {
  const { data } = await adminDb().from('tropical_tenant_members').select('tenant_id');
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = row.tenant_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
});
