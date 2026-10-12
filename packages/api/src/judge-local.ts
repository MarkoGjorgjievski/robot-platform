// A free local pass for the judge-run CLI: before paying for a judge call, look
// for the value in the page's visible text. The judge sees only a screenshot
// tile; campaign 2 (2026-10-12) lost values it could have confirmed from the
// text — "910" judged against "MYR 910", a 4.5 rating shown as stars, "1144"
// shown as "(1,144)", descriptions folded behind "read more".
//
// A local "correct" is never checked by anyone, so a match must carry context:
// a money value needs a currency sign/code beside it or decimals; a number
// needs a field word nearby, a rating suffix ("/5", "out of", "stars", "★") or
// decimals; a long text needs its first 80 characters verbatim. A bare whole
// number never settles; a short text never settles.
//
// Pure: no I/O. A miss means "ask the judge", never "wrong".

const NUMERIC_TYPES = new Set(['number', 'money']);
/** Thousands separators seen on product pages (after nbsp/narrow nbsp become spaces). */
const THOUSANDS = [',', '.', ' ', "'", '’'];
const DECIMAL_MARKS = ['.', ','];
/** Name words shorter than this, and these, carry no signal. */
const MIN_NAME_WORD = 3;
const STOP_WORDS = new Set(['the', 'and', 'for', 'of', 'per', 'number', 'count', 'total', 'amount', 'value']);
/** A number value settles when one of the field's words is this close (characters, either side). */
const NAME_WINDOW = 40;
/** A money value settles when a currency sign or code is this close (characters, either side). */
const CURRENCY_GAP = 3;
/** Long text: a `text` value longer than this settles on its first PREFIX_CHARS characters. */
export const PREFIX_CHARS = 80;
/** Page text sent to the judge: a window this wide around the value, else the first START_CHARS. */
export const EXCERPT_CHARS = 4_000;
export const START_CHARS = 8_000;

const CURRENCY_SIGNS = '$€£¥₹₩₽¢₺₪₫฿₱₦₴';
const CURRENCY_CODES = [
  'usd', 'eur', 'gbp', 'myr', 'aud', 'cad', 'nzd', 'sgd', 'hkd', 'jpy', 'cny', 'rmb', 'krw', 'inr', 'chf', 'sek', 'nok',
  'dkk', 'pln', 'czk', 'huf', 'ron', 'try', 'zar', 'brl', 'mxn', 'ars', 'clp', 'cop', 'php', 'idr', 'thb', 'vnd', 'aed',
  'sar', 'ils', 'twd', 'rm', 'kr', 'zł', 'zl', 'lei', 'rs',
];
const CODES_RE = CURRENCY_CODES.join('|');
const CURRENCY_BEFORE = new RegExp(`(?:[${CURRENCY_SIGNS}]|(?<![a-z])(?:${CODES_RE}))[^\\da-z]{0,${CURRENCY_GAP}}$`);
const CURRENCY_AFTER = new RegExp(`^[^\\da-z]{0,${CURRENCY_GAP}}(?:[${CURRENCY_SIGNS}]|(?:${CODES_RE})(?![a-z]))`);
const RATING_AFTER = /^\s*(?:\/\s*\d|out of|stars?\b|★)/;

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

type Rendering = { text: string; decimals: boolean };

function renderings(n: number): Rendering[] {
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
  const out = new Map<string, boolean>();
  for (const [int, sep] of ints) {
    for (const frac of fracs) {
      if (frac === '') { out.set(int, false); continue; }
      for (const mark of DECIMAL_MARKS) {
        if (mark === sep) continue; // "1,144,50" is not a rendering
        out.set(`${int}${mark}${frac}`, true);
      }
    }
  }
  return [...out].map(([text, decimals]) => ({ text, decimals }));
}

