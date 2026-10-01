# Variants plan 1 — contract and detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project can turn variants on and choose their shape; each field has a product or variant level; axis columns (Colour, Size…) exist; and each website's Verification tab shows what variants its proof pages reveal and records the method and axis mapping the customer confirms.

**Architecture:** Two small database columns hold the choices: `datasets.variant_mode` (the project's shape) and `sources.variant_setup` (the website's method and axis mapping). Field levels and axes live in the dataset's schema array beside the fields (axes are entries with `kind: 'axis'`, kept out of `contractFields` so nothing that verifies fields sees them). Detection is a scraper module: a pure structured-data part (JSON-LD `hasVariant`, `offers[]`, API variant lists) and two in-page scripts (variant links, pickers) run over the proof pages' stored captures — free, no page loads, no model. Verification and certification of variants are plan 2; extraction and export are plan 3.

**Tech Stack:** Drizzle + Postgres (migration 0012), tRPC v11 + zod, `@robot/scraper` verify modules with Playwright `setContentEvaluate` for DOM scripts, `@robot/app` (TanStack Start, React), vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-variants-design.md` — §2 (contract), §3 (setup on a website), §9 decisions (approved). Plan 1 is spec §8 item 1.

## Global Constraints

- Variants setting values: `ignore` (default for every project, existing and new) · `row_per_variant` (labelled "One row per variant") · `nested` (labelled "One row per product, variants listed inside"). When the customer turns variants on, the preselected choice is `row_per_variant`.
- A field's level is `product` or `variant`. Effective level = the field's stored `level` if set, else by concept: **variant** for concepts `price`, `regular_price`, `discount`, `unit_price`, `sku`, `url`, `availability`, `stock_count`, `image_url`, `additional_images`; **product** for everything else, including custom fields with no catalogue concept. (Spec §2's "existing fields read as product until set" is satisfied because levels only matter when the mode is not `ignore`.)
- Axes are schema entries `{ key, name, kind: 'axis', concept: 'axis' }`; `contractFields(schema)` never returns them; `contractAxes(schema)` does. A field and an axis may not share a name.
- Existing projects and websites are unchanged: `variant_mode` defaults to `ignore`, `variant_setup` to null, no hash or certification changes.
- Detection is free: it reads stored proof-page captures only (no page load, no model). A website's method is one of `list`, `links`, `none`.
- Customer wording on screen: "Variants", "Colour", "Size", "One row per variant", "Listed in the page data", "Linked as separate pages", "Only in a picker on the page — not collected in this version", "No variants on this website". Never "axis", "hasVariant", "ProductGroup", "JSON-LD", "source".
- **Budget rule:** no implementer or test clicks Verify, Sample, Extract or Check with an Anthropic key present.
- **No implementer signs in as `markodjordjievski@gmail.com`** or writes org `default`/`mar` data. Browser checks use throwaway `check-*`/`smoke-*` identities. Back up the dev database (`docker exec robot-platform-db pg_dump -U postgres robot_platform > <scratchpad>/pre-variants.sql`) before running the migration on it.
- Commits by explicit path; messages end with a `Co-Authored-By:` line for the model that wrote them.
- Test gate per package: `pnpm --filter <pkg> test -- --maxWorkers=2`; Postgres (`robot-platform-db`) up.

## Review Focus

1. **A project with variants turned on but no website set up yet** (or a website with no proof pages captured). Expected: the Verification tab says what to do ("Take the screenshots first" / "Find products first"), never an empty or broken panel. Test: Task 6 view logic.
2. **Turning variants off again (`ignore`) after axes and setups exist.** Expected: nothing is deleted; axes and setups are kept and simply unused, so turning variants back on restores them. Test: Task 2.
3. **Deleting an axis that a website's setup maps to.** Expected: refused with the website named ("Nike uses Colour") — or, if the customer confirms, the mapping on that website is removed; never a dangling key. Plan rule: refuse. Test: Task 2.
4. **A page whose JSON-LD has `hasVariant` with one entry, or `offers[]` with one offer.** Expected: not a variant list (one is a product, not variants). Test: Task 3.
5. **A link group that is the site's navigation or related products** (many same-host links in a `nav` or "You may also like"). Expected: not taken as variant links — only groups inside a variant-like control. Test: Task 4.

---

## File map

- Create `packages/db/drizzle/0012_variants.sql` (+ meta snapshot via drizzle-kit); modify `packages/db/src/schema.ts`.
- Modify `packages/api/src/contract.ts` (+ test): `ContractField.level?`, `kind?`; `contractFields` excludes axes; `contractAxes`; `effectiveLevel`; `VARIANT_CONCEPTS`.
- Modify `packages/api/src/routers/datasets.ts` (+ `datasets-variants.test.ts`): `setVariantMode`, `setFieldLevel`, `addAxis`, `renameAxis`, `deleteAxis`; `getContract` → unchanged shape; new `variants` query.
- Create `packages/scraper/src/verify/variant-detect.ts` (+ test): `detectVariantList`, `VARIANT_AXIS_KEYS`, types.
- Create `packages/scraper/src/verify/variant-dom.ts` (+ test): `buildVariantLinksScript`, `buildVariantPickerScript`, result types.
- Modify `packages/api/src/routers/sources.ts` (+ `sources-variants.test.ts`): `detectVariants`, `setVariantSetup`; `sources.get` returns `variantSetup`; `projects.get` returns `variantMode`.
- Modify `packages/app/src/lib/fields-view.ts` (+ test), `packages/app/src/components/fields/fields-table.tsx`; create `packages/app/src/components/fields/variants-panel.tsx`.
- Create `packages/app/src/lib/site/variants-view.ts` (+ test), `packages/app/src/components/verification/variants-step.tsx`; modify the Verification route.
- Modify `packages/app/src/routes-smoke.test.ts`; docs: `docs/handoff.md`.

---

### Task 1: Storage and the contract's new shape

**Files:**
- Modify: `packages/db/src/schema.ts`; Create: `packages/db/drizzle/0012_variants.sql` (generate with drizzle-kit as earlier migrations were: read `packages/db/package.json` scripts and `docs/handoff.md` "migration" notes first)
- Modify: `packages/api/src/contract.ts`; Test: `packages/api/src/contract.test.ts`

**Interfaces — Produces:**

```ts
// db schema
datasets.variantMode: varchar('variant_mode', { length: 20 }).notNull().default('ignore')
sources.variantSetup: jsonb('variant_setup')            // null until a website is set up
// contract.ts
export type VariantMode = 'ignore' | 'row_per_variant' | 'nested';
export type FieldLevel = 'product' | 'variant';
export type ContractField = { key: string; name: string; type: CustomerFieldType; concept: string; description?: string; level?: FieldLevel; kind?: 'field' } & Record<string, unknown>;
export type ContractAxis = { key: string; name: string; kind: 'axis'; concept: 'axis' };
export const VARIANT_CONCEPTS: ReadonlySet<string>;     // the constraint's list
export function contractFields(schema: unknown): ContractField[];   // now excludes kind === 'axis'
export function contractAxes(schema: unknown): ContractAxis[];
export function effectiveLevel(f: Pick<ContractField, 'level' | 'concept'>): FieldLevel;
export type VariantSetup = { method: 'list' | 'links' | 'none'; axes: Array<{ from: string; axisKey: string }>; confirmedAt: string };
```

- [ ] **Step 1: Failing tests** in `contract.test.ts`:

```ts
describe('variants in the contract', () => {
  const schema = [
    { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
    { key: 'price', name: 'Price', type: 'money', concept: 'price' },
    { key: 'note', name: 'Note', type: 'text', concept: 'note', level: 'variant' },
    { key: 'colour', name: 'Colour', kind: 'axis', concept: 'axis' },
    { name: 'legacy operator field' },
  ];
  it('keeps axes out of the fields and lists them separately', () => {
    expect(contractFields(schema).map((f) => f.key)).toEqual(['title', 'price', 'note']);
    expect(contractAxes(schema)).toEqual([{ key: 'colour', name: 'Colour', kind: 'axis', concept: 'axis' }]);
  });
  it('levels come from the stored level, else from the concept', () => {
    expect(effectiveLevel({ concept: 'product_name' })).toBe('product');
    expect(effectiveLevel({ concept: 'price' })).toBe('variant');
    expect(effectiveLevel({ concept: 'sku' })).toBe('variant');
    expect(effectiveLevel({ concept: 'note' })).toBe('product');
    expect(effectiveLevel({ concept: 'note', level: 'variant' })).toBe('variant');
    expect(effectiveLevel({ concept: 'price', level: 'product' })).toBe('product');
  });
});
```

- [ ] **Step 2: FAIL** — `pnpm --filter @robot/api exec vitest run src/contract.test.ts`.
- [ ] **Step 3: Implement** the schema columns, the migration (`ALTER TABLE datasets ADD COLUMN variant_mode varchar(20) NOT NULL DEFAULT 'ignore'; ALTER TABLE sources ADD COLUMN variant_setup jsonb;`), and `contract.ts`:

```ts
export const VARIANT_CONCEPTS: ReadonlySet<string> = new Set(['price', 'regular_price', 'discount', 'unit_price', 'sku', 'url', 'availability', 'stock_count', 'image_url', 'additional_images']);
const isAxis = (f: unknown) => !!f && typeof f === 'object' && (f as { kind?: unknown }).kind === 'axis';
export function contractFields(schema: unknown): ContractField[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter((f): f is ContractField => !isAxis(f) && !!f && typeof f === 'object' && typeof (f as ContractField).key === 'string' && (f as ContractField).key.length > 0);
}
export function contractAxes(schema: unknown): ContractAxis[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter(isAxis).filter((a): a is ContractAxis => typeof (a as ContractAxis).key === 'string' && typeof (a as ContractAxis).name === 'string')
    .map((a) => ({ key: a.key, name: a.name, kind: 'axis' as const, concept: 'axis' as const }));
}
export function effectiveLevel(f: Pick<ContractField, 'level' | 'concept'>): FieldLevel {
  return f.level ?? (VARIANT_CONCEPTS.has(f.concept) ? 'variant' : 'product');
}
```

Run the migration on the dev database **after** the backup in Global Constraints (`pnpm db:migrate`). Check that every other reader of the dataset schema (`rg -n "dataset.*schema|\.schema\b" packages/api/src packages/scraper/src`) goes through `contractFields` or tolerates an axis entry; list any that doesn't in the report and route it through `contractFields`.
- [ ] **Step 4: PASS**, then `pnpm --filter @robot/db test -- --maxWorkers=2` and `pnpm --filter @robot/api test -- --maxWorkers=2`.
- [ ] **Step 5: Commit** (`packages/db/src/schema.ts packages/db/drizzle/0012_variants.sql packages/db/drizzle/meta/* packages/api/src/contract.ts packages/api/src/contract.test.ts` and any reader fixed) — `feat(db,api): a project's variant setting, field levels and axes`.

---

### Task 2: API — the project's variant setting, field levels and axes

**Files:** Modify `packages/api/src/routers/datasets.ts`, `packages/api/src/routers/projects.ts` (`projects.get` returns `variantMode`); Test: create `packages/api/src/routers/datasets-variants.test.ts`.

**Interfaces — Produces** (all org-scoped through `loadDatasetInOrg`, all schema writes inside the existing `lockDatasetSchema` transaction pattern):

```ts
datasets.variants({ datasetId }) → { mode: VariantMode; fields: Array<{ key; name; level: FieldLevel; levelIsDefault: boolean }>; axes: ContractAxis[] }
datasets.setVariantMode({ datasetId, mode: VariantMode }) → { mode }
datasets.setFieldLevel({ datasetId, key, level: FieldLevel | null }) → { key, level: FieldLevel }   // null = back to the default by concept
datasets.addAxis({ datasetId, name }) → ContractAxis                 // key via deriveKey; name free among fields and axes
datasets.renameAxis({ datasetId, key, name }) → ContractAxis
datasets.deleteAxis({ datasetId, key }) → { ok: true }               // PRECONDITION_FAILED "{website} uses {axis}" when any website's variantSetup maps to it
```

- Setting the mode never deletes axes, levels or setups (Review Focus 2).
- `setFieldLevel` refuses `NOT_FOUND` for an unknown key and never changes `fieldHash` (level is not hashed — levels change rows, not what a field means).

- [ ] **Step 1: Failing tests** (follow `datasets-fields.test.ts` / `datasets-org.test.ts` for setup and a second org):

```ts
describe('variants on the contract', () => {
  it('turns variants on and off without losing axes or levels', async () => {
    const p = await caller.projects.create({ name: `${tag} v` });
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money', concept: 'price' });
    const a = await caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' });
    await caller.datasets.setVariantMode({ datasetId: p.datasetId, mode: 'row_per_variant' });
    await caller.datasets.setVariantMode({ datasetId: p.datasetId, mode: 'ignore' });
    const v = await caller.datasets.variants({ datasetId: p.datasetId });
    expect(v.mode).toBe('ignore');
    expect(v.axes).toEqual([a]);
    expect(v.fields.find((f) => f.name === 'Price')).toMatchObject({ level: 'variant', levelIsDefault: true });
  });
  it('a field level can be set and reset to its default', async () => { /* setFieldLevel product → level product, levelIsDefault false; null → variant, true */ });
  it('an axis name may not repeat a field or another axis', async () => { /* addAxis 'Price' → BAD_REQUEST or the existing assertNameFree code */ });
  it('refuses to delete an axis a website maps to, naming the website', async () => {
    // create a website, write sources.variantSetup directly with axes [{ from: 'color', axisKey }], expect PRECONDITION_FAILED with the website's name
  });
  it('is invisible from another organisation', async () => { /* every new procedure from org B → NOT_FOUND */ });
});
```

- [ ] **Step 2: FAIL**, **Step 3: implement**, **Step 4: PASS** + `pnpm --filter @robot/api test -- --maxWorkers=2`.
- [ ] **Step 5: Commit** — `feat(api): a project's variant setting, field levels and axes`.

