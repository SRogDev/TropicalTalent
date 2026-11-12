# Sourcing Workflow — Cubora

**Status:** Phase 5 (Quality & Launch). Operations record for the
sourcing-request lifecycle as actually built in Phases 3 and 4.
Sources: `CUBORA_PLAN.md` §4, §9; `CUBORA_SPEC_ANALYSIS.md` §4.3
(MUST S21, SHOULD S22), §10 O13; `docs/architecture/ai-orchestration.md`
§5 (no-results workflow, O13 default); `docs/architecture/data-model.md`
§8 (migration 055); `docs/product/commercial-model.md` §2, §6.

## 1. Why sourcing requests exist

Cubora should be able to generate new supply, not just display
existing listings (plan §4, spec S22). When a buyer describes a need
and no suitable offer exists, the platform does not end the
conversation with a dead end — it creates a structured sourcing
request, registers it in internal operations, searches for potential
suppliers, verifies relevant candidates, and notifies the consumer
when a real opportunity becomes available (plan §4, spec S21).

## 2. The lifecycle as built

```
no-results discovery turn
  → sourcing request created (status: open)
  → registered in the internal ops queue
  → ops searches for potential suppliers
  → relevant candidates verified (verification workflow)
  → match to a verified, published offer (status: matched)
  → requester notified (status: notified)
```

### Step 1 — Creation (automated, Phase 3)

When the LangGraph discovery graph's `search_offers` node returns
nothing, the `sourcing` node runs (`sourcing_requests.create_sourcing_request`
+ `record_pending_notification`):

- A `tropical_sourcing_requests` row is created (migration 055):
  `user_id`, the verbatim `query`, structured `requirements` jsonb,
  `status = 'open'`, and `conversation_id` (nullable FK to
  `agent_conversations`).
- A row is recorded in `tropical_sourcing_notifications`
  (`status = 'pending'`, `channel = 'email'`).
- The client receives a `sourcing_request` event
  (`cubora-discovery-sse/1`) and shows that Cubora will look for a
  supplier.

Creation is the only automated step. The AI never invents a supplier
to fill the gap — the request records the real need and waits for a
real, verified offer.

**Test coverage (verified by reading the test files):**
`apps/ai/tests/test_sourcing_requests.py` — creating a request stores
structured requirements, an empty query is rejected, and
`record_pending_notification` writes a stub row, not a send.
`apps/ai/tests/test_discovery_graph.py` — a no-results turn creates a
sourcing request (`test_no_results_turn_creates_sourcing_request`).
Both suites run against fakes/stubs, not a live database — see §5.

### Step 2 — Registration in the internal ops queue (built)

The request is searchable by ops via the GIN index on `requirements`
plus the `(status, created_at)` queue index (migration 055), and
visible in the ops CRM (`app/[locale]/admin/operations/requests`).
There is no buyer-facing search over sourcing requests.

**Status guard:** only ops moves a request out of `open` — no
UPDATE/DELETE policy for `authenticated` on
`tropical_sourcing_requests`, plus the
`tropical_sourcing_requests_guard_status` trigger, following the
051/052 pattern.

### Step 3 — Supplier search (human, ops)

Ops searches for potential suppliers against the request's
requirements. This step is a human operations activity: no automated
supplier-discovery job exists in the MVP. (More advanced AI-powered
sourcing and supplier discovery is a post-MVP roadmap item, plan
§15.)

### Step 4 — Verification of candidates (human, ops)

Relevant candidates go through the verification workflow before they
can be matched — see `docs/operations/supplier-verification.md`.
Matching an unverified or draft offer is refused by
`matchSourcingRequestAction`; only a verified, published offer from a
verified provider can be matched. What "verified" means is still OPEN
(O6).

### Step 5 — Match (ops action, Phase 4)

Ops matches an open sourcing request to a verified offer
(`matchSourcingRequestAction`). The match opens a negotiation
(consumer + provider + offer + sourcing request), and the request
moves to status `matched`. From there the commercial workflow takes
over — see `docs/operations/commercial-operations.md`.

### Step 6 — Notification (recorded manual step, Phase 4)

Notification delivery is a **recorded manual step only**
(`docs/product/commercial-model.md` §6):

1. Ops sends the message themselves (email, or another channel the
   requester gave).
2. Ops marks the row sent (`markNotificationSentAction`), with the
   channel, the timestamp, who sent it (`sent_by`), and how the
   requester was reached (`sent_note` — required; a sent mark
   without a note is refused).
3. If the sourcing request was `matched`, it moves to `notified`.

**No email or push provider is wired.** Nothing on the notifications
page sends anything. The pending row is the queue; delivery is a
human act recorded in the database. Wiring a real provider is a later
decision, not smuggled in here.

## 3. What is automated vs what is human

| Step | Automated | Human (ops) |
|---|---|---|
| Create request on no-results | Yes — discovery graph `sourcing` node | — |
| Record pending notification row | Yes — `record_pending_notification` | — |
| Queue and search by ops | — | Yes — CRM queue, GIN-indexed search |
| Find and vet candidate suppliers | — | Yes |
| Verify candidates | — | Yes — verification workflow |
| Match request to verified offer | — | Yes — `matchSourcingRequestAction` |
| Notify the requester | — | Yes — manual send + recorded mark |

## 4. OPEN timing question (O13)

**Spec OPEN O13 — "How long may a sourcing request stay open, and
what triggers the consumer notification — first verified candidate,
best match, or a time threshold?" — is unanswered in the spec, and
this doc does not answer it.** What Phase 3 recorded is a **default
(ASSUMES, not a requirement)**, documented in
`docs/architecture/ai-orchestration.md` §5 so Roger can overturn it:

- A request stays `open` until a match is recorded (status →
  `matched`, by the Phase 4 CRM when ops links a verified offer) or
  the requester withdraws it (Phase 4).
- The notification fires on the **first verified match**.
- There is **no expiry threshold** in the MVP.

That default is a working assumption, not a decision. Until Roger
answers O13, there is no defined maximum open time, no definition of
"best match" vs "first verified candidate" as the trigger, and no
expiry or stale-request handling. A request could in principle stay
open indefinitely under the current default — that is the honest
consequence of the undecided question, and it is recorded here rather
than papered over with an invented deadline.

## 5. What is planned, not implemented

- **Live verification.** The sourcing tables (migration 055) are
  unapplied, like every migration in this repo; RLS validation
  against a live database is Phase 5 work. The AI tests above run
  against fakes, and live Pinecone/Gemini calls are unverified in
  this environment.
- **Notification delivery provider.** No email or push provider is
  wired (see §2, step 6).
- **Automated supplier discovery.** Post-MVP (plan §15).
- **Requester withdrawal flow.** Referenced by the O13 default
  (a request stays open until matched "or the requester withdraws
  it"); the withdrawal mechanism itself is not specified in the
  Phase 3/4 docs and is not claimed as built here.
- **Buyer-facing sourcing-request search.** Does not exist in the
  MVP; ops-only.
