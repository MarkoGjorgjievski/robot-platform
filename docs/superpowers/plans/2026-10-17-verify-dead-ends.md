# Verify dead ends — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An honest customer can pass Verify on the seven dead ends of campaign 2, group 3. A field this website lacks passes as "not on this website". A default stops a suggestion on products 4–6 from blocking. The shop's name can be a brand. A page whose value was found reads green. A marked value is what the element shows, without a label, and survives a retype. A rounded number matches its precise page data. The cost label is an upper bound again and is shown to staff only, since customers see no money anywhere. The variant-address warning has a "Re-verify this field" that never calls the AI.

**Architecture:** The rules live in `@robot/scraper` (`field-fit.ts`, `normalize.ts`, `transforms.ts`, `certify.ts`, `box-map.ts`, `run-verification.ts`, `page-variant-match.ts`, `constants.ts`). `@robot/api` carries them through the binding (`binding-input.ts`), field currency (`current-certification.ts`, `jev-agreement.ts`), ops (`routers/ops.ts`) and the estimate (`routers/sources.ts`). `@robot/app` mirrors the gate and the mark rules in `verification-model.ts`, shows the new copy (`verification-view.ts`, `ops-view.ts`), and adds the warning's button (`verification-table.tsx`, the site route). No migration: every new value is optional JSON on existing jsonb columns.

**Tech Stack:** TypeScript ESM; vitest; Drizzle + Postgres; tRPC v11; TanStack Start + React 19 + Tailwind v4; Playwright for the box map's Chromium test and the route smoke.

**Spec:** `docs/superpowers/specs/2026-10-17-verify-dead-ends-design.md`

**Planner's notes:** ten tasks. Task 8 makes money staff-only (Marko, 2026-10-17: customers see no price; spec §8a). Item 5 (marked values) splits into the engine (Task 3) and the app (Task 4): a reviewer can judge what certification reads apart from what the board stores. Item 1 splits the same way (Tasks 5 and 6); Task 6 also carries item 2, because both change `verifyGate`. Items 3 and 6 share Task 1: both are pure matching rules in two small files. Task 9 is a placeholder whose content Marko supplies; it is the one allowed placeholder and must not start until he has.

## Global Constraints

- Copy is exact, from spec §9:
  - row word `not on this website · left empty on every product`;
  - gate reason `{Field} needs a value on at least two products, or "not on this product" on every one`;
  - server problem `{Field}: needs a value on at least two products, or "not on this product" on every one`;
  - ops `no path — not on this website, left empty`;
  - `ambiguous` hint `Found on this product, but not in the same place as on the others. Mark it on the screenshot.`;
  - address-warning button `Re-verify this field` for a customer, `Re-verify this field · free` for staff (spec §8a);
  - a customer sees no money amount and no price word anywhere; staff see them as today (spec §8a).
- No customer string names a tool, a model or a mechanism (memory `customer-copy-no-internals`).
- Spec §10 property 8: a set, result or estimate with none of the new fields behaves as today. `notOnWebsite` is omitted when false, never written as `false`, `undefined` or `null`.
- The `after_label` transform is used for mark XPaths only. It is never added to `APPLICABLE`, to `inferTransform`, to the DOM search, or to the agent's transform lists (`packages/agent/src/propose-paths.ts`, `packages/agent/src/tools.ts`).
- Labels are stripped only for the concepts in `LABELLED_CONCEPTS` (`sku`, `brand`, `availability`, `rating`, `review_count`, `currency`).
- Rounding applies to `number` fields only, and only when the shorter value has at least one decimal.
- The address warning's re-verify never calls AI (spec §10 property 9).
- Tests per package only: `pnpm --filter @robot/<pkg> exec vitest run <file>`. Never `pnpm -r test`. The scraper's Chromium tests run one file at a time. The api tests need Postgres running.
- The route smoke (`pnpm test:ui:app`) runs once, after the merge to `main`, against `pnpm dev:all` that Marko runs. Never start or restart a server.
- Commits by explicit path. Never `git add -A` or `git add .`. Never stage `packages/app/src/routeTree.gen.ts`. Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `.js` suffix on relative imports in scraper and api; none in app. `@robot/app` imports nothing from `@robot/scraper` except `@robot/scraper/normalize`, and nothing from `@robot/api`.
- Work only in the worktree `../robot-platform-verify`, branch `feat/verify-dead-ends`.

## Review Focus

1. A field absent on every proof page must never certify a path, even when a cached domain path reads nothing (or something) on the proof pages. → Task 5 test "a field absent on every page certifies nothing, even with a cached path".
2. A page turning green under the three-page rule must not make a failing field certify, and the two-of-three `different_value` diagnosis must still win on its page. → Task 2 tests "skullcandy shape: covered pages pass, the uncovered page carries the diagnosis" and the existing "two of three" tests left unchanged.
3. A title with a colon must never be shortened; only the six concepts lose a label. → Task 3 test "afterLabel leaves a product name with a colon whole"; Task 4 test "valueFromBox keeps a title's colon".
4. A retyped cell must keep its mark only while the marked element still shows the typed value. → Task 4 tests "typedAnswer keeps the mark…" and "…drops it on another value".
5. Rounding must not let "5" match 4.6, nor a money value round. → Task 1 tests on `valuesEqual`.
6. The shop's name must not certify as the brand of a product whose page shows another brand. → Task 1 test "og:site_name is unsafe when one page's brand differs".
7. The address warning's re-verify must replace a fixed-index path the customer confirmed with its `[page]` twin, and stay free. → Task 7 tests "the cache shortcut is not kept…" and "a [page] twin of a confirmed path ranks first".
8. A pending suggestion on products 4–6 must still block a field without a default. → Task 6 test "a suggestion on product 4 still blocks a field with no default".
9. A customer session must see no money amount or price word on any screen, while an operator and a staff session see them as today. → Task 8 `showsMoney` tests, each view's customer/staff pair, and the route smoke's `expectNoMoney` on four screens (Task 10).

---

### Task 1: The shop's name as a brand; rounded numbers (`@robot/scraper`) — items 3 and 6

**Files:**
- Modify: `packages/scraper/src/verify/field-fit.ts` (`CONCEPT_PATHS.brand`)
- Modify: `packages/scraper/src/verify/normalize.ts` (`valuesEqual` for numbers)
- Test: `packages/scraper/src/verify/field-fit.test.ts`, `packages/scraper/src/verify/normalize.test.ts`, `packages/scraper/src/verify/certify.test.ts`, `packages/scraper/src/verify/suggest-marks.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CONCEPT_PATHS.brand` ends with `'seller.name', 'og:site_name'`. `valuesEqual('number', …)` rounds as spec §7 says.

- [ ] **Step 1: Failing tests.**

Append to `field-fit.test.ts`:

```ts
describe('the shop\'s name as a brand (spec 2026-10-17 §4)', () => {
  it('brand fits og:site_name and the offer seller, last', () => {
    expect(pathFitsConcept('brand', 'og:site_name')).toBe(true);
    expect(pathFitsConcept('brand', 'offers.seller.name')).toBe(true);
    expect(pathFitsConcept('brand', 'offers[0].seller.name')).toBe(true);
  });
  it('a product name still never fits og:site_name', () => {
    expect(pathFitsConcept('product_name', 'og:site_name')).toBe(false);
  });
});
```

