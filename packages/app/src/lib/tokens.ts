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
