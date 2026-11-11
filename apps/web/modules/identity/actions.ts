'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { adminDb, db } from '@/lib/supabase';
import { fail, ok, slugify, type ActionResult } from '@/lib/utils';
import { sendNotificationEmail, sendWelcomeEmail } from '@/modules/notifications/email';
import { getTenant } from '@/modules/tenancy/queries';
import { requestUrl } from '@/modules/tenancy/urls';
import { hasFeature, homePath, type Tenant } from '@/modules/tenancy/types';
import { capabilitiesForSignup } from '@/modules/tenancy/presets';
import type { TenantCapabilities } from '@/modules/tenancy/types';
import { TERMS_VERSION } from '@/lib/legal';
import { completeProfileSchema, signUpSchema } from './schema';
import { getViewer, pendingTenantInvite } from './queries';

/**
 * Identity writes: sign up, sign in, sign out, profile edits.
 *
 * Sign-up is the flow that used to end at the `waitlist` table. It now creates
 * a real Supabase auth user and real profile rows — AND still writes the
 * waitlist row on tenants that keep a waitlist, because that table feeds
 * production reporting and dropping the write would put a hole in the funnel
 * data. See recordWaitlist() for why that is now a per-tenant decision.
 */

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export interface SignUpResult {
  /** True when the project has email confirmation on and no session was issued. */
  needsEmailConfirmation: boolean;
  /** Where to send the browser when a session was issued. */
  next: string;
  /** Set when the account was created but the photo was not saved. */
  avatarWarning: string | null;
}

export async function signUpAction(form: FormData): Promise<ActionResult<SignUpResult>> {
  const role = String(form.get('role') ?? '');

  const raw: Record<string, unknown> = {
    name: form.get('name'),
    email: form.get('email'),
    password: form.get('password'),
    role,
  };

  if (role === 'brand') {
    raw.companyBlurb = form.get('companyBlurb');
  } else if (role === 'creative') {
    raw.passions = safeJsonArray(form.get('passions'));
    raw.bio = form.get('bio');
    raw.locationText = form.get('locationText') ?? undefined;
  }

  // Optional, and deliberately outside the schema: a mistyped referral code
  // must never be the reason an otherwise valid sign-up fails.
  const referralCode = String(form.get('referralCode') ?? '').trim();

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');
  }
  const input = parsed.data;

  // Which site is this sign-up for? Everything below depends on it: who is
  // allowed in, what they may do, and where the confirmation link points.
  const tenant = await getTenant();

  // Eligibility BEFORE the account exists.
  //
  // This check used to live inside writeProfile(), which runs after
  // auth.signUp(). So a person refused by an invite-only tenant was left with
  // a real Supabase account, a users row, and no membership — and the retry
  // told them "That email already has an account." Their address was burnt and
  // there was no way forward from the UI. Asking first costs one indexed
  // lookup and only on tenants that have closed sign-up anyway.
  const invite = await lookupInvite(tenant.id, input.email);
  const eligibility = signUpRefusal(tenant, invite, input.role);
  if (eligibility) return fail(eligibility);

  // The cookie-bound client, so a session (when the project issues one
  // immediately) is written straight to the browser and the user lands signed
  // in rather than being bounced to a login form they just filled in.
  const supabase = await db();

  const username = await uniqueUsername(input.name);

  const { data: signUp, error: signUpError } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { name: input.name, username, display_name: input.name, role: input.role },
      // THE white-label sign-up bug.
      //
      // Without this, Supabase builds the confirmation link against the
      // project's Site URL — classic TropicalTalent. Two things then break at once: the
      // customer's user lands on a brand they have never seen, and the PKCE
      // code verifier cookie was written on the TENANT's host, so it is absent
      // on classic and exchangeCodeForSession() fails. The result was
      // /auth/sign-in?error=exchange_failed on the wrong domain, with no way to
      // finish signing up at all.
      //
      // Supabase still rewrites this to the Site URL unless the host is on the
      // Redirect URLs allowlist — see docs/white-label-runbook.md Part 1 §2.
      emailRedirectTo: await requestUrl('/auth/callback'),
    },
  });

  if (signUpError) {
    return fail(translateAuthError(signUpError.message));
  }
  if (!signUp.user) {
    return fail('Could not create the account. Please try again.');
  }

  // An address that ALREADY has a confirmed account.
  //
  // With email confirmation on, Supabase will not say so — telling an
  // anonymous caller which addresses are registered is a user-enumeration
  // leak, so it answers 200 with a fabricated user id, an empty `identities`
  // array, no session and no email. Verified against this project: a fresh
  // address comes back with one identity, an existing one with none.
  //
  // Everything below would then run against a user that does not exist.
  // public.users has no foreign key onto auth.users, so the profile upsert
  // SUCCEEDS — inventing an orphan row nobody can ever sign in as, granting it
  // tenant membership, and claiming this tenant's invite in its name, marking
  // the real person as arrived. The caller is told to check an email that was
  // never sent, and the admin's roster shows them as joined.
  //
  // The empty-identities check is the only signal available, and it has to be
  // read here rather than trusted to writeProfile: by the time that runs the
  // damage is the write itself.
  if (Array.isArray(signUp.user.identities) && signUp.user.identities.length === 0) {
    return fail('That email already has an account. Sign in instead.');
  }

  const userId = signUp.user.id;

  // Profile writes go through the service role. A brand-new user may not have
  // a session yet (email confirmation on), so their own RLS policies cannot
  // authorise these inserts — and the trigger that mirrors auth.users into
  // public.users may not have committed by the time we get here either, which
  // is why this is an upsert rather than an update.
  const admin = adminDb();

  const [avatarResult, locationId] = await Promise.all([
    uploadAvatar(admin, userId, form.get('photo')),
    input.role === 'creative' ? findOrCreateLocation(admin, input.locationText) : null,
  ]);
  const avatar = avatarResult.url;

  const profileError = await writeProfile(admin, {
    userId,
    email: input.email,
    username,
    name: input.name,
    role: input.role,
    bio: input.role === 'creative' ? input.bio : input.companyBlurb,
    avatar,
    locationId,
    passions: input.role === 'creative' ? input.passions : [],
  });

  if (profileError) {
    return fail(`Account created but the profile did not save: ${profileError}`);
  }

  // The tick-box on the sign-up dialog gates the button; this is what makes it
  // evidence. Written with the same service-role client and for the same
  // reason as the profile above — on the email-confirmation path there is no
  // session yet, so the user cannot write their own row.
  await recordTermsAcceptance(admin, userId, tenant.id, 'signup');

  // Only once a session exists.
  //
  // With email confirmation ON — which it is for this project — there is no
  // session here, and the person holds an unconfirmed account they cannot sign
  // in to. A welcome landing in the same breath as "confirm your address"
  // competes with the one mail they actually have to act on, and welcomes the
  // share who never confirm at all. Those accounts get theirs from
  // /auth/callback instead, once the link is clicked.
  if (signUp.session) {
    await sendWelcomeEmail(userId, input.name, input.role, tenant);
  }

  // Record the referral with the id we just created rather than through the
  // authenticated wrapper: with email confirmation on there is no session yet,
  // so auth.uid() would be null and every referral would be lost.
  await recordReferral(tenant, admin, referralCode, userId, input.name);

  // Waitlist row preserved. Production reads this table; a duplicate email is
  // not an error here because the account itself already succeeded.
  await recordWaitlist(tenant, admin, {
    name: input.name,
    email: input.email,
    role: input.role,
    company_blurb: input.role === 'brand' ? input.companyBlurb : null,
    photo_url: avatar,
    passion: input.role === 'creative' ? input.passions.join(', ') : null,
    bio: input.role === 'creative' ? input.bio : null,
    location_id: locationId,
    location_text: input.role === 'creative' ? (input.locationText ?? null) : null,
  });

  return ok({
    needsEmailConfirmation: !signUp.session,
    next: homeForSignup(tenant, input.role, invite),
    // The account is made either way; this is the difference between "no photo
    // because I skipped it" and "no photo because we dropped it silently".
    avatarWarning: avatarResult.problem ? avatarProblemMessage(avatarResult.problem) : null,
  });
}

