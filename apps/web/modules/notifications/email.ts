import 'server-only';

import { Resend } from 'resend';
import { adminDb } from '@/lib/supabase';
import { siteUrl } from '@/lib/urls';
import { getTenant } from '@/modules/tenancy/queries';
import { requestOrigin, tenantOrigin } from '@/modules/tenancy/urls';
import { safeColour, wordmark } from '@/modules/tenancy/theme';
import { showsPoweredBy } from '@/modules/tenancy/types';
import type { Tenant } from '@/modules/tenancy/types';
import { unsubscribeToken } from '@/lib/unsubscribe';
import type { NotificationKind } from './queries';

/**
 * Email, the side effect layered on top of the in-app notification.
 *
 * Every call site already has an in-app tropical_notifications row for the same
 * event (written by the RPC it just called, or by the action itself) — this
 * module never decides IF something happened, only whether to also email
 * about it. That split is why a Resend outage cannot break anything: every
 * function here fails closed into a silent no-op, the same principle
 * recordReferral() uses in modules/identity/actions.ts ("a referral that
 * fails to attach is a support question, not a failed sign-up").
 *
 * Preference and recipient-address lookups both go through adminDb(),
 * deliberately not db() — the caller here is whoever performed the
 * triggering action (a brand releasing a role, say), not the recipient being
 * emailed, so the recipient's own RLS session is not available. This is
 * exactly the "operation a signed-in user cannot perform as themselves" case
 * adminDb() exists for.
 */

let resendClient: Resend | null = null;

function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient ??= new Resend(key);
  return resendClient;
}

/**
 * Whether to send this person a SERVICE email — a role assigned, work
 * delivered, a payout completed.
 *
 * Reads email_enabled and deliberately not marketing_enabled. Since 042 those
 * are two different questions, and conflating them is what made the old
 * opt-out unusable: the only way to escape a re-engagement nudge was to switch
 * off the notification saying your money had arrived.
 */
async function isEmailEnabled(userId: string): Promise<boolean> {
  const { data } = await adminDb()
    .from('tropical_notification_preferences')
    .select('email_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  // No row = never opted out.
  return data?.email_enabled ?? true;
}

/**
 * Plain, dependency-free HTML shell. No design system — this is one wrapper
 * reused by every kind, not a template per kind.
 *
 * `path` is relative (e.g. `/projects/xyz`, `/wallet`) — resolved against the
 * brand's own origin here rather than by each call site, so a call site only
 * ever says WHERE in the app the email is about, never the full URL.
 */
interface EmailBrand {
  name: string;
  mark: string;
  /** CTA background. A tenant colour when it passes the palette allowlist. */
  cta: string;
  poweredBy: boolean;
  slug: string;
  /**
   * The origin the CTA links to.
   *
   * Was siteUrl() — the platform env var — for every email this app has ever
   * sent, including ones whose header, colours and sender were the tenant's.
   * So a white-label contractor got an Acme-branded email whose only button
   * took them to tropicaltalent.dev: a host their session does not cover and a
   * tenant they are not a member of, which answers with /auth/no-access.
   */
  origin: string;
  /** A verified per-tenant sender, when the tenant has one. */
  from?: string;
}

/** TropicalTalent's own branding, and the fallback for anything sent without a request. */
const CLASSIC_BRAND: Omit<EmailBrand, 'origin'> = {
  name: 'TropicalTalent',
  mark: 'TROPICALTALENT',
  cta: '#18181b',
  poweredBy: false,
  slug: 'tropicaltalent',
};

/**
 * One tenant by id, shaped like getTenant()'s result.
 *
 * Service role, because the caller here is a cron or a webhook with no session
 * — the same reason every other read in this file uses adminDb(). Returns null
 * rather than throwing; a branding lookup must never be able to fail a send.
 */
async function tenantById(tenantId: string): Promise<Tenant | null> {
  const { data } = await adminDb()
    .from('tropical_tenants')
    .select('id, slug, name, is_classic, theme, branding')
    .eq('id', tenantId)
    .maybeSingle();

  if (!data) return null;

  // Only the fields the branding helpers read. The rest of Tenant is not
  // needed here and fetching it would widen the query for nothing.
  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    isClassic: Boolean(data.is_classic),
    status: 'active',
    archetype: 'classic',
    // Not selected above and not read by any branding helper. Private is the
    // safe filler for a field this shape does not carry.
    visibility: 'private',
    theme: asObject(data.theme),
    branding: asObject(data.branding),
    features: {},
    platformFeePct: 0,
    partnerSharePct: 0,
  };
}

