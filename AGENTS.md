# AGENTS.md — TropicalTalent working agreement

## What this repo is

A public monorepo, licensed Elastic License 2.0. It is a **reference base** for a future platform connecting Cuba with the world (influencers, producers, tech/marketing talent with foreign clients) — not the final product. The product idea is still being defined by Roger; do not invent product decisions, pricing, or a payments rail.

## Layout

- `apps/web/` — Next.js 16 + React 19 + Tailwind v4 + Supabase. Bun-first (`bun install`, `bun run dev`, `bun run typecheck`).
- `apps/ai/` — FastAPI + LangChain 0.3 + Gemini + Pinecone. **uv only**: `uv sync`, `uv run ...`, deps in `pyproject.toml [project]`, `uv.lock` committed. Never pip, never `requirements.txt`.

## Rules

- **README rule:** every significant change ships with a README touch-up in the same change. READMEs in English, current, no invented claims.
- **No payments.** Do not reintroduce Stripe or any payment provider without Roger's explicit order. The escrow/wallet/recurring modules are intentional stubs.
- **No secrets.** Never commit `.env` files, API keys, or tokens. `.env.example` files contain empty placeholders only.
- **No live claims without verification.** Do not claim a feature works live until it has been run against a real backend/DB. Typecheck and compile checks are not live verification.
- **Ask before critical decisions** (architecture, data model, promotion to main, scope changes): present context + at least 3 options and wait for Roger's answer.
- **Git:** human pace. Small changes may go direct to `main`; big changes (features, refactors, dependency changes, behaviour changes) go as PRs. Never mass-create repos or auto-merge PRs with scripts.
- **Axum for Rust backends** (global rule) — not applicable here, but never introduce Actix.
- **Frontend/UI:** `ui-ux-pro-max` is the design authority when UI work is done; run its design-system search first.
- **Code:** `gentle-ai` discipline (ODD routing, TDD evidence, RDD self-review) and `karpathy-guidelines` (think before coding, simplicity first, surgical changes, goal-driven execution) apply to all coding work.

## Known state (2026-11-12, after Phase 5)

See `STATUS.md` and the root `README.md` "What is omitted / not working" section. In short: payments omitted; web and AI wired for discovery + semantic search (live Pinecone/Gemini unverified); Team Search re-enabled with project creation disabled (crm_handoff); AI auth gaps closed in Phase 5 (JWT on search/insights/vectorize, QStash fail-closed); AI tests 136 passed, 0 failed; web tests 137/137; bilingual EN/ES via next-intl (admin console, legacy screens and server-action errors still English); geography still UK-flavoured; no live DB has ever existed — all RLS/migration validation is static. Remaining Medium gaps: proposal acceptance flags not DB-enforced (A-3), RLS policies without explicit `TO authenticated` (A-4) — both need a live DB to close.
