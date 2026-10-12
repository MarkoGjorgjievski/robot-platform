// A free local pass for the judge-run CLI: before paying for a judge call, look
// for the value in the page's visible text. The judge sees only a screenshot
// tile; campaign 2 (2026-10-12) lost values it could have confirmed from the
// text — a 4.5 rating shown as stars, "1144" shown as "(1,144) reviews",
// descriptions folded behind "read more".
//
// A local "correct" is never checked by anyone, so it must be hard to earn:
// - money never settles here (compare-at prices, shipping thresholds,
//   instalments and other variants' prices all carry currency context); it
//   goes to the judge with a text excerpt around the value;
// - a number settles only with one of the field's words right beside it
//   ("1,144 reviews", "rating: 4.5") or a rating suffix right after it
//   ("4.5 out of 5", "4.5/5", "4.5 stars", "4.5 ★");
// - a long text (not a product name or brand) settles only when its first 80
//   characters occur exactly once in the page text.
//
// Pure: no I/O. A miss means "ask the judge", never "wrong".

/** Thousands separators seen on product pages: `,` `.` space, no-break space, narrow no-break space, apostrophe, right single quote. */
const THOUSANDS = [',', '.', ' ', ' ', ' ', "'", '’'];
/** The same set as a regex character class, for the whole-token guards. */
const SEP_CLASS = `[,. \\u00a0\\u202f'\\u2019]`;
const DECIMAL_MARKS = ['.', ','];
/** Name words shorter than this, and these, carry no signal. */
const MIN_NAME_WORD = 3;
const STOP_WORDS = new Set(['the', 'and', 'for', 'of', 'per', 'number', 'count', 'total', 'amount', 'value']);
/** A field word settles a number when it is this close (characters), with only spaces, colons, brackets or dashes between. */
const NAME_GAP = 15;
/** A single digit (0–9) needs its field word closer still. */
const SMALL_NAME_GAP = 3;
/** A rating suffix settles a number when it starts this close after it. */
const RATING_GAP = 5;
/** What may stand between a number and its field word: no other word, no other number, no "·" or "|". */
const GAP_CHARS = `[\\s:()\\[\\]-]`;
/** How much text either side of a match is looked at (the gap plus a long word). */
const CONTEXT_CHARS = 60;
const RATING_AFTER =new RegExp(`^${GAP_CHARS}{0,${RATING_GAP}}(?:/\\s?5(?!\\d)|out of 5(?!\\d)|stars?(?![a-z])|★)`);
/** Long text: a `text` value longer than this settles (and is judged) on its first PREFIX_CHARS characters. */
export const PREFIX_CHARS = 80;
/** Concepts whose text is repeated across a page (breadcrumbs, related products) — never settled locally. */
const NO_TEXT_PASS_CONCEPTS = new Set(['product_name', 'brand']);
/** Page text sent to the judge: a window this wide around the value, else the first START_CHARS. */
export const EXCERPT_CHARS = 4_000;
export const START_CHARS = 8_000;

