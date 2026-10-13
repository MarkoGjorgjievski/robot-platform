// Is a certified value shown on the product's rendered page? (spec 2026-10-12 §3)
// Pure and free: the capture's visible text is in memory at extraction time.
import type { CertifiedPath, CustomerFieldType } from './types.js';
import { visibleTextFromHtml } from '../corroborate-value.js';

export type Shown = boolean | null;
const PREFIX = 80;
// `text_list` too: its rendered value is sorted, de-duplicated and joined, a
// form the page almost never prints, so a substring check would flag nearly
// every multi-item list (final review I1). The app's `UNCHECKED_TYPES` agrees.
const UNCHECKED: ReadonlySet<string> = new Set(['url', 'image', 'boolean', 'date', 'text_list']);

// `visibleTextFromHtml` strips tags but does not decode entities, so a literal
// "&nbsp;" (common in serialized markup) survives alongside a real U+00A0
// (common in captured text nodes) — both are decoded to a plain space before
// whitespace collapse, or neither "Hello&nbsp;  World" nor "Hello World"
// would normalise to the same token as the page's own rendering.
function decodeNbsp(s: string): string {
  return s.replace(/&nbsp;/gi, ' ').replace(/ /g, ' ');
}

export function pageTextOf(html: string): string {
  return decodeNbsp(visibleTextFromHtml(html).normalize('NFKC')).replace(/\s+/g, ' ').trim().toLowerCase();
}

function normText(v: unknown): string {
  return decodeNbsp(String(v ?? '').normalize('NFKC')).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every common rendering of a number: decimal mark `.` or `,`, with or without thousands separators, one or two decimals. */
function renderings(n: number): string[] {
  const out = new Set<string>();
  const fixed = (d: number) => n.toFixed(d);
  for (const s of [String(n), fixed(1), fixed(2)]) {
    out.add(s); out.add(s.replace('.', ','));
    const [int, frac] = s.split('.');
    const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    out.add(frac ? `${grouped}.${frac}` : grouped);
    out.add(frac ? `${grouped.replace(/,/g, '.')},${frac}` : grouped.replace(/,/g, '.'));
  }
  if (Number.isInteger(n)) out.add(String(n));
  return [...out];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A value read as a number under either decimal mark: "1,299.99" and
 * "1.299,99" are both 1299.99; an ambiguous "1.299" or "1,299" reads as both
 * 1.299 and 1299, and either reading shown on the page counts (final review
 * M1). A canonical `Number` reads as itself. The app's `shown.ts` twin agrees.
 */
export function numberReadings(value: unknown): number[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  const raw = String(value ?? '').replace(/[^\d.,-]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  const out = new Set<number>();
  for (const [g, d] of [[',', '.'], ['.', ',']] as const) {
    if (!new RegExp(`^-?(?:\\d{1,3}(?:${escape(g)}\\d{3})+|\\d+)(?:${escape(d)}\\d+)?$`).test(raw)) continue;
    const n = Number(raw.split(g).join('').replace(d, '.'));
    if (Number.isFinite(n)) out.add(n);
  }
  return [...out];
}

export function numberShownInText(value: unknown, type: 'number' | 'money', text: string, fieldWords: string[]): boolean {
  return numberReadings(value).some((n) => {
    if (n === 0) {
      // A bare 0 proves nothing (Decathlon's rating fallback): only next to the field's own words.
      const words = fieldWords.map(escape).join('|');
      return words.length > 0 && new RegExp(`(?:${words})\\s*[:]?\\s*0(?!\\d)|(?<!\\d)0\\s*(?:${words})`).test(text);
    }
    // A rendering must stand as its own token: not glued to a digit on the left
    // (part of a longer integer like "1200"), and on the right neither glued to
    // a word character (an identifier like "sku-12x") nor the start of a longer
    // decimal ("12.5" must not read as containing "12").
    return renderings(Math.abs(n)).some((r) => new RegExp(`(?<![\\d.,])${escape(r)}(?!\\w)(?![.,]\\d)`).test(text));
  });
}

export function shownOnPage(field: { type: CustomerFieldType; key: string; concept: string }, path: CertifiedPath, value: unknown, pageText: string): Shown {
  if (UNCHECKED.has(field.type)) return null;
  if (path.source === 'xpath') return true;
  if (value === null || value === undefined || value === '') return null;
  if (field.type === 'number' || field.type === 'money') {
    return numberShownInText(value, field.type, pageText, [field.key, field.concept, ...field.concept.split(/[_\s]+/)].map(normText).filter(Boolean));
  }
  const v = normText(value);
  if (v === '') return null;
  const needle = v.length > PREFIX ? v.slice(0, PREFIX) : v;
  return pageText.includes(needle);
}
