# Screen Architecture — Cubora web (Phase 1 + Phase 2)

**Status:** Phase 1 (Brand & Foundation) + Phase 2 (Catalog & Provider Management — see the Phase 2 section below). Inventory of the screens and
components in `apps/web`, the routing map, and the reuse rule Phase 1 was
held to. Source of truth for what exists: `app/[locale]/` (routes) and
`components/` + `modules/` (implementation). The Phase 0 audit
(`docs/architecture/repository-audit.md`) is the pre-Phase-1 inventory this
builds on.

## Reuse rule (binding)

When a component already exists, **improve it — never create a duplicate**.
Same for screens. Before creating any new component or screen, grep the
tree and prove no equivalent exists. Phase 1 result:

### Improved (not created)

- `app/[locale]/page.tsx` — landing page rewritten as Cubora (brand,
  tagline, categories, how-it-works, seal section); structure and CTA
  behaviour kept.
- `app/layout.tsx` + `app/[locale]/layout.tsx` — root layout reduced to a
  pass-through; fonts, theme/toast providers and metadata moved into the
  locale layout.
- `app/[locale]/globals.css` — Cubora brand tokens added, display font
  fixed (`--font-arvo` pointed at a font that never existed), explicit
  `:focus-visible` ring added; the existing green system refined, not
  replaced.
- `proxy.ts` — locale-aware: strips the locale prefix before the existing
  auth checks, redirects bare paths to locale-prefixed ones, keeps the
  white-label root redirect, the auth-code funnel and the auth bounce.
- `components/tropical/app-shell.tsx` — nav labels, group labels and
  aria-labels translated; locale switcher and role switcher added to the
  existing shell; `next/link` swapped for the locale-aware navigation
  helpers in this file only.
- `components/tropical/tenant-logo.tsx` — fallback now `/cubora-logo.svg`
  (the old fallback path, `/tropicaltalent-logo.svg`, did not exist).
- `components/waitlist/steps.tsx` — the role step now asks what the user
  wants to do **first** and notes the other role can be activated later.
- `components/waitlist/sign-in-form.tsx` — labels translated; router
  swapped for the locale-aware one.
- `app/[locale]/auth/sign-in/page.tsx` — heading, intro and sign-up line
  translated.
- `components/waitlist/sign-up-dialog.tsx`,
  `components/waitlist/complete-profile.tsx`,
  `components/waitlist/referral-field.tsx` — classic-tenant defaults
  renamed TropicalTalent → Cubora.
- `modules/notifications/email.ts` — classic brand (sender name, email
  header wordmark, slug, "via" line) renamed to Cubora.
- `modules/admin/broadcast-templates.ts`, `components/tropical/referral-panel.tsx`,
  `components/tropical/export-data-panel.tsx`,
  `app/[locale]/(app)/wallet/page.tsx`,
  `app/[locale]/admin/referrals/page.tsx` — user-visible product name and
  export filename renamed to Cubora.
- `app/[locale]/error.tsx`, `app/[locale]/sub-processors/page.tsx` —
  user-visible copy renamed to Cubora.
