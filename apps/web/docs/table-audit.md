# Table audit — live `public` schema

Audited **2026-08-19** against the live database. Written so the next person
does not have to re-derive it.

> Reference-build note: live row counts from the original audit have been
> replaced with `n/a` below — they were a snapshot of a live database, not
> reproducible here. Table names, verdicts and reasoning are unchanged.

This app is a from-scratch rebuild of a much larger predecessor, and the
database still carries that app's tables. Under multi-tenancy every table that
nothing owns is an unaudited surface — RLS you have not reviewed, grants to
`anon` you did not make — so they are worth clearing out before tenancy lands,
not after.

## Method

The live object list came from PostgREST's OpenAPI document
(`GET /rest/v1/` as the service role), which is authoritative for what is
exposed in `public`. Row counts came from
`?select=*&limit=0` with `Prefer: count=exact`.

A table is an **ARCHIVE** candidate only if all four hold:

1. No `.from('<table>')` anywhere in `app|modules|lib|hooks|components|scripts`.
2. No numbered migration (`0NN_tropical_*.sql`) references it as a relation —
   i.e. not matched by `public.<t>` or `FROM|INTO|UPDATE|JOIN|REFERENCES <t>`.
   Prose mentions in comments do not count, and were the only hits for
   `projects` and `notifications` (see below).
3. It is not one of the identity tables this codebase reads but never migrates.
4. No live trigger, cron job or `SECURITY DEFINER` function writes to it.

Criterion 4 is the one that catches things. It is why `user_balances` and
`messages` are not where a naive grep would put them.

## Rule

**Archive, never drop.** `ALTER TABLE ... SET SCHEMA archive` preserves every
row, index and constraint, and is reversible with one command:

```sql
ALTER TABLE archive.<name> SET SCHEMA public;
```

Moving out of `public` removes the table from PostgREST's exposed surface, which
is the actual goal — it stops being reachable over the API. An actual `DROP` is
a separate decision for a later quarter, taken deliberately.

## Verdicts

### KEEP — live identity tables

Read but never migrated by this codebase.

| Table                       | Rows   | Why                                                  |
| --------------------------- | ------ | ---------------------------------------------------- |
| `users`                     | n/a | Core identity                                        |
| `creative_data`             | n/a | Creative profile                                     |
| `brand_data`                | n/a | Brand profile                                        |
| `locations`                 | n/a | Location lookup                                      |
| `user_stats`                | n/a | Jobs done / revenue                                  |
| `connected_payout_accounts` | n/a | connected payout accounts                                       |
| `waitlist`                  | n/a | Written on every sign-up; feeds production reporting |
| **`user_balances`**         | **n/a** | **See warning below**                                |

> ⚠️ **`user_balances` is not in CLAUDE.md's list of pre-existing tables, but it
> must be kept.** The live trigger `on_public_user_created` →
> `handle_new_public_user()` (`migrations/create_user_records_on_signup.sql:17`)
> `INSERT`s into it on every sign-up. Archiving it breaks account creation.
> Note the app itself reads `tropical_user_balances`, not this one — so
> `user_balances` is written-on-signup and never read. That is worth resolving
> one day, but it is a behaviour change, not a cleanup, so it is out of scope
> here. CLAUDE.md's list should be corrected to eight tables.

### KEEP — owned by this app

All 29 `tropical_*` tables and views. Four of them have **zero** references in
application code and would look dead to a grep, but each is written by a live
RPC:

| Table                        | Written by                                         |
| ---------------------------- | -------------------------------------------------- |
| `tropical_contracts`           | `tropical_create_project()` — `007:150`              |
| `tropical_contract_signatures` | v1 signature model; still carries 001/002 policies |
| `tropical_role_events`         | `011`, `017`, `020`                                |
| `tropical_tag_discipline_map`  | read by the `003`/`004` discipline backfill        |

### ARCHIVE — 25 tables

Zero code references, zero relation references from any numbered migration.

