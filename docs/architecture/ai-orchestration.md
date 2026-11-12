# AI Orchestration — Cubora discovery (Phase 3)

**Status:** Phase 3 (AI Discovery). Written alongside the migration
from LangChain `AgentExecutor` toward LangGraph, the structured-
streaming contract (spec OPEN O12, now defined), and the no-results
sourcing workflow (spec OPEN O13, default decided — see §5).

**Sources:** `CUBORA_PLAN.md` §4, §8, §10; `CUBORA_SPEC_ANALYSIS.md`
§4.3 (MUST S18–S22, S51–S52), §10 O12/O13; Phase 0 audit
(`docs/architecture/repository-audit.md` §3.1, §4.2); data model
(`docs/architecture/data-model.md` §5, §7).

**What Phase 3 changes, in one paragraph:** the live per-user agent
is now orchestrated by an explicit LangGraph graph
(`apps/ai/app/services/discovery_graph.py`); the AgentExecutor
survives only as one node inside it. One SSE stream carries text,
clarification prompts, inline offer cards, and sourcing-request
events (§2). Team Search is re-enabled as a LangGraph graph behind
JWT auth (§4). Offers are indexed into Pinecone as `offer-*` vectors
(§6) so semantic search returns offer cards. No-results turns create
a structured sourcing request (§5). Nothing here touches payments,
the CRM, or the catalog model beyond migration 055.

## 1. Migration map — AgentExecutor → LangGraph

### What was migrated in this phase

| Before (AgentExecutor decides everything) | After (graph decides; nodes execute) |
|---|---|
| `create_tool_calling_agent` picks tools implicitly per turn | `understand` node extracts requirements (LLM intent + deterministic local extraction); `route_after_understand` routes explicitly: `legacy_agent` / `clarify` / `search_offers` |
| Clarification is emergent from the LLM system prompt | `clarify` node: at most 2 targeted questions, at most 2 rounds, then search anyway; partial results attach to the clarification (§3) |
| Search only over talent profiles (`search_creatives` → Pinecone user vectors) | `search_offers` node: semantic Pinecone offer vectors + structured Supabase query over `tropical_offers` (§6) |
| No-results is a generated message (`no_results_messenger`) | `sourcing` node: creates a `tropical_sourcing_requests` row + a pending notification record (§5) |
| SSE events are an undocumented de-facto set (`message`, `profiles`, `search_log`, `done`) | The event set is the O12 contract in §2, with `offers`, `clarification`, `sourcing_request`, `conversation_id` added |
| No conversation id reaches the client, so the web cannot resume a thread | `conversation_id` is the first event of every turn; the client sends it back next turn; the graph checkpointer resumes by `thread_id = conversation_id` |

Graph (`get_discovery_graph()`, `app/services/discovery_graph.py`):

```
START -> understand
  understand --legacy--> legacy_agent --> respond --> END
  understand --clarify--> clarify --> respond --> END
  understand --search--> search_offers --offers--> present --> respond --> END
  understand --search--> search_offers --none--> sourcing --> respond --> END
```

Nodes and what each owns:

- `understand` — requirement extraction. LLM intent
  (`intent_extractor.extract_search_intent`) is best-effort and
  merged into deterministic local extraction
  (`discovery_requirements.extract_requirements_local`); when Gemini
  is down, local extraction alone drives the decision. Never invents
  a requirement: a field is set only when the user's words state it.
- `clarify` — targeted questions + partial search (see §3).
- `search_offers` — `offer_search.search_offers` (§6). Records
  `tools_used: ["search_offers"]` for persistence.
- `present` — deterministic summary text over the offers actually
  found (`summarize_offers_text`). Adds no availability,
  verification, or quality claim — the card shows provider-stated
  fields.
- `sourcing` — `sourcing_requests.create_sourcing_request` +
  `record_pending_notification` (§5).
- `legacy_agent` — collects the existing `run_agent_streaming`
  (AgentExecutor + tools) into state events, so `respond` emits them
  in the same SSE shape as before.
- `respond` — assembles the canonical event order (§2).

### What remains AgentExecutor (not migrated in this phase)

- The conversational turns routed to `legacy_agent`: greetings,
  comparing exactly two people, and named-person deep dives. The
  tools they call (`search_creatives`, `profile_deep_dive`,
  `compare_profiles`) are unchanged.
- The Team Search graph's own agents (business/search/reviewing/
  people-analyst/project-creator/persuasion) — that graph was already
  LangGraph; Phase 3 re-enabled it, it did not migrate it (§4).
- `no_results_messenger.py` still exists (used by the legacy
  `/search` path). The discovery graph does not call it; the sourcing
  node replaces it for discovery turns. Removing it is a later
  cleanup, not this phase.

