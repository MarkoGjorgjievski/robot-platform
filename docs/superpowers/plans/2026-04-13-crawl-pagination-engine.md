# Crawl & Pagination Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `crawl()` method to the browser that navigates paginated listing pages, extracting data from each page using the same selectors, with mechanical pagination detection and AI fallback.

**Architecture:** Three layers — pagination detector (finds how to get to the next page), crawl method (iterates pages), and domain cache integration (saves/loads pagination config). Pagination detection tries mechanical patterns first (free), falls back to AI (~$0.03).

**Tech Stack:** TypeScript, Playwright, vitest, Drizzle ORM, Anthropic Claude API

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/browser/src/types.ts` | Modify | Add `PaginationConfig`, `CrawlOptions`, `CrawlPage` types |
| `packages/browser/src/pagination-detector.ts` | Create | Mechanical pagination detection (3 strategies) |
| `packages/browser/src/pagination-detector.test.ts` | Create | Tests for mechanical detection |
| `packages/browser/src/playwright-browser.ts` | Modify | Add `crawl()` async generator method |
| `packages/browser/src/index.ts` | Modify | Export new types + pagination detector |
| `packages/agent/src/types.ts` | Modify | Add `PaginationDetectionResult` type |
| `packages/agent/src/prompts.ts` | Modify | Add pagination detection prompt |
| `packages/agent/src/tools.ts` | Modify | Add pagination detection tool |
| `packages/agent/src/schema-agent.ts` | Modify | Add `detectPagination()` method |
| `packages/db/src/schema.ts` | Modify | Add `paginationConfig` column to `domainIntelligence` |
| `packages/scraper/src/domain-cache.ts` | Modify | Save/load pagination config |

---

### Task 1: Types

**Files:**
- Modify: `packages/browser/src/types.ts`

- [ ] **Step 1: Add pagination and crawl types**

Add to the end of `packages/browser/src/types.ts`:

```typescript
export type PaginationConfig = {
  strategy: 'url-pattern' | 'next-button' | 'page-numbers';
  /** For url-pattern: URL with {N} placeholder, e.g. "https://example.com/search?page={N}" */
  urlTemplate?: string;
  /** For next-button: CSS selector for the next page element */
  nextSelector?: string;
  /** For page-numbers: CSS selector for page number links container */
  pageSelector?: string;
};

export type CrawlOptions = {
  /** Maximum number of pages to crawl. Default: 5 */
  maxPages?: number;
  /** Stop after extracting this many total items across all pages */
  maxItems?: number;
  /** The extraction script to run on each page (from buildExtractionScript) */
  extractionScript: string;
  /** Skip detection if pagination config is already known (from cache) */
  paginationConfig?: PaginationConfig;
};

export type CrawlPage = {
  url: string;
  pageNumber: number;
  data: Record<string, unknown>[];
  totalRows: number;
};
```

- [ ] **Step 2: Export new types from browser package**

In `packages/browser/src/index.ts`, add the new types to the export:

Change:
```typescript
export type { IBrowser, BrowserOptions, CaptureOptions, PageCapture, StructuredData, InterceptedRequest } from './types.js';
```

To:
```typescript
export type { IBrowser, BrowserOptions, CaptureOptions, PageCapture, StructuredData, InterceptedRequest, PaginationConfig, CrawlOptions, CrawlPage } from './types.js';
```

- [ ] **Step 3: Commit**

```bash
git add packages/browser/src/types.ts packages/browser/src/index.ts
git commit -m "feat(browser): add pagination and crawl types"
```

---

### Task 2: Mechanical pagination detector

**Files:**
- Create: `packages/browser/src/pagination-detector.ts`
- Create: `packages/browser/src/pagination-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/browser/src/pagination-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectPaginationFromHtml } from './pagination-detector.js';

