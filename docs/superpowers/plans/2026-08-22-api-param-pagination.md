# `api-param` Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paginate a listing by replaying its own JSON endpoint, with the paging parameter proven by experiment before it is ever used or cached.

**Architecture:** Detection identifies the listing API as the intercepted response containing the detail URLs page 1 already produced (multiplicity-gated, so it is not the single-identifier rule that broke Nike). Candidate paging parameters are ranked by name, then each is *proven* by fetching one probe and comparing returned identifiers against page 1's. The page fetches; Node decides. `planRun`'s existing `walkPages(config)` seam becomes a dispatcher, so caching, verification, the stale retry and every warning work unchanged.

**Tech Stack:** TypeScript (ESM), Playwright, Vitest, Drizzle ORM + PostgreSQL, pnpm workspaces + Turborepo.

**Spec:** [`docs/superpowers/specs/2026-08-22-api-param-pagination-design.md`](../specs/2026-08-22-api-param-pagination-design.md)

## Global Constraints

- All packages are ESM. Every relative import MUST carry a `.js` extension.
- TDD: write the failing test first, run it, watch it fail for the right reason, then implement.
- **The paging parameter is never guessed.** Every candidate is proven by replay before use and before caching. A candidate whose probe returns page 1's items again is rejected.
- Detection thresholds, exact values: `API_MATCH_MIN_COUNT = 3`, `API_MATCH_MIN_SHARE = 0.5`, `REPLAY_MAX_OVERLAP = 0.5`.
- Candidate parameter names, in rank order: `page`, `pageNumber`, `pageNum`, `p`, `offset`, `start`, `startIndex`, `from`, `skip`.
- GET, JSON, 2xx responses only. **No cursors, no POST, no GraphQL, no DOM scroll** — those are the next cycle.
- A pagination failure must never lose the work page 1 already planned. Every failure path degrades to a warning and falls through to the HTML strategies.
- `pnpm -r test` needs Postgres: `docker start robot-platform-db` first.
- Verify types with `pnpm typecheck --force` — a plain run is FULL TURBO cached and proves nothing. Check the dashboard separately with `pnpm --filter @robot/dashboard exec tsc --noEmit`.
- Leave no test rows behind: `select count(*) from domain_intelligence where domain in ('example.com','listing.example') or domain like 'test-%'` must be 0 after a full suite run.

---

## A deviation from the spec, decided here

Spec §4 says detail URLs come out of paged JSON "through the existing cached-API-path tier", with `detail_url` getting an `api`-sourced dot-notation path in `field_paths`. **This plan instead carries `itemsPath` and `urlPath` on the config itself.**

Why: `field_paths` is written by `saveDomainCache` at the end of an extraction, keyed `(domain, pageType)`. The walk needs those paths *during* the walk, on every page, before any of that has run — and a config that cannot enumerate on a later run without a second cache lookup succeeding is not self-sufficient. Putting both paths on the config makes a cached `api-param` config complete on its own.

Cost if this is wrong: the config object carries two more strings, and a future move to `field_paths` has to migrate them.

## A second deviation: payload termination signals are not used

Spec §4 says termination "prefers real signals from the payload — `total`, `totalPages`, `totalCount`, `hasMore`, `has_next` where present". **This plan does not implement them**, and the reason is a direct consequence of the §3 batching decision the spec itself makes.

Pages 2..`max_pages` are fetched in **one** batch, because that costs one navigation instead of one per page. A `hasMore` flag can only be acted on *between* fetches — so honouring it would mean going back to one navigation per page, trading a real cost for a saving of at most a couple of small JSON requests.

The walk stays fully bounded without them: `max_pages`, `max_items`, and a page that yields no new identifiers all still stop it. If `max_pages` were ever raised to something large, this trade flips and the signals become worth having — that is the condition to revisit under, and it is recorded in the roadmap by Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/browser/src/types.ts` | **Modify.** `PaginationConfig` gains its `api-param` member. |
| `packages/scraper/src/crawl/api-identifiers.ts` | **Create.** Pure: pull comparable identifiers out of a URL and out of a JSON payload. Shared by detection and verification — one definition, so the two can never disagree. |
| `packages/scraper/src/crawl/find-listing-api.ts` | **Create.** Pure: which intercepted response is the listing API, and where its items and URLs live. |
| `packages/scraper/src/crawl/api-param-candidates.ts` | **Create.** Pure: rank candidate parameters and steps; decide whether a probe verified. |
| `packages/scraper/src/crawl/api-param-fetch.ts` | **Create.** The two in-page fetch scripts and their typed results. The only file here that touches a browser. |
| `packages/scraper/src/crawl/detect-api-param.ts` | **Create.** Orchestrates: find the API → rank → probe → verify → build the config. |
| `packages/scraper/src/crawl/detect-pagination.ts` | **Modify.** `api-param` becomes the first rung after `cached`. |
| `packages/scraper/src/crawl/plan-run.ts` | **Modify.** `walkPages` dispatches to a JSON walker when the config is `api-param`. |
| `packages/scraper/src/__fixtures__/serve.ts` | **Modify.** Serve JSON endpoints alongside HTML, same origin. |
| `packages/scraper/src/crawl/api-param-fixture.test.ts` | **Create.** Tier 1 gate: real Chromium, real fetch, real HTTP. |
| `docs/handoff.md`, `docs/roadmap.md` | **Modify.** Record what the live run demonstrated. |

---

### Task 1: The config member and the identifier helper

**Files:**
- Modify: `packages/browser/src/types.ts` (the `PaginationConfig` type)
- Create: `packages/scraper/src/crawl/api-identifiers.ts`
- Test: `packages/scraper/src/crawl/api-identifiers.test.ts`

**Interfaces:**
- Produces: `ApiParamConfig`; `identifierFromUrl(url: string): string | null`; `collectFromJson(json: unknown, itemsPath: string, urlPath: string): string[]`; `getPath(obj: unknown, path: string): unknown`.

Context: `PaginationConfig` today is a flat object with `strategy` plus optional fields — the three HTML strategies share it. Keep that shape; add the `api-param` fields as further optionals rather than converting it to a discriminated union, because `crawl()`, the cache, and `detectPaginationFromHtml` all read the flat shape and a union would ripple through all of them for no gain in this cycle.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/api-identifiers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { identifierFromUrl, collectFromJson, getPath } from './api-identifiers.js';

describe('identifierFromUrl', () => {
  it('takes the last meaningful path segment', () => {
    expect(identifierFromUrl('https://x.example/books/9780134685991')).toBe('9780134685991');
  });

  it('ignores a trailing slash', () => {
    expect(identifierFromUrl('https://x.example/books/abc-123/')).toBe('abc-123');
  });

  it('answers the same identifier for an absolute URL and its bare path', () => {
    // An API routinely returns "/p/9780134685991" where the DOM carried the
    // absolute URL. If those two do not compare equal, detection never matches
    // anything at all.
    expect(identifierFromUrl('https://x.example/p/9780134685991')).toBe('9780134685991');
    expect(identifierFromUrl('/p/9780134685991')).toBe('9780134685991');
  });

  it('never mistakes a hostname for an identifier', () => {
    // "x.example" is nine characters, so a naive split would sail past the
    // length bar and match itself in every payload on the domain.
    expect(identifierFromUrl('https://x.example')).toBeNull();
  });

  it('rejects a segment too short to be an identifier by coincidence', () => {
    // "4" or "en" would collide across unrelated payloads.
    expect(identifierFromUrl('https://x.example/p/4')).toBeNull();
  });

  it('answers null for a URL with no path', () => {
    expect(identifierFromUrl('https://x.example/')).toBeNull();
  });
});

describe('getPath', () => {
  it('walks dot notation', () => {
    expect(getPath({ data: { items: [1, 2] } }, 'data.items')).toEqual([1, 2]);
  });

  it('answers undefined for a missing branch rather than throwing', () => {
    expect(getPath({ data: {} }, 'data.items.0.url')).toBeUndefined();
  });

  it('treats an empty path as the root', () => {
    expect(getPath([1, 2], '')).toEqual([1, 2]);
  });
});

describe('collectFromJson', () => {
  const payload = {
    results: [
      { link: '/p/11111', name: 'One' },
      { link: '/p/22222', name: 'Two' },
      { name: 'No link' },
    ],
  };

  it('collects one identifier per item that has one', () => {
    expect(collectFromJson(payload, 'results', 'link')).toEqual(['11111', '22222']);
  });

  it('answers an empty array when the items path is not an array', () => {
    expect(collectFromJson(payload, 'nope', 'link')).toEqual([]);
  });

  it('reads a nested url path inside each item', () => {
    const nested = { d: { rows: [{ meta: { href: '/p/33333' } }] } };
    expect(collectFromJson(nested, 'd.rows', 'meta.href')).toEqual(['33333']);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-identifiers.test.ts`

