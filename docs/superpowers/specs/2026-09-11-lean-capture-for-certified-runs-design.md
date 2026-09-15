# Lean capture for certified runs — design note

**Status:** discussed 2026-09-11; first increment (the wait strategy, the lock, the timings) landed 2026-09-15 in `b765f48`, see the last section. The second increment is not decided. Companion note:
`2026-09-11-second-layout-learning-design.md`. Either can be built first; lean
capture is the smaller change, second-layout learning the more important one
for correctness at scale.

## The problem

Extraction on a verified website costs nothing in compute: the certified paths
are evaluated in milliseconds. What costs time is the page capture, and the
capture a certified run uses today is the one built for the AI analysis chain.

Per product, `execute-run.ts` → `extract-item.ts` (certified branch) →
`runVerifiedExtraction` → `browser.capture(url, { waitUntil: 'networkidle' })`
does, in order:

1. New tab, navigate, wait for `networkidle` (fallback to `domcontentloaded`
   plus a 3 s sleep if that never comes; 60 s timeout).
2. `dismissPopups`: a fixed 1.5 s sleep, then up to 3 rounds of clicking with
   an 800 ms sleep after each click and a 500 ms sleep after the JS removal.
3. `expandHiddenContent`: 2 rounds of clicking "show more" / accordion controls.
4. Full-page PNG screenshots, tiled, one after another.
5. Readable-content extraction and markdown conversion.
6. `setContentEvaluate`: a second tab, the saved HTML loaded into it, the
   certified XPaths run there.
7. One `captures` row and one `extractions` row.

Steps 4 and 5 exist only for Claude, which never runs on a certified website.
Step 6 renders the page a second time. Steps 2 and 3 sleep even when there is
no popup. Rough split, unmeasured (no certified Extract has run live yet):

| Stage | Rough cost |
|---|---|
| Navigation to networkidle | 2–6 s |
| Popup and expand rounds | 2–4 s |
| Screenshots plus markdown | 1–5 s |
| Second render for XPaths | 0.5–1 s |
| Applying the certified paths | milliseconds |

A product likely costs 6–15 s, of which under a second is the work we need.

**Measured 2026-09-15.** Marko's Ikea Extract of 2026-09-11 (30 products,
completed, every field filled) took 1,996 s: 69–75 s per product, median 71.6 s.
One product page captured directly, stage-logged:

| Wait mode | Total | Where it went |
|---|---|---|
| `networkidle` (today) | 69.8 s | 60 s until the networkidle timeout, 4.4 s popup rounds, 0.5 s expand, 0.7 s screenshots + rest |
| `load` | 7.0 s | 1.7 s navigate, 4.2 s popup rounds, 0.5 s expand, 0.6 s screenshots + rest |

Both captures yielded the same 2 JSON-LD blocks and the same 10 JSON API
responses, including the product JSON the certified paths read. Ikea holds a
connection open, so the page never goes idle and every product pays the full
60 s timeout. The wait strategy (item 1 below) is therefore the whole first
increment on its own: 70 s → ~7 s. The rest of lean capture (items 2–3, mostly
the popup rounds) takes 7 s → ~2 s and is the second increment.

Also found while reading: `execute-run.ts` says the per-domain lock's 2 s
politeness delay protects every request. The lock lives in
`acquireDomainLock` and is taken by `runExtraction` and `planRun`. The
certified path calls `browser.capture` directly and bypasses it, so certified
runs hit the site back to back with no spacing. Not urgent while the loop is
sequential; must be fixed before any parallelism.

## What "lean" means and does not mean

Lean and full describe only how the page is loaded. Both apply the same
certified paths. Nothing is rediscovered or guessed in either mode. The proof
sheet (verification of the three proof pages) keeps the full capture,
unchanged. The domain intelligence cache is not involved: a verified website
never consults it.

## Design

1. **`captureLean` on `IBrowser`, alongside `capture`.** Navigates and waits
   for `load` only; skips popup dismissal, content expansion, screenshots and
   markdown; keeps network interception and the structured-data pass (the
   certified paths need JSON-LD, meta tags and intercepted API bodies). Returns
   `{ url, html, title, structuredData, interceptedRequests, probe, timings }`.
   Takes a probe script and a readiness predicate: after `load` it runs the
   probe in the live tab every 250 ms until the predicate is satisfied or an
   ~8 s deadline passes; past the deadline it does one bounded `networkidle`
   wait and a final probe, so a real miss is still an honest one.
   `resolveStructured` is retyped to take only the fields it reads
   (`structuredData`, `interceptedRequests`) so both capture shapes fit.

