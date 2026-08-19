# v2 Crawler — Plan A: Foundations + Phase 1 (`plan`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `crawl.plan` produce an inspectable, budget-capped work list of detail URLs for every row of a Source's InputSet, without extracting a single detail page.

**Architecture:** Pure decision functions in `packages/scraper/src/crawl/` (budget, URL building, enumeration, row merging, schema partitioning), one injected-dependency orchestrator (`plan-run.ts`) that captures listing pages through the existing `runExtraction` chain, and a thin tRPC procedure that persists the result as `run_items` rows. No detail-page extraction, no execution loop — that is Plan B.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Drizzle ORM + PostgreSQL, tRPC v11 + Zod, Playwright, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-19-v2-crawler-design.md`](../specs/2026-08-19-v2-crawler-design.md)

## Global Constraints

- All packages are ESM (`"type": "module"`). **Relative imports must carry the `.js` extension**, e.g. `import { resolveBudget } from './budget.js'`.
- Node ≥ 20.12. pnpm version is pinned by `packageManager`.
- Tests are Vitest. Run a single file with `pnpm --filter <pkg> exec vitest run <path>`.
- `pnpm -r test` is the green gate and **requires Postgres**: `docker start robot-platform-db`.
- `pnpm typecheck` covers only `@robot/api` and `@robot/db`. Also run `pnpm --filter @robot/api-server exec tsc --noEmit` and `pnpm --filter @robot/dashboard exec tsc --noEmit` when touching those packages.
- Budget defaults, verbatim from the spec: `max_pages = 3`, `max_items = 50`, `mode = 'first_n'`. Hard ceiling **5000 items per run**, independent of configuration.
- `mode` semantics, verbatim: `first_n` stops enumerating once `max_items` detail URLs exist; `all` ignores `max_items` and stops only at `max_pages`.
- Field `origin` values, verbatim: `'detail' | 'listing' | 'input' | 'system'`; **absent means `'detail'`**.
- System field definitions, verbatim: `_url` is the detail URL the row was extracted from; `_page_number` is the listing page the URL was discovered on, `null` for `listing_mode: 'detail'` Sources.
- Commit style: focused, single-purpose, conventional-commit prefixes (`feat:`, `fix:`, `test:`, `docs:`). Commit at the end of every task.

---

### Task 1: Budget resolution

**Files:**
- Create: `packages/scraper/src/crawl/budget.ts`
- Test: `packages/scraper/src/crawl/budget.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type Budget = { maxPages: number; maxItems: number; mode: 'all' | 'first_n' }`; `resolveBudget(raw: unknown): Budget`; `itemCap(budget: Budget): number`; `HARD_ITEM_CEILING = 5000`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/crawl/budget.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBudget, itemCap, HARD_ITEM_CEILING } from './budget.js';

describe('resolveBudget', () => {
  it('applies conservative defaults to an empty budget', () => {
    expect(resolveBudget({})).toEqual({ maxPages: 3, maxItems: 50, mode: 'first_n' });
  });

  it('applies the same defaults to null', () => {
    expect(resolveBudget(null)).toEqual({ maxPages: 3, maxItems: 50, mode: 'first_n' });
  });

  it('reads the snake_case keys the database stores', () => {
    expect(resolveBudget({ max_pages: 10, max_items: 200, mode: 'all' }))
      .toEqual({ maxPages: 10, maxItems: 200, mode: 'all' });
  });

  it('fills only the missing keys of a partial budget', () => {
    expect(resolveBudget({ max_pages: 7 })).toEqual({ maxPages: 7, maxItems: 50, mode: 'first_n' });
  });

  it('rejects a non-positive page count rather than crawling zero pages', () => {
    expect(resolveBudget({ max_pages: 0 }).maxPages).toBe(3);
  });

  it('ignores an unknown mode', () => {
    expect(resolveBudget({ mode: 'everything' }).mode).toBe('first_n');
  });
});

describe('itemCap', () => {
  it('caps at max_items under first_n', () => {
    expect(itemCap({ maxPages: 3, maxItems: 50, mode: 'first_n' })).toBe(50);
  });

  it('ignores max_items under all, falling back to the hard ceiling', () => {
    expect(itemCap({ maxPages: 3, maxItems: 50, mode: 'all' })).toBe(HARD_ITEM_CEILING);
  });

  it('never exceeds the hard ceiling, however large max_items is', () => {
    expect(itemCap({ maxPages: 3, maxItems: 99999, mode: 'first_n' })).toBe(HARD_ITEM_CEILING);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/budget.test.ts`
Expected: FAIL — `Cannot find module './budget.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/scraper/src/crawl/budget.ts
// Reads sources.budget, which had no reader at all before the crawler.
//
// The defaults conserve REQUESTS TO THE SITE, not dollars: AI cost per detail
// page collapses after the first one (the cache the first page writes serves
// the rest), but every item is still a page load against a domain whose
// anti-bot is this project's binding constraint.

export type Budget = { maxPages: number; maxItems: number; mode: 'all' | 'first_n' };

/** Applies regardless of configuration: a mis-detected url-pattern template is a loop generator. */
export const HARD_ITEM_CEILING = 5000;

const DEFAULTS: Budget = { maxPages: 3, maxItems: 50, mode: 'first_n' };

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function resolveBudget(raw: unknown): Budget {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    maxPages: positiveInt(b.max_pages, DEFAULTS.maxPages),
    maxItems: positiveInt(b.max_items, DEFAULTS.maxItems),
    mode: b.mode === 'all' ? 'all' : DEFAULTS.mode,
  };
}

/** How many detail URLs this run may enumerate in total. */
export function itemCap(budget: Budget): number {
  const requested = budget.mode === 'all' ? HARD_ITEM_CEILING : budget.maxItems;
  return Math.min(requested, HARD_ITEM_CEILING);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/budget.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/crawl/budget.ts packages/scraper/src/crawl/budget.test.ts
git commit -m "feat(crawl): budget resolution with conservative request-blast-radius defaults"
```

---

### Task 2: Field `origin` — partition helper and widened schema contract

**Files:**
- Create: `packages/scraper/src/crawl/partition-schema.ts`
- Test: `packages/scraper/src/crawl/partition-schema.test.ts`
- Modify: `packages/api/src/routers/datasets.ts` (the `updateSchema` input, around lines 92–105)
- Test: `packages/api/src/routers/datasets-schema-field.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type FieldOrigin = 'detail' | 'listing' | 'input' | 'system'`; `type OriginField = { name: string; type: string; origin?: FieldOrigin; input_column?: string; enabled?: boolean }`; `partitionSchemaByOrigin(fields: OriginField[]): { detail: OriginField[]; listing: OriginField[]; input: OriginField[]; system: OriginField[] }`; exported zod schema `datasetSchemaFieldSchema` from `@robot/api`'s datasets router module

- [ ] **Step 1: Write the failing test for the partition helper**

```typescript
// packages/scraper/src/crawl/partition-schema.test.ts
import { describe, it, expect } from 'vitest';
import { partitionSchemaByOrigin } from './partition-schema.js';

describe('partitionSchemaByOrigin', () => {
  it('treats a field with no origin as a detail field', () => {
    const result = partitionSchemaByOrigin([{ name: 'title', type: 'string' }]);
    expect(result.detail.map((f) => f.name)).toEqual(['title']);
    expect(result.listing).toEqual([]);
  });

  it('routes each field to the partition its origin names', () => {
    const result = partitionSchemaByOrigin([
      { name: 'title', type: 'string', origin: 'detail' },
      { name: 'category', type: 'string', origin: 'listing' },
      { name: 'requested_by', type: 'string', origin: 'input', input_column: 'customer' },
      { name: '_url', type: 'url', origin: 'system' },
    ]);
    expect(result.detail.map((f) => f.name)).toEqual(['title']);
    expect(result.listing.map((f) => f.name)).toEqual(['category']);
    expect(result.input.map((f) => f.name)).toEqual(['requested_by']);
    expect(result.system.map((f) => f.name)).toEqual(['_url']);
  });

  it('drops fields the user disabled', () => {
    const result = partitionSchemaByOrigin([
      { name: 'title', type: 'string' },
      { name: 'internal', type: 'string', enabled: false },
    ]);
    expect(result.detail.map((f) => f.name)).toEqual(['title']);
  });

  it('preserves schema order inside a partition', () => {
    const result = partitionSchemaByOrigin([
      { name: 'b', type: 'string', origin: 'listing' },
      { name: 'a', type: 'string', origin: 'listing' },
    ]);
    expect(result.listing.map((f) => f.name)).toEqual(['b', 'a']);
  });

  it('returns empty partitions for an empty schema', () => {
    expect(partitionSchemaByOrigin([])).toEqual({ detail: [], listing: [], input: [], system: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/partition-schema.test.ts`
Expected: FAIL — `Cannot find module './partition-schema.js'`

- [ ] **Step 3: Write the partition helper**

```typescript
// packages/scraper/src/crawl/partition-schema.ts
// Field origin partitions the schema by WHERE each field lives.
//
// The partitions are disjoint, so the final row is a plain key merge with no
// precedence rules to get wrong — and a listing-classified field is never
// looked for on the detail page, so it cannot silently return a wrong value
// from a page that does not have it.

export type FieldOrigin = 'detail' | 'listing' | 'input' | 'system';

export type OriginField = {
  name: string;
  type: string;
  origin?: FieldOrigin;
  /** Which InputSet column supplies this field, when origin is 'input'. */
  input_column?: string;
  enabled?: boolean;
};

export type PartitionedSchema = {
  detail: OriginField[];
  listing: OriginField[];
  input: OriginField[];
  system: OriginField[];
};

export function partitionSchemaByOrigin(fields: OriginField[]): PartitionedSchema {
  const out: PartitionedSchema = { detail: [], listing: [], input: [], system: [] };
  for (const field of fields) {
    if (field.enabled === false) continue;
    out[field.origin ?? 'detail'].push(field);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/partition-schema.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Write the failing test for the widened tRPC contract**

```typescript
// packages/api/src/routers/datasets-schema-field.test.ts
import { describe, it, expect } from 'vitest';
import { datasetSchemaFieldSchema } from './datasets.js';

