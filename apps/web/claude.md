# TropicalTalent — Project Context

Next.js 16 marketplace connecting Cuban talent with the world. Reference
base, not the final product. Full detail is in [README.md](README.md); this
file is the short version for an agent picking up the repo cold.

## Stack

- **Framework**: Next.js 16.0.10 (App Router), React 19, TypeScript 5.9.3, Bun
- **UI**: 6 Radix primitives + a hand-rolled toast, Tailwind CSS 4, Lucide icons
- **Backend**: Supabase (Postgres, Auth, Realtime, Storage), Resend for email
- **Payments**: none — omitted entirely in this build (no provider, no
  checkout, no escrow, no payouts; see README.md)
- **DevTools**: ESLint, Prettier, Husky, lint-staged — all bun-driven

No Zustand, Dexie, Sentry, PostHog, framer-motion, react-hook-form, or test
runner. Those were load-bearing in an earlier version of this app and were
removed deliberately when the app was rebuilt. Don't re-add a dependency
without checking it's actually imported somewhere first.

## Layout

```
app/            routes only — pages resolve data and render, no logic in them
  (app)/        the signed-in shell (one layout, one set of sidebar queries)
  admin/        role-gated dashboard, its own layout, not part of (app)
  auth/         sign-in, sign-up completion, password reset, OAuth callback
  api/          waitlist, cron (project-checkins, retention)
modules/        the service layer — see modules/README.md for the boundary rules
components/
  ui/           Radix primitives. Nothing goes in here that isn't a primitive.
  tropical/     the app's own components
  waitlist/     landing-page sign-up and auth forms
lib/            Supabase clients, money math, small shared helpers
hooks/          realtime subscriptions (project chat, notifications)
migrations/     tropical_* schema (additive) + pre-existing historical migrations
proxy.ts        the edge gateway — routing only, no business logic
```

## Routes that exist

`/` (landing, static), `/auth/*`, `/create`, `/projects`, `/projects/[id]`,
`/talent`, `/briefs`, `/jobs`, `/profile/[username]`, `/wallet`
(placeholder — payments omitted), `/admin/*`, `/api/waitlist`,
`/api/cron/project-checkins`, `/api/cron/retention`.

## Payments — omitted

- `modules/escrow/actions.ts`, `modules/wallet/actions.ts`,
  `modules/wallet/queries.ts`, `modules/recurring/actions.ts` and
  `modules/recurring/billing.ts` are stubs. They keep their old export
  surface so the workspace UI still compiles, but every money-moving call
  refuses with "Payments are omitted in this reference build".
- There is no payment-provider API route, no payment cron, no payment env vars.
  Do not re-add a payment provider without a new decision — the escrow and
  recurring migrations in `migrations/` are reference schema only.
- `lib/money.ts` stays: budget display math (`formatPence`, `splitPot`) is
  still used across project screens. It moves no money.

## Conventions

- Money is recomputed server-side; client figures are for display only.
- Every server action re-authenticates; every read is `React.cache`d.
- Green theme tokens live in `app/globals.css` (`--primary`, `--accent`,
  `--neon-green` / `--neon-emerald` / `--neon-lime`, `gradient-brand`).
- Env vars: see `.env.example` — empty placeholders only, no keys in repo.