- `modules/identity/actions.ts` — `activateRoleAction` added (the "activate
  the other role later" half of onboarding); sign-up, sign-in and profile
  completion untouched.
- `next.config.mjs` — `next-intl` plugin added (required for the message
  loader; without it the build fails at prerender time).

### Created (genuinely new — 4 files + 2 components + i18n infra)

- `components/shared/locale-switcher.tsx` — EN/ES switcher. No equivalent
  existed.
- `components/tropical/made-in-cuba-badge.tsx` — seal badge. No badge/chip
  component existed in the tree (only inline unread counts and a lucide
  `BadgeCheck` icon), so this is new rather than a duplicate.
- `components/tropical/role-switcher.tsx` — role switch / role activation
  in the app shell. No equivalent existed.
- `modules/identity/roles.ts` (+ `roles.test.ts`) — the pure Cubora role
  model: consumer/provider as capabilities.
- `lib/i18n.ts` (+ `i18n.test.ts`) — locale helpers the proxy needs.
- `i18n/routing.ts`, `i18n/request.ts`, `i18n/navigation.ts` — next-intl
  wiring.
- `messages/en.json`, `messages/es.json` — the message catalogues.
- `public/cubora-logo.svg` (rework + rename of the old logo),
  `public/made-in-cuba-seal.svg` (new seal artwork).
- `app/icon.svg` — reworked in place (same path, same mark as the logo).

No new screen was created. No screen was duplicated.

## Routing map

All pages live under `app/[locale]/`, locales `en` + `es`, prefix always
present. The proxy redirects bare paths (`/briefs` → `/en/briefs`) using
the `NEXT_LOCALE` cookie, then `Accept-Language`, then the `en` default.
`/api/*` and the root `/unsubscribe` handler live outside the locale
segment and never get a prefix.

| Route | Who | What |
|---|---|---|
| `/[locale]` | public | Cubora landing page (force-static, both locales prerendered) |
| `/[locale]/auth/sign-in` | public | Log in |
| `/[locale]/auth/reset` | public | Request a password reset |
| `/[locale]/auth/update-password` | public | Set a new password |
| `/[locale]/auth/callback` | public | OAuth / email-confirmation exchange |
| `/[locale]/auth/complete` | signed-in | OAuth profile completion (onboarding) |
| `/[locale]/auth/continue` | signed-in | "Take me into the app" resolver |
| `/[locale]/auth/no-access` | signed-in | Not a member of this workspace |
| `/[locale]/create` | consumer | Brief → crew → project |
| `/[locale]/projects` | consumer | Project grid |
| `/[locale]/projects/[id]` | both | Workspace: channels, contracts, deliverables, settings |
| `/[locale]/talent` | consumer | Discover, favourite, invite talent |
| `/[locale]/briefs` | provider | Public brief feed |
| `/[locale]/jobs` | provider | Roles held + applications sent |
| `/[locale]/profile/[username]` | both | Profile, inline-editable |
| `/[locale]/wallet` | both | Placeholder — payments are omitted in this build |
| `/[locale]/sub-processors` | public | Sub-processor list (force-static) |
| `/[locale]/admin/*` (11 pages) | admin | Console: users, projects, comms, complaints, deletions, earnings, referrals, tenants |
| `/api/waitlist`, `/api/cron/*` | public/cron | Preserved for external callers / bearer-protected crons |
| `/unsubscribe` | public | Unsubscribe handler (root, no locale prefix) |

`/[locale]/terms` and `/[locale]/privacy-policy` are listed as public in
the proxy but have no routes — they 404. That predates Phase 1 (audit §2.1)
and is unchanged.

## Navigation components

- `AppShell` (`components/tropical/app-shell.tsx`) — sidebar + drawer,
  project tree, profile row, logout, theme toggle, locale switcher, role
  switcher. Uses the locale-aware `Link`/`usePathname` from
  `i18n/navigation`, so in-app navigation keeps the current locale.
- `LocaleSwitcher` (`components/shared/locale-switcher.tsx`) — EN/ES
  toggle; navigates to the same path under the other locale.
- `RoleSwitcher` (`components/tropical/role-switcher.tsx`) — see
  `docs/product/user-workflows.md`.

## i18n: what is translated

Translated (EN + ES, `messages/*.json`): the landing page, the app-shell
navigation (labels, groups, aria-labels), the role switcher, the
locale switcher, the sign-in form and sign-in page, the onboarding role
step (question + "activate the other role later" note), the Made in Cuba
seal label.

**Not translated yet** (English only — Phase 5 bilingual QA, or the phase
that owns the surface):

- The rest of the sign-up wizard (name/email/password, company blurb,
  passions, bio, location, photo, referral steps) and the OAuth
  completion form's non-role steps.
- Server error strings from the identity actions (`translateAuthError`,
  sign-up/complete validation messages) and the resend-confirmation copy.
- All in-app screens beyond the shell: briefs, projects, workspace, chat,
  talent, profile, admin console, wallet placeholder, sub-processors page,
  not-found/error pages.
- Transactional emails (Resend templates in `modules/notifications/`) —
  the brand name inside them is Cubora, the body copy is English.
- Offer data and provider languages (Phase 2: offer data is
  language-aware "where appropriate" per the plan).

## Phase 2 — Catalog & Provider Management

**Status:** Phase 2. Design doc: `docs/architecture/data-model.md`.
Inventory of what Phase 2 added to the screens, under the same reuse rule
(improve, never duplicate). Grep-proved before creating: no offer card,
offer form, catalog page, offer-management page, or supplier-onboarding
page existed (`brief-card` is a brief, `talent-tile` is a person, the
profile page shows a talent profile, the admin console had no suppliers
surface).

### Improved (not created)

- `app/[locale]/admin/layout.tsx` — one NAV entry, `Suppliers`. The admin
  shell, its gate, and its patterns are untouched.
- `components/tropical/app-shell.tsx` — two nav items: `Catalog` in the
  hiring (consumer) group, `My offers` in the working (provider) group.
  The catalog is consumer-grouped because it is a discovery surface for
  buyers; a provider-only account reaches it by URL or by activating the
  consumer role. No new nav group.
- `components/tropical/profile-view.tsx` — own-profile-only "My offers"
  section (offer count + link to `/offers`). Visitors see the talent
  profile, not the management surface.
- `app/[locale]/(app)/profile/[username]/page.tsx` — loads the offer count
  for the own profile, nothing else.
- `messages/en.json`, `messages/es.json` — two nav keys (`catalog`,
  `myOffers`). The new screens themselves are English-only, like every
  in-app screen beyond the shell — bilingual QA is Phase 5.
- `apps/web/.env.example` — `CUBORA_AI_BASE_URL` placeholder for the
  semantic-search seam.
- `apps/web/migrations/apply.mjs` — verification block updated for the
  Phase 2 counts (20 tropical tables, 7 AI-service tables, 67 disciplines,
  19 RLS tables, 37 policies, 6 functions) and one new check for the
  AI-service tables.
- `apps/web/scripts/seed-tropical.ts` — fictitious provider/offer fixtures
  (`.invalid` emails, invented names) for the three creative fixtures,
  created as drafts with verification `pending`. Teardown is unchanged:
  deleting the auth user cascades to providers and offers.

### Created (genuinely new)

- `app/[locale]/(app)/catalog/page.tsx` — unified catalog browse/search.
- `app/[locale]/(app)/offers/page.tsx` — provider "My offers" management
  (profile + offer list + create/edit form; consumer-only accounts get the
  existing `activateRoleAction` form, not a new flow).
- `app/[locale]/admin/suppliers/page.tsx` + `[id]/page.tsx` — internal
  supplier onboarding queue + detail (evidence, status, per-offer
  origin/seal, history). No CRM beyond onboarding — Phase 4 owns that.
- `app/api/ai-search/route.ts` — server-side seam to the AI `GET /search`
  endpoint. No service key reaches the browser; the user id sent is the
  verified session user.
- `components/tropical/offer-card.tsx` — one catalog offer.
- `components/tropical/catalog-board.tsx` — structured filters (URL-driven,
  same shape as `talent-board`) + semantic search box.
- `components/tropical/offer-form.tsx` — create/edit offer, category-specific
  fields per category. No verification fields exist in the form.
- `components/tropical/provider-form.tsx` — provider profile form.
- `components/tropical/my-offers-list.tsx` — own offers with
  publish/unpublish/archive/delete.
- `components/tropical/supplier-verification-form.tsx` — admin verification
  controls (provider status, evidence, per-offer origin/seal, history).
- `modules/catalog/` — `types.ts`, `filters.ts` (+ `filters.test.ts`),
  `queries.ts`, `actions.ts`, `ai-search.ts` (+ `ai-search.test.ts`).
  Structured search reuses the talent module's query shape (session
  client, keyset pagination, filters in SQL); the skill picker is the
  existing `DisciplineSearch`.

