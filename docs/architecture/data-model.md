# Data Model — Cubora unified catalog (Phase 2) + commercial operations (Phase 4)

**Status:** Phase 2 (Catalog & Provider Management) + Phase 4
(Commercial Operations, migration 056 — see §10). Design doc for
the unified offer model, written alongside migrations `051`–`054`
(Phase 2) and `056` (Phase 4). The Phase 0 audit
(`docs/architecture/repository-audit.md` §3.3, §5.2) is the
pre-Phase-2 state this builds on; the spec is
`CUBORA_SPEC_ANALYSIS.md` §4.1/§4.5 (MUST S13–S15, S37–S40) and
§4.4 (MUST S23–S31) and the plan is `CUBORA_PLAN.md` §3, §5, §6, §7.

**What Phase 2 changes:** providers and offers are new tables. The legacy
profile tables (`users`, `creative_data`, `brand_data`) are NOT replaced
and NOT modified — the new model sits beside them and references
`users(id)`, the same way 001 does. Replacing the legacy profile storage
is a later-phase migration, not this one.

## 1. The unified model

One catalog, three categories (plan §3). One provider holds many offers.

```
users (legacy, pre-existing)
  └── tropical_providers (051)  1 per account, individual | business
        ├── tropical_verification_events (051)  evidence + decisions
        └── tropical_offers (052)  N per provider
              category: talent | services | products
```

### `tropical_providers` (051)

| Column | Meaning |
|---|---|
| `user_id` | The account. UNIQUE — one provider profile per account. |
| `kind` | `individual` (a person) or `business` (company, cooperative, other legal entity). |
| `display_name`, `legal_name` | Public name; legal name for businesses. |
| `description` | Capabilities, in the provider's own words. |
| `city`, `country` | Free text, default country `Cuba`. The legacy `locations` table is UK-flavoured with no Cuba content; a structured location model is Phase 5 geography work, not this phase. |
| `languages` | `text[]` of ISO 639-1 codes (`es`, `en`, …). Plan §11 / spec S57. |
| `verification_status` | `pending` \| `in_review` \| `verified` \| `rejected`. Default `pending`. |
| `verified_at`, `verified_by`, `verification_notes` | Audit columns for the verification decision. |

**Verification is never self-asserted.** The status and audit columns are
written only by the admin/ops verification actions
(`modules/catalog/actions.ts`, behind `requireAdminScope()` + `adminDb()`).
Enforcement is two-layered: the action layer never touches those columns
from a provider-side call, and a database trigger
(`tropical_providers_guard_verification`) raises if a write running as
role `authenticated` changes them. Ops writes run as `service_role` and
pass through. Spec OPEN O6 (what "verified" means — what evidence, who
verifies, re-verification) is still unanswered: until Roger answers it,
the workflow records evidence and a human decision, and nothing in this
model defines what evidence is sufficient.

### `tropical_verification_events` (051)

One row per evidence item or status decision: `kind` (`document` |
`note` | `status_change`), `reference` (a Storage path or external
identifier — never a secret), `note`, `status_after`, `recorded_by`,
`offer_id` (NULL for provider-level evidence; set for offer-level
evidence such as origin proof — the column is added by 052, because
offers do not exist yet when 051 runs). Readable only by the provider it
concerns (RLS) and by ops; never insertable through RLS.

### `tropical_offers` (052)

