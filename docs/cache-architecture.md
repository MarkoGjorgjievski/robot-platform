# Domain Intelligence Cache — Architecture

## Overview

The domain intelligence cache stores extraction knowledge per website. Each successful extraction enriches the cache with multiple ranked paths per field. Subsequent extractions try cached paths first ($0.00) before falling back to AI ($0.12).

## Cache Lookup Flow

```
User enters URL
     │
     ▼
Extract domain (strip www)
     │
     ▼
┌─────────────────────────────────┐
│  STEP 1: Exact domain match     │
│  domain = "amazon.co.uk"        │
│  pageType = "detail"            │
│                                  │
│  Found? ─── YES → USE IT ($0)   │
│         │                        │
│         NO                       │
│         │                        │
│  STEP 2: Brand match            │
│  Extract brand: "amazon"         │
│  Search: domain LIKE "%amazon%"  │
│  Same pageType                   │
│                                  │
│  Found? ─── YES → TRY PATHS     │
│         │   (may work, same HTML)│
│         │                        │
│         NO                       │
│         │                        │
│  STEP 3: Full AI chain ($0.12)  │
│  Save results as new cache entry│
└─────────────────────────────────┘
```

## What's Stored

Each `domain + pageType` gets one cache entry:

```
domain_intelligence {
  domain: "amazon.com"
  pageType: "detail"

  fieldPaths: {
    "price": {
      paths: [
        { path: "data.product.price",              source: "human",  confidence: 1.0,  hits: 5,  misses: 0 }
        { path: "data.offers[0].price.current",     source: "api-ai", confidence: 0.95, hits: 47, misses: 2 }
        { path: "//span[@data-test='product-price']", source: "xpath", confidence: 0.82, hits: 40, misses: 7 }
        { path: "product:price:amount",             source: "meta",   confidence: 0.70, hits: 49, misses: 0 }
      ],
      conflictCount: 1
    }
  }

  apiEndpoints: [{ url: "api.amazon.com/...", method: "GET" }]
  totalRuns: 50
  successfulRuns: 48
  consecutiveFailures: 0
}
```

## Path Priority Order

During resolution, paths are tried in this order:

1. **human** — operator-verified, confidence 1.0, never auto-pruned
2. **api-ai** — Claude analyzed raw API JSON, found the dot-notation path
3. **api** — mechanical flattening matched field name to JSON key
4. **json-ld** — Schema.org structured data
5. **meta** — Open Graph / product meta tags
6. **xpath** — Claude-generated DOM selector
7. **xpath-cached** — replayed from previous run

Within each source type, sorted by hit rate (hits / total uses).

## Path Lifecycle

```
New path added (first extraction):
  confidence: 0.7-1.0 (depending on source)
  hits: 1, misses: 0

Successful use:
  hits++
  confidence += 0.02 (capped at 1.0)

Failed use:
  misses++
  confidence -= 0.05 (floored at 0.0)

Auto-pruned when:
  total uses > 10 AND hit rate < 10%
  (human paths exempt — never auto-pruned)

Max 5 paths per field (lowest hit rate pruned when exceeded)
```

## Cross-Validation

When multiple paths return values for the same field:

- **All agree** → highest confidence, use any
- **Majority agree** → use majority value, flag outlier path
- **Disagree** → use path with best historical hit rate, increment conflictCount

Numeric values use 5% tolerance (e.g. $42.49 ≈ $42.50).

## Scenario: Same Domain, Cached Run

```
1st run: amazon.com/dp/B09V3KXJPB → full AI chain → $0.12 → cache saved
2nd run: amazon.com/dp/B07XJ8C8F5 (different product)
  → Cache hit
  → Cached API paths resolve: price, brand, description
  → Cached XPaths resolve: title, rating, images
  → Cross-validate: all agree
  → 15/16 fields, $0.00, ~5 seconds
```

## Scenario: Different TLD

```
Cache: amazon.com/detail (50 runs, 96% success)
New:   amazon.co.uk/dp/B09V3KXJPB

  → Exact match "amazon.co.uk" → NOT FOUND
  → Brand match "amazon" → FOUND: amazon.com
  → Try amazon.com paths on .co.uk page
  → Most work (same HTML template, same API shape)
  → Save as NEW entry: amazon.co.uk/detail
  → 14/16 fields, $0.00
```

## Scenario: Different Subdomain (Different App)

```
Cache: www.morrisons.com/detail
New:   groceries.morrisons.com/products/milk

  → Exact match → NOT FOUND
  → Brand match "morrisons" → FOUND: www.morrisons.com
  → Try paths → ALL FAIL (completely different app)
  → Fall through to full AI chain → $0.12
  → Save as SEPARATE entry: groceries.morrisons.com/detail
  → Both coexist independently
```

## Scenario: Human Override Propagation

```
Customer A: target.com, price extracted wrong
  → Operator fixes via click-to-select
  → Saved: source="human", confidence=1.0, path="//span[@data-test='price-value']"
  → Inserted at TOP of paths list

Customer B: target.com (different product)
  → Cache hit → human path tried FIRST → correct ✓

Customer C: target.co.uk
  → Brand match → human path from .com tried → works on .co.uk too ✓
```

## Cache Degradation + Escalation

Cache degradation is detected but NEVER auto-reset. Human review required.

```
Run 48: 15/16 fields ✓  consecutiveFailures: 0
Run 49: 3/16 fields  ✗  consecutiveFailures: 1
Run 50: 2/16 fields  ✗  consecutiveFailures: 2
Run 51: 4/16 fields  ✗  consecutiveFailures: 3
...
Run 53: 2/16 fields  ✗  consecutiveFailures: 5 ← FLAGGED

Action: Cache entry flagged as "degraded" (amber) or "broken" (red)
  → Visible on Domain Library dashboard
  → Operator reviews and decides:
     a) Reset cache → fresh AI rebuild ($0.12)
     b) Manual fix → update specific broken selectors
     c) Investigate → site may be blocking, need proxy/stealth
  → Auto-reset is DISABLED — too risky to wipe 50 runs of learned data
```

## Cost Model

| Scenario | AI Calls | Cost | Speed |
|----------|----------|------|-------|
| First run (no cache) | Schema + API analysis + XPath | ~$0.12 | 30-90s |
| Cached run (same domain) | 0 | $0.00 | 5-20s |
| Cached run (TLD variant) | 0 (if paths work) | $0.00 | 5-20s |
| Partial cache miss | API analysis only | ~$0.03 | 15-40s |
| Full cache miss | Full chain | ~$0.12 | 30-90s |
| 1,000 pages (same domain) | 1 (first only) | ~$0.12 total | Minutes |