/**
 * Joins the tenant the viewer is looking at, using an invite for their address.
 *
 * The gap this closes: an invite was only ever redeemable inside
 * writeProfile(), which runs during SIGN-UP. Someone who already had an
 * account — a contractor whose client also uses TropicalTalent, or anyone the roster
 * was pasted for after they had signed up elsewhere on the platform — could
 * not use theirs. Signing up again is not an alternative: the address is
 * already registered, so it is refused. They reached /auth/no-access and had
 * nowhere to go, while the admin's console showed them as still pending.
 *
 * Everything is re-derived here from the session and the host. Nothing about
 * which tenant, which role, or which capabilities comes from the request body,
 * because this is a public HTTP endpoint and those three fields are exactly
 * what someone would forge: the tenant is the host they are on, and the terms
 * are whatever the admin froze onto the invite row.
 */
export async function joinTenantWithInviteAction(): Promise<ActionResult<{ next: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (viewer.belongsToTenant) return fail('You are already a member of this workspace.');

  const tenant = await getTenant();

  // Re-read rather than trusting anything passed in. pendingTenantInvite()
  // resolves the tenant from the host and the address from the verified
  // session, so there is no input here to tamper with.
  const invite = await pendingTenantInvite();
  if (!invite) {
    return fail(`There is no open invitation for your account on ${tenant.name}.`);
  }

  const admin = adminDb();

  // The same RPC sign-up uses, so "claimed" means one thing in the console
  // whichever route the person arrived by. Service role: it is revoked from
  // everyone else, because the caller has no membership yet by definition.
  const { error: claimError } = await admin.rpc('tropical_claim_invite', {
    p_tenant: tenant.id,
    p_email: viewer.email ?? '',
    p_user: viewer.id,
  });
  if (claimError) return fail(claimError.message);

  const { error: membershipError } = await admin.from('tropical_tenant_members').upsert(
    {
      tenant_id: tenant.id,
      user_id: viewer.id,
      role: invite.memberRole,
      capabilities: invite.capabilities,
    },
    { onConflict: 'tenant_id,user_id' },
  );
  if (membershipError) return fail(membershipError.message);

  // users.role follows the capabilities that actually won, exactly as
  // writeProfile() reconciles it at sign-up — otherwise the sidebar and the
  // profile disagree about what this person is. An account granted both keeps
  // the role it already had, which is the classic TropicalTalent shape.
  const effectiveRole: 'creative' | 'brand' | null =
    invite.capabilities.brand && !invite.capabilities.work
      ? 'brand'
      : invite.capabilities.work && !invite.capabilities.brand
        ? 'creative'
        : null;

  // Never demote a super admin: users.role = 'admin' is what gates /admin, and
  // overwriting it here would lock a TropicalTalent operator out of the console for the
  // sake of a membership they took on to reproduce a bug.
  if (effectiveRole && effectiveRole !== viewer.role && !viewer.isSuperAdmin) {
    await admin.from('users').update({ role: effectiveRole }).eq('id', viewer.id);
  }

  revalidatePath('/', 'layout');

  return ok({
    next: homePath(
      { canBrand: invite.capabilities.brand, isCreative: invite.capabilities.work },
      tenant.features,
    ),
  });
}

// ---------------------------------------------------------------------------
// OAuth profile completion
// ---------------------------------------------------------------------------

/**
 * Finishes the profile for a user who signed in with Google.
 *
 * OAuth hands back a verified email, a display name and usually an avatar —
 * and nothing else. No role, no disciplines, no bio. Without this step a
 * Google user lands in the app as a default talent with an empty profile,
 * invisible to every brief match.
 *
 * Same questions as the sign-up dialog, minus the credentials they already
 * have. Writes through the same `writeProfile` helper, so an account created
 * either way ends up identical.
 */
