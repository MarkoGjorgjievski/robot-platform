# Variants plan 3 — extraction, export and reporting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a website verified with variants, an extraction run produces one row per variant (list method: from the product page's own data; links method: one page per variant), each carrying `product_key` and `variant_key`. Export gives the project's chosen shape in CSV, XLSX and JSON. The run page counts variants, products with and without them, and partial ones.

**Architecture:**
- **Run start:** `startExecution` builds a `VariantRunPlan` from the run's certification (`cert.variants`: method, list ref, entry paths, from-product fields, collector), the project's `variantMode` and the website's entry fields. With no plan (variants off, or method `none`), every path is today's.
- **Per product page, `extractItem`:**
  - extracts the certified fields as today, but keeps the page capture;
  - **list method:** reads the certified list from that same capture and writes N rows into the one extraction (`data` is already an array);
  - **links method:** reads the certified collector's links from the capture, writes the page's own row, and queues the product's other variant pages in the same run, as a whole group within the item budget or not at all.
- **Pure row-building in the scraper:** `buildVariantRows`, `variantKeyOf`, `groupKeyOf`. These are unit-tested without a browser.
- **Export:** shapes rows per `variantMode` and gains XLSX through `exceljs`.
- **Run summary:** `finaliseRun` derives the run's variant summary and row total from the stored rows.

