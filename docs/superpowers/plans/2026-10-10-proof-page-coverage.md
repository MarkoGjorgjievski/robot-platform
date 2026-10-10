# Proof-page coverage and "not on this product" — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every passing Verify, a free background check samples twenty products from the listing, runs the certified paths on them, and the Verification tab says per field where they came back empty and why; and a cell marked "Not on this product" makes a path that invents a value there unsafe.

**Architecture:** Part A is a sibling of the drift check: a `coverage_checks` row per check, started fire-and-forget at the end of `runSourceVerification`, run with injectable capture/extract functions so its tests need no browser, summarised by a pure module into per-field lines the tab renders in the drift line's slot. Part B is one new map on the verification set (`absent`), honoured by `checkedPages`/`certify` in the scraper, by `bindingProblems`/`prepareBinding` in the api, and by the board model, the detail bar and the context menu in the app.

**Tech Stack:** TypeScript ESM across the monorepo; Drizzle + Postgres (`@robot/db`); tRPC v11 (`@robot/api`); TanStack Start/Router/Query + React 19 + Tailwind v4 + shadcn (`@robot/app`); vitest; Playwright for the route smoke.

**Spec:** `docs/superpowers/specs/2026-10-10-proof-page-coverage-design.md`

## Global Constraints

- Nothing in this plan calls a model. The coverage check writes only its own `coverage_checks` row: no `captures` rows, no `verificationSet`, no `sources` column, no domain cache, no path hit/miss stats (spec A4, property 1).
- Sample size **20**, spread evenly over the listing's product group in listing order (first link, then every k-th with k = floor(n / 20)); proof pages excluded; fewer than twenty links means all of them (D1).
- The check runs only after a **passing** Verify (D4). Go to Extract is never gated on it (D2).
- A field may be absent on any proof page as long as it has an expected value on **at least two** pages (D3). Blank keeps its meaning ("not checked here") and stays allowed only on pages four to six.
- Copy is exact, from the spec's §5 table: stage lines "Checking 20 more products from the listing…", "Checked 20 more products from the listing: every field was found on all of them.", "2 fields were empty on some of the 20 sampled products — see the rows."; row line "Empty on 11 of 20 sampled products · all 11 list their sizes as variants in the page data"; action "Use as proof page"; cell action "Not on this product"; cell text "not on this product"; row word "not on product 4"; verify fail "found 0 on product 4, but you said it isn't there"; limit "This website has its six proof pages".
- Import style: `.js` suffix on relative imports in browser/scraper/api; none in app. `@robot/app` never imports `@robot/scraper` or `@robot/api` (it re-declares narrowed types).
- Tests per package only, never `pnpm -r test`: `pnpm --filter @robot/scraper test`, `pnpm --filter @robot/api test`, `pnpm --filter @robot/app test`, `pnpm --filter @robot/db test`. One Chromium-heavy process at a time.
- Commits by explicit path (`git add -- <new>`; `git commit -m "…" -- <paths>`), never `git add -A`/`.`; never stage `packages/app/src/routeTree.gen.ts`; every message ends `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never start, stop or restart the dev servers; the live check (Task 11) needs them and asks the controller when they are down.

## Review Focus

1. **A listing with fewer non-proof links than three, or none.** The check runs on what there is and the stage line counts honestly ("Checked 1 more product from the listing…"); with none it ends `done` with zero sampled and the stage line says nothing. → Task 4 (sampler), Task 9 (copy).
2. **A second passing Verify while a check is still running.** One `running` row per website: the new Verify returns `in-progress` and the tab shows the newest row; the first check's result is still shown when it lands. → Task 5.
3. **A sampled page whose shape cannot be read** (no JSON-LD at all, an intercepted-API-only site). Its shape is `{ jsonLdTypes: [], offers: 'none', rating: false, address }` and the explanation falls back to the count when the proof pages share that same emptiness. → Task 2, Task 4.
4. **Marking a cell absent that already carries a mark or a confirmed path.** The mark and the path go with the value, so no stale mark joins certification's candidates. → Task 7.
5. **A field absent on every page but one.** `bindingProblems` refuses the save with "{name}: needs a value on at least two products"; the autosave shows the reason, Verify is not reached. → Task 6.

---

### Task 1: `absent` in certification (`@robot/scraper`)

**Files:**
- Modify: `packages/scraper/src/verify/types.ts` (`VerificationSet.absent`, `FailReason` + `'found_unexpected'`)
- Modify: `packages/scraper/src/verify/certify.ts` (`checkedPages`, `CertifyInput.absent`, the evaluation and the cells)
- Modify: `packages/scraper/src/verify/run-verification.ts` (`fieldHash`, `definitionHash`, the certify calls carry `absent`)
- Modify: `packages/scraper/src/verify/drift-classify.ts:132` (passes `absent` through unchanged: the drift check decides on expected pages only — read the file; if `decidingExpected` is built from `set.expected`, leave `absent` out and say so in a comment)
- Test: `packages/scraper/src/verify/certify.test.ts`, `packages/scraper/src/verify/run-verification.test.ts` (hash cases)

**Interfaces:**
- Produces: `VerificationSet.absent?: Record<string, Record<string, true>>`; `FailReason` gains `'found_unexpected'`; `checkedPages(urls: string[], expected: Record<string, string>, absent?: Record<string, true>): string[]`; `CertifyInput.absent?: string[]` (the urls this field is absent on).

- [ ] **Step 1: Types**

In `packages/scraper/src/verify/types.ts`, inside `VerificationSet` after `paths?`:

```ts
  /** fieldKey → url → true: the customer said this field is not on that product (spec 2026-10-10 §B1). A checked page where the right answer is "nothing". Absent on sets written before it existed. */
  absent?: Record<string, Record<string, true>>;
