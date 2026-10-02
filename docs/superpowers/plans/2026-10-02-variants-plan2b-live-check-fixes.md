# Variants plan 2b — fixes from the live check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Variants verify honestly on real shops. Stub entries are not variants. A list certifies only when values are actually read from it. The real SKU is suggested, not a barcode. Help, breadcrumb and customise links are never variant links. The step and the row word things plainly.

**Architecture:**
- **Detection and certification** (`@robot/scraper`, `variant-detect.ts`, `variant-certify.ts`, `variant-dom.ts`, `variant-collector.ts`) share two new rules:
  - `isVariantEntry`: an entry with nothing but a link is not a variant.
  - `isLikelyVariantHref`: a variant link lives under the product page's own path shape.
- **Certification** refuses a list result that reads nothing from the list.
- **The API** refuses an answer that marks a column "From the product page".
- **The app** hides that choice for columns and fixes three wordings.
- **No schema or migration change.**

**Tech Stack:** TypeScript, vitest, Playwright `setContentEvaluate` for the in-page scripts, tRPC + zod, React.

**Spec:** `docs/superpowers/specs/2026-10-01-variants-design.md` (§3 detection, §4 verification). This plan answers the defects in `docs/testing/results/2026-10-02-variants-live-check.md`: defects 1–8. Defect 5 is answered by the path-shape rule, see Task 3.

## Global Constraints

- **A variant entry** (list method) carries at least one of the following besides `@type`, `@id`, `url`, `name`, `image`, `description`:
  - an axis value (a `VARIANT_AXIS_KEYS` key, or an `options`/`selectedOptions` array);
  - a `sku`, `mpn`, `gtin*` or `productID`;
  - a `price`;
  - an `offers` object or array.

  Everything else is a stub. Stubs are dropped by detection, by `resolveVariantList`, by suggestions and by certification alike. A list with fewer than 2 variant entries is not a list.