**Tech Stack:** TypeScript, Drizzle + Postgres (migration 0014), tRPC v11, Hono (export routes), `exceljs` (new dependency, MIT), Playwright `setContentEvaluate`, React (TanStack), vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-variants-design.md`, §5 (extraction at scale), §5.1 (rows and identity), §5.2 (export), §5.3 (the run page), and §9's approved decisions. Plans 1, 2 and 2b are merged on `main` (`ac7f265`). Two leftovers from `docs/testing/results/2026-10-02-variants-live-check-2.md` are folded in as Task 7 (N1, N3). Code map: `C:\Users\Marko\AppData\Local\Temp\claude\C--Users-Marko-Documents-projects-robot-platform\14a25afa-e94a-4aab-83c9-f7bdec13e563\scratchpad\plan3-dossier-notes.md`. Its facts are restated below where tasks need them.

## Global Constraints

- **When variants apply:** variants apply to a run only when its certification carries `variants` (Plan 2: required, current and passed). Otherwise extraction, storage, export and the run page behave exactly as today. Every existing test stays green.
- **Row keys:** every row of a variants run carries `_product_key` and `_variant_key` (internal keys, underscore-prefixed like the other provenance keys). Export renames them to the columns `product_key` and `variant_key`.
  - **`_product_key`:**
    - list method: the product page URL (normalised with `normalizeVariantLink`);
    - links method: `groupKeyOf(urls)`, the lexicographically smallest normalised URL of the product's variant group, including the page itself. This is deterministic whichever member page is extracted first.
    - A product without variants gets its page URL.
  - **`_variant_key`:** the row's certified SKU value, else its GTIN value, else (links) its own page URL, else its axis values joined `" · "` in setup-axes order ("Black/Red · 10C"). A product without variants gets no `_variant_key` (empty).
- **Axis columns:** a row stores each axis column under its axis `key`. Export names it with the axis column's name (Colour, Size).
- **List method rows:**
  - Product-level fields come from the product page.
  - Variant-level fields and axes come from each entry through its entry path. A field in `fromProduct` takes the product page's value on every row.
  - Values are normalised with `normalize(type, raw, { pageUrl })` and rendered with `renderValue` as the product fields are.
  - An entry whose entry path reads nothing for some field marks its row `_variant_partial: true`.
  - If the list is missing on the page (resolves `null`) or empty, the product gets one row with its own values and counts as "without variants".
- **Links method rows and queueing:**
  - The page's own row holds its certified fields, plus its axis value from its own link's label (the first mapped axis column gets the label).
  - The product's other variant URLs are queued as `detail` run items of the same run, with `variant_of = _product_key`.
  - A URL already in the run (the unique `(run_id, url)` index) is not queued again. It is extracted once, and its row carries the group's `_product_key` because every member computes the same group.
  - A variant page that fails to load marks the product partial (counted). It never stops the run.
- **Budget:**
  - The run's item cap is `itemCap(resolveBudget(source.budget))`. Queued variant pages count against it. A group is queued only when all of its not-yet-queued members fit in the remaining cap; otherwise none are queued, and the summary counts them under `variantsSkippedForBudget`.
  - The run never stops to ask (spec §1).
  - **Changed 2026-10-05 (Marko, budget option 1, after the live extraction):** variant pages no longer count against the source's item budget — the cap is `HARD_ITEM_CEILING` instead, and a product with pages skipped for it now also counts as partial. See `docs/testing/results/2026-10-05-variants-live-extraction.md` and spec §5.
- **Run row total:** `runs.resultCount` becomes the sum of `extractions.rowCount` for the run, not the count of done items. For a run without variants the two are equal.
- **Export shapes** (spec §5.2, decision §9.2):
  - **`row_per_variant`:** columns are product-level fields (contract order), then axis columns (axis order), then variant-level fields (contract order), then `product_key`, `variant_key`.
  - **`nested`:** in JSON, one object per product with its product-level fields, `product_key` and a `variants` array of `{ variant_key, <axis names>, <variant-level field names> }`. In CSV and XLSX, one row per product: product-level fields, then each axis and variant-level column joined with `"; "` in variant order, then `product_key`. Documented as lossy in the export file's name note.
  - **`ignore`:** today's shape. Variants never apply then anyway.
  - **Format:** CSV, XLSX and JSON for every shape. The XLSX is one sheet named `Data`, with a bold header row, frozen first row, and plain values (numbers as numbers where the field type is `number`/`money`).
- **Run page counts** (spec §5.3), shown only on a variants run:
  - "{v} variants from {p} products";
  - "{w} products without variants";
  - "{q} products with partial variants";
  - "{s} variant pages skipped for the budget" (only when s > 0).
- **No AI, no new spend.** Variant pages are captured like product pages (the domain politeness lock still applies).
- **Wording leftovers** (live check 2):
  - **N1:** for a column field, the "isn't in the list" message ends `— check the value` (no "or mark it from the product page").
  - **N3:** a link group whose detected axis word is generic (`option`, `variant`, `swatch`, `style`) defaults its new column name to "Colour".
- **Unchanged rules:**
  - **Budget:** no implementer or test clicks Verify, Sample, Extract or Check with an Anthropic key present. Live runs happen only on the keyless :4100, controller-run.
  - **Identities:** never sign in as `markodjordjievski@gmail.com`, and never touch org `default`/`mar` or the projects Acne, Scratch or Competitor prices.
  - **Dev servers:** never stop, start or restart them (:4000/:3000/:3456).
  - **Commits:** by explicit path, never `git stash`. Each ends with the writer's `Co-Authored-By:` line.
  - **Tests:** run with `--maxWorkers=2`.
  - **Migrations:** run `pg_dump` before the migration (`docker exec robot-platform-db pg_dump -U postgres robot_platform > <scratchpad>/pre-variants-3.sql`).

## Review Focus

1. **A list-method product whose page no longer carries the list** (the site changed). Expected: one row with its own values, counted under "without variants", and the variant fields count as misses for drift. The run never fails. Test: Task 3.
2. **A links-method run where two listing products are colourways of each other.** Expected: each URL is extracted once, both rows share one `_product_key`, and the group is never queued twice. Test: Task 4.
3. **A budget that ends in the middle of a links group.** Expected: the group is not queued, the products already extracted keep their rows, and the summary reports the skipped variant pages. Test: Task 4.
4. **Backfill of a missing cell on a list-method extraction holding several rows.** Expected: each row is filled by its own `_variant_key`, never row 0's value copied to all. Test: Task 5.
5. **Export of a variants run in `nested` mode where one product has no variants.** Expected: that product appears with an empty `variants` array (JSON), or with empty variant cells (CSV/XLSX), never dropped. Test: Task 6.

---

## File map

- **Database:**
  - Create `packages/db/drizzle/0014_variant_runs.sql`, plus its meta snapshot via drizzle-kit.
  - Modify `packages/db/src/schema.ts`: `run_items.variant_of text` (nullable), `runs.variant_summary jsonb` (nullable).
- **Scraper:**
  - Create `packages/scraper/src/verify/variant-rows.ts` and its test: `buildVariantRows`, `variantKeyOf`, `groupKeyOf`, `VariantRunPlan`.
  - Modify `packages/scraper/src/verify/verified-extraction.ts`: return the capture.
  - Modify `packages/scraper/src/verify/variant-collector.ts`: `buildXPathLinksScript`, which gives hrefs with labels.
- **API:**
  - Modify `packages/api/src/crawl/start-execution.ts` (load the plan), `packages/api/src/crawl/extract-item.ts` (rows and queueing), `packages/api/src/crawl/roll-up-run.ts` (`finaliseRun`: resultCount and variant summary), and `packages/api/src/crawl/merge-backfill.ts` (multi-row merge).
  - Create `packages/api/src/crawl/variant-run-plan.ts` (`loadVariantRunPlan`) and `packages/api/src/crawl/queue-variant-pages.ts` (`queueVariantGroup`).
  - Modify `packages/api/src/export/{build-run-export.ts,load-run-export.ts,load-project-export.ts,serialize.ts}`, and create `packages/api/src/export/xlsx.ts`.
- **API server:** modify `packages/api-server/src/routes/export.ts` to accept `.xlsx`.
- **App:**
  - Modify `packages/app/src/lib/site/run-screen-view.ts` and its test (variant counts), `packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx` (counts, axis and key columns in the results sheet, XLSX link), and `runs.getWithDetails` in `packages/api/src/routers/runs.ts` (returns `variantSummary`, axis columns, and the project's `variantMode`).
  - Modify `packages/app/src/lib/site/variants-view.ts` (N3) and `packages/scraper/src/verify/variant-certify.ts` (N1).
- **Docs:** `docs/handoff.md`.

---

### Task 1: Storage, and the pure variant-row builder

**Files:**
- Modify: `packages/db/src/schema.ts`. Create: `packages/db/drizzle/0014_variant_runs.sql` (generate it with drizzle-kit as 0013 was; back up first; apply with `pnpm db:migrate`).
- Create: `packages/scraper/src/verify/variant-rows.ts`; Test: `packages/scraper/src/verify/variant-rows.test.ts`.
- Modify: `packages/scraper/src/verify/index.ts`.

**Interfaces:**
- **Consumes:** `resolveVariantList`, `readEntryPath`, `EntryPath`, `VariantListRef` (`variant-certify.ts`); `normalizeVariantLink` (`variant-collector.ts`); `normalize`, `renderValue` (`normalize.ts`); `CustomerFieldType`.
- **Produces:**

```ts
// db
runItems.variantOf: text('variant_of')            // nullable: the group's _product_key for a queued variant page
runs.variantSummary: jsonb('variant_summary')     // nullable: VariantRunSummary

