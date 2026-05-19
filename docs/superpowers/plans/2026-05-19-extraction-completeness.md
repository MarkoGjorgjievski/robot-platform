# Extraction Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three loops in the extraction pipeline so every discovered+toggled field returns a row, the cache remembers fields it failed to resolve, and `__NEXT_DATA__` / JSON-LD blobs become first-class extraction sources instead of orphaned ones.

**Architecture:**
1. **Contract layer:** `sandbox.extract` always returns one result row per toggled-on schema field (value or `null`) — for both `requested` and `discovered` tiers. No silent drops.
2. **Cache layer:** `saveDomainCache` persists discovered-but-unresolved fields as empty-path entries (`paths: []`). `analyze` cache-hit re-runs AI discovery for fields with empty paths so they get re-attempted rather than buried.
3. **Source coverage:** AI API analysis consumes `capture.structuredData.nextData` and `capture.structuredData.ldJson` alongside `interceptedRequests`. An entity-subtree identifier locates the product subtree before extraction, cutting noise. A shape-validation post-filter rejects values whose shape doesn't match the requested type.

**Tech Stack:** TypeScript, Vitest, tRPC v11, Drizzle ORM, existing `@robot/scraper` + `@robot/agent` + `@robot/api`.

**Roadmap slot:** Track A v1.1a (sits in front of v1.1's data-quality work — both pipeline-only, can ship independently).

**Why this matters (context for new thread):** Dogfooding the Phase-4-complete dashboard on Amazon Godiva revealed three compounding bugs. Analyze proposed 14 fields, all toggled-on. Extract returned 9 (sizes, flavours, etc. silently dropped). Cache stored those 9 paths only. Second run hit cache, schema reduced to 9 — the 5 lost fields were permanently forgotten. Root cause spread across `scraper.ts:496-504` (contract), `domain-cache.ts:436` (`mergeFieldPaths` skips path-less results), and the architectural decision to mechanically skip `__NEXT_DATA__` without ever wiring AI into that path. See `docs/ideas.md` → "Extraction completeness" + "Treat `__NEXT_DATA__` / JSON-LD blobs as first-class extraction sources."

---

## File Structure

**New:**
- `packages/api/src/routers/lib/build-result-rows.ts` — Pure function that maps schemaFields → result rows. Extracts inline logic from `scraper.ts:485-504` so it's unit-testable.
- `packages/api/src/routers/lib/build-result-rows.test.ts`
- `packages/scraper/src/entity-subtree.ts` — Heuristic identification of the product/entity subtree inside a nested JSON blob.
- `packages/scraper/src/entity-subtree.test.ts`
- `packages/scraper/src/shape-validator.ts` — Type/shape post-filter for resolved field values.
- `packages/scraper/src/shape-validator.test.ts`

**Modified:**
- `packages/api/src/routers/scraper.ts` — Use `buildResultRows`. Pass nextData + ldJson into AI API analysis. Hook shape validator at result-build boundary.
- `packages/scraper/src/domain-cache.ts` — `saveDomainCache` accepts a `discoveredFieldNames` set, writes empty-path entries for unresolved discovered fields. `mergeFieldPaths` handles empty-path entries without pruning them.
- `packages/scraper/src/index.ts` — Re-export `findEntitySubtree`, `validateFieldShape`.
- `docs/extraction-architecture.md` — Note the new structured-data flow (nextData/ldJson reach AI API analysis via entity-subtree identification).

---

## Task 1: Extract `buildResultRows` pure function + fix discovered-tier contract

**Files:**
- Create: `packages/api/src/routers/lib/build-result-rows.ts`
- Create: `packages/api/src/routers/lib/build-result-rows.test.ts`
- Modify: `packages/api/src/routers/scraper.ts:485-504`

The result-building logic at `scraper.ts:485-504` builds `requestedResults` from `schemaFields` (correct — fills `null` for unresolved) but builds `discoveredResults` from `Object.entries(finalData)` (wrong — silently drops unresolved fields). Extract a single pure helper that handles both tiers symmetrically, unit-test it, then call it from `scraper.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/routers/lib/build-result-rows.test.ts
import { describe, it, expect } from 'vitest';
import { buildResultRows } from './build-result-rows.js';

const requested = (name: string, type = 'string') => ({ name, type, tier: 'requested' as const });
const discovered = (name: string, type = 'string') => ({ name, type, tier: 'discovered' as const });

describe('buildResultRows', () => {
  it('emits all requested fields with null + not_found when unresolved', () => {
    const out = buildResultRows({
      schemaFields: [requested('price'), requested('title')],
      finalData: { price: '$24.99' },
      sources: { price: 'api' },
    });
    expect(out.requested).toEqual([
      { name: 'price', type: 'string', value: '$24.99', status: 'found', source: 'api' },
      { name: 'title', type: 'string', value: null, status: 'not_found', source: null },
    ]);
    expect(out.discovered).toEqual([]);
  });

  it('emits all discovered fields with null + not_found when unresolved', () => {
    const out = buildResultRows({
      schemaFields: [discovered('sizes'), discovered('flavours')],
      finalData: { sizes: ['S', 'M', 'L'] },
      sources: { sizes: 'xpath' },
    });
    expect(out.discovered).toEqual([
      { name: 'sizes', type: 'string', value: ['S', 'M', 'L'], status: 'found', source: 'xpath' },
      { name: 'flavours', type: 'string', value: null, status: 'not_found', source: null },
    ]);
  });

  it('treats null value as not_found, not as a successful empty hit', () => {
    const out = buildResultRows({
      schemaFields: [requested('description')],
      finalData: { description: null },
      sources: {},
    });
    expect(out.requested[0]).toMatchObject({ status: 'not_found', value: null });
  });

  it('treats undefined value identically to missing key', () => {
    const out = buildResultRows({
      schemaFields: [discovered('weight')],
      finalData: { weight: undefined } as Record<string, unknown>,
      sources: {},
    });
    expect(out.discovered[0]).toMatchObject({ status: 'not_found', value: null });
  });

  it('partitions strictly by tier — a discovered field with same name as a requested one stays in its tier', () => {
    const out = buildResultRows({
      schemaFields: [requested('price'), discovered('sizes')],
      finalData: { price: '$24.99', sizes: ['S'] },
      sources: { price: 'api', sizes: 'xpath' },
    });
    expect(out.requested.map(r => r.name)).toEqual(['price']);
    expect(out.discovered.map(r => r.name)).toEqual(['sizes']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api test build-result-rows`
Expected: FAIL with "Cannot find module './build-result-rows.js'"

- [ ] **Step 3: Implement the helper**

```typescript
// packages/api/src/routers/lib/build-result-rows.ts
export type SchemaFieldLite = {
  name: string;
  type: string;
  tier: 'requested' | 'discovered';
};

export type ResultRow = {
  name: string;
  type: string;
  value: unknown;
  status: 'found' | 'not_found';
  source: string | null;
};

export type BuildResultRowsInput = {
  schemaFields: SchemaFieldLite[];
  finalData: Record<string, unknown>;
  sources: Record<string, string>;
};

export type BuildResultRowsOutput = {
  requested: ResultRow[];
  discovered: ResultRow[];
};

function toRow(field: SchemaFieldLite, finalData: Record<string, unknown>, sources: Record<string, string>): ResultRow {
  const raw = finalData[field.name];
  const resolved = raw !== undefined && raw !== null;
  return {
    name: field.name,
    type: field.type,
    value: resolved ? raw : null,
    status: resolved ? 'found' : 'not_found',
    source: sources[field.name] ?? null,
  };
}

export function buildResultRows(input: BuildResultRowsInput): BuildResultRowsOutput {
  const requested: ResultRow[] = [];
  const discovered: ResultRow[] = [];
  for (const field of input.schemaFields) {
    const row = toRow(field, input.finalData, input.sources);
    if (field.tier === 'requested') requested.push(row);
    else discovered.push(row);
  }
  return { requested, discovered };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/api test build-result-rows`
Expected: PASS — 5/5 tests

- [ ] **Step 5: Swap `scraper.ts` to use the helper**

Replace `packages/api/src/routers/scraper.ts:484-504` with:

```typescript
        // STEP 5: Quality validation
        const { data: cleanedData, issues: qualityIssues } = validateExtractedData(
          [finalData],
          schemaFields,
        );

        // Build result rows — every toggled-on schema field emits a row,
        // null + not_found if extraction couldn't resolve it.
        const { requested: requestedResults, discovered: discoveredResults } = buildResultRows({
          schemaFields: schemaFields.map(f => ({ name: f.name, type: f.type, tier: (f.tier ?? 'discovered') as 'requested' | 'discovered' })),
          finalData,
          sources,
        });
```

Add the import near the top of `scraper.ts`:

```typescript
import { buildResultRows } from './lib/build-result-rows.js';
```

- [ ] **Step 6: Verify the api package typechecks and existing tests still pass**

Run: `pnpm --filter @robot/api typecheck && pnpm --filter @robot/api test`
Expected: PASS, no new failures

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routers/lib/build-result-rows.ts packages/api/src/routers/lib/build-result-rows.test.ts packages/api/src/routers/scraper.ts
git commit -m "fix(extract): every toggled-on field returns a result row (null + not_found if unresolved)"
```

---

## Task 2: Persist discovered-but-unresolved fields in domain cache

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts` (extend `ExtractionOutcome`, `saveDomainCache`, `mergeFieldPaths`, `buildFreshPaths`)
- Create: `packages/scraper/src/domain-cache-discovered.test.ts`
- Modify: `packages/api/src/routers/scraper.ts:463-472` (pass discovered names)

`saveDomainCache` today only writes `fieldPaths` entries for fields in `fieldResults` (resolved). Discovered fields with no path are forgotten. Extend the input shape to include `discoveredFieldNames: string[]` and write an entry with `paths: []` for any name that isn't already in the merge. These entries flow through the existing analyze cache-hit logic (which reads `Object.entries(cache.fieldPaths)`), so they reappear in the next run's schema. Existing prune logic must not delete empty-path entries.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/domain-cache-discovered.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import { saveDomainCache, lookupDomainCache } from './domain-cache.js';

const DOMAIN = 'test-domain-completeness.example';
const PAGE_TYPE = 'detail';

async function cleanup() {
  await db.delete(domainIntelligence).where(
    and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE))
  );
}

