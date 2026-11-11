# White-label runbook

How to stand up a white-label, and the platform configuration it depends on.

Everything in **Part 1** is done once, in dashboards, by someone with the
relevant account access. Everything in **Part 2** is done per customer, in the
app, and takes minutes.

---

## Part 1 — Platform setup (once)

These four are the difference between the tenancy code working locally and
working in production. Nothing in the codebase can do them for you.

### 1. Wildcard subdomain on Vercel

Add `*.tropicaltalent.dev` as a domain on the project. Vercel issues a wildcard
certificate, and every `<slug>.tropicaltalent.dev` then resolves without any further DNS
work per customer — which is what makes creating a tenant a form rather than a
ticket.

Without this, a new tenant's hostname does not resolve at all and
`getTenant()` never sees it.

### 2. Supabase Auth redirect allowlist

> **This is the single most common cause of "the white-label just sends me back
> to TropicalTalent".** Nothing in the codebase can work around it. Do it before the
> first customer, and re-check it every time a custom domain is added.

**Authentication → URL Configuration → Redirect URLs**, add:

```
https://*.tropicaltalent.dev/**
```

Three separate flows build a `redirectTo` from the requesting host — sign-up
confirmation (`emailRedirectTo`, `modules/identity/actions.ts`), password reset
(`requestPasswordResetAction`) and Google OAuth
(`components/waitlist/google-button.tsx`). Supabase silently rewrites any
redirect not on this list back to the project's **Site URL**, so without the
wildcard all three land a customer's user on tropicaltalent.dev — confusing at
best, and it looks like a phishing redirect at worst.

Sign-up is the one that fails outright rather than merely looking wrong. The
session exchange is PKCE: the code-verifier cookie is written on the _tenant's_
host and does not exist on the classic one, so a confirmation link rewritten to
the Site URL cannot be exchanged at all. The user gets
`/auth/sign-in?error=exchange_failed`, on the wrong brand, with no way forward.

Add each custom domain here too, as they are added.

**Site URL** itself should stay the classic apex. It is only the fallback for
anything not on the allowlist, and pointing it at a customer's domain would send
TropicalTalent's own users there.

### 2b. The wildcard domain must be SERVED, not redirected

On Vercel, a domain can be attached as a served domain or as a _redirect_ to
another one. If `*.tropicaltalent.dev` is attached as a redirect to the primary domain,
every white-label request 308s to tropicaltalent.dev before Next.js ever runs —
which looks exactly like an application bug and is not one. Check
**Project → Settings → Domains**: the wildcard row must have no "Redirect to"
target.

### 3. `CRON_SECRET`

Set it on the Vercel project. `vercel.json` schedules two crons:

| Path                          | Schedule    | What it does                            |
| ----------------------------- | ----------- | --------------------------------------- |
| `/api/cron/project-checkins`  | `0 9 * * 1` | Weekly digest (skips retainer projects) |
| `/api/cron/retention`         | `0 4 * * 0` | Retention job                           |

(The recurring-billing cron is gone with payments in this reference build.)
Each returns 401 without the bearer token, and 503
if the variable is unset — so an unset secret fails closed rather than running
unauthenticated.

### 4. Resend

`RESEND_FROM_EMAIL` is the platform sender and the fallback. A tenant that
wants mail from its own address needs that domain verified in Resend first;
until then `senderFor()` sends as `Acme via TropicalTalent <platform address>`, which
is deliverable. Setting `branding.fromEmail` before the domain is verified
means mail fails SPF — verify first, then set it.

---

## Part 2 — Onboarding a customer

### Step 1: Create the tenant

`/admin/tenants/new`, as a TropicalTalent super admin.

Pick the shape first — it seeds the feature flags and what new members may do:

| Archetype               | Worker                 | Payer               | Brief feed        |
| ----------------------- | ---------------------- | ------------------- | ----------------- |
| Contractors + companies | Contractor, earns only | Company, hires only | off               |
| Talent + brands      | Talent, earns only   | Brand, hires only   | on, tenant-scoped |

Then name, slug, host, colours, fee and partner share. **Partner share is a
percentage OF the fee, not of the pot**: 15% fee with a 33% share is roughly 5%
of the project value going to the partner.