// variant-rows.ts
export type VariantRunPlan = {
  method: 'list' | 'links';
  list?: VariantListRef;
  entryPaths: Record<string, EntryPath>;           // list method: entry-field key → path
  fromProduct: string[];
  collector?: string;                              // links method
  axes: Array<{ key: string; name: string }>;      // mapped axis columns, setup order
  fields: Array<{ key: string; name: string; type: CustomerFieldType; level: 'product' | 'variant' }>;  // contract fields, contract order
  skuKey?: string;                                 // the contract field with concept 'sku', if any
  gtinKey?: string;                                // the contract field with concept 'gtin' (or 'gtin13'), if any
};
export type VariantRunSummary = {
  variants: number; products: number; withoutVariants: number; partial: number; variantsSkippedForBudget: number;
};
export function groupKeyOf(urls: string[]): string;                       // min of normalised urls
export function variantKeyOf(row: Record<string, unknown>, plan: VariantRunPlan, ownUrl?: string): string;
export function buildVariantRows(args: {
  productRow: Record<string, unknown>;             // the product page's certified row (keys = field keys)
  entries: Record<string, unknown>[] | null;       // resolveVariantList's result on that page
  plan: VariantRunPlan;
  pageUrl: string;
}): { rows: Record<string, unknown>[]; partial: boolean; withVariants: boolean };
export function summariseVariantRows(rows: Record<string, unknown>[], skippedForBudget: number): VariantRunSummary;
```

**Rules:**
- **`buildVariantRows`:**
  - `entries` null or empty → `[{ ...productRow, _product_key: normalizeVariantLink(pageUrl) }]`, with `withVariants: false`.
  - Otherwise, for each entry:
    1. Start from `productRow`'s product-level fields.
    2. Add each variant-level field: its entry path's value normalised and rendered, or `productRow[key]` when the field is in `fromProduct`, or `null` when it has no path.
    3. Add each axis column under its key (through its entry path).
    4. Set `_product_key = normalizeVariantLink(pageUrl)` and `_variant_key = variantKeyOf(row, plan)`.
  - A row is partial when any variant-level field or axis with an entry path reads `null`. In that case set `_variant_partial: true` and return `partial: true`.
- **`variantKeyOf`:** the rule in Global Constraints. Axis values come from the row under the axis keys.
- **`summariseVariantRows`:**
  - `products` = distinct `_product_key`;
  - `variants` = rows with a non-empty `_variant_key`;
  - `withoutVariants` = product keys none of whose rows has a `_variant_key`;
  - `partial` = distinct `_product_key` with any `_variant_partial`.

- [ ] **Step 1: Write the failing tests**

```ts
const plan: VariantRunPlan = {
  method: 'list', list: { source: 'json-ld', path: 'hasVariant' },
  entryPaths: { price: { kind: 'path', path: 'offers.price' }, sku: { kind: 'path', path: 'sku' }, colour: { kind: 'axis', from: 'color' } },
  fromProduct: ['in_stock'], axes: [{ key: 'colour', name: 'Colour' }],
  fields: [
    { key: 'title', name: 'Title', type: 'text', level: 'product' },
    { key: 'price', name: 'Price', type: 'money', level: 'variant' },
    { key: 'sku', name: 'SKU', type: 'text', level: 'variant' },
    { key: 'in_stock', name: 'In stock', type: 'boolean', level: 'variant' },
  ],
  skuKey: 'sku',
};
const product = { title: 'Shoe', price: '10.00', sku: 'P1', in_stock: true };
const entries = [
  { '@type': 'Product', color: 'Black', sku: 'A1', offers: { price: '10.00' } },
  { '@type': 'Product', color: 'Red', sku: 'A2', offers: {} },
];
it('one row per entry: product fields, variant fields from the entry, from-product fields copied, axis column, keys', () => {
  const r = buildVariantRows({ productRow: product, entries, plan, pageUrl: 'https://s.example/p/1#x' });
  expect(r.withVariants).toBe(true);
  expect(r.rows).toHaveLength(2);
  expect(r.rows[0]).toMatchObject({ title: 'Shoe', price: 10, sku: 'A1', in_stock: true, colour: 'Black', _product_key: 'https://s.example/p/1', _variant_key: 'A1' });
});
it('an entry missing a variant field is partial, the row is kept', () => {
  const r = buildVariantRows({ productRow: product, entries, plan, pageUrl: 'https://s.example/p/1' });
  expect(r.rows[1]).toMatchObject({ price: null, _variant_partial: true });
  expect(r.partial).toBe(true);
});
it('no list on the page: one row, without variants', () => {
  const r = buildVariantRows({ productRow: product, entries: null, plan, pageUrl: 'https://s.example/p/1' });
  expect(r).toMatchObject({ withVariants: false, partial: false });
  expect(r.rows).toEqual([{ ...product, _product_key: 'https://s.example/p/1' }]);
});
it('variant key falls back to the axis values when there is no sku', () => {
  expect(variantKeyOf({ colour: 'Black', size: '10C' }, { ...plan, skuKey: undefined, axes: [{ key: 'colour', name: 'Colour' }, { key: 'size', name: 'Size' }] })).toBe('Black · 10C');
});
it('the group key is the smallest normalised url, whichever member asks', () => {
  expect(groupKeyOf(['https://s.example/t/b#x', 'https://s.example/t/a', 'https://s.example/t/c'])).toBe('https://s.example/t/a');
});
it('summarises rows', () => {
  const rows = [
    { _product_key: 'p1', _variant_key: 'A1' }, { _product_key: 'p1', _variant_key: 'A2', _variant_partial: true },
    { _product_key: 'p2' },
  ];
  expect(summariseVariantRows(rows, 3)).toEqual({ variants: 2, products: 2, withoutVariants: 1, partial: 1, variantsSkippedForBudget: 3 });
});
```

  Read `renderValue` first. If a money value renders as a string rather than a number, assert what it renders, and keep it identical to what `extractItem` already stores for a product row.
- [ ] **Step 2: Run them to see them fail:** `pnpm --filter @robot/scraper exec vitest run --maxWorkers=2 src/verify/variant-rows.test.ts`.
- [ ] **Step 3: Implement.** Back up the DB, then generate and apply migration 0014.
- [ ] **Step 4: Run them to see them pass**, then the scraper gate and `tsc --noEmit` in scraper and db.
- [ ] **Step 5: Commit** `feat(db,scraper): store a run's variant summary, and build one row per variant`.

