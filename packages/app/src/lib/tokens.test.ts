import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATE_KEYS, SURFACE_KEYS, TEXT_COLOURS, THEMES, contrastRatio, type ThemeName } from './tokens';

const themeNames = Object.keys(THEMES) as ThemeName[];

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3ddc84', '#3ddc84')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#0a0a0a', '#ededed')).toBeCloseTo(contrastRatio('#ededed', '#0a0a0a'), 10);
  });
});

/**
 * The contract, with no escape hatch: anything allowed to carry text is legible
 * on every surface the app paints, in both themes. Table rows raise to `raised`
 * on hover, so that surface counts as much as the background does.
 */
describe.each(themeNames)('%s theme: every text colour on every surface', (name) => {
  const t = THEMES[name];

  for (const colour of TEXT_COLOURS) {
    for (const surface of SURFACE_KEYS) {
      it(`${colour} on ${surface} clears 4.5:1`, () => {
        expect(contrastRatio(t[colour], t[surface])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('the text-colour list', () => {
  it('excludes muted, which is a divider/disabled/placeholder colour, not text', () => {
    expect(TEXT_COLOURS).not.toContain('muted');
  });

  it('is right to exclude it: muted misses 4.5:1 on every surface, in both themes', () => {
    for (const name of themeNames) {
      for (const surface of SURFACE_KEYS) {
        expect(contrastRatio(THEMES[name].muted, THEMES[name][surface])).toBeLessThan(4.5);
      }
    }
  });

});

describe.each(themeNames)('%s theme state colours', (name) => {
  const t = THEMES[name];

  it.each(STATE_KEYS)('the %s state colour clears 3:1 on the background', (key) => {
    // Dots, 2 px rails and badge borders — non-text, so 3:1 is the bar.
    expect(contrastRatio(t[key], t.bg)).toBeGreaterThanOrEqual(3);
  });

  it.each(STATE_KEYS)('the %s state colour clears 3:1 on a panel', (key) => {
    expect(contrastRatio(t[key], t.panel)).toBeGreaterThanOrEqual(3);
  });

  it('the primary button (bg-on-text) is legible both ways round', () => {
    // The primary button is `text` filled with `bg` lettering: white on black in
    // dark, black on white in light. Same pair as body text, asserted explicitly
    // because it is a different component.
    expect(contrastRatio(t.bg, t.text)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tokens.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8');

  const cssVar: Record<keyof (typeof THEMES)['dark'], string> = {
    bg: '--bg',
    panel: '--panel',
    raised: '--raised',
    border: '--border',
    borderHover: '--border-hover',
    text: '--text',
    secondary: '--secondary',
    muted: '--muted',
    pass: '--pass',
    fail: '--fail',
    warn: '--warn',
    link: '--link',
  };

  it.each(themeNames)('declares every %s value exactly as THEMES has it', (name) => {
    const block = new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([\\s\\S]*?)\\}`).exec(css)?.[1];
    expect(block, `no :root[data-theme="${name}"] block in tokens.css`).toBeTruthy();
    for (const [key, variable] of Object.entries(cssVar)) {
      const declared = new RegExp(`${variable}\\s*:\\s*([^;]+);`).exec(block!)?.[1]?.trim();
      expect(declared, `${variable} missing from the ${name} block`).toBe(
        THEMES[name][key as keyof (typeof THEMES)['dark']]
      );
    }
  });
});
