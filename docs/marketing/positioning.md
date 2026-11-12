# Positioning — Cubora

**Status:** Phase 5 (Quality & Launch). Positioning record for the
Cubora MVP. Sources: `CUBORA_PLAN.md` §1, §5, §13; `CUBORA_SPEC_ANALYSIS.md`
§4.10 (MUST S65, SHOULD S66–S68), §6; `docs/product/commercial-model.md`
(Phase 4, what the product actually mediates).

## 1. Positioning statement

Cubora is a commercial platform that connects Cuba's talent,
services, products, producers, and production capabilities with
buyers around the world — not as a listing site, but as an
AI-powered commercial intermediary that helps buyers discover
opportunities, find reliable suppliers, negotiate, and establish
commercial relationships (plan §1, spec S2).

The core principle: make Cuban capabilities accessible to the world
through technology, trust, and commercial coordination (plan §1,
spec S3).

## 2. The five positioning pillars

The plan positions Cubora around (plan §13, spec S67): **access,
capabilities, reliability, coordination, and commercial opportunity.**
Each pillar maps to something the product actually does in the MVP:

| Pillar | What it means | What the product does (Phases 0–4) |
|---|---|---|
| **Access** | Cuban talent, services, products, and production that international buyers could not otherwise reach | One unified catalog (talent / services / products & production) with one consistent discovery experience; conversational AI discovery in English and Spanish |
| **Capabilities** | Real, specific, provider-stated capability — skills, production capacity, scope, deliverables | Category-specific offer fields (skills, capacity, specifications, quantity, availability); provider profiles for individuals and businesses |
| **Reliability** | A buyer can trust what they see, and a provider can trust the process | Provider verification workflow with recorded evidence and human decisions; Made in Cuba origin gate at the database level; the AI never fabricates supply, availability, or verification |
| **Coordination** | Cubora runs the commercial relationship in its early stages so neither side has to improvise it | Mediated negotiation through the platform; proposals with per-party acceptance; contact release only via an explicit ops approval record; every important commercial event recorded |
| **Commercial opportunity** | New supply can be created, not just displayed | Structured sourcing requests when no offer matches: the request is registered in internal operations, matched to a verified offer, and the requester is notified |

**Price is supportive, not primary.** Competitive pricing can support
the value proposition but should not be the primary message (plan
§13, spec S67). Cubora does not compete on being the cheapest option;
it competes on reaching capability that is otherwise unreachable, with
an intermediary standing behind the relationship. No price claim,
discount, or rate is stated anywhere in this positioning — offer
pricing is the provider's stated pricing basis, and the
intermediation fee model is still undecided (O1).

## 3. Audiences

Acquisition focuses on (plan §13, spec S66):

1. **International businesses seeking Cuban talent and services.**
   The primary buyer audience: companies hiring or contracting
   talent (notably tech and marketing) and buying services.
2. **Buyers interested in Cuban products and production
   capabilities.** Buyers of physical goods, agricultural products,
   and production capacity — including buyers who need a producer,
   not just a product.
3. **Relevant entrepreneurs and commercial networks.** People and
   networks already doing cross-border business who can bring
   buyers, not just attention.
4. **Cuban diaspora business networks** — as a potential acquisition
   channel **to validate**, not an assumed channel. Whether diaspora
   networks actually deliver buyers is an open validation question,
   not a claim in this doc.

The product serves three user groups (spec §6): international buyers,
Cuban providers (individuals and businesses), and Cubora's internal
operations team running the CRM. Positioning speaks first to buyers —
acquiring real buyers is the initial commercial priority, not
maximizing the number of listings (plan §13, spec S65).

## 4. Differentiation vs a plain marketplace or directory

| A plain marketplace / directory | Cubora |
|---|---|
| Lists offers; the buyer does the work of finding, vetting, and contacting | AI conversational discovery: describe a need, get inline offer cards, refine, compare, request a quotation |
| Contact details are visible or one click away | Contact is released only after agreed conditions, via an explicit approval record; negotiation happens through Cubora |
| Supply is whatever is listed | No-results creates a structured sourcing request — Cubora generates new supply by finding and verifying candidates |
| Verification is a badge with no stated process | Verification is a recorded workflow (evidence events, human decision, status guards); the Made in Cuba seal is gated at the database level |
| A transaction is a checkout | A commercial operation is a tracked workflow: request → match → negotiation → proposal → acceptance → contact release → tracking → fee record |
| Price is the headline | Access, capability, reliability, coordination, and opportunity are the headline; price supports |

## 5. What Cubora is NOT

- **Not a marketplace or a directory.** Stated in the plan (§1) and
  the spec (S2). Listings exist, but the product is the
  intermediation around them.
- **Not a payments product.** No payment rail, no custody of funds,
  no escrow in the MVP (plan §5, spec S33). Fee *records* exist;
  fee *collection* does not. Any claim that Cubora takes, holds, or
  protects money is false for the MVP.
- **Not a logistics or shipping provider.** Physical goods and
  producers are discoverable without logistics providers (plan §7),
  and the platform never implies a product can be exported, paid
  for, or delivered until that specific operation's capacity,
  logistics, documentation, destination, payment route, and
  compliance are verified (plan §7, spec S42).
- **Not a quality certifier.** The Made in Cuba seal marks origin,
  not quality (plan §2, spec S11). Nothing in the product certifies
  quality.
- **Not a legal or compliance authority.** Cuba-related sanctions,
  export controls, and payment restrictions need transaction-specific
  review by qualified professionals (plan §12, spec S64). The
  platform records compliance reviews; it does not certify a
  transaction as compliant.
- **Not a Polygrow product in the MVP.** Polygrow integration is
  outside the MVP critical path (plan §17, spec S87) and post-MVP
  scope is still open (O10).

## 6. What is still open

- **O1–O5, O7:** the fee model, what "securing a contact" means, fee
  timing, contact-release conditions, the payment/compliance route,
  and the commercial terms. Until these are decided, positioning
  copy must not promise a fee structure, a release timeline, or a
  payment method.
- **O6:** what "verified" means — the reliability pillar rests on a
  verification standard that is not yet defined.
- **O15:** numeric targets for go-to-market success — see
  `docs/marketing/go-to-market.md`. No target is stated here.