The site is live on save. No deploy, no migration.

### Step 2: Decide who may sign themselves up

A white-label's sign-in link goes on the customer's own public website, so
whatever the sign-up form allows, the public can do. Two flags, and they answer
different questions:

| Flag                               | Effect                                                                                                                       | Use when                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `features.inviteOnly = true`       | Only pre-authorised emails may sign up at all. Anyone else is refused before an account exists.                              | The customer has a known roster (Step 3).                                               |
| `features.selfServeBrands = false` | Workers may sign themselves up; payers may not. The hiring side disappears from the wizard and the server action refuses it. | The customer's contractors self-serve but their client companies are onboarded by hand. |

An invite always overrides `selfServeBrands` — an admin who put someone on the
roster as a payer has already made that decision.

Both are refused **before** the Supabase account is created, so a rejected
person can try again later with the same address once they are invited.

### Step 3: Load the roster

`/admin/tenants/<id>` → Roster. Paste a spreadsheet column, a CSV, or a list —
addresses are extracted, so the format does not matter. Choose whether they
join as workers or payers, and tick the admin box for the customer's own
managers.

**Nothing is emailed from here.** The rows record who is _allowed_ to join. The
customer sends their own people the sign-in link, which is how this was asked
for and avoids 600 rate-limited Supabase invitations landing in spam folders.
The page shows the exact link to send.

As people sign up they are matched to their invite by email and get the role
and capabilities it was created with. The roster page shows how many have
arrived.

### Step 4: Custom domain (optional)

1. Add the domain to the Vercel project.
2. Customer points a CNAME at Vercel.
3. Add it to the Supabase redirect allowlist (Part 1, step 2).
4. Insert a `tropical_tenant_domains` row for it.

Set `is_primary` on whichever host should appear in outbound links.

> Host resolution does **not** currently check `verified_at` — it is a record
> of what was checked, not a gate. A row is live the moment it exists, so do
> not add one before the DNS actually points at us.

---

## Verifying a tenant

```bash
npm run verify           # every shipping query, as real signed-in users
npm run verify:tenancy   # cross-tenant isolation, with its own fixture
```

`verify:tenancy` creates a second tenant, asserts that neither side can see the
other, and tears itself down. Two assertions are worth knowing:

- _"talent with NO tenant filter still returns nothing"_ — it removes the
  app-layer filter and confirms RLS alone holds the line.
- _"project created through the RPC lands in the right tenant"_ — the fixture
  project is created by calling `tropical_create_project` as the signed-in brand,
  not by a service-role insert with `tenant_id` set by hand. That distinction
  matters: for a while the RPC did not set `tenant_id` at all, every white-label
  project fell to the classic default, and the isolation suite passed anyway
  because its fixture set the column itself. Do not "simplify" it back.

Then, by hand:

- Open the tenant's host. The palette, logo and wordmark should be theirs, with
  no flash of TropicalTalent's colours first.
- "Powered by TropicalTalent" in the sidebar, linking out with `utm_source=<slug>`.
- Sign in as someone from another tenant → `/auth/no-access`, naming this
  workspace and no other.
- Sign up with a fresh address. The confirmation email must link back to **this
  host** — if it points at tropicaltalent.dev, Part 1 §2 is not done.
- Create a project, then check it appears in the tenant's own feed. If it does
  not, `tropical_projects.tenant_id` is the first thing to look at.
- Trigger any notification email (invite someone to a role). Header, colours and
  the CTA link should all be the tenant's.

---

## Recurring pay, before the first live run

The pay run charges real cards. Exercise it in payment provider test mode first:

- A period funds ~3 days before it starts (`FUND_LEAD_DAYS`), so the money is
  taken before the work.
- A `card_declined` test method must leave the project **active** and the group
  channel **open** — a funding problem is a banner, never a lockout. This is
  the invariant the whole design rests on; see the header of migration 027.
- Re-running the cron must not double-charge. Three things prevent it: the row
  is claimed (`scheduled → funding`) before payment provider is called, the call carries
  an idempotency key, and `UNIQUE (role_id, period_start)` blocks a duplicate
  row.
- After three consecutive failures the role pauses. Pausing stops the _next_
  period. It never claws back a funded one.
