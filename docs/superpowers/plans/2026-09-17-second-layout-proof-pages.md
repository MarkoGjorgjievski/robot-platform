# Second-Layout Proof Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer certify a second page layout on a verified website by adding a fourth to sixth proof page with one expected value, find out about it from the run page, and repair the run.

**Architecture:** `certify` changes from "a path must be correct on every proof page" to "safe paths that together cover every page the field is checked on". A field's pages are the proof pages it has a non-blank expected value on, and its hash covers only those, so adding a page for one field leaves the others verified. The run page gains a read-only grouping of empty cells by field and listing with a link into the Schema tab, which gains an add/remove page column. Extraction at scale is untouched: it already tries a field's certified paths in order.

**Tech Stack:** TypeScript ESM monorepo (pnpm). `@robot/scraper` (vitest, real Chromium in some tests), `@robot/api` (tRPC v11, Zod, Drizzle, vitest), `@robot/dashboard` (Vite, TanStack Router/Query, Tailwind v4, vitest).

**Spec:** `docs/superpowers/specs/2026-09-17-second-layout-proof-pages-design.md`. Read it first. Section numbers below refer to it.

## Global Constraints

- Proof pages: minimum 3, maximum 6 (`VERIFY_URL_MIN = 3`, `VERIFY_URL_MAX = 6`).
- Blank expected cells are allowed only on pages four to six; on the first three every field needs a value.
- A path that resolves to a wrong value on any page the field is checked on is never certified.
- A website with one layout must certify exactly as it does today: same `certified` array (no `provenOn` key), same cells, same `fieldHash` string. Existing certifications in the database must stay current.
- Only a certified path may fill a customer's cell. Nothing in this plan adds discovery, fallback or AI to `runVerifiedExtraction`.
- Budget rule: never click a Verify or Extract in the live app that shows a dollar amount. Live checks in this plan are free ones only; if a label shows money, stop and report.
- Test gate per package, never `pnpm -r test` (it is killed for memory on this machine): `pnpm --filter @robot/<pkg> test -- --maxWorkers=1 --run`. Postgres must be running (Docker container `robot-platform-db`).
- Typecheck per package: `pnpm --filter @robot/<pkg> exec tsc --noEmit -p .`
- Commit by explicit path only (`git add <paths>`), never `git add -A` or `git add .`. One focused commit per task. End every commit message with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0142fYHHcikKNFv8faR79GCY
  ```
- Dashboard copy rules: sentence case, no uppercase labels, no cards outside dialogs and the websites list. Reuse existing classes (`btn-quiet`, `sheet`, `sheet-row`, `line-warn`, `line-fail`, `label-soft`).
- All packages are ESM: relative imports end in `.js` in `api` and `scraper`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/scraper/src/verify/constants.ts` | `VERIFY_URL_MIN`, `VERIFY_URL_MAX` (keeps `VERIFY_URL_COUNT` as an alias of the minimum) |
| `packages/scraper/src/verify/types.ts` | `CertifiedPath.provenOn?`, `FieldVerification.thinEvidence?` |
| `packages/scraper/src/verify/certify.ts` | the cover rule, `checkedPages` |
| `packages/scraper/src/verify/run-verification.ts` | per-field `fieldHash`, per-field reuse guard |
| `packages/scraper/src/__fixtures__/verify/shop-example/p4.json` | a product page with a second layout |
| `packages/api/src/verify/binding-input.ts` | 3 to 6 urls, blanks only on extra pages |
| `packages/api/src/routers/sources.ts` | `verifyEstimate` counts a changed field as AI-reachable |
| `packages/api/src/crawl/misses.ts` | pure grouping of a run's empty cells by field and listing |
| `packages/api/src/routers/crawl.ts` | `crawl.misses`; `backfillPreview` reports `certified` and a zero estimate |
| `packages/dashboard/src/lib/schema-grid.ts` | variable page count, `addPage`, `removePage`, blank rule |
| `packages/dashboard/src/lib/verification-view.ts` | per-row staleness over the row's own checked pages |
| `packages/dashboard/src/lib/schema-tab-view.ts` | "not checked" cell line, thin-evidence note |
| `packages/dashboard/src/components/schema-grid.tsx`, `page-header-cell.tsx` | Add page column, Remove page |
| `packages/dashboard/src/routes/source-schema.tsx` | `?addPage=&field=` arrival |
| `packages/dashboard/src/components/run-misses.tsx` | the grouped miss list with "Use as proof page" |
| `packages/dashboard/src/routes/source-run-detail.tsx`, `lib/backfill-preview.ts` | mount the list; "free" copy for a verified website |

---

### Task 1: The cover rule in `certify`

**Files:**
- Modify: `packages/scraper/src/verify/types.ts`
- Modify: `packages/scraper/src/verify/certify.ts`
- Test: `packages/scraper/src/verify/certify.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `CertifiedPath = { source; path; transform; provenOn?: string[] }`
  - `FieldVerification.thinEvidence?: boolean`
  - `export function checkedPages(urls: string[], expected: Record<string, string>): string[]` from `certify.ts` — the urls, in order, whose expected value is non-blank.
  - `certify(input, deps)` keeps its signature. `cells` contains only checked pages.

- [ ] **Step 1: Write the failing tests.** Append to `packages/scraper/src/verify/certify.test.ts`, inside the file after the existing `describe('certify', …)` block:

```ts
// Second layout (spec 2026-09-17 §3). Page 4 carries the price under a
// different JSON-LD key; `offers.price` is absent there.
function cap2(url: string, price: string): CaptureLike {
  return {
    url, html: '<html></html>',
    structuredData: { ldJson: [{ priceSpecification: { price } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  };
}
const A = { source: 'json-ld' as const, path: 'offers.price', transform: 'identity' as const };
const B = { source: 'json-ld' as const, path: 'priceSpecification.price', transform: 'identity' as const };
const P4 = 'https://s.example/4';
const P5 = 'https://s.example/5';

describe('certify — second layout', () => {
  it('certifies two safe paths that together cover every checked page, and passes every cell', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50' },
      captures: { ...captures, [P4]: cap2(P4, '89.50') },
      candidates: [B, A],
    }, xpathDeps);
    // A covers three pages, B one: A first.
    expect(r.certified).toEqual([
      { ...A, provenOn: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'] },
      { ...B, provenOn: [P4] },
    ]);
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
    expect(r.cells[P4]).toEqual({ status: 'pass', found: '89.50', path: r.certified[1] });
    expect(r.thinEvidence).toBe(true); // B is proven on one page only
  });

  it('is not thin once the second layout is proven on two pages', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50', [P5]: '45.00' },
      captures: { ...captures, [P4]: cap2(P4, '89.50'), [P5]: cap2(P5, '45.00') },
      candidates: [A, B],
    }, xpathDeps);
    expect(r.certified.map((p) => p.path)).toEqual(['offers.price', 'priceSpecification.price']);
    expect(r.thinEvidence).toBeUndefined();
  });

  it('never certifies a path that is WRONG on any checked page, even if another path covers it', async () => {
    // On page 4 `offers.price` resolves to a different product's price. At scale
    // A is tried first and would win with the wrong value, so A must not be chosen.
    const wrongOn4: CaptureLike = { ...cap2(P4, '89.50'), structuredData: { ldJson: [{ offers: { price: '12.00' }, priceSpecification: { price: '89.50' } }], nextData: null, initialState: null, meta: {} } };
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50' },
      captures: { ...captures, [P4]: wrongOn4 },
      candidates: [A, B],
    }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells[P4]).toMatchObject({ status: 'fail', reason: 'different_value', found: '12.00' });
  });

  it('does not certify when nothing covers the new page, but still shows what works on the others', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50' },
      captures: { ...captures, [P4]: cap2(P4, '89.50') },
      candidates: [A],
    }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://s.example/1']).toEqual({ status: 'pass', found: '129.99', path: A });
    expect(r.cells[P4]).toMatchObject({ status: 'fail', reason: 'not_found' });
  });

  it('a blank expected value means the page is not checked: no cell, no effect on certification', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '' },
      captures: { ...captures, [P4]: cap2(P4, '89.50') },
      candidates: [A],
    }, xpathDeps);
    // Byte-for-byte today's one-layout result: no provenOn, no thinEvidence.
    expect(r.certified).toEqual([A]);
    expect(Object.keys(r.cells)).toEqual(['https://s.example/1', 'https://s.example/2', 'https://s.example/3']);
    expect(r.thinEvidence).toBeUndefined();
    expect(r.incomplete).toBe(false);
  });

  it('an uncaptured page the field is not checked on does not make the field incomplete', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '' },
      captures: { ...captures, [P4]: null },
      candidates: [A],
    }, xpathDeps);
    expect(r.certified).toEqual([A]);
    expect(r.incomplete).toBe(false);
  });
});

describe('checkedPages', () => {
  it('keeps the urls with a non-blank expected value, in url order', () => {
    expect(checkedPages(['u1', 'u2', 'u3', 'u4'], { u4: ' 9 ', u1: '1', u2: '2', u3: '   ' })).toEqual(['u1', 'u2', 'u4']);
  });
});
```

Change the file's import line to:

```ts
import { certify, checkedPages, rankCertified, type CaptureLike } from './certify.js';
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/certify.test.ts`
Expected: FAIL. `checkedPages` is not exported, and the second-layout cases return `certified: []`.

- [ ] **Step 3: Extend the types.** In `packages/scraper/src/verify/types.ts` replace the `CertifiedPath` line and add `thinEvidence` to `FieldVerification`:

```ts
/** `provenOn` is set only when a field needed more than one layout (spec 2026-09-17 §3): the proof pages this path was correct on. Absent on a one-layout result, so those stay byte-for-byte what they were. Ignored by extraction and by path identity. */
export type CertifiedPath = { source: CertifiedSource; path: string; transform: Transform; provenOn?: string[] };
```

```ts
  weakEvidence: boolean;               // all checked expected values identical
  /** Set (true) only when some certified path is proven on a single page: several nodes can hold the same value on one page, so one page is thinner evidence than three. Never blocks certification. */
  thinEvidence?: boolean;
```

- [ ] **Step 4: Implement the rule.** In `packages/scraper/src/verify/certify.ts`:

Replace `type Eval = { raw: unknown; correct: boolean };` with:

```ts
type Eval = { raw: unknown; correct: boolean; empty: boolean };

/** A field's pages: the proof pages it has an expected value on, in url order. A blank cell (allowed on pages four to six only; binding-input enforces that) means "not checked here". */
export function checkedPages(urls: string[], expected: Record<string, string>): string[] {
  return urls.filter((u) => (expected[u] ?? '').trim() !== '');
}

