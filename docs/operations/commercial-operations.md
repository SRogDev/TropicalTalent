# Commercial Operations — Cubora

**Status:** Phase 5 (Quality & Launch). Operations record for the
commercial workflow as actually built in Phase 4. Sources:
`CUBORA_PLAN.md` §5, §8, §9; `CUBORA_SPEC_ANALYSIS.md` §4.4
(MUST S23–S30), §10 O1–O5, O7, O8; `docs/product/commercial-model.md`
(Phase 4 design doc, migration 056); `docs/architecture/data-model.md`
§10 (migration 056 tables).

## 1. The workflow as built

The plan's commercial workflow (§5), in the order the product
implements it:

1. Consumer submits a request — a natural-language discovery turn,
   or a quotation request on a catalog offer.
2. Cubora identifies or sources potential suppliers — a catalog
   match, or a sourcing request matched to a verified offer by ops.
3. Consumer receives relevant opportunities — the negotiation opens.
4. Negotiation takes place through Cubora — mediated messages, no
   direct contact.
5. A concrete commercial proposal is prepared — a proposal /
   quotation on the negotiation.
6. Both parties accept the required conditions — acceptance flags on
   the proposal, recorded by ops as proposal status `accepted`.
7. Contact details are released according to the agreed policy — the
   contact-release approval record (see §4).
8. The operation is tracked — status, messages, events, and the
   activated workspace.
9. Cubora collects its intermediation fee — **not in the MVP**
   (see §5). The fee *record* exists; collection does not.

## 2. The negotiation and the state machine

One negotiation is one buyer, one provider, and optionally one offer
or one sourcing request. It is the commercial operation. Proposals,
messages, the contact release, fee records, compliance reviews, and
the audit trail all hang off it (`tropical_negotiations`).

A negotiation opens in exactly two ways:

- **From an offer:** the consumer clicks "Request a quotation" on a
  published catalog offer (`createNegotiationFromOfferAction`).
- **From a sourcing request:** ops matches an open sourcing request
  to a verified, published offer from a verified provider
  (`matchSourcingRequestAction`). Matching an unverified or draft
  offer is refused.

The state machine (migration 056, `NEGOTIATION_TRANSITIONS` in
`modules/commercial/validation.ts`):

```
open → proposal → awaiting_acceptance → accepted
  → contact_released → completed
any non-terminal state → blocked → open (unblock) | cancelled
completed / cancelled are terminal
```

**Ops drives every transition.** There is no UPDATE/DELETE policy
for the `authenticated` role on `tropical_negotiations`, and the
`tropical_negotiations_guard_status` trigger raises on any status
change from that role. Parties signal intent on proposals (acceptance
flags); ops records the transitions.

This state machine replaces the escrow-funded transitions the
inherited workspace keyed off. The group channel used to unlock when
escrow was funded, and escrow funding is stubbed to always refuse —
so the group channel could never unlock. The fix: activation is now a
Cubora operations decision (a negotiation is accepted, ops activates
the linked project via `activateProjectAction`, project
`pending_payment` → `active`), and the group channel opens because
the project is active. **No payment event is involved anywhere.
There is no payment rail in the MVP.**

## 3. Proposals and quotations

A proposal is a commercial object tied to a negotiation
(`tropical_proposals`): title, summary, and `terms` — scope,
deliverables, price basis and amount as the author wrote them. The
author role is derived from who the viewer is, never taken from the
form. Cubora's intermediation fee is **not** in the proposal; it
lives on the fee record (§5).

Acceptance is two flags, one per party:

