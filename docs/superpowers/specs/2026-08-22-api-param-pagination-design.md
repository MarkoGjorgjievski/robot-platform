# `api-param` Pagination — Design Spec

**Date:** 2026-08-22
**Status:** Approved — ready for implementation planning
**Related:** [`2026-08-19-v2-crawler-design.md`](2026-08-19-v2-crawler-design.md) (§2.4 ranks `api-param` first and was never built), [`2026-08-21-pagination-proof-and-caching-design.md`](2026-08-21-pagination-proof-and-caching-design.md) (the caching this plugs into), [`docs/handoff.md`](../../handoff.md), [`docs/roadmap.md`](../../roadmap.md)

## Motivation

A listing page that paginates in HTML is the easy case. The common modern case is a page whose results arrive as JSON — from a scroll, a "load more" click, or a pager that never changes the URL — and for those, every HTML strategy we have returns `no pagination detected — planned page 1 only`.

We already intercept every XHR during capture, with URL, method, headers and parsed JSON (`InterceptedRequest`). The data needed to paginate those sites is sitting in the capture and nothing reads it.

**There is a second, sharper reason to build this now.** On 2026-08-21 a live run exposed `deriveTemplate` choosing AbeBooks' `ds` filter as the page cursor while pinning `p=1`, the real pager. Pages 2 and 3 re-fetched page 1; 30 detail URLs became 30/2/1; and the three stray items that leaked past dedupe satisfied the `gained > 0` gate, so a broken config was cached in silence. `api-param` faces the identical question — *which query parameter is the pager?* — but unlike the HTML path it can **answer it by experiment before committing**: replay the endpoint with a candidate bumped and see whether different data comes back. This spec makes that verification mandatory, which makes `api-param` the first strategy that closes the hole the HTML path still has.

## Pinned decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Which response is the listing API | The one whose JSON contains **the detail URLs page 1's row extraction already produced** | A match on shared concrete values, not a guess about which endpoint looks product-ish |
| Choosing the paging parameter | Rank candidates by name, then **prove the winner by replay** | The AbeBooks bug, caught in one JSON fetch instead of by a human reading item counts days later |
| Choosing the step | Name implies it (`page` → 1, `offset`/`start`/`skip` → page size); if verification fails, try the other before discarding the parameter | A wrong step produces an overlapping window, which the same check catches |
| Cursor APIs | **Out of scope.** Numeric parameters only | An opaque cursor cannot be bumped, so the verify-by-replay loop does not apply; those sites fall to the DOM-scroll cycle |
| Where replay runs | Inside the page via `page.evaluate(fetch)` | Cookies, auth headers and CSRF tokens apply automatically; the request is indistinguishable from the site's own |
| Ladder position | Ahead of `url-pattern` / `next-button` / `page-numbers` | v2 spec §2.4 |

## What exists, and what is missing

| Asset | Location | State |
|---|---|---|
| Every XHR from the capture, with parsed JSON | `PageCapture.interceptedRequests` | Captured on every run; **nothing reads it for pagination** |
| `PaginationConfig` | `packages/browser/src/types.ts` | Union of three HTML strategies; **needs an `api-param` member** |
| Per-domain config caching + verify-before-write + one bounded stale retry | `plan-run.ts`, `domain-cache.ts` | Shipped 2026-08-21; `api-param` plugs straight into it |
| `detectPagination(capture, agent, cached?)` | `crawl/detect-pagination.ts` | The tier ladder lives here; `api-param` becomes its first rung |
| Cached API-path replay (dot-notation into fresh JSON) | `resolveApiPathsFromCache`, `getByDotPath` in `domain-cache.ts` | Exactly the mechanism for pulling `detail_url` out of a paged response |
| In-page evaluation | `IBrowser.evaluate(url, script, options)` | Navigates, then evaluates — see §3 for why that shapes the design |
| Static fixture HTTP server | `packages/scraper/src/__fixtures__/serve.ts` | Shipped 2026-08-21 for the multi-page gate; **extends to serve JSON, which is what makes this testable offline** |

## Goals

1. A listing whose results come from a GET JSON endpoint paginates without touching HTML pagination.
2. The paging parameter is never guessed — it is demonstrated before use and before caching.
3. Enumeration from page 2 onward costs no AI and no page loads.

## Non-goals

- **Opaque cursors** (`nextCursor`, `after`, `endCursor`). They cannot be bumped, so the verification loop does not apply. Deferred to the DOM-scroll cycle.
- **POST bodies and GraphQL.** GET query parameters only, as v2 §2.4 already scoped.
- **DOM-driven infinite scroll**, including sites that render results without any XHR at all. That is the next cycle, and it is the fallback that catches everything this cannot.
- Fixing `deriveTemplate`'s parameter choice on the HTML path. Separate problem, separate cycle.