export async function completeProfileAction(
  form: FormData,
): Promise<ActionResult<{ next: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const tenant = await getTenant();

  const role = String(form.get('role') ?? '');
  const raw: Record<string, unknown> = {
    name: form.get('name') || viewer.name || '',
    role,
  };

  if (role === 'brand') {
    raw.companyBlurb = form.get('companyBlurb');
  } else if (role === 'creative') {
    raw.passions = safeJsonArray(form.get('passions'));
    raw.bio = form.get('bio');
    raw.locationText = form.get('locationText') ?? undefined;
  }

  const parsed = completeProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');
  }
  const input = parsed.data;

  // Same gates as the password path. An OAuth account is created by Google
  // before this form is ever shown, so refusing here cannot prevent the auth
  // user — but it does stop a membership being granted, which is the thing
  // that actually opens the workspace.
  const invite = await lookupInvite(tenant.id, viewer.email ?? '');
  const eligibility = signUpRefusal(tenant, invite, input.role);
  if (eligibility) return fail(eligibility);

  const admin = adminDb();

  const [avatarResult, locationId] = await Promise.all([
    uploadAvatar(admin, viewer.id, form.get('photo')),
    input.role === 'creative' ? findOrCreateLocation(admin, input.locationText) : null,
  ]);
  const avatar = avatarResult.url;

  const profileError = await writeProfile(admin, {
    userId: viewer.id,
    email: viewer.email ?? '',
    // Keep the handle they already have; only mint one if the OAuth path never
    // produced a usable username.
    username: viewer.username ?? (await uniqueUsername(input.name)),
    name: input.name,
    role: input.role,
    bio: input.role === 'creative' ? input.bio : input.companyBlurb,
    // Keep whatever is already on the row rather than nulling it when the user
    // skipped the photo step.
    //
    // This comment used to claim "Google's avatar is already on the row". It
    // is not, and never was: the live handle_new_user() trigger inserts
    // `avatar` as a hard-coded null and never reads avatar_url or picture out
    // of raw_user_meta_data. Google's photo is discarded at sign-up, which is
    // part of why so many OAuth accounts have none. Migration 049 fixes the
    // trigger; the coalesce stays correct either way.
    avatar: avatar ?? viewer.avatar,
    locationId,
    passions: input.role === 'creative' ? input.passions : [],
  });

  if (profileError) return fail(profileError);

  await recordTermsAcceptance(admin, viewer.id, tenant.id, 'oauth_complete');

  // Unconditional here: an OAuth account is confirmed by the provider, and
  // reaching this line means the profile form was just submitted, so a session
  // exists and the account is usable.
  await sendWelcomeEmail(viewer.id, input.name, input.role, tenant);

  // An OAuth signup can also carry a code — the landing page stashes ?ref=
  // before handing off to Google, and /auth/complete passes it through.
  await recordReferral(
    tenant,
    admin,
    String(form.get('referralCode') ?? '').trim(),
    viewer.id,
    input.name,
  );

  await recordWaitlist(tenant, admin, {
    name: input.name,
    email: viewer.email,
    role: input.role,
    company_blurb: input.role === 'brand' ? input.companyBlurb : null,
    photo_url: avatar ?? viewer.avatar,
    passion: input.role === 'creative' ? input.passions.join(', ') : null,
    bio: input.role === 'creative' ? input.bio : null,
    location_id: locationId,
    location_text: input.role === 'creative' ? (input.locationText ?? null) : null,
  });

  revalidatePath('/', 'layout');
  return ok({ next: homeForSignup(tenant, input.role, invite) });
}

// ---------------------------------------------------------------------------
// Who may sign up here
// ---------------------------------------------------------------------------

/** The terms a pre-authorised invite carries, as tropical_claim_invite returns them. */
interface TenantInvite {
  member_role: string;
  capabilities: unknown;
}

/**
 * The invite row for an email on a tenant, WITHOUT claiming it.
 *
 * Read-only twin of tropical_claim_invite, so eligibility can be decided before
 * an auth user exists. Service role because there is no session yet — the same
 * reason writeProfile()'s writes use it.
 *
 * Lowercased to match the CHECK constraint on tropical_tenant_invites.email; a
 * roster pasted out of a spreadsheet is never consistent about case.
 */
async function lookupInvite(tenantId: string, email: string): Promise<TenantInvite | null> {
  const { data } = await adminDb()
    .from('tropical_tenant_invites')
    .select('member_role, capabilities')
    .eq('tenant_id', tenantId)
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  return (data as TenantInvite | null) ?? null;
}

/**
 * Why this sign-up is refused, or null if it is allowed.
 *
 * Two independent gates, both about the SITE rather than the person:
 *
 *   inviteOnly       — the workspace is closed to anyone not on the roster. A
 *                      white-label's sign-in link lives on the customer's own
 *                      public website, so without this anyone who finds it can
 *                      open an account inside their workspace.
 *   selfServeBrands  — the workspace does not let payers sign themselves up. A
 *                      contractor platform wants its companies onboarded by
 *                      hand without having to close sign-up entirely.
 *
 * selfServeBrands is read as "refuse only when explicitly false", which is the
 * opposite of hasFeature()'s absent-means-off convention. That convention is
 * for flags a tenant opts INTO; this one is on in every archetype preset and in
 * the classic seed, so a half-filled row must not silently lock a customer's
 * payers out of their own site. An invite always wins over it — an admin who
 * put someone on the roster as a payer has already made the decision.
 */
function signUpRefusal(
  tenant: Tenant,
  invite: TenantInvite | null,
  role: 'creative' | 'brand',
): string | null {
  if (!invite && tenant.features.inviteOnly === true) {
    return 'That email has not been invited to this workspace.';
  }

  if (role === 'brand' && !invite && tenant.features.selfServeBrands === false) {
    return `${tenant.name} doesn't take company sign-ups here - ask your contact to invite you.`;
  }

  return null;
}

/**
 * A capabilities object from jsonb, with both keys present and boolean.
 *
 * tropical_tenant_invites.capabilities is free-form jsonb an admin's roster
 * import wrote. Absent reads as false, matching findMembership() in
 * modules/identity/queries.ts — a membership written before a capability
 * existed must not silently acquire it.
 */
function normaliseCapabilities(value: unknown): TenantCapabilities {
  const shape = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { brand: shape.brand === true, work: shape.work === true };
}

/**
 * Where a freshly signed-up account should land.
 *
 * The capabilities it was just granted, against the tenant's own feature flags.
 * Every one of these call sites used to hardcode `/create` for a brand and
 * `/briefs` for everyone else, which on a contractor tenant means a feed that
 * is switched off — /briefs then redirects to /jobs, so the first thing a new
 * contractor saw was two redirects, and an admin saw a page with no nav link.
 */
function homeForSignup(tenant: Tenant, role: 'creative' | 'brand', invite: TenantInvite | null) {
  const caps = (
    invite?.capabilities && typeof invite.capabilities === 'object'
      ? invite.capabilities
      : capabilitiesForSignup(tenant.archetype, role)
  ) as Record<string, unknown>;

  return homePath(
    { canBrand: caps.brand === true, isCreative: caps.work === true },
    tenant.features,
  );
}

