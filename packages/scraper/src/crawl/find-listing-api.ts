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
import { collectFromJson, identifierFromUrl } from './api-identifiers.js';

/** At least this many of page 1's URLs must appear. Stops a tiny listing qualifying a widget. */
export const API_MATCH_MIN_COUNT = 3;
/** And at least this share of them. Stops a large listing qualifying a sidebar. */
export const API_MATCH_MIN_SHARE = 0.5;

/** How deep to search for an array of objects. Deeper than this is not a results payload. */
const MAX_DEPTH = 3;

export type ListingApiMatch = {
  request: InterceptedRequest;
  itemsPath: string;
  urlPath: string;
  /** Fraction of page 1's identifiers found. */
  share: number;
  matched: number;
};

/** Every dot path (to MAX_DEPTH) holding an array whose first element is an object. */
function arrayPaths(node: unknown, prefix = '', depth = 0): string[] {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return [];
  const found: string[] = [];
  if (Array.isArray(node)) {
    if (node.length > 0 && typeof node[0] === 'object' && node[0] !== null) found.push(prefix);
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

  let best: ListingApiMatch | null = null;

  for (const request of requests) {
    if (request.method !== 'GET') continue;
    if (!request.isJson || request.parsedJson === null) continue;
    if (request.responseStatus < 200 || request.responseStatus >= 300) continue;

    for (const itemsPath of arrayPaths(request.parsedJson)) {
      const sample = getFirstItem(request.parsedJson, itemsPath);
      for (const urlPath of stringPaths(sample)) {
        const ids = collectFromJson(request.parsedJson, itemsPath, urlPath);
        const matched = ids.filter((id) => wanted.has(id)).length;
        const share = matched / wanted.size;
        if (matched < API_MATCH_MIN_COUNT || share < API_MATCH_MIN_SHARE) continue;
        if (!best || share > best.share || (share === best.share && matched > best.matched)) {
          best = { request, itemsPath, urlPath, share, matched };
        }
      }
    }
  }

  return best;
}

function getFirstItem(json: unknown, itemsPath: string): unknown {
  const parts = itemsPath === '' ? [] : itemsPath.split('.');
  let current: unknown = json;
  for (const key of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current[0] : undefined;
}
