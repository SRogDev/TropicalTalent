# Repository Audit — TropicalTalent / Cubora (Phase 0)

**Date:** 2026-11-11 (audit performed 2026-11-11/12, America/Havana)
**Scope:** Phase 0 of `CUBORA_PLAN.md` §14 — inspect the existing frontend, backend,
database, and chat implementation; review current marketplace entities and workflows;
identify reusable components and incomplete functionality; review authentication and
security gaps; document the actual implementation before modifying it.
**Method:** static read-only inspection of the working tree, plus two allowed
read-only checks (`bun run typecheck` in `apps/web`; `uv run python -c "import app.main"`
in `apps/ai`). No test suite was run in full, no build was run, no code was changed,
nothing was pushed or committed.
**Sources cross-checked:** `CUBORA_PLAN.md`, `CUBORA_SPEC_ANALYSIS.md` (OPEN O1–O15),
`AUDIT.md` (pre-fusion audit, 2026-11-11), `BUILD_REPORT.md` (fusion report, 2026-11-11).
Every prior claim below was re-verified against the current tree; §11 lists what the
prior reports got wrong or what has changed since.

## 0. Working-tree state at audit time (read this first)

- **Local HEAD:** `5f7ef4a` — "Initial TropicalTalent monorepo: reference fusion of Tones
  web + AI backend", the single initial commit. `git log` shows exactly 1 commit.
  (During this audit the concurrent Sentry-fix agent committed `64b77ba` —
  "fix(ai): Sentry env-driven, disabled without DSN" — so HEAD is now `64b77ba`,
  2 commits. The Sentry section below reports the pre-fix state from `5f7ef4a`
  and the fix as committed in `64b77ba`.)
- **Remote:** a remote **is now configured** (`origin` →
  `git@ssh.github.com:SRogDev/TropicalTalent.git`), which contradicts BUILD_REPORT.md's
  "no remote configured". The remote could not be reached from this sandbox
  (`git ls-remote` fails: connection reset by the egress proxy), so local-vs-remote
  equality could **not** be re-verified here. Memory records the published remote as
  `main @ 969c6cda` with the same tree but a different history from the local commit —
  **do not assume this local clone equals the remote; re-clone or fetch before building.**
- **Dirty working tree (not mine, at audit start):** 6 modified files + 1 new file, all in `apps/ai`,
  were the Sentry env-config fix in progress by a concurrent agent
  (`apps/ai/app/core/sentry.py`, `app/core/logging.py`, `app/main.py`,
  `apps/ai/.env.example`, `apps/ai/README.md`, `apps/ai/SENTRY_USAGE.md`,
  new `apps/ai/tests/test_sentry_config.py`). **That work was committed during
  this audit as `64b77ba`** ("fix(ai): Sentry env-driven, disabled without DSN");
  by audit end the tree was clean apart from this audit's own `docs/` addition.
  This audit reports the **pre-fix state from `5f7ef4a`** for Sentry (§7.1) and
  the fix as committed in `64b77ba`. I touched nothing in `apps/ai`.
- **Size:** `apps/web` 282 files (excluding `node_modules`), `apps/ai` 120 files
  (excluding `.venv`). No `docs/` directory exists at the repo root yet — the
  `docs/` structure proposed in `CUBORA_PLAN.md` §16 does not exist; the only
  in-repo docs are `apps/web/docs/` (3 files) and scattered `apps/ai/*.md`.

## 1. What this codebase is

A two-sided freelance-talent marketplace inherited from Tones by Salome, fused into
one monorepo and rebranded to TropicalTalent as a **reference base, not a product**:
brand posts a brief → a crew is proposed per discipline → talent apply or are invited
→ a project workspace with chat, contracts, deliverables → escrow (Stripe) → delivery
→ release → withdrawal via Stripe Connect. Roles are `creative` (talent) / `brand` /
`admin`, plus white-label tenant roles (`wl_admin` / `member`).

What Cubora needs that this is **not** (yet): a commercial intermediary for Cuban
talent, services, products, and production with global buyers; mediated negotiation;
contact-release controls; sourcing requests; verification and a Made in Cuba seal;
bilingual (EN/ES) UX; no custody of funds in the MVP. The gap between the inherited
loop and the Cubora loop is the whole of Phases 1–5 — the audit below maps it
concretely.

### 1.1 Stack (verified)

| Layer | Claimed | Verified in tree |
|---|---|---|
| Web | Next.js 16, React 19, TS, Tailwind 4, Bun | `apps/web/package.json`: `next 16.0.10`, `react 19.2.0`, `tailwindcss ^4.1.18`, Bun scripts. Correct. |
| Web deps | — | **Unpinned:** `@supabase/ssr: latest`, `@supabase/supabase-js: latest`, `next-themes: latest`. Everything else pinned. |
| AI | FastAPI, LangChain 0.3, Gemini, Pinecone | `apps/ai/pyproject.toml`: `fastapi==0.129.0`, `langchain==0.3.25`, `langgraph>=0.3.0` (unpinned range), `pinecone==7.3.0`, `sentry-sdk==2.52.0`, `uv.lock` committed (163 packages). Correct. |
| DB/Auth | Supabase Postgres + Auth + Realtime + Storage | Migrations + `lib/supabase*.ts` + `proxy.ts`. Correct in design; **no live database was reachable from here**, so no migration was ever applied/verified live in this audit. |
| i18n | next-intl (planned) | **Absent.** No `next-intl` dep, no `messages/` dir, all copy English (`en-GB` flavour). |
| Payments | Omitted | Correct: no Stripe dep, no `app/api/stripe/*`; escrow/wallet/recurring are stubs (§6). But `lib/money.ts` is still **GBP/pence** (`CURRENCY = 'GBP'`, `formatPence` → `£`) — see §11. |

## 2. Web app (`apps/web`) — what exists

### 2.1 Routes (32 pages/routes)

- **Public:** `/` (landing, "Cuban talent, connected with the world"), `/sub-processors`,
  `/unsubscribe` (route), `/auth/*` (sign-in, callback, complete, continue, no-access,
  reset, update-password).
