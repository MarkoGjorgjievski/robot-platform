// A page's shape, read from its page data only (spec 2026-10-10 §A3): what
// kind of thing the JSON-LD says it is, where its offers sit, whether a
// rating is present, and the address pattern. Used by the coverage check to
// group and explain the pages a field came back empty on — never to decide
// anything about a value.
import type { PageCapture } from '@robot/browser';

export type Shape = {
  jsonLdTypes: string[];
  offers: 'top-level' | 'in-variants' | 'none';
  rating: boolean;
  address: string;
};

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every JSON-LD node, `@graph` unwrapped one level (the way variant-detect reads Nike). */
function nodes(ldJson: unknown[]): Node[] {
  const out: Node[] = [];
  for (const j of ldJson) {
    if (!isNode(j)) continue;
    if (Array.isArray(j['@graph'])) { for (const g of j['@graph']) if (isNode(g)) out.push(g); continue; }
    out.push(j);
  }
  return out;
}

function typesOf(n: Node): string[] {
  const t = n['@type'];
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : typeof t === 'string' ? [t] : [];
}

const has = (n: Node, key: string) => n[key] !== undefined && n[key] !== null && !(Array.isArray(n[key]) && (n[key] as unknown[]).length === 0);

/** A number above zero, or a string that reads as one. */
function positive(v: unknown): boolean {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0;
}

// A rating is present only when one of these keys carries a number above zero.
// A product API often carries `rating: 0` or `averageRating: 0` for a product with
// no rating yet (Decathlon's `stats.averageRating`), and recommendation carousels
// and review widgets carry such keys on nearly every page: a key alone says nothing.
const RATING_KEYS = ['ratingValue', 'averageRating', 'average_rating', 'rating'];

/** Does any object in this JSON (depth ≤ 6) carry a rating above zero, bare or under `aggregateRating`? */
function anyRating(value: unknown, depth = 0): boolean {
  if (depth > 6 || !isNode(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.some((v) => anyRating(v, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (RATING_KEYS.includes(k) && positive(v)) return true;
    if (anyRating(v, depth + 1)) return true; // `aggregateRating: { ratingValue }` is reached here
  }
  return false;
}

/** A JSON-LD `aggregateRating` counts only when it has a `ratingValue`. */
const ldRating = (n: Node) => isNode(n.aggregateRating) && has(n.aggregateRating, 'ratingValue') && n.aggregateRating.ratingValue !== '';

export function addressPattern(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const path = u.pathname.replace(/\d+/g, 'n');
  const keys = [...u.searchParams.keys()].sort();
  return keys.length ? `${path}?${keys.join('&')}` : path;
}

export function shapeOf(capture: Pick<PageCapture, 'url' | 'structuredData' | 'interceptedRequests'>): Shape {
  const ns = nodes(capture.structuredData.ldJson);
  const jsonLdTypes = [...new Set(ns.flatMap(typesOf))];
  const topLevelOffers = ns.some((n) => has(n, 'offers'));
  const inVariants = ns.some((n) => Array.isArray(n.hasVariant) && (n.hasVariant as unknown[]).some((v) => isNode(v) && has(v, 'offers')));
  const offers = topLevelOffers ? 'top-level' : inVariants ? 'in-variants' : 'none';
  let rating = ns.some(ldRating);
  if (!rating) {
    for (const r of capture.interceptedRequests) {
      if (!r.isJson || r.parsedJson == null) continue;
      if (anyRating(r.parsedJson)) { rating = true; break; }
    }
  }
  return { jsonLdTypes, offers, rating, address: addressPattern(capture.url) };
}