---

### Task 2: Keep the capture, read the plan at run start, and links with labels

**Files:**
- Modify: `packages/scraper/src/verify/verified-extraction.ts` (`VerifiedExtractionResult` gains `capture: PageCapture | null`: the capture it used or took), and its test.
- Modify: `packages/scraper/src/verify/variant-collector.ts`: `buildXPathLinksScript(xpath, pageUrl)` returns `Array<{ href, label }>`. It is filtered by `isLikelyVariantHref`, uses `normalizeVariantLink`, and labels links as `buildVariantLinksScript` does. Add its test.
- Create: `packages/api/src/crawl/variant-run-plan.ts`; Test: `packages/api/src/crawl/variant-run-plan.test.ts`.
- Modify: `packages/api/src/crawl/start-execution.ts`: load the plan once per run and pass it to `extractItem` as `deps.variantPlan`.

**Interfaces — Produces:**

```ts
export function buildXPathLinksScript(xpath: string, pageUrl: string): string;   // → Array<{ href: string; label: string }>
export async function loadVariantRunPlan(db: Database, sourceId: string, cert: Certification | null): Promise<VariantRunPlan | null>;
```

**Rules:**
- **`loadVariantRunPlan`:**
  - Returns `null` unless `cert?.variants` is set.
  - Otherwise builds the plan from:
    - `cert.variants` (method, list, entryPaths, fromProduct, collector);
    - the dataset's contract fields with `effectiveLevel`, as `fields` in contract order;
    - the setup's mapped axes that still exist, as `axes`, deduped by key in setup order;
    - `skuKey` and `gtinKey`: the contract fields whose concept is `sku`, or `gtin`/`gtin13`.
  - Read the dataset and the source in one query, the way `loadSourceRow` does.
