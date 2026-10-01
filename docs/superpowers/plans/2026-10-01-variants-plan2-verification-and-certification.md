# Variants plan 2 — verification and certification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a website whose project wants variants, the customer confirms each proof product's variants (count and values) and spot-checks one variant. Verify then certifies how variants are read on that website: a list in the page data with paths inside each entry, or a set of variant links. Extract stays locked until that passes.

**Architecture:**
- **Answers:** the customer's variant answers live on the verification set beside the field answers (`VerificationSet.variants`, one per proof page). A dedicated, row-locked save procedure writes them, and the fields' autosave carries them forward.
- **Certification:** two pure-ish scraper modules certify variants with the same rules as fields:
  - `variant-certify.ts`: a list ref plus entry paths; no browser.
  - `variant-collector.ts`: one XPath that yields exactly the confirmed variant links; in-page scripts.
- **Verify:** every Verify run on such a website also runs a free variant check after the fields. Its result is stored on the run in a new `variant_results` column, with a hash of the answers, so currency works like `fieldHash`. `requireCertification` adds the variant gate.
- **The app:** a Variants row in the Verification table. It confirms counts with one tick and expands to the spot-check. For the links method the first variant page is captured and must pass the website's certified fields.
- **Later:** extraction at scale and export are plan 3.

**Tech Stack:**
- Drizzle + Postgres (migration 0013).
- tRPC v11 + zod.
- `@robot/scraper` verify modules, with Playwright `setContentEvaluate` for in-page scripts.
- `@robot/app` (TanStack Start, React Query).
- vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-variants-design.md`. This plan covers §4 (verification and certification) and §8 item 2. It builds on plan 1, `docs/superpowers/plans/2026-10-01-variants-plan1-contract-and-detection.md`, which is merged on `main`. Plan 1 delivered:
- the project's `variant_mode`;
- field levels and axis columns;
- `sources.variant_setup`;
- `detectVariantLists`, `buildVariantLinksScript` and `buildVariantPickerScript`;
- `sources.detectVariants` and `sources.setVariantSetup`;
- the Variants step.

## Global Constraints

- **When variants are required:** a website needs variant certification when its project's `variant_mode` is not `ignore` **and** its `variant_setup.method` is `list` or `links`. With `ignore`, or with method `none`, nothing in this plan applies, and Extract gates exactly as today.
- **Variants turned on, setup missing:** a project with `variant_mode` not `ignore` and a website with `variant_setup` null blocks Extract with "Set up this website's variants before extracting".
- **Certification rules:** the same rules as fields (spec 2026-09-29):
  1. A path the customer accepted goes first.
  2. A yes/no field certifies only on an accepted path or a concept-fitting path (`pathFitsConcept` from `field-fit.ts`).
  3. Values are compared with `valuesEqual`, and validity is checked with `normalize`, both from `normalize.ts`.
- **Entry fields** are the project's variant-level contract fields (`effectiveLevel(f) === 'variant'`) plus every axis column the website's setup maps (`variant_setup.axes`, each `{ from, axisKey }`).
- **"From the product page":** a variant-level field the list does not carry is marked this way by the customer. It needs no entry path; plan 3 fills it from the product page.
- **No AI, no new spend:**
  - The list method costs nothing new.
  - The links method costs one free page capture per proof product, taken when the customer confirms the links, through the existing `sources.captureProofPage`.
  - The Verify label stays "· free" for the variant part.
- **Failure is reported, never guessed.** Exact message templates, with `{n}` the 1-based product number, `{noun}` the plural word and `{field}` the field's name:
  - `found {k} of {count} {noun} on product {n}`
  - `found {k} {noun} on product {n}, expected {count}`
  - `found no {noun} on product {n}`
  - `product {n} lists {k} {noun} — confirm them`
  - `{field} missing on {m} of {count} {noun} on product {n}`
  - `{field} on the checked variant of product {n} isn't in the list — check the value or mark it from the product page`
  - `two {noun} on product {n} read the same: {label}`
  - `{field} is taken from the product page on product {a} but from the list on product {b}`
  - `{field} missing on the {label} page of product {n}`
  - `Take the {label} page's screenshot again`
  - Website level: `None of the products has variants — add one that does, or choose No variants on this website`
- **`{noun}`** is the first mapped axis column's name, lower-cased, with `s` added ("Colour" → "colours", "Size" → "sizes"); with no mapped axis it is `variants`. One function on each side computes it: `variantNoun` in the API, `variantNoun` in the app view.
- **On-screen wording:** "Variants", "No variants on this product", "Check this one", "From the product page", "Not right?", "Mark the colour buttons on the screenshot", "Verify variants · free". Never "axis", "entry path", "list path", "collector", "XPath", "JSON-LD", "hasVariant".
- **Budget rule:** no implementer or test clicks Verify, Sample, Extract or Check while an Anthropic key is present. Live Verify checks run only on a keyless api-server on :4100, after asserting the button reads "· free".
- **Identities:**
  - No implementer signs in as `markodjordjievski@gmail.com`, or writes data for org `default`/`mar` or the projects Acne, Scratch or Competitor prices.
  - Browser checks use throwaway `check-*`/`smoke-*` identities.
  - Back up the dev database before running the migration on it: `docker exec robot-platform-db pg_dump -U postgres robot_platform > <scratchpad>/pre-variants-2.sql`.
- **Dev servers:** never stop, start or restart Marko's dev servers (:4000/:3000/:3456).
- **Commits:**
  - By explicit path, never `git stash`.
  - Messages end with a `Co-Authored-By:` line for the model that wrote them.
- **Test gate per package:** `pnpm --filter <pkg> exec vitest run --maxWorkers=2`, with Postgres (`robot-platform-db`) up. This machine times out Chromium tests at full parallelism.

## Review Focus

1. **The fields' autosave racing a variant answer save.** Expected: the variant answer survives. `updateBinding` re-reads `variants` under a row lock and carries it forward. Test: Task 3.
2. **A proof product is removed or replaced (its URL changes).** Expected: its variant answer is dropped with it, the variant hash changes, and the variants stop being current. Never an orphaned answer still counted. Test: Task 3, plus Task 4 for currency.
3. **Two entries of one product read the same on every axis (duplicate variants in the data).** Expected: certification fails with `two colours on product 1 read the same: Black`. Test: Task 1.
4. **Variants turned on for a website that was already verified.** Expected:
   - With fields current and setup null, Extract is blocked with "Set up this website's variants before extracting".
   - Setting the project back to `ignore` unlocks Extract without re-verifying.

   Test: Task 4.
