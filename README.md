# TropicalTalent

> **Status: reference base, not the final product.** This monorepo is a working reference for a future platform. The product idea is still being defined — see [Vision](#vision) below. Nothing here is live, and no real credentials are included.

> **Brand (Phase 1):** the product is **Cubora** — "Born from ingenuity. Built through resilience. Made in Cuba." — with a light-green design system and English/Spanish (see `docs/architecture/design-system.md`). The repository keeps the name TropicalTalent; only the product brand changed.

> **Catalog (Phase 2):** one unified catalog — talent, services, products & production — with provider profiles, verification and a Made in Cuba origin seal, structured search/filtering, and a server-side semantic-search seam to the AI service (see `docs/architecture/data-model.md`).

> **Discovery (Phase 3):** conversational AI discovery on the catalog — a LangGraph graph (`understand → clarify / search / present / sourcing`, AgentExecutor only in the legacy node), structured SSE streaming (text, clarification prompts, inline offer cards, sourcing-request events — contract in `docs/architecture/ai-orchestration.md`), offer-level Pinecone indexing, no-results sourcing requests (migration 055), and Team Search re-enabled behind JWT auth. Web: `/discover` + `POST /api/discovery` proxy.

> **Commercial Operations (Phase 4):** the internal ops CRM (`/admin/operations`: requests queue, negotiations, contact-release approvals, fee tracking, compliance, pending notifications), mediated negotiations with proposals/quotations and a Cubora state machine (migration 056), contact release only via an explicit approval record, fee records with nullable type/amount/currency (no fee model invented — spec O1–O3 are Roger's decisions), and consumer/provider dashboards (`/operations`). Team Search's project-creation nodes are disabled, not fixed with legacy tables (see `docs/product/commercial-model.md`).

> **Quality & Launch (Phase 5):** auth/authorization audit + static RLS validation (no live DB exists — see `docs/architecture/repository-audit.md` and `~/workspace/tropical-talent/WEB_AUTH_AUDIT.md`, kept out of the repo as a working file); AI auth gaps closed (`GET /search` JWT-only with user_id from the token, insights endpoints authenticated, vectorize user_id must match the JWT, QStash webhook fail-closed); AI test suite fixed to **136 passed, 0 failed** (was 28 failed / 81 passed + `test_auth.py` uncollectable); bilingual QA — landing, auth, onboarding, catalog, offers, discover, operations translated EN/ES (admin console, legacy screens and server-action error strings remain English); error responses no longer leak internals; E2E commercial workflow test plan in `docs/architecture/e2e-commercial-workflow.md`; marketing + operations docs completed (`docs/marketing/`, `docs/operations/`). Remaining known issues are listed below.

Cubora is a platform to **connect Cuba with the world** — not only jobs:

- Cuban **influencers** with audiences and clients abroad.
- Local **producers** with foreign clients.
- Cuban **tech and marketing talent** with teams and clients anywhere.

The connection has to work **without violating the blockade** — that constraint shapes every product and payments decision that comes later. Payments are deliberately omitted from this reference build (see [What is omitted](#what-is-omitted--not-working)).

## Origin / attribution

This codebase is a rebranded reference fusion of Roger's own earlier marketplace work (the Tones web app and AI backend, written by Roger as sole developer). It is kept as a base to build something different on top of — the brand, the audience, the geography, and the business model are all new. Internal identifiers were renamed (`tones2_*` → `tropical_*`); the only remaining mentions of the old name are the origin notes in this file, `STATUS.md`, and `apps/ai`.

## Architecture

```
tropical-talent/
├── apps/
│   ├── web/   # Next.js 16 + React 19 + Tailwind v4 + Supabase
│   │          # Talent marketplace UI: briefs, talent discovery,
│   │          # projects, workspace, chat, admin console, white-label tenancy
│   │          # Cubora catalog (Phase 2): unified offers, provider profiles,
│   │          # supplier onboarding, semantic-search seam to apps/ai
│   └── ai/    # FastAPI + LangChain 0.3 + Google Gemini + Pinecone
│              # Semantic talent matching: profile vectorization,
│              # hybrid search + rerank, conversational agent, recommendations
├── LICENSE    # Elastic License 2.0
├── AGENTS.md  # Working agreement for contributors/agents
└── STATUS.md  # What is done, what is next
```

The two apps share one Supabase project (auth + Postgres + RLS) in the reference design. Since Phase 2 they are partly wired: the web app calls the AI service's `GET /search` server-side only (via `GET /api/ai-search`); migration 053 creates the tables the AI service queries that no web migration created before. Since Phase 3 the discovery loop is wired too: `POST /api/discovery` → AI `POST /api/agent` (LangGraph discovery, structured SSE), and offers are indexed into Pinecone at offer level. Live Pinecone/Gemini calls are still unverified in this environment.

## Quickstart

### Web — `apps/web`

```bash
cd apps/web
bun install
cp .env.example .env.local   # fill in your own Supabase project values
bun run dev                  # http://localhost:3000
bun run typecheck            # tsc --noEmit
```

Environment (see `apps/web/.env.example` — placeholders only, no real values):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase (admin routes only) |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | Public base URL |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Transactional email (optional — degrades to no-op) |
| `CRON_SECRET` / `UNSUBSCRIBE_SECRET` | Vercel cron + unsubscribe links |

Database: apply the SQL migrations in `apps/web/migrations/` (`001`–`050`, plus later numbered files) against a Postgres/Supabase database with `node migrations/apply.mjs`. Tables use the `tropical_*` prefix.

### AI — `apps/ai`

Python managed with **uv** (the only Python workflow in this repo).

```bash
cd apps/ai
uv sync --group dev
cp .env.example .env   # fill in with your own credentials (placeholders only)
uv run uvicorn app.main:app --reload --port 8000
uv run pytest -q      # 136 passed, 0 failed (Phase 5)
```

Environment (all from `apps/ai/app/core/config.py` — no real values anywhere in the repo):

| Variable | Required | Purpose |
|---|---|---|
| `PINECONE_API_KEY` | yes | Pinecone vector store |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | yes | Supabase (service key bypasses RLS) |
| `GEMINI_API_KEY` | yes | Google Gemini embeddings + chat |
| `INTERNAL_API_KEY` | yes | Admin endpoints — required, no default (fails fast if unset) |
| `UPSTASH_REDIS_URL` | no | Rate limiting + LangGraph checkpointer (falls back to in-process memory) |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | no | Webhook signature verification |
| `SENTRY_DSN` | no | Error reporting |

Dependency decisions: `apps/ai/pyproject.toml` is the single source of truth (`uv.lock` committed). The production LangChain **0.3.x** line was chosen as canonical, resolving a prod/dev drift where dev pinned LangChain 1.2. `requirements.txt` / `requirements-dev.txt` were deleted.

## What is omitted / not working

Honest list — this is a reference base, and these are known before anything is built on top of it:

- **No payments.** Stripe, escrow funding, payouts, and prices were removed entirely. The escrow/wallet/recurring modules are stubs that refuse with "Payments are omitted in this reference build". No payout rail exists yet; the Cuba payments decision is deferred to the product definition.
- **Web and AI are wired for discovery.** The web app calls the AI service server-side only: `GET /api/ai-search` → AI `GET /search` (talent profiles) and `POST /api/discovery` → AI `POST /api/agent` (structured discovery stream; the user's own JWT is forwarded, it never leaves the server). Offer-level Pinecone indexing is implemented (`offer-*` vectors, `search_indexed_at` stamped) — semantic search returns offer cards. Live Pinecone/Gemini calls are still unverified in this environment.
- **Team Search (LangGraph multi-agent team builder) is re-enabled** behind JWT auth + rate limit (Phase 3). Clarify/search/review work; project creation and invitations are disabled in Phase 4 — the `project_creator`/`persuasion_agent` nodes wrote to legacy `projects`/`connections`/`messages` tables no migration creates, and creating them would resurrect a second project model nothing reads. Approval now ends at a `crm_handoff` node (Cubora operations opens the negotiation); see `docs/architecture/ai-orchestration.md` §4.
- **AI auth gaps (fixed in Phase 5):** `GET /search` now requires JWT and takes user_id from the token only (caller-supplied user_id removed); both insights endpoints require auth; `POST /api/vectorize` rejects a user_id that does not match the JWT (403); the QStash webhook fails closed (unsigned rejected in production, and in dev unless the explicit dev-only `QSTASH_ALLOW_UNSIGNED=true` flag is set). The `creative_data` table name is still the old one in backend queries (a DB migration must come before renaming it). Two Medium-severity gaps remain and need a live DB to close (see below).
- **AI test suite (fixed in Phase 5):** was 28 failed / 81 passed with `test_auth.py` failing at collection; now **136 passed, 0 failed** (`uv run pytest -q`). Tests were fixed at root cause (moved helpers, stale mocks/paths); no test was deleted and no assertion weakened. Nothing was verified against live Pinecone/Gemini/Supabase — all service tests use mocks.
- **Geography is still UK-flavoured** in the AI backend (`city_normalizer.py`); it must be rebuilt for Cuba + remote/worldwide.
- **Bilingual:** English and Spanish via next-intl with localized routes (Phase 1, QA'd in Phase 5). Translated: landing, auth, onboarding, catalog, offers, discover, operations. Still English by decision: the admin/ops console, legacy Tones screens, server-action error strings, page titles/meta. No employment/job-board flow (the reference loop is project-based freelance). The discipline taxonomy was re-seeded in Phase 2 (migration 054) toward tech/marketing + products/production as primary, creative categories kept as secondary.
- **Known issues remaining after Phase 5 (see `STATUS.md` for the full list):** proposal acceptance flags are not DB-enforced — a direct Supabase call could forge the other party's acceptance (app layer is correct; needs a trigger + live DB test). Cubora RLS policies have no explicit `TO authenticated` clause (needs a live check that anon holds no table privileges). `datetime.utcnow()` remains in backend files Phase 5 did not touch. Agent SSE errors mid-stream are swallowed (stream ends with 200 and an empty body). `next build` fails in this sandbox (Google Fonts fetch blocked by the egress proxy — pre-existing, unchanged by Phase 5). No live database exists anywhere in this workflow, so no migration has ever been applied or RLS-checked live; everything above is static validation.
- **Docs drift:** some app-level docs still describe the old product in places; treat this README and `STATUS.md` as the current truth.

## License

Elastic License 2.0 — see [LICENSE](LICENSE).
