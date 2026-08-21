# Pagination — Live Proof + Config Caching — Design Spec

**Date:** 2026-08-21
**Status:** Approved — ready for implementation planning
**Related:** [`2026-08-19-v2-crawler-design.md`](2026-08-19-v2-crawler-design.md) (§2.4 is the section this builds), [`2026-05-22-testing-strategy-design.md`](2026-05-22-testing-strategy-design.md), [`docs/handoff.md`](../../handoff.md), [`docs/roadmap.md`](../../roadmap.md)

## Motivation

The v2 crawler ships and is live-proven end to end: a planned run of 8 AbeBooks URLs extracted 8/8, and the CSV carried one row per URL. Two claims inside it are **not** proven, and one is not built at all.

**Multi-page walking has never run against a live site.** The proving run's 8 items filled `max_items` on listing page 1, so page 2 was never fetched. Detection is fixture-tested; *walking* — `browser.crawl()` over pages 2..N, `absorb` deduping across them, `max_pages` stopping the loop — has neither a live proof nor an offline gate. Every remaining v2 item assumes it works.

**`pagination_config` is never written.** The v2 spec §2.4 says the winning config is stored per `(domain, 'listing')`, and the plumbing to *read* it exists — `lookupDomainCache` returns `paginationConfig`, `detectPagination` takes a `cached` argument and reports `source: 'cache'`, `browser.crawl` skips detection when handed a config. `planRun` never passes it, so that branch is dead code, and nothing writes the column.

**One correction to §2.4.** It says caching means later runs "pay nothing for detection." Mechanical detection was already free — the saving is real only on domains where `detectPaginationFromHtml` fails and the AI fallback fires. The durable win is **determinism**: a domain that needed AI two runs ago replays a known-good answer instead of re-rolling detection on every plan. This spec states the narrower claim, and the docs should too.

## Pinned decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| When a config is written | Only when the walk it drove **verifiably produced new items** | A config that yields nothing is a false positive — a carousel arrow, or a selector for an absent element |
| A stale cached config | Re-detect in the same run; overwrite only if the fresh config verifies | Self-healing; always trades an unverified config for a verified one |
| Cache key | `(domain, 'listing')` — one config per domain | No schema change; collisions are visible in warnings and self-correct via verify-then-replace |
| Proof standard | One live run **and** an offline fixture gate | Live fire found three Criticals on the phase-2 branch that 456 green tests missed; a gate keeps it from regressing |

## What exists, and what is missing

| Asset | Location | State |
|---|---|---|
| `pagination_config` column | `domain_intelligence` | Exists; read on lookup; **never written** |
| `DomainCache.paginationConfig` | `domain-cache.ts` | Returned by `lookupDomainCache` |
| `detectPagination(capture, agent, cached?)` | `crawl/detect-pagination.ts` | Accepts a cached config, reports `source: 'cache'` — **the branch is dead, nothing passes it** |
| `crawl(url, { paginationConfig })` | `playwright-browser.ts` | Skips detection when handed a config |
| Verification of a walk | `crawl/plan-run.ts`, the `detailCount() === detailsBeforePaging` check | Already computed, already warns; **its result is discarded** |
| Targeted single-field cache write | `pinFieldPath` in `domain-cache.ts` | The precedent to model the writer on |
| Cache access inside `planRun` | — | **Does not exist.** `PlanRunDeps` is `browser`, `agent`, `extract?`, `acquireLock?` |

## Goals

1. Multi-page walking proven against a live site, and gated offline so it stays proven.
2. A verified pagination config persisted per domain and consulted on later plans.
3. A stale config self-heals within the run that notices, bounded.

## Non-goals

- **`api-param` detection and replay.** §2.4 ranks it first in the strategy order; it is not built and is not in scope here. This spec covers the HTML strategies only.
- Infinite scroll and load-more.
- Keying a config more finely than by domain (see §4).
- Multiple ranked candidate configs per domain with hit/miss scoring — nothing needs it yet.

## 1. Read path

`PlanRunDeps` gains two injectable collaborators, defaulting to the real implementations, matching the existing `extract` / `acquireLock` pattern so tests need no DB:

```
lookupCache?: typeof lookupDomainCache
savePagination?: typeof savePaginationConfig
```