(The order between `brand.name` and the shop's name is pinned where it matters: certification ranks JSON-LD before meta, and the suggestion test below keeps `brand.name` first.)

Append to `normalize.test.ts`:

```ts
describe('valuesEqual — rounded numbers (spec 2026-10-17 §7)', () => {
  it('a shown number with decimals matches more precise page data within half its last unit', () => {
    expect(valuesEqual('number', 4.7610064, '4.8')).toBe(true);
    expect(valuesEqual('number', '4.8', '4.7610064')).toBe(true);
    expect(valuesEqual('number', 4.75, '4.8')).toBe(true);    // the half-unit boundary rounds either way
    expect(valuesEqual('number', '4.74', '4.8')).toBe(false);
  });
  it('never rounds a whole number, a further-off value or money', () => {
    expect(valuesEqual('number', '4.9', 4.7610064)).toBe(false);
    expect(valuesEqual('number', '5', 4.6)).toBe(false);
    expect(valuesEqual('money', '4.8', 4.7610064)).toBe(false);
  });
  it('the same precision compares exactly, as today; trailing zeros are the same number', () => {
    expect(valuesEqual('number', '4.7', '4.8')).toBe(false);
    expect(valuesEqual('number', '4.80', 4.8)).toBe(true);
  });
});
```

Append to `certify.test.ts`:

```ts
describe('certify — the shop\'s name and rounded ratings (spec 2026-10-17 §4, §7)', () => {
  const brand = { key: 'brand', name: 'Brand', type: 'text' as const, description: 'the maker', concept: 'brand' };
  const rating = { key: 'rating', name: 'Rating', type: 'number' as const, description: 'stars', concept: 'rating' };
  const R = ['https://r.example/1', 'https://r.example/2', 'https://r.example/3'];
  const page = (url: string, ld: Record<string, unknown>, meta: Record<string, string> = {}): CaptureLike => ({
    url, html: '<html></html>', structuredData: { ldJson: [ld], nextData: null, initialState: null, meta }, interceptedRequests: [],
  });
  const deps = { evalXPaths: async () => ({}) };
  const siteName = { source: 'meta' as const, path: 'og:site_name', transform: 'identity' as const };

  it('a brand typed the same everywhere certifies through og:site_name when brand.name is the tagline', async () => {
    const caps = Object.fromEntries(R.map((u) => [u, page(u, { brand: { name: 'Gymshark | We Do Gym' } }, { 'og:site_name': 'Gymshark' })]));
    const expected = Object.fromEntries(R.map((u) => [u, 'Gymshark']));
    const { candidates } = await gatherCandidates(brand, expected, caps, { runDomSearch: async () => [] });
    const r = await certify({ field: brand, expected, captures: caps, candidates }, deps);
    expect(r.certified).toEqual([siteName]);
  });

  it('og:site_name is unsafe when one page\'s brand differs', async () => {
    const caps = Object.fromEntries(R.map((u) => [u, page(u, {}, { 'og:site_name': 'Thomann' })]));
    const expected = { [R[0]!]: 'Thomann', [R[1]!]: 'Thomann', [R[2]!]: 'Harley Benton' };
    const r = await certify({ field: brand, expected, captures: caps, candidates: [siteName] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.cells[R[2]!]).toMatchObject({ status: 'fail', reason: 'different_value', found: 'Thomann' });
  });

  it('typed ratings shown to one decimal certify the precise page data', async () => {
    const data = ['4.7610064', '4.57', '4.93'];
    const caps = Object.fromEntries(R.map((u, i) => [u, page(u, { aggregateRating: { ratingValue: Number(data[i]) } })]));
    const expected = { [R[0]!]: '4.8', [R[1]!]: '4.6', [R[2]!]: '4.9' };
    const { candidates } = await gatherCandidates(rating, expected, caps, { runDomSearch: async () => [] });
    const r = await certify({ field: rating, expected, captures: caps, candidates }, deps);
    expect(r.certified[0]).toMatchObject({ source: 'json-ld', path: 'aggregateRating.ratingValue' });
  });
});
```

Make sure `gatherCandidates` is imported at the top of `certify.test.ts` (add it to the existing import from `./certify.js` if missing).

Append to `suggest-marks.test.ts`:

```ts
describe('suggestMarks — the shop\'s name (spec 2026-10-17 §4)', () => {
  const brand = { key: 'brand', name: 'Brand', type: 'text' as const, description: 'the maker', concept: 'brand' };
  const cap = (ld: Record<string, unknown>, meta: Record<string, string>) => ({
    url: 'https://s.example/p', html: '<html></html>', structuredData: { ldJson: [ld], nextData: null, initialState: null, meta }, interceptedRequests: [],
  });
  it('suggests og:site_name when the page data names no brand', () => {
    expect(suggestMarks(cap({ name: 'Brow Kit' }, { 'og:site_name': 'Sigma Beauty' }), [], [brand]).brand).toMatchObject({ value: 'Sigma Beauty', via: { source: 'meta', path: 'og:site_name' } });
  });
  it('keeps brand.name first wherever it exists', () => {
    expect(suggestMarks(cap({ brand: { name: 'Kith Women' } }, { 'og:site_name': 'Kith' }), [], [brand]).brand).toMatchObject({ value: 'Kith Women' });
  });
});
```

- [ ] **Step 2: Run them and see them fail.**

```
pnpm --filter @robot/scraper exec vitest run src/verify/field-fit.test.ts src/verify/normalize.test.ts src/verify/certify.test.ts src/verify/suggest-marks.test.ts
```

Expected: the new tests fail (no fit for `og:site_name`; 4.8 ≠ 4.761). Everything else passes.

- [ ] **Step 3: Implement.**

In `field-fit.ts`, the brand line becomes:

```ts
  // og:site_name and the offer's seller are the shop's own name (spec 2026-10-17 §4): last, so a product-level brand always ranks first.
  brand: ['brand.name', 'brand', 'manufacturer', 'manufacturer.name', 'vendor', 'brandName', 'brand_name', 'product:brand', 'og:brand', 'seller.name', 'og:site_name'],
```

In `normalize.ts`, above `valuesEqual`:

```ts
function decimals(s: string): number {
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Spec 2026-10-17 §7: a number shown with d ≥ 1 decimals equals a more precise one within half a
 * unit of its last decimal (4.8 matches 4.7610064). Symmetric. A whole number never rounds.
 * `a`, `b` are `normalize('number', …)` strings.
 */
function roundsTo(a: string, b: string): boolean {
  const [shown, precise] = decimals(a) <= decimals(b) ? [a, b] : [b, a];
  const d = decimals(shown);
  if (d === 0 || decimals(precise) <= d) return false;
  return Math.abs(Number(precise) - Number(shown)) <= 0.5 * 10 ** -d + 1e-9;
}
```

and in `valuesEqual`, before the final `return`:

```ts
  if (type === 'number') return na === nb || roundsTo(na, nb);
```

- [ ] **Step 4: Run the four files again.** Expected: all pass. Then run the rest of the verify folder's pure tests that compare numbers, to catch a rule that relied on exact equality:

```
pnpm --filter @robot/scraper exec vitest run src/verify/transforms.test.ts src/verify/search-structured.test.ts src/verify/shown-on-page.test.ts src/verify/drift-classify.test.ts src/verify/variant-certify.test.ts
```

Expected: pass. If one fails, read why before changing it: a test that pins exact equality of numbers with different precision is changed only when spec §7 says the new answer is right, and the change is named in the report.

- [ ] **Step 5: Commit.**

```
git add packages/scraper/src/verify/field-fit.ts packages/scraper/src/verify/normalize.ts packages/scraper/src/verify/field-fit.test.ts packages/scraper/src/verify/normalize.test.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/suggest-marks.test.ts
git commit -m "feat(scraper): the shop's name can be a brand, and a rounded number matches its precise page data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A page whose value was found reads green (`@robot/scraper`, `@robot/app` copy) — item 4

**Files:**
- Modify: `packages/scraper/src/verify/certify.ts` (the `safeHere` branch, `nearMisses`)
- Modify: `packages/app/src/lib/site/verification-view.ts` (`hintFor('ambiguous')`)
- Test: `packages/scraper/src/verify/certify.test.ts`, `packages/app/src/lib/site/verification-view.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: on any number of proof pages, a captured page where a safe candidate is correct reads `{ status: 'pass', found, path }` when nothing certified. Near misses never include a value equal to the page's expected value.

- [ ] **Step 1: Failing tests.** Append to `certify.test.ts`:

```ts
describe('certify — found here, the problem elsewhere (spec 2026-10-17 §5)', () => {
  const brand = { key: 'brand', name: 'Brand', type: 'text' as const, description: 'the maker', concept: 'brand' };
  const S = ['https://k.example/1', 'https://k.example/2', 'https://k.example/3'];
  const deps = { evalXPaths: async () => ({}) };
  const brandName = { source: 'json-ld' as const, path: 'brand.name', transform: 'identity' as const };
  const vendor = { source: 'json-ld' as const, path: 'vendor', transform: 'identity' as const };
  const page = (url: string, ld: Record<string, unknown>): CaptureLike => ({
    url, html: '<html></html>', structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: {} }, interceptedRequests: [],
  });

  it('skullcandy shape: covered pages pass, the uncovered page carries the diagnosis', async () => {
    const caps = {
      [S[0]!]: page(S[0]!, { vendor: 'Skullcandy US' }),
      [S[1]!]: page(S[1]!, { brand: { name: 'Skullcandy' }, vendor: 'Skullcandy US' }),
      [S[2]!]: page(S[2]!, { brand: { name: 'Skullcandy' }, vendor: 'Skullcandy US' }),
    };
    const expected = Object.fromEntries(S.map((u) => [u, 'Skullcandy']));
    const r = await certify({ field: brand, expected, captures: caps, candidates: [brandName, vendor] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.cells[S[1]!]).toEqual({ status: 'pass', found: 'Skullcandy', path: brandName });
    expect(r.cells[S[2]!]).toEqual({ status: 'pass', found: 'Skullcandy', path: brandName });
    expect(r.cells[S[0]!]).toMatchObject({ status: 'fail' });
  });

  it('a page whose only correct candidates read something else on another page stays ambiguous', async () => {
    const title = { key: 'sku', name: 'SKU', type: 'text' as const, description: 'code', concept: 'sku' };
    const a = { source: 'json-ld' as const, path: 'a', transform: 'identity' as const };
    const b = { source: 'json-ld' as const, path: 'b', transform: 'identity' as const };
    const caps = {
      [S[0]!]: page(S[0]!, { a: 'X1', b: 'Q' }),
      [S[1]!]: page(S[1]!, { a: 'Q', b: 'X2' }),
      [S[2]!]: page(S[2]!, { a: 'Q', b: 'Q' }),
    };
    const expected = { [S[0]!]: 'X1', [S[1]!]: 'X2', [S[2]!]: 'X3' };
    const r = await certify({ field: title, expected, captures: caps, candidates: [a, b] }, deps);
    expect(r.cells[S[0]!]).toMatchObject({ status: 'fail', reason: 'ambiguous' });
  });

  it('no near miss equals the page\'s expected value', async () => {
    const caps = Object.fromEntries(S.map((u) => [u, page(u, { brand: { name: u === S[0] ? 'Other' : 'Skullcandy' } })]));
    const expected = Object.fromEntries(S.map((u) => [u, 'Skullcandy']));
    const r = await certify({ field: brand, expected, captures: caps, candidates: [brandName] }, deps);
    for (const cell of Object.values(r.cells)) {
      if (cell.status === 'fail') expect(cell.nearMisses ?? []).not.toContain('Skullcandy');
    }
  });
});
```

Append to `verification-view.test.ts`:

```ts
it('the ambiguous hint says what happened and what to do (spec 2026-10-17 §5)', () => {
  expect(hintFor('ambiguous')).toBe('Found on this product, but not in the same place as on the others. Mark it on the screenshot.');
});
```

(Import `hintFor` there if the file does not already.)

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @robot/scraper exec vitest run src/verify/certify.test.ts
pnpm --filter @robot/app exec vitest run src/lib/site/verification-view.test.ts
```

- [ ] **Step 3: Implement.** In `certify.ts`, the `safeHere` branch drops its page-count condition:

```ts
    const safeHere = rankedSafe.find((c) => isCorrect(c, url));
    // Spec 2026-10-17 §5: on any number of proof pages, a page a safe path is right on reads as found;
    // the page nothing covers carries the diagnosis. (Spec 2026-09-17 §9 property 4 limited this to more than three pages.)
    if (complete && safeHere) {
```

The `nearMisses` line gains the expected-value filter:

```ts
    const nearMisses = [...new Set(candidates.map((c) => evals.get(pathId(c))?.[url]?.raw).map(displayValue).filter((r): r is string => r !== null && r !== '' && !valuesEqual(field.type, r, expected[url] ?? '', ctx)))].slice(0, 3);
```

Remove `VERIFY_URL_MIN` from the import line if nothing else in the file uses it.

In `verification-view.ts`:

```ts
    case 'ambiguous':
      return 'Found on this product, but not in the same place as on the others. Mark it on the screenshot.';
```

Then search for the old text anywhere else and replace it the same way:

```
grep -rn "Several places match" packages --include=*.ts --include=*.tsx
```

- [ ] **Step 4: Run the two files again.** Expected: the new tests pass. Some existing three-page `certify.test.ts` tests that pinned `ambiguous` (or `not_found`) on a page a safe path covers now see `pass`. For each, check that the page has a safe candidate correct on it, update the expectation to the pass cell, and list the test names in the report. Leave every "two of three" test unchanged: if one of those changes, the implementation is wrong. Then:

```
pnpm --filter @robot/scraper exec vitest run src/verify/run-verification.test.ts src/verify/variant-certify.test.ts
```

Expected: pass, with the same rule for any changed expectation.

- [ ] **Step 5: Commit.**

```
git add packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts packages/app/src/lib/site/verification-view.ts packages/app/src/lib/site/verification-view.test.ts
git commit -m "feat: a proof page whose value was found reads as found on three pages too; 'several places match' says to mark it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add any other file the grep in Step 3 changed, by its path.

---

### Task 3: Marks read what the element shows (`@robot/scraper`, `@robot/api`) — item 5, engine

**Files:**
- Modify: `packages/scraper/src/verify/normalize.ts` (`afterLabel`, `labelled`, `LABELLED_CONCEPTS`)
- Modify: `packages/scraper/src/verify/types.ts` (`Transform` gains `'after_label'`)
- Modify: `packages/scraper/src/verify/transforms.ts` (`applyTransform` case; `TRANSFORMS` list)
- Modify: `packages/scraper/src/domain-cache.ts` (the two transform unions, lines ~27 and ~1122)
- Modify: `packages/scraper/src/verify/certify.ts` (`markPaths`, `gatherCandidates`)
- Modify: `packages/scraper/src/verify/run-verification.ts` (`markXPaths` through `markPaths`)
- Modify: `packages/scraper/src/verify/box-map.ts` (whole text, 2,000 characters, `src`)
- Modify: `packages/api/src/verify/binding-input.ts` (a mark is kept when its text after its label equals the value)
- Test: `packages/scraper/src/verify/normalize.test.ts`, `transforms.test.ts`, `certify.test.ts`, `box-map.test.ts` (Chromium), `packages/api/src/verify/binding-input.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  // normalize.ts (browser-safe: imports nothing but types)
  export const LABELLED_CONCEPTS: readonly string[];
  export function labelled(concept: string | undefined): boolean;
  export function afterLabel(text: string): string | null;
  // types.ts
  export type Transform = 'identity' | 'cents_to_units' | 'first_of_list' | 'after_label';
  // certify.ts
  export function markPaths(field: Pick<SchemaDefinitionField, 'type'>, mark: Pick<Mark, 'xpaths'>): string[];
  ```

- [ ] **Step 1: Failing tests.**

Append to `normalize.test.ts`:

```ts
describe('afterLabel (spec 2026-10-17 §6)', () => {
  it('takes the text after a short digit-free label', () => {
    expect(afterLabel('Style: 398846_01')).toBe('398846_01');
    expect(afterLabel('Art.-Nr.: 12345')).toBe('12345');
    expect(afterLabel('  SKU:ABC-1 ')).toBe('ABC-1');
  });
  it('none when the label has digits, is too long, or there is no colon', () => {
    expect(afterLabel('Top 5: great')).toBeNull();
    expect(afterLabel('A label that is far too long to be one: x')).toBeNull();
    expect(afterLabel('398846_01')).toBeNull();
    expect(afterLabel('Style:')).toBeNull();
  });
  it('afterLabel leaves a product name with a colon whole: product_name is not labelled', () => {
    expect(labelled('product_name')).toBe(false);
    expect(labelled('description')).toBe(false);
    expect(labelled(undefined)).toBe(false);
    for (const c of ['sku', 'brand', 'availability', 'rating', 'review_count', 'currency']) expect(labelled(c)).toBe(true);
  });
});
```

Append to `transforms.test.ts`:

```ts
it('after_label strips a leading label and leaves anything else (spec 2026-10-17 §6)', () => {
  expect(applyTransform('Style: 398846_01', 'after_label')).toBe('398846_01');
  expect(applyTransform('398846_01', 'after_label')).toBe('398846_01');
  expect(applyTransform(null, 'after_label')).toBeNull();
});
it('after_label is never inferred', () => {
  expect(inferTransform('text', 'Style: 398846_01', '398846_01')).toBeNull();
});
```

Append to `certify.test.ts`:

```ts
describe('marks read what the element shows (spec 2026-10-17 §6)', () => {
  const sku = { key: 'sku', name: 'SKU', type: 'text' as const, description: 'code', concept: 'sku' };
  const image = { key: 'image', name: 'Main image', type: 'image' as const, description: 'hero', concept: 'image_url' };
  const P = ['https://p.example/1', 'https://p.example/2', 'https://p.example/3'];
  const html = (code: string) => `<html><body><div id="d"><span class="style">Style: ${code}</span><img class="hero" src="/i/${code}.jpg"></div></body></html>`;
  const codes = ['398846_01', '312123_16', '109135_03'];
  const caps = Object.fromEntries(P.map((u, i) => [u, { url: u, html: html(codes[i]!), structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] } as CaptureLike]));
  const mark = (xp: string, text: string) => ({ xpaths: [xp], text, rect: { x: 1, y: 1, w: 10, h: 10 } });
  // A stand-in for the browser probe: reads the span's text or the img's src attribute off the fixture HTML.
  const evalXPaths = async (h: string, xps: string[]) => Object.fromEntries(xps.map((xp) => {
    if (xp.endsWith('/@src')) return [xp, /src="([^"]+)"/.exec(h)?.[1] ?? null];
    if (xp.includes('span')) return [xp, /<span class="style">([^<]+)</.exec(h)?.[1] ?? null];
    return [xp, null];
  }));

  it('markPaths gives an image mark /@src, a link mark /@href, and leaves a suffixed or text mark alone', () => {
    expect(markPaths({ type: 'image' }, { xpaths: ['//*[@id="d"]/img'] })).toEqual(['//*[@id="d"]/img/@src']);
    expect(markPaths({ type: 'url' }, { xpaths: ['//a'] })).toEqual(['//a/@href']);
    expect(markPaths({ type: 'image' }, { xpaths: ['//img/@src'] })).toEqual(['//img/@src']);
    expect(markPaths({ type: 'text' }, { xpaths: ['//span'] })).toEqual(['//span']);
  });

  it('a sku mark yields an after_label candidate beside the identity one', async () => {
    const marks = { [P[0]!]: mark('//*[@id="d"]/span', 'Style: 398846_01') };
    const { candidates } = await gatherCandidates(sku, { [P[0]!]: '398846_01' }, { [P[0]!]: caps[P[0]!]! }, { runDomSearch: async () => [], marks });
    expect(candidates).toEqual(expect.arrayContaining([
      { source: 'xpath', path: '//*[@id="d"]/span', transform: 'identity' },
      { source: 'xpath', path: '//*[@id="d"]/span', transform: 'after_label' },
    ]));
  });

  it('three marked "Style: …" lines with clean typed codes certify through after_label', async () => {
    const marks = Object.fromEntries(P.map((u, i) => [u, mark('//*[@id="d"]/span', `Style: ${codes[i]}`)]));
    const expected = Object.fromEntries(P.map((u, i) => [u, codes[i]!]));
    const { candidates } = await gatherCandidates(sku, expected, caps, { runDomSearch: async () => [], marks });
    const r = await certify({ field: sku, expected, captures: caps, candidates, markXPaths: ['//*[@id="d"]/span'] }, { evalXPaths });
    expect(r.certified[0]).toEqual({ source: 'xpath', path: '//*[@id="d"]/span', transform: 'after_label' });
    expect(r.cells[P[0]!]).toMatchObject({ status: 'pass', found: '398846_01' });
  });

  it('a marked image, stored without /@src, certifies through its src attribute', async () => {
    const marks = Object.fromEntries(P.map((u) => [u, mark('//*[@id="d"]/img', '')]));
    const expected = Object.fromEntries(P.map((u, i) => [u, `${u.replace(/\/\d$/, '')}/i/${codes[i]}.jpg`]));
    const { candidates } = await gatherCandidates(image, expected, caps, { runDomSearch: async () => [], marks });
    const r = await certify({ field: image, expected, captures: caps, candidates }, { evalXPaths });
    expect(r.certified[0]).toMatchObject({ source: 'xpath', path: '//*[@id="d"]/img/@src' });
  });
});
```

(Import `markPaths` alongside `gatherCandidates`. The XPath in the `sku` test contains no part of the expected value, so `xpathContainsValue` keeps it.)

Append to `box-map.test.ts` (Chromium):

```ts
describe('box map text and images (spec 2026-10-17 §6)', () => {
  it('a paragraph with a link keeps the link\'s words; an image with a srcset reports its src', async () => {
    const boxes = await boxMap(`<html><body>
      <p class="d">Soft cotton, <a href="/care">machine washable</a>, made to last.</p>
      <img class="h" src="/img/a.jpg" srcset="/img/a-916.jpg?w=916 916w" sizes="916px">
    </body></html>`);
    expect(boxes.find((b) => b.tag === 'p')!.text).toBe('Soft cotton, machine washable, made to last.');
    expect(boxes.find((b) => b.kind === 'image')!.src).toMatch(/\/img\/a\.jpg$/);
  });
});
```

Update the existing assertion in the first `buildBoxMapScript` test that pins own text: the `<p>` now holds `In stock` (the `<b>` still holds `stock`). Change `expect(byText['In']).toMatchObject({ tag: 'p' });` to `expect(byText['In stock']).toMatchObject({ tag: 'p' });` and its comment to "Whole text: the <p> holds "In stock", the <b> holds "stock".".

Append to `binding-input.test.ts`, inside the file's existing `prepareBinding` describe (reuse its `ok` binding and `contract`; give the contract's SKU field `concept: 'sku'` if the fixture has none, or add one):

```ts
it('keeps a mark whose text after its label equals the value (spec 2026-10-17 §6)', () => {
  const u = ok.urls[0]!;
  const input = { ...ok, expected: { ...ok.expected, sku: { ...ok.expected.sku, [u]: '398846_01' } },
    marks: { sku: { [u]: { xpaths: ['//span'], text: 'Style: 398846_01', rect: { x: 1, y: 1, w: 5, h: 5 } } } } };
  expect(prepareBinding(input, contract).verificationSet.marks?.sku?.[u]?.text).toBe('Style: 398846_01');
});
```

Adapt the key names (`sku`) to the fixture's contract if it differs; the point is a labelled concept.

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @robot/scraper exec vitest run src/verify/normalize.test.ts src/verify/transforms.test.ts src/verify/certify.test.ts
pnpm --filter @robot/scraper exec vitest run src/verify/box-map.test.ts
pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts
```

- [ ] **Step 3: Implement.**

`normalize.ts`, at the end:

```ts
/** Spec 2026-10-17 §6: the concepts whose marked text may carry a leading label ("Style: 398846_01"). Never a name or a description. */
export const LABELLED_CONCEPTS: readonly string[] = ['sku', 'brand', 'availability', 'rating', 'review_count', 'currency'];

export function labelled(concept: string | undefined): boolean {
  return !!concept && LABELLED_CONCEPTS.includes(concept);
}

const LABEL = /^\s*([^\d:\n]{1,30}):\s*(\S[\s\S]*?)\s*$/u;

/** The text after a leading "Label:" — at most 30 characters, no digits, at least one letter — or null when there is none. */
export function afterLabel(text: string): string | null {
  const m = LABEL.exec(text);
  if (!m || !/\p{L}/u.test(m[1]!)) return null;
  return m[2]!;
}
```

`types.ts`: `export type Transform = 'identity' | 'cents_to_units' | 'first_of_list' | 'after_label';`

`transforms.ts`: import `afterLabel` from `./normalize.js`; add `'after_label'` to `TRANSFORMS` (it lists every transform a stored path may carry; `APPLICABLE` stays as it is, so it is never inferred); add the case:

```ts
    // Spec 2026-10-17 §6: only ever a mark's transform; a value with no label passes through.
    case 'after_label': return typeof raw === 'string' ? (afterLabel(raw) ?? raw) : raw;
```

Then `grep -rn "TRANSFORMS" packages --include=*.ts` and check that nothing offers `TRANSFORMS` to the AI or uses it to infer. The agent keeps its own list without `after_label`.

`domain-cache.ts`: add `| 'after_label'` to both transform unions.

`certify.ts`, beside `gatherCandidates`:

```ts
/** Spec 2026-10-17 §6: the XPaths a mark is read through. An image mark reads its src, a link mark its href; a mark stored before this change gets the suffix here. */
export function markPaths(field: Pick<SchemaDefinitionField, 'type'>, mark: Pick<Mark, 'xpaths'>): string[] {
  const attr = field.type === 'image' ? '/@src' : field.type === 'url' ? '/@href' : '';
  return mark.xpaths.map((xp) => (attr && !/\/@[\w:-]+$/.test(xp) ? xp + attr : xp));
}
```

and the mark branch of `gatherCandidates` becomes:

```ts
    if (mark) {
      const xps = markPaths(field, mark);
      hitsByUrl[url] = structured.length + xps.length;
      candidates.push(...xps.map((xp) => ({ source: 'xpath' as const, path: xp, transform: 'identity' as const })));
      // A labelled concept's mark may show "Style: 398846_01" for the value 398846_01 (spec 2026-10-17 §6).
      if (labelled(field.concept)) candidates.push(...xps.map((xp) => ({ source: 'xpath' as const, path: xp, transform: 'after_label' as const })));
      continue;
    }
```

(Keep the existing comment above it; import `labelled` from `./normalize.js`.)

`run-verification.ts`: the `markXPaths` line becomes

```ts
    const markXPaths = Object.values(req.verificationSet.marks?.[field.key] ?? {}).flatMap((m) => markPaths(field, m));
```

with `markPaths` imported from `./certify.js`.

`box-map.ts`: `TEXT_LIMIT = 2000` (the server's mark text limit). In `browserBoxes`, replace `ownText` with two helpers and use them:

```ts
  const hasOwnText = (el: Element): boolean => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
  const wholeText = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, textLimit);
  …
    // Spec 2026-10-17 §6: an element's whole text, as the XPath probe reads it; still only elements with text of their own.
    const text = kind === 'text' && !hasOwnText(el) ? '' : wholeText(el);
