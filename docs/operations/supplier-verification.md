# Supplier Verification — Cubora

**Status:** Phase 5 (Quality & Launch). Operations record for the
verification workflow as actually built in Phases 2 and 4. Sources:
`CUBORA_PLAN.md` §2, §7, §12; `CUBORA_SPEC_ANALYSIS.md` §4.9
(MUST S59–S64), §10 O6, O8; `docs/architecture/data-model.md` §1–§2
(migrations 051/052); `docs/product/commercial-model.md` §8.

## 1. What verification is

Verification is the recorded, human-decided process by which Cubora
establishes that a provider is who they say they are, that their
business information is as stated, and — for products — that the
origin is genuinely Cuban before the Made in Cuba seal is awarded.
Trust is a core part of Cubora's commercial value (plan §12, spec
S58), and verification is how the platform earns it: the AI never
fabricates verification, and an unverified offer is never presented
as verified.

Verification covers three different facts, stored separately:

| Fact | Where it lives | What it gates |
|---|---|---|
| Provider verification | `tropical_providers.verification_status` | Whether the provider can be matched to sourcing requests and presented as a verified supplier |
| Offer verification | `tropical_offers.verification_status` | Whether the offer can be matched; only verified, published offers are matchable |
| Origin verification | `tropical_offers.origin_verified` → `made_in_cuba` | Whether the Made in Cuba seal may be shown on the offer |

A verified provider can still have an unverified product, and an
unverified provider's offers cannot be matched at all — the facts
are independent by design.

## 2. The workflow as built

### Status flow

Provider and offer verification share the same status vocabulary:

```
pending → in_review → verified
                   ↘ rejected
```

Default status is `pending`. There is no self-service path to
`verified`: the status and audit columns (`verified_at`,
`verified_by`, `verification_notes`) are written only by the
admin/ops verification actions (`modules/catalog/actions.ts`, behind
`requireAdminScope()` + `adminDb()`).

### Evidence

One row per evidence item or status decision in
`tropical_verification_events` (migration 051):

- `kind`: `document` | `note` | `status_change`.
- `reference`: a Storage path or external identifier — never a
  secret.
- `note`: the ops note on the item.
- `status_after`: the status the decision left the provider/offer in.
- `recorded_by`: who recorded it.
- `offer_id`: NULL for provider-level evidence; set for offer-level
  evidence such as origin proof (added by migration 052).

Evidence is readable only by the provider it concerns (RLS) and by
ops; it is never insertable through RLS.

### Enforcement (two layers)

1. **Action layer:** the ops verification actions never touch the
   verification columns from a provider-side call.
2. **Database layer:** the triggers
   `tropical_providers_guard_verification` and
   `tropical_offers_guard_verification` raise if a write running as
   role `authenticated` changes the verification columns
   (`verification_status`, `verified_at`, `verified_by`,
   `verification_notes`, and for offers also `origin_verified`,
   `made_in_cuba`, `search_indexed_at`).

Ops writes run as `service_role` and pass through. The pattern is
the same two-layer pattern used for the sourcing-request, negotiation,
and proposal status guards (migrations 055/056).

### Where verification happens

- **Supplier onboarding:** `/admin/suppliers` — the provider queue
  (`tropical_providers` + `tropical_verification_events` via
  `adminDb()` behind `requireAdminScope()`).
- **Catalog:** only `published` offers are publicly readable; drafts
  and archived offers only by their provider and ops. A provider
  writes only their own offers.
- **Matching:** `matchSourcingRequestAction` refuses to match an
  unverified or draft offer — Cubora never presents supply it has
  not verified (plan §4).

### The Made in Cuba origin gate (database level)

- `made_in_cuba` is a boolean, default `false`, set ONLY by the
  admin/ops verification flow. The provider cannot set it (RLS
  insert check + trigger).
- The CHECK constraint `NOT made_in_cuba OR origin_verified`
  forbids the seal without verified origin — the database refuses
  the combination, it is not a UI convention.
- Origin verification is kept separate from quality certification
  (plan §2, spec S11): nothing in the model is a quality claim, and
  no UI presents the seal as one. The seal badge
  (`components/tropical/made-in-cuba-badge.tsx`) renders only when
  `made_in_cuba` is true.
- The seal is per-offer, not per-provider (see §1).

## 3. What "verified" still leaves OPEN (O6)

**Spec OPEN O6 — "What counts as verified for a provider, a product
origin, or a supplier — what evidence, who verifies, and is
re-verification required?" — is unanswered.** The workflow above
records evidence and a human decision; it does not define what
evidence is sufficient. Concretely undecided:

- **Evidence standard:** what documents, checks, or references are
  enough to mark a provider verified, and what proves Cuban origin
  for a product. No list exists in the plan, the spec, or the code.
- **Who verifies:** the actions require an admin/ops scope, but who
  holds that scope, and whether verification is done by Cubora staff
  or a third party, is not defined.
- **Re-verification:** whether a verified status expires, is
  re-checked on a schedule, or is re-opened when information changes.
  Nothing in the model expires a verification.
- **Rejection consequences:** what a `rejected` provider or offer
  may do next (appeal, re-apply, correct evidence) is not defined.

Until Roger answers O6, ops records the decision case by case, and
nothing in the product defines the criteria. **No verification
outcome is claimed in this doc** — no provider, offer, or product is
described here as verified, and no evidence list is invented.

## 4. Human-review scope note (O8 — open)

Human review for sensitive or high-risk cases is required by the plan
(§12, spec S61/S63) and recorded in Phase 4
(`tropical_compliance_reviews`, ops-only — no RLS policies for
`authenticated` at all; opening a review on a negotiation blocks it,
clearing it unblocks it). But **spec OPEN O8 — which cases require
human review, who reviews them, and the escalation / block / unblock
procedure in detail — is unanswered.** This phase records reviews and
decisions; it does not define the scope. The verification workflow
and the compliance-review workflow are therefore related but
separate: verification decides whether a provider/offer is verified;
compliance review decides whether a specific operation may proceed.
Which cases go to human review, and what happens to a verification
already granted when a compliance review opens, is not defined.

## 5. What is planned, not implemented

- **RLS validation against a live database.** All policies in
  migrations 051/052/055/056 are unapplied, as every migration in
  this repo has been so far. The two-layer enforcement described in
  §2 is code + migration text; it has not been verified against a
  live database. That is Phase 5 work — see
  `docs/architecture/e2e-commercial-workflow.md`.
- **Advanced verification (post-MVP):** more advanced supplier
  verification and automated document/compliance assistance are
  post-MVP roadmap items (plan §15).
- **Screening against restrictions:** the plan requires screening
  parties, ownership, products, destinations, end users, payment
  routes, and logistics against applicable restrictions (plan §12,
  spec S62). No automated screening is implemented; screening is a
  human-review matter under O8, and transaction-specific legal review
  by qualified professionals is required for Cuba-related sanctions,
  export controls, and payment restrictions (plan §12, spec S64).
  Nothing here certifies a transaction as compliant, and the platform
  must not facilitate evasion.
