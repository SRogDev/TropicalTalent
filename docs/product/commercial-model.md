# Commercial Model — Cubora (Phase 4)

**Status:** Phase 4 (Commercial Operations). Design doc for the
commercial workflow, written alongside migration `056`
(`tropical_negotiations`, `tropical_negotiation_messages`,
`tropical_proposals`, `tropical_contact_releases`, `tropical_fees`,
`tropical_compliance_reviews`, `tropical_operation_events`).
**Sources:** `CUBORA_PLAN.md` §5, §8, §9; `CUBORA_SPEC_ANALYSIS.md`
§4.4 (MUST S23–S30), §10 O1–O5, O7, O8; Phase 0 audit
(`docs/architecture/repository-audit.md` §4.1, §6); data model
(`docs/architecture/data-model.md` §10).

**What this doc is:** the record of how commercial operations work
in the MVP — the workflow, the state machine, the contact-release
rule, the fee record, and the manual notification step. It also
records, explicitly, what is still undecided and who decides it.

## 1. The workflow

The plan's commercial workflow (§5), in order:

1. Consumer submits a request — a natural-language discovery turn,
   or a quotation request on a catalog offer.
2. Cubora identifies or sources potential suppliers — a catalog match,
   or a sourcing request matched to a verified offer by ops.
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
9. Cubora collects its intermediation fee — **not in the MVP** (see
   §5). The fee *record* exists; collection does not.

## 2. The negotiation

One negotiation is one buyer, one provider, and optionally one offer
or one sourcing request. It is the commercial operation. Proposals,
messages, the contact release, fee records, compliance reviews, and
the audit trail all hang off it (`tropical_negotiations`).

A negotiation opens in exactly two ways:

- **From an offer:** the consumer clicks "Request a quotation" on a
  published catalog offer (`createNegotiationFromOfferAction`). The
  provider sees it once it exists.
- **From a sourcing request:** ops matches an open sourcing request
  to a verified, published offer from a verified provider
  (`matchSourcingRequestAction`). Matching an unverified or draft
  offer is refused — Cubora never presents supply it has not verified
  (plan §4).

## 3. The state machine (Cubora's own)

Migration 056, `NEGOTIATION_TRANSITIONS` in
`modules/commercial/validation.ts`:

```
open → proposal → awaiting_acceptance → accepted
  → contact_released → completed
any non-terminal state → blocked → open (unblock) | cancelled
completed / cancelled are terminal
```

**Ops drives every transition.** There is no UPDATE/DELETE policy
for the `authenticated` role on `tropical_negotiations`, and the
`tropical_negotiations_guard_status` trigger raises on any status
change from that role — the same two-layer pattern as the
verification guards (051/052/055). Parties signal intent on
proposals (acceptance flags); ops records the transitions.

This state machine **replaces the escrow-funded transitions** the
inherited workspace keyed off (audit §4.1, §6). The group channel
used to unlock when escrow was funded, and escrow funding is stubbed
to always refuse — so the group channel could never unlock. The fix:

- Activation is now a Cubora operations decision: a negotiation is
  accepted, ops activates the linked project
  (`activateProjectAction`: project `pending_payment` → `active`,
  with `negotiation_id` set on the project and
  `activated_project_id` set on the negotiation), and the group
  channel opens because the project is active.
- `tropical_can_access_channel` (restated in 056) keeps its rule —
  group access keys off project status `active`/`completed` — with
  the corrected comment: the transition that satisfies it is the
  operations decision, not a payment event.
- No payment event is involved anywhere. There is no payment rail in
  the MVP.

## 4. Mediated communication & contact release

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
  ops-only writes, RLS read for the parties). The reveal itself goes
  through `revealContactAction`, which checks the release row first
  and refuses — without revealing anything — when the relevant side
  has not been released. The contact (email from Supabase Auth) is
  fetched through the service-role client only after that check.
- **The two sides are independent:** releasing the consumer's contact
  does not release the provider's, and vice versa.

### What is still undecided (spec OPEN O4 — Roger's decision)