- **Columns come from the list.** An axis column can never be "From the product page".
- **A certified list reads something:** at least one entry field with an entry path.
- **New exact message templates** (`{field}` = the field's name):
  - `{field} differs per variant — it must come from the list` (certification, and the API's BAD_REQUEST).
  - `Nothing is read from the variants — check at least one value of the checked variant` (certification `problem`).
- **Suggestion order follows the concept's vocabulary order** in `CONCEPT_PATHS` (`field-fit.ts`). For `sku` that is `sku` before `productID`, `mpn` and `gtin`. Among concept-fitting leaves, the one whose last path segment comes earliest in that list wins; ties go to the shorter path.
- **A variant link's path shape:**
  - When the product page's path has two or more segments, a variant link's first path segment must equal the page's (`/t/…` stays `/t/…`; `/u/…` and `/help/…` are dropped).
  - When the page's path has a single segment, any same-host link qualifies.
  - The rule applies to detection, to marked re-search, to the collector's certification, and to `buildXPathHrefsScript`'s output (which plan 3 uses at scale).
- **On-screen wording:**
  - **The row's noun:** the single mapped column's plural ("colours"); with two or more mapped columns, or none, it is `variants`. The API's `variantNoun` and the app's `variantNoun` follow the same rule.
  - **Picker-only line:** shows only known variant words, in plain plurals. Known words are: colours, sizes, lengths, widths, heights, materials, patterns, styles, capacities, flavours, scents, finishes. Any other picker word is left out. If none is left, the line is omitted.
  - **List found but no column detected:** "These variants have no colour or size in the page data — they will be told apart by their SKU". This replaces "Nothing of this kind on these products yet…" for that case only. The old sentence stays for a method that found nothing.
- **Unchanged rules:**
  - **Budget:** no implementer or test clicks Verify, Sample, Extract or Check with an Anthropic key present.
  - **Identities and data:** never sign in as `markodjordjievski@gmail.com`, and never touch org `default`/`mar` or the projects Acne, Scratch or Competitor prices.
  - **Dev servers:** never stop, start or restart them (:4000/:3000/:3456).
  - **Commits:** by explicit path, never `git stash`. Each ends with the writer's `Co-Authored-By:` line.
  - **Tests:** run with `--maxWorkers=2`.

## Review Focus

1. **A list whose entries all carry an axis value but no SKU or price** (a size list with only `size`). Expected: these are variant entries, not stubs. Test: Task 1.
2. **A stub-only `hasVariant`, or one real entry plus stubs.** Expected: not a list at all (fewer than 2 variant entries), so detection suggests the next method instead of a list of "Variant 1…". Test: Task 1.
3. **A website already verified under the old rules, where every field was marked "From the product page".** Expected: its stored variant result stays as it is (no rewrite), but the next Verify fails it with the new messages. The app shows those columns without the "From the product page" choice, so the customer can fix them. Test: Task 2 (certification on that answer shape).
4. **A product page at the site root (`https://shop.example/blue-shirt`)** whose colour links are other root slugs. Expected: links still qualify (one-segment rule). Test: Task 3.
5. **A colour swatch group that also contains one off-pattern link** (Nike's "Design your own", `/u/…`). Expected: that link is dropped, the rest stay a group, and the count excludes it. Test: Task 3.

---

## File map

- **Scraper:**
  - Modify `packages/scraper/src/verify/variant-detect.ts` (`isVariantEntry`, used in `buildList` and `qualifiesAsApiVariantArray`) and its test.
  - Modify `packages/scraper/src/verify/variant-certify.ts` (stub filter in `resolveVariantList`; vocabulary-order ranking in `suggestEntryValues` and `candidatesForField`; the two new rules) and its test.
  - Modify `packages/scraper/src/verify/variant-dom.ts` and `variant-collector.ts` (`isLikelyVariantHref`, inside every link-producing script and in `certifyVariantLinks`), and their tests.
- **API:**
  - Modify `packages/api/src/routers/sources.ts`: `saveVariantAnswer` refuses a column in `fromProduct`; `variantList`'s labels use the sku suggestion.
  - Modify `packages/api/src/verify/variant-fields.ts` (`variantNoun`).
  - Tests: `sources-variant-answers.test.ts`, `variant-check.test.ts`.
- **App:**
  - Modify `packages/app/src/lib/site/variants-view.ts` (picker words; the no-column sentence), `packages/app/src/lib/site/variants-row-view.ts` (`variantNoun`; `spotRows` with no "from-product" for columns), `packages/app/src/components/verification/variants-row.tsx` and `variants-step.tsx`, plus the view tests.

---

### Task 1: Scraper — stub entries are not variants, and the real SKU is suggested

**Files:**
- Modify: `packages/scraper/src/verify/variant-detect.ts`, `packages/scraper/src/verify/variant-certify.ts`, `packages/scraper/src/verify/index.ts`.
- Test: `variant-detect.test.ts`, `variant-certify.test.ts`.
- Modify: `packages/api/src/routers/sources.ts`. `variantList`'s label fallback reads the sku-concept suggestion, not the raw `sku` key.

**Interfaces — Produces:**

```ts
// variant-detect.ts
export function isVariantEntry(entry: Record<string, unknown>): boolean;
```

**Rules:**
- **`isVariantEntry`:** exactly the Global Constraints definition.
- **Detection:**
  - `buildList` keeps only variant entries; with fewer than 2 it returns `null`.
  - `count` is the number of variant entries.
  - `qualifiesAsApiVariantArray` counts only variant entries toward its thresholds.
- **`resolveVariantList`:** returns only variant entries, so certification and `variantList` see the same entries detection counted.
- **Suggestion and candidate ranking:**
  - Concept-fitting leaves are ordered by the index of their last path segment (lower-cased, with `[n]` stripped) in `CONCEPT_PATHS[concept]`, then by path length.
  - Apply this in `suggestEntryValues` and in `candidatesForField`'s concept-fitting leaves.

- [ ] **Step 1: Write the failing tests**

```ts
// variant-detect.test.ts
const stub = (size: number) => ({ '@type': 'Product', url: `https://s.example/p/other?size=${size}` });
const real = (size: string, sku: string) => ({ '@type': 'Product', size, sku, offers: { price: '100', availability: 'https://schema.org/InStock' } });
it('drops URL-only stub entries from a hasVariant list (Allbirds)', () => {
  const lists = detectVariantLists(cap([{ '@type': 'ProductGroup', hasVariant: [stub(8), stub(9), stub(10), real('8', 'A-8'), real('9', 'A-9')] }]));
  expect(lists).toHaveLength(1);
  expect(lists[0]!.count).toBe(2);
  expect(lists[0]!.entries.map((e) => e.sku)).toEqual(['A-8', 'A-9']);
});
it('a list of stubs plus one real entry is no list', () => {
  expect(detectVariantLists(cap([{ '@type': 'ProductGroup', hasVariant: [stub(8), stub(9), real('8', 'A-8')] }]))).toEqual([]);
});
it('entries with only an axis value are variants', () => {
  expect(isVariantEntry({ '@type': 'Product', size: 'M' })).toBe(true);
  expect(isVariantEntry({ '@type': 'Product', url: 'https://s.example/x', name: 'x', image: 'i.jpg' })).toBe(false);
});

// variant-certify.test.ts
it('resolveVariantList drops stubs, so certification counts what detection counted', () => {
  const c = cap(U[0]!, [{ '@type': 'ProductGroup', hasVariant: [{ '@type': 'Product', url: 'https://s.example/o' }, v('Black', 'A1', '10.00'), v('Red', 'A2', '11.00')] }]);
  expect(resolveVariantList(c, LIST)).toHaveLength(2);
});
it('suggests sku before mpn (Everlane)', () => {
  const entry = { '@type': 'Product', mpn: '0-00000-52277-9', sku: 'M-T-CTN-WHT-XS', size: 'XS', offers: { price: '30' } };
  expect(suggestEntryValues(entry, [{ key: 'sku', name: 'SKU', type: 'text', concept: 'sku' }]).sku).toEqual({ value: 'M-T-CTN-WHT-XS', path: 'sku' });
});
it('certifies sku on sku when both sku and mpn read the confirmed value', () => { /* entries carry sku and mpn equal on the spot entry; entryPaths.sku → { kind: 'path', path: 'sku' } */ });
```

- [ ] **Step 2: Run** `pnpm --filter @robot/scraper exec vitest run --maxWorkers=2 src/verify/variant-detect.test.ts src/verify/variant-certify.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the Rules, export `isVariantEntry`, and change `variantList`'s label fallback in `sources.ts` to use the sku-concept suggestion's value.
- [ ] **Step 4: Run them to see them pass**, then the scraper and api gates (`--maxWorkers=2`) and `tsc --noEmit` in both.
- [ ] **Step 5: Commit** `fix(scraper): stub entries are not variants, and the real SKU is suggested before a barcode`.

---

### Task 2: A certified list must read values from the list; columns never come from the product page

**Files:**
- Modify: `packages/scraper/src/verify/variant-certify.ts` and its test, `packages/api/src/routers/sources.ts` (`saveVariantAnswer`), `packages/api/src/routers/sources-variant-answers.test.ts`.
- Modify: `packages/app/src/lib/site/variants-row-view.ts` (`spotRows`) and its test, `packages/app/src/components/verification/variants-row.tsx`.

**Interfaces:**
- **Consumes:** `EntryField.axisFrom` (set for an axis column), `VariantAnswer.spot.fromProduct`.
- **Produces:** `spotRows(args)` gains `columnKeys: string[]` (the axis entry fields' keys); a column's row never has the state `from-product`.

**Rules:**
- **`certifyVariantList`, an axis entry field listed in any page's `spot.fromProduct`:** that page fails with `{field} differs per variant — it must come from the list`, and the field gets no entry path.
- **`certifyVariantList`, after entry fields are decided:** if no entry field received an entry path, set `problem` to `Nothing is read from the variants — check at least one value of the checked variant` and `passed: false`.
- **`saveVariantAnswer`:** when the website's setup method is `list` and `answer.spot.fromProduct` contains an axis column's key (from `entryFieldsFor`), reject with BAD_REQUEST and the same `{field} differs per variant — it must come from the list`.
- **App:** `spotRows` takes the column keys. A column's row is `suggested`, `confirmed` or `needs-you`, never `from-product`. `variants-row.tsx` does not render the "From the product page" control on a column's row. An answer already holding a column in `fromProduct` shows that row as `needs-you`.

- [ ] **Step 1: Write the failing tests:**
  - **scraper:** Allbirds' answer shape (every field, including Size and Colour, in `fromProduct`) gives the page failures `Size differs per variant — it must come from the list` and `problem: 'Nothing is read from the variants — check at least one value of the checked variant'`, with `passed: false`.
  - **scraper:** only non-column fields in `fromProduct`, with the columns read from the list, still passes.
  - **api:** `saveVariantAnswer` with `fromProduct: ['colour']` (an axis key) → BAD_REQUEST with the message.
  - **app:** `spotRows` never returns `from-product` for a column key; an old answer holding it → `needs-you`.
- [ ] **Step 2: Run them to see them fail** (focused files in the three packages).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass**, then the scraper, api and app gates (`--maxWorkers=2`) and `tsc` in all three.
- [ ] **Step 5: Commit** per package: `fix(scraper): a variant list certifies only when values are read from it` / `fix(api): a column is never taken from the product page` / `fix(app): no "From the product page" for a column`.

---

### Task 3: Variant links stay under the product page's own path shape

**Files:**
- Modify: `packages/scraper/src/verify/variant-collector.ts` (export `isLikelyVariantHref`; use it in `buildCollectorCandidatesScript`, `buildXPathHrefsScript`, `buildLinksNearScript` and `certifyVariantLinks`), `packages/scraper/src/verify/variant-dom.ts` (`buildVariantLinksScript`: filter each group's links before the ≥ 2 rule), and both tests.

**Interfaces — Produces:**

```ts
export function isLikelyVariantHref(pageUrl: string, href: string): boolean;  // also spliced into the in-page scripts
```

**Rules:**
- **The rule itself:** as in Global Constraints, over normalised hrefs (`normalizeVariantLink`). Path segments are the non-empty parts of `pathname` split on `/`.
- **Detection:** a group keeps only qualifying links. A group with fewer than 2 left is dropped. `count` counts what is left.
- **`buildXPathHrefsScript`:** returns only qualifying hrefs, so a certified collector can never yield an off-pattern link at extraction time.
- **`certifyVariantLinks`:** filters each page's collected hrefs and each answer's `links` through the rule before comparing. An answer link that fails the rule is ignored for the comparison. The count used is the filtered count.

- [ ] **Step 1: Write the failing tests** (real Chromium, as `variant-collector.test.ts` does):

```ts
const nikePage = `<html><body><main>
  <div class="colorway-images" aria-label="Colour">
    <a href="/t/air-force-1-white/CW2288-111">White</a><a href="/t/air-force-1-black/CW2288-001">Black</a>
    <a href="/u/custom-nike-air-force-1-by-you">Design your own Nike By You product</a></div>
  <div class="pdp-help-options"><a href="/help/a/returns">Return policy</a><a href="/help/a/pickup">Pick-up available</a></div>
</main></body></html>`;
const PAGE = 'https://www.nike.com/t/air-force-1-white/CW2288-111';
it('drops the customise link and the help links (Nike)', async () => {
  const groups = await browser.setContentEvaluate<VariantLinks[]>(nikePage, buildVariantLinksScript(PAGE));
  expect(groups).toHaveLength(1);
  expect(groups[0]!.links.map((l) => l.label)).toEqual(['White', 'Black']);
});
it('a root-level product page keeps root-level colour links', () => {
  expect(isLikelyVariantHref('https://shop.example/blue-shirt', 'https://shop.example/red-shirt')).toBe(true);
  expect(isLikelyVariantHref('https://www.nike.com/t/a/1', 'https://www.nike.com/help/a')).toBe(false);
});
it('a certified collector never yields an off-pattern link', async () => { /* buildXPathHrefsScript over nikePage with the colorway XPath → only the two /t/ links */ });
```

- [ ] **Step 2: Run them to see them fail**: `pnpm --filter @robot/scraper exec vitest run --maxWorkers=2 src/verify/variant-collector.test.ts src/verify/variant-dom.test.ts`.
- [ ] **Step 3: Implement.** Keep the in-page helper and the exported function one implementation (the `toString()` splice pattern the file already uses).
- [ ] **Step 4: Run them to see them pass**, then the scraper gate and `tsc`.
- [ ] **Step 5: Commit** `fix(scraper): variant links stay under the product page's own path`.

---

### Task 4: Wording — the noun, the picker line, and a list without columns

**Files:**
- Modify: `packages/api/src/verify/variant-fields.ts` (`variantNoun`), `packages/app/src/lib/site/variants-row-view.ts` (`variantNoun`), `packages/app/src/lib/site/variants-view.ts` (picker words; a `noColumns` flag on the `found` state), `packages/app/src/components/verification/variants-step.tsx`, and the tests (`variant-check.test.ts` or a `variant-fields` test, `variants-row-view.test.ts`, `variants-view.test.ts`).
- `docs/handoff.md`: a short "Variants plan 2b" note under the variants sections.

**Rules:** exactly the Global Constraints on-screen wording:
- **`variantNoun`:** one mapped column → its plural; two or more, or none → `variants`. Change it on both sides, with a test on each.
- **Picker-only words:** only the known list. "swatchs", "defaultcolornames" and "unstyleds" never appear. If no known word is left, there is no picker line.
- **Found list with no detected column** (every page's lists have `axes: []`): show "These variants have no colour or size in the page data — they will be told apart by their SKU" instead of "Nothing of this kind…".

- [ ] **Step 1: Write the failing tests:**
  - `variantNoun(['Size', 'Colour'])` → `variants`, and `variantNoun(['Colour'])` → `colours`, in the app.
  - The API noun for a setup mapping two columns → `variants`.
  - `summaryLines`/picker words for pickers `['swatch', 'defaultColorNames', 'colour']` → only `colours`.
  - A `found` state over lists with `axes: []` carries `noColumns: true`.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the api and app gates and `tsc`.
- [ ] **Step 5: Commit** `fix(app,api): plain variant wording — the noun, picker words, a list without columns`; docs as a second commit.

---

## After the plan: re-run the live check

The controller re-runs `docs/testing/ui-check-app-variants.mts` on Allbirds, Everlane and Nike, free, on a keyless :4100, as recorded in `docs/testing/results/2026-10-02-variants-live-check.md`. Expected:
- **Allbirds:** 13 / … sizes (no stubs). A real variant is checked. Size and Colour can't be "From the product page". Verify passes only with values read from the list.
- **Everlane:** SKU certified on `sku`.
- **Nike:** one colour group, without "Design your own" or help links.

Record the results in a new dated results file.

## Not in this plan (ruled)

- **"Remove one link" from a confirmed group:** replaced by the path-shape rule, which removes the observed case (`/u/…`) both at setup and at scale. Revisit if a live site shows an odd link that shares the path shape.
- **Jev as a judge of link groups:** noted for the parked shadow-checks spec (`2026-09-28-jev-shadow-checks-design.md`). Try it if link detection still misfires after this plan.
- **Allbirds' other colourways** (separate pages, each with its own sizes): a combined links-plus-list method is a later design. This plan reads each colour page's own sizes.
