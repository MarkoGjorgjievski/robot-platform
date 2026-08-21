# Pagination Live Proof + Config Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a verified pagination config per domain, consult it on later plans, self-heal it when it goes stale — and prove multi-page walking both live and in an offline gate.

**Architecture:** `planRun` gains two injectable cache collaborators. It passes any stored config into `detectPagination` (whose `cached` branch already exists and is currently dead), walks the pages, and writes the config back only when that walk verifiably produced new detail URLs. A cached config that produces nothing triggers exactly one re-detect-and-retry. Separately, a tiny static HTTP server lets Tier 1 walk multi-page fixtures in real Chromium, which `setContentEvaluate` cannot do because it never navigates.

**Tech Stack:** TypeScript (ESM), Drizzle ORM + PostgreSQL, Playwright, Vitest, pnpm workspaces + Turborepo.

**Spec:** [`docs/superpowers/specs/2026-08-21-pagination-proof-and-caching-design.md`](../specs/2026-08-21-pagination-proof-and-caching-design.md)

## Global Constraints

- All packages are ESM. Every relative import MUST carry a `.js` extension.
- TDD: write the failing test first, run it, watch it fail for the right reason, then implement.
- A pagination config is written **only when the walk it drove verifiably produced new items**. A config that yields nothing is a false positive.
- **Never write `null`** to `pagination_config`. A failed detection leaves whatever was there.
- Cache key is `(domain, 'listing')` — one config per domain. Not per URL shape, not per Source.
- The stale path is bounded at **one** re-detect and **one** retry per input. No loop, no recursion.
- Out of scope: `api-param` detection and replay, infinite scroll, load-more, URL-shape keying, multiple ranked configs per domain.
- `pnpm -r test` needs Postgres: `docker start robot-platform-db` first.
- Verify types with `pnpm typecheck --force` — a plain run is FULL TURBO cached and proves nothing. `api-server` and `dashboard` are not in that graph; check the dashboard separately with `pnpm --filter @robot/dashboard exec tsc --noEmit`.
- Leave no `test-%` rows behind. `select count(*) from orgs where slug like 'test-%'` must be 0, and DB-backed tests clean up their own `domain_intelligence` rows.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/scraper/src/domain-cache.ts` | **Modify.** Add `savePaginationConfig` beside `pinFieldPath`, the existing precedent for a targeted single-column cache write. |
| `packages/scraper/src/pagination-cache.test.ts` | **Create.** DB-backed tests for the writer. |
| `packages/scraper/src/crawl/plan-run.ts` | **Modify.** Two new deps; read the cached config; extract the page walk into one local helper; write on verified success; the stale path. |
| `packages/scraper/src/crawl/plan-run-pagination.test.ts` | **Create.** Fake-collaborator tests for read, write, and stale behaviour. |
| `packages/scraper/src/__fixtures__/serve.ts` | **Create.** Minimal static HTTP server for multi-page fixtures. |
| `packages/scraper/src/crawl/multi-page-walk-fixture.test.ts` | **Create.** Tier 1 gate: real Chromium walks pages 2..N, dedupes, stops on budget. |
| `docs/handoff.md`, `docs/roadmap.md` | **Modify.** Record what the live run demonstrated; correct the "pay nothing for detection" claim. |

---

### Task 1: The pagination config writer

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts` (add after `pinFieldPath`, which ends around line 247)
- Test: `packages/scraper/src/pagination-cache.test.ts`

**Interfaces:**
- Consumes: `db`, `domainIntelligence` from `@robot/db`; `PaginationConfig` from `@robot/browser` (already imported at the top of `domain-cache.ts`).
- Produces: `savePaginationConfig(domain: string, config: PaginationConfig): Promise<void>` — used by Tasks 3 and 4.

Context the implementer needs: `domain_intelligence` has a unique index on `(domain, page_type)` (`domain_intelligence_domain_page_type_idx`), so an upsert via `onConflictDoUpdate` is safe and atomic. `lookupDomainCache(domain, pageType)` already returns `paginationConfig` on the `DomainCache` object.

The spec lists "`null` is never written" as a required property. It has no test here **by design**: the parameter is typed `PaginationConfig`, not `PaginationConfig | null`, so a null write is a compile error rather than a runtime behaviour a test could observe. Do not widen that type to add a test for it — the type IS the guarantee. If a caller ever needs to clear a config, that is a new function with its own reasoning.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/pagination-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import type { PaginationConfig } from '@robot/browser';
import { savePaginationConfig, lookupDomainCache, saveDomainCache } from './domain-cache.js';

const DOMAIN = 'test-pagination-cache.example';
const PAGE_TYPE = 'listing';

