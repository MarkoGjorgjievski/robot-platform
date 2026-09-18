# Schema Stepper — Step 1, Fields and the Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Schema tab becomes a stepper whose first step lets a customer build the project's field list from a per-schema-type catalogue (Product, Article, …) or by hand, with today's grid standing in as step 2 until the pages and mark screens land.

**Architecture:** A static catalogue module in `@robot/api` (entries carry key, name, type, description and concept) is exposed as `datasets.catalogue`; `datasets.addField` accepts the entry's description and concept so a catalogue field arrives on every website already described and correctly conceptualised. The dashboard adds a `FieldCatalogue` component (type tabs, grouped chips) used by the project home's `ContractEditor` and by the Schema tab's new `1 · Fields` section; the tab's `?step=fields|pages` search param drives the Extract tab's existing `Stepper`/`Section` components; the grid is wrapped unchanged as `2 · Pages and values`.

**Tech Stack:** TypeScript ESM, tRPC v11 + Zod, Drizzle/Postgres (api tests need the dev DB), React 19 + TanStack Router, Tailwind v4, Vitest, Playwright for the smoke run and the look-only check.

**Spec:** `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md` — §2 (flow), §2.1 (Fields), §2.5 (arrivals), §7 item 3. The engine plan `docs/superpowers/plans/2026-09-18-schema-stepper-engine.md` is merged; nothing there changes here.

## Global Constraints

- ESM everywhere; imports end in `.js` in packages (`.tsx`/`.ts` imports in the dashboard have no extension, matching its existing files).
- Run one package's tests at a time with `pnpm --filter <pkg> exec vitest run --maxWorkers=1 <name>` (the `test --` form does not filter here; `pnpm -r test` gets killed for memory). `@robot/api` tests need Postgres up.
- Commit with explicit paths only: `git add <paths>` then `git commit -m "…" -- <paths>` (shared checkout).
- Copy rules (spec 2026-09-08 §7, in force on every customer screen): sentence case, no uppercase labels, no cards outside dialogs and the websites list; names in Public Sans, keys/types/values in mono; `label-soft`, `sheet`, `btn-primary`, `btn-quiet`, `strip` utilities from `packages/dashboard/src/styles.css`. Wording is customer-facing: "website", "field", "page", never "source", "binding", "dataset".
- Spec §2.1 verbatim: schema types "Product, Listing item, Article, Job, Property, Event, Custom"; Product groups *Identity* (title, subtitle, brand, SKU, GTIN, product URL), *Price* (price, was-price, currency, discount, unit price), *Availability* (in stock, stock count, delivery), *Content* (description, bullet points, specifications), *Media* (main image, gallery), *Rating* (rating, review count), *Taxonomy* (category, breadcrumbs, tags); "20 to 30 entries per type"; "Add your own adds a custom field with a name and a type"; for a later website "shared with n websites" and "This adds the field to n websites"; "Next is enabled with at least one field".
- Spec §2.5: after `sources.createInProject`, navigate to `?step=fields` when the project has no fields, else `?step=pages`.
- Spec amendment (engine plan): the API requires a location hint per field; a catalogue field's description is that hint's default.
- Nothing in the grid, verification, or the engine changes. `deriveConcept` is untouched: a catalogue entry's explicit `concept` bypasses it.
- Before the branch is called done, the real tab is looked at with Playwright (memory rule: unit tests and reviews passed while three UI defects sat on screen on 2026-09-17).

---

## File map

| File | Responsibility |
|---|---|
| `packages/api/src/schema-catalogue.ts` (new) | `SCHEMA_TYPES`, `CATALOGUE`, `catalogueEntry(type, key)` |
| `packages/api/src/routers/datasets.ts` | `datasets.catalogue`; `addField` takes `description`/`concept`; `propagate` add uses the description |
| `packages/api/src/contract.ts` | `ContractField.description?`; `bindingFor` defaults a website's hint to it |
| `packages/dashboard/src/lib/schema-stepper-view.ts` (new) | pure: `stepOf(search, fieldCount)`, `stepStates(step, fieldCount)`, `sharedNote(websiteCount)` |
| `packages/dashboard/src/components/field-catalogue.tsx` (new) | type tabs + grouped chips; `onAdd(entry)`; added chips disabled |
| `packages/dashboard/src/components/contract-editor.tsx` | catalogue below the list; `websiteCount` note; `addField` sends description/concept |
| `packages/dashboard/src/router.tsx` | `step` search param on the Schema route |
| `packages/dashboard/src/routes/source-schema.tsx` | stepper strip, `1 · Fields`, `2 · Pages and values`; empty state removed |
| `packages/dashboard/src/routes/project-home.tsx` | Add website navigates to `?step=fields` or `?step=pages` |
| `packages/dashboard/src/routes-smoke.test.ts` | step 1 walk |
| `docs/testing/ui-check-schema-step1.mts` (new) | look-only browser check |

---

### Task 1: The catalogue module and `datasets.catalogue`

**Files:**
- Create: `packages/api/src/schema-catalogue.ts`
- Modify: `packages/api/src/routers/datasets.ts` (add the query next to `getContract`)
- Test: `packages/api/src/schema-catalogue.test.ts` (new), `packages/api/src/routers/datasets-fields.test.ts` (one case)

**Interfaces:**
- Produces:
  ```ts
  export const SCHEMA_TYPES = ['product', 'listing_item', 'article', 'job', 'property', 'event', 'custom'] as const;
  export type SchemaType = (typeof SCHEMA_TYPES)[number];
  export type CatalogueEntry = { key: string; name: string; type: CustomerFieldType; description: string; concept: string };
  export type CatalogueGroup = { name: string; entries: CatalogueEntry[] };
  export type Catalogue = Record<SchemaType, { label: string; groups: CatalogueGroup[] }>;
  export const CATALOGUE: Catalogue;
  export function catalogueEntry(type: SchemaType, key: string): CatalogueEntry | undefined;
  // datasets.catalogue() → Catalogue (no input)
  ```
