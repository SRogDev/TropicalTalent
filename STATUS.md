# STATUS.md — TropicalTalent

**Updated:** 2026-11-11 · **Branch:** `main` (single initial commit) · **License:** Elastic License 2.0 · **Visibility:** intended public

## Done (2026-11-11)

- **Monorepo fusion:** `tonesbysalome/MVP-V1` (Next.js web) + `tonesbysalome/tones-ai-backend` (FastAPI) fused into one repo as `apps/web` + `apps/ai`. Sources were copied, not history-imported — the new repo has a single clean initial commit, no imported git history.
- **Rebrand Tones → TropicalTalent:** user-visible copy, metadata, domains (`tropicaltalent.dev` placeholders), green gradient theme (deep green → emerald → lime), new minimalist logo (beach horizon + palm + talent sparkle) at `apps/web/public/tropical-talent-logo.svg` and `apps/web/app/icon.svg`. Internal identifiers renamed `tones2_*` → `tropical_*` (migrations + code). Grep-verified: `tones` 3 hits (all in clearly-marked origin notes), `salome` 0, `stripe` 0.
- **Payments omitted:** Stripe dependency, API routes, Connect onboarding, webhooks, and cron billing removed; escrow/wallet/recurring modules stubbed to refuse with a clear message. No prices, no GBP, no payout rail.
- **Backend on uv:** `apps/ai/pyproject.toml` is the single source of truth (prod LangChain 0.3.x line chosen as canonical), `uv.lock` committed (163 packages), `requirements*.txt` deleted, scripts/docs converted to `uv` commands. `redis` added (was imported but unlisted).
- **One security fix:** `INTERNAL_API_KEY` is now required with no default — the app fails fast at startup if unset.
- **Secrets scrubbed:** no live keys in the tree (grep-verified); seed password replaced with a fake placeholder; the 3 real usernames from the old README and live row counts removed.
- **Verification:** web `tsc --noEmit` passes; AI `compileall` passes and `app.main` imports; `uv lock --check` passes.

## Doing

- Nothing — awaiting Roger's product definition for the Cuba-connects-with-the-world platform.

## Next (in Roger's order, when he defines the idea)

1. Define the product: who connects with whom, and what the first slice is (influencers / producers / talent — pick one).
2. Decide the payments rail for Cuba (deferred deliberately; the reference build has none).
3. Wire `apps/web` to `apps/ai` (talent search via the AI service instead of keyword templates).
4. Re-enable and test Team Search (LangGraph) or cut it.
5. Fix the AI auth gaps (`GET /search`, insights endpoints) before any deployment.
6. Fix the AI test-suite drift (28 failed / 18 passed, pre-existing) — separate pass.
7. Rebuild geography for Cuba + remote/worldwide; re-seed the discipline taxonomy tech/marketing-first.
8. Spanish/i18n, Terms/Privacy (currently Google Docs links / placeholders).

## Known issues (carried from the audit, still true)

See root `README.md` — "What is omitted / not working". The honest list: no payments, web/AI unwired, Team Search disabled, AI auth gaps, AI test drift, UK geography, no i18n, taxonomy film/music-heavy, docs drift in places.
