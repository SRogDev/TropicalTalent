import { describe, expect, test } from 'bun:test';
import { safeColour, themeCss, wordmark } from './theme';
import type { Tenant } from './types';

/**
 * themeCss builds a string that is injected into a <style> tag from data any
 * tenant admin can edit. That makes it the one place in the app where a
 * database value becomes executable-ish content, so it gets the only test
 * suite in the repo.
 *
 * `bun test` is already wired up in package.json (--passWithNoTests); this is
 * the first thing worth pointing it at.
 */

const tenant = (overrides: Partial<Tenant> = {}): Tenant => ({
  id: 't1',
  slug: 'acme',
  name: 'Acme',
  isClassic: false,
  status: 'active',
  visibility: 'private',
  archetype: 'contractors_brands',
  theme: {},
  branding: {},
  features: {},
  platformFeePct: 15,
  partnerSharePct: 0,
  ...overrides,
});

describe('themeCss — output', () => {
  test('classic tenant emits nothing', () => {
    expect(themeCss(tenant({ isClassic: true, theme: { primary: '#ff0000' } }))).toBe('');
  });

  test('a tenant with no palette emits nothing', () => {
    expect(themeCss(tenant())).toBe('');
  });

  test('a valid primary reaches the token and both theme blocks', () => {
    const css = themeCss(tenant({ theme: { primary: 'oklch(0.62 0.19 145)' } }));
    expect(css).toContain('--tenant-primary:oklch(0.62 0.19 145)');
    expect(css).toContain('.tropical{');
    expect(css).toContain(':root:not(.dark) .tropical{');
    // The light block derives a darker variant rather than reusing the value.
    expect(css).toContain('color-mix(in oklab,var(--tenant-primary');
  });

  test('a two-stop gradient becomes a linear-gradient', () => {
    const css = themeCss(tenant({ theme: { gradient: ['#112233', '#445566'] } }));
    expect(css).toContain('--tenant-gradient:linear-gradient(135deg,#112233,#445566)');
  });

  test('a single stop is not a gradient', () => {
    expect(themeCss(tenant({ theme: { gradient: ['#112233'] } }))).toBe('');
  });

  test('only registered fonts are emitted', () => {
    expect(themeCss(tenant({ theme: { font: 'inter', primary: '#123456' } }))).toContain(
      '--tenant-font:var(--font-inter)',
    );

    // An unregistered font must never be DEFINED. The mapping block still
    // references `var(--tenant-font, var(--font-inter))` either way — that
    // reference is the fallback that makes an undefined token resolve to
    // Inter, so asserting on the bare name would be asserting the fallback
    // away. The definition is what matters.
    expect(themeCss(tenant({ theme: { font: 'Comic Sans', primary: '#123456' } }))).not.toContain(
      '--tenant-font:',
    );
  });
});

describe('themeCss — injection', () => {
  // Each of these is a value someone could put in the tenants row. None may
  // appear in the output, and none may add a declaration or a selector.
  const attacks: Array<[string, string]> = [
    ['closes the declaration', 'red;}body{display:none'],
    ['adds a second property', 'red;background:url(https://evil.test/x)'],
    ['smuggles a url', 'url(https://evil.test/x)'],
    ['opens a comment', 'red/*'],
    ['closes the style tag', '</style><script>alert(1)</script>'],
    ['expression', 'expression(alert(1))'],
    ['nested function', 'rgb(var(--x),url(https://evil.test))'],
    ['import', '@import "https://evil.test/x.css"'],
  ];

  for (const [label, value] of attacks) {
    test(`rejects a value that ${label}`, () => {
      const css = themeCss(tenant({ theme: { primary: value } }));
      // Either nothing at all, or a block that never contains the payload.
      expect(css).not.toContain('evil.test');
      expect(css).not.toContain('</style');
      expect(css).not.toContain('@import');
      expect(css).not.toContain('display:none');
      expect(css).not.toContain(value);
    });
  }

  test('a rejected value leaves the rest of a palette usable', () => {
    const css = themeCss(
      tenant({ theme: { primary: 'red;}body{display:none', accent: '#00ff00' } }),
    );
    expect(css).toContain('--tenant-accent:#00ff00');
    expect(css).not.toContain('display:none');
  });

  test('gradient stops are filtered individually', () => {
    const css = themeCss(
      tenant({ theme: { gradient: ['#112233', 'url(https://evil.test)', '#445566'] } }),
    );
    expect(css).not.toContain('evil.test');
    expect(css).toContain('linear-gradient(135deg,#112233,#445566)');
  });

  test('a gradient is capped so a huge array cannot bloat every response', () => {
    const css = themeCss(tenant({ theme: { gradient: Array(50).fill('#112233') } }));

    // Count the stops inside the declaration rather than occurrences across the
    // whole string: the declaration block is emitted twice, once at :root for
    // the auth screens and once at .tropical for the shell, so a global count
    // measures how many scopes there are and not how many stops there are.
    const decl = css.match(/--tenant-gradient:linear-gradient\(135deg,([^)]*)\)/);
    expect(decl).not.toBeNull();
    expect(decl![1].split(',').length).toBeLessThanOrEqual(4);
  });
});