- `concept` values come from the vocabulary the engine already knows (`deriveConcept`'s `ALIASES` plus `structured-extractor.ts`'s `FIELD_ALIASES` keys): `product_name, price, regular_price, currency, description, image_url, additional_images, brand, sku, availability, rating, review_count, url, category, seller, discount_amount, discount_percentage, shipping_info, product_dimensions, product_features`; an entry outside that vocabulary uses its own key as concept (the suggester falls back to the key as a path tail).

- [ ] **Step 1: Failing tests**

`packages/api/src/schema-catalogue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CUSTOMER_FIELD_TYPES, deriveKey } from '@robot/scraper';
import { CATALOGUE, SCHEMA_TYPES, catalogueEntry } from './schema-catalogue.js';

const KNOWN_CONCEPTS = new Set(['product_name', 'price', 'regular_price', 'currency', 'description', 'image_url', 'additional_images', 'brand', 'sku', 'availability', 'rating', 'review_count', 'url', 'category', 'seller', 'discount_amount', 'discount_percentage', 'shipping_info', 'product_dimensions', 'product_features']);

describe('schema catalogue', () => {
  it('has every schema type, with a label', () => {
    for (const t of SCHEMA_TYPES) expect(CATALOGUE[t].label.length).toBeGreaterThan(0);
  });
  it('product has the seven groups from the spec, 20 to 30 entries in all; custom has none', () => {
    expect(CATALOGUE.product.groups.map((g) => g.name)).toEqual(['Identity', 'Price', 'Availability', 'Content', 'Media', 'Rating', 'Taxonomy']);
    const n = CATALOGUE.product.groups.flatMap((g) => g.entries).length;
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThanOrEqual(30);
    expect(CATALOGUE.custom.groups).toEqual([]);
  });
  it('every entry has a unique key within its type, a valid field type, a description, and a concept that is known or its own key', () => {
    for (const t of SCHEMA_TYPES) {
      const entries = CATALOGUE[t].groups.flatMap((g) => g.entries);
      expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
      for (const e of entries) {
        expect(e.key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(e.name.trim().length).toBeGreaterThan(0);
        expect(e.name).toBe(e.name.charAt(0).toUpperCase() + e.name.slice(1)); // sentence case: first letter capital
        expect(CUSTOMER_FIELD_TYPES).toContain(e.type);
        expect(e.description.trim().length).toBeGreaterThan(0);
        expect(KNOWN_CONCEPTS.has(e.concept) || e.concept === e.key).toBe(true);
        // addField mints the key from the name; the chip's "added" state matches the contract by key, so the two must agree.
        expect(deriveKey(e.name, new Set())).toBe(e.key);
      }
    }
  });
  it('the live-check concepts are right: currency is currency, product id is sku, was price is regular_price', () => {
    expect(catalogueEntry('product', 'price_currency')?.concept).toBe('currency');
    expect(catalogueEntry('product', 'sku')?.concept).toBe('sku');
    expect(catalogueEntry('product', 'was_price')?.concept).toBe('regular_price');
    expect(catalogueEntry('product', 'nope')).toBeUndefined();
  });
});
```

`datasets-fields.test.ts`, appended:

```ts
describe('datasets.catalogue', () => {
  it('returns the catalogue', async () => {
    const c = await caller.datasets.catalogue();
    expect(Object.keys(c).sort()).toEqual([...SCHEMA_TYPES].sort());
    expect(c.product.groups[0]!.entries[0]!.key).toBe('title');
  });
});
```

(import `SCHEMA_TYPES` from `../schema-catalogue.js` at the top of that file).

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/api exec vitest run --maxWorkers=1 schema-catalogue datasets-fields` → module missing.

- [ ] **Step 3: Implement `schema-catalogue.ts`**

```ts
// packages/api/src/schema-catalogue.ts
// The field catalogue behind step 1 of the Schema tab (spec 2026-09-18 §2.1):
// what a customer scraping a product page (or an article, a job, …) usually
// wants, as chips they add with one click. Static on purpose: no model, and a
// list a human wrote and can read. `concept` says what an entry IS in the
// engine's vocabulary, so a catalogue field suggests and caches correctly
// without going through `deriveConcept`'s name guessing (which read
// "price currency" as a price on 2026-09-18). `description` is the website's
// default location hint, the one the API requires per field.
import type { CustomerFieldType } from '@robot/scraper';

export const SCHEMA_TYPES = ['product', 'listing_item', 'article', 'job', 'property', 'event', 'custom'] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export type CatalogueEntry = { key: string; name: string; type: CustomerFieldType; description: string; concept: string };
export type CatalogueGroup = { name: string; entries: CatalogueEntry[] };
export type Catalogue = Record<SchemaType, { label: string; groups: CatalogueGroup[] }>;

const e = (key: string, name: string, type: CustomerFieldType, description: string, concept = key): CatalogueEntry => ({ key, name, type, description, concept });