## 1. Which intercepted response is the listing API

Candidates are filtered to: `method === 'GET'`, `isJson`, a 2xx `responseStatus`, and a parsed body containing at least one array of objects.

A candidate is **the** listing API when its JSON contains the detail URLs page 1's row extraction already produced. Matching accepts a full URL, a path, or a trailing slug/id, because APIs commonly return `/p/12345` or `12345` where the DOM carries an absolute URL.

**Why this is not the rule that broke Nike.** `filterRequestsForPage` (reverted in `c606a54`) matched a *single* entity's identifier against intercepted responses, and the note left at its call site is explicit that the identifier rule is unsafe across API namespaces — a recommendations endpoint legitimately carries the product id you are looking for. The rule here is different in kind: it requires **multiplicity**. A recommendations blob may carry two or three of a listing's URLs; it will not carry twenty of them in the same order. The threshold is therefore a *share* of page 1's yield, not a hit:

- at least `API_MATCH_MIN_COUNT` (3) distinct matches, **and**
- at least `API_MATCH_MIN_SHARE` (0.5) of page 1's detail URLs.

Both bars exist deliberately: the count stops a tiny listing from qualifying a widget on one coincidence, the share stops a large listing from qualifying a sidebar that happens to hold a handful.

If several candidates qualify, prefer the one with the highest share, then the largest array. If none qualifies, there is no API pagination and detection falls through to the HTML strategies — **exactly as today**, so a site this cannot handle is no worse off than before.

## 2. The paging parameter, and its step

Parse the winning endpoint's query string. A parameter is a candidate when its value is entirely numeric and its name is in:

```
page, pageNumber, pageNum, p, offset, start, startIndex, from, skip
```

Rank by that order — but ranking only decides *what to try first*, never what to use.

**The step is part of the hypothesis, not an afterthought.** `page`-family names imply a step of 1; `offset`/`start`/`from`/`skip` imply a step of one page size, where the page size is the length of the result array in page 1's own response. Getting this wrong yields an overlapping window rather than a fresh page, which the verification below rejects just as it rejects a wrong name.

**Verification — the load-bearing part of this spec.** For each candidate, in rank order:

1. Build the endpoint URL with the candidate advanced by its hypothesised step.
2. Fetch it (§3).
3. Extract the identifiers from the response using the same accessor that found the match in §1.
4. Compare against page 1's identifiers. If the overlap exceeds `REPLAY_MAX_OVERLAP` (0.5), the hypothesis is wrong.
5. On failure, retry the *same parameter* with the other step before moving to the next candidate. Only when both steps fail is the parameter discarded.

A candidate that returns a well-formed response full of the same items is the AbeBooks bug, and it is rejected here for a few hundred milliseconds of JSON rather than surviving into the cache.

If no candidate verifies, fall through to the HTML strategies. Record a warning naming the endpoint and the candidates tried — that warning is the raw material for improving this heuristic later, and the 2026-08-21 cycle showed that a subsystem which cannot say what it observed cannot be improved from real traffic.

## 3. Replay mechanics

`IBrowser.evaluate(url, script)` navigates and then evaluates, so one call per fetch would mean one page load per page of results — worse than the HTML path it replaces.

It also must not put the decision logic inside a stringified script, because logic that only exists in-page cannot be unit-tested in Node — and the verification in §2 is the part of this design most in need of tests.

So the work splits along that seam. **The page fetches; Node decides.** Two `evaluate` calls per input, not one per fetch and not one per page:

1. **Probe.** One script fetching every candidate URL (at most one per candidate parameter × two steps, so a handful of small JSON requests), returning each raw body with its status.
2. Node runs the §2 verification over those bodies — pure functions, no browser, fully unit-testable — and picks the winner or decides there is none.
3. **Page.** A second script fetching pages 2..N with the winning template, returning each raw body.

`buildExtractionScript` is the established precedent for handing the page a generated script and getting structured data back; these scripts are simpler, because all they do is fetch and return.

Requests use `fetch(url, { credentials: 'include' })` from the page's own origin, so session cookies, auth headers and CSRF tokens apply without being reconstructed in Node — the difference between a request that works and one that returns a login page.

Both scripts must be defensive in-page: a non-2xx response, a body that is not JSON, or a network error is recorded against that URL and the script returns what it has rather than throwing. A pagination failure must never lose the work page 1 already planned.

The cost of the split is one extra navigation per input. That is a page load the HTML path pays several times over, and it buys the entire verification story being testable without a browser.

## 4. Enumeration and termination