---

### Task 3: Scraper — variant lists in the page data

**Files:** Create `packages/scraper/src/verify/variant-detect.ts` (+ `.test.ts`); export from `verify/index.ts`.

**Interfaces — Produces:**

```ts
export const VARIANT_AXIS_KEYS: readonly string[];   // 'color','colour','size','length','width','height','material','pattern','style','capacity','flavor','flavour','scent','finish','option1','option2','option3'
export type VariantList = {
  source: 'json-ld' | 'api';
  path: string;                 // dot path to the array, e.g. 'hasVariant', 'offers', 'product.variants'
  count: number;
  axes: string[];               // axis keys found on the entries, in VARIANT_AXIS_KEYS order (schema.org variesBy first when present)
  entries: Array<Record<string, string>>;   // up to 50: each entry's axis values plus sku/price when present, as text
};
export function detectVariantLists(capture: CaptureLike): VariantList[];   // best first
```

**Rules:**
- JSON-LD: an object with `@type` `ProductGroup` (or any object with a `hasVariant` array) → the `hasVariant` array; axes = `variesBy` values with the `https://schema.org/` prefix removed and lower-cased, else entry keys in `VARIANT_AXIS_KEYS`. A `Product` whose `offers` is an array of ≥ 2 objects where each has `sku` or `price` → that array.
- API bodies (`capture.interceptedRequests`, `isJson`): any array of ≥ 2 plain objects, reachable within depth 6, where ≥ 2 entries have one of `sku`, `price`, `id`/`variant_id` **and** at least one key in `VARIANT_AXIS_KEYS` or an `options`/`selectedOptions` array.
- An array of 1 entry is never a variant list (Review Focus 4).
- `entries`: per entry, each axis key's value as text (for `selectedOptions`/`options` arrays of `{name, value}`, `name.toLowerCase()` → value), plus `sku` (from `sku`/`mpn`/`productID`) and `price` (from `price`/`offers.price`) when present.
- Sort: JSON-LD before API; longer `count` first; at most 3 lists returned.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import nike from '../__fixtures__/corpus/nike-air-jordan-detail.json';
import { detectVariantLists } from './variant-detect.js';