/** jsonb columns are `unknown` until proven otherwise; never trust the shape. */
function asObject<T>(value: unknown): T {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : ({} as T);
}

/**
 * Branding for an outbound email.
 *
 * Two sources, and which one applies is the caller's to say:
 *
 *   * no `tenantId` — resolve from the REQUEST's tenant. Right for everything
 *     a user triggers (releasing a role, answering an invite, funding escrow),
 *     because the request arrived on that tenant's hostname.
 *   * `tenantId` given — resolve from that tenant directly. Required for work
 *     with no browser in front of it: a Vercel cron's Host header is the
 *     deployment's own and resolves to classic, and a payment provider webhook arrives
 *     on whichever host payment provider was configured with. Both send mail, and both
 *     used to send it in TropicalTalent's colours with a TropicalTalent link.
 *
 * Never throws: email is a side effect that must not be able to fail the
 * action that triggered it, and that includes failing to work out a colour.
 */
async function emailBrand(tenantId?: string | null): Promise<EmailBrand> {
  try {
    const tenant = tenantId ? await tenantById(tenantId) : await getTenant();

    // The origin has to follow the same source as the branding, or a
    // cron-sent email carries Acme's colours and a TropicalTalent link.
    const origin = tenantId ? await tenantOrigin(tenantId) : await requestOrigin();

    if (!tenant || tenant.isClassic) return { ...CLASSIC_BRAND, origin };

    return {
      name: tenant.name,
      mark: wordmark(tenant).toUpperCase(),
      cta: safeColour(tenant.theme.primary) ?? CLASSIC_BRAND.cta,
      poweredBy: showsPoweredBy(tenant),
      slug: tenant.slug,
      origin,
      from: tenant.branding.fromEmail?.trim() || undefined,
    };
  } catch {
    return { ...CLASSIC_BRAND, origin: siteUrl() };
  }
}

/**
 * The From header.
 *
 * RESEND_FROM_EMAIL is one global verified address. A white-label sending as
 * itself needs its own domain verified with Resend, which is an onboarding
 * step and not something this code can assume has happened — so until then a
 * tenant sends as "Acme via TropicalTalent", which is honest, deliverable, and does not
 * silently fail SPF the way spoofing their domain would.
 *
 * Once branding.fromEmail is set AND verified, that address is used directly.
 */
function senderFor(brand: EmailBrand, fallback: string): string {
  if (brand.from) return brand.from;
  if (brand.name === CLASSIC_BRAND.name) return fallback;

  // Display name only — the address stays the verified one.
  const address = fallback.includes('<') ? fallback.slice(fallback.indexOf('<')) : `<${fallback}>`;
  return `${brand.name} via TropicalTalent ${address}`;
}

/**
 * @param unsubscribeUrl  Present ONLY on marketing email. Its presence is what
 *                        switches the footer from "manage these on your
 *                        profile" to a one-click opt-out, so a service email
 *                        can never accidentally offer to stop itself.
 */
function renderEmail(
  subject: string,
  body: string,
  path: string,
  brand: EmailBrand,
  unsubscribeUrl?: string,
): string {
  const url = new URL(path, brand.origin).toString();

  // escapeHtml on every interpolated value, brand included: the wordmark and
  // name come from tenant jsonb, and the CTA colour is allowlisted by
  // safeColour() before it reaches a style attribute.
  // No platform credit footer in this reference build: the "Powered by"
  // link was removed with the old brand footers.
  const footer = '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:28px 28px 8px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#71717a;">${escapeHtml(brand.mark)}</td>
      </tr>
      <tr>
        <td style="padding:8px 28px 4px;font-size:18px;font-weight:600;">${escapeHtml(subject)}</td>
      </tr>
      <tr>
        <td style="padding:8px 28px 20px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(body)}</td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px;">
          <a href="${url}" style="display:inline-block;padding:10px 20px;border-radius:8px;background:${brand.cta};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
            View in ${escapeHtml(brand.name)}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px;border-top:1px solid #e4e4e7;font-size:11px;color:#a1a1aa;">
          ${
            unsubscribeUrl
              ? `You are receiving this because you have an account with ${escapeHtml(brand.name)}.
                 <a href="${unsubscribeUrl}" style="color:#a1a1aa;">Unsubscribe</a> from emails like this one.
                 You will still get the emails about your account.`
              : 'Turn these off any time from your profile page.'
          }${footer}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');
}

/**
 * Sends one notification email. Never throws — a failed send is logged and
 * swallowed so it can never fail or roll back the action that triggered it.
 */
