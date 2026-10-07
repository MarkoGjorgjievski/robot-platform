# Extraction Architecture

## Overview

The AI scraper extracts data from web pages using a multi-source, multi-pass approach. Every field is resolved by trying multiple extraction strategies in priority order, cross-validating results, and caching successful paths for future runs.

## Extraction Chain

Each extraction runs through these steps in order. Later steps only run for fields not yet resolved.

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 0: Domain Cache Lookup                         FREE   │
│  Check if we've scraped this domain+pageType before.        │
│  If yes, cached paths are always consulted (no gate).       │
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
│  STEP 2.5a: Cached API Path Resolution               FREE   │
│  If cache exists, replay stored dot-notation JSON paths      │
│  against fresh intercepted API responses.                    │
│  e.g. "data.product.price.current" → $42.49                 │
│  Uses getByDotPath() — no AI needed, just path traversal.   │
├─────────────────────────────────────────────────────────────┤
│  STEP 2.5b: Cached XPath Execution                   FREE   │
│  Execute stored XPath expressions on the live page via       │
│  page.evaluate(). No AI needed — just replay known selectors.│
│  e.g. "//span[@data-test='price']" → $42.49                 │
├─────────────────────────────────────────────────────────────┤
│  STEP 2.5c: Cross-Validation                         FREE   │
│  Compare values from all paths (API, XPath, meta, JSON-LD). │
│  All agree → highest confidence. Majority wins on conflict.  │
│  Paths ranked by historical hit rate.                        │
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
│  Multimodal + reverse-search: Claude receives the page       │
│  screenshot AND HTML, and the prompt targets a specific      │
│  value ("find an XPath that yields this exact text").        │
│  Returns, per field, both an xpath and the value the AI      │
│  saw on the page.                                            │
│                                                              │
│  If the generated xpath returns nothing, the AI-seen value   │
│  is delivered with source 'ai-vision' and an empty path      │
│  (used for this run, NOT cached as a reusable selector).     │
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
│  Cache is an accumulator — enriched, never overwritten.      │
│  Dead paths auto-pruned (≥5 uses & ≤10% hit rate; max 5     │
│  paths/field). No auto-reset; human review required.         │
└─────────────────────────────────────────────────────────────┘
```

## Verification-first sources

Added 2026-09 (`docs/superpowers/specs/2026-09-04-customer-schema-verification-design.md`
§4–§5). A Source whose customer filled the schema grid — one row per field, an expected value
typed on each of three product URLs — skips the chain above entirely, through a module beside
it, not inside it: `packages/scraper/src/verify/`.

**Verify (once, at setup time):** capture the three URLs the same way the chain does →
normalize both sides per field type (`$129.99` vs `129.99`) → mechanically search every
capture's JSON bodies, JSON-LD, meta, and DOM for a node matching the expected value (a DOM
match whose XPath contains the literal value is rejected) → **certify a candidate only if it
produces the expected value on all three captures**, no two-of-three tolerance, ranked by
source authority then path length, top primary plus up to four fallbacks → any field still
uncertified gets exactly one AI `propose_path` call, whose proposal must certify the same way
or is discarded → each cell paints green (certified) or red (a fixed reason with a
customer-facing hint). Extract stays disabled until every cell is green.

**Extraction at scale:** on a full pass, certified paths are written into
`domain_intelligence.field_paths` under the field's **concept** (not the customer's name/key)
as `PathSource: 'verified'` — above every source but a human pin, never auto-pruned; the next
customer verifying the same concept on that domain gets them tried first. Runs then go through
`runVerifiedExtraction`, not the chain above: only that Source's certified paths, first
type-valid hit wins, no mechanical/cache/AI fallback. A miss leaves the cell empty and is
recorded per path (same hit/miss ledger the 2026-09-02 cache-reputation fix made real) — empty
means "no proven path found it," never a guess. A field whose run miss-rate crosses
`DRIFT_MISS_SHARE` (0.2) flags `drifted` — but only on a run of at least `DRIFT_MIN_ROWS` (5)
rows, since a two-row run is too small a sample to accuse a certified path of anything. The fix
is a free re-verify if the pages haven't changed.

Legacy Sources (no schema definition) keep running the full chain above unchanged.
`sources.confirm`'s certification gate enforces "verify before extracting"; a listing URL on a
verified Source still goes through the existing probe-confirm gate once the grid is green.

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
}
```

### Cache Behavior

| Scenario | Action |
|----------|--------|
| Cache hit + good result | Use cached data. Increment `hits` on used paths. |
| Cache hit + bad result (fluke) | Fall through to full AI chain for THIS page. Increment `misses`. Cache stays intact. |
| Cache always consulted | No consecutive-failures gate; the cache is checked on every run. |
| Dead path (≥5 uses & ≤10% hit rate) | Auto-pruned from the paths list. |
| Max paths per field | 5. Ranked by recency-weighted hit rate, lowest pruned. |

### Cross-Validation

There is no separate serving-time cross-validation pass. Validation lives inside the tiers themselves:

- **`resolveApiPathsFromCache()`** — when several stored API paths resolve values for the same field, agreement among them sets the confidence (majority share) and the top-ranked path's value serves.
- **`tryAssign()`** (orchestrator) — every candidate value, from any tier, must pass shape validation and corroboration against the rendered page text before it is accepted. First accepted value wins.
- **`saveDomainCache()`** — at save time, disagreeing `lastValue`s across a field's paths (same page only) increment `conflictCount` and are reported for human review, never auto-resolved.

Numeric values use 5% tolerance for matching (e.g. $42.49 ≈ $42.50); structured values compare structurally (sorted-key JSON).

### Cache Resolution Functions

| Function | What it does | When it runs |
|----------|-------------|--------------|
| `resolveApiPathsFromCache()` | Traverses fresh API JSON using stored dot-notation paths (e.g. `data.product.price.current`) | Step 2.5a — after mechanical, before AI |
| `buildCachedXPathScript()` | Generates a Playwright `page.evaluate()` script from stored XPaths, runs on live page | Step 2.5b — after API cache, before AI |
| `resolveFromCache()` | Ranks a field's stored paths (pin > human > evidence) and picks the best value from already-gathered data | Analyze wizard only — live-example replay. The crawl orchestrator's former "final cache pass" call was removed: keyed by field name against already-assigned data, it could never assign anything new |
| `saveDomainCache()` | Merges new paths into existing cache, updates hit/miss stats, prunes dead paths | Step 5 — after extraction complete |

### OR-Logic Path Resolution

Each field can have up to 5 paths from different sources. Resolution follows OR-logic:

```
price = data.product.price.current     (api-ai, 95% hit rate)
     || data.offers[0].price           (api-ai, 85% hit rate)
     || //span[@data-test='price']     (xpath, 92% hit rate)
     || product:price:amount           (meta, 99% hit rate)
```

First path that returns a non-null value wins. If multiple return values, cross-validate.

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
- Scoped to the entity subtree via `findEntitySubtree()`, then handed to AI API analysis as a synthetic source with URL `inline://nextdata[.path...]`
- Mechanical extraction still skips the raw blob — key-name suffix matching on the unscoped tree picks up false positives (e.g. 30+ keys named `title`). Path-aware AI extraction is the right tool for these sources; the cache then makes subsequent runs free

### Why structured-data blobs are first-class sources
SSR-hydration blobs (`__NEXT_DATA__`, Apollo cache, `__NUXT__`, Remix data routes, large JSON-LD) often hold the cleanest version of product data on the page. The pipeline treats them as just another API response:
1. **Entity-subtree identification** — `findEntitySubtree` scores objects by counting DISTINCT schema tokens matched as case-insensitive substrings of their direct keys (e.g. a key `productTitle` matches both "product" and "title" tokens), with a tiebreak preference for nodes reached via a key containing "selected". This scopes real Next.js `__NEXT_DATA__` (e.g. Nike) to the product node instead of falling through to the full blob. Drops the noise floor by ~100× on large nextData blobs.
2. **Path-aware AI extraction** — the scoped subtree is sent to `extractFromApi`. AI returns dot-paths; the cache replays them on every future run for free.
3. **Source priority** — `collectAiAnalysisSources` always retains `inline://` structured-data sources first and applies the 5-source size cap only to intercepted requests. A correctly scoped `nextData` source is never evicted by large junk intercepted requests.
4. **Shape validation post-filter** — `validateFieldShape` rejects values whose shape doesn't match the requested type at the resolution boundary (e.g. a `description` field that resolves to "Customer reviews" is rejected, so the next step in the chain still gets a chance).

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
| Anthropic (`claude-sonnet-5`) | Production use — best structured output | $3/M input, $15/M output (intro $2/$10 through 2026-08-31) |
| Ollama (local) | Development/testing — free, no API key | Free (runs on your hardware) |

Auto-detected: if `ANTHROPIC_API_KEY` is set, uses Claude. Otherwise falls back to Ollama.

Model IDs are centralised in `packages/agent/src/models.ts` (`EXTRACTION_MODEL`, `JUDGE_MODEL`,
`OLLAMA_MODEL`), each overridable by env var. They were previously hardcoded at each call
site, which is how the retirement of `claude-sonnet-4-20250514` took the whole agent layer
down at once in Aug 2026 with nothing in the test suite able to see it.

Anthropic provider includes retry with exponential backoff for transient errors (429, 529, 503).

## Package Architecture

```
@robot/browser    — Playwright wrapper, page capture, popup dismissal,
                    network interception, structured data extraction
@robot/agent      — LLM orchestration (schema discovery, selector generation,
                    API analysis, validation), provider abstraction
@robot/scraper    — Pipeline orchestration, XPath executor, structured data
                    extractor, domain intelligence cache
@robot/app        — TanStack Start + Router/Query (SSR) customer app; :3000
@robot/db         — PostgreSQL schema (Drizzle ORM)
@robot/api        — tRPC routers
```

(`@robot/dashboard`, the Vite + TanStack Router/Query SPA that itself
replaced the original Next.js dashboard in v1.5, was deleted at cut-over
(2026-10, plan 6) once `@robot/app` reached parity with it.)
