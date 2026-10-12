// A free local pass for the judge-run CLI: before paying for a judge call on a
// number or money value, look for the value in the page's visible text in any
// common rendering. The judge sees only a screenshot tile; campaign 2 (2026-10-12)
// lost values it could have confirmed from the text — "910" judged against
// "MYR 910", a 4.5 rating shown as stars, "1144" shown as "(1,144)".
//
// Pure: no I/O. A miss means "ask the judge", never "wrong".

const NUMERIC_TYPES = new Set(['number', 'money']);
/** Thousands separators seen on product pages (after nbsp/narrow nbsp become spaces). */
const THOUSANDS = [',', '.', ' ', "'", '’'];
const DECIMAL_MARKS = ['.', ','];
/** Name words shorter than this, and these, carry no signal for the adjacency rule. */
const MIN_NAME_WORD = 3;
const STOP_WORDS = new Set(['the', 'and', 'for', 'of', 'per', 'number', 'count', 'total', 'amount', 'value']);

/** A stored value as a finite number, or null. Strings are read leniently ("$1,144.00", "4,5"). */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = value.match(/-?\d[\d.,\s' ]*/);
  if (!m) return null;
  let s = m[0].replace(/[\s' ]/g, '').replace(/[.,]$/, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later one is the decimal mark.
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // Comma only: "1,144" (groups of three) is thousands, "4,5" is a decimal.
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function groupThousands(int: string, sep: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every common rendering of `n`: decimal mark `.`/`,`, with or without thousands separators, 0–2 decimals. */
export function numberRenderings(n: number): string[] {
  const abs = Math.abs(n);
  const plain = String(abs).includes('e') ? abs.toFixed(2) : String(abs);
  const [intPart, fracRaw = ''] = plain.split('.') as [string, string?];
  const fracs = new Set<string>();
  if (fracRaw === '' || /^0+$/.test(fracRaw)) { fracs.add(''); fracs.add('0'); fracs.add('00'); }
  else {
    fracs.add(fracRaw);
    if (fracRaw.length === 1) fracs.add(`${fracRaw}0`);
    if (fracRaw.length > 2) fracs.add(abs.toFixed(2).split('.')[1]!);
  }
  const ints = new Map<string, string | null>([[intPart, null]]);
  if (intPart.length > 3) for (const sep of THOUSANDS) ints.set(groupThousands(intPart, sep), sep);
  const out = new Set<string>();
  for (const [int, sep] of ints) {
    for (const frac of fracs) {
      if (frac === '') { out.add(int); continue; }
      for (const mark of DECIMAL_MARKS) {
        if (mark === sep) continue; // "1,144,50" is not a rendering
        out.add(`${int}${mark}${frac}`);
      }
    }
  }
  return [...out];
}

function nameWords(fieldName: string): string[] {
  return fieldName.toLowerCase().split(/[^a-z]+/)
    .filter((w) => w.length >= MIN_NAME_WORD && !STOP_WORDS.has(w));
}

/** True when `word` and a name word share a stem: "reviews" ↔ "review", "ratings" ↔ "rating". */
function isNameWord(word: string, names: string[]): boolean {
  if (word.length < MIN_NAME_WORD) return false;
  return names.some((n) => word.startsWith(n) || n.startsWith(word));
}

/**
 * Whether `value` (a `number` or `money` field's value) appears in the page's
 * visible `text` as a whole token in any common rendering: `4.5` ↔ `4,5` ↔
 * `4.50`; `1144` ↔ `1,144`; `910` in "MYR 910"; `12` in "$12.00".
 *
 * A single-digit whole number (0–9) is everywhere on a page ("out of 5 stars",
 * "1 item in cart", a product code), so it counts only next to one of the
 * field's name words: "0 reviews", "rating: 4".
 */
export function numberShownInText(value: unknown, type: string, text: string, fieldName: string): boolean {
  if (!NUMERIC_TYPES.has(type)) return false;
  const n = toNumber(value);
  if (n == null || !text) return false;
  const page = text.toLowerCase().replace(/&nbsp;|&#160;|[   ]/g, ' ');
  const alternatives = numberRenderings(n).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  // Whole token: no digit (or digit + decimal mark) before it, no digit (or mark + digit) after it.
  const re = new RegExp(`(?<!\\d)(?<!\\d[.,])(?:${alternatives})(?!\\d)(?![.,]\\d)`, 'g');
  const needsName = Number.isInteger(n) && Math.abs(n) < 10;
  const names = needsName ? nameWords(fieldName) : [];
  if (needsName && names.length === 0) return false;
  for (const m of page.matchAll(re)) {
    if (!needsName) return true;
    const at = m.index ?? 0;
    const before = page.slice(Math.max(0, at - 40), at);
    const after = page.slice(at + m[0].length, at + m[0].length + 40);
    // The word right before ("rating 0", "reviews: 0") or right after ("0 reviews", "(0 ratings)").
    const prev = before.match(/([a-z]+)[\s:()-]{0,3}$/)?.[1];
    const next = after.match(/^[\s:()-]{0,3}([a-z]+)/)?.[1];
    if ((prev && isNameWord(prev, names)) || (next && isNameWord(next, names))) return true;
  }
  return false;
}