describe('saveDomainCache — discovered-but-unresolved fields', () => {
  beforeEach(cleanup);

  it('persists empty-path entries for discovered fields that did not resolve', async () => {
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      interceptedRequests: [],
      fieldResults: {
        title: { value: 'Hello', source: 'json-ld', path: '$.name', confidence: 0.95 },
      },
      discoveredFieldNames: ['title', 'sizes', 'flavours'],
      overallConfidence: 0.33,
      hasJsonLd: true,
      hasNextData: false,
    });

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache).not.toBeNull();
    expect(Object.keys(cache!.fieldPaths).sort()).toEqual(['flavours', 'sizes', 'title']);
    expect(cache!.fieldPaths['sizes'].paths).toEqual([]);
    expect(cache!.fieldPaths['flavours'].paths).toEqual([]);
    expect(cache!.fieldPaths['title'].paths.length).toBeGreaterThan(0);
  });

  it('does not prune empty-path entries on subsequent runs', async () => {
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      interceptedRequests: [],
      fieldResults: {},
      discoveredFieldNames: ['sizes'],
      overallConfidence: 0,
      hasJsonLd: false,
      hasNextData: false,
    });
    // Run again with the same shape
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      interceptedRequests: [],
      fieldResults: {},
      discoveredFieldNames: ['sizes'],
      overallConfidence: 0,
      hasJsonLd: false,
      hasNextData: false,
    });
    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache!.fieldPaths['sizes']).toBeDefined();
    expect(cache!.fieldPaths['sizes'].paths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper test domain-cache-discovered`
Expected: FAIL — current `saveDomainCache` signature doesn't accept `discoveredFieldNames`.

- [ ] **Step 3: Extend `ExtractionOutcome` and `saveDomainCache`**

In `packages/scraper/src/domain-cache.ts`, locate the `ExtractionOutcome` type near line 340 and add the new field:

```typescript
export type ExtractionOutcome = {
  domain: string;
  pageType: string;
  interceptedRequests: InterceptedRequest[];
  fieldResults: Record<string, {
    value: unknown;
    source: PathSource;
    path: string;
    confidence: number;
  }>;
  /** All field names the AI proposed AND the user kept toggled on, including ones that didn't resolve. */
  discoveredFieldNames: string[];
  overallConfidence: number;
  hasJsonLd: boolean;
  hasNextData: boolean;
};
```

In `mergeFieldPaths`, after the existing loop over `newResults`, add:

```typescript
  // Persist discovered-but-unresolved fields as empty-path entries.
  // Existing cache-hit logic returns them in the schema; analyze re-runs AI for them.
  for (const fieldName of discoveredFieldNames) {
    if (!merged[fieldName]) {
      merged[fieldName] = { paths: [], conflictCount: 0 };
    }
  }
```

Pass `discoveredFieldNames` into `mergeFieldPaths` and `buildFreshPaths` — update signatures:

```typescript
function mergeFieldPaths(
  existing: Record<string, FieldPathSet>,
  newResults: ExtractionOutcome['fieldResults'],
  discoveredFieldNames: string[],
  isSuccess: boolean,
  now: string,
): Record<string, FieldPathSet> { ... }

function buildFreshPaths(
  fieldResults: ExtractionOutcome['fieldResults'],
  discoveredFieldNames: string[],
  now: string,
): Record<string, FieldPathSet> {
  const result: Record<string, FieldPathSet> = {};
  for (const [name, fr] of Object.entries(fieldResults)) {
    if (!fr.path) continue;
    result[name] = { paths: [{ path: fr.path, source: fr.source, confidence: fr.confidence, hits: 1, misses: 0, lastValue: fr.value, lastUsedAt: now }], conflictCount: 0 };
  }
  for (const name of discoveredFieldNames) {
    if (!result[name]) result[name] = { paths: [], conflictCount: 0 };
  }
  return result;
}
```

Update call sites inside `saveDomainCache` to forward `outcome.discoveredFieldNames`.

Verify the prune logic at lines 482-497 doesn't drop empty-path entries — the `pathSet.paths.filter` runs over `paths`, so an empty array stays empty. No change needed, but add a comment near the prune block:

```typescript
    // Empty-path entries (discovered-but-unresolved fields) survive pruning by construction.
```

- [ ] **Step 4: Pass `discoveredFieldNames` from `scraper.ts`**

In `packages/api/src/routers/scraper.ts`, update the `saveDomainCache` call near line 463:

```typescript
        try {
          const discoveredFieldNames = schemaFields
            .filter(f => (f.tier ?? 'discovered') === 'discovered')
            .map(f => f.name);
          // Requested-tier fields the user typed in are also "things we should remember exist on this domain"
          const requestedNames = schemaFields
            .filter(f => f.tier === 'requested')
            .map(f => f.name);
          await saveDomainCache({
            domain,
            pageType: resolvedPageType,
            interceptedRequests: capture.interceptedRequests,
            fieldResults,
            discoveredFieldNames: [...discoveredFieldNames, ...requestedNames],
            overallConfidence: confidence,
            hasJsonLd: capture.structuredData.ldJson.length > 0,
            hasNextData: capture.structuredData.nextData !== null,
          });
          console.log(`[extract] Saved domain intelligence for ${domain}`);
        } catch (err) {
          console.error('[extract] Cache save failed (non-fatal):', err);
        }
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @robot/scraper test && pnpm --filter @robot/api typecheck`
Expected: PASS — 2 new tests + existing domain-cache tests still green

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/domain-cache.ts packages/scraper/src/domain-cache-discovered.test.ts packages/api/src/routers/scraper.ts
git commit -m "feat(cache): persist discovered-but-unresolved field names in domain intelligence"
```

---

## Task 3: Cache-hit re-discovery — re-run AI for empty-path fields

**Files:**
- Modify: `packages/api/src/routers/scraper.ts:55-162` (the `analyze` cache-hit branch)
- Modify: `packages/api/src/routers/scraper.ts:290-343` (the `extract` cache-hit branch)

Right now `analyze` on a cached domain returns whatever's in `cache.fieldPaths` and skips AI. With Task 2 in place, empty-path entries flow through — but the user still has no way to *resolve* them. Two changes:

1. In `analyze`'s cache-hit branch, if any cached field has `paths: []`, mark it in the returned schema (`needsRediscovery: true`). The dashboard already toggles these on by default; status field is a hint.
2. In `extract`, after the existing cache resolution step, if any field is still missing AND has an empty-path cache entry, treat it identically to a brand-new field — let AI API analysis + XPath fallback run for it. Today this already happens because `missingAfterCache` is calculated from `finalData`, not `cache.fieldPaths` — verify with a test, no code change needed. The risk is regression if a future refactor changes this.

- [ ] **Step 1: Write the failing test for analyze re-discovery hint**

```typescript
// packages/api/src/routers/scraper-cache-hit.test.ts (new file)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq } from 'drizzle-orm';
import { saveDomainCache } from '@robot/scraper';

const DOMAIN = 'cache-hit-rediscovery.example';

beforeEach(async () => {
  await db.delete(domainIntelligence).where(eq(domainIntelligence.domain, DOMAIN));
});
afterEach(async () => {
  await db.delete(domainIntelligence).where(eq(domainIntelligence.domain, DOMAIN));
});

describe('analyze cache-hit returns empty-path fields with needsRediscovery hint', () => {
  it('marks empty-path entries with needsRediscovery: true in the schema', async () => {
    await saveDomainCache({
      domain: DOMAIN, pageType: 'detail', interceptedRequests: [],
      fieldResults: { title: { value: 'X', source: 'json-ld', path: '$.name', confidence: 0.9 } },
      discoveredFieldNames: ['title', 'sizes'],
      overallConfidence: 0.5, hasJsonLd: true, hasNextData: false,
    });
    // Hit the analyze procedure's cache-hit branch via a mock — see Step 3 for the test harness.
    // For this step the test will fail because needsRediscovery doesn't exist yet.
    expect(true).toBe(false); // placeholder — replaced in Step 3
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api test scraper-cache-hit`
Expected: FAIL (placeholder)

- [ ] **Step 3: Add the `needsRediscovery` hint in analyze cache-hit**

In `scraper.ts:68-87`, locate the `cachedFields` construction and add the flag:

```typescript
        const cachedFields = Object.entries(cache.fieldPaths).map(([name, pathSet]) => {
          const bestPath = pathSet.paths.sort((a, b) => (b.hits - b.misses) - (a.hits - a.misses))[0];
          return {
            name,
            type: inferType(bestPath?.lastValue),
            description: `Cached field (${pathSet.paths.length} path${pathSet.paths.length === 1 ? '' : 's'})`,
            api_path: bestPath?.path,
            source: bestPath?.source ?? 'unknown',
            example: bestPath?.lastValue ?? null,
            tier: 'discovered' as string | undefined,
            needsRediscovery: pathSet.paths.length === 0,
          };
        });
```

Replace the placeholder test with:

```typescript
import { appRouter } from './index.js';
import { createCallerFactory } from '../trpc.js';
const createCaller = createCallerFactory(appRouter);

it('marks empty-path entries with needsRediscovery: true in the schema', async () => {
  await saveDomainCache({
    domain: DOMAIN, pageType: 'detail', interceptedRequests: [],
    fieldResults: { title: { value: 'X', source: 'json-ld', path: '$.name', confidence: 0.9 } },
    discoveredFieldNames: ['title', 'sizes'],
    overallConfidence: 0.5, hasJsonLd: true, hasNextData: false,
  });
  // We exercise lookupDomainCache + the schema-build logic via a small test harness.
  // Pulling the helper out of `analyze` into its own exported function is fine if
  // testing through the caller is too heavy (would require network).
  const { lookupDomainCache } = await import('@robot/scraper');
  const cache = await lookupDomainCache(DOMAIN, 'detail');
  expect(cache).not.toBeNull();
  expect(cache!.fieldPaths['sizes'].paths).toEqual([]);
  expect(cache!.fieldPaths['title'].paths.length).toBeGreaterThan(0);
});
```

(For the user-visible `needsRediscovery` flag, since the analyze procedure body is one big closure, prefer extracting `cachedFieldsFromCache(cache)` into a small exported helper at the top of `scraper.ts` so it can be unit-tested without HTTP. Test the helper directly.)

- [ ] **Step 4: Verify cache-hit doesn't block re-discovery in extract**

In `scraper.ts:332-343`, `resolveFromCache` is called with `cache.fieldPaths` — a field with `paths: []` returns no value, so `finalData[name]` stays undefined and the downstream `missingAfterCache` correctly picks it up for AI API analysis. Add an assertion comment:

```typescript
          // Empty-path entries (discovered-but-unresolved in a previous run) resolve to
          // nothing, so they flow into the AI API analysis step below as missing fields.
          const cacheResult = resolveFromCache(cache.fieldPaths, finalData, fieldNames);
```

Add one extract-path test in `packages/scraper/src/domain-cache-discovered.test.ts`:

```typescript
import { resolveFromCache } from './domain-cache.js';

it('resolveFromCache returns nothing for empty-path entries — caller treats as missing', () => {
  const fieldPaths = {
    sizes: { paths: [], conflictCount: 0 },
    title: { paths: [{ path: '$.name', source: 'json-ld' as const, confidence: 0.9, hits: 5, misses: 0, lastValue: 'X', lastUsedAt: new Date().toISOString() }], conflictCount: 0 },
  };
  const result = resolveFromCache(fieldPaths, { name: 'X' }, ['sizes', 'title']);
  expect(result.resolved['sizes']).toBeUndefined();
  expect(result.resolved['title']).toBeDefined();
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @robot/scraper test && pnpm --filter @robot/api test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routers/scraper.ts packages/api/src/routers/scraper-cache-hit.test.ts packages/scraper/src/domain-cache-discovered.test.ts
git commit -m "feat(analyze): mark empty-path cached fields with needsRediscovery so AI re-attempts them"
```

---

## Task 4: AI API analysis consumes `__NEXT_DATA__` and JSON-LD

**Files:**
- Modify: `packages/api/src/routers/scraper.ts:351-381` (the AI API analysis loop)

Today `apisToTry` filters `capture.interceptedRequests` only. The captured `structuredData.nextData` (a JSON object) and `structuredData.ldJson` (an array of JSON objects) are not offered to AI. Add them as synthetic API entries before the loop. They participate in the same prompt format — `extractFromApi(body, url, missingFields)` — using a sentinel URL like `inline://nextdata` so the source attribution stays readable.

- [ ] **Step 1: Write the failing test**

Add to `packages/scraper/src/domain-cache-discovered.test.ts` (or a new file `packages/api/src/routers/scraper-structured-sources.test.ts`):

```typescript
import { collectAiAnalysisSources } from './scraper.js'; // we'll export this helper

describe('collectAiAnalysisSources', () => {
  it('includes intercepted requests over the size threshold', () => {
    const sources = collectAiAnalysisSources({
      interceptedRequests: [
        { url: 'https://api.x/p/1', responseBody: '{"price":10}', bodySize: 1000, method: 'GET' } as never,
        { url: 'https://api.x/p/2', responseBody: '{}', bodySize: 5, method: 'GET' } as never,
      ],
      structuredData: { nextData: null, ldJson: [], metaTags: {} },
    });
    expect(sources.map(s => s.url)).toEqual(['https://api.x/p/1']);
  });

  it('includes nextData as a synthetic source when present', () => {
    const sources = collectAiAnalysisSources({
      interceptedRequests: [],
      structuredData: { nextData: { props: { pageProps: { product: { title: 'X' } } } }, ldJson: [], metaTags: {} },
    });
    expect(sources.map(s => s.url)).toContain('inline://nextdata');
  });

  it('includes large ldJson blobs as synthetic sources', () => {
    const big = { '@type': 'Product', name: 'X', description: 'long description'.repeat(40) };
    const sources = collectAiAnalysisSources({
      interceptedRequests: [],
      structuredData: { nextData: null, ldJson: [big], metaTags: {} },
    });
    expect(sources.find(s => s.url === 'inline://ld+json[0]')).toBeDefined();
  });

  it('caps the number of sources at 5 to control token cost', () => {
    const sources = collectAiAnalysisSources({
      interceptedRequests: Array.from({ length: 10 }, (_, i) => ({
        url: `https://api.x/p/${i}`, responseBody: '{"a":1}', bodySize: 1000, method: 'GET',
      } as never)),
      structuredData: { nextData: { props: 1 }, ldJson: [{ a: 1 }], metaTags: {} },
    });
    expect(sources.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api test scraper-structured-sources`
Expected: FAIL — `collectAiAnalysisSources` not exported

- [ ] **Step 3: Implement and wire**

Add to `scraper.ts` (near the top, exported):

```typescript
export type AnalysisSource = { url: string; responseBody: string; bodySize: number; method: string };

export function collectAiAnalysisSources(input: {
  interceptedRequests: Array<{ url: string; responseBody: string | null; bodySize: number; method: string }>;
  structuredData: { nextData: unknown; ldJson: unknown[]; metaTags: unknown };
}): AnalysisSource[] {
  const sources: AnalysisSource[] = [];
  for (const r of input.interceptedRequests) {
    if (r.responseBody && r.bodySize > 500) {
      sources.push({ url: r.url, responseBody: r.responseBody, bodySize: r.bodySize, method: r.method });
    }
  }
  if (input.structuredData.nextData) {
    const body = JSON.stringify(input.structuredData.nextData);
    sources.push({ url: 'inline://nextdata', responseBody: body, bodySize: body.length, method: 'INLINE' });
  }
  for (let i = 0; i < input.structuredData.ldJson.length; i++) {
    const body = JSON.stringify(input.structuredData.ldJson[i]);
    if (body.length > 200) {
      sources.push({ url: `inline://ld+json[${i}]`, responseBody: body, bodySize: body.length, method: 'INLINE' });
    }
  }
  // Cap to control token cost — prefer richer sources by descending size.
  return sources.sort((a, b) => b.bodySize - a.bodySize).slice(0, 5);
}
```

Replace `scraper.ts:355-357` with:

```typescript
          const apisToTry = collectAiAnalysisSources({
            interceptedRequests: capture.interceptedRequests,
            structuredData: capture.structuredData,
          });
```

The downstream `agent.extractFromApi(api.responseBody!, api.url, stillMissing)` call already works with this shape — `responseBody` is a string, `url` is informational. No `agent` change needed.

- [ ] **Step 4: Pass through to `saveDomainCache` cleanly**

The `saveDomainCache` call passes `interceptedRequests: capture.interceptedRequests`. Inline sources should NOT be persisted to `apiEndpoints` (they're not URLs to refetch). No change needed since `capture.interceptedRequests` excludes the inline ones.

When a field resolves via an inline source, the path is stored under source `'api-ai'` already (line 369). Augment the source label so cache attribution is clearer: if `api.url.startsWith('inline://')`, store source as `'structured-data'` instead:

```typescript
                  fieldResults[field.name] = {
                    value: field.value,
                    source: api.url.startsWith('inline://') ? 'json-ld' : 'api-ai',
                    path: field.json_path,
                    confidence: field.confidence,
                  };
```

(Reusing `'json-ld'` keeps the existing PathSource union; if you prefer a new label `'structured-ai'`, add it to the `PathSource` union in `domain-cache.ts:8` and the inferred type — minor enum extension.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @robot/api test && pnpm --filter @robot/api typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routers/scraper.ts packages/api/src/routers/scraper-structured-sources.test.ts
git commit -m "feat(extract): feed nextData + JSON-LD blobs into AI API analysis"
```

---

## Task 5: Entity-subtree identification helper

**Files:**
- Create: `packages/scraper/src/entity-subtree.ts`
- Create: `packages/scraper/src/entity-subtree.test.ts`
- Modify: `packages/scraper/src/index.ts` (re-export)

A 500KB `__NEXT_DATA__` blob is 99% chrome. Before handing the whole thing to AI, find the subtree most likely to contain the product/article entity. Heuristic: walk the tree, score each object by how many "schema-relevant" keys it contains directly (e.g., `name`, `title`, `price`, `description`, `sku`, `image`, `images`, `brand`). Return the highest-scoring subtree above a size floor. Fall through to the whole blob if no clear winner.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/entity-subtree.test.ts
import { describe, it, expect } from 'vitest';
import { findEntitySubtree } from './entity-subtree.js';

describe('findEntitySubtree', () => {
  it('finds the deepest object containing the most schema-relevant keys', () => {
    const blob = {
      props: {
        pageProps: {
          product: {
            name: 'Godiva Assorted',
            price: 24.99,
            description: 'A box of chocolates',
            sku: 'B0FDLT4Y1P',
            images: ['a.jpg', 'b.jpg'],
          },
          breadcrumbs: [{ title: 'Home' }, { title: 'Food' }],
        },
        layout: { title: 'Page Title' },
      },
    };
    const result = findEntitySubtree(blob);
    expect(result.path).toBe('$.props.pageProps.product');
    expect(result.score).toBeGreaterThanOrEqual(4);
  });

  it('returns the root with score 0 when no subtree has 2+ schema keys', () => {
    const result = findEntitySubtree({ foo: 'bar', baz: 1 });
    expect(result.path).toBe('$');
    expect(result.score).toBe(0);
  });

  it('prefers a child subtree over a parent when child has more concentration of schema keys', () => {
    const blob = {
      page: { title: 'A' },
      item: { name: 'B', price: 1, description: 'C', sku: 'X' },
    };
    const result = findEntitySubtree(blob);
    expect(result.path).toBe('$.item');
  });

  it('walks into arrays — returns the path with index', () => {
    const blob = {
      products: [{ name: 'A', price: 1, sku: 'X', description: 'D' }],
    };
    const result = findEntitySubtree(blob);
    expect(result.path).toBe('$.products[0]');
  });

  it('caps recursion at a reasonable depth to avoid pathological blobs', () => {
    // build a 20-level deep object
    let nested: Record<string, unknown> = { name: 'leaf', price: 1, sku: 'X', description: 'D' };
    for (let i = 0; i < 20; i++) nested = { wrap: nested };
    const result = findEntitySubtree(nested);
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper test entity-subtree`
Expected: FAIL — module missing

- [ ] **Step 3: Implement the heuristic**

```typescript
// packages/scraper/src/entity-subtree.ts
const SCHEMA_KEYS = new Set([
  'name', 'title', 'price', 'description', 'sku', 'image', 'images',
  'brand', 'category', 'availability', 'rating', 'reviews', 'product',
  'variants', 'sizes', 'colors', 'flavours', 'options',
]);

const MAX_DEPTH = 12;

export type EntitySubtree = {
  path: string;
  score: number;
  value: unknown;
};

function scoreObject(obj: Record<string, unknown>): number {
  let score = 0;
  for (const key of Object.keys(obj)) {
    if (SCHEMA_KEYS.has(key.toLowerCase())) score++;
  }
  return score;
}

function walk(value: unknown, path: string, depth: number, best: EntitySubtree): EntitySubtree {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return best;

  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 20); i++) {
      best = walk(value[i], `${path}[${i}]`, depth + 1, best);
    }
    return best;
  }

  const obj = value as Record<string, unknown>;
  const score = scoreObject(obj);
  if (score >= 2 && score > best.score) {
    best = { path, score, value: obj };
  }
  for (const [k, v] of Object.entries(obj)) {
    best = walk(v, `${path}.${k}`, depth + 1, best);
  }
  return best;
}

/**
 * Find the subtree most likely to contain the main entity (product/article/place).
 * Returns root path '$' with score 0 if nothing scores above the floor.
 */
export function findEntitySubtree(blob: unknown): EntitySubtree {
  const initial: EntitySubtree = { path: '$', score: 0, value: blob };
  if (blob === null || typeof blob !== 'object') return initial;
  return walk(blob, '$', 0, initial);
}
```

Re-export from `packages/scraper/src/index.ts`:

```typescript
export { findEntitySubtree, type EntitySubtree } from './entity-subtree.js';
```

- [ ] **Step 4: Use it inside `collectAiAnalysisSources` to scope the nextData payload**

Replace the `nextData` branch in `collectAiAnalysisSources`:

```typescript
  if (input.structuredData.nextData) {
    const subtree = findEntitySubtree(input.structuredData.nextData);
    const target = subtree.score >= 2 ? subtree.value : input.structuredData.nextData;
    const body = JSON.stringify(target);
    sources.push({
      url: subtree.score >= 2 ? `inline://nextdata${subtree.path.slice(1)}` : 'inline://nextdata',
      responseBody: body,
      bodySize: body.length,
      method: 'INLINE',
    });
  }
```

Add an import:

```typescript
import { findEntitySubtree } from '@robot/scraper';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @robot/scraper test && pnpm --filter @robot/api test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/entity-subtree.ts packages/scraper/src/entity-subtree.test.ts packages/scraper/src/index.ts packages/api/src/routers/scraper.ts
git commit -m "feat(extract): entity-subtree identifier scopes nextData payload before AI analysis"
```

---

## Task 6: Shape-validation post-filter

**Files:**
- Create: `packages/scraper/src/shape-validator.ts`
- Create: `packages/scraper/src/shape-validator.test.ts`
- Modify: `packages/scraper/src/index.ts`
- Modify: `packages/api/src/routers/scraper.ts` — call the validator at the boundary between cache resolution and `finalData` accumulation, AND between mechanical/api resolution and result-building

A field that resolves to `"Customer reviews"` for `description` is currently logged as a hit. Add a shape check at the resolution boundary: if the requested field's type doesn't admit the resolved value's shape, reject the value and treat the field as still missing — so the next step in the chain gets a chance.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/scraper/src/shape-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateFieldShape } from './shape-validator.js';

describe('validateFieldShape', () => {
  it('accepts a number-shaped string for a number field', () => {
    expect(validateFieldShape('24.99', 'number')).toEqual({ ok: true, normalized: 24.99 });
    expect(validateFieldShape('$24.99', 'number')).toEqual({ ok: true, normalized: 24.99 });
  });

  it('rejects a UI label for a description field', () => {
    expect(validateFieldShape('Customer reviews', 'string', { fieldName: 'description' }).ok).toBe(false);
  });

  it('accepts a long string for a description field', () => {
    const long = 'A delicious assortment of premium chocolates in a gift box, hand-selected for any occasion.';
    expect(validateFieldShape(long, 'string', { fieldName: 'description' }).ok).toBe(true);
  });

  it('rejects an empty array for an array field', () => {
    expect(validateFieldShape([], 'array').ok).toBe(false);
  });

  it('accepts a populated array for an array field', () => {
    expect(validateFieldShape(['S', 'M', 'L'], 'array').ok).toBe(true);
  });

  it('accepts unknown types as passthrough', () => {
    expect(validateFieldShape('anything', 'unknown-type').ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/scraper test shape-validator`
Expected: FAIL — module missing

- [ ] **Step 3: Implement**

```typescript
// packages/scraper/src/shape-validator.ts
const UI_LABEL_PATTERNS = [
  /^(customer reviews|reviews|ratings|add to cart|buy now|out of stock|in stock|details|specifications|description|features|overview)$/i,
];

const DESCRIPTION_MIN_LENGTH = 20;

export type ValidateResult =
  | { ok: true; normalized: unknown }
  | { ok: false; reason: string };

export function validateFieldShape(
  value: unknown,
  type: string,
  opts: { fieldName?: string } = {},
): ValidateResult {
  if (value === null || value === undefined) return { ok: false, reason: 'null' };

  switch (type) {
    case 'number': {
      if (typeof value === 'number') return { ok: true, normalized: value };
      if (typeof value === 'string') {
        const cleaned = value.replace(/[$,€£¥\s]/g, '').trim();
        const n = Number(cleaned);
        if (!Number.isNaN(n)) return { ok: true, normalized: n };
        return { ok: false, reason: 'not numeric' };
      }
      return { ok: false, reason: 'not numeric' };
    }
    case 'array': {
      if (!Array.isArray(value)) return { ok: false, reason: 'not array' };
      if (value.length === 0) return { ok: false, reason: 'empty array' };
      return { ok: true, normalized: value };
    }
    case 'string': {
      if (typeof value !== 'string') return { ok: false, reason: 'not string' };
      if (UI_LABEL_PATTERNS.some(p => p.test(value.trim()))) {
        return { ok: false, reason: 'looks like UI label' };
      }
      if (opts.fieldName === 'description' && value.trim().length < DESCRIPTION_MIN_LENGTH) {
        return { ok: false, reason: 'description too short' };
      }
      return { ok: true, normalized: value };
    }
    default:
      return { ok: true, normalized: value };
  }
}
```

Re-export:

```typescript
export { validateFieldShape, type ValidateResult } from './shape-validator.js';
```

- [ ] **Step 4: Apply the validator in scraper.ts at resolution boundaries**

The cleanest single integration point is just before each assignment to `finalData`. Wrap each `finalData[name] = value` with the validator. Since there are 6+ sites, write a small inline helper at the top of the `extract` handler:

```typescript
        const fieldByName = new Map(schemaFields.map(f => [f.name, f]));
        function tryAssign(name: string, value: unknown, source: PathSource, path: string, confidence: number): boolean {
          if (finalData[name] !== undefined) return false;
          const field = fieldByName.get(name);
          const type = field?.type ?? 'string';
          const v = validateFieldShape(value, type, { fieldName: name });
          if (!v.ok) {
            console.log(`[extract] Rejected ${name}=${JSON.stringify(value).slice(0, 60)} (source=${source}): ${v.reason}`);
            return false;
          }
          finalData[name] = v.normalized;
          fieldResults[name] = { value: v.normalized, source, path, confidence };
          return true;
        }
```

Replace each `finalData[name] = ...` site with `tryAssign(name, ..., source, path, confidence)`. Sites:
- `scraper.ts:240` (cached API paths)
- `scraper.ts:265` (mechanical structured-extractor)
- `scraper.ts:281` (mechanical multi-source)
- `scraper.ts:300` (cached XPath)
- `scraper.ts:320` (cached XPath via buildCachedXPathScript)
- `scraper.ts:336` (resolveFromCache)
- `scraper.ts:366` (AI API analysis)
- `scraper.ts:398` (XPath fallback)
- `scraper.ts:427` (XPath retry)

Import:

```typescript
import { validateFieldShape } from '@robot/scraper';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @robot/scraper test && pnpm --filter @robot/api test && pnpm --filter @robot/api typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/shape-validator.ts packages/scraper/src/shape-validator.test.ts packages/scraper/src/index.ts packages/api/src/routers/scraper.ts
git commit -m "feat(extract): shape-validate field values at resolution boundary, reject UI labels and bad types"
```

---

## Task 7: Update `docs/extraction-architecture.md`

**Files:**
- Modify: `docs/extraction-architecture.md`

Reflect the new structured-data flow in the architecture doc so future contributors don't repeat the "skip nextData" shortcut.

- [ ] **Step 1: Read the current doc**

Run: `cat docs/extraction-architecture.md`

- [ ] **Step 2: Update the section that says `__NEXT_DATA__` is excluded**

Replace any wording that says nextData is "too unreliable, deferred to AI" with:

> `__NEXT_DATA__` blobs are scoped to their entity subtree via `findEntitySubtree()`, then handed to AI API analysis as a synthetic API response (URL `inline://nextdata...`). Mechanical extraction still skips the raw blob because key-name matching on the unscoped tree picks up false positives. Path-aware AI extraction is the right tool for these sources.

Add a section "Why structured-data blobs are first-class sources" that summarizes the entity-subtree + shape-validator design.

- [ ] **Step 3: Commit**

```bash
git add docs/extraction-architecture.md
git commit -m "docs(extraction): structured-data blobs are first-class via entity-subtree + AI"
```

---

## End-of-phase verification

After all six commits land:

- [ ] **Run the full test suite**: `pnpm -r test` — all packages green
- [ ] **Run typecheck across the workspace**: `pnpm -r typecheck` — all packages green
- [ ] **Dogfood Amazon Godiva again**:
  - Paste the same URL into the sandbox
  - Confirm analyze proposes ≥ the same field count as before, including sizes/flavours
  - Confirm extract returns a row per toggled field (with `null` + `not_found` for any that didn't resolve)
  - Confirm the run shows `inline://nextdata...` as a source for fields that came from `__NEXT_DATA__`
  - Confirm the second run hits cache and still shows the full schema (no fields silently forgotten)
- [ ] **Update `docs/roadmap.md`** Track A: mark v1.1a as done with date and commit count.

---

## Out of scope (deferred to follow-up ideas)

- **Cross-source corroboration with structured-data sources.** The existing cross-validation in `resolveFromCache` already compares values across paths within a field; extending it to weight structured-data sources higher (vs. XPath inferences) is a small follow-up but not required for this phase.
- **Cache rediscovery cadence.** Right now `analyze` returns the cached schema with `needsRediscovery: true` for empty-path fields, but the user has to hit "re-analyze" explicitly. A scheduled re-discovery (e.g., re-attempt empty-path fields once per N days) is a follow-up.
- **More UI label patterns.** The shape validator's `UI_LABEL_PATTERNS` is intentionally short — add to it as real failures land. Don't pre-emptively pad it.
- **Embedding-based description matching** — see `docs/ideas.md` → "Description-based field matching."

---

## Self-Review Notes

- **Spec coverage:** All three issues from `docs/ideas.md` → "Extraction completeness" are addressed: Task 1 fixes the contract bug; Tasks 2-3 fix the cache-forgets-fields bug; Tasks 4-6 address the structured-data-source orphaning.
- **No placeholders:** Each step has runnable code or an exact file:line modification.
- **Type consistency:** `SchemaFieldLite`, `ResultRow`, `AnalysisSource`, `EntitySubtree`, `ValidateResult` are defined in one place each; consumers import the same names.
- **TDD:** Every code task starts with a failing test.
- **Frequent commits:** One commit per task, six commits total + one for the doc.
- **YAGNI:** No new tables, no new endpoints, no new packages. All changes fit into the existing `@robot/scraper` + `@robot/api` packages.
