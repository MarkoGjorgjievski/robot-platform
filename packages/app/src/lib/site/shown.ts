// Is a typed Verify value shown on its proof page? (spec 2026-10-12 Part B,
// rule B2, reusing §3's check). The app cannot import `@robot/scraper` (that
// package graph reaches Playwright, the database and the Anthropic SDK, none
// of which may enter a browser bundle), so this mirrors
// `packages/scraper/src/verify/shown-on-page.ts`'s normalisation and number
// renderings in miniature. Keep the two in step by the same test cases.
import type { FieldType } from '../fields-view';
import type { Answer, Field } from './verification-model';

const PREFIX = 80;
/** Types the §3 rule does not check: availability words, dates and links/images vary too much to pin down. */
const UNCHECKED_TYPES: ReadonlySet<FieldType> = new Set(['url', 'image', 'boolean', 'date']);

// A literal "&nbsp;" (common in serialized markup) and a real U+00A0 (common
// in rendered text) must normalise to the same plain space, or neither a
// typed value nor the page text would compare as the same token.
function decodeNbsp(s: string): string {
  return s.replace(/&nbsp;/gi, ' ').replace(/ /g, ' ');
}

export function normText(v: unknown): string {
  return decodeNbsp(String(v ?? '').normalize('NFKC')).replace(/\s+/g, ' ').trim().toLowerCase();
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

export function numberShown(value: unknown, text: string, fieldWords: string[]): boolean {
  const raw = String(value ?? '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || raw === '') return false;
  if (n === 0) {
    // A bare 0 proves nothing (Decathlon's rating fallback): only next to the field's own words.
    const words = fieldWords.map(escape).join('|');
    return words.length > 0 && new RegExp(`(?:${words})\\s*[:]?\\s*0(?!\\d)|(?<!\\d)0\\s*(?:${words})`).test(text);
  }
  return renderings(Math.abs(n)).some((r) => new RegExp(`(?<![\\d.,])${escape(r)}(?!\\w)(?![.,]\\d)`).test(text));
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