describe('datasetSchemaFieldSchema', () => {
  it('accepts a field with no origin (existing schemas keep working)', () => {
    const parsed = datasetSchemaFieldSchema.parse({ name: 'title', type: 'string' });
    expect(parsed.origin).toBeUndefined();
  });

  it('accepts every origin the spec defines', () => {
    for (const origin of ['detail', 'listing', 'input', 'system'] as const) {
      expect(datasetSchemaFieldSchema.parse({ name: 'f', type: 'string', origin }).origin).toBe(origin);
    }
  });

  it('rejects an origin outside the enum', () => {
    expect(() => datasetSchemaFieldSchema.parse({ name: 'f', type: 'string', origin: 'api' })).toThrow();
  });

  it('carries input_column for input-origin fields', () => {
    const parsed = datasetSchemaFieldSchema.parse({
      name: 'customer', type: 'string', origin: 'input', input_column: 'customer_name',
    });
    expect(parsed.input_column).toBe('customer_name');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/routers/datasets-schema-field.test.ts`
Expected: FAIL — `datasetSchemaFieldSchema` is not exported

- [ ] **Step 7: Widen the contract**

In `packages/api/src/routers/datasets.ts`, add above `export const datasetsRouter`:

```typescript
/** One Dataset schema field. `origin` says WHERE the field is resolved; absent means 'detail'. */
export const datasetSchemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().optional(),
  description: z.string().optional(),
  origin: z.enum(['detail', 'listing', 'input', 'system']).optional(),
  input_column: z.string().optional(),
});
```

Then replace the inline object inside `updateSchema`'s input so it reads:

```typescript
        schema: z.array(datasetSchemaFieldSchema),
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @robot/api exec vitest run src/routers/datasets-schema-field.test.ts`
Expected: PASS — 4 tests

Run: `pnpm --filter @robot/api exec vitest run`
Expected: PASS — no regressions in the existing router tests

- [ ] **Step 9: Commit**

```bash
git add packages/scraper/src/crawl/partition-schema.ts packages/scraper/src/crawl/partition-schema.test.ts packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-schema-field.test.ts
git commit -m "feat(schema): field origin — partition helper and widened updateSchema contract"
```

---

### Task 3: Build starting URLs from InputSet rows

**Files:**
- Create: `packages/scraper/src/crawl/build-input-urls.ts`
- Test: `packages/scraper/src/crawl/build-input-urls.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type InputStrategy = 'direct' | 'template' | 'category' | 'search'`; `type StartUrl = { url: string; inputIndex: number; inputValues: Record<string, unknown> }`; `type BuildInputUrlsResult = { urls: StartUrl[]; errors: Array<{ inputIndex: number; message: string }> }`; `buildInputUrls(args): BuildInputUrlsResult`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/crawl/build-input-urls.test.ts
import { describe, it, expect } from 'vitest';
import { buildInputUrls } from './build-input-urls.js';

const COLUMNS = [{ name: 'url', primary: true }];

describe('buildInputUrls', () => {
  it('uses the primary value itself for the direct strategy', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'https://example.com/p/1' }],
    });
    expect(result.urls).toEqual([
      { url: 'https://example.com/p/1', inputIndex: 0, inputValues: { url: 'https://example.com/p/1' } },
    ]);
  });

  it('substitutes the primary value into the template by column name', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: 'https://example.com/dp/{asin}',
      columns: [{ name: 'asin', primary: true }],
      rows: [{ asin: 'B001' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/dp/B001');
  });

  it('substitutes non-primary columns too', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: 'https://example.com/{country}/dp/{asin}',
      columns: [{ name: 'asin', primary: true }, { name: 'country' }],
      rows: [{ asin: 'B001', country: 'uk' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/uk/dp/B001');
  });

  it('url-encodes a search query so spaces cannot break the URL', () => {
    const result = buildInputUrls({
      strategy: 'search',
      urlTemplate: 'https://example.com/search?q={query}',
      columns: [{ name: 'query', primary: true }],
      rows: [{ query: 'protein bars' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/search?q=protein%20bars');
  });

  it('does not re-encode a direct URL', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'https://example.com/search?q=a%20b&x=1' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/search?q=a%20b&x=1');
  });

  it('reports a row whose placeholder has no matching column instead of emitting a broken URL', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: 'https://example.com/dp/{asin}',
      columns: [{ name: 'sku', primary: true }],
      rows: [{ sku: 'X1' }],
    });
    expect(result.urls).toEqual([]);
    expect(result.errors).toEqual([{ inputIndex: 0, message: 'unresolved placeholder: {asin}' }]);
  });

  it('reports a template strategy with no template', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: null,
      columns: [{ name: 'asin', primary: true }],
      rows: [{ asin: 'B001' }],
    });
    expect(result.errors[0]?.message).toBe('source has no url_template');
  });

  it('reports a direct row whose value is not a URL', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'not a url' }],
    });
    expect(result.urls).toEqual([]);
    expect(result.errors[0]?.message).toBe('not an absolute http(s) URL: not a url');
  });

  it('keeps good rows when a sibling row is broken, and preserves input index', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'nope' }, { url: 'https://example.com/ok' }],
    });
    expect(result.urls).toEqual([
      { url: 'https://example.com/ok', inputIndex: 1, inputValues: { url: 'https://example.com/ok' } },
    ]);
    expect(result.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/build-input-urls.test.ts`
Expected: FAIL — `Cannot find module './build-input-urls.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/scraper/src/crawl/build-input-urls.ts
// InputSet rows + strategy + template → the URL each input starts from.
//
// A broken row is reported, never guessed at: emitting a URL with an unresolved
// {placeholder} in it would spend a page load to fetch a 404.

export type InputStrategy = 'direct' | 'template' | 'category' | 'search';

export type InputSetColumn = { name: string; primary?: boolean; propagate?: boolean };

export type StartUrl = {
  url: string;
  inputIndex: number;
  inputValues: Record<string, unknown>;
};

export type BuildInputUrlsResult = {
  urls: StartUrl[];
  errors: Array<{ inputIndex: number; message: string }>;
};

export type BuildInputUrlsArgs = {
  strategy: InputStrategy;
  urlTemplate: string | null;
  columns: InputSetColumn[];
  rows: Array<Record<string, unknown>>;
};

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildInputUrls(args: BuildInputUrlsArgs): BuildInputUrlsResult {
  const { strategy, urlTemplate, columns, rows } = args;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const urls: StartUrl[] = [];
  const errors: BuildInputUrlsResult['errors'] = [];

  rows.forEach((row, inputIndex) => {
    if (strategy === 'direct') {
      const value = String(row[primary?.name ?? ''] ?? '');
      if (!isAbsoluteHttpUrl(value)) {
        errors.push({ inputIndex, message: `not an absolute http(s) URL: ${value}` });
        return;
      }
      urls.push({ url: value, inputIndex, inputValues: row });
      return;
    }

    if (!urlTemplate) {
      errors.push({ inputIndex, message: 'source has no url_template' });
      return;
    }

    let unresolved: string | null = null;
    const url = urlTemplate.replace(PLACEHOLDER_RE, (match, name: string) => {
      const value = row[name];
      if (value === undefined || value === null || value === '') {
        unresolved ??= match;
        return match;
      }
      // Encoded because a category slug or search query may contain spaces and
      // punctuation that would otherwise change the URL's structure.
      return encodeURIComponent(String(value));
    });

    if (unresolved) {
      errors.push({ inputIndex, message: `unresolved placeholder: ${unresolved}` });
      return;
    }
    if (!isAbsoluteHttpUrl(url)) {
      errors.push({ inputIndex, message: `not an absolute http(s) URL: ${url}` });
      return;
    }
    urls.push({ url, inputIndex, inputValues: row });
  });

  return { urls, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/build-input-urls.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/crawl/build-input-urls.ts packages/scraper/src/crawl/build-input-urls.test.ts
git commit -m "feat(crawl): build starting URLs from InputSet rows per strategy"
```

---

### Task 4: Enumerate detail URLs from listing rows

**Files:**
- Create: `packages/scraper/src/crawl/enumerate-detail-urls.ts`
- Test: `packages/scraper/src/crawl/enumerate-detail-urls.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type EnumeratedItem = { url: string; listingValues: Record<string, unknown>; pageNumber: number }`; `type StopReason = 'budget' | 'empty-page' | 'all-duplicates' | null`; `type EnumerateResult = { items: EnumeratedItem[]; stop: StopReason }`; `enumerateDetailUrls(args): EnumerateResult`; `DETAIL_URL_FIELD = 'detail_url'`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/crawl/enumerate-detail-urls.test.ts
import { describe, it, expect } from 'vitest';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const PAGE_URL = 'https://example.com/c/shelves?page=1';

function args(rows: Array<Record<string, unknown>>, overrides: Partial<Parameters<typeof enumerateDetailUrls>[0]> = {}) {
  return { rows, pageUrl: PAGE_URL, pageNumber: 1, seen: new Set<string>(), remaining: 100, ...overrides };
}

describe('enumerateDetailUrls', () => {
  it('resolves a relative href against the listing page URL', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/kallax' }]));
    expect(result.items[0]?.url).toBe('https://example.com/p/kallax');
  });

  it('keeps an already-absolute URL unchanged', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: 'https://cdn.example.com/p/1' }]));
    expect(result.items[0]?.url).toBe('https://cdn.example.com/p/1');
  });

  it('carries the row\'s other fields as that item\'s listing values', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1', listing_price: '79', category: 'Shelves' }]));
    expect(result.items[0]?.listingValues).toEqual({ listing_price: '79', category: 'Shelves' });
  });

  it('stamps the page number each URL was discovered on', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }], { pageNumber: 4 }));
    expect(result.items[0]?.pageNumber).toBe(4);
  });

  it('drops a row with no detail_url', () => {
    const result = enumerateDetailUrls(args([{ listing_price: '79' }, { [DETAIL_URL_FIELD]: '/p/1' }]));
    expect(result.items).toHaveLength(1);
  });

  it('drops a non-http scheme rather than queueing javascript: as work', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: 'javascript:void(0)' }]));
    expect(result.items).toEqual([]);
  });

  it('drops a URL already seen on an earlier page', () => {
    const seen = new Set(['https://example.com/p/1']);
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }, { [DETAIL_URL_FIELD]: '/p/2' }], { seen }));
    expect(result.items.map((i) => i.url)).toEqual(['https://example.com/p/2']);
  });

  it('dedupes repeats within the same page', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }, { [DETAIL_URL_FIELD]: '/p/1' }]));
    expect(result.items).toHaveLength(1);
  });

  it('stops with empty-page when the page yielded no rows', () => {
    expect(enumerateDetailUrls(args([])).stop).toBe('empty-page');
  });

  it('stops with all-duplicates when every URL was already seen — the clamped-page-number signature', () => {
    const seen = new Set(['https://example.com/p/1']);
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }], { seen }));
    expect(result.stop).toBe('all-duplicates');
  });

  it('truncates to the remaining budget and reports the budget stop', () => {
    const result = enumerateDetailUrls(
      args([{ [DETAIL_URL_FIELD]: '/p/1' }, { [DETAIL_URL_FIELD]: '/p/2' }, { [DETAIL_URL_FIELD]: '/p/3' }], { remaining: 2 }),
    );
    expect(result.items.map((i) => i.url)).toEqual(['https://example.com/p/1', 'https://example.com/p/2']);
    expect(result.stop).toBe('budget');
  });

  it('does not stop while new URLs are still arriving under budget', () => {
    expect(enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }])).stop).toBeNull();
  });

  it('does not mutate the caller\'s seen set', () => {
    const seen = new Set<string>();
    enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }], { seen }));
    expect(seen.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/enumerate-detail-urls.test.ts`
Expected: FAIL — `Cannot find module './enumerate-detail-urls.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/scraper/src/crawl/enumerate-detail-urls.ts
// Listing rows → the detail URLs a run will work through.
//
// `all-duplicates` is the important stop reason: a site that clamps an
// out-of-range page number back to page 1 serves the same products forever, and
// without this check every run would walk to max_pages before noticing.

/** Reserved field name the listing extraction resolves to each row's detail link. */
export const DETAIL_URL_FIELD = 'detail_url';

export type EnumeratedItem = {
  url: string;
  listingValues: Record<string, unknown>;
  pageNumber: number;
};

export type StopReason = 'budget' | 'empty-page' | 'all-duplicates' | null;

export type EnumerateResult = { items: EnumeratedItem[]; stop: StopReason };

export type EnumerateArgs = {
  rows: Array<Record<string, unknown>>;
  pageUrl: string;
  pageNumber: number;
  /** URLs already queued by earlier pages or inputs. Not mutated. */
  seen: Set<string>;
  /** How many more items the budget allows. */
  remaining: number;
};

function absolute(href: unknown, pageUrl: string): string | null {
  if (typeof href !== 'string' || href.trim() === '') return null;
  try {
    const resolved = new URL(href, pageUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

export function enumerateDetailUrls(args: EnumerateArgs): EnumerateResult {
  const { rows, pageUrl, pageNumber, seen, remaining } = args;
  if (rows.length === 0) return { items: [], stop: 'empty-page' };

  const items: EnumeratedItem[] = [];
  const local = new Set(seen);
  let sawAnyUrl = false;
  let truncated = false;

  for (const row of rows) {
    const url = absolute(row[DETAIL_URL_FIELD], pageUrl);
    if (!url) continue;
    sawAnyUrl = true;
    if (local.has(url)) continue;
    if (items.length >= remaining) {
      truncated = true;
      break;
    }
    local.add(url);
    const { [DETAIL_URL_FIELD]: _discarded, ...listingValues } = row;
    items.push({ url, listingValues, pageNumber });
  }

  if (truncated) return { items, stop: 'budget' };
  if (items.length === 0) return { items, stop: sawAnyUrl ? 'all-duplicates' : 'empty-page' };
  return { items, stop: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/enumerate-detail-urls.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/crawl/enumerate-detail-urls.ts packages/scraper/src/crawl/enumerate-detail-urls.test.ts
git commit -m "feat(crawl): enumerate detail URLs with dedupe, budget and loop stop conditions"
```

---

### Task 5: Merge a final row from its four origins

**Files:**
- Create: `packages/scraper/src/crawl/merge-row.ts`
- Test: `packages/scraper/src/crawl/merge-row.test.ts`

**Interfaces:**
- Consumes: `OriginField` from `./partition-schema.js`
- Produces: `mergeRow(args: { inputFields: OriginField[]; inputValues: Record<string, unknown>; listingValues: Record<string, unknown>; detailRow: Record<string, unknown>; url: string; pageNumber: number | null }): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/crawl/merge-row.test.ts
import { describe, it, expect } from 'vitest';
import { mergeRow } from './merge-row.js';

const BASE = {
  inputFields: [],
  inputValues: {},
  listingValues: {},
  detailRow: {},
  url: 'https://example.com/p/1',
  pageNumber: 2,
};

describe('mergeRow', () => {
  it('always stamps the system fields', () => {
    expect(mergeRow(BASE)).toEqual({ _url: 'https://example.com/p/1', _page_number: 2 });
  });

  it('records a null page number for a source with no listing phase', () => {
    expect(mergeRow({ ...BASE, pageNumber: null })._page_number).toBeNull();
  });

  it('includes detail values', () => {
    expect(mergeRow({ ...BASE, detailRow: { title: 'Kallax' } }).title).toBe('Kallax');
  });

  it('carries listing values down to the detail row', () => {
    expect(mergeRow({ ...BASE, listingValues: { category: 'Shelves' } }).category).toBe('Shelves');
  });

  it('copies an input-origin field from the named InputSet column', () => {
    const row = mergeRow({
      ...BASE,
      inputFields: [{ name: 'requested_category', type: 'string', origin: 'input', input_column: 'category_slug' }],
      inputValues: { category_slug: 'shelves' },
    });
    expect(row.requested_category).toBe('shelves');
  });

  it('falls back to the field name when input_column is absent', () => {
    const row = mergeRow({
      ...BASE,
      inputFields: [{ name: 'category_slug', type: 'string', origin: 'input' }],
      inputValues: { category_slug: 'shelves' },
    });
    expect(row.category_slug).toBe('shelves');
  });

  it('emits null for an input field whose column the row does not carry', () => {
    const row = mergeRow({
      ...BASE,
      inputFields: [{ name: 'missing', type: 'string', origin: 'input', input_column: 'absent' }],
      inputValues: { category_slug: 'shelves' },
    });
    expect(row.missing).toBeNull();
  });

  it('does not leak unrequested InputSet columns into the output', () => {
    const row = mergeRow({ ...BASE, inputValues: { internal_note: 'do not export' } });
    expect(row).not.toHaveProperty('internal_note');
  });

  it('merges all four origins into one row', () => {
    const row = mergeRow({
      inputFields: [{ name: 'batch', type: 'string', origin: 'input', input_column: 'batch' }],
      inputValues: { batch: 'Q3' },
      listingValues: { category: 'Shelves' },
      detailRow: { title: 'Kallax', price: 79 },
      url: 'https://example.com/p/1',
      pageNumber: 1,
    });
    expect(row).toEqual({
      batch: 'Q3',
      category: 'Shelves',
      title: 'Kallax',
      price: 79,
      _url: 'https://example.com/p/1',
      _page_number: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/merge-row.test.ts`
Expected: FAIL — `Cannot find module './merge-row.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/scraper/src/crawl/merge-row.ts
// The four origins are disjoint partitions of the schema, so assembling the
// final row is a plain key merge — no precedence rules, because no two origins
// can claim the same field.

import type { OriginField } from './partition-schema.js';

export type MergeRowArgs = {
  inputFields: OriginField[];
  inputValues: Record<string, unknown>;
  listingValues: Record<string, unknown>;
  detailRow: Record<string, unknown>;
  url: string;
  /** The listing page this URL was discovered on; null when there was no listing phase. */
  pageNumber: number | null;
};

export function mergeRow(args: MergeRowArgs): Record<string, unknown> {
  const fromInput: Record<string, unknown> = {};
  for (const field of args.inputFields) {
    const column = field.input_column ?? field.name;
    fromInput[field.name] = args.inputValues[column] ?? null;
  }

  return {
    ...fromInput,
    ...args.listingValues,
    ...args.detailRow,
    _url: args.url,
    _page_number: args.pageNumber,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/merge-row.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/crawl/merge-row.ts packages/scraper/src/crawl/merge-row.test.ts
git commit -m "feat(crawl): merge input, listing, detail and system values into one row"
```

---

### Task 6: `run_items` table and widened run status vocabulary

**Files:**
- Modify: `packages/db/src/schema.ts` (add after the `runs` relations block)
- Create: `packages/db/drizzle/0005_run_items.sql` (generated, not hand-written)
- Test: `packages/db/src/run-items.test.ts`

**Interfaces:**
- Consumes: `runs`, `extractions` tables
- Produces: exported Drizzle table `runItems` with columns `id, runId, kind, url, inputIndex, inputValues, listingValues, pageNumber, parentId, status, attempts, error, extractionId, startedAt, completedAt, createdAt`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/run-items.test.ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { runItems } from './schema.js';

describe('run_items table', () => {
  it('is named run_items', () => {
    expect(getTableConfig(runItems).name).toBe('run_items');
  });

  it('carries every column the crawler needs', () => {
    const columns = getTableConfig(runItems).columns.map((c) => c.name).sort();
    expect(columns).toEqual([
      'attempts', 'completed_at', 'created_at', 'error', 'extraction_id', 'id',
      'input_index', 'input_values', 'kind', 'listing_values', 'page_number',
      'parent_id', 'run_id', 'started_at', 'status', 'url',
    ]);
  });

  it('defaults a new item to pending with zero attempts', () => {
    const config = getTableConfig(runItems);
    const status = config.columns.find((c) => c.name === 'status');
    const attempts = config.columns.find((c) => c.name === 'attempts');
    expect(status?.default).toBe('pending');
    expect(attempts?.default).toBe(0);
  });

  it('enforces one row per URL per run, so the same product on two pages queues once', () => {
    const unique = getTableConfig(runItems).uniqueConstraints.map((u) => u.columns.map((c) => c.name));
    expect(unique).toContainEqual(['run_id', 'url']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/db exec vitest run src/run-items.test.ts`
Expected: FAIL — `runItems` is not exported from `./schema.js`

- [ ] **Step 3: Add the table to the schema**

In `packages/db/src/schema.ts`, immediately after the `runsRelations` block:

```typescript
// ─── Run Items (v2 crawler) ─────────────────────────────────────────────────
//
// Simultaneously the work list, the queue, and the per-URL status record. The
// unique (run_id, url) constraint is the dedupe mechanism: the same product
// appearing on two listing pages is queued once.

export const runItems = pgTable('run_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  // 'listing' | 'detail'
  kind: varchar('kind', { length: 10 }).notNull(),
  url: text('url').notNull(),
  /** Which InputSet row this item descends from. */
  inputIndex: integer('input_index').notNull().default(0),
  /** Snapshot of that row, so a historical run stays reproducible if the InputSet changes. */
  inputValues: jsonb('input_values').notNull().default({}),
  /** Values captured on the listing page for this row (category, listing price, ...). */
  listingValues: jsonb('listing_values').notNull().default({}),
  /** Listing items: which page this is. Detail items: which page discovered the URL. */
  pageNumber: integer('page_number'),
  parentId: uuid('parent_id'),
  // 'pending' | 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  extractionId: uuid('extraction_id').references(() => extractions.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('run_items_run_url_idx').on(table.runId, table.url),
  index('run_items_run_status_idx').on(table.runId, table.status),
  index('run_items_run_kind_idx').on(table.runId, table.kind),
]);

export const runItemsRelations = relations(runItems, ({ one }) => ({
  run: one(runs, { fields: [runItems.runId], references: [runs.id] }),
  extraction: one(extractions, { fields: [runItems.extractionId], references: [extractions.id] }),
  parent: one(runItems, { fields: [runItems.parentId], references: [runItems.id], relationName: 'run_item_parent' }),
}));
```

Note: `parentId` is deliberately declared without an inline `.references()` — a self-reference inside the same `pgTable` call cannot see `runItems` yet. The FK is added in the migration SQL in Step 5.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/db exec vitest run src/run-items.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Generate and complete the migration**

```bash
pnpm --filter @robot/db exec drizzle-kit generate
```

This writes `packages/db/drizzle/0005_*.sql`. Open it and append the self-FK Drizzle could not infer:

```sql
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_parent_id_run_items_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "run_items"("id") ON DELETE set null;
```

- [ ] **Step 6: Apply and verify the migration**

```bash
docker start robot-platform-db
pnpm db:migrate
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "\d run_items"
```

Expected: the table exists with the unique index `run_items_run_url_idx` and both foreign keys.

- [ ] **Step 7: Run the full gate**

Run: `pnpm -r test`
Expected: PASS — no regressions

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/run-items.test.ts packages/db/drizzle/
git commit -m "feat(db): run_items — the crawler's work list, queue and per-URL status"
```

---

### Task 7: Put `crawl()` on the `IBrowser` interface and let it start from page 2

**Files:**
- Modify: `packages/browser/src/types.ts` (the `IBrowser` interface at ~line 56; `CrawlOptions` at ~line 76)
- Modify: `packages/browser/src/playwright-browser.ts` (the `crawl` generator at ~line 720)
- Test: `packages/browser/src/crawl-options.test.ts`

**Interfaces:**
- Consumes: existing `CrawlPage`, `PaginationConfig`
- Produces: `IBrowser.crawl(startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage>`; `CrawlOptions.startPage?: number` (default 1)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/browser/src/crawl-options.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage } from './types.js';

/** A stand-in proving IBrowser is implementable without Playwright — which is
 *  exactly what the crawler's tests need and what the interface did not allow. */
class FakeBrowser implements IBrowser {
  constructor(private readonly pages: CrawlPage[]) {}
  async launch(): Promise<void> {}
  async capture(): Promise<never> { throw new Error('not used'); }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('not used'); }
  async close(): Promise<void> {}
  async *crawl(_startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
    const from = options.startPage ?? 1;
    for (const page of this.pages) {
      if (page.pageNumber < from) continue;
      yield page;
    }
  }
}

const PAGES: CrawlPage[] = [
  { url: 'https://example.com/c?page=1', pageNumber: 1, data: [{ detail_url: '/p/1' }], totalRows: 1 },
  { url: 'https://example.com/c?page=2', pageNumber: 2, data: [{ detail_url: '/p/2' }], totalRows: 1 },
];

async function collect(browser: IBrowser, options: CrawlOptions): Promise<number[]> {
  const seen: number[] = [];
  for await (const page of browser.crawl('https://example.com/c', options)) seen.push(page.pageNumber);
  return seen;
}

describe('IBrowser.crawl', () => {
  it('is part of the interface, so a fake can satisfy it', async () => {
    const browser: IBrowser = new FakeBrowser(PAGES);
    expect(await collect(browser, { extractionScript: 'x' })).toEqual([1, 2]);
  });

  it('skips pages before startPage, so a caller that already captured page 1 does not refetch it', async () => {
    const browser: IBrowser = new FakeBrowser(PAGES);
    expect(await collect(browser, { extractionScript: 'x', startPage: 2 })).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/browser exec vitest run src/crawl-options.test.ts`
Expected: FAIL — TypeScript error: `crawl` does not exist on type `IBrowser`, and `startPage` does not exist on `CrawlOptions`

- [ ] **Step 3: Extend the types**

In `packages/browser/src/types.ts`, add to `IBrowser` (after `setContentEvaluate`):

```typescript
  crawl(startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage>;
```

and to `CrawlOptions`:

```typescript
  /**
   * First page to yield. Default 1. Phase 1 of the crawler captures page 1
   * itself (it needs the full capture for selector generation), so it resumes
   * pagination at 2 rather than paying for that page load twice.
   */
  startPage?: number;
```

- [ ] **Step 4: Honour `startPage` in the implementation**

In `packages/browser/src/playwright-browser.ts`, inside `crawl`, replace the page-1 block so it is skipped when starting later. After `const page = await this.context.newPage();` and inside the `try`, the page-1 section becomes:

```typescript
      const startPage = options.startPage ?? 1;

      // Page 1: navigate, extract, detect pagination. Skipped when the caller
      // already captured it and only wants the pages after it.
      await this.navigateWithFallback(page, startUrl);
      await this.dismissPopups(page);
      await this.expandHiddenContent(page);

      const page1Html = await page.content();

      if (startPage <= 1) {
        const page1Data = await page.evaluate(options.extractionScript) as { data: Record<string, unknown>[]; totalRows: number };
        yield { url: startUrl, pageNumber: 1, data: page1Data.data, totalRows: page1Data.totalRows };
        totalItems += page1Data.data.length;
        if (totalItems >= maxItems || maxPages <= 1) return;
      }
```

The `for (let pageNum = 2; ...)` loop below it is unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @robot/browser exec vitest run`
Expected: PASS — the two new tests plus all existing browser tests

- [ ] **Step 6: Commit**

```bash
git add packages/browser/src/types.ts packages/browser/src/playwright-browser.ts packages/browser/src/crawl-options.test.ts
git commit -m "feat(browser): crawl() joins IBrowser and gains startPage"
```

---

### Task 8: Run cached XPaths against captured HTML instead of re-navigating

**Files:**
- Modify: `packages/scraper/src/extraction-orchestrator.ts` (STEP 1.5, the `browser.evaluate(...)` call inside the `stillMissing` block)
- Test: `packages/scraper/src/extraction-orchestrator-cached-xpath.test.ts`

**Interfaces:**
- Consumes: `IBrowser.setContentEvaluate`, already on the interface
- Produces: no new exports; a behavioural guarantee that the cached-XPath tier performs no navigation

**Why:** `evaluate()` opens a new page and re-navigates the URL, so every warm item loads its page twice. At crawl scale that doubles requests and wall-clock against a domain whose anti-bot is the binding constraint. `setContentEvaluate` already runs generated scripts against captured HTML in real Chromium — the Tier 1 fixture harness has relied on it since 2026-05-25.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/extraction-orchestrator-cached-xpath.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';
import type { DomainCache } from './domain-cache.js';

const CAPTURE = {
  url: 'https://example.com/p/1',
  html: '<html><body><h1 id="t">Kallax</h1></body></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'Kallax',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
} as unknown as PageCapture;

const CACHE = {
  domain: 'example.com',
  pageType: 'detail',
  fieldPaths: {
    title: { paths: [{ path: '//h1[@id="t"]', source: 'xpath', uses: 3, hits: 3, lastUsedAt: new Date().toISOString() }] },
  },
  apiEndpoints: [],
  popupSelectors: [],
  totalRuns: 3,
  successfulRuns: 3,
  consecutiveFailures: 0,
} as unknown as DomainCache;

class RecordingBrowser implements IBrowser {
  navigations = 0;
  setContentCalls = 0;
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return CAPTURE; }
  async evaluate<T>(): Promise<T> {
    this.navigations++;
    return { data: [{ title: 'Kallax' }], fieldCount: 1 } as T;
  }
  async setContentEvaluate<T>(): Promise<T> {
    this.setContentCalls++;
    return { data: [{ title: 'Kallax' }], fieldCount: 1 } as T;
  }
  async close(): Promise<void> {}
  async *crawl(): AsyncGenerator<never> {}
}

describe('cached XPath tier', () => {
  it('resolves against the captured HTML without navigating a second time', async () => {
    const browser = new RecordingBrowser();
    await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture: CAPTURE,
        lookupCache: async () => CACHE,
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );
    expect(browser.setContentCalls).toBe(1);
    expect(browser.navigations).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/extraction-orchestrator-cached-xpath.test.ts`
Expected: FAIL — `expected 1 to be 0` on `navigations` (the tier still calls `evaluate`)

- [ ] **Step 3: Switch the tier to `setContentEvaluate`**

In `packages/scraper/src/extraction-orchestrator.ts`, replace the `browser.evaluate` call in the cached-XPath block with:

```typescript
            // Against the HTML we already captured — `evaluate` would open a new
            // page and re-navigate, doubling page loads on exactly the warm path
            // a crawl spends most of its time in.
            const xpathResult = await browser.setContentEvaluate<{ data: Record<string, unknown>[]; fieldCount: number }>(
              capture.html ?? '', cachedXPath.script,
            );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/extraction-orchestrator-cached-xpath.test.ts`
Expected: PASS — 1 test

Run: `pnpm --filter @robot/scraper exec vitest run`
Expected: PASS — including the Tier 1 corpus replay, which exercises this tier against real fixtures in real Chromium

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/extraction-orchestrator.ts packages/scraper/src/extraction-orchestrator-cached-xpath.test.ts
git commit -m "perf(extract): cached XPaths run against captured HTML, halving warm page loads"
```

---

### Task 9: `planRun` — phase 1 orchestration

**Files:**
- Create: `packages/scraper/src/crawl/plan-run.ts`
- Test: `packages/scraper/src/crawl/plan-run.test.ts`

**Interfaces:**
- Consumes: `resolveBudget`, `itemCap` (Task 1); `partitionSchemaByOrigin`, `OriginField` (Task 2); `buildInputUrls` (Task 3); `enumerateDetailUrls`, `DETAIL_URL_FIELD` (Task 4); `IBrowser.crawl` (Task 7); `runExtraction` from `../extraction-orchestrator.js`
- Produces:

```typescript
export type PlannedItem = {
  kind: 'listing' | 'detail';
  url: string;
  inputIndex: number;
  inputValues: Record<string, unknown>;
  listingValues: Record<string, unknown>;
  pageNumber: number | null;
};
export type PlanRunOutcome = {
  items: PlannedItem[];
  warnings: string[];
  errors: Array<{ inputIndex: number; message: string }>;
  cacheWarm: boolean;
};
export function planRun(request: PlanRunRequest, deps: PlanRunDeps): Promise<PlanRunOutcome>;
```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/crawl/plan-run.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture } from '@robot/browser';
import { planRun } from './plan-run.js';

const FAKE_CAPTURE = {
  url: 'https://example.com/c/shelves',
  html: '<html></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'Shelves',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
} as unknown as PageCapture;

class FakeBrowser implements IBrowser {
  captures = 0;
  constructor(private readonly pages: CrawlPage[] = []) {}
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { this.captures++; return FAKE_CAPTURE; }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('not used'); }
  async close(): Promise<void> {}
  async *crawl(_url: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
    const from = options.startPage ?? 1;
    for (const page of this.pages) if (page.pageNumber >= from) yield page;
  }
}

const LISTING_SOURCE = {
  listingMode: 'listing_to_detail' as const,
  inputStrategy: 'category' as const,
  urlTemplate: 'https://example.com/c/{slug}',
  budget: { max_pages: 2, max_items: 10, mode: 'first_n' },
};

const SCHEMA = [
  { name: 'title', type: 'string' },
  { name: 'category', type: 'string', origin: 'listing' as const },
];

const INPUT_SET = {
  columns: [{ name: 'slug', primary: true }],
  rows: [{ slug: 'shelves' }],
};

/** Stands in for runExtraction: returns the listing rows the chain would resolve. */
function fakeExtract(rows: Array<Record<string, unknown>>) {
  return async () => ({
    data: rows,
    plan: { row_xpath: '//li', fields: [] },
    confidence: 0.9,
    sources: {},
    fieldCount: { found: 1, total: 1 },
    fieldsByTier: { requested: [], discovered: [] },
    cacheHit: false,
  });
}

describe('planRun', () => {
  it('emits one detail item per listing row, carrying that row\'s listing values', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      {
        browser: new FakeBrowser(),
        agent: null,
        extract: fakeExtract([
          { detail_url: '/p/1', category: 'Shelves' },
          { detail_url: '/p/2', category: 'Shelves' },
        ]),
      },
    );
    const details = outcome.items.filter((i) => i.kind === 'detail');
    expect(details.map((i) => i.url)).toEqual(['https://example.com/p/1', 'https://example.com/p/2']);
    expect(details[0]?.listingValues).toEqual({ category: 'Shelves' });
  });

  it('records the listing page it walked as its own item', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      { browser: new FakeBrowser(), agent: null, extract: fakeExtract([{ detail_url: '/p/1' }]) },
    );
    const listings = outcome.items.filter((i) => i.kind === 'listing');
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({ url: 'https://example.com/c/shelves', pageNumber: 1 });
  });

  it('walks page 2 through crawl() and keeps its URLs, stamped with their page number', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      {
        browser: new FakeBrowser([
          { url: 'https://example.com/c/shelves?page=2', pageNumber: 2, data: [{ detail_url: '/p/3' }], totalRows: 1 },
        ]),
        agent: null,
        extract: fakeExtract([{ detail_url: '/p/1' }]),
      },
    );
    const details = outcome.items.filter((i) => i.kind === 'detail');
    expect(details.map((i) => i.url)).toEqual(['https://example.com/p/1', 'https://example.com/p/3']);
    expect(details[1]?.pageNumber).toBe(2);
  });

  it('stops at the item cap and reports it', async () => {
    const outcome = await planRun(
      { source: { ...LISTING_SOURCE, budget: { max_pages: 2, max_items: 1, mode: 'first_n' } }, schema: SCHEMA, inputSet: INPUT_SET },
      { browser: new FakeBrowser(), agent: null, extract: fakeExtract([{ detail_url: '/p/1' }, { detail_url: '/p/2' }]) },
    );
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(1);
    expect(outcome.warnings).toContain('budget reached: 1 items');
  });

  it('emits one detail item per input row for a detail-mode source, with no listing capture', async () => {
    const outcome = await planRun(
      {
        source: { listingMode: 'detail', inputStrategy: 'direct', urlTemplate: null, budget: {} },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://example.com/p/9' }] },
      },
      {
        browser: new FakeBrowser(),
        agent: null,
        extract: async () => { throw new Error('detail-mode planning must not capture a listing page'); },
      },
    );
    expect(outcome.items).toEqual([
      {
        kind: 'detail',
        url: 'https://example.com/p/9',
        inputIndex: 0,
        inputValues: { url: 'https://example.com/p/9' },
        listingValues: {},
        pageNumber: null,
      },
    ]);
  });

  it('warns when a detail-mode source has listing-origin fields that can never resolve', async () => {
    const outcome = await planRun(
      {
        source: { listingMode: 'detail', inputStrategy: 'direct', urlTemplate: null, budget: {} },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://example.com/p/9' }] },
      },
      { browser: new FakeBrowser(), agent: null, extract: async () => { throw new Error('unused'); } },
    );
    expect(outcome.warnings).toContain('1 listing-origin field(s) cannot resolve: this source has no listing phase');
  });

  it('reports a broken input row without losing the good ones', async () => {
    const outcome = await planRun(
      {
        source: { listingMode: 'detail', inputStrategy: 'direct', urlTemplate: null, budget: {} },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'nope' }, { url: 'https://example.com/p/9' }] },
      },
      { browser: new FakeBrowser(), agent: null, extract: async () => { throw new Error('unused'); } },
    );
    expect(outcome.items).toHaveLength(1);
    expect(outcome.errors).toEqual([{ inputIndex: 0, message: 'not an absolute http(s) URL: nope' }]);
  });

  it('records a listing capture that failed as an error and keeps planning the other inputs', async () => {
    let call = 0;
    const outcome = await planRun(
      {
        source: LISTING_SOURCE,
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'broken' }, { slug: 'shelves' }] },
      },
      {
        browser: new FakeBrowser(),
        agent: null,
        extract: async () => {
          call++;
          if (call === 1) throw new Error('navigation timeout');
          return { data: [{ detail_url: '/p/1' }], plan: null, confidence: 0, sources: {}, fieldCount: { found: 0, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false };
        },
      },
    );
    expect(outcome.errors[0]).toEqual({ inputIndex: 0, message: 'listing capture failed: navigation timeout' });
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(1);
  });

  it('dedupes a URL that two different inputs both surface', async () => {
    const outcome = await planRun(
      {
        source: LISTING_SOURCE,
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'a' }, { slug: 'b' }] },
      },
      { browser: new FakeBrowser(), agent: null, extract: fakeExtract([{ detail_url: 'https://example.com/p/same' }]) },
    );
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run.test.ts`
Expected: FAIL — `Cannot find module './plan-run.js'`

- [ ] **Step 3: Write the orchestrator**

```typescript
// packages/scraper/src/crawl/plan-run.ts
// Phase 1: walk listing pages and enumerate the work, spending nothing per
// detail page. The output is a work list you can look at before phase 2 turns
// it into page loads.
//
// The listing capture goes through the SAME runExtraction chain the rest of the
// pipeline uses, against a synthetic schema of `detail_url` plus every
// listing-origin field. Mechanical, cached-path, cached-XPath and AI tiers all
// apply unchanged, so a domain crawled before costs nothing here.

import type { IBrowser } from '@robot/browser';
import { runExtraction, type ExtractionAgent, type ExtractionOutcome } from '../extraction-orchestrator.js';
import { buildExtractionScript } from '../executor.js';
import { resolveBudget, itemCap } from './budget.js';
import { partitionSchemaByOrigin, type OriginField } from './partition-schema.js';
import { buildInputUrls, type InputSetColumn, type InputStrategy } from './build-input-urls.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

export type PlannedItem = {
  kind: 'listing' | 'detail';
  url: string;
  inputIndex: number;
  inputValues: Record<string, unknown>;
  listingValues: Record<string, unknown>;
  pageNumber: number | null;
};

export type PlanRunOutcome = {
  items: PlannedItem[];
  warnings: string[];
  errors: Array<{ inputIndex: number; message: string }>;
  cacheWarm: boolean;
};

export type PlanRunRequest = {
  source: {
    listingMode: string | null;
    inputStrategy: InputStrategy;
    urlTemplate: string | null;
    budget: unknown;
  };
  schema: OriginField[];
  inputSet: { columns: InputSetColumn[]; rows: Array<Record<string, unknown>> };
};

export type PlanRunDeps = {
  browser: IBrowser;
  agent: ExtractionAgent | null;
  /** Injected so tests can plan without a browser or an API key. */
  extract?: typeof runExtraction;
};

export async function planRun(request: PlanRunRequest, deps: PlanRunDeps): Promise<PlanRunOutcome> {
  const { source, schema, inputSet } = request;
  const extract = deps.extract ?? runExtraction;
  const budget = resolveBudget(source.budget);
  const cap = itemCap(budget);
  const partitions = partitionSchemaByOrigin(schema);

  const items: PlannedItem[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  const { urls, errors } = buildInputUrls({
    strategy: source.inputStrategy,
    urlTemplate: source.urlTemplate,
    columns: inputSet.columns,
    rows: inputSet.rows,
  });

  // Detail-mode sources have no listing phase: one item per input row.
  if (source.listingMode !== 'listing_to_detail') {
    if (partitions.listing.length > 0) {
      warnings.push(`${partitions.listing.length} listing-origin field(s) cannot resolve: this source has no listing phase`);
    }
    for (const start of urls) {
      if (seen.has(start.url)) continue;
      seen.add(start.url);
      items.push({
        kind: 'detail', url: start.url, inputIndex: start.inputIndex,
        inputValues: start.inputValues, listingValues: {}, pageNumber: null,
      });
    }
    return { items, warnings, errors, cacheWarm: false };
  }

  // The listing page is asked for the detail link plus every listing-origin field.
  const listingFields = [
    { name: DETAIL_URL_FIELD, type: 'url', description: 'Link to this row\'s detail page' },
    ...partitions.listing.map((f) => ({ name: f.name, type: f.type })),
  ];

  let cacheWarm = false;

  for (const start of urls) {
    if (items.filter((i) => i.kind === 'detail').length >= cap) break;

    // Captured ONCE and injected into the extraction. Task 10 adds a second,
    // document-mode pass over this same capture for page-level listing fields —
    // which is only free because the capture is not thrown away here.
    let page1: ExtractionOutcome;
    try {
      const capture = await deps.browser.capture(start.url, {
        waitUntil: 'networkidle',
        interceptNetworkRequests: true,
      });
      page1 = await extract(
        { url: start.url, fields: listingFields, pageType: 'listing' },
        { browser: deps.browser, agent: deps.agent, capture },
      );
    } catch (err) {
      errors.push({ inputIndex: start.inputIndex, message: `listing capture failed: ${(err as Error).message}` });
      continue;
    }
    cacheWarm ||= page1.cacheHit;

    items.push({
      kind: 'listing', url: start.url, inputIndex: start.inputIndex,
      inputValues: start.inputValues, listingValues: {}, pageNumber: 1,
    });

    const absorb = (rows: Array<Record<string, unknown>>, pageUrl: string, pageNumber: number): 'stop' | 'continue' => {
      const detailCount = items.filter((i) => i.kind === 'detail').length;
      const result = enumerateDetailUrls({ rows, pageUrl, pageNumber, seen, remaining: cap - detailCount });
      for (const item of result.items) {
        seen.add(item.url);
        items.push({
          kind: 'detail', url: item.url, inputIndex: start.inputIndex,
          inputValues: start.inputValues, listingValues: item.listingValues, pageNumber: item.pageNumber,
        });
      }
      if (result.stop === 'budget') {
        warnings.push(`budget reached: ${cap} items`);
        return 'stop';
      }
      return result.stop === null ? 'continue' : 'stop';
    };

    if (absorb(page1.data, start.url, 1) === 'stop') continue;
    if (budget.maxPages <= 1 || !page1.plan) continue;

    // Pages 2+ replay page 1's plan — no further AI, no re-fetch of page 1.
    // buildExtractionScript(plan, fieldTypes): the second argument is a
    // name → type map, so `detail_url` is collected as a URL, not a text node.
    const script = buildExtractionScript(page1.plan, { [DETAIL_URL_FIELD]: 'url' });
    try {
      for await (const page of deps.browser.crawl(start.url, {
        extractionScript: script,
        maxPages: budget.maxPages,
        startPage: 2,
      })) {
        items.push({
          kind: 'listing', url: page.url, inputIndex: start.inputIndex,
          inputValues: start.inputValues, listingValues: {}, pageNumber: page.pageNumber,
        });
        if (absorb(page.data, page.url, page.pageNumber) === 'stop') break;
      }
    } catch (err) {
      errors.push({ inputIndex: start.inputIndex, message: `pagination failed: ${(err as Error).message}` });
    }
  }

  return { items, warnings, errors, cacheWarm };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Run the package suite**

Run: `pnpm --filter @robot/scraper exec vitest run`
Expected: PASS — no regressions

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/crawl/plan-run.ts packages/scraper/src/crawl/plan-run.test.ts
git commit -m "feat(crawl): planRun — phase 1 listing walk and detail URL enumeration"
```

---

### Task 10: Page-level listing fields (the category-in-the-header case)

**Files:**
- Modify: `packages/scraper/src/crawl/plan-run.ts`
- Test: `packages/scraper/src/crawl/plan-run-page-level.test.ts`

**Interfaces:**
- Consumes: `planRun` (Task 9), `ExtractionDeps.capture`
- Produces: no new exports; every detail item's `listingValues` may now carry page-level values

**Why:** listing-origin fields come in two shapes. *Per-row* values (listing price, listing title) are extracted relative to `row_xpath` and follow their own `detail_url` — Task 9 handles those. *Page-level* values are shown once for the whole page: the category name in a breadcrumb or header, on a detail page that has no breadcrumb at all. Those are not per-row, so the row extraction never resolves them.

Phase 1 therefore runs a second **document-mode** pass over the *same capture* for any listing field no row resolved, and applies the result to every row from that page. Re-using the capture means no second fetch — only selector generation for those specific fields.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/crawl/plan-run-page-level.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture } from '@robot/browser';
import { planRun } from './plan-run.js';

const FAKE_CAPTURE = {
  url: 'https://example.com/c/shelves',
  html: '<html><h1>Shelves</h1></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'Shelves',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
} as unknown as PageCapture;

class FakeBrowser implements IBrowser {
  captures = 0;
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { this.captures++; return FAKE_CAPTURE; }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('not used'); }
  async close(): Promise<void> {}
  async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
}

const REQUEST = {
  source: {
    listingMode: 'listing_to_detail' as const,
    inputStrategy: 'category' as const,
    urlTemplate: 'https://example.com/c/{slug}',
    budget: { max_pages: 1 },
  },
  schema: [
    { name: 'title', type: 'string' },
    { name: 'category', type: 'string', origin: 'listing' as const },
    { name: 'listing_price', type: 'price', origin: 'listing' as const },
  ],
  inputSet: { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'shelves' }] },
};

const OUTCOME_SHAPE = {
  plan: { row_xpath: '//li', fields: [] },
  confidence: 0.9,
  sources: {},
  fieldCount: { found: 1, total: 1 },
  fieldsByTier: { requested: [], discovered: [] },
  cacheHit: false,
};

describe('page-level listing fields', () => {
  it('fills a listing field no row resolved from a document-mode pass, for every row', async () => {
    const calls: Array<{ pageType: string; fields: string[] }> = [];
    const outcome = await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) => {
        calls.push({ pageType: request.pageType ?? 'detail', fields: request.fields.map((f) => f.name) });
        // First call: the row pass resolves per-row price but no category.
        if (calls.length === 1) {
          return {
            ...OUTCOME_SHAPE,
            data: [
              { detail_url: '/p/1', listing_price: '79' },
              { detail_url: '/p/2', listing_price: '49' },
            ],
          };
        }
        // Second call: the document-mode pass finds the category in the header.
        return { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });

    const details = outcome.items.filter((i) => i.kind === 'detail');
    expect(details[0]?.listingValues).toEqual({ listing_price: '79', category: 'Shelves' });
    expect(details[1]?.listingValues).toEqual({ listing_price: '49', category: 'Shelves' });
  });

  it('asks the second pass only for the fields the rows left unresolved', async () => {
    const calls: Array<string[]> = [];
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) => {
        calls.push(request.fields.map((f) => f.name));
        if (calls.length === 1) return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', listing_price: '79' }] };
        return { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });
    expect(calls[1]).toEqual(['category']);
  });

  it('runs the second pass in document mode, not row mode', async () => {
    const pageTypes: string[] = [];
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) => {
        pageTypes.push(request.pageType ?? 'detail');
        if (pageTypes.length === 1) return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1' }] };
        return { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });
    expect(pageTypes).toEqual(['listing', 'detail']);
  });

  it('lets a per-row value win over the page-level one for the same field', async () => {
    const outcome = await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) =>
        request.pageType === 'listing'
          ? { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', category: 'Bookcases', listing_price: '79' }] }
          : { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] },
    });
    expect(outcome.items.find((i) => i.kind === 'detail')?.listingValues.category).toBe('Bookcases');
  });

  it('skips the second pass entirely when every listing field resolved per row', async () => {
    let calls = 0;
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async () => {
        calls++;
        return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', category: 'Shelves', listing_price: '79' }] };
      },
    });
    expect(calls).toBe(1);
  });

  it('captures the listing page only once across both passes', async () => {
    const browser = new FakeBrowser();
    await planRun(REQUEST, {
      browser,
      agent: null,
      extract: async (request) =>
        request.pageType === 'listing'
          ? { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1' }] }
          : { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] },
    });
    expect(browser.captures).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-page-level.test.ts`
Expected: FAIL — `expected { listing_price: '79' } to equal { listing_price: '79', category: 'Shelves' }`; only one extract call is made

- [ ] **Step 3: Add the second pass**

In `packages/scraper/src/crawl/plan-run.ts`, widen the browser import to `import type { IBrowser, PageCapture } from '@robot/browser';`, hold the capture in a variable so both passes share it, and add the page-level pass immediately after the row pass:

```typescript
    let page1: ExtractionOutcome;
    let capture: PageCapture | undefined;
    try {
      capture = await deps.browser.capture(start.url, {
        waitUntil: 'networkidle',
        interceptNetworkRequests: true,
      });
      page1 = await extract(
        { url: start.url, fields: listingFields, pageType: 'listing' },
        { browser: deps.browser, agent: deps.agent, capture },
      );
    } catch (err) {
      errors.push({ inputIndex: start.inputIndex, message: `listing capture failed: ${(err as Error).message}` });
      continue;
    }
    cacheWarm ||= page1.cacheHit;

    // Page-level listing fields: a value shown once for the whole page (the
    // category in a breadcrumb) is not per-row, so no row resolved it. A second
    // document-mode pass over the SAME capture costs no fetch.
    let pageLevelValues: Record<string, unknown> = {};
    const unresolved = partitions.listing.filter(
      (field) => !page1.data.some((row) => row[field.name] !== undefined && row[field.name] !== null),
    );
    if (unresolved.length > 0) {
      try {
        const pageLevel = await extract(
          {
            url: start.url,
            fields: unresolved.map((f) => ({ name: f.name, type: f.type })),
            pageType: 'detail',
          },
          { browser: deps.browser, agent: deps.agent, capture },
        );
        pageLevelValues = pageLevel.data[0] ?? {};
      } catch (err) {
        warnings.push(`page-level listing fields failed on ${start.url}: ${(err as Error).message}`);
      }
    }
```

Then, inside `absorb`, merge page-level values underneath the per-row ones so a per-row value always wins:

```typescript
        items.push({
          kind: 'detail', url: item.url, inputIndex: start.inputIndex,
          inputValues: start.inputValues,
          listingValues: { ...pageLevelValues, ...item.listingValues },
          pageNumber: item.pageNumber,
        });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-page-level.test.ts`
Expected: PASS — 6 tests

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/`
Expected: PASS — Task 9's tests still pass

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/crawl/plan-run.ts packages/scraper/src/crawl/plan-run-page-level.test.ts
git commit -m "feat(crawl): page-level listing fields carried down to every detail row"
```

---

### Task 11: Tier 1 listing fixture and a deterministic enumeration gate

**Files:**
- Create: `packages/scraper/src/__fixtures__/corpus/<label>-listing.json` (captured, not hand-written)
- Modify: `packages/scraper/src/__fixtures__/corpus/manifest.ts`
- Create: `packages/scraper/src/crawl/enumerate-fixture.test.ts`

**Interfaces:**
- Consumes: `loadFixture` from `../__fixtures__/load.js`; `enumerateDetailUrls` (Task 4)
- Produces: a fixture label other tests can load

**Why:** the corpus is entirely detail pages, so link enumeration and pagination detection have no deterministic gate at all today.

- [ ] **Step 1: Capture a real listing page**

Pick a category URL on a domain the corpus already covers and that is not hard-blocked — `newegg` is the safest (it is measured, and its fixture already passes liveness).

```bash
docker start robot-platform-db
pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts "https://www.newegg.com/Video-Cards-Video-Devices/Category/ID-38" newegg-gpu-listing listing
```

- [ ] **Step 2: Inspect what was captured and write the goldens**

```bash
node -e "const f=require('./packages/scraper/src/__fixtures__/corpus/newegg-gpu-listing.json'); console.log(f.url, f.html.length, Object.keys(f.structuredData));"
```

Open the fixture JSON and set `expected` to the values a human can verify on the page — at minimum:

```json
  "expected": {
    "detail_url": null
  }
```

`detail_url` stays `null` in `expected` because the golden for a listing is the *count and shape* of links, asserted in Step 3, not one value. Leave the rest of `expected` empty rather than inventing goldens.

- [ ] **Step 3: Write the failing enumeration test**

```typescript
// packages/scraper/src/crawl/enumerate-fixture.test.ts
// Tier 1: link enumeration against a frozen listing capture. No network, no AI.
import { describe, it, expect } from 'vitest';
import { loadFixture } from '../__fixtures__/load.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const FIXTURE = 'newegg-gpu-listing';

/** Pulls every product link out of the frozen HTML the way a row extraction would. */
function hrefsFromFixtureHtml(html: string): Array<Record<string, unknown>> {
  const hrefs = [...html.matchAll(/href="([^"]*\/p\/[^"]*)"/gi)].map((m) => m[1]!);
  return hrefs.map((href) => ({ [DETAIL_URL_FIELD]: href }));
}

describe('detail URL enumeration against a frozen listing capture', () => {
  const fixture = loadFixture(FIXTURE);

  it('is a listing fixture', () => {
    expect(fixture.pageType).toBe('listing');
  });

  it('finds product links in the captured page', () => {
    const rows = hrefsFromFixtureHtml(fixture.html);
    expect(rows.length).toBeGreaterThan(5);
  });

  it('turns them into absolute, deduped, budget-capped work items', () => {
    const rows = hrefsFromFixtureHtml(fixture.html);
    const result = enumerateDetailUrls({
      rows, pageUrl: fixture.url, pageNumber: 1, seen: new Set(), remaining: 10,
    });
    expect(result.items.length).toBeLessThanOrEqual(10);
    for (const item of result.items) {
      expect(item.url).toMatch(/^https:\/\//);
    }
    expect(new Set(result.items.map((i) => i.url)).size).toBe(result.items.length);
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/enumerate-fixture.test.ts`

Before capturing: FAIL — fixture file not found. After Step 1: PASS — 3 tests.

If the `\/p\/` pattern finds no links, open the fixture HTML, find the real product-URL shape, and update `hrefsFromFixtureHtml` to match it. Do not weaken the assertions.

- [ ] **Step 5: Register the fixture in the manifest**

Open `packages/scraper/src/__fixtures__/corpus/manifest.ts`, read how existing entries are shaped, and add `newegg-gpu-listing` in the same form. If the manifest only lists detail fixtures and the corpus test would now demand goldens the listing has none of, exclude it there and leave enumeration coverage to this test file.

- [ ] **Step 6: Run the full gate**

Run: `pnpm -r test`
Expected: PASS — including `fixture-integrity.test.ts`, which validates fixture shape

- [ ] **Step 7: Commit**

```bash
git add packages/scraper/src/__fixtures__/corpus/ packages/scraper/src/crawl/enumerate-fixture.test.ts
git commit -m "test(crawl): Tier 1 listing fixture — first deterministic gate for link enumeration"
```

---

### Task 12: `crawl.plan` tRPC procedure

**Files:**
- Create: `packages/api/src/routers/crawl.ts`
- Modify: `packages/api/src/routers/index.ts` (register the router)
- Test: `packages/api/src/routers/crawl.test.ts`

**Interfaces:**
- Consumes: `planRun`, `PlannedItem` from `@robot/scraper`; `runs`, `runItems`, `sources`, `inputSets`, `datasets` from `@robot/db`
- Produces: `crawlRouter` with `plan({ sourceId })` returning `{ runId: string; itemCount: number; listingPages: number; warnings: string[]; errors: Array<{ inputIndex: number; message: string }>; cacheWarm: boolean }`

- [ ] **Step 1: Export the crawl module from `@robot/scraper`**

Check `packages/scraper/src/index.ts` and add, following the existing export style:

```typescript
export { planRun } from './crawl/plan-run.js';
export type { PlannedItem, PlanRunOutcome, PlanRunRequest } from './crawl/plan-run.js';
export { resolveBudget, itemCap, HARD_ITEM_CEILING } from './crawl/budget.js';
export { partitionSchemaByOrigin } from './crawl/partition-schema.js';
export type { OriginField, FieldOrigin } from './crawl/partition-schema.js';
export { mergeRow } from './crawl/merge-row.js';
export { DETAIL_URL_FIELD } from './crawl/enumerate-detail-urls.js';
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/api/src/routers/crawl.test.ts
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

describe('crawlRouter.plan', () => {
  it('rejects a missing sourceId', async () => {
    try {
      await caller.crawl.plan({} as never);
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
      if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
    }
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.crawl.plan({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
    }
  });

  it('reports a source that does not exist rather than creating an orphan run', async () => {
    await expect(
      caller.crawl.plan({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/routers/crawl.test.ts`
Expected: FAIL — `crawl` does not exist on the caller

- [ ] **Step 4: Write the router**

```typescript
// packages/api/src/routers/crawl.ts
// Phase 1 of the v2 crawler over HTTP. Thin by design: every decision lives in
// @robot/scraper's crawl module; this file owns the DB writes and the tRPC
// boundary only.

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { PlaywrightBrowser } from '@robot/browser';
import { SchemaAgent } from '@robot/agent';
import { planRun, type PlannedItem } from '@robot/scraper';
import { runs, runItems, sources } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const crawlRouter = router({
  plan: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        with: { dataset: { columns: { schema: true } }, inputSet: { columns: { columns: true, rows: true } } },
      });
      if (!source) throw new Error(`Source ${input.sourceId} not found`);
      if (!source.inputSet) throw new Error(`Source ${input.sourceId} has no InputSet to plan from`);

      const [run] = await ctx.db.insert(runs).values({
        sourceId: source.id,
        status: 'planning',
        startedAt: new Date(),
        inputLabel: (source.urlTemplate ?? source.name).slice(0, 200),
      }).returning({ id: runs.id });

      const browser = new PlaywrightBrowser();
      await browser.launch({ headless: true });
      try {
        const outcome = await planRun(
          {
            source: {
              listingMode: source.listingMode,
              inputStrategy: (source.inputStrategy ?? 'direct') as 'direct' | 'template' | 'category' | 'search',
              urlTemplate: source.urlTemplate,
              budget: source.budget,
            },
            schema: ((source.dataset?.schema ?? []) as Array<{ name: string; type: string }>),
            inputSet: {
              columns: (source.inputSet.columns ?? []) as Array<{ name: string; primary?: boolean; propagate?: boolean }>,
              rows: (source.inputSet.rows ?? []) as Array<Record<string, unknown>>,
            },
          },
          { browser, agent: new SchemaAgent() },
        );

        if (outcome.items.length > 0) {
          await ctx.db.insert(runItems).values(
            outcome.items.map((item: PlannedItem) => ({
              runId: run!.id,
              kind: item.kind,
              url: item.url,
              inputIndex: item.inputIndex,
              inputValues: item.inputValues,
              listingValues: item.listingValues,
              pageNumber: item.pageNumber,
            })),
          ).onConflictDoNothing();
        }

        const listingPages = outcome.items.filter((i) => i.kind === 'listing').length;
        const itemCount = outcome.items.length - listingPages;

        await ctx.db.update(runs)
          .set({ status: 'planned', resultCount: itemCount })
          .where(eq(runs.id, run!.id));

        return {
          runId: run!.id,
          itemCount,
          listingPages,
          warnings: outcome.warnings,
          errors: outcome.errors,
          cacheWarm: outcome.cacheWarm,
        };
      } catch (err) {
        await ctx.db.update(runs)
          .set({ status: 'failed', errorMessage: (err as Error).message, completedAt: new Date() })
          .where(eq(runs.id, run!.id));
        throw err;
      } finally {
        await browser.close();
      }
    }),
});
```

- [ ] **Step 5: Register the router**

In `packages/api/src/routers/index.ts`, import `crawlRouter` and add `crawl: crawlRouter` to `appRouter`, following the existing entries.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @robot/api exec vitest run src/routers/crawl.test.ts`
Expected: PASS — 3 tests

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/scraper/src/index.ts packages/api/src/routers/crawl.ts packages/api/src/routers/index.ts packages/api/src/routers/crawl.test.ts
git commit -m "feat(api): crawl.plan — persist a run's work list without extracting"
```

---

### Task 13: Field origin control in the Dataset schema editor

**Files:**
- Modify: `packages/dashboard/src/routes/dataset-detail.tsx`
- Create: `packages/dashboard/src/lib/field-origin.ts`
- Test: `packages/dashboard/src/lib/field-origin.test.ts`

**Interfaces:**
- Consumes: `datasets.updateSchema` (Task 2)
- Produces: `FIELD_ORIGINS`, `originLabel(origin?: string): string`

**Note:** the dashboard has no component-test infrastructure — only opt-in Playwright smoke tests. Testable logic goes in a pure helper, as `screenshot-url.ts` and `export-url.ts` already do; the JSX is verified manually in Step 5.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/dashboard/src/lib/field-origin.test.ts
import { describe, it, expect } from 'vitest';
import { FIELD_ORIGINS, originLabel } from './field-origin';

describe('field origin', () => {
  it('offers exactly the four origins the pipeline understands', () => {
    expect(FIELD_ORIGINS).toEqual(['detail', 'listing', 'input', 'system']);
  });

  it('labels an unset origin as the detail default rather than blank', () => {
    expect(originLabel(undefined)).toBe('Detail page');
  });

  it('labels each origin in the language of where the value comes from', () => {
    expect(originLabel('listing')).toBe('Listing page');
    expect(originLabel('input')).toBe('Input column');
    expect(originLabel('system')).toBe('System');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/field-origin.test.ts`
Expected: FAIL — `Cannot find module './field-origin'`

- [ ] **Step 3: Write the helper**

```typescript
// packages/dashboard/src/lib/field-origin.ts
/** Where a schema field's value is resolved. Absent means the detail page. */
export const FIELD_ORIGINS = ['detail', 'listing', 'input', 'system'] as const;

export type FieldOrigin = (typeof FIELD_ORIGINS)[number];

const LABELS: Record<FieldOrigin, string> = {
  detail: 'Detail page',
  listing: 'Listing page',
  input: 'Input column',
  system: 'System',
};

export function originLabel(origin?: string): string {
  return LABELS[(origin ?? 'detail') as FieldOrigin] ?? LABELS.detail;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/field-origin.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Add the control to the Dataset page**

Read `packages/dashboard/src/routes/dataset-detail.tsx` first — it is ~117 lines and currently lists Sources, not schema fields. Add this component to that file and render it above the Sources list, passing the dataset's id and schema:

```tsx
type SchemaField = { name: string; type: string; origin?: string; input_column?: string };

function SchemaFieldOrigins({ datasetId, schema }: { datasetId: string; schema: SchemaField[] }) {
  const [fields, setFields] = useState<SchemaField[]>(schema);
  const utils = trpc.useUtils();
  const updateSchema = trpc.datasets.updateSchema.useMutation({
    onSuccess: () => utils.datasets.invalidate(),
  });

  function setOrigin(index: number, origin: string) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, origin } : f)));
  }

  if (fields.length === 0) {
    return <p className="mt-6 text-sm text-gray-500">This dataset has no schema fields yet.</p>;
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Schema fields</h2>
      <p className="mt-1 text-xs text-gray-500">
        Where each value comes from. Listing-page fields are captured while crawling and carried
        down to every detail row.
      </p>
      <table className="mt-3 w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Field</th>
            <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Type</th>
            <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Comes from</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, i) => (
            <tr key={field.name} className="border-b last:border-b-0">
              <td className="py-2 pr-4 font-mono text-xs">{field.name}</td>
              <td className="py-2 pr-4 font-mono text-xs text-gray-500">{field.type}</td>
              <td className="py-2 pr-4">
                <select
                  value={field.origin ?? 'detail'}
                  onChange={(e) => setOrigin(i, e.target.value)}
                  className="rounded border px-2 py-1 text-xs"
                >
                  {FIELD_ORIGINS.map((origin) => (
                    <option key={origin} value={origin}>{originLabel(origin)}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => updateSchema.mutate({ datasetId, schema: fields })}
        disabled={updateSchema.isPending}
        className="mt-3 rounded border px-3 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {updateSchema.isPending ? 'Saving...' : 'Save field origins'}
      </button>
      {updateSchema.isError && (
        <p className="mt-2 text-xs text-red-600">{updateSchema.error.message}</p>
      )}
    </div>
  );
}
```

Add the imports this needs at the top of the file: `useState` from `react`, and `FIELD_ORIGINS, originLabel` from `../lib/field-origin`. `trpc` is already imported there.

Verify manually — there is no component test to catch a mistake here:

```bash
pnpm dev:all
```

Open `http://localhost:3456/p/sandbox/datasets`, open a Dataset, change a field's origin to "Listing page", save, reload, and confirm it persisted. Then confirm in the database:

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select schema from datasets limit 1;"
```

Expected: the field carries `"origin": "listing"`.

- [ ] **Step 6: Typecheck and run the gate**

Run: `pnpm --filter @robot/dashboard exec tsc --noEmit`
Expected: PASS

Run: `pnpm -r test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/lib/field-origin.ts packages/dashboard/src/lib/field-origin.test.ts packages/dashboard/src/routes/dataset-detail.tsx
git commit -m "feat(dashboard): classify each schema field by where its value comes from"
```

---

## Done when

- `pnpm -r test` passes with Postgres running; `pnpm typecheck` plus `tsc --noEmit` on api-server and dashboard are clean.
- `crawl.plan({ sourceId })` on a `listing_to_detail` Source writes `run_items` rows and returns item count, listing page count, warnings and errors — with no detail page fetched.
- The same procedure on a `detail`-mode Source produces one item per input row and warns about unresolvable listing-origin fields.
- A listing field shown once per page (a category in a header) reaches every detail row from that page, resolved from the capture already taken rather than a second fetch.
- A Tier 1 listing fixture gates link enumeration offline.
- Warm extractions no longer re-navigate for cached XPaths.

## Not in this plan (Plan B)

Phase 2 `execute` and its worker loop, cancel/resume, `api-param` pagination detection and replay, pagination config caching to `domain_intelligence`, read-side aggregation in `runs.getWithDetails` and `loadRunExport`, and the live dogfood crawl.
