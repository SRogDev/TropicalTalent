# Cubora Design System — Phase 1

**Status:** Phase 1 (Brand & Foundation). Source: `CUBORA_PLAN.md` §2, the
ui-ux-pro-max design-system search already run for this phase ("commercial
marketplace minimal light green", Hero + Testimonials + CTA, Vibrant &
Block-based), and the tokens in `apps/web/app/[locale]/globals.css`.

**Palette note:** the search suggested a violet/purple palette. That was
rejected — the brand palette stays **light green** per the plan (brand wins
on colour). The search is used here for system structure, typography,
spacing and UX rules only, not for colour.

## Brand

- **Name:** Cubora. **Tagline:** "Born from ingenuity. Built through
  resilience. Made in Cuba."
- **Personality:** global, technological, commercially professional,
  distinctly Cuban. Contemporary and minimal.
- **Never:** tourist clichés, stereotypical imagery, excessive decoration.
  The previous palm-tree/beach logo was reworked for exactly this reason —
  the mark is now an open "C" closed by a lime signal dot
  (`public/cubora-logo.svg`, `app/icon.svg`).

## Colour — Cubora light green

Tokens live in `:root` in `globals.css` (`--cubora-50` … `--cubora-900`,
registered as `bg-cubora-*` / `text-cubora-*` utilities). The ramp, deep
green → emerald → lime:

| Token | oklch | Use |
|---|---|---|
| `--cubora-900` / `--brand-deep` | `0.26 0.11 160` | Dark text on light, gradient start |
| `--cubora-700` | `0.43 0.17 160` | Body-safe green text on white |
| `--cubora-600` / `--brand-emerald` | `0.52 0.19 155` | Primary actions (light theme) |
| `--cubora-500` | `0.62 0.20 155` | Primary actions (dark theme) |
| `--cubora-300` / `--brand-lime` | `0.80 0.16 140` | Signal / accent only, never body text |
| `--cubora-50` | `0.97 0.03 155` | Tinted surfaces |

The brand gradient (`gradient-app`, `gradient-app-text`) runs deep green →
emerald → lime at 135°. The signed-in app theme (`.tropical` in
`globals.css`) keeps its existing green system — it already was deep green →
emerald → lime; Phase 1 refined the tokens rather than replacing the system.
The `.tropical` class name is a legacy identifier, not a brand statement.

**Contrast:** the 600/700 steps are the text-safe greens on white (4.5:1);
lime is signal only. Status colours keep the existing ramp
(`--status-pending/active/complete/cancelled`).

## Typography

- **Headings & UI:** Inter (400/500/600/700, `--font-inter`), already the
  app font. Base 16px, line-height 1.5.
- **Display:** Playfair Display (`--font-playfair`, utility `font-display`),
  for the landing tagline and marketing headings only. The app UI stays
  Inter — a serif body would hurt legibility in dense screens.
- **Rules:** no body text below 12px; no grey-on-grey; no raw hex in
  components — use the tokens.

## Spacing, radius, motion

- **Sections:** large, 48px+ gaps (`py-24`, `gap-12` grids on the landing
  page). Cards `rounded-2xl`, controls `rounded-lg`, radius token
  `--radius: 0.625rem`.
- **Transitions:** 200–300ms (`duration-200` standard). One attention cue
  only, on the single action a flow hinges on.
- **Reduced motion:** `prefers-reduced-motion: reduce` collapses all
  animation/transition durations to near-zero in `globals.css`.

## UX rules (from ui-ux-pro-max)

- **Accessibility:** 4.5:1 contrast minimum; visible `:focus-visible`
  2px ring with offset (enforced in `globals.css`, never removed);
  icon-only buttons carry `aria-label`; pinch-zoom is not capped.
- **Touch & interaction:** interactive elements ≥44px on coarse pointers
  (40px minimum enforced in CSS); `cursor-pointer` on clickable cards and
  buttons; hover states on every interactive element; loading feedback on
  submits (spinners, not silent waits).
- **Icons:** SVG/Lucide only — no emoji as icons, anywhere.
- **Forms:** visible labels (never placeholder-only), errors next to the
  field, progressive disclosure in the sign-up wizard (one question per
  step).
- **Responsive:** mobile-first; verified breakpoints 375 / 768 / 1024 /
  1440 (layout, no horizontal scroll, drawer nav below `md`).
- **Navigation:** predictable back behaviour, deep-linkable routes, locale
  in the URL so a shared link keeps its language.

## The Made in Cuba seal

Artwork: `public/made-in-cuba-seal.svg` — the Cubora "C" mark inside a
double ring, language-neutral (the translated label is rendered by the
`MadeInCubaBadge` component, never inside the SVG). The seal marks
**origin, not quality**: it may only be shown on an offer whose Cuban
origin has been verified, and origin verification is kept separate from
any quality claim. **Verification logic is Phase 2** — Phase 1 ships the
artwork and the badge component only; on the landing page the seal appears
as brand identity (what the seal means), never attached to a product.

## What Phase 1 did not change

- The white-label tenant theming (`modules/tenancy/theme.ts`) still lets a
  tenant supply its own palette; the Cubora tokens are the classic
  tenant's palette and the fallback.
- The classic tenant row in the database is still named "TropicalTalent"
  (seed data). Renaming it needs a data migration against a live database
  and is not part of this phase — user-visible copy that does not come from
  the database already says Cubora.

## i18n coverage

See `docs/architecture/screen-architecture.md` ("What is translated").
