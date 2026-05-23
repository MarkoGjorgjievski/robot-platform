# Testing & Extraction-Quality Harness — Design

**Date:** 2026-05-22
**Roadmap slot:** cross-cutting initiative (touches Track A + Track B); recorded in `docs/roadmap.md` as **Testing & Quality Harness (IN PROGRESS)**.
**Sibling docs:** `docs/testing.md` (the canonical "how to test" — created in P1).

---

## Problem

The product's whole value is *"did extraction pull the right data."* Yet:

- The `agent` and `dashboard` packages have **zero tests**, and a `vitest` script with no test files makes `pnpm -r test` exit non-zero — so there is **no green workspace gate**.
- Every dogfood we've run (Amazon Godiva, Nike) has been a throwaway script. There is **no repeatable extraction-regression suite**, no corpus, no golden expectations, and no record of quality over time.
- The hardest extraction failure modes — *wrong-but-non-null cached paths, overfit selectors, stale `lastValue` examples* — silently survive resolution-rate metrics, so a "looks fine" report can hide real rot.

We protect extraction quality first. Code/UX hygiene comes along but isn't the centre.

---

## Strategy in one sentence

**Two tiers, three channels, one documented home:** a deterministic *fixture-replay gate* (runs on every change, no LLM/network) plus an *on-demand live dogfood harness* (the real pipeline + an LLM-as-judge), driven from the **CLI** and the **agent** ("you"); a **web** smoke E2E rides along as a smaller secondary layer. Strategy + fixtures + results live in `docs/testing.md` and a committed corpus + per-run results log.

---

## Tier 1 — Deterministic fixture-replay gate

Runs on every workspace test invocation. **Free, deterministic, fast.** This is the safety net under refactors.

### Fixture format

Each fixture is a single committed JSON file capturing the *deterministic inputs* of one real page, plus the learned selectors and golden expectations:

```jsonc
// packages/scraper/src/__fixtures__/corpus/<site>-<page-shape>.json
{
  "label": "amazon-godiva-detail",
  "url": "https://www.amazon.com/Godiva-…",
  "domain": "www.amazon.com",
  "pageType": "detail",
  "capturedAt": "2026-05-22T…",
  "html": "<html>…</html>",
  "structuredData": { /* same shape as PageCapture.structuredData */ },
  "interceptedRequests": [ /* JSON-bearing intercepted requests we want to test */ ],
  "fieldPaths": { /* the DomainCache.fieldPaths for this (domain, pageType) at capture time */ },
  "expected": {
    "product_name": "Godiva Gold Assorted Chocolate Gift Box, …",
    "rating": 4.15,
    "size_options": "30 Pieces",
    "upc": null,
    "asin": null
    /* exact known-correct values for fields we care about; null = legitimately not on page */
  }
}
```