- **`runVerifiedExtraction`:** returns the capture. Nothing else changes; existing callers ignore it.

- [ ] **Step 1: Write the failing tests:**
  - `loadVariantRunPlan` returns `null` without `cert.variants`.
  - With a list certification it returns method, list, the entry paths and the fields with levels.
  - It drops an axis whose column was deleted.
  - `buildXPathLinksScript` on the Nike-shaped fixture from `variant-collector.test.ts` returns the two `/t/` links with labels "White" and "Black".
  - `runVerifiedExtraction` returns the supplied capture.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement**, and wire `start-execution.ts` (an existing test or a new one asserts `extractItem` receives the plan).
- [ ] **Step 4: Run them to see them pass**, then the scraper and api gates and `tsc`.
- [ ] **Step 5: Commit** `feat(api,scraper): read a run's variant plan, keep the page capture, read variant links with labels`.

---

### Task 3: List method — one extraction holds a product's variant rows

**Files:**
- Modify: `packages/api/src/crawl/extract-item.ts` and `packages/api/src/crawl/extract-item.test.ts`.
- Modify: `packages/api/src/crawl/roll-up-run.ts` (`finaliseRun`: `resultCount` = sum of `rowCount`; when the run's extractions hold any `_product_key`, write `variantSummary` with `summariseVariantRows(allRows, skipped)`, where `skipped` = the run's queued-but-skipped count from Task 4, 0 here), and `roll-up-run.test.ts`.

