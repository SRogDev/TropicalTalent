# End-to-End Commercial Workflow — Test Plan

**Status:** Phase 5 (Quality & Launch). Test plan for the full
commercial workflow, from a buyer describing a need to a completed
operation with a fee record. Sources: `CUBORA_PLAN.md` §4, §5, §14
Phase 5; `CUBORA_SPEC_ANALYSIS.md` §4.3–§4.4 (MUST S18–S30), §8
(acceptance criteria), §10 O1–O9, O13; `docs/architecture/ai-orchestration.md`
(Phase 3 discovery, O12 contract, O13 default);
`docs/architecture/data-model.md` §8, §10 (migrations 055/056);
`docs/product/commercial-model.md` (Phase 4);
`docs/operations/sourcing-workflow.md`;
`docs/operations/commercial-operations.md`.

**How to read this plan.** For every step: what is automated (with
the existing test file or suite that covers it, verified by reading
the test file — or the new tests the other Phase 5 workers are
adding), what needs a live database / live Pinecone / live Gemini
(marked **NOT-RUN-HERE**), and what is blocked by an OPEN question.
Coverage is claimed only where a test file was read in this session.
Nothing here claims a test was run live: no live database, Pinecone,
Gemini, or Upstash was reachable from this environment, and every
migration in this repo (051–056) is unapplied.

**Scope note.** This plan covers the commercial workflow only. It
does not cover the Phase 5 auth/RLS audit, bilingual QA, responsive
design, or observability — those are separate Phase 5 items owned by
other workers.

## 0. Test environment and prerequisites

| Prerequisite | Status |
|---|---|
| Live Supabase database with migrations 051–056 applied | **NOT-RUN-HERE** — no live database was available; all migrations are unapplied in this repo |
| Live Pinecone index with offer vectors | **NOT-RUN-HERE** — offer indexing is implemented but live calls are unverified in this environment |
| Live Gemini (intent extraction, embeddings, legacy agent) | **NOT-RUN-HERE** — live calls unverified; AI tests run against fakes/stubs |
| Live Upstash Redis (graph checkpointer) | **NOT-RUN-HERE** — Redis persistence unverified; the MemorySaver fallback is the path that actually ran |
| Test accounts: one consumer, one verified provider, one ops/admin account | Required before any run; none exist yet |
| Seeded catalog: at least one verified provider with a published, origin-verified product offer and one talent offer | Required before any run; no seed data is claimed here |