```

and the image line:

```ts
    if (kind === 'image') { const img = el as HTMLImageElement; const src = img.getAttribute('src') ? img.src : img.currentSrc; if (!src) continue; box.src = src; }
```

Update the file's header comment on "own text" to say whole text.

`binding-input.ts`, the mark-keeping test inside `prepareBinding`:

```ts
      const value = expected[f.key]![u] ?? '';
      const after = labelled(f.concept) ? afterLabel(mark.text) : null;
      return mark.text.trim() === '' || valuesEqual(f.type, mark.text, value, { pageUrl: u }) || (after !== null && valuesEqual(f.type, after, value, { pageUrl: u }));
```

with `afterLabel` and `labelled` imported from wherever this file imports `valuesEqual`. If the contract field type has no `concept`, read it from the binding field `bindingFor` builds; do not guess a concept.

- [ ] **Step 4: Run every file from Step 2 again**, then the neighbours a mark or the box map feeds:

```
pnpm --filter @robot/scraper exec vitest run src/verify/marks.test.ts src/verify/transfer-marks.test.ts src/verify/run-verification.test.ts src/verify/verified-extraction.test.ts
pnpm --filter @robot/scraper exec vitest run src/verify/suggest-marks.test.ts
pnpm --filter @robot/api exec vitest run src/routers/sources-marks.test.ts
```

Expected: pass. `transfer-marks` builds marks from box text; if one of its tests pinned own text, update it the way Step 1 updated `box-map.test.ts` and name it in the report.

- [ ] **Step 5: Commit.**

```
git add packages/scraper/src/verify/normalize.ts packages/scraper/src/verify/types.ts packages/scraper/src/verify/transforms.ts packages/scraper/src/domain-cache.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/box-map.ts packages/api/src/verify/binding-input.ts packages/scraper/src/verify/normalize.test.ts packages/scraper/src/verify/transforms.test.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/box-map.test.ts packages/api/src/verify/binding-input.test.ts
git commit -m "feat: a mark is read the way it is shown — whole text, an image's src, a value after its label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add any test file Step 4 changed, by its path.

