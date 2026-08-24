// Which intercepted response is the listing's own API?
//
// Not "which endpoint looks product-ish" — that guess is what `c606a54` reverted
// for breaking Nike. Page 1's row extraction has ALREADY produced detail URLs, so
// the listing API is the response carrying those same values. Evidence comparable
// by construction.
//
// The single-identifier version of this rule is unsafe across API namespaces (see
// the note at `filterRequestsForPage`'s call site): a recommendations endpoint
// legitimately carries a product id you are looking for. This rule survives that
// because it demands MULTIPLICITY — a recommendations blob carries two or three of
// a listing's URLs, never twenty.

import type { InterceptedRequest } from '@robot/browser';
import { collectFromJson, getPath, identifierFromUrl } from './api-identifiers.js';

/** At least this many of page 1's URLs must appear. Stops a tiny listing qualifying a widget. */
export const API_MATCH_MIN_COUNT = 3;
/** And at least this share of them. Stops a large listing qualifying a sidebar. */
export const API_MATCH_MIN_SHARE = 0.5;

/** How deep to search for an array of objects. Deeper than this is not a results payload. */
const MAX_DEPTH = 3;

/**
 * Scan at most this many items of any one candidate array. Real listing pages
 * run from a handful of items up to a few hundred (the reviewer's measured
 * worst case, 300, is itself called out as a plausible real shape); 1000 gives
 * generous headroom above that so a genuine listing is never truncated, while
 * still bounding a pathological payload — a full catalog dump or unrelated
 * cache blob nested at a candidate path — that could otherwise be orders of
 * magnitude larger and dominate runtime for no benefit.
 */
export const MAX_ITEMS_SCANNED = 1000;

export type ListingApiMatch = {
  request: InterceptedRequest;
  itemsPath: string;
  urlPath: string;
  /** Fraction of page 1's identifiers found. */
  share: number;
  matched: number;
  /** How many items the array at `itemsPath` holds. Spec §1's tie-break. */
  arrayLength: number;
};

/** Every dot path (to MAX_DEPTH) holding an array whose first element is a plain object. */
function arrayPaths(node: unknown, prefix = '', depth = 0): string[] {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return [];
  const found: string[] = [];
  if (Array.isArray(node)) {
    const first = node[0];
    if (node.length > 0 && typeof first === 'object' && first !== null && !Array.isArray(first)) {
      found.push(prefix);
    }
    return found;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    found.push(...arrayPaths(value, prefix === '' ? key : `${prefix}.${key}`, depth + 1));
  }
  return found;
}

/** Dot paths to string values on an object, one level deep plus nested objects. */
function stringPaths(item: unknown, prefix = '', depth = 0): string[] {
  if (depth > 1 || item === null || typeof item !== 'object' || Array.isArray(item)) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') found.push(path);
    else found.push(...stringPaths(value, path, depth + 1));
  }
  return found;
}

export function findListingApi(
  requests: InterceptedRequest[],
  page1Urls: string[],
): ListingApiMatch | null {
  const wanted = new Set(page1Urls.map(identifierFromUrl).filter((id): id is string => id !== null));
  if (wanted.size === 0) return null;

  // Every (response, array path) pair worth scanning, collected BEFORE any
  // scanning starts and ordered by array length, longest first.
  //
  // This is not a behaviour change. The winner is the lexicographic maximum of
  // (share, then array length), and a maximum does not depend on visiting
  // order — except among candidates tying on BOTH keys, and those necessarily
  // have equal array length, so a stable sort (every engine since ES2019)
  // leaves their relative order exactly as interception produced it.
  // `[small, large]` and `[large, small]` both still answer `large`.
  //
  // What the order buys is the ONE short-circuit that is safe here; see below.
  const candidates: Array<{ request: InterceptedRequest; itemsPath: string; items: unknown[] }> = [];
  for (const request of requests) {
    if (request.method !== 'GET') continue;
    if (!request.isJson || request.parsedJson === null) continue;
    if (request.responseStatus < 200 || request.responseStatus >= 300) continue;
    for (const itemsPath of arrayPaths(request.parsedJson)) {
      // `arrayPaths` only yields a path whose value is a non-empty array of
      // objects, so this cast holds by construction.
      candidates.push({ request, itemsPath, items: getPath(request.parsedJson, itemsPath) as unknown[] });
    }
  }
  candidates.sort((a, b) => b.items.length - a.items.length);

  let best: ListingApiMatch | null = null;

  for (const { request, itemsPath, items } of candidates) {
    for (const urlPath of stringPaths(items[0])) {
      const ids = collectFromJson(request.parsedJson, itemsPath, urlPath, MAX_ITEMS_SCANNED);
      const matched = ids.filter((id) => wanted.has(id)).length;
      const share = matched / wanted.size;
      if (matched < API_MATCH_MIN_COUNT || share < API_MATCH_MIN_SHARE) continue;
      // Spec §1: "prefer the one with the highest share, then the largest
      // array." A tie-break on `matched` WOULD be unreachable — `wanted.size`
      // is fixed for the whole call, so share is strictly monotonic in matched
      // — but array length is a different dimension entirely, and two
      // endpoints carrying the same page-1 URLs in windows of different sizes
      // tie on share exactly. Prefer the fuller window: it means fewer
      // requests for the same catalogue, against a corpus whose binding
      // constraint is anti-bot.
      if (!best || share > best.share || (share === best.share && items.length > best.arrayLength)) {
        best = { request, itemsPath, urlPath, share, matched, arrayLength: items.length };
      }
      // The bound this function lost when the tie-break went in, restored in
      // the only form the tie-break permits.
      //
      // The naive `if (share >= 1) return best` was genuinely incompatible:
      // with it, `findListingApi([small, large])` answers `small`, and
      // interception order decides the winner. But the reason it was
      // incompatible is that a LARGER array might still be coming — and
      // scanning longest-first makes that impossible. `best` was set on this
      // candidate or an earlier (so at least as long) one, and every candidate
      // still to come is at most as long as this one — hence at most
      // `best.arrayLength`. Beating a share of 1 needs either a higher share
      // (there is none) or a STRICTLY larger array (there is none). Nothing
      // remaining can win, so stopping cannot change the answer.
      //
      // What it costs to omit: measured on the shape the original perf ruling
      // used — 30 responses x 300 items x 21 string fields x 3 array paths,
      // all under MAX_ITEMS_SCANNED — this call takes 3898 ms without the
      // return and 1 ms with it. That is synchronous, blocking, and paid once
      // per listing input. MAX_ITEMS_SCANNED does not cover it: it caps items
      // inside ONE array, not responses x array paths x string fields.
      if (best.share >= 1) return best;
    }
  }

  return best;
}