**Interfaces:**
- **Consumes:** `VariantRunPlan`, `buildVariantRows`, `summariseVariantRows`, `resolveVariantList`, `deps.variantPlan`, `verified.capture`.
- **Produces:** `persistRows(rows, confidence, metadata)`, replacing `persistRow`. It writes `data: rows` and `rowCount: rows.length`. `extractItem`'s return `row` stays the first row, so existing callers keep working.

**Rules:**
- **When `deps.variantPlan?.method === 'list'`:**
  1. After `extractVerified`, compute `entries = verified.capture ? resolveVariantList(verified.capture, plan.list!) : null`.
  2. Build the product row as today (`mergeRow`).
  3. Call `buildVariantRows` and persist all of its rows in the one extraction.
  4. Record path stats as today, for the product fields only.
- **No plan:** byte-for-byte today's behaviour.
- **`finaliseRun`:** derive the sums from the database. `extractions.data` is jsonb, so use `jsonb_array_length` in SQL, as `runs.getWithDetails` already does.

- [ ] **Step 1: Write the failing tests:**
  - **In `extract-item.test.ts`,** add a certified list case with a fake `extractVerified` returning a capture whose JSON-LD has `hasVariant` with 2 colours. Expect one extraction with `rowCount: 2` and rows with `_variant_key`s.
  - **Review Focus 1:** a capture without the list gives one row with `_product_key` and no `_variant_key`.
  - **No plan:** the extraction is unchanged (`rowCount: 1`, same row as before).
  - **In `roll-up-run.test.ts`:** `resultCount` sums `rowCount`, and `variantSummary` is written only when rows carry `_product_key`.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the api gate and `tsc`.
- [ ] **Step 5: Commit** `feat(api): a list-method product page becomes one row per variant`.

---

### Task 4: Links method — the page's own row, and its variant pages queued as a group

**Files:**
- Create: `packages/api/src/crawl/queue-variant-pages.ts`; Test: `packages/api/src/crawl/queue-variant-pages.test.ts` (DB-backed, like `plan-source.test.ts`).
- Modify: `packages/api/src/crawl/extract-item.ts` and its test, and `packages/api/src/crawl/roll-up-run.ts` (the skipped count).

**Interfaces:**
- **Consumes:** `buildXPathLinksScript`, `groupKeyOf`, `variantKeyOf`, `normalizeVariantLink`, `itemCap`/`resolveBudget` (`@robot/scraper` crawl budget), `run_items` (`variantOf`), `ClaimedItem` (its `url`, `inputIndex`, `inputValues`).
- **Produces:**

```ts
export async function queueVariantGroup(db: Database, args: {
  runId: string; sourceId: string; productKey: string; urls: string[]; from: ClaimedItem; cap: number;
}): Promise<{ queued: number; skippedForBudget: number }>;
```

**Rules:**
- **In `extractItem`, when `plan.method === 'links'`:**
  1. Evaluate `buildXPathLinksScript(plan.collector!, item.url)` on the capture's HTML (`browser.setContentEvaluate`) to get the group `links`.
  2. `group = normalizeVariantLinks([item.url, ...links.map(l => l.href)])`, and `productKey = groupKeyOf(group)`.
  3. The page's own row is the certified row, plus `_product_key: productKey`, plus the first axis column set to its own link's label (when its URL is among the links), plus `_variant_key = variantKeyOf(row, plan, normalizeVariantLink(item.url))`.
  4. If `links` is empty, the row is a product without variants: `_product_key = normalizeVariantLink(item.url)`, and no `_variant_key`.
  5. Call `queueVariantGroup` with the group minus the URLs already in the run.
