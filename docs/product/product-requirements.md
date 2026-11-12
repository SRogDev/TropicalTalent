# Product Requirements — Cubora

> Status: working requirements, traced to the master plan and to the implementation phases. Each requirement carries its status as of 2026-11-12. Anything marked **Open** is a decision for Roger, not something this document answers. Anything marked **Not implemented** is out of the MVP or post-MVP by plan — see `STATUS.md`.

## 1. Product structure

| # | Requirement | Status |
|---|---|---|
| 1.1 | One unified catalog with three offer categories: talent, services, products & production | Implemented — Phase 2 (migrations 051–054, `docs/architecture/data-model.md`) |
| 1.2 | All categories discoverable through one consistent experience, with contextual filters and category-specific information | Implemented — Phase 2 (`/catalog`, structured + semantic search) |
| 1.3 | Support individual providers and businesses | Implemented — Phase 1/2 (dual-role accounts, individual + business profiles) |

## 2. AI-powered discovery

| # | Requirement | Status |
|---|---|---|
| 2.1 | Conversational discovery as the main experience, built on the existing chat — do not rebuild it | Implemented — Phase 3 (`/discover`, `DiscoveryChat`, existing chat adapted) |
| 2.2 | User describes the need in natural language; AI interprets and extracts requirements | Implemented — Phase 3 (discovery LangGraph: understand → clarify / search / present / sourcing) |
| 2.3 | Search immediately when clear; ask targeted questions only when necessary; show partial results | Implemented — Phase 3 (adaptive clarify-vs-search, ≤2 questions, ≤2 rounds) |
| 2.4 | Supplier, talent, service, and product cards displayed inside the conversation | Implemented — Phase 3 (inline `OfferCard`, same component as the catalog — no duplicate card) |
| 2.5 | Refine, filter, compare, request quotations from the conversation | Implemented — Phase 3/4 (filters, comparison, "Request a quotation" on offer cards) |
| 2.6 | Never fabricate suppliers, products, availability, or verification | Enforced — seed data is fictitious and marked as such; no-results path creates a sourcing request instead of inventing a match |
| 2.7 | No-results workflow: structured sourcing request → internal ops → supplier search → verification → notify consumer | Implemented — Phase 3 (sourcing requests + pending notifications; delivery is a recorded manual step — no notification provider is wired) |

## 3. Commercial intermediation

| # | Requirement | Status |
|---|---|---|
| 3.1 | Buyers and providers cannot access each other's contact information before agreed release conditions are met | Implemented — Phase 4 (mediated negotiation; release only via an explicit approval record; enforced in code + RLS) |
| 3.2 | Communication and negotiation happen through Cubora; Cubora coordinates questions, quotations, proposals, terms | Implemented — Phase 4 (negotiation state machine, proposals, `/admin/operations` CRM) |
| 3.3 | Contact released only after required conditions are satisfied | Implemented as a mechanism — Phase 4. **The policy itself (what the conditions are) is Open** — see `docs/product/commercial-model.md` |
| 3.4 | Consumer pays Cubora's intermediation fee per agreed commercial terms; important events and agreements recorded | Records implemented — Phase 4 (fee records with nullable type/amount/currency; operation events audit trail). **The fee model is Open** — fixed vs percentage vs hybrid, when it becomes payable, and what "securing a contact" means are Roger's decisions |
| 3.5 | No custody of third-party funds in the MVP | Enforced — payments omitted entirely; escrow/wallet modules are stubs. Post-MVP only, with legal + provider validation |

## 4. Accounts & onboarding

| # | Requirement | Status |
|---|---|---|
| 4.1 | One account acts as consumer and provider; ask what they want to do first; activate the other role later | Implemented — Phase 1 (onboarding role question + dual-role activation) |
| 4.2 | Individual and business profiles; simple role switching | Implemented — Phase 1 |
| 4.3 | Provider profiles: identity/business info, description, capabilities, location, verification status, offers, portfolio, languages, documentation | Implemented — Phase 2 (profile + offer CRUD, verification events) |

## 5. Catalog & supply

| # | Requirement | Status |
|---|---|---|
| 5.1 | Create, edit, publish, manage offers; manage provider profiles and multiple offers | Implemented — Phase 2 (`/offers`) |
| 5.2 | Search/filter the unified catalog; manage quantities/availability; record capacity and specifications | Implemented — Phase 2 |
| 5.3 | Track origin and verification; internal supplier onboarding | Implemented — Phase 2 (`/admin/suppliers`, verification queue; Made in Cuba seal gated by verified origin at the DB level) |
| 5.4 | Index offers for structured and semantic search | Implemented — Phase 3 (offer-level Pinecone indexing + backfill endpoint) |
| 5.5 | Physical goods and producers discoverable in the MVP even without logistics providers | Implemented — discovery does not require logistics |
| 5.6 | Never imply a product can be exported, paid for, or delivered until capacity, logistics, documentation, destination, payment route, and compliance are verified for that operation | Enforced — no such implication in copy or flows; verification is per-operation (see `docs/operations/`) |