```

and change `FailReason` to:

```ts
export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch' | 'no_fitting_path' | 'found_unexpected';
```

- [ ] **Step 2: Failing tests in `certify.test.ts`**

Append a describe block (the `cap` helper and `field` are at the top of the file):

```ts
describe('certify — "not on this product" (spec 2026-10-10 §B2)', () => {
  const rating = { key: 'rating', name: 'Rating', type: 'number' as const, description: 'stars', concept: 'rating' };
  // Decathlon: the JSON-LD carries the rating only when the product has one; an api
  // field `stats.averageRating` is 0 for products with none.
  function page(url: string, jsonRating: number | null, apiRating: number): CaptureLike {
    return {
      url, html: '<html></html>',
      structuredData: { ldJson: [jsonRating === null ? { name: 'x' } : { aggregateRating: { ratingValue: jsonRating } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [{ url: `${url}/api`, method: 'GET', resourceType: 'xhr', status: 200, responseBody: JSON.stringify({ stats: { averageRating: apiRating } }) } as never],
    };
  }
  const caps = {
    'https://d.example/1': page('https://d.example/1', 4.39, 4.39),
    'https://d.example/2': page('https://d.example/2', 4.6, 4.6),
    'https://d.example/3': page('https://d.example/3', 4.54, 4.54),
    'https://d.example/4': page('https://d.example/4', null, 0),
  };
  const exp = { 'https://d.example/1': '4.39', 'https://d.example/2': '4.6', 'https://d.example/3': '4.54' };
  const jsonLd = { source: 'json-ld' as const, path: 'aggregateRating.ratingValue', transform: 'identity' as const };
  const api = { source: 'api' as const, path: 'stats.averageRating', transform: 'identity' as const };

  it('checkedPages counts an absent page as checked', () => {
    expect(checkedPages(Object.keys(caps), exp, { 'https://d.example/4': true })).toEqual(Object.keys(caps));
    expect(checkedPages(Object.keys(caps), exp)).toEqual(Object.keys(caps).slice(0, 3));
  });

  it('a path that yields a value on an absent page is never certified; the one that yields nothing certifies and passes that cell', async () => {
    const r = await certify({ field: rating, expected: exp, absent: ['https://d.example/4'], captures: caps, candidates: [api, jsonLd] }, xpathDeps);
    expect(r.certified.map((p) => p.path)).toEqual(['aggregateRating.ratingValue']);
    expect(r.cells['https://d.example/4']).toEqual({ status: 'pass', found: '', path: jsonLd });
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });

  it('without the absent page the api fallback certifies too (what Decathlon saw)', async () => {
    const r = await certify({ field: rating, expected: exp, captures: caps, candidates: [api, jsonLd] }, xpathDeps);
    expect(r.certified.map((p) => p.path).sort()).toEqual(['aggregateRating.ratingValue', 'stats.averageRating']);
  });

  it('reports found_unexpected on the absent page when every candidate produces a value there', async () => {
    const r = await certify({ field: rating, expected: exp, absent: ['https://d.example/4'], captures: caps, candidates: [api] }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://d.example/4']).toMatchObject({ status: 'fail', reason: 'found_unexpected', found: '0' });
  });
});
```

If the `interceptedRequests` entry's shape does not match `InterceptedRequest` in `@robot/browser` (`packages/browser/src/types.ts`), build it with the real fields — the point is that `resolveStructured(capture, 'api', 'stats.averageRating')` reads `0` from it. Check `search-structured.ts` `resolveStructured` for how `api` paths are read (which request fields it parses) and shape the fake accordingly.

- [ ] **Step 3: Run to see them fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/certify.test.ts`
Expected: the four new tests fail (`absent` unknown / wrong cells).

- [ ] **Step 4: Implement in `certify.ts`**

`checkedPages`:

```ts
/** A field's pages: the proof pages it has an expected value on, plus those the customer said it is absent on (spec 2026-10-10 §B2), in url order. A blank cell (allowed on pages four to six only; binding-input enforces that) means "not checked here". */
export function checkedPages(urls: string[], expected: Record<string, string>, absent: Record<string, true> = {}): string[] {
  return urls.filter((u) => (expected[u] ?? '').trim() !== '' || absent[u] === true);
}
```

`CertifyInput` gains:

```ts
  /** The proof pages the customer said this field is NOT on (spec 2026-10-10 §B2): checked pages where the right answer is nothing. */
  absent?: string[];
```

In `certifyCandidates`:

```ts
  const absentSet = new Set(input.absent ?? []);
  const absentMap: Record<string, true> = Object.fromEntries([...absentSet].map((u) => [u, true as const]));
  const urls = checkedPages(Object.keys(captures), input.expected, absentMap);
  const expected = Object.fromEntries(urls.filter((u) => !absentSet.has(u)).map((u) => [u, input.expected[u]!]));
```

In the evaluation loop, `correct` becomes:

```ts
      const correct = absentSet.has(url) ? empty : !empty && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
```

(An absent page: a candidate is correct iff it resolves to nothing; `empty && !correct` can no longer happen there, and a value there makes `e.correct || e.empty` false → unsafe.)

In the cells loop, the `pass` branches use `found: displayValue(raw) ?? String(raw)`; on an absent page `raw` is empty, so make the found text `''`:

```ts
const foundText = (raw: unknown) => (raw === null || raw === undefined || raw === '' ? '' : displayValue(raw) ?? String(raw));
```

and use `foundText(raw)` in the three `pass` constructions. Before the `twoOfThree` block add the absent-page failure:

```ts
    if (absentSet.has(url)) {
      // Every candidate produced a value on a page the customer said has none.
      const produced = candidates.map((c) => evals.get(pathId(c))?.[url]?.raw).find((r) => !(r === null || r === undefined || r === ''));
      cells[url] = { status: 'fail', reason: 'found_unexpected', ...(displayValue(produced) !== null ? { found: displayValue(produced)! } : {}) };
      continue;
    }
```

`weakEvidence`'s `Object.keys(expected).length > 1` and `gatherCandidates` (searches only pages with an expected value) are unchanged: an absent page offers no value to search for.

- [ ] **Step 5: `run-verification.ts` carries `absent` and hashes it**

Where `const expected = req.verificationSet.expected[field.key] ?? {};` add `const absent = Object.keys(req.verificationSet.absent?.[field.key] ?? {});` and pass `absent` into every `certify({ … })` call in the file (three). In the AI block, `const pages = checkedPages(req.verificationSet.urls, expected);` stays (the model searches pages with a value only).

`fieldHash`:

```ts
  const absent = Object.keys(set.absent?.[field.key] ?? {}).filter((u) => set.urls.includes(u)).sort();
  const pages = checkedPages(set.urls, expected, Object.fromEntries(absent.map((u) => [u, true as const])));
  …
    expected: …,
    ...(absent.length ? { absent } : {}),
```

`definitionHash`: add `...(set.absent && Object.keys(set.absent).length ? { absent: Object.fromEntries(Object.keys(set.absent).sort().map((k) => [k, Object.keys(set.absent![k]!).sort()])) } : {}),`. A set with no `absent` hashes byte-for-byte as before (test it: the hash of a set without `absent` equals the hash from before this change — pin it by asserting `fieldHash(field, set) === fieldHash(field, { ...set, absent: {} })` and that adding an absent page changes it).

- [ ] **Step 6: Run the scraper tests**

Run: `pnpm --filter @robot/scraper test`
Expected: all pass (the pre-existing `transfer-marks.test.ts` image case is a known flake; re-run alone if it fails).

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(scraper): a proof page where a field is absent is a checked page — a path that invents a value there never certifies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/scraper/src/verify/types.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/run-verification.test.ts packages/scraper/src/verify/drift-classify.ts
```

---

### Task 2: The shape signature (`@robot/scraper`)

**Files:**
- Create: `packages/scraper/src/verify/shape.ts`, `packages/scraper/src/verify/shape.test.ts`
- Modify: `packages/scraper/src/index.ts` (export `shapeOf`, `type Shape`, `addressPattern`)

**Interfaces:**
- Produces: `type Shape = { jsonLdTypes: string[]; offers: 'top-level' | 'in-variants' | 'none'; rating: boolean; address: string }`; `shapeOf(capture: Pick<PageCapture, 'url' | 'structuredData' | 'interceptedRequests'>): Shape`; `addressPattern(url: string): string`.

- [ ] **Step 1: Failing tests**

```ts
// packages/scraper/src/verify/shape.test.ts
import { describe, it, expect } from 'vitest';
import { shapeOf, addressPattern } from './shape.js';

const cap = (url: string, ldJson: Record<string, unknown>[], api?: unknown) => ({
  url,
  structuredData: { ldJson, nextData: null, initialState: null, meta: {} },
  interceptedRequests: api ? [{ url: `${url}/api`, method: 'GET', resourceType: 'xhr', status: 200, responseBody: JSON.stringify(api) } as never] : [],
});

describe('shapeOf', () => {
  it('a single product with top-level offers and a rating', () => {
    expect(shapeOf(cap('https://s.example/p/12', [{ '@type': 'Product', offers: { price: '1' }, aggregateRating: { ratingValue: 4 } }])))
      .toEqual({ jsonLdTypes: ['Product'], offers: 'top-level', rating: true, address: '/p/n' });
  });
  it('a ProductGroup whose offers sit in its variants (Lookfantastic)', () => {
    const s = shapeOf(cap('https://s.example/p/12?variation=3', [{ '@type': 'ProductGroup', hasVariant: [{ '@type': 'Product', offers: { price: '1' } }] }]));
    expect(s).toEqual({ jsonLdTypes: ['ProductGroup'], offers: 'in-variants', rating: false, address: '/p/n?variation' });
  });
  it('unwraps @graph and reads a rating from an intercepted API when the JSON-LD has none', () => {
    const s = shapeOf(cap('https://s.example/x', [{ '@graph': [{ '@type': 'BreadcrumbList' }, { '@type': 'Product' }] }], { stats: { averageRating: 4.2 } }));
    expect(s.jsonLdTypes).toEqual(['BreadcrumbList', 'Product']);
    expect(s.offers).toBe('none');
    expect(s.rating).toBe(true);
  });
  it('no page data at all', () => {
    expect(shapeOf(cap('https://s.example/', []))).toEqual({ jsonLdTypes: [], offers: 'none', rating: false, address: '/' });
  });
});

describe('addressPattern', () => {
  it('replaces digit runs and keeps query keys, sorted', () => {
    expect(addressPattern('https://s.example/p/ekiden-one/9713/c248c227m8351755?b=1&a=2')).toBe('/p/ekiden-one/n/cnncnnnmn?a&b');
  });
});
```

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @robot/scraper exec vitest run src/verify/shape.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
// packages/scraper/src/verify/shape.ts
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
      const body = (r as { responseBody?: unknown }).responseBody;
      if (typeof body !== 'string' || !body.startsWith('{') && !body.startsWith('[')) continue;
      try { if (anyKey(JSON.parse(body), RATING_KEYS)) { rating = true; break; } } catch { /* not JSON */ }
    }
  }
  return { jsonLdTypes, offers, rating, address: addressPattern(capture.url) };
}
```

Read `InterceptedRequest` in `packages/browser/src/types.ts` and use its real body field name (if it is not `responseBody`, use the real one in both the module and the test).

- [ ] **Step 4: Export** — in `packages/scraper/src/index.ts`: `export { shapeOf, addressPattern, type Shape } from './verify/shape.js';`

- [ ] **Step 5: Run** — `pnpm --filter @robot/scraper exec vitest run src/verify/shape.test.ts` → pass; `pnpm --filter @robot/scraper exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add -- packages/scraper/src/verify/shape.ts packages/scraper/src/verify/shape.test.ts
git commit -m "feat(scraper): a page's shape from its page data, for grouping the pages a field is empty on

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/scraper/src/verify/shape.ts packages/scraper/src/verify/shape.test.ts packages/scraper/src/index.ts
```

---

### Task 3: The `coverage_checks` table (`@robot/db`)

**Files:**
- Modify: `packages/db/src/schema.ts` (after `driftChecksRelations`)
- Create: `packages/db/drizzle/0017_coverage_checks.sql` + journal/snapshot entries (generated)

**Interfaces:**
- Produces: `coverageChecks` table with columns `id`, `sourceId`, `verificationId`, `status`, `results`, `error`, `createdAt`, `completedAt`; exported from `@robot/db` like `driftChecks`.

- [ ] **Step 1: Schema**

```ts
// The coverage check (spec 2026-10-10 §A): after a passing Verify, twenty
// products sampled from the listing and read with the certified paths only,
// so the Verification tab can say where a field comes back empty before the
// first run. Writes only this row: no captures, no verification set, no path
// stats, no domain cache (spec A4).

export const coverageChecks = pgTable('coverage_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  verificationId: uuid('verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  // 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('running'),
  // CoverageResults (@robot/api verify/run-coverage-check.ts)
  results: jsonb('results'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('coverage_checks_source_id_idx').on(table.sourceId),
]);

export const coverageChecksRelations = relations(coverageChecks, ({ one }) => ({
  source: one(sources, { fields: [coverageChecks.sourceId], references: [sources.id] }),
  verification: one(sourceVerifications, { fields: [coverageChecks.verificationId], references: [sourceVerifications.id] }),
}));
```

Check `packages/db/src/index.ts` exports `* from './schema.js'` (or add the export the way `driftChecks` is exported).

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @robot/db run db:generate -- --name coverage_checks` (drizzle-kit reads `packages/db/drizzle.config.ts`). Expected: `packages/db/drizzle/0017_coverage_checks.sql` with one `CREATE TABLE "coverage_checks"`, two FKs and the index, plus `meta/0017_snapshot.json` and a journal entry. Read the SQL: it must touch only this table. Then `pnpm db:migrate` against the local database.

- [ ] **Step 3: Test** — `pnpm --filter @robot/db test` → pass (its schema test enumerates tables; add `coverage_checks` where it lists `drift_checks`, if it does).

- [ ] **Step 4: Commit**

```bash
git add -- packages/db/drizzle/0017_coverage_checks.sql packages/db/drizzle/meta/0017_snapshot.json
git commit -m "feat(db): coverage_checks — one row per coverage check after a passing Verify

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/db/src/schema.ts packages/db/drizzle/0017_coverage_checks.sql packages/db/drizzle/meta/0017_snapshot.json packages/db/drizzle/meta/_journal.json packages/db/src/schema.test.ts
```

---

### Task 4: The sampler and the summary (`@robot/api`, pure)

**Files:**
- Create: `packages/api/src/verify/coverage-sampler.ts`, `coverage-sampler.test.ts`, `coverage-summary.ts`, `coverage-summary.test.ts`

**Interfaces:**
- Consumes: `Shape` from `@robot/scraper` (Task 2).
- Produces:
  ```ts
  export const COVERAGE_SAMPLE_SIZE = 20;
  export function sampleListing(productUrls: string[], proofUrls: string[], max = COVERAGE_SAMPLE_SIZE): string[];
  export type SampledPage = { url: string; empty: string[]; shape: Shape } | { url: string; unread: string };
  export type CoverageResults = { listingUrl: string; sampled: SampledPage[]; proofShapes: Record<string, Shape> };
  export type FieldCoverage = { key: string; empty: string[]; sampled: number; unread: number; explanation: string | null; representative: string | null };
  export function summariseCoverage(results: CoverageResults, fieldKeys: string[]): FieldCoverage[];
  export function stageLine(status: 'running' | 'done' | 'failed', results: CoverageResults | null, fieldsWithEmpties: number, error: string | null): string | null;
  ```

- [ ] **Step 1: Failing tests, sampler**

```ts
// packages/api/src/verify/coverage-sampler.test.ts
import { describe, it, expect } from 'vitest';
import { sampleListing, COVERAGE_SAMPLE_SIZE } from './coverage-sampler.js';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://s.example/p/${i + 1}`);

describe('sampleListing (spec 2026-10-10 §A2, D1)', () => {
  it('drops the proof pages and takes everything when fewer than twenty remain', () => {
    expect(sampleListing(urls(5), ['https://s.example/p/2'])).toEqual(['https://s.example/p/1', 'https://s.example/p/3', 'https://s.example/p/4', 'https://s.example/p/5']);
  });
  it('spreads twenty over a long listing: the first link, then every k-th', () => {
    const out = sampleListing(urls(103), []);
    expect(out).toHaveLength(COVERAGE_SAMPLE_SIZE);
    expect(out[0]).toBe('https://s.example/p/1');
    expect(out[1]).toBe('https://s.example/p/6'); // k = floor(103 / 20) = 5
    expect(new Set(out).size).toBe(20);
  });
  it('compares proof pages after normalising a trailing slash and the fragment', () => {
    expect(sampleListing(['https://s.example/p/1/', 'https://s.example/p/2#x'], ['https://s.example/p/1', 'https://s.example/p/2'])).toEqual([]);
  });
  it('nothing to sample is an empty list, not an error', () => {
    expect(sampleListing([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Failing tests, summary**

```ts
// packages/api/src/verify/coverage-summary.test.ts
import { describe, it, expect } from 'vitest';
import { summariseCoverage, stageLine, type CoverageResults } from './coverage-summary.js';

const single = { jsonLdTypes: ['Product'], offers: 'top-level' as const, rating: true, address: '/p/n' };
const multi = { jsonLdTypes: ['ProductGroup'], offers: 'in-variants' as const, rating: true, address: '/p/n' };
const noRating = { ...single, rating: false };
const P = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const results = (sampled: CoverageResults['sampled']): CoverageResults => ({ listingUrl: 'https://s.example/l', sampled, proofShapes: Object.fromEntries(P.map((u) => [u, single])) });
const page = (i: number, empty: string[], shape = single) => ({ url: `https://s.example/p/${i}`, empty, shape });

describe('summariseCoverage (spec 2026-10-10 §A5)', () => {
  it('Lookfantastic: price empty on the multi-size pages, explained because every empty page has what no proof page has', () => {
    const sampled = [...Array.from({ length: 11 }, (_, i) => page(10 + i, ['price', 'in_stock'], multi)), ...Array.from({ length: 9 }, (_, i) => page(30 + i, []))];
    const [price] = summariseCoverage(results(sampled), ['price', 'title']).filter((f) => f.key === 'price');
    expect(price).toEqual({
      key: 'price', empty: sampled.slice(0, 11).map((p) => p.url), sampled: 20, unread: 0,
      explanation: 'all 11 list their sizes as variants in the page data',
      representative: 'https://s.example/p/10',
    });
  });
  it('no explanation when the empties share nothing the proof pages lack; representative is still the first empty', () => {
    const [price] = summariseCoverage(results([page(10, ['price']), page(11, ['price']), page(12, [])]), ['price']);
    expect(price.explanation).toBeNull();
    expect(price.representative).toBe('https://s.example/p/10');
  });
  it('"n of m" when at least four of five share the feature, none below that', () => {
    const r = summariseCoverage(results([page(10, ['rating'], noRating), page(11, ['rating'], noRating), page(12, ['rating'], noRating), page(13, ['rating'], noRating), page(14, ['rating'])]), ['rating']);
    expect(r[0].explanation).toBe('4 of 5 show no rating in the page data');
    const low = summariseCoverage(results([page(10, ['rating'], noRating), page(11, ['rating']), page(12, ['rating'])]), ['rating']);
    expect(low[0].explanation).toBeNull();
  });
  it('one empty page reads in the singular', () => {
    const r = summariseCoverage(results([page(10, ['price'], multi), page(11, [])]), ['price']);
    expect(r[0].explanation).toBe('it lists its sizes as variants in the page data');
  });
  it('unread pages count as unread, never as empty; a field with no empties is left out', () => {
    const r = summariseCoverage(results([page(10, []), { url: 'https://s.example/p/11', unread: 'shop.example refused the browser (HTTP 403).' }]), ['price']);
    expect(r).toEqual([]);
  });
  it('the representative is the first empty page of the largest shape group', () => {
    const r = summariseCoverage(results([page(10, ['price'], noRating), page(11, ['price'], multi), page(12, ['price'], multi)]), ['price']);
    expect(r[0].representative).toBe('https://s.example/p/11');
  });
});

describe('stageLine (spec §5)', () => {
  const twenty = results(Array.from({ length: 20 }, (_, i) => page(10 + i, [])));
  it('running', () => expect(stageLine('running', twenty, 0, null)).toBe('Checking 20 more products from the listing…'));
  it('clean', () => expect(stageLine('done', twenty, 0, null)).toBe('Checked 20 more products from the listing: every field was found on all of them.'));
  it('clean with unread', () => {
    const r = results([...twenty.sampled.slice(0, 17), ...[1, 2, 3].map((i) => ({ url: `https://s.example/u/${i}`, unread: 'wall' }))]);
    expect(stageLine('done', r, 0, null)).toBe('Checked 20 more products from the listing: every field was found on all of them. (3 could not be read)');
  });
  it('empties', () => expect(stageLine('done', twenty, 2, null)).toBe('2 fields were empty on some of the 20 sampled products — see the rows.'));
  it('one field, one product', () => expect(stageLine('done', results([page(10, ['price'])]), 1, null)).toBe('1 field was empty on some of the 1 sampled product — see the row.'));
  it('failed reads the error', () => expect(stageLine('failed', null, 0, 'shop.example refused the browser (HTTP 403).')).toBe('shop.example refused the browser (HTTP 403).'));
  it('nothing sampled says nothing', () => expect(stageLine('done', results([]), 0, null)).toBeNull());
});
```

- [ ] **Step 3: Run to see them fail** — `pnpm --filter @robot/api exec vitest run src/verify/coverage-sampler.test.ts src/verify/coverage-summary.test.ts` → modules not found.

- [ ] **Step 4: Implement the sampler**

```ts
// packages/api/src/verify/coverage-sampler.ts
// Which products the coverage check reads (spec 2026-10-10 §A2, D1): the
// listing's product group minus the proof pages, twenty of them spread evenly
// over the listing's order so the top of the page (colourways, sponsored
// strips) does not fill the sample.
export const COVERAGE_SAMPLE_SIZE = 20;

const key = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '');

export function sampleListing(productUrls: string[], proofUrls: string[], max = COVERAGE_SAMPLE_SIZE): string[] {
  const proof = new Set(proofUrls.map(key));
  const seen = new Set<string>();
  const pool = productUrls.filter((u) => { const k = key(u); if (proof.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  if (pool.length <= max) return pool;
  const k = Math.floor(pool.length / max);
  const out: string[] = [];
  for (let i = 0; i < pool.length && out.length < max; i += k) out.push(pool[i]!);
  return out;
}
```

- [ ] **Step 5: Implement the summary**

```ts
// packages/api/src/verify/coverage-summary.ts
// From a coverage check's row to what the Verification tab says (spec
// 2026-10-10 §A5): per field, the sampled pages it was empty on, one
// explanation from a fixed vocabulary when at least four of five of them share
// a shape feature none of the proof pages has, and the page to offer as the
// next proof page. Pure: the row in, strings out.
import type { Shape } from '@robot/scraper';

export type SampledPage = { url: string; empty: string[]; shape: Shape } | { url: string; unread: string };
export type CoverageResults = { listingUrl: string; sampled: SampledPage[]; proofShapes: Record<string, Shape> };
export type FieldCoverage = { key: string; empty: string[]; sampled: number; unread: number; explanation: string | null; representative: string | null };

type Read = Extract<SampledPage, { shape: Shape }>;
const isRead = (p: SampledPage): p is Read => 'shape' in p;

/** A feature a page may have, the test for it, and its sentence in the plural ("all n …" / "n of m …") and the singular. */
type Feature = { id: string; has: (s: Shape) => boolean; plural: string; singular: string };
const FEATURES: Feature[] = [
  { id: 'in-variants', has: (s) => s.offers === 'in-variants', plural: 'list their sizes as variants in the page data', singular: 'lists its sizes as variants in the page data' },
  { id: 'no-offer', has: (s) => s.offers === 'none', plural: 'have no offer in the page data', singular: 'has no offer in the page data' },
  { id: 'no-rating', has: (s) => s.rating === false, plural: 'show no rating in the page data', singular: 'shows no rating in the page data' },
  { id: 'not-product', has: (s) => !s.jsonLdTypes.includes('Product'), plural: 'do not describe themselves as a product in the page data', singular: 'does not describe itself as a product in the page data' },
];
const SHARE = 0.8;

function explain(empties: Read[], proof: Shape[]): string | null {
  const n = empties.length;
  if (n === 0) return null;
  const candidates: Array<{ count: number; text: string }> = [];
  for (const f of FEATURES) {
    if (proof.length > 0 && proof.some(f.has)) continue;           // a proof page has it too: not the difference
    const count = empties.filter((p) => f.has(p.shape)).length;
    if (count / n < SHARE) continue;
    candidates.push({ count, text: n === 1 ? `it ${f.singular}` : count === n ? `all ${n} ${f.plural}` : `${count} of ${n} ${f.plural}` });
  }
  // The address pattern: every empty page shares one the proof pages do not use.
  const addresses = new Set(empties.map((p) => p.shape.address));
  if (addresses.size === 1 && proof.length > 0 && !proof.some((s) => s.address === [...addresses][0])) {
    const a = [...addresses][0]!;
    candidates.push({ count: n, text: n === 1 ? `its address looks like ${a}` : `all ${n} have addresses like ${a}` });
  }
  candidates.sort((x, y) => y.count - x.count);
  return candidates[0]?.text ?? null;
}

/** The first empty page of the largest group of identical shapes (ties: the earlier page). */
function representative(empties: Read[]): string | null {
  if (empties.length === 0) return null;
  const groups = new Map<string, Read[]>();
  for (const p of empties) { const k = JSON.stringify(p.shape); (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  let best: Read[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best[0]!.url;
}

export function summariseCoverage(results: CoverageResults, fieldKeys: string[]): FieldCoverage[] {
  const read = results.sampled.filter(isRead);
  const unread = results.sampled.length - read.length;
  const proof = Object.values(results.proofShapes);
  const out: FieldCoverage[] = [];
  for (const key of fieldKeys) {
    const empties = read.filter((p) => p.empty.includes(key));
    if (empties.length === 0) continue;
    out.push({ key, empty: empties.map((p) => p.url), sampled: read.length, unread, explanation: explain(empties, proof), representative: representative(empties) });
  }
  return out;
}

export function stageLine(status: 'running' | 'done' | 'failed', results: CoverageResults | null, fieldsWithEmpties: number, error: string | null): string | null {
  if (status === 'failed') return error;
  const n = results?.sampled.length ?? 0;
  if (status === 'running') return `Checking ${n} more products from the listing…`;
  if (n === 0) return null;
  const read = results!.sampled.filter(isRead).length;
  const products = n === 1 ? 'product' : 'products';
  if (fieldsWithEmpties === 0) {
    const unread = n - read;
    return `Checked ${n} more ${products} from the listing: every field was found on all of them.${unread > 0 ? ` (${unread} could not be read)` : ''}`;
  }
  const fields = fieldsWithEmpties === 1 ? '1 field was' : `${fieldsWithEmpties} fields were`;
  return `${fields} empty on some of the ${read} sampled ${read === 1 ? 'product' : 'products'} — see the ${fieldsWithEmpties === 1 ? 'row' : 'rows'}.`;
}
```

(The running line counts the sample as planned: Task 5 writes the sampled urls into `results.sampled` as `{ url, empty: [], shape }`-less placeholders? No — simpler: Task 5 writes `results = { listingUrl, sampled: [], proofShapes: {}, planned: n }` up front; add `planned?: number` to `CoverageResults` and let `stageLine` use `results.planned ?? results.sampled.length` for the running count. Add that field and that fallback, and a test: `stageLine('running', { …, sampled: [], planned: 20 }, 0, null)` reads "Checking 20 more products from the listing…".)

- [ ] **Step 6: Run** — both test files pass; `pnpm --filter @robot/api exec tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add -- packages/api/src/verify/coverage-sampler.ts packages/api/src/verify/coverage-sampler.test.ts packages/api/src/verify/coverage-summary.ts packages/api/src/verify/coverage-summary.test.ts
git commit -m "feat(api): the coverage sample (twenty, spread, no proof pages) and the per-field summary with its fixed explanations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/api/src/verify/coverage-sampler.ts packages/api/src/verify/coverage-sampler.test.ts packages/api/src/verify/coverage-summary.ts packages/api/src/verify/coverage-summary.test.ts
```

---

### Task 5: The coverage check job and its query (`@robot/api`)

**Files:**
- Create: `packages/api/src/verify/run-coverage-check.ts`, `run-coverage-check.test.ts`
- Modify: `packages/api/src/verify/run-source-verification.ts` (start the check after a passing Verify), `packages/api/src/routers/sources.ts` (`coverage` query)
- Test: `packages/api/src/routers/sources-coverage.test.ts` (the query)

**Interfaces:**
- Consumes: `sampleListing`, `summariseCoverage`, `stageLine`, `CoverageResults`, `SampledPage` (Task 4); `shapeOf` (Task 2); `coverageChecks` (Task 3); `runVerifiedExtraction`, `CaptureProblemError`, `largestProductGroup`, `LISTING_ANCHORS_SCRIPT`, `backoffAnswer` from `@robot/scraper`; `loadCurrentCertification` (`./current-certification.js`); `captureSlots` (`./proof-page-capture.js`); `withBrowserSession` (`../browser-session.js`); `loadProofPageCaptures`-equivalent for the proof pages' latest captures (read `proof-page-capture.ts` for the loader that returns a `ProofPageCaptureRecord` per url — `loadProofPageCaptureById` exists; find or add `latestProofPageCaptures(sourceId, urls)`).
- Produces:
  ```ts
  export const COVERAGE_CHECK_STALL_MS = 10 * 60 * 1000;
  export const COVERAGE_WALL_BREAKER = 3;
  export type CoverageDeps = {
    listing?: (url: string) => Promise<{ productUrls: string[]; verdictMessage: string | null }>;
    extract?: (url: string, fields: VerifiedField[]) => Promise<{ data: Record<string, unknown>; shape: Shape } | { unread: string; wall: boolean }>;
    proofShapes?: (sourceId: string, urls: string[]) => Promise<Record<string, Shape>>;
  };
  export function startCoverageCheck(sourceId: string, verificationId: string | null, opts?: { fire?: boolean } & CoverageDeps): Promise<{ checkId: string; status: 'started' | 'in-progress' }>;
  export function runCoverageCheck(checkId: string, deps?: CoverageDeps): Promise<void>;
  export function latestCoverageCheck(sourceId: string): Promise<{ id: string; status: 'running'|'done'|'failed'; results: CoverageResults | null; error: string | null; createdAt: Date; fields: FieldCoverage[]; stage: string | null } | null>;
  ```

- [ ] **Step 1: Failing tests**

Model the file on `run-drift-check.test.ts` (signed-in caller, `createProjectWithSource`, a seeded passing verification so `loadCurrentCertification` returns paths — read `run-drift-check.test.ts` for how it seeds `source_verifications` with `fieldHash`). All three deps injected; no browser launched.

```ts
// packages/api/src/verify/run-coverage-check.test.ts
import { describe, it, expect, afterAll, vi } from 'vitest';
import { and, eq, count } from 'drizzle-orm';
import { db, captures, coverageChecks, sources, domainIntelligence } from '@robot/db';
import { startCoverageCheck, runCoverageCheck, latestCoverageCheck, COVERAGE_CHECK_STALL_MS } from './run-coverage-check.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
// + the seeding helper the drift test uses to make the website certified (copy its approach)

const me = await signedInCaller('run-coverage-check');
afterAll(async () => { await me.cleanup(); });

const single = { jsonLdTypes: ['Product'], offers: 'top-level' as const, rating: true, address: '/p/n' };
const multi = { ...single, jsonLdTypes: ['ProductGroup'], offers: 'in-variants' as const };
const listing = (n: number) => async () => ({ productUrls: Array.from({ length: n }, (_, i) => `https://test-cov.example.com/p/${i + 1}`), verdictMessage: null });
const extract = (emptyOn: (url: string) => boolean) => async (url: string) => ({ data: { price: emptyOn(url) ? null : '1.00', title: 'x' }, shape: emptyOn(url) ? multi : single });
const proofShapes = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, single]));

describe('runCoverageCheck (spec 2026-10-10 §A)', () => {
  it('samples, reads, records empties with shapes; writes only its own row', async () => {
    const { sourceId } = await certifiedWebsite('cov-a');          // helper: project + source + a passing verification seeded on price/title
    const before = { captures: await rowCount(captures), domains: await rowCount(domainIntelligence), set: await setOf(sourceId) };
    const { checkId } = await startCoverageCheck(sourceId, null, { fire: false });
    await runCoverageCheck(checkId, { listing: listing(30), extract: extract((u) => /\/p\/(1|2|3)\d/.test(u)), proofShapes });
    const row = (await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, checkId) }))!;
    expect(row.status).toBe('done');
    const results = row.results as CoverageResults;
    expect(results.sampled).toHaveLength(20);
    expect(results.sampled.filter((p) => 'empty' in p && p.empty.includes('price')).length).toBeGreaterThan(0);
    expect(await rowCount(captures)).toBe(before.captures);
    expect(await rowCount(domainIntelligence)).toBe(before.domains);
    expect(await setOf(sourceId)).toEqual(before.set);
  });
  it('a walled page is unread, never empty; three walls in a row stop the check done with what it has', async () => { /* extract returns { unread, wall: true } for every url: expect sampled.length === 3, all unread, status done */ });
  it('a walled listing ends the check failed with the verdict sentence', async () => { /* listing returns verdictMessage: expect status failed, error === the sentence */ });
  it('a website with no listing url ends done with nothing sampled', async () => { /* … */ });
  it('one running check per website; a stalled one is closed failed/stalled and a new one may start', async () => {
    /* start (fire:false) → start again → in-progress; backdate createdAt by COVERAGE_CHECK_STALL_MS + 1 → start again → started, and the old row reads failed/stalled */
  });
  it('latestCoverageCheck summarises the newest row', async () => { /* fields[0].key === 'price', stage matches the spec line */ });
});
```

Write the four sketched tests out in full in the same style as the first (they are the spec's properties 1, 3, 7 and Review Focus 1–2); `rowCount(table)` is `(await db.select({ n: count() }).from(table))[0]!.n`; `setOf` reads `sources.verificationSet` and `schemaDefinition` for the website.

- [ ] **Step 2: Run to see them fail** — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/verify/run-coverage-check.ts
// The coverage check (spec 2026-10-10 §A): after a passing Verify, sample
// twenty products from the listing, run the certified paths on each, and
// record per page which fields came back empty, with the page's shape.
// Page loads and code only: no model, ever. Writes only its own
// `coverage_checks` row — no captures, no verification set, no path stats,
// no domain cache (spec A4). Follows run-drift-check.ts: fire-and-forget,
// never rejects, always leaves its row terminal.
import { and, desc, eq } from 'drizzle-orm';
import { db, coverageChecks, sources } from '@robot/db';
import {
  backoffAnswer, CaptureProblemError, largestProductGroup, LISTING_ANCHORS_SCRIPT, runVerifiedExtraction, shapeOf,
  type ListingAnchor, type SchemaDefinitionField, type Shape, type VerificationSet, type VerifiedField,
} from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { loadCurrentCertification } from './current-certification.js';
import { captureSlots } from './proof-page-capture.js';
import { sampleListing } from './coverage-sampler.js';
import { summariseCoverage, stageLine, type CoverageResults, type SampledPage, type FieldCoverage } from './coverage-summary.js';

export const COVERAGE_CHECK_STALL_MS = 10 * 60 * 1000;
/** Three refused/challenged pages in a row end the check with what it has (the run breaker's rule, fix wave C2 2026-10-09). */
export const COVERAGE_WALL_BREAKER = 3;

export type CoverageDeps = {
  listing?: (url: string) => Promise<{ productUrls: string[]; verdictMessage: string | null }>;
  extract?: (url: string, fields: VerifiedField[]) => Promise<{ data: Record<string, unknown>; shape: Shape } | { unread: string; wall: boolean }>;
  proofShapes?: (sourceId: string, urls: string[]) => Promise<Record<string, Shape>>;
};

/** The listing's product group, read with the finder's own capture and grouping; a non-ok verdict is the sentence instead. */
async function defaultListing(url: string): Promise<{ productUrls: string[]; verdictMessage: string | null }> {
  const waiting = backoffAnswer(url);
  if (waiting) return { productUrls: [], verdictMessage: waiting.message };
  return withBrowserSession(async (browser) => {
    const capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: false });
    if (capture.verdict.kind !== 'ok') return { productUrls: [], verdictMessage: (await import('@robot/browser')).verdictSentence(capture.verdict, url) };
    const anchors = await browser.setContentEvaluate<ListingAnchor[]>(capture.html, LISTING_ANCHORS_SCRIPT);
    return { productUrls: largestProductGroup(anchors, url), verdictMessage: null };
  });
}
```

(Import `verdictSentence` statically from `@robot/browser` instead of the dynamic import above; the api already depends on it.)

```ts
/** One sampled page: certified paths only, in a proof-page capture slot, under the domain lock `runVerifiedExtraction` takes itself. */
async function defaultExtract(url: string, fields: VerifiedField[]): ReturnType<NonNullable<CoverageDeps['extract']>> {
  return captureSlots(() => withBrowserSession(async (browser) => {
    try {
      const r = await runVerifiedExtraction({ url, fields }, { browser });
      return { data: r.data, shape: shapeOf(r.capture!) };
    } catch (err) {
      if (err instanceof CaptureProblemError) {
        const kind = err.verdict?.kind;
        return { unread: err.message, wall: kind === 'refused' || kind === 'challenge' };
      }
      if (err instanceof (await import('@robot/browser')).CaptureError) return { unread: err.message, wall: false };
      throw err;
    }
  }));
}
```

(Same note: import `CaptureError` statically. Check `createLimiter`'s call shape in `limiter.ts` — if `captureSlots` is `(fn) => Promise`, the above is right; if it is `acquire/release`, adapt.)

```ts
/** The proof pages' shapes from their latest captures (the Verification tab's), so the explanation can say what the sample has that they lack. */
async function defaultProofShapes(sourceId: string, urls: string[]): Promise<Record<string, Shape>> {
  // Read proof-page-capture.ts: use its loader of the latest captured record per url
  // (the one the Verification tab's cards read). Return shapeOf(record.capture) per url that has one.
  …
}

export async function startCoverageCheck(sourceId: string, verificationId: string | null, opts: { fire?: boolean } & CoverageDeps = {}) {
  const running = await db.query.coverageChecks.findFirst({
    where: and(eq(coverageChecks.sourceId, sourceId), eq(coverageChecks.status, 'running')),
    orderBy: [desc(coverageChecks.createdAt)], columns: { id: true, createdAt: true },
  });
  if (running) {
    if (Date.now() - running.createdAt.getTime() < COVERAGE_CHECK_STALL_MS) return { checkId: running.id, status: 'in-progress' as const };
    await db.update(coverageChecks).set({ status: 'failed', error: 'stalled', completedAt: new Date() })
      .where(and(eq(coverageChecks.id, running.id), eq(coverageChecks.status, 'running')));
  }
  const [row] = await db.insert(coverageChecks).values({ sourceId, verificationId, status: 'running' }).returning({ id: coverageChecks.id });
  const checkId = row!.id;
  if (opts.fire ?? true) void runCoverageCheck(checkId, opts);
  return { checkId, status: 'started' as const };
}

/** Never rejects: a throw anywhere leaves the row `failed` with its error. */
export async function runCoverageCheck(checkId: string, deps: CoverageDeps = {}): Promise<void> {
  const listing = deps.listing ?? defaultListing;
  const extract = deps.extract ?? defaultExtract;
  const proofShapes = deps.proofShapes ?? defaultProofShapes;
  try {
    const check = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, checkId) });
    if (!check) return;
    const source = await db.query.sources.findFirst({ where: eq(sources.id, check.sourceId), columns: { schemaDefinition: true, verificationSet: true } });
    if (!source) throw new Error(`Website ${check.sourceId} not found`);
    const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
    const fieldsDef = (Array.isArray(source.schemaDefinition) ? source.schemaDefinition : []) as SchemaDefinitionField[];
    const cert = await loadCurrentCertification(db, check.sourceId);
    const done = async (results: CoverageResults) => {
      await db.update(coverageChecks).set({ status: 'done', results, completedAt: new Date() })
        .where(and(eq(coverageChecks.id, checkId), eq(coverageChecks.status, 'running')));
    };
    const listingUrl = set.listing_url;
    if (!listingUrl || !cert) { await done({ listingUrl: listingUrl ?? '', sampled: [], proofShapes: {} }); return; }

    const { productUrls, verdictMessage } = await listing(listingUrl);
    if (verdictMessage) throw new Error(verdictMessage);
    const urls = sampleListing(productUrls, set.urls);
    // The planned size, so the tab's running line can count before any page is read.
    await db.update(coverageChecks).set({ results: { listingUrl, sampled: [], proofShapes: {}, planned: urls.length } })
      .where(eq(coverageChecks.id, checkId));

    const fields: VerifiedField[] = fieldsDef.filter((f) => (cert.paths[f.key]?.length ?? 0) > 0)
      .map((f) => ({ key: f.key, type: f.type, concept: f.concept, paths: cert.paths[f.key]! }));
    const sampled: SampledPage[] = [];
    let walls = 0;
    for (const url of urls) {
      const r = await extract(url, fields);
      if ('unread' in r) {
        sampled.push({ url, unread: r.unread });
        walls = r.wall ? walls + 1 : 0;
        if (walls >= COVERAGE_WALL_BREAKER) break;
        continue;
      }
      walls = 0;
      const empty = fields.filter((f) => r.data[f.key] === null || r.data[f.key] === undefined || r.data[f.key] === '').map((f) => f.key);
      sampled.push({ url, empty, shape: r.shape });
    }
    await done({ listingUrl, sampled, proofShapes: await proofShapes(check.sourceId, set.urls), planned: urls.length });
  } catch (err) {
    console.error(`[coverage] check ${checkId} failed:`, err);
    try {
      await db.update(coverageChecks).set({ status: 'failed', error: safeErrorMessage(err).slice(0, 1000), completedAt: new Date() })
        .where(and(eq(coverageChecks.id, checkId), eq(coverageChecks.status, 'running')));
    } catch (recoveryErr) {
      console.error(`[coverage] failed to record failure for ${checkId}:`, recoveryErr);
    }
  }
}

/** The newest check with its per-field summary and stage line; a stalled `running` row is closed on the way (the drift check's rule). */
export async function latestCoverageCheck(sourceId: string) {
  let row = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.sourceId, sourceId), orderBy: [desc(coverageChecks.createdAt)] });
  if (!row) return null;
  if (row.status === 'running' && Date.now() - row.createdAt.getTime() >= COVERAGE_CHECK_STALL_MS) {
    const [closed] = await db.update(coverageChecks).set({ status: 'failed', error: 'stalled', completedAt: new Date() })
      .where(and(eq(coverageChecks.id, row.id), eq(coverageChecks.status, 'running'))).returning();
    row = closed ?? row;
  }
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true } });
  const keys = ((Array.isArray(source?.schemaDefinition) ? source!.schemaDefinition : []) as SchemaDefinitionField[]).map((f) => f.key);
  const results = (row.results as CoverageResults | null) ?? null;
  const status = row.status as 'running' | 'done' | 'failed';
  const fields: FieldCoverage[] = status === 'done' && results ? summariseCoverage(results, keys) : [];
  return { id: row.id, status, results, error: row.error, createdAt: row.createdAt, fields, stage: stageLine(status, results, fields.length, row.error === 'stalled' ? null : row.error) };
}
```

A `stalled` check has no customer sentence: its stage is `null` (nothing shown), and the next Verify tries again.

- [ ] **Step 4: Start it after a passing Verify**

In `run-source-verification.ts`, right after `await db.update(sources).set({ driftedFields: null … })` inside `if (run.outcome.allPassed)`:

```ts
      // The coverage check (spec 2026-10-10 §A1): free, in the background, never awaited.
      void startCoverageCheck(sourceId, verificationId).catch((err) => console.error(`[coverage] could not start for ${sourceId}:`, err));
```

Tests for `runSourceVerification` that count writes or mock the db: inject nothing new; if a test asserts the exact set of tables written after a passing Verify, add `coverage_checks` to it. If the verification test suite would now launch real coverage checks against fake hosts, guard with an injectable `startCoverage` dep on `runSourceVerification`'s deps object (default `startCoverageCheck`) and pass a no-op in those tests.

- [ ] **Step 5: The query**

In `routers/sources.ts`, beside `driftCheck`:

```ts
  /** The website's latest coverage check (spec 2026-10-10 §A5): per field the sampled pages it was empty on, the explanation, the page to offer, and the stage line. Null when it never had one. */
  coverage: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return latestCoverageCheck(input.sourceId);
    }),
```

Test in `routers/sources-coverage.test.ts`: a website in another org → `FORBIDDEN`/`NOT_FOUND` as `driftCheck` behaves; a website with a seeded `done` row → `fields` and `stage` as Task 4 defines.

- [ ] **Step 6: Run** — `pnpm --filter @robot/api test` → pass; `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add -- packages/api/src/verify/run-coverage-check.ts packages/api/src/verify/run-coverage-check.test.ts packages/api/src/routers/sources-coverage.test.ts
git commit -m "feat(api): the coverage check — twenty listing products read with the certified paths after a passing Verify, one row, a query

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/api/src/verify/run-coverage-check.ts packages/api/src/verify/run-coverage-check.test.ts packages/api/src/verify/run-source-verification.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-coverage.test.ts
```

---

### Task 6: `absent` on the binding (`@robot/api`)

**Files:**
- Modify: `packages/api/src/verify/binding-input.ts`
- Test: `packages/api/src/verify/binding-input.test.ts`

**Interfaces:**
- Consumes: `VerificationSet.absent` (Task 1).
- Produces: `bindingInput.absent?: Record<fieldKey, Record<url, true>>`; `bindingProblems` rules; `prepareBinding` emits `absent` filtered to the saved urls.

- [ ] **Step 1: Failing tests** (follow the file's existing helpers for `contract` and a base input):

```ts
describe('absent — "not on this product" (spec 2026-10-10 §B1, D3)', () => {
  const base = { ...validInput(), absent: { price: { [U[2]]: true as const } }, expected: { ...validInput().expected, price: { [U[0]]: '1.00', [U[1]]: '2.00', [U[2]]: '' } } };
  it('a field absent on one page with values on two others saves', () => expect(bindingProblems(base, contract)).toEqual([]));
  it('absent on all but one page is refused with the field's name', () => {
    const one = { ...base, absent: { price: { [U[1]]: true as const, [U[2]]: true as const } }, expected: { ...base.expected, price: { [U[0]]: '1.00', [U[1]]: '', [U[2]]: '' } } };
    expect(bindingProblems(one, contract)).toEqual(['Price: needs a value on at least two products']);
  });
  it('a cell cannot be both a value and absent', () => {
    const both = { ...base, expected: { ...base.expected, price: { ...base.expected.price, [U[2]]: '3.00' } } };
    expect(bindingProblems(both, contract)).toEqual([`Price @ ${U[2]}: a value and "not on this product" cannot both be set`]);
  });
  it('a draft may be absent anywhere and still saves; prepareBinding keeps absent only for saved urls and drops a mark or path on an absent cell', () => {
    const draft = { ...base, draft: true, marks: { price: { [U[2]]: MARK } }, paths: { price: { [U[2]]: { source: 'json-ld' as const, path: 'offers.price' } } }, absent: { price: { [U[2]]: true as const, 'https://gone.example/x': true as const } } };
    const { verificationSet } = prepareBinding({ ...draft, draft: false }, contract);
    expect(verificationSet.absent).toEqual({ price: { [U[2]]: true } });
    expect(verificationSet.marks?.price?.[U[2]]).toBeUndefined();
    expect(verificationSet.paths?.price?.[U[2]]).toBeUndefined();
  });
  it('an absent cell on page three is not "missing" for a non-draft save', () => expect(bindingProblems(base, contract)).toEqual([]));
});
```

- [ ] **Step 2: Implement**

`bindingInput` gains `absent: z.record(z.string(), z.record(z.string(), z.literal(true))).optional(),`.

In `bindingProblems`, per field (inside the `for (const f of contract)` loop), before the urls loop:

```ts
    const absent = input.absent?.[f.key] ?? {};
    input.urls.forEach((url, i) => {
      const value = cells[url] ?? '';
      if (absent[url] && value.trim() !== '') { problems.push(`${f.name} @ ${url}: a value and "not on this product" cannot both be set`); return; }
      if (absent[url]) return;                                         // a checked page where the answer is nothing
      if ((draft || i >= VERIFY_URL_MIN) && value.trim() === '') return;
      const err = validateExpected(f.type, value);
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    });
    if (!draft) {
      const withValue = input.urls.filter((url) => (cells[url] ?? '').trim() !== '').length;
      const absentCount = input.urls.filter((url) => absent[url]).length;
      if (absentCount > 0 && withValue < 2) problems.push(`${f.name}: needs a value on at least two products`);
    }
```

(Replace the existing urls loop with this one; keep the marks check after it. A required page one-to-three cell that is blank and not absent still fails as today through `validateExpected` on `''`.) The "type at least one expected value on this page, or remove it" rule for pages four to six counts an absent cell as an answer: `contract.every((f) => (input.expected[f.key]?.[url] ?? '').trim() === '' && !input.absent?.[f.key]?.[url])`.

In `prepareBinding`: marks and paths already require a non-blank value (`current` / the paths filter), so an absent cell drops them by construction; emit

```ts
  const absent: NonNullable<VerificationSet['absent']> = {};
  for (const f of contract) {
    const perUrl = Object.fromEntries(input.urls.filter((u) => input.absent?.[f.key]?.[u]).map((u) => [u, true as const]));
    if (Object.keys(perUrl).length) absent[f.key] = perUrl;
  }
  … ...(Object.keys(absent).length ? { absent } : {}),
```

`updateBinding` writes `verificationSet` whole, so `absent` travels with it.

- [ ] **Step 3: Run** — `pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts` → pass; then `pnpm --filter @robot/api test`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): a binding may say a field is not on a product — a checked page whose answer is nothing, with a value on two pages at least

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/api/src/verify/binding-input.ts packages/api/src/verify/binding-input.test.ts
```

---

### Task 7: The board knows an absent cell (`@robot/app`, model)

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts` (`Answer.absent`, `StoredVerificationSet.absent`, `boardFrom`, `toBindingInput`, `rowStatus`, `cellAcceptable`, a `markAbsent` helper, `displayValue`), `packages/app/src/lib/site/verification-view.ts` (`FailReason`, `hintFor`)
- Test: `packages/app/src/lib/site/verification-model.test.ts`, `verification-view.test.ts`

**Interfaces:**
- Produces: `Answer = { value: string; mark: Mark | null; via?: Via; absent?: true }`; `markAbsent(board, key, url): Board` (answer `{ value: '', mark: null, absent: true }`); `isAbsent(board, key, url): boolean`; `ABSENT_TEXT = 'not on this product'`; `toBindingInput` emits `absent`; `rowStatus` treats an absent answer as answered with no value; `hintFor('found_unexpected', found, …, productNumber?)` → "found {found} on product {n}, but you said it isn't there".

- [ ] **Step 1: Failing tests**

```ts
describe('"not on this product" (spec 2026-10-10 §B3)', () => {
  it('markAbsent writes an answer with no value, clearing a mark and a path; typing a value clears absent', () => {
    let b = answer(board(), 'price', U[2]!, { value: '3.00', mark: MARK, via: { source: 'json-ld', path: 'offers.price' } });
    b = markAbsent(b, 'price', U[2]!);
    expect(b.answers.price![U[2]!]).toEqual({ value: '', mark: null, absent: true });
    expect(isAbsent(b, 'price', U[2]!)).toBe(true);
    b = answer(b, 'price', U[2]!, { value: '3.00', mark: null });
    expect(isAbsent(b, 'price', U[2]!)).toBe(false);
  });
  it('toBindingInput sends absent beside an empty expected cell', () => {
    const b = markAbsent(full(), 'price', U[2]!);
    const input = toBindingInput(b, FIELDS);
    expect(input.expected.price![U[2]!]).toBe('');
    expect(input.absent).toEqual({ price: { [U[2]!]: true } });
  });
  it('boardFrom reads absent back', () => {
    const b = boardFrom({ schemaDefinition: FIELDS, verificationSet: { urls: U, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '' } }, absent: { price: { [U[2]!]: true } } } });
    expect(isAbsent(b, 'price', U[2]!)).toBe(true);
  });
  it('an absent cell is answered for the row: two agreeing suggestions and one absent read agreed, not missing', () => {
    let b = board();
    b = markAbsent(b, 'price', U[2]!);
    const live = { price: { [U[0]!]: sugg('1.00'), [U[1]!]: sugg('2.00') } };
    expect(rowStatus(b, FIELDS[1]!, live, boxes()).kind).toBe('agreed');
  });
});
```

(`sugg` and `boxes` are whatever helpers the file already uses to build a page-data suggestion with one pointable box; reuse them.) In `verification-view.test.ts`: `hintFor('found_unexpected', '0', undefined, undefined, 4)` → `"found 0 on product 4, but you said it isn't there"`.

- [ ] **Step 2: Implement**

`Answer` gains `absent?: true`; `StoredVerificationSet` (the narrowed stored type at the top of the file) gains `absent?: Record<string, Record<string, true>>`.

```ts
export const ABSENT_TEXT = 'not on this product';
export function markAbsent(board: Board, key: string, url: string): Board {
  return answer(board, key, url, { value: '', mark: null, absent: true });
}
export function isAbsent(board: Board, key: string, url: string): boolean {
  return board.answers[key]?.[url]?.absent === true;
}
```

`boardFrom`: in the answers loop, after building `kept` from expected, add absent cells: `for (const [url] of Object.entries(set.absent?.[key] ?? {})) kept[url] = { value: '', mark: null, absent: true };` (iterate `set.absent` keys too for fields with no expected entries).

`toBindingInput`: collect `absentByUrl[urls[i]] = true` when `a?.absent`; emit `...(Object.keys(absent).length > 0 ? { absent } : {})` and extend the return type with `absent?: Record<string, Record<string, true>>`.

`rowStatus`: in the `if (a)` branch, `if (a.absent) continue;` before `validateValue` (an absent answer is answered, carries no value, and never joins `values`).

`cellValue`/`displayValue` callers: the route's `cellValue(f, url)` should return `ABSENT_TEXT` for an absent answer — do that in the route (Task 8) or export `cellText(board, field, url)` here; choose the model helper:

```ts
export function cellText(board: Board, field: Field, url: string, fallback: () => string): string {
  return isAbsent(board, field.key, url) ? ABSENT_TEXT : fallback();
}
```

`verification-view.ts`: add `'found_unexpected'` to `FailReason`; `hintFor(reason, found?, type?, field?, product?)`: `case 'found_unexpected': return \`found ${found ?? 'a value'} on product ${product ?? ''}, but you said it isn't there\`.trim();` — and `cellStatusFor`'s caller passes the product number (read where `hintFor` is called and thread the 1-based product through).

- [ ] **Step 3: Run** — `pnpm --filter @robot/app test` → pass; `pnpm --filter @robot/app exec tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(app): the board carries \"not on this product\" — an answered cell with no value, sent as absent, read back, never a missing row

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/lib/site/verification-view.ts packages/app/src/lib/site/verification-view.test.ts
```

---

### Task 8: The cell action (`@robot/app`, UI)

**Files:**
- Modify: `packages/app/src/components/verification/cell-detail-bar.tsx` (`onAbsent`, the button), `verification-table.tsx` (the context-menu item; an absent cell's text in muted style), `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (`markAbsent` wiring, `cellValue` uses `cellText`)
- Test: `packages/app/src/lib/site/table-selection.test.ts` if a pure helper is added; the smoke covers the rest (Task 10)

**Interfaces:**
- Consumes: `markAbsent`, `isAbsent`, `ABSENT_TEXT`, `cellText` (Task 7).
- Produces: `DetailBarSelection.onAbsent: (() => void) | null` (null when the cell is already absent); the context menu item "Not on this product".

- [ ] **Step 1: Detail bar**

In `DetailBarSelection` add `onAbsent: (() => void) | null;`. In the actions row after "Type it":

```tsx
            {s.onAbsent ? (
              <Button variant="ghost" size="xs" disabled={locked} aria-label={`${s.fieldName} is not on product ${s.productNumber}`} onClick={s.onAbsent}>
                Not on this product
              </Button>
            ) : null}
```

- [ ] **Step 2: Context menu**

In `verification-table.tsx`, after the "Type it" `ContextMenuItem`, add `onAbsent?: (sel: CellSelection) => void` to the table's props (next to `onFix`, `onCopy`) and:

```tsx
                          <ContextMenuItem disabled={locked || !cell.url.trim() || cell.value === ABSENT_TEXT} onSelect={() => onAbsent?.(sel)}>
                            Not on this product
                          </ContextMenuItem>
```

An absent cell renders its value in `text-muted-foreground` (the `answered` segment's rail stays): where the cell's text is rendered, `className={cell.value === ABSENT_TEXT ? 'text-muted-foreground' : undefined}` (or compare a new `TableCell.absent?: boolean` set by the route — prefer the flag).

- [ ] **Step 3: Route**

- `cellValue(f, url)` → wrap with `cellText(board, f, url, () => <today's body>)`.
- `markAbsentCell(sel: CellSelection)`: `const f = fields.find(…); const url = board.cards[sel.product]?.url; if (!f || !url) return; setBoard((b) => markAbsent(b, f.key, url));`.
- `detailBar.onAbsent`: `url && !isAbsent(board, detailField.key, url) ? () => markAbsentCell(selection) : null`.
- Pass `onAbsent={markAbsentCell}` to the table; `cells[].absent: isAbsent(board, f.key, c.url)`.
- `FieldDetails`'s `typed` for an absent answer is `''` already (`a.mark === null ? a.value : ''`); typing a value calls `answer(..., { value, mark: null })`, which replaces the absent answer (Task 7's test).

- [ ] **Step 4: Typecheck and run the app tests** — `pnpm --filter @robot/app exec tsc --noEmit`; `pnpm --filter @robot/app test`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(app): \"Not on this product\" in the detail bar and the cell menu; an absent cell reads so in muted text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/components/verification/cell-detail-bar.tsx packages/app/src/components/verification/verification-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
```

---

### Task 9: The coverage line and the stage line (`@robot/app`)

**Files:**
- Create: `packages/app/src/lib/site/coverage-view.ts`, `coverage-view.test.ts`
- Modify: `verification-table.tsx` (`TableRow.coverage`, the row line), `verify-bar.tsx` (no change if the route passes the coverage stage as `stage`), the site route (query, rows, stage precedence, "Use as proof page")

**Interfaces:**
- Consumes: `sources.coverage` (Task 5) → `{ status, fields: FieldCoverage[], stage, results }`.
- Produces:
  ```ts
  export type CoverageView = { status: 'running'|'done'|'failed'; stage: string | null; fields: Array<{ key: string; empty: string[]; sampled: number; explanation: string | null; representative: string | null }> };
  export function coverageLine(f: CoverageView['fields'][number], atLimit: boolean): { text: string; useAsProofPage: string | null };
  export function coverageStage(verifyStage: string | null, coverage: CoverageView | null): string | null;
  ```

- [ ] **Step 1: Failing tests**

```ts
// packages/app/src/lib/site/coverage-view.test.ts
import { describe, it, expect } from 'vitest';
import { coverageLine, coverageStage } from './coverage-view';

const f = { key: 'price', empty: ['https://s.example/p/10', 'https://s.example/p/11'], sampled: 20, explanation: 'all 2 list their sizes as variants in the page data', representative: 'https://s.example/p/10' };

describe('coverageLine (spec 2026-10-10 §5)', () => {
  it('count, explanation, action', () => {
    expect(coverageLine(f, false)).toEqual({ text: 'Empty on 2 of 20 sampled products · all 2 list their sizes as variants in the page data', useAsProofPage: 'https://s.example/p/10' });
  });
  it('count alone without an explanation', () => {
    expect(coverageLine({ ...f, explanation: null }, false).text).toBe('Empty on 2 of 20 sampled products');
  });
  it('at six proof pages the line says so and offers nothing', () => {
    expect(coverageLine(f, true)).toEqual({ text: 'Empty on 2 of 20 sampled products · all 2 list their sizes as variants in the page data · This website has its six proof pages', useAsProofPage: null });
  });
  it('one sampled product reads in the singular', () => {
    expect(coverageLine({ ...f, empty: ['https://s.example/p/10'], sampled: 1, explanation: null }, false).text).toBe('Empty on 1 of 1 sampled product');
  });
});

describe('coverageStage', () => {
  it('a running Verify wins over the coverage line', () => expect(coverageStage('checking product 2 of 3', { status: 'done', stage: 'x', fields: [] })).toBe('checking product 2 of 3'));
  it('otherwise the coverage stage, or nothing', () => {
    expect(coverageStage(null, { status: 'running', stage: 'Checking 20 more products from the listing…', fields: [] })).toBe('Checking 20 more products from the listing…');
    expect(coverageStage(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/app/src/lib/site/coverage-view.ts
// What the Verification tab says about the coverage check (spec 2026-10-10
// §A5, §5): the stage line and the line under a field's row. Pure, so the exact
// copy is tested without a server. The app never imports @robot/api; the
// query's shape is re-declared here, narrowed.
export type CoverageView = {
  status: 'running' | 'done' | 'failed';
  stage: string | null;
  fields: Array<{ key: string; empty: string[]; sampled: number; explanation: string | null; representative: string | null }>;
};

export const AT_LIMIT = 'This website has its six proof pages';

export function coverageLine(f: CoverageView['fields'][number], atLimit: boolean): { text: string; useAsProofPage: string | null } {
  const parts = [`Empty on ${f.empty.length} of ${f.sampled} sampled ${f.sampled === 1 ? 'product' : 'products'}`];
  if (f.explanation) parts.push(f.explanation);
  if (atLimit) parts.push(AT_LIMIT);
  return { text: parts.join(' · '), useAsProofPage: atLimit ? null : f.representative };
}

/** The verify bar's one stage line: a running Verify's own stage first, else the coverage check's. */
export function coverageStage(verifyStage: string | null, coverage: CoverageView | null): string | null {
  return verifyStage ?? coverage?.stage ?? null;
}
```

- [ ] **Step 3: The table row line**

`TableRow` gains `coverage?: { text: string; onUseAsProofPage: (() => void) | null }`. Render after the drift lines block:

```tsx
              {row.coverage ? (
                <tr>
                  <td colSpan={totalCols} className="border-t border-line bg-panel px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground" data-coverage={row.field.key}>
                      <span>{row.coverage.text}</span>
                      {row.coverage.onUseAsProofPage ? (
                        <Button variant="outline" size="xs" disabled={locked} aria-label={`Use a sampled product as proof page for ${row.field.name}`} onClick={row.coverage.onUseAsProofPage}>
                          Use as proof page
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
```

- [ ] **Step 4: The route**

- Query, beside the drift one: `const coverageQuery = trpc.sources.coverage.useQuery({ sourceId }, { refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false) });` and `const coverage: CoverageView | null = coverageQuery.data ? { status: coverageQuery.data.status, stage: coverageQuery.data.stage, fields: coverageQuery.data.fields } : null;`.
- After a Verify completes (`statusQuery` turns from active to settled), the coverage row appears on the next refetch: call `coverageQuery.refetch()` in the effect that already reacts to a finished verification (find where `verifying` flips false / `statusQuery` settles).
- Rows: `coverage: coverageFor(f)` where

```ts
  const atLimit = board.cards.length >= PRODUCTS_MAX;
  function coverageFor(f: Field): TableRow['coverage'] {
    const c = coverage?.status === 'done' ? coverage.fields.find((x) => x.key === f.key) : undefined;
    if (!c) return undefined;
    const line = coverageLine(c, atLimit);
    return {
      text: line.text,
      onUseAsProofPage: line.useAsProofPage ? () => navigate({ to: '/projects/$project/sites/$site', params: { project, site }, search: { addPage: line.useAsProofPage!, field: f.key } }) : null,
    };
  }
```

(`navigate` is the route's `useNavigate()`; the arrival effect at the `?addPage` comment consumes it exactly as the run page's link does — read that effect: if it ignores a navigation from the same route, set the search with `navigate({ search: … , replace: true })` and confirm the effect re-runs on `search.addPage` change.)

- Stage: `<VerifyBar … stage={coverageStage(stage, coverage)} />`.

- [ ] **Step 5: Run** — `pnpm --filter @robot/app test`; `tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add -- packages/app/src/lib/site/coverage-view.ts packages/app/src/lib/site/coverage-view.test.ts
git commit -m "feat(app): the coverage line under a field's row and the stage line — where the certified paths came back empty on the listing's products, and the page to add

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/lib/site/coverage-view.ts packages/app/src/lib/site/coverage-view.test.ts packages/app/src/components/verification/verification-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
```

---

### Task 10: The route smoke

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts` (the fixture shop, the Verification test, a new coverage + absent test placed before the wall test), `docs/testing/screens/app-*.png` (refreshed by the run)

Needs `pnpm dev:all` running the branch (api-server with the migration applied: `pnpm db:migrate` first). If the servers are down, report NEEDS_CONTEXT to the controller; never start them yourself.

- [ ] **Step 1: A fourth product of a second shape in the listing**

Add to the shop a product `/p/9`, listed LAST on `/l` so the finder's first three remain `/p/1..3`:

```ts
/** A fourth product in the listing, of a second shape (spec 2026-10-10 §7): a `ProductGroup` whose
 *  offers sit in its variants and no top-level `offers`, so a Price certified on `offers.price`
 *  comes back empty on it — what the coverage check is there to find. Its rating is on the page. */
const SECOND_SHAPE = { path: '/p/9', title: 'Widget D', price: '$99.00', rating: '4.1' };
```

In `/l`, append `<li><a href="/p/9"><img src="/i/9.png" alt=""><span>Widget D</span></a></li>` to the cards. In `shopPage`, before `const product = PRODUCTS.find(…)`:

```ts
  if (pathname === SECOND_SHAPE.path) {
    const ld = { '@context': 'https://schema.org', '@type': 'ProductGroup', name: SECOND_SHAPE.title, variesBy: ['https://schema.org/size'],
      hasVariant: ['S', 'M'].map((size) => ({ '@type': 'Product', size, sku: `p9-${size}`, offers: { '@type': 'Offer', price: '99.00', priceCurrency: 'USD' } })) };
    return { type: 'text/html', body: `<html><head><title>${SECOND_SHAPE.title}</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><div id="main"><h1>${SECOND_SHAPE.title}</h1><p class="sizes">Sizes S and M</p><span class="rating">${SECOND_SHAPE.rating}</span></div>${SHOP_FOOTER}</body></html>` };
  }
```

Then fix every assertion the extra card changes: the finder's count ("3 products found" → 4; grep the file for `products found`), and the finder's first three cards must still be `/p/1..3` (they are: listing order).

- [ ] **Step 2: The coverage and absent test**

Insert before `'a wall is reported as a wall…'` (which must stay last):

```ts
  it('after Verify, the coverage check finds the second shape, "Use as proof page" adds it, and "Not on this product" verifies', async () => {
    await page.goto(`${APP}${sitePath}`, { waitUntil: 'networkidle' });
    // The check ran in the background after the Verify above (one page: /p/9). Its line lands within a minute.
    const priceLine = page.locator('[data-coverage="price"]');
    await expect.poll(async () => (await priceLine.count()) ? await priceLine.innerText() : '', { timeout: 90_000 })
      .toContain('Empty on 1 of 1 sampled product · it lists its sizes as variants in the page data');
    expect(await page.locator('[data-coverage="title"]').count(), 'Title was found on the sampled product').toBe(0);
    await priceLine.getByRole('button', { name: /Use a sampled product as proof page/ }).click();
    await expect.poll(() => page.locator('[data-card]').count(), { timeout: 30_000 }).toBe(4);   // use the cards' real selector
    // Price is genuinely not on product 4's top level: say so, save, verify.
    // Select the Price cell on product 4 (the table's cell selector, as the earlier test does), then:
    await page.getByRole('button', { name: 'Price is not on product 4' }).click();
    await expect.poll(() => page.getByText('not on this product').count()).toBe(1);
    await waitForSaved(page);                                                                    // the file's save-line helper
    await verifyButtonOf(page).click();
    await expect.poll(async () => (await page.locator('tr', { hasText: 'Price' }).innerText()), { timeout: 150_000 }).toMatch(/verified.*4\/4/);
    await screenshot(page, 'site-verification-coverage');
  });
```

Use the file's own helpers and selectors (`sitePath`, `verifyButtonOf`, the save-wait, the cell selection via keyboard or click) — read the existing Verification test and mirror it exactly. The re-Verify also starts a second coverage check; the wall test after it starts with the backoff untouched (coverage pages are `ok`), so nothing changes there.

- [ ] **Step 3: Run** — `pnpm db:migrate` (if not yet), then `pnpm test:ui:app` once. Expected: all pass (22 tests). Fix assertions the fourth card changed; fix the code if a sentence differs from the spec.

- [ ] **Step 4: Commit**

```bash
git add -- docs/testing/screens/app-site-verification-coverage.png
git commit -m "test(app): the route smoke's shop has a second-shape product; the coverage line, Use as proof page and Not on this product are walked

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/routes-smoke.test.ts docs/testing/screens
```

---

### Task 11: Live check and handoff

**Files:**
- Create: `docs/testing/results/2026-10-10-proof-page-coverage-live-check.md`, `docs/testing/results/screens-2026-10-10-coverage/`
- Modify: `docs/handoff.md`, `docs/superpowers/specs/2026-10-10-proof-page-coverage-design.md` (status line), `CLAUDE.md` (one line under Key Technical Decisions: "Not on this product" and the coverage check)

- [ ] **Step 1: Live, free, with the servers running this branch**

In the campaign org (`credit-campaign@example.com`, password `smoke`, project "Credit campaign 2026-10"): on **lookfantastic.com**, click Verify (free, 8 of 8 certified before) and watch the stage line; within about four minutes the Price and In stock rows read "Empty on n of 20 sampled products · all n list their sizes as variants in the page data" (or the honest result; record what is seen). Click Use as proof page, type the price shown for one size, Verify. On **decathlon.com**, select Rating on the marketplace proof page (product 4), Not on this product, Verify; then in ops (`/ops`, needs `OPS_EMAILS`; if not configured, read `source_verifications.results` with a SELECT) confirm the certified Rating paths no longer include `stats.averageRating`. Screenshots per step. Never click a button showing more than $0.50.

- [ ] **Step 2: Handoff**

"**Newest:** [Proof-page coverage and "not on this product" (2026-10-10)](#…)" paragraph; demote the current Newest; a `## Proof-page coverage and "not on this product" (2026-10-10)` section before the honest-verdicts one: what changed (one paragraph), the files, how it was proven (per-package tests, the smoke's new test, the live check), "What NOT to redo": the coverage check reads, it never writes a proof page or gates Extract; absent is a checked page, never a blank; and the known gaps: the explanation vocabulary is four features plus the address; the check runs only after Verify. Update the top next-work list (the coverage item done; correctness on the run page and sitemap discovery next) and the campaign section's follow-up order.

- [ ] **Step 3: Spec status** — `**Status:** implemented on \`feat/proof-page-coverage\`, 2026-10-10; live check in \`docs/testing/results/2026-10-10-proof-page-coverage-live-check.md\`.` plus any deviations the implementation made (singular copy forms; the `planned` field).

- [ ] **Step 4: Commit**

```bash
git add -- docs/testing/results/2026-10-10-proof-page-coverage-live-check.md docs/testing/results/screens-2026-10-10-coverage
git commit -m "docs: proof-page coverage — live check and handoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- docs/handoff.md docs/superpowers/specs/2026-10-10-proof-page-coverage-design.md CLAUDE.md docs/testing/results/2026-10-10-proof-page-coverage-live-check.md docs/testing/results/screens-2026-10-10-coverage
```

---

## Self-review

**Spec coverage.** §3 A1 (after a passing Verify, fire-and-forget, stall rule, one running row, no listing → nothing) → Task 5. A2 (finder's capture + grouping, twenty spread, proof pages dropped, walled listing → failed with the sentence) → Tasks 4, 5. A3 (certified paths only in the three slots, per-page empties + shape, unread on a non-ok verdict, three walls stop, proof shapes, no stats) → Tasks 2, 5. A4 (the table, writes only its row) → Tasks 3, 5 (property 1 test). A5 (query, stage lines, row line, explanation vocabulary with the 4-of-5 rule, representative, Use as proof page via `?addPage`, six-page limit, never gates Extract) → Tasks 4, 9. §4 B1 (`absent`, binding rules, clears mark/path, blank unchanged, old sets unchanged) → Tasks 1, 6, 7. B2 (checkedPages with absent, correct iff nothing, unsafe otherwise, `found_unexpected`, n/m counts absent pages) → Task 1 (the count follows from `cells` holding the absent page). B3 (detail bar + context menu action, cell text, row word via `cellText`, the fail hint, Import values round-trip — `toBindingInput`/`boardFrom`) → Tasks 7, 8. B4 → nothing to do. §5 copy → Tasks 4, 7, 9. §6 properties 1–7 → Tasks 5 (1, 3, 7), 4 (2, 4), 1 (5), 6 (6). §7 testing → Tasks 1–9 unit, 10 smoke, 11 live. §8 files → every file has a task.

**Placeholders.** Task 5's `defaultProofShapes` body says to read `proof-page-capture.ts` for the latest-record loader: that is a read instruction with the exact goal (shape per url from its latest captured record), not a TBD; the implementer names the loader it finds. Task 5's four sketched tests are specified by property and expected outcome in the sketch comments and must be written in full. Task 10 names the smoke's own helpers by role where their names must be read from the file.

**Type consistency.** `Shape` (Task 2) is what `SampledPage`/`CoverageResults` (Task 4) carry and `shapeOf` returns; `FieldCoverage` (Task 4) is what `latestCoverageCheck` (Task 5) returns in `fields` and `CoverageView.fields` (Task 9) narrows; `absent` is `Record<fieldKey, Record<url, true>>` in Tasks 1, 6, 7 and `string[]` only inside `CertifyInput` (Task 1), converted in `run-verification.ts`; `found_unexpected` is spelled the same in Tasks 1 and 7; `COVERAGE_SAMPLE_SIZE` lives in the sampler and is used by the summary tests only through `sampleListing`.

**Review Focus.** 1 → Task 4 (`stageLine` singular/zero cases) and Task 5 (no-listing test). 2 → Task 5 (one running row test). 3 → Task 2 (no page data test) and Task 4 (no explanation when shared). 4 → Task 7 (`markAbsent` clears mark and path) and Task 6 (`prepareBinding` drops them). 5 → Task 6 (all but one page refused).

**Added beyond the spec, recorded for the status line:** singular copy forms for one empty or one sampled product; `planned` on the results so the running line can count before the first page is read; a `stalled` check shows no stage line.
