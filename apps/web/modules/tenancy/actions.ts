'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminDb } from '@/lib/supabase';
import { fail, ok, type ActionResult } from '@/lib/utils';
import { getViewer } from '@/modules/identity/queries';
import { getTenant } from '@/modules/tenancy/queries';
import { sendInviteEmails } from '@/modules/notifications/email';
import { ARCHETYPE_PRESETS } from './presets';
import type { TenantArchetype } from './types';

/**
 * Tenant administration.
 *
 * Creating a white-label is two rows: the tenant and its first hostname. That
 * is the whole point of the tenancy design — no deploy, no migration, no
 * per-customer code — and this is where it happens.
 *
 * Creating, configuring and suspending a tenant is SUPER-ADMIN ONLY, checked
 * on every call. A white-label's own admin must not be able to mint another
 * tenant, edit one they do not own, or switch off their attribution — and a
 * server action is a public HTTP endpoint, so the console hiding a link is not
 * a control.
 *
 * The one exception is inviteRosterAction at the bottom: a wl_admin may
 * onboard their OWN roster, because that is precisely their job. It checks the
 * tenant it was handed against their membership rather than assuming the
 * console passed the right one.
 */

/** Matches the CHECK constraint on tropical_tenants.slug in migration 023. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** The colour syntaxes themeCss will accept. Rejected here so the form can say so. */
const COLOUR =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:oklch|oklab|lab|lch|rgb|rgba|hsl|hsla|color)\([0-9a-z.,%/\s+-]{1,120}\))$/i;

const colour = z.string().trim().regex(COLOUR, 'Use a hex or oklch() colour.');

const createTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG, 'Lowercase letters, numbers and hyphens; 3–40 characters.'),
  name: z.string().trim().min(1).max(120),
  archetype: z.enum(['classic', 'contractors_brands', 'creatives_brands']),
  host: z.string().trim().toLowerCase().min(3).max(253),

  platformFeePct: z.coerce.number().min(0).max(99),
  partnerSharePct: z.coerce.number().min(0).max(100),

  // Whether this customer's PEOPLE are also part of classic TropicalTalent. Chosen once,
  // at creation, because it decides where their accounts live — see migration
  // 036. Absent reads as private: the checkbox is unticked by default and an
  // unchecked box sends nothing.
  publicRoster: z.coerce.boolean().optional(),

  logoUrl: z.string().trim().url().startsWith('https://').optional().or(z.literal('')),
  wordmark: z.string().trim().max(40).optional().or(z.literal('')),
  fromEmail: z.string().trim().email().optional().or(z.literal('')),

  primary: colour.optional().or(z.literal('')),
  accent: colour.optional().or(z.literal('')),
  gradientFrom: colour.optional().or(z.literal('')),
  gradientTo: colour.optional().or(z.literal('')),
  gradientForeground: colour.optional().or(z.literal('')),
});

async function requireSuperAdmin(): Promise<string | null> {
  const viewer = await getViewer();
  if (!viewer) return 'You need to be signed in.';
  // users.role === 'admin'. Not tenantRole — a white-label admin is an admin
  // of one tenant and must never be able to mint another.
  if (!viewer.isSuperAdmin) return 'Only a TropicalTalent admin can manage tenants.';
  return null;
}

/**
 * Super admin AND on the classic host.
 *
 * For the operations that act on the ESTATE rather than on one workspace:
 * creating a tenant, deleting one, suspending one. Identity alone is not the
 * test — a super admin signs in to a customer's own hostname routinely, to
 * reproduce their bugs, and while standing there they should be able to act on
 * THAT customer and nothing else. The estate is TropicalTalent's business and it belongs
 * on TropicalTalent's host, which is the same rule requireAdminScope() applies to every
 * read in the admin console.
 *
 * The pages check this too. This is here because a server action is a public
 * HTTP endpoint and the page is not what protects it.
 */
