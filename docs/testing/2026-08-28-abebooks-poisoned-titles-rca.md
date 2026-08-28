# C2 RCA — Garbled title/author on abebooks sample detail rows

Probe run `f89905b1-da26-4203-a...-4b7663a6042a` (source abebooks-com-353m8e, listing kn=python).
Symptom: of 3 sample detail rows, row1 has title="book magazine collector 129 dec",
author="crispin jackson charles dickens novels"; rows 2-3 have no title/author keys at all.
Deterministic across two independent probe runs on different code.

## Evidence

### The three sample rows (SQL: run_items + extractions)

| run_item | URL | extraction | title/author |
|---|---|---|---|
| c5d7d764 | `/magazines-periodicals/Book-Magazine-Collector-129-Dec-1994/32250286895/bd` | cefe793b | garbled values |
| abc6870e | `/Monty-Python-Radio-Times-Official-Guide/31259578351/bd` | ffe8ec4e | keys absent |
| d6c9f182 | `/Best-Monty-Python-essential-gags-sketches/2278025554/bd` | 2c8b427f | keys absent |

Extraction cefe793b (magazine row) also contains, verbatim:

```
"url":   "ds=5&sortby=17&an=crispin%20jackson%20charles%20dickens%20novels&tn=book%20magazine%20collector%20129%20dec&bi=s&cond=...&attrs=used%20sc"
"title": "book magazine collector 129 dec"
"author": "crispin jackson charles dickens novels"
```

The "garbled" title and author are exactly the `tn=` and `an=` query parameters of the `url`
value — normalized search keys, not page text. Extractions ffe8ec4e/2c8b427f have the same
`url` shape but with `isbn=9780992936464` / `isbn=9780413776150` in place of `an`/`tn` —
and correspondingly no title/author keys.

### H1 — wrong sample URLs: REJECTED (with a true half)

The row1 URL genuinely is a magazine listing ("Book and Magazine Collector No 129 Dec 1994" —
it appears in kn=python results because the issue covers a Monty Python article). But it is a
legitimate organic search result, not an ad/junk row, and the sampler picked it fairly. More
decisively: the extracted values are NOT the magazine page's real values. Live Playwright
fetch of the URL (free, 2026-08-28):

- real `h1`: "Book and Magazine Collector : No 129 Dec 1994 / Charles Dickens' novels, Monty Python, Elisabeth Beresford and 'The Wombles', ..."
- real author line: "Crispin Jackson (Editor) / Charles Dickens' novels, Monty Python, ..."

So even on the "junk" row, faithful extraction would have produced a long, correctly cased
title. The garbling is ours, not the page's. And rows 2-3 are ordinary book pages whose
real titles ("The Very Best of Monty Python: ...") extraction missed entirely. H1 does not
explain the defect.

### H2 — poisoned detail cache: CONFIRMED (as the amplifier; minting is mechanical)

`domain_intelligence` (www.abebooks.com, detail; 23 runs) cached field paths:

```
title:  path "bibliographicDetail.title",  source "api", hits 2, misses 0
author: path "bibliographicDetail.author", source "api", hits 2, misses 0
url:    path "refinementList[0].url",      source "api", hits 6, misses 0
```

Recorded API endpoint: `https://www.abebooks.com/servlet/DWRestService/pricingservice` (POST).
Live capture of both sample URLs shows what that service actually returns:

- Magazine page (no ISBN): `bibliographicDetail: {"author":"crispin jackson charles dickens novels","title":"book magazine collector 129 dec"}` — byte-for-byte the extracted garbage. `refinementList[0].url` = the `an=/tn=` query string.
- ISBN book page: `bibliographicDetail: null`; `refinementList[0].url` = the `isbn=` query string.

`bibliographicDetail` is abebooks' echo of the normalized search keys the pricing widget uses
to find other copies of the same work (lowercased, stop-words dropped, truncated). It is
request metadata, not display data. On ISBN books it is null, so the cached path misses and —
because the pages have **zero JSON-LD and no og:title** (verified live: ldJsonCount 0,
ogTitle null) and the cache holds **no xpath path for title/author** — nothing else can
supply the field. Keys absent. On non-ISBN items the echo resolves and wins. Fully
deterministic, matching both probe runs.

Two aggravators:

