import type { Tenant, TenantTheme } from './types';

/**
 * Tenant palette -> a CSS override block.
 *
 * app/globals.css defines the whole signed-in app as ~35 custom properties
 * under `.tropical`, and that class is mounted in exactly one place
 * (components/tropical/app-shell.tsx). The file says so itself: "because the
 * shadcn primitives read the same --color-* variables, every button, dialog
 * and popover inside the shell re-themes with no component changes".
 *
 * So re-skinning a tenant is redefining a handful of those properties. This
 * emits that block, server-rendered into the layout — no client JS, no flash
 * of the wrong brand, and no component anywhere needs to know a tenant exists.
 *
 * ---------------------------------------------------------------------------
 * This function builds a string that goes inside <style>. Treat it as such.
 * ---------------------------------------------------------------------------
 * `tenant.theme` is jsonb: whatever was written to the row. Interpolating it
 * raw would let anyone who can edit a tenant close the declaration and inject
 * arbitrary CSS — at minimum a defacement, and with the right selectors a way
 * to exfiltrate page content through attribute selectors and background URLs.
 *
 * Two independent gates, both allowlists rather than denylists:
 *
 *   1. Only keys in TOKENS are read at all. An unknown key is ignored, never
 *      passed through as a property name.
 *   2. Every value must fully match COLOUR — an anchored pattern for the
 *      colour syntaxes we accept. Anything containing a brace, semicolon,
 *      comment marker or url() fails to match and is dropped.
 *
 * A rejected value is dropped silently and the token keeps its TropicalTalent default,
 * so a malformed palette degrades to the standard theme rather than to a
 * broken page.
 */

/**
 * Accepted colour syntaxes, anchored end to end.
 *
 * The functional form permits only characters that can legitimately appear
 * inside colour arguments: digits, letters (for `deg`, `turn`, `none`), dots,
 * commas, percent, slash (the alpha separator in modern syntax), whitespace
 * and signs. No parentheses, so a nested function cannot smuggle url().
 */
const COLOUR =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:oklch|oklab|lab|lch|rgb|rgba|hsl|hsla|color)\([0-9a-z.,%/\s+-]{1,120}\))$/i;

/** Fonts registered at build time in app/layout.tsx. Nothing else is loadable. */
const FONTS: Record<string, string> = {
  inter: 'var(--font-inter)',
};

/**
 * Tenant theme key -> the CSS custom property it drives.
 *
 * Deliberately small. These are the tokens that carry brand identity; the rest
 * of the palette (surfaces, borders, muted text, the status ramp) stays as
 * TropicalTalent designed it, because a tenant supplying its own greys is how a themed
 * app stops being legible.
 */
/*
 * Every entry writes a `--tenant-*` holding variable, never the real token.
 *
 * The mapping blocks below then assign the real tokens in each theme. Writing
 * a real token directly here would put it at `.tropical` specificity, where
 * globals.css's `:root:not(.dark) .tropical` palette outranks it and quietly
 * reverts the tenant's colour in light mode.
 */
const TOKENS: Array<{ key: keyof TenantTheme; prop: string }> = [
  { key: 'primary', prop: '--tenant-primary' },
  { key: 'accent', prop: '--tenant-accent' },
  { key: 'gradientForeground', prop: '--tenant-on-brand' },
];

/** Longest palette we will build a gradient from. */
const MAX_STOPS = 4;

