# Extraction Architecture

## Overview

The AI scraper extracts data from web pages using a multi-source, multi-pass approach. Every field is resolved by trying multiple extraction strategies in priority order, cross-validating results, and caching successful paths for future runs.

## Extraction Chain

Each extraction runs through these steps in order. Later steps only run for fields not yet resolved.

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 0: Domain Cache Lookup                         FREE   │
│  Check if we've scraped this domain+pageType before.        │
│  If yes and success rate ≥70%, use cached paths first.      │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Page Capture                               ~5-20s  │
│  Playwright navigates to URL. During load:                   │
│  • Intercept all XHR/fetch JSON responses                    │
│  • Dismiss popups/consent banners (3 rounds)                 │
│  • Extract JSON-LD, __NEXT_DATA__, meta tags                 │
│  • Take full-page screenshot                                 │
│  • Convert HTML → clean Markdown                             │
│                                                              │
│  Navigation fallback:                                        │
│  networkidle (ideal) → domcontentloaded + 3s wait (heavy)    │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Mechanical Extraction                       FREE   │
│  Try to resolve fields without AI:                           │
│                                                              │
│  a) API response flattening (8 levels deep)                  │
│     Flatten intercepted JSON → match field names + aliases   │
│                                                              │
│  b) JSON-LD (Schema.org structured data)                     │
│     Flatten ld+json blocks → match field names + aliases     │
│                                                              │
│  c) Meta tags (og:title, product:price:amount, etc.)         │
│     Direct key matching                                      │
│                                                              │
│  Priority: API > JSON-LD > Meta                              │
│  Only primitive values stored (strings, numbers, booleans)   │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2.5: Cache Path Resolution                     FREE   │
│  If cache exists, try all stored paths for missing fields.   │
│  Paths ranked by historical hit rate.                        │
│  Cross-validate: if multiple paths agree → high confidence.  │
└──────────────────────┬──────────────────────────────────────┘
                       ▼ (only if fields still missing)
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: AI API Analysis                            ~$0.03  │
│  Send top-ranked intercepted API response to Claude.         │
│  Claude reads the raw JSON (up to 30KB) and:                 │
│  • Finds values for each missing field                       │
│  • Returns JSON dot-notation path (e.g. data.product.price)  │
│  • Rates confidence per field                                │
│                                                              │
│  Handles deeply nested structures that mechanical can't      │
│  parse (e.g. Target's layout.zones[2].modules[0]...)        │
└──────────────────────┬──────────────────────────────────────┘
                       ▼ (only if fields still missing)
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: XPath DOM Extraction                       ~$0.05  │
│  Claude generates XPath expressions for remaining fields.    │
│  Executed on the live Playwright page via page.evaluate().   │
│                                                              │
│  Listing pages: row_xpath matches each item, field XPaths    │
│  are relative (./span[@class='price'])                       │
│                                                              │
│  Detail pages: field XPaths are absolute from document root  │
│  (//span[@data-test='product-price'])                        │
│                                                              │
│  XPath chosen over CSS because it supports:                  │
│  • Sibling traversal (following-sibling::tr)                 │
│  • Ancestor access (ancestor::div[@class='card'])            │
│  • Text matching (contains(text(), 'Next'))                  │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Save to Domain Intelligence Cache                   │
│  Store what we learned for future runs:                       │
│  • API endpoints discovered (URL patterns)                   │
│  • Multiple paths per field with hit/miss stats              │
│  • XPath selectors that worked                               │
│  • JSON-LD / meta tag availability                           │
│                                                              │
│  Cache is enriched, never overwritten.                       │
│  Dead paths auto-pruned. 5 consecutive failures → reset.     │
└─────────────────────────────────────────────────────────────┘
```

## Domain Intelligence Cache

### Data Model

Each domain + page type combination gets a cache entry:

```
domain_intelligence {
  domain: "target.com"
  pageType: "detail"
  fieldPaths: {
    "price": {
      paths: [
        { path: "data.product.price.current", source: "api-ai", hits: 47, misses: 2, confidence: 0.95 },
        { path: "//span[@data-test='price']", source: "xpath",  hits: 40, misses: 7, confidence: 0.82 },
        { path: "product:price:amount",       source: "meta",   hits: 49, misses: 0, confidence: 0.70 }
      ],
      conflictCount: 1
    },
    "product_name": {
      paths: [
        { path: "data.product.title", source: "api-ai", hits: 49, misses: 0, confidence: 0.98 },
        { path: "og:title",           source: "meta",   hits: 49, misses: 0, confidence: 0.85 }
      ],
      conflictCount: 0
    }
  }
  totalRuns: 50
  successfulRuns: 48
  consecutiveFailures: 0
}
```

### Cache Behavior

| Scenario | Action |
|----------|--------|
| Cache hit + good result | Use cached data. Increment `hits` on used paths. |
| Cache hit + bad result (fluke) | Fall through to full AI chain for THIS page. Increment `misses`. Cache stays intact. |
| Cache hit + 5 consecutive bad results | Site structure likely changed. Reset cache, rebuild from scratch. |
| Dead path (>10 uses, <10% hit rate) | Auto-pruned from the paths list. |
| Max paths per field | 5. Ranked by hit rate, lowest pruned. |

### Cross-Validation

When multiple paths return values for the same field:
- **All agree** → highest confidence
- **Majority agree** → use majority value, flag outlier
- **Disagree** → use path with best historical hit rate, increment `conflictCount`

Numeric values use 5% tolerance for matching (e.g. $42.49 ≈ $42.50).

### Cost Model

| Run | AI Calls | Cost | Speed |
|-----|----------|------|-------|
| First run (no cache) | Schema discovery + API analysis + XPath | ~$0.12 | 30-90s |
| Second run (cache hit) | 0 | ~$0.00 | 5-20s |
| Cache miss (fluke page) | API analysis + maybe XPath | ~$0.08 | 20-60s |
| Cache reset (structure change) | Full chain | ~$0.12 | 30-90s |

## Page Types

### Listing Pages
- Multiple repeating items (search results, category pages)
- `row_xpath` matches each item container
- Field XPaths are relative to row: `.//span[@class='price']`
- Example: Hacker News front page → 30 stories

### Detail Pages
- Single item (product page, article)
- `row_xpath` matches the page container or returns 0-1 results
- Field XPaths are absolute: `//span[@data-test='product-price']`
- Example: Target product page → 1 product with 15+ fields

## Structured Data Sources

### JSON-LD (Schema.org)
- Found in `<script type="application/ld+json">`
- Standardized schema — most reliable when available
- Common on e-commerce (Product), news (Article), recipes (Recipe)
- Not all sites use it (Target doesn't)

### __NEXT_DATA__
- Next.js server-side props in `<script id="__NEXT_DATA__">`
- Contains full page data but deeply nested and noisy
- Currently excluded from mechanical extraction (too unreliable)
- AI API analysis handles these cases instead

### Meta Tags
- `og:title`, `og:image`, `og:description` — Open Graph
- `product:price:amount`, `product:price:currency` — Product
- Always available, low detail, good for validation

### Intercepted API Responses
- XHR/fetch JSON responses captured during page load
- Ranked by relevance (URL patterns + body content signals)
- Filtered: skip analytics, tracking, tiny responses, huge responses
- Top response sent to Claude for intelligent field extraction

## Popup Dismissal

Before capturing, the browser attempts to dismiss common overlays:

1. **Click-based** — Try known button selectors (cookie consent, health consent, newsletter modals)
2. **JS removal** — Remove overlay/modal DOM elements and fixed-position high-z-index divs
3. **Scroll unlock** — Reset `overflow: hidden` on body

3 rounds of dismissal, 1.5s initial wait for popups to appear.

## Provider Support

The AI agent supports two LLM providers:

| Provider | Best For | Cost |
|----------|----------|------|
| Anthropic (Claude Sonnet) | Production use — best structured output | ~$3/M input, $15/M output |
| Ollama (local) | Development/testing — free, no API key | Free (runs on your hardware) |

Auto-detected: if `ANTHROPIC_API_KEY` is set, uses Claude. Otherwise falls back to Ollama.

Anthropic provider includes retry with exponential backoff for transient errors (429, 529, 503).

## Package Architecture

```
@robot/browser    — Playwright wrapper, page capture, popup dismissal,
                    network interception, structured data extraction
@robot/agent      — LLM orchestration (schema discovery, selector generation,
                    API analysis, validation), provider abstraction
@robot/scraper    — Pipeline orchestration, XPath executor, structured data
                    extractor, domain intelligence cache
@robot/dashboard2 — Next.js UI, API routes, wizard flow
@robot/db         — PostgreSQL schema (Drizzle ORM)
@robot/api        — tRPC routers
```