async function requireEstateAdmin(): Promise<string | null> {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  const tenant = await getTenant();
  if (!tenant.isClassic) {
    return 'Workspaces are managed from the TropicalTalent console, not from a customer site.';
  }
  return null;
}

/**
 * Super admin, and allowed to touch THIS tenant from where they are standing.
 *
 * Editing is narrower than creating: a super admin on acme.tropicaltalent.dev fixing
 * Acme's own logo is exactly the workflow signing in there is for, so that is
 * permitted. Reaching across to another customer's row from Acme's domain is
 * not.
 */
async function requireTenantEditor(tenantId: string): Promise<string | null> {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  const tenant = await getTenant();
  if (!tenant.isClassic && tenant.id !== tenantId) {
    return 'You can only edit this workspace from its own site.';
  }
  return null;
}

export async function createTenantAction(form: FormData): Promise<ActionResult<{ slug: string }>> {
  const denied = await requireEstateAdmin();
  if (denied) return fail(denied);

  const parsed = createTenantSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Check the form.');
  }
  const input = parsed.data;

  const preset = ARCHETYPE_PRESETS[input.archetype as TenantArchetype];

  const gradient = [input.gradientFrom, input.gradientTo].filter(Boolean) as string[];
  const theme = {
    ...(input.primary ? { primary: input.primary } : {}),
    ...(input.accent ? { accent: input.accent } : {}),
    // Two stops or none — themeCss ignores a single-stop gradient, so writing
    // one would be a setting that appears to take and silently does nothing.
    ...(gradient.length === 2 ? { gradient } : {}),
    // The label colour ON the gradient. Left unset it defaults to near-white,
    // which is unreadable on a pale gradient — see the field's hint.
    ...(input.gradientForeground ? { gradientForeground: input.gradientForeground } : {}),
  };

  const admin = adminDb();

  const { data: tenant, error } = await admin
    .from('tropical_tenants')
    .insert({
      slug: input.slug,
      name: input.name,
      archetype: input.archetype,
      // Seeded from the archetype, then editable. The preset is a starting
      // point recorded once, not a mode anything branches on later.
      features: preset.features,
      branding: {
        ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
        ...(input.wordmark ? { wordmark: input.wordmark } : {}),
        ...(input.fromEmail ? { fromEmail: input.fromEmail } : {}),
        // Attribution on by default for every white-label. Only a super admin
        // can clear it, and only by editing the row.
        poweredBy: true,
      },
      theme,
      platform_fee_pct: input.platformFeePct,
      partner_share_pct: input.partnerSharePct,
      visibility: input.publicRoster ? 'public' : 'private',
    })
    .select('id, slug')
    .single();

  if (error) {
    // 23505 is unique_violation — slug is the only unique column here.
    if (error.code === '23505') return fail(`The slug "${input.slug}" is already taken.`);
    return fail(error.message);
  }

  const { error: domainError } = await admin.from('tropical_tenant_domains').insert({
    host: input.host,
    tenant_id: tenant.id,
    is_primary: true,
    // A subdomain of our own wildcard needs no DNS proof. A custom domain
    // does, and stays unverified until it is pointed at us — resolution does
    // not currently gate on this, so treat it as a record of what was checked
    // rather than as a control.
    verified_at: new Date().toISOString(),
  });

  if (domainError) {
    // Roll the tenant back rather than leaving one that no hostname reaches.
    // There is no transaction across two PostgREST calls, so this is the
    // compensating half done by hand.
    await admin.from('tropical_tenants').delete().eq('id', tenant.id);
    if (domainError.code === '23505') {
      return fail(`The host "${input.host}" already belongs to another tenant.`);
    }
    return fail(domainError.message);
  }

  revalidatePath('/admin/tenants');
  return ok({ slug: tenant.slug });
}

/**
 * Suspends or reactivates a tenant.
 *
 * A suspended tenant stops resolving: getTenant() treats it as unknown and
 * falls back to classic, where its members fail the membership check and land
 * on /auth/no-access. Their data is untouched.
 */