## 6. Chat & communication

| # | Requirement | Status |
|---|---|---|
| 6.1 | Persistent conversations, AI-assisted discovery, human-assisted coordination, mediated consumer/provider communication | Implemented — Phases 1–4 (existing chat adapted; negotiation channels mediated) |
| 6.2 | Commercial context attached to conversations; quotations, proposals, notifications, read states | Implemented — Phase 4 |
| 6.3 | Contact privacy and controlled contact release; Spanish and English; audit trail for important commercial events | Implemented — Phases 4–5 (approval-gated release; EN/ES; operation events) |

## 7. Dashboards

| # | Requirement | Status |
|---|---|---|
| 7.1 | Consumer dashboard: requests, sourcing requests, opportunities, negotiations, proposals, agreed operations, fee/payment history | Implemented — Phase 4 (`/operations`) |
| 7.2 | Provider dashboard: offers, availability/capacity, opportunities, negotiations, proposals, verification status | Implemented — Phase 4 (`/operations`, `/offers`) |
| 7.3 | Internal ops dashboard (lightweight CRM): incoming/unmatched requests, supplier discovery + verification, matches, negotiations, proposals, contact-release approvals, operations + fee tracking, compliance reviews/blocked cases | Implemented — Phase 4 (`/admin/operations`) |

## 8. AI & backend architecture

| # | Requirement | Status |
|---|---|---|
| 8.1 | Preserve the stack (Next.js 16, React 19, TypeScript, Tailwind 4, Bun, Supabase, FastAPI, Gemini, Pinecone) unless a blocker justifies change | Preserved — no stack changes in Phases 0–5 |
| 8.2 | Migrate orchestration incrementally from AgentExecutor toward LangGraph, preserving functionality | Implemented — Phase 3 (discovery graph; AgentExecutor survives only in the `legacy_agent` node; Team Search re-enabled behind JWT, project-creation nodes disabled in favour of `crm_handoff`) |
| 8.3 | Frontend–AI integration with structured streaming (text, clarification, results, offer cards, sourcing-request events) | Implemented — Phase 3 (streaming contract in `docs/architecture/ai-orchestration.md`; `/api/discovery` proxy forwards the user's JWT) |

## 9. Internationalization

| # | Requirement | Status |
|---|---|---|
| 9.1 | English and Spanish from the MVP via next-intl, localized routes and content | Implemented — Phase 1; QA'd in Phase 5 (landing, auth, onboarding, catalog, offers, discover, operations translated) |
| 9.2 | Complete UX translated, including onboarding, dashboards, notifications, transactional messages | Partially implemented — admin/ops console, legacy screens, and server-action error strings remain English by decision (Phase 5) |
| 9.3 | Offer data language-aware where appropriate; providers specify supported languages | Implemented in the data model — Phase 2 (`attributes` jsonb, languages on profiles) |

## 10. Trust, security & compliance

| # | Requirement | Status |
|---|---|---|
| 10.1 | Verify providers and business information; verify origin before Made in Cuba | Implemented — Phase 2 (verification workflow + events; seal DB-gated) |
| 10.2 | Protect private contact information; enforce auth/authorization; apply Supabase RLS correctly | Implemented — Phases 4–5 (mediated comms, 21 web routes audited, static RLS validation of 20 tables). **Live-DB validation has never run** — no live database exists |
| 10.3 | Audit trails for commercial operations; human review for sensitive/high-risk cases | Implemented — Phase 4 (operation events, compliance reviews queue) |
| 10.4 | Screen parties, ownership, products, destinations, end users, payment routes, logistics against applicable restrictions; procedures for blocked/suspicious/incomplete operations | Partially implemented — compliance review workflow + blocked-case handling exist (Phase 4); screening itself is a human ops step, not automated |
| 10.5 | No facilitation of sanctions/export-control evasion; transaction-specific review by qualified professionals | Enforced as a constraint — the platform must not facilitate evasion; legal validation is outside this build |

## 11. Marketing & go-to-market

See `docs/marketing/`. Requirements: acquire real buyers first (international businesses, product/production buyers, entrepreneurs, diaspora networks); position on access, capabilities, reliability, coordination, opportunity — not primarily price. Status: strategy documented (Phase 5); no marketing execution in this build.

## 12. Post-MVP (not in this build)

Escrow/transaction protection via qualified financial infrastructure; logistics integrations; international shipping/fulfillment; advanced supplier verification; automated document/compliance assistance; advanced analytics; additional payment methods/currencies; Polygrow integration for autonomously fulfillable service requests; more advanced AI sourcing.

## Open decisions (Roger's)

Fee model; contact-release policy; payment/compliance route; commercial terms; launch bar. Recorded in `docs/product/commercial-model.md` — this document does not answer them.
