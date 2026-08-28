# RCA: probe run f5b72f3a found 0 items on a listing that serves 30

Investigated 2026-08-27, branch `feat/mvp-simplification` @ aacf4c2. Read-only: no fixes, no commits, no AI-spending calls (the one live reproduction ran with `agent: null` and `saveCache` stubbed).

## The defect

Probe run `f5b72f3a-dfaa-408e-8286-0d61ec437bc4` (source `abebooks-com-353m8e`, listing mode, `https://www.abebooks.com/servlet/SearchResults?kn=python`) planned **1 listing item, 0 detail items**, finalised as `planned`, with **completely empty `runs.logs`** — no warning, no error. Every previous walk of the same URL found 30 items.

## Timeline (from `runs`, `run_items`, `domain_intelligence`)

| When (UTC) | What | Evidence |
|---|---|---|
| 10:27, 10:44 | Two `sources.analyze` listing extractions, both successful | `(www.abebooks.com, listing)` fieldPaths: `title` path hits=2 lastUsedAt 10:44; `detail_url` xpath variants #1 (10:27) and #2 (10:44), hits=1 each |
| 10:45:37 | Probe `7a88bb2a` (commit 9ac406b) plans 30 details + 1 listing, warning `budget reached: 30 items` | `runs` row; 30 `run_items` kind=detail; `detail_url` xpath variant #3 written, lastUsedAt 10:45:54 |
| 10:46:44–10:47:13 | Its execution extracts 3 details (probe sample), 27 stay `pending`, zero item errors | `run_items` statuses; `(abebooks, detail)` cache: 20 runs / 20 successes, last touch 10:47:13 |
| ~11:xx | Fix wave 9ac406b..aacf4c2 lands; api-server restarted on aacf4c2 | `git log` |
| 12:12:42 | Run `7a88bb2a` finalised `partial` (c5bab55's limit-stop finalisation) | `runs.completed_at`, `result_count=3` |
| 12:17:08–12:17:44 | **Probe `f5b72f3a`: 1 listing item, 0 details, status `planned`, `logs` NULL** | `runs`, `run_items` |
| 12:17:44.181 | Listing cache row bumped: `total_runs` 3→4, `consecutive_failures` 0→1, successful_runs stays 3. **No `detail_url` path gained a hit, no 4th path variant appeared** | `domain_intelligence.updated_at` = 12:17:44.181; all three `detail_url` paths still hits=1, lastUsedAt ≤ 10:45:54 |
| minutes later | Plain Playwright fetch: ~39 BookDetails links, no block (parent's observation) | dispatch |
| 2026-08-27 (this RCA) | Free repro via the app's own capture path: healthy page, 30 rows, cached xpath matches 30, chain-without-AI reproduces the failing signature exactly | below |

## What the failing run provably did

`planSource` (packages/api/src/crawl/plan-source.ts:106) → `planRun` (packages/scraper/src/crawl/plan-run.ts). The only control path through `planRun` that produces exactly *1 listing item + 0 details + zero warnings + zero errors + status `planned`* is:

1. Page-1 capture and extraction **succeeded** (a throw would have pushed `listing capture failed:` into `errors` → `allInputsFailed` → status `failed`; the run is `planned`).
2. The extraction resolved **nothing**: the cache row recorded a run with `confidence 0` (`consecutive_failures` 0→1, `successful_runs` unchanged), and no `detail_url` fieldPath was touched or added.
3. `absorb(listingRows, start.url, 1)` got rows with no usable `detail_url` → `enumerateDetailUrls` returned `stop: 'empty-page'` (packages/scraper/src/crawl/enumerate-detail-urls.ts:56 or :84) → **plan-run.ts:436-439 `continue`s silently**: `report(..., 'planned', 0)` and *no warning is pushed on this branch*. Every warning-producing branch (budget, thin walk, "no pagination detected", "produced no new items") sits *after* this early exit.

## Why the extraction resolved nothing: `detail_url` has exactly one producer — a fresh AI call

In `runExtraction` (packages/scraper/src/extraction-orchestrator.ts), `detail_url` is `rowScopedOnly` (defined at plan-run.ts:285-298):

- Every page-level tier skips it (`pageLevel()` filter, orchestrator:164).
- **Both cached tiers explicitly exclude it**: `missingForCache` (orchestrator:403) and `stillMissing` (orchestrator:414) filter `!rowScoped.has(n)` — so the three *proven, still-working* cached `detail_url` xpaths are never replayed. (They would also be executed page-level by `buildCachedXPathScript`, i.e. one row, which is why the exclusion exists.)
- `tryAssign` (orchestrator:232) rejects any non-`xpath` source for it.
- The persisted row selector is unusable: `domain_intelligence.row_selector` is NULL — `DomainCache.rowSelector` accepts only `source: 'human'` (packages/scraper/src/domain-cache.ts:47); the AI-proven `row_xpath` from the three successful walks was **never persisted anywhere**.

So the *only* code that can ever produce `detail_url` rows is STEP 3, `agent.generateSelectors` (orchestrator:575-639) — a fresh, nondeterministic AI vision call (locate-results + selector generation, packages/agent/src/schema-agent.ts:131-156) **on every single listing plan, warm domain or not**. Its two failure modes both land in the same silent place:

- it throws → caught at orchestrator:637-639, **`console.error` only** — nothing reaches `outcome.warnings`/`runs.logs`; `plan` stays null, `rows` stays undefined → `listingRows = page1.data = [{}]` → `'empty-page'`;
- it returns a plan whose `row_xpath` matches 0 rows → `extractedRows = []` → `'empty-page'`.

The DB cannot distinguish which of the two happened at 12:17 (the api-server console was not persisted), but both produce byte-identical DB state and both have the same root cause and fix. That the three prior successes produced three *different* xpath variants of the same selector (quote-style/`@href` differences) shows the call's run-to-run nondeterminism directly.

## Reproduction (free, no AI, no cache writes)

Throwaway script (since deleted) ran the app's own capture path (`browser.capture(url, {waitUntil:'networkidle', interceptNetworkRequests:true})`, popup dismissal included) and then `runExtraction` with the failing run's exact field set (`[detail_url]`, `pageType:'listing'`) and `agent: null`:

```
capture took 11259ms, final url: .../SearchResults?kn=python, title: Python – AbeBooks
health: {"healthy":true}, html length: 963389
'/bd' BookDetails-style links: 90, 'listing-title-link' occurrences: 30
cached xpath //a[@data-test-id='listing-title-link']/@href matches: {"count":30, first/last real /bd URLs}
cache: totalRuns=4, rowSelector=null, detail_url paths=3
runExtraction(agent:null): 0/1 fields, plan=null, rows=undefined, confidence=0, cacheHit=true
```

The last line is **exactly the failing run's signature** (confidence-0 failure recorded to the cache, no detail_url resolution, plan null → silent `'empty-page'` in planRun). The page, the app's capture path, and the cached selectors are all fine *today*; remove the AI rung and you get the 12:17 outcome deterministically.

## Hypotheses

### H1 (prime suspect): 6f9a130 — `effectiveSchema` filters `detail_url` — **REFUTED**

- The hypothesis was that the walk previously received `detail_url` *with a cached selector* through `effectiveSchema`. It never did: `effectiveSchema` (both versions — `git show 9ac406b:packages/api/src/crawl/effective-schema.ts` vs current) maps down to bare `{name, type}`; `selectors_json.fields` carries **no `origin` and no selectors** (verified: the JSON holds only name/type/description-ish keys — zero `origin`/`selector`/`xpath` keys). `partitionSchemaByOrigin` (packages/scraper/src/crawl/partition-schema.ts:33) therefore defaults every field to `'detail'`, so `partitions.listing` was **empty at both probes**, and `listingFields` — the actual extraction request — was `[DETAIL_URL_FIELD]` in both. The filter changes nothing the listing walk sees; `DETAIL_URL_FIELD` is re-added by plan-run.ts:280-300 with its full definition either way (the definition never carried a selector — selectors come from cache/AI inside the chain).
- Corroborated by cache data: the 10:45 pre-fix probe touched **only** `detail_url` in the listing cache (variant #3); the 18 other listing fieldPaths (`title` etc.) were last touched by the 10:44 analyze — i.e. the pre-fix probe also requested exactly one field.

### H2: any other fix-wave commit — **REFUTED**

`git diff --stat 9ac406b..aacf4c2` touches **no file in packages/scraper or packages/browser** — the capture path, `planRun`, `runExtraction`, and the agent are byte-identical across the two probes. The api-side changes are guards (duplicate probe, confirm-once, mode lock), phase-2 finalisation (`execute-run`/`roll-up-run`/`start-execution`), and dashboard copy — none touch the planning walk's inputs (proven identical under H1) or its execution. The fix wave changed *when* the old run was finalised (12:12 `partial`), not how the new probe planned.

### H3: site served a block/consent variant to the app's capture path — **REFUTED (as a systemic cause)**

The failing run passed `checkPageHealth` (a blocked page throws → run `failed`; it is `planned`), and this RCA's repro through the identical capture path got a healthy 963KB page with all 30 rows and the intercepted `HighlightInventory` JSON. A one-off degraded render at 12:17 exactly cannot be replayed, but nothing in the evidence requires it, and it could not explain the *silence* either way.

### H4: rate limiting — **REFUTED**

Total site traffic before the failing probe: ~7 page loads spread over 10:27–10:47, then **90 minutes of zero traffic** before 12:17 (the 12:12 event was a DB-only finalisation). A plain fetch minutes after the failing run got full results.

### H5: the earlier `selectors_json` reset / restage state — **REFUTED**

Current `selectors_json` holds 19 fields incl. `detail_url`, `"cached": true` (the post-wave analyze served a cached analysis — hence no cache touches between 10:45 and 12:17, and `total_runs` accounts exactly for 4 live listing extractions). Schema contents only reach the listing walk via `partitions.listing`, which requires `origin:'listing'` fields that have never existed here (H1). Whatever `selectors_json` held at each probe, the walk's extraction request was the same one field.

### H6: AI selector-generation rung failed this run, and nothing else can serve `detail_url` — **CONFIRMED**

By elimination *and* by direct reproduction: the chain minus a successful `generateSelectors` call yields precisely the observed DB state, and no other tier is permitted to produce the field (orchestrator:164/232/403/414; `rowSelector` human-only at domain-cache.ts:47; `row_xpath` never persisted).

## ROOT CAUSE

The listing walk has a hard, per-run dependency on one nondeterministic AI call, and loses it silently. `detail_url` is `rowScopedOnly`, so every tier except STEP 3's fresh `agent.generateSelectors` call is forbidden to produce it (packages/scraper/src/extraction-orchestrator.ts:403 and :414 exclude row-scoped fields from both cached tiers; :232 rejects non-xpath sources) — the domain's three verified cached `detail_url` xpaths and the previously proven `row_xpath` are never replayed (row plans are never persisted; `rowSelector` is human-only, packages/scraper/src/domain-cache.ts:47). In run f5b72f3a that single AI call failed (threw — swallowed at orchestrator:637-639 as console-only — or returned a plan matching 0 rows), extraction returned no rows, and `planRun` hit the page-1 `'empty-page'` stop at packages/scraper/src/crawl/plan-run.ts:436-439, a branch that reports the input `'planned'` and pushes **no warning** — so a 0-item walk of a 30-item listing finalised as a clean `planned` run with empty logs. The fix wave (9ac406b..aacf4c2) is not causal: it touched no scraper/browser code and the walk's extraction request was `[detail_url]` before and after 6f9a130.

## Minimal fix direction

Two independent, small changes:

1. **Warm-path resilience**: persist the verified listing row plan (at minimum `row_xpath`, ideally the whole page-1 plan) into the `(domain, 'listing')` cache after a successful walk, and add a row-mode cached rung before STEP 3 that replays it (executing the cached `detail_url` xpath *relative to the cached row xpath*, not page-level). Then a warm domain plans without any AI call, and an AI blip cannot zero a proven listing.
2. **No silent zero**: in `plan-run.ts`, when page 1 of a `listing_to_detail` input absorbs 0 detail items, push a warning naming the stop reason (and surface STEP 3's swallowed `generateSelectors` failure into `outcome.warnings` rather than console only); optionally `planSource` should refuse to call a 0-item listing plan a clean `planned`.

## The test that would have caught it

A `planRun` unit test with an injected `extract` that simulates AI failure (returns `{data:[{}], rows: undefined, plan: null, ...}` — or rows lacking `detail_url`) asserting the outcome is **not silent**: `warnings` (or `errors`) non-empty for that input. It fails today — `outcome.warnings` is `[]`. Companion test for the warm path once fix 1 exists: `runExtraction` with `agent: null` and a cache holding a verified row plan must resolve `detail_url` rows (today this can only pass by calling the AI).