### Orchestration vs provider separation

The graph holds no model client. Gemini is reached only through the
existing services: `extract_search_intent` (understand),
`run_agent_streaming` (legacy node), `generate_embedding`
(offer search/indexing). Swapping the provider means changing those
services, not the graph. State is plain JSON-serializable data
(dicts/lists/strings), so the checkpointer can persist it.

### Checkpointer

Upstash Redis (`RedisSaver`) when `UPSTASH_REDIS_URL` is set, else
in-process `MemorySaver` — the same pattern as Team Search
(`team_search/graph.py:_build_checkpointer`). The fallback is
in-process only: conversation state is lost on restart/redeploy.
**Redis persistence is NOT claimed as verified:** no Redis was
reachable from this environment, so the MemorySaver path is the one
that actually ran here. Verifying the Redis checkpointer against a
live Upstash instance is Phase 5 work.

## 2. Structured-streaming contract (O12 — defined in this phase)

Spec OPEN O12 asked for the concrete contract. This section **is**
the contract (v1, `cubora-discovery-sse/1`). It covers the discovery
stream only (`POST /api/agent`, proxied by the web as
`POST /api/discovery`); Team Search keeps its own event set
(`team_question`, `team_update`, …) documented in
`app/routes/team_search.py`.

### Transport

- HTTP POST, response `Content-Type: text/event-stream`.
- One event per SSE `data:` line: `data: {"type": ..., "content": ...}\n\n`.
- No `id:` / `Last-Event-ID` / server retry in v1. Reconnect is a new
  POST with the same `conversation_id`; the server resumes from the
  checkpointed graph state.
- The stream always ends with a `done` event, even after an `error`
  (§2.4). A client must never wait on an unterminated stream: the
  server emits `done` defensively when the graph yields no events.

### Event schema

| type | content | when |
|---|---|---|
| `conversation_id` | `"<uuid>"` | First event of a turn, when a conversation exists. The client stores it and sends `conversation_id` on the next turn. |
| `message` | `"<text chunk>"` | Plain assistant text, split into ~120-char chunks. Concatenate in order. |
| `clarification` | `{"questions": ["…"], "partial_offers": [OfferCard]}` | At most 2 questions; `partial_offers` holds preliminary matches (possibly `[]`). |
| `offers` | `{"offers": [OfferCard], "query": "…", "partial": bool}` | Offer cards to render inline. `partial: true` means the search ran on incomplete requirements (shown while clarifying). |
| `sourcing_request` | `{"id": "…", "status": "open", "query": "…"}` | A sourcing request was created for this turn (no-results path). |
| `profiles` | `[<profile>]` | Legacy passthrough from the AgentExecutor node (talent profiles, pre-Phase-3 shape). |
| `search_log` | `{"log_id": "…"}` | Legacy passthrough (rating/feedback link). |
| `error` | `{"message": "…"}` | A recoverable failure. The stream still ends with `done`. |
| `done` | `"end"` | Always last. |

`OfferCard` is the web `Offer` JSON (camelCase,
`apps/web/modules/catalog/types.ts`): `id, category, title,
description, skills, languages, city, country,
availabilityStatus, quantityAvailable, quantityUnit,
productionCapacity, pricingBasis, priceAmount, priceCurrency,
originCountry, originVerified, madeInCuba, verificationStatus,
provider: {displayName, kind, city, country, languages,
verificationStatus}`. Only rows that exist in `tropical_offers`
are ever sent; a missing price stays `null` (price on request),
a missing quantity stays `null` (quantity on request).

`tool_used` is intentionally **not** a wire event: the service
collects it for persistence and never streams it (as before).

### Ordering

Discovery turn, canonical order: `conversation_id`, `message`
chunks, `clarification` (if any), `offers` (if any),
`sourcing_request` (if any), `done`. A search turn emits `message`
then `offers`; a clarification turn emits `message` then
`clarification` (with `offers` `partial: true` when preliminary
matches exist); a no-results turn emits `message` then
`sourcing_request`. Legacy turns emit the AgentExecutor events in
their original order, then `done`.

### Failure semantics

- Graph failure mid-turn: the service yields a `message` apology
  event, then `done`. The turn is still persisted (user message +
  apology) so the conversation history stays coherent.
- A failed stage inside a node degrades, never aborts the turn:
  intent extraction falls back to local extraction; semantic
  search falls back to structured search; a failed partial search
  yields a clarification without partial offers; a failed sourcing
  insert yields the honest no-results text plus `error_message` in
  state (no `sourcing_request` event is emitted).
- Unknown event types, malformed JSON lines, and heartbeat lines
  are ignored by the client (`modules/discovery/events.ts`), never
  fatal. An offer that fails validation is dropped, never repaired
  with invented fields.