- **App (gated):** `/briefs`, `/create`, `/jobs`, `/talent`, `/profile/[username]`,
  `/projects`, `/projects/[id]`, `/wallet` (placeholder page, §6).
- **Admin (11 pages):** `/admin`, `/admin/users`, `/admin/projects`, `/admin/comms`,
  `/admin/complaints`, `/admin/deletions`, `/admin/earnings`, `/admin/referrals`,
  `/admin/tenants`, `/admin/tenants/new`, `/admin/tenants/[id]`.
- **API routes (3):** `/api/waitlist` (public), `/api/cron/project-checkins` (Mon 09:00),
  `/api/cron/retention` (Sun 04:00) — both crons bearer-protected by `CRON_SECRET`
  (`apps/web/app/api/cron/retention/route.ts` returns 503 if the secret is unset, 401
  on mismatch). The recurring-billing cron is gone with payments.
- **Notably absent:** no onboarding wizard (only `completeProfileAction` +
  `/auth/complete`, a single profile-completion step gated on `profile_completed`),
  no consumer/provider dashboards as Cubora defines them, no catalog/offer pages,
  no search/discovery page beyond `/talent` and `/briefs`, no CRM, no settings page
  for roles, no `/terms` or `/privacy-policy` routes (see §2.5).

### 2.2 Modules (`apps/web/modules/`, 11,495 lines)