5. **The links method's checked variant page has a failed screenshot, or one older than 24 hours.** Expected: that product reads `Take the Red page's screenshot again`, never a pass. Test: Task 4.

---

## File map

- **Scraper:**
  - Modify `packages/scraper/src/verify/types.ts`: `VariantAnswer`; `VerificationSet.variants`.
  - Create `packages/scraper/src/verify/variant-certify.ts` and its test: list certification, entry suggestions, `variantHash`.
  - Modify `packages/scraper/src/verify/variant-detect.ts`: export `entryAxisValue`.
  - Create `packages/scraper/src/verify/variant-collector.ts` and its test: link collector certification, links near a marked element.
  - Modify `packages/scraper/src/verify/index.ts`: exports.
- **Database:**
  - Create `packages/db/drizzle/0013_variant_results.sql`, plus the meta snapshot via drizzle-kit.
  - Modify `packages/db/src/schema.ts`: `sourceVerifications.variantResults`.
- **API:**
  - Modify `packages/api/src/verify/binding-input.ts` and `packages/api/src/routers/sources.ts`:
    - `updateBinding` carries `variants` forward under a lock;
    - new `saveVariantAnswer`, `variantList` and `variantLinksNear`;
    - `verify` accepts a variants-only run;
    - `verificationStatus` returns `variants`.
  - Create `packages/api/src/verify/variant-check.ts` and its test: runs the variant check of one Verify run.
  - Modify `packages/api/src/verify/run-source-verification.ts`: calls it and stores `variantResults`.
  - Modify `packages/api/src/verify/current-certification.ts`: `loadVariantCurrency`; `Certification.variants`.
  - Modify `packages/api/src/crawl/require-certification.ts`: the variant gate.
  - Create `packages/api/src/test-helpers/variant-shop.ts`: three product captures with variants, as data and HTML.
  - Tests: create `packages/api/src/routers/sources-variant-answers.test.ts`, `packages/api/src/verify/variant-check.test.ts` and `packages/api/src/crawl/require-certification-variants.test.ts`.
- **App:**
  - Create `packages/app/src/lib/site/variants-row-view.ts` and its test.
  - Modify `packages/app/src/lib/site/verify-button.ts` and its test.
  - Create `packages/app/src/components/verification/variants-row.tsx`.
  - Modify `packages/app/src/components/verification/verification-table.tsx`, `verify-bar.tsx`, and the route `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`.
  - Modify `packages/app/src/routes-smoke.test.ts`.
- **Docs:** `docs/handoff.md`.

---

### Task 1: Scraper — the variant answers and list certification

**Files:**
- Modify: `packages/scraper/src/verify/types.ts`, `packages/scraper/src/verify/variant-detect.ts` (export `entryAxisValue`), `packages/scraper/src/verify/index.ts`.
- Create: `packages/scraper/src/verify/variant-certify.ts`; Test: `packages/scraper/src/verify/variant-certify.test.ts`.

**Interfaces:**
- **Consumes:**
  - `CaptureLike` and `getByDotPath` (as `resolveStructured` in `search-structured.ts` uses it);
  - `normalize` and `valuesEqual` (`normalize.ts`);
  - `pathFitsConcept` (`field-fit.ts`);
  - `CustomerFieldType`;
  - from `variant-detect.ts`, the private `entryAxisValue(entry, axisKey)`, which this task exports.
- **Produces:**

```ts
// types.ts
export type VariantListRef = { source: 'json-ld' | 'api'; path: string };
export type VariantAnswer = {
  count: number;                     // 0 = "No variants on this product"
  labels: string[];                  // one per variant, as confirmed ("Black/Red · 10C", or the link's label)
  list?: VariantListRef;             // list method: the list the customer confirmed
  links?: string[];                  // links method: the confirmed variant hrefs, absolute
  spot?: {
    index: number;                   // list: which entry was checked (0-based); links: 0
    url?: string;                    // links: the variant page captured for the check
    expected: Record<string, string>;// list: entry-field key → value as confirmed
    paths?: Record<string, string>;  // list: entry-field key → the entry path of an accepted suggestion
    fromProduct?: string[];          // list: entry-field keys the list does not carry
  };
};
// VerificationSet gains:  variants?: Record<string /* proof url */, VariantAnswer>;

// variant-certify.ts
export type EntryField = { key: string; name: string; type: CustomerFieldType; concept: string; axisFrom?: string };
export type EntryPath = { kind: 'path'; path: string } | { kind: 'axis'; from: string };
export type VariantPageResult =
  | { status: 'pass'; count: number }
  | { status: 'none' }
  | { status: 'fail'; message: string }
  | { status: 'not_captured' };
export type VariantVerification = {
  method: 'list' | 'links';
  hash: string;
  passed: boolean;
  list?: VariantListRef;
  entryPaths?: Record<string, EntryPath>;
  fromProduct?: string[];
  collector?: string;                // links method (Task 2)
  pages: Record<string, VariantPageResult>;
  problem?: string;                  // website-level failure
};
export function resolveVariantList(capture: CaptureLike, ref: VariantListRef): Record<string, unknown>[] | null;
export function flattenEntry(entry: Record<string, unknown>, maxDepth?: number): Array<{ path: string; raw: unknown }>;
export function readEntryPath(entry: Record<string, unknown>, p: EntryPath): unknown;
export function suggestEntryValues(entry: Record<string, unknown>, fields: EntryField[]): Record<string, { value: string; path: string } | null>;
export function certifyVariantList(input: {
  urls: string[]; captures: Record<string, CaptureLike | null>; answers: Record<string, VariantAnswer>;
  fields: EntryField[]; noun: string;
}): Omit<VariantVerification, 'hash' | 'method'>;
export function variantHash(input: {
  method: 'list' | 'links'; axes: Array<{ from: string; axisKey: string }>; urls: string[];
  answers: Record<string, VariantAnswer>; fields: Array<{ key: string; type: string; concept: string }>;
}): string;
```

**Rules:**
- **`resolveVariantList`:**
  - Scans the same containers detection scans: each JSON-LD block and the members of its `@graph` for `json-ld`; each JSON intercepted body for `api`.
  - Returns the first array found at `ref.path` (dot path, `[n]` indexes) with at least one plain object, keeping only its plain objects.
  - Otherwise `null`.
- **`flattenEntry`:**
  - Returns every scalar leaf, and every object read through `objectUrl`/`displayValue` from `structured-value.ts`, to depth `maxDepth = 4`.
  - Paths are dot paths with `[n]` indexes.
  - Arrays are scanned to their first 10 items.
- **`readEntryPath`:**
  - `{kind:'path'}` → `getByDotPath`.
  - `{kind:'axis', from}` → `entryAxisValue(entry, from)`.
- **`suggestEntryValues`:** per field, the first leaf that fits, or `null`:
  - an axis field → `entryAxisValue`, path `axis:<from>`;
  - else a leaf whose path fits the concept (`pathFitsConcept`) and whose value normalises for the type;
  - else (non-boolean types only) nothing — the customer types it.
  - Its value is the display text.
- **`certifyVariantList`:**
  1. **Pages.** `answered` = each url of `urls` (in order, product n = index + 1).
     - A url without an answer counts as `count: 0`.
     - A url whose capture is `null` → `not_captured`.
  2. **List ref.** Candidates are the distinct `answer.list` of answers with `count > 0`.
     - A candidate *fits* a page when the resolved list length equals the answer's count (count 0: null or empty).
     - Take the first candidate that fits every captured page. Otherwise report the best one (most pages fit) and give each misfitting page its count message.
     - If no answer has `count > 0`, set `problem` (the website-level message) and `passed: false`.
  3. **Duplicates.** For each page with a fitting list, if two entries give the same tuple of axis values (axis fields only), fail that page with `two {noun} on product {n} read the same: {values joined '/'}`.
  4. **Entry fields.** For each entry field:
     - If every page with variants lists it in `spot.fromProduct`, it goes into `fromProduct`.
     - If some do and some don't, fail with the `taken from the product page on product {a} but from the list on product {b}` message, on the first product that does not.
     - Otherwise candidates, in this order:
       1. the `spot.paths[key]` values (an accepted suggestion: `axis:<from>` → kind axis, else kind path);
       2. for an axis field, `{kind:'axis', from: axisFrom}`;
       3. the flattened leaves of each page's spot entry whose value `valuesEqual(type, raw, spot.expected[key])`, concept-fitting leaves first, then shorter paths. A boolean field takes only accepted and concept-fitting candidates.
     - The first candidate wins when, on every page with variants, it reads `spot.expected[key]` on the spot entry and a value that `normalize`s on every other entry.
     - If none wins, fail with:
       - `{field} on the checked variant of product {n} isn't in the list…` when no candidate reads the spot value on product n;
       - else `{field} missing on {m} of {count} {noun} on product {n}` for the best candidate.
  5. **Result.** `pages[url]`:
     - `pass` (with count) or `none` (count 0, confirmed);
     - `fail` takes the first message for that page;
     - `passed` = no fail, no `not_captured`, no `problem`.