/**
 * Writes the sign-up's `waitlist` row, on the tenants that keep a waitlist.
 *
 * `waitlist` is classic TropicalTalent's funnel table: it predates this app, production
 * reporting reads it, and it has no tenant column. Until 2026-08-27 both
 * sign-up paths inserted into it unconditionally, so every white-label
 * contractor landed in TropicalTalent's funnel indistinguishable from a TropicalTalent signup —
 * even though `features.waitlist` is off for both live white-labels.
 *
 * The flag is the gate, not `isClassic`: a white-label that wants its own
 * funnel turns it on, and classic keeps the table exactly as production expects
 * it. Failures stay silent for the same reason as before — the account already
 * exists, and a missing funnel row is a reporting gap, not a failed sign-up.
 */
async function recordWaitlist(
  tenant: Tenant,
  admin: AdminClient,
  row: Record<string, unknown>,
): Promise<void> {
  if (!hasFeature(tenant, 'waitlist')) return;
  await admin.from('waitlist').insert(row);
}

/**
 * Writes down that this person accepted the Terms, and which version.
 *
 * The sign-up dialog has had a checkbox for a while and it does gate both
 * entry points — but `agreedToTerms` was React state that never left the
 * browser, so the honest answer to "what did they agree to, and when" was that
 * we did not know. For a document that now carries an escrow arrangement, a
 * continuous payment authority and a liability cap, that is the half worth
 * having.
 *
 * The version is NOT taken from the client. A tampered request could otherwise
 * claim acceptance of a version that never existed, or of an older one whose
 * terms were more favourable. TERMS_VERSION is the server's own constant.
 *
 * Never throws, and never blocks a sign-up. The account is what the person
 * came for; a missing acceptance row is a gap in our records that support can
 * close by asking them to re-accept, not a reason to refuse them an account
 * they have already been charged nothing for. The UNIQUE constraint makes a
 * repeat call a no-op rather than a second agreement.
 */
async function recordTermsAcceptance(
  admin: AdminClient,
  userId: string,
  tenantId: string,
  source: 'signup' | 'oauth_complete' | 're_accept',
): Promise<void> {
  try {
    await admin.from('tropical_terms_acceptances').upsert(
      {
        user_id: userId,
        document: 'terms',
        version: TERMS_VERSION,
        tenant_id: tenantId,
        source,
      },
      { onConflict: 'user_id,document,version', ignoreDuplicates: true },
    );
  } catch {
    // See above: the account matters more than the row.
  }
}

/**
 * Credits a referral, if a usable code was supplied.
 *
 * Never throws and never blocks sign-up. An unknown code, a self-referral or a
 * user who was already referred all resolve to "no credit" inside the RPC, and
 * a missing RPC (migration 014 not applied) is swallowed here.
 */
async function recordReferral(
  tenant: Tenant,
  admin: AdminClient,
  code: string,
  referredId: string,
  referredName: string,
): Promise<void> {
  if (!code) return;

  // A tenant that does not run referrals does not accrue them either.
  //
  // The sign-up form hides the step (referralAudience), but the code also
  // arrives from ?ref= through sessionStorage and from the OAuth round trip,
  // so the form is not the gate — this is. Without it a white-label sign-up
  // silently credits a TropicalTalent referrer, because tropical_referrals has no tenant
  // column and every code is global.
  if (!hasFeature(tenant, 'referrals')) return;

  try {
    const { data: referrerId } = await admin.rpc('tropical_record_referral', {
      p_code: code,
      p_referred: referredId,
    });

    if (referrerId) {
      const subject = 'Your referral joined TropicalTalent';
      const body = `${referredName || 'Someone you referred'} just joined TropicalTalent using your code.`;
      await admin.from('tropical_notifications').insert({
        user_id: referrerId,
        project_id: null,
        kind: 'referral_redeemed',
        title: subject,
        body,
        actor_id: referredId,
      });
      await sendNotificationEmail({ userId: referrerId, kind: 'referral_redeemed', subject, body });
    }
  } catch {
    // The account is what matters; a referral that fails to attach is a
    // support question, not a failed sign-up.
  }
}

/**
 * The profile write, shared by the password and OAuth sign-up paths.
 *
 * Returns an error message, or null on success.
 */