### Routing additions (Phase 2)

| Route | Who | What |
|---|---|---|
| `/[locale]/catalog` | signed-in | Unified catalog: talent, services, products & production |
| `/[locale]/offers` | provider | My offers: provider profile + offer management |
| `/[locale]/admin/suppliers` | admin | Supplier onboarding queue |
| `/[locale]/admin/suppliers/[id]` | admin | Supplier review: evidence, status, origin/seal |
| `/api/ai-search` | signed-in | Server-side semantic search (AI `GET /search`) |

`/[locale]/terms` and `/[locale]/privacy-policy` still 404 (unchanged
since Phase 0).

## Known migration debt (from the [locale] move)

- Only the files Phase 1 touched import `Link`/`usePathname`/`useRouter`
  from `i18n/navigation`. The other ~60 files still import from
  `next/link` / `next/navigation` with bare `href="/..."` paths. They
  keep working because the proxy redirects bare paths to locale-prefixed
  ones, but each such navigation costs a redirect round trip instead of
  staying client-side. Later phases should swap the imports file by file;
  do not do it in one bulk change.
- Server `redirect('/auth/...')` calls in layouts and route handlers use
  bare paths and likewise rely on the proxy redirect. Same treatment.
- The classic tenant row in the database is still named "TropicalTalent",
  so any copy that reads `tenant.name` from the database (app-shell
  wordmark, sign-in page tenant name, admin console) still shows the old
  name. Renaming it needs a data migration against a live database.