describe('themeCss — the page background', () => {
  /**
   * --gradient-bg is the pair of radial ellipses `.tropical` paints behind the
   * whole signed-in app. It was hardcoded to TropicalTalent's violet and orange in both
   * themes and nothing overrode it, so a white-label with a green brand got
   * green buttons sitting on TropicalTalent's background — the largest coloured area on
   * the screen, and the last thing still saying "TropicalTalent" after everything else
   * was themed.
   */
  test('a tenant primary re-hues the wash in both themes', () => {
    const css = themeCss(tenant({ theme: { primary: 'oklch(0.62 0.19 145)' } }));

    // Once under `.tropical` (dark) and once under `:root:not(.dark) .tropical`.
    expect(css.match(/--gradient-bg:/g)).toHaveLength(2);
    expect(css).toContain('var(--tenant-primary,var(--tenant-accent))');
  });

  test('the light wash is fainter than the dark one', () => {
    const css = themeCss(tenant({ theme: { primary: '#00ff88' } }));

    const dark = css.slice(css.indexOf('.tropical{--gradient-bg'));
    const light = css.slice(css.indexOf(':root:not(.dark) .tropical{'));

    // A brand colour that reads as a tint on obsidian reads as a stain on
    // near-white, so the light block mixes in less of it.
    expect(dark).toContain('32%');
    expect(light).toContain('20%');
  });

  test('accent alone is enough to re-hue it', () => {
    expect(themeCss(tenant({ theme: { accent: '#00ff88' } }))).toContain('--gradient-bg:');
  });

  test('a gradient-only tenant keeps the TropicalTalent wash rather than a blank one', () => {
    // Two transparent ellipses would be worse than the default: a flat
    // background nobody chose, on every screen.
    const css = themeCss(tenant({ theme: { gradient: ['#112233', '#445566'] } }));
    expect(css).toContain('--tenant-gradient:');
    expect(css).not.toContain('--gradient-bg:');
  });
});

describe('themeCss — the label on the gradient', () => {
  /**
   * `text-on-brand` reads --gradient-brand-foreground. The .tropical blocks map
   * it, but the auth screens sit outside the shell — so before this the token
   * fell through to its near-white default there and a tenant with a pale
   * gradient could set the colour and watch the sign-in button ignore it.
   */
  test('reaches :root so the auth screens honour it', () => {
    const css = themeCss(tenant({ theme: { primary: '#00ff88', gradientForeground: '#0b0b0b' } }));
    const root = css.slice(css.indexOf(':root{'), css.indexOf('.tropical{'));

    expect(root).toContain('--tenant-on-brand:#0b0b0b');
    expect(root).toContain('--gradient-brand-foreground:#0b0b0b');
  });

  test('is absent when the tenant sets no label colour', () => {
    const css = themeCss(tenant({ theme: { primary: '#00ff88' } }));
    const root = css.slice(css.indexOf(':root{'), css.indexOf('.tropical{'));
    expect(root).not.toContain('--gradient-brand-foreground');
  });

  test('a rejected value does not reach the stylesheet', () => {
    const css = themeCss(tenant({ theme: { primary: '#00ff88', gradientForeground: 'red;}' } }));
    const root = css.slice(css.indexOf(':root{'), css.indexOf('.tropical{'));

    // Nothing of the input survives anywhere...
    expect(css).not.toContain('red');
    // ...and the root mapping is not emitted at all, so the token keeps its
    // near-white default. The .tropical blocks below still map it — they do that
    // unconditionally, falling back through var() — so this asserts on the root
    // block rather than the whole sheet.
    expect(root).not.toContain('--gradient-brand-foreground');
  });
});

describe('safeColour', () => {
  test('accepts the syntaxes the palette uses', () => {
    for (const v of ['#fff', '#ffffff', '#ffffffff', 'oklch(0.6 0.2 145)', 'rgb(1,2,3)']) {
      expect(safeColour(v)).toBe(v);
    }
  });

  test('rejects everything else', () => {
    for (const v of ['red', 'url(x)', 'a;b', '', null, undefined, 42, {}]) {
      expect(safeColour(v)).toBeNull();
    }
  });
});

describe('wordmark', () => {
  test('prefers the configured wordmark', () => {
    expect(wordmark(tenant({ branding: { wordmark: 'ACME CO' } }))).toBe('ACME CO');
  });

  test('falls back to the tenant name, never to TropicalTalent', () => {
    expect(wordmark(tenant())).toBe('Acme');
    expect(wordmark(tenant({ branding: { wordmark: '   ' } }))).toBe('Acme');
  });
});