export async function sendNotificationEmail({
  userId,
  kind,
  subject,
  body,
  path = '/',
  tenantId,
}: {
  userId: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  /** Relative path the email's button links to, e.g. `/projects/xyz`. Defaults to the homepage. */
  path?: string;
  /**
   * Brand and link as THIS tenant rather than the request's.
   *
   * Only needed where there is no meaningful request: a cron, a payment provider
   * webhook. Every user-triggered call should leave it unset — the hostname
   * they are on is a better answer than any id the call site could guess.
   */
  tenantId?: string | null;
}): Promise<void> {
  try {
    const client = resend();
    const from = process.env.RESEND_FROM_EMAIL;
    if (!client || !from) {
      // Silent no-op here used to be indistinguishable from "sent fine" —
      // this is the one warning worth keeping even though everything else in
      // this function fails quietly, because it means email is not merely
      // skipped for this user, it is off for the whole app.
      console.warn(
        `sendNotificationEmail(${kind}): RESEND_API_KEY or RESEND_FROM_EMAIL is not set — skipping.`,
      );
      return;
    }

    if (!(await isEmailEnabled(userId))) return;

    const { data } = await adminDb().auth.admin.getUserById(userId);
    const email = data.user?.email;
    if (!email) {
      console.warn(`sendNotificationEmail(${kind}): no email on file for user ${userId}.`);
      return;
    }

    const brand = await emailBrand(tenantId);
    await client.emails.send({
      from: senderFor(brand, from),
      to: email,
      subject,
      html: renderEmail(subject, body, path, brand),
    });
  } catch (err) {
    console.error(`sendNotificationEmail(${kind}) failed for user ${userId}:`, err);
  }
}

/**
 * Fans a notification out to every member of a project, minus whoever
 * triggered it. The multi-recipient case (deliverables updated, project
 * completed) — mirrors the SQL side's `WHERE m.user_id <> v_caller` pattern.
 */
export async function notifyProjectMembers({
  projectId,
  excludeUserId,
  kind,
  subject,
  body,
  path = `/projects/${projectId}`,
  tenantId,
}: {
  projectId: string;
  excludeUserId?: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  path?: string;
  /** See sendNotificationEmail — request-less callers only. */
  tenantId?: string | null;
}): Promise<void> {
  const { data: members } = await adminDb()
    .from('tropical_project_members')
    .select('user_id')
    .eq('project_id', projectId);

  await Promise.all(
    (members ?? [])
      .filter((m) => m.user_id !== excludeUserId)
      .map((m) =>
        sendNotificationEmail({ userId: m.user_id, kind, subject, body, path, tenantId }),
      ),
  );
}

export interface BulkEmailResult {
  sent: number;
  skippedOptedOut: number;
  skippedNoEmail: number;
  failed: number;
}

/**
 * Sends the same subject/body to many users at once — the admin dashboard's
 * "user comms" broadcasts, not tied to any single event. Uses Resend's batch
 * endpoint (up to 100 recipients per call) rather than one sendNotificationEmail()
 * per recipient, since a broadcast can reach the whole user base and looping
 * individual sends would be both slow and more likely to hit a rate limit.
 *
 * Still respects the per-user email preference — a broadcast is exactly the
 * kind of email the master "email me about activity" switch should also
 * gate, even though it is not triggered by an in-app event the way every
 * other call in this file is.
 */