export const CATALOGUE: Catalogue = {
  product: {
    label: 'Product',
    groups: [
      { name: 'Identity', entries: [
        e('title', 'Title', 'text', 'The product name as shown in the page heading', 'product_name'),
        e('subtitle', 'Subtitle', 'text', 'The line under the product name: variant, colour or short description'),
        e('brand', 'Brand', 'text', 'The brand or manufacturer', 'brand'),
        e('sku', 'SKU', 'text', 'The seller\'s article number or product code', 'sku'),
        e('gtin', 'GTIN', 'text', 'The barcode number (EAN, UPC, ISBN)', 'sku'),
        e('product_url', 'Product URL', 'url', 'The canonical address of the product page', 'url'),
      ] },
      { name: 'Price', entries: [
        e('price', 'Price', 'money', 'The price the customer pays now', 'price'),
        e('was_price', 'Was price', 'money', 'The crossed-out or previous price', 'regular_price'),
        e('price_currency', 'Price currency', 'text', 'The currency of the price (code or symbol)', 'currency'),
        e('discount', 'Discount', 'text', 'The saving shown next to the price, as an amount or a percentage', 'discount_amount'),
        e('unit_price', 'Unit price', 'money', 'The price per unit of measure (per kg, per litre)'),
      ] },
      { name: 'Availability', entries: [
        e('in_stock', 'In stock', 'boolean', 'Whether the product can be bought now', 'availability'),
        e('stock_count', 'Stock count', 'number', 'How many are left, when the page says'),
        e('delivery', 'Delivery', 'text', 'The delivery promise or shipping information', 'shipping_info'),
      ] },
      { name: 'Content', entries: [
        e('description', 'Description', 'text', 'The main product description', 'description'),
        e('bullet_points', 'Bullet points', 'text_list', 'The highlights or key features list', 'product_features'),
        e('specifications', 'Specifications', 'text', 'The technical details or specification table', 'product_dimensions'),
      ] },
      { name: 'Media', entries: [
        e('main_image', 'Main image', 'image', 'The primary product photo', 'image_url'),
        e('gallery', 'Gallery', 'text_list', 'The other product photos', 'additional_images'),
      ] },
      { name: 'Rating', entries: [
        e('rating', 'Rating', 'number', 'The average customer rating', 'rating'),
        e('review_count', 'Review count', 'number', 'How many reviews the rating is based on', 'review_count'),
      ] },
      { name: 'Taxonomy', entries: [
        e('category', 'Category', 'text', 'The category the product is filed under', 'category'),
        e('breadcrumbs', 'Breadcrumbs', 'text_list', 'The breadcrumb trail above the product'),
        e('tags', 'Tags', 'text_list', 'Labels or badges shown on the product'),
      ] },
    ],
  },
  listing_item: {
    label: 'Listing item',
    groups: [
      { name: 'Item', entries: [
        e('title', 'Title', 'text', 'The item name on the listing card', 'product_name'),
        e('item_url', 'Item URL', 'url', 'The link from the card to the item page', 'url'),
        e('thumbnail', 'Thumbnail', 'image', 'The card image', 'image_url'),
        e('price', 'Price', 'money', 'The price on the card', 'price'),
        e('was_price', 'Was price', 'money', 'The crossed-out price on the card', 'regular_price'),
        e('rating', 'Rating', 'number', 'The rating on the card', 'rating'),
        e('review_count', 'Review count', 'number', 'The number of reviews on the card', 'review_count'),
        e('badge', 'Badge', 'text', 'A label such as New, Sale or Bestseller'),
        e('in_stock', 'In stock', 'boolean', 'Whether the card says it can be bought', 'availability'),
        e('position', 'Position', 'number', 'The item\'s position in the listing'),
      ] },
    ],
  },
  article: {
    label: 'Article',
    groups: [
      { name: 'Identity', entries: [
        e('headline', 'Headline', 'text', 'The article title', 'product_name'),
        e('subheading', 'Subheading', 'text', 'The standfirst or deck under the headline'),
        e('author', 'Author', 'text', 'The byline'),
        e('published_date', 'Published date', 'date', 'The publication date'),
        e('updated_date', 'Updated date', 'date', 'The last-updated date, when shown'),
        e('article_url', 'Article URL', 'url', 'The canonical address of the article', 'url'),
      ] },
      { name: 'Content', entries: [
        e('body', 'Body', 'text', 'The article text'),
        e('summary', 'Summary', 'text', 'The abstract or lead paragraph', 'description'),
        e('main_image', 'Main image', 'image', 'The lead image', 'image_url'),
        e('image_caption', 'Image caption', 'text', 'The caption under the lead image'),
      ] },
      { name: 'Taxonomy', entries: [
        e('section', 'Section', 'text', 'The section or category the article sits in', 'category'),
        e('tags', 'Tags', 'text_list', 'The topic tags'),
        e('word_count', 'Word count', 'number', 'The length, when shown'),
        e('comment_count', 'Comment count', 'number', 'The number of comments'),
      ] },
    ],
  },
  job: {
    label: 'Job',
    groups: [
      { name: 'Position', entries: [
        e('job_title', 'Job title', 'text', 'The position title', 'product_name'),
        e('company', 'Company', 'text', 'The employer', 'brand'),
        e('location', 'Location', 'text', 'Where the job is based'),
        e('remote', 'Remote', 'boolean', 'Whether the job can be done remotely'),
        e('employment_type', 'Employment type', 'text', 'Full-time, part-time, contract'),
        e('seniority', 'Seniority', 'text', 'The level: junior, senior, lead'),
        e('job_url', 'Job URL', 'url', 'The canonical address of the posting', 'url'),
      ] },
      { name: 'Pay', entries: [
        e('salary_from', 'Salary from', 'money', 'The lower end of the salary range', 'price'),
        e('salary_to', 'Salary to', 'money', 'The upper end of the salary range'),
        e('salary_period', 'Salary period', 'text', 'Per year, per month, per hour'),
        e('currency', 'Currency', 'text', 'The currency of the salary', 'currency'),
      ] },
      { name: 'Details', entries: [
        e('description', 'Description', 'text', 'The job description', 'description'),
        e('requirements', 'Requirements', 'text_list', 'The requirements list', 'product_features'),
        e('benefits', 'Benefits', 'text_list', 'The benefits list'),
        e('posted_date', 'Posted date', 'date', 'When the job was posted'),
        e('closing_date', 'Closing date', 'date', 'The application deadline'),
        e('department', 'Department', 'text', 'The team or department', 'category'),
      ] },
    ],
  },
  property: {
    label: 'Property',
    groups: [
      { name: 'Identity', entries: [
        e('title', 'Title', 'text', 'The listing headline', 'product_name'),
        e('address', 'Address', 'text', 'The street address or area'),
        e('property_type', 'Property type', 'text', 'House, flat, land', 'category'),
        e('listing_type', 'Listing type', 'text', 'For sale or to rent'),
        e('reference', 'Reference', 'text', 'The agent\'s reference number', 'sku'),
        e('property_url', 'Property URL', 'url', 'The canonical address of the listing', 'url'),
      ] },
      { name: 'Price', entries: [
        e('price', 'Price', 'money', 'The asking price or rent', 'price'),
        e('price_currency', 'Price currency', 'text', 'The currency of the price', 'currency'),
        e('price_period', 'Price period', 'text', 'Per month, per week, when renting'),
      ] },
      { name: 'Size', entries: [
        e('bedrooms', 'Bedrooms', 'number', 'The number of bedrooms'),
        e('bathrooms', 'Bathrooms', 'number', 'The number of bathrooms'),
        e('floor_area', 'Floor area', 'number', 'The internal area'),
        e('plot_area', 'Plot area', 'number', 'The land area'),
        e('year_built', 'Year built', 'number', 'The construction year'),
      ] },
      { name: 'Content', entries: [
        e('description', 'Description', 'text', 'The listing description', 'description'),
        e('features', 'Features', 'text_list', 'The features list', 'product_features'),
        e('main_image', 'Main image', 'image', 'The primary photo', 'image_url'),
        e('agent', 'Agent', 'text', 'The listing agent or agency', 'seller'),
        e('energy_rating', 'Energy rating', 'text', 'The energy performance rating'),
      ] },
    ],
  },
  event: {
    label: 'Event',
    groups: [
      { name: 'Identity', entries: [
        e('title', 'Title', 'text', 'The event name', 'product_name'),
        e('organiser', 'Organiser', 'text', 'Who runs the event', 'brand'),
        e('event_url', 'Event URL', 'url', 'The canonical address of the event page', 'url'),
        e('category', 'Category', 'text', 'Concert, conference, sport', 'category'),
      ] },
      { name: 'When and where', entries: [
        e('start_date', 'Start date', 'date', 'The start date'),
        e('end_date', 'End date', 'date', 'The end date'),
        e('venue', 'Venue', 'text', 'The venue name'),
        e('address', 'Address', 'text', 'The venue address'),
        e('online', 'Online', 'boolean', 'Whether the event is online'),
      ] },
      { name: 'Tickets', entries: [
        e('price', 'Price', 'money', 'The ticket price, or the lowest one', 'price'),
        e('price_currency', 'Price currency', 'text', 'The currency of the price', 'currency'),
        e('tickets_available', 'Tickets available', 'boolean', 'Whether tickets can still be bought', 'availability'),
      ] },
      { name: 'Content', entries: [
        e('description', 'Description', 'text', 'The event description', 'description'),
        e('main_image', 'Main image', 'image', 'The event image', 'image_url'),
        e('performers', 'Performers', 'text_list', 'Who performs or speaks'),
      ] },
    ],
  },
  custom: { label: 'Custom', groups: [] },
};