The release **conditions** themselves — which conditions, who
approves release, what counts as acceptance by both parties — are
still open. The approval record does not invent them: it captures
what ops attested was met (`conditions_summary`, in ops' own words)
and which side was released. Until Roger answers O4, ops records the
decision case by case, and nothing in the product defines the policy.

Related OPEN questions this phase does not answer:

- **O2 — "Securing a contact":** what precisely counts as securing a
  contact (the release itself, the first direct exchange, a signed
  agreement, or something else). Blocks the fee trigger.
- **O7 — Commercial terms:** what the "agreed commercial terms" are
  — who drafts them, in what form, and where/how they are accepted
  in-product. Proposals carry the author's own terms as free text /
  JSON; they are not Cubora's terms.

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

### What is still undecided (spec OPEN O1–O3 — Roger's decisions)

- **O1 — Fee model:** fixed, percentage-based, or hybrid, and on
  what base a percentage is calculated.
- **O2 — "Securing a contact":** see §4.
- **O3 — Fee timing:** at what exact moment the fee becomes payable
  (on contact release, on agreement, on operation completion, or
  another milestone).
- **O5 — Payment route & compliance:** which payment providers and
  currencies, how money moves for fees and for operations, who
  performs transaction-specific review, and what happens when no
  compliant route exists.

Until O1–O3 are answered, fee records may carry only a note about
what was agreed, or nothing at all. Fee history is consumer-visible
(plan §9: it is on the consumer dashboard, not the provider's); RLS
admits only the consumer of the operation.

## 6. Notification delivery — recorded manual step

Phase 3 left pending rows (`tropical_sourcing_notifications`,
status `pending`): a row records that the requester must be told
when a real opportunity appears. Phase 4 delivers from those rows —
as a **recorded manual step only**:

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

## 7. Proposals & quotations

A proposal is a commercial object tied to a negotiation
(`tropical_proposals`): title, summary, and `terms` — scope,
deliverables, price basis and amount as the author wrote them. The
author role is derived from who the viewer is, never taken from the
form. Cubora's intermediation fee is **not** in the proposal; it
lives on the fee record (§5).

Acceptance is two flags, one per party:

- A party sets **only their own flag** (`acceptProposalAction`
  refuses to touch the other side's flag; the action layer enforces
  which flag belongs to the viewer).
- Both flags set is acceptance by both parties. Ops then marks the
  proposal `accepted` (`setProposalStatusAction`), which also moves
  the negotiation to `accepted` when the transition is valid. Ops
  records the fact; it does not invent acceptance — marking a
  proposal accepted without both flags is refused.
- Declining is unilateral: a party declines, the status flips to
  `declined` through the verified privileged-write path (party
  checked as the user, written as the service role, recorded as an
  event), and the negotiation is untouched.

Proposal status is ops-only at the database (the
`tropical_proposals_guard_status` trigger), like negotiation status.

## 8. Compliance reviews & blocked cases

Human review for sensitive or high-risk cases (plan §12, spec S61,
S63). `tropical_compliance_reviews` is ops-only — no RLS policies
for `authenticated` at all. Opening a review on a negotiation blocks
it (`blocked`); clearing the review unblocks it (back to `open`).

**What is still undecided (spec OPEN O8 — Roger's decision):**
which cases require human review, who reviews them, and the
escalation / block / unblock procedure in detail. This phase records
reviews and decisions; it does not define the scope.

**What this phase does not claim:** legal compliance. Cuba-related
sanctions, export controls, payment restrictions, and other legal
requirements need transaction-specific review by qualified
professionals (plan §12, spec S64). The platform must not facilitate
evasion, and nothing here certifies a transaction as compliant.

## 9. Audit trail

Important commercial events and agreements are recorded (plan §5,
spec S29) in `tropical_operation_events`: negotiation opened,
sourcing request matched, proposal sent / accepted by one side / by
both / declined, proposal status set, negotiation status changed,
contact released, fee recorded / voided, workspace activated. The
table has no INSERT policy for `authenticated`; rows are written
through the service role after the action has established, via an
RLS read, that the caller is a party or ops.

## 10. What Phase 4 deliberately leaves for later

- **Phase 5 (Quality & Launch):** RLS validation against a live
  database (all policies here are unapplied, as every migration in
  this repo has been so far); bilingual QA of the new surfaces;
  end-to-end commercial workflow testing; live verification of the
  migration.
- **Post-MVP:** escrow / transaction protection through qualified
  financial infrastructure; fee collection through a real payment
  route (needs O5 + legal validation); logistics; Polygrow
  integration.
- **Roger's decisions (OPEN O1–O5, O7, O8):** fee model, "securing
  a contact", fee timing, contact-release conditions, payment /
  compliance route, commercial terms, human-review scope. Nothing in
  this phase answers them, and nothing in this phase may be read as
  an answer.