- **`variantHash`:** sha256 (as `fieldHash` does) over `{ method, axes sorted by from, answers for the given urls only (keys sorted, deep-sorted), fields sorted by key }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { certifyVariantList, suggestEntryValues, variantHash, resolveVariantList, type EntryField } from './variant-certify.js';
import type { CaptureLike } from './certify.js';
import type { VariantAnswer } from './types.js';

const v = (color: string, sku: string, price: string | null, extra: Record<string, unknown> = {}) => ({
  '@type': 'Product', color, sku, featured: true,
  ...(price === null ? {} : { offers: { '@type': 'Offer', price, availability: 'https://schema.org/InStock' } }), ...extra,
});
const group = (variants: unknown[]) => ({ '@type': 'ProductGroup', name: 'Shoe', variesBy: ['https://schema.org/color'], hasVariant: variants });
const cap = (url: string, ld: unknown[]): CaptureLike => ({
  url, html: '<html><body></body></html>', interceptedRequests: [],
  structuredData: { ldJson: ld as object[], nextData: null, initialState: null, meta: {} },
});
const U = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const FIELDS: EntryField[] = [
  { key: 'price', name: 'Price', type: 'money', concept: 'price' },
  { key: 'sku', name: 'SKU', type: 'text', concept: 'sku' },
  { key: 'in_stock', name: 'In stock', type: 'boolean', concept: 'availability' },
  { key: 'colour', name: 'Colour', type: 'text', concept: 'axis', axisFrom: 'color' },
];
const LIST = { source: 'json-ld' as const, path: 'hasVariant' };
const spot = (expected: Record<string, string>, extra: Partial<NonNullable<VariantAnswer['spot']>> = {}) => ({ index: 0, expected, ...extra });
const captures = () => ({
  [U[0]!]: cap(U[0]!, [group([v('Black', 'A1', '10.00'), v('Red', 'A2', '11.00')])]),
  [U[1]!]: cap(U[1]!, [group([v('Black', 'B1', '20.00'), v('Red', 'B2', '21.00'), v('White', 'B3', '22.00')])]),
  [U[2]!]: cap(U[2]!, [{ '@type': 'Product', name: 'Plain', sku: 'C1', offers: { price: '5.00' } }]),
});
const answers = (): Record<string, VariantAnswer> => ({
  [U[0]!]: { count: 2, labels: ['Black', 'Red'], list: LIST, spot: spot({ price: '10.00', sku: 'A1', in_stock: 'yes', colour: 'Black' }) },
  [U[1]!]: { count: 3, labels: ['Black', 'Red', 'White'], list: LIST, spot: spot({ price: '20.00', sku: 'B1', in_stock: 'yes', colour: 'Black' }) },
  [U[2]!]: { count: 0, labels: [] },
});
const run = (a = answers(), c: Record<string, CaptureLike | null> = captures()) =>
  certifyVariantList({ urls: U, captures: c, answers: a, fields: FIELDS, noun: 'colours' });

describe('certifyVariantList', () => {
  it('certifies the list and an entry path per field; a product without variants reads none', () => {
    const r = run();
    expect(r.passed).toBe(true);
    expect(r.list).toEqual(LIST);
    expect(r.entryPaths).toEqual({
      price: { kind: 'path', path: 'offers.price' }, sku: { kind: 'path', path: 'sku' },
      in_stock: { kind: 'path', path: 'offers.availability' }, colour: { kind: 'axis', from: 'color' },
    });
    expect(r.pages[U[0]!]).toEqual({ status: 'pass', count: 2 });
    expect(r.pages[U[2]!]).toEqual({ status: 'none' });
  });
  it('a yes/no field never certifies on a path that does not mean it (featured: true)', () => {
    expect(run().entryPaths!.in_stock).toEqual({ kind: 'path', path: 'offers.availability' });
  });
  it('reports a count that does not match', () => {
    const a = answers(); a[U[1]!] = { ...a[U[1]!]!, count: 4, labels: ['Black', 'Red', 'White', 'Blue'] };
    const r = run(a);
    expect(r.passed).toBe(false);
    expect(r.pages[U[1]!]).toEqual({ status: 'fail', message: 'found 3 of 4 colours on product 2' });
  });
  it('reports an entry missing a field', () => {
    const c = captures();
    c[U[1]!] = cap(U[1]!, [group([v('Black', 'B1', '20.00'), v('Red', 'B2', null), v('White', 'B3', '22.00')])]);
    expect(run(answers(), c).pages[U[1]!]).toEqual({ status: 'fail', message: 'Price missing on 1 of 3 colours on product 2' });
  });
  it('reports two variants that read the same', () => {
    const c = captures();
    c[U[0]!] = cap(U[0]!, [group([v('Black', 'A1', '10.00'), v('Black', 'A2', '11.00')])]);
    expect(run(answers(), c).pages[U[0]!]).toEqual({ status: 'fail', message: 'two colours on product 1 read the same: Black' });
  });
  it('asks to confirm a list on a product answered as having none', () => {
    const a = answers(); a[U[1]!] = { count: 0, labels: [] };
    expect(run(a).pages[U[1]!]).toEqual({ status: 'fail', message: 'product 2 lists 3 colours — confirm them' });
  });
  it('a field marked from the product page on every product needs no entry path', () => {
    const a = answers();
    for (const u of [U[0]!, U[1]!]) { const s = a[u]!.spot!; delete s.expected.in_stock; s.fromProduct = ['in_stock']; }
    const r = run(a);
    expect(r.passed).toBe(true);
    expect(r.fromProduct).toEqual(['in_stock']);
    expect(r.entryPaths!.in_stock).toBeUndefined();
  });
  it('a website where no product has variants fails as a whole', () => {
    const a: Record<string, VariantAnswer> = { [U[0]!]: { count: 0, labels: [] }, [U[1]!]: { count: 0, labels: [] }, [U[2]!]: { count: 0, labels: [] } };
    const c = { [U[0]!]: cap(U[0]!, []), [U[1]!]: cap(U[1]!, []), [U[2]!]: cap(U[2]!, []) };
    const r = run(a, c);
    expect(r.passed).toBe(false);
    expect(r.problem).toBe('None of the products has variants — add one that does, or choose No variants on this website');
  });
  it('a page without a capture is not_captured and fails the whole', () => {
    const c = captures(); c[U[1]!] = null;
    const r = run(answers(), c);
    expect(r.pages[U[1]!]).toEqual({ status: 'not_captured' });
    expect(r.passed).toBe(false);
  });
});

describe('suggestEntryValues', () => {
  it('suggests by meaning, axis by its key', () => {
    const list = resolveVariantList(captures()[U[0]!]!, LIST)!;
    expect(suggestEntryValues(list[1]!, FIELDS)).toEqual({
      price: { value: '11.00', path: 'offers.price' }, sku: { value: 'A2', path: 'sku' },
      in_stock: { value: 'https://schema.org/InStock', path: 'offers.availability' }, colour: { value: 'Red', path: 'axis:color' },
    });
  });
});

describe('variantHash', () => {
  const base = { method: 'list' as const, axes: [{ from: 'color', axisKey: 'colour' }], urls: U, answers: answers(), fields: FIELDS };
  it('is stable under key order and moves with an answer', () => {
    const reordered = Object.fromEntries(Object.entries(answers()).reverse());
    expect(variantHash({ ...base, answers: reordered })).toBe(variantHash(base));
    const a = answers(); a[U[0]!] = { ...a[U[0]!]!, count: 3 };
    expect(variantHash({ ...base, answers: a })).not.toBe(variantHash(base));
  });
  it('ignores answers for urls no longer in the set', () => {
    const a = { ...answers(), 'https://s.example/p/old': { count: 2, labels: ['x', 'y'] } };
    expect(variantHash({ ...base, answers: a })).toBe(variantHash(base));
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Run `pnpm --filter @robot/scraper exec vitest run src/verify/variant-certify.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** `types.ts` additions, the `entryAxisValue` export and `variant-certify.ts`, following the Rules; then export them from `verify/index.ts`. If `normalize('boolean', 'https://schema.org/InStock')` and `valuesEqual('boolean', …, 'yes')` disagree with the tests, read `normalize.ts` and adjust the fixture's expected text to what the engine already accepts for fields; never change `normalize`.
- [ ] **Step 4: Run them to see them pass**, then the scraper gate: `pnpm --filter @robot/scraper exec vitest run --maxWorkers=2` and `pnpm --filter @robot/scraper exec tsc --noEmit`.
- [ ] **Step 5: Commit** `packages/scraper/src/verify/{types.ts,variant-detect.ts,variant-certify.ts,variant-certify.test.ts,index.ts}` — `feat(scraper): certify a website's variant list and the paths inside each variant`.