| Column | Meaning |
|---|---|
| `provider_id` | Owner. |
| `category` | `talent` \| `services` \| `products`. `products` covers physical goods AND producers/production capacity: a producer's offer describes what they can produce, with capacity in `production_capacity`. |
| `status` | `draft` \| `published` \| `archived`. Only `published` is publicly readable. |
| `title`, `description` | The offer, in the provider's words. |
| `skills` | `text[]` — searchable skills/disciplines (talent/services). |
| `languages` | `text[]` — languages the offer is delivered in. |
| `city`, `country` | Where the work / goods are. |
| `availability_status` | `available` \| `limited` \| `unavailable`. The provider's stated availability only — never a promise about export, payment, or delivery (plan §7, spec S42). |
| `quantity_available`, `quantity_unit` | Stock for products. NULL = not applicable or unstated — never invent a number. |
| `production_capacity` | jsonb, e.g. `{"monthly_amount": 500, "unit": "kg", "lead_time_days": 14}`. NULL = unstated, not zero. |
| `pricing_basis`, `price_amount`, `price_currency` | `hour` \| `project` \| `unit` \| `quote`; amount NULL for `quote`. Currency defaults to `USD`. (The legacy `lib/money.ts` is still GBP/pence for briefs; offer pricing is separate and does not reuse it.) |
| `origin_country`, `origin_verified`, `made_in_cuba` | Origin + the seal. See §2. |
| `verification_status` | Per-offer status, same vocabulary as providers. |
| `attributes` | jsonb — category-specific detail (§3). |
| `search_indexed_at` | Last semantic-search indexing time. NULL = never indexed. Written by the indexing seam, not by the provider. Offer-level Pinecone indexing lands in Phase 3; see §5. |

**RLS (052, following 002):** published offers are readable by any
signed-in user; drafts and archived offers only by their provider and
ops. A provider writes only their own offers; the trigger
(`tropical_offers_guard_verification`) blocks provider-side changes to
`origin_verified`, `made_in_cuba`, `verification_status`, and
`search_indexed_at`.

## 2. Made in Cuba — origin, not quality

- `made_in_cuba` is a boolean, default `false`, set ONLY by the admin/ops
  verification flow. The provider cannot set it (RLS insert check +
  trigger), and the database CHECK
  `NOT made_in_cuba OR origin_verified` forbids the seal without verified
  origin.
- Origin verification is kept separate from quality certification (plan
  §2, spec S11): nothing in this model is a quality claim, and no UI
  presents the seal as one. The seal badge (`components/tropical/
  made-in-cuba-badge.tsx`, Phase 1) renders only when `made_in_cuba` is
  true.
- The seal is per-offer, not per-provider: a verified provider can still
  have an unverified product. Provider verification and origin
  verification are different facts and are stored on different rows.

## 3. Category-specific attributes (`attributes` jsonb)

Typed columns carry everything the catalog filters on; `attributes`
carries the rest, per category (plan §6, spec S38). Shapes are
conventions, not a schema — the categories evolve faster than the
schema should. Providers supply these values; the platform never
invents them.

| Category | Attributes shape |
|---|---|
| `talent` | `{ "years_experience": n, "portfolio_urls": [..], "availability": "…" }` — skills, languages, and availability also live in typed columns. |
| `services` | `{ "scope": "…", "deliverables": [..], "conditions": "…", "pricing_basis": "…" }` |
| `products` | `{ "origin": "…", "specifications": {..}, "quality": "…", "quantity": "…", "availability": "…" }` — quantity/availability also live in typed columns. |
| producers (category `products`) | `{ "products": [..], "documentation": [..] }` + `production_capacity` (typed jsonb) + location (typed columns). |

## 4. Taxonomy (054)

The discipline vocabulary (`tropical_disciplines`) is re-seeded toward
tech/marketing + products/production as primary, keeping creative
categories as secondary (plan §14 Phase 2; STATUS.md "Next" item 7,
closed by this phase):

- **No rows deleted.** Existing disciplines keep slugs, labels, and
  relative order; only `sort_order` shifts by +1000 to make room.
- **New rows (22, `ON CONFLICT DO NOTHING`):** tech in the existing
  `technical` category (`ai-engineer`, `ml-engineer`, `data-scientist`,
  `data-analyst`, `ai-product-engineer`, `automation-engineer`); two new
  categories, `marketing` (8: digital/growth/performance marketer, SEO,
  content strategist, brand manager, email marketer, social media
  strategist) and `production` (8: agricultural/food/artisan producer,
  manufacturer, production/quality/export/supply-chain roles).
- The `film`/`performance`/`styling` categories remain, now sorting after
  the primary ones. They are secondary, not removed: creative talent is
  still a real catalog category.

