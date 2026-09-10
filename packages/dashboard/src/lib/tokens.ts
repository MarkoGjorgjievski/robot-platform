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
} as const;

export const textOnTint: Array<[text: keyof typeof palette, bg: keyof typeof palette]> = [
  ['ink', 'paper'],
  ['ink', 'surface'],
  ['ink', 'paperDark'],
  ['inkSoft', 'paper'],
  ['inkSoft', 'surface'],
  ['inkSoft', 'paperDark'],
  ['ink', 'passTint'],
  ['pass', 'passTint'],
  ['ink', 'failTint'],
  ['fail', 'failTint'],
  ['ink', 'warnTint'],
  ['warn', 'warnTint'],
  ['ink', 'changedTint'],
  ['changed', 'changedTint'],
  ['accent', 'paper'],
  ['accent', 'surface'],
  ['accent', 'accentTint'],
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