const URL_PATTERN: PaginationConfig = {
  strategy: 'url-pattern',
  urlTemplate: 'https://test-pagination-cache.example/search?page={N}',
};
const NEXT_BUTTON: PaginationConfig = { strategy: 'next-button', nextSelector: 'a.next' };

async function cleanup() {
  await db.delete(domainIntelligence).where(
    and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE)),
  );
}

beforeEach(cleanup);
afterAll(cleanup);

describe('savePaginationConfig', () => {
  it('creates the listing row when the domain has no intelligence yet', async () => {
    // A domain can be walked before anything has ever cached a listing extraction
    // for it, so the writer cannot assume a row exists.
    await savePaginationConfig(DOMAIN, URL_PATTERN);

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache?.paginationConfig).toEqual(URL_PATTERN);
  });

  it('replaces a stored config without disturbing the rest of the row', async () => {
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      interceptedRequests: [],
      fieldResults: {
        detail_url: { value: 'https://x.example/p/1', source: 'xpath', path: './/a/@href', confidence: 0.9 },
      },
      discoveredFieldNames: ['detail_url'],
      overallConfidence: 0.9,
      hasJsonLd: false,
      hasNextData: false,
    });
    await savePaginationConfig(DOMAIN, URL_PATTERN);

    await savePaginationConfig(DOMAIN, NEXT_BUTTON);

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache?.paginationConfig).toEqual(NEXT_BUTTON);
    // The field paths this domain learned are not collateral damage of a
    // pagination write — the cache is an accumulator, not a snapshot.
    expect(Object.keys(cache?.fieldPaths ?? {})).toContain('detail_url');
  });

  it('writes to the listing partition, never the detail one', async () => {
    await savePaginationConfig(DOMAIN, URL_PATTERN);

    const detail = await lookupDomainCache(DOMAIN, 'detail');
    expect(detail?.paginationConfig ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/pagination-cache.test.ts`

Expected: FAIL — `savePaginationConfig is not a function` (it does not exist yet).

- [ ] **Step 3: Implement the writer**

Add to `packages/scraper/src/domain-cache.ts`, directly after `pinFieldPath`:

```typescript
/**
 * The page-type partition a pagination config belongs to. Pagination is a
 * property of listing pages; a detail page has none.
 */
const PAGINATION_PAGE_TYPE = 'listing';

/**
 * Store the pagination config that WORKED for a domain.
 *
 * Only ever called with a config whose walk verifiably produced new detail
 * URLs — a config that yields nothing is a false positive (a carousel arrow, a
 * selector for an element that is not there), and caching one would make every
 * later run on this domain replay a known-bad answer for free.
 *
 * There is no `null` case on purpose. A failed detection leaves whatever is
 * stored alone: absence of evidence is not evidence of absence, and a domain
 * with no config already behaves correctly by detecting from scratch.
 *
 * One config per domain, deliberately. A site whose search results and category
 * pages paginate differently will see the two overwrite each other; that is
 * visible in planRun's warnings, and the verify-then-replace rule means a wrong
 * config never survives a run that disproves it.
 */
export async function savePaginationConfig(domain: string, config: PaginationConfig): Promise<void> {
  await db
    .insert(domainIntelligence)
    .values({ domain, pageType: PAGINATION_PAGE_TYPE, paginationConfig: config })
    .onConflictDoUpdate({
      target: [domainIntelligence.domain, domainIntelligence.pageType],
      set: { paginationConfig: config, updatedAt: new Date() },
    });
  console.log(`[cache] pagination for ${domain}: ${config.strategy}`);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/pagination-cache.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Teeth check**

Change `onConflictDoUpdate` to `onConflictDoNothing`. Re-run. Expected: the "replaces a stored config" test FAILS (`expected {strategy:'url-pattern'…} to equal {strategy:'next-button'…}`). Restore.

- [ ] **Step 6: Full gates and commit**

```bash
docker start robot-platform-db
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/domain-cache.ts packages/scraper/src/pagination-cache.test.ts
git commit -m "feat(cache): persist a verified pagination config per domain"
```

---

### Task 2: `planRun` consults the stored config

**Files:**
- Modify: `packages/scraper/src/crawl/plan-run.ts` (`PlanRunDeps` around lines 61-71; the pagination block around lines 288-340)
- Test: `packages/scraper/src/crawl/plan-run-pagination.test.ts`

**Interfaces:**
- Consumes: `savePaginationConfig` from Task 1; `lookupDomainCache(domain, pageType): Promise<DomainCache | null>` and `detectPagination(capture, agent, cached?)`, both already exported.
- Produces: `PlanRunDeps.lookupCache?: typeof lookupDomainCache` and `PlanRunDeps.savePagination?: typeof savePaginationConfig` — Tasks 3 and 4 use both.

Context: `detectPagination(capture, agent, cached?)` already returns `{ config, source: 'cache' | 'mechanical' | 'ai' | 'none' }` and short-circuits on a truthy `cached`. Nothing passes that third argument today, so the `'cache'` branch is unreachable. `planRun` currently has no cache access at all.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/plan-run-pagination.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { PaginationConfig } from '@robot/browser';
import { planRun } from './plan-run.js';
import { fakeDeps, fakeRequest, CACHED_CONFIG } from './plan-run-pagination.fixtures.js';

describe('planRun — pagination config cache', () => {
  it('uses the stored config instead of detecting again', async () => {
    const detect = vi.fn();
    const deps = fakeDeps({
      cachedConfig: CACHED_CONFIG,
      agent: { detectPagination: detect },
    });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    // The whole point: a warm domain does not re-roll detection.
    expect(detect).not.toHaveBeenCalled();
    expect(deps.crawlCalls[0]?.paginationConfig).toEqual(CACHED_CONFIG);
  });

  it('detects from the capture when the domain is cold', async () => {
    const deps = fakeDeps({ cachedConfig: null });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    // listingHtml carries a rel=next link, so mechanical detection answers.
    expect(deps.crawlCalls[0]?.paginationConfig).toBeTruthy();
  });

  it('looks the config up under the listing partition', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const deps = fakeDeps({ cachedConfig: null, lookupCache: lookup });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(lookup).toHaveBeenCalledWith('listing.example', 'listing');
  });
});
```

Create the shared fixture module `packages/scraper/src/crawl/plan-run-pagination.fixtures.ts`. It exists so Tasks 2, 3 and 4 share one fake instead of three near-copies:

```typescript
import { vi } from 'vitest';
import type { PaginationConfig, CrawlOptions, CrawlPage, PageCapture } from '@robot/browser';
import type { PlanRunDeps, PlanRunRequest } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

export const CACHED_CONFIG: PaginationConfig = {
  strategy: 'url-pattern',
  urlTemplate: 'https://listing.example/search?page={N}',
};

/** Page 1 markup: two products, and a rel=next mechanical detection can find. */
export const listingHtml = `<html><head><link rel="next" href="https://listing.example/search?page=2"></head>
<body><a class="p" href="/p/1">One</a><a class="p" href="/p/2">Two</a></body></html>`;

export type FakeDeps = PlanRunDeps & {
  /** Every options object browser.crawl() was called with, in order. */
  crawlCalls: CrawlOptions[];
  /** Every config handed to savePagination, in order. */
  saved: PaginationConfig[];
};

export function fakeDeps(over: {
  cachedConfig: PaginationConfig | null;
  /** Detail URLs each crawled page yields, in page order. Default: one new page. */
  pages?: string[][];
  agent?: { detectPagination: (html: string) => Promise<unknown> };
  lookupCache?: PlanRunDeps['lookupCache'];
}): FakeDeps {
  const crawlCalls: CrawlOptions[] = [];
  const saved: PaginationConfig[] = [];
  const pages = over.pages ?? [['https://listing.example/p/3']];

  const capture = {
    url: 'https://listing.example/search',
    html: listingHtml,
    screenshot: '',
    screenshotTiles: [],
    interceptedRequests: [],
  } as unknown as PageCapture;

  return {
    browser: {
      capture: async () => capture,
      async *crawl(_url: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
        crawlCalls.push(options);
        // Which batch of URLs to serve is keyed off how many times crawl has run,
        // so the stale path's SECOND walk can yield different results from the first.
        const batch = pages[crawlCalls.length - 1] ?? [];
        if (batch.length === 0) return;
        yield {
          url: 'https://listing.example/search?page=2',
          pageNumber: 2,
          data: batch.map((u) => ({ [DETAIL_URL_FIELD]: u })),
        } as CrawlPage;
      },
    } as unknown as PlanRunDeps['browser'],
    agent: (over.agent ?? null) as PlanRunDeps['agent'],
    extract: (async () => ({
      data: [{ [DETAIL_URL_FIELD]: 'https://listing.example/p/1' }],
      rows: [
        { [DETAIL_URL_FIELD]: 'https://listing.example/p/1' },
        { [DETAIL_URL_FIELD]: 'https://listing.example/p/2' },
      ],
      plan: { row_xpath: '//a', fields: [{ name: DETAIL_URL_FIELD, xpath: './@href' }] },
      confidence: 1,
      sources: {},
      fieldCount: { found: 1, total: 1 },
      fieldsByTier: { requested: [], discovered: [] },
      cacheHit: false,
    })) as unknown as PlanRunDeps['extract'],
    acquireLock: async () => () => {},
    lookupCache: over.lookupCache
      ?? (vi.fn().mockResolvedValue(
        over.cachedConfig ? { paginationConfig: over.cachedConfig } : null,
      ) as unknown as PlanRunDeps['lookupCache']),
    savePagination: (async (_domain: string, config: PaginationConfig) => { saved.push(config); }) as PlanRunDeps['savePagination'],
    crawlCalls,
    saved,
  };
}

export function fakeRequest(budget: { maxPages: number; maxItems: number }): PlanRunRequest {
  return {
    source: {
      listingMode: 'listing_to_detail',
      inputStrategy: 'direct',
      urlTemplate: 'https://listing.example/search',
      budget: { max_pages: budget.maxPages, max_items: budget.maxItems, mode: 'first_n' },
    },
    schema: [{ name: DETAIL_URL_FIELD, type: 'url', origin: 'listing' }],
    inputSet: { columns: [], rows: [] },
  } as unknown as PlanRunRequest;
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-pagination.test.ts`

Expected: FAIL — TypeScript rejects `lookupCache` / `savePagination` as unknown properties of `PlanRunDeps`, and `detect` is called because nothing passes a cached config.

- [ ] **Step 3: Add the deps and wire the read**

In `packages/scraper/src/crawl/plan-run.ts`, extend the imports:

```typescript
import { runExtraction, type ExtractionAgent, type ExtractionDeps, type ExtractionOutcome } from '../extraction-orchestrator.js';
import { lookupDomainCache, savePaginationConfig } from '../domain-cache.js';
```

Extend `PlanRunDeps`:

```typescript
export type PlanRunDeps = {
  browser: IBrowser;
  agent: ExtractionAgent | null;
  /** Injected so tests can plan without a browser or an API key. */
  extract?: typeof runExtraction;
  /**
   * The per-domain lock + politeness delay. Injectable so tests do not pay the
   * 2s spacing; defaults to the real one.
   */
  acquireLock?: typeof acquireDomainLock;
  /** Reads the stored pagination config. Injectable so tests need no database. */
  lookupCache?: typeof lookupDomainCache;
  /** Writes a pagination config that a walk has just verified. */
  savePagination?: typeof savePaginationConfig;
};
```

Resolve them beside the existing defaults inside `planRun`:

```typescript
const lookupCache = deps.lookupCache ?? lookupDomainCache;
const savePagination = deps.savePagination ?? savePaginationConfig;
```

Replace the detection call in the pagination block (currently `const pagination = capture ? await detectPagination(capture, deps.agent as PaginationAgent | null) : ...`) with:

```typescript
      // A config this domain has already proven beats re-rolling detection: it is
      // the same answer every run, and on a domain where mechanical detection
      // fails it also skips the AI call. Looked up under 'listing' because that
      // is the only page type that paginates.
      const paginationDomain = new URL(start.url).hostname;
      const cachedPagination = (await lookupCache(paginationDomain, 'listing'))?.paginationConfig ?? null;
      const pagination = capture
        ? await detectPagination(capture, deps.agent as PaginationAgent | null, cachedPagination)
        : { config: null, source: 'none' as const };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-pagination.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Teeth check**

Drop the third argument from the `detectPagination` call. Re-run. Expected: "uses the stored config instead of detecting again" FAILS because `detect` was called. Restore.

- [ ] **Step 6: Full gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/crawl/plan-run.ts packages/scraper/src/crawl/plan-run-pagination.test.ts packages/scraper/src/crawl/plan-run-pagination.fixtures.ts
git commit -m "feat(crawl): planRun consults the stored pagination config"
```

---

### Task 3: Write the config only when the walk verifies it

**Files:**
- Modify: `packages/scraper/src/crawl/plan-run.ts` (the paging block, around lines 305-335)
- Test: `packages/scraper/src/crawl/plan-run-pagination.test.ts` (append)

**Interfaces:**
- Consumes: `savePagination` resolved in Task 2; the `fakeDeps({ pages })` helper from Task 2's fixture module.
- Produces: a local `walkPages(config): Promise<number>` helper inside `planRun` returning how many NEW detail items the walk added — Task 4 calls it a second time.

Context: the verification the write hangs off already exists. `plan-run.ts` computes `detailsBeforePaging` before the walk and warns when `detailCount() === detailsBeforePaging` afterwards, with a comment saying such a config "is never cached as this domain's pattern". Today that result is discarded.

- [ ] **Step 1: Write the failing test**

Append to `packages/scraper/src/crawl/plan-run-pagination.test.ts`:

```typescript
describe('planRun — writing the config back', () => {
  it('stores a freshly detected config once its walk produced new items', async () => {
    const deps = fakeDeps({ cachedConfig: null, pages: [['https://listing.example/p/3']] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]?.strategy).toBe('url-pattern');
  });

  it('stores NOTHING when the walk produced no new items', async () => {
    // A detected config that yields nothing is a false positive — a carousel
    // arrow, or a selector for an element that is not on the page. Caching it
    // would make every later run on this domain replay a known-bad answer.
    const deps = fakeDeps({ cachedConfig: null, pages: [[]] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
  });

  it('does not rewrite a cached config that worked', async () => {
    // It is already stored and already correct; a write here is pure noise.
    const deps = fakeDeps({ cachedConfig: CACHED_CONFIG, pages: [['https://listing.example/p/3']] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-pagination.test.ts -t "writing the config back"`

Expected: FAIL — "stores a freshly detected config" gets `[]`, because nothing calls `savePagination` yet.

- [ ] **Step 3: Extract the walk and write on success**

In `plan-run.ts`, replace the body of the `try` that currently runs `for await (const page of deps.browser.crawl(...))` with a named helper plus the write. The helper exists so Task 4 can run the same walk twice without duplicating it:

```typescript
      // Pages 2+ replay page 1's plan — no further AI.
      // buildExtractionScript(plan, fieldTypes): the second argument is a
      // name → type map, so `detail_url` is collected as a URL, not a text node.
      const script = buildExtractionScript(page1.plan, { [DETAIL_URL_FIELD]: 'url' }, start.url);

      /** Walk pages 2..maxPages with `config`; answer how many NEW items it added. */
      const walkPages = async (config: PaginationConfig): Promise<number> => {
        const before = detailCount();
        for await (const page of deps.browser.crawl(start.url, {
          extractionScript: script,
          maxPages: budget.maxPages,
          startPage: 2,
          paginationConfig: config,
        })) {
          items.push({
            kind: 'listing', url: page.url, inputIndex: start.inputIndex,
            inputValues: start.inputValues, listingValues: {}, pageNumber: page.pageNumber,
          });
          if (absorb(page.data, page.url, page.pageNumber) === 'stop') break;
        }
        return detailCount() - before;
      };

      try {
        const gained = await walkPages(pagination.config);

        // Verification, not trust: a config is worth remembering only once a walk
        // it drove has actually produced new URLs. A cached config that worked is
        // already stored, so re-writing it would be noise.
        if (gained > 0 && pagination.source !== 'cache') {
          await savePagination(paginationDomain, pagination.config);
        }
        if (gained === 0) {
          warnings.push(
            `pagination (${pagination.source}: ${pagination.config.strategy}) produced no new items on ${start.url}`,
          );
        }
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
      } catch (err) {
        errors.push({ inputIndex: start.inputIndex, message: `pagination failed: ${(err as Error).message}` });
        report(start.inputIndex, 'error', detailCount() - detailsBefore);
      }
```

Two notes on variables in that block:

- `detailsBefore` is already declared by the enclosing input loop, before `page1` is extracted, and the `report(...)` calls above and below already use it. Leave it alone — do not redeclare or shadow it.
- `detailsBeforePaging` becomes unused once `walkPages` computes its own `before`. Delete it.

Add `PaginationConfig` to the type-only import from `@robot/browser` at the top of the file.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-pagination.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 5: Teeth check**

Change the write condition to `if (pagination.source !== 'cache')` (dropping `gained > 0`). Re-run. Expected: "stores NOTHING when the walk produced no new items" FAILS. Restore.

- [ ] **Step 6: Full gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/crawl/plan-run.ts packages/scraper/src/crawl/plan-run-pagination.test.ts
git commit -m "feat(crawl): cache a pagination config once its walk verifies it"
```

---

### Task 4: The stale path — re-detect once, retry once

**Files:**
- Modify: `packages/scraper/src/crawl/plan-run.ts` (the block from Task 3)
- Test: `packages/scraper/src/crawl/plan-run-pagination.test.ts` (append)

**Interfaces:**
- Consumes: `walkPages(config)` from Task 3; `detectPagination` and `savePagination` as already wired.
- Produces: nothing new.

Context: this is the v2 spec §2.4 rule — "when a cached config produces nothing on page 2, phase 1 re-detects once, stores the new config" — made concrete. Bounded at one retry: no loop, no recursion.

- [ ] **Step 1: Write the failing test**

Append to `packages/scraper/src/crawl/plan-run-pagination.test.ts`:

```typescript
describe('planRun — a stale cached config', () => {
  it('re-detects and retries once when the cached config yields nothing', async () => {
    // First walk (cached config): nothing. Second walk (fresh config): items.
    const deps = fakeDeps({
      cachedConfig: CACHED_CONFIG,
      pages: [[], ['https://listing.example/p/9']],
    });

    const outcome = await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(2);
    // The retry must not reuse the config that just failed.
    expect(deps.crawlCalls[1]?.paginationConfig).not.toEqual(CACHED_CONFIG);
    // And the replacement is stored only because its own walk verified it.
    expect(deps.saved).toHaveLength(1);
    expect(outcome.items.some((i) => i.url === 'https://listing.example/p/9')).toBe(true);
  });

  it('gives up after ONE retry rather than looping', async () => {
    const deps = fakeDeps({ cachedConfig: CACHED_CONFIG, pages: [[], []] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(2);
    // A re-detection that also produced nothing is not evidence of anything:
    // the stored config stays, and a human sees the warning.
    expect(deps.saved).toEqual([]);
  });

  it('does not retry when the config that failed was freshly detected', async () => {
    // Re-detecting would just produce the same answer from the same capture.
    const deps = fakeDeps({ cachedConfig: null, pages: [[]] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-pagination.test.ts -t "stale cached config"`

Expected: FAIL — `expected 1 to be 2`, because there is no retry.

- [ ] **Step 3: Implement the stale path**

Replace the `const gained = await walkPages(pagination.config);` line and the write that follows it with:

```typescript
        let gained = await walkPages(pagination.config);
        let winning = pagination.config;
        let winningSource = pagination.source;

        // A CACHED config that produced nothing means the site changed its pager
        // since we learned it. Re-detect from this run's own capture and try once
        // more — bounded at one retry, because a second failure is a site we
        // cannot page today, not a reason to keep fetching.
        //
        // A freshly detected config that failed gets no retry: re-detecting would
        // read the same capture and reach the same answer.
        if (gained === 0 && pagination.source === 'cache') {
          const fresh = await detectPagination(capture!, deps.agent as PaginationAgent | null);
          if (fresh.config) {
            gained = await walkPages(fresh.config);
            winning = fresh.config;
            winningSource = fresh.source;
          }
        }

        // Verification, not trust: a config is worth remembering only once a walk
        // it drove has actually produced new URLs. A cached config that worked is
        // already stored, so re-writing it would be noise.
        if (gained > 0 && winningSource !== 'cache') {
          await savePagination(paginationDomain, winning);
        }
        if (gained === 0) {
          warnings.push(
            `pagination (${winningSource}: ${winning.strategy}) produced no new items on ${start.url}`,
          );
        }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-pagination.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 5: Teeth check**

Remove the `&& pagination.source === 'cache'` condition so every failed walk retries. Re-run. Expected: "does not retry when the config that failed was freshly detected" FAILS with `expected 2 to be 1` — a second `crawl` call happened where the test demands only one. Restore.

- [ ] **Step 6: Full gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/crawl/plan-run.ts packages/scraper/src/crawl/plan-run-pagination.test.ts
git commit -m "feat(crawl): a stale pagination config re-detects and retries once"
```

---

### Task 5: The offline multi-page gate

**Files:**
- Create: `packages/scraper/src/__fixtures__/serve.ts`
- Test: `packages/scraper/src/crawl/multi-page-walk-fixture.test.ts`

**Interfaces:**
- Consumes: `PlaywrightBrowser` from `@robot/browser`; `buildExtractionScript` from `../executor.js`; `enumerateDetailUrls`, `DETAIL_URL_FIELD` from `./enumerate-detail-urls.js`.
- Produces: `serveFixturePages(pages: ServedPage[]): Promise<ServedSite>` where `ServedPage = { path: string; html: string }` and `ServedSite = { baseUrl: string; requests: string[]; close: () => Promise<void> }`.

Context and why this task exists: `setContentEvaluate` injects HTML into a blank page and never navigates, so it cannot exercise `browser.crawl()`'s page-to-page walking at all. That is why multi-page walking has no offline gate today, and why three live-fire bugs on the phase-2 branch were invisible to 456 green tests. This is the largest piece of the plan.

The spec suggested a fixed port range; use port `0` instead (the OS assigns a free ephemeral port) — a fixed port makes the suite fail when anything else holds it, and nothing here needs a predictable URL.

Model the Playwright lifecycle on `packages/scraper/src/crawl/link-enumeration-fixture.test.ts`: one browser in `beforeAll`, closed in `afterAll`, 60s timeouts on the browser-touching tests.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/multi-page-walk-fixture.test.ts`:

```typescript
// Tier 1: does browser.crawl() actually WALK pages 2..N, and does enumeration
// dedupe across them? setContentEvaluate cannot answer this — it never navigates
// — so until now nothing offline covered the multi-page path at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, type CrawlPage } from '@robot/browser';
import { serveFixturePages, type ServedSite } from '../__fixtures__/serve.js';
import { buildExtractionScript } from '../executor.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const page = (links: string[]) =>
  `<html><body>${links.map((h) => `<div class="item"><a class="t" href="${h}">x</a></div>`).join('')}</body></html>`;

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([
    { path: '/list?page=1', html: page(['/p/1', '/p/2']) },
    { path: '/list?page=2', html: page(['/p/3', '/p/4']) },
    // Page 3 repeats /p/4 — a real site's overlap between pages.
    { path: '/list?page=3', html: page(['/p/4', '/p/5']) },
    { path: '/list?page=4', html: page(['/p/6']) },
  ]);
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

const script = () => buildExtractionScript(
  { row_xpath: '//div[@class="item"]', fields: [{ name: DETAIL_URL_FIELD, xpath: './/a/@href', transform: 'absolute_url' }] },
  { [DETAIL_URL_FIELD]: 'url' },
);

async function walk(maxPages: number): Promise<CrawlPage[]> {
  const pages: CrawlPage[] = [];
  for await (const p of browser.crawl(`${site.baseUrl}/list?page=1`, {
    extractionScript: script(),
    maxPages,
    startPage: 2,
    paginationConfig: { strategy: 'url-pattern', urlTemplate: `${site.baseUrl}/list?page={N}` },
  })) {
    pages.push(p);
  }
  return pages;
}

describe('multi-page walking against served fixtures', () => {
  it('walks pages 2..maxPages and extracts each one', async () => {
    const pages = await walk(3);

    expect(pages.map((p) => p.pageNumber)).toEqual([2, 3]);
    expect(pages[0]!.data).toHaveLength(2);
  }, 60_000);

  it('stops at maxPages instead of walking the whole site', async () => {
    site.requests.length = 0;
    await walk(3);

    // Page 4 exists and is reachable by the same template. The budget is the
    // only thing stopping the crawl, so if it is not honoured we fetch it.
    expect(site.requests.some((r) => r.includes('page=4'))).toBe(false);
  }, 60_000);

  it('dedupes detail URLs that appear on more than one page', async () => {
    const pages = await walk(3);
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const p of pages) {
      const result = enumerateDetailUrls({ rows: p.data, pageUrl: p.url, pageNumber: p.pageNumber, seen, remaining: 50 });
      for (const item of result.items) { seen.add(item.url); urls.push(item.url); }
    }

    // /p/4 is on both page 2 and page 3; it must be planned exactly once.
    expect(urls.filter((u) => u.endsWith('/p/4'))).toHaveLength(1);
    expect(new Set(urls).size).toBe(urls.length);
  }, 60_000);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/multi-page-walk-fixture.test.ts`

Expected: FAIL — cannot resolve `../__fixtures__/serve.js`.

- [ ] **Step 3: Implement the server**

Create `packages/scraper/src/__fixtures__/serve.ts`:

```typescript
// A static HTTP server for multi-page fixtures.
//
// Tier 1's other tests use `setContentEvaluate`, which injects HTML into a blank
// page and never navigates. That makes it structurally incapable of exercising
// `browser.crawl()`'s page-to-page walk: no navigation, no pagination. Serving
// the frozen pages over real HTTP gives the crawler somewhere to actually go,
// for free and offline.
import { createServer } from 'node:http';

export type ServedPage = {
  /** Path INCLUDING any query string, e.g. "/list?page=2" — matched exactly. */
  path: string;
  html: string;
};

export type ServedSite = {
  /** Origin to build URLs from, e.g. "http://127.0.0.1:54321". */
  baseUrl: string;
  /** Every path requested, in order. Mutable so a test can reset it between walks. */
  requests: string[];
  close: () => Promise<void>;
};

export async function serveFixturePages(pages: ServedPage[]): Promise<ServedSite> {
  const byPath = new Map(pages.map((p) => [p.path, p.html]));
  const requests: string[] = [];

  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    requests.push(path);
    const html = byPath.get(path);
    if (html === undefined) {
      // A 404 rather than a fallback page: a crawler that walks past the end of
      // the fixture must fail loudly, not silently re-extract something.
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such fixture page');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  // Port 0: the OS hands us a free ephemeral port. A fixed port turns "something
  // else is listening" into a confusing suite failure.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/multi-page-walk-fixture.test.ts`

Expected: PASS, 3 tests.

If the walk yields nothing, check that `browser.crawl`'s `url-pattern` strategy substitutes `{N}` in the template — set `HEADFUL=1` and watch, rather than weakening the assertions.

- [ ] **Step 5: Teeth check**

In `walk()`, change `maxPages` to `9`. Re-run. Expected: "stops at maxPages" FAILS because `page=4` was fetched. Restore.

- [ ] **Step 6: Full gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/scraper/src/__fixtures__/serve.ts packages/scraper/src/crawl/multi-page-walk-fixture.test.ts
git commit -m "test(crawl): Tier 1 gate for multi-page walking over served fixtures"
```

---

### Task 6: Prove it live, and say what is true

**Files:**
- Modify: `docs/handoff.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: everything above.

This task spends real money and makes real requests to a live site. It is authorised for ONE planning run and ONE execution run. Do not raise any budget beyond what Step 1 sets, and do not re-run for a better-looking result — a second distinct failure is information worth reporting.

- [ ] **Step 1: Raise the AbeBooks budget so page 2 is actually reached**

The existing budget stops at 8 items on page 1, which is exactly why multi-page walking is unproven.

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "update sources set budget = '{\"mode\":\"first_n\",\"max_items\":20,\"max_pages\":3}'::jsonb where slug='abebooks-pagination' returning slug, budget;"
```

- [ ] **Step 2: Plan the crawl**

```bash
pnpm --filter @robot/api exec tsx src/crawl-plan.ts abebooks-pagination
```

Record the run id. Expected: more than one `listing` item, and detail URLs carrying `page_number` 2 (and 3, if the cap allows).

- [ ] **Step 3: Verify the walk actually happened**

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "select kind, page_number, count(*) from run_items where run_id='<run-id>' group by 1,2 order by 1,2;"
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "select domain, page_type, pagination_config from domain_intelligence where domain like '%abebooks%';"
```

Expected: `listing` rows for pages 1 and 2 (at least), detail rows carrying more than one distinct `page_number`, and a non-null `pagination_config` on the `(abebooks.com, listing)` row. That last one is the first time this column has ever been written.

- [ ] **Step 4: Plan a second time and confirm the domain is warm**

```bash
pnpm --filter @robot/api exec tsx src/crawl-plan.ts abebooks-pagination
```

Expected: the same fan-out, with the console showing pagination `source: cache`. Record whether anything else changed.

- [ ] **Step 5: Execute one of the runs end to end**

```bash
pnpm --filter @robot/api exec tsx src/crawl-execute.ts <run-id>
```

Expected: every detail item reaches `done` or `failed` with a recorded reason, and the run reaches `completed` or `partial`.

- [ ] **Step 6: Live-exercise cancel and resume**

While a run is executing, in another terminal, stop it and then resume it:

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "update runs set status='cancelling' where id='<run-id>';"
# watch the CLI settle, then:
pnpm --filter @robot/api exec tsx src/crawl-execute.ts <run-id>
```

Expected: the run settles to `cancelled` with items still `pending`, and the second call resumes and finishes them. This is the claim the docs currently mark unit-tested-only; either it holds and the caveat goes, or it does not and that is the most valuable finding in this plan.

- [ ] **Step 7: Record what is true**

Update `docs/handoff.md` with the real numbers: listing pages walked, detail items per page, whether the config was cached and replayed on the second plan, and the cancel/resume result. Update `docs/roadmap.md`'s v2 section to mark multi-page pagination and config caching as delivered — **only for what the run actually demonstrated**. If `max_pages` never bound because `max_items` filled first again, say so rather than implying otherwise.

Correct the "pay nothing for detection" claim wherever it appears (the v2 spec §2.4 and any doc echoing it): mechanical detection was already free, so the saving is real only where the AI fallback fires; the durable win is determinism.

- [ ] **Step 8: Commit**

```bash
git add docs/handoff.md docs/roadmap.md
git commit -m "docs: pagination caching and the multi-page walk, proven live"
```

---

## Done when

- `pnpm -r test`, `pnpm typecheck --force`, and `pnpm --filter @robot/dashboard exec tsc --noEmit` are all clean, and `select count(*) from orgs where slug like 'test-%'` is 0.
- A verified pagination config is written to `domain_intelligence.pagination_config` and replayed on the next plan for that domain.
- A config whose walk produced nothing is never written.
- A stale cached config re-detects and retries exactly once, and a second failure leaves the stored config alone with a warning.
- Tier 1 walks a multi-page site offline, dedupes across pages, and honours `maxPages`.
- A live run walked more than one listing page, and the docs say exactly what it demonstrated.

## Not in this plan

`api-param` pagination detection and replay; infinite scroll and load-more; keying a config by URL shape or by Source; multiple ranked candidate configs with hit/miss scoring; the progressive-confidence ladder; a real job queue.