| Table                 | Rows | Origin                                                             |
| --------------------- | ---- | ------------------------------------------------------------------ |
| `projects`            | n/a | v1 project system                                                  |
| `project_members`     | n/a | v1 project system                                                  |
| `project_messages`    | n/a | v1 project system                                                  |
| `messages`            | n/a | v1 chat — **see cron warning**                                     |
| `connections`         | n/a | v1 connections                                                     |
| `collaborations`      | n/a | v1 collaboration/quote flow                                        |
| `revision_events`     | n/a | v1 revision tracking                                               |
| `feedback_messages`   | n/a | v1 feedback                                                        |
| `disputes`            | n/a | superseded by `tropical_disputes`                                    |
| `escrow_holds`        | n/a | superseded by `tropical_escrow_holds`                                |
| `payments`            | n/a | v1 payments — superseded by escrow + `tropical_balance_transactions` |
| `notifications`       | n/a | superseded by `tropical_notifications`                               |
| `email_preferences`   | n/a | superseded by `tropical_notification_preferences`                    |
| `referrals`           | n/a | superseded by `tropical_referrals`                                   |
| `portfolio_items`     | n/a | superseded by `creative_data.backstory`                            |
| `agent_conversations` | n/a | removed AI search microservice                                     |
| `agent_messages`      | n/a | removed AI search microservice                                     |
| `search_logs`         | n/a | removed AI search microservice                                     |
| `events`              | n/a | removed `/events` route                                            |
| `accelerations`       | n/a | removed accelerator route                                          |
| `spotlight`           | n/a | app computes its spotlight in `modules/talent/queries.ts:225`      |
| `subscriptions`       | n/a | never-shipped subscription billing                                 |
| `subscription_plans`  | n/a | never-shipped subscription billing                                 |
| `product_metrics`     | n/a | removed analytics                                                  |
| `users_events`        | n/a | removed analytics                                                  |

Two of these are referenced in numbered migrations **only in prose**, and both
comments confirm the verdict rather than contradicting it:

- `001:83` — _"Supersedes the unused `public.projects` table."_
- `010:207` — _"Deliberately separate from the pre-existing `public.notifications` table."_

### Dependency that must be handled first

`messages` is updated nightly by a **live pg_cron job**. From
`migrations/expire_quotes_cron.sql`:

```sql
CREATE OR REPLACE FUNCTION expire_pending_quotes() ... UPDATE messages SET status = 'expired' ...
SELECT cron.schedule('expire-pending-quotes', '5 0 * * *', $$SELECT expire_pending_quotes()$$);
```

The function is `SECURITY DEFINER` with an unqualified `messages`, so moving the
table makes it fail every night at 00:05 UTC. `022_archive_legacy.sql`
unschedules the job and drops the function before touching the table. The
scheme it served (quote messages expiring) does not exist in this app.

### Residual risk

Triggers and non-exposed functions cannot be enumerated over PostgREST, so a
`SECURITY DEFINER` function referencing one of these tables by unqualified name
could still exist outside this repo's migrations — `expire_pending_quotes` was
exactly that shape and was found only by reading the historical migration files.

This is why the rule is archive rather than drop: if something does break, the
fix is one `SET SCHEMA public` and the data was never at risk. Run
`npm run verify` immediately after applying.

---

# Re-audit — 2026-08-27

The 022 archive holds: PostgREST now exposes fewer objects in `public` — the 25 archived tables are gone from the API
surface, and objects have been added since by tenancy (023–025, 031, 036) and
recurring (027–030).

Same method as above, plus two passes the first audit did not run:

- **Tenant attribution.** Row counts split by `tenant_id`, or joined through
  `tropical_projects.tenant_id` for the child tables that inherit tenancy. Three
  tenants were live: TropicalTalent (classic) and two sample tenants (both
  `contractors_brands`, `visibility: private`).
- **Anonymous exposure.** Every object re-fetched with the publishable key
  alone. A 401 or an empty result means RLS and grants hold.

The full ledger — all objects with counts, tenant split, code path and
notes — is the artifact published on 2026-08-27. What follows is only what
changed, and what was done about it.

## Findings and verdicts

### 1. `users` and `creative_data` were readable by `anon` — FIXED (038)