## 5. Schema alignment with apps/ai (053) — the smaller correct option

The audit (§3.3) found the AI service queries tables no web migration
creates (`users`, `creative_data`, `opportunities`, `search_logs`,
`feedback_messages`, `agent_conversations`, …), so the two apps cannot
share one live database. Two options were on the table:

1. **Create the missing tables** in the web migrations.
2. **Map the new unified model** to what apps/ai expects (views/adapters).

Option 1 is smaller and correct, and it is what 053 does — for exactly
the seven tables the AI code reads/writes, with the columns that code
actually uses (verified against `apps/ai` on 2026-11-11):

- `agent_conversations` (`id, user_id, title, summary, created_at,
  updated_at`), `agent_messages` (`id, conversation_id, role, content,
  tool_used, search_log_id, sender_id, created_at`),
  `agent_conversation_entities` (`conversation_id` PK — the code
  upserts `on_conflict="conversation_id"` — `user_id, entities` jsonb).
- `search_logs` (`id, user_id, content, original_query, results
  text[], embedding real[], similarity_score, original_query_top_score,
  behavioral_rating 0|1|2|NULL, created_at`).
- `feedback_messages` (`id, user_id, type, content, created_at`).
- `opportunities` (`id, description, payment_range, status,
  metadata` jsonb) and `matching_results` (`id, opportunity_id,
  matched_users` jsonb, `total_matches, metadata`) — both orphaned
  (no route calls the service); created so a fresh database matches what
  the code expects.
- 053 also folds in the unnumbered legacy migration
  `add_agent_conversation_summary.sql` (the `summary` column, indexes,
  and the `updated_at` trigger), which the `apply.mjs` runner never runs
  because it only applies `/^\d{3}_.*\.sql$/` files.

Deliberately NOT created here:

- `users`, `creative_data`, `brand_data`, `locations` — pre-existing
  legacy tables owned outside this runner (001 treats them as read-only);
  creating them would collide with the live database.
- `connections`, `messages`, `projects`, `project_members` — legacy
  tables the disabled Team Search graph reads. Team Search is disabled
  (audit §3.2); re-enable-or-cut is a separate decision, not Phase 2.
- No rename of `creative_data` → `tropical_*`. The AI config documents
  the name as intentionally un-renamed
  (`apps/ai/app/core/config.py`); renaming needs a real DB migration of
  its own.

**What is still not aligned:** the AI service does not read
`tropical_offers`. Its search path is Pinecone user vectors +
`creative_data` metadata. Wiring AI search to the unified model (offer
vectors, offer metadata in search results) is Phase 3 work. Phase 2's
seam is the web side only: a server-side route handler
(`app/api/ai-search/route.ts`) that calls the existing AI `GET /search`
endpoint with the signed-in user's JWT forwarded, so no service key ever
reaches the browser. The AI `/search` endpoint is unauthenticated today
(audit §7.2) — the handler calls it server-side only and the auth gap is
recorded as a known issue for Phase 5; Phase 2 invents no auth for it.
`offers.search_indexed_at` exists so the Phase 3 indexer has a place to
record its work.

## 6. What the web reads, and from where

| Surface | Source |
|---|---|
| Catalog browse/search (`/catalog`) | `tropical_offers` (published) + `tropical_providers` (verified), via `modules/catalog/queries.ts`. Structured filters run in SQL; semantic search goes through `/api/ai-search` → AI `/search` (talent profiles today). |
| Provider "My offers" (`/offers`, profile) | `tropical_offers` + `tropical_providers` for the signed-in user. |
| Supplier onboarding (`/admin/suppliers`) | `tropical_providers` + `tropical_verification_events` via `adminDb()` behind `requireAdminScope()` (modules/admin pattern). No negotiations, no contact-release, no fees — those are Phase 4. |
| Talent discovery (`/talent`) | Unchanged: `users` + `creative_data` + `tropical_creative_disciplines`. The catalog does not replace it; it adds the services/products side the talent page never had. |

