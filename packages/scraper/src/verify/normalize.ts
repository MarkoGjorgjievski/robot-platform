import type { CustomerFieldType } from './types.js';

export type NormalizeContext = { pageUrl?: string };

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock', 'https://schema.org/instock', 'http://schema.org/instock']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out', 'https://schema.org/outofstock', 'http://schema.org/outofstock']);
const LIST_SEP = String.fromCharCode(31); // unit separator: never appears in page text

function text(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/** "1,299.50" | "1.299,50" | "1299" | 1299.5 → number. Currency symbols/codes stripped first. */
function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  let s = String(raw).normalize('NFKC').trim();
  s = s.replace(/[A-Za-z$€£¥₹\s]/g, ''); // symbols, codes, whitespace
  s = s.replace(/^[^\d\-+.,]+|[^\d.,]+$/g, '');
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const groups = s.split(',');
    // "1,299" is thousands; "129,99" is a decimal (two digits after a single comma).
    s = groups.length === 2 && groups[1]!.length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot > -1) {
    const groups = s.split('.');
    // "1.299" alone is ambiguous; treat a single 3-digit group as thousands only if there are 2+ dots.
    if (groups.length > 2) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(raw: unknown): string | null {
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  const s = text(raw)?.toLowerCase() ?? null;
  if (s === null) return null;
  if (TRUE_WORDS.has(s)) return 'true';
  if (FALSE_WORDS.has(s)) return 'false';
  return null;
}

/** Calendar day. A string carrying an explicit zone (Z or ±hh:mm) is read in UTC;
 *  anything else ("September 4, 2026", "2026-09-04 10:00") is a LOCAL date and
 *  must be read with local components — `toISOString()` on a local midnight in a
 *  UTC+2 zone yields the previous day. */
function day(raw: unknown): string | null {
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = typeof raw === 'string' ? raw.trim() : raw === null || raw === undefined ? '' : String(raw);
  if (s === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(s) && /T\d{2}:\d{2}/.test(s);
  return zoned ? new Date(t).toISOString().slice(0, 10) : local(new Date(t));
}

function url(raw: unknown, ctx?: NormalizeContext): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const u = new URL(raw.trim(), ctx?.pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.href;
  } catch {
    return null;
  }
}

function list(raw: unknown): string | null {
  const items = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\n,;]/) : null;
  if (!items) return null;
  const norm = items.map((i) => text(i)?.toLowerCase() ?? null).filter((i): i is string => i !== null);
  if (norm.length === 0) return null;
  return [...new Set(norm)].sort().join(LIST_SEP);
}

export function normalize(type: CustomerFieldType, raw: unknown, ctx?: NormalizeContext): string | null {
  switch (type) {
    case 'text': return text(raw);
    case 'number': { const n = parseNumber(raw); return n === null ? null : String(n); }
    case 'money': { const n = parseNumber(raw); return n === null ? null : (Math.round(n * 100) / 100).toFixed(2); }
    case 'boolean': return bool(raw);
    case 'date': return day(raw);
    case 'url':
    case 'image': return url(raw, ctx);
    case 'text_list': return list(raw);
  }
}

export function valuesEqual(type: CustomerFieldType, a: unknown, b: unknown, ctx?: NormalizeContext): boolean {
  const na = normalize(type, a, ctx);
  const nb = normalize(type, b, ctx);
  if (na === null || nb === null) return false;
  return type === 'text' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

const TYPE_LABEL: Record<CustomerFieldType, string> = {
  text: 'text', number: 'a number', money: 'a money amount', boolean: 'yes/no (or in stock/out of stock)',
  date: 'a date', url: 'a URL', image: 'an image URL', text_list: 'a comma-separated list',
};

export function validateExpected(type: CustomerFieldType, textIn: string): string | null {
  if (textIn.trim() === '') return 'Expected value is required';
  if (normalize(type, textIn) === null) return `Not ${TYPE_LABEL[type]}`;
  return null;
}

export function renderValue(type: CustomerFieldType, normalized: string): unknown {
  switch (type) {
    case 'number':
    case 'money': return Number(normalized);
    case 'boolean': return normalized === 'true';
    case 'text_list': return normalized.split(LIST_SEP);
    default: return normalized;
  }
}