const cap = (ldJson: unknown[], apis: unknown[] = []) => ({ url: 'https://s.example/p/1', html: '', structuredData: { ldJson, nextData: null, initialState: null, meta: {} },
  interceptedRequests: apis.map((parsedJson, i) => ({ url: `https://s.example/api/${i}`, method: 'GET', status: 200, isJson: true, parsedJson })) });

describe('detectVariantLists', () => {
  it('finds Nike\'s colour variants in its ProductGroup', () => {
    const lists = detectVariantLists(cap((nike as { structuredData: { ldJson: unknown[] } }).structuredData.ldJson));
    expect(lists[0]).toMatchObject({ source: 'json-ld', count: 2, axes: ['color'] });
    expect(lists[0]!.entries[0]).toMatchObject({ color: 'Black/Varsity Red', sku: '850000-003' });
  });
  it('finds an offers list with a SKU per entry', () => {
    const l = detectVariantLists(cap([{ '@type': 'Product', offers: [{ sku: 'A-S', size: 'S', price: '10' }, { sku: 'A-M', size: 'M', price: '10' }] }]));
    expect(l[0]).toMatchObject({ path: 'offers', count: 2, axes: ['size'] });
  });
  it('finds a Shopify-like API variants list', () => {
    const l = detectVariantLists(cap([], [{ product: { variants: [{ id: 1, sku: 'X1', option1: 'Red', price: '5' }, { id: 2, sku: 'X2', option1: 'Blue', price: '5' }] } }]));
    expect(l[0]).toMatchObject({ source: 'api', path: 'product.variants', count: 2, axes: ['option1'] });
  });
  it('one entry is a product, not variants', () => {
    expect(detectVariantLists(cap([{ '@type': 'ProductGroup', hasVariant: [{ sku: 'only' }] }, { '@type': 'Product', offers: [{ sku: 'x', price: 1 }] }]))).toEqual([]);
  });
  it('ignores arrays that look like lists but carry no variant data', () => {
    expect(detectVariantLists(cap([], [{ reviews: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }]))).toEqual([]);
  });
});
```

(Read the fixture's real shape first — if `structuredData` sits under `capture`, adjust the access.)
- [ ] **Step 2: FAIL**, **Step 3: implement**, **Step 4: PASS** + `pnpm --filter @robot/scraper test -- --maxWorkers=2`.
- [ ] **Step 5: Commit** — `feat(scraper): find a product's variants listed in its page data`.

