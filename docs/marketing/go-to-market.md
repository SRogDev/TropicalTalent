# Go-to-Market — Cubora

**Status:** Phase 5 (Quality & Launch). Go-to-market record for the
Cubora MVP. Sources: `CUBORA_PLAN.md` §13, §14 Phase 5, §15;
`CUBORA_SPEC_ANALYSIS.md` §4.10 (MUST S65, SHOULD S66–S68), §10 O15;
`docs/marketing/positioning.md` (audiences and pillars);
`docs/product/commercial-model.md` (what the funnel actually
records).

## 1. The buyer-first rule

The initial commercial priority is acquiring **real buyers**, not
maximizing the number of listings (plan §13, spec S65). Everything
in this plan follows from that:

- A buyer conversation that ends in a sourcing request is worth more
  than a listing that is never seen.
- Supplier onboarding serves buyer demand — supply is built toward
  real requests (including via the sourcing workflow), not stockpiled
  in advance.
- Launch readiness is judged buyer-side (qualified conversations,
  sourcing requests, completed operations), not by listing counts
  (spec §9, ASSUMES).

## 2. Acquisition channels (from the plan)

The plan names four focus areas (plan §13, spec S66). These are
channels to work, in this order of priority:

1. **International businesses seeking Cuban talent and services.**
   Outreach and presence where such businesses already look for
   talent and contractors — the primary channel.
2. **Buyers interested in Cuban products and production
   capabilities.** Buyers of physical goods, agricultural products,
   and production capacity, including buyers who need a producer
   rather than a finished product.
3. **Relevant entrepreneurs and commercial networks.** Cross-border
   business people and networks who can introduce buyers.
4. **Cuban diaspora business networks** — a potential acquisition
   channel **to validate**. It is listed in the plan as a channel to
   test, not as a proven source of buyers. Validation means: run
   outreach through a diaspora network, count qualified buyer
   conversations that result, and only then treat it as a channel.

**What is not a channel in the MVP:** paid listing acquisition,
marketplace-style seller onboarding drives, and any channel that
promises export, payment, or delivery the platform cannot yet verify
(plan §7, spec S42). No channel is claimed to work until it has
produced a qualified buyer conversation.

## 3. The funnel (what the product actually records)

The go-to-market funnel follows the commercial workflow the product
already records. Each stage is a real, stored fact — not a
spreadsheet estimate:

1. **Qualified buyer conversation** — a discovery turn (or mediated
   exchange) with a real buyer about a real need. Recorded in
   conversation history.
2. **Sourcing request** — a structured request created when no offer
   matches, registered in internal operations
   (`tropical_sourcing_requests`, status `open`).
3. **Verified match** — the sourcing request matched by ops to a
   verified, published offer from a verified provider; or a catalog
   match that opens a negotiation.
4. **Proposal** — a concrete commercial proposal prepared on a
   negotiation (`tropical_proposals`).
5. **Accepted opportunity** — a proposal accepted by both parties
   (both acceptance flags set), recorded by ops as proposal status
   `accepted` and negotiation status `accepted`.
6. **Completed operation** — a negotiation carried through contact
   release and tracking to status `completed`.
7. **Revenue** — intermediation revenue. **Planned, not implemented:**
   fee *records* exist (`tropical_fees`), fee *collection* does not
   (no payment rail in the MVP). Revenue cannot be tracked as money
   received until O1 (fee model), O3 (fee timing), and O5
   (payment/compliance route) are decided and a collection route
   exists. Until then, "revenue" in the funnel is a placeholder for
   fee records, not cash.
8. **Repeat buyer** — a buyer who returns with a further request or
   operation. **Planned, not implemented:** no repeat-buyer tracking
   exists in the product; it is a metric to define, not a number the
   product reports today.

## 4. Tracked metrics

The plan's metrics, verbatim (plan §13, spec S68):

- Qualified buyer conversations
- Real sourcing requests
- Verified supplier matches
- Proposals delivered
- Accepted commercial opportunities
- Completed operations
- Intermediation revenue
- Repeat buyers

Definitions follow §3 above. Two honesty notes:

- **"Real" sourcing requests** means requests created from a real
  buyer need (a no-results discovery turn or a direct request), not
  test or seeded data. Test data must be excluded from every metric.
- **"Verified" supplier matches** means matches to verified
  providers and verified, published offers only — the product
  refuses to match unverified or draft offers
  (`matchSourcingRequestAction`), so an unverified match cannot
  appear in this metric by construction.

## 5. Targets — OPEN (O15), none invented

**Numeric targets for the tracked metrics are OPEN (spec O15) and
no targets are invented in this document.** There is no target number
of qualified buyer conversations, sourcing requests, matches,
proposals, accepted opportunities, completed operations, revenue, or
repeat buyers stated anywhere here — because the plan sets none and
the spec records the question as unanswered: "What numeric targets
define go-to-market success for the tracked metrics?" (spec §10,
O15). Setting a target is Roger's decision; it blocks evaluating
whether marketing and launch succeeded, and it is not answered by
writing a plausible number into a doc.

The same applies to the launch bar (spec O9): how many verified
suppliers/buyers, and which end-to-end workflows must pass before
launch, is undecided. See
`docs/architecture/e2e-commercial-workflow.md`.

## 6. What launch onboarding means in the MVP

Phase 5 includes "initial buyer and supplier onboarding" (plan §14).
In the MVP that means:

- **Buyers:** onboarding as a consumer (what-do-you-want-to-do-first
  question, consumer role), a first discovery conversation, and —
  where there is no match — a sourcing request. No buyer is promised
  a supplier, a price, or a delivery date the product cannot verify.
- **Suppliers:** provider profile creation (individual or business),
  offer creation, and the verification workflow (evidence recorded,
  human decision). No supplier is promised buyers, and no offer is
  presented as verified before the verification workflow says so.
- **Operations:** the internal CRM is the launch console — incoming
  requests, unmatched requests, verification queue, matches,
  negotiations, proposals, contact-release approvals, fee records,
  compliance reviews, blocked cases.

## 7. What this doc does not claim

- No channel is claimed to work, no audience size is stated, and no
  conversion rate is given — none is in the plan.
- No revenue figure, fee amount, or currency appears here — the fee
  model (O1), fee timing (O3), and payment route (O5) are open.
- No escrow, transaction protection, logistics, or additional payment
  methods are offered at launch — all post-MVP (plan §15, spec O11).
- No Polygrow integration at launch — outside the MVP critical path
  (plan §17, spec O10).