describe('detectPaginationFromHtml', () => {
  describe('URL pattern detection', () => {
    it('detects ?page=N pattern', () => {
      const html = `
        <div class="pagination">
          <a href="/search?q=shoes&page=1" class="active">1</a>
          <a href="/search?q=shoes&page=2">2</a>
          <a href="/search?q=shoes&page=3">3</a>
        </div>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/search?q=shoes');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('url-pattern');
      expect(result!.urlTemplate).toContain('{N}');
      expect(result!.urlTemplate).toContain('page=');
    });

    it('detects &p=N pattern', () => {
      const html = `
        <nav>
          <a href="/results?q=test&p=2">Next</a>
        </nav>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/results?q=test');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('url-pattern');
    });

    it('detects /page/N/ pattern', () => {
      const html = `
        <div class="pagination">
          <a href="/blog/page/2/">2</a>
          <a href="/blog/page/3/">3</a>
        </div>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/blog/');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('url-pattern');
      expect(result!.urlTemplate).toContain('/page/{N}/');
    });
  });

  describe('Next button detection', () => {
    it('detects a[rel="next"]', () => {
      const html = `<a rel="next" href="/page/2">Next</a>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/page/1');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('next-button');
      expect(result!.nextSelector).toBe('a[rel="next"]');
    });

    it('detects aria-label="Next"', () => {
      const html = `<button aria-label="Next page">→</button>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('next-button');
      expect(result!.nextSelector).toContain('aria-label');
    });

    it('detects .pagination .next', () => {
      const html = `
        <ul class="pagination">
          <li class="active"><a href="?page=1">1</a></li>
          <li><a href="?page=2">2</a></li>
          <li class="next"><a href="?page=2">Next</a></li>
        </ul>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/');
      expect(result).not.toBeNull();
      // Could be url-pattern or next-button — both are valid
      expect(['url-pattern', 'next-button']).toContain(result!.strategy);
    });
  });

  describe('Page number detection', () => {
    it('detects numbered links in pagination container', () => {
      const html = `
        <nav aria-label="Pagination">
          <a href="/p1" class="active">1</a>
          <a href="/p2">2</a>
          <a href="/p3">3</a>
          <a href="/p4">4</a>
        </nav>`;
      // No ?page=N pattern, no rel="next" — should fall back to page numbers
      const result = detectPaginationFromHtml(html, 'https://example.com/p1');
      expect(result).not.toBeNull();
    });
  });

  describe('No pagination', () => {
    it('returns null for pages without pagination', () => {
      const html = `<div><h1>Product</h1><p>Description</p></div>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/product');
      expect(result).toBeNull();
    });

    it('returns null for empty HTML', () => {
      const result = detectPaginationFromHtml('', 'https://example.com/');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/browser && npx vitest run src/pagination-detector.test.ts`
Expected: FAIL — cannot find `./pagination-detector.js`

- [ ] **Step 3: Implement pagination detector**

Create `packages/browser/src/pagination-detector.ts`:

```typescript
import type { PaginationConfig } from './types.js';

/**
 * Detect pagination from raw HTML string.
 * Tries three strategies in order: URL pattern, next button, page numbers.
 * Returns null if no pagination detected.
 *
 * This runs on the server side (not in browser context) — uses regex/string
 * matching, not DOM APIs.
 */
export function detectPaginationFromHtml(
  html: string,
  currentUrl: string,
): PaginationConfig | null {
  return (
    detectUrlPattern(html, currentUrl) ??
    detectNextButton(html) ??
    detectPageNumbers(html) ??
    null
  );
}

// ─── Strategy 1: URL Pattern ───────────────────────────────────────────────

const URL_PAGE_PATTERNS = [
  // ?page=N or &page=N
  { regex: /href="([^"]*[?&]page=)(\d+)([^"]*)"/gi, param: 'page' },
  // ?p=N or &p=N
  { regex: /href="([^"]*[?&]p=)(\d+)([^"]*)"/gi, param: 'p' },
  // ?offset=N or &offset=N
  { regex: /href="([^"]*[?&]offset=)(\d+)([^"]*)"/gi, param: 'offset' },
  // ?start=N or &start=N
  { regex: /href="([^"]*[?&]start=)(\d+)([^"]*)"/gi, param: 'start' },
  // /page/N or /page/N/
  { regex: /href="([^"]*\/page\/)(\d+)(\/?"[^>]*)/gi, param: 'path' },
];

function detectUrlPattern(html: string, currentUrl: string): PaginationConfig | null {
  for (const pattern of URL_PAGE_PATTERNS) {
    // Reset regex state
    pattern.regex.lastIndex = 0;
    const matches: Array<{ prefix: string; num: number; suffix: string }> = [];

    let match;
    while ((match = pattern.regex.exec(html)) !== null) {
      matches.push({
        prefix: match[1],
        num: parseInt(match[2], 10),
        suffix: match[3],
      });
    }

    // Need at least one match with page > 1 (to confirm it's pagination, not just any link)
    const hasHigherPage = matches.some(m => m.num > 1);
    if (matches.length > 0 && hasHigherPage) {
      const first = matches[0];
      let urlTemplate: string;

      if (pattern.param === 'path') {
        // /page/N/ style
        urlTemplate = resolveUrl(currentUrl, `${first.prefix}{N}${first.suffix.replace(/".*/, '')}`);
      } else {
        // Query param style — reconstruct full URL with {N} placeholder
        urlTemplate = resolveUrl(currentUrl, `${first.prefix}{N}${first.suffix.replace(/".*/, '')}`);
      }

      return { strategy: 'url-pattern', urlTemplate };
    }
  }

  return null;
}

// ─── Strategy 2: Next Button ───────────────────────────────────────────────

const NEXT_BUTTON_PATTERNS: Array<{ regex: RegExp; selector: string }> = [
  { regex: /rel=["']next["']/i, selector: 'a[rel="next"]' },
  { regex: /aria-label=["']Next["']/i, selector: '[aria-label="Next"]' },
  { regex: /aria-label=["']Next page["']/i, selector: '[aria-label="Next page"]' },
  { regex: /class=["'][^"']*\bnext\b[^"']*["'][^>]*>.*?(Next|→|›|»)/is, selector: '.next a, a.next, .next button, button.next' },
  { regex: /<(?:a|button)[^>]*>(?:\s*(?:<[^>]+>\s*)*)?Next(?:\s*(?:<[^>]+>\s*)*)?<\/(?:a|button)>/i, selector: 'a:has-text("Next"), button:has-text("Next")' },
];

function detectNextButton(html: string): PaginationConfig | null {
  for (const pattern of NEXT_BUTTON_PATTERNS) {
    if (pattern.regex.test(html)) {
      return { strategy: 'next-button', nextSelector: pattern.selector };
    }
  }

  return null;
}

// ─── Strategy 3: Page Numbers ──────────────────────────────────────────────

function detectPageNumbers(html: string): PaginationConfig | null {
  // Look for pagination containers with numbered links
  const containerPatterns = [
    /(<nav[^>]*aria-label=["'][^"']*paginat[^"']*["'][^>]*>[\s\S]*?<\/nav>)/i,
    /(<[^>]+class=["'][^"']*pagination[^"']*["'][^>]*>[\s\S]*?<\/\w+>)/i,
    /(<[^>]+role=["']navigation["'][^>]*>[\s\S]*?<\/\w+>)/i,
  ];

  for (const pattern of containerPatterns) {
    const containerMatch = html.match(pattern);
    if (!containerMatch) continue;

    const container = containerMatch[1];
    // Count links with numeric text content
    const numericLinks = container.match(/<a[^>]+>\s*\d+\s*<\/a>/g);
    if (numericLinks && numericLinks.length >= 2) {
      // Extract the container selector
      const classMatch = containerMatch[0].match(/class=["']([^"']+)["']/);
      const ariaMatch = containerMatch[0].match(/aria-label=["']([^"']+)["']/);

      let selector: string;
      if (ariaMatch) {
        selector = `[aria-label="${ariaMatch[1]}"] a`;
      } else if (classMatch) {
        const mainClass = classMatch[1].split(/\s+/)[0];
        selector = `.${mainClass} a`;
      } else {
        selector = 'nav a';
      }

      return { strategy: 'page-numbers', pageSelector: selector };
    }
  }

  return null;
}

// ─── Utils ─────────────────────────────────────────────────────────────────

function resolveUrl(base: string, relative: string): string {
  // If relative is already absolute, return as-is
  if (relative.startsWith('http')) return relative;
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/browser && npx vitest run src/pagination-detector.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Export from browser package**

In `packages/browser/src/index.ts`, add:

```typescript
export { detectPaginationFromHtml } from './pagination-detector.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/browser/src/pagination-detector.ts packages/browser/src/pagination-detector.test.ts packages/browser/src/index.ts
git commit -m "feat(browser): mechanical pagination detector"
```

---

### Task 3: AI pagination detection fallback

**Files:**
- Modify: `packages/agent/src/types.ts`
- Modify: `packages/agent/src/prompts.ts`
- Modify: `packages/agent/src/tools.ts`
- Modify: `packages/agent/src/schema-agent.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Add PaginationDetectionResult type**

Add to the end of `packages/agent/src/types.ts`:

```typescript
export type PaginationDetectionResult = {
  has_pagination: boolean;
  strategy: 'url-pattern' | 'next-button' | 'page-numbers' | 'none';
  url_template?: string;
  next_selector?: string;
  page_selector?: string;
};
```

- [ ] **Step 2: Export PaginationDetectionResult**

In `packages/agent/src/index.ts`, add `PaginationDetectionResult` to the type exports from `./types.js`.

- [ ] **Step 3: Add pagination detection prompt**

Add to `packages/agent/src/prompts.ts`, after the `selectorRetryUserContent` function:

```typescript
export const PAGINATION_DETECTION_SYSTEM = `You are a pagination expert. Given the HTML of a listing page, identify how to navigate to the next page of results.

Look for:
1. URL-based pagination: links with ?page=2, &p=2, /page/2/, ?offset=20
2. Next buttons: elements labeled "Next", "→", "›", with rel="next", or aria-label="Next"
3. Page number links: numbered links (1, 2, 3...) inside a pagination container

Return the most reliable pagination mechanism found. Prefer URL patterns over click-based navigation.
If no pagination exists (single-page listing), set has_pagination to false.`;

export function paginationDetectionUserContent(html: string): string {
  return `Find the pagination mechanism on this listing page.

HTML (may be truncated):

${html}`;
}
```

- [ ] **Step 4: Add pagination detection tool**

Add to `packages/agent/src/tools.ts`, after the existing tool definitions:

```typescript
export const detectPaginationTool: Tool = {
  name: 'detect_pagination',
  description: 'Detect the pagination mechanism on a listing page. Identify how to navigate to the next page of results.',
  input_schema: {
    type: 'object' as const,
    properties: {
      has_pagination: {
        type: 'boolean',
        description: 'Whether the page has pagination (multiple pages of results)',
      },
      strategy: {
        type: 'string',
        enum: ['url-pattern', 'next-button', 'page-numbers', 'none'],
        description: 'The type of pagination mechanism found',
      },
      url_template: {
        type: 'string',
        description: 'For url-pattern: the URL with {N} as page number placeholder, e.g. "https://example.com/search?page={N}"',
      },
      next_selector: {
        type: 'string',
        description: 'For next-button: CSS selector for the next page button/link, e.g. "a[rel=next]", ".pagination .next a"',
      },
      page_selector: {
        type: 'string',
        description: 'For page-numbers: CSS selector for the pagination number links, e.g. ".pagination a", "nav[aria-label=Pagination] a"',
      },
    },
    required: ['has_pagination', 'strategy'],
  },
};
```

- [ ] **Step 5: Add detectPagination method to SchemaAgent**

In `packages/agent/src/schema-agent.ts`, add the import for the new prompt and tool. Add `PAGINATION_DETECTION_SYSTEM` and `paginationDetectionUserContent` to the prompts import, and `detectPaginationTool` to the tools import. Also add `PaginationDetectionResult` to the types import.

Then add this method to the `SchemaAgent` class, after the `retrySelectorGeneration` method:

```typescript
  async detectPagination(html: string): Promise<PaginationDetectionResult> {
    const truncated = truncateHtml(html, this.anthropic ? 50000 : 30000);
    const userText = paginationDetectionUserContent(truncated);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: PAGINATION_DETECTION_SYSTEM,
        tool: detectPaginationTool,
        userText,
      });
      return result as PaginationDetectionResult;
    }

    const json = await this.ollama!.callWithJson({
      system: PAGINATION_DETECTION_SYSTEM + '\n\nYou MUST respond with valid JSON only.',
      userText,
    }) as Record<string, unknown>;

    return {
      has_pagination: Boolean(json.has_pagination ?? false),
      strategy: (json.strategy as PaginationDetectionResult['strategy']) ?? 'none',
      url_template: json.url_template as string | undefined,
      next_selector: json.next_selector as string | undefined,
      page_selector: json.page_selector as string | undefined,
    };
  }
```

- [ ] **Step 6: Verify types compile**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/types.ts packages/agent/src/prompts.ts packages/agent/src/tools.ts packages/agent/src/schema-agent.ts packages/agent/src/index.ts
git commit -m "feat(agent): AI pagination detection fallback"
```

---

### Task 4: Database migration for paginationConfig

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add paginationConfig column to domainIntelligence**

In `packages/db/src/schema.ts`, find the `domainIntelligence` table definition. Add a `paginationConfig` column after the `popupSelectors` line:

After:
```typescript
  popupSelectors: jsonb('popup_selectors').default([]),
```

Add:
```typescript
  // Pagination detection results for listing pages
  paginationConfig: jsonb('pagination_config'),
```

- [ ] **Step 2: Push schema change to database**

Run: `cd packages/db && pnpm db:push`
Expected: Schema pushed successfully, `pagination_config` column added to `domain_intelligence` table

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add paginationConfig column to domainIntelligence"
```

---

### Task 5: Domain cache integration for pagination config

**Files:**
- Modify: `packages/scraper/src/domain-cache.ts`

- [ ] **Step 1: Add paginationConfig to DomainCache type**

In `packages/scraper/src/domain-cache.ts`, find the `DomainCache` type (around line 28). Add after `successRate`:

```typescript
  paginationConfig: PaginationConfig | null;
```

Also add the import at the top of the file:

```typescript
import type { PaginationConfig } from '@robot/browser';
```

- [ ] **Step 2: Update lookupDomainCache to return paginationConfig**

In the `lookupDomainCache` function, the existing code queries `domainIntelligence` and returns a `DomainCache` object. The `paginationConfig` field will be available automatically from the query since it's a new column — just add it to the return mapping.

Find where the function returns the result object (it constructs a `DomainCache` from the DB row). Add `paginationConfig` to the mapped object. Look for the line that constructs the return — it will look like:

```typescript
  return {
    id: result.id,
    domain: result.domain,
    // ... other fields
  };
```

Add:
```typescript
    paginationConfig: (result.paginationConfig as PaginationConfig) ?? null,
```

Do the same for any place in `lookupDomainCache` that constructs a return value (there may be a fallback path for related domains).

- [ ] **Step 3: Add savePaginationConfig function**

Add this function after the existing `saveDomainCache` function:

```typescript
/**
 * Save detected pagination config to domain intelligence.
 * Only saves for listing page types.
 */
export async function savePaginationConfig(
  domain: string,
  pageType: string,
  config: PaginationConfig,
): Promise<void> {
  const existing = await db.query.domainIntelligence.findFirst({
    where: and(
      eq(domainIntelligence.domain, domain),
      eq(domainIntelligence.pageType, pageType),
    ),
  });

  if (existing) {
    await db
      .update(domainIntelligence)
      .set({
        paginationConfig: config,
        updatedAt: new Date(),
      })
      .where(eq(domainIntelligence.id, existing.id));
  } else {
    await db.insert(domainIntelligence).values({
      domain,
      pageType,
      paginationConfig: config,
    });
  }
}
```

- [ ] **Step 4: Export savePaginationConfig from scraper package**

Add to `packages/scraper/src/index.ts`:

```typescript
export { savePaginationConfig } from './domain-cache.js';
```

Also add `type PaginationConfig` re-export if not already available through `@robot/browser`.

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/domain-cache.ts packages/scraper/src/index.ts
git commit -m "feat(scraper): save/load pagination config in domain cache"
```

---

### Task 6: The crawl() method

**Files:**
- Modify: `packages/browser/src/playwright-browser.ts`

- [ ] **Step 1: Add crawl method to PlaywrightBrowser**

In `packages/browser/src/playwright-browser.ts`, add this import at the top alongside the existing Playwright imports:

```typescript
import type { CrawlOptions, CrawlPage, PaginationConfig } from './types.js';
import { detectPaginationFromHtml } from './pagination-detector.js';
```

Then add the `crawl` method to the `PlaywrightBrowser` class, after the `evaluate` method (around line 142):

```typescript
  /**
   * Crawl paginated listing pages, yielding extracted data from each page.
   * Detects pagination mechanically from page 1 HTML unless config is provided.
   */
  async *crawl(startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
    if (!this.context) throw new Error('Browser not launched. Call launch() first.');

    const maxPages = options.maxPages ?? 5;
    const maxItems = options.maxItems ?? Infinity;
    let totalItems = 0;
    let paginationConfig = options.paginationConfig ?? null;

    const page = await this.context.newPage();

    try {
      // Page 1: navigate, extract, detect pagination
      await this.navigateWithFallback(page, startUrl);
      await this.dismissPopups(page);
      await this.expandHiddenContent(page);

      const page1Html = await page.content();
      const page1Data = await page.evaluate(options.extractionScript) as { data: Record<string, unknown>[]; totalRows: number };

      yield {
        url: startUrl,
        pageNumber: 1,
        data: page1Data.data,
        totalRows: page1Data.totalRows,
      };

      totalItems += page1Data.data.length;
      if (totalItems >= maxItems || maxPages <= 1) return;

      // Detect pagination from page 1 HTML if not provided
      if (!paginationConfig) {
        paginationConfig = detectPaginationFromHtml(page1Html, startUrl);
        if (paginationConfig) {
          console.log(`[crawl] Detected pagination: ${paginationConfig.strategy}`);
        }
      }

      // If no pagination detected mechanically, caller can try AI fallback
      // We store detectedPagination on the yielded result but don't call AI here
      // (the browser package doesn't depend on @robot/agent)
      if (!paginationConfig) {
        console.log('[crawl] No pagination detected — single page listing');
        return;
      }

      // Pages 2+
      for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
        if (totalItems >= maxItems) break;

        const navigated = await this.navigateToPage(page, paginationConfig, pageNum, startUrl);
        if (!navigated) {
          console.log(`[crawl] No more pages after page ${pageNum - 1}`);
          break;
        }

        // Wait for content to settle
        await page.waitForTimeout(1000);

        const pageData = await page.evaluate(options.extractionScript) as { data: Record<string, unknown>[]; totalRows: number };

        // Stop if no new items
        if (pageData.data.length === 0) {
          console.log(`[crawl] Page ${pageNum} returned 0 items — stopping`);
          break;
        }

        yield {
          url: page.url(),
          pageNumber: pageNum,
          data: pageData.data,
          totalRows: pageData.totalRows,
        };

        totalItems += pageData.data.length;
        console.log(`[crawl] Page ${pageNum}: ${pageData.data.length} items (${totalItems} total)`);
      }
    } finally {
      await page.close();
    }
  }

  /**
   * Navigate to a specific page number using the detected pagination strategy.
   * Returns false if navigation failed (no more pages).
   */
  private async navigateToPage(
    page: import('playwright').Page,
    config: PaginationConfig,
    pageNum: number,
    startUrl: string,
  ): Promise<boolean> {
    try {
      switch (config.strategy) {
        case 'url-pattern': {
          if (!config.urlTemplate) return false;
          const targetUrl = config.urlTemplate.replace('{N}', String(pageNum));
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return true;
        }

        case 'next-button': {
          if (!config.nextSelector) return false;
          const nextEl = page.locator(config.nextSelector).first();
          if (!await nextEl.isVisible({ timeout: 3000 })) return false;
          await nextEl.click({ timeout: 5000 });
          // Wait for navigation or content change
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          return true;
        }

        case 'page-numbers': {
          if (!config.pageSelector) return false;
          // Find the link with text matching the page number
          const pageLink = page.locator(`${config.pageSelector}`).filter({ hasText: String(pageNum) }).first();
          if (!await pageLink.isVisible({ timeout: 3000 })) return false;
          await pageLink.click({ timeout: 5000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          return true;
        }

        default:
          return false;
      }
    } catch (err) {
      console.error(`[crawl] Navigation to page ${pageNum} failed:`, err);
      return false;
    }
  }
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/browser && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/browser/src/playwright-browser.ts
git commit -m "feat(browser): add crawl() async generator for paginated listings"
```

---

### Task 7: Integration test script

**Files:**
- Create: `packages/scraper/src/test-crawl.ts`

- [ ] **Step 1: Create a CLI test script for crawling**

Create `packages/scraper/src/test-crawl.ts`:

```typescript
import { PlaywrightBrowser } from '@robot/browser';
import { SchemaAgent } from '@robot/agent';
import { buildExtractionScript } from './executor.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: tsx src/test-crawl.ts <URL> [maxPages]');
  process.exit(1);
}

const maxPages = parseInt(process.argv[3] ?? '3', 10);

console.log(`\n--- Crawl Test ---`);
console.log(`URL: ${url}`);
console.log(`Max pages: ${maxPages}\n`);

const browser = new PlaywrightBrowser();
await browser.launch({ headless: !process.env.HEADFUL });

try {
  // Step 1: Capture and discover schema
  const capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
  const agent = new SchemaAgent();
  const schema = await agent.discoverSchema(capture);

  console.log(`Page type: ${schema.page_type}`);
  console.log(`Fields: ${schema.fields.map(f => f.name).join(', ')}\n`);

  if (!['listing', 'search_results', 'table'].includes(schema.page_type)) {
    console.log('Not a listing page — skipping crawl');
    process.exit(0);
  }

  // Step 2: Generate selectors
  const plan = await agent.generateSelectors(capture, schema.fields, schema.page_type);
  plan.page_type = schema.page_type;
  const script = buildExtractionScript(plan);

  // Step 3: Crawl
  let totalItems = 0;
  for await (const page of browser.crawl(url, { extractionScript: script, maxPages })) {
    console.log(`Page ${page.pageNumber} (${page.url}):`);
    console.log(`  ${page.data.length} items extracted`);
    if (page.data[0]) {
      console.log(`  First item: ${JSON.stringify(page.data[0]).slice(0, 200)}`);
    }
    totalItems += page.data.length;
  }

  console.log(`\n--- Total: ${totalItems} items across all pages ---`);
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Test with a paginated site**

Run: `pnpm --filter @robot/scraper exec tsx src/test-crawl.ts "https://books.toscrape.com/catalogue/page-1.html" 3`
Expected: Should extract books from 3 pages of the catalogue

- [ ] **Step 3: Commit**

```bash
git add packages/scraper/src/test-crawl.ts
git commit -m "feat(scraper): add crawl test script"
```
