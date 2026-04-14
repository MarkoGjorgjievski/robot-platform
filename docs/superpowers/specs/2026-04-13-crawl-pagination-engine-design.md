# Crawl & Pagination Engine

## Purpose

Add a `crawl()` method to `PlaywrightBrowser` that navigates through paginated listing pages, extracting data from each page using the same extraction plan. Detects pagination mechanically (free) with AI fallback. Stores detected pagination config in domain intelligence for reuse.

## Pagination Detection

Three strategies, tried in order. Mechanical detection is free and instant. AI fallback costs ~$0.03.

### Strategy 1: URL Pattern (mechanical)

Scan `<a>` elements inside pagination-like containers for URL patterns:
- `?page=2`, `&page=2`, `?p=2`
- `/page/2/`, `/page-2`
- `?offset=20`, `?start=20`

If found, construct a URL template: `https://example.com/search?q=shoes&page={N}`

### Strategy 2: Next Button (mechanical)

Find clickable elements matching common selectors (tried in order):
- `a[rel="next"]`
- `[aria-label="Next"]`, `[aria-label="Next page"]`
- `.pagination .next`, `.pager .next`
- `button:has-text("Next")`, `a:has-text("Next")`
- `[class*="next"]:not([class*="prev"])`
- `li.next > a`, `a.next`

### Strategy 3: Page Number Links (mechanical)

Find numbered links inside pagination containers:
- `.pagination a`, `[role="navigation"] a`, `nav[aria-label*="pagination"] a`
- Filter to links whose text content is a number (2, 3, 4...)

### Strategy 4: AI Fallback

If mechanical detection finds nothing, send the page HTML (truncated) to Claude:
"This is a listing page. Find the pagination mechanism — is there a Next button, page number links, or URL-based pagination? Return the selector or URL pattern."

Uses the existing `SchemaAgent` with a new prompt + tool.

## `crawl()` API

```typescript
async *crawl(startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage>
```

### Types

```typescript
type CrawlOptions = {
  maxPages?: number;           // default: 5
  maxItems?: number;           // stop after N total items extracted
  extractionPlan: ExtractionPlan;
  paginationConfig?: PaginationConfig;  // skip detection if provided (from cache)
};

type CrawlPage = {
  url: string;
  pageNumber: number;
  data: Record<string, unknown>[];
  capture: PageCapture;
};

type PaginationConfig = {
  strategy: 'url-pattern' | 'next-button' | 'page-numbers';
  urlTemplate?: string;    // for url-pattern: "https://example.com/search?page={N}"
  nextSelector?: string;   // for next-button: "a[rel='next']"
  pageSelector?: string;   // for page-numbers: ".pagination a"
};
```

### Flow

1. Navigate to `startUrl`, run `extractionPlan` via `buildExtractionScript()`, yield page 1
2. If no `paginationConfig` provided, run pagination detection (mechanical → AI)
3. If no pagination found, stop (single-page listing)
4. Navigate to page 2:
   - `url-pattern`: construct URL with `{N}` replaced by page number
   - `next-button`: click the selector, wait for navigation/content change
   - `page-numbers`: click the link for the next page number
5. Wait for content to load (same `waitUntil` strategy as initial capture)
6. Run extraction with same `extractionPlan`, yield page N
7. Stop when: `maxPages` reached, `maxItems` total items reached, no next page found, or page returns 0 new items

### Detecting "no more pages"

- `url-pattern`: stop if page returns 0 items or same items as previous page
- `next-button`: stop if selector not found or not visible on current page
- `page-numbers`: stop if no higher page number link exists

## Storage

### Domain Intelligence

Add `paginationConfig` JSONB column to `domainIntelligence` table. Stored alongside `fieldPaths` with the same `(domain, pageType)` key.

On first crawl: detect → save to cache.
On subsequent crawls: load from cache → skip detection.

### Cache Integration

In `domain-cache.ts`:
- `lookupDomainCache()` already returns the full row — `paginationConfig` will be available automatically once the column exists.
- `saveDomainCache()` — add optional `paginationConfig` parameter. Only save when a new config is detected (don't overwrite with null on non-crawl runs).

## Files Changed

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/browser/src/types.ts` | Modify | Add `CrawlOptions`, `CrawlPage`, `PaginationConfig` types |
| `packages/browser/src/pagination-detector.ts` | Create | Mechanical detection (URL pattern, next button, page numbers) |
| `packages/browser/src/playwright-browser.ts` | Modify | Add `crawl()` method |
| `packages/browser/src/index.ts` | Modify | Export new types |
| `packages/agent/src/prompts.ts` | Modify | Add pagination detection prompt |
| `packages/agent/src/tools.ts` | Modify | Add pagination detection tool |
| `packages/agent/src/schema-agent.ts` | Modify | Add `detectPagination()` method |
| `packages/agent/src/types.ts` | Modify | Add `PaginationDetectionResult` type |
| `packages/scraper/src/domain-cache.ts` | Modify | Save/load pagination config |
| `packages/db/src/schema.ts` | Modify | Add `paginationConfig` column |
| DB migration | Create | Migration for new column |
| `packages/browser/src/pagination-detector.test.ts` | Create | Tests for mechanical detection |

## What We're NOT Doing

- No listing→detail (following links from listing to detail pages) — sub-project 2
- No input sets or batch processing — sub-project 3
- No progressive confidence — sub-project 4
- No infinite scroll detection — future enhancement
- No frontend changes — deferred for UX redesign