---

### Task 4: The board stores what the element shows, and a retype keeps the mark (`@robot/app`) — item 5, app

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts` (`valueFromBox` takes the concept; `typedAnswer`)
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (`onType` uses `typedAnswer`)
- Test: `packages/app/src/lib/site/verification-model.test.ts`

**Interfaces:**
- Consumes: `afterLabel`, `labelled` from `@robot/scraper/normalize` (Task 3).
- Produces:
  ```ts
  export function valueFromBox(box: Box, type: FieldType, concept?: string): { value: string; mark: Mark | null } | { error: string };
  export function typedAnswer(prev: Answer | undefined, field: Field, text: string, url: string): Answer | null;
  ```

- [ ] **Step 1: Failing tests.** Append to `verification-model.test.ts`:

```ts
describe('marked values without their label; a retype keeps the mark (spec 2026-10-17 §6)', () => {
  const U = 'https://p.example/1';
  const sku: Field = { key: 'sku', name: 'SKU', type: 'text', description: '', concept: 'sku' };
  const title: Field = { key: 'title', name: 'Title', type: 'text', description: '', concept: 'product_name' };
  const box = (text: string): Box => ({ xpaths: ['//span'], text, rect: { x: 1, y: 1, w: 10, h: 10 }, tag: 'span', kind: 'text' });

  it('valueFromBox stores a sku without its label and keeps the whole text in the mark', () => {
    expect(valueFromBox(box('Style: 398846_01'), 'text', 'sku')).toEqual({ value: '398846_01', mark: { xpaths: ['//span'], text: 'Style: 398846_01', rect: { x: 1, y: 1, w: 10, h: 10 } } });
  });
  it('valueFromBox keeps a title\'s colon', () => {
    expect(valueFromBox(box('Star Wars: The Mandalorian Tee'), 'text', 'product_name')).toMatchObject({ value: 'Star Wars: The Mandalorian Tee' });
    expect(valueFromBox(box('Style: 398846_01'), 'text')).toMatchObject({ value: 'Style: 398846_01' });
  });
  it('typedAnswer keeps the mark when the marked element shows the typed value after its label', () => {
    const prev: Answer = { value: 'Style: 398846_01', mark: { xpaths: ['//span'], text: 'Style: 398846_01', rect: { x: 1, y: 1, w: 10, h: 10 } } };
    expect(typedAnswer(prev, sku, '398846_01', U)).toEqual({ value: '398846_01', mark: prev.mark });
  });
  it('typedAnswer drops it on another value, and on a field whose concept has no label', () => {
    const prev: Answer = { value: '398846_01', mark: { xpaths: ['//span'], text: 'Style: 398846_01', rect: { x: 1, y: 1, w: 10, h: 10 } } };
    expect(typedAnswer(prev, sku, '123', U)).toEqual({ value: '123', mark: null });
    expect(typedAnswer({ ...prev, value: 'x' }, title, '398846_01', U)).toEqual({ value: '398846_01', mark: null });
  });
  it('typedAnswer: blank clears the cell; no mark stays typed', () => {
    expect(typedAnswer(undefined, sku, '  ', U)).toBeNull();
    expect(typedAnswer(undefined, sku, 'A1', U)).toEqual({ value: 'A1', mark: null });
  });
});
```

(Add `typedAnswer` to the test file's import from `./verification-model`.)

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts
```

- [ ] **Step 3: Implement.** In `verification-model.ts`, extend the normalize import: `import { afterLabel, labelled, normalize, valuesEqual } from '@robot/scraper/normalize';`.

`valueFromBox` gains a third parameter and its text branch reads:

```ts
    const t = box.text.trim();
    if (t === '') return { error: 'This element has no text' };
    // Spec 2026-10-17 §6: "Style: 398846_01" on a labelled concept stores 398846_01; the mark keeps the element's whole text.
    value = (labelled(concept) ? afterLabel(t) : null) ?? t;
```

Pass the field's concept at every call that has a field: `fieldsFor` (`valueFromBox(box, field.type, field.concept)`), `answerFromSuggestion`, `pickAnswer` and `placesOf`. Calls without a field keep two arguments.

Add, after `answer`:

```ts
/**
 * The answer a typed cell stores (spec 2026-10-17 §6): blank clears the cell; a mark stays only
 * while the marked element still shows the typed value, whole or after its label. A typed value
 * never carries a suggestion's path.
 */
export function typedAnswer(prev: Answer | undefined, field: Field, text: string, url: string): Answer | null {
  if (!text.trim()) return null;
  const mark = prev?.mark;
  if (!mark) return { value: text, mark: null };
  const shows = (t: string) => valuesEqual(field.type, t, text, { pageUrl: url });
  const after = labelled(field.concept) ? afterLabel(mark.text) : null;
  return shows(mark.text) || (after !== null && shows(after)) ? { value: text, mark } : { value: text, mark: null };
}
```

In the site route, `onType` becomes:

```tsx
        onType: (text: string) => {
          if (!detailUrl) return;
          setBoard((b) => answer(b, f.key, detailUrl, typedAnswer(b.answers[f.key]?.[detailUrl], f, text, detailUrl)));
        },
```

and `typedAnswer` joins the route's import list from `verification-model`.

- [ ] **Step 4: Run the model tests, then the app's type check.**

```
pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts src/lib/site/shown.test.ts
pnpm --filter @robot/app exec tsc --noEmit
```

Expected: pass, no type errors.

- [ ] **Step 5: Commit.**

