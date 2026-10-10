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

/** Does any object in this JSON (depth ≤ 6) carry one of these keys with a non-empty value? */
function anyKey(value: unknown, keys: string[], depth = 0): boolean {
  if (depth > 6 || !isNode(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.some((v) => anyKey(v, keys, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (keys.includes(k) && v !== null && v !== undefined && v !== '') return true;
    if (anyKey(v, keys, depth + 1)) return true;
  }
  return false;
}

// Includes a bare 'rating': a product API often carries `rating: 0` or
// `rating: null` for a no-rating product — anyKey treats `0` as present (it
// only excludes null/undefined/''), which is what we want: the API DOES
// carry a rating field, even when its value says there is no rating yet.
const RATING_KEYS = ['aggregateRating', 'ratingValue', 'averageRating', 'average_rating', 'rating'];

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
  let rating = ns.some((n) => has(n, 'aggregateRating'));
  if (!rating) {
    for (const r of capture.interceptedRequests) {
      if (!r.isJson || r.parsedJson == null) continue;
      if (anyKey(r.parsedJson, RATING_KEYS)) { rating = true; break; }
    }
  }
  return { jsonLdTypes, offers, rating, address: addressPattern(capture.url) };
}