export function catalogueEntry(type: SchemaType, key: string): CatalogueEntry | undefined {
  return CATALOGUE[type].groups.flatMap((g) => g.entries).find((en) => en.key === key);
}
```

`datasets.ts`, after `getContract`:

```ts
  /** The field catalogue for step 1 of the Schema tab (spec 2026-09-18 §2.1): static, all types at once. */
  catalogue: publicProcedure.query(() => CATALOGUE),
```

with `import { CATALOGUE } from '../schema-catalogue.js';`.

- [ ] **Step 4: Run, expect pass** — same command. Product count: 6 + 5 + 3 + 3 + 2 + 2 + 3 = 24.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @robot/api typecheck
git add packages/api/src/schema-catalogue.ts packages/api/src/schema-catalogue.test.ts packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-fields.test.ts
git commit -m "feat(api): the field catalogue behind step 1, per schema type, with engine concepts" -- packages/api/src/schema-catalogue.ts packages/api/src/schema-catalogue.test.ts packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-fields.test.ts
```

---

### Task 2: `addField` takes a description and a concept; the description is the website's default hint

**Files:**
- Modify: `packages/api/src/contract.ts`, `packages/api/src/routers/datasets.ts` (`addField`, `propagate` call)
- Test: `packages/api/src/routers/datasets-fields.test.ts`, `packages/api/src/routers/sources-project.test.ts` (one case: `createInProject` seeds the hint)

**Interfaces:**
- Produces: `datasets.addField({ datasetId, name, type, description?: string (≤ 1000), concept?: string (≤ 100, /^[a-z][a-z0-9_]*$/) })` → `{ key, name, type, concept, description, affectedSourceIds }`. `ContractField.description?: string`. `bindingFor(contract, descriptions)` uses `descriptions[key] ?? f.description ?? ''`.
- Existing behaviour unchanged when neither is sent: concept from `deriveConcept`, description `''`.

- [ ] **Step 1: Failing tests**