export async function setTenantStatusAction(
  tenantId: string,
  status: 'active' | 'suspended',
): Promise<ActionResult<null>> {
  const denied = await requireEstateAdmin();
  if (denied) return fail(denied);

  const { error } = await adminDb()
    .from('tropical_tenants')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', tenantId);

  if (error) return fail(error.message);

  revalidatePath('/admin/tenants');
  return ok(null);
}

/**
 * Edits the safe, cosmetic fields on a tenant.
 *
 * Deliberately NARROW. Slug, archetype and host are not here: they are
 * identity, and changing them under a live customer breaks their links, their
 * members' capabilities, or both. Fees are not here either — repricing a
 * customer from a colour-picker form is not a thing that should be one
 * mis-click away.
 *
 * What is here is everything a customer will actually ask to tweak in the
 * first month: their palette, their mark, their sender, and which surfaces are
 * switched on.
 */
const editTenantSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  wordmark: z.string().trim().max(40).optional().or(z.literal('')),
  logoUrl: z.string().trim().url().startsWith('https://').optional().or(z.literal('')),
  fromEmail: z.string().trim().email().optional().or(z.literal('')),
  primary: colour.optional().or(z.literal('')),
  accent: colour.optional().or(z.literal('')),
  gradientFrom: colour.optional().or(z.literal('')),
  gradientTo: colour.optional().or(z.literal('')),
  gradientForeground: colour.optional().or(z.literal('')),
  poweredBy: z.coerce.boolean().optional(),
  inviteOnly: z.coerce.boolean().optional(),
});

