# TropicalTalent

A marketplace web app connecting Cuban talent with the world — Cuban
influencers with foreign audiences and clients, local producers with foreign
clients, tech and marketing talent with the teams that need them.

**Status: reference base, not the final product.** This is a rebranded fusion
of earlier marketplace work, kept as a clean starting point for the real
platform. It is not a live business.

**Payments are omitted entirely.** There is no payment provider, no checkout,
no escrow funding, no payouts and no prices anywhere in this build.
`modules/escrow`, `modules/wallet` and the recurring billing engine are
minimal stubs that refuse with a plain message; `/wallet` is a placeholder
page. Budgets are shown as agreed figures only — no money moves.

## Run it

```bash
bun install
bun run migrate      # see "Database" — needs TROPICAL_DB_URL
bun dev
```

Other useful commands: `bun run typecheck`, `bun run lint`, `bun test`,
`bun run verify` (live-database checks, needs `.env.local`).

## Routes

| Route                   | Who      | What                                                   |
| ----------------------- | -------- | ------------------------------------------------------ |
| `/`                     | public   | Landing page. The CTA creates a real account.          |
| `/auth/sign-in`         | public   | Log in                                                 |
| `/auth/reset`           | public   | Request a password reset                               |
| `/auth/update-password` | public   | Set a new password                                     |
| `/auth/callback`        | public   | OAuth / email-confirmation exchange                    |
| `/create`               | brand    | Brief → crew → project                                 |
| `/projects`             | brand    | Project grid                                           |
| `/projects/[id]`        | both     | Workspace: channels, contracts, deliverables, settings |
| `/talent`               | brand    | Discover, favourite, invite talent                     |
| `/briefs`               | talent   | Public brief feed                                      |
| `/jobs`                 | talent   | Roles held + applications sent                         |
| `/profile/[username]`   | both     | Profile, inline-editable                               |
| `/wallet`               | both     | Placeholder — payments are omitted in this build       |
| `/api/waitlist`         | public   | Preserved for external callers                         |
| `/api/cron/project-checkins` | cron | Weekly project check-ins (bearer `CRON_SECRET`)   |
| `/api/cron/retention`   | cron     | Retention job (bearer `CRON_SECRET`)                   |

## Architecture

```
app/            routes only. Pages resolve data and render; they hold no logic.
  (app)/        the signed-in shell. One layout, one set of sidebar queries.
modules/        the service layer. See modules/README.md.
components/
  ui/           six Radix primitives and a toast. Nothing else.
  tropical/     the app's own components.
  waitlist/     landing-page sign-up and auth forms.
lib/            supabase clients, money, small shared helpers.
migrations/     the tropical schema, additive.
proxy.ts        the edge gateway. Routing only.
```

Stack: Next.js 16 (App Router), React 19, TypeScript, Bun, Tailwind CSS 4,
Supabase (Postgres, Auth, Realtime, Storage), Resend for email. No payment
provider, no analytics, no test runner beyond `bun test`.

## Environment

Copy `.env.example` to `.env.local` and fill in the values. Every value is
empty by default — there are no keys in this repo.

| Variable | Used for |
| -------- | -------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin access (migrations, seed, admin reads) |
| `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_SITE_URL`) | Public origin, e.g. `https://tropicaltalent.dev` |
| `RESEND_API_KEY` | Outbound email |
| `RESEND_FROM_EMAIL` | Sender address for outbound email |
| `CRON_SECRET` | Bearer token for `/api/cron/*` |
| `UNSUBSCRIBE_SECRET` | Signed unsubscribe links |
| `TROPICAL_DB_URL` | Postgres connection string for `bun run migrate` |
| `TROPICAL_SEED_PASSWORD` | Dev seed password (`change-me-dev-only` if unset; dev databases only) |

## Database

Migrations in `migrations/` are additive and applied in filename order with
`bun run migrate` (`node migrations/apply.mjs`, needs `TROPICAL_DB_URL`).
Table names are `tropical_*`. The historical escrow / withdrawal / recurring
migrations remain as reference schema only — nothing in this build funds,
charges or releases anything through them.

`docs/table-audit.md` records the earlier audit of the live `public` schema
(row counts removed in this reference build; verdicts and reasoning kept).

## Theming

Green brand theme (deep green → emerald → lime) in `app/globals.css` — the
`gradient-brand` / `gradient-app` utilities and `--primary` / `--accent` /
`--neon-*` tokens. Class names are kept stable; white-label tenants can still
override the palette per tenant (see `modules/tenancy/theme.ts`).
