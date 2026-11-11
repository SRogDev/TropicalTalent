# TropicalTalent

> **Status: reference base, not the final product.** This monorepo is a working reference for a future platform. The product idea is still being defined — see [Vision](#vision) below. Nothing here is live, and no real credentials are included.

TropicalTalent is a platform to **connect Cuba with the world** — not only jobs:

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
│   └── ai/    # FastAPI + LangChain 0.3 + Google Gemini + Pinecone
│              # Semantic talent matching: profile vectorization,
│              # hybrid search + rerank, conversational agent, recommendations
├── LICENSE    # Elastic License 2.0
├── AGENTS.md  # Working agreement for contributors/agents
└── STATUS.md  # What is done, what is next
```

The two apps share one Supabase project (auth + Postgres + RLS) in the reference design, but **they are not wired together yet**: the web app currently talks only to Supabase directly, and the AI service is a standalone API. Wiring them is future work.

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
uv run pytest -q      # note: the test suite currently has pre-existing drift, see below
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
- **Web and AI are not wired together.** Talent matching in the web app is keyword templates, not the AI service. No frontend code calls `apps/ai` yet.
- **Team Search (LangGraph multi-agent team builder) is disabled** — its router is commented out in `apps/ai`.
- **AI auth gaps (known, unfixed):** `GET /search` has no authentication, the insights endpoints have no auth, and the `creative_data` table name is still the old one in backend queries (a DB migration must come before renaming it). The weak `INTERNAL_API_KEY` default was fixed (now required).
- **AI test suite drift:** tests are byte-identical to the original repo and target moved/renamed internals — currently 28 failed / 18 passed when run; fixing the suite is a separate pass. The web app typechecks clean (`tsc --noEmit` passes).
- **Geography is still UK-flavoured** in the AI backend (`city_normalizer.py`); it must be rebuilt for Cuba + remote/worldwide.
- **No Spanish/i18n yet** (UI is English), no employment/job-board flow (the reference loop is project-based freelance), and the discipline taxonomy is still film/music-heavy with tech grafted on.
- **Docs drift:** some app-level docs still describe the old product in places; treat this README and `STATUS.md` as the current truth.

## License

Elastic License 2.0 — see [LICENSE](LICENSE).