/** A stored value as a finite number, or null. Strings are read leniently ("1,144", "4,5", "4.5 stars"). */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = value.match(/-?\d[\d.,\s'  ’]*/);
  if (!m) return null;
  let s = m[0].replace(/[\s'  ’]/g, '').replace(/[.,]$/, '');
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

/** A value the number pass can settle: one non-negative number ("12-15", "12 x 3" and "-4" are refused). */
function singleNonNegative(value: unknown): number | null {
  if (typeof value === 'string') {
    const numbers = value.match(/\d+(?:[.,\s'  ’]\d+)*/g) ?? [];
    if (numbers.length !== 1 || /-\s*\d/.test(value)) return null;
  }
  const n = toNumber(value);
  return n != null && n >= 0 ? n : null;
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

/** Lower-cased, one character for one, so an index into it is an index into `text`. */
function lowerPage(text: string): string {
  return text.toLowerCase();
}

/**
 * Whole-token matches of any rendering of `n` in `page` (already lower-cased).
 * Whole token: no digit, and no digit followed by a decimal mark or thousands
 * separator, on either side — so 299 is not found in "1 299 €" or "CHF 1'299.00",
 * nor 144 in "1 144 reviews".
 */
function* numberMatches(n: number, page: string): Generator<{ at: number; end: number }> {
  const alternatives = numberRenderings(n).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const re = new RegExp(`(?<!\\d)(?<!\\d${SEP_CLASS})(?:${alternatives})(?!\\d)(?!${SEP_CLASS}\\d)`, 'g');
  for (const m of page.matchAll(re)) {
    const at = m.index ?? 0;
    yield { at, end: at + m[0].length };
  }
}

/**
 * Whether a `number` field's `value` is shown in the page's visible `text` as
 * THIS field's value: a whole-token rendering (`4.5` ↔ `4,5` ↔ `4.50`; `1144`
 * ↔ `1,144`) with one of the field's words beside it — within 15 characters
 * on one side, with only spaces, colons, brackets or dashes between
 * ("(1,144) reviews", "rating: 4.5") — or followed within 5 characters by a
 * rating suffix (`/5`, `/ 5`, `out of 5`, `stars`, `star`, `★`). A single
 * digit (0–9) needs its word within 3 characters. Money never settles here;
 * neither do negative numbers or values holding two numbers ("12-15").
 */
export function numberShownInText(value: unknown, type: string, text: string, fieldName: string): boolean {
  if (type !== 'number') return false;
  const n = singleNonNegative(value);
  if (n == null || !text) return false;
  const page = lowerPage(text);
  const names = nameWords(fieldName);
  const small = Number.isInteger(n) && n < 10;
  const gap = small ? SMALL_NAME_GAP : NAME_GAP;
  const wordBefore = new RegExp(`([a-z]+)${GAP_CHARS}{0,${gap}}$`);
  const wordAfter = new RegExp(`^${GAP_CHARS}{0,${gap}}([a-z]+)`);
  for (const { at, end } of numberMatches(n, page)) {
    const before = page.slice(Math.max(0, at - CONTEXT_CHARS), at);
    const after = page.slice(end, end + CONTEXT_CHARS);
    const prev = before.match(wordBefore)?.[1];
    const next = after.match(wordAfter)?.[1];
    if ((prev && isNameWord(prev, names)) || (next && isNameWord(next, names))) return true;
    if (!small && RATING_AFTER.test(after)) return true;
  }
  return false;
}

/** Text compared for the long-text pass: NFKC, common entities decoded, whitespace collapsed, lower-cased. */
export function normaliseText(s: string): string {
  return s.normalize('NFKC')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True for a `text` value longer than PREFIX_CHARS: judged (and settled) on its first PREFIX_CHARS characters. */
export function isLongText(value: unknown, type: string | undefined): value is string {
  return type === 'text' && typeof value === 'string' && value.length > PREFIX_CHARS;
}

/**
 * Whether a long `text` value's first 80 characters (normalised both sides)
 * occur EXACTLY once in the FULL page text. Boilerplate repeats, a wrong value
 * is absent; short text and product names / brands (`concept`) never settle here.
 */
export function textPrefixInText(value: unknown, type: string, fullText: string, concept?: string): boolean {
  if (!isLongText(value, type) || !fullText) return false;
  if (concept && NO_TEXT_PASS_CONCEPTS.has(concept)) return false;
  const prefix = normaliseText(value).slice(0, PREFIX_CHARS).trim();
  if (prefix.length === 0) return false;
  const page = normaliseText(fullText);
  const first = page.indexOf(prefix);
  return first >= 0 && page.indexOf(prefix, first + 1) === -1;
}

export type PageTextForJudge = { text: string; kind: 'excerpt' | 'start' };

/**
 * The page text sent to the judge beside the screenshot: a window of 4,000
 * characters centred on the value (or a long text's first 80 characters) when
 * it is found in the full text, otherwise the first 8,000 characters.
 */
export function pageTextForJudge(value: unknown, type: string | undefined, fullText: string): PageTextForJudge {
  const page = lowerPage(fullText);
  let at = -1;
  let len = 0;
  if (type === 'number' || type === 'money') {
    const n = toNumber(value);
    const first = n == null ? undefined : numberMatches(n, page).next().value;
    if (first) { at = first.at; len = first.end - first.at; }
  } else if (typeof value === 'string' || typeof value === 'number') {
    const s = String(value);
    const needle = (s.length > PREFIX_CHARS ? s.slice(0, PREFIX_CHARS) : s).toLowerCase().replace(/\s+/g, ' ').trim();
    if (needle) { at = page.indexOf(needle); len = needle.length; }
  }
  if (at < 0) return { text: fullText.slice(0, START_CHARS), kind: 'start' };
  const centre = at + Math.floor(len / 2);
  const end = Math.min(fullText.length, Math.max(0, centre - EXCERPT_CHARS / 2) + EXCERPT_CHARS);
  const start = Math.max(0, end - EXCERPT_CHARS);
  return { text: fullText.slice(start, end), kind: 'excerpt' };
}