- **`queueVariantGroup`, in one transaction:**
  1. Lock the run row (`SELECT … FOR UPDATE` on `runs`) and count the run's detail items.
  2. Let `missing` = the URLs not yet present (by `(run_id, url)`).
  3. If `count + missing.length <= cap`, insert them all as `kind: 'detail'`, `status: 'pending'`, `variant_of: productKey`, copying `inputIndex`/`inputValues` from `from`, with `on conflict do nothing`. Otherwise insert none and add `missing.length` to the run's skipped tally, which lives in `runs.variantSummary` as `{ variantsSkippedForBudget: n }`. Increment it inside the same transaction: `jsonb_set(coalesce(variant_summary, '{}'), '{variantsSkippedForBudget}', to_jsonb(coalesce((variant_summary->>'variantsSkippedForBudget')::int, 0) + $missing))`. `finaliseRun` reads that number as `skipped` before it writes the full summary.
- **The claim loop:** `executeRun` already loops until no pending item remains, so queued pages are extracted in the same run with no change there. Confirm this by reading `execute-run.ts` and `claim-item.ts`.
- **A variant page's own extraction** runs the same code, so its group recomputes to the same `productKey`, and its queue call finds every member already present.

- [ ] **Step 1: Write the failing tests:**
  - **`queueVariantGroup`:** queues the missing URLs with `variant_of`, and skips URLs already present.
  - **Review Focus 3:** a group that doesn't fit the cap queues nothing and returns `skippedForBudget`.
  - Two calls for the same group queue it once.
  - **`extract-item.test.ts` (links):** a fake capture with 3 swatch links gives the own row with its label as Colour, the group key, and `queueVariantGroup` called with the 2 others.
  - **Review Focus 2:** the two members compute the same `_product_key`.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the api gate and `tsc`.
- [ ] **Step 5: Commit** `feat(api): a links-method product queues its variant pages as one group within the budget`.

---

### Task 5: Backfill and drift with several rows per extraction

**Files:**
- Modify: `packages/api/src/crawl/merge-backfill.ts` and `merge-backfill.test.ts`.
- Modify: `packages/api/src/crawl/drift.test.ts` (a guard test only, unless the code needs a change).

**Rules:**
- **`mergeBackfillResult`, when the parent extraction holds several rows:**
  - The re-extracted rows are matched to the parent's rows by `_variant_key`. A row without a key is matched by position only when both sides hold exactly one row.
  - Target fields are filled per matched row; unmatched new rows are appended; parent rows are never removed.
  - A single-row extraction keeps today's path unchanged.
- **Drift:** `driftedKeys` already flattens every row. Add a test that a variant field missing on most variant rows of a run flags drift for that field, and that `_`-prefixed keys never count as fields.

- [ ] **Step 1: Write the failing tests.** **Review Focus 4:** a parent with rows A1 (missing `price`) and A2 (missing `price`), plus a backfill result with A2 `price: 21` and A1 `price: 20`, fills each by key. Add the drift guard test.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the api gate and `tsc`.
- [ ] **Step 5: Commit** `fix(api): backfill fills each variant row by its key`.

---

### Task 6: Export — the project's shape, product_key and variant_key, and XLSX

**Files:**
- Modify: `packages/api/src/export/build-run-export.ts` and its test, `load-run-export.ts`, and `load-project-export.ts` and its test.
- Create: `packages/api/src/export/xlsx.ts` and its test.
- Modify: `packages/api-server/src/routes/export.ts` and `packages/api-server/src/export-route.test.ts`.
- Add `exceljs` to `packages/api`'s dependencies (`pnpm --filter @robot/api add exceljs`).

**Interfaces — Produces:**

```ts
export type ExportShape = 'flat' | 'row_per_variant' | 'nested';
export function shapeRows(args: {
  rows: Record<string, unknown>[]; shape: ExportShape;
  fields: Array<{ key: string; name: string; level: 'product' | 'variant' }>; axes: Array<{ key: string; name: string }>;
}): { columns: string[]; rows: Record<string, unknown>[]; json: unknown };
export async function toXlsx(columns: string[], rows: Record<string, unknown>[], types?: Record<string, string>): Promise<Buffer>;
```