Append to `datasets-fields.test.ts` (use the file's existing helpers for a fresh project; read them first):

```ts
describe('datasets.addField with a catalogue description and concept', () => {
  it('stores both on the contract, uses the concept as given, and gives every website the description as its hint', async () => {
    const f = await createProjectWithSource(caller, { tag: 'catalogue-add', fields: [] });
    try {
      const r = await caller.datasets.addField({ datasetId: f.datasetId, name: 'Currency', type: 'text', description: 'The currency of the price', concept: 'currency' });
      expect(r.concept).toBe('currency');
      expect(r.description).toBe('The currency of the price');
      const contract = await caller.datasets.getContract({ datasetId: f.datasetId });
      expect(contract.find((c) => c.key === r.key)).toMatchObject({ concept: 'currency', description: 'The currency of the price' });
      const src = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { schemaDefinition: true } });
      expect((src!.schemaDefinition as Array<{ key: string; description: string; concept: string }>).find((d) => d.key === r.key)).toMatchObject({ description: 'The currency of the price', concept: 'currency' });
    } finally { await f.cleanup(); }
  });
  it('a name with "price" in it keeps the given concept', async () => {
    const f = await createProjectWithSource(caller, { tag: 'catalogue-conc', fields: [] });
    try {
      const r = await caller.datasets.addField({ datasetId: f.datasetId, name: 'Price currency', type: 'text', concept: 'currency' });
      expect(r.concept).toBe('currency');
    } finally { await f.cleanup(); }
  });
  it('without them, behaves as before', async () => {
    const f = await createProjectWithSource(caller, { tag: 'catalogue-plain', fields: [] });
    try {
      const r = await caller.datasets.addField({ datasetId: f.datasetId, name: 'Price currency', type: 'text' });
      expect(r.concept).toBe('price');
      expect(r.description).toBe('');
    } finally { await f.cleanup(); }
  });
});
```

In `sources-project.test.ts` (follow its fresh-project helper), add: a project whose contract gained a field with `description: 'The price the customer pays now'`, then `sources.createInProject` → the new website's `schemaDefinition` entry for that key has that description.

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/api exec vitest run --maxWorkers=1 datasets-fields sources-project`.

- [ ] **Step 3: Implement**

`contract.ts`:

```ts
export type ContractField = { key: string; name: string; type: CustomerFieldType; concept: string; description?: string } & Record<string, unknown>;

/** A website's binding rows for a contract (spec 4.2): name/type/concept copied; the hint is the website's own, defaulting to the contract's description (a catalogue field arrives described). */
export function bindingFor(contract: ContractField[], descriptions: Record<string, string> = {}): SchemaDefinitionField[] {
  return contract.map((f) => ({ key: f.key, name: f.name, type: f.type, description: descriptions[f.key] ?? f.description ?? '', concept: f.concept }));
}
```

`datasets.ts` `addField`:

```ts
  addField: publicProcedure
    .input(z.object({
      datasetId: z.string().uuid(),
      name: z.string().trim().min(1).max(100),
      type: z.enum(CUSTOMER_FIELD_TYPES),
      /** From the catalogue (spec 2026-09-18 §2.1): the website's default location hint, and what the field is in the engine's vocabulary. */
      description: z.string().trim().max(1000).optional(),
      concept: z.string().regex(/^[a-z][a-z0-9_]*$/).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      const contract = contractFields(schema);
      assertNameFree(contract, input.name);
      const key = deriveKey(input.name, new Set(contract.map((f) => f.key)));
      const concept = input.concept ?? deriveConcept(input.name, input.type);
      const description = input.description ?? '';
      const field: ContractField = { key, name: input.name, type: input.type, concept, ...(description ? { description } : {}) };
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: [...schema, field], updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        const locked = await lockSources(tx, ds.id);
        return propagate(tx, locked, key, { add: { key, name: input.name, type: input.type, description, concept } });
      });
      return { key, name: input.name, type: input.type, concept, description, affectedSourceIds };
    }),
```

Check `updateSchema`'s keyed-entry guard (datasets.ts ~line 200) still lets `description` change freely — its comment says it does.

- [ ] **Step 4: Run, expect pass**; also run `binding-input` and `current-certification` tests (they build `SchemaDefinitionField`s) — `fieldHash` includes `description`, so a website created AFTER this change with a described field hashes differently from one created before; that is correct (a new website has no stored certification yet) and existing websites' bindings are untouched (their `schemaDefinition` rows are not rewritten by this task).

- [ ] **Step 5: Typecheck, commit**

```bash
pnpm typecheck
git add packages/api/src/contract.ts packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-fields.test.ts packages/api/src/routers/sources-project.test.ts
git commit -m "feat(api): addField takes the catalogue's description and concept; the description is a website's default hint" -- packages/api/src/contract.ts packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-fields.test.ts packages/api/src/routers/sources-project.test.ts
```

---

### Task 3: Stepper view logic (pure)

**Files:**
- Create: `packages/dashboard/src/lib/schema-stepper-view.ts`
- Test: `packages/dashboard/src/lib/schema-stepper-view.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SchemaStep = 'fields' | 'pages';
  /** Which step is open: the URL's say when valid, else fields until the project has a field. */
  export function stepOf(search: { step?: string }, fieldCount: number): SchemaStep;
  /** [fields, pages] as the Stepper strip and Sections read them. */
  export function stepStates(step: SchemaStep, fieldCount: number): [StepState, StepState];
  /** "shared with n websites" for n > 1, else null. */
  export function sharedNote(websiteCount: number): string | null;
  /** "This adds the field to n websites" for n > 1, else null. */
  export function addNote(websiteCount: number): string | null;
  ```
  `StepState` from `./extract-view`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { stepOf, stepStates, sharedNote, addNote } from './schema-stepper-view';

describe('stepOf', () => {
  it('defaults to fields on an empty contract and pages otherwise', () => {
    expect(stepOf({}, 0)).toBe('fields');
    expect(stepOf({}, 3)).toBe('pages');
  });
  it('honours a valid step in the URL, ignores an invalid one', () => {
    expect(stepOf({ step: 'fields' }, 3)).toBe('fields');
    expect(stepOf({ step: 'pages' }, 0)).toBe('fields'); // pages needs a field
    expect(stepOf({ step: 'mark' }, 3)).toBe('pages');
  });
});
describe('stepStates', () => {
  it('fields current, pages later while the contract is empty', () => {
    expect(stepStates('fields', 0)).toEqual(['current', 'later']);
  });
  it('fields current, pages done-ish (locked) when reopened with fields present', () => {
    expect(stepStates('fields', 2)).toEqual(['current', 'locked']);
  });
  it('fields done, pages current on the pages step', () => {
    expect(stepStates('pages', 2)).toEqual(['done', 'current']);
  });
});
describe('notes', () => {
  it('speak only for a shared contract', () => {
    expect(sharedNote(1)).toBeNull();
    expect(sharedNote(2)).toBe('shared with 2 websites');
    expect(addNote(1)).toBeNull();
    expect(addNote(3)).toBe('This adds the field to 3 websites');
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/dashboard exec vitest run --maxWorkers=1 schema-stepper-view`.

- [ ] **Step 3: Implement**