/**
 * Greedy set cover over SAFE candidates: repeatedly take the candidate correct
 * on the most still-uncovered pages, ties going to today's rank. Returns []
 * unless every page is covered within MAX_CERTIFIED_PATHS. Order does not
 * affect correctness (a safe path is correct or empty on every checked page,
 * so whichever resolves first is right); it is by pages proven, then rank,
 * so the common layout is tried first at scale.
 */
function greedyCover(safe: CandidatePath[], pages: string[], isCorrect: (c: CandidatePath, url: string) => boolean): CandidatePath[] {
  const ranked = rankCertified(safe);
  const uncovered = new Set(pages);
  const chosen: CandidatePath[] = [];
  while (uncovered.size > 0 && chosen.length < MAX_CERTIFIED_PATHS) {
    let best: CandidatePath | null = null;
    let bestGain = 0;
    for (const c of ranked) {
      if (chosen.includes(c)) continue;
      const gain = [...uncovered].filter((u) => isCorrect(c, u)).length;
      if (gain > bestGain) { best = c; bestGain = gain; }
    }
    if (!best) break;
    chosen.push(best);
    for (const u of [...uncovered]) if (isCorrect(best, u)) uncovered.delete(u);
  }
  if (uncovered.size > 0) return [];
  const proven = (c: CandidatePath) => pages.filter((u) => isCorrect(c, u)).length;
  return [...chosen].sort((a, b) => proven(b) - proven(a) || ranked.indexOf(a) - ranked.indexOf(b));
}
```

Replace the body of `certify` from its first line down to (and including) the `const rankedCorrectOnAllCaptured = …` line with:

```ts
export async function certify(input: CertifyInput, deps: CertifyDeps): Promise<FieldVerification> {
  const { field, captures } = input;
  // Only the pages this field is checked on take part: evaluation, cells, completeness.
  const urls = checkedPages(Object.keys(captures), input.expected);
  const expected = Object.fromEntries(urls.map((u) => [u, input.expected[u]!]));
  const candidates = dedupe(input.candidates).filter((c) => c.source !== 'xpath' || !Object.values(expected).some((e) => xpathContainsValue(c.path, e)));
  const capturedUrls = urls.filter((u) => captures[u] !== null);

  // Evaluate every candidate on every captured, checked page.
  const evals = new Map<string, Record<string, Eval>>(); // pathId → url → eval
  for (const url of capturedUrls) {
    const capture = captures[url]!;
    const ctx = { pageUrl: capture.url };
    const xpaths = candidates.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(capture.html, xpaths) : {};
    for (const c of candidates) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(capture, c.source, c.path);
      const raw = applyTransform(rawBase, c.transform);
      const empty = raw === null || raw === undefined || raw === '';
      const correct = !empty && valuesEqual(field.type, raw, expected[url] ?? '', ctx);
      if (!evals.has(pathId(c))) evals.set(pathId(c), {});
      evals.get(pathId(c))![url] = { raw, correct, empty };
    }
  }
  const isCorrect = (c: CandidatePath, u: string) => evals.get(pathId(c))?.[u]?.correct === true;

  const complete = capturedUrls.length === urls.length;
  // Safe: on every captured page the field is checked on, correct or nothing.
  // A path that resolves to a WRONG value anywhere is never certified: at
  // scale paths are tried in order and the first value wins.
  const safe = candidates.filter((c) => capturedUrls.length > 0 && capturedUrls.every((u) => { const e = evals.get(pathId(c))?.[u]; return !!e && (e.correct || e.empty); }));
  const correctOnAllCaptured = safe.filter((c) => capturedUrls.every((u) => isCorrect(c, u)));
  const oneLayout = complete ? rankCertified(correctOnAllCaptured).slice(0, MAX_CERTIFIED_PATHS) : [];
  // One layout: exactly today's result, no provenOn. Otherwise a cover, each path stamped with its pages.
  const cover = complete && oneLayout.length === 0 ? greedyCover(safe, capturedUrls, isCorrect) : [];
  const certified: CertifiedPath[] = oneLayout.length > 0
    ? oneLayout
    : cover.map((c) => ({ ...c, provenOn: capturedUrls.filter((u) => isCorrect(c, u)) }));
  const thinEvidence = cover.length > 0 && certified.some((p) => p.provenOn?.length === 1);
  const rankedCorrectOnAllCaptured = rankCertified(correctOnAllCaptured);
  // Without a certification, a page a safe path is correct on still reads as
  // pass, so the customer sees what works and which page is the problem.
  const rankedSafe = rankCertified(safe);
```

Add `CertifiedPath` to the type import at the top of the file:

```ts
import type { CellResult, CertifiedPath, FieldVerification, SchemaDefinitionField } from './types.js';
```

(`CandidatePath` is already `= CertifiedPath` in this file; the import of `CertifiedPath` is already there, keep one.)

In the cells loop, replace the `if (primary) { … continue; }` block (and delete the now-unused `const primary = certified[0];` line) with:

```ts
    if (certified.length > 0) {
      // Every checked page is covered; safety makes the first non-empty path the right one.
      const winner = certified.find((p) => isCorrect(p, url))!;
      cells[url] = { status: 'pass', found: String(evals.get(pathId(winner))![url]!.raw), path: winner };
      continue;
    }
```

Directly after the existing `if (!complete && rankedCorrectOnAllCaptured.length > 0) { … continue; }` block add:

```ts
    const safeHere = rankedSafe.find((c) => isCorrect(c, url));
    if (complete && urls.length > VERIFY_URL_MIN && safeHere) {
      cells[url] = { status: 'pass', found: String(evals.get(pathId(safeHere))![url]!.raw), path: safeHere };
      continue;
    }
```

(The `urls.length > VERIFY_URL_MIN` guard keeps a three-page field's failure cells exactly as they are today.)

Replace the final `return` with:

```ts
  const norms = new Set(Object.values(expected).map((e) => normalize(field.type, e)));
  return {
    key: field.key, cells, certified,
    weakEvidence: norms.size === 1 && Object.keys(expected).length > 1,
    aiCalled: false, incomplete: !complete,
    ...(thinEvidence ? { thinEvidence: true } : {}),
  };
```

Change the constants import to `import { MAX_CERTIFIED_PATHS, VERIFY_URL_MIN } from './constants.js';` and in `packages/scraper/src/verify/constants.ts` replace the first line with:

```ts
export const VERIFY_URL_MIN = 3;
export const VERIFY_URL_MAX = 6;
/** @deprecated the minimum; kept so callers that mean "three" keep compiling until Task 3 moves them. */
export const VERIFY_URL_COUNT = VERIFY_URL_MIN;
```

In `gatherCandidates` (same file), skip pages the field is not checked on: change `const exp = expected[url] ?? '';` to:

```ts
    const exp = expected[url] ?? '';
    if (exp.trim() === '') continue; // not checked here: nothing to search for
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/certify.test.ts`
Expected: PASS, including every pre-existing case unchanged.

- [ ] **Step 6: Typecheck and run the verify folder.**

Run: `pnpm --filter @robot/scraper exec tsc --noEmit -p .` — expected: no output.
Run: `pnpm --filter @robot/scraper exec vitest run src/verify` — expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/types.ts packages/scraper/src/verify/constants.ts
git commit -m "feat(scraper): a field certifies when safe paths together cover its proof pages"
```

---

### Task 2: Per-field pages in the hash and the reuse guard, plus the two-layout fixture

**Files:**
- Modify: `packages/scraper/src/verify/run-verification.ts`
- Create: `packages/scraper/src/__fixtures__/verify/shop-example/p4.json`
- Modify: `packages/scraper/src/__fixtures__/verify/load.ts`
- Test: `packages/scraper/src/verify/run-verification.test.ts`
- Test: `packages/scraper/src/verify/verified-extraction.test.ts`

**Interfaces:**
- Consumes: `checkedPages(urls, expected)` from `./certify.js` (Task 1).
- Produces: `fieldHash(field, set)` — same signature; hashes only the field's checked pages and non-blank expected values. For a set where the field has a value on every url the string is identical to today's. `loadVerifyFixture('shop-example', 'p4')` and `SHOP_EXAMPLE_P4 = 'https://shop.example/p/4'`.

- [ ] **Step 1: Create the fixture.** `packages/scraper/src/__fixtures__/verify/shop-example/p4.json` — a clearance-template page: no `offers` in JSON-LD, no `item.priceCents` in the API, the price lives in `clearance.amount`; everything else as on p1–p3:

```json
{
  "url": "https://shop.example/p/4",
  "html": "<html><body><div id=\"main\"><h1>Widget D</h1><div class=\"clearance\"><span class=\"final\">$89.50</span></div><p class=\"stock\">In stock</p><img class=\"hero\" src=\"/img/d.jpg\" alt=\"Widget D photo\"><ul class=\"colors\"><li>Orange</li></ul><span class=\"rating\">4.1</span></div></body></html>",
  "structuredData": {
    "ldJson": [
      { "@context": "https://schema.org", "@type": "Product", "name": "Widget D" }
    ],
    "nextData": null,
    "initialState": null,
    "meta": { "og:title": "Widget D" }
  },
  "interceptedRequests": [
    {
      "url": "https://shop.example/api/product/4",
      "method": "GET",
      "resourceType": "xhr",
      "responseStatus": 200,
      "responseHeaders": {},
      "responseBody": "{}",
      "contentType": "application/json",
      "bodySize": 1,
      "isJson": true,
      "parsedJson": {
        "item": { "name": "Widget D", "code": "SKU-D4", "images": ["https://shop.example/img/d.jpg"], "colors": ["Orange"], "rating": 4.1 },
        "clearance": { "amount": 89.5 }
      },
      "timestamp": 0
    }
  ]
}
```

Append to `packages/scraper/src/__fixtures__/verify/load.ts`:

```ts
/** A product on the shop's clearance template: the price is NOT where p1–p3 keep it (spec 2026-09-17). */
export const SHOP_EXAMPLE_P4 = 'https://shop.example/p/4';
```

- [ ] **Step 2: Write the failing tests.** Append to `packages/scraper/src/verify/run-verification.test.ts`:

```ts
import { loadVerifyFixture, SHOP_EXAMPLE_P4 as P4 } from '../__fixtures__/verify/load.js';

describe('runVerification — a fourth proof page for one field (spec 2026-09-17)', () => {
  const blank = (key: keyof typeof set.expected) => ({ ...set.expected[key], [P4]: '' });
  const set4: VerificationSet = {
    urls: [...U, P4],
    expected: {
      product_name: blank('product_name'), in_stock: blank('in_stock'), image: blank('image'),
      colors: blank('colors'), rating: blank('rating'),
      price: { ...set.expected.price, [P4]: '89.50' },
    },
  };
  const captures4 = () => ({ ...loadShopExample(), [P4]: loadVerifyFixture('shop-example', 'p4') });

  it('certifies price across both layouts mechanically, and leaves the other fields exactly as they were', async () => {
    const before = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const run = await runVerification({ fields, verificationSet: set4 }, { browser, agent: null, captures: captures4() });
    expect(run.outcome.allPassed).toBe(true);
    expect(run.outcome.aiCalls).toBe(0);
    const price = run.outcome.fields.price!;
    expect(price.certified.length).toBeGreaterThanOrEqual(2);
    expect(price.certified[0]!.provenOn).toEqual(U);
    expect(price.certified.some((p) => p.provenOn?.length === 1 && p.provenOn[0] === P4)).toBe(true);
    expect(price.cells[P4]).toMatchObject({ status: 'pass' });
    expect(price.thinEvidence).toBe(true);
    // The others are not checked on page 4: same cells, same paths, same hash.
    for (const key of ['product_name', 'in_stock', 'image', 'colors', 'rating']) {
      expect(run.outcome.fields[key]!.certified).toEqual(before.outcome.fields[key]!.certified);
      expect(Object.keys(run.outcome.fields[key]!.cells)).toEqual(U);
      expect(run.outcome.fields[key]!.fieldHash).toBe(before.outcome.fields[key]!.fieldHash);
    }
    expect(price.fieldHash).not.toBe(before.outcome.fields.price!.fieldHash);
  }, 60_000);

  it('a scoped re-verify of price reuses the other fields\' stored results even though the url list grew', async () => {
    const before = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const run = await runVerification(
      { fields, verificationSet: set4 },
      { browser, agent: null, captures: captures4(), onlyKeys: ['price'], previous: before.outcome, previousUrls: U },
    );
    for (const key of ['product_name', 'in_stock', 'image', 'colors', 'rating']) {
      expect(run.outcome.fields[key]).toBe(before.outcome.fields[key]); // the same object: reused, not recomputed
    }
    expect(run.outcome.fields.price!.cells[P4]).toMatchObject({ status: 'pass' });
  }, 60_000);

  it('still refuses to reuse a stored result proven against a page that is no longer a proof page', async () => {
    const before = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const moved: VerificationSet = { urls: [U[0]!, U[1]!, P4], expected: Object.fromEntries(Object.entries(set.expected).map(([k, v]) => [k, { [U[0]!]: v[U[0]!]!, [U[1]!]: v[U[1]!]!, [P4]: k === 'price' ? '89.50' : 'x' }])) };
    const run = await runVerification(
      { fields, verificationSet: moved },
      { browser, agent: null, captures: captures4(), onlyKeys: ['price'], previous: before.outcome, previousUrls: U },
    );
    expect(run.outcome.fields.product_name).not.toBe(before.outcome.fields.product_name);
  }, 60_000);
});

describe('fieldHash — per-field pages', () => {
  const f = fields[1]!; // price
  it('is unchanged for a field with a value on every page (existing certifications stay current)', () => {
    // Pinned literal: computed on main before this change. If this fails, every stored certification goes stale.
    expect(fieldHash(f, set)).toBe(fieldHash(f, { ...set, expected: { ...set.expected } }));
    expect(fieldHash(fields[0]!, set)).toBe(fieldHash(fields[0]!, { urls: [...U, P4], expected: { ...set.expected, product_name: { ...set.expected.product_name, [P4]: '' } } }));
  });
  it('changes when the field gains a checked page', () => {
    expect(fieldHash(f, set)).not.toBe(fieldHash(f, { urls: [...U, P4], expected: { ...set.expected, price: { ...set.expected.price, [P4]: '89.50' } } }));
  });
});
```

The "unchanged" claim is pinned against `main`, not against itself: the literal below was computed at `76faf18`, before this change, with this command (re-run it on the pre-change commit if you doubt it):

```bash
pnpm --filter @robot/scraper exec tsx -e "import('./src/verify/run-verification.ts').then(m=>console.log(m.fieldHash({key:'price',name:'Price',type:'money',description:'green number, not the crossed-out one',concept:'price'},{urls:['https://shop.example/p/1','https://shop.example/p/2','https://shop.example/p/3'],expected:{price:{'https://shop.example/p/1':'129.99','https://shop.example/p/2':'219.99','https://shop.example/p/3':'149.00'}}})))"
```

It printed `fed4a2b94eb6c4a43d1582e1d4536499b969e14147d7f3b13620165eaf1664f2`. Add this assertion to the first `fieldHash` test:

```ts
    expect(fieldHash(f, set)).toBe('fed4a2b94eb6c4a43d1582e1d4536499b969e14147d7f3b13620165eaf1664f2');
```

Append to `packages/scraper/src/verify/verified-extraction.test.ts`:

```ts
describe('runVerifiedExtraction — two certified layouts, tried in order', () => {
  const PRICE_TWO: VerifiedField = {
    key: 'price', type: 'money', concept: 'price',
    paths: [
      { source: 'api', path: 'item.priceCents', transform: 'cents_to_units' },
      { source: 'api', path: 'clearance.amount', transform: 'identity' },
    ],
  };
  it('a layout-1 page yields the first path\'s value', async () => {
    const r = await runVerifiedExtraction({ url: URL, fields: [PRICE_TWO] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(r.data.price).toBe(129.99);
    expect(r.stats).toEqual([expect.objectContaining({ hit: true, path: PRICE_TWO.paths[0] })]);
  }, 30_000);
  it('a layout-2 page misses the first path honestly and yields the second', async () => {
    const r = await runVerifiedExtraction({ url: 'https://shop.example/p/4', fields: [PRICE_TWO] }, { browser, capture: loadVerifyFixture('shop-example', 'p4') });
    expect(r.data.price).toBe(89.5);
    expect(r.stats.map((s) => s.hit)).toEqual([false, true]);
  }, 30_000);
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/run-verification.test.ts src/verify/verified-extraction.test.ts`
Expected: the two `verified-extraction` cases PASS already (they pin an existing property). The `runVerification` cases FAIL: the other fields' hashes change and reuse is refused because the url list grew.

- [ ] **Step 4: Implement.** In `packages/scraper/src/verify/run-verification.ts`:

Add to the imports from `./certify.js`: `checkedPages`.

Replace `fieldHash` with:

```ts
/**
 * Per-field hash (spec 4.4; per-field pages since 2026-09-17): the field's own
 * definition, the pages IT is checked on, and its non-blank expected cells.
 * A page added for another field does not move this hash. For a field with a
 * value on every page the string is identical to the pre-2026-09-17 one, so
 * stored certifications stay current.
 */
export function fieldHash(field: SchemaDefinitionField, set: VerificationSet): string {
  const expected = set.expected[field.key] ?? {};
  const pages = checkedPages(set.urls, expected);
  return sha256(JSON.stringify({
    key: field.key,
    type: field.type,
    description: field.description,
    concept: field.concept,
    urls: pages,
    expected: Object.fromEntries(Object.entries(expected).filter(([u]) => pages.includes(u)).sort()),
  }));
}
```

Replace `previousIsStale` and its doc comment with:

```ts
/**
 * May this field's stored result be carried forward? Its hash already covers
 * the field's own pages and expected values; this is the defence-in-depth
 * guard that used to compare whole url lists. A stored cell is keyed by url,
 * so a result is reusable only while every page it was proven on is still a
 * proof page. A page ADDED for another field does not disturb it; a page
 * removed or replaced does. Erring toward re-verifying costs one free
 * mechanical pass, erring the other way costs correctness.
 */
function provenPagesStillPresent(prev: FieldVerification, urls: string[]): boolean {
  return Object.keys(prev.cells).every((u) => urls.includes(u));
}
```

In `runVerification`, delete the `const reuseAllowed = …` line and change the reuse condition to:

```ts
    if (deps.onlyKeys && !deps.onlyKeys.includes(field.key) && prev && prev.fieldHash === fh && provenPagesStillPresent(prev, req.verificationSet.urls)) {
```

Leave `previousUrls` in `VerificationDeps` (callers still pass it) and mark it:

```ts
  /** @deprecated unused since 2026-09-17: reuse is decided per field (`provenPagesStillPresent`). Kept so callers compile. */
  previousUrls?: string[];
```

Capture only what is needed: a page no field is checked on cannot exist (the first three are always checked), so the capture loop is unchanged.

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify`
Expected: PASS. If an existing test asserted that a changed url list forces a full re-verify of an unaffected field, update it to the new rule and say why in the test's comment; a test asserting that a REPLACED page forces it must still pass unchanged.

- [ ] **Step 6: Typecheck, then commit.**

Run: `pnpm --filter @robot/scraper exec tsc --noEmit -p .`

```bash
git add packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/run-verification.test.ts packages/scraper/src/verify/verified-extraction.test.ts packages/scraper/src/__fixtures__/verify/shop-example/p4.json packages/scraper/src/__fixtures__/verify/load.ts
git commit -m "feat(scraper): a field's hash and reuse cover only the pages it is checked on"
```

---

### Task 3: The API accepts three to six pages, and the estimate stays honest

**Files:**
- Modify: `packages/api/src/verify/binding-input.ts`
- Modify: `packages/api/src/routers/sources.ts` (the `verifyEstimate` procedure, around the `aiFields` line)
- Test: `packages/api/src/verify/binding-input.test.ts` (create if absent; otherwise append)
- Test: the existing test file that covers `verifyEstimate` (find it with `grep -rln "verifyEstimate" packages/api/src --include=*.test.ts`)

**Interfaces:**
- Consumes: `VERIFY_URL_MIN`, `VERIFY_URL_MAX`, `fieldHash` from `@robot/scraper`.
- Produces: `bindingInput.urls` accepts 3 to 6. `bindingProblems` allows a blank expected value at index 3 and above. `verifyEstimate` returns the same shape; `aiFields` also counts a field whose stored `fieldHash` differs from the current one.

- [ ] **Step 1: Write the failing tests.** In `packages/api/src/verify/binding-input.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bindingInput, bindingProblems, prepareBinding } from './binding-input.js';
import type { ContractField } from '../contract.js';

const U = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
const P4 = 'https://s.example/4';
const contract = [
  { key: 'title', name: 'Title', type: 'text', concept: 'title' },
  { key: 'price', name: 'Price', type: 'money', concept: 'price' },
] as ContractField[];
const descriptions = { title: 'heading', price: 'green number' };
const full = (urls: string[], price4?: string) => ({
  urls, descriptions,
  expected: {
    title: Object.fromEntries(urls.map((u, i) => [u, i < 3 ? `T${i}` : ''])),
    price: Object.fromEntries(urls.map((u, i) => [u, i < 3 ? `${i + 1}.00` : price4 ?? ''])),
  },
});