2. **`runVerifiedExtraction` uses it.** The probe is the existing XPath probe
   script, so the XPaths run in the live page and the second render goes away.
   Readiness: every field with at least one certified path has at least one
   path resolving to a non-null value on the snapshot (probe result plus
   structured data plus intercepted requests so far).

3. **Fallback on a miss, to today's exact code.** If any field is still empty
   after the lean capture, the same product is re-captured with the full
   capture and evaluated the way it is today (`setContentEvaluate` on the
   saved HTML). A working product costs one fast capture; a broken one costs
   a slow one and is flagged as drift anyway. This covers the one real risk of
   skipping the click rounds: a certified value that only appears after a
   "show more" click.

4. **Learn within the run.** If the full capture finds a value the lean one
   missed, count it. After 3 such products in a row, the rest of the run goes
   straight to full. Caps the penalty on a website whose certified field always
   needs the click rounds. (The alternative, recording at certification time
   whether each value was present before the click rounds, is more precise but
   touches the stored certification; revisit if the Ikea run shows the need.)

5. **Politeness restored.** `runVerifiedExtraction` takes the domain lock via
   an injectable `acquireLock` (default `acquireDomainLock`, no-op in tests),
   the pattern `plan-run.ts` already uses. Two seconds per product becomes the
   floor for a certified run; a per-website setting can lift it later.

6. **Measure it.** Each product's capture mode (`lean` / `full` /
   `full-after-lean-miss`) and milliseconds go into the `captures` row's
   `metadata` (today `{}`) and one log line per product, so the Ikea run gives
   the real before-and-after. Run the free Ikea Extract on current `main`
   first for the baseline (this is also handoff item 1).

## Files

- `packages/browser/src/types.ts`, `playwright-browser.ts` (+ test with a fake
  page for the readiness poll and deadline)
- `packages/scraper/src/verify/verified-extraction.ts` (+ test: lean hit;
  lean miss then full; three rescued misses switch the run to full)
- `packages/scraper/src/verify/search-structured.ts` (parameter type only)
- `packages/api/src/crawl/extract-item.ts` (+ test: metadata on the capture row)
- every fake `IBrowser` in tests gains `captureLean`

## Not in scope

- Parallel tabs on one domain, or parallel websites in a project. Both are
  multipliers on the per-page cost and come after it; both need item 5 first.
- Skipping the browser entirely for structured-only paths (plain HTTP fetch or
  direct API replay). The largest possible win for a website like Ikea whose
  fields are all mechanical, but it needs certification to record whether a
  value is present in the raw server HTML. A separate note when we get there.
- The physical floor: the target site's own response time and its tolerance
  for our request rate. Going faster than a site accepts turns a five second
  product into a blocked run.

## First increment landed (2026-09-15)

Items 1 (as `CaptureOptions.ready`, not a separate method), 5 and 6 are on
`main`. `runVerifiedExtraction` captures with `waitUntil: 'load'` plus a ready
check built from the certified paths (`buildReadyCheck`), takes the domain
lock, and returns the capture's timings, which `extract-item.ts` writes to
`captures.metadata.capture`. Items 2–4 (the XPaths in the live tab, dropping
the click rounds, screenshots and markdown, the fallback and the in-run
switch) are the second increment and are not built.

Measured on the same Ikea website, a full Extract limited to 10 products:

| | Before (2026-09-11, 30 products) | After (2026-09-15, 10 products) |
|---|---|---|
| Per product, median | 71.6 s | 10.5 s |
| Per product, range | 69.0–75.3 s | 8.6–11.2 s |
| Capture alone | ~70 s | 6.5–9.1 s |
| Ready check | — | passed on the first poll on all 10 (12–36 ms after `load`) |
| Fields filled | 8 of 8 on every row | 8 of 8 on every row |

Of the ~10.5 s that remain per product, the capture is ~8 s (navigation
2.3–3.8 s, the rest popup rounds, expand, screenshots, markdown) and the
second render for the XPaths plus stats and row writes are the other ~2.5 s.
That is the second increment's territory.