export async function updateTenantAction(form: FormData): Promise<ActionResult<null>> {
  const raw = Object.fromEntries(form);
  const parsed = editTenantSchema.safeParse({
    ...raw,
    // Unchecked boxes are absent from FormData entirely, which zod's coerce
    // would read as undefined rather than false — and undefined would leave
    // the old value in place, so a box could be ticked but never unticked.
    poweredBy: form.get('poweredBy') === 'on',
    inviteOnly: form.get('inviteOnly') === 'on',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.');
  const input = parsed.data;

  // After parsing, because the check needs to know WHICH tenant is being
  // edited — a super admin on a customer's host may edit that customer and no
  // other.
  const denied = await requireTenantEditor(input.tenantId);
  if (denied) return fail(denied);

  const admin = adminDb();
  const { data: current } = await admin
    .from('tropical_tenants')
    .select('id, is_classic, branding, theme, features')
    .eq('id', input.tenantId)
    .maybeSingle();

  if (!current) return fail('That tenant could not be found.');
  if (current.is_classic) {
    // TropicalTalent's own row has no theme override by design — themeCss() returns ''
    // for it — so "editing" it would write settings that never render.
    return fail('The classic TropicalTalent tenant is styled in globals.css, not here.');
  }

  const gradient = [input.gradientFrom, input.gradientTo].filter(Boolean) as string[];

  const { error } = await admin
    .from('tropical_tenants')
    .update({
      name: input.name,
      // Merge rather than replace: these jsonb columns hold fields this form
      // does not show, and a replace would silently drop them.
      branding: {
        ...(current.branding as Record<string, unknown>),
        wordmark: input.wordmark || undefined,
        logoUrl: input.logoUrl || undefined,
        fromEmail: input.fromEmail || undefined,
        poweredBy: input.poweredBy,
      },
      theme: {
        ...(current.theme as Record<string, unknown>),
        primary: input.primary || undefined,
        accent: input.accent || undefined,
        gradient: gradient.length === 2 ? gradient : undefined,
        gradientForeground: input.gradientForeground || undefined,
      },
      features: {
        ...(current.features as Record<string, unknown>),
        inviteOnly: input.inviteOnly,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.tenantId);

  if (error) return fail(error.message);

  revalidatePath('/admin/tenants');
  revalidatePath(`/admin/tenants/${input.tenantId}`);
  return ok(null);
}

/**
 * Deletes a tenant.
 *
 * Destructive and cascading: tropical_tenant_domains, tropical_tenant_members and
 * tropical_tenant_invites all reference it ON DELETE CASCADE, so this removes a
 * customer's entire membership list in one statement.
 *
 * Two guards, because "suspend" is almost always what someone actually wants:
 *
 *   1. The classic tenant can never be deleted — every request resolves
 *      through it, so removing it takes the whole platform down.
 *   2. A tenant with projects is refused outright. Those projects reference it
 *      and would be orphaned or cascade-deleted depending on the constraint,
 *      and neither is something to discover after the fact. Suspend instead.
 */
export async function deleteTenantAction(tenantId: string): Promise<ActionResult<null>> {
  const denied = await requireEstateAdmin();
  if (denied) return fail(denied);

  const admin = adminDb();

  const { data: tenant } = await admin
    .from('tropical_tenants')
    .select('id, name, is_classic')
    .eq('id', tenantId)
    .maybeSingle();

  if (!tenant) return fail('That tenant could not be found.');
  if (tenant.is_classic) return fail('The classic TropicalTalent tenant cannot be deleted.');

  const { count: projects } = await admin
    .from('tropical_projects')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if ((projects ?? 0) > 0) {
    return fail(
      `${tenant.name} has ${projects} project${projects === 1 ? '' : 's'}. Suspend it instead - deleting would take their work with it.`,
    );
  }

  const { error } = await admin.from('tropical_tenants').delete().eq('id', tenantId);
  if (error) return fail(error.message);

  revalidatePath('/admin/tenants');
  return ok(null);
}

// ---------------------------------------------------------------------------
// Roster onboarding
// ---------------------------------------------------------------------------

/**
 * Anything that looks like an email, out of anything a person pastes.
 *
 * Rosters arrive as a CSV column, a spreadsheet paste, a line-separated list,
 * or a mail client's "Name <addr@x>" format. Extracting rather than parsing
 * means all of those work and none of them need instructions.
 */
function extractEmails(raw: string): string[] {
  const found = raw.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g) ?? [];
  return Array.from(new Set(found.map((e) => e.toLowerCase().replace(/[.,;]+$/, ''))));
}

export interface InviteResult {
  added: number;
  alreadyInvited: number;
  alreadyMembers: number;
  invalid: number;
  total: number;
  /** Addresses actually emailed. 0 when the admin left the box unticked. */
  emailed: number;
}

/**
 * Pre-authorises a roster to join a tenant, and optionally tells them.
 *
 * These rows say who is ALLOWED in and on what terms. The invite is matched by
 * email at sign-up and applies the role and capabilities it was created with.
 *
 * Emailing is opt-in, per call, and off unless the caller asks. 031 chose to
 * send nothing at all, on the grounds that a client puts the sign-in link on
 * their own website and 600 Supabase invitations are a queue, a deliverability
 * problem and a pile of expired links. The endpoint objection no longer
 * applies — sendInviteEmails() sends the tenant's ordinary sign-in URL through
 * Resend, with no token and nothing to expire — but the judgement underneath
 * it does: an admin pasting a roster to record who is allowed in must not
 * discover afterwards that it mailed six hundred people. So the checkbox
 * exists, it names the number, and the count comes back in the result.
 *
 * A failed send never fails the invite. The rows are the durable thing; the
 * mail is a convenience, and one that can be repeated by re-pasting the list.
 *
 * Callable by a TropicalTalent super admin or the tenant's own wl_admin — this is the
 * one write in this file a white-label's admin may perform, because onboarding
 * their own roster is exactly their job.
 */
export async function inviteRosterAction(form: FormData): Promise<ActionResult<InviteResult>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const tenantId = String(form.get('tenantId') ?? '');
  const side = String(form.get('side') ?? 'worker');
  const asAdmin = form.get('asAdmin') === 'on';
  const notify = form.get('notify') === 'on';
  const raw = String(form.get('emails') ?? '');

  if (!tenantId) return fail('Missing tenant.');

  // Super admin anywhere; a wl_admin only for their own tenant.
  const permitted =
    viewer.isSuperAdmin || (viewer.tenantRole === 'wl_admin' && viewer.tenantId === tenantId);
  if (!permitted) return fail('You cannot invite people to that workspace.');

  const admin = adminDb();
  const { data: tenant } = await admin
    .from('tropical_tenants')
    .select('id, archetype')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return fail('That workspace could not be found.');

  const emails = extractEmails(raw);
  const rough = raw.split(/[\s,;]+/).filter(Boolean).length;
  if (emails.length === 0) return fail('No email addresses found in that list.');
  if (emails.length > 2000) return fail('That is more than 2000 addresses - split it up.');

  const preset =
    ARCHETYPE_PRESETS[tenant.archetype as TenantArchetype] ?? ARCHETYPE_PRESETS.classic;
  const capabilities =
    side === 'payer' ? preset.signup.payer.capabilities : preset.signup.worker.capabilities;

  // Anyone already a member is reported rather than invited: an invite for
  // someone who is already in would be claimed on a sign-up that will never
  // happen, and would sit in the pending list forever looking like a person
  // who has not turned up.
  const { data: existingUsers } = await admin
    .from('tropical_tenant_members')
    .select('user_id, user:users!inner(id)')
    .eq('tenant_id', tenantId);

  const memberIds = new Set((existingUsers ?? []).map((m) => m.user_id as string));
  const { emailById } = await resolveEmailsForIds(memberIds);
  const memberEmails = new Set(
    Array.from(emailById.values())
      .filter(Boolean)
      .map((e) => e!.toLowerCase()),
  );

  const toInsert = emails.filter((e) => !memberEmails.has(e));
  const alreadyMembers = emails.length - toInsert.length;

  const { data: existingInvites } = await admin
    .from('tropical_tenant_invites')
    .select('email')
    .eq('tenant_id', tenantId)
    .in('email', toInsert);

  const invited = new Set((existingInvites ?? []).map((i) => i.email as string));

  const rows = toInsert.map((email) => ({
    tenant_id: tenantId,
    email,
    member_role: asAdmin ? 'wl_admin' : 'member',
    capabilities,
    created_by: viewer.id,
  }));

  if (rows.length > 0) {
    // Upsert rather than insert: re-pasting a roster to add the ten people
    // who were missed should not fail on the 590 already there.
    const { error } = await admin
      .from('tropical_tenant_invites')
      .upsert(rows, { onConflict: 'tenant_id,email', ignoreDuplicates: true });
    if (error) return fail(error.message);
  }

  // Only the addresses this call actually added. Someone already on the roster
  // has either been told already or is deliberately being re-added to fix their
  // capabilities, and neither is a reason to mail them again.
  const freshlyInvited = toInsert.filter((email) => !invited.has(email));

  let emailed = 0;
  if (notify && freshlyInvited.length > 0) {
    const result = await sendInviteEmails({ tenantId, emails: freshlyInvited });
    emailed = result.sent;
  }

  revalidatePath('/admin/tenants');
  return ok({
    added: rows.length - invited.size,
    alreadyInvited: invited.size,
    alreadyMembers,
    invalid: Math.max(0, rough - emails.length),
    total: emails.length,
    emailed,
  });
}

/** Emails for a set of user ids, walking the auth directory only as far as needed. */
async function resolveEmailsForIds(
  wanted: Set<string>,
): Promise<{ emailById: Map<string, string | null> }> {
  const emailById = new Map<string, string | null>();
  if (wanted.size === 0) return { emailById };

  const admin = adminDb();
  const PER_PAGE = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    const batch = data?.users ?? [];
    if (error || batch.length === 0) break;
    for (const u of batch) if (wanted.has(u.id)) emailById.set(u.id, u.email ?? null);
    if (emailById.size >= wanted.size || batch.length < PER_PAGE) break;
  }
  return { emailById };
}