export async function sendBulkEmail({
  userIds,
  subject,
  body,
  path = '/',
}: {
  userIds: string[];
  subject: string;
  body: string;
  path?: string;
}): Promise<BulkEmailResult> {
  const client = resend();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!client || !from) {
    console.warn('sendBulkEmail: RESEND_API_KEY or RESEND_FROM_EMAIL is not set - skipping.');
    return { sent: 0, skippedOptedOut: 0, skippedNoEmail: 0, failed: userIds.length };
  }

  const admin = adminDb();
  const [{ data: prefs }, { data: authUsers }] = await Promise.all([
    admin.from('tropical_notification_preferences').select('*').in('user_id', userIds),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  // marketing_enabled, NOT email_enabled. This function sends the four canned
  // outreach templates, which are marketing — including the inactivity nudge,
  // which is selected on when someone last signed in and is therefore
  // profiling. Reading the service-email flag here was the bug: it meant the
  // only way to stop marketing was to also stop being told your money moved.
  //
  // The fallback to email_enabled is not belt-and-braces, it is the safe
  // direction. Until 042 is applied there is no marketing_enabled column, and
  // a row read that finds nothing must not be taken as consent — that would
  // silently mail everyone who had already opted out under the old single
  // switch. Absent the new column, the old one still governs.
  const optedOut = new Set(
    (prefs ?? [])
      .filter((p) => {
        const row = p as { marketing_enabled?: boolean; email_enabled?: boolean };
        if (typeof row.marketing_enabled === 'boolean') return !row.marketing_enabled;
        return row.email_enabled === false;
      })
      .map((p) => (p as { user_id: string }).user_id),
  );
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]));

  // Kept as pairs rather than a list of addresses: the unsubscribe token is
  // per recipient, so the id has to survive as far as the send.
  const recipients: Array<{ id: string; email: string }> = [];
  let skippedOptedOut = 0;
  let skippedNoEmail = 0;
  for (const id of userIds) {
    if (optedOut.has(id)) {
      skippedOptedOut++;
      continue;
    }
    const email = emailById.get(id);
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    recipients.push({ id, email });
  }

  const brand = await emailBrand();
  const sender = senderFor(brand, from);
  let sent = 0;
  let failed = 0;

  // Resend's batch endpoint caps at 100 emails per call.
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    try {
      await client.batch.send(
        chunk.map(({ id, email }) => {
          // Per recipient, so the body and the headers are built inside the
          // map rather than once above it.
          const token = unsubscribeToken(id);
          const unsubscribeUrl = token
            ? `${brand.origin}/unsubscribe?t=${encodeURIComponent(token)}`
            : undefined;

          return {
            from: sender,
            to: email,
            subject,
            html: renderEmail(subject, body, path, brand, unsubscribeUrl),
            // What makes Gmail and Apple Mail show their own Unsubscribe
            // control beside the sender. List-Unsubscribe-Post is the half
            // that makes it one click rather than a trip to the browser —
            // without it the client shows the button and then opens the link
            // anyway, which is not what "one-click" means to a regulator.
            ...(unsubscribeUrl
              ? {
                  headers: {
                    'List-Unsubscribe': `<${unsubscribeUrl}>`,
                    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                  },
                }
              : {}),
          };
        }),
      );
      sent += chunk.length;
    } catch (err) {
      console.error('sendBulkEmail: batch failed:', err);
      failed += chunk.length;
    }
  }

  return { sent, skippedOptedOut, skippedNoEmail, failed };
}

// ---------------------------------------------------------------------------
// Roster invitations
// ---------------------------------------------------------------------------

export interface InviteEmailResult {
  sent: number;
  failed: number;
}

/**
 * Tells a roster they can join, in their own client's branding.
 *
 * Migration 031 refused to email invitations, and the reasons it gave were
 * about Supabase's auth invite endpoint specifically: one rate-limited mail
 * per address, and a magic link that expires before half of 600 people get to
 * it. None of that applies here. This sends a plain Resend message containing
 * the tenant's ordinary sign-in URL — no token, no expiry, nothing to burn —
 * so a link found three weeks later still works, and Resend batches a hundred
 * addresses per call instead of one request each.
 *
 * The other objection 031 raised does still hold, and is handled rather than
 * dismissed: putting TropicalTalent in the middle of a conversation between a client
 * and their own contractors. senderFor() sends as the tenant's verified
 * address when it has one and as "<Tenant> via TropicalTalent" when it does not, and
 * the body never mentions TropicalTalent unless that tenant shows a powered-by.
 *
 * Recipients are addresses, not user ids: the whole point of an invite is that
 * these people have no account yet, so there is no id and no notification
 * preference row to check. That also means there is nothing to opt out of —
 * which is why the caller makes this a deliberate choice rather than a side
 * effect of pasting a roster.
 *
 * Never throws. A roster that is recorded but not emailed is a worse outcome
 * than one that is emailed twice, and neither is worth losing the invites for.
 */
export async function sendInviteEmails({
  tenantId,
  emails,
}: {
  tenantId: string;
  emails: string[];
}): Promise<InviteEmailResult> {
  if (emails.length === 0) return { sent: 0, failed: 0 };

  const client = resend();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!client || !from) {
    console.warn('sendInviteEmails: RESEND_API_KEY or RESEND_FROM_EMAIL is not set - skipping.');
    return { sent: 0, failed: emails.length };
  }

  const brand = await emailBrand(tenantId);
  const sender = senderFor(brand, from);
  const subject = `You've been invited to ${brand.name}`;
  const html = renderInviteEmail(brand);

  let sent = 0;
  let failed = 0;

  // Resend's batch endpoint caps at 100 emails per call.
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    try {
      await client.batch.send(chunk.map((to) => ({ from: sender, to, subject, html })));
      sent += chunk.length;
    } catch (err) {
      console.error('sendInviteEmails: batch failed:', err);
      failed += chunk.length;
    }
  }

  return { sent, failed };
}

