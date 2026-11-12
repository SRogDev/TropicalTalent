# Brand Strategy — Cubora

**Status:** Phase 5 (Quality & Launch). Brand record for the Cubora
MVP. Sources: `CUBORA_PLAN.md` §2, §12, §13; `CUBORA_SPEC_ANALYSIS.md`
§4.2 (MUST S4–S12), §6; `docs/architecture/design-system.md`
(Phase 1 tokens, seal artwork); `docs/architecture/data-model.md`
§2 (the seal at the database level).

## 1. Name and tagline

- **Name:** Cubora.
- **Tagline:** "Born from ingenuity. Built through resilience. Made in
  Cuba."

The name is the product; the tagline is the promise. The tagline is
used on the landing page and in marketing material. It is not a
quality claim, a certification, or a guarantee about any individual
offer — it describes the platform's origin story and ambition.

## 2. Personality

Global, technological, commercially professional, and distinctly
Cuban (plan §2, spec S5). In practice:

- **Global:** written for an international buyer who has never done
  business with Cuba. No assumed local knowledge, no insider jargon.
- **Technological:** the product is AI-mediated discovery and
  commercial coordination, not a phone book. Copy leads with what the
  platform does, not with adjectives about Cuba.
- **Commercially professional:** the tone of a trustworthy
  intermediary. Precise about what is verified and what is not,
  plain about what is still undecided, and never promotional about
  an offer's exportability, payment, or delivery.
- **Distinctly Cuban:** the identity is Cuban without performing
  Cubanness. The story is ingenuity and resilience — the people and
  the capability — not scenery.

The desired experience, in three words (spec §6): trustworthy, clear,
professional.

## 3. Visual direction

Contemporary and minimal, with light green as the primary brand
color (plan §2, spec S6). The design system is the authority on
tokens and components — see `docs/architecture/design-system.md`:

- **Palette:** the Cubora light-green ramp (`--cubora-50` …
  `--cubora-900` in `apps/web/app/[locale]/globals.css`), deep green
  → emerald → lime. Text-safe greens (600/700) for body text on
  white; lime is signal/accent only, never body text.
- **Mark:** an open "C" closed by a lime signal dot
  (`public/cubora-logo.svg`, `app/icon.svg`).
- **Typography:** Inter for headings and UI; Playfair Display for the
  landing tagline and marketing headings only. The app UI stays
  Inter — a serif body would hurt legibility in dense screens.
- **Motion and spacing:** large section gaps, `rounded-2xl` cards,
  200–300ms transitions, one attention cue per flow, reduced-motion
  support.
- **Accessibility:** 4.5:1 contrast minimum, visible focus rings,
  44px touch targets, SVG/Lucide icons only — no emoji as icons.

No exact light-green value, type scale, or motion language is defined
in the plan; Phase 1 defined the tokens as a design-system decision
(spec §9, ASSUMES). The tokens in `globals.css` are the current
record — if they change, this doc and the design-system doc change
together.

## 4. What to avoid

The plan is explicit (plan §2, spec S8): **avoid tourist clichés,
stereotypical imagery, and excessive visual decoration.** Concretely:

- No palm trees, beaches, cigars, vintage cars, rum, or salsa
  imagery as brand shorthand. The previous palm-tree/beach logo was
  reworked for exactly this reason (design-system doc).
- No decorative Cuban iconography on commercial surfaces. Cuban
  identity is carried by the name, the tagline, the seal, and the
  providers' own words — not by stock imagery.
- No visual decoration that competes with the commercial content.
  On offer cards and in the CRM, verification status and the seal
  outrank brand flourishes (spec §6 visual hierarchy).
- No emoji as icons anywhere (design-system rule).

## 5. The Made in Cuba seal

A recognizable seal for products genuinely made, grown, or
manufactured in Cuba (plan §2, spec S9–S12). The seal rules:

1. **Origin only, never quality.** The seal marks verified Cuban
   origin. It is not a quality certification, and origin verification
   is kept separate from quality certification (plan §2, spec S11).
   No UI presents the seal as a quality claim, and no offer's
   quality field is treated as verified by the platform.
2. **Verified origin before the seal.** Origin is verified before the
   seal is awarded (spec S10). At the database level this is a
   CHECK constraint: `NOT made_in_cuba OR origin_verified` — the
   seal cannot exist without verified origin
   (`docs/architecture/data-model.md` §2). The flag is set only by
   the admin/ops verification flow; a provider cannot set it.
3. **Per-offer, not per-provider.** A verified provider can still
   have an unverified product. Provider verification and origin
   verification are different facts stored on different rows.
4. **Identity and authenticity indicator.** The seal is used across
   the platform as a recognizable identity and authenticity indicator
   (spec S12) — on offer cards and in catalog filters — wherever an
   origin-verified product appears.
5. **Artwork.** `public/made-in-cuba-seal.svg` — the Cubora "C" mark
   inside a double ring, language-neutral. The translated label is
   rendered by the `MadeInCubaBadge` component, never inside the SVG.

**What "verified" means is still OPEN (spec O6):** what evidence
counts, who verifies, and whether re-verification is required. The
seal's database gate (origin verified → seal allowed) is built; the
evidence standard behind "origin verified" is not defined. See
`docs/operations/supplier-verification.md`.

**Planned, not implemented:** nothing about the seal's visual
treatment beyond the Phase 1 artwork and badge component is
specified — seal placement rules on marketing surfaces and any
seal-specific landing content are design decisions for a later
phase, not claims made here.

## 6. Voice and tone

Cubora speaks in the voice of a careful intermediary, in English and
Spanish from the MVP (plan §11). Rules:

- **Plain and specific.** Name the offer, the provider's stated
  capability, and the verification status. Never pad a thin offer
  with adjectives.
- **Honest about limits.** If export, payment, or delivery is not
  verified for an operation, say so — never imply it
  (plan §7, spec S42). If a fee, a condition, or a timeline is
  undecided, say it is undecided and who decides it.
- **Never fabricate.** The AI never invents suppliers, products,
  availability, or verification (plan §4, spec S20). Marketing copy
  follows the same rule: no invented provider counts, no invented
  success stories, no invented outcomes.
- **Mediation is the product.** Copy describes Cubora as the
  coordinator — discovery, negotiation, proposal, contact release —
  not as a passive listing site. See `docs/marketing/positioning.md`.
- **Bilingual, not translated-as-afterthought.** The complete
  experience — onboarding, dashboards, notifications, transactional
  messages — is translated (plan §11, spec S55). Bilingual QA of the
  new surfaces is Phase 5 work and is not yet verified; see
  `docs/architecture/e2e-commercial-workflow.md`.

## 7. What this doc does not decide

- The evidence standard for verification and for the seal (O6).
- Any fee, price, or commercial-terms language (O1, O3, O7) — brand
  copy must not state a fee or a price the product has not decided.
- Numeric marketing targets (O15) — see
  `docs/marketing/go-to-market.md`.
- Exact clarification style, card layout, and dashboard density
  (O14) — UI detail decisions left open by the plan.