| Module | Lines | State |
|---|---|---|
| `identity` | ~1,880 | Sign-up / sign-in / password reset / profile completion / avatar / account deletion / data export / tenant join & leave. The most complete module. Role model: `creative` / `brand` / `admin` (+ tenant `wl_admin`/`member`). **No dual consumer+provider role model** — one `role` per user; Cubora's "one account, both roles, switch simply" (plan §6) does not exist. |
| `projects` | ~1,330 | Briefs → projects, roles, members, applications, invitations, budget split. Matching is **keyword templates** (`brief-split.ts`, 374 lines: `film`/`photo`/`music`/… templates matched case-insensitively as whole words, weights sum to 100). Deterministic by design, <1 ms, no network — and **not AI**. |
| `chat` | 898 | Project channels/messages + deliverables + per-role contracts + disputes (§4). |
| `admin` | ~1,120 | Console reads/actions behind a single `requireAdminScope()` gate (§5). |
| `tenancy` | ~1,690 | Full white-label multi-tenancy: tenants, domains, branding/theme, invites, URL resolution. **A product decision, not a bug** — Cubora Phase 1 must decide keep vs cut (AUDIT.md decision #4, still open). |
| `notifications` | ~693 | Resend email (`sendNotificationEmail`, `notifyProjectMembers`, bulk ≤100/recipient batch); degrades to no-op without `RESEND_API_KEY`. In-app notifications via `tropical_notifications` + live hook (§4). |
| `talent` | ~630 | Talent discovery: search by name/username/bio, candidate pool, verification surfaced in query (`creative_data(verification)`). |
| `briefs` | ~450 | Brief CRUD/queries; `loadMyApplications` via the `tropical_my_applications` view (migration 011). |
| `referrals` | ~? | Tiers + actions/queries; referral rewards are part of the admin console. |
| `skills` | ~? | Discipline taxonomy queries/actions (film/music-heavy, §9). |
| `complaints` | ~180 | Dispute/complaint actions. |
| `escrow` / `wallet` / `recurring` | stubs | **All refuse.** See §6. |

### 2.3 Components (`apps/web/components/`)

- `components/tropical/` — ~45 components: `app-shell`, `project-workspace` (802 lines),
  `team-builder`, `talent-board`/`talent-tile`, `brief-card`/`brief-composer`/`brief-search`,
  `profile-view` (631 lines), `role-contract-panel` (577 lines), `contract-panel`,
  `delivery-panel`, `deliverables-form`, `retainer-*` (3 files, UI for a stubbed feature),
  `tenant-*` (form/settings/logo/style/context), admin rows/panels, `showreel-player`,
  `referral-panel`, `workspaces-panel`, `project-tree`, `project-status-pin`.
- `components/ui/` — 10 Radix primitives (avatar, button, card, dialog, input, label,
  popover, progress, textarea, toast).
- `components/waitlist/` — sign-up/sign-in/reset forms + steps.
- `components/shared/` — theme provider + toggle only.
- **Design system:** `app/globals.css` — green rebrand is real (deep green → emerald →
  lime gradient, `--primary: oklch(0.62 0.2 155)` etc.). Note the file keeps a
  black-and-white base system alongside the brand gradient; Cubora Phase 1 must still
  define the light-green tokens (no hex value is fixed anywhere — matches spec
  assumption that "light green" is a direction, not a value).

### 2.4 The `proxy.ts` gateway (ex-`middleware.ts`)

Well-engineered and well-documented in-code. Session state is decoded locally from
the `sb-*-auth-token` cookie (no network per request); `getUser()` runs only near
expiry (~once/hour/user). Public paths: `/`, `/terms`, `/privacy-policy`,
`/sub-processors`, `/unsubscribe`, all `/auth/*`; public API: `/api/waitlist`,
`/api/cron/*`. Everything else redirects to sign-in. Two subtleties:

- The locally-decoded token is **only used for routing**, never as proof of identity;
  authorisation is RLS + verified `getUser()` in server components. That design is
  sound **if** every data path actually goes through RLS or a verified check (§5).
- `/terms` and `/privacy-policy` are listed as public but **no such routes exist**
  in `app/` — they 404. The legal content lives in Google Docs links (§2.5).

### 2.5 Legal / copy gaps

- `lib/legal.ts` links Terms and Privacy to **Google Docs** (two `docs.google.com`
  document URLs) and carries literal placeholders: `HOSTING_REGIONS = { data:
  '[CONFIRM: your Supabase project region]', app: '[CONFIRM: your Vercel region]' }`.
  No in-repo Terms/Privacy. The retention cron exists to make "section 9 of the
  privacy policy true" — for a policy that is a Google Doc.
- No Spanish anywhere; no `next-intl`; taxonomy and seed data are film/music-first
  (disciplines seeded in migration 003 include Actor, Cinematographer, Colorist,
  Musician, Singer, Songwriter, Model, Stylist…; tech is a graft: `Developer`,
  `Project Manager`, `Brand Strategist`, `Marketing`).
- `lib/money.ts` is GBP/pence throughout (`CURRENCY = 'GBP'`); brief budgets are
  stored/displayed in pence. The payment provider is gone, but the currency
  assumption is not.

## 3. AI backend (`apps/ai`) — what exists

FastAPI app, Python ≥3.12, uv-managed. `import app.main` **passes** (verified
2026-11-12 with dummy env vars; without env vars it fails fast with a Pydantic
`ValidationError` — by design, since 6 settings are required). 12 route paths
registered (14 route objects including `/`):

| Route | Auth | State |
|---|---|---|
| `GET /` | none | Service/version banner. |
| `GET /health` | none | Static `{"status":"ok","version":"1.0.0"}` + `datetime.utcnow()`; no dependency checks (does not prove Pinecone/Supabase/Gemini are up). |
| `POST /api/agent` (+ 4 conversation CRUD routes) | JWT (`get_current_user`) + rate limit | **Working, real.** SSE streaming conversational agent (§4). |
| `GET /api/recommendations` | JWT + rate limit | Working (per code). |
| `POST /api/vectorize`, `DELETE /api/vectorize/{user_id}` | JWT + rate limit | Working, but POST has an **ownership hole** (§7.2). DELETE correctly checks `sub == user_id`. |
| `POST /api/webhooks/vectorize` | QStash HMAC | Working, but signature check is **skipped whenever keys are unconfigured** (§7.2). |
| `POST /api/admin/backfill-vectors` | `X-Admin-Key` = `INTERNAL_API_KEY` (required, no default) | Working; fixed in the fusion. |
| `GET /search` (`app/routes/internals/search.py`) | **None** — only rate limit | **Unauthenticated; caller-supplied `user_id`** (§7.2). |
| `GET /generate-feedback-insights` | **None** | **Unauthenticated**; reads `feedback_messages` via service role, calls Gemini (§7.2). |
| `GET /generate-search-insights` | **None** | **Unauthenticated**; reads `search_logs` via service role, calls Gemini (§7.2). |
| `POST /api/team-search` | JWT + rate limit (in code) | **Router commented out** in `app/routes/__init__.py` (`# disabled for now`) — the endpoint does not exist at runtime. |

### 3.1 Agent (the reusable core for Cubora Phase 3)

- `app/services/agent_executor.py` (453 lines): LangChain `AgentExecutor` +
  `create_tool_calling_agent`, model `gemini-2.5-flash`, 3 tools
  (`app/services/tools/`: `search_tool.py`, `profile_tool.py`, `compare_tool.py`).
- `app/services/agent_service.py` (211 lines): SSE streaming (`message`, `profiles`,
  `search_log`, `done` events), conversation persistence in `agent_conversations`,
  memory via `memory_manager.py` (buffer + summary, 330 lines) and
  `entity_memory.py` (282 lines). Failures degrade gracefully (continues without
  persistence/context) — good for resilience, bad for silent data loss; nothing
  surfaces the degradation to the caller.
- Supporting services, all real code: `embedding_service.py` (Gemini
  `gemini-embedding-001`, 3072d), `embedding_search.py`, `vector_store.py`,
  `pinecone_client.py`, `search.py` (457 lines: Pinecone hybrid search + Gemini
  rerank + search cache + search-log saving), `intent_extractor.py`,
  `query_enricher.py`, `text_processor.py`, `recommendations.py`,
  `search_log_saver.py`, `sparse_encoder.py`, `image_analyzer.py`,
  `pdf_analyzer.py` (PyMuPDF), `youtube_analyzer.py` (transcript API),
  `vectorize.py` (518 lines: profile → weighted embedding → Pinecone),
  `no_results_messenger.py` (Gemini-generated no-results message + static fallback —
  a genuine seed for the plan's no-results/sourcing workflow, but it only writes a
  message; **no sourcing request is created or stored anywhere**).
- **Model inconsistency:** chat/agent/embeddings use `gemini-2.5-flash` /
  `gemini-embedding-001`; the two insights endpoints still use **`gemini-1.5-flash`**
  (`app/routes/feedback.py:60`, `app/routes/search_insights.py:109`).
- **LangGraph exists but is dormant:** `app/services/team_search/` — a real
  `StateGraph` (`graph.py`, 268 lines) with 6 nodes (`business_agent`,
  `search_agent`, `reviewing`, `people_analyst`, `project_creator`,
  `persuasion_agent`), conditional edges, `interrupt_before=["reviewing"]`,
  checkpointer Redis (`RedisSaver`, Upstash) with `MemorySaver` fallback.
  The plan's "move from AgentExecutor toward LangGraph" therefore has two
  starting points: the disabled Team Search graph (multi-agent, needs a product
  decision: re-enable or cut) and the live AgentExecutor agent (needs incremental
  migration). Neither is wired to the web app.

### 3.2 Team Search detail (for the re-enable-or-cut decision)

- 4 agent modules (132–206 lines each) + `nodes/project_creator.py` + `state.py`.
- The graph compiles as a singleton; checkpointer falls back silently from Redis to
  in-process `MemorySaver` (state lost on restart/redeploy — acceptable for dev,
  wrong for production, and silent).
- No route, no frontend, no tests exercising the graph end-to-end (tests are unit
  mocks; see §10).

### 3.3 What the AI backend expects from the database — and does not get

The AI service queries tables that **no migration in `apps/web/migrations/` creates**:
`users`, `creative_data`, `opportunities`, `search_logs`, `feedback_messages`,
`agent_conversations`, `agent_messages`, `matching_results` (0 `CREATE TABLE` hits
for each in the web migrations). The web schema is `tropical_*` tables; the AI
service still targets the pre-fusion Tones schema (`config.py` even documents the
`creative_data` name as intentionally un-renamed, pending a real DB migration).
**Consequence:** the two apps cannot share one live database as-is. Wiring web↔AI
(BUILD_REPORT step 3) requires a schema-alignment migration first, not just an HTTP
call. The opportunities CRUD in `app/core/supabase_service.py` (create/get/
update-status/list + `save_matching_results`) is **orphaned** — no route calls it.

## 4. Chat — the two implementations, and the gap between them

There is **no single chat system**. There are two unrelated ones, and neither is
Cubora's discovery chat.

### 4.1 Web project chat (human-to-human, workspace-scoped)

- **Where:** `modules/chat/` (`actions.ts` 524, `queries.ts` 280, `types.ts` 94) +
  `components/tropical/project-workspace.tsx` (802 lines) + hooks
  `use-project-realtime.ts`, `use-project-live.ts`, `use-live-notifications.ts`.
- **How it works:** Postgres tables `tropical_channels` / `tropical_channel_messages`
  (channels: bot "Project Admin", group, per-role DMs). One Supabase Realtime
  subscription per project, filtered on `project_id`, fanning out in memory;
  client-generated message IDs dedupe the optimistic row / insert response /
  realtime echo. Messages page at 60/channel; `loadProjectMessages` pre-loads all
  channels in one query (cap 360/project). Notifications: one subscription filtered
  on `user_id`, toast + `router.refresh()`.
- **Realtime publication:** migration 006 adds `tropical_channel_messages`,
  `tropical_project_roles`, `tropical_project_escrows` to `supabase_realtime`, with
  `REPLICA IDENTITY FULL` noted as required for UPDATE/DELETE payloads. RLS applies
  to realtime delivery.
- **What's in it beyond messages:** deliverables (RPC `tropical_save_deliverables`),
  per-role contracts (draft → agreed → locked; edits clear the other side's
  acceptance; amounts hidden from non-parties by the query), disputes/complaints,
  escrow-gated visibility (group channel locked until escrow funded; bot channel
  brand-only; DMs brand + role holder only).
- **Critical interaction with the payments stub:** the group channel unlocks when
  escrow is funded — and escrow funding is stubbed to always refuse (§6). **In this
  reference build the group channel can never unlock.** The workspace chat is
  therefore DMs + bot channel only in practice, until a payments/escrow decision
  lands. Any Phase 3 reuse must decouple channel visibility from escrow funding.
- **Access control:** the module header states it plainly — "Access control lives
  entirely in RLS." Reads use the session client; privileged writes (bot messages
  with `sender_id NULL`, cross-user notifications) use `adminDb()` after an
  application-level membership check. That is the correct shape, but it makes RLS
  correctness load-bearing (§5).