**Known pre-existing test-suite state (do not confuse with this
plan's results):** the AI test suite has pre-existing drift — the
Phase 3 measurement was 29 failed / 24 passed before the phase and
identical after it (zero delta; `tests/test_auth.py` fails
collection on a moved import). The web suite typechecks clean and
`bun test` passed 110/110 at Phase 3. Any failure observed while
running this plan must be checked against that baseline before being
attributed to the commercial workflow.

## 1. Happy path

The plan's commercial workflow (§5, spec S30), end to end:

```
request → sourcing/match → negotiation → proposal → acceptance
  → contact release → tracking → fee record
```

### Step 1 — Buyer describes a need; AI searches

**What happens:** the buyer describes the need in natural language
in the discovery chat. The LangGraph discovery graph
(`understand` → `search_offers` → `present` → `respond`) searches
immediately when the request is clear, asks at most 2 targeted
questions (at most 2 rounds) when it is not, and shows partial
results while clarifying.

**Automated (verified by reading the test files):**

- `apps/ai/tests/test_discovery_requirements.py` — deterministic
  requirement extraction and the search-vs-clarify decision (no LLM,
  no I/O): category extraction EN/ES, sufficiency rules,
  clarification capped at 2 questions with category first.
- `apps/ai/tests/test_discovery_graph.py` — the graph compiles with
  the expected nodes; a search turn emits `message` → `offers` →
  `done`; a vague turn clarifies and shows partial results; a second
  clarification round searches anyway; greetings route to the legacy
  agent.
- `apps/ai/tests/test_discovery_events.py` — the SSE event contract
  (`cubora-discovery-sse/1`): message, offers, clarification,
  sourcing-request, error-then-done, stable event-type set.
- `apps/web/modules/discovery/events.test.ts` — the web SSE parser:
  conversation id, message chunks, offers into Offer cards,
  clarification with partial offers, sourcing-request event, done
  and error, malformed offers dropped (never repaired with invented
  fields), heartbeats/junk skipped.
- `apps/ai/tests/test_offer_search.py` — structured search returns
  only published offers; empty when nothing matches; degrades when
  Supabase fails; semantic search returns offer cards from Pinecone
  ids; semantic failure falls back to structured search.
- `apps/web/modules/catalog/filters.test.ts` — catalog filter
  parsing (unknown category/availability dropped, not trusted;
  verified / Made in Cuba need exactly `"1"`).
- `apps/web/modules/catalog/ai-search.test.ts` — the server-side
  AI-search seam.

**NOT-RUN-HERE:** the live turn — real Gemini intent extraction,
real Pinecone semantic search, real Supabase hydration of offer
vectors, and the web `POST /api/discovery` → AI `POST /api/agent`
round trip. The tests above run against fakes/stubs. Live offer
indexing (`offer_indexing.py`, `search_indexed_at` stamping, the
`POST /api/admin/backfill-offer-vectors` endpoint) is covered only
by `apps/ai/tests/test_offer_indexing.py` against fakes — the live
Pinecone upsert is **NOT-RUN-HERE**.

**Pass criteria:** a clear request returns inline offer cards with
provider-stated fields only (no invented availability, verification,
or quality); a vague request asks at most 2 questions and shows
partial matches; the stream always ends with `done`.

### Step 2 — No match: sourcing request created (branch A)

**What happens:** when the offer search returns nothing, the
`sourcing` node creates a `tropical_sourcing_requests` row (status
`open`) and a pending notification row, and the client receives a
`sourcing_request` event.

**Automated (verified):**

- `apps/ai/tests/test_sourcing_requests.py` — creating a request
  stores structured requirements; an empty query is rejected;
  `record_pending_notification` writes a stub row, not a send.
- `apps/ai/tests/test_discovery_graph.py` —
  `test_no_results_turn_creates_sourcing_request`.
- `apps/ai/tests/test_discovery_events.py` — the
  `sourcing_request` event shape; `apps/web/modules/discovery/events.test.ts`
  — the web parser handles it.

**NOT-RUN-HERE:** the live insert against a real database (migration
055 unapplied), and the ops-queue visibility of the request
(`app/[locale]/admin/operations/requests`).

**Pass criteria:** a no-results turn creates exactly one open
sourcing request with the verbatim query and structured requirements,
one pending notification row, and no invented supplier in the reply.

### Step 2 (branch B) — Match: catalog match opens a negotiation

**What happens:** the consumer clicks "Request a quotation" on a
published catalog offer (`createNegotiationFromOfferAction`), or ops
matches an open sourcing request to a verified, published offer
(`matchSourcingRequestAction`). Either way a negotiation opens in
status `open`.

**Automated:** none verified. There is **no test file** for
`apps/web/modules/commercial/actions.ts` or `queries.ts` in this
repo — only `modules/commercial/validation.test.ts` (pure validation,
see step 4). **New tests needed** (other Phase 5 workers may be
adding them): opening from an offer, matching a sourcing request,
refusal to match an unverified or draft offer, and the sourcing
request moving `open` → `matched`.

**NOT-RUN-HERE:** the whole step against a live database — RLS
admission for the two parties, the status guard trigger, and the CRM
queue views.

**Pass criteria:** a negotiation exists with the right consumer,
provider, offer (and sourcing request, if matched); an unverified or
draft offer cannot be matched; the requester is not notified yet
(notification is a separate manual step).

### Step 3 — Negotiation through Cubora

**What happens:** the parties exchange mediated messages
(`tropical_negotiation_messages`); no contact details are reachable.

**Automated:** none verified. No test file covers the mediated
message actions or their RLS. **New tests needed:** only the two
parties (and ops via service role) can read/post; a third party
cannot; no message can carry contact details out of the mediated
channel (there are no contact fields on any commercial table — verify
by inspection, not by test).

**NOT-RUN-HERE:** live RLS validation of the message table and the
negotiation read policies.

**Pass criteria:** both parties can read and post; nobody else can;
no email or phone number is exposed in any negotiation read.

### Step 4 — Proposal prepared; both parties accept

**What happens:** a proposal is prepared on the negotiation
(`tropical_proposals`: title, summary, `terms` jsonb). Each party
sets only their own acceptance flag; when both flags are set, ops
marks the proposal `accepted` (`setProposalStatusAction`), which
moves the negotiation to `accepted`.

**Automated (verified):**

- `apps/web/modules/commercial/validation.test.ts` — the pure rules:
  `canTransitionNegotiation` allows only the listed transitions
  (`open` → `proposal` → `awaiting_acceptance` → `accepted` →
  `contact_released`/`completed`; `blocked` → `open`/`cancelled`;
  `completed`/`cancelled` terminal); `bothPartiesAccepted` requires
  both flags (one flag is not acceptance); fee parsing and display
  rules (see step 7); release-state derivation (see step 5). These
  are pure-function tests — they do not touch a database, an action,
  or RLS.

**NOT-RUN-HERE:** the action layer — `acceptProposalAction`
(refusing to touch the other side's flag), `setProposalStatusAction`
(refusing acceptance without both flags), the
`tropical_proposals_guard_status` trigger, and the negotiation
status transition on acceptance. **New tests needed** for the
actions and for the trigger behaviour against a live database.

**Pass criteria:** one flag alone never counts as acceptance; ops
cannot mark a proposal accepted without both flags; a declined
proposal flips to `declined` unilaterally without moving the
negotiation.

### Step 5 — Contact release via explicit approval

**What happens:** ops creates the contact-release approval record
(`tropical_contact_releases`, one row per negotiation,
`conditions_summary` required, per-side release flags independent),
and the parties reveal contact through `revealContactAction`, which
checks the release row first.

**Automated (verified, pure only):**

- `apps/web/modules/commercial/validation.test.ts` —
  `releaseStateFor`: without a release row nothing is released; a
  release for one side does not release the other side.

**NOT-RUN-HERE:** `revealContactAction` itself (no test file),
the ops-only write policy on `tropical_contact_releases`, the
service-role Auth admin read of the email, and the refusal path
(when the relevant side has not been released, nothing is revealed).
**New tests needed** for the action and the RLS/trigger behaviour.

**Pass criteria:** no contact is reachable before the approval
record exists; releasing one side does not release the other; a
refused reveal leaks nothing.

**Blocked by OPEN O4:** the release *conditions* themselves —
which conditions, who approves, what counts as acceptance by both
parties — are undecided. The test can verify the mechanism (record
+ check + reveal); it cannot verify the policy, because there is
none yet. The `conditions_summary` is ops' own words, case by case.

### Step 6 — Operation tracked; workspace activated

**What happens:** the negotiation moves through `accepted` →
`contact_released` → `completed`; ops activates the linked project
(`activateProjectAction`: `pending_payment` → `active`, with
`negotiation_id` set), which opens the group channel; events are
recorded in `tropical_operation_events`.

**Automated (verified, pure only):** `validation.test.ts` covers the
transition map (step 4). No test file covers `activateProjectAction`,
the project ↔ negotiation link, `tropical_can_access_channel`, or
the event log. **New tests needed.**

**NOT-RUN-HERE:** the live activation flow, channel access by
project status, and the audit-trail writes (no INSERT policy for
`authenticated`; written via service role after a party check).

**Pass criteria:** the full happy-path status sequence is
reachable and each transition is recorded as an event; the group
channel opens on the operations decision (accepted negotiation),
not on any payment event — there is none.

### Step 7 — Fee record

**What happens:** ops records the intermediation fee on
`tropical_fees` — type, amount, currency, basis, all nullable; a
record with nothing set renders as "Not set".

**Automated (verified):**

- `apps/web/modules/commercial/validation.test.ts` —
  `parseFeeInput` (empty input records nothing; a negative amount is
  rejected; a non-numeric amount is rejected; a fee type outside
  `fixed` / `percentage` / `hybrid` is rejected; blank strings become
  null) and `formatFeeForDisplay` (a fee with nothing set says so —
  never a default; a void fee is labelled void).

**NOT-RUN-HERE:** the fee-record action, the fee page
(`app/[locale]/admin/operations/fees`), voiding, and the
consumer-visible fee history RLS.

**Pass criteria:** no fee type, amount, or currency is ever
invented or defaulted; a record with nothing set displays as
"Not set", never as zero.

**Blocked by OPEN O1–O3:** the fee model, what "securing a
contact" means, and fee timing are undecided. The test can verify
that the record stores exactly what ops entered; it cannot verify
any fee *calculation*, because the model does not exist. **Fee
collection is not part of this test plan at all** — there is no
payment rail in the MVP (see §2, failure path "fee terms missing").

## 2. Failure paths

### F1 — No match (no offer exists, and no supplier is found)

**Path:** discovery → no-results → sourcing request `open` →
ops searches → no verified candidate found → request stays `open`.

**Automated:** the creation half is covered (step 2, branch A).
The "stays open" half has no test — it is the absence of a
transition, enforced by the status guard (only ops moves a request
out of `open`).

**NOT-RUN-HERE:** live queue behaviour over time; there is no
expiry threshold in the MVP (see O13 below), so "stays open" is
verified by observing that nothing moves it.

**Pass criteria:** the request remains `open` with no match, no
notification row is marked sent, and the buyer is never told a
supplier exists when none does. **OPEN O13** (how long a request
stays open; notification trigger) means there is no defined
"give up" point to test against — the Phase 3 default (open until
matched or withdrawn; notify on first verified match; no expiry)
is a working assumption, not a decision.

### F2 — Rejected proposal

**Path:** proposal sent → one party declines → proposal
`declined`, negotiation untouched.

**Automated (verified, pure only):** the transition map in
`validation.test.ts` (a declined proposal is not an accepted one;
`awaiting_acceptance` can return to `proposal`).

**NOT-RUN-HERE:** the decline action (verified privileged-write
path: party checked as the user, written as the service role,
recorded as an event) and the "negotiation untouched" assertion
against a live database. **New tests needed.**

**Pass criteria:** the proposal is `declined`, the negotiation
status does not change, the decline is recorded as an event, and a
new proposal can still be prepared on the same negotiation.

### F3 — Blocked compliance case

**Path:** a compliance review opens on a negotiation → negotiation
`blocked` → review cleared → negotiation back to `open` (or
cancelled).

**Automated:** none verified. No test file covers
`tropical_compliance_reviews`, the block/unblock transitions, or
the `blocked` state in the negotiation machine beyond the pure
transition map (`blocked` → `open`/`cancelled` in
`validation.test.ts`).

**NOT-RUN-HERE:** the review actions, the ops-only table (no RLS
policies for `authenticated` at all), and the live block/unblock
round trip.

**Pass criteria:** opening a review blocks the negotiation; no
party action can advance a blocked negotiation; clearing the review
unblocks it; the review and the block are both recorded.

**Blocked by OPEN O8:** which cases require human review, who
reviews them, and the escalation / block / unblock procedure in
detail are undecided. The test can verify the mechanism; it cannot
verify the scope, because the scope is not defined.

### F4 — Release denied

**Path:** a party (or ops) attempts contact reveal without an
approval record, or for a side whose flag is not set → reveal
refused, nothing leaked.

**Automated (verified, pure only):** `releaseStateFor` in
`validation.test.ts` — without a release row nothing is released;
one side's release does not release the other.

**NOT-RUN-HERE:** `revealContactAction` and its refusal path
against a live database. **New tests needed.**

**Pass criteria:** the reveal returns a refusal, not an error that
leaks the contact; no email is selected by any app query before the
check passes; the attempt is recorded as an event.

### F5 — Fee terms missing

**Path:** the negotiation reaches `accepted` / `contact_released` /
`completed` with no fee type, amount, currency, or basis recorded
→ the fee renders as "Not set" and nothing is charged.

**Automated (verified):** `parseFeeInput` / `formatFeeForDisplay`
in `validation.test.ts` — empty input records nothing; a fee with
nothing set says so.

**NOT-RUN-HERE:** the end-to-end run (a completed negotiation with
an empty fee record) against a live database.

**Pass criteria:** the operation completes without a fee record;
nothing in the UI or the database implies a charge; no default fee
appears anywhere. **Blocked by OPEN O1–O3 and O5:** there is no
fee model, no fee timing, and no payment/compliance route, so
"fee terms missing" is the expected state for every operation
until Roger decides — this path is not an edge case, it is the
default.

## 3. What this plan does not cover (and why)

- **RLS validation against a live database** — every policy in
  migrations 051/052/055/056 is unapplied; the live RLS audit is a
  separate Phase 5 item, and this plan's **NOT-RUN-HERE** marks are
  the places it bites.
- **AI auth gaps** (`GET /search` unauthenticated, insights
  endpoints unauthenticated) — Phase 5 items; the discovery proxy
  does not use them, but the gaps remain.
- **Bilingual QA** of the new surfaces — Phase 5 work; note the
  root README still states "No Spanish/i18n yet (UI is English)"
  while the Phase 1 docs describe `next-intl` implementation, so
  bilingual state must be verified live, not assumed from either doc.
- **The remaining `push_scope` sites** in apps/ai
  (`app/core/__init__.py`, `routes/internals/search.py`,
  `routes/admin.py`, `routes/recommendations.py`,
  `routes/vectorize.py`) — Phase 5 items; they raise
  `AttributeError` inside their error handlers when hit.
- **Team Search end-to-end** — clarify/search/review work; project
  creation and invitations are disabled by design (Phase 4 decision:
  approval ends at the `crm_handoff` node, no Supabase writes).
  Covered by `apps/ai/tests/test_team_search_crm_handoff.py` and
  `test_team_search_route.py` (verified by reading); the live
  route is **NOT-RUN-HERE**.
- **Redis checkpointer verification** against live Upstash —
  Phase 5 work; the MemorySaver fallback is the path that ran.

## 4. The launch-bar question (O9) — OPEN

**Spec OPEN O9 — "What is the MVP launch bar — how many verified
suppliers/buyers, and which end-to-end workflows must pass before
launch?" — is unanswered, and this plan does not answer it.** This
document defines *how* to test the workflow; it cannot define
*whether the results are enough to launch*, because the bar is
Roger's decision. Concretely, this plan leaves open:

- How many verified suppliers and buyers must exist before launch
  (no number is stated anywhere in this plan).
- Which of the paths above must pass live (happy path only, or happy
  path plus all five failure paths) before launch.
- Whether the **NOT-RUN-HERE** items (live database, live Pinecone,
  live Gemini, live RLS validation) must all be run before launch —
  this plan's position is that they must, because every migration
  and every AI integration is currently unverified live, but that
  requirement is a recommendation, not a decided bar.

Until O9 is answered, a green test run against fakes and pure
functions is **not** a launch signal. The honest launch statement
today is: the workflow is specified, the pure rules are tested, the
actions and the live integrations are not yet verified.

## 5. Test inventory (verified by reading)

| Area | Test file | What it covers |
|---|---|---|
| Commercial validation (pure) | `apps/web/modules/commercial/validation.test.ts` | State machine, fee parse/format, release state, both-accepted |
| Discovery requirements | `apps/ai/tests/test_discovery_requirements.py` | Extraction, search-vs-clarify decision |
| Discovery graph | `apps/ai/tests/test_discovery_graph.py` | Nodes, search/clarify/no-results turns |
| Discovery events (AI) | `apps/ai/tests/test_discovery_events.py` | SSE contract `cubora-discovery-sse/1` |
| Discovery events (web) | `apps/web/modules/discovery/events.test.ts` | SSE parsing, malformed-offer dropping |
| Sourcing requests | `apps/ai/tests/test_sourcing_requests.py` | Creation, empty-query rejection, pending-row stub |
| Offer search | `apps/ai/tests/test_offer_search.py` | Published-only, degradation, semantic fallback |
| Offer indexing | `apps/ai/tests/test_offer_indexing.py` | Vector upsert, draft skip, unindexed backfill |
| Catalog filters | `apps/web/modules/catalog/filters.test.ts` | Filter parsing |
| Catalog AI search seam | `apps/web/modules/catalog/ai-search.test.ts` | Server-side seam |
| Team Search handoff | `apps/ai/tests/test_team_search_crm_handoff.py` | Routing, handoff node, compiled-graph nodes |
| Team Search route | `apps/ai/tests/test_team_search_route.py` | Mounted, 401 without auth, clarification stream |

**Gaps (no test file found — new tests needed, possibly being added
by other Phase 5 workers):** `modules/commercial/actions.ts`
(negotiation open/match, proposal accept/decline, contact reveal,
fee record, notification mark-sent, project activation),
`modules/commercial/queries.ts`, mediated-message RLS behaviour,
compliance-review block/unblock, and any live-database, live-Pinecone,
or live-Gemini run of the above.