Before detecting, `planRun` looks up `(domain, 'listing')` and passes `cache?.paginationConfig` as `detectPagination`'s third argument. That is the whole read path — the argument and its `'cache'` branch already exist.

The lookup happens **once per input**, inside the per-domain lock already held around that input's fetching.

## 2. Write path

New `savePaginationConfig(domain, config)` in `domain-cache.ts`, modelled on `pinFieldPath`: upsert the `(domain, 'listing')` row and set `pagination_config`. It must create the row when absent — a plan can walk a domain that has no `listing` intelligence row yet.

It is called from exactly one place: the existing verification check in `planRun`, inverted. Written only when the walk produced new items.

Never write `null`. A failed detection leaves whatever was there; absence of evidence is not evidence of absence, and a domain with no config already behaves correctly — it detects from scratch.

## 3. Stale path

When `source === 'cache'` **and** the walk produced no new items:

1. Discard the cached config for this run.
2. Re-detect from scratch — mechanical, then AI.
3. Retry the walk **once** with the fresh config.
4. If that verifies, overwrite. If it does not, warn and leave the stored config alone.

Bounded at one retry per input: no loop, no recursion. Worst case on a redesigned site is one wasted walk plus one detection, once, after which the domain is warm again. This is §2.4's "re-detect once, store the new config, stamp the failure" made concrete.

## 4. Cache key and its accepted risk

One config per `(domain, 'listing')`. A domain whose search results and category pages paginate differently gets one of them, and the two shapes may overwrite each other on alternating runs.

This is accepted deliberately. The thrash is visible — each overwrite is preceded by a "produced no new items" warning naming the URL — and verify-then-replace means a wrong config never survives a run that disproves it. **If the warnings show real thrash in practice, that is the evidence for keying by URL shape**, which is the alternative considered and deferred.

## 5. Proof

Two parts, both required.

**Live.** One AbeBooks run at `max_items: 20, max_pages: 3`, so pages 2 and 3 are genuinely walked. Record: pages walked, items enumerated per page, dedupe behaviour across pages, and whether `max_pages` or `max_items` stopped it. The run also live-exercises `crawl.cancel` stop-and-resume, which is unit-tested only today.

**Offline.** Capture those listing pages as fixtures and serve them over a local HTTP server, so `browser.crawl()` can navigate between them in Tier 1 forever after. This is new harness surface: `setContentEvaluate` cannot navigate, which is exactly why multi-page walking has no offline gate today. It is the largest single piece of this work and should be sized as such.

## 6. Testing

| Property | How |
|---|---|
| A verified walk writes the config | Unit, fake `savePagination`, assert called with the winning config |
| An unverified walk writes nothing | Unit — the regression that matters most; a false positive must never be cached |
| A cached config short-circuits detection | Unit, assert the agent's `detectPagination` is never called |
| The stale path re-detects exactly once | Unit, assert one re-detect and one retry, no loop |
| `null` is never written | Unit |
| Pages 2..N are walked, deduped, and budget-stopped | Tier 1, fixtures served over the local HTTP server |
| It works on a real site | The live run above |

Every test names the production change that would make it fail. The fixture gate is the one that must survive a refactor.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Two listing shapes on one domain thrash | Accepted; visible in warnings; escalate to URL-shape keying if observed (§4) |
| The fixture HTTP server becomes flaky harness | Keep it minimal — static files, fixed port range, torn down per suite |
| A cached config drives a walk that silently returns page 1 repeatedly | Already covered: §2.4's stop condition rejects a page yielding only already-seen URLs |
| AbeBooks blocks the deeper walk | Fall back to another corpus domain and say so; anti-bot is already the binding constraint on this corpus |

## 8. Suggested implementation order

1. `savePaginationConfig` plus its unit tests, with no callers yet.
2. `PlanRunDeps` gains `lookupCache` / `savePagination`; wire the read path; write on verified success.
3. The stale path.
4. The fixture HTTP server and the Tier 1 multi-page gate.
5. The live run, at the raised budget, recorded in `docs/handoff.md`.
6. Update `docs/roadmap.md` — and correct the "pay nothing for detection" claim wherever it appears.