**Known limitation — no tenant scoping on providers.** `tropical_providers`
has no tenant column and there is no white-label provider-creation path,
so the catalog and the supplier queue are deployment-global. That matches
the current product shape (Cubora is the classic host) and the admin
supplier list returns empty for a scoped (white-label) admin rather than
leaking classic providers across tenants. Tenant scoping for providers
belongs with the tenancy keep-or-cut decision (audit §12), not with this
phase. The app-shell nav follows the same split: Catalog sits in the
hiring (consumer) group and My offers in the working (provider) group, so
a provider-only account reaches the catalog by URL or by activating the
consumer role.

## 8. Phase 3 additions (migration 055 + offer indexing)

**Migration 055** (`055_cubora_sourcing_requests.sql`) adds the
no-results workflow tables; the design doc is
`docs/architecture/ai-orchestration.md` §5–§6.

- `tropical_sourcing_requests`: `user_id`, verbatim `query`,
  structured `requirements` jsonb, `status` (`open` | `matched` |
  `notified`, default `open`), `conversation_id` (nullable FK to
  `agent_conversations`). Only ops moves a request out of `open`
  (no UPDATE/DELETE policy for `authenticated` + the
  `tropical_sourcing_requests_guard_status` trigger, following the
  051/052 pattern). Searchable by ops: GIN index on `requirements`
  + `(status, created_at)` queue index.
- `tropical_sourcing_notifications`: `sourcing_request_id`,
  `user_id`, `channel` (default `email`), `status` (`pending` |
  `sent` | `failed`, default `pending`), `sent_at`. A `pending` row
  records that the requester must be told — delivery itself is a
  stub in Phase 3 (nothing is sent); Phase 4 delivers from these rows.
- `agent_conversations.mode`: additive column (`NULL` = agent chat,
  `'team_search'`) needed by the re-enabled Team Search route, which
  inserts it. 053 created the table without it.

**Offer indexing (no schema change):** `search_indexed_at` (052) is
now written by the AI service (`offer_indexing.py`): published
offers are embedded (same embedding service as profiles) and
upserted into Pinecone as `offer-<id>` vectors with
`record_type: "offer"` metadata; drafts are never indexed. The
semantic offer search hydrates those vectors back to `tropical_offers`
rows, so the AI returns offer cards, not only talent profiles.

## 9. Deliberately left for later phases

- **Phase 3 (AI Discovery):** offer-level Pinecone indexing
  (`search_indexed_at` is the placeholder), AI search returning offer
  cards instead of talent-only profiles, the structured-streaming
  contract (spec O12), sourcing requests on no-results.
- **Phase 4 (Commercial Operations):** the internal CRM (negotiations,
  quotations/proposals, contact-release controls, fee records —
  migration 056, `docs/product/commercial-model.md`), supplier
  verification workflows beyond record-and-decide, notification
  delivery from the Phase 3 pending rows (recorded manual step only),
  and the Team Search legacy-tables decision — **decided: disable,
  do not create the tables** (see §10). Everything blocked by OPEN
  O1–O5 (fee model, "securing a contact", fee timing, contact-release
  conditions, payment/compliance route) stays open; the Phase 4
  shapes record what ops enters and attests, they do not decide the
  policy.
- **Phase 5 (Quality & Launch):** RLS validation against a live database
  (all policies here are unapplied, as every migration in this repo has
  been so far), the AI auth gaps (`/search`, insights endpoints), bilingual
  QA of the new surfaces, live verification of the migrations.
- **Unanswered spec questions this model does not resolve:** O6 (what
  "verified" means), O8 (human-review scope), O9 (launch bar). The model
  records human decisions; it does not define their criteria.

## 10. Phase 4 additions (migration 056 + commercial module)

**Migration 056** (`056_cubora_commercial_operations.sql`) adds the
commercial operation tables; the design doc is
`docs/product/commercial-model.md`. The web module is
`modules/commercial/` (`types.ts`, `validation.ts`, `queries.ts`,
`actions.ts`); the ops CRM lives under `app/[locale]/admin/
operations/`; the party dashboards under `app/[locale]/(app)/
operations/`.