### Client handling (web)

`components/tropical/discovery-chat.tsx` reads the stream
incrementally, parses each line with `parseDiscoveryEvent`, and
renders: text bubbles, question lists, `OfferCard` grids inline,
and the sourcing-request notice. `modules/discovery/events.ts`
holds the parser and its tests. The browser never calls the AI
service directly: `app/api/discovery/route.ts` forwards the
signed-in user's own Supabase JWT (from the verified session,
never from the request body).

## 3. Adaptive search / clarification

Plan §4, spec S18–S19. The decision is deterministic and testable
(`discovery_requirements.py`, no LLM, no I/O):

- **Search immediately** when the request is sufficiently clear: a
  category keyword (talent/services/products, EN/ES), a named
  skill/passion, a location, or ≥ 3 content terms.
- **Ask only when necessary:** at most 2 targeted questions about
  what is actually missing (category first, then the most important
  detail), at most 2 rounds per conversation. After 2 rounds the
  graph searches with whatever requirements exist.
- **Show partial results:** the `clarify` node runs a partial offer
  search first whenever any signal exists (category, terms, passion,
  or location), and attaches the matches to the clarification event
  — the buyer never waits on a blank conversation.

The LLM intent extractor (`intent_extractor`) adds `passion` /
`location_city` when it works; it never overrides an explicitly
stated local value, and its failure changes nothing (local
extraction alone decides). The UK-only `city_normalizer` is
deliberately **not** used for locations: it maps UK aliases and
would mis-normalize Cuban place names.

## 4. Team Search — re-enabled

`POST /api/team-search` is mounted again
(`app/routes/__init__.py`). Auth is the same as the agent routes:
JWT via `get_current_user` + per-IP rate limit; unauthenticated
requests get 401. Tests:
`apps/ai/tests/test_team_search_route.py` (mounted, 401 without
auth, clarification stream with a stubbed graph).

Two things the re-enable does **not** fix:

1. **Checkpointer:** same Redis → MemorySaver fallback as §1.
   Redis persistence is unverified (no live Upstash here).
2. **Legacy tables — DECIDED in Phase 4 (2026-11-12): disable the
   nodes, do not create the tables.** The graph's `project_creator`
   and `persuasion_agent` nodes wrote to `projects` /
   `project_members` / `connections` / `messages`, which no web
   migration creates (migration 053 deliberately excluded them).
   Phase 4 decided **not** to create those tables: they would
   resurrect a second project model nothing in the web reads, under a
   `projects` name that collides with `tropical_projects`, while the
   Cubora commercial operation is the negotiation, owned by the Phase
   4 CRM (migration 056). Approval of a reviewed team now ends at
   the `crm_handoff` node (`route_after_review` returns
   `crm_handoff` on an approval phrase, in both create and update
   mode): status `complete`, `project_id` `None`, no Supabase writes,
   and a message telling the user Cubora operations will open the
   commercial operation. The two node modules stay in the tree,
   marked DISABLED, as history; the graph no longer contains them.
   Tests: `apps/ai/tests/test_team_search_crm_handoff.py` (routing,
   handoff node, compiled-graph node set). The `creating` /
   `inviting` statuses are kept as literals in `state.py` for
   history but are no longer emitted. Clarify / search / review work
   as before.
3. `agent_conversations.mode` (`'team_search'`) is added by
   migration 055 — the route inserts it, and 053 created the table
   without it.

`push_scope` (removed in sentry-sdk 2.x) is fixed on the two paths
this phase touches (`routes/agent.py`, `routes/team_search.py` →
`new_scope()`). The remaining sites (`app/core/__init__.py`,
`routes/internals/search.py`, `routes/admin.py`,
`routes/recommendations.py`, `routes/vectorize.py`) still use it
and will raise `AttributeError` inside their error handlers when
hit; that is a Phase 5 item, reported not gold-plated here.

## 5. No-results workflow & sourcing requests (O13 — default decided)

Plan §4, spec S21. When the offer search returns nothing:

1. `sourcing` node creates `tropical_sourcing_requests`
   (migration 055): `user_id`, verbatim `query`, structured
   `requirements` JSONB, `status = 'open'`, `conversation_id`.
2. It records a row in `tropical_sourcing_notifications`
   (`status = 'pending'`, `channel = 'email'`).
3. The client receives a `sourcing_request` event and shows that
   Cubora will look for a supplier.

**O13 default (ASSUMES, not a requirement):** the spec leaves open
how long a request stays open and what triggers the notification.
This phase takes the following default, recorded here so Roger can
overturn it: a request stays `open` until a match is recorded
(status → `matched`, by the Phase 4 CRM when ops links a verified
offer) or the requester withdraws it (Phase 4); the notification
fires on the **first verified match**; there is **no expiry
threshold** in the MVP. The `notified` status is set when the
notification is delivered (Phase 4).