---

### Task 2: Scraper — certify variant links, and find links near a marked element

**Files:**
- Create: `packages/scraper/src/verify/variant-collector.ts`; Test: `packages/scraper/src/verify/variant-collector.test.ts`, which runs real Chromium the way `variant-dom.test.ts` does.
- Modify: `packages/scraper/src/verify/index.ts`.

**Interfaces:**
- **Consumes:**
  - `VariantAnswer`, `VariantPageResult` and `VariantVerification` (Task 1);
  - `VariantLinks` (`variant-dom.ts`);
  - `PAGE_SCRIPT_PRELUDE`, and the script-builder style of `dom-scripts.ts`/`variant-dom.ts`.
- **Produces:**

```ts
export type EvalScript = <T>(html: string, script: string) => Promise<T>;   // browser.setContentEvaluate
export function buildCollectorCandidatesScript(hrefs: string[], pageUrl: string): string;  // → string[] XPaths ending in //a/@href
export function buildXPathHrefsScript(xpaths: string[], pageUrl: string): string;          // → string[][] absolute, de-duplicated, per xpath
export function buildLinksNearScript(xpath: string, pageUrl: string): string;              // → VariantLinks | null
export async function certifyVariantLinks(input: {
  urls: string[]; captures: Record<string, CaptureLike | null>; answers: Record<string, VariantAnswer>; noun: string;
}, deps: { evalScript: EvalScript }): Promise<Omit<VariantVerification, 'hash' | 'method'>>;
```

**Rules:**
- **`buildCollectorCandidatesScript`:**
  - Finds the `a[href]` elements whose resolved href (resolved against `pageUrl`) is in `hrefs`, and their lowest common ancestor.
  - Walks the ancestor and up to 3 of its own ancestors, emitting for each, in this order:
    - `//*[@id='ID']//a/@href` when it has an id;
    - `//*[contains(concat(' ', normalize-space(@class), ' '), ' TOKEN ')]//a/@href` for each class token that is not a utility token (`/^(is-|has-|js-|d-|flex|grid|col|row|mt-|mb-|p-|px-|py-)/`);
    - `//*[@aria-label='LABEL']//a/@href` when it has an aria-label.
  - Quote safely: a value containing `'` is skipped.
  - Returns at most 12 candidates, de-duplicated.
- **`buildXPathHrefsScript`:** evaluates each XPath with `ORDERED_NODE_SNAPSHOT_TYPE`; returns the attribute values resolved against `pageUrl`, de-duplicated, in document order.
- **`buildLinksNearScript`:** finds the element at `xpath`. From it, walks up at most 3 ancestors until one holds ≥ 2 distinct same-host `a[href]`. Returns `{ container, count, links: [{href, label}] }`, labelled like `buildVariantLinksScript`, or `null`.
- **`certifyVariantLinks`:**
  1. Product n = index + 1 in `urls`. An unanswered url counts as `count: 0`. A null capture → `not_captured`.
  2. If no answer has `count > 0`, set `problem` as in Task 1.
  3. Gather candidates by running `buildCollectorCandidatesScript(answer.links, url)` on every page with variants. Keep them in first-seen order, de-duplicated.
  4. Evaluate all candidates on every captured page in one `buildXPathHrefsScript` call per page.
  5. A candidate *fits* a page when:
     - its href set equals the answer's `links` set (count > 0);
     - or it is empty (count 0).
  6. The first candidate fitting every captured page is the `collector`. Otherwise, take the best candidate (most pages fit) and fail each misfitting page:
     - fewer links: `found {k} of {count} {noun} on product {n}`;
     - more links: `found {k} {noun} on product {n}, expected {count}`;
     - none: `found no {noun} on product {n}`;
     - a count-0 page with links: `product {n} lists {k} {noun} — confirm them`.
  7. Pages: `pass` / `none` / `fail` / `not_captured` as Task 1; `passed` likewise. The spot-check of a variant page is **not** part of this function (Task 4 adds it).

- [ ] **Step 1: Write the failing tests**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildLinksNearScript, certifyVariantLinks } from './variant-collector.js';
import type { CaptureLike } from './certify.js';
import type { VariantAnswer } from './types.js';

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch(); }, 30_000);
afterAll(async () => { await browser?.close(); }, 30_000);

const page = (swatches: string[]) => `<html><body>
  <nav><a href="/c/shoes">Shoes</a><a href="/c/boots">Boots</a></nav>
  <main class="pdp">${swatches.length ? `<div class="product-swatches" aria-label="Colour">${swatches.map((s) => `<a href="/p/shoe-${s.toLowerCase()}" class="swatch">${s}</a>`).join('')}</div>` : ''}
  <section class="related"><a href="/p/other-1">Other</a><a href="/p/other-2">Other 2</a></section></main></body></html>`;
const U = ['https://s.example/p/shoe-black', 'https://s.example/p/boot-black', 'https://s.example/p/sock'];
const cap = (url: string, html: string): CaptureLike => ({ url, html, interceptedRequests: [], structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} } });
const abs = (xs: string[]) => xs.map((s) => `https://s.example/p/shoe-${s.toLowerCase()}`);
const evalScript = <T,>(html: string, script: string) => browser.setContentEvaluate<T>(html, script);

describe('certifyVariantLinks', () => {
  const captures = () => ({ [U[0]!]: cap(U[0]!, page(['Black', 'Red'])), [U[1]!]: cap(U[1]!, page(['Black', 'Red', 'White'])), [U[2]!]: cap(U[2]!, page([])) });
  const answers = (): Record<string, VariantAnswer> => ({
    [U[0]!]: { count: 2, labels: ['Black', 'Red'], links: abs(['Black', 'Red']) },
    [U[1]!]: { count: 3, labels: ['Black', 'Red', 'White'], links: abs(['Black', 'Red', 'White']) },
    [U[2]!]: { count: 0, labels: [] },
  });
  it('certifies one collector over the swatches, not the navigation or related products', async () => {
    const r = await certifyVariantLinks({ urls: U, captures: captures(), answers: answers(), noun: 'colours' }, { evalScript });
    expect(r.passed).toBe(true);
    expect(r.collector).toBe("//*[contains(concat(' ', normalize-space(@class), ' '), ' product-swatches ')]//a/@href");
    expect(r.pages[U[2]!]).toEqual({ status: 'none' });
  });
  it('reports a product whose links do not match', async () => {
    const a = answers(); a[U[1]!] = { count: 4, labels: ['Black', 'Red', 'White', 'Blue'], links: abs(['Black', 'Red', 'White', 'Blue']) };
    const r = await certifyVariantLinks({ urls: U, captures: captures(), answers: a, noun: 'colours' }, { evalScript });
    expect(r.passed).toBe(false);
    expect(r.pages[U[1]!]).toEqual({ status: 'fail', message: 'found 3 of 4 colours on product 2' });
  });
});