---

### Task 4: Scraper — variant links and pickers on the page

**Files:** Create `packages/scraper/src/verify/variant-dom.ts` (+ `.test.ts`, real Chromium as `dom-scripts.test.ts` does); export from `verify/index.ts`.

**Interfaces — Produces:**

```ts
export type VariantLinks = { container: string; count: number; links: Array<{ href: string; label: string }> };   // container: a short CSS-ish description for the report
export type VariantPicker = { axis: string; options: string[] };
export function buildVariantLinksScript(pageUrl: string): string;   // evaluates to VariantLinks[]
export function buildVariantPickerScript(): string;                 // evaluates to VariantPicker[]
```

**Rules (in-page, dependency-free like `dom-scripts.ts`):**
- A **variant-like control** is an element whose `class`, `id`, `data-*` attribute names/values or `aria-label` match `/variant|swatch|colou?r|size|option|style|length|material/i`, and which is not inside `nav`, `header`, `footer`, or an element matching `/related|recommend|also|similar|recently|upsell|cross-?sell|breadcrumb/i` (Review Focus 5).
- **Links:** inside one such control, ≥ 2 `a[href]` with distinct resolved hrefs on the page's host (the current page's own URL may be one of them). Label = trimmed text, else `title`, else `aria-label`, else an inner `img` `alt`. One result per control, largest first; at most 3.
- **Pickers:** inside such controls, a `select` with ≥ 2 non-empty options, or a group of ≥ 2 `input[type=radio]` sharing a `name`, or ≥ 2 `button`s with distinct labels; `axis` = the control's label (`aria-label`, an associated `label`, a `legend`, or the matching word from the class, lower-cased); `options` = the labels.

