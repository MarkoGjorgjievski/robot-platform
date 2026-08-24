# DOM-Scroll Pagination — Design Spec

**Date:** 2026-08-24
**Status:** Approved — ready for implementation planning
**Related:** [`2026-08-22-api-param-pagination-design.md`](2026-08-22-api-param-pagination-design.md) (the strategy this backstops), [`2026-08-21-pagination-proof-and-caching-design.md`](2026-08-21-pagination-proof-and-caching-design.md) (the caching this plugs into), [`2026-08-19-v2-crawler-design.md`](2026-08-19-v2-crawler-design.md), [`docs/handoff.md`](../../handoff.md)

## Motivation

Every pagination strategy we have needs a *thing to act on*: a URL template, a next button, numbered links, or a JSON endpoint with a page parameter. A listing that loads by scrolling has none of them. Today those sites produce `no pagination detected on … — planned page 1 only` (`plan-run.ts:483`) and the customer silently gets one screen of results.

`api-param` covers the subset that scroll-fetches over a GET endpoint with a numeric parameter. It cannot cover opaque cursors, POST or GraphQL bodies, or a page that renders its next batch without any XHR at all — and it has no live-proven site, because the corpus has none that paginates over JSON.

**This is the transport-agnostic fallback.** It does not care how the next batch arrives; it cares only that the DOM grew. That property is what makes it the last rung: whatever falls through everything else, this catches.

## Pinned decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Correctness vs. speed | **URL dedupe is the correctness backstop; card labelling is a speed optimisation on top** | A virtualized list recycles nodes and takes their labels with them. Labels must never be load-bearing |
| Stop signal | **Wait for growth with a timeout, then N consecutive quiet rounds** | A single slow round is not the end of a list; treating it as one is silent truncation |
| Budget | **`max_items` alone governs.** `max_pages` is not consulted | An operator thinks "get me 200 products", not "scroll 8 times". Scrolling has no natural pages |
| When it fires | **Whenever every other strategy came back empty** | There is nothing to detect from a static capture — you find out by trying, and the quiet-round rule makes a finished page cost two scrolls |
| Trigger | Scroll and "load more" are **one strategy with two triggers** | Identical loop: grow the DOM, re-extract, repeat until quiet |

## What exists, and what is missing

| Asset | Location | State |
|---|---|---|
| `crawl()` — async generator owning a page, yielding extracted batches | `packages/browser/src/playwright-browser.ts` | The shape to mirror; navigates between pages, so it cannot scroll |
| The give-up point | `plan-run.ts:482-486` | Pushes a warning and `continue`s. **This is where the scroll walk goes** |
| `walkPages` dispatcher, `{ gained, budgetStopped, refused }` | `plan-run.ts` | Two branches today (HTML, api-param); needs a third |
| `absorb` — dedupe, item cap, stop reasons | `plan-run.ts` | Shared by both existing walkers; the scroll walk uses it unchanged |
| Verify-before-cache + one bounded stale re-detect | `plan-run.ts`, `domain-cache.ts` | Shipped 2026-08-21; this plugs straight in |
| `PaginationConfig` | `packages/browser/src/types.ts` | Four strategies; needs a fifth |
| Fixture HTTP server with cookies and per-page content types | `packages/scraper/src/__fixtures__/serve.ts` | Serves static bodies; **needs to serve a page whose JS appends cards** |
| Heuristic-then-AI detection pattern | `detectPaginationFromHtml` → `SchemaAgent.detectPagination` | The pattern the load-more button finder follows |

## Goals

1. A listing that loads by scrolling or by a "load more" button enumerates past its first screen.
2. It works regardless of how the next batch arrives — XHR, cursor, GraphQL, or already in the page.
3. A listing that is genuinely finished costs a bounded, small number of extra rounds.

## Non-goals