describe('buildLinksNearScript', () => {
  it('finds the swatch links from a click on one swatch', async () => {
    const got = await browser.setContentEvaluate<{ count: number; links: Array<{ label: string }> } | null>(
      page(['Black', 'Red']), buildLinksNearScript("//a[text()='Red']", U[0]!));
    expect(got?.count).toBe(2);
    expect(got?.links.map((l) => l.label)).toEqual(['Black', 'Red']);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Run `pnpm --filter @robot/scraper exec vitest run src/verify/variant-collector.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** following the Rules and the style of `variant-dom.ts`: in-page helpers stringified into the script, `pageUrl` passed through `JSON.stringify`, and every href resolved with `new URL(href, pageUrl)`. Then export from `verify/index.ts`.
- [ ] **Step 4: Run them to see them pass**, then the scraper gate and `tsc --noEmit`.
- [ ] **Step 5: Commit** `packages/scraper/src/verify/{variant-collector.ts,variant-collector.test.ts,index.ts}` — `feat(scraper): certify a website's variant links and find links near a marked element`.

---

### Task 3: Storage and the API for variant answers

**Files:**
- Modify: `packages/db/src/schema.ts`. Create: `packages/db/drizzle/0013_variant_results.sql` (generate it with drizzle-kit exactly as 0012 was; read `packages/db/package.json` scripts first), adding `source_verifications.variant_results jsonb` (nullable).
- Modify: `packages/api/src/verify/binding-input.ts` (`prepareBinding` leaves `variants` alone), `packages/api/src/routers/sources.ts`.
- Create: `packages/api/src/test-helpers/variant-shop.ts`; Test: `packages/api/src/routers/sources-variant-answers.test.ts`.

**Interfaces:**
- **Consumes:**
  - `VariantAnswer`, `resolveVariantList`, `suggestEntryValues`, `EntryField` (Task 1);
  - `buildLinksNearScript`, `VariantLinks` (Task 2, plan 1);
  - `contractFields`, `contractAxes`, `effectiveLevel` (`contract.ts`);
  - `loadProofPageCaptures`, `withBrowserSession`, `sourceInOrg` (as `detectVariants` uses them).
- **Produces:**

```ts
sourceVerifications.variantResults: jsonb('variant_results')   // VariantVerification | null
// API helper (sources.ts or a small module beside it — both Task 4 and this task use it):
export function entryFieldsFor(datasetSchema: unknown, setup: VariantSetup | null): EntryField[];
export function variantNoun(datasetSchema: unknown, setup: VariantSetup | null): string;
sources.saveVariantAnswer({ sourceId, url, answer: VariantAnswer | null }) → { variants: Record<string, VariantAnswer> }
sources.variantList({ sourceId, url, list: { source: 'json-ld' | 'api'; path: string } }) → {
  count: number;
  labels: string[];                                  // per entry: its axis values joined '/', in setup.axes order; else its sku; else 'Variant {i}'
  suggestions: Array<Record<string, { value: string; path: string } | null>>;   // per entry (≤ 50), per entry field
} | null                                             // null: the page has no capture or the list is not there
sources.variantLinksNear({ sourceId, url, xpath }) → VariantLinks | null
// VariantAnswer is accepted by zod as:
const variantAnswerInput = z.object({
  count: z.number().int().min(0).max(500),
  labels: z.array(z.string().max(200)).max(500),
  list: z.object({ source: z.enum(['json-ld', 'api']), path: z.string().min(1).max(300) }).optional(),
  links: z.array(z.string().url()).max(500).optional(),
  spot: z.object({
    index: z.number().int().min(0),
    url: z.string().url().optional(),
    expected: z.record(z.string(), z.string().max(2000)),
    paths: z.record(z.string(), z.string().max(300)).optional(),
    fromProduct: z.array(z.string()).optional(),
  }).optional(),
});
```

**Rules:**
- **`entryFieldsFor`:**
  - Returns `contractFields(schema)` with `effectiveLevel === 'variant'`, as `{ key, name, type, concept }`.
  - Then, for each `setup.axes` entry whose `axisKey` is an existing axis: `{ key: axisKey, name: axis.name, type: 'text', concept: 'axis', axisFrom: from }`.
- **`variantNoun`:** the first mapped axis's name, lower-cased, plus `s`; else `variants`.
- **`saveVariantAnswer`:**
  - Checks `sourceInOrg`.
  - In one transaction: `SELECT … FOR UPDATE` the source row, require `url ∈ verificationSet.urls` (else `BAD_REQUEST` "That page is not one of this website's products"), then set or delete `verificationSet.variants[url]` and write it.
  - Returns the new map.
- **`updateBinding`:**
  - Inside its existing transaction, before the `update`, re-reads the source row `FOR UPDATE`.
  - Carries `variants` forward from that fresh read, keeping only urls in the new `urls`.
  - `prepareBinding` never emits `variants`.
- **`variantList`:**
  - Loads the proof capture of `url` (fresh only, like `detectVariants`).
  - Calls `resolveVariantList` and `suggestEntryValues(entry, entryFieldsFor(...))` for each of the first 50 entries.
  - Builds `labels` from the suggestions' axis values. No browser.
- **`variantLinksNear`:**
  - Loads the proof capture of `url` and runs `buildLinksNearScript(xpath, url)` in one `withBrowserSession`.
  - Returns `null` when there is no capture.

- [ ] **Step 1: Write the fixture** `packages/api/src/test-helpers/variant-shop.ts`. Export `VARIANT_SHOP: Record<'p1' | 'p2' | 'p3', PageCapture>`, built the way `shop-example.ts` builds its pages:
  - **p1:** a `ProductGroup` with `hasVariant` holding 2 colours (Black/Red; `sku`, `color`, `offers.price`, `offers.availability`). The HTML has a `div.product-swatches` with 2 links.
  - **p2:** the same shape with 3 colours.
  - **p3:** a plain `Product`, with no swatches.
  - **Also export** `VARIANT_SHOP_URLS = ['https://variants.example/p/1', 'https://variants.example/p/2', 'https://variants.example/p/3']`, with swatch hrefs under the same host.

- [ ] **Step 2: Write the failing tests** in `sources-variant-answers.test.ts`. Seed proof pages the way `sources-marks.test.ts` does: mock `proof-page-capture.js`'s runner, insert `captures` rows and write sidecars, all from `VARIANT_SHOP`. Create the project with `createProjectWithSource`, then set the variant mode and setup through `datasets.setVariantMode` and `sources.setVariantSetup` (method `list`, axes `[{ from: 'color', newAxisName: 'Colour' }]`).

```ts
it('saves an answer for a proof page and returns the map', async () => {
  const r = await caller.sources.saveVariantAnswer({ sourceId, url: URLS[0], answer: { count: 2, labels: ['Black', 'Red'], list: { source: 'json-ld', path: 'hasVariant' } } });
  expect(r.variants[URLS[0]].count).toBe(2);
});
it('refuses a page that is not one of the products', async () => {
  await expect(caller.sources.saveVariantAnswer({ sourceId, url: 'https://variants.example/p/9', answer: null }))
    .rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
it('the fields autosave never drops a variant answer, even when they race', async () => {
  const binding = await currentBindingInput(caller, sourceId);   // read the source and rebuild the updateBinding input the app sends
  await Promise.all([
    caller.sources.updateBinding({ sourceId, ...binding }),
    caller.sources.saveVariantAnswer({ sourceId, url: URLS[1], answer: { count: 3, labels: ['Black', 'Red', 'White'] } }),
  ]);
  const s = await caller.sources.get({ id: sourceId });
  expect((s.verificationSet as { variants: Record<string, unknown> }).variants[URLS[1]]).toBeTruthy();
});
it('replacing a product drops its variant answer', async () => {
  await caller.sources.saveVariantAnswer({ sourceId, url: URLS[2], answer: { count: 0, labels: [] } });
  const binding = await currentBindingInput(caller, sourceId);
  await caller.sources.updateBinding({ sourceId, ...binding, urls: [URLS[0], URLS[1], 'https://variants.example/p/4'] });
  const s = await caller.sources.get({ id: sourceId });
  expect(Object.keys((s.verificationSet as { variants?: Record<string, unknown> }).variants ?? {})).not.toContain(URLS[2]);
});
it('lists a product\'s variants with a suggestion per variant field', async () => {
  const r = await caller.sources.variantList({ sourceId, url: URLS[1], list: { source: 'json-ld', path: 'hasVariant' } });
  expect(r!.count).toBe(3);
  expect(r!.labels).toEqual(['Black', 'Red', 'White']);
  expect(r!.suggestions[0]!.price).toEqual({ value: expect.any(String), path: 'offers.price' });
});
it('finds the links near a marked swatch', async () => {
  const r = await caller.sources.variantLinksNear({ sourceId, url: URLS[0], xpath: "//div[contains(@class,'product-swatches')]/a[2]" });
  expect(r!.count).toBe(2);
});
it('another org gets NOT_FOUND from all three', async () => { /* other caller → NOT_FOUND for saveVariantAnswer, variantList, variantLinksNear */ });
```

  Write `currentBindingInput` as a local helper. It reads `sources.get` and maps `schemaDefinition`/`verificationSet` back to `BindingInput` (`urls`, `listingUrl`, `descriptions`, `expected`, `marks`, `paths`, `cards`, `draft: true`), the way the app's `toBindingInput` does.
- [ ] **Step 3: Run them to see them fail.** Run `pnpm --filter @robot/api exec vitest run --maxWorkers=2 src/routers/sources-variant-answers.test.ts`.
- [ ] **Step 4: Implement:**
  - Back up the dev DB (Global Constraints), generate and apply migration 0013 (`pnpm db:migrate`), then add the schema column.
  - Implement the helpers, the procedures and the `updateBinding` carry-forward.
- [ ] **Step 5: Run them to see them pass**, then the api gate (`--maxWorkers=2`) and `tsc --noEmit`.
- [ ] **Step 6: Commit** the schema, the migration and its meta, `binding-input.ts`, `sources.ts`, the helper module (if separate), `variant-shop.ts` and the test: `feat(api): save a website's variant answers, list a product's variants, find links near a mark`.

---

### Task 4: The variant check in Verify, its currency, and the Extract gate

**Files:**
- Create: `packages/api/src/verify/variant-check.ts`; Test: `packages/api/src/verify/variant-check.test.ts`.
- Modify: `packages/api/src/verify/run-source-verification.ts`, `packages/api/src/verify/current-certification.ts`, `packages/api/src/crawl/require-certification.ts`, `packages/api/src/routers/sources.ts` (`verify`, `verificationStatus`).
- Test: `packages/api/src/crawl/require-certification-variants.test.ts`.

**Interfaces:**
- **Consumes:**
  - `certifyVariantList`, `variantHash`, `VariantVerification`, `VariantPageResult` (Task 1);
  - `certifyVariantLinks` (Task 2);
  - `entryFieldsFor`, `variantNoun`, `sourceVerifications.variantResults` and `VARIANT_SHOP` (Task 3);
  - `runVerifiedExtraction`, `VerifiedField` (`verified-extraction.ts`);
  - `normalize`;
  - `loadProofPageCaptures`.
- **Produces:**

```ts
// variant-check.ts
export function variantsRequired(mode: string | null | undefined, setup: VariantSetup | null): 'no' | 'setup-missing' | 'yes';
export function currentVariantHash(args: { set: VerificationSet; setup: VariantSetup; datasetSchema: unknown }): string;
export async function runVariantCheck(args: {
  sourceId: string; set: VerificationSet; setup: VariantSetup; datasetSchema: unknown;
  fields: SchemaDefinitionField[]; results: Record<string, FieldVerification>;     // this run's field results
}, deps: { browser: IBrowser }): Promise<VariantVerification>;
// current-certification.ts
export async function loadVariantCurrency(db: Database, sourceId: string): Promise<{
  required: 'no' | 'setup-missing' | 'yes'; current: boolean; passed: boolean; result: VariantVerification | null;
}>;
// Certification gains:  variants?: VariantVerification   (present when required === 'yes')
// verificationStatus gains:
variants: null | { required: 'setup-missing' | 'yes'; current: boolean; passed: boolean; result: VariantVerification | null }
```

**Rules:**
- **`variantsRequired`:**
  - mode `ignore`/missing → `no`;
  - setup null → `setup-missing`;
  - method `none` → `no`;
  - else `yes`.
- **`runVariantCheck`:**
  - **list:** `certifyVariantList` with `entryFieldsFor` and `variantNoun`, over the proof pages' captures (the run's own captures, or `loadProofPageCaptures`).
  - **links:** `certifyVariantLinks` (through `browser.setContentEvaluate`), then the spot-check:
    1. For each page with variants and a `spot.url`, load that capture with `loadProofPageCaptures(sourceId, [spot.url])`. Fresh only, so a failed or older-than-24h capture is absent. If absent, the page fails with `Take the {label} page's screenshot again`, where `{label}` is the answer's label for that link.
    2. If present, run `runVerifiedExtraction({ url: spot.url, fields }, { browser, capture })`, with `fields` built from this run's `results[key].certified` for every field that has certified paths.
    3. Any field whose value does not `normalize` for its type fails the page with `{field} missing on the {label} page of product {n}`.
    4. If any field has no certified path this run, every page with variants fails with "Verify every field first".
  - **Result:** `hash = currentVariantHash(...)`, `method = setup.method`, and `passed` re-derived after the spot-checks.
- **`currentVariantHash`:** `variantHash({ method, axes: setup.axes, urls: set.urls, answers: set.variants ?? {}, fields: entryFieldsFor(...) })`.
- **`runSourceVerification`:**
  - Loads the dataset's `variantMode` and `schema` and the source's `variantSetup` alongside what it loads today.
  - When `variantsRequired === 'yes'`, after `runVerification` (inside the same or a second `withBrowserSession`), it calls `runVariantCheck` and writes `variantResults` in the same `update` as `results`; otherwise it writes `variantResults: null`.
  - It does **not** touch `allPassed` (fields only). A throw inside the variant check becomes a variant result with `passed: false`, `problem: 'The variant check failed — try Verify again'`, `pages: {}`, and is logged. It never fails the field run.
- **`verify`:**
  - Accepts `onlyKeys: []` (a variants-only run): nothing is re-run for fields. Confirm by reading `runVerification` that every field is then copied from `previous`. If a field without a `previous` result would be re-run, keep that behaviour; it is correct.
  - Also, when `variantsRequired === 'yes'`, rejects with `PRECONDITION_FAILED` "Confirm the variants of every product first" when any `set.urls` entry has no answer in `set.variants`. A product without variants is answered with `{ count: 0, labels: [] }` by its one tick (Task 6), so this never asks for the impossible.
- **`loadVariantCurrency`:**
  - Reads the dataset mode and the setup.
  - Reads the same latest clean row `loadFieldCurrency` uses.
  - `current` = that row's `variantResults?.hash === currentVariantHash(...)`; `passed` = `current && variantResults.passed`.
- **`loadCurrentCertification`:** unchanged for fields. It attaches `variants` when required is `yes` and the variants are current and passed.
- **`requireCertification`:** after the field certification:
  - `setup-missing` → `PRECONDITION_FAILED` "Set up this website's variants before extracting".
  - `yes` and not (current and passed) → `PRECONDITION_FAILED` "Verify the variants before extracting".
  - `no` → as today.
- **`verificationStatus`:** returns `variants: null` when required is `no`, else `{ required, current, passed, result }`.

- [ ] **Step 1: Write the failing tests.**

`variant-check.test.ts` seeds `VARIANT_SHOP` proof pages as in Task 3, with real Chromium for the links method:

```ts
it('list: certifies on the seeded shop and fails product 2 when its count is wrong', async () => { /* answers for p1 (2), p2 (3), p3 (0) with spots → passed; p2 count 4 → pages[p2] = 'found 3 of 4 colours on product 2' */ });
it('links: certifies the swatch collector and spot-checks the first variant page against the certified fields', async () => {
  /* seed a 4th capture for the spot url (VARIANT_SHOP.p1 html/structuredData at url 'https://variants.example/p/1-red');
     results = { title: { certified: [{ source: 'json-ld', path: 'name', transform: 'identity' }], ... }, price: {...} } → passed */
});
it('links: a missing spot capture asks for the screenshot again', async () => { /* no spot capture → pages[p1] = "Take the Red page's screenshot again" */ });
it('links: a field without a certified path fails every product with variants', async () => { /* → 'Verify every field first' */ });
it('the hash moves when an answer changes and ignores answers for removed pages', () => { /* currentVariantHash */ });
```

`require-certification-variants.test.ts`: insert `sourceVerifications` rows directly, with `results` holding passing `FieldVerification`s whose `fieldHash` matches (copy the `hashOf` helper from `sources-verify.test.ts`), and with `variantResults` as needed:

```ts
it('ignore mode: certification as today', async () => { /* mode ignore → cert, no variants */ });
it('variants on, website not set up: Extract is blocked with the setup message', async () => {
  await expect(requireCertification(db, sourceId)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: "Set up this website's variants before extracting" });
});
it('method none: certification as today', async () => { /* setVariantSetup none → cert */ });
it('list, variants not verified: blocked with the variants message', async () => { /* → 'Verify the variants before extracting' */ });
it('list, variants verified and current: cert carries variants', async () => { /* variantResults { hash: currentVariantHash(...), passed: true } → cert.variants.passed */ });
it('an answer changed after the run: no longer current', async () => { /* saveVariantAnswer → blocked again */ });
it('setting the project back to ignore unlocks without a new run', async () => { /* setVariantMode ignore → cert */ });
```

Add to the existing `sources-verify.test.ts` (it mocks `runSourceVerification`):
- `verify({ onlyKeys: [] })` starts a run;
- `verify` refuses with "Confirm the variants of every product first" when a proof page has no answer and variants are required.

- [ ] **Step 2: Run them to see them fail.** Run `pnpm --filter @robot/api exec vitest run --maxWorkers=2 src/verify/variant-check.test.ts src/crawl/require-certification-variants.test.ts src/routers/sources-verify.test.ts`.
- [ ] **Step 3: Implement** following the Rules.
- [ ] **Step 4: Run them to see them pass**, then the api gate (`--maxWorkers=2`) and `tsc --noEmit`.
- [ ] **Step 5: Commit** `variant-check.ts`, its test, `run-source-verification.ts`, `current-certification.ts`, `require-certification.ts`, the new test, `sources.ts` and `sources-verify.test.ts`: `feat(api): check variants in every Verify run and keep Extract locked until they pass`.

---

### Task 5: App — the Variants row's view logic and the Verify bar

**Files:**
- Create: `packages/app/src/lib/site/variants-row-view.ts`; Test: `packages/app/src/lib/site/variants-row-view.test.ts`.
- Modify: `packages/app/src/lib/site/verify-button.ts` (and its test).

**Interfaces:**
- **Consumes:**
  - `DetectResult`, `VariantSetup` (`variants-view.ts`);
  - `verificationStatus.variants` and `sources.variantList` output shapes (Tasks 3–4).
  - Re-declare the types locally: the app never imports scraper code. `tsc` on the route keeps them in sync, as `variants-view.ts` already does.
- **Produces:**

```ts
export type VariantAnswer = { count: number; labels: string[]; list?: { source: string; path: string }; links?: string[];
  spot?: { index: number; url?: string; expected: Record<string, string>; paths?: Record<string, string>; fromProduct?: string[] } };
export type VariantResultView = { passed: boolean; problem?: string; pages: Record<string, { status: 'pass'; count: number } | { status: 'none' } | { status: 'fail'; message: string } | { status: 'not_captured' }> };
export type VariantCell =
  | { kind: 'waiting'; text: string }                       // "Waiting for the screenshot"
  | { kind: 'found'; text: string; labels: string[] }       // orange — found, not confirmed: "4 colours"
  | { kind: 'none-found'; text: string }                    // grey — nothing found, nothing to do: "No variants"
  | { kind: 'confirmed'; text: string; labels: string[] }   // green
  | { kind: 'confirmed-none'; text: string }                // green — "No variants on this product"
  | { kind: 'failed'; text: string };                       // red — the page's message, after Verify
export function variantNoun(axisNames: string[]): string;                 // same rule as the API
export function variantCells(args: {
  method: 'list' | 'links'; urls: string[]; detection: DetectResult | null; answers: Record<string, VariantAnswer>;
  result: VariantResultView | null; resultCurrent: boolean; noun: string;
}): Record<string, VariantCell>;
export function confirmAnswer(method: 'list' | 'links', page: DetectResult['pages'][number], current: VariantAnswer | undefined): VariantAnswer;   // the one-tick confirm
export type SpotRow = { key: string; name: string; state: 'suggested' | 'confirmed' | 'from-product' | 'needs-you'; value?: string; suggestion?: { value: string; path: string } };
export function spotRows(args: {
  fields: Array<{ key: string; name: string }>;            // entry fields, in contract order then axes
  suggestions: Record<string, { value: string; path: string } | null> | null;
  answer: VariantAnswer | undefined;
}): SpotRow[];
export function variantsNeed(args: {
  variants: { required: 'setup-missing' | 'yes'; current: boolean; passed: boolean } | null;
  urls: string[]; answers: Record<string, VariantAnswer>; method: 'list' | 'links' | null;
  entryFieldKeys: string[];
}): { kind: 'none' } | { kind: 'blocked'; reason: string } | { kind: 'pending' } | { kind: 'done' };
```

**Rules:**
- **`variantCells`**, per url:
  1. A current result with that page's `fail` → `failed`, with its message.
  2. An answer → `confirmed` (text `{count} {noun}`), or `confirmed-none`.
  3. Otherwise, the detection page:
     - not captured → `waiting`;
     - for `list`: the first list's count; for `links`: the first link group's count;
     - a count > 0 → `found`;
     - else `none-found`.
- **`confirmAnswer`:**
  - list: `{ count, labels, list: { source, path } }` from the page's first list, with labels from the entries' axis values joined `/`, or its sku.
  - links: `{ count, labels, links, spot: { index: 0, url, expected: {} } }`, where `url` is the first link whose href is not the page's own url.
  - A page with nothing found → `{ count: 0, labels: [] }`.
  - It keeps an existing `spot` when the count and list are unchanged.
- **`spotRows`**, per entry field:
  - `from-product` when listed in `fromProduct`;
  - `confirmed` when `expected[key]` is set;
  - `suggested` when there is a suggestion;
  - else `needs-you`.
- **`variantsNeed`**, in this order:
  1. `null` → `none`.
  2. `setup-missing` → `blocked`, "Set up this website's variants below".
  3. A url without an answer → `blocked`, "Confirm the variants of every product".
  4. For `list`: a confirmed product with `count > 0` and an entry field neither confirmed nor from-product → `blocked`, "Check one variant of product {n}".
  5. Not current → `pending`.
  6. Current → `done`.
- **`verifyButton`:** gains `variants: ReturnType<typeof variantsNeed>`.
  - With no field to (re)verify and `variants.kind === 'pending'`: the label is `Verify variants · free`, enabled.
  - With fields to verify and variants pending: the label gains ` and variants`, e.g. `Re-verify 2 fields and variants · free`.
  - `blocked` disables the button with that reason, unless a field run is possible (then fields verify and the reason shows beside it).
- **Extract `enabled`:** fields current and all passed, **and** `variants.kind` is `none` or (`done` and passed). Export `extractEnabled(status)` from `variants-row-view.ts` for the route.

- [ ] **Step 1: Write the failing tests:**
  - **`variantCells`:** each kind (waiting, found, none-found, confirmed, confirmed-none, failed); a stale (non-current) failure shows the answer, not the failure.
  - **`confirmAnswer`:**
    - list labels from colours;
    - links: picks the first link that is not the page itself;
    - keeps the spot when unchanged.
  - **`spotRows`:** the four states.
  - **`variantsNeed`:** each kind, including "Check one variant of product 2".
  - **`verifyButton`:** `Verify variants · free` with no fields pending; `Re-verify 2 fields and variants · free`; blocked reasons.
  - **`extractEnabled`:** stays locked until the variants are done and passed; unlocked in `ignore` mode (`variants: null`).
  - **`variantNoun`:** `['Colour'] → 'colours'`, `[] → 'variants'`.
- [ ] **Step 2: Run them to see them fail.** Run `pnpm --filter @robot/app exec vitest run --maxWorkers=2 src/lib/site/variants-row-view.test.ts src/lib/site/verify-button.test.ts`.
- [ ] **Step 3: Implement.** **Step 4: Run them to see them pass**, plus `pnpm --filter @robot/app exec tsc --noEmit`.
- [ ] **Step 5: Commit** both views and their tests: `feat(app): the Variants row's states and a Verify bar that knows about variants`.

---

### Task 6: App — the Variants row on the Verification tab, smoke and handoff

**Files:**
- Create: `packages/app/src/components/verification/variants-row.tsx`.
- Modify: `verification-table.tsx` (render the row after the fields when `variantsNeed` is not `none` and the method is `list` or `links`), `verify-bar.tsx`, the route `sites/$site/index.tsx`, `packages/app/src/routes-smoke.test.ts`, `docs/handoff.md`.

**Interfaces:**
- **Consumes:**
  - from Task 5: `variantCells`, `confirmAnswer`, `spotRows`, `variantsNeed`, `extractEnabled`, `variantNoun`;
  - from Task 3: `sources.saveVariantAnswer`, `sources.variantList`, `sources.variantLinksNear`;
  - `sources.captureProofPage` (existing);
  - `sources.detectVariants` (plan 1; already fetched by `variants-step.tsx` — share its query key, don't fetch twice);
  - from Task 4: `verificationStatus.variants`;
  - the existing `PageViewer` mark mode.

**Behaviour:**
- **The row:**
  - **Label column:** "Variants", with a chevron like a field row's.
  - **Per product:** a cell styled like the field cells — orange for `found`, green for confirmed, grey for `none-found`, red for `failed`.
  - **Tick:** a `found` cell has a ✓ (`aria-label="Confirm the variants of product {n}"`), which saves `confirmAnswer(...)`. For links it also starts `captureProofPage` for the spot url.
  - **No variants found:** a `none-found` cell has a ✓ that saves `{ count: 0, labels: [] }` ("No variants on this product").
- **Expanded, per product column:**
  - **The confirmed labels:** the first 8, then "and {k} more".
  - **"Not right?":**
    - **list:** offers the page's other detected lists (by count) and "No variants on this product".
    - **links:** offers "Mark the colour buttons on the screenshot" (using `{noun}`). This opens the product's screenshot in mark mode; the click's xpath goes to `variantLinksNear`; the result is shown and confirmed with ✓, saving `{ count, labels, links, spot }`.
  - **Spot-check, list method:** one sub-row per entry field (`spotRows`), using `variantList` for the chosen variant (default index 0; "Check this one" on another label switches it).
    - A suggested value has a ✓ that saves it, with its path into `spot.expected` / `spot.paths`.
    - A text input lets the customer type a value.
    - "From the product page" moves the key into `fromProduct`.
    - Each change saves through `saveVariantAnswer`, debounced like the fields' autosave (300 ms), with the latest answer winning.
  - **Spot-check, links method:** "Checking the {label} page" with that capture's state (capturing / ready / failed with "Try again", which re-runs `captureProofPage`). After Verify, the page's result line shows.
- **Verify bar:**
  - Uses `verifyButton` with `variants: variantsNeed(...)`.
  - "Go to Extract" uses `extractEnabled`.
  - A variants-only Verify calls `sources.verify({ sourceId, onlyKeys: [] })`.
- **Invalidation:** after every `saveVariantAnswer`, invalidate `sources.get` and `sources.verificationStatus`.
- **Never shown in `ignore` mode.** Never blocks field work.

- [ ] **Step 1: Components and wiring**, matching the existing table cells and the dark/light tokens exactly. `tsc --noEmit`; `pnpm --filter @robot/app exec vitest run --maxWorkers=2`.
- [ ] **Step 2: Smoke** (with Marko's `pnpm dev:all` already running — never start or restart it). Extend `routes-smoke.test.ts`:
  1. In the throwaway project, turn variants on.
  2. Use the smoke's local shop: its products get `hasVariant` JSON-LD with 2 and 3 colours, and product 3 none. Confirm "Listed in the page data" with a new Colour column.
  3. See the Variants row: "2 colours" and "3 colours" orange, product 3 "No variants".
  4. Tick both, and tick "No variants on this product" on product 3.
  5. Expand, accept the suggested Price, SKU and Colour of the first variant on each, and mark In stock "From the product page".
  6. See the Verify button read `… and variants …` and **do not click it**.
  7. Screenshot `app-site-verification-variants-row-{light,dark}.png`.
  8. Restore any screenshot not meant to change.
- [ ] **Step 3: Live, free (optional, controller-run):** on a keyless api-server on :4100 (memory: free live checks), with the same throwaway project, assert the button reads "· free", click Verify, and see the row turn green and "Go to Extract" unlock. Record the result in the handoff.
- [ ] **Step 4: Docs.** Add a `docs/handoff.md` section, "Variants plan 2 (2026-10-0x)", covering what landed, how to check it, and what plan 3 adds, and update its "Read this first" line.
- [ ] **Step 5: Commit** by explicit paths: `feat(app): confirm and spot-check variants on the Verification tab`; docs as a second commit.

---

## Self-review notes (for the executor)

- **Spec coverage:**
  - §4.1 count confirm and spot-check (Tasks 5–6), and "mark the variant control … searched again near it" (`variantLinksNear`, Tasks 3 and 6).
  - For the list method, the re-search is "pick another list the page carries" or "No variants on this product". Marking a screenshot cannot reveal page data that detection did not already read.
  - §4.2 list and entry paths (Task 1), link collector (Task 2), the links spot-check through the certified fields (Task 4), failure reporting (all templates in Global Constraints), no AI and free (Tasks 3–4), Extract gating (Task 4).
- **Out of scope here:** variant rows at scale, `variant_key`, budget and export (plan 3); collecting picker-only variants (spec §6).
- **Ruled for this plan:** a structured link collector (e.g. JSON-LD `hasVariant[].url`) is not built. A site that lists its variants with URLs in the data is a `list`-method site, and plan 3 reads each entry's `url`.