Expected: FAIL — cannot resolve `./api-identifiers.js`.

- [ ] **Step 3: Implement**

Create `packages/scraper/src/crawl/api-identifiers.ts`:

```typescript
// Comparable identifiers, defined once.
//
// Detection asks "does this response carry the URLs page 1 produced?" and
// verification asks "did this probe return the SAME items as page 1?". Both are
// the same question about the same kind of value, so they share one definition —
// if they drifted apart, a config could pass detection and then be verified
// against a differently-shaped identifier, which is a bug with no symptom until
// a live site produces one.

/**
 * Short segments collide across unrelated payloads — "4", "en", "us" appear in
 * everything. An identifier has to be long enough that a coincidental match is
 * not the likely explanation. Same reasoning, and the same number, as
 * `MIN_IDENTIFIER_LENGTH` in `entity-match.ts`.
 */
const MIN_IDENTIFIER_LENGTH = 6;

/** Walk dot notation without throwing on a missing branch. */
export function getPath(obj: unknown, path: string): unknown {
  if (path === '') return obj;
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * The last meaningful path segment of a URL, or null when there isn't one.
 *
 * Deliberately path-only: an API returns "/p/12345" where the DOM carried
 * "https://site.example/p/12345", and detection compares one against the other.
 * Anchoring on the trailing segment makes those equal without needing to know
 * the origin.
 */
export function identifierFromUrl(url: string): string | null {
  let path: string;
  try {
    // Parsing gets the host out of the way for free — splitting the raw string
    // would leave "x.example" looking like a path segment, and a hostname is
    // long enough to pass the length bar and poison every comparison.
    path = new URL(url).pathname;
  } catch {
    // Not absolute: it is already a path like "/p/12345".
    path = url.split('?')[0]!.split('#')[0]!;
  }
  const segments = path.split('/').filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (!last || last.length < MIN_IDENTIFIER_LENGTH) return null;
  return last;
}

/** Every identifier reachable at `itemsPath[].urlPath`, in order, skipping items that have none. */
export function collectFromJson(json: unknown, itemsPath: string, urlPath: string): string[] {
  const items = getPath(json, itemsPath);
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const item of items) {
    const raw = getPath(item, urlPath);
    if (typeof raw !== 'string') continue;
    const id = identifierFromUrl(raw);
    if (id) out.push(id);
  }
  return out;
}
```

Then extend `PaginationConfig` in `packages/browser/src/types.ts`:

```typescript
export type PaginationConfig = {
  strategy: 'url-pattern' | 'next-button' | 'page-numbers' | 'api-param';
  /** For url-pattern: URL with {N} placeholder, e.g. "https://example.com/search?page={N}" */
  urlTemplate?: string;
  /** For next-button: CSS selector for the next page element */
  nextSelector?: string;
  /** For page-numbers: CSS selector for page number links container */
  pageSelector?: string;
  /**
   * For api-param: the listing endpoint with the paging parameter's value
   * replaced by {N}. A template, not a captured URL, for the same reason
   * `urlTemplate` is one — a captured URL carries a value that is wrong on
   * every subsequent page.
   */
  apiTemplate?: string;
  /** For api-param: the query parameter that pages, e.g. "offset". */
  paramName?: string;
  /** For api-param: how much to advance it per page — 1 for page-style, the page size for offset-style. */
  step?: number;
  /** For api-param: dot path to the results array inside the response. */
  itemsPath?: string;
  /** For api-param: dot path to the detail URL inside each result. */
  urlPath?: string;
};
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-identifiers.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Teeth check**

Lower `MIN_IDENTIFIER_LENGTH` to 1. Re-run. Expected: "rejects a segment too short to be an identifier by coincidence" FAILS. Restore.

- [ ] **Step 6: Gates and commit**

```bash
docker start robot-platform-db
pnpm -r test
pnpm typecheck --force
git add packages/browser/src/types.ts packages/scraper/src/crawl/api-identifiers.ts packages/scraper/src/crawl/api-identifiers.test.ts
git commit -m "feat(crawl): api-param config member and shared identifier extraction"
```

---

### Task 2: Find the listing API

**Files:**
- Create: `packages/scraper/src/crawl/find-listing-api.ts`
- Test: `packages/scraper/src/crawl/find-listing-api.test.ts`

**Interfaces:**
- Consumes: `collectFromJson`, `identifierFromUrl` from Task 1; `InterceptedRequest` from `@robot/browser`.
- Produces: `findListingApi(requests: InterceptedRequest[], page1Urls: string[]): ListingApiMatch | null` where `ListingApiMatch = { request: InterceptedRequest; itemsPath: string; urlPath: string; share: number; matched: number }`.

Context — **the thing this task exists to get right.** `filterRequestsForPage` (reverted in `c606a54` for breaking Nike) matched a *single* entity's identifier against intercepted responses, and the note at its call site says the identifier rule is unsafe across API namespaces: a recommendations endpoint legitimately carries the id you are hunting. This rule survives that objection only because it demands **multiplicity** — a recommendations blob carries two or three of a listing's URLs, not twenty. Both thresholds exist for different reasons: the count stops a tiny listing qualifying a widget on one coincidence, the share stops a large listing qualifying a sidebar holding a handful.

Candidate `(itemsPath, urlPath)` pairs are found by search, not assumption: walk the response for arrays of objects (to depth 3), and for each, try each string-valued key on the first item.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/find-listing-api.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { InterceptedRequest } from '@robot/browser';
import { findListingApi } from './find-listing-api.js';

const PAGE1 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/10000${i}`);

function req(url: string, json: unknown, over: Partial<InterceptedRequest> = {}): InterceptedRequest {
  return {
    url, method: 'GET', resourceType: 'xhr', responseStatus: 200,
    responseHeaders: {}, responseBody: JSON.stringify(json), contentType: 'application/json',
    bodySize: 100, isJson: true, parsedJson: json, timestamp: 0, ...over,
  };
}

const listingApi = req('https://x.example/api/search?q=py&offset=0', {
  results: PAGE1.map((u) => ({ link: u, title: 'x' })),
});

/** The Nike shape: a real endpoint that legitimately carries a couple of the same ids. */
const recommendations = req('https://x.example/api/recs', {
  items: [{ link: PAGE1[0] }, { link: PAGE1[1] }, { link: 'https://x.example/p/999999' }],
});

