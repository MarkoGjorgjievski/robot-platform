// Is a typed Verify value shown on its proof page? (spec 2026-10-12 Part B,
// rule B2, reusing §3's check). The text form is the shared, import-free
// `@robot/scraper/shown-text` rule. Otherwise the app cannot import
// `@robot/scraper` (that package graph reaches Playwright, the database and
// the Anthropic SDK, none of which may enter a browser bundle), so this
// mirrors `packages/scraper/src/verify/shown-on-page.ts`'s number renderings
// in miniature. Keep the two in step by the same test cases.
import { shownKey } from '@robot/scraper/shown-text';
import type { FieldType } from '../fields-view';
import type { Answer, Field } from './verification-model';

const PREFIX = 80;
/**
 * Types the §3 rule does not check: availability words, dates and links/images
 * vary too much to pin down, and a list is rarely printed the way it is typed
 * or stored (final review I1; the scraper's `UNCHECKED` agrees).
 */
const UNCHECKED_TYPES: ReadonlySet<FieldType> = new Set(['url', 'image', 'boolean', 'date', 'text_list']);

// A literal "&nbsp;" (common in serialized markup) and a real U+00A0 (common
// in rendered text) must normalise to the same plain space, or neither a
// typed value nor the page text would compare as the same token.
function decodeNbsp(s: string): string {
  return s.replace(/&nbsp;/gi, ' ').replace(/ /g, ' ');
}

/** The scraper's `pageTextOf` form (`shownKey`): a symbol mark joined to its word, whitespace collapsed, NFKC, lower case. */
export function normText(v: unknown): string {
  return shownKey(decodeNbsp(String(v ?? '')));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/**
 * A typed value read as a number under either decimal mark: "1,299.99" and
 * "1.299,99" are both 1299.99; an ambiguous "1.299" or "1,299" reads as both
 * 1.299 and 1299, and either reading shown on the page counts (final review
 * M1). The app has a money validator (`validateValue`) but no normaliser, so
 * both conventions are tried. The scraper's `numberReadings` twin agrees.
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

export function numberShown(value: unknown, text: string, fieldWords: string[]): boolean {
  return numberReadings(value).some((n) => {
    if (n === 0) {
      // A bare 0 proves nothing (Decathlon's rating fallback): only next to the field's own words.
      const words = fieldWords.map(escape).join('|');
      return words.length > 0 && new RegExp(`(?:${words})\\s*[:]?\\s*0(?!\\d)|(?<!\\d)0\\s*(?:${words})`).test(text);
    }
    return renderings(Math.abs(n)).some((r) => new RegExp(`(?<![\\d.,])${escape(r)}(?!\\w)(?![.,]\\d)`).test(text));
  });
}

export function textShown(value: string, text: string): boolean {
  const v = normText(value);
  if (v === '') return false;
  const needle = v.length > PREFIX ? v.slice(0, PREFIX) : v;
  return text.includes(needle);
}

/**
 * A typed expected value (no mark, no path) the proof page's stored text does
 * not show (spec B2). `pageText` is already lower-cased/NFKC-normalised by
 * the server (`suggestMarks`'s `pageText`, from `@robot/scraper`'s
 * `pageTextOf`); an empty `pageText` (a page not yet captured) never warns.
 */
export function typedNotShown(field: Field, answer: Answer | undefined, pageText: string): boolean {
  if (!answer || answer.absent || answer.mark !== null || answer.via) return false;
  if (UNCHECKED_TYPES.has(field.type)) return false;
  if (!pageText) return false;
  if (field.type === 'number' || field.type === 'money') {
    const concept = field.concept ?? '';
    const words = [field.key, concept, ...concept.split(/[_\s]+/)].map(normText).filter(Boolean);
    return !numberShown(answer.value, pageText, words);
  }
  return !textShown(answer.value, pageText);
}

/**
 * A default no captured proof page shows (spec 2026-10-13 §6): the §B2 check
 * against every page with text, true only when all of them lack it. Inert
 * with no captured text, a blank value, or a type the check never reads.
 */
export function defaultNotShown(field: Field, value: string, pageTexts: string[]): boolean {
  const v = value.trim();
  if (!v) return false;
  const texts = pageTexts.filter(Boolean);
  if (texts.length === 0) return false;
  return texts.every((t) => typedNotShown(field, { value: v, mark: null }, t));
}