describe('binding input — three to six proof pages (spec 2026-09-17 §4)', () => {
  it('accepts a fourth page with only one field filled in', () => {
    expect(bindingProblems(full([...U, P4], '89.50'), contract)).toEqual([]);
    const { verificationSet } = prepareBinding(full([...U, P4], '89.50'), contract);
    expect(verificationSet.urls).toEqual([...U, P4]);
    expect(verificationSet.expected.title![P4]).toBe('');
    expect(verificationSet.expected.price![P4]).toBe('89.50');
  });
  it('still requires every field on each of the first three pages', () => {
    const input = full(U);
    input.expected.title[U[1]!] = '';
    expect(bindingProblems(input, contract)).toEqual([expect.stringContaining('Title @ https://s.example/2')]);
  });
  it('validates a non-blank value on an extra page against the field type', () => {
    expect(bindingProblems(full([...U, P4], 'cheap'), contract)).toEqual([expect.stringContaining('Price @ https://s.example/4')]);
  });
  it('flags an extra page no field is checked on: it would be captured for nothing', () => {
    expect(bindingProblems(full([...U, P4]), contract)).toEqual([`${P4}: type at least one expected value on this page, or remove it`]);
  });
  it('schema: 3 to 6 urls', () => {
    const ok = (n: number) => bindingInput.safeParse({ sourceId: '00000000-0000-4000-8000-000000000000', urls: Array.from({ length: n }, (_, i) => `https://s.example/${i}`), descriptions: {}, expected: {} }).success;
    expect([2, 3, 6, 7].map(ok)).toEqual([false, true, true, false]);
  });
});
```

For the estimate, edit `packages/api/src/routers/sources-verify.test.ts`. Add to its imports: `fieldHash, type SchemaDefinitionField, type VerificationSet` from `@robot/scraper`. Add this helper near `urlsFor`:

```ts
/** The current per-field hash of a source's field, as the server computes it. */
async function hashOf(sourceId: string, key: string): Promise<string> {
  const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const def = (src!.schemaDefinition as SchemaDefinitionField[]).find((d) => d.key === key)!;
  return fieldHash(def, src!.verificationSet as VerificationSet);
}
```

The existing test `prices only the keys that would actually reach AI: a certified key replays for free` stores results with no `fieldHash`. Under the new rule a result with no hash, or a stale one, counts as AI-reachable (such a result is never current anyway). Make that test's `certifiedFv` honest by giving it the live hash: change it to `const certifiedFv = async (key: string) => ({ key, cells: {}, certified: [certifiedPath], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: await hashOf(f.sourceId, key) });` and `await` it where it is used. Its assertions stay as they are.

Then add, in the same `describe('sources.verifyEstimate re-verify pricing', …)` block:

```ts
  it('counts a field whose pages changed as AI-reachable, and only that field', async () => {
    const tag = `est4-${Date.now()}`;
    const urls = urlsFor(tag);
    const f = await createProjectWithSource(caller, {
      tag, urls,
      fields: [{ name: 'Price', type: 'money', description: 'green number' }, { name: 'Title', type: 'text', description: 'heading' }],
      expected: {
        Price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' },
        Title: { [urls[0]!]: 'a', [urls[1]!]: 'b', [urls[2]!]: 'c' },
      },
    });
    try {
      const path = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
      const fv = async (key: string) => ({ key, cells: {}, certified: [path], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: await hashOf(f.sourceId, key) });
      const price = f.keys.Price!; const title = f.keys.Title!;
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(),
        results: { [price]: await fv(price), [title]: await fv(title) }, captures: {},
      });
      expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId })).aiFields).toBe(0);

      // A fourth proof page, checked for Price only (spec 2026-09-17 §4).
      const page4 = `${new URL(urls[0]!).origin}/p/${tag}-4`;
      await caller.sources.updateBinding({
        sourceId: f.sourceId, urls: [...urls, page4],
        descriptions: { [price]: 'green number', [title]: 'heading' },
        expected: {
          [price]: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3', [page4]: '4' },
          [title]: { [urls[0]!]: 'a', [urls[1]!]: 'b', [urls[2]!]: 'c', [page4]: '' },
        },
      });
      // Price has a certified path from pages 1–3, but page four may need AI: not free.
      expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [price] })).aiFields).toBe(1);
      // Title is not checked on page four: its hash did not move.
      expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [title] })).aiFields).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
```

If `createProjectWithSource`'s field type has no `description` property, read `packages/api/src/test-helpers/customer-source.ts` and pass the description the way its other callers do; the `updateBinding` input is `bindingInput` from this task's file.

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts`
Expected: FAIL (four urls rejected; blank cells rejected).

- [ ] **Step 3: Implement.** In `packages/api/src/verify/binding-input.ts`:

```ts
import { VERIFY_URL_MIN, VERIFY_URL_MAX, normalize, validateExpected, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
```

```ts
  urls: z.array(httpUrl).min(VERIFY_URL_MIN).max(VERIFY_URL_MAX),
```

Replace the per-field loop in `bindingProblems` with:

```ts
  for (const f of contract) {
    if (!(input.descriptions[f.key] ?? '').trim()) problems.push(`${f.name}: say where it is on this website`);
    const cells = input.expected[f.key] ?? {};
    input.urls.forEach((url, i) => {
      const value = cells[url] ?? '';
      // Pages four to six: a blank cell means "not checked here" (spec 2026-09-17 §4).
      if (i >= VERIFY_URL_MIN && value.trim() === '') return;
      const err = validateExpected(f.type, value);
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    });
  }
  input.urls.slice(VERIFY_URL_MIN).forEach((url) => {
    if (contract.every((f) => (input.expected[f.key]?.[url] ?? '').trim() === '')) problems.push(`${url}: type at least one expected value on this page, or remove it`);
  });
```

Update the file's header comment: "the three proof pages" → "the three to six proof pages".

In `packages/api/src/routers/sources.ts`, in `verifyEstimate`, import `fieldHash` from `@robot/scraper` (add to the existing import) and replace the `lastResults` / `aiFields` lines with:

```ts
      // A key reaches AI on a re-verify when its latest clean result has no
      // certified path, OR when its pages or expected values changed since
      // (its stored hash no longer matches): a field with a certified path
      // from pages 1–3 may still need AI on a newly added page four, and a
      // label reading "free" for it would be a lie (spec 2026-09-17 §6).
      const lastResults = (last?.results ?? {}) as Record<string, { certified?: unknown[]; fieldHash?: string }>;
      const definition = Array.isArray(source.schemaDefinition) ? (source.schemaDefinition as SchemaDefinitionField[]) : [];
      const set = source.verificationSet as VerificationSet | null;
      const aiFields = estimateKeys.filter((k) => {
        const r = lastResults[k];
        if ((r?.certified?.length ?? 0) === 0) return true;
        const f = definition.find((d) => d.key === k);
        return !!f && !!set && r!.fieldHash !== fieldHash(f, set);
      }).length;
```

- [ ] **Step 4: Run the tests to verify they pass, then the package gate.**

Run: `pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts`
Run: `pnpm --filter @robot/api exec tsc --noEmit -p .`
Run: `pnpm --filter @robot/api test -- --maxWorkers=1 --run`
Expected: all pass. Grep for other three-page assumptions and fix any that reject four pages: `grep -rn "VERIFY_URL_COUNT" packages/api/src packages/scraper/src` — every remaining use must mean "the minimum"; replace each with `VERIFY_URL_MIN` and delete the deprecated alias from `constants.ts` when none are left.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/verify/binding-input.ts packages/api/src/verify/binding-input.test.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-verify.test.ts packages/scraper/src/verify/constants.ts
git commit -m "feat(api): a website takes three to six proof pages; the verify estimate prices a changed field"
```

---

### Task 4: `crawl.misses` — a run's empty cells by field and listing

**Files:**
- Create: `packages/api/src/crawl/misses.ts`
- Test: `packages/api/src/crawl/misses.test.ts`
- Modify: `packages/api/src/routers/crawl.ts` (add `misses` after `coverage`; extend `backfillPreview`)
- Modify: `packages/api/src/crawl/load-run-coverage.ts` (export a sibling loader)

**Interfaces:**
- Consumes: the cell semantics of `computeCoverage` in `coverage.ts` (filled / confirmed-absent / missing).
- Produces:
  ```ts
  export type MissGroup = { listingUrl: string | null; count: number; urls: string[] };
  export type FieldMisses = { name: string; count: number; total: number; groups: MissGroup[] };
  export function computeMisses(fields: Array<{ name: string }>, items: Array<{ url: string; listingUrl: string | null; row: Record<string, unknown> | null; absentFields: string[] }>): FieldMisses[];
  ```
  tRPC `crawl.misses({ runId }) → { certified: boolean; fields: FieldMisses[] }`. `crawl.backfillPreview` additionally returns `certified: boolean`, and `estCostUsd: 0` when certified.

- [ ] **Step 1: Write the failing test.** `packages/api/src/crawl/misses.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMisses, MISS_URLS_PER_GROUP } from './misses.js';

const fields = [{ name: 'title' }, { name: 'price' }];
const L1 = 'https://s.example/cat/sofas';
const L2 = 'https://s.example/cat/chairs';
const item = (n: number, listingUrl: string | null, row: Record<string, unknown> | null, absentFields: string[] = []) =>
  ({ url: `https://s.example/p/${n}`, listingUrl, row, absentFields });