async function writeProfile(
  admin: AdminClient,
  input: {
    userId: string;
    /** Used to match a pre-authorised tenant invite. */
    email: string;
    username: string;
    name: string;
    role: 'creative' | 'brand';
    bio: string;
    avatar: string | null;
    locationId: number | null;
    passions: string[];
  },
): Promise<string | null> {
  // The users row has to exist before the invite can be claimed (claimed_by is
  // a foreign key onto it) and before the membership row references it. Written
  // with the role the person PICKED; reconciled below if their invite says
  // otherwise.
  const { error } = await admin.from('users').upsert(
    {
      id: input.userId,
      username: input.username,
      name: input.name,
      role: input.role,
      bio: input.bio,
      avatar: input.avatar,
      location: input.locationId,
      profile_completed: true,
    },
    { onConflict: 'id' },
  );

  if (error) return error.message;

  // Membership in the tenant whose hostname this sign-up arrived on.
  //
  // Both entry points converge here — password sign-up and the OAuth
  // /auth/complete form — so this is the one place that has to know about it.
  // Without a row the account is authenticated but belongs to no site, and the
  // (app) layout sends it to /auth/no-access.
  //
  // Capabilities come from the tenant's archetype: a contractor tenant makes
  // its workers earn-only, the classic tenant grants both. Service role
  // because the user has no session yet on the email-confirmation path — the
  // same reason the users upsert above uses it.
  const tenant = await getTenant();

  // A pre-authorised invite, if this tenant's admin put one there. It carries
  // the terms the admin chose per person — a roster is usually mixed, and a
  // couple of managers among 600 contractors need different capabilities than
  // the archetype default would give everyone.
  //
  // Claiming here rather than at the eligibility check above, because claiming
  // needs the user id and marks the row as arrived: it is the admin's only
  // progress signal out of a roster of 600, and it must record who actually
  // completed a sign-up, not who started one.
  const { data: claimed } = await admin.rpc('tropical_claim_invite', {
    p_tenant: tenant.id,
    p_email: input.email,
    p_user: input.userId,
  });
  const invite = Array.isArray(claimed) ? claimed[0] : null;

  // Eligibility is decided BEFORE the account is created — see signUpAction and
  // completeProfileAction. Re-checked here because this function is the single
  // convergence point of both entry points and a future third one must not be
  // able to skip it by forgetting the pre-flight.
  const refusal = signUpRefusal(tenant, invite, input.role);
  if (refusal) return refusal;

  // What this person may actually do here. An invite wins over what they picked
  // on the form, which is deliberate — migration 031 freezes the terms at invite
  // time because "the person building [the roster] knows which is which".
  const capabilities = normaliseCapabilities(
    invite?.capabilities ?? capabilitiesForSignup(tenant.archetype, input.role),
  );

  const { error: membershipError } = await admin.from('tropical_tenant_members').upsert(
    {
      tenant_id: tenant.id,
      user_id: input.userId,
      role: invite?.member_role === 'wl_admin' ? 'wl_admin' : 'member',
      capabilities,
    },
    { onConflict: 'tenant_id,user_id' },
  );

  // Fail the sign-up rather than leaving an account that cannot reach anything.
  // Unlike the referral write below, this one is load-bearing.
  if (membershipError) return membershipError.message;

  // A PUBLIC white-label's people are part of classic TropicalTalent as well, so they
  // appear on the TropicalTalent Talent board and can work on TropicalTalent projects. A private
  // one's are not, and signing in to classic with that account lands on
  // /auth/no-access — which is the honest answer for a workforce the customer
  // onboarded themselves.
  //
  // This used to happen to everyone, and by accident: 023's backfill re-ran on
  // every migrate and quietly made every account in the database a classic
  // member. Now it is a decision the tenant's own visibility records, taken
  // when the workspace was created.
  //
  // Classic capabilities are the classic archetype's, not this tenant's — the
  // same person can be earn-only on a contractor workspace and hold both on
  // TropicalTalent, and copying the white-label's narrower set across would quietly
  // limit them on a marketplace that has no such rule.
  if (!tenant.isClassic && tenant.visibility === 'public') {
    const { data: classic } = await admin
      .from('tropical_tenants')
      .select('id')
      .eq('is_classic', true)
      .maybeSingle();

    if (classic) {
      // Not load-bearing: the account already has a working home. A failure
      // here costs them the TropicalTalent marketplace, not the site they signed up on.
      await admin.from('tropical_tenant_members').upsert(
        {
          tenant_id: classic.id,
          user_id: input.userId,
          role: 'member',
          capabilities: capabilitiesForSignup('classic', input.role),
        },
        { onConflict: 'tenant_id,user_id' },
      );
    }
  }

  /**
   * Reconcile users.role with the capabilities that actually won.
   *
   * These are two records of the same fact and they were allowed to disagree.
   * Someone on the roster as a worker who then picked "I'm a Company" at
   * sign-up ended up with users.role = 'brand' and work-only capabilities — and
   * different parts of the app read different ones, so the sidebar called them
   * a Talent while their profile said Brand.
   *
   * The capabilities are the side that decides what they can DO, so the role
   * follows them. An account granted both keeps whichever side it chose, which
   * is the classic TropicalTalent shape and the only case where the two are genuinely
   * independent.
   */
  const effectiveRole: 'creative' | 'brand' =
    capabilities.brand && !capabilities.work
      ? 'brand'
      : capabilities.work && !capabilities.brand
        ? 'creative'
        : input.role;

  if (effectiveRole !== input.role) {
    const { error: roleError } = await admin
      .from('users')
      .update({ role: effectiveRole })
      .eq('id', input.userId);
    if (roleError) return roleError.message;
  }

  // Follows the effective role, not the requested one: loadTalent() filters on
  // users.role, so a worker who was written a brand_data row and no disciplines
  // would be invisible to every search on the site they were invited to.
  if (effectiveRole === 'creative') {
    await admin.from('creative_data').upsert(
      {
        user_id: input.userId,
        name: input.name,
        passion: input.passions.join(', '),
        tags: input.passions,
        verification: 'approved',
      },
      { onConflict: 'user_id' },
    );

    // The passions become disciplines, so a new talent is matchable against
    // briefs immediately rather than after a separate profile-editing trip.
    await attachDisciplines(admin, input.userId, input.passions);
  } else {
    await admin
      .from('brand_data')
      .upsert(
        { user_id: input.userId, name: input.name, type: 'other_business' },
        { onConflict: 'user_id' },
      );
  }

  return null;
}

export async function signInAction(form: FormData): Promise<ActionResult<{ next: string }>> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '');

  if (!email || !password) return fail('Enter your email and password.');

  const supabase = await db();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(translateAuthError(error.message));

  const [viewer, tenant] = await Promise.all([getViewer(), getTenant()]);

  // Authenticated is not the same as "belongs here".
  //
  // One Supabase identity can hold memberships in several tenants, and the
  // credentials are valid on every host. Without this the sign-in reports
  // success, pushes into the app, and the (app) layout bounces to
  // /auth/no-access a moment later — which reads as a broken login rather than
  // as the deliberate answer it is. Route there directly instead: the page
  // names this workspace and offers to sign in as someone else.
  if (viewer && !viewer.belongsToTenant) return ok({ next: '/auth/no-access' });

  if (next.startsWith('/') && !next.startsWith('//')) return ok({ next });

  // Their capabilities here, against what this site actually has switched on.
  // A hardcoded /briefs sent a contractor to a feed their tenant does not have.
  return ok({
    next: viewer
      ? homePath({ canBrand: viewer.canBrand, isCreative: viewer.isCreative }, tenant.features)
      : '/auth/sign-in',
  });
}

/**
 * Sends the confirmation email again.
 *
 * The gap this closes: there was no way back from a lost or expired
 * confirmation link. Signing up again is refused ("That email already has an
 * account"), signing in is refused ("Confirm your email address first"), and
 * nothing anywhere offered a third door. The account existed, the person could
 * not reach it, and only a manual fix in the Supabase dashboard helped.
 *
 * `emailRedirectTo` is built the same way signUpAction builds it, and for the
 * same reason — see the long note there. A link built against the project's
 * Site URL instead of the host the person is actually on lands them on classic
 * TropicalTalent with no PKCE verifier cookie, and the exchange fails.
 *
 * The reply is identical whether or not the address is registered. Saying
 * "no account for that address" here would turn this into a free membership
 * oracle for anyone with a list of emails — the same reason auth.signUp()
 * itself refuses to confirm an address exists.
 */