- A party sets **only their own flag** (`acceptProposalAction`
  refuses to touch the other side's flag).
- Both flags set is acceptance by both parties. Ops then marks the
  proposal `accepted` (`setProposalStatusAction`), which also moves
  the negotiation to `accepted` when the transition is valid. Ops
  records the fact; it does not invent acceptance — marking a
  proposal accepted without both flags is refused.
- Declining is unilateral: a party declines, the status flips to
  `declined` through the verified privileged-write path, and the
  negotiation is untouched.

Proposal status is ops-only at the database (the
`tropical_proposals_guard_status` trigger), like negotiation status.

## 4. Mediated communication and contact release

**Rule (plan §5, spec S24/S27):** buyers and providers cannot
directly access each other's contact information before the agreed
release conditions are met. Communication and negotiation happen
through Cubora.

How it is enforced, in code and in the database:

- **There are no contact fields on any commercial table.** A party's
  email lives only in Supabase Auth; no app query selects it. The
  negotiation, its messages, and its proposals are readable by the
  parties — contact details are not in any of them.
- **Negotiation messages** (`tropical_negotiation_messages`) are the
  mediated channel. RLS admits only the two parties (and ops via the
  service role). A negotiation happens before any project exists, so
  it cannot reuse the project-scoped `tropical_channels`.
- **Contact release happens only through an explicit approval
  record** (`tropical_contact_releases`, one row per negotiation,
  ops-only writes, RLS read for the parties). The reveal goes through
  `revealContactAction`, which checks the release row first and
  refuses — without revealing anything — when the relevant side has
  not been released. The contact (email from Supabase Auth) is
  fetched through the service-role client only after that check.
- **The two sides are independent:** releasing the consumer's contact
  does not release the provider's, and vice versa. The release record
  captures what ops attested was met (`conditions_summary`, in ops'
  own words) and which side was released.

## 5. Fee records — record only, never a charge

**Rule (plan §5, spec S28):** the consumer pays Cubora's
intermediation fee according to the agreed commercial terms. **In
the MVP there is no collection:** no payment rail, no custody of
funds, no escrow, no Stripe. A fee record is a record, not a charge.

`tropical_fees` stores, per operation, exactly what ops enters:

- `fee_type` — `fixed` | `percentage` | `hybrid` (the plan's own
  three words) **or NULL**.
- `fee_amount` — numeric, ≥ 0, **or NULL**.
- `fee_currency` — free text, **or NULL**. No currency is defaulted.
- `fee_basis` — what the amount/percentage applies to, as ops wrote
  it, **or NULL**.
- `status` — `recorded` | `void` (voiding keeps the row as an audit
  trail).

Nothing in the migration, the validation, or the UI supplies a
default: no percentage, no amount, no currency. A record with nothing
set renders as "Not set" — never as zero, never as a default fee.
Fee history is consumer-visible; RLS admits only the consumer of the
operation.

## 6. Notification delivery — manual only

Phase 3 left pending rows (`tropical_sourcing_notifications`,
status `pending`). Phase 4 delivers from those rows — as a
**recorded manual step only**:

1. Ops sends the message themselves (email, or another channel the
   requester gave).
2. Ops marks the row sent (`markNotificationSentAction`), with the
   channel, the timestamp, who sent it (`sent_by`), and how the
   requester was reached (`sent_note` — required; a sent mark without
   a note is refused).
3. If the sourcing request was `matched`, it moves to `notified`.

**No email or push provider is wired.** Nothing on the notifications
page sends anything. Wiring a real provider is a later decision, not
smuggled in here.

## 7. Compliance reviews and blocked cases

Human review for sensitive or high-risk cases (plan §12, spec S61,
S63). `tropical_compliance_reviews` is ops-only — no RLS policies
for `authenticated` at all. Opening a review on a negotiation blocks
it (`blocked`); clearing the review unblocks it (back to `open`).

**What this phase does not claim:** legal compliance. Cuba-related
sanctions, export controls, payment restrictions, and other legal
requirements need transaction-specific review by qualified
professionals (plan §12, spec S64). The platform must not facilitate
evasion, and nothing here certifies a transaction as compliant.

## 8. Audit trail

Important commercial events and agreements are recorded (plan §5,
spec S29) in `tropical_operation_events`: negotiation opened,
sourcing request matched, proposal sent / accepted by one side / by
both / declined, proposal status set, negotiation status changed,
contact released, fee recorded / voided, workspace activated. The
table has no INSERT policy for `authenticated`; rows are written
through the service role after the action has established, via an
RLS read, that the caller is a party or ops.

## 9. OPEN decisions — blocking, no invented values

The following spec OPEN questions are **blocking** for commercial
operations. None is answered by Phase 4, none is answered in this
doc, and no value for any of them is invented anywhere in the
product or in these docs:

| Question | What is open | What it blocks |
|---|---|---|
| **O1 — Fee model** | Fixed, percentage-based, or hybrid, and on what base a percentage is calculated | Fee records, fee/payment history UI, commercial terms, revenue tracking |
| **O2 — "Securing a contact"** | What precisely counts as securing a contact — the release itself, the first direct exchange, a signed agreement, or something else | Contact-release conditions and the fee trigger |
| **O3 — Fee timing** | At what exact moment the fee becomes payable — on contact release, on agreement, on operation completion, or another milestone | Fee collection workflow and dashboards |
| **O4 — Release conditions** | The exact conditions for releasing contact details — which conditions, who approves release, what counts as acceptance by both parties, and whether release is reversible | Contact-release controls and CRM approvals |
| **O5 — Payment / compliance route** | Which payment providers and currencies, how money moves for fees and for operations, who performs transaction-specific review, and what happens when no compliant route exists | Fee collection, any claim that a product can be paid for, Phase 4 operations, post-MVP payment methods |
| **O7 — Commercial terms** | What the "agreed commercial terms" are — who drafts them, in what form, and where/how they are accepted in-product | Negotiation workflow, proposal acceptance, fee terms |

Related but not blocking the state machine itself: **O6** (what
"verified" means — see `docs/operations/supplier-verification.md`)
and **O8** (human-review scope — see §7 above).

Until O1–O3 are answered, fee records may carry only a note about
what was agreed, or nothing at all. Until O4 is answered, ops
records the release decision case by case in `conditions_summary`,
and nothing in the product defines the policy. Until O5 is answered,
no fee can be collected and no product can be presented as payable.
Until O7 is answered, proposals carry the author's own terms as free
text / JSON; they are not Cubora's terms.

## 10. What is planned, not implemented

- **RLS validation against a live database** (all policies in
  migration 056 are unapplied, as every migration in this repo has
  been so far) — Phase 5 work; see
  `docs/architecture/e2e-commercial-workflow.md`.
- **Bilingual QA** of the new CRM and party-dashboard surfaces —
  Phase 5 work.
- **Fee collection** through a real payment route (needs O1, O3, O5
  + legal validation) — post-MVP.
- **Escrow / transaction protection** through qualified financial
  infrastructure — post-MVP (spec O11).
- **Logistics** — post-MVP; not a prerequisite for discovery
  (plan §7).
- **Polygrow integration** — outside the MVP critical path (plan
  §17, spec O10).