describe('computeMisses', () => {
  it('groups a field\'s empty cells by the listing each product came from, largest group first', () => {
    const out = computeMisses(fields, [
      item(1, L1, { title: 'A', price: 10 }),
      item(2, L2, { title: 'B', price: null }),
      item(3, L2, { title: 'C', price: '' }),
      item(4, L1, { title: 'D', price: null }),
      item(5, L2, { title: 'E' }),
    ]);
    expect(out).toEqual([{
      name: 'price', count: 4, total: 5,
      groups: [
        { listingUrl: L2, count: 3, urls: ['https://s.example/p/2', 'https://s.example/p/3', 'https://s.example/p/5'] },
        { listingUrl: L1, count: 1, urls: ['https://s.example/p/4'] },
      ],
    }]);
  });
  it('omits fields with nothing missing, and treats 0 and false as filled', () => {
    expect(computeMisses(fields, [item(1, L1, { title: 'A', price: 0 }), item(2, L1, { title: 'B', price: false })])).toEqual([]);
  });
  it('a confirmed-absent cell is not a miss', () => {
    expect(computeMisses(fields, [item(1, L1, { title: 'A', price: null }, ['price'])])).toEqual([]);
  });
  it('a failed item (no row) misses every field', () => {
    expect(computeMisses(fields, [item(1, L1, null)]).map((f) => f.name)).toEqual(['title', 'price']);
  });
  it('products given directly form one group with a null listing', () => {
    expect(computeMisses(fields, [item(1, null, { title: 'A' })])[0]!.groups).toEqual([{ listingUrl: null, count: 1, urls: ['https://s.example/p/1'] }]);
  });
  it('caps the urls listed per group but not the count', () => {
    const many = Array.from({ length: MISS_URLS_PER_GROUP + 5 }, (_, i) => item(i, L1, { title: 'x' }));
    const g = computeMisses(fields, many)[0]!.groups[0]!;
    expect(g.count).toBe(MISS_URLS_PER_GROUP + 5);
    expect(g.urls).toHaveLength(MISS_URLS_PER_GROUP);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/misses.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `packages/api/src/crawl/misses.ts`:

```ts
// packages/api/src/crawl/misses.ts
// A run's empty cells, by field and by the listing each product came from
// (spec 2026-09-17 §5). Pure, like coverage.ts, and with the SAME cell
// semantics: filled iff the row has a non-null, non-empty value (0 and false
// count as filled); a confirmed-absent cell is not a miss; every field of a
// failed item (no row) is one. This is what tells a customer that a listing's
// products carry a different layout: "price is empty on 38 products, 36 from
// /cat/sofas" points at a page worth adding as a proof page.

export const MISS_URLS_PER_GROUP = 10;

export type MissGroup = { listingUrl: string | null; count: number; urls: string[] };
export type FieldMisses = { name: string; count: number; total: number; groups: MissGroup[] };
export type MissItem = { url: string; listingUrl: string | null; row: Record<string, unknown> | null; absentFields: string[] };

export function computeMisses(fields: Array<{ name: string }>, items: MissItem[]): FieldMisses[] {
  const out: FieldMisses[] = [];
  for (const f of fields) {
    const groups = new Map<string | null, MissGroup>();
    let count = 0;
    for (const item of items) {
      const value = item.row ? item.row[f.name] : undefined;
      const filled = item.row != null && value != null && value !== '';
      if (filled || item.absentFields.includes(f.name)) continue;
      count++;
      let g = groups.get(item.listingUrl);
      if (!g) { g = { listingUrl: item.listingUrl, count: 0, urls: [] }; groups.set(item.listingUrl, g); }
      g.count++;
      if (g.urls.length < MISS_URLS_PER_GROUP) g.urls.push(item.url);
    }
    if (count > 0) out.push({ name: f.name, count, total: items.length, groups: [...groups.values()].sort((a, b) => b.count - a.count) });
  }
  return out;
}
```

In `packages/api/src/crawl/load-run-coverage.ts` add, after `loadRunCoverage` (reuse its run/source loading by extracting the shared part into a local `loadRunAndItems(db, runId)` that also selects `inputValues`):

```ts
/** The listing a product was found on, as planning recorded it on the item (`input_values.url`); null for a product url given directly. */
function listingUrlOf(inputValues: unknown): string | null {
  const v = (inputValues as { url?: unknown } | null)?.url;
  return typeof v === 'string' && v !== '' ? v : null;
}

export async function loadRunMisses(db: Database, runId: string): Promise<{ sourceId: string; fields: FieldMisses[] }> {
  const { run, items } = await loadRunAndItems(db, runId);
  const fields = effectiveSchema(run.source);
  return {
    sourceId: run.source.id,
    fields: computeMisses(fields, items.map((i) => ({
      url: i.url,
      // A detail item found on a listing carries the listing's url; a detail
      // item that IS the input carries its own url there, which is not a listing.
      listingUrl: listingUrlOf(i.inputValues) === i.url ? null : listingUrlOf(i.inputValues),
      row: Array.isArray(i.extraction?.data) ? (i.extraction!.data[0] as Record<string, unknown> ?? null) : null,
      absentFields: (i.absentFields as string[] | null) ?? [],
    }))),
  };
}
```

with `import { computeMisses, type FieldMisses } from './misses.js';` and `inputValues: true` added to the items' `columns`.

In `packages/api/src/routers/crawl.ts`, after the `coverage` procedure:

```ts
  /**
   * A run's empty cells by field and by listing (spec 2026-09-17 §5). Read-only.
   * `certified` tells the run page whether "Use as proof page" applies: only a
   * website with a verified schema has proof pages to add to.
   */
  misses: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { sourceId, fields } = await loadRunMisses(ctx.db, input.runId);
      const certified = (await loadCurrentCertification(ctx.db, sourceId)) !== null;
      return { certified, fields };
    }),
```

Import `loadRunMisses` from `../crawl/load-run-coverage.js` and `loadCurrentCertification` from `../verify/current-certification.js` (check the top of the file; `requireCertification` already imports from that module's neighbour).

In `backfillPreview`, make a verified website's repair read as what it is, free. The run's source id is needed; `loadRunCoverage` does not return it, so load it the same way `misses` does:

```ts
      const { sourceId } = await loadRunMisses(ctx.db, input.runId);
      const certified = (await loadCurrentCertification(ctx.db, sourceId)) !== null;
      return {
        pages: items.length,
        // A certified website runs certified paths only; it never reaches the AI tiers the "up to" figure prices.
        estCostUsd: certified ? 0 : Number((items.length * EST_AI_COST_PER_PAGE_USD).toFixed(2)),
        certified,
        fields: classifyFields(cov.fields, targetNames),
      };
```

Add to `packages/api/src/routers/crawl-backfill-preview.test.ts` (its `seedRunWithGapItems` seeds one run with `title` filled on one of two items and `isbn` on neither; the items carry no `input_values`, so they group under a null listing):

```ts
describe('crawl.misses', () => {
  it('groups a run\'s empty cells by field and listing, and says an unverified website is not certified', async () => {
    const { runId } = await seedRunWithGapItems();
    const out = await caller.crawl.misses({ runId });
    expect(out.certified).toBe(false);
    expect(out.fields.map((f) => [f.name, f.count, f.total])).toEqual([['title', 1, 2], ['isbn', 2, 2]]);
    expect(out.fields[0]!.groups).toEqual([{ listingUrl: null, count: 1, urls: ['https://example.com/p/2'] }]);
    expect(out.fields[1]!.groups[0]!.urls).toEqual(expect.arrayContaining(['https://example.com/p/1', 'https://example.com/p/2']));
  });
  it('a product found on a listing groups under that listing', async () => {
    const { runId } = await seedRunWithGapItems();
    await db.insert(runItems).values({
      runId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0,
      inputValues: { url: 'https://example.com/cat/a' }, status: 'failed', error: 'blocked',
    });
    const title = (await caller.crawl.misses({ runId })).fields.find((f) => f.name === 'title')!;
    expect(title.groups).toEqual(expect.arrayContaining([{ listingUrl: 'https://example.com/cat/a', count: 1, urls: ['https://example.com/p/3'] }]));
  });
  it('a clean run has no misses', async () => {
    const { runId } = await seedRunWithNoGaps();
    expect((await caller.crawl.misses({ runId })).fields).toEqual([]);
  });
});

describe('crawl.backfillPreview on an unverified website', () => {
  it('keeps the "up to" AI estimate and reports certified: false', async () => {
    const { runId } = await seedRunWithGapItems();
    const p = await caller.crawl.backfillPreview({ runId });
    expect(p.certified).toBe(false);
    expect(p.estCostUsd).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run the tests, typecheck, package gate.**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/misses.test.ts`
Run: `pnpm --filter @robot/api exec tsc --noEmit -p .`
Run: `pnpm --filter @robot/api test -- --maxWorkers=1 --run`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/crawl/misses.ts packages/api/src/crawl/misses.test.ts packages/api/src/crawl/load-run-coverage.ts packages/api/src/routers/crawl.ts packages/api/src/routers/crawl-backfill-preview.test.ts
git commit -m "feat(api): crawl.misses groups a run's empty cells by field and listing"
```

---

### Task 5: Dashboard model — variable page count, blank rule, per-row staleness

**Files:**
- Modify: `packages/dashboard/src/lib/schema-grid.ts`
- Modify: `packages/dashboard/src/lib/verification-view.ts`
- Modify: `packages/dashboard/src/lib/schema-tab-view.ts`
- Test: `packages/dashboard/src/lib/schema-grid.test.ts`, `verification-view.test.ts`, `schema-tab-view.test.ts` (append to each; they exist)

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime; mirrors Task 3's server rules.
- Produces, from `schema-grid.ts`:
  ```ts
  export const URL_MIN = 3; export const URL_MAX = 6;
  export const URL_COUNT = URL_MIN; // kept: "the number a new grid starts with"
  export function addPage(state: GridState, url?: string): GridState;      // no-op at URL_MAX; appends '' to every row's expected
  export function removePage(state: GridState, index: number): GridState;  // no-op for index < URL_MIN
  export function canAddPage(state: GridState): boolean;
  ```
  From `verification-view.ts`: `isRowStale(row, grid, saved)` (new middle argument) compares the row's own checked pages. `reverifyKeys` no longer returns `undefined` merely because the url list changed. `FieldVerificationView` gains `thinEvidence?: boolean`.
  From `schema-tab-view.ts`: `cellLine(status, typed, typeFix?, pageIndex?)` (new optional fourth argument) returns `{ tone: 'none', text: 'not checked' }` for a blank cell with no status on page four or later, and appends ` · layout N` to a pass line when `status.layout` is 2 or more; `thinEvidenceNote(results, rows): string | null`.
  From `verification-view.ts` and `components/schema-grid.tsx`: `CellStatus` gains `layout?: number`, set by `cellStatusFor` to the 1-based position of the passing cell's path in the field's certified list, only when that list has more than one path.

- [ ] **Step 1: Write the failing tests.** Append to `packages/dashboard/src/lib/schema-grid.test.ts`:

```ts
import { addPage, removePage, canAddPage, URL_MAX } from './schema-grid';

describe('proof pages: three to six', () => {
  const base = (): GridState => ({
    urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '',
    rows: [
      { id: 'a', key: 'title', name: 'Title', type: 'text', description: 'heading', expected: ['A', 'B', 'C'] },
      { id: 'b', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] },
    ],
  });
  it('addPage appends a url and a blank cell on every row', () => {
    const s = addPage(base(), 'https://s.example/4');
    expect(s.urls).toHaveLength(4);
    expect(s.rows.map((r) => r.expected)).toEqual([['A', 'B', 'C', ''], ['1', '2', '3', '']]);
  });
  it('addPage focuses an existing page instead of duplicating it, and stops at six', () => {
    expect(addPage(base(), 'https://s.example/2').urls).toHaveLength(3);
    let s = base();
    for (let i = 4; i <= 9; i++) s = addPage(s, `https://s.example/${i}`);
    expect(s.urls).toHaveLength(URL_MAX);
    expect(canAddPage(s)).toBe(false);
  });
  it('removePage drops the column on every row, but never one of the first three', () => {
    const s = addPage(base(), 'https://s.example/4');
    expect(removePage(s, 3).rows[0]!.expected).toEqual(['A', 'B', 'C']);
    expect(removePage(s, 1)).toBe(s);
  });
  it('a blank cell is a problem on pages one to three and fine on page four', () => {
    const s = addPage(base(), 'https://s.example/4');
    s.rows[1]!.expected[3] = '89.50';
    expect(bindingProblems(s)).toEqual([]);
    s.rows[0]!.expected[1] = '';
    expect(bindingProblems(s)).toEqual([expect.stringContaining('Title @ https://s.example/2')]);
  });
  it('an extra page nobody typed on is a problem', () => {
    expect(bindingProblems(addPage(base(), 'https://s.example/4'))).toEqual(['https://s.example/4: type at least one expected value on this page, or remove it']);
  });
  it('toBindingInput sends every page, blanks included', () => {
    const s = addPage(base(), 'https://s.example/4');
    expect(toBindingInput(s).expected.title).toEqual({ 'https://s.example/1': 'A', 'https://s.example/2': 'B', 'https://s.example/3': 'C', 'https://s.example/4': '' });
  });
});
```

Append to `packages/dashboard/src/lib/verification-view.test.ts` (adapt the imports to the file's existing ones):

```ts
describe('staleness is per row, over the pages the row is checked on', () => {
  const saved: GridState = {
    urls: ['u1', 'u2', 'u3'], listingUrl: '',
    rows: [
      { id: 'a', key: 'title', name: 'Title', type: 'text', description: 'h', expected: ['A', 'B', 'C'] },
      { id: 'b', key: 'price', name: 'Price', type: 'money', description: 'g', expected: ['1', '2', '3'] },
    ],
  };
  const withPage4: GridState = { ...saved, urls: [...saved.urls, 'u4'], rows: [{ ...saved.rows[0]!, expected: ['A', 'B', 'C', ''] }, { ...saved.rows[1]!, expected: ['1', '2', '3', '89.50'] }] };
  const results = { title: { cells: {}, certified: [{}], weakEvidence: false }, price: { cells: {}, certified: [{}], weakEvidence: false } } as never;

  it('adding a page for price makes price stale and leaves title alone', () => {
    expect(isRowStale(withPage4.rows[1]!, withPage4, saved)).toBe(true);
    expect(isRowStale(withPage4.rows[0]!, withPage4, saved)).toBe(false);
    expect(reverifyKeys(results, withPage4, saved, ['title', 'price'])).toEqual(['price']);
  });
  it('replacing one of the first three pages makes every row stale', () => {
    const moved = { ...saved, urls: ['u1', 'uX', 'u3'] };
    expect(reverifyKeys(results, moved, saved, ['title', 'price'])).toEqual(['title', 'price']);
  });
});
```

Append to `packages/dashboard/src/lib/schema-tab-view.test.ts`:

```ts
describe('extra proof pages', () => {
  it('a blank cell on page four reads "not checked"; on page two it stays empty', () => {
    expect(cellLine(null, '', null, 3)).toEqual({ tone: 'none', text: 'not checked' });
    expect(cellLine(null, '  ', null, 3)).toEqual({ tone: 'none', text: 'not checked' });
    expect(cellLine(null, '', null, 1)).toEqual({ tone: 'none', text: '' });
    expect(cellLine(null, '89.50', null, 3)).toEqual({ tone: 'none', text: '' }); // typed, not verified yet
  });
  it('a pass on the second layout says so', () => {
    expect(cellLine({ status: 'pass', found: '89.50', pathSource: 'API', layout: 2 }, '89.50')).toEqual({ tone: 'pass', text: 'from API · layout 2' });
    expect(cellLine({ status: 'pass', found: '1', pathSource: 'API', layout: 1 }, '1')).toEqual({ tone: 'pass', text: 'from API' });
  });
  it('names the fields whose second layout is proven on one page', () => {
    const results = { price: { thinEvidence: true }, title: {} } as never;
    expect(thinEvidenceNote(results, [{ key: 'price', name: 'Price' }, { key: 'title', name: 'Title' }])).toBe('Price: second layout proven on one page · add another page of that layout to be sure');
    expect(thinEvidenceNote({ title: {} } as never, [{ key: 'title', name: 'Title' }])).toBeNull();
  });
});
```

`cellLine`'s current signature is `cellLine(status: CellStatus | null, typed: string, typeFix?: 'url' | null)`; this task adds an optional fourth argument `pageIndex?: number`. Keep every existing return untouched apart from the two additions below.

Also append to `packages/dashboard/src/lib/verification-view.test.ts`:

```ts
describe('cellStatusFor — which layout proved a cell', () => {
  const A = { source: 'api', path: 'item.priceCents', transform: 'cents_to_units' };
  const B = { source: 'api', path: 'clearance.amount', transform: 'identity' };
  const results = { price: { key: 'price', weakEvidence: false, certified: [{ ...A, provenOn: ['u1', 'u2', 'u3'] }, { ...B, provenOn: ['u4'] }], cells: {
    u1: { status: 'pass', found: '1', path: { ...A, provenOn: ['u1', 'u2', 'u3'] } },
    u4: { status: 'pass', found: '89.5', path: { ...B, provenOn: ['u4'] } },
  } } } as never;
  it('numbers the layout only when the field has more than one', () => {
    expect(cellStatusFor(results, 'price', 'u1', false)).toMatchObject({ status: 'pass', layout: 1 });
    expect(cellStatusFor(results, 'price', 'u4', false)).toMatchObject({ status: 'pass', layout: 2 });
    const one = { price: { key: 'price', weakEvidence: false, certified: [A], cells: { u1: { status: 'pass', found: '1', path: A } } } } as never;
    expect(cellStatusFor(one, 'price', 'u1', false)!.layout).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/schema-grid.test.ts src/lib/verification-view.test.ts src/lib/schema-tab-view.test.ts`
Expected: FAIL (missing exports, old signatures).

- [ ] **Step 3: Implement `schema-grid.ts`.**

Replace `export const URL_COUNT = 3;` with:

```ts
export const URL_MIN = 3;
export const URL_MAX = 6;
/** The number of proof pages a new grid starts with. */
export const URL_COUNT = URL_MIN;
```

In `setCell`, the clip uses the row's own width so a paste can reach page four: replace `if (i < 0 || i >= URL_COUNT) return row;` with `if (i < 0 || i >= row.expected.length) return row;`.

In `applyPasteByName`, replace `const hasType = block[0]!.length >= 2 + 1 + URL_COUNT;` with `const hasType = block[0]!.length >= 2 + 1 + state.urls.length;`.

Add:

```ts
export function canAddPage(state: GridState): boolean { return state.urls.length < URL_MAX; }

/** Append a proof page (spec 2026-09-17 §6). A url already present is left alone; six is the cap. */
export function addPage(state: GridState, url = ''): GridState {
  const u = url.trim();
  if (u !== '' && state.urls.some((x) => x.trim() === u)) return state;
  if (!canAddPage(state)) return state;
  return { ...state, urls: [...state.urls, u], rows: state.rows.map((r) => ({ ...r, expected: [...r.expected, ''] })) };
}

/** Remove an extra proof page. The first three are the floor and cannot be removed. */
export function removePage(state: GridState, index: number): GridState {
  if (index < URL_MIN || index >= state.urls.length) return state;
  return { ...state, urls: state.urls.filter((_, i) => i !== index), rows: state.rows.map((r) => ({ ...r, expected: r.expected.filter((_, i) => i !== index) })) };
}
```

In `bindingProblems`, replace the `URL_COUNT` message and the expected loop:

```ts
  if (urls.some((u) => u === '')) problems.push('Every proof page needs a URL');
```

```ts
    r.expected.forEach((v, i) => {
      if (i >= URL_MIN && v.trim() === '') return; // pages four to six: blank means "not checked here"
      const err = validateExpectedClient(r.type, v);
      if (err) problems.push(`${r.name} @ ${urls[i] || `URL ${i + 1}`}: ${err}`);
    });
```

and after the rows loop:

```ts
  urls.forEach((u, i) => {
    if (i >= URL_MIN && state.rows.length > 0 && state.rows.every((r) => (r.expected[i] ?? '').trim() === '')) problems.push(`${u || `URL ${i + 1}`}: type at least one expected value on this page, or remove it`);
  });
```

If an existing test pins the old message `All 3 product URLs are required`, update it to the new text.

- [ ] **Step 4: Implement `verification-view.ts`.**

Add `thinEvidence?: boolean` to the field-verification view type (next to `weakEvidence`).

Replace `isRowStale` with:

```ts
/** The (url, expected) pairs a row is actually checked on: blank cells on pages four to six are "not checked" and take no part (mirrors the server's `checkedPages` / `fieldHash`). */
function checkedCells(row: GridRow, urls: string[]): Array<[string, string]> {
  return urls.map((u, i) => [u.trim(), row.expected[i] ?? ''] as [string, string]).filter(([, v]) => v.trim() !== '');
}

/**
 * Has this row drifted from what was last saved? Its definition, or the pages
 * it is checked on, or a value on one of them. A page added for ANOTHER field
 * leaves this row alone (spec 2026-09-17 §4); replacing one of the first three
 * pages moves every row, since every row has a value there.
 */
export function isRowStale(row: GridRow, grid: GridState, saved: GridState | null): boolean {
  if (!saved) return false;
  const savedRow = row.key ? saved.rows.find((r) => r.key === row.key) : undefined;
  if (!savedRow) return false;
  return (
    row.name !== savedRow.name ||
    row.type !== savedRow.type ||
    row.description !== savedRow.description ||
    JSON.stringify(checkedCells(row, grid.urls)) !== JSON.stringify(checkedCells(savedRow, saved.urls))
  );
}
```

In `reverifyKeys`, delete the line `if (savedGrid && urlsChanged(grid, savedGrid)) return undefined;` and change the call to `isRowStale(row, grid, savedGrid)`. Delete `urlsChanged` if nothing else uses it (`grep -n urlsChanged packages/dashboard/src -r`). Update the doc comment of `reverifyKeys` to say a url change is now handled per row.

Update the one other caller, `cellIsStale` in `packages/dashboard/src/routes/source-schema.tsx`: `isRowStale(row, savedGrid)` → `isRowStale(row, grid, savedGrid)`. (The rest of that file is Task 6.)

- [ ] **Step 5: Implement `schema-tab-view.ts`.**

Give `cellLine` its optional fourth argument and the layout suffix:

```ts
export function cellLine(status: CellStatus | null, typed: string, typeFix?: 'url' | null, pageIndex?: number): CellLine {
  // Pages four to six: a blank cell is "not checked here", not an omission (spec 2026-09-17 §4).
  if (!status) return { tone: 'none', text: typed.trim() === '' && (pageIndex ?? 0) >= 3 ? 'not checked' : '' };
  switch (status.status) {
    case 'pass': {
      if (status.found !== undefined && status.found !== typed) return { tone: 'pass', text: `page shows ${status.found}` };
      const layout = status.layout && status.layout > 1 ? ` · layout ${status.layout}` : '';
      return { tone: 'pass', text: (status.pathSource ? `from ${status.pathSource}` : 'verified') + layout };
    }
```

(the remaining cases stay exactly as they are). In `packages/dashboard/src/components/schema-grid.tsx` add `layout?: number` to the `CellStatus` type. In `verification-view.ts`'s `cellStatusFor`, replace the pass return with:

```ts
  if (cell.status === 'pass') {
    // Which certified path proved this page, 1-based, only when the field needed more than one layout.
    const same = (a: { source: string; path: string; transform: string }, b: { source: string; path: string; transform: string }) => a.source === b.source && a.path === b.path && a.transform === b.transform;
    const at = fv.certified.length > 1 && cell.path ? fv.certified.findIndex((p) => same(p, cell.path!)) : -1;
    return { status: 'pass', found: cell.found, weak, pathSource: pathSourceLabel(cell.path?.source), ...(at >= 0 ? { layout: at + 1 } : {}) };
  }
```

Make sure the view types in that file give `certified` entries and `cell.path` the three identity fields plus optional `provenOn`.

Then add:

```ts
/** One line for the strip when a field's second layout rests on a single page (spec 2026-09-17 §3). */
export function thinEvidenceNote(results: Record<string, { thinEvidence?: boolean }> | null | undefined, rows: Array<{ key?: string; name: string }>): string | null {
  const names = rows.filter((r) => r.key && results?.[r.key]?.thinEvidence).map((r) => r.name);
  return names.length ? `${names.join(', ')}: second layout proven on one page · add another page of that layout to be sure` : null;
}
```

- [ ] **Step 6: Run the tests, typecheck, package gate.**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib`
Run: `pnpm --filter @robot/dashboard exec tsc --noEmit -p .`
Run: `pnpm --filter @robot/dashboard test -- --maxWorkers=1 --run`
Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add packages/dashboard/src/lib/schema-grid.ts packages/dashboard/src/lib/schema-grid.test.ts packages/dashboard/src/lib/verification-view.ts packages/dashboard/src/lib/verification-view.test.ts packages/dashboard/src/lib/schema-tab-view.ts packages/dashboard/src/lib/schema-tab-view.test.ts packages/dashboard/src/routes/source-schema.tsx
git commit -m "feat(dashboard): the proof sheet model takes three to six pages, stale per row"
```

---

### Task 6: The Schema tab — Add page, Remove page, arrival from a run

**Files:**
- Modify: `packages/dashboard/src/components/schema-grid.tsx`
- Modify: `packages/dashboard/src/components/page-header-cell.tsx`
- Modify: `packages/dashboard/src/routes/source-schema.tsx`
- Modify: `packages/dashboard/src/router.tsx` (`sourceSchemaRoute`, the index route under `/projects/$project/sources/$source`; routing here is code-based, `createRoute`)
- Test: `packages/dashboard/src/components/schema-grid.test.tsx` if it exists, otherwise the UI smoke in Task 8 covers rendering; the arrival logic gets a unit test in `packages/dashboard/src/lib/schema-grid.test.ts` via `addPage` (done in Task 5).

**Interfaces:**
- Consumes: `addPage`, `removePage`, `canAddPage`, `URL_MIN` (Task 5); `cellLine(status, cell)`, `thinEvidenceNote` (Task 5).
- Produces: Schema tab search params `addPage?: string`, `field?: string`. `SchemaGrid` props gain `onAddPage?: () => void` and `onRemovePage?: (index: number) => void`. `PageHeaderCell` props gain `onRemove?: () => void`.

- [ ] **Step 1: `PageHeaderCell` gets a remove control.** Read the file. In the popover that holds the URL input and "Find pages", add below them, only when `onRemove` is given and the cell is not `disabled`:

```tsx
{onRemove && !disabled && (
  <button type="button" className="btn-quiet mt-2" onClick={onRemove} aria-label={`Remove page ${index + 1}`}>
    Remove this page
  </button>
)}
```

Add `onRemove?: () => void` to the props type and destructure it.

- [ ] **Step 2: `SchemaGrid` gets the Add page column.** In the header row, pass `onRemove` for extra pages and add a trailing header cell:

```tsx
                  onFindPages={onFindPages}
                  onRemove={i >= URL_MIN && onRemovePage ? () => onRemovePage(i) : undefined}
```

```tsx
            {onAddPage && !readOnly && (
              <th className="w-[92px] px-2 py-1.5 text-left align-top font-normal">
                <button type="button" className="btn-quiet" onClick={onAddPage} aria-label="Add a proof page">Add page</button>
              </th>
            )}
```

and a matching empty `<td />` at the end of every body row when that header cell is rendered, so the sheet's columns stay aligned. Import `URL_MIN` from `../lib/schema-grid`. Where the grid computes each expected cell's line, pass the page index as the new fourth argument: find the existing `cellLine(` call (`grep -rn "cellLine(" packages/dashboard/src --include=*.tsx`) and add the column index after its current arguments, passing `null` for `typeFix` when the call does not already pass one.

Raise the table's `min-w-[1100px]` to grow with the page count: `style={{ minWidth: 560 + state.urls.length * 180 }}` and drop the fixed class.

- [ ] **Step 3: `source-schema.tsx` wires them and handles the arrival.**

Replace `setGrid({ urls: ['', '', ''], …` with `urls: Array(URL_COUNT).fill('')` (import `URL_COUNT`).

Replace `pageCount: URL_COUNT` in the `stripSummary` call with `pageCount: grid.urls.length`.

Pass the handlers (only when the table is editable, i.e. the same condition that sets `readOnly` false):

```tsx
onAddPage={canAddPage(grid) ? () => setGrid((g) => addPage(g)) : undefined}
onRemovePage={(i) => setGrid((g) => removePage(g, i))}
```

Declare the search params on `sourceSchemaRoute` in `packages/dashboard/src/router.tsx` (add the `validateSearch` option to its `createRoute({ … })`):

```ts
validateSearch: (s: Record<string, unknown>) => ({
  ...(typeof s.addPage === 'string' ? { addPage: s.addPage } : {}),
  ...(typeof s.field === 'string' ? { field: s.field } : {}),
}),
```

In the component (import `useSearch` from `@tanstack/react-router`), after the grid is initialised from the source (the effect that sets `initialized.current = true`), apply the arrival once:

```tsx
  // router.tsx imports this component, so the route object cannot be imported back here.
  const search = useSearch({ strict: false }) as { addPage?: string; field?: string };
  const arrival = useRef(false);
  const [arrivalNote, setArrivalNote] = useState<string | null>(null);
  useEffect(() => {
    if (!initialized.current || arrival.current || !search.addPage) return;
    arrival.current = true;
    setGrid((g) => addPage(g, search.addPage));
    setTouched(true);
    const name = grid.rows.find((r) => r.key === search.field)?.name;
    setArrivalNote(name
      ? `Added from a run: type what ${name} should be on this page, then verify.`
      : 'Added from a run: type the expected value on this page, then verify.');
  }, [search.addPage, search.field, grid.rows]);
```

Render the note as one line above the grid, using the same element and classes the file already uses for its inline notes (find the existing note about fields living on the project page and mirror it). When `addPage` was refused because six pages exist, the note reads: `This website already has six proof pages. Remove one to add this page.` (detect with `!canAddPage(grid) && !grid.urls.includes(search.addPage)` before calling `addPage`).

Under the status strip, render the thin-evidence line when present:

```tsx
{(() => { const t = thinEvidenceNote(results, grid.rows); return t ? <p className="mt-1 text-[12px] line-warn">{t}</p> : null; })()}
```

- [ ] **Step 4: Typecheck and run the dashboard tests.**

Run: `pnpm --filter @robot/dashboard exec tsc --noEmit -p .`
Run: `pnpm --filter @robot/dashboard test -- --maxWorkers=1 --run`
Expected: all pass.

- [ ] **Step 5: See it.** With `pnpm dev:all` running, open the Ikea website's Schema tab at `http://localhost:3456/projects/<project>/sources/<source>` (the bare website URL is the Schema tab; find the slugs in the URL bar from the projects list). Check: an "Add page" control after page three; clicking it adds a fourth column whose blank cells read "not checked"; the header popover of page four has "Remove this page" and pages one to three do not; the Verify button is disabled with the problem "type at least one expected value on this page, or remove it" until a value is typed. Do not click Verify in this task. Remove the page again so nothing is saved.

- [ ] **Step 6: Commit.**

```bash
git add packages/dashboard/src/components/schema-grid.tsx packages/dashboard/src/components/page-header-cell.tsx packages/dashboard/src/routes/source-schema.tsx packages/dashboard/src/router.tsx
git commit -m "feat(dashboard): the Schema tab adds and removes proof pages, and takes one from a run"
```

---

### Task 7: The run page — grouped misses with "Use as proof page", and an honest repair label

**Files:**
- Create: `packages/dashboard/src/components/run-misses.tsx`
- Create: `packages/dashboard/src/lib/run-misses-view.ts`
- Test: `packages/dashboard/src/lib/run-misses-view.test.ts`
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx`
- Modify: `packages/dashboard/src/lib/backfill-preview.ts` and its test

**Interfaces:**
- Consumes: tRPC `crawl.misses({ runId }) → { certified, fields: FieldMisses[] }` and `backfillPreview.certified` (Task 4); Schema tab search params `addPage`, `field` (Task 6).
- Produces: `missLine(f, labelOf)`, `listingLabel(url)`; `<RunMisses runId projectSlug sourceSlug fields={contract fields} />`.

- [ ] **Step 1: Write the failing test.** `packages/dashboard/src/lib/run-misses-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { missLine, listingLabel } from './run-misses-view';

describe('run misses copy', () => {
  it('one sentence per field: the count, then each listing with its share', () => {
    expect(missLine({ name: 'price', count: 38, total: 600, groups: [
      { listingUrl: 'https://www.ikea.com/my/en/cat/two-seater-sofas-10668/', count: 36, urls: [] },
      { listingUrl: 'https://www.ikea.com/my/en/cat/armchairs-16239/', count: 2, urls: [] },
    ] }, 'Price')).toBe('Price is empty on 38 of 600 products · 36 from /my/en/cat/two-seater-sofas-10668/ · 2 from /my/en/cat/armchairs-16239/');
  });
  it('says "all" when one listing holds every miss, and handles products given directly', () => {
    expect(missLine({ name: 'price', count: 3, total: 10, groups: [{ listingUrl: 'https://s.example/cat/a', count: 3, urls: [] }] }, 'Price')).toBe('Price is empty on 3 of 10 products · all from /cat/a');
    expect(missLine({ name: 'price', count: 1, total: 4, groups: [{ listingUrl: null, count: 1, urls: [] }] }, 'Price')).toBe('Price is empty on 1 of 4 products · all from the product URLs you gave');
  });
  it('listingLabel is the path, never the host', () => {
    expect(listingLabel('https://s.example/cat/a?page=2')).toBe('/cat/a?page=2');
    expect(listingLabel('not a url')).toBe('not a url');
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/run-misses-view.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `packages/dashboard/src/lib/run-misses-view.ts`:

```ts
// Copy for the run page's grouped misses (spec 2026-09-17 §5).
export type MissGroupView = { listingUrl: string | null; count: number; urls: string[] };
export type FieldMissesView = { name: string; count: number; total: number; groups: MissGroupView[] };

export function listingLabel(url: string | null): string {
  if (url === null) return 'the product URLs you gave';
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

export function missLine(f: FieldMissesView, label: string): string {
  const head = `${label} is empty on ${f.count.toLocaleString('en-US')} of ${f.total.toLocaleString('en-US')} products`;
  if (f.groups.length === 1) return `${head} · all from ${listingLabel(f.groups[0]!.listingUrl)}`;
  return [head, ...f.groups.map((g) => `${g.count.toLocaleString('en-US')} from ${listingLabel(g.listingUrl)}`)].join(' · ');
}
```

- [ ] **Step 4: Implement the component** `packages/dashboard/src/components/run-misses.tsx`:

```tsx
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { missLine, listingLabel } from '../lib/run-misses-view';

/**
 * A verified website's empty cells, by field and by listing (spec 2026-09-17
 * §5). A listing whose products all miss the same field is a second layout;
 * "Use as proof page" takes one of those products to the Schema tab, where the
 * customer types the one missing value and verifies.
 */
export function RunMisses({ runId, projectSlug, sourceSlug, fields }: {
  runId: string; projectSlug: string; sourceSlug: string;
  /** The contract's fields, for the customer's own names. */
  fields: Array<{ name: string; label?: string }>;
}) {
  const query = trpc.crawl.misses.useQuery({ runId });
  const [open, setOpen] = useState<string | null>(null);
  const data = query.data;
  if (!data || !data.certified || data.fields.length === 0) return null;
  const labelOf = (name: string) => fields.find((f) => f.name === name)?.label ?? name;

  return (
    <section aria-label="Empty cells" className="mt-4">
      <h2 className="text-[13px] font-semibold text-gray-900">Empty cells</h2>
      <p className="mt-0.5 text-[12px] text-gray-600">
        A listing whose products all miss the same field usually lays that field out differently. Add one of them as a proof page to teach this website the second layout.
      </p>
      <ul className="mt-2">
        {data.fields.map((f) => (
          <li key={f.name} className="sheet-row py-1.5">
            <button type="button" className="btn-quiet text-left" aria-expanded={open === f.name} onClick={() => setOpen(open === f.name ? null : f.name)}>
              {missLine(f, labelOf(f.name))}
            </button>
            {open === f.name && (
              <div className="mt-1 pl-3">
                {f.groups.map((g) => (
                  <div key={g.listingUrl ?? 'direct'} className="mt-1">
                    <p className="text-[12px] text-gray-600">
                      {g.count.toLocaleString('en-US')} from {listingLabel(g.listingUrl)}{g.count > g.urls.length ? ` · showing ${g.urls.length}` : ''}
                    </p>
                    <ul>
                      {g.urls.map((url) => (
                        <li key={url} className="flex items-center gap-3 py-0.5 text-[12px]">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 font-mono text-gray-900 underline-offset-2 hover:underline">
                            <span className="truncate">{listingLabel(url)}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                          <Link
                            to="/projects/$project/sources/$source"
                            params={{ project: projectSlug, source: sourceSlug }}
                            search={{ addPage: url, field: f.name }}
                            className="btn-quiet flex-shrink-0"
                          >
                            Use as proof page
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

The Schema tab is the index route of `/projects/$project/sources/$source` (`router.tsx`), with params `project` and `source`. Check the `trpc` import path against a neighbouring component and use what the codebase uses.

- [ ] **Step 5: Mount it and fix the repair label.** In `packages/dashboard/src/routes/source-run-detail.tsx`, directly above the `BackfillGapsPanel` block and under the same condition (`runIsTerminal && !probeGateShowing && !isBackfillRun`):

```tsx
        <RunMisses runId={runId} projectSlug={projectSlug} sourceSlug={sourceSlug} fields={fields} />
```

(`fields` is the list the results table already gets: `{ name, type, label }`.)

In `packages/dashboard/src/lib/backfill-preview.ts`: `previewSummary` takes `certified?: boolean` and, when true, reads `… · free` instead of the "up to $x" clause; `strategyCopy` returns `null` when called with a second argument `{ certified: true }` (the dead-field strategy choice is an analysis-chain concept). Add a test for each next to the existing ones in `backfill-preview.test.ts`:

```ts
it('a verified website\'s repair is free: certified paths never call AI', () => {
  expect(previewSummary({ pages: 38, estCostUsd: 0, certified: true })).toMatch(/38 .*free/);
  expect(previewSummary({ pages: 38, estCostUsd: 0, certified: true })).not.toMatch(/\$/);
});
it('offers no dead-field strategy on a verified website', () => {
  expect(strategyCopy({ name: 'price', fill: 0.1, classification: 'dead' }, { certified: true })).toBeNull();
});
```

Thread `certified` from the `backfillPreview` query result into both calls inside `BackfillGapsPanel` (it is defined in `source-run-detail.tsx` itself). With no strategy shown, the panel must send `deadFieldStrategy: 'full_focus'` for a certified website when a dead field is checked (the server's guard 5 requires a value; `full_focus` is the plain path, which is exactly what a certified repair is). Do that in `backfillMutationInput` behind the same `certified` flag and cover it with a test.

- [ ] **Step 6: Run the tests, typecheck, package gate.**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/run-misses-view.test.ts src/lib/backfill-preview.test.ts`
Run: `pnpm --filter @robot/dashboard exec tsc --noEmit -p .`
Run: `pnpm --filter @robot/dashboard test -- --maxWorkers=1 --run`
Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add packages/dashboard/src/components/run-misses.tsx packages/dashboard/src/lib/run-misses-view.ts packages/dashboard/src/lib/run-misses-view.test.ts packages/dashboard/src/routes/source-run-detail.tsx packages/dashboard/src/lib/backfill-preview.ts packages/dashboard/src/lib/backfill-preview.test.ts
git commit -m "feat(dashboard): the run page groups empty cells by listing and offers one as a proof page"
```

---

### Task 8: Gates, a free live check, and the docs

**Files:**
- Modify: `docs/handoff.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-11-second-layout-learning-design.md` (status line only)

- [ ] **Step 1: Full gates, one package at a time.**

```bash
pnpm --filter @robot/scraper test -- --maxWorkers=1 --run
pnpm --filter @robot/api test -- --maxWorkers=1 --run
pnpm --filter @robot/dashboard test -- --maxWorkers=1 --run
```

Expected: all pass. With `pnpm dev:all` running: `RUN_UI_SMOKE=1 pnpm test:ui` — expected: pass.

- [ ] **Step 2: Existing certifications are still current.** The Ikea website was verified before this change; it must not have gone stale:

```bash
curl -s "http://localhost:4000/trpc/sources.verificationStatus?input=%7B%22json%22%3A%7B%22sourceId%22%3A%22799be508-0c22-4493-bf5b-052d0c13910f%22%7D%7D" | head -c 600
```

Expected: `currentKeys` lists all eight field keys. (If the procedure name differs, find it with `grep -n "currentKeys" packages/api/src/routers/sources.ts`.) If any key dropped out, the `fieldHash` string changed for a one-layout field: stop and fix Task 2 before going on.

- [ ] **Step 3: A free live check of the fourth page.** Stop `pnpm dev:all` and start `pnpm dev:all:noai` for this step: with no API key in the api-server the Verify label reads "mechanical only" and AI cannot be called, so the check is free by construction. (Under the normal server the label would honestly read "up to $0.05" for the changed field, which the budget rule forbids clicking.) In the dashboard, open Ikea's Schema tab, Add page, paste a fourth Ikea product URL from the last run (`select url from run_items where run_id='39cba014-c88c-486c-9b2e-50c86ebaeb50' and kind='detail' limit 1 offset 5`), type its real price into the Price cell only. Read the Verify button. **If it shows a dollar amount, do not click it: report the label and stop.** If it reads "mechanical only" (or free), click it. Expected: Price verifies on four pages, the other seven fields stay verified without re-running (their cells on page four read "not checked"), and since Ikea has one layout Price's certified paths carry no `provenOn`. Then remove page four and verify again, still under `dev:all:noai`, so the website is left as it was. Restart `pnpm dev:all` afterwards.

- [ ] **Step 4: Docs.** In `docs/handoff.md`, under the two-design-notes paragraph, add a short section "Second-layout proof pages (2026-09-17)": what landed (three to six proof pages, the cover rule with the never-wrong guard, per-field pages in the hash, `crawl.misses` and the run page list, the Schema tab's Add page), that a real second-layout website has not been through it live yet, and that automatic discovery remains the next increment. In `CLAUDE.md` under "Key Technical Decisions", extend the verification-first line: "…paths certify when, together, they cover every proof page a field is checked on and none is wrong on any (three to six pages; 2026-09-17)". In the 2026-09-11 note, change the status line to say the cheap version landed and point at the 2026-09-17 design.

- [ ] **Step 5: Commit.**

```bash
git add docs/handoff.md CLAUDE.md docs/superpowers/specs/2026-09-11-second-layout-learning-design.md
git commit -m "docs: second-layout proof pages landed — handoff, key decisions, note status"
```