Detail URLs come out of each page's JSON through the existing cached-API-path mechanism: `detail_url` gets an `api`-sourced dot-notation path in `field_paths`, so later runs read them with no AI. The path is discovered once, from page 1's response, by locating the identifiers matched in §1.

When the API returns bare ids or slugs rather than URLs: if the Source has a `url_template`, substitute; otherwise fall through to HTML pagination rather than fabricate a URL.

Termination prefers real signals from the payload over the heuristics HTML forces on us — `total`, `totalPages`, `totalCount`, `hasMore`, `has_next` where present. Backstops, all of which already exist: the `max_pages` / `max_items` budget, and a page that yields no new identifiers.

## 5. Caching

The winning configuration stores to `domain_intelligence.pagination_config` beside the HTML strategies, as a new `PaginationConfig` member:

```
{ strategy: 'api-param', apiTemplate: string, paramName: string, step: number }
```

`apiTemplate` is the endpoint URL with the paging parameter's value replaced by `{N}` — a template, not a captured URL, for the same reason `urlTemplate` is.

It reuses the 2026-08-21 machinery unchanged: written only on a verified walk, never `null`, one config per `(domain, 'listing')`, and one bounded re-detect when a cached config stops producing.

**One thing it does better, and the spec should say so plainly.** The HTML path's verification is `gained > 0` — which the AbeBooks run proved too weak, because a broken pager that leaks three stray items past dedupe satisfies it. `api-param`'s verification is a direct comparison of returned identifiers against page 1's, so a config that re-serves page 1 cannot reach the cache at all. This is the first strategy to close that hole, and it closes it only for itself; the HTML path keeps its weaker gate and its new thin-walk warning until someone fixes `deriveTemplate`.

## 6. Position in the ladder

`detectPagination` becomes: `cached → api-param → url-pattern → next-button → page-numbers → AI`.

`api-param` runs first because it is the cheapest and the best-verified: no page load, no AI, and an answer that has been demonstrated rather than inferred. It requires page 1's extracted `detail_url` values, which `planRun` already has before it decides how to paginate — so the ordering costs nothing to arrange.

A cached `api-param` config short-circuits detection exactly as a cached HTML config does.

## 7. Testing

**This is testable offline, and that is not an accident.** The fixture HTTP server shipped on 2026-08-21 serves fixture pages over real HTTP so Chromium can navigate them; extending it to serve JSON endpoints from the same origin means an in-page `fetch` works in Tier 1, with real cookies and a real origin.

| Property | How |
|---|---|
| The endpoint carrying page 1's URLs is chosen over a decoy | Unit, with a recommendations-shaped blob holding 2 of 30 URLs as the decoy — the Nike case, encoded |
| A parameter that re-serves page 1 is rejected | Unit — **the AbeBooks bug as a test**; this is the one that must never go vacuous |
| A wrong step is rejected, then the right step accepted for the same parameter | Unit |
| Nothing qualifies → falls through to HTML strategies, page 1 still planned | Unit |
| End to end over real HTTP: listing page + JSON API, walked and enumerated | Tier 1, fixture server serving both |
| A non-2xx or non-JSON page ends the loop without losing page 1's work | Unit |

Every test names the production change that would make it fail. The 2026-08-21 cycle shipped four separate vacuous tests in one file before they were caught — assume this file will try to do the same.

## 8. Risks

| Risk | Mitigation |
|---|---|
| A decoy endpoint passes the share threshold | Two independent bars (count and share); the decoy test encodes the real Nike shape |
| Replay is rejected by the origin (bot protection on the API) | The loop degrades to "no api-param" and falls through to HTML; page 1's work is never lost |
| An in-page script is harder to debug than Node code | Structured return values including which candidate won and why the others failed; `HEADFUL=1` remains available |
| The thresholds (3, 0.5, 0.5) are picked from reasoning, not data | They gate a *fallthrough*, not a refusal of work — a miss costs the HTML path, which is today's behaviour. Log the observed shares so the next cycle tunes from traffic |
| An API that paginates but returns identical first and second pages by design | Rejected as unverified, correctly — we cannot distinguish it from a broken parameter, and caching it would be worse |

## 9. Suggested implementation order

1. `PaginationConfig` gains its `api-param` member, plus the identifier-extraction helper shared by detection and verification.
2. Listing-API detection from a capture (§1), unit-tested with the decoy.
3. Candidate + step ranking and the verification decision (§2) as pure functions over already-fetched bodies — no browser, no fetching.
4. The two in-page fetch scripts and their structured results (§3).
5. Wire into `detectPagination` as the first rung, and into `planRun`'s existing cache read/write.
6. Extend the fixture server to serve JSON; the Tier 1 end-to-end gate.
7. Live proof on one real site, plan-only, with the budget shaped so pages rather than items are the limit.
