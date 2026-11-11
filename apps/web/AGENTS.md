# AGENTS.md

Root context for AI coding agents (Claude, Codex, Copilot, etc).

Full project context lives in the monorepo root `AGENTS.md` plus
[README.md](README.md) (this app) and [claude.md](claude.md) (short version).
Read one of those before making changes.

This app — `apps/web` — is the TropicalTalent marketplace web app (Next.js 16,
React 19, TypeScript, Bun, Tailwind 4, Supabase, Resend). It is a **reference
base, not the final product**, and **payments are omitted entirely**: no
payment provider, no checkout, no escrow, no payouts. `modules/escrow`,
`modules/wallet` and the recurring billing engine are stubs that refuse with a
plain message — do not re-add a payment provider without a new decision.
