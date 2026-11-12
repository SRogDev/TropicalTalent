# User Workflows — Cubora (Phase 1: accounts, onboarding & roles)

**Status:** Phase 1 (Brand & Foundation). This file is the Phase 1 record
of the account and role model. The other product docs
(`vision.md`, `product-requirements.md`, `commercial-model.md`) are owned
by later phases. Source: `CUBORA_PLAN.md` §6, `CUBORA_SPEC_ANALYSIS.md`
§4.5 (MUST S35/S36), and the implementation in `modules/identity/` +
`components/waitlist/` + `components/tropical/role-switcher.tsx`.

## The role model

One account, two roles. The roles are **capabilities, not identity** —
an account holds either or both, and the two sides are independent of
each other:

| Cubora role | What it means | Inherited capability | Legacy `users.role` |
|---|---|---|---|
| **Consumer** | Buy / hire — request talent, services, products | `brand` (may create projects, browse talent, invite) | `brand` |
| **Provider** | Offer work — talent, services, products, production | `work` (may apply to briefs, hold roles, appear in search) | `creative` |

The mapping lives in exactly one place, `modules/identity/roles.ts`
(`cuboraRolesFor`, `activateRole`, `roleHome`, `roleLabel`), covered by
`modules/identity/roles.test.ts`. No new database column was added: the
capabilities already live on the tenant membership row
(`tropical_tenant_members.capabilities`: `{ brand, work }`), and the
module is the pure mapping over them.

**Deliberately not modelled yet** (OPEN in the spec, decided by later
phases): the fee model (O1), what "securing a contact" means (O2), fee
timing (O3), contact-release conditions (O4), what "verified" means (O6).
Nothing in this file answers them, and no UI in Phase 1 implies an
answer.

## Onboarding: what do you want to do first?

Both entry points — password sign-up (`SignUpDialog`) and OAuth profile
completion (`CompleteProfile` → `/auth/complete`) — ask the same first
question, in the role step (`components/waitlist/steps.tsx`, `RoleStep`):

> **What do you want to do first?**
> One account can do both. Pick what you want to do first — you can
> activate the other role later from your profile.

The two cards are the tenant's own words for the two sides (classic
Cubora: "Talent" / "Brand"; a contractor white-label: "Contractor" /
"Company"). The choice is recorded exactly as before — the sign-up form
still writes `role: 'creative' | 'brand'` and the membership capabilities
follow the tenant archetype (`capabilitiesForSignup` in
`modules/tenancy/presets.ts`). What changed in Phase 1 is the question
itself: it now names the Cubora roles and promises the second role is
available later, instead of presenting a permanent either/or.

The rest of onboarding is unchanged: name → role → role-specific detail
(company blurb for consumers; passions, bio, location, photo for
providers) → optional referral → terms acceptance → profile completion.
There is no separate onboarding wizard — the audit found none, and
building one is not Phase 1.

### Individual vs business profiles

The plan requires both individual and business profiles. Phase 1 records
the distinction where the schema already supports it and does not invent
storage where it does not:

- **Consumer/business:** a consumer account writes a `brand_data` row
  (`type: 'other_business'`). A business adds its description in the
  company-blurb step.
- **Provider/individual:** a provider account writes a `creative_data`
  row (bio, tags, location, showreel, verification).
- **Not yet stored:** an explicit individual-vs-business flag on the
  account, business documentation, languages spoken, and provider
  verification evidence. Those belong to the Phase 1 core data model /
  Phase 2 provider profiles, and need a migration against a live database
  before they can be collected honestly. The onboarding copy does not
  claim to collect them.

## Switching roles, activating the other role

In the app shell, under the navigation groups, the **role switcher**
(`components/tropical/role-switcher.tsx`) shows:

- **Both roles held** (the classic Cubora shape — every classic account
  gets both capabilities at sign-up): two links, "Switch to buying"
  (→ `/projects`) and "Switch to offering" (→ `/briefs`), with the
  current side highlighted. Switching is navigation, not a state change —
  there is no "active role" stored anywhere, and none is needed, because
  the two sides are capabilities the account already holds.
- **One role held** (e.g. an earn-only contractor on a white-label): a
  button to activate the other role — "Activate buying" / "Activate
  offering". It calls `activateRoleAction` (`modules/identity/actions.ts`),
  which sets the missing capability on the tenant membership row and
  revalidates the shell. It is **additive only**: it never clears a
  capability, so it cannot lock an account out of a side it already had.
  A non-member cannot activate anything — creating a membership here
  would grant workspace access without an invite.
- **No role held:** the switcher shows the two role descriptions and no
  actions (an account in this state cannot reach the shell's pages
  anyway; the layout sends it to `/auth/no-access`).

`users.role` is reconciled only when an account ends up holding exactly
one side; with both sides it keeps whichever role the account already
had, matching `writeProfile()`'s existing rule.

## What a consumer does first / what a provider does first

- **Consumer home:** `/projects` (their projects; create a brief from
  `/create`). The brief → project → workspace loop is the inherited
  Tones loop, unchanged in Phase 1.
- **Provider home:** `/briefs` (the public brief feed; `/jobs` for roles
  held and applications sent). Talent discovery is `/talent`.

The unified catalog (talent / services / products & production),
AI discovery, mediated negotiation, quotations/proposals, contact
release and the consumer/provider/operations dashboards are Phases 2–4
and are not described here — this file covers accounts and roles only.