**Notification delivery is a stub.** `record_pending_notification`
only writes the pending row. Nothing is sent — no email, no push.
The row is the queue Phase 4 delivers from. The code and the
migration both say so; no status, UI copy, or doc claims delivery
works.

**Searchable registration:** the request is searchable by ops via
the GIN index on `requirements` plus the `(status, created_at)`
queue index (migration 055). There is no buyer-facing search over
sourcing requests in this phase.

**Status guard:** only ops moves a request out of `open` — RLS
(no UPDATE/DELETE policy for `authenticated`) plus the
`tropical_sourcing_requests_guard_status` trigger, following the
051/052 pattern.

## 6. Offer-level Pinecone indexing

`search_indexed_at` (the Phase 2 placeholder on `tropical_offers`)
is now written by `app/services/offer_indexing.py`, reusing the
profile vectorization seam (same embedding service, same index —
extended, not duplicated):

- `offer_to_text` builds the embeddable text from provider-stated
  fields only (title, description, category, skills, languages,
  city, country, production capacity). No export/payment/delivery
  claim is ever added.
- `index_offer` upserts vector id `offer-<offer_id>` with metadata
  `{record_type: "offer", offer_id, category, title, city, country,
  skills, made_in_cuba, availability_status}`, then stamps
  `search_indexed_at`. Only `published` offers are indexed; drafts
  are skipped (they must not surface in buyer search).
- `index_unindexed_offers` indexes every published offer with
  `search_indexed_at IS NULL`, in batches.
- Admin endpoint `POST /api/admin/backfill-offer-vectors`
  (`X-Admin-Key`, `?dry_run=true` counts without indexing,
  `?limit=` caps the run), mirroring `backfill-vectors`.
- `offer_search.search_offers` queries Pinecone with filter
  `{record_type: {"$eq": "offer"}}`, hydrates the ids from
  Supabase, and fills up to the limit with structured search.
  Either stage failing degrades to the other; both failing returns
  `[]`, never an invented result.

## 7. What this phase deliberately leaves for Phases 4–5

- **Phase 4 (Commercial Operations) — done 2026-11-12, see
  `docs/product/commercial-model.md` and
  `docs/architecture/data-model.md` §10:** the internal CRM
  (sourcing queue UI, supplier verification workflow, matching a
  sourcing request to a verified offer), notification **delivery**
  (recorded manual step from the pending rows — no provider wired),
  quotations/proposals, negotiation tracking, contact-release
  controls, fee records. The legacy Team Search tables decision is
  **decided: disable the two nodes, do not create the tables**
  (§4 above).
- **Phase 5 (Quality & Launch):** verifying the Redis
  checkpointer against live Upstash; the remaining `push_scope`
  sites; the AI auth gaps the audit found (`/search` and the
  insights endpoints are still unauthenticated — the discovery
  proxy does not use them); RLS validation of migration 055
  against a live database (all policies here are unapplied, as
  every migration in this repo has been so far); bilingual QA of
  `/discover`; live verification of offer indexing against real
  Pinecone/Gemini.
- **Open spec questions untouched:** O1–O5 (fee model, "securing a
  contact", fee timing, contact-release conditions,
  payment/compliance route), O6 (what "verified" means), O8 (human
  review scope), O9 (launch bar). O12 is defined here; O13 has a
  documented default (ASSUMES) in §5.

## 8. Verification (this phase)

- Web: `bun run typecheck` PASS; `bun test` 110/110 (100 baseline
  + 10 new in `modules/discovery/events.test.ts`).
- AI: `uv run python -m compileall -q app` PASS;
  `uv run python -c "from app.main import app"` PASS (14 API routes
  incl. `/api/team-search`, `/api/admin/backfill-offer-vectors`;
  `/generate-search-insights` fails to load under dummy env, as
  before — pre-existing, unrelated to this phase).
- AI tests: 52 new tests pass (events, requirements, sourcing,
  offer search/indexing, discovery graph, agent-service wiring,
  team-search route). Full-suite delta, measured in this session
  with `--timeout=15 --timeout_method=signal` (pre-existing tests
  call live Gemini and hang on the sandbox egress without a bound):
  **before 29 failed / 24 passed, after 29 failed / 24 passed —
  identical failure sets, zero delta** (verified by running the
  suite on the stashed pristine tree). `tests/test_auth.py` still
  fails collection (pre-existing drift: it imports
  `get_supabase_client` from `app.dependencies.auth`, where it no
  longer lives). No assertion was weakened.
- Migration 055 parses (pglast, 25 statements). No live database
  run — unapplied, like every migration in this repo.