No screenshots in Tier 1 fixtures (the deterministic chain doesn't use them — that keeps fixtures lean and committable). Seed corpus: the sites we already extracted (Amazon Godiva, Nike Air Jordan, IKEA pillow). Add new fixtures whenever a real bug is found.

### What Tier 1 asserts

Replay the non-AI chain against each fixture and assert resolved values equal `expected`:

- **Pure-function checks (fast vitest, no browser):**
  - Mechanical/structured-data flattening (`extractFromStructuredData`).
  - Cached API dot-paths against the fixture's `interceptedRequests` (`resolveApiPathsFromCache`).
  - `resolveFromCache` ranking + cross-validation across the fixture's `fieldPaths`.
  - `shape-validator`, `entity-subtree`, `data-quality` against fixture-derived inputs.
- **Cached-XPath replay (Playwright `setContent`, offline):** load `fixture.html` into a headless page via `page.setContent(html, { waitUntil: 'load' })`, run `buildCachedXPathScript(fixture.fieldPaths, fieldNames)` through `page.evaluate`. **Why Playwright over jsdom/linkedom:** Chromium's XPath engine is what runs in prod, so we don't get false greens from a partial DOM/XPath implementation. The page never loads anything — `setContent` is fully offline.

A new helper `runFixtureReplay(fixture)` in `packages/scraper/src/__fixtures__/replay.ts` exposes this end-to-end so each fixture's vitest is a one-liner:

```typescript
it('amazon-godiva-detail', async () => {
  const result = await runFixtureReplay(loadFixture('amazon-godiva-detail'));
  expect(result.resolved).toEqual(fixture.expected);
});
```

### Workspace gate hygiene

`pnpm -r test` is currently broken (agent/dashboard have a `vitest` script but no test files → exit 1). Fix once: change those scripts to `vitest --passWithNoTests`. After this, `pnpm -r test` becomes the green gate Tier 1 plugs into.

### Tier 1 explicitly does NOT

- Call any LLM (no determinism).
- Open any URL (no network).
- Assert AI-generated XPath quality (that's Tier 2, by definition).

---

## Tier 2 — Live dogfood + LLM-judge (CLI + agent channels)

A real CLI harness replacing all prior throwaway dogfood scripts. Run on demand by me (the "you" channel) or any operator. **Realistic, costs AI per run, not a gate.**

### Inputs

A committed manifest, e.g. `packages/scraper/src/__fixtures__/corpus/manifest.ts`:

```typescript
export const liveCorpus: Array<{
  label: string;
  url: string;
  pageType: 'detail' | 'listing';
  fields: string[];                       // field names to request (or 'discover' to let analyze propose)
  knownAbsentFields?: string[];           // fields we expect to be NOT on the page (e.g. 'upc' on Amazon)
}> = [
  { label: 'amazon-godiva',  url: 'https://www.amazon.com/…',  pageType: 'detail', fields: ['discover'], knownAbsentFields: ['upc'] },
  { label: 'nike-air-jordan', url: 'https://www.nike.com/…',    pageType: 'detail', fields: ['discover'] },
  /* …grow as we find new failure modes… */
];
```

### What Tier 2 runs

For each manifest entry, the harness calls the **real tRPC `extract` procedure** via the `createCallerFactory(appRouter)({ db })` caller (same path the dashboard uses). Then, for each resolved field, it calls a small LLM-judge:

> *"Here is a screenshot of the page. The extractor returned `{field}` = `{value}` (source: `{source}`). Is this the correct value for `{field}` on this page? Reply `correct` / `wrong` / `not-on-page`."*

The judge runs against the page's first screenshot tile (already captured for free during `extract`). Each judge call is one cheap Claude call. Resolved-but-`wrong` fields are the high-signal output (the `diet_type`=title case).

### Output — a timestamped report

Append a per-run Markdown file to `docs/testing/results/YYYY-MM-DD-HHMM-dogfood.md` with:

- Per-site: resolution rate (`X/Y`), per-field rows `[verdict] field = value (source)`, flagged `resolved-but-wrong` list.
- Aggregate: total resolved, total wrong, total not-on-page, total absent (matched `knownAbsentFields`).
- Diff vs the previous run's report when both exist (resolution-rate delta, newly-wrong fields).

Reports are diffable text — quality drift becomes a `git log` of `docs/testing/results/`.

### Tier 2 does NOT

- Gate commits (flaky/costly).
- Block on a judge miss (judge is a hint, not ground truth — its verdict goes in the report).

---

## Web channel — dashboard smoke E2E (secondary)

One Playwright test that drives the SPA: `sandbox` → paste URL → analyze → extract → assert the results table renders rows for the toggled fields. Uses one Tier 1 fixture served via `page.setContent` (no live network). Lives in `packages/dashboard/tests/e2e/`. Single test, single fixture — explicitly a smoke, not full coverage. Bigger E2E is deferred until a UI behaviour actively regresses.

---

## Documentation — where + how

- **`docs/testing.md`** — *canonical strategy.* Sections: the two tiers, how to run each (`pnpm test`, `pnpm dogfood`), the channels, where fixtures live, where results live, how to add a new fixture, how to interpret a judge verdict.
- **`packages/scraper/src/__fixtures__/corpus/`** — Tier 1 fixture JSONs + the Tier 2 `manifest.ts`. Single source of truth for "what we test against."
- **`docs/testing/results/`** — per-run Tier 2 reports. Committed (diffable history of real-world quality over time).
- **`docs/roadmap.md`** — a new "Testing & Quality Harness (IN PROGRESS)" section recording the initiative + pointer to this spec.

A new fixture's lifecycle is one paragraph in `docs/testing.md`: capture the page once (a `pnpm capture-fixture <url>` helper writes the JSON), fill in `expected`, commit. A new live URL is one entry in `manifest.ts`.

---

## Phases (the plan will sequence)

- **P1 — foundation gate.** Fix `pnpm -r test` (`--passWithNoTests` on agent/dashboard). Build the fixture format, `runFixtureReplay` helper (Playwright `setContent` for cached-XPath replay), and seed with one fixture (Amazon Godiva) to prove the loop. Write `docs/testing.md` (strategy section + "how to add a fixture"). Roadmap entry. Outcome: a green gate + one regression-protected real page.
- **P2 — live dogfood.** CLI harness + `manifest.ts` + LLM-judge + Markdown report writer + `docs/testing/results/` log. Run it once to seed the first real-world report. Outcome: repeatable on-demand quality measurement with auto-flagged wrong values.
- **P3 — corpus growth + web smoke.** Add 2–3 more Tier 1 fixtures (Nike, IKEA) and the dashboard smoke E2E. Outcome: the harness has bite across multiple page shapes.

P1 is the foundational deliverable; P2 and P3 layer on top.

---

## Out of scope (deferred)

- **Recorded LLM responses (VCR cassettes)** — would make Tier 2 fully deterministic but adds upkeep + masks real drift. We chose the two-tier split instead.
- **CI service (GitHub Actions etc.)** — there's no remote configured; "the gate" is `pnpm -r test` run locally / pre-commit. Wire CI when a remote exists.
- **Performance/load testing** — not the current risk.
- **Full dashboard E2E coverage** — only a smoke test for now.

---

## Success criteria

- `pnpm -r test` is green and runs Tier 1 across every relevant package on every change.
- Adding a new fixture (capture + golden + commit) is documented and takes < 10 minutes.
- One Tier 2 dogfood run produces a committed Markdown report with judge verdicts; the next run produces a diffable second report.
- A regression that breaks a cached path on a real page (e.g. a future agent prompt change that makes a selector overfit) is caught by Tier 1 — a red test, not a runtime miss.