```ts
// packages/dashboard/src/lib/schema-stepper-view.ts
// The Schema tab's stepper as pure decisions (spec 2026-09-18 §2): which
// step is open and how the strip reads. Steps 2 and 3 of the spec are one
// interim section here ("Pages and values", today's grid) until the pages
// and mark screens land.
import type { StepState } from './extract-view';

export type SchemaStep = 'fields' | 'pages';

export function stepOf(search: { step?: string }, fieldCount: number): SchemaStep {
  if (fieldCount === 0) return 'fields';
  return search.step === 'fields' ? 'fields' : 'pages';
}

export function stepStates(step: SchemaStep, fieldCount: number): [StepState, StepState] {
  if (step === 'fields') return ['current', fieldCount === 0 ? 'later' : 'locked'];
  return ['done', 'current'];
}

export function sharedNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `shared with ${websiteCount} websites` : null;
}

export function addNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `This adds the field to ${websiteCount} websites` : null;
}
```

- [ ] **Step 4: Run, expect pass. Commit**

```bash
git add packages/dashboard/src/lib/schema-stepper-view.ts packages/dashboard/src/lib/schema-stepper-view.test.ts
git commit -m "feat(dashboard): the Schema tab's stepper decisions, pure" -- packages/dashboard/src/lib/schema-stepper-view.ts packages/dashboard/src/lib/schema-stepper-view.test.ts
```

---

### Task 4: `FieldCatalogue` and the project home's editor

**Files:**
- Create: `packages/dashboard/src/components/field-catalogue.tsx`
- Modify: `packages/dashboard/src/components/contract-editor.tsx`
- Modify: `packages/dashboard/src/routes/project-home.tsx` (pass `websiteCount` to the editor — read where `ContractEditor` is rendered)
- Test: none of these are unit-testable without a DOM harness (the dashboard has none); Task 6's smoke run and look-only check cover them.

**Interfaces:**
- Consumes: `datasets.catalogue`, `datasets.addField({ description, concept })` (Task 2), `sharedNote`/`addNote` (Task 3).
- Produces:
  ```tsx
  export function FieldCatalogue({ existingKeys, onAdd, pendingKey, note }: {
    existingKeys: Set<string>;               // contract keys already present → chip shows "added" and is disabled
    onAdd: (entry: CatalogueEntry) => void;  // one mutation per click
    pendingKey: string | null;               // the chip mid-flight shows a spinner
    note: string | null;                     // addNote(websiteCount)
  })
  ```
  `ContractEditor` gains `websiteCount: number` and renders `FieldCatalogue` under the list with a heading "Add from the catalogue"; its own "Add field" row is the spec's "Add your own".

- [ ] **Step 1: `field-catalogue.tsx`**