### 4.2 AI agent chat (human-to-AI, standalone)

- **Where:** `POST /api/agent` + conversation CRUD, `app/services/agent_service.py`,
  `app/services/agent_executor.py`, `app/models/agent.py`.
- **How it works:** JWT-authenticated; SSE stream of typed events (`message`,
  `profiles`, `search_log`, `done`); the AgentExecutor decides between tools
  (talent search, profile deep-dive, compare) and direct response; conversation
  + memory persisted in Supabase (`agent_conversations`); entity memory tracks
  people mentioned across turns.
- **What it is not:** it has no connection to the web workspace chat, no offer
  cards (it returns `profiles` events, not Cubora offer cards), no clarification
  state machine (clarification is emergent from the LLM, not the plan's
  ask-only-when-necessary flow), no sourcing-request creation, no commercial
  context, no quotations/proposals, no read states, no Spanish. The plan's
  structured-streaming contract (spec O12) does not exist yet — the current SSE
  event set is the de-facto contract and is undocumented outside code comments.

### 4.3 What Cubora chat needs that exists nowhere

Persistent buyer↔provider mediated conversations outside a project; commercial
context attached to conversations; quotations/proposals; contact-privacy +
controlled release; sourcing requests + consumer notification; audit trail of
commercial events; bilingual support. The web chat gives Cubora the **transport
and the realtime pattern**; the AI chat gives it the **agent + streaming pattern**.
Both need adaptation; neither can be reused as-is for discovery or mediation.

## 5. Auth + Supabase RLS

### 5.1 Web auth

- Supabase Auth via `@supabase/ssr`; `proxy.ts` gates pages (§2.4); server
  components use the session client `db()` (RLS-enforced); `adminDb()` is the
  service-role client, documented as reserved for operations a user provably cannot
  perform as themselves (bot messages, webhook-driven escrow flips, sign-up user
  creation). Call sites: admin console (all reads, behind `requireAdminScope()`),
  crons, waitlist, unsubscribe, chat privileged writes, briefs/project deletion.