- [ ] **Step 1: Failing tests** with fixture HTML through `browser.setContentEvaluate`:

```ts
const html = `<html><body>
  <nav><a href="/c/chairs">Chairs</a><a href="/c/tables">Tables</a></nav>
  <div class="product-swatches" aria-label="Colour">
    <a href="/p/shoe?color=black"><img alt="Black"></a>
    <a href="/p/shoe?color=red" title="Red"></a>
    <a href="/p/shoe?color=white">White</a>
  </div>
  <div class="size-selector"><label for="sz">Size</label><select id="sz"><option value="">Choose</option><option>8</option><option>9</option></select></div>
  <section class="related-products"><div class="swatch"><a href="/p/other-1">A</a><a href="/p/other-2">B</a></div></section>
</body></html>`;
it('finds the colour links, not the navigation or related products', async () => {
  const links = await browser.setContentEvaluate<VariantLinks[]>(html, buildVariantLinksScript('https://s.example/p/shoe?color=black'));
  expect(links).toHaveLength(1);
  expect(links[0]!.links.map((l) => l.label)).toEqual(['Black', 'Red', 'White']);
});
it('finds the size picker', async () => {
  const pickers = await browser.setContentEvaluate<VariantPicker[]>(html, buildVariantPickerScript());
  expect(pickers).toEqual([{ axis: 'size', options: ['8', '9'] }]);
});
```