- **Replacing `api-param`.** Where a JSON endpoint with a numeric parameter exists, that strategy is cheaper and better-verified and runs first.
- Fixing `deriveTemplate`'s parameter choice on the HTML path.
- Horizontal carousels, "quick view" overlays, or anything that is not a vertically-growing result list.
- Clicking through consent or region interstitials — popup dismissal already runs at capture.

## 1. Where it fires — and why it is not a detection rung

Every other strategy is *detected* from a static capture and then *walked*. **DOM-scroll cannot be detected at all**: nothing in the markup reliably distinguishes a listing that will grow when scrolled from one that will not. Asking an AI to guess would put an unverified answer into the cache tier, which is where this project has twice been burned.

So the asymmetry is deliberate, and a reader will get it wrong unless it is stated:

- **Cold run:** `detectPagination` returns `null` exactly as today. `planRun`, instead of pushing its warning and `continue`ing at `plan-run.ts:482`, attempts a scroll walk. If it gains items, the config is written.
- **Warm run:** the stored config short-circuits the ladder at its existing `cached` rung, and the walk goes straight to scrolling.

The existing bounded stale path covers the reverse case: a site that later grows real pagination produces a scroll walk that gains nothing, which triggers exactly one re-detect.

## 2. The loop

A new async generator on `IBrowser`, beside `crawl()`, owning the page for the duration. It must live there rather than in `planRun`: `IBrowser.evaluate(url, script)` navigates, so a Node-driven loop would reload the page every round and destroy everything already loaded.

Each round:

1. **Trigger** — scroll to the bottom, or click the load-more button (§3).
2. **Wait for growth** — poll the row count until it increases or `GROWTH_TIMEOUT_MS` expires. A fast site proceeds immediately; a slow one still gets its chance.
3. **Extract** — run page 1's own `ExtractionPlan` via `buildExtractionScript`, scoped to unlabelled rows (§4).
4. **Label** what was extracted, and yield the batch.

It stops on the first of: `QUIET_ROUNDS` consecutive rounds yielding no new rows; the caller closing the generator (because `max_items` filled); or `MAX_SCROLL_ROUNDS`, a hard safety bound that is not a budget knob and exists only so a pathological page cannot loop forever.

Budget and dedupe decisions stay in `planRun`, as with both existing walkers. The generator's only job is to grow the page and hand back what appeared.

## 3. Triggers

**Scroll** is the default: scroll the results container, or the window, to the bottom.

**Load more** is the same loop with a click instead. The button is found the way this codebase finds everything else — heuristic first, AI second:

- Heuristic: a clickable (`button`, `a`, `[role=button]`) whose text matches *load more*, *show more*, *see more*, *view more*, or *more results*, positioned after the results container.
- AI fallback: `SchemaAgent`, given the screenshot, as `detectPaginationFromHtml` → `SchemaAgent.detectPagination` already does for HTML pagination.

Both endings are already handled by machinery agreed above: a button that **disappears** is a clean stop; a button that **remains but stops yielding** is caught by the quiet-round rule. No special case is needed for either.

When a button is found, its selector is stored on the config so warm runs skip the search.

## 4. Labelling

Each extracted row container is stamped with a `data-robot-seen` attribute, and each round extracts only unlabelled rows. On an append-only list this turns every round from O(all cards) into O(new cards), which is the difference between linear and quadratic work over a 500-item scroll.

**It is an optimisation and nothing more.** When a virtualized list recycles a node, the label goes with it; the card is re-extracted and the URL dedupe discards it. Nothing breaks, and nothing is lost. The rule to hold onto: *correctness comes from `absorb`'s `seen` set; labels only make it cheaper.*

## 5. Correctness and termination

Every batch goes through the same `absorb` the HTML and API walkers use, so dedupe, the item cap and the stop reasons behave identically whichever strategy produced the URLs. The scroll walk returns the same `{ gained, budgetStopped, refused }` shape, so the verification, the cache write, the thin-walk warning and the per-input error isolation all work untouched.