- `requireAdminScope()` is the single admin gate: it answers "may this person see a
  console at all, and whose tenant's data is in it" — host-decided scope, `tenantId:
  null` = unscoped, only for a TropicalTalent super admin on the classic host. The
  module comment records a real past leak (a second gate that skipped scoping showed
  classic-TropicalTalent referrers on a tenant's domain) and its removal. **Caveat,
  stated in the code itself:** `adminDb()` bypasses RLS, so in the admin console the
  tenant boundary is application code, not Postgres; `scripts/verify-tenancy.mjs`
  asserts it from outside.
- Roles: `users.role` ∈ `creative | brand | admin` (there is no sign-up path to
  `admin`; a super admin is an implicit `wl_admin` of every tenant). Profile
  completion is a boolean (`profile_completed`); verification is a `creative_data`
  column (`pending | approved | rejected`, migration `add_verification_to_creative_data.sql`)
  with an admin flow — a usable seed for Cubora verification (O6 still open: what
  "verified" means, what evidence, who verifies).

### 5.2 RLS — extensive, unaudited live

- **106 `CREATE POLICY` statements across 29 migration files; 48 `ENABLE ROW LEVEL
  SECURITY`; 102 `SECURITY DEFINER` functions** (RPCs carry much of the write logic:
  `tropical_save_deliverables`, `tropical_unread_counts`, `tropical_run_retention`,
  `tropical_create_project`, escrow guards, etc.).
- Migration 002 is the core RLS file; 024/025/038 are tenancy/identity lockdowns
  (038: anon lockdown; 026: storage lockdown; 047 `rpc_lockdown`).
- **This audit could not validate RLS live** (no database was available). The policy
  count is evidence of intent, not of correctness. Phase 5's "RLS validation" is
  still entirely ahead, and the `SECURITY DEFINER` surface (102 functions) is the
  highest-risk area to review: a single overly-broad definer function bypasses
  every policy.
- **Migration hygiene problem:** 81 migration files; numbered 001–050 with
  **duplicated numbers 019, 047, 048, 049** (two different files each); 28 files are
  unnumbered legacy names (`add_*.sql`, `create_*.sql`, `fix_*.sql`,
  `collaborations_update_policy.sql`, …). `migrations/apply.mjs` only applies
  `/^\d{3}_.*\.sql$/` in lexicographic order — **the 28 unnumbered files are never
  applied by the runner**, and there is no migration-tracking table (re-runs rely on
  `IF NOT EXISTS` guards). Lexicographic order also makes the duplicate numbers
  apply in filename order, not in any intended sequence. The schema a fresh deploy
  gets from `apply.mjs` is therefore **not** the schema the file list suggests.
  (Also note: `apply.mjs`'s header still references a `migrations/tropical/`
  path that does not exist in this tree.)

### 5.3 Service-role usage in the AI backend

Every AI service that touches Supabase uses the **service-role key** (`create_client(
settings.supabase_url, settings.supabase_service_role_key)`), i.e. it bypasses RLS
by construction. Authorisation is therefore entirely the API layer's job — which is
why the gaps in §7.2 matter. `config.py` documents this. There is no per-user
Supabase client anywhere in `apps/ai`.

### 5.4 AI auth mechanism

`get_current_user` (`app/dependencies/auth.py`) validates the JWT locally with
`python-jose`, HS256, `SUPABASE_JWT_SECRET`, `audience="authenticated"`,
`verify_exp=True`. That is a correct shape for Supabase JWTs. Gaps: no check that
the user still exists / is not banned; the payload is trusted as the identity with
no further lookup; `rate_limit` is per-IP (`request.client.host`), not per-user,
so one NAT / one bad actor can consume the shared 60/min budget and lock others
out — and the in-process fallback is per-worker, so under Gunicorn the limit is
effectively 60/min **per worker**.

## 6. Payments: omitted — and what that breaks

The omission is honest and complete at the provider level (no Stripe dep, no Stripe
routes, no webhook, no GBP payout rail). The stubs keep the exact export surface:

- `modules/escrow/actions.ts` — every action returns
  "Payments are omitted in this reference build…". `notifyEscrowFunded` etc. are
  no-ops. But the **UI still renders escrow state**: `escrow-banner.tsx`,
  `contract-panel`, `role-contract-panel`, and the chat module's escrow-paid boundary
  (contracts stop being editable "after payment") all read escrow status that can
  never change. Dead UI around a dead state machine.
- `modules/wallet/actions.ts` — `withdrawAction` refuses; `/wallet` is a placeholder
  page; nav link removed.
- `modules/recurring/` — actions + `billing.ts` stubbed; the retainer UI
  (`retainer-admin-panel.tsx` 1,054 lines, `retainer-composer`, `retainer-panel`)
  still exists and compiles against the stub.
- **Historical escrow migrations remain** (008, 015–017, 034, 046, 047) as reference
  schema; the tables exist in the migration set but nothing funds or releases them.
- **Consequence for Cubora:** the plan's MVP has no custody of funds (correct per
  spec), but the inherited workspace **uses escrow funding as a workflow key**
  (group-chat unlock, contract locking, delivery confirmation). Phase 4 must replace
  escrow-funded transitions with Cubora's own state machine (proposal acceptance,
  contact release) — it cannot just "turn payments back on".

## 7. Security gaps (ranked)

### 7.1 Sentry — pre-fix state (`5f7ef4a`) and the fix (`64b77ba`)

**Pre-fix (`5f7ef4a`, what shipped in the fusion):** `apps/ai/app/core/sentry.py`
called `sentry_sdk.init()` **at import time** with a **hardcoded DSN**
(`https://bf020ddd8d414e8e1ba71e493bec488e@o4510276306468864.ingest.us.sentry.io/4510295934173184`,
`send_default_pii=True`). Importing `app.core` anywhere — including local runs and
tests — initialised the SDK against the production Sentry project, so local/dev
errors were reported to production. A **second copy of the same hardcoded DSN**
was embedded in the `get_logger` docstring in `app/core/logging.py` (a pasted code
sample left inside a docstring). `config.py` already had the proper fields
(`sentry_dsn`, `sentry_environment`, `sentry_traces_sample_rate`) — they were
simply never used by `sentry.py`.
One correction to the task brief: `config.py`'s `sentry_environment` default is
**`"development"`, not `"production"`** — the "production" aspect of the bug is
that the hardcoded DSN pointed at the production Sentry project regardless of
environment, not a default value.
**Fix (committed during this audit as `64b77ba`, "fix(ai): Sentry env-driven,
disabled without DSN"):** `sentry.py` now
exposes `init_sentry(settings)` (no import-time side effect; no-op without a DSN;
environment from `SENTRY_ENVIRONMENT`, default `development`); `main.py` calls it
at startup; the docstring DSN is removed from `logging.py`; `.env.example` documents
`SENTRY_DSN`/`SENTRY_ENVIRONMENT`; new `tests/test_sentry_config.py` (6 tests).
**Not yet fixed by that change:** `send_default_pii=True` is retained; `push_scope`
usages remain (§7.4).

### 7.2 Unauthenticated / under-authenticated AI endpoints (highest risk)

1. **`GET /search`** (`app/routes/internals/search.py`): no auth at all; `user_id` is
   a caller-supplied query param. Anyone can search **as any user** — results exclude
   that user and search logs are saved under that user (`search_log_saver`). It also
   burns Gemini embedding + Pinecone + rerank cost per anonymous call, rate-limited
   only per IP (60/min, §5.4). Intended as an internal agent-tool endpoint; it is
   mounted on the public API with no internal key.
2. **`GET /generate-feedback-insights`** (`app/routes/feedback.py`): no auth; reads
   the last 24 h of `feedback_messages` via the service-role client and sends the
   content to Gemini 1.5-flash. Anyone can exfiltrate user feedback verbatim and
   run up Gemini cost.
3. **`GET /generate-search-insights`** (`app/routes/search_insights.py`): no auth;
   same shape, over `search_logs` (user queries + result counts) via service role.
   Module-level `supabase = create_client(...)` at import time.
4. **`POST /api/vectorize`**: JWT-authenticated, but the `user_id` form field is
   caller-supplied and **never compared to `current_user["sub"]`** — any authenticated
   user can vectorize (overwrite) any other user's Pinecone profile, including
   uploading a PDF/YouTube/image analysis under their identity. (The DELETE
   endpoint does the check correctly — the inconsistency shows the POST check was
   simply missed.)
5. **`POST /api/webhooks/vectorize`**: QStash signature verification is **skipped
   whenever `QSTASH_CURRENT_SIGNING_KEY` is unset** — the code logs "skipping
   signature check (dev mode)" and returns, with no environment check. The comment
   says "skip in dev/test but block in prod"; the code does not block in prod. A
   deployment that forgets the keys ships an unauthenticated vectorize webhook.
6. **`GET /health`**: unauthenticated by design (load-balancer use) — acceptable,
   but it returns a static payload with no dependency checks.

### 7.3 Fixed in the fusion (verify, don't re-fix)

- `INTERNAL_API_KEY` is required with no default; `Settings()` raises at startup if
  unset (verified in `config.py`; the app fails fast — this audit's import check
  confirmed the fail-fast behaviour). The admin backfill route checks
  `X-Admin-Key` against it.
- No live secrets in the tree (see §8). The old `INTERNAL_API_KEY` placeholder
  default is gone.

### 7.4 Latent runtime breakage (will fail when hit, not at import)

- **`sentry_sdk.push_scope()`** is used in 3 places (`app/core/__init__.py:42`,
  `app/routes/internals/search.py:71`, `app/routes/admin.py:149`, plus
  `app/routes/vectorize.py`) — `push_scope` was **removed in sentry-sdk 2.x**
  (the pinned SDK is 2.52.0). Any exception on those paths raises
  `AttributeError` inside the error handler instead of reporting. The same applies
  to the `capture_exception` helper in `app/core/__init__.py`.
- **`datetime.utcnow()`** (deprecated, naive) in ~10 places
  (`app/core/supabase_service.py`, `app/core/user_vector_cache.py`,
  `app/models/*.py` as `default_factory`, `app/routes/health.py`).
- **Gemini 1.5-flash** in the two insights endpoints vs 2.5-flash everywhere else.
- **Docs-gating:** `/docs`, `/redoc`, `/openapi.json` are only mounted when
  `settings.debug` is true — good; but `debug` also enables uvicorn reload in
  `main()` and `get_cors_origins()` returns `["*"]` in dev (that method is unused
  — see §8 — so the wildcard is currently dead, not live).

### 7.5 Web-side notes

- `proxy.ts` trusts the locally-decoded cookie **only for routing**; the design is
  sound, but its safety rests on RLS + verified `getUser()` in every server
  component. Spot-checked paths comply; a full audit of every `db()` call site was
  out of scope for Phase 0 and belongs in Phase 5.
- `CRON_SECRET` / `UNSUBSCRIBE_SECRET`: the retention cron 503s if `CRON_SECRET`
  is unset (fail-closed); the unsubscribe HMAC (`lib/unsubscribe.ts`) deliberately
  never expires (documented trade-off).
- CSP in `next.config.mjs` is tight (Supabase origins only, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`); `unsafe-inline` scripts remain for Next's bootstrap.
- Supabase JS packages are `latest` (unpinned) — a future major could break the
  build without a code change.

## 8. Dead code, stubs, and drift

- **Stubs (intentional, documented):** `modules/escrow`, `modules/wallet`,
  `modules/recurring` (actions + `billing.ts`); `/wallet` placeholder page;
  `poweredBy` tenant toggle (schema + form field exist, renders nothing).
- **Disabled:** Team Search router (commented out, §3); opportunities CRUD
  (orphaned service, no route, §3.3).
- **Dead/broken files:** `apps/ai/ai` — an executable shell wrapper that delegates
  to `$PARENT_DIR/ai`, which does not exist as a file (`apps/` contains only `ai/`
  and `web/`); it cannot run. `apps/ai/app/core/database.py` vs
  `app/models/database.py` — confusingly named near-duplicates (client wrapper vs
  Pydantic models); the client is what the code imports, the models file is the
  schema — not dead, but a rename candidate. `Settings.get_cors_origins()` is
  defined but never called (`setup_cors` hardcodes its own list, including the
  placeholder `https://tropicaltalent.dev` / `www.tropicaltalent.dev`).
- **Docs drift (stale, do not trust):** `apps/ai/DEPLOYMENT.md` documents
  `railway.json` and Railway deployment; **neither `railway.json` nor any
  `Dockerfile` exists** in the repo. `apps/ai/AUTH_IMPLEMENTATION.md` (Spanish)
  documents `get_supabase_client()` in `app/dependencies/auth.py` — that function
  moved to `app/core/database.py`. `apps/ai/AI_SELF_IMPROVEMENT_PROPOSALS.md`,
  `MICROSERVICE_DETAILS.md`, `PRODUCTION_CONFIG.md`, `resources-explanation.md`
  describe the pre-fusion product. `apps/ai/tests/README.md` + `testsprite_tests/`
  (8 TestSprite cases + raw report JSON) are stale artefacts of a run that was
  7/8 failed because the server was never up (AUDIT.md). `apps/web/docs/` holds
  only a budget-split design note, a table audit, and a white-label runbook.
- **No secrets found in the working tree** by the fusion's grep
  (`sk_live/sk_test/pk_live/whsec_/AIza/pcsk_/sbp_`, fake JWT stubs only) — with
  one exception the fusion report does not mention: the **hardcoded Sentry DSN**
  (§7.1) is a live credential-equivalent in HEAD. It is a public DSN (not a secret
  key), but it routes errors to someone else's Sentry project; rotate it as part
  of the Sentry fix.
- **Seed data is fictional** (`scripts/seed-tropical.ts`, `.invalid` domain,
  `change-me-dev-only` default password) and film/music-flavoured; safe for dev,
  useless as Cubora supply. **Never fabricate supply** (plan §4) means the seed
  must not be presented as real listings.

## 9. What is missing for Cubora (gap map vs plan §14)

| Plan need | Current state |
|---|---|
| Unified catalog: talent / services / products & production | **Absent.** There is a talent directory and a brief/project model. No services, no products, no producers, no production capacity, no unified offer model, no category-specific fields. |
| Provider/business profiles | Partial. Talent profile = `users` + `creative_data` (bio, tags, passion, video, verification) + location. No business profiles, no documents, no languages field, no portfolio beyond showreel/PDF. |
| Verification + Made in Cuba seal | Seed only: `verification` enum (`pending/approved/rejected`) + admin flow. No origin verification, no seal, no separation of origin vs quality (spec O6 open). |
| AI discovery (conversational, inline cards, clarify-when-needed) | Seed only: agent SSE + tools + no-results message. No inline offer cards, no clarification policy, no structured streaming contract (spec O12 open), no sourcing requests. |
| Mediated communication / contact release / fee | **Absent.** Chat is project-scoped; no contact-release control, no fee model (spec O1–O4 open), no proposals/quotations as commercial objects (contracts exist but are escrow-shaped). |
| Dashboards (consumer / provider / ops CRM) | Partial. Admin console (11 pages) is the closest thing to an ops view, but it is a Tones admin console (users/projects/earnings/referrals/tenants/complaints), not a commercial CRM (no incoming/unmatched requests, no supplier verification queue, no contact-release approvals, no fee tracking). No consumer or provider dashboard as Cubora defines them. |
| i18n EN/ES (`next-intl`, localized routes) | **Absent.** |
| Onboarding (what do you want to do first; dual roles) | Minimal: sign-up + one profile-completion step. No role-choice onboarding, no dual roles. |
| Trust/compliance (screening, human review, audit trail) | Partial: complaints/disputes + account deletion + retention + admin review exist as mechanics. No sanctions/export screening, no human-review routing, no commercial audit trail. |
| Observability | Structlog JSON logging in AI; Sentry (broken, §7.1); no Sentry in web (the web Sentry wrapper was removed in the fusion); no metrics. |
| Brand (Cubora, light-green system, tagline) | **Not started.** Brand is still TropicalTalent; green theme is the Tones rebrand, not the Cubora design system. |
| Repo docs (`docs/` per plan §16) | **Not started.** No root `docs/`. |

## 10. Test state + verification performed in this audit

- **Allowed checks (re-run 2026-11-11/12):**
  - `bun run typecheck` in `apps/web`: **PASS, 0 errors** (re-run by this audit).
  - `uv run python -c "from app.main import app"` in `apps/ai`: **PASS** (with dummy
    required env vars; 14 routes registered). Without env vars it fails fast with
    `ValidationError` — expected and correct. Note: the check ran against the
    tree already containing the Sentry fix (committed as `64b77ba` during the
    audit); the fix only touches Sentry init, not routing.
- **Not run (per task):** full test suites, `next build`. BUILD_REPORT.md's
  "`next build` was not run" is still true.
- **AI test suite (static count):** 5 test files, 61 test functions
  (`test_auth.py` 8, `test_endpoints.py` 13, `test_infrastructure.py` 22,
  `test_services.py` 12, `test_sentry_config.py` 6 — the last is the Sentry-fix
  file, committed during this audit as `64b77ba`). BUILD_REPORT's "28 failed / 18 passed" was
  **not re-run** and is quoted, not verified, here.
- **Known test drift (verified statically):** `tests/test_auth.py:16` imports
  `get_supabase_client` from `app.dependencies.auth` — that symbol no longer
  exists there (it moved to `app.core.database`); the file also patches
  `app.dependencies.auth.get_supabase_client` in 5 places. It **cannot pass**
  as written. `tests/conftest.py` imports `app.main` and sets dummy env vars
  itself, so collection of the other files is at least possible.
- **Web tests:** 3 files (`modules/admin/health.test.ts` 11 tests,
  `modules/admin/user-table.test.ts` 14, `modules/tenancy/theme.test.ts` 22 —
  47 test cases total), run by `bun test`. Not run in this audit.
- **No live verification exists for:** any migration applied to a real database,
  RLS behaviour, realtime delivery, Resend delivery, Pinecone/Gemini calls, or
  the full brief→project→delivery loop. `scripts/verify.mjs` and
  `scripts/verify-tenancy.mjs` exist but were not run (they need a live project).

## 11. Corrections to AUDIT.md / BUILD_REPORT.md

Verified against the current tree; corrections, not contradictions — the fusion
report was largely accurate, these are the deltas:

1. **"grep `tones`: 3 hits / `salome`: 0 / `stripe`: 0" — no longer accurate.**
   Current worktree (excluding lockfiles, `node_modules`, `.venv`, `.git`):
   `tones` 6 hits, `salome` 2, `stripe` 4. All are prose in origin notes /
   READMEs / STATUS.md / a CORS comment (`tonesagency.com` etc.) — no code
   references, no Stripe dependency — but the "0 hits" claim is false as stated
   and the counts drifted because the reports themselves mention the names.
   (The fusion's own grep presumably excluded docs.)
2. **"No GBP" / "no prices" — inaccurate.** The payment *provider* is gone, but
   `lib/money.ts` still denominates everything in GBP pence (`CURRENCY = 'GBP'`,
   `£` formatting), and briefs carry pence budgets. Any Cubora pricing work must
   replace this, not just "add a provider".
3. **"No remote configured" — changed.** `origin` now points at
   `git@ssh.github.com:SRogDev/TropicalTalent.git`. The repo has been published
   since the fusion (memory: remote `main @ 969c6cda`, same tree, different
   history from local `5f7ef4a`). Local is behind the remote; fetch/re-clone
   before building.
4. **"Sentry `push_scope` removed in SDK 2.x" — confirmed and extended.** It is
   still used in 4 places (§7.4); the Sentry fix in `64b77ba` does not touch them.
5. **"Team Search disabled — router commented out" — confirmed**, and the graph
   itself is complete and compilable (6 nodes, interrupt, Redis/MemorySaver).
   The decision is re-enable-or-cut, not build-from-scratch.
6. **"Geography UK-only" — confirmed and bounded.** It is exactly one module
   (`app/services/city_normalizer.py`, 281 lines, "UK only" in its own docstring,
   e.g. `"brum" → "Birmingham"`, `"londres" → "London"`). The web side has a
   `locations` table (`add_locations_table.sql`: city/county/country) with no
   Cuba content.
7. **AUDIT.md's "55 unit tests, TestSprite 7/8 failed"** describes the
   pre-fusion backend; the fused tree has 61 test functions across 5 files
   (including the new Sentry tests). The TestSprite artefacts are still in the
   tree, stale.
8. **AUDIT.md's "no Dockerfile / railway.json although docs cite them" —
   still true**, and worse: `DEPLOYMENT.md` still documents a Railway flow
   (`railway up`, `railway.json` detection) for files that do not exist.
9. **New since the fusion (not in either prior report):** the group-channel
   escrow lock (§4.1) — the fusion stubbed escrow funding, which silently
   disables the group channel; and the migration-runner gap (§5.2) — 28 of 81
   migration files are never applied by `apply.mjs`.
10. **Sentry DSN:** neither prior report names the hardcoded DSN as a credential
    exposure. It is one (public DSN, §7.1/§8) and should be rotated.

## 12. Reusable inventory — what Phase 1–5 can build on vs rebuild

**Reuse as-is (with adaptation):**
- Web project chat transport + realtime pattern (§4.1) — the subscription model,
  optimistic IDs, channel model. Must decouple visibility from escrow.
- AI agent + SSE streaming + tools + memory (§3.1) — the discovery engine seed.
  Must gain offer cards, clarification policy, sourcing requests, structured
  events (O12).
- Pinecone hybrid search + Gemini rerank + vectorize pipeline (profile/PDF/
  YouTube/image analysis) — the matching core. Must gain Cuba geography,
  product/producer vectors, and the `creative_data` → new-schema migration.
- Identity module (sign-up, profile completion, avatar, deletion, export) —
  the account spine. Must gain dual roles + onboarding.
- Admin console shell + `requireAdminScope()` pattern — the ops-CRM spine. Must
  gain commercial queues (requests, verification, contact-release, fees).
- Notifications (Resend + in-app + live toasts) — reuse; add bilingual templates.
- Tenancy system — **only if** Roger keeps white-label; otherwise cut (it is
  ~1,700 lines + 10 migrations of scope Cubora does not need in the MVP).
- RLS policy set + RPC patterns — reuse as the starting point, but Phase 5 must
  validate live; the 102 `SECURITY DEFINER` functions are the review priority.

**Rebuild / build new:**
- Unified catalog + offer model (talent/services/products/production) — nothing
  exists.
- Provider/business profiles, verification + Made in Cuba seal — seed only.
- Discovery UX (inline cards, compare, request quotation, sourcing requests) —
  new on top of the agent.
- Commercial workflow (negotiation, proposals, contact release, fee records) —
  new state machine; the escrow-shaped contract model does not map onto it.
- i18n (`next-intl`, localized routes, ES translations) — from zero.
- Cubora brand + light-green design system + landing — from zero (current brand
  is TropicalTalent).
- `docs/` structure per plan §16 — from zero.
- Schema alignment migration (AI tables ↔ `tropical_*` tables) — prerequisite
  for any web↔AI wiring.

**Decide before building (blocking):** spec OPEN O1–O5 (fee model, "securing a
contact", fee timing, contact-release conditions, payment/compliance route) block
Phase 4; O6 (what "verified" means) blocks verification + seal; O12 (streaming
contract) blocks Phase 3 frontend↔AI integration; O9 (launch bar) blocks Phase 5.
The white-label keep-or-cut decision and the Team Search re-enable-or-cut decision
are the two largest code-scope decisions in the repo.

## Appendix A — Endpoint inventory (AI, runtime)

`/` · `/health` · `POST /api/agent` · `POST /api/agent/conversations` ·
`GET /api/agent/conversations` · `GET /api/agent/conversations/{id}` ·
`DELETE /api/agent/conversations/{id}` · `GET /api/recommendations` ·
`POST /api/vectorize` · `DELETE /api/vectorize/{user_id}` ·
`POST /api/webhooks/vectorize` · `POST /api/admin/backfill-vectors` ·
`GET /search` · `GET /generate-feedback-insights` · `GET /generate-search-insights`
(`POST /api/team-search` exists in code, not mounted.) Docs/OpenAPI only when
`debug=true`.

## Appendix B — Web route inventory

See §2.1 (32 pages/routes). Admin: 11 pages. API: 3 routes. No `/terms`,
`/privacy-policy` routes exist despite `proxy.ts` listing them as public.

## Appendix C — Migration inventory (summary)

81 files in `apps/web/migrations/`: numbered 001–050 (54 files incl. duplicate
019/047/048/049 pairs) + 28 unnumbered legacy files not applied by `apply.mjs`.
Core: 001 schema (15 tables), 002 RLS, 006 realtime, 007 project creation,
008/015–017/034 escrow, 010–012 v2 tables/logic/invites, 014 referrals, 019
feedback/withdrawal-reason, 020–021 notifications/rewards, 022 archive legacy,
023–025/031–032/036 tenancy, 026 storage lockdown, 027–029/035/043 retainers,
030 contract documents, 033 member roles, 037 technical disciplines,
038 identity anon lockdown, 039 archive dead objects, 040 account deletion,
041 complaints, 042 consent/retention, 044–045 deletion/archive, 046 card setup,
047 budget-split edit + RPC lockdown, 048 leave-role + user-stats RLS,
049 archived views + signup trigger, 050 welcome emails.