1. **Minting**: the mechanical tier would mint this even with a cold cache.
   `packages/scraper/src/structured-extractor.ts` — `extractFromStructuredData` puts the
   flattened intercepted-API pool FIRST (lines 58-62), and `findFieldValue` (lines 146-189)
   matches alias/field-name suffixes: alias suffix `.title` hits `bibliographicDetail.title`,
   field suffix `.author` hits `bibliographicDetail.author` (shallowest match, depth 2).
   The orchestrator then saves those paths to the cache
   (`packages/scraper/src/extraction-orchestrator.ts:880-895` → `saveDomainCache`), and
   subsequent runs replay them via `resolveApiPathsFromCache`
   (`packages/scraper/src/domain-cache.ts:723`, called at `extraction-orchestrator.ts:424`).
2. **Masking**: because the poisoned api path "resolves" title/author on non-ISBN pages,
   step 6 (AI XPath generation, which only runs for still-missing fields) never generated a
   DOM selector for title/author — note `publisher` DID earn an xpath path
   (`.//dl[@class='listing-metadata']/dt[text()='Publisher']/following-sibling::dd[1]`),
   title/author never did. The bad path blocks learning the good one.
3. **Prune can never fire**: `mergeFieldPaths` (`packages/scraper/src/domain-cache.ts:1036-1064`)
   only iterates fields present in this run's `fieldResults`; a cached path that silently
   fails to resolve leaves no entry, so `misses` never increments (observed: misses 0 after
   failing on 2 of 3 pages). The conservative prune (>=5 uses & <=10% hit rate) is therefore
   unreachable for exactly this class of poison.

Same family as `price_currency` = 2.03 (cached `pricingInfoForBestUsed.bestPriceInPurchaseCurrencyWithCurrencySymbol`
= "US$ 2.03", numerically coerced) — another pricingservice-derived path.

### H3 — listing-row provenance mixup: REJECTED

The strings do not come from the SearchResults listing row (which shows the full cased title
"Book and Magazine Collector : No 129 Dec 1994 / Charles Dickens' novels, ..."). They come
from the detail page's own intercepted pricingservice response, proven byte-identical above.
`listing_values` carry-over is not involved.

## ROOT CAUSE

The extraction chain treats the abebooks `DWRestService/pricingservice` response's
`bibliographicDetail` — a normalized search-key echo (lowercased/truncated request metadata) —
as page data. Minted by the mechanical tier's suffix matching over flattened intercepted API
JSON (`packages/scraper/src/structured-extractor.ts:146-189`, API pool prioritized at :58-62),
persisted to `domain_intelligence` (`extraction-orchestrator.ts:880-895`), replayed by the
cached-API tier (`domain-cache.ts:723`). On ISBN books `bibliographicDetail` is null and the
pages have no JSON-LD/og:title and no cached xpath (the poisoned path masked AI XPath
generation for those fields), so title/author vanish entirely. Secondary defect: replay
misses are never recorded (`domain-cache.ts:1036-1064`), so the prune safeguard can never
retire the path.

**Scope: pre-existing product debt.** Nothing in feat/mvp-simplification touches this code
path; the defect reproduced identically on pre-branch code (run 7a88bb2a) and is reproducible
with a cold cache by the mechanical tier alone.

## Minimal fix direction

Corroborate api-sourced values for display-text fields against the captured page before
assigning/caching: reject an intercepted-API candidate whose value does not appear
(normalized) in the page's visible text/H1 — "book magazine collector 129 dec" appears
nowhere in the page, the real title does. Apply the same gate in `resolveApiPathsFromCache`
so already-poisoned caches self-heal. Complementary (small): record a miss when a cached
path fails to resolve for a requested field, so the existing prune can eventually fire; that
also unmasks step 6 so title/author can earn proper XPath paths.

## If unfixed, at the confirm gate

For abebooks the user sees 3 sample rows where price/seller/condition look right but the
title/author column shows lowercase truncated word-soup on some rows and is blank on most
book rows — the two fields customers care about first. The extractor looks broken and the
user rejects the source, even though a correct H1/author-line selector exists on every page.

## Verification artifacts

- Live-capture script: scratchpad `c2-verify.mts` (plain Playwright, no AI). Output captured
  in this investigation's transcript; key values reproduced above.