An unauthenticated request returned all user rows and all talent
profiles, **including users whose only tenant membership is a private
white-label**. The talent roster is correctly scoped (INNER embed on
`tropical_tenant_members`, 024); reading the base table walks around that join.
`anon` also held UPDATE and DELETE on both tables.

`038_tropical_identity_anon_lockdown.sql` revokes ALL from `anon` and from
PUBLIC, and grants `authenticated` the SELECT/INSERT/UPDATE it actually uses.
Grants rather than policies: these tables' policies were written by the
predecessor app and are not in this repo, so there is no policy name to drop
and no guarantee a new one would not reopen it.

Still anon-readable, deliberately: `locations`, `tropical_disciplines`,
`tropical_creative_disciplines`, `tropical_tag_discipline_map` — lookups and
taxonomy, no personal data.

### 2. White-label sign-ups wrote to `waitlist` — FIXED (code)

Both sign-up paths inserted a `waitlist` row unconditionally, and the table has
no `tenant_id`, so white-label sign-ups landed in TropicalTalent's funnel table
indistinguishable from TropicalTalent sign-ups — with `features.waitlist` false on both
white-labels and never consulted.

`recordWaitlist()` in `modules/identity/actions.ts` now gates on the flag, and
`/api/waitlist` — which answers on every branded host, being in the proxy's
`PUBLIC_API` — 404s on a tenant that runs no waitlist.

### 3. Referrals were gated by archetype, not by the feature — FIXED (code)

`features.referrals` was defined, seeded false for both white-label archetypes,
and read nowhere. The only gate was `workerIsContractor`, so a _payer_ account
on a white-label still got a referral code, and the OAuth completion form
offered the referral step to everyone regardless.

`referralAudience()` (`modules/tenancy/presets.ts`) now answers per side of the
marketplace and is applied at every surface — sign-up dialog, OAuth completion,
profile panel — and `recordReferral()` refuses to credit on a tenant that runs
no programme, which is the real gate: a code also arrives via `?ref=` and
survives the Google round trip in `sessionStorage`.

**Not fixed, and a decision rather than a bug:** `tropical_referrals` has no
tenant column, so codes remain global. A referral earned on one site can be
spent on another. That needs a migration plus a rewrite of
`tropical_record_referral()`, and is deliberately left open.

### 4. Two more dead objects — ARCHIVED (039)

| Object                       | Rows | Verdict                                                 |
| ---------------------------- | ---- | ------------------------------------------------------- |
| `tropical_contract_signatures` | n/a | v1 signature model; no writer anywhere. Archived.       |
| `tropical_tag_discipline_map`  | n/a | 003 seed data, read only by the 004 backfill. Archived. |

Both are CREATEd by earlier numbered migrations, and `apply.mjs` re-runs every
file, so 039 archives the original and then removes the copy 001/003 recreate
on each subsequent run — with the contract-signatures branch refusing to touch
a public copy that has rows, on the grounds that a table someone is writing to
is not dead after all.

Kept, though a grep calls them dead:

- `tropical_contracts` — written by `tropical_create_project()` on every project,
  read by nothing. **Write-only, not unused.** Stopping the write means editing
  the RPC every project creation depends on; separate decision.
- `tropical_role_events` — same shape: six RPCs write it, nothing reads it. An
  audit trail with no reader.
- `user_balances` — the sign-up trigger still inserts here. Archiving it breaks
  account creation. Unchanged from the 2026-08-19 verdict.

## Standing observations, no action taken

- **Wallet and identity are per-user, not per-tenant.** `tropical_user_balances`,
  `tropical_balance_transactions`, `connected_payout_accounts`, `user_stats`,
  `tropical_favourites` and `tropical_notification_preferences` are shared across
  every tenant a person belongs to. Correct for a single payment provider payout
  identity; worth knowing before anyone reports per-tenant earnings from them.
- **`tropical_notifications.project_id` is nullable**, so notifications about
  invites and payouts carry no tenant at all.
- **`tropical_disciplines` is one global taxonomy.** A white-label cannot name
  its own disciplines yet.