- [ ] **Step 2: FAIL**, **Step 3: implement**, **Step 4: PASS** + the scraper gate.
- [ ] **Step 5: Commit** — `feat(scraper): find variant links and pickers on a product page`.

---

### Task 5: API — detect a website's variants, record its setup

**Files:** Modify `packages/api/src/routers/sources.ts` (+ `sources.get` returns `variantSetup`); Test: create `packages/api/src/routers/sources-variants.test.ts`.

**Interfaces — Produces:**

```ts
sources.detectVariants({ sourceId }) → {
  pages: Array<{ url: string; captured: boolean; lists: VariantList[]; links: VariantLinks[]; pickers: VariantPicker[] }>;   // one per proof page, in order
  suggested: 'list' | 'links' | 'none';   // list if any page has a list; else links if any page has links; else none
}
sources.setVariantSetup({ sourceId, method: 'list' | 'links' | 'none', axes: Array<{ from: string; axisKey?: string; newAxisName?: string }> }) → VariantSetup
```

- `detectVariants`: `sourceInOrg`; proof URLs from the verification set; captures via `loadProofPageCaptures` (fresh only; a page without one → `captured: false`); lists via `detectVariantLists(capture)`; links and pickers via one `withBrowserSession` evaluating the two scripts over each capture's HTML (`setContentEvaluate`) — no navigation, no model.
- `setVariantSetup`: `sourceInOrg`; for each `{ from, newAxisName }` creates the axis on the dataset (same transaction and name rules as `addAxis`); `axisKey` must be an existing axis (else `BAD_REQUEST`); writes `sources.variant_setup = { method, axes: [{ from, axisKey }], confirmedAt: now }`. `method: 'none'` clears `axes`.

- [ ] **Step 1: Failing tests** (seed proof-page captures as `sources-marks.test.ts` does — reuse its `seedProofPage` pattern with a variant HTML/JSON-LD fixture; launch `PlaywrightBrowser` like that file):
  - detection over three seeded captures (two with a `hasVariant` list, one without) → `suggested: 'list'`, page 3 lists `[]`;
  - a page without a capture → `captured: false`;
  - `setVariantSetup` with one new axis ("Colour") creates it on the dataset and stores the mapping; a second call with `axisKey` of it reuses it; `method: 'none'` clears axes;
  - an unknown `axisKey` → `BAD_REQUEST`; another org → `NOT_FOUND` for both procedures.
- [ ] **Step 2: FAIL**, **Step 3: implement**, **Step 4: PASS** + the api gate.
- [ ] **Step 5: Commit** — `feat(api): detect a website's variants from its proof pages and record its setup`.

---

### Task 6: App — the Fields page's Variants panel and the Verification tab's Variants step