describe('findListingApi', () => {
  it('picks the endpoint carrying page 1 URLs and reports where they live', () => {
    const match = findListingApi([recommendations, listingApi], PAGE1);
    expect(match?.request.url).toBe(listingApi.url);
    expect(match?.itemsPath).toBe('results');
    expect(match?.urlPath).toBe('link');
    expect(match?.matched).toBe(10);
  });

  it('does NOT pick a recommendations blob that shares a couple of ids', () => {
    // This is the c606a54 case. Two of ten is a coincidence, not a listing.
    expect(findListingApi([recommendations], PAGE1)).toBeNull();
  });

  it('requires a minimum COUNT, so a tiny listing cannot qualify a widget', () => {
    // 2 of 2 is a 100% share but only two matches — below API_MATCH_MIN_COUNT.
    const twoUrls = PAGE1.slice(0, 2);
    const widget = req('https://x.example/api/w', { items: twoUrls.map((u) => ({ link: u })) });
    expect(findListingApi([widget], twoUrls)).toBeNull();
  });

  it('ignores non-GET, non-JSON and non-2xx responses', () => {
    const posted = req(listingApi.url, { results: PAGE1.map((u) => ({ link: u })) }, { method: 'POST' });
    const failed = req(listingApi.url, { results: PAGE1.map((u) => ({ link: u })) }, { responseStatus: 500 });
    const notJson = req(listingApi.url, null, { isJson: false, parsedJson: null });
    expect(findListingApi([posted, failed, notJson], PAGE1)).toBeNull();
  });

  it('finds items nested under a wrapper object', () => {
    const nested = req('https://x.example/api/s?page=1', {
      data: { products: PAGE1.map((u) => ({ href: u })) },
    });
    const match = findListingApi([nested], PAGE1);
    expect(match?.itemsPath).toBe('data.products');
    expect(match?.urlPath).toBe('href');
  });

  it('prefers the higher-share candidate when two qualify', () => {
    const partial = req('https://x.example/api/a', { results: PAGE1.slice(0, 6).map((u) => ({ link: u })) });
    const full = req('https://x.example/api/b', { results: PAGE1.map((u) => ({ link: u })) });
    expect(findListingApi([partial, full], PAGE1)?.request.url).toBe(full.url);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/find-listing-api.test.ts`
Expected: FAIL — cannot resolve `./find-listing-api.js`.

- [ ] **Step 3: Implement**

Create `packages/scraper/src/crawl/find-listing-api.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/find-listing-api.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Teeth check**

Set `API_MATCH_MIN_COUNT = 1`. Re-run. Expected: "requires a minimum COUNT" FAILS, and "does NOT pick a recommendations blob" FAILS. Restore. Then set `API_MATCH_MIN_SHARE = 0`. Expected: the recommendations test FAILS. Restore.

Report both. If the recommendations test does not fail under either sabotage, say so and stop — it is the test this whole task exists for.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/crawl/find-listing-api.ts packages/scraper/src/crawl/find-listing-api.test.ts
git commit -m "feat(crawl): identify a listing API by the URLs page 1 already produced"
```

---

### Task 3: Rank candidates, and decide whether a probe verified

**Files:**
- Create: `packages/scraper/src/crawl/api-param-candidates.ts`
- Test: `packages/scraper/src/crawl/api-param-candidates.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (deliberately — these are pure decisions over values).
- Produces: `rankCandidates(endpointUrl: string, pageSize: number): Candidate[]` where `Candidate = { paramName: string; from: number; step: number }`; `probeUrl(endpointUrl: string, c: Candidate): string`; `templateFor(endpointUrl: string, paramName: string): string`; `overlapShare(page1Ids: string[], probeIds: string[]): number`; `REPLAY_MAX_OVERLAP`.

Context: this is the heart of the spec. **A candidate is a (name, step) hypothesis, not a name.** `page`-family names advance by 1; `offset`/`start`/`from`/`skip` advance by one page size. A wrong step returns an overlapping window rather than a fresh page — which the same overlap check rejects, so both kinds of error are caught by one mechanism. Emit both steps per parameter, name-implied first, so the caller tries the likely one and still has the fallback.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/api-param-candidates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  rankCandidates, probeUrl, templateFor, overlapShare, REPLAY_MAX_OVERLAP,
} from './api-param-candidates.js';

describe('rankCandidates', () => {
  it('offers page-style names before offset-style ones', () => {
    const names = rankCandidates('https://x.example/a?offset=0&page=1', 30).map((c) => c.paramName);
    expect(names.indexOf('page')).toBeLessThan(names.indexOf('offset'));
  });

  it('gives a page-style parameter a step of 1 first, and the page size as a fallback', () => {
    const forPage = rankCandidates('https://x.example/a?page=1', 30).filter((c) => c.paramName === 'page');
    expect(forPage.map((c) => c.step)).toEqual([1, 30]);
  });

  it('gives an offset-style parameter the page size first, and 1 as a fallback', () => {
    // The AbeBooks lesson generalised: the STEP is part of the hypothesis. An
    // offset bumped by 1 returns items 1..30 instead of 30..59 — a window that
    // overlaps page 1 almost entirely, which is a wrong answer that parses.
    const forOffset = rankCandidates('https://x.example/a?offset=0', 30).filter((c) => c.paramName === 'offset');
    expect(forOffset.map((c) => c.step)).toEqual([30, 1]);
  });

  it('ignores parameters that are not numeric', () => {
    const names = rankCandidates('https://x.example/a?page=abc&q=python', 30).map((c) => c.paramName);
    expect(names).toEqual([]);
  });

  it('ignores parameters whose names are not known pagers', () => {
    // AbeBooks carried ds, sp and spo alongside the real pager. A name we do not
    // recognise is not a candidate; it is noise.
    const names = rankCandidates('https://x.example/a?ds=1&spo=30&p=1', 30).map((c) => c.paramName);
    expect(new Set(names)).toEqual(new Set(['p']));
  });

  it('carries the parameter\'s current value so the probe can advance from it', () => {
    expect(rankCandidates('https://x.example/a?offset=60', 30)[0]).toMatchObject({ from: 60, step: 30 });
  });
});

describe('probeUrl', () => {
  it('advances the candidate parameter and leaves every other one alone', () => {
    const url = probeUrl('https://x.example/a?kn=py&offset=0&spo=30', { paramName: 'offset', from: 0, step: 30 });
    expect(new URL(url).searchParams.get('offset')).toBe('30');
    expect(new URL(url).searchParams.get('kn')).toBe('py');
    expect(new URL(url).searchParams.get('spo')).toBe('30');
  });
});

describe('templateFor', () => {
  it('replaces only the paging parameter with {N}', () => {
    expect(templateFor('https://x.example/a?kn=py&offset=0', 'offset'))
      .toBe('https://x.example/a?kn=py&offset={N}');
  });
});

describe('overlapShare', () => {
  it('is 1 when the probe returned exactly page 1 again', () => {
    // The AbeBooks failure, as a number. This is what a wrong parameter looks like.
    expect(overlapShare(['a1', 'b2', 'c3'], ['a1', 'b2', 'c3'])).toBe(1);
  });

  it('is 0 when the probe returned a genuinely different page', () => {
    expect(overlapShare(['a1', 'b2'], ['d4', 'e5'])).toBe(0);
  });

  it('is 0 when the probe returned nothing', () => {
    expect(overlapShare(['a1', 'b2'], [])).toBe(0);
  });

  it('rejects a mostly-overlapping window at the documented threshold', () => {
    // An offset bumped by 1: 29 of 30 items are page 1's.
    const page1 = Array.from({ length: 30 }, (_, i) => `id${i}`);
    const shifted = Array.from({ length: 30 }, (_, i) => `id${i + 1}`);
    expect(overlapShare(page1, shifted)).toBeGreaterThan(REPLAY_MAX_OVERLAP);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-param-candidates.test.ts`
Expected: FAIL — cannot resolve `./api-param-candidates.js`.

- [ ] **Step 3: Implement**

Create `packages/scraper/src/crawl/api-param-candidates.ts`:

```typescript
// Which query parameter pages this endpoint, and by how much?
//
// The same question `deriveTemplate` gets wrong on the HTML path: on 2026-08-21
// it chose AbeBooks' `ds` filter and pinned `p=1`, the real pager, so pages 2 and
// 3 re-served page 1 — and three stray items past dedupe were enough to satisfy
// the `gained > 0` gate, so the broken config was cached in silence.
//
// The difference here is that we can settle it by experiment. This module only
// RANKS and DECIDES; the fetching happens elsewhere, so every judgement below is
// a pure function over values a test can hand it.

/** Names that page, best guess first. A name outside this list is noise, not a candidate. */
const PAGE_STYLE = ['page', 'pageNumber', 'pageNum', 'p'] as const;
const OFFSET_STYLE = ['offset', 'start', 'startIndex', 'from', 'skip'] as const;
const RANKED: readonly string[] = [...PAGE_STYLE, ...OFFSET_STYLE];

/** Above this share of page 1's identifiers coming back, the hypothesis is wrong. */
export const REPLAY_MAX_OVERLAP = 0.5;

export type Candidate = {
  paramName: string;
  /** The value the parameter holds on page 1. */
  from: number;
  /** How much to advance it by for the next page. */
  step: number;
};

export function rankCandidates(endpointUrl: string, pageSize: number): Candidate[] {
  const params = new URL(endpointUrl).searchParams;
  const out: Candidate[] = [];
  for (const name of RANKED) {
    const raw = params.get(name);
    if (raw === null || !/^\d+$/.test(raw)) continue;
    const from = Number(raw);
    // The step is part of the hypothesis. Name-implied first, the other second —
    // an offset bumped by 1 (or a page bumped by 30) parses perfectly and returns
    // an overlapping window, which only a replay can tell apart from a real page.
    const implied = (PAGE_STYLE as readonly string[]).includes(name) ? 1 : pageSize;
    const other = implied === 1 ? pageSize : 1;
    out.push({ paramName: name, from, step: implied });
    if (other !== implied && other > 0) out.push({ paramName: name, from, step: other });
  }
  return out;
}

/** The endpoint with `c.paramName` advanced one page, everything else untouched. */
export function probeUrl(endpointUrl: string, c: Candidate): string {
  const url = new URL(endpointUrl);
  url.searchParams.set(c.paramName, String(c.from + c.step));
  return url.toString();
}

/** The endpoint with `paramName`'s value replaced by the {N} placeholder. */
export function templateFor(endpointUrl: string, paramName: string): string {
  const url = new URL(endpointUrl);
  url.searchParams.set(paramName, '__N__');
  return url.toString().replace('__N__', '{N}');
}

/**
 * What share of page 1's identifiers came back in the probe.
 *
 * Measured against PAGE 1's set, not the probe's: a probe returning page 1's
 * thirty items plus ten new ones is still re-serving page 1, and dividing by the
 * probe's larger set would hide that.
 */
export function overlapShare(page1Ids: string[], probeIds: string[]): number {
  if (page1Ids.length === 0) return 0;
  const probe = new Set(probeIds);
  const repeated = new Set(page1Ids.filter((id) => probe.has(id)));
  return repeated.size / new Set(page1Ids).size;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-param-candidates.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Teeth check**

In `rankCandidates`, drop the fallback step (push only the implied candidate). Re-run. Expected: both step-ordering tests FAIL. Restore.

Then change `overlapShare` to divide by `probe.size` instead of page 1's set size. Re-run. Expected: at minimum the "exactly page 1 again" test still passes but the mostly-overlapping-window test's margin changes — report exactly what you observe. If nothing fails, say so: it means the overlap denominator is untested and needs a case that pins it.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/crawl/api-param-candidates.ts packages/scraper/src/crawl/api-param-candidates.test.ts
git commit -m "feat(crawl): rank paging-parameter hypotheses and judge a probe"
```

---

### Task 4: The in-page fetch scripts

**Files:**
- Create: `packages/scraper/src/crawl/api-param-fetch.ts`
- Test: `packages/scraper/src/crawl/api-param-fetch.test.ts`

**Interfaces:**
- Consumes: `IBrowser` from `@robot/browser`.
- Produces: `buildFetchScript(urls: string[]): string`; `type FetchedBody = { url: string; status: number; json: unknown | null; error: string | null }`; `fetchInPage(browser: IBrowser, pageUrl: string, urls: string[]): Promise<FetchedBody[]>`.

Context: `IBrowser.evaluate(url, script)` navigates and then evaluates, so one call per fetch would cost one page load per page of results — worse than the HTML path it replaces. Instead each call fetches a *batch* of URLs from one page context. Two calls per input total: one probe batch, one paging batch.

`credentials: 'include'` is the point of doing this in-page at all — session cookies, auth headers and CSRF tokens apply without being reconstructed in Node, which is the difference between a request that works and one that returns a login page.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/api-param-fetch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { IBrowser } from '@robot/browser';
import { buildFetchScript, fetchInPage, type FetchedBody } from './api-param-fetch.js';

describe('buildFetchScript', () => {
  it('embeds the URLs as data, not as code', () => {
    // A URL carrying a quote must not be able to close the string and run.
    const script = buildFetchScript(['https://x.example/a?q=\'); alert(1); //']);
    expect(script).toContain(JSON.stringify(['https://x.example/a?q=\'); alert(1); //']));
  });

  it('asks for credentials, which is the whole reason to fetch in-page', () => {
    expect(buildFetchScript(['https://x.example/a'])).toContain("credentials: 'include'");
  });
});

describe('fetchInPage', () => {
  it('evaluates once for the whole batch rather than once per URL', async () => {
    const calls: string[] = [];
    const browser = {
      evaluate: async (url: string) => { calls.push(url); return [] as FetchedBody[]; },
    } as unknown as IBrowser;

    await fetchInPage(browser, 'https://x.example/list', ['a', 'b', 'c']);

    expect(calls).toEqual(['https://x.example/list']);
  });

  it('answers an empty batch without touching the browser at all', async () => {
    let called = false;
    const browser = { evaluate: async () => { called = true; return []; } } as unknown as IBrowser;

    expect(await fetchInPage(browser, 'https://x.example/list', [])).toEqual([]);
    expect(called).toBe(false);
  });

  it('degrades to an empty batch when the page context itself fails', async () => {
    // Pagination is an optimisation. A navigation failure must never lose the
    // work page 1 already planned, so this answers [] rather than throwing.
    const browser = {
      evaluate: async () => { throw new Error('net::ERR_ABORTED'); },
    } as unknown as IBrowser;

    expect(await fetchInPage(browser, 'https://x.example/list', ['a'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-param-fetch.test.ts`
Expected: FAIL — cannot resolve `./api-param-fetch.js`.

- [ ] **Step 3: Implement**

Create `packages/scraper/src/crawl/api-param-fetch.ts`:

```typescript
// The page fetches; Node decides.
//
// Every judgement about which parameter pages this endpoint lives in
// `api-param-candidates.ts` as a pure function, because logic that only exists
// inside a stringified in-page script cannot be unit-tested — and the
// verification is the part of this design most in need of tests. This file does
// the one thing that genuinely has to happen in the browser: issuing the fetches
// from the site's own origin, with its cookies.

import type { IBrowser } from '@robot/browser';

export type FetchedBody = {
  url: string;
  status: number;
  json: unknown | null;
  error: string | null;
};

/**
 * A script that fetches every URL and returns one record each.
 *
 * Defensive by construction: a non-2xx, a body that is not JSON, and a network
 * error all become a record with `error` set, never a throw. One bad URL must not
 * cost the batch.
 */
export function buildFetchScript(urls: string[]): string {
  return `(async () => {
  const urls = ${JSON.stringify(urls)};
  const out = [];
  for (const url of urls) {
    try {
      // credentials: 'include' is the reason this runs in the page rather than
      // in Node — session cookies and auth headers apply automatically.
      const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      out.push({ url, status: res.status, json, error: json === null ? 'not json' : null });
    } catch (e) {
      out.push({ url, status: 0, json: null, error: String((e && e.message) || e) });
    }
  }
  return out;
})()`;
}

/**
 * Fetch a batch of URLs from `pageUrl`'s context. One navigation for the batch.
 *
 * Answers `[]` rather than throwing on any page-level failure: pagination is an
 * optimisation layered on top of work that is already planned, and spec §3 is
 * explicit that a pagination failure must never lose page 1's items.
 */
export async function fetchInPage(
  browser: IBrowser,
  pageUrl: string,
  urls: string[],
): Promise<FetchedBody[]> {
  if (urls.length === 0) return [];
  try {
    return await browser.evaluate<FetchedBody[]>(pageUrl, buildFetchScript(urls));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-param-fetch.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Teeth check**

Remove the `try/catch` from `fetchInPage`. Re-run. Expected: "degrades to an empty batch when the page context itself fails" FAILS with `net::ERR_ABORTED`. Restore.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/crawl/api-param-fetch.ts packages/scraper/src/crawl/api-param-fetch.test.ts
git commit -m "feat(crawl): batch in-page JSON fetches with the site's own credentials"
```

---

### Task 5: Detection — find, probe, verify, build the config

**Files:**
- Create: `packages/scraper/src/crawl/detect-api-param.ts`
- Test: `packages/scraper/src/crawl/detect-api-param.test.ts`
- Modify: `packages/scraper/src/crawl/detect-pagination.ts`

**Interfaces:**
- Consumes: `findListingApi` (Task 2), `rankCandidates` / `probeUrl` / `templateFor` / `overlapShare` / `REPLAY_MAX_OVERLAP` (Task 3), `fetchInPage` (Task 4), `collectFromJson` (Task 1).
- Produces: `detectApiParam(capture: PageCapture, page1Urls: string[], browser: IBrowser): Promise<{ config: PaginationConfig; tried: string[] } | null>`; `detectPagination` gains a fourth parameter.

Context: this is where the spec's central promise is kept — no candidate is used or cached until a probe has shown it returns different data. All candidates are probed in **one** batch (they are small JSON requests), then judged in rank order in Node.

`detectPagination`'s signature grows. Its existing callers pass `(capture, agent, cached?)`; the new parameter is optional and, when absent, `api-param` is simply skipped — so no existing caller changes behaviour.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/detect-api-param.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { IBrowser, InterceptedRequest, PageCapture } from '@robot/browser';
import { detectApiParam } from './detect-api-param.js';

const PAGE1 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/10000${i}`);
const PAGE2 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/20000${i}`);

const endpoint = 'https://x.example/api/search?kn=py&offset=0&ds=1';

function capture(requests: InterceptedRequest[]): PageCapture {
  return { url: 'https://x.example/list', html: '', interceptedRequests: requests } as unknown as PageCapture;
}

function apiRequest(urls: string[]): InterceptedRequest {
  const json = { results: urls.map((u) => ({ link: u })) };
  return {
    url: endpoint, method: 'GET', resourceType: 'xhr', responseStatus: 200,
    responseHeaders: {}, responseBody: JSON.stringify(json), contentType: 'application/json',
    bodySize: 100, isJson: true, parsedJson: json, timestamp: 0,
  };
}

/** A browser whose in-page fetch answers from a fixed map of url → item URLs. */
function fakeBrowser(byUrl: Record<string, string[]>): IBrowser {
  return {
    evaluate: async (_pageUrl: string, script: string) => {
      const urls: string[] = JSON.parse(script.match(/const urls = (\[.*?\]);/s)![1]!);
      return urls.map((url) => ({
        url,
        status: 200,
        json: byUrl[url] ? { results: byUrl[url]!.map((u) => ({ link: u })) } : { results: [] },
        error: null,
      }));
    },
  } as unknown as IBrowser;
}

describe('detectApiParam', () => {
  it('accepts a parameter whose probe returns a genuinely different page', async () => {
    const browser = fakeBrowser({ 'https://x.example/api/search?kn=py&offset=10&ds=1': PAGE2 });

    const result = await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser);

    expect(result?.config.strategy).toBe('api-param');
    expect(result?.config.paramName).toBe('offset');
    expect(result?.config.step).toBe(10);
    expect(result?.config.apiTemplate).toBe('https://x.example/api/search?kn=py&offset={N}&ds=1');
    expect(result?.config.itemsPath).toBe('results');
    expect(result?.config.urlPath).toBe('link');
  });

  it('REJECTS a parameter whose probe returns page 1 again', async () => {
    // The AbeBooks bug, as a test — and the fixture has to make every probe come
    // back FULL of page 1's items, not empty. An empty probe is rejected earlier,
    // by the `probeIds.length === 0` check, so a fixture that returns nothing
    // would pass this test with the overlap guard deleted. It must be the overlap
    // guard, and only the overlap guard, that says no here.
    const browser = fakeBrowser({
      'https://x.example/api/search?kn=py&offset=10&ds=1': PAGE1,
      'https://x.example/api/search?kn=py&offset=1&ds=1': PAGE1,
    });

    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser)).toBeNull();
  });

  it('answers null when every probe comes back empty', async () => {
    // The neighbouring guard, kept honest separately: an endpoint that returns no
    // items for the next page tells us nothing, and must not be read as "verified".
    const browser = fakeBrowser({});

    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser)).toBeNull();
  });

  it('falls back to the other step for the same parameter before discarding it', async () => {
    // offset+10 (the page size) returns page 1 again; offset+1 is what this
    // (unusual) API actually wants. The parameter is right; the step was not.
    const browser = fakeBrowser({
      'https://x.example/api/search?kn=py&offset=10&ds=1': PAGE1,
      'https://x.example/api/search?kn=py&offset=1&ds=1': PAGE2,
    });

    const result = await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser);

    expect(result?.config.paramName).toBe('offset');
    expect(result?.config.step).toBe(1);
  });

  it('answers null when no intercepted response is the listing API', async () => {
    expect(await detectApiParam(capture([]), PAGE1, fakeBrowser({}))).toBeNull();
  });

  it('answers null when the page context fails entirely', async () => {
    const broken = { evaluate: async () => { throw new Error('nav failed'); } } as unknown as IBrowser;
    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, broken)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/detect-api-param.test.ts`
Expected: FAIL — cannot resolve `./detect-api-param.js`.

- [ ] **Step 3: Implement**

Create `packages/scraper/src/crawl/detect-api-param.ts`:

```typescript
// Detect API pagination by PROVING it, not by guessing it.
//
// The HTML path picks a parameter by name and finds out whether it was right
// from item counts, days later, if a human notices. Here the answer is one small
// JSON fetch away, so the parameter is never used — and never cached — until a
// probe has shown it returns different data.

import type { IBrowser, PageCapture, PaginationConfig } from '@robot/browser';
import { collectFromJson } from './api-identifiers.js';
import { findListingApi } from './find-listing-api.js';
import {
  rankCandidates, probeUrl, templateFor, overlapShare, REPLAY_MAX_OVERLAP,
} from './api-param-candidates.js';
import { fetchInPage } from './api-param-fetch.js';

export type ApiParamDetection = {
  config: PaginationConfig;
  /** Every candidate probed, for the warning when none verifies. */
  tried: string[];
};

export async function detectApiParam(
  capture: PageCapture,
  page1Urls: string[],
  browser: IBrowser,
): Promise<ApiParamDetection | null> {
  const match = findListingApi(capture.interceptedRequests ?? [], page1Urls);
  if (!match) return null;

  const page1Ids = collectFromJson(match.request.parsedJson, match.itemsPath, match.urlPath);
  const pageSize = page1Ids.length;
  if (pageSize === 0) return null;

  const candidates = rankCandidates(match.request.url, pageSize);
  if (candidates.length === 0) return null;

  // One batch for every candidate: they are small JSON requests, and issuing
  // them together costs one navigation instead of one per hypothesis.
  const probes = candidates.map((c) => probeUrl(match.request.url, c));
  const bodies = await fetchInPage(browser, capture.url ?? match.request.url, probes);
  const byUrl = new Map(bodies.map((b) => [b.url, b]));

  const tried: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const body = byUrl.get(probes[i]!);
    tried.push(`${candidate.paramName}+${candidate.step}`);
    if (!body || body.error !== null || body.json === null) continue;
    if (body.status < 200 || body.status >= 300) continue;

    const probeIds = collectFromJson(body.json, match.itemsPath, match.urlPath);
    if (probeIds.length === 0) continue;
    // The load-bearing line: a probe that hands back page 1's items is a wrong
    // hypothesis, however well-formed its response.
    if (overlapShare(page1Ids, probeIds) > REPLAY_MAX_OVERLAP) continue;

    return {
      config: {
        strategy: 'api-param',
        apiTemplate: templateFor(match.request.url, candidate.paramName),
        paramName: candidate.paramName,
        step: candidate.step,
        itemsPath: match.itemsPath,
        urlPath: match.urlPath,
      },
      tried,
    };
  }

  return null;
}
```

Then make it the first rung in `packages/scraper/src/crawl/detect-pagination.ts`. Add to the imports:

```typescript
import type { IBrowser } from '@robot/browser';
import { detectApiParam } from './detect-api-param.js';
```

Widen `PaginationDetection['source']` to include `'api-param'`, and change the signature and body:

```typescript
export async function detectPagination(
  capture: PageCapture,
  agent: PaginationAgent | null,
  cached?: PaginationConfig | null,
  /**
   * Supplied only by callers that have page 1's detail URLs and a browser — i.e.
   * planRun. When absent, api-param is skipped and this behaves exactly as
   * before, so no existing caller changes.
   */
  api?: { browser: IBrowser; page1Urls: string[] },
): Promise<PaginationDetection> {
  if (cached) return { config: cached, source: 'cache' };

  // First rung: the cheapest and the best-verified. No page load beyond one
  // navigation, no AI, and an answer demonstrated rather than inferred.
  if (api && api.page1Urls.length > 0) {
    const apiParam = await detectApiParam(capture, api.page1Urls, api.browser);
    if (apiParam) return { config: apiParam.config, source: 'api-param' };
  }

  const mechanical = detectPaginationFromHtml(capture.html ?? '', capture.url);
  if (mechanical) return { config: mechanical, source: 'mechanical' };
  // ... rest unchanged
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/detect-api-param.test.ts src/crawl/detect-pagination.test.ts`
Expected: PASS — 5 new tests, and the existing `detect-pagination` tests still green because the new parameter is optional.

- [ ] **Step 5: Teeth check**

Delete the `overlapShare(...) > REPLAY_MAX_OVERLAP` guard. Re-run. Expected: "REJECTS a parameter whose probe returns page 1 again" FAILS, because a bogus config is now returned — and "answers null when every probe comes back empty" must still PASS, since a different guard rejects that one.

This is the single most important teeth check in the plan — it is the AbeBooks bug. If it does not fail, stop and report.

Then delete the `probeIds.length === 0` check instead and re-run. Expected: "answers null when every probe comes back empty" FAILS, and the overlap test still passes. Restore.

Two guards sit next to each other here, and each must be shown to reject on its own. An earlier draft of this plan gave the overlap test an empty-probe fixture, so the length check rejected it first and the overlap guard could have been deleted with the suite green — the AbeBooks regression test proving nothing about AbeBooks.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/crawl/detect-api-param.ts packages/scraper/src/crawl/detect-api-param.test.ts packages/scraper/src/crawl/detect-pagination.ts
git commit -m "feat(crawl): api-param detection, proven by probe before use"
```

---

### Task 6: Walk the API in planRun

**Files:**
- Modify: `packages/scraper/src/crawl/plan-run.ts` (the pagination block; `walkPages` becomes a dispatcher)
- Test: `packages/scraper/src/crawl/plan-run-api-param.test.ts`

**Interfaces:**
- Consumes: `fetchInPage` (Task 4), `collectFromJson` (Task 1), `detectPagination`'s new `api` parameter (Task 5), `DETAIL_URL_FIELD`.
- Produces: nothing new; `walkPages(config)` keeps returning `{ gained: number; budgetStopped: boolean }`.

Context — **why this is a small change.** `plan-run.ts` already has the whole apparatus: verification (`gained > 0`), the bounded stale retry, cache write, the thin-walk warning, the overwrite warning. All of it keys off `walkPages(config) → { gained, budgetStopped }`. So `api-param` needs exactly one thing: a walker with that same signature. Do **not** restructure the surrounding block.

Page URLs come from `apiTemplate` with `{N}` replaced by `from + step * n`. The starting value is not stored on the config, so pages are generated from `step * n` beginning at page 2 — that is `step * 1`, `step * 2`, … which matches what `probeUrl` verified (`from + step`, with `from` being page 1's value, normally 0 or 1). Where `from` is not 0, the first template value equals `from + step` by construction of `templateFor`, because the template replaces the parameter wholesale.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/plan-run-api-param.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { PaginationConfig } from '@robot/browser';
import { planRun } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import { apiParamDeps, apiParamRequest, API_CONFIG } from './plan-run-api-param.fixtures.js';

describe('planRun — walking an api-param config', () => {
  it('enumerates detail URLs out of paged JSON without a page load per page', async () => {
    const deps = apiParamDeps({
      cachedConfig: API_CONFIG,
      pages: [
        ['https://listing.example/p/200001', 'https://listing.example/p/200002'],
        ['https://listing.example/p/300001'],
      ],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    expect(detailUrls).toContain('https://listing.example/p/200001');
    expect(detailUrls).toContain('https://listing.example/p/300001');
    // One evaluate for the whole walk — not one per page, and no browser.crawl().
    expect(deps.evaluateCalls).toHaveLength(1);
    expect(deps.crawlCalls).toHaveLength(0);
  });

  it('substitutes {N} with the value the probe verified', async () => {
    const deps = apiParamDeps({ cachedConfig: API_CONFIG, pages: [['https://listing.example/p/200001']] });

    await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    // step is 2 in API_CONFIG, so page 2 asks for offset=2 and page 3 for offset=4.
    expect(deps.fetchedUrls[0]).toContain('offset=2');
    expect(deps.fetchedUrls[1]).toContain('offset=4');
  });

  it('a page that returns nothing new ends the walk and caches nothing', async () => {
    const deps = apiParamDeps({ cachedConfig: null, detected: API_CONFIG, pages: [[]] });

    await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
  });
});
```

Create the fixture module `packages/scraper/src/crawl/plan-run-api-param.fixtures.ts`, modelled on the existing `plan-run-pagination.fixtures.ts` (read it first and match its shape — same `fakeDeps` idea, same `saved` recording, same `PlanRunRequest` construction). It must expose:

- `API_CONFIG: PaginationConfig` — `{ strategy: 'api-param', apiTemplate: 'https://listing.example/api?kn=py&offset={N}', paramName: 'offset', step: 2, itemsPath: 'results', urlPath: 'link' }`
- `apiParamRequest(budget)` — same shape as `fakeRequest` there, with one input row.
- `apiParamDeps({ cachedConfig, detected, pages })` — a `PlanRunDeps` whose `browser.evaluate` returns one `FetchedBody` per requested URL, serving `pages[n]` for the nth fetched URL, and which records `evaluateCalls`, `fetchedUrls`, `crawlCalls` and `saved`.

**`API_CONFIG` uses `step: 2` deliberately.** A step of 1 would make `offset=2` for page 2 indistinguishable from a page counter, and the second test would pass under a bug that ignored `step` entirely.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-api-param.test.ts`
Expected: FAIL — `browser.crawl` is called (the current `walkPages` has no `api-param` branch), so `crawlCalls` is not empty and no detail URLs are enumerated.

- [ ] **Step 3: Implement**

In `plan-run.ts`, add the imports:

```typescript
import { fetchInPage } from './api-param-fetch.js';
import { collectFromJson } from './api-identifiers.js';
```

Rename the existing `walkPages` body to `walkHtmlPages` (identical code, identical return type), add the JSON walker beside it, and make `walkPages` the dispatcher:

```typescript
      /**
       * Walk an api-param config: fetch pages 2..maxPages as JSON in ONE page
       * context, and feed each page's URLs through the same `absorb` the HTML
       * walk uses — so dedupe, the item cap and the stop reasons behave
       * identically no matter which strategy produced the URLs.
       */
      const walkApiPages = async (config: PaginationConfig): Promise<{ gained: number; budgetStopped: boolean }> => {
        const before = detailCount();
        const { apiTemplate, step, itemsPath, urlPath } = config;
        if (!apiTemplate || !step || itemsPath === undefined || urlPath === undefined) {
          return { gained: 0, budgetStopped: false };
        }
        const urls: string[] = [];
        for (let page = 2; page <= budget.maxPages; page++) {
          urls.push(apiTemplate.replace('{N}', String(step * (page - 1))));
        }
        const bodies = await fetchInPage(deps.browser, start.url, urls);

        let budgetStopped = false;
        for (let i = 0; i < bodies.length; i++) {
          const body = bodies[i]!;
          if (body.error !== null || body.json === null) break;
          const pageUrls = collectRowUrls(body.json, itemsPath, urlPath);
          if (pageUrls.length === 0) break;
          const pageNumber = i + 2;
          items.push({
            kind: 'listing', url: body.url, inputIndex: start.inputIndex,
            inputValues: start.inputValues, listingValues: {}, pageNumber,
          });
          const stop = absorb(pageUrls.map((u) => ({ [DETAIL_URL_FIELD]: u })), body.url, pageNumber);
          if (stop !== null) {
            budgetStopped = stop === 'budget';
            break;
          }
        }
        return { gained: detailCount() - before, budgetStopped };
      };

      const walkPages = (config: PaginationConfig) =>
        (config.strategy === 'api-param' ? walkApiPages(config) : walkHtmlPages(config));
```

Add this module-level helper beside `THIN_WALK_SHARE` — `collectFromJson` returns identifiers, and the walk needs whole URLs:

```typescript
/** The raw URL strings at `itemsPath[].urlPath`, in order. */
function collectRowUrls(json: unknown, itemsPath: string, urlPath: string): string[] {
  const items = getPath(json, itemsPath);
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const item of items) {
    const raw = getPath(item, urlPath);
    if (typeof raw === 'string' && raw.length > 0) out.push(raw);
  }
  return out;
}
```

…importing `getPath` from `./api-identifiers.js` alongside `collectFromJson`. (`collectFromJson` stays imported because detection uses it; if the linter reports it unused here, drop it from this file's import and keep `getPath`.)

Finally, pass page 1's URLs and the browser into detection so `api-param` can run. `page1Urls` is the detail URLs page 1 produced for this input — derive it from the rows already extracted, immediately before the `detectPagination` call:

```typescript
      const page1Urls = listingRows
        .map((row) => row[DETAIL_URL_FIELD])
        .filter((u): u is string => typeof u === 'string');
      const pagination = capture
        ? await detectPagination(capture, deps.agent as PaginationAgent | null, cachedPagination, {
            browser: deps.browser, page1Urls,
          })
        : { config: null, source: 'none' as const };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-api-param.test.ts src/crawl/plan-run-pagination.test.ts`
Expected: PASS — the new file, and every existing pagination test still green.

- [ ] **Step 5: Teeth check**

Change the dispatcher to always call `walkHtmlPages`. Re-run. Expected: all three new tests FAIL. Restore.

Then change the URL generation to `String(page - 1)` (ignoring `step`). Expected: "substitutes {N} with the value the probe verified" FAILS with `offset=1` where `offset=2` was expected. Restore.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
pnpm --filter @robot/dashboard exec tsc --noEmit
git add packages/scraper/src/crawl/plan-run.ts packages/scraper/src/crawl/plan-run-api-param.test.ts packages/scraper/src/crawl/plan-run-api-param.fixtures.ts
git commit -m "feat(crawl): planRun walks an api-param config as JSON"
```

---

### Task 7: The offline end-to-end gate

**Files:**
- Modify: `packages/scraper/src/__fixtures__/serve.ts`
- Test: `packages/scraper/src/crawl/api-param-fixture.test.ts`

**Interfaces:**
- Consumes: `serveFixturePages` and `ServedSite` from the fixture server; `detectApiParam` (Task 5); `PlaywrightBrowser`.
- Produces: `ServedPage` gains an optional `contentType`, so the same server serves HTML and JSON.

Context — **why this is possible at all.** An in-page `fetch` needs a real origin with real cookies. `setContentEvaluate` has neither. The fixture HTTP server built on 2026-08-21 for the multi-page walk gives us both: serve the listing page and its JSON API from the same origin, and the whole api-param path runs offline, for free, in real Chromium.

Keep `serveFixturePages`'s existing behaviour exactly — HTML remains the default so the multi-page gate is untouched.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/api-param-fixture.test.ts`:

```typescript
// Tier 1: does api-param actually work against a real origin?
//
// The unit tests fake the fetch. This one serves a listing page and its JSON API
// over real HTTP and drives real Chromium, so the in-page fetch, the credentials
// and the same-origin behaviour are the real ones.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { serveFixturePages, type ServedSite } from '../__fixtures__/serve.js';
import { detectApiParam } from './detect-api-param.js';

const PAGE1 = ['/p/1000001', '/p/1000002', '/p/1000003', '/p/1000004'];
const PAGE2 = ['/p/2000001', '/p/2000002', '/p/2000003', '/p/2000004'];

const body = (urls: string[]) => JSON.stringify({ results: urls.map((u) => ({ link: u })) });

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([
    { path: '/list', html: '<html><body>listing</body></html>' },
    { path: '/api?kn=py&offset=0', html: body(PAGE1), contentType: 'application/json' },
    { path: '/api?kn=py&offset=4', html: body(PAGE2), contentType: 'application/json' },
    // The wrong-step probe: offset bumped by 1 re-serves page 1's window.
    { path: '/api?kn=py&offset=1', html: body(PAGE1), contentType: 'application/json' },
  ]);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await site?.close(); }
});

describe('api-param against a real origin', () => {
  it('verifies the paging parameter by fetching, in the page, over real HTTP', async () => {
    const capture = {
      url: `${site.baseUrl}/list`,
      html: '',
      interceptedRequests: [{
        url: `${site.baseUrl}/api?kn=py&offset=0`,
        method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
        responseBody: body(PAGE1), contentType: 'application/json', bodySize: 100,
        isJson: true, parsedJson: JSON.parse(body(PAGE1)), timestamp: 0,
      }],
    } as unknown as Parameters<typeof detectApiParam>[0];

    const result = await detectApiParam(capture, PAGE1, browser);

    expect(result?.config.paramName).toBe('offset');
    expect(result?.config.step).toBe(4);
    expect(result?.config.apiTemplate).toBe(`${site.baseUrl}/api?kn=py&offset={N}`);
    // The probe really was fetched from the page, not from Node.
    expect(site.requests).toContain('/api?kn=py&offset=4');
  }, 60_000);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-param-fixture.test.ts`
Expected: FAIL — `contentType` is not a property of `ServedPage`, and the JSON is served as `text/html`, so the in-page `JSON.parse` still succeeds but `tsc` rejects the fixture. Confirm the type error is what you see.

- [ ] **Step 3: Implement**

In `packages/scraper/src/__fixtures__/serve.ts`, extend the type and use it:

```typescript
export type ServedPage = {
  /** Path INCLUDING any query string, e.g. "/list?page=2" — matched exactly. */
  path: string;
  /** The response body. Named `html` because that is what it is for every HTML fixture. */
  html: string;
  /**
   * Defaults to HTML. Set to `application/json` to serve an API endpoint from the
   * SAME origin as the pages — which is what makes an in-page `fetch` behave like
   * the site's own, cookies and all.
   */
  contentType?: string;
};
```

and in the handler, replace the fixed content-type header:

```typescript
    res.writeHead(200, { 'content-type': page.contentType ?? 'text/html; charset=utf-8' });
    res.end(page.html);
```

changing the map to hold the whole `ServedPage` rather than just its `html`:

```typescript
  const byPath = new Map(pages.map((p) => [p.path, p]));
  // ...
    const page = byPath.get(path);
    if (page === undefined) { /* 404 branch unchanged */ }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/api-param-fixture.test.ts src/crawl/multi-page-walk-fixture.test.ts`
Expected: PASS — the new gate, and the existing multi-page gate unaffected.

- [ ] **Step 5: Teeth check**

Change the `/api?kn=py&offset=4` fixture to serve `body(PAGE1)`. Re-run. Expected: the test FAILS because nothing verifies and `detectApiParam` answers null — the AbeBooks bug, caught end to end over real HTTP. Restore.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/__fixtures__/serve.ts packages/scraper/src/crawl/api-param-fixture.test.ts
git commit -m "test(crawl): Tier 1 gate for api-param over a real origin"
```

---

### Task 8: Live proof and docs

**Files:**
- Modify: `docs/handoff.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: everything above.

This task makes real requests to a live site. **Plan only — it fetches listing pages and JSON, never a detail page.** Cost is roughly $0–0.60. Do not raise a budget beyond what step 1 sets, and do not re-run a step for a better-looking result.

- [ ] **Step 1: Pick a target and set a page-bound budget**

Use `abebooks-pagination`. Its HTML pagination is known-broken (`deriveTemplate` pages the `ds` filter), which makes it the ideal test of whether `api-param` takes precedence and does better. Set `max_items` high so `max_pages` is the binding cap, and record the previous value:

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "update sources set budget = '{\"mode\":\"first_n\",\"max_items\":60,\"max_pages\":3}'::jsonb where slug='abebooks-pagination' returning slug, budget;"
```

- [ ] **Step 2: Plan, and capture what detection chose**

```bash
pnpm --filter @robot/api exec tsx src/crawl-plan.ts abebooks-pagination
```

Record the run id and the pagination `source` line. **Either outcome is a result worth having:**
- `source: api-param` — AbeBooks exposes a usable JSON endpoint and the probe verified it. Record the config.
- Falls through to `mechanical` — no intercepted response passed the multiplicity bars. Record *why* from the warnings; that is data about the thresholds, not a failure of the task.

- [ ] **Step 3: Verify against the database**

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "select kind, page_number, count(*) from run_items where run_id='<run-id>' group by 1,2 order by 1,2;"
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "select pagination_config from domain_intelligence where domain like '%abebooks%' and page_type='listing';"
```

If `api-param` won, expect detail items spread across more than one `page_number` **and a per-page count close to page 1's** — the 30/2/1 shape is what a broken pager looks like, and its absence is the headline result. If the counts are thin again, say so plainly.

- [ ] **Step 4: Restore the budget**

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "update sources set budget = '<the value recorded in step 1>'::jsonb where slug='abebooks-pagination';"
```

- [ ] **Step 5: Record what is true**

Update `docs/handoff.md` and `docs/roadmap.md` with the real numbers and the strategy that won. Do not claim anything the run did not demonstrate. Specifically:

- If detection fell through to the HTML path, `api-param` is **implemented and gated offline but not live-proven** — say exactly that.
- The thresholds (3, 0.5, 0.5) were picked from reasoning, not traffic. Record the observed share from this run whatever the outcome, because it is the first real data point.
- **Cursor APIs, POST/GraphQL and DOM-driven infinite scroll remain unsupported.** State it, so "API pagination delivered" cannot be read as covering them. The DOM-scroll cycle is what covers the rest.

- [ ] **Step 6: Commit**

```bash
git add docs/handoff.md docs/roadmap.md
git commit -m "docs: api-param pagination, and what the live run showed"
```

---

## Done when

- `pnpm -r test`, `pnpm typecheck --force` and `pnpm --filter @robot/dashboard exec tsc --noEmit` are clean, and the leaked-row query returns 0.
- A listing API is identified by carrying page 1's URLs, and a recommendations-shaped decoy is rejected.
- A paging parameter is never used or cached until a probe has shown it returns different data — proven by a test that fails when the overlap guard is removed.
- A wrong step is rejected and the right step accepted for the same parameter.
- `planRun` walks an `api-param` config as JSON, feeding the same `absorb` the HTML walk uses, with no `browser.crawl()` call.
- Tier 1 exercises the whole path against a real origin, and fails when the fixture makes page 2 re-serve page 1.
- The docs say exactly what the live run demonstrated, including if it fell through.

## Not in this plan

Cursor-based APIs; POST and GraphQL endpoints; DOM-driven infinite scroll and load-more; fixing `deriveTemplate`'s parameter choice on the HTML path; an operator surface for `pagination_config`; strengthening the HTML path's `gained > 0` gate.