export function themeCss(tenant: Tenant): string {
  // The classic tenant is what globals.css already describes. Emitting an
  // identical override would be dead weight in every response.
  if (tenant.isClassic) return '';

  const theme = tenant.theme ?? {};
  const vars: string[] = [];

  for (const { key, prop } of TOKENS) {
    const value = theme[key];
    if (typeof value === 'string' && COLOUR.test(value.trim())) {
      vars.push(`${prop}:${value.trim()}`);
    }
  }

  const stops = Array.isArray(theme.gradient)
    ? theme.gradient
        .filter((s): s is string => typeof s === 'string' && COLOUR.test(s.trim()))
        .slice(0, MAX_STOPS)
        .map((s) => s.trim())
    : [];

  // One stop is not a gradient; two is the minimum that reads as one.
  if (stops.length >= 2) {
    vars.push(`--tenant-gradient:linear-gradient(135deg,${stops.join(',')})`);
  }

  const font = typeof theme.font === 'string' ? FONTS[theme.font.toLowerCase()] : undefined;
  if (font) vars.push(`--tenant-font:${font}`);

  if (vars.length === 0) return '';

  const declared = vars.join(';');

  /**
   * The page wash, re-hued.
   *
   * `--gradient-bg` is two big radial ellipses that `.tropical` paints behind the
   * entire signed-in app (globals.css:258). Both were hardcoded to TropicalTalent's
   * violet and orange in BOTH themes, and nothing here overrode them — so a
   * white-label with a green brand got green buttons on TropicalTalent's violet-and-
   * orange background. It is the largest coloured area on every screen, which
   * makes it the single most visible thing left saying "TropicalTalent" after the
   * buttons, logo and wordmark were all themed.
   *
   * Only emitted when the tenant supplied a hue to build it from. A tenant that
   * sets nothing but a gradient keeps TropicalTalent's wash rather than getting two
   * transparent ellipses and a flat background.
   *
   * color-mix at low percentages, matching what globals.css does by hand: the
   * wash is a tint, and a tenant's brand colour at full strength behind an
   * entire app is not a background, it is a wall.
   */
  const onBrand = safeColour(theme.gradientForeground);
  const primary = vars.some((v) => v.startsWith('--tenant-primary:'));
  const accent = vars.some((v) => v.startsWith('--tenant-accent:'));
  const wash = (from: number, to: number) =>
    primary || accent
      ? `--gradient-bg:` +
        `radial-gradient(ellipse at top left,color-mix(in oklab,var(--tenant-primary,var(--tenant-accent)) ${from}%,transparent),transparent 60%),` +
        `radial-gradient(ellipse at bottom right,color-mix(in oklab,var(--tenant-accent,var(--tenant-primary)) ${to}%,transparent),transparent 60%);`
      : '';

  // Why three blocks rather than one:
  //
  // `.tropical` holds the tenant's raw values. The two theme blocks then map
  // them onto the real tokens, and they do it DIFFERENTLY — which is the whole
  // reason this is not a single assignment. globals.css:270 explains it for
  // TropicalTalent's own violet: "Same violet, pulled darker: at the dark theme's
  // lightness it fails contrast against a near-white surface."
  //
  // A tenant supplies one brand colour, not a light and a dark variant, so the
  // light block derives one with color-mix — the same move, automated. Without
  // it, a tenant whose brand is a bright neon gets an unreadable light theme
  // and we would be shipping a contrast failure per customer.
  //
  // The selectors mirror globals.css exactly, including `:root:not(.dark)`
  // rather than `.light`, so the light palette is also what renders before
  // next-themes' inline script runs.
  return [
    // Root scope as well as `.tropical`. The auth screens — sign-in, complete,
    // reset, no-access — sit OUTSIDE the app shell, and they are the first
    // thing a white-label's users ever see. Without this their sign-in button
    // paints TropicalTalent's gradient under the tenant's own logo.
    //
    // --gradient-brand-foreground is mapped here and not only in the .tropical
    // blocks below for the same reason. The `text-on-brand` utility reads that
    // token, not --tenant-on-brand, so out here it fell through to its
    // near-white default: a tenant with a pale gradient could set the label
    // colour and watch the sign-in button ignore it — the one gradient button
    // every single user of theirs has to look at.
    `:root{${declared}${onBrand ? `;--gradient-brand-foreground:${onBrand}` : ''}}`,
    `.tropical{${declared}}`,

    `.tropical{` +
      // Darker theme, stronger tint — the same relationship globals.css uses
      // between its own two blocks.
      wash(32, 24) +
      `--primary:var(--tenant-primary,var(--primary));` +
      `--ring:var(--tenant-primary,var(--ring));` +
      `--accent:var(--tenant-accent,var(--accent));` +
      `--gradient-brand:var(--tenant-gradient,var(--gradient-brand));` +
      `--gradient-brand-foreground:var(--tenant-on-brand,var(--gradient-brand-foreground));` +
      `--shadow-glow:0 0 40px color-mix(in oklab,var(--tenant-primary,transparent) 40%,transparent);` +
      `--font-sans:var(--tenant-font,var(--font-inter));` +
      `}`,

    // Every token the DARK block above maps must be re-mapped here, not just
    // the ones that need a different value.
    //
    // globals.css defines its light palette at `:root:not(.dark) .tropical`,
    // which outranks a bare `.tropical` on specificity. So any token that block
    // sets — and it sets the whole palette, --gradient-brand and
    // --gradient-brand-foreground included — wins over the mapping above and
    // silently reverts to TropicalTalent's own colours in light mode.
    //
    // This is not hypothetical: the first version of this function omitted
    // --gradient-brand here, and a tenant with a green brand rendered green
    // buttons in dark mode and TropicalTalent's magenta in light mode.
    `:root:not(.dark) .tropical{` +
      // Fainter on white. globals.css:321 makes the same move for TropicalTalent's own
      // wash; a brand colour that reads as a tint on obsidian reads as a stain
      // on near-white.
      wash(20, 16) +
      `--primary:color-mix(in oklab,var(--tenant-primary,var(--primary)) 88%,black);` +
      `--ring:color-mix(in oklab,var(--tenant-primary,var(--ring)) 88%,black);` +
      `--accent:color-mix(in oklab,var(--tenant-accent,var(--accent)) 88%,black);` +
      `--gradient-brand:var(--tenant-gradient,var(--gradient-brand));` +
      `--gradient-brand-foreground:var(--tenant-on-brand,var(--gradient-brand-foreground));` +
      // A neon halo on white reads as a smudge — globals.css:310 makes the same
      // point and swaps the glow for a lift. Mirrored here.
      `--shadow-glow:0 8px 24px color-mix(in oklab,var(--tenant-primary,transparent) 25%,transparent);` +
      `}`,
  ].join('');
}

/**
 * A colour from tenant jsonb, or null.
 *
 * Exported so anywhere else that interpolates a tenant colour into markup —
 * the email template, notably — runs it through the same allowlist rather
 * than inventing a second, weaker check.
 */
export function safeColour(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return COLOUR.test(trimmed) ? trimmed : null;
}

/**
 * The wordmark to render beside the logo.
 *
 * Falls back to the tenant's own name rather than to "TropicalTalent": a white-label
 * whose branding row is half-filled should show its own name, not ours.
 */
export function wordmark(tenant: Tenant): string {
  const w = tenant.branding?.wordmark;
  return typeof w === 'string' && w.trim() ? w.trim() : tenant.name;
}