**Rules:**
- **The shape:** `flat` when the run has no `_product_key` rows (today); otherwise the project's `variantMode` (`row_per_variant` or `nested`).
- **Columns and nesting:** exactly as in Global Constraints. `customerColumns` keeps renaming field keys to names. Axis keys map to axis names, and `_product_key`/`_variant_key` map to `product_key`/`variant_key`. `_variant_partial` is not exported.
- **The project export** applies the same shape per website, under its `Website` column.
- **Routes:**
  - `parseFile` accepts `xlsx` and responds with content type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and the same filename stem.
  - The CSV and JSON responses stay byte-identical for flat runs. A test proves this against today's output.

- [ ] **Step 1: Write the failing tests:**
  - `shapeRows` `row_per_variant` gives the column order and the renamed keys.
  - **Review Focus 5:** `nested` JSON with one product without variants gives `variants: []`; `nested` CSV gives one row per product, with `"; "`-joined cells.
  - A flat run is unchanged.
  - `toXlsx` round-trip: read the buffer back with `exceljs` and see the header and two rows, with numbers stored as numbers.
  - Route: `/runs/<id>.xlsx` returns 200 with the xlsx content type; `/runs/<id>.pdf` returns 404.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the api and api-server gates and `tsc`.
- [ ] **Step 5: Commit** `feat(api): export variants in the project's shape, with product_key, variant_key and an Excel file`.

---

### Task 7: The run page, the two wording leftovers, smoke and handoff

**Files:**
- Modify: `packages/api/src/routers/runs.ts` (`getWithDetails` also returns `variantSummary`, the project's `variantMode`, and the mapped axis columns `{ key, name }[]`).
- Modify: `packages/app/src/lib/site/run-screen-view.ts` (`variantCountLines(summary)` → string[]) and its test; `packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx` (show the lines under the run facts; the results sheet adds axis columns after the product fields and a `variant_key` column; add a "Download Excel" link next to CSV/JSON).
- Modify: `packages/scraper/src/verify/variant-certify.ts` and its test (N1); `packages/app/src/lib/site/variants-view.ts` and its test (N3).
- Modify: `packages/app/src/routes-smoke.test.ts`, `docs/handoff.md`.

**Rules:**
- **`variantCountLines`:** exactly the run-page counts in Global Constraints, in that order, with the skipped line only when it is above 0. An empty array when there is no summary.
- **N1:** for an entry field with `axisFrom`, the "isn't in the list" message is `{field} on the checked variant of product {n} isn't in the list — check the value`. Other fields keep today's text.
- **N3:** when a links group's detected axis word is one of `option`, `variant`, `swatch` or `style`, the proposed new column name is "Colour".
- **Smoke** (Marko's dev servers already running; never start or restart them; throwaway identity; never click Extract or Verify): open an existing run page of the throwaway project to see that it renders. No extraction is started. The CSV/JSON/Excel links appear. Restore any unrelated screenshots.
- **Handoff:** a "Variants plan 3" section covering what landed, how to check it, and the live run step below.

- [ ] **Step 1: Write the failing tests:**
  - `variantCountLines` with and without skipped pages, and with no summary;
  - N1's message for a column;
  - N3's default name;
  - `getWithDetails` returns `variantSummary` (api test).
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the api, app and scraper gates, `tsc`, and the smoke.
- [ ] **Step 5: Commit** per package; docs as a separate commit.

---

## After the plan: a live, free extraction (controller-run)

On a keyless :4100 (see the memory procedure), with a throwaway identity, the controller:
1. sets up Everlane (list) and Nike (links) as in `docs/testing/results/2026-10-02-variants-live-check-2.md`;
2. verifies them;
3. plans and executes a small run (budget 3 products) through tRPC on :4100 only;
4. downloads CSV, JSON and XLSX;
5. records rows per product, keys, the counts, and the time per product in a new dated results file.

No extraction is ever started on :4000.

## Not in this plan (ruled)

- **N2** (a self-plus-one link pair counted in the step's summary): it is summary-only and never chosen; revisit with link detection.
- **Picker-only variants, variants on listing pages, per-variant stock behind cart calls, cross-website variant matching:** spec §6.
- **Hit/miss stats for entry paths:** the domain cache holds field paths only. Drift covers partial variants through the rows.
