# Backups from more than one source — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A field's certified backups come from different sources — at most two paths per source, five in all, today's first path first — so one changed API response no longer empties a column, and ops shows which response each API path reads.

**Architecture:** `@robot/scraper` learns which intercepted response an API path reads on a proof page (`apiResponseOf`, the same body `resolveStructured` takes its value from), groups the safe API paths by the response they share on a page, and, for a one-layout field, picks backups round-robin across sources (`spreadAcrossSources`); every certified API path is stamped with its source's name (`container`). The domain-cache shortcut in `runVerification` stops replaying a one-source certification and searches again, free. `@robot/api`'s `ops.website` passes `container` through; `@robot/app`'s ops page shows it under each API path and warns only when every path reads one source, of any kind. No migration: results are jsonb.

**Tech Stack:** TypeScript ESM; vitest; Drizzle + Postgres; tRPC v11; TanStack Start + React 19 + Tailwind v4; Playwright (the scraper's Chromium tests, the route smoke).

**Spec:** `docs/superpowers/specs/2026-10-20-one-source-backups-design.md`

**Planner's notes:** seven tasks. Engine first: Task 1 (`apiResponseOf`), Task 2 (certify spreads; needs 1), Task 3 (the cache shortcut; needs 2). Then Task 4 (ops API; needs 2 for the type) and Task 5 (ops app; independent of 4 at the code level — the app has its own `OpsFieldPath` type, which already has `container`). Task 6 is a read-only check on real stored captures (needs 1–3). Task 7 is the merge gate. Tasks 4 and 5 touch disjoint files and may run in parallel after Task 2. Line numbers were read on `feat/one-source-backups` @ `dfc9fe1` and are approximate — find the code by the quoted text.

## Global Constraints

- The rule (spec §3): `MAX_PATHS_PER_SOURCE = 2`, `MAX_CERTIFIED_PATHS = 5` (unchanged). Order: every confirmed path first in rank order (never dropped by the per-source cap, counted toward its source), then round 1 — each source's best remaining path, sources in the order of their best path in the ranked list — then round 2 — each source's next; keep the first five.
- One source (spec §3.1): an API response named by its address's origin + path, query and fragment ignored; all JSON-LD; all meta; the page's HTML (all XPaths). Two API paths are one source when, on some proof page they both read, they read the same response.
- The spread applies to the one-layout result only. A cover (`greedyCover`) is unchanged.
- `certified[0]` never changes for the same candidates; no cell, flag or fail reason changes (spec §6.1–6.2).
- `container` is set on certified API paths only, from the proof pages just evaluated; any `container` a candidate brings in is replaced or dropped. Path identity (`pathId`, `sameVerified`), extraction and the domain store ignore it.
- Customer copy: nothing new for customers; never render `container` outside `/ops`. Staff copy: the warning text stays exactly `All backups read the same response — if it changes, they fail together`; the new per-path line is `from {host}{pathname}`. No money, no model names anywhere new (memory `customer-copy-no-internals`).
- ESM. Relative imports carry `.js` in `@robot/scraper` and `@robot/api`; none in `@robot/app`. `@robot/app` imports nothing from `@robot/scraper` except `@robot/scraper/normalize`, and nothing from `@robot/api` (the existing `import type { AppRouter }` in `lib/trpc.ts` stays).
- Tests per package, one file at a time while working: `cd packages/<pkg> && npx vitest run <file>`. Chromium files (`run-verification.test.ts`, anything that launches `PlaywrightBrowser`) one at a time. Never `pnpm -r test`. The api tests need Postgres (Docker, `127.0.0.1:5432`); `.env` is present in the worktree (gitignored; never stage it).
- Commits by explicit path. Never `git add -A` / `git add .`. Never stage `packages/app/src/routeTree.gen.ts`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No paid APIs: no keyed Verify, no Extract, no judge. Task 6 runs with no agent and writes nothing.
- Never start, stop or restart Marko's dev servers (:3000, :4000). The only servers this plan starts are the isolated pair on :4100/:3100 (Task 7), stopped by port afterwards.
- Work only in `C:\Users\Marko\Documents\projects\robot-platform-onesource` (bash: `/c/Users/Marko/Documents/projects/robot-platform-onesource`) on `feat/one-source-backups`. Task 6 only *reads* the main checkout's capture files and Marko's database.
- Files in this repo are CRLF. Edit with tools that keep line endings; new files may be LF (git normalises).

## Review Focus

1. The same dot path present in two JSON bodies on one page (a cart response and a product response both with `price`): the response it reads must be the *first* body where it resolves, the one extraction takes the value from — never the last, never a non-JSON request. → Task 1 tests "names the first body where the path reads, as resolveStructured does" and "skips non-JSON and unparsed requests".
2. Three or more confirmed paths from one response: all stay, first, in rank order; other sources still get places after them. → Task 2 test "confirmed paths beyond two from one response are all kept, first".
3. A candidate that arrives with a stale `container` (drift re-certifies with the old certified paths as candidates; a cached path) must leave with the fresh one (API) or none (other kinds). → Task 2 test "a candidate's stale container is replaced on API paths and dropped on others".
4. A site with no structured data (XPaths only): two XPaths are kept, not five, and ops warns for the field. → Task 2 test "XPaths only: two kept" and Task 5 test "fires for two XPaths".
5. A product id in the response's path (`/products/1.json` on page 1, `/products/2.json` on page 2): siblings must still be one source. → Task 2 Ikea test asserts both API paths carry `https://www.ikea.com/my/en/products/1.json`.

---

### Task 1: Which response an API path reads (`@robot/scraper`) — spec §3.1

**Files:**
- Modify: `packages/scraper/src/verify/search-structured.ts` (after `resolveStructured`, end of file `:~141`)
- Test: `packages/scraper/src/verify/search-structured.test.ts`

**Interfaces:**
- Consumes: `getByDotPath` (already imported in this file), `PathContext` type.
- Produces:
  - `export function responseKey(url: string): string` — `origin + pathname`; for an unparsable address, the text before the first `?` or `#`.
  - `export function apiResponseOf(capture: Pick<PageCapture, 'interceptedRequests' | 'pageVariant'>, path: string): string | null` — the `responseKey` of the first JSON body (in capture order, `isJson && parsedJson !== null`) where `getByDotPath(body, path, { pageVariant })` is non-empty; `null` when none.

- [ ] **Step 1: Write the failing tests**

In `packages/scraper/src/verify/search-structured.test.ts`, change the import line

```ts
import { searchStructured, resolveStructured, searchStructuredByConcept } from './search-structured.js';
```

to

```ts
import { searchStructured, resolveStructured, searchStructuredByConcept, apiResponseOf, responseKey } from './search-structured.js';
```

and append at the end of the file:

```ts
describe('apiResponseOf (spec 2026-10-20 one-source §3.1)', () => {
  const json = (url: string, parsedJson: unknown) => ({ url, method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true, responseBody: '{}', parsedJson });
  const text = (url: string) => ({ url, method: 'POST', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'text/plain', bodySize: 1, timestamp: 0, isJson: false, responseBody: 'ok', parsedJson: null });
  const at = (...requests: unknown[]) => ({ interceptedRequests: requests as unknown as typeof capture.interceptedRequests });

  it('names the response by origin and path, query and fragment ignored', () => {
    expect(apiResponseOf(at(json('https://api.salesitem.ingka.com/availabilities/ru/us?itemNos=80275887&expand=StoresList#x', { price: 79.99 })), 'price'))
      .toBe('https://api.salesitem.ingka.com/availabilities/ru/us');
  });

  it('names the first body where the path reads, as resolveStructured does', () => {
    const c = at(
      json('https://shop.example/api/cart', { total: 0 }),
      json('https://shop.example/api/product/1', { price: 129.99 }),
      json('https://shop.example/api/recommendations', { price: 5 }),
    );
    expect(apiResponseOf(c, 'price')).toBe('https://shop.example/api/product/1');
    expect(resolveStructured({ ...c, structuredData: capture.structuredData }, 'api', 'price')).toBe(129.99);
  });

  it('skips non-JSON and unparsed requests, and a body where the path is empty', () => {
    const c = at(text('https://shop.example/telemetry'), json('https://shop.example/api/a', { price: '' }), json('https://shop.example/api/b', { price: null }), json('https://shop.example/api/c', { price: 9 }));
    expect(apiResponseOf(c, 'price')).toBe('https://shop.example/api/c');
  });

  it('is null when no body has the path', () => {
    expect(apiResponseOf(at(json('https://shop.example/api/a', { name: 'x' })), 'price')).toBeNull();
    expect(apiResponseOf(at(), 'price')).toBeNull();
  });

  it('reads a [page] path through the capture\'s page variant', () => {
    const pageVariant = pageVariantFrom('https://shop.example/p/1?size=M', null, {});
    const c = { ...at(json('https://shop.example/api/p/1', { variants: [{ size: 'S', price: 1 }, { size: 'M', price: 2 }] })), pageVariant };
    expect(apiResponseOf(c, 'variants[page].price')).toBe('https://shop.example/api/p/1');
  });

  it('responseKey keeps an unparsable address up to its query', () => {
    expect(responseKey('/relative/path?x=1#y')).toBe('/relative/path');
    expect(responseKey('https://a.example/x/y?z=1')).toBe('https://a.example/x/y');
  });
});
```

(The `[page]` case relies on `pickPageEntry` matching the `size=M` query to the entry with `size: 'M'`, as `page-variant-match.test.ts` does. If the matcher needs a `variesBy` hint for this shape, change the body to `{ variesBy: ['size'], variants: [...] }` — the point of the test is that `pageVariant` is passed through.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper && npx vitest run src/verify/search-structured.test.ts`
Expected: FAIL — `apiResponseOf` / `responseKey` are not exported.

- [ ] **Step 3: Implement**

Append to `packages/scraper/src/verify/search-structured.ts`:

```ts
/**
 * Spec 2026-10-20 one-source §3.1: a response's name — its address's origin and path. The query
 * (product ids, cache-busters, options) and the fragment are not part of it: the same endpoint with
 * another query changes, moves or disappears as one.
 */
export function responseKey(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split(/[?#]/)[0]!;
  }
}

/**
 * Spec 2026-10-20 one-source §3.1: the response an API path reads on this page — the first JSON body,
 * in capture order, where it resolves to a value, which is exactly the body `resolveStructured` takes
 * the value from — by `responseKey`. Null when no body has it.
 */
export function apiResponseOf(capture: Pick<PageCapture, 'interceptedRequests' | 'pageVariant'>, path: string): string | null {
  const ctx = { pageVariant: capture.pageVariant };
  for (const r of capture.interceptedRequests) {
    if (!r.isJson || r.parsedJson === null) continue;
    if (nonEmpty(getByDotPath(r.parsedJson, path, ctx))) return responseKey(r.url);
  }
  return null;
}
```

(`nonEmpty`, `getByDotPath` and `PageCapture` are already in scope in this file.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper && npx vitest run src/verify/search-structured.test.ts`
Expected: PASS (all, the existing ones included).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add packages/scraper/src/verify/search-structured.ts packages/scraper/src/verify/search-structured.test.ts
git commit -m "feat(scraper): name the response an API path reads on a page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Certification spreads backups across sources (`@robot/scraper`) — spec §3.1–§3.3, §3.5

**Files:**
- Modify: `packages/scraper/src/verify/types.ts:~55-56` (`CertifiedPath`)
- Modify: `packages/scraper/src/verify/constants.ts:~3` (after `MAX_CERTIFIED_PATHS`)
- Modify: `packages/scraper/src/verify/certify.ts` (imports `:2,5`; new helpers after `dedupe` `:~83`; `certifyCandidates` `:~318-331`)
- Modify: `packages/scraper/src/verify/index.ts:7` (exports)
- Test: `packages/scraper/src/verify/certify.test.ts`

**Interfaces:**
- Consumes: `apiResponseOf(capture, path): string | null` (Task 1).
- Produces:
  - `CertifiedPath` gains `container?: string`.
  - `export const MAX_PATHS_PER_SOURCE = 2;` (re-exported by `export * from './constants.js'`).
  - `export function sourceKey(p: Pick<CertifiedPath, 'source' | 'container'>): string` — `api ${container ?? ''}` for API, else the source (`json-ld`, `meta`, `xpath`).
  - `export function readsOneSource(paths: ReadonlyArray<Pick<CertifiedPath, 'source' | 'container'>>): boolean` — two or more paths, one `sourceKey`.
  - `export function spreadAcrossSources<T>(ranked: T[], keyOf: (c: T) => string, pinned: (c: T) => boolean): T[]`.
  - All three exported from `@robot/scraper` (`verify/index.ts`). Task 3 uses `readsOneSource`; Task 6 uses `readsOneSource` and `sourceKey`.

- [ ] **Step 1: Write the failing tests**

In `packages/scraper/src/verify/certify.test.ts`, change the import

```ts
import { certify, checkedPages, expectedWithDefault, gatherCandidates, isNotOnWebsite, markPaths, qualifiesForWeak, rankCertified, type CaptureLike } from './certify.js';
```

to

```ts
import { certify, checkedPages, expectedWithDefault, gatherCandidates, isNotOnWebsite, markPaths, qualifiesForWeak, rankCertified, readsOneSource, sourceKey, spreadAcrossSources, type CaptureLike } from './certify.js';
```

and append at the end of the file:

```ts
describe('spreadAcrossSources (spec 2026-10-20 one-source §3.2)', () => {
  const key = (s: string) => s[0]!;
  it('the best first, then each other source\'s best, then each source\'s second; five at most', () => {
    expect(spreadAcrossSources(['a1', 'a2', 'a3', 'b1', 'c1', 'c2', 'c3', 'd1'], key, () => false)).toEqual(['a1', 'b1', 'c1', 'd1', 'a2']);
  });
  it('one source: its two best', () => {
    expect(spreadAcrossSources(['a1', 'a2', 'a3', 'a4', 'a5'], key, () => false)).toEqual(['a1', 'a2']);
  });
  it('pinned paths first, never capped, and counted toward their source', () => {
    expect(spreadAcrossSources(['a1', 'a2', 'a3', 'b1', 'b2'], key, (c) => c === 'a2' || c === 'a3')).toEqual(['a2', 'a3', 'b1', 'b2']);
    expect(spreadAcrossSources(['a3', 'a1', 'a2', 'b1', 'c1', 'c2', 'd1'], key, (c) => c === 'a3')).toEqual(['a3', 'b1', 'c1', 'd1', 'a1']);
  });
});

describe('sourceKey / readsOneSource (spec 2026-10-20 one-source §3.1)', () => {
  const p = (source: 'api' | 'json-ld' | 'meta' | 'xpath', container?: string) => ({ source, ...(container ? { container } : {}) });
  it('one API response per container; JSON-LD, meta and the page are one source each', () => {
    expect(sourceKey(p('api', 'https://a.example/x'))).toBe('api https://a.example/x');
    expect(sourceKey(p('api'))).toBe('api ');
    expect(sourceKey(p('json-ld'))).toBe('json-ld');
    expect(sourceKey(p('xpath'))).toBe('xpath');
  });
  it('two or more paths, all one source', () => {
    expect(readsOneSource([p('api', 'https://a.example/x')])).toBe(false);
    expect(readsOneSource([p('api', 'https://a.example/x'), p('api', 'https://a.example/x')])).toBe(true);
    expect(readsOneSource([p('api', 'https://a.example/x'), p('api', 'https://a.example/y')])).toBe(false);
    expect(readsOneSource([p('xpath'), p('xpath')])).toBe(true);
    expect(readsOneSource([p('api', 'https://a.example/x'), p('json-ld')])).toBe(false);
  });
});

describe('certify — backups from more than one source (spec 2026-10-20 one-source)', () => {
  const price = { key: 'price', name: 'Price', type: 'money' as const, description: 'the price', concept: 'price' };
  const I = ['https://www.ikea.com/my/en/p/kivik-1/', 'https://www.ikea.com/my/en/p/glostad-2/', 'https://www.ikea.com/my/en/p/hemlingby-3/'];
  const P = [1295, 349, 59];
  const req = (url: string, parsedJson: unknown) => ({ url, method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true, responseBody: '{}', parsedJson });
  // Ikea's price response (2026-09-29 audit): five sibling keys hold the price; the product id is in the address's path.
  const pip = (i: number) => req(`https://www.ikea.com/my/en/products/${i + 1}.json?c=7`, { price: P[i], priceExclTax: P[i], priceNumeral: P[i], priceExclTaxNumeral: P[i], revampPrice: { integer: P[i] } });
  const page = (i: number, extra: { requests?: unknown[]; ld?: Record<string, unknown>[]; meta?: Record<string, string>; html?: string } = {}): CaptureLike => ({
    url: I[i]!, html: extra.html ?? '<html></html>',
    structuredData: { ldJson: extra.ld ?? [{ '@type': 'Product', offers: { price: `${P[i]}.00` } }], nextData: null, initialState: null, meta: extra.meta ?? {} },
    interceptedRequests: (extra.requests ?? [pip(i)]) as unknown as CaptureLike['interceptedRequests'],
  });
  const pages = (extra: (i: number) => Parameters<typeof page>[1] = () => ({})) => Object.fromEntries(I.map((u, i) => [u, page(i, extra(i))]));
  const exp = Object.fromEntries(I.map((u, i) => [u, String(P[i])]));
  const api = (path: string) => ({ source: 'api' as const, path, transform: 'identity' as const });
  const ld = (path: string) => ({ source: 'json-ld' as const, path, transform: 'identity' as const });
  const meta = (path: string) => ({ source: 'meta' as const, path, transform: 'identity' as const });
  const xp = (path: string) => ({ source: 'xpath' as const, path, transform: 'identity' as const });
  const SIBLINGS = ['price', 'priceExclTax', 'priceNumeral', 'priceExclTaxNumeral', 'revampPrice.integer'].map(api);
  const PIP1 = 'https://www.ikea.com/my/en/products/1.json';
  const deps = { evalXPaths: async () => ({}) };
  const ids = (ps: ReadonlyArray<{ source: string; path: string }>) => ps.map((p) => `${p.source} ${p.path}`);

  it('Ikea\'s price: five API siblings and JSON-LD → the best API path, JSON-LD, the second API sibling; every cell as before', async () => {
    const r = await certify({ field: price, expected: exp, captures: pages(), candidates: [...SIBLINGS, ld('offers.price')] }, deps);
    expect(ids(r.certified)).toEqual(['api price', 'json-ld offers.price', 'api priceExclTax']);
    // Review Focus 5: a product id in the response's path does not split the siblings.
    expect(r.certified[0]!.container).toBe(PIP1);
    expect(r.certified[2]!.container).toBe(PIP1);
    expect('container' in r.certified[1]!).toBe(false);
    for (const u of I) expect(r.cells[u]).toMatchObject({ status: 'pass', path: { source: 'api', path: 'price' } });
    expect(readsOneSource(r.certified)).toBe(false);
  });

  it('two API responses, JSON-LD and meta → one from each, then the first source\'s second; five at most', async () => {
    const r = await certify({
      field: price, expected: exp,
      captures: pages((i) => ({
        requests: [pip(i), req(`https://www.ikea.com/my/en/offers?item=${i + 1}`, { offer: { amount: P[i], value: P[i] } })],
        ld: [{ '@type': 'Product', offers: { price: `${P[i]}.00`, lowPrice: `${P[i]}.00` } }],
        meta: { 'og:price:amount': String(P[i]), 'product:price:amount': String(P[i]) },
      })),
      candidates: [...SIBLINGS, api('offer.amount'), api('offer.value'), ld('offers.price'), ld('offers.lowPrice'), meta('og:price:amount'), meta('product:price:amount')],
    }, deps);
    expect(ids(r.certified)).toEqual(['api price', 'api offer.value', 'json-ld offers.price', 'meta og:price:amount', 'api priceExclTax']);
    expect(r.certified.map((p) => p.container)).toEqual([PIP1, 'https://www.ikea.com/my/en/offers', undefined, undefined, PIP1]);
  });

  it('one response and nothing else: its two best paths', async () => {
    const r = await certify({ field: price, expected: exp, captures: pages(() => ({ ld: [] })), candidates: SIBLINGS }, deps);
    expect(ids(r.certified)).toEqual(['api price', 'api priceExclTax']);
    expect(readsOneSource(r.certified)).toBe(true);
  });

  it('XPaths only: two kept', async () => {
    // evalXPaths reads the page's html as every XPath's value, so each XPath reads the price on its page.
    const caps = pages((i) => ({ requests: [], ld: [], html: `${P[i]}.00` }));
    const evalXPaths = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, html]));
    const r = await certify({ field: price, expected: exp, captures: caps, candidates: [xp('//*[@id="t"]'), xp('//h1'), xp('//div/h1')] }, { evalXPaths });
    expect(ids(r.certified)).toEqual(['xpath //h1', 'xpath //div/h1']);
  });

  it('confirmed paths beyond two from one response are all kept, first', async () => {
    const confirmed = [{ source: 'api' as const, path: 'priceNumeral' }, { source: 'api' as const, path: 'priceExclTax' }, { source: 'api' as const, path: 'revampPrice.integer' }];
    const r = await certify({ field: price, expected: exp, captures: pages(), confirmed, candidates: [...SIBLINGS, ld('offers.price')] }, deps);
    expect(ids(r.certified)).toEqual(['api priceExclTax', 'api priceNumeral', 'api revampPrice.integer', 'json-ld offers.price']);
  });

  it('a candidate\'s stale container is replaced on API paths and dropped on others', async () => {
    const r = await certify({
      field: price, expected: exp, captures: pages(),
      candidates: [{ ...api('price'), container: 'https://stale.example/x' }, { ...ld('offers.price'), container: 'https://stale.example/y' }],
    }, deps);
    expect(r.certified[0]!.container).toBe(PIP1);
    expect('container' in r.certified[1]!).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper && npx vitest run src/verify/certify.test.ts`
Expected: FAIL — `readsOneSource`, `sourceKey`, `spreadAcrossSources` are not exported (the import fails, so every test in the file fails to load).

- [ ] **Step 3: Implement the type and the constant**

In `packages/scraper/src/verify/types.ts`, replace

```ts
/** `provenOn` is set only when a field needed more than one layout (spec 2026-09-17 §3): the proof pages this path was correct on. Absent on a one-layout result, so those stay byte-for-byte what they were. Ignored by extraction and by path identity. */
export type CertifiedPath = { source: CertifiedSource; path: string; transform: Transform; provenOn?: string[] };
```

with

```ts
/**
 * `provenOn` is set only when a field needed more than one layout (spec 2026-09-17 §3): the proof pages this path was correct on. Absent on a one-layout result, so those stay byte-for-byte what they were. Ignored by extraction and by path identity.
 * `container` (spec 2026-10-20 one-source §3.5) is set on a certified API path only: the name (origin + path) of the response it reads on the proof pages, shared by every API path that reads the same response. Ignored by extraction, by path identity and by the domain store; absent on results certified before it existed.
 */
export type CertifiedPath = { source: CertifiedSource; path: string; transform: Transform; provenOn?: string[]; container?: string };
```

In `packages/scraper/src/verify/constants.ts`, after `export const MAX_CERTIFIED_PATHS = 5;` add:

```ts
/** Spec 2026-10-20 one-source §3: a one-layout field keeps at most this many certified paths from any one source (confirmed paths excepted). */
export const MAX_PATHS_PER_SOURCE = 2;
```

- [ ] **Step 4: Implement the helpers in `certify.ts`**

Change the imports at the top of `packages/scraper/src/verify/certify.ts`:

```ts
import { MAX_CERTIFIED_PATHS } from './constants.js';
```
→
```ts
import { MAX_CERTIFIED_PATHS, MAX_PATHS_PER_SOURCE } from './constants.js';
```

```ts
import { resolveStructured, searchStructured } from './search-structured.js';
```
→
```ts
import { apiResponseOf, resolveStructured, searchStructured } from './search-structured.js';
```

After the `dedupe` function (`function dedupe(candidates: CandidatePath[]): CandidatePath[] { … }`), add:

```ts
/** Spec 2026-10-20 one-source §3.1: one API response (by `container`; none recorded reads as one shared response), the page's JSON-LD, its meta tags, or its HTML. */
export function sourceKey(p: Pick<CertifiedPath, 'source' | 'container'>): string {
  return p.source === 'api' ? `api ${p.container ?? ''}` : p.source;
}

/** Two or more paths, all from one source (spec 2026-10-20 one-source §3.2, §3.4). */
export function readsOneSource(paths: ReadonlyArray<Pick<CertifiedPath, 'source' | 'container'>>): boolean {
  return paths.length >= 2 && new Set(paths.map(sourceKey)).size === 1;
}

/**
 * Spec 2026-10-20 one-source §3.2: from a ranked list, the pinned (confirmed) paths first, in their
 * order and never capped; then round 1 takes the best remaining path of every source holding fewer
 * than one, round 2 the next of every source holding fewer than two — sources in the order of their
 * best path in `ranked` — and the first MAX_CERTIFIED_PATHS are kept. So the first path is always
 * `ranked[0]`, and no source holds more than MAX_PATHS_PER_SOURCE unpinned places.
 */
export function spreadAcrossSources<T>(ranked: T[], keyOf: (c: T) => string, pinned: (c: T) => boolean): T[] {
  const out = ranked.filter(pinned);
  const queues = new Map<string, T[]>();
  for (const c of ranked) {
    const k = keyOf(c);
    if (!queues.has(k)) queues.set(k, []);
    if (!pinned(c)) queues.get(k)!.push(c);
  }
  const held = (k: string) => out.filter((c) => keyOf(c) === k).length;
  for (let round = 1; round <= MAX_PATHS_PER_SOURCE; round++) {
    for (const [k, queue] of queues) {
      if (queue.length > 0 && held(k) < round) out.push(queue.shift()!);
    }
  }
  return out.slice(0, MAX_CERTIFIED_PATHS);
}

/**
 * Spec 2026-10-20 one-source §3.1: each API path's source name. On every page a path reads, the
 * response it reads (`apiResponseOf`); two paths reading the same response on the same page are one
 * source — so siblings group even when a product id sits in the response's path — and a source is
 * named by the response its best-ranked member reads on the first page it reads. A path that reads
 * nothing anywhere gets no name.
 */
function responseLabels(ranked: CandidatePath[], urls: string[], captures: Record<string, CaptureLike | null>): Map<string, string> {
  const reads = new Map<string, Array<[string, string]>>(); // pathId → [page url, response] per page it reads
  for (const c of ranked) {
    if (c.source !== 'api' || reads.has(pathId(c))) continue;
    reads.set(pathId(c), urls.flatMap((u): Array<[string, string]> => {
      const cap = captures[u];
      const r = cap ? apiResponseOf(cap, c.path) : null;
      return r ? [[u, r]] : [];
    }));
  }
  const labels = new Map<string, string>();
  for (const [id, mine] of reads) {
    const peer = [...labels.keys()].find((q) => reads.get(q)!.some(([u, r]) => mine.some(([u2, r2]) => u === u2 && r === r2)));
    const label = peer !== undefined ? labels.get(peer) : mine[0]?.[1];
    if (label !== undefined) labels.set(id, label);
  }
  return labels;
}
```

- [ ] **Step 5: Use them in `certifyCandidates`**

In `certifyCandidates`, right after the line that defines `safe`

```ts
  const safe = candidates.filter((c) => readsSomething(c) && capturedUrls.length > 0 && capturedUrls.every((u) => { const e = evals.get(pathId(c))?.[u]; return !!e && (e.correct || e.empty); }));
```

add:

```ts
  // Spec 2026-10-20 one-source §3.1: which source each safe path reads — API paths by the response they share on a page.
  const labels = responseLabels(rank(safe), capturedUrls, captures);
  const keyOf = (c: CandidatePath) => sourceKey({ source: c.source, container: labels.get(pathId(c)) });
  const pinned = (c: CandidatePath) => isConfirmedPath(c, input.confirmed);
```

Replace

```ts
  const oneLayout = complete ? rank(oneLayoutPool).slice(0, MAX_CERTIFIED_PATHS) : [];
```

with

```ts
  // Spec 2026-10-20 one-source §3.2: backups spread across sources, at most two from any one; the first path is today's.
  const oneLayout = complete ? spreadAcrossSources(rank(oneLayoutPool), keyOf, pinned) : [];
```

Replace

```ts
  const certified: CertifiedPath[] = oneLayout.length > 0
    ? oneLayout
    : cover.map((c) => ({ ...c, provenOn: capturedUrls.filter((u) => !absentSet.has(u) && isProven(c, u)) }));
```

with

```ts
  // Spec 2026-10-20 one-source §3.5: every certified API path names its source; a container a candidate brought along is replaced or dropped.
  const stamp = (p: CandidatePath): CertifiedPath => {
    const base: CertifiedPath = { source: p.source, path: p.path, transform: p.transform, ...(p.provenOn ? { provenOn: p.provenOn } : {}) };
    const label = p.source === 'api' ? labels.get(pathId(p)) : undefined;
    return label !== undefined ? { ...base, container: label } : base;
  };
  const certified: CertifiedPath[] = (oneLayout.length > 0
    ? oneLayout
    : cover.map((c) => ({ ...c, provenOn: capturedUrls.filter((u) => !absentSet.has(u) && isProven(c, u)) }))).map(stamp);
```

Nothing else in the function changes (the cells read `certified`, whose first path is the same as before).

- [ ] **Step 6: Export from the package**

In `packages/scraper/src/verify/index.ts`, replace

```ts
export { rankCertified, qualifiesForWeak, markPaths, isNotOnWebsite, type CaptureLike, type CandidatePath } from './certify.js';
```

with

```ts
export { rankCertified, qualifiesForWeak, markPaths, isNotOnWebsite, sourceKey, readsOneSource, spreadAcrossSources, type CaptureLike, type CandidatePath } from './certify.js';
```

- [ ] **Step 7: Run the new tests, then fix the old assertions that now carry a container**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper && npx vitest run src/verify/certify.test.ts`
Expected: the new tests PASS. One existing assertion fails because a certified API path now carries its response: "the identity reading of a confirmed path certifies although the cache offers a different transform for it" (`:~214`). Change

```ts
    expect(r.certified).toEqual([{ source: 'api', path: 'price', transform: 'identity' }]);
```

to

```ts
    expect(r.certified).toEqual([{ source: 'api', path: 'price', transform: 'identity', container: 'https://s.example/1/api' }]);
```

Re-run: expected PASS for the whole file. Any other failure there is a real regression of spec §6 (a changed first path, cell or cover): fix the code, not the test.

- [ ] **Step 8: Run the rest of the verify suite and type-check**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper
for f in src/verify/*.test.ts; do npx vitest run "$f" || echo "FAILED: $f"; done
npx tsc --noEmit
```

Expected: PASS except, possibly, assertions that compare a certified API path with `toEqual` and no `container`. `run-verification.test.ts` has two (`:~63` `item.priceCents`, `:~364` `item.rating`) — Task 3 updates them; leave them for Task 3 and confirm they are the only reasons that file fails. If any other file fails on a `container` alone, add `container: '<the response's origin + path>'` to its expectation in this task and list it in the commit message. `transfer-marks.test.ts`'s JSON-LD image-array case is a known flake: re-run it alone.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add packages/scraper/src/verify/types.ts packages/scraper/src/verify/constants.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/index.ts packages/scraper/src/verify/certify.test.ts
git commit -m "feat(scraper): certified backups come from more than one source, at most two from each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any other test file Step 8 changed to the `git add` line by its path.)

---

### Task 3: A cached one-source certification is searched again (`@robot/scraper`) — spec §3.4

**Files:**
- Modify: `packages/scraper/src/verify/run-verification.ts:4` (import), `:~196` (the shortcut's condition)
- Test: `packages/scraper/src/verify/run-verification.test.ts` (Chromium file: run it alone)

**Interfaces:**
- Consumes: `readsOneSource(paths): boolean` (Task 2).
- Produces: no new names. Behaviour: the cache shortcut is kept only when its certified paths do not read one source with two or more paths.

- [ ] **Step 1: Write the failing tests**

Append to `packages/scraper/src/verify/run-verification.test.ts` (it already imports `vi`, `IBrowser`, `VerificationSet`, `SchemaDefinitionField`, `U`, and defines `emptyCapture`):

```ts
describe('runVerification — a cached certification that reads one source (spec 2026-10-20 one-source §3.4)', () => {
  const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'price', concept: 'price' };
  const P = [1295, 349, 59];
  const capture = (url: string, i: number) => ({
    ...emptyCapture(url),
    structuredData: { ldJson: [{ '@type': 'Product', offers: { price: `${P[i]}.00` } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [{ url: `https://www.ikea.com/my/en/products/${i + 1}.json`, method: 'GET', status: 200, isJson: true, parsedJson: { price: P[i], priceNumeral: P[i] } }],
  }) as unknown as import('@robot/browser').PageCapture;
  const caps = Object.fromEntries(U.map((u, i) => [u, capture(u, i)]));
  const priceSet: VerificationSet = { urls: U, expected: { price: Object.fromEntries(U.map((u, i) => [u, String(P[i])])) } };
  const apiPrice = { source: 'api' as const, path: 'price', transform: 'identity' as const };
  const apiNumeral = { source: 'api' as const, path: 'priceNumeral', transform: 'identity' as const };
  const ldPrice = { source: 'json-ld' as const, path: 'offers.price', transform: 'identity' as const };
  const noSearch = { setContentEvaluate: async () => { throw new Error('searched the pages although the cached certification reads two sources'); } } as unknown as IBrowser;
  const ids = (ps: ReadonlyArray<{ source: string; path: string }>) => ps.map((p) => `${p.source} ${p.path}`);

  it('two cached paths from one response: the pages are searched again, free, and JSON-LD joins as a backup', async () => {
    const search = vi.fn(async () => []);
    const run = await runVerification({ fields: [price], verificationSet: priceSet }, {
      browser: { setContentEvaluate: search } as unknown as IBrowser, agent: null, captures: caps,
      cachedPaths: async () => [apiPrice, apiNumeral],
    });
    expect(search).toHaveBeenCalled();
    expect(ids(run.outcome.fields.price!.certified)).toEqual(['api price', 'json-ld offers.price', 'api priceNumeral']);
    expect(run.outcome.aiCalls).toBe(0);
  });

  it('a cached pair from two sources is kept without a search', async () => {
    const run = await runVerification({ fields: [price], verificationSet: priceSet }, { browser: noSearch, agent: null, captures: caps, cachedPaths: async () => [apiPrice, ldPrice] });
    expect(ids(run.outcome.fields.price!.certified)).toEqual(['api price', 'json-ld offers.price']);
  });

  it('a single cached path is still kept without a search', async () => {
    const run = await runVerification({ fields: [price], verificationSet: priceSet }, { browser: noSearch, agent: null, captures: caps, cachedPaths: async () => [apiPrice] });
    expect(ids(run.outcome.fields.price!.certified)).toEqual(['api price']);
  });
});
```

- [ ] **Step 2: Run the file to see the first new test fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper && npx vitest run src/verify/run-verification.test.ts`
Expected: FAIL — "two cached paths from one response…" (`search` was never called; certified is `['api price', 'api priceNumeral']`). Also failing, from Task 2: `:~63` and `:~364` (a `container` on an API path).

- [ ] **Step 3: Implement**

In `packages/scraper/src/verify/run-verification.ts`, change the import

```ts
import { certify, checkedPages, expectedWithDefault, gatherCandidates, isVolatilePath, markPaths, type CandidatePath, type CaptureLike } from './certify.js';
```

to

```ts
import { certify, checkedPages, expectedWithDefault, gatherCandidates, isVolatilePath, markPaths, readsOneSource, type CandidatePath, type CaptureLike } from './certify.js';
```

and replace

```ts
      if (r.certified.length > 0 && !r.certified.some(isVolatilePath) && !(namedVariant && r.certified.some(readsFixedVariant))) result = r;
```

with

```ts
      // Spec 2026-10-20 one-source §3.4: nor one that reads one source with two or more paths (Ikea's API
      // siblings): search again — free, the AI is asked only when nothing certifies — so another source can
      // join as a backup. Where the pages offer no other source the result is the same pair.
      if (r.certified.length > 0 && !r.certified.some(isVolatilePath) && !(namedVariant && r.certified.some(readsFixedVariant)) && !readsOneSource(r.certified)) result = r;
```

- [ ] **Step 4: Update the two assertions that now carry a container**

In `run-verification.test.ts`:

`:~63`
```ts
    expect(run.outcome.fields.price!.certified[0]).toEqual({ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' });
```
→
```ts
    expect(run.outcome.fields.price!.certified[0]).toEqual({ source: 'api', path: 'item.priceCents', transform: 'cents_to_units', container: 'https://shop.example/api/product/1' });
```

`:~364`
```ts
    expect(run.outcome.fields.rating!.certified).toEqual([stable]);
```
→
```ts
    expect(run.outcome.fields.rating!.certified).toEqual([{ ...stable, container: 'https://shop.example/api/product/1' }]);
```

- [ ] **Step 5: Run the file to see it pass**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper && npx vitest run src/verify/run-verification.test.ts`
Expected: PASS (the shop-example test at `:~59` still finds the `span[@class="now"]` XPath among price's paths: price reads one API response, JSON-LD, meta and the page, so it keeps API, JSON-LD, meta and two XPaths, as before).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/run-verification.test.ts
git commit -m "feat(scraper): a cached certification that reads one source is searched again

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ops passes each API path's response through (`@robot/api`) — spec §3.5, §4

**Files:**
- Modify: `packages/api/src/routers/ops.ts:~283-296` (the `paths: certified.map(…)` block in `website`)
- Test: `packages/api/src/routers/ops.test.ts:~294-356` (the "gets its fields' certified paths in try order…" test)

**Interfaces:**
- Consumes: `CertifiedPath.container?: string` (Task 2).
- Produces: each entry of `ops.website`'s `fields[].paths` may carry `container: string` (absent when the stored path has none). The app's `OpsFieldPath` already declares `container?: string`.

- [ ] **Step 1: Change the test to expect the container**

In `packages/api/src/routers/ops.test.ts`, in the test whose title starts `"gets its fields' certified paths in try order`:

1. Rename the title to `"gets its fields' certified paths in try order, named with the contract's own field names, with real run stats, 0/0 for a path the domain store never recorded, and the response a certified API path reads (its container), never the domain store's lastUrl"`.
2. Replace
```ts
      const pricePrimary: CertifiedPath = { source: 'api', path: 'product.price', transform: 'identity' };
```
with
```ts
      const pricePrimary: CertifiedPath = { source: 'api', path: 'product.price', transform: 'identity', container: `https://${host}/api/product` };
```
3. Change the domain store row's `lastUrl` in the same test from `` `https://${host}/api/product` `` to `` `https://${host}/p/1` `` (a product page, as `lastUrl` really is), so the test proves the container comes from the certified path.
4. Replace
```ts
        { source: 'api', path: 'product.price', uses: 6, hits: 5 },
```
with
```ts
        { source: 'api', path: 'product.price', container: `https://${host}/api/product`, uses: 6, hits: 5 },
```
(The JSON-LD backup and `nameField` keep their expectations: no `container`.)

- [ ] **Step 2: Run the test to see it fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/api && npx vitest run src/routers/ops.test.ts -t "certified paths in try order"`
Expected: FAIL — the API path has no `container`.

- [ ] **Step 3: Implement**

In `packages/api/src/routers/ops.ts`, inside `paths: certified.map((p) => { … })`, replace

```ts
            // Final review I2: `stat.lastUrl` is the product *page* the path
            // last hit on, not the intercepted API request's URL — nothing
            // today records that reliably, so `container` stays unset and
            // `oneSourceWarning`'s documented fallback applies (every `api`
            // path of a field counts as one response).
            return {
              source: p.source,
              path: p.path,
              ...(p.provenOn ? { provenOn: p.provenOn } : {}),
```

with

```ts
            // Spec 2026-10-20 one-source §3.5: certify names the response each
            // API path reads (`container`). `stat.lastUrl` is the product
            // *page* the path last hit on and is never used for it (final
            // review I2). A result certified before the change has none, and
            // `oneSourceWarning` reads that as one shared response.
            return {
              source: p.source,
              path: p.path,
              ...(p.provenOn ? { provenOn: p.provenOn } : {}),
              ...(p.container ? { container: p.container } : {}),
```

- [ ] **Step 4: Run the ops tests and the verify tests, and type-check**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/api
npx vitest run src/routers/ops.test.ts
npx vitest run --no-file-parallelism src/verify
npx tsc --noEmit
```

Expected: PASS. A `src/verify` test that fails only because a certified API path now carries `container` (it ran the real `certify`): add the `container` to its expectation, in this task, and add the file to the commit.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add packages/api/src/routers/ops.ts packages/api/src/routers/ops.test.ts
git commit -m "feat(api): ops shows the response each certified API path reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ops shows the response and warns only for one source (`@robot/app`) — spec §4

**Files:**
- Modify: `packages/app/src/lib/ops-view.ts:~247-267` (`ONE_SOURCE_WARNING`'s doc, `oneSourceWarning`; add `responseText`)
- Modify: `packages/app/src/routes/_app/ops/websites/$sourceId.tsx` (import list `:~13-32`; the path row `:~512-530`)
- Test: `packages/app/src/lib/ops-view.test.ts` (`describe('oneSourceWarning')` `:~280`)

**Interfaces:**
- Consumes: `OpsFieldPath.container?: string` (already declared in `ops-view.ts:~159`), filled by Task 4.
- Produces: `export function responseText(container: string): string` → `from {host}{pathname}`; `oneSourceWarning` keeps its signature.

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/lib/ops-view.test.ts`, add `responseText,` to the import list (alphabetical, after `provenText,`), and inside `describe('oneSourceWarning', () => { … })`, after the last `it(…)`, add:

```ts
  it('fires for two meta paths, and for two XPaths (spec 2026-10-20 one-source §4)', () => {
    expect(oneSourceWarning([path({ source: 'meta' }), path({ source: 'meta' })])).toBe(ONE_SOURCE_WARNING);
    expect(oneSourceWarning([path({ source: 'xpath' }), path({ source: 'xpath' })])).toBe(ONE_SOURCE_WARNING);
  });

  it('is null for one response plus the page, and for meta plus JSON-LD', () => {
    expect(oneSourceWarning([path({ source: 'api', container: 'https://x.example/api/a' }), path({ source: 'xpath' })])).toBeNull();
    expect(oneSourceWarning([path({ source: 'meta' }), path({ source: 'json-ld' })])).toBeNull();
  });

  it('two API paths of one response and a third of another is not one source', () => {
    const a = 'https://x.example/api/a';
    expect(oneSourceWarning([path({ source: 'api', container: a }), path({ source: 'api', container: 'https://x.example/api/b' }), path({ source: 'api', container: a })])).toBeNull();
  });
```

and after that `describe` block add:

```ts
describe('responseText', () => {
  it('names the response without its scheme', () => {
    expect(responseText('https://www.ikea.com/my/en/products/1.json')).toBe('from www.ikea.com/my/en/products/1.json');
  });
  it('shows an unparsable container as it is', () => {
    expect(responseText('/api/product')).toBe('from /api/product');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/app && npx vitest run src/lib/ops-view.test.ts`
Expected: FAIL — `responseText` is not exported; the meta/XPath case returns null.

- [ ] **Step 3: Implement in `ops-view.ts`**

Replace

```ts
/**
 * The one-source warning (Global Constraints): a field with more than one
 * certified path, every one of them `api` or every one `json-ld`. For
 * `api`, `container` (the intercepted request's url) is what tells two
 * backups apart — a path with none recorded reads as the same response as
 * any other (the brief's own rule), so the warning fires unless at least
 * two DIFFERENT containers are on record.
 */
export function oneSourceWarning(paths: ReadonlyArray<Pick<OpsFieldPath, 'source' | 'container'>>): string | null {
  if (paths.length < 2) return null;
  const allApi = paths.every((p) => p.source === 'api');
  const allJsonLd = paths.every((p) => p.source === 'json-ld');
  if (!allApi && !allJsonLd) return null;
  if (allApi) {
    const containers = new Set(paths.map((p) => p.container).filter((c): c is string => !!c));
    if (containers.size > 1) return null;
  }
  return ONE_SOURCE_WARNING;
}
```

with

```ts
/**
 * The source a path reads (spec 2026-10-20 one-source §3.1, mirrored from
 * `@robot/scraper`'s `sourceKey`, which the app may not import): one API
 * response, told apart by `container` — a path with none recorded (a result
 * certified before 2026-10-20) reads as the same response as any other —
 * or the page's JSON-LD, its meta tags, or its HTML.
 */
function sourceOf(p: Pick<OpsFieldPath, 'source' | 'container'>): string {
  return p.source === 'api' ? `api ${p.container ?? ''}` : p.source;
}

/**
 * The one-source warning: a field with two or more certified paths, all
 * read from one source. Certification keeps at most two paths per source
 * (spec 2026-10-20), so on a result certified since then this fires only
 * when the proof pages offered one source; on an older result it is the
 * all-API / all-JSON-LD case it always was.
 */
export function oneSourceWarning(paths: ReadonlyArray<Pick<OpsFieldPath, 'source' | 'container'>>): string | null {
  if (paths.length < 2) return null;
  return new Set(paths.map(sourceOf)).size === 1 ? ONE_SOURCE_WARNING : null;
}

/** Under an API path on the ops website page: the response it reads, without its scheme (spec 2026-10-20 one-source §4). */
export function responseText(container: string): string {
  try {
    const u = new URL(container);
    return `from ${u.host}${u.pathname}`;
  } catch {
    return `from ${container}`;
  }
}
```

- [ ] **Step 4: Show it on the path row**

In `packages/app/src/routes/_app/ops/websites/$sourceId.tsx`, add `responseText,` to the `../../../../lib/ops-view` import list after `provenText,`. In the path row, replace

```tsx
        <span className="text-sm text-muted-foreground">{provenText(path.provenOn, proofUrls)}</span>
      </div>
```

with

```tsx
        {path.container ? (
          <span title={path.container} className="max-w-[320px] truncate font-mono text-xs text-muted-foreground">
            {responseText(path.container)}
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground">{provenText(path.provenOn, proofUrls)}</span>
      </div>
```

- [ ] **Step 5: Run the tests and type-check**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/app
npx vitest run src/lib/ops-view.test.ts
npx tsc --noEmit
```

Expected: PASS, no type errors. If `tsc` or a dev build regenerated `src/routeTree.gen.ts`, restore it: `git checkout -- src/routeTree.gen.ts`.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add packages/app/src/lib/ops-view.ts packages/app/src/lib/ops-view.test.ts "packages/app/src/routes/_app/ops/websites/\$sourceId.tsx"
git commit -m "feat(app): ops names each API path's response and warns only when one source is left

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Read-only check on real stored captures — spec §7

**Files:**
- Create: `packages/api/src/scripts/one-source-recertify.ts`
- Create: `docs/testing/results/2026-10-20-one-source/recertify.md`

**Interfaces:**
- Consumes: `runVerification`, `readsOneSource`, `sourceKey`, `CertifiedPath`, `FieldVerification`, `SchemaDefinitionField`, `VerificationSet` from `@robot/scraper`; `readCaptureFile`, `StoredCaptureRef` from `../verify/capture-store.js`; `withBrowserSession` from `../browser-session.js`.
- Produces: a CLI that writes nothing; a results note.

This is the evidence for "certification spreads backups across sources" on real data (Ikea's Price and Product URL, and every other website the old rule flags), free: no agent, no domain store, no live page — each field is certified again on the stored captures of the verification that certified it. It reads Marko's database (select only) and the main checkout's capture files; it writes nothing to either.

- [ ] **Step 1: Write the script**

Create `packages/api/src/scripts/one-source-recertify.ts`:

```ts
// Read-only check (spec 2026-10-20 one-source §7). For every website whose latest completed
// verification certified a field on two or more paths that read one source by the old rule (all
// API, or all JSON-LD), certify that field again on that verification's own stored captures — no
// agent, no domain store, no live page: free — and print the stored paths beside the new ones.
// Select queries only; nothing is written to the database or the capture files.
//
//   cd packages/api && CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures npx tsx src/scripts/one-source-recertify.ts
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { datasets, db, orgs, projects, sources, sourceVerifications } from '@robot/db';
import { readsOneSource, runVerification, sourceKey, type CertifiedPath, type FieldVerification, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { readCaptureFile, type StoredCaptureRef } from '../verify/capture-store.js';

const oldRule = (ps: CertifiedPath[]) => ps.length >= 2 && (ps.every((p) => p.source === 'api') || ps.every((p) => p.source === 'json-ld'));
const label = (p: CertifiedPath) => `${p.source} ${p.path}${p.container ? ` @ ${p.container}` : ''}`;

const withSets = await db
  .select({ id: sources.id, name: sources.name, schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet, project: projects.slug, org: orgs.slug })
  .from(sources)
  .leftJoin(datasets, eq(datasets.id, sources.datasetId))
  .leftJoin(projects, eq(projects.id, datasets.projectId))
  .leftJoin(orgs, eq(orgs.id, projects.orgId))
  .where(isNotNull(sources.verificationSet));

let checked = 0, spread = 0, single = 0, uncertified = 0, skipped = 0;
await withBrowserSession(async (browser) => {
  for (const s of withSets) {
    if (!Array.isArray(s.schemaDefinition)) continue;
    const [latest] = await db
      .select({ results: sourceVerifications.results, captures: sourceVerifications.captures })
      .from(sourceVerifications)
      .where(and(eq(sourceVerifications.sourceId, s.id), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)))
      .orderBy(desc(sourceVerifications.completedAt))
      .limit(1);
    if (!latest) continue;
    const results = latest.results as Record<string, FieldVerification>;
    const fields = (s.schemaDefinition as SchemaDefinitionField[]).filter((f) => oldRule(results[f.key]?.certified ?? []));
    if (fields.length === 0) continue;
    const website = `${s.org ?? '?'}/${s.project ?? '?'}/${s.name}`;
    const set = s.verificationSet as VerificationSet;
    const refs = (latest.captures ?? {}) as Record<string, StoredCaptureRef>;
    const captures: Record<string, PageCapture> = {};
    for (const url of set.urls) {
      const ref = refs[url];
      const c = ref?.captureId ? await readCaptureFile(ref.captureId) : null;
      if (c) captures[url] = c;
    }
    // Every proof page from its stored file, or the field is skipped: a missing one would be captured live.
    if (Object.keys(captures).length !== set.urls.length) {
      skipped += fields.length;
      console.log(`\n${website}: skipped ${fields.length} field(s) — ${set.urls.length - Object.keys(captures).length} stored capture(s) missing`);
      continue;
    }
    const run = await runVerification({ fields, verificationSet: set }, { browser, agent: null, free: true, captures });
    for (const f of fields) {
      checked++;
      const now = run.outcome.fields[f.key]?.certified ?? [];
      if (now.length === 0) uncertified++;
      else if (readsOneSource(now) || now.length === 1) single++;
      else spread++;
      console.log(`\n${website} — ${f.name}`);
      console.log(`  stored: ${results[f.key]!.certified.map(label).join(' | ')}`);
      console.log(`  now:    ${now.map(label).join(' | ') || '(nothing certified on the stored captures)'}`);
      console.log(`  sources now: ${new Set(now.map(sourceKey)).size}`);
    }
  }
});
console.log(`\n${checked} one-source field(s) certified again on stored captures, ${skipped} skipped (captures missing): ${spread} now read two or more sources, ${single} still one source, ${uncertified} certified nothing.`);
process.exit(0);
```

- [ ] **Step 2: Type-check it**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run it**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/api
CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures npx tsx src/scripts/one-source-recertify.ts 2>&1 | tee /tmp/one-source-recertify.txt
```

(Use the scratchpad instead of `/tmp` if the controller has one.) Expected: a block per flagged field; Ikea's Price fields read `api price | json-ld offers.price | api …` (or `… | meta …`) where the stored captures carry JSON-LD or meta with the price; a field whose pages really have one source reads two paths and `sources now: 1`. It must not print any SQL error or write anything (it never calls `insert`/`update`).

If a field "certified nothing" on its own stored captures, that is not this change: the stored captures or expected values have moved since (the stored result is older than the binding). Note it in the results and go on.

- [ ] **Step 4: Write the results note**

Create `docs/testing/results/2026-10-20-one-source/recertify.md`:

```markdown
# Backups from more than one source — read-only check on stored captures (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-one-source-backups-design.md` §7. Script
`packages/api/src/scripts/one-source-recertify.ts`, run from `feat/one-source-backups` @ `<sha>`
against the local database (select only) and the main checkout's capture files. No agent, no domain
store, no live page: $0, nothing written.

## Summary

<the script's last line>

## Fields

<the script's per-field blocks, verbatim, in a fenced block>

## Reading

<two to five sentences: what Ikea's Price became and from which sources; which fields still read one
source and why (the pages offer only that source); any field that certified nothing and why.>
```

Fill the placeholders from the run's output (the `<sha>` is `git rev-parse --short HEAD`).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add packages/api/src/scripts/one-source-recertify.ts docs/testing/results/2026-10-20-one-source/recertify.md
git commit -m "test(api): one-source fields certified again on their stored captures, read-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The merge gate, docs, the merge and the queue (`CLAUDE.md` "Autonomous runs")

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-one-source-backups-design.md` (Status), `docs/handoff.md` (the "Read this first" list item 1, the "Newest" line, a new section before `## The finder reads product links (2026-10-20)`), `CLAUDE.md` (Key Technical Decisions), `docs/queue.md` (after the merge)

**Interfaces:**
- Consumes: every earlier task.
- Produces: a branch that passes the gate, docs that say what shipped, `main` fast-forwarded and pushed, the queue item in **Done**.

- [ ] **Step 1: Every task's tests and reviews are clean; trailers are right**

Confirm each task's review (and fix rounds) ended clean. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` where the script amends only commits whose trailer names another model (memory `subagent-commit-trailers`).

- [ ] **Step 2: Full test run and type-check of every touched package**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/scraper && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/api && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/app && npx vitest run && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up). A Chromium file that times out only in the full run: re-run that file alone; `transfer-marks.test.ts`'s JSON-LD image-array case is a known flake. A real failure blocks the merge: fix it on the branch with a test. Restore `packages/app/src/routeTree.gen.ts` if it changed.

- [ ] **Step 3: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan. Points to press: spec §6 (first path, cells and covers unchanged — compare `certify` before/after on the existing certify tests), the grouping in `responseLabels` (siblings on per-product addresses; a path that reads no common page), `stamp` dropping stale containers, the cache shortcut's new condition (no AI reachable through it: the AI runs only when nothing certifies), and that `container` is rendered nowhere outside `/ops`. No open Critical or Important finding may remain; fix on the branch and re-run Step 2 for the touched packages.

- [ ] **Step 4: The route smoke, from the branch, on an isolated pair**

`@robot/app` and `@robot/api` changed, so (CLAUDE.md gate 4), in the background:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts
```

and, in the background:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

Wait until `curl -s http://localhost:4100/healthz` answers `{"status":"ok"}` and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` answers 200. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
```

Expected: PASS (27 of 27 on `main` before this branch). Stop both servers by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 4100,3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

Then restore what the run wrote: `git checkout -- docs/testing/screens packages/app/src/routeTree.gen.ts` (no screenshot is new in this plan).

- [ ] **Step 5: The live check (gate 5)**

Capture and extraction code are unchanged (extraction still runs the stored paths in order); what changed is which paths certification stores. Task 6's `recertify.md` is the check on real data. If any code in `packages/scraper/src/verify` changed after Task 6 (review fixes), re-run Task 6 Steps 3–4 and commit the new results before going on.

- [ ] **Step 6: Docs**

Note the last code commit: `git log -1 --format=%h -- packages` → `<sha>`.

1. Spec — replace the Status paragraph with: ``**Status:** implemented on `feat/one-source-backups` and merged to `main` on 2026-10-20 (`<sha>`); written under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue item "Backups that all come from one source"), with its plan (`docs/superpowers/plans/2026-10-20-one-source-backups.md`). Read-only check on stored captures: `docs/testing/results/2026-10-20-one-source/recertify.md`.`` Add any deviation the reviews forced as a **Deviations:** sentence.

2. `docs/handoff.md`:
   - In "The next work, in order", replace item 1's text with: `**Backups that all come from one source — done 2026-10-20.** See "Backups from more than one source (2026-10-20)" below: a field keeps at most two certified paths per source; ops names each API path's response and warns only when the pages offer one source. Existing websites keep their paths until their next Verify.`
   - Replace the line starting `**Newest: [The finder reads product links (2026-10-20)]` with two lines: `**Newest: [Backups from more than one source (2026-10-20)](#backups-from-more-than-one-source-2026-10-20).** A field's backups now come from different sources (at most two paths from any one API response, the page's JSON-LD, meta or HTML), so one changed response no longer empties a column; ops shows which response each API path reads. Merged 2026-10-20 after the full gate.` and `**Before it: [The finder reads product links (2026-10-20)](#the-finder-reads-product-links-2026-10-20).**` followed by the rest of the old "Newest" sentence.
   - Insert before `## The finder reads product links (2026-10-20)`:

```markdown
## Backups from more than one source (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-one-source-backups-design.md`, plan
`docs/superpowers/plans/2026-10-20-one-source-backups.md`. Branch `feat/one-source-backups`. Queue item
"Backups that all come from one source" (handoff item 1 since 2026-10-07).

**What changed.**
1. Certification (`certify.ts`, one layout only): at most `MAX_PATHS_PER_SOURCE` = 2 paths per source,
   5 in all; the first path is today's, then each other source's best, then each source's second
   (`spreadAcrossSources`). Confirmed paths stay first and are never capped. Covers are unchanged.
2. A source is one API response (origin + path, query ignored; `apiResponseOf` names the body
   `resolveStructured` reads; paths reading the same body on a proof page are one source, so siblings
   group even with a product id in the address), the page's JSON-LD, its meta tags, or its HTML.
3. Certified API paths carry `container` (the response's name); extraction, path identity and the
   domain store ignore it.
4. The domain-cache shortcut no longer replays a certification that reads one source with two or more
   paths: Verify searches again, free (`run-verification.ts`).
5. Ops: "from {host}{path}" under each API path; the one-source warning fires when every path reads
   one source of any kind (all-meta and all-XPath fields now warn too).

**Proof.** Unit tests (Ikea-shaped pages, two responses, confirmed paths, the cap, stale containers,
the shortcut), the ops API and view tests, the route smoke on an isolated pair, and the read-only
re-certification of every one-source field on its stored captures
(`docs/testing/results/2026-10-20-one-source/recertify.md`: <its summary line>).

**Existing websites.** Unchanged until their next Verify; ops keeps warning on their one-source fields.
Ikea's websites (Acne / Ikea, Competitor prices / Ikea) are among them.

**Open.**
- Extraction still reads an API path from the first body where it resolves, not from its own response.
- The domain store's own five-path cap is by hit rate, not by source.
- A field whose pages offer one source with two paths is searched on every Verify (free, a few
  seconds).
```

3. `CLAUDE.md` — after the "The finder reads product links (2026-10-20)" bullet in Key Technical Decisions:

```markdown
- Backups from more than one source (2026-10-20): a one-layout field keeps at most two certified paths per source (`MAX_PATHS_PER_SOURCE`) and five in all — today's first path, then each other source's best, then each source's second; a source is one API response (origin + path, query ignored; paths reading the same body on a proof page are one), the page's JSON-LD, its meta tags or its HTML; confirmed paths stay first and are never capped; covers are unchanged; a cached certification that reads one source is searched again (free); certified API paths carry `container`, which ops shows, and ops warns only when every path reads one source.
```

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add docs/superpowers/specs/2026-10-20-one-source-backups-design.md docs/handoff.md CLAUDE.md
git commit -m "docs: backups from more than one source — shipped; handoff, decisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Rebase on `main`, fast-forward `main`, push**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git checkout -- packages/app/src/routeTree.gen.ts
git status --short
git fetch origin
git rebase main
```

If `main` moved, re-run Step 2 for the touched packages (and Step 4 if an app/api file on `main` changed). The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean, or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/one-source-backups
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. A refused fast-forward (main moved again) means: rebase again, re-run Steps 2 and 4, try again.

- [ ] **Step 8: The queue item to Done, on `main`**

In the worktree (its branch is now `main`'s head), edit `docs/queue.md`: delete item 1 ("Backups that all come from one source …") from **Next** (leave **Next** empty if it was the only item, with the line `(empty — Marko adds the next item)`); add at the top of **Done**: ``- 2026-10-20 — Backups from more than one source (`<sha>`).`` (the last code commit from Step 6). Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-onesource
git add docs/queue.md
git commit -m "docs(queue): backups from more than one source — done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/one-source-backups
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: `main` at the queue commit, pushed.