```tsx
// packages/dashboard/src/components/field-catalogue.tsx
// Step 1's catalogue (spec 2026-09-18 §2.1): a row of schema types, then that
// type's groups as chips. A chip already in the contract reads "added" and is
// disabled; clicking any other adds it with one mutation. On the paper, no
// card: the type row is a set of quiet buttons with a 2px rail under the
// chosen one (the stepper's language), the groups are labelled rows of chips.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';

export type CatalogueEntry = { key: string; name: string; type: string; description: string; concept: string };
type SchemaType = 'product' | 'listing_item' | 'article' | 'job' | 'property' | 'event' | 'custom';

export function FieldCatalogue({ existingKeys, onAdd, pendingKey, note }: {
  existingKeys: Set<string>;
  onAdd: (entry: CatalogueEntry) => void;
  pendingKey: string | null;
  note: string | null;
}) {
  const catalogue = trpc.datasets.catalogue.useQuery();
  const [type, setType] = useState<SchemaType>('product');
  const types = catalogue.data ? (Object.keys(catalogue.data) as SchemaType[]) : [];
  const current = catalogue.data?.[type];
  return (
    <div>
      <div role="tablist" aria-label="Schema type" className="flex flex-wrap gap-3">
        {types.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={t === type} onClick={() => setType(t)}
            className={`border-b-2 pb-1 text-xs ${t === type ? 'border-accent-600 text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {catalogue.data![t].label}
          </button>
        ))}
      </div>
      {current && current.groups.length === 0 && <p className="label-soft mt-3">No suggestions for a custom schema. Add your own fields below.</p>}
      {current?.groups.map((g) => (
        <div key={g.name} className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className="label-soft w-24 flex-shrink-0">{g.name}</span>
          {g.entries.map((en) => {
            const added = existingKeys.has(en.key);
            const pending = pendingKey === en.key;
            return (
              <button key={en.key} type="button" disabled={added || pending} title={en.description} aria-label={added ? `${en.name} (added)` : `Add ${en.name}`}
                onClick={() => onAdd(en)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${added ? 'border-gray-200 text-gray-600' : 'border-gray-300 text-gray-900 hover:border-accent-600'}`}>
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                {en.name}<span className="font-mono text-[10px] text-gray-600">{en.type}</span>
                {added && <span className="text-[10px] text-gray-600">added</span>}
              </button>
            );
          })}
        </div>
      ))}
      {note && <p className="label-soft mt-3">{note}</p>}
    </div>
  );
}
```

The chip's key-in-contract check is by **key**: a catalogue entry's key is what `deriveKey` mints from its name (`'Was price'` → `was_price`), which is why every catalogue key was written to equal `deriveKey(name)`. Where a custom field has taken that key already, the chip reads "added" — acceptable, and honest (the field exists).

- [ ] **Step 2: `contract-editor.tsx`**

Add the prop `websiteCount: number`, the catalogue below the table, and make `add` send the entry's description and concept:

```tsx
import { FieldCatalogue, type CatalogueEntry } from './field-catalogue';
import { addNote } from '../lib/schema-stepper-view';
// …
export function ContractEditor({ datasetId, projectSlug, websiteCount }: { datasetId: string; projectSlug: string; websiteCount: number }) {
  // … existing hooks …
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  function addFromCatalogue(en: CatalogueEntry) {
    setPendingKey(en.key);
    add.mutate({ datasetId, name: en.name, type: en.type as GridFieldType, description: en.description, concept: en.concept }, { onSettled: () => setPendingKey(null) });
  }
  // … after </table> and the label-soft paragraph:
  <h4 className="name mt-6 text-base">Add from the catalogue</h4>
  <p className="label-soft">Pick what this kind of page usually has. Each one becomes a field on every website in the project.</p>
  <div className="mt-2">
    <FieldCatalogue existingKeys={new Set(fields.map((f) => f.key))} onAdd={addFromCatalogue} pendingKey={pendingKey} note={addNote(websiteCount)} />
  </div>
```

The existing "field name / type / Add field" row keeps its place and gets the aria-label "Add your own" on its button (`aria-label="Add your own"`, visible text unchanged: "Add field").

In `project-home.tsx`, pass `websiteCount={sources.length}` (the sources list the page already queries; read the file to find the variable).

- [ ] **Step 3: Typecheck, run the dashboard suite, commit**

```bash
pnpm --filter @robot/dashboard typecheck
pnpm --filter @robot/dashboard exec vitest run --maxWorkers=1
git add packages/dashboard/src/components/field-catalogue.tsx packages/dashboard/src/components/contract-editor.tsx packages/dashboard/src/routes/project-home.tsx
git commit -m "feat(dashboard): the field catalogue, on the project home's field list" -- packages/dashboard/src/components/field-catalogue.tsx packages/dashboard/src/components/contract-editor.tsx packages/dashboard/src/routes/project-home.tsx
```

---

### Task 5: The Schema tab as a stepper: `1 · Fields`, `2 · Pages and values`, arrivals

**Files:**
- Modify: `packages/dashboard/src/router.tsx` (`step` search param), `packages/dashboard/src/routes/source-schema.tsx`, `packages/dashboard/src/routes/project-home.tsx` (Add website dialog navigation)
- Test: `packages/dashboard/src/routes-smoke.test.ts` (step 1 walk)

**Interfaces:**
- Consumes: `Stepper`, `Section` from `../components/stepper` (their `Section` heading id is `extract-step-${n}`; pass `n` 1 and 2 — the id prefix is cosmetic, but the smoke test locates headings by it), `ContractEditor` (Task 4), `stepOf`/`stepStates`/`sharedNote` (Task 3), `sources.listByProject` (already queried) for `websiteCount` and `datasetId`.
- Behaviour:
  - `router.tsx`: the Schema route's `validateSearch` also keeps `step` when it is `'fields'` or `'pages'`.
  - `source-schema.tsx`: `const step = stepOf(search, fieldCount)`, `[s1, s2] = stepStates(step, fieldCount)`. Strip: `<Stepper steps={[{ n: 1, title: 'Fields', detail: fieldCount ? `${fieldCount} fields` : 'none yet', state: s1 }, { n: 2, title: 'Pages and values', detail: 'until the mark screen lands', state: s2 }]} />`. Section 1 (`title="Fields"`, `hint={sharedNote(websiteCount) ?? 'the columns of your output'}`, `state={s1}`, `onEdit={() => navigate({ search: { step: 'fields' } })}`) holds `<ContractEditor datasetId={source.datasetId} projectSlug={projectSlug} websiteCount={websiteCount} />` and a `btn-primary` "Next: pages" (`disabled={fieldCount === 0}`, `onClick={() => navigate({ search: (s) => ({ ...s, step: 'pages' }) })}`). Section 2 (`title="Pages and values"`, `hint="three product pages and what each field reads on them"`, `reason="Add a field first"` when `fieldCount === 0`, `state={s2}`) wraps everything the tab renders today from the `StatusStrip` down, unchanged. The `contractEmpty ? <EmptyState …>` branch is deleted; `contractEmpty` still gates `showProblems` and the verify button's `complete`.
  - `datasetId`: `source.datasetId` is in `listByProject`'s selection (the engine's live check printed it); if it is null (a legacy source), render Section 1 with the sentence "This website has no project field list." and no editor.
  - `ContractEditor`'s mutations already invalidate `sources` queries, so the grid re-seeds… **it does not**: `source-schema.tsx` seeds the grid once (`initialized` ref). After `addField` the new row must appear: extend the seeding effect's guard — when `source.schemaDefinition` gains a key the grid does not have, append `{ ...emptyRow(), key, name, type, description }` for each such key (and drop rows whose key is gone), leaving existing rows' cells untouched. Put this in a small pure function `reconcileRows(rows, definition)` in `lib/schema-grid.ts` with a unit test in `schema-grid.test.ts`: adding a key appends a row with the definition's name/type/description; removing a key drops its row; existing rows keep their cells.
  - `project-home.tsx` Add website dialog: after `createInProject`, `navigate({ to: '/projects/$project/sources/$source', params, search: { step: fieldCount === 0 ? 'fields' : 'pages' } })` where `fieldCount` is the project's contract length (the page already has the dataset's fields via `ContractEditor`'s query; lift `datasets.getContract` to the page or read `projects.list`'s `fieldCount` for this slug — whichever the file already has in scope). Update the dialog's sentence "Next you'll pick three product pages and fill in the expected values." to "Next you'll add fields, then pick three product pages." when the project has none.

- [ ] **Step 1: `reconcileRows` test and implementation** in `lib/schema-grid.ts` / `schema-grid.test.ts` (read the file's `GridRow`/`emptyRow` first):

```ts
it('reconcileRows appends rows for new keys, drops rows for removed keys, keeps existing cells', () => {
  const rows = [{ ...emptyRow(), key: 'price', name: 'Price', type: 'money' as const, description: 'd', expected: ['1', '2', '3'] }];
  const def = [{ key: 'price', name: 'Price', type: 'money' as const, description: 'd' }, { key: 'title', name: 'Title', type: 'text' as const, description: 'The product name' }];
  const next = reconcileRows(rows, def);
  expect(next.map((r) => r.key)).toEqual(['price', 'title']);
  expect(next[0]!.expected).toEqual(['1', '2', '3']);
  expect(next[1]).toMatchObject({ name: 'Title', type: 'text', description: 'The product name' });
  expect(reconcileRows(next, [def[1]!]).map((r) => r.key)).toEqual(['title']);
});
```

(adapt the `expected` field name to what `GridRow` calls its cells).

```ts
/** After the project's field list changes under an open tab: rows for new keys, none for removed keys, existing rows untouched. */
export function reconcileRows(rows: GridRow[], definition: Array<{ key: string; name: string; type: GridFieldType; description: string }>): GridRow[] {
  const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
  return definition.map((d) => byKey.get(d.key) ?? { ...emptyRow(), key: d.key, name: d.name, type: d.type, description: d.description });
}
```

- [ ] **Step 2: Wire `source-schema.tsx`** as described; in the seeding effect, after `initialized.current` is true, add a second effect keyed on `source?.schemaDefinition` that calls `setGrid((g) => ({ ...g, rows: reconcileRows(g.rows, definition) }))` when the key sets differ (not a user edit: does not flip `touched`).

- [ ] **Step 3: `router.tsx`**

```ts
  validateSearch: (s: Record<string, unknown>) => ({
    ...(typeof s.addPage === 'string' ? { addPage: s.addPage } : {}),
    ...(typeof s.field === 'string' ? { field: s.field } : {}),
    ...(s.step === 'fields' || s.step === 'pages' ? { step: s.step } : {}),
  }),
```

- [ ] **Step 4: Smoke test** — extend the "a project and a website created through the new procedures render" case in `routes-smoke.test.ts`: create the project WITHOUT `addField`, create the website, open the Schema route, assert: the strip lists "Fields" and "Pages and values" (`#extract-step-1` and `#extract-step-2` headings); the Product tab is selected (`getByRole('tab', { name: 'Product' })` has `aria-selected="true"`); click `getByLabel('Add Price')`; wait until `getByText('Price', { exact: true })` is in the field list (the field takes the catalogue's name) and `getByLabel('Price (added)')` is disabled; click "Next: pages" and assert the URL's search has `step=pages` and the grid's "Where it is on this website" text is present. The existing assertions that follow (page pencils, status strip, the `price` contract row — now named `Price`) run on the pages step; keep the Extract locked-strip checks as they are.

- [ ] **Step 5: Run** — `pnpm --filter @robot/dashboard typecheck`, `pnpm --filter @robot/dashboard exec vitest run --maxWorkers=1 schema-grid schema-stepper-view`, and with `pnpm dev:all` running, `RUN_UI_SMOKE=1 pnpm --filter @robot/dashboard exec vitest run --maxWorkers=1 routes-smoke`. The smoke rewrites the tracked screenshots under `docs/testing/screens/`; restore them afterwards with `git checkout -- docs/testing/screens` (Task 6 takes the screenshots that are meant to change).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/router.tsx packages/dashboard/src/routes/source-schema.tsx packages/dashboard/src/routes/project-home.tsx packages/dashboard/src/lib/schema-grid.ts packages/dashboard/src/lib/schema-grid.test.ts packages/dashboard/src/routes-smoke.test.ts
git commit -m "feat(dashboard): the Schema tab is a stepper: fields from the catalogue, then pages and values" -- packages/dashboard/src/router.tsx packages/dashboard/src/routes/source-schema.tsx packages/dashboard/src/routes/project-home.tsx packages/dashboard/src/lib/schema-grid.ts packages/dashboard/src/lib/schema-grid.test.ts packages/dashboard/src/routes-smoke.test.ts
```

---

### Task 6: Look-only browser check, screenshots, handoff

**Files:**
- Create: `docs/testing/ui-check-schema-step1.mts` (model: `docs/testing/ui-check-schema-arrival.mts`; run from `packages/browser` so `playwright` resolves)
- Modify: `docs/testing/screens/README.md`, `docs/handoff.md`

- [ ] **Step 1: The check script** — against `pnpm dev:all`: create a throwaway project and website over tRPC (as the smoke does), open the Schema tab, screenshot `docs/testing/screens/schema-step1-empty.png`; click three Product chips (Title, Price, Main image) and screenshot `schema-step1-added.png`; switch to the Article tab and screenshot `schema-step1-article.png`; click "Next: pages" and screenshot `schema-step2-interim.png`; open the project home and screenshot `project-home-catalogue.png`; delete the throwaway project. Print each assertion it makes (strip present, chips disabled after adding, hint column pre-filled with the catalogue description in the grid row — `getByDisplayValue('The product name as shown in the page heading')` or the grid's hint cell text). Then **look at the five screenshots** (the Read tool renders PNGs) and fix what is wrong before reporting: overlapping chips, a strip that wraps badly, a section rule missing, uppercase anywhere, a card where there should be none.

- [ ] **Step 2: README and handoff** — add the five screenshots to `docs/testing/screens/README.md`'s table; add a section "Schema stepper, step 1 (2026-09-19)" to `docs/handoff.md` after the engine section: what landed (catalogue, `addField` description/concept, the tab as a stepper, interim step 2), what the browser check found and fixed, and the next plan (step 2: pages with background captures).

- [ ] **Step 3: Commit**

```bash
git add docs/testing/ui-check-schema-step1.mts docs/testing/screens/schema-step1-empty.png docs/testing/screens/schema-step1-added.png docs/testing/screens/schema-step1-article.png docs/testing/screens/schema-step2-interim.png docs/testing/screens/project-home-catalogue.png docs/testing/screens/README.md docs/handoff.md
git commit -m "docs: step 1 look-only browser check, its screenshots, and the handoff" -- docs/testing/ui-check-schema-step1.mts docs/testing/screens/schema-step1-empty.png docs/testing/screens/schema-step1-added.png docs/testing/screens/schema-step1-article.png docs/testing/screens/schema-step2-interim.png docs/testing/screens/project-home-catalogue.png docs/testing/screens/README.md docs/handoff.md
```