/**
 * Its own template rather than renderEmail().
 *
 * That one closes with "Turn these off any time from your profile page", which
 * is addressed to someone who has an account and a preferences row. The
 * recipient here has neither — the mail exists precisely because they have not
 * signed up — so the footer would point at a page they cannot reach, and the
 * CTA's "View in <brand>" would describe something they cannot view yet.
 */
function renderInviteEmail(brand: EmailBrand): string {
  const url = new URL('/auth/sign-in', brand.origin).toString();
  const name = escapeHtml(brand.name);

  // No platform credit footer in this reference build: the "Powered by"
  // link was removed with the old brand footers.
  const footer = `You're receiving this because someone at ${name} added your address.`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:28px 28px 8px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#71717a;">${escapeHtml(brand.mark)}</td>
      </tr>
      <tr>
        <td style="padding:8px 28px 4px;font-size:18px;font-weight:600;">You've been invited to ${name}</td>
      </tr>
      <tr>
        <td style="padding:8px 28px 20px;font-size:14px;line-height:1.6;color:#3f3f46;">
          Your email address has been added to ${name}. Create your account with this address and you'll go straight in - the link doesn't expire, so you can come back to it whenever suits.
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px;">
          <a href="${url}" style="display:inline-block;padding:10px 20px;border-radius:8px;background:${brand.cta};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
            Join ${name}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px;border-top:1px solid #e4e4e7;font-size:11px;color:#a1a1aa;">
          ${footer}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The one email a new account gets from us.
 *
 * There was no welcome email at all — the only mail a new user had ever
 * received was Supabase's own confirmation link, so the first thing the
 * product ever said to anyone was a verification prompt.
 *
 * It lives HERE rather than in identity/actions.ts, and that is not
 * organisational taste. Every async export of a `'use server'` module is
 * published as a callable HTTP endpoint, so exporting this from there made
 * "send a welcome to an arbitrary user id" a public route that did not
 * re-authenticate — against this repo's own rule that every server action
 * re-authenticates because it is a public endpoint. This module is
 * `server-only` without `'use server'`, so the function is reachable from
 * server code and from nowhere else.
 *
 * Email-only, deliberately: no tropical_notifications row is written, because an
 * in-app bell saying "welcome" the instant you arrive is noise, and 'welcome'
 * is correspondingly absent from that table's kind CHECK constraint.
 *
 * Never throws and never blocks a sign-up: sendNotificationEmail swallows its
 * own failures, respects the per-user opt-out, and no-ops with a warning when
 * RESEND_API_KEY is unset. The account is what the person came for.
 */
export async function sendWelcomeEmail(
  userId: string,
  name: string,
  role: 'creative' | 'brand',
  tenant: { id: string; name: string },
): Promise<void> {
  // Claim first, send second, and let the INSERT be the claim.
  //
  // This is called from three places and one of them, /auth/callback, runs on
  // every sign-in for the rest of the account's life. A read-then-write check
  // would also leave a window for two concurrent callbacks to both send.
  // ON CONFLICT DO NOTHING returns a row only to whoever actually inserted.
  const { data: claimed } = await adminDb()
    .from('tropical_welcome_emails')
    .insert({ user_id: userId, tenant_id: tenant.id })
    .select('user_id')
    .maybeSingle();

  if (!claimed) return;

  const first = name.trim().split(/\s+/)[0] || 'there';

  // Where a new account should go FIRST differs by side of the marketplace, so
  // the copy and the button do too. homeForSignup() decides where the app drops
  // them; this is the same destination said in words.
  const body =
    role === 'creative'
      ? `Hi ${first}, welcome to ${tenant.name}.\n\n` +
        `Your profile is live. Two things worth doing now: add the skills you want to be found for, ` +
        `and add a photo if you skipped it — both are what briefs get matched against.\n\n` +
        `Browse the open briefs whenever you're ready.`
      : `Hi ${first}, welcome to ${tenant.name}.\n\n` +
        `Your account is ready. When you post a brief, you'll be matched with creatives who work in ` +
        `the disciplines you need, and payment is held in escrow until you approve the work.\n\n` +
        `Start whenever you like.`;

  // tenantId is left unset so the branding and the CTA origin come from the
  // host the person actually signed up on — see sendNotificationEmail's note.
  // Passing an id here is how a white-label's new member gets a TropicalTalent-branded
  // welcome.
  await sendNotificationEmail({
    userId,
    kind: 'welcome',
    subject: `Welcome to ${tenant.name}`,
    body,
    path: role === 'creative' ? '/briefs' : '/create',
  });
}
