/**
 * Design tokens as data: the palette and type scale, plus a WCAG contrast
 * proof (see tokens.test.ts) that every text/background pairing the app
 * actually uses meets 4.5:1. See styles.css for how these become Tailwind
 * theme values and utilities.
 */

export const palette = {
  paper: '#f3f4f1',
  surface: '#fbfbf9',
  paperDark: '#e9ebe5',
  ink: '#1c1f1a',
  inkSoft: '#5f665c',
  rule: '#d5d9d1',
  ruleSoft: '#e1e4de',
  accent: '#1f5e4a',
  accentHover: '#174a3a',
  accentTint: '#e8f2ea',
  pass: '#1f7a4d',
  passTint: '#eaf4ee',
  fail: '#a13a2a',
  failTint: '#f6e6e3',
  warn: '#8a5a12',
  warnTint: '#f5ecdc',
  // Darkened from the spec's #7a8077 to #666c63 — minimally, in 1-unit RGB
  // steps — because #7a8077 on changedTint only reaches 3.42:1 (spec 7
  // requires 4.5:1). #666c63 is the first step that clears the bar (4.55:1);
  // #676d64 (one step lighter) still falls short at 4.48:1. See tokens.test.ts.
  changed: '#666c63',
  changedTint: '#ebece8',
  // `--color-white` is remapped to surface in styles.css, so `text-white`
  // (btn-primary, the pass pill on the domain detail) is this colour, not #fff.
  white: '#fbfbf9',
} as const;

/**
 * Every text/background pairing the app actually renders, not just the
 * spec's token-on-its-own-tint list. The point of the test over this array is
 * that it fails when someone reaches for a colour on a background nobody
 * checked — a list that only re-proves the spec's own pairs can never do that.
 *
 * Read as: ink and ink-soft go anywhere (paper, surface, the strip's
 * paper-dark, and every tint); each status colour is used on paper, on
 * surface, and on its own tint; accent likewise; and `white` rides on the
 * filled accent/fail/pass buttons and pills.
 *
 * One pairing is deliberately absent: `changed` on `paperDark` measures
 * 4.49:1. The status strip's stage line used to render it (`text-gray-500` on
 * the strip); it is `text-gray-900` now. Do not put `changed`/`text-gray-500`
 * on the strip — use ink or ink-soft.
 */
export const textOnTint: Array<[text: keyof typeof palette, bg: keyof typeof palette]> = [
  // Ink and ink-soft, on every surface the app paints.
  ['ink', 'paper'],
  ['ink', 'surface'],
  ['ink', 'paperDark'],
  ['ink', 'passTint'],
  ['ink', 'failTint'],
  ['ink', 'warnTint'],
  ['ink', 'changedTint'],
  ['ink', 'accentTint'],
  ['inkSoft', 'paper'],
  ['inkSoft', 'surface'],
  ['inkSoft', 'paperDark'],
  ['inkSoft', 'passTint'],
  ['inkSoft', 'failTint'],
  ['inkSoft', 'warnTint'],
  ['inkSoft', 'changedTint'],
  ['inkSoft', 'accentTint'],
  // Each status colour: on the paper, on a sheet, and on its own tint.
  ['pass', 'paper'],
  ['pass', 'surface'],
  ['pass', 'passTint'],
  ['fail', 'paper'],
  ['fail', 'surface'],
  ['fail', 'failTint'],
  ['warn', 'paper'],
  ['warn', 'surface'],
  ['warn', 'warnTint'],
  ['changed', 'paper'],
  ['changed', 'surface'],
  ['changed', 'changedTint'],
  // Accent: links and quiet text on the paper, and its own tint.
  ['accent', 'paper'],
  ['accent', 'surface'],
  ['accent', 'accentTint'],
  // Filled controls: btn-primary (accent, and its destructive fail variant)
  // and the domain detail's confirmed-path pill.
  ['white', 'accent'],
  ['white', 'fail'],
  ['white', 'pass'],
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

export const scale = {
  title: [24, 1.2],
  section: [18, 1.25],
  body: [14, 1.5],
  table: [13, 1.45],
  secondary: [12, 1.4],
  cellLine: [11, 1.35],
} as const;