`max_items` is the only budget consulted. `max_pages` is deliberately ignored: a Source configured `max_pages: 2` for HTML pagination must not silently cap a scroll listing at two rounds.

Because `max_pages` does not bound this walk, **`max_items`, `QUIET_ROUNDS` and `MAX_SCROLL_ROUNDS` are load-bearing rather than backstops.** That is the direct cost of the budget decision, and it is why `MAX_SCROLL_ROUNDS` exists.

## 6. Caching

A verified scroll walk writes `{ strategy: 'dom-scroll', loadMoreSelector? }` to `domain_intelligence.pagination_config`, under the rules already in place: written only when the walk gained new items, never when it was refused, one config per `(domain, 'listing')`.

The stored config is thin by nature — there is no template or parameter to remember. What it buys is that a warm run skips straight to scrolling instead of running the whole ladder and falling through it, and remembers the load-more selector if one was found.

## 7. Testing

**The fixture server gains a scroll page.** Today it serves static bodies; it needs one whose inline JS appends a batch of cards on scroll (and one variant with a load-more button). That page is ordinary HTML and JS with no network calls, so the whole loop runs in real Chromium, offline and free.

| Property | How |
|---|---|
| A scroll page enumerates past its first screen | Tier 1, real Chromium against the fixture server |
| A finished page stops after the quiet rounds, not on the first quiet one | Tier 1 — a fixture that pauses one round then yields again |
| A load-more button is found, clicked, and its disappearance ends the walk | Tier 1 |
| A virtualized list (nodes recycled) loses no items | Tier 1 — the fixture removes off-screen cards |
| Labels make round N extract only new cards | Unit, on the extraction-scoping helper |
| `max_items` stops the walk | Unit, fake generator |
| `MAX_SCROLL_ROUNDS` bounds a page that never goes quiet | Unit — a fixture that grows forever |
| A verified walk caches; an unverified one does not | Unit, reusing the existing walker fixtures |

Every test names the production change that would make it fail. **Adjacent guards get adjacent fixtures — one per guard, each failing only its own.** The `api-param` cycle produced nine tests that ran fine and proved nothing, every one of them a fixture that satisfied two constraints at once or none of the ones it claimed; assume this cycle will try the same.

## 8. Risks

| Risk | Mitigation |
|---|---|
| **Repeated scrolling is a more visible bot signal than fetching pages** — and anti-bot is already this corpus's binding constraint | Human-plausible pacing between rounds; `MAX_SCROLL_ROUNDS` caps exposure; treat a blocked capture as a corpus fact, not a code defect |
| A page that never goes quiet | `max_items` and `MAX_SCROLL_ROUNDS`, both load-bearing here by design |
| A virtualized list recycles a card before it is ever extracted | Extract every round rather than trusting labels; the round's extraction runs before the next trigger |
| The load-more heuristic clicks the wrong control (a filter, a newsletter opt-in) | Require the clickable to sit after the results container; a wrong click yields no new rows and the quiet-round rule ends the walk; the config is not cached because nothing was gained |
| Growth timeout too short on a slow site | Wait for growth rather than a fixed delay, so the timeout only binds when nothing is coming |
| A scroll walk on an ordinary unpaginated category page | Bounded and cheap by construction: two quiet rounds and done |

## 9. Suggested implementation order

1. `PaginationConfig` gains `dom-scroll` and `loadMoreSelector`; the fixture server gains a scroll page and a load-more page.
2. The load-more button finder (heuristic, then AI), pure and unit-tested against captured HTML.
3. The generator on `IBrowser`, with the growth wait and the quiet-round rule; Tier 1 against the fixture server.
4. Labelling and scoped extraction.
5. `planRun`: the third `walkPages` branch, and the fallback at `plan-run.ts:482` where it currently gives up.
6. Caching, reusing the existing verify-before-write path unchanged.
7. Live proof on one real scroll-loading site, plan-only, with the budget shaped so `max_items` binds.