**Files:**
- Modify `packages/app/src/lib/fields-view.ts` (+ test); create `packages/app/src/components/fields/variants-panel.tsx`; modify `packages/app/src/routes/_app/projects/$project/fields.tsx` to mount it.
- Create `packages/app/src/lib/site/variants-view.ts` (+ test); create `packages/app/src/components/verification/variants-step.tsx`; modify the Verification route to mount it.
- Modify `packages/app/src/routes-smoke.test.ts`; `docs/handoff.md`.

**Interfaces — Produces:**

```ts
// fields-view.ts
export const VARIANT_MODE_LABELS: Record<'ignore' | 'row_per_variant' | 'nested', string>;  // 'No variants' / 'One row per variant' / 'One row per product, variants listed inside'
// variants-view.ts
export type VariantsStepState =
  | { kind: 'off' }                                         // project mode is ignore → step not shown
  | { kind: 'no-pages'; reason: string }                    // "Find products first" / "Wait for the screenshots"
  | { kind: 'found'; summary: string[]; suggested: 'list' | 'links' | 'none'; axes: Array<{ from: string; label: string; options: string[] }>; pickerOnly: string[] }
  | { kind: 'set'; method: 'list' | 'links' | 'none'; axes: Array<{ from: string; axisName: string }> };
export function variantsStepState(args: { mode: string; cards: number; detection: DetectResult | null; setup: VariantSetup | null; axes: Array<{ key: string; name: string }> }): VariantsStepState;
export function summaryLines(detection: DetectResult): string[];   // e.g. "Listed in the page data: 2 colours on product 1, none on product 3"
```

**Behaviour:**
- **Fields page:** a "Variants" panel above the field list — a three-way choice (`datasets.setVariantMode`); when not "No variants": each field row shows its level as a two-option control ("Same for every variant" / "Differs per variant") calling `datasets.setFieldLevel` (a "default" marker when `levelIsDefault`); an "Axes" list (Colour, Size…) with rename and delete (delete shows the API's refusal reason).
- **Verification tab:** when the project's mode is not `ignore`, a "Variants" panel under the table:
  - `no-pages` → its reason;
  - `found` → the summary lines (from `sources.detectVariants`, fetched once per set of captured proof pages), a method choice preselected to `suggested` ("Listed in the page data" / "Linked as separate pages" / "No variants on this website"), for each detected axis a select "becomes column: [existing axis…] / New column 'Colour'", the picker-only line ("Only in a picker on the page: sizes — not collected in this version"), and **Confirm** → `sources.setVariantSetup`;
  - `set` → one line ("Variants: linked as separate pages · Colour") with **Change**.
  - Never blocks Verify or Extract in this plan (gating is plan 2).
- `summaryLines` words counts with the axis name in plain words (`color`/`colour` → "colours", `size` → "sizes", `option1` → "options").

- [ ] **Step 1: Failing view tests** (`variants-view.test.ts`, `fields-view.test.ts`): each `VariantsStepState` kind from its inputs (incl. Review Focus 1: mode on, no cards → "Find products first"; cards but no captures → "Wait for the screenshots"); `summaryLines` for a list on two of three pages, links on all three, picker-only sizes; mode labels.
- [ ] **Step 2: FAIL → implement the view logic → PASS.**
- [ ] **Step 3: Components and route wiring.**
- [ ] **Step 4: Verify** — `tsc --noEmit`; `pnpm --filter @robot/app test -- --maxWorkers=2`; with `pnpm dev:all` up, extend the smoke: turn variants on in the throwaway project, see the Fields panel; on the website (its fixture product pages get a `hasVariant` JSON-LD block with two colours added to the smoke's local server), see "Listed in the page data: 2 colours…", confirm with a new "Colour" column, reload and see the `set` line. Never click Verify. Restore screenshots not meant to change.
- [ ] **Step 5: Docs** — a handoff section "Variants plan 1 (2026-10-0x)" (what landed, how to run, what plans 2–3 add) and its "Read this first" line.
- [ ] **Step 6: Commit** by explicit paths — `feat(app): variants on the Fields page and the website's Variants step`.
