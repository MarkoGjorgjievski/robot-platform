/**
 * The palette as data, so the contrast proof in tokens.test.ts can assert over
 * it. The values here are the single source of truth for the design's colour
 * ramp (spec 2026-09-21 §4); styles/tokens.css writes the same values as CSS
 * custom properties on `:root[data-theme]`. Keep the two in step — the test
 * `tokens.css matches THEMES` does exactly that.
 *
 * `contrastRatio` mirrors packages/dashboard/src/lib/tokens.ts.
 */

export type ThemeName = 'dark' | 'light';

export type Palette = {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  borderHover: string;
  text: string;
  secondary: string;
  /**
   * NOT A TEXT COLOUR. `muted` reaches 3.45:1 on the dark background and 2.58:1
   * on the light one — it cannot carry a word a person has to read. It is for
   * dividers, disabled states and placeholders only; the quietest legible text
   * in this system is `secondary`. `TEXT_COLOURS` deliberately excludes it and
   * tokens.test.ts asserts that exclusion, so putting a sentence in `muted`
   * means editing a test on purpose.
   */
  muted: string;
  pass: string;
  fail: string;
  warn: string;
  link: string;
};

export const THEMES: Record<ThemeName, Palette> = {
  dark: {
    bg: '#0a0a0a',
    panel: '#111111',
    raised: '#171717',
    border: '#262626',
    borderHover: '#333333',
    text: '#ededed',
    secondary: '#a1a1a1',
    muted: '#666666',
    pass: '#3ddc84',
    fail: '#ff5c5c',
    warn: '#f5a623',
    link: '#52a8ff',
  },
  light: {
    bg: '#ffffff',
    panel: '#fafafa',
    raised: '#f4f4f4',
    border: '#e5e5e5',
    borderHover: '#d4d4d4',
    text: '#171717',
    secondary: '#666666',
    muted: '#a1a1a1',
    pass: '#0f7b3d',
    fail: '#c62828',
    warn: '#b26a00',
    link: '#0b6bcb',
  },
};

/** The state colours, which appear as dots, 2 px rails and badges — never as text. */
export const STATE_KEYS = ['pass', 'fail', 'warn'] as const satisfies ReadonlyArray<keyof Palette>;

/** The surfaces text is ever set on. */
export const SURFACE_KEYS = ['bg', 'panel', 'raised'] as const satisfies ReadonlyArray<keyof Palette>;

/**
 * Every colour that is allowed to carry text, anywhere in the app. Each one is
 * held to 4.5:1 against every surface in `SURFACE_KEYS`, in both themes
 * (tokens.test.ts). `muted` is absent on purpose — see the field comment above.
 */
export const TEXT_COLOURS = [
  'text',
  'secondary',
  'link',
  'pass',
  'fail',
  'warn',
] as const satisfies ReadonlyArray<keyof Palette>;

/**
 * The one pairing in `TEXT_COLOURS` that does not clear 4.5:1 today. Light
 * `warn` (#b26a00) is a spec decision, not a typo, so it is recorded here with
 * its measured ratio rather than quietly darkened: the colour is fixed by
 * `2026-09-21-app-redesign-design.md` §4 and changing it belongs in that spec.
 *
 * Consequence until it is decided: **do not set text in `warn` in the light
 * theme.** Amber is a dot, a rail or a badge border there. The test below keeps
 * this list honest in both directions — an entry that starts passing must be
 * deleted, and a new failure cannot be added without editing this list.
 */
export const TEXT_CONTRAST_EXCEPTIONS: ReadonlyArray<{
  theme: ThemeName;
  colour: (typeof TEXT_COLOURS)[number];
  surface: (typeof SURFACE_KEYS)[number];
  ratio: number;
}> = [
  { theme: 'light', colour: 'warn', surface: 'bg', ratio: 4.24 },
  { theme: 'light', colour: 'warn', surface: 'panel', ratio: 4.06 },
  { theme: 'light', colour: 'warn', surface: 'raised', ratio: 3.85 },
];

/** sRGB hex channel (0-255) -> linearized channel per WCAG 2.x. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.x contrast ratio between two colors, order-independent. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