- `tropical_negotiations`: `sourcing_request_id` (nullable),
  `consumer_id`, `provider_id`, `offer_id` (nullable), `status`
  (`open` | `proposal` | `awaiting_acceptance` | `accepted` |
  `contact_released` | `completed` | `cancelled` | `blocked`,
  default `open`), `activated_project_id` (nullable FK to
  `tropical_projects`). Only ops moves status (no UPDATE/DELETE
  policy for `authenticated` + the
  `tropical_negotiations_guard_status` trigger, following the
  051/052/055 pattern). Consumer opens (status `open` only); parties
  read their own.
- `tropical_negotiation_messages`: `negotiation_id`, `sender_id`,
  `content`. The mediated channel — negotiations precede any project,
  so they cannot reuse project-scoped `tropical_channels`. Parties
  read and post as themselves.
- `tropical_proposals`: `negotiation_id`, `created_by`,
  `author_role` (`consumer` | `provider` | `ops`), `title`,
  `summary`, `terms` jsonb, `status` (`draft` | `sent` | `accepted`
  | `declined` | `superseded`), `consumer_accepted` /
  `provider_accepted` booleans. Status is ops-only (trigger);
  parties set only their own acceptance flag (action layer).
- `tropical_contact_releases`: one row per negotiation (UNIQUE),
  `approved_by`, `conditions_summary` (REQUIRED — what ops attested,
  in ops' own words), `consumer_contact_released` /
  `provider_contact_released` booleans (independent). Parties read;
  no write policy for `authenticated`. The release conditions
  themselves stay OPEN (spec O4).
- `tropical_fees`: `negotiation_id`, `fee_type` (NULL or
  `fixed` | `percentage` | `hybrid`), `fee_amount` (NULL, ≥ 0),
  `fee_currency` (NULL), `fee_basis` (NULL), `status`
  (`recorded` | `void`), `recorded_by`, `notes`. All of type, amount,
  currency, and basis are nullable — no default anywhere (spec O1–O3
  undecided). Consumer of the operation reads; no write policy for
  `authenticated`. A record is not a charge: no payment rail exists.
- `tropical_compliance_reviews`: `entity_type` (`negotiation` |
  `provider` | `sourcing_request`), `entity_id`, `status` (`open` |
  `reviewing` | `blocked` | `cleared` | `escalated`), `reason`,
  `notes`, `reviewed_by`, `resolved_at`. No RLS policies for
  `authenticated` at all — ops-only.
- `tropical_operation_events`: `negotiation_id` (nullable),
  `event_type`, `actor_id`, `detail` jsonb. Audit trail (spec S29);
  parties read their negotiation's events; no write policy for
  `authenticated` (written via service role after a party check).
- `tropical_sourcing_notifications.sent_by` / `sent_note`
  (additive ALTERs): the manual-delivery attestation for the Phase 3
  pending rows — who sent it, and how the requester was reached.
- `tropical_projects.negotiation_id` (additive ALTER + index): the
  workspace ↔ negotiation link. Activation is an operations decision
  (negotiation accepted → ops activates the project,
  `pending_payment` → `active`), replacing the escrow-funded
  transition; `tropical_can_access_channel` is restated in 056 with
  that rule documented (logic unchanged: group access keys off
  project status `active`/`completed`).

**Contact privacy (audit):** there are no contact fields on any
Phase 4 table. A party's email lives only in Supabase Auth and is
never selected by an app query. Contact is revealed only through
`revealContactAction`, which requires a release row with that side's
flag set and reads the email through the service-role Auth admin API.

**Team Search legacy-tables decision (Phase 4, decided):** DISABLE
the `project_creator` and `persuasion_agent` nodes; do NOT create
the legacy `projects` / `project_members` / `connections` /
`messages` tables. Creating them would resurrect a second project
model nothing in the web reads, under a `projects` name that
collides with `tropical_projects`. The Cubora commercial operation
is the negotiation, owned by this CRM. Approval of a reviewed team
ends at the `crm_handoff` node (status `complete`, no Supabase
writes); see `docs/architecture/ai-orchestration.md` §4.