/** Every common rendering of `n`: decimal mark `.`/`,`, with or without thousands separators, 0–2 decimals. */
export function numberRenderings(n: number): string[] {
  return renderings(n).map((r) => r.text);
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

/** Lower-cased, non-breaking spaces as spaces; one character for one, so an index into it is an index into `text`. */
function lowerPage(text: string): string {
  return text.toLowerCase().replace(/[   ]/g, ' ');
}

/** Whole-token matches of any rendering of `n` in `page` (already lower-cased). */
function* numberMatches(n: number, page: string): Generator<{ at: number; end: number; decimals: boolean }> {
  const rs = renderings(n).sort((a, b) => b.text.length - a.text.length);
  const decimalsOf = new Map(rs.map((r) => [r.text, r.decimals]));
  // Whole token: no digit (or digit + decimal mark) before it, no digit (or mark + digit) after it.
  const re = new RegExp(`(?<!\\d)(?<!\\d[.,])(?:${rs.map((r) => escapeRe(r.text)).join('|')})(?!\\d)(?![.,]\\d)`, 'g');
  for (const m of page.matchAll(re)) {
    const at = m.index ?? 0;
    yield { at, end: at + m[0].length, decimals: decimalsOf.get(m[0]) ?? false };
  }
}

/**
 * Whether `value` (a `number` or `money` field's value) is shown in the page's
 * visible `text`, in any common rendering (`4.5` ↔ `4,5` ↔ `4.50`; `1144` ↔
 * `1,144`), as a whole token, with context:
 * - money: a currency sign or code within 3 characters (`$12.00`, `12€`,
 *   `MYR 910`, `12 eur`), or decimals (`12.00`);
 * - number: one of the field's words within 40 characters (`rating 4.5`,
 *   `(1,144) reviews`), a rating suffix (`/5`, `out of`, `stars`, `★`), or decimals.
 * A bare whole number never settles. A single-digit whole number (0–9) further
 * needs one of the field's words right beside it ("0 reviews", "rating: 4").
 */
export function numberShownInText(value: unknown, type: string, text: string, fieldName: string): boolean {
  if (!NUMERIC_TYPES.has(type)) return false;
  const n = toNumber(value);
  if (n == null || !text) return false;
  const page = lowerPage(text.replace(/&nbsp;|&#160;/g, ' '));
  const names = nameWords(fieldName);
  const smallWhole = Number.isInteger(n) && Math.abs(n) < 10;
  if (smallWhole && names.length === 0) return false;
  for (const { at, end, decimals } of numberMatches(n, page)) {
    const before = page.slice(Math.max(0, at - NAME_WINDOW), at);
    const after = page.slice(end, end + NAME_WINDOW);
    if (smallWhole) {
      // The word right before ("rating 0", "reviews: 0") or right after ("0 reviews", "(0 ratings)").
      const prev = before.match(/([a-z]+)[\s:()-]{0,3}$/)?.[1];
      const next = after.match(/^[\s:()-]{0,3}([a-z]+)/)?.[1];
      if (!((prev && isNameWord(prev, names)) || (next && isNameWord(next, names)))) continue;
    }
    if (decimals) return true;
    if (type === 'money') {
      if (CURRENCY_BEFORE.test(before) || CURRENCY_AFTER.test(after)) return true;
    } else {
      if (RATING_AFTER.test(after)) return true;
      const near = `${before} ${after}`;
      if ((near.match(/[a-z]+/g) ?? []).some((w) => isNameWord(w, names))) return true;
    }
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
 * Whether a long `text` value's first 80 characters appear in the FULL page
 * text (normalised both sides). Short text (a title, a brand) never settles
 * here: it always goes to the judge.
 */
export function textPrefixInText(value: unknown, type: string, fullText: string): boolean {
  if (!isLongText(value, type) || !fullText) return false;
  const prefix = normaliseText(value).slice(0, PREFIX_CHARS).trim();
  return prefix.length > 0 && normaliseText(fullText).includes(prefix);
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
  if (type && NUMERIC_TYPES.has(type)) {
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