export async function resendConfirmationAction(form: FormData): Promise<ActionResult<null>> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!email) return fail('Enter your email address.');

  const supabase = await db();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: await requestUrl('/auth/callback') },
  });

  // Rate limiting is the one failure worth passing on, because the answer is
  // "wait" rather than "try something else". Everything else is swallowed: an
  // unregistered address, an already-confirmed one, and a genuine send failure
  // must be indistinguishable from the outside.
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) {
      return fail('Too many attempts. Wait a minute and try again.');
    }
    console.error('[resend-confirmation] failed', { error: error.message });
  }

  return ok(null);
}

export async function signOutAction(): Promise<void> {
  const supabase = await db();
  await supabase.auth.signOut();
  redirect('/');
}

export async function requestPasswordResetAction(form: FormData): Promise<ActionResult<null>> {
  const email = String(form.get('email') ?? '');
  if (!email) return fail('Enter your email.');

  const supabase = await db();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // The requesting host, not the platform env var: a reset asked for on a
    // white-label must come back to that white-label. Supabase still has to
    // have the host on its redirect allowlist or it rewrites this away.
    redirectTo: await requestUrl('/auth/update-password'),
  });
  if (error) return fail(translateAuthError(error.message));
  return ok(null);
}

export async function updatePasswordAction(form: FormData): Promise<ActionResult<null>> {
  const password = String(form.get('password') ?? '');
  if (password.length < 8) return fail('Use at least 8 characters.');

  const supabase = await db();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(translateAuthError(error.message));
  return ok(null);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileUpdateSchema = z.object({
  name: z.string().max(100).optional(),
  bio: z.string().max(1000).optional(),
  passion: z.string().max(500).optional(),
  showreelUrl: z.string().max(500).optional(),
  tags: z.array(z.string().min(1).max(60)).max(40).optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Saves a profile edit.
 *
 * Writes both tables concurrently and returns the saved values, so the client
 * can reconcile against what the server actually stored instead of holding its
 * own optimistic copy. That is what removes the stale-state / re-render loop:
 * the component has one source of truth after the round trip, not two.
 */
export async function updateProfileAction(
  input: ProfileUpdateInput,
): Promise<ActionResult<ProfileUpdateInput>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Some details need fixing.');
  const value = parsed.data;

  const supabase = await db();

  const userPatch: Record<string, unknown> = {};
  if (value.name !== undefined) userPatch.name = value.name;
  if (value.bio !== undefined) userPatch.bio = value.bio;

  const creativePatch: Record<string, unknown> = { user_id: viewer.id };
  if (value.passion !== undefined) creativePatch.passion = value.passion;
  if (value.tags !== undefined) creativePatch.tags = value.tags;
  if (value.showreelUrl !== undefined) creativePatch.video = value.showreelUrl || null;

  const [users, creative] = await Promise.all([
    Object.keys(userPatch).length > 0
      ? supabase.from('users').update(userPatch).eq('id', viewer.id)
      : Promise.resolve({ error: null }),
    Object.keys(creativePatch).length > 1 && viewer.role !== 'brand'
      ? supabase.from('creative_data').upsert(creativePatch, { onConflict: 'user_id' })
      : Promise.resolve({ error: null }),
  ]);

  if (users.error) return fail(users.error.message);
  if (creative.error) return fail(creative.error.message);

  revalidatePath('/profile/[username]', 'page');
  return ok(value);
}

/** Avatar upload is separate from the text fields: it is the only part of a
 *  profile save that carries bytes, and keeping it apart means a slow upload
 *  cannot block a one-word bio edit. */
export async function updateAvatarAction(form: FormData): Promise<ActionResult<{ url: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const file = form.get('avatar');
  if (!(file instanceof File) || file.size === 0) return fail('No image selected.');

  const admin = adminDb();
  // Unlike sign-up, this IS the whole action, so a failure is a failure — and
  // now it says which one rather than "Could not upload that image."
  const { url, problem } = await uploadAvatar(admin, viewer.id, file);
  if (!url) return fail(problem ? avatarProblemMessage(problem) : 'No image selected.');

  const { error } = await admin.from('users').update({ avatar: url }).eq('id', viewer.id);
  if (error) return fail(error.message);

  revalidatePath('/profile/[username]', 'page');
  return ok({ url });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof adminDb>;

/**
 * A username that is free at the time of writing.
 *
 * users.username carries a unique constraint, so a collision would fail the
 * whole sign-up. Suffixing on collision is cheap and the loop is bounded.
 */
async function uniqueUsername(name: string): Promise<string> {
  const base = slugify(name).replace(/-/g, '_') || 'creative';
  const admin = adminDb();

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}_${Math.floor(Math.random() * 9000) + 1000}`;
    const { data } = await admin.from('users').select('id').eq('username', candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}

/** Why an avatar did not end up on the profile. Null reason = none was offered. */
export type AvatarProblem = 'too_large' | 'wrong_type' | 'upload_failed';

interface AvatarResult {
  url: string | null;
  /** Null when no file was supplied at all — the photo step is optional. */
  problem: AvatarProblem | null;
}

/** Extension by MIME type, so the stored path never inherits the filename.
 *  `file.name.split('.').pop()` put whatever the client sent into the object
 *  key — "x.foo/bar" became "<uuid>/avatar.foo/bar" — and it disagreed with
 *  contentType whenever the two did not match. */
const AVATAR_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // iPhones hand over HEIC unless the picker coerces it. Rejecting it was the
  // single most likely reason a photo vanished without a word.
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Uploads a profile photo, reporting WHY when it does not.
 *
 * Every failure used to return a bare null — oversize, wrong type, storage
 * error and "no file offered" were indistinguishable, and the callers passed
 * the null straight into the profile write. So someone whose 25 MB photo was
 * rejected finished sign-up with no picture and no message, and support could
 * not tell them apart from someone who skipped the step on purpose.
 *
 * Still never throws and never fails a sign-up: the account matters more than
 * the picture. The caller surfaces `problem` as a warning instead.
 */
async function uploadAvatar(
  admin: AdminClient,
  userId: string,
  file: FormDataEntryValue | null,
): Promise<AvatarResult> {
  if (!(file instanceof File) || file.size === 0) return { url: null, problem: null };
  if (file.size > 20 * 1024 * 1024) return { url: null, problem: 'too_large' };

  const ext = AVATAR_EXT[file.type];
  if (!ext) return { url: null, problem: 'wrong_type' };

  const path = `${userId}/avatar.${ext}`;

  const { error } = await admin.storage
    .from('avatars')
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) {
    console.error('[avatar] upload failed', { userId, type: file.type, error: error.message });
    return { url: null, problem: 'upload_failed' };
  }

  const {
    data: { publicUrl },
  } = admin.storage.from('avatars').getPublicUrl(path);

  // Cache-bust so a re-upload to the same path is not served from the CDN copy.
  return { url: `${publicUrl}?t=${Date.now()}`, problem: null };
}

/** The sentence shown next to a sign-up that otherwise succeeded. */
function avatarProblemMessage(problem: AvatarProblem): string {
  if (problem === 'too_large') return 'Your photo was over 20MB, so it was not saved.';
  if (problem === 'wrong_type') return 'That image format is not supported, so it was not saved.';
  return 'We could not save your photo.';
}

/**
 * Resolves free-text location to a `locations` row.
 *
 * The Google Places autocomplete has been dropped along with its two npm
 * packages — no NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is configured, so the live UI
 * has always fallen through to the plain-text field anyway. google_place_id is
 * NOT NULL-ish in practice and unique, so manual entries get a stable
 * synthetic key derived from the text.
 */
async function findOrCreateLocation(
  admin: AdminClient,
  text: string | undefined,
): Promise<number | null> {
  const value = text?.trim();
  if (!value) return null;

  const key = `manual:${slugify(value)}`;

  const { data: existing } = await admin
    .from('locations')
    .select('id')
    .eq('google_place_id', key)
    .maybeSingle();
  if (existing) return existing.id;

  const [city, ...rest] = value.split(',').map((p) => p.trim());
  const { data: created } = await admin
    .from('locations')
    .insert({
      google_place_id: key,
      city: city || null,
      county: rest.length > 1 ? rest[0] : null,
      country: rest.length > 0 ? rest[rest.length - 1] : null,
    })
    .select('id')
    .maybeSingle();

  return created?.id ?? null;
}

/**
 * Maps the talent's chosen passions onto canonical disciplines, creating any
 * that do not exist yet.
 *
 * This is the same path the profile skill editor uses, so a skill added at
 * sign-up and a skill added later end up as the same row.
 */
async function attachDisciplines(admin: AdminClient, userId: string, labels: string[]) {
  if (labels.length === 0) return;

  const slugs = labels.map(slugify).filter(Boolean);
  if (slugs.length === 0) return;

  await admin.from('tropical_disciplines').upsert(
    labels.map((label, i) => ({
      slug: slugs[i],
      label: label.trim(),
      category: 'other',
      is_active: true,
    })),
    { onConflict: 'slug', ignoreDuplicates: true },
  );

  await admin.from('tropical_creative_disciplines').upsert(
    slugs.map((slug, i) => ({
      user_id: userId,
      discipline_slug: slug,
      source: 'self',
      is_primary: i === 0,
    })),
    { onConflict: 'user_id,discipline_slug', ignoreDuplicates: true },
  );
}

function safeJsonArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Supabase auth errors are developer-facing; these are the ones users hit. */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'That email already has an account. Try logging in instead.';
  }
  if (m.includes('invalid login credentials')) return 'That email and password do not match.';
  if (m.includes('email not confirmed'))
    return 'Confirm your email address first - check your inbox.';
  if (m.includes('password')) return 'Password must be at least 8 characters.';
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return message;
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/**
 * Closes the signed-in account.
 *
 * Two halves, in this order, and the order is the whole design:
 *
 *   1. tropical_delete_account() (migration 040) does everything inside one
 *      transaction — the guards, the deletion record, the anonymisation of
 *      users and creative_data, the membership suspension. If any guard trips
 *      it returns a sentence and changes nothing.
 *   2. Only then is the auth user removed, which is what actually ends the
 *      ability to sign in.
 *
 * Doing (2) first would be the bug: a person whose auth user is gone but whose
 * profile still stands is locked out of an account that is still visible on
 * every roster, and there is no session left to retry with. Deleting the auth
 * user is also the one step that cannot be rolled back by a failing
 * transaction, so it goes last, after the part that can.
 *
 * What deletion means here — anonymisation rather than DELETE, and why it has
 * to — is set out at length in the header of migration 040. The short version:
 * tropical_projects.brand_id cascades, so removing the row would take other
 * people's projects, contracts and messages with it.
 */
export async function deleteAccountAction(reason?: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const supabase = await db();

  // As the user, not the service role. The RPC reads auth.uid() and takes no
  // user argument, so there is nothing here to point at somebody else.
  const { data: refusal, error } = await supabase.rpc('tropical_delete_account', {
    p_reason: reason?.trim() || null,
  });

  if (error) return fail(error.message);

  // A non-null return is a blocker the person can go and clear — money in the
  // wallet, a live project — not a failure. It is written to be shown to them.
  if (typeof refusal === 'string' && refusal.length > 0) return fail(refusal);

  // Service role: removing an auth user is not something an account can do to
  // itself through its own session.
  //
  // public.users has NO foreign key onto auth.users (see the sign-up comments
  // above), so this ends the login without touching the anonymised profile row
  // that step 1 just wrote — which is exactly what the deletion record in
  // tropical_deleted_accounts points at.
  const { error: authError } = await adminDb().auth.admin.deleteUser(viewer.id);

  // Not fatal, and deliberately not surfaced as a failure: the profile is
  // already anonymised and every membership suspended, so the account is
  // closed in every sense the user can observe. A lingering auth row is an
  // operational tidy-up, and telling them their deletion failed when it did
  // not would be worse than the log line.
  if (authError) {
    console.error(`deleteAccountAction: auth user ${viewer.id} not removed:`, authError.message);
  }

  await supabase.auth.signOut();

  return ok(null);
}

// ---------------------------------------------------------------------------
// Leaving a workspace
// ---------------------------------------------------------------------------

/**
 * Removes the viewer from one branded site.
 *
 * The exit that did not exist. Signing up on a white-label whose visibility is
 * 'public' also enrols the account into classic TropicalTalent — see the classic
 * membership upsert in writeProfile() — which puts the profile on the TropicalTalent
 * talent board and makes it reachable by Clients the person never chose to
 * work with. That is the customer's configuration, not the member's decision,
 * and until now there was no way back out of it short of closing the account.
 *
 * Guards, in the order they can trip:
 *
 *   * never the last one   — an account belonging to no workspace is signed in
 *                            and homeless: every (app) route sends it to
 *                            /auth/no-access. Someone who wants that outcome
 *                            wants to close their account, and should be told
 *                            so rather than walked into it.
 *   * never mid-engagement — a live project or a contracted role inside that
 *                            workspace has another party depending on it, and
 *                            leaving would strip the membership their RLS
 *                            reads depend on.
 *
 * Suspends rather than deletes the row. tropical_project_members and every
 * historic project page resolve who was on them through this table, so
 * deleting it would blank a client's own records of work they paid for. Status
 * 'suspended' is what every roster read already filters on.
 */
export async function leaveWorkspaceAction(tenantId: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');
  if (!tenantId) return fail('Which workspace?');

  const admin = adminDb();

  const { data: memberships } = await admin
    .from('tropical_tenant_members')
    .select('tenant_id')
    .eq('user_id', viewer.id)
    .eq('status', 'active');

  const active = (memberships ?? []).map((m) => m.tenant_id as string);

  if (!active.includes(tenantId)) {
    return fail('You are not a member of that workspace.');
  }
  if (active.length <= 1) {
    return fail(
      'This is the only workspace you belong to. Leaving it would leave you with nothing to sign in to - close your account instead if that is what you want.',
    );
  }

  // Anything live inside THAT tenant specifically. Both reads are scoped by
  // tenant as well as by user: a contract on TropicalTalent is no reason to keep
  // somebody tied to a client's workspace.
  const [{ count: liveProjects }, { count: liveRoles }] = await Promise.all([
    admin
      .from('tropical_projects')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', viewer.id)
      .eq('tenant_id', tenantId)
      .in('status', ['pending_payment', 'active']),
    admin
      .from('tropical_project_roles')
      .select('id, project:tropical_projects!inner(tenant_id)', { count: 'exact', head: true })
      .eq('assigned_user_id', viewer.id)
      .eq('project.tenant_id', tenantId)
      .in('status', ['accepted', 'delivered', 'approved']),
  ]);

  if ((liveProjects ?? 0) > 0) {
    return fail('You have live projects in this workspace. Complete or cancel them first.');
  }
  if ((liveRoles ?? 0) > 0) {
    return fail('You are contracted on a role in this workspace. Finish or leave it first.');
  }

  const { error } = await admin
    .from('tropical_tenant_members')
    .update({ status: 'suspended' })
    .eq('user_id', viewer.id)
    .eq('tenant_id', tenantId);

  if (error) return fail(error.message);

  revalidatePath('/', 'layout');
  return ok(null);
}

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

/**
 * Everything we hold that is keyed to the viewer, as JSON.
 *
 * The portability right the privacy policy grants and nothing could execute.
 * Returns a string rather than writing a file: the browser turns it into a
 * download, so the data never touches our disk and there is no object sitting
 * in a bucket waiting to be found by whoever guesses the URL.
 *
 * ---------------------------------------------------------------------------
 * What is in it, and what deliberately is not
 * ---------------------------------------------------------------------------
 * Every table below is filtered on the viewer's own id. That is the line, and
 * it is narrower than "everything about me feels like mine":
 *
 *   * messages they SENT are included; the replies are the other party's.
 *   * projects they OWN are included, with the role rows, because those are
 *     the terms they agreed. The other members' profiles are not.
 *   * a dispute or complaint they RAISED is included. One raised ABOUT them is
 *     not — disclosing it would hand the subject of a conduct report the
 *     reporter's account of it, which is the thing that stops people
 *     reporting.
 *
 * Article 20 is a right to the data you provided, not to everyone else's view
 * of you, and the second reading would make the export a weapon.
 *
 * Runs through the service role because several of these tables restrict a
 * signed-in user to a narrower slice than the export is entitled to return —
 * every query is pinned to viewer.id, which is the only thing that makes that
 * safe.
 */
export async function exportMyDataAction(): Promise<ActionResult<{ json: string }>> {
  const viewer = await getViewer();
  if (!viewer) return fail('You need to be signed in.');

  const admin = adminDb();
  const id = viewer.id;

  const mine = <T>(p: PromiseLike<{ data: T | null }>) => p;

  const [
    profile,
    creative,
    disciplines,
    memberships,
    projects,
    roles,
    applications,
    messages,
    balance,
    transactions,
    preferences,
    referrals,
    complaints,
    acceptances,
  ] = await Promise.all([
    mine(admin.from('users').select('*').eq('id', id).maybeSingle()),
    mine(admin.from('creative_data').select('*').eq('user_id', id).maybeSingle()),
    mine(admin.from('tropical_creative_disciplines').select('*').eq('user_id', id)),
    mine(admin.from('tropical_tenant_members').select('*').eq('user_id', id)),
    mine(admin.from('tropical_projects').select('*').eq('brand_id', id)),
    mine(admin.from('tropical_project_roles').select('*').eq('assigned_user_id', id)),
    mine(admin.from('tropical_applications').select('*').eq('user_id', id)),
    mine(admin.from('tropical_channel_messages').select('*').eq('sender_id', id)),
    mine(admin.from('tropical_user_balances').select('*').eq('user_id', id).maybeSingle()),
    mine(admin.from('tropical_balance_transactions').select('*').eq('user_id', id)),
    mine(admin.from('tropical_notification_preferences').select('*').eq('user_id', id).maybeSingle()),
    mine(admin.from('tropical_referrals').select('*').eq('referred_id', id)),
    mine(admin.from('tropical_complaints').select('*').eq('raised_by', id)),
    mine(admin.from('tropical_terms_acceptances').select('*').eq('user_id', id)),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account_id: id,
    email: viewer.email,
    // Said in the file itself, because someone reading this months later will
    // otherwise assume an omission is a deletion.
    note: 'Contains the data held about this account. Records that belong jointly to another party - messages they sent you, reports raised about you, and their side of a contract - are theirs and are not included. Payment and contract records are retained under our Privacy Policy even after an account is closed.',
    profile: profile.data,
    creative_profile: creative.data,
    disciplines: disciplines.data ?? [],
    workspaces: memberships.data ?? [],
    projects_you_created: projects.data ?? [],
    roles_you_held: roles.data ?? [],
    applications: applications.data ?? [],
    messages_you_sent: messages.data ?? [],
    wallet: balance.data,
    transactions: transactions.data ?? [],
    email_preferences: preferences.data,
    referral: referrals.data ?? [],
    complaints_you_raised: complaints.data ?? [],
    terms_accepted: acceptances.data ?? [],
  };

  return ok({ json: JSON.stringify(payload, null, 2) });
}