```
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts "packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx"
git commit -m "feat(app): a marked sku or brand is stored without its label, and retyping the same value keeps the mark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A field not on this website (`@robot/scraper`, `@robot/api`) — item 1, engine

**Files:**
- Modify: `packages/scraper/src/verify/types.ts` (`FieldVerification.notOnWebsite`)
- Modify: `packages/scraper/src/verify/certify.ts` (early return; `isNotOnWebsite`)
- Modify: `packages/scraper/src/verify/index.ts` (export `isNotOnWebsite` if the index lists certify's exports one by one)
- Modify: `packages/scraper/src/verify/run-verification.ts` (no AI; `allPassed`)
- Modify: `packages/api/src/verify/binding-input.ts` (D3)
- Modify: `packages/api/src/verify/current-certification.ts`, `packages/api/src/verify/jev-agreement.ts` (passed without a path)
- Modify: `packages/api/src/routers/ops.ts` (`notOnWebsite` on the ops field)
- Modify: `packages/api/src/routers/sources.ts` (`verifyEstimate`: such a field never reaches AI)
- Test: `packages/scraper/src/verify/certify.test.ts`, `run-verification.test.ts`, `packages/api/src/verify/binding-input.test.ts`, `current-certification.test.ts`, `packages/api/src/routers/sources-verify.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  // types.ts
  FieldVerification.notOnWebsite?: true;   // set only when every checked page is absent and there is no default
  // certify.ts
  export function isNotOnWebsite(set: Pick<VerificationSet, 'urls' | 'expected' | 'absent' | 'defaults'>, key: string): boolean;
  // ops field: notOnWebsite?: true
  ```

- [ ] **Step 1: Failing tests.**

Append to `certify.test.ts`:

```ts
describe('certify — not on this website (spec 2026-10-17 §2)', () => {
  const rating = { key: 'rating', name: 'Rating', type: 'number' as const, description: 'stars', concept: 'rating' };
  const K = ['https://kith.example/1', 'https://kith.example/2', 'https://kith.example/3'];
  const page = (url: string, ld: Record<string, unknown> = {}): CaptureLike => ({
    url, html: '<html></html>', structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: {} }, interceptedRequests: [],
  });
  const cached = { source: 'json-ld' as const, path: 'aggregateRating.ratingValue', transform: 'identity' as const };
  const deps = { evalXPaths: async () => ({}) };

  it('a field absent on every page certifies nothing, even with a cached path', async () => {
    const caps = Object.fromEntries(K.map((u) => [u, page(u)]));
    const r = await certify({ field: rating, expected: {}, absent: K, captures: caps, candidates: [cached] }, deps);
    expect(r).toEqual({ key: 'rating', cells: Object.fromEntries(K.map((u) => [u, { status: 'pass', found: '' }])), certified: [], weakEvidence: false, aiCalled: false, incomplete: false, notOnWebsite: true });
  });

  it('the same when the cached path reads a value on one page', async () => {
    const caps = { ...Object.fromEntries(K.map((u) => [u, page(u)])), [K[1]!]: page(K[1]!, { aggregateRating: { ratingValue: 0 } }) };
    const r = await certify({ field: rating, expected: {}, absent: K, captures: caps, candidates: [cached] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.notOnWebsite).toBe(true);
  });

  it('absent on two and a value on one is today\'s result, with no notOnWebsite', async () => {
    const caps = { ...Object.fromEntries(K.map((u) => [u, page(u)])), [K[0]!]: page(K[0]!, { aggregateRating: { ratingValue: 4.5 } }) };
    const r = await certify({ field: rating, expected: { [K[0]!]: '4.5' }, absent: [K[1]!, K[2]!], captures: caps, candidates: [cached] }, deps);
    expect(r.notOnWebsite).toBeUndefined();
  });

  it('isNotOnWebsite: absent on 1–3 and blank on 4 yes; a value or a default anywhere no', () => {
    const urls = [...K, 'https://kith.example/4'];
    const absent = { rating: Object.fromEntries(K.map((u) => [u, true as const])) };
    expect(isNotOnWebsite({ urls, expected: { rating: {} }, absent }, 'rating')).toBe(true);
    expect(isNotOnWebsite({ urls, expected: { rating: { [urls[3]!]: '4.1' } }, absent }, 'rating')).toBe(false);
    expect(isNotOnWebsite({ urls, expected: { rating: {} }, absent, defaults: { rating: '5' } }, 'rating')).toBe(false);
    expect(isNotOnWebsite({ urls, expected: { rating: {} } }, 'rating')).toBe(false);
  });
});
```

(Import `isNotOnWebsite` with the others.)

Append to `run-verification.test.ts`, using the file's `fakeDeps`, `emptyCapture` and `U`:

```ts
describe('runVerification — not on this website (spec 2026-10-17 §2)', () => {
  const rating: SchemaDefinitionField = { key: 'rating', name: 'Rating', type: 'number', description: 'stars', concept: 'rating' };
  it('an all-absent field makes no AI call and counts as passed', async () => {
    const set: VerificationSet = { urls: U, expected: { rating: {} }, absent: { rating: Object.fromEntries(U.map((u) => [u, true as const])) } };
    const agent = { proposePaths: async () => { throw new Error('asked AI for a field that is not on this website'); } };
    const run = await runVerification({ fields: [rating], verificationSet: set }, { ...fakeDeps(set), agent: agent as never });
    expect(run.outcome.fields.rating).toMatchObject({ notOnWebsite: true, certified: [], aiCalled: false });
    expect(run.outcome.aiCalls).toBe(0);
    expect(run.outcome.allPassed).toBe(true);
  });
});
```

(Use the agent shape the file's other AI tests use if `proposePaths` is not its method name; the point is an agent that throws if called.)

Append to `binding-input.test.ts`, with the file's `ok`, `U` and `contract` (pick the contract's number or any field, here called `rating`; use whatever key the fixture has):

```ts
describe('D3 and a field not on this website (spec 2026-10-17 §2)', () => {
  const key = contract[0]!.key;
  const name = contract[0]!.name;
  const allAbsent = Object.fromEntries(ok.urls.slice(0, 3).map((u) => [u, true as const]));
  it('absent on products 1–3 with no value is no problem', () => {
    const input = { ...ok, expected: { ...ok.expected, [key]: {} }, absent: { [key]: allAbsent } };
    expect(bindingProblems(input, contract).filter((p) => p.startsWith(name))).toEqual([]);
  });
  it('absent on two with a value on one is refused with the new words', () => {
    const [a, b, c] = ok.urls;
    const input = { ...ok, expected: { ...ok.expected, [key]: { [a!]: ok.expected[key]![a!]!, [b!]: '', [c!]: '' } }, absent: { [key]: { [b!]: true as const, [c!]: true as const } } };
    expect(bindingProblems(input, contract)).toContain(`${name}: needs a value on at least two products, or "not on this product" on every one`);
  });
});
```

Then update the existing test(s) in that file that expect the old text `needs a value on at least two products` to the new one.

Append to `current-certification.test.ts`, mirroring its existing default-only currency test (copy that test, set `notOnWebsite: true` in place of `defaultOnly: true`, and name it "a field not on this website whose cells all pass is current"). If no default-only test exists there, write the case against `loadFieldCurrency` with the file's seed helpers, asserting the key is in `currentKeys`.

Append to `sources-verify.test.ts`, inside `describe('sources.verifyEstimate re-verify pricing'`:

```ts
  it('a field marked not on this product everywhere never reaches AI (spec 2026-10-17 §2)', async () => {
    const tag = `est-absent-${Date.now()}`;
    const urls = urlsFor(tag);
    const f = await createProjectWithSource(caller, {
      tag, urls,
      fields: [{ name: 'Rating', type: 'number' }, { name: 'Title', type: 'text' }],
      expected: { Rating: {}, Title: { [urls[0]!]: 'a', [urls[1]!]: 'b', [urls[2]!]: 'c' } },
      absent: { Rating: Object.fromEntries(urls.map((u) => [u, true as const])) },
    });
    try {
      const est = await caller.sources.verifyEstimate({ sourceId: f.sourceId });
      expect(est.fields).toBe(2);
      expect(est.aiFields).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
```

If `createProjectWithSource` has no `absent` option, add one to that helper (it lives in the api test helpers; find it with `grep -rn "export async function createProjectWithSource" packages/api/src`), passing it through to the binding save, and include the helper file in the commit.

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @robot/scraper exec vitest run src/verify/certify.test.ts src/verify/run-verification.test.ts
pnpm --filter @robot/api exec vitest run src/verify/binding-input.test.ts src/verify/current-certification.test.ts src/routers/sources-verify.test.ts
```

- [ ] **Step 3: Implement.**

`types.ts`, in `FieldVerification` after `defaultOnly`:

```ts
  /** Set (true) only when every checked page is marked "not on this product" and there is no default (spec 2026-10-17 §2): no path, every product left empty. Absent otherwise. */
  notOnWebsite?: true;
```

`certify.ts`, beside `checkedPages`:

```ts
/** Spec 2026-10-17 §2: is this field marked "not on this product" on every page it is checked on, with no value anywhere and no default? */
export function isNotOnWebsite(set: Pick<VerificationSet, 'urls' | 'expected' | 'absent' | 'defaults'>, key: string): boolean {
  if ((set.defaults?.[key] ?? '').trim()) return false;
  const absent = set.absent?.[key] ?? {};
  const pages = checkedPages(set.urls, set.expected[key] ?? {}, absent);
  return pages.length > 0 && pages.every((u) => absent[u] === true);
}
```

(Import `VerificationSet` from `./types.js`.) In `certifyCandidates`, right after `const urls = …`:

```ts
  // Spec 2026-10-17 §2: every checked page absent, no default — not on this website. Nothing is
  // evaluated: with no page holding a value, any path (a cached one included) would be "correct".
  if (defaultValue === undefined && urls.length > 0 && urls.every((u) => absentSet.has(u))) {
    return {
      key: field.key,
      cells: Object.fromEntries(urls.map((u): [string, CellResult] => [u, captures[u] ? { status: 'pass', found: '' } : { status: 'not_captured' }])),
      certified: [], weakEvidence: false, aiCalled: false, incomplete: urls.some((u) => !captures[u]), notOnWebsite: true,
    };
  }
```

`run-verification.ts`: the AI condition gains `&& !result.notOnWebsite`; `allPassed` reads `(f.certified.length > 0 || f.defaultOnly === true || f.notOnWebsite === true)`.

`binding-input.ts`, the D3 block:

```ts
      const withValue = input.urls.filter((url) => (cells[url] ?? '').trim() !== '').length;
      const absentCount = input.urls.filter((url) => absent[url]).length;
      // Spec 2026-10-17 §2: absent on products one to three with no value anywhere is "not on this website".
      const notOnWebsite = withValue === 0 && input.urls.slice(0, VERIFY_URL_MIN).every((url) => absent[url]);
      if (absentCount > 0 && withValue < 2 && !notOnWebsite) problems.push(`${f.name}: needs a value on at least two products, or "not on this product" on every one`);
```

`current-certification.ts` line ~117 and `jev-agreement.ts` line ~55: add `|| r.notOnWebsite === true` beside `r.defaultOnly === true`, with the comment "A field not on this website (spec 2026-10-17 §2) is current with no path."

`routers/ops.ts`, beside the `defaultOnly` spread: `...(result?.notOnWebsite ? { notOnWebsite: true as const } : {}),`.

`routers/sources.ts`, in `verifyEstimate`'s `aiFields` filter, first line inside the callback:

```ts
        if (set && isNotOnWebsite(set, k)) return false; // spec 2026-10-17 §2: never searched, never AI
```

with `isNotOnWebsite` imported from `@robot/scraper` (add it to `packages/scraper/src/verify/index.ts` and the package index if they list exports by name).

- [ ] **Step 4: Run every file from Step 2 again.** Expected: pass. Then:

```
pnpm --filter @robot/api exec vitest run src/verify/run-source-verification.test.ts src/verify/jev-agreement.test.ts
pnpm --filter @robot/scraper exec tsc --noEmit
pnpm --filter @robot/api exec tsc --noEmit
```

- [ ] **Step 5: Commit.**

```
git add packages/scraper/src/verify/types.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/index.ts packages/scraper/src/verify/run-verification.ts packages/api/src/verify/binding-input.ts packages/api/src/verify/current-certification.ts packages/api/src/verify/jev-agreement.ts packages/api/src/routers/ops.ts packages/api/src/routers/sources.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/run-verification.test.ts packages/api/src/verify/binding-input.test.ts packages/api/src/verify/current-certification.test.ts packages/api/src/routers/sources-verify.test.ts
git commit -m "feat: a field marked 'not on this product' on every proof page passes as not on this website — no path, no AI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Leave out `index.ts` if it did not change; add the test helper by its path if Step 1 changed it.

---

### Task 6: The Verify gate and the row (`@robot/app`) — items 1 and 2, app

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts` (`verifyGate`, `badge`, `NOT_ON_WEBSITE_WORD`, `notOnWebsiteWord`, `VerificationResultsLike`)
- Modify: `packages/app/src/lib/site/verification-view.ts` (`FieldVerification.notOnWebsite`)
- Modify: `packages/app/src/lib/ops-view.ts` (`OpsField.notOnWebsite`, `NOT_ON_WEBSITE_PATHS`)
- Modify: `packages/app/src/routes/_app/ops/websites/$sourceId.tsx` (the two default-only lines)
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (the row word)
- Test: `packages/app/src/lib/site/verification-model.test.ts`, `packages/app/src/lib/ops-view.test.ts` (if it exists; else the model test file only)

**Interfaces:**
- Consumes: `notOnWebsite` on stored results and ops fields (Task 5).
- Produces:
  ```ts
  export const NOT_ON_WEBSITE_WORD = 'not on this website · left empty on every product';
  export function notOnWebsiteWord(results: VerificationResultsLike | null, key: string, unchangedKeys: string[]): string | null;
  export const NOT_ON_WEBSITE_PATHS = 'no path — not on this website, left empty';  // ops-view.ts
  ```

- [ ] **Step 1: Failing tests.** Append to `verification-model.test.ts` (reuse the file's board builders if it has them; otherwise build boards with `emptyBoard()`, `setCards`, `answer`, `markAbsent`, `setDefault` as below):

```ts
describe('verifyGate — not on this website, and a default on products 4–6 (spec 2026-10-17 §2, §3)', () => {
  const cards = [1, 2, 3, 4].map((i) => ({ url: `https://g.example/${i}`, title: `P${i}` }));
  const brand: Field = { key: 'brand', name: 'Brand', type: 'text', description: 'logo', concept: 'brand' };
  const rating: Field = { key: 'rating', name: 'Rating', type: 'number', description: 'stars', concept: 'rating' };
  const base = () => {
    let b = setCards(emptyBoard(), cards);
    for (const c of cards.slice(0, 3)) b = answer(b, 'brand', c.url, { value: 'Gymshark', mark: null });
    return b;
  };
  const suggestion = { captureId: 'c', value: 'Gymshark', boxes: [], origin: 'page-data' as const, via: { source: 'json-ld', path: 'brand.name' } };

  it('a field absent on products 1–3 with no value passes the gate', () => {
    let b = base();
    for (const c of cards.slice(0, 3)) b = markAbsent(b, 'rating', c.url);
    b = answer(b, 'brand', cards[3]!.url, { value: 'Gymshark', mark: null });
    expect(verifyGate(b, [brand, rating], {})).toEqual({ ok: true });
  });

  it('absent on two and a value on one names the new rule', () => {
    let b = base();
    b = answer(b, 'rating', cards[0]!.url, { value: '4.5', mark: null });
    b = markAbsent(markAbsent(b, 'rating', cards[1]!.url), 'rating', cards[2]!.url);
    b = answer(b, 'brand', cards[3]!.url, { value: 'Gymshark', mark: null });
    expect(verifyGate(b, [brand, rating], {})).toMatchObject({ ok: false, reason: 'Rating needs a value on at least two products, or "not on this product" on every one', field: 'rating' });
  });

  it('a suggestion on product 4 does not block a field with a default', () => {
    let b = setDefault(base(), 'brand', 'Gymshark');
    b = answer(b, 'rating', cards[3]!.url, { value: '4.1', mark: null });
    for (const c of cards.slice(0, 3)) b = answer(b, 'rating', c.url, { value: '4.2', mark: null });
    expect(verifyGate(b, [brand, rating], { brand: { [cards[3]!.url]: suggestion } })).toEqual({ ok: true });
  });

  it('a suggestion on product 4 still blocks a field with no default', () => {
    let b = base();
    for (const c of cards) b = answer(b, 'rating', c.url, { value: '4.2', mark: null });
    expect(verifyGate(b, [brand, rating], { brand: { [cards[3]!.url]: suggestion } })).toMatchObject({ ok: false, reason: 'Brand has a suggestion to confirm on product 4' });
  });
});

describe('a field not on this website after Verify (spec 2026-10-17 §2)', () => {
  const results = { rating: { certified: [], notOnWebsite: true as const, cells: { 'https://g.example/1': { status: 'pass' as const } } } };
  it('reads verified and carries its row word while unchanged', () => {
    expect(badge({ key: 'rating', results, unchangedKeys: ['rating'], running: false, cards: [] })).toEqual({ kind: 'verified' });
    expect(notOnWebsiteWord(results, 'rating', ['rating'])).toBe('not on this website · left empty on every product');
    expect(notOnWebsiteWord(results, 'rating', [])).toBeNull();
  });
});
```

Update the existing test(s) in this file that expect the old D3 reason `needs a value on at least two products` to the new text.

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts
```

- [ ] **Step 3: Implement.** In `verification-model.ts`:

`VerificationResultsLike` gains `notOnWebsite?: true;` beside `defaultOnly`.

In `verifyGate`, the products 4–6 branch:

```ts
        if (!a) {
          // A blank cell of a field with a default is a default cell on every product (spec 2026-10-17 §3), so its suggestion never blocks.
          if (s[f.key]?.[url] && defaultOf(board, f.key) === undefined) return { ok: false, reason: `${f.name} has a suggestion to confirm on product ${n}`, gap: f.key };
          continue;
        }
```

and the D3 loop:

```ts
  // Spec D3: a field absent anywhere must still carry a value on at least two products, unless it
  // is absent on products one to three and valued nowhere: not on this website (spec 2026-10-17 §2).
  for (const f of fields) {
    const answered = board.cards.map((c) => board.answers[f.key]?.[c.url]).filter((a): a is Answer => !!a);
    if (!answered.some((a) => a.absent)) continue;
    const valued = answered.filter((a) => !a.absent).length;
    const notOnWebsite = valued === 0 && board.cards.slice(0, PRODUCTS_MIN).every((c) => isAbsent(board, f.key, c.url));
    if (valued < 2 && !notOnWebsite) return { ok: false, reason: `${f.name} needs a value on at least two products, or "not on this product" on every one`, field: f.key };
  }
```

Beside `DEFAULT_ONLY_WORD`:

```ts
export const NOT_ON_WEBSITE_WORD = 'not on this website · left empty on every product';

/** The row word beside a verified badge for a field not on this website (spec 2026-10-17 §2); null otherwise or once the field changed since. */
export function notOnWebsiteWord(results: VerificationResultsLike | null, key: string, unchangedKeys: string[]): string | null {
  return results?.[key]?.notOnWebsite === true && unchangedKeys.includes(key) ? NOT_ON_WEBSITE_WORD : null;
}
```

In `badge`: `if (fv.certified.length > 0 || fv.defaultOnly === true || fv.notOnWebsite === true) return { kind: 'verified' };`

In `reverifyScope`, a field not on this website that is current is left out like a certified one:

```ts
  return fields.filter((f) => !currentKeys.includes(f.key) || ((results[f.key]?.certified.length ?? 0) === 0 && results[f.key]?.notOnWebsite !== true)).map((f) => f.key);
```

In `verification-view.ts`, `FieldVerification` gains `notOnWebsite?: true;` with the same doc line as the scraper's.

In `ops-view.ts`: `OpsField` gains `notOnWebsite?: boolean;` and, beside `DEFAULT_ONLY_PATHS`, `export const NOT_ON_WEBSITE_PATHS = 'no path — not on this website, left empty';`. In the ops route's two lines, `field.defaultOnly ? DEFAULT_ONLY_PATHS :` becomes `field.defaultOnly ? DEFAULT_ONLY_PATHS : field.notOnWebsite ? NOT_ON_WEBSITE_PATHS :`, with the import.

In the site route, the row's word: `defaultOnlyWord: defaultOnlyWord(results, f.key, unchangedKeys) ?? notOnWebsiteWord(results, f.key, unchangedKeys),` with `notOnWebsiteWord` imported. (The table renders that prop as the row word; it is not renamed.)

- [ ] **Step 4: Run the tests and the type check.**

```
pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts src/lib/site/verify-button.test.ts
pnpm --filter @robot/app exec tsc --noEmit
```

- [ ] **Step 5: Commit.**

```
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/lib/site/verification-view.ts packages/app/src/lib/ops-view.ts "packages/app/src/routes/_app/ops/websites/\$sourceId.tsx" "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
git commit -m "feat(app): Verify lets a field through that is not on this website, and a default stops a product-4 suggestion from blocking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: An honest cost label, and the address warning's re-verify (`@robot/scraper`, `@robot/api`, `@robot/app`) — item 7

**Files:**
- Modify: `packages/scraper/src/verify/constants.ts` (`EST_AI_COST_PER_FIELD_PAGE_USD`, `estAiCostPerFieldUsd`)
- Modify: `packages/scraper/src/verify/page-variant-match.ts` (`readsFixedVariant`)
- Modify: `packages/scraper/src/verify/run-verification.ts` (the cache shortcut)
- Modify: `packages/scraper/src/verify/certify.ts` (`isConfirmedPath` and the `[page]` twin)
- Modify: `packages/api/src/routers/sources.ts` (`verifyEstimate`)
- Modify: `packages/app/src/components/verification/verification-table.tsx` (the button)
- Modify: `packages/app/src/lib/site/verification-model.ts` (`REVERIFY_FIELD`, `REVERIFY_FIELD_FREE`)
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (`reverifyField`)
- Test: `packages/scraper/src/verify/certify.test.ts`, `run-verification.test.ts`, `page-variant-match.test.ts`, `packages/api/src/routers/sources-verify.test.ts`, `packages/app/src/lib/site/verification-model.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  // constants.ts
  export const EST_AI_COST_PER_FIELD_PAGE_USD = 0.06;
  export function estAiCostPerFieldUsd(pages: number): number;  // cents-rounded, at least three pages
  // page-variant-match.ts
  export function readsFixedVariant(p: { source: string; path: string }): boolean;
  // verification-model.ts
  export const REVERIFY_FIELD = 'Re-verify this field';            // customer
  export const REVERIFY_FIELD_FREE = 'Re-verify this field · free'; // staff (Task 8)
  // verification-table.tsx: TableRow.onReverifyField?: () => void
  ```
  `EST_AI_COST_PER_FIELD_USD` is removed; `grep -rn EST_AI_COST_PER_FIELD_USD packages` must come back empty.

- [ ] **Step 1: Failing tests.**

Append to `page-variant-match.test.ts`:

```ts
describe('readsFixedVariant (spec 2026-10-17 §8)', () => {
  it('a structured path with a numeric index on a variant list, never [page] or an xpath', () => {
    expect(readsFixedVariant({ source: 'json-ld', path: 'offers[0].price' })).toBe(true);
    expect(readsFixedVariant({ source: 'json-ld', path: 'hasVariant[1].offers.price' })).toBe(true);
    expect(readsFixedVariant({ source: 'json-ld', path: 'hasVariant[page].offers.price' })).toBe(false);
    expect(readsFixedVariant({ source: 'json-ld', path: 'image[0]' })).toBe(false);
    expect(readsFixedVariant({ source: 'xpath', path: '(//span)[1]' })).toBe(false);
  });
});
```

Append to `certify.test.ts`:

```ts
it('a [page] twin of a confirmed path ranks first (spec 2026-10-17 §8)', async () => {
  const price = { key: 'price', name: 'Price', type: 'money' as const, description: 'p', concept: 'price' };
  const urls = ['https://v.example/1', 'https://v.example/2', 'https://v.example/3'];
  const ld = { offers: [{ price: 10 }] };
  const caps = Object.fromEntries(urls.map((u) => [u, { url: u, html: '<html></html>', structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] } as CaptureLike]));
  const fixed = { source: 'json-ld' as const, path: 'offers[0].price', transform: 'identity' as const };
  const twin = { source: 'json-ld' as const, path: 'offers[page].price', transform: 'identity' as const };
  const r = await certify({ field: price, expected: Object.fromEntries(urls.map((u) => [u, '10.00'])), captures: caps, candidates: [fixed, twin], confirmed: [{ source: 'json-ld', path: 'offers[0].price' }] }, { evalXPaths: async () => ({}) });
  expect(r.certified[0]).toMatchObject({ path: 'offers[page].price' });
});
```

(`resolveStructured` resolves `[page]` with no page variant to the first entry, as `pickPageEntry` does; if it resolves to nothing without a `pageVariant`, give each capture `pageVariant: pageVariantFrom(u + '?variant=1', null, {})` from `@robot/browser`, as `search-structured.test.ts` does.)

Append to `run-verification.test.ts`:

```ts
describe('runVerification — a cached fixed-variant path on a named-variant page (spec 2026-10-17 §8)', () => {
  const rug = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/ruggable.json', import.meta.url), 'utf8'));
  const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'price', concept: 'price' };
  const capture = { ...emptyCapture(rug.url), url: rug.url, structuredData: { ldJson: rug.ldJson, nextData: null, initialState: null, meta: {} }, pageVariant: pageVariantFrom(rug.url, null, {}) } as unknown as import('@robot/browser').PageCapture;
  const caps = Object.fromEntries(U.map((u) => [u, capture]));
  const set: VerificationSet = { urls: U, expected: { price: Object.fromEntries(U.map((u) => [u, '569.00'])) } };
  it('the cache shortcut is not kept; the search\'s [page] path certifies first', async () => {
    const run = await runVerification({ fields: [price], verificationSet: set }, {
      browser: { setContentEvaluate: async () => [] } as unknown as IBrowser, agent: null, captures: caps,
      cachedPaths: async () => [{ source: 'json-ld', path: 'hasVariant[1].offers.price', transform: 'identity' }],
    });
    expect(run.outcome.fields.price!.certified[0]).toMatchObject({ path: 'hasVariant[page].offers.price' });
    expect(run.outcome.aiCalls).toBe(0);
  });
});
```

(Add `import { readFileSync } from 'node:fs';` and `pageVariantFrom` to the `@robot/browser` import at the top of the file.)

In `sources-verify.test.ts`, the first estimate test's `perFieldUsd: 0.05` becomes `perFieldUsd: 0.18`, and its title "returns fields, perFieldUsd 0.18, …". Append to the re-verify pricing describe:

```ts
  it('the per-field figure is per checked proof page and covers the largest three-page call seen (spec 2026-10-17 §8)', () => {
    expect(estAiCostPerFieldUsd(3)).toBe(0.18);
    expect(estAiCostPerFieldUsd(4)).toBe(0.24);
    expect(estAiCostPerFieldUsd(2)).toBe(0.18);
    expect(estAiCostPerFieldUsd(3)).toBeGreaterThanOrEqual(0.1521); // skims, campaign 2: one AI call on three pages
  });
```

(Import `estAiCostPerFieldUsd` from `@robot/scraper`.)

Append to `verification-model.test.ts`:

```ts
it('the address warning button copy (spec 2026-10-17 §8)', () => {
  expect(REVERIFY_FIELD).toBe('Re-verify this field');
  expect(REVERIFY_FIELD_FREE).toBe('Re-verify this field · free');
});
```

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @robot/scraper exec vitest run src/verify/page-variant-match.test.ts src/verify/certify.test.ts src/verify/run-verification.test.ts
pnpm --filter @robot/api exec vitest run src/routers/sources-verify.test.ts
pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts
```

- [ ] **Step 3: Implement.**

`constants.ts`, replacing `EST_AI_COST_PER_FIELD_USD`:

```ts
/**
 * Spec 2026-10-17 §8: one AI call reads every checked proof page's capture, so its cost grows with
 * the pages. Campaign 2 calls cost $0.08–$0.17 (skims: $0.1521 for one field on three pages), so
 * $0.06 a page keeps "up to" an upper bound.
 */
export const EST_AI_COST_PER_FIELD_PAGE_USD = 0.06;

/** The most one AI-reachable field may cost at Verify on this many proof pages (never fewer than three). */
export function estAiCostPerFieldUsd(pages: number): number {
  return Math.round(EST_AI_COST_PER_FIELD_PAGE_USD * Math.max(pages, VERIFY_URL_MIN) * 100) / 100;
}
```

Export both wherever `EST_AI_COST_PER_FIELD_USD` was exported.

`routers/sources.ts`: import `estAiCostPerFieldUsd` in place of the old constant;

```ts
      const perFieldUsd = estAiCostPerFieldUsd(urls.length);
      return {
        fields,
        aiFields,
        perFieldUsd,
        upperBoundUsd: aiAvailable ? Math.round(aiFields * perFieldUsd * 100) / 100 : 0,
```

`page-variant-match.ts`:

```ts
/** A numeric index directly on a variant-list key (`offers[0]`, `hasVariant[2]`); never `@graph[n]`, `image[n]` or any other key. The app's address warning uses the same words. */
const INDEXED_STEP = /(^|[.\]])(offers|hasVariant|variants|variant|skus|items|products|options)\[\d+\]/i;

/** Spec 2026-10-17 §8: does this structured path read a fixed entry of a variant list, with no `[page]` step? */
export function readsFixedVariant(p: { source: string; path: string }): boolean {
  return p.source !== 'xpath' && !p.path.includes('[page]') && INDEXED_STEP.test(p.path);
}
```

`run-verification.ts`, the shortcut:

```ts
      // Spec 2026-10-17 §8: a fixed variant index on a proof page whose address names a variant reads
      // the first variant whatever the address says; search again, so the [page] path can replace it.
      const namedVariant = Object.values(caps).some((c) => c?.pageVariant?.named === true);
      if (r.certified.length > 0 && !r.certified.some(isVolatilePath) && !(namedVariant && r.certified.some(readsFixedVariant))) result = r;
```

`certify.ts`, `isConfirmedPath`:

```ts
/** Index-free form of a structured path, so `offers[page].price` and `offers[0].price` compare equal. */
const indexFree = (p: string) => p.replace(/\[(?:\d+|page)\]/g, '[]');

/** Was this candidate confirmed by the customer? Source and path; the transform does not matter. A `[page]` path counts as confirmed when its fixed-index twin was (spec 2026-10-17 §8). */
function isConfirmedPath(c: CandidatePath, confirmed: ConfirmedPath[] | undefined): boolean {
  return c.source !== 'xpath' && (confirmed ?? []).some((p) => p.source === c.source && (p.path === c.path || (c.path.includes('[page]') && indexFree(p.path) === indexFree(c.path))));
}
```

`verification-model.ts`, beside `ADDRESS_WARNING`: `export const REVERIFY_FIELD = 'Re-verify this field';` and `export const REVERIFY_FIELD_FREE = 'Re-verify this field · free';` (staff only; Task 8 chooses between them through `showsMoney`, and until then the table renders the customer label).

`verification-table.tsx`: `TableRow` gains `onReverifyField?: () => void;` (doc: "Re-verifies this row's field alone, for the address warning (spec 2026-10-17 §8)"). `StatusCellProps` gains `onReverifyField?: () => void`. In `StatusCell`, the warning line becomes:

```tsx
      {shows ? (
        <span className="flex flex-wrap items-center gap-2 text-sm text-warn">
          {addressWarning}
          {props.onReverifyField ? (
            <Button size="sm" variant="outline" disabled={props.locked} onClick={props.onReverifyField}>
              {REVERIFY_FIELD}
            </Button>
          ) : null}
        </span>
      ) : null}
```

Destructure `onReverifyField` out of `props` before `StatusBody` receives the rest, the way `addressWarning` is (extend the `Omit<…>` of `StatusBody`'s props). Pass `onReverifyField={row.onReverifyField}` where `StatusCell` is rendered. Use the size and variant names `button.tsx` actually exports.

In the site route, next to `handleVerify`:

```tsx
  // Spec 2026-10-17 §8: the address warning's own re-verify — this field alone, free (its old path is still a candidate, so no AI).
  async function reverifyField(key: string) {
    setError(null);
    setNotice(null);
    setVerifying(true);
    try {
      await saverRef.current?.flush();
      await variantAnswers.flush();
      await verifyMutation.mutateAsync({ sourceId, onlyKeys: [key] });
      await invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }
```

and in the row object, beside `addressWarning`: `onReverifyField: () => void reverifyField(f.key),`.

- [ ] **Step 4: Run every file from Step 2 again**, then:

```
grep -rn "EST_AI_COST_PER_FIELD_USD" packages --include=*.ts --include=*.tsx
pnpm --filter @robot/app exec vitest run src/lib/site/verify-button.test.ts
pnpm --filter @robot/app exec tsc --noEmit
pnpm --filter @robot/api exec tsc --noEmit
```

Expected: the grep is empty; tests pass; no type errors. If `verify-button.test.ts` pins a dollar figure built from 0.05, update it to the new figure and name it in the report.

- [ ] **Step 5: Commit.**

```
git add packages/scraper/src/verify/constants.ts packages/scraper/src/verify/page-variant-match.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/certify.ts packages/api/src/routers/sources.ts packages/app/src/components/verification/verification-table.tsx packages/app/src/lib/site/verification-model.ts "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/scraper/src/verify/page-variant-match.test.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/run-verification.test.ts packages/api/src/routers/sources-verify.test.ts packages/app/src/lib/site/verification-model.test.ts
git commit -m "feat: Verify's cost label is per proof page, and the variant-address warning re-verifies its field for free

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add any index file or test Step 4 changed, by its path.

---

### Task 8: Customers see no money (`@robot/app`) — item 7, Marko's decision

Marko, 2026-10-17: "once we have paying customers we don't want to show any price to the customer. We will have a different payment plan, to be decided later." Spec §8a.

**Files:**
- Create: `packages/app/src/lib/money-visibility.ts` (`showsMoney`)
- Modify: `packages/app/src/lib/site/verify-button.ts` (`showMoney` argument)
- Modify: `packages/app/src/lib/site/backfill-preview.ts` (`previewSummary` takes `showMoney`)
- Modify: `packages/app/src/lib/usage-view.ts` (`usageView` takes `showMoney`; `usageHeadline`)
- Modify: `packages/app/src/lib/staff-view.ts` (`formatStaffEntry` takes `showMoney`)
- Modify: `packages/app/src/components/extract/extract-sample.tsx` (the sentence)
- Modify: `packages/app/src/components/usage/usage-total.tsx`, `packages/app/src/components/usage/usage-table.tsx`, `packages/app/src/routes/_app/usage.tsx`
- Modify: `packages/app/src/components/runs/backfill-panel.tsx`, `packages/app/src/components/staff/staff-activity-list.tsx`
- Modify: `packages/app/src/components/verification/verification-table.tsx` (`showMoney` prop for the address button)
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (passes `showMoney` to the button label and the table)
- Modify: `packages/app/src/routes-smoke.test.ts` (no `$` on four screens)
- Test: `packages/app/src/lib/money-visibility.test.ts` (new), `lib/site/verify-button.test.ts`, `lib/site/backfill-preview.test.ts`, `lib/usage-view.test.ts` (create if missing), `lib/staff-view.test.ts` (create if missing), `lib/org-runs-view.test.ts` (create if missing)

**Interfaces:**
- Consumes: the `/_app` route context's `session` (`isOperator`, `staff`), as the site route reads it for staff-only readings; `REVERIFY_FIELD`, `REVERIFY_FIELD_FREE` (Task 7).
- Produces:
  ```ts
  // lib/money-visibility.ts
  export type MoneyViewer = { isOperator: boolean; staff?: unknown };
  export function showsMoney(viewer: MoneyViewer): boolean;
  // verify-button.ts: verifyButton(args & { showMoney: boolean })
  // backfill-preview.ts: previewSummary(p, showMoney: boolean)
  // usage-view.ts: usageView(rows, showMoney: boolean): UsageRowView[]  (spendLabel: string | null)
  //                usageHeadline(total, month, showMoney): { label: string; figure: string; sub: string }
  // staff-view.ts: formatStaffEntry(e, now, showMoney: boolean)  (cost: string | null)
  ```

- [ ] **Step 1: Failing tests.**

`money-visibility.test.ts` (new):

```ts
import { describe, it, expect } from 'vitest';
import { showsMoney } from './money-visibility';

describe('showsMoney (spec 2026-10-17 §8a)', () => {
  it('a customer never sees money', () => expect(showsMoney({ isOperator: false, staff: null })).toBe(false));
  it('an operator does', () => expect(showsMoney({ isOperator: true, staff: null })).toBe(true));
  it('a staff session inside a customer org does', () => expect(showsMoney({ isOperator: false, staff: { orgId: 'o', expiresAt: '2026-10-17T20:00:00Z' } })).toBe(true));
});
```

Append to `verify-button.test.ts` (reuse the file's base args; `base` here stands for them):

```ts
describe('money on the Verify button is staff-only (spec 2026-10-17 §8a)', () => {
  const args = { ...base, firstRun: true, fieldCount: 8, aiAvailable: true, upperBoundUsd: 1.44, complete: true, busy: false };
  it('a customer reads no amount and no price word', () => {
    expect(verifyButton({ ...args, showMoney: false }).label).toBe('Verify 8 fields');
    expect(verifyButton({ ...args, showMoney: false, upperBoundUsd: 0 }).label).toBe('Verify 8 fields');
  });
  it('staff read the worst case', () => {
    expect(verifyButton({ ...args, showMoney: true }).label).toBe('Verify 8 fields · up to $1.44');
    expect(verifyButton({ ...args, showMoney: true, upperBoundUsd: 0 }).label).toBe('Verify 8 fields · free');
  });
  it('the re-verify and variants forms follow the same rule', () => {
    const re = { ...args, firstRun: false, reverifyCount: 2 };
    expect(verifyButton({ ...re, showMoney: false }).label).toBe('Re-verify 2 fields');
    expect(verifyButton({ ...re, showMoney: true }).label).toBe('Re-verify 2 fields · up to $1.44');
  });
});
```

(Match the function's real name and argument names in `verify-button.ts`; the variants-only form reads `Verify variants` for a customer and `Verify variants · free` for staff — add those two asserts with the args the file's variants tests use. Every existing test gains `showMoney: true` so its expectations stay as they are.)

Append to `backfill-preview.test.ts`:

```ts
it('previewSummary shows a price to staff only (spec 2026-10-17 §8a)', () => {
  expect(previewSummary({ pages: 12, estCostUsd: 0.36 }, false)).toBe('12 pages');
  expect(previewSummary({ pages: 12, estCostUsd: 0.36 }, true)).toBe('12 pages — up to ~$0.36 if no cache answers');
  expect(previewSummary({ pages: 1, estCostUsd: 0, certified: true }, false)).toBe('1 page');
});
```

`usage-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { usageView, usageHeadline } from './usage-view';

describe('usage without money for a customer (spec 2026-10-17 §8a)', () => {
  const rows = [{ id: 'p', name: 'Prices', slug: 'prices', spendUsd: 1.24, pagesCaptured: 60 }];
  it('rows carry no spend label for a customer, and one for staff', () => {
    expect(usageView(rows, false)[0]!.spendLabel).toBeNull();
    expect(usageView(rows, true)[0]!.spendLabel).toBe('$1.24');
  });
  it('the headline is pages for a customer, spend for staff', () => {
    expect(usageHeadline({ spendUsd: 1.24, pagesCaptured: 60 }, '2026-10', false)).toEqual({ label: 'Pages captured in Oct 2026', figure: '60 pages', sub: '' });
    expect(usageHeadline({ spendUsd: 1.24, pagesCaptured: 60 }, '2026-10', true)).toEqual({ label: 'Spend in Oct 2026', figure: '$1.24', sub: '60 pages captured' });
  });
});
```

(Use `monthLabel`'s real output for the month; check it before writing the literal.)

`staff-view.test.ts` (append if it exists):

```ts
it('formatStaffEntry shows a run\'s cost to staff only (spec 2026-10-17 §8a)', () => {
  const e = { id: 'a', at: '2026-10-17T10:00:00Z', actor: { name: 'Op', email: 'op@example.com' }, org: { id: 'o', name: 'Org' }, project: null, website: null, summary: 'Verified', run: { id: 'r', costUsd: 1.24 } };
  const now = new Date('2026-10-17T11:00:00Z');
  expect(formatStaffEntry(e as never, now, false).cost).toBeNull();
  expect(formatStaffEntry(e as never, now, true).cost).toBe('$1.24');
});
```

(Shape `e` after `StaffEntryView`; drop the casts once it matches.)

`org-runs-view.test.ts` (append if it exists):

```ts
it('the org runs view carries no cost to render (spec 2026-10-17 §8a)', () => {
  const views = orgRunsView([row]);   // `row`: the file's own OrgRunRow fixture, or one built from RunRow with costUsd 1.24
  expect(Object.keys(views[0]!)).not.toContain('costUsd');
  expect(JSON.stringify(views[0])).not.toMatch(/\$\d/);
});
```

In `routes-smoke.test.ts`, after the step that opens each of the Verification tab, the Extract tab, a run page and Usage, assert on the page's main region (the smoke signs in as a customer):

```ts
    // Spec 2026-10-17 §8a: a customer sees no money.
    expect(await page.locator('main').innerText()).not.toMatch(/\$\s?\d/);
```

Add it as one helper (`expectNoMoney(page)`) called on the four screens, in both themes where the smoke already loops.

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @robot/app exec vitest run src/lib/money-visibility.test.ts src/lib/site/verify-button.test.ts src/lib/site/backfill-preview.test.ts src/lib/usage-view.test.ts src/lib/staff-view.test.ts src/lib/org-runs-view.test.ts
```

(The route smoke is not run here; it runs after the merge, Task 10.)

- [ ] **Step 3: Implement.**

`lib/money-visibility.ts`:

```ts
// Who sees money (spec 2026-10-17 §8a). Marko, 2026-10-17: "once we have paying customers we don't
// want to show any price to the customer." Staff — an operator, or a staff session inside the
// customer's org — still do. Every amount on a customer screen goes through this.

export type MoneyViewer = { isOperator: boolean; staff?: unknown };

export function showsMoney(viewer: MoneyViewer): boolean {
  return viewer.isOperator || !!viewer.staff;
}
```

`verify-button.ts`: the args gain `showMoney: boolean`; the cost becomes a suffix:

```ts
  const price = !aiAvailable || upperBoundUsd === 0 ? 'free' : `up to $${upperBoundUsd.toFixed(2)}`;
  // Spec 2026-10-17 §8a: staff read the price (a worst case, every field needing the AI); a customer reads none.
  const cost = showMoney ? ` · ${price}` : '';
```

and every label that used `· ${cost}` now ends `${cost}` (so `Verify ${fieldsWord(fieldCount)}${cost}`); the two variants-only labels become `` `Verify variants${showMoney ? ' · free' : ''}` ``. Update the file's header comment to say the price is staff-only.

`backfill-preview.ts`:

```ts
export function previewSummary(p: { pages: number; estCostUsd: number; certified?: boolean }, showMoney: boolean): string {
  const pages = p.pages === 1 ? 'page' : 'pages';
  if (!showMoney) return `${p.pages} ${pages}`; // spec 2026-10-17 §8a
  const cost = p.certified ? 'free' : `up to ~$${p.estCostUsd.toFixed(2)} if no cache answers`;
  return `${p.pages} ${pages} — ${cost}`;
}
```

(Keep the existing `pages` word logic if it differs.)

`usage-view.ts`: `UsageRowView.spendLabel` becomes `string | null`; `usageView(rows, showMoney)` sets it to `showMoney ? usdLabel(r.spendUsd) : null`. Add:

```ts
/** The usage headline (spec 2026-10-17 §8a): spend for staff; pages captured for a customer. */
export function usageHeadline(total: { spendUsd: number; pagesCaptured: number }, month: string, showMoney: boolean): { label: string; figure: string; sub: string } {
  return showMoney
    ? { label: `Spend in ${monthLabel(month)}`, figure: usdLabel(total.spendUsd), sub: `${pagesLabel(total.pagesCaptured)} captured` }
    : { label: `Pages captured in ${monthLabel(month)}`, figure: pagesLabel(total.pagesCaptured), sub: '' };
}
```

`usage-total.tsx` renders `usageHeadline(...)` from a new `showMoney` prop (label, figure in the 28 px slot, sub line when non-empty). `usage-table.tsx` takes `showMoney` and renders the Spend `<col>`, `<th>` and `<td>` only when it is true (the loading row's `colSpan` follows). `routes/_app/usage.tsx` reads `const { session } = useRouteContext({ from: '/_app' }); const showMoney = showsMoney(session);`, passes it down and to `usageView`, and the empty text becomes `and its pages will show here.` for a customer (`spend` for staff).

`staff-view.ts`: `formatStaffEntry(e, now = new Date(), showMoney = false)` — the default is the customer's — and `cost: showMoney && e.run && e.run.costUsd > 0 ? … : null`. `staff-activity-list.tsx` reads the session the same way and passes `showsMoney(session)`. Check every other caller of `formatStaffEntry` (ops reuses it?) and pass `true` there.

`extract-sample.tsx`: two sentences, chosen by `showsMoney(session)`:

```ts
const SAMPLE_SENTENCE = 'walks the first listing for up to 3 pages, extracts 3 products with the verified paths.';
const SAMPLE_SENTENCE_STAFF = `${SAMPLE_SENTENCE} No AI. Free.`;
```

`backfill-panel.tsx`: `previewSummary(checkedPreview.data, showsMoney(session))`, the session read from the `/_app` context.

`verification-table.tsx`: `TableRow` (or the table's props) gains `showMoney: boolean`; the address button renders `showMoney ? REVERIFY_FIELD_FREE : REVERIFY_FIELD`. The site route computes `const showMoney = showsMoney(viewer);` once (beside `showJev`, which can become `showJev = showsMoney(viewer)`'s twin — leave `showJev` as it is) and passes it to `verifyButton` and the table.

- [ ] **Step 4: Run Step 2's files again, then the type check and a sweep for amounts that bypass the helper.**

```
pnpm --filter @robot/app exec vitest run src/lib/money-visibility.test.ts src/lib/site/verify-button.test.ts src/lib/site/backfill-preview.test.ts src/lib/usage-view.test.ts src/lib/staff-view.test.ts src/lib/org-runs-view.test.ts
pnpm --filter @robot/app exec tsc --noEmit
grep -rn '\$\${' packages/app/src --include=*.ts --include=*.tsx | grep -v '\.test\.' | grep -v '/ops/\|ops-view'
```

Expected: tests pass, no type errors. Every line the grep prints is behind `showMoney` or is not money (a template's `$` from a variable name); report any other.

- [ ] **Step 5: Commit.**

```
git add packages/app/src/lib/money-visibility.ts packages/app/src/lib/money-visibility.test.ts packages/app/src/lib/site/verify-button.ts packages/app/src/lib/site/verify-button.test.ts packages/app/src/lib/site/backfill-preview.ts packages/app/src/lib/site/backfill-preview.test.ts packages/app/src/lib/usage-view.ts packages/app/src/lib/usage-view.test.ts packages/app/src/lib/staff-view.ts packages/app/src/lib/staff-view.test.ts packages/app/src/lib/org-runs-view.test.ts packages/app/src/components/extract/extract-sample.tsx packages/app/src/components/usage/usage-total.tsx packages/app/src/components/usage/usage-table.tsx packages/app/src/routes/_app/usage.tsx packages/app/src/components/runs/backfill-panel.tsx packages/app/src/components/staff/staff-activity-list.tsx packages/app/src/components/verification/verification-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): customers see no money — prices, spend and costs are staff-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Leave out any listed test file that did not exist and was not created.

---

### Task 9: UX polish — content from Marko

**Placeholder.** Marko said "UX needs little polishing, but about that later" (2026-10-16) and "UX changes at the end" (2026-10-17). He supplies this task's content before it runs. Do not start it, and do not guess its content.

When he does:
- write it here as Files, Interfaces and TDD steps like the tasks above, with exact copy in his words;
- keep it in `@robot/app` unless he says otherwise;
- check every new customer string against `customer-copy-no-internals`;
- commit by explicit path with the trailer.

If Marko wants the row-level "Not on this website" action (spec §12 decision 5), it belongs here.

---

### Task 10: Docs and the route smoke

**Files:**
- Modify: `docs/superpowers/specs/2026-10-17-verify-dead-ends-design.md` (Status: implemented, merge commit, deviations)
- Modify: `docs/handoff.md` (current state; what not to redo; the decisions taken)
- Modify: `CLAUDE.md` (one "Key Technical Decisions" line)
- Modify: `docs/testing/2026-10-11-campaign-2.md` (group 3: each dead end marked fixed with this spec's section)

- [ ] **Step 1: Spec status.** Add a second Status paragraph: implemented on `feat/verify-dead-ends`, merged into `main` on the date with the merge commit, the review outcome, and a **Deviations** list (every expectation changed in Tasks 2, 3 and 7, named; every interface that moved).

- [ ] **Step 2: CLAUDE.md.** Add under Key Technical Decisions:

```
- Verify dead ends (2026-10-17): a field marked "not on this product" on every proof page passes as not on this website (no path, left empty); the shop's name (og:site_name, the offer seller) can be a brand; a proof page whose value was found reads green on three pages too; a marked sku/brand/rating line stores its value without "Label:", and a mark reads an image's src; a number shown with decimals matches more precise page data; Verify's cost label is $0.06 per AI-reachable field per proof page, staff only; a customer sees no money anywhere in the app (`showsMoney`, Marko 2026-10-17).
```

- [ ] **Step 3: handoff.md and the campaign doc.** In `docs/handoff.md`, replace the Verify dead-ends entry in the open work with what is done, what was left out (spec §11), and the decisions Marko took on spec §12. In the campaign doc's group 3, add "fixed: spec 2026-10-17 §n" after each bullet this spec covers, and "open" after the silent-failures bullet.

- [ ] **Step 4: Commit.**

```
git add docs/superpowers/specs/2026-10-17-verify-dead-ends-design.md docs/handoff.md CLAUDE.md docs/testing/2026-10-11-campaign-2.md
git commit -m "docs: Verify dead ends — status, decisions, handoff and campaign notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: After the merge to `main`, the route smoke.** With `pnpm dev:all` running in Marko's terminal (never started or restarted here) and `JEV_SHADOW` unset:

```
pnpm test:ui:app
```

Expected: every screen passes and writes its screenshots in both themes, and `expectNoMoney` (Task 8) finds no amount on the Verification tab, the Extract tab, a run page and Usage. Commit any screenshot changes by explicit path under `docs/testing/screens/` with the trailer. A failure is reported with its output, not retried blindly.
