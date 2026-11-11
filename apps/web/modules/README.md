# Service modules

Each folder here is a **service**: one bounded slice of the product with its
own types, its own reads, and its own writes. Nothing outside a module reaches
into its tables directly — the module's `queries.ts` and `actions.ts` are its
entire surface.

```
modules/<service>/
  types.ts     domain types (safe to import from client components)
  queries.ts   server-only reads   —  'server-only' + React.cache
  actions.ts   server-only writes  —  'use server'
```

| Service         | Owns                                                         |
| --------------- | ------------------------------------------------------------ |
| `identity`      | auth session, `users`, `creative_data`, `brand_data`, signup |
| `skills`        | `tropical_disciplines`, `tropical_creative_disciplines`          |
| `projects`      | `tropical_projects`, roles, members, settings                  |
| `briefs`        | public feed + `tropical_applications`                          |
| `chat`          | channels, messages, deliverables, role contracts, disputes   |
| `escrow`        | stub — payments omitted; `tropical_project_escrows`, holds (reference schema only) |
| `talent`        | discovery, favourites, invitations                           |
| `wallet`        | stub — payments omitted; no live balances or payouts          |
| `notifications` | `tropical_notifications`                                       |
| `admin`         | cross-account reads for `/admin` — no tables of its own      |

## Why a modular monolith and not literal microservices

The brief asked for a component/microservice-shaped backend. What that buys —
independent reasoning, independent testing, no hidden coupling — comes from the
**boundaries**, not from the network hops. Splitting these nine services across
nine deployed processes would add an HTTP round trip to operations that
currently run as one Postgres statement, which is the opposite of the latency
goal.

So the boundaries are real and enforced by convention (a module never imports
another module's `queries.ts`; it goes through the published function), while
the runtime stays in-process. Postgres is the shared substrate and RLS is the
authorisation boundary that survives regardless of how the code is packaged.

Two services are already split out at the infrastructure level, which is where
the split actually pays: **auth** (Supabase GoTrue). Payments were the second
one; they are omitted entirely from this reference build, so `escrow`,
`wallet` and the recurring billing engine are stubs (see their module
headers).

If a service ever does need its own process, the seam is already cut: replace
the body of its `queries.ts` / `actions.ts` with a fetch and nothing that
consumes it changes.

## Rules

1. **One round trip per screen.** Related data is fetched with PostgREST
   resource embedding, not with a sequence of awaits.
2. **Independent queries run under `Promise.all`.** Never in sequence.
3. **Every read is wrapped in `React.cache`.** A layout and its page can ask
   for the same thing without paying twice.
4. **Every action re-authenticates.** Server actions are public HTTP endpoints.
5. **Money is recomputed server-side.** Client figures are for display only.
