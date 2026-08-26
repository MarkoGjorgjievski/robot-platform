# MVP Simplification Implementation Plan — Declared Sources + Probe-Confirm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user declares listing vs detail (no guessing), multi-listing sources probe their first listing and gate on human confirmation before scaling, and the sandbox/graduate world is deleted.

**Architecture:** Declared `listing_mode` becomes `runAnalysis`'s required input (cache key = domain + declared type; the dual-cache arbitration is deleted). Listing analyze reuses `runExtraction` with an injected capture to report rows/pagination/samples. Probe = `crawl.plan` scoped to the first input row with a fixed probe budget + `crawl.execute` with a new item limit. Confirmation persists as `sources.confirmed_at` and unlocks full-budget planning. The sandbox router/routes/graduate flow are removed; the wizard UI is reborn on the Source page.

**Tech Stack:** TypeScript ESM, Drizzle/PostgreSQL, vitest, tRPC v11 + Zod, TanStack Router/Query, Tailwind v4 design system (`card`, `micro-label`, `btn-primary`, `btn-quiet`, accent tokens).

**Spec:** `docs/superpowers/specs/2026-08-26-mvp-simplification-design.md`

## Global Constraints

- All packages ESM (`"type": "module"`); imports end in `.js` inside src. No new npm dependencies.
- Postgres running (`docker start robot-platform-db`). After every task: `pnpm -r test` green, `pnpm typecheck` green, `pnpm --filter @robot/dashboard exec tsc --noEmit` clean (repo typecheck skips the dashboard), and the cache-hygiene gate returns zero rows:
  `docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select domain, page_type from domain_intelligence where domain in ('example.com','listing.example') or domain like 'test-%';"`
- TDD: behavior changes start with a failing test, watched to fail. Deletion tasks delete the covering tests in the same commit.
- Probe budget is exactly `{ max_pages: 3, max_items: 30, mode: 'first_n' }` (constant `PROBE_BUDGET`). Probe sample extraction limit is exactly `3` (constant `PROBE_SAMPLE_LIMIT`).
- Probe runs are ordinary runs with `input_label = 'probe'` — no new run states.
- Soft validator thresholds: listing warning when `rowsFound <= 2 && paginationStrategy === null`; detail warning when JSON-LD carries `ItemList`/`CollectionPage` `@type`.
- Blocked-page handling (`checkPageHealth`, `blockedReason`) and per-field example provenance are KEPT and extended, never weakened.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; one focused commit per task. Shell is Windows PowerShell 5.1 — no `&&` chaining.
- NO live/paid runs in Tasks 1–11. Task 12 is the live proof and STOPS for Marko's explicit go.

---

### Task 1: `confirmed_at` column + the Scratch project

**Files:**
- Modify: `packages/db/src/schema.ts` (sources table)
- Create: migration via drizzle-kit + one data-migration SQL
- Modify: seed script if it names the sandbox project (`packages/db/src` — grep `sandbox` to find it)

**Interfaces:**
- Produces: `sources.confirmedAt: timestamp | null` (Drizzle property `confirmedAt`, column `confirmed_at`).
- Produces: the seeded sandbox project renamed — `name: 'Scratch'`, `slug: 'scratch'`.

- [ ] **Step 1: Schema edit.** In `sources` (schema.ts), next to `isSandbox`, add:

```ts
  // Set when a human confirmed this source's probe run looked right (spec §3).
  // Null = unconfirmed: the first Extract probes the first input and gates.
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
```

- [ ] **Step 2: Generate + apply.**

```powershell
pnpm --filter @robot/db exec drizzle-kit generate --name source_confirmed_at
pnpm db:migrate
```

Inspect: exactly one additive `ALTER TABLE "sources" ADD COLUMN "confirmed_at" timestamp with time zone;`.

- [ ] **Step 3: Scratch rename (data).** Append to the SAME generated migration file (data travels with schema history):

```sql
--> statement-breakpoint
UPDATE "projects" SET "name" = 'Scratch', "slug" = 'scratch' WHERE "slug" = 'sandbox';
```

Re-run `pnpm db:migrate`; verify: `select slug, name from projects where slug in ('sandbox','scratch');` shows only `scratch | Scratch`. Grep the db package's seed for `'sandbox'` and update the seeded slug/name to scratch so a fresh install matches.

- [ ] **Step 4: Verify + commit.** `pnpm -r test`, hygiene gate, `pnpm typecheck`.

```powershell
git add packages/db
git commit -m "feat(db): sources.confirmed_at + Scratch project (mvp-simplification task 1)"
```

---

### Task 2: `crawl.execute` item limit

**Files:**
- Modify: `packages/api/src/crawl/execute-run.ts` (`executeRun(runId, deps)` — the `for (;;)` loop at ~line 51)
- Modify: `packages/api/src/routers/crawl.ts` (`execute` procedure input + `startExecution` threading)
- Test: `packages/api/src/routers/crawl-execute.test.ts` (extend, follow its existing fake-deps pattern)

**Interfaces:**
- Produces: `executeRun(runId: string, deps: ExecuteDeps, opts?: { limit?: number })` — stops claiming once `extracted + failed >= limit`; run finalises normally (remaining items stay `pending`, status derives from the DB as today, i.e. a limited run ends `partial`/`cancelled`-style semantics unchanged — it ends with pending items and the existing roll-up handles that exactly like a cancel-between-items does).
- Produces: `crawl.execute` input gains `limit: z.number().int().positive().max(100).optional()`, threaded through `startExecution(runId, sourceId, schema, limit?)`.

- [ ] **Step 1: Failing test** (in crawl-execute.test.ts, using its existing claim/extractItem fakes):

```ts
it('stops after opts.limit items and leaves the rest pending', async () => {
  // Fake claim serves 5 items; limit 2 → exactly 2 extractItem calls, then finalise.
  const claimed: string[] = [];
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }) as never);
  let i = 0;
  const outcome = await executeRun('run-1', {
    claim: async () => { const it = items[i] ?? null; if (it) { i++; claimed.push((it as { id: string }).id); } return it; },
    extractItem: async () => ({ extractionId: 'x' }),
    recordOutcome: async () => {},
    isCancelled: async () => false,
    finalise: async () => 'partial',
  } as never, { limit: 2 });
  expect(claimed).toEqual(['a', 'b']);
  expect(outcome.extracted).toBe(2);
});
```

(Adapt the deps literal to `ExecuteDeps`' real property names — read the type first; assertions stay identical.)

- [ ] **Step 2: RED** — `pnpm --filter @robot/api exec vitest run src/routers/crawl-execute.test.ts`.
- [ ] **Step 3: Implement.** In the loop, before `deps.claim`: `if (opts?.limit !== undefined && extracted + failed >= opts.limit) break;`. Thread `limit` from the procedure input → `startExecution` → `executeRun`.
- [ ] **Step 4: GREEN**, full gates, commit `feat(api): crawl.execute item limit (mvp-simplification task 2)`.

---

### Task 3: `crawl.plan` probe mode

**Files:**
- Modify: `packages/api/src/routers/crawl.ts` (`plan` procedure, ~113; run insert; the planRun call at ~151)
- Test: extend `packages/api/src/routers/crawl.test.ts` (follow its existing plan-procedure test pattern)

**Interfaces:**
- Produces: `crawl.plan` input gains `probe: z.boolean().optional()`. When true: `inputSet.rows` passed to `planRun` is `[rows[0]]`, the budget passed is `PROBE_BUDGET` (exported const `{ max_pages: 3, max_items: 30, mode: 'first_n' }`), and the run row is created with `inputLabel: 'probe'`.
- Produces: `export const PROBE_BUDGET` and `export const PROBE_SAMPLE_LIMIT = 3` from `packages/api/src/crawl/probe.ts` (new tiny module, imported by the router and later by the UI-facing procedures).

- [ ] **Step 1: Failing tests** — two cases in crawl.test.ts: (a) `probe: true` with a 3-row input set → the planRun stub receives exactly 1 row and `PROBE_BUDGET`; the created run row has `input_label = 'probe'`; (b) `probe` absent → all rows and the source's own budget (regression lock). Write them against the file's existing stubbing pattern for `planRun`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — in the `plan` mutation:

```ts
      const probe = input.probe === true;
      const rows = (inputSet.rows ?? []) as Array<Record<string, unknown>>;
      const planRows = probe ? rows.slice(0, 1) : rows;
      const planBudget = probe ? PROBE_BUDGET : source.budget;
```

thread `planRows`/`planBudget` into the existing planRun args; add `inputLabel: probe ? 'probe' : null` to the run insert.

- [ ] **Step 4: GREEN**, gates, commit `feat(api): probe-scoped planning (mvp-simplification task 3)`.

---

### Task 4: `runAnalysis` declared type — the deletion

**Files:**
- Modify: `packages/scraper/src/analysis-orchestrator.ts`
- Modify: `packages/scraper/src/cached-fields-from-cache.ts` (+ its test) — per-field example provenance
- Modify: `packages/api/src/routers/scraper.ts` (`analyze` input gains required `pageType`)
- Test: rewrite `packages/scraper/src/analysis-orchestrator.test.ts` sections that covered arbitration

**Interfaces:**
- Produces: `runAnalysis(request: { url: string; pageType: 'detail' | 'listing'; requestedFields?: string }, deps)` — pageType REQUIRED.
- DELETES: the dual-cache lookup (`Promise.all` of both types), the `caches` array, the multi-candidate `resolveLiveValues` voting loop in `analyzeFromCache` (the function reverts to ONE cache: lookup `(domain, request.pageType)` only; `resolveLiveValues` itself stays — single call). `liveExamples`/`blockedReason` semantics unchanged.
- Produces: `CachedFieldSummary` gains `example_source: 'live' | 'cached'` — `'live'` when `liveValues[name] !== undefined`, else `'cached'`. (`cachedFieldsFromCache` already receives `liveValues`; it decides per field.)
- Note: this task covers the DETAIL path; pageType `'listing'` may temporarily route to the same cache-replay flow — Task 5 gives it its real flow. Tests for listing behavior land in Task 5.

- [ ] **Step 1: Failing tests.** Rewrite the "domain cached under BOTH page types" describe: (a) `pageType: 'detail'` on that dual-cache domain returns the DETAIL cache even when listing paths resolve better (declaration wins — the exact inversion of the deleted behavior; assert `page_type === 'detail'`); (b) `pageType: 'listing'` returns the listing cache; (c) `runAnalysis` without `pageType` is a TYPE error — enforce by signature, not runtime (delete any test calling without it). Add to cached-fields tests: a field with a live value gets `example_source: 'live'`, one falling back to `lastValue` gets `'cached'`.
- [ ] **Step 2: RED** (compile errors count as RED for the signature change; behavior tests must fail for behavior reasons).
- [ ] **Step 3: Implement.** `runAnalysis`: `const cache = await lookupCache(domain, request.pageType).catch(() => null);` — delete the arbitration block; `analyzeFromCache` takes `cache: DomainCache` (singular) again, keeps blocked/health/liveExamples handling, single `resolveLiveValues` call. `scraper.ts` analyze input: `pageType: z.enum(['detail', 'listing'])` (required). Fix the one other caller (`sandbox.ts` — passes `source.listingMode === 'listing_to_detail' ? 'listing' : 'detail'`; this file dies in Task 11 but must compile until then).
- [ ] **Step 4: GREEN**, gates, commit `feat(scraper,api)!: runAnalysis requires the declared page type; arbitration deleted (mvp-simplification task 4)`.

---

### Task 5: Listing analyze

**Files:**
- Modify: `packages/scraper/src/analysis-orchestrator.ts` (new `runListingAnalysis` branch)
- Test: Create `packages/scraper/src/analysis-orchestrator-listing.test.ts` + a Tier-1-style test against the real corpus fixtures

**Interfaces:**
- Produces: when `pageType === 'listing'`, `runAnalysis` returns the standard `AnalysisOutcome` plus `listing: { rowsFound: number; paginationStrategy: string | null; sampleDetailUrls: string[] }` (optional field on `AnalysisOutcome`, absent for detail).
- Mechanism (reuse, not new machinery): capture once (health-checked exactly like the detail path — blocked ⇒ `blockedReason`, no listing report). Fields: the `(domain,'listing')` cache's fields when present, else `agent.discoverSchema(capture)` fields; ALWAYS ensure a `detail_url` field (`{ name: DETAIL_URL_FIELD, type: 'url', rowScopedOnly: true }` — import `DETAIL_URL_FIELD` from `./crawl/enumerate-detail-urls.js`, mirroring how `plan-run.ts` builds its listing fields — read that block and copy its shape). Then `runExtraction({ url, fields, pageType: 'listing' }, { browser, agent, capture, lookupCache, saveCache })` with the SAME capture injected (no second navigation): `rowsFound = outcome.rows?.length ?? 0`; `sampleDetailUrls` = first 5 rows' `DETAIL_URL_FIELD` values (strings only); `paginationStrategy` = `detectPaginationFromHtml(capture.html, url)?.strategy ?? null` (import from `@robot/browser`).
- The schema shown to the user = the listing fields with examples from the FIRST row's values (live) — reuse the example plumbing with row 0 as `liveValues`.

- [ ] **Step 1: Failing tests.** Unit: stubbed browser/extract → outcome carries `listing.rowsFound`, `sampleDetailUrls`, `paginationStrategy` from a fake capture with a `rel=next` link. Fixture: load `packages/scraper/src/__fixtures__/corpus/newegg-gpu-listing.json` and `abebooks-search-listing.json`, run `runAnalysis` with `pageType: 'listing'` and a browser stub whose `capture` returns the fixture and whose `evaluate`/`setContentEvaluate` route through `setContentEvaluate` real-Chromium style ONLY if the existing fixture harness already does this cheaply — otherwise stub extraction with the fixture's known rows and assert the report plumbing (state which you did in the report). Assert: `rowsFound > 0` for abebooks (real page with 30 rows), `paginationStrategy === 'url-pattern'` for abebooks (its `<link rel=next>` — verified earlier in pagination-detector-real-pages.test.ts).
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN**, gates, commit `feat(scraper): listing analyze — rows, pagination, sample urls (mvp-simplification task 5)`.

---

### Task 6: Soft validator

**Files:**
- Create: `packages/scraper/src/page-hints.ts` + `page-hints.test.ts`
- Modify: `analysis-orchestrator.ts` (attach hints), `AnalysisOutcome` gains `hints: string[]` (always present, often empty)

**Interfaces:**
- Produces: `listingHints(rowsFound: number, paginationStrategy: string | null): string[]` — returns the hub warning (exact copy from spec §2) when `rowsFound <= 2 && paginationStrategy === null`, else `[]`.
- Produces: `detailHints(ldJson: unknown[]): string[]` — returns the looks-like-a-listing warning when any block's `@type` (string or array) includes `ItemList` or `CollectionPage`, else `[]`.

- [ ] **Step 1: Failing tests** — four cases each (fires / doesn't / boundary: rowsFound 3 no-pagination → no warning; `@type: ['Thing','ItemList']` array form → fires).
- [ ] **Step 2: RED. Step 3: implement (pure functions + attachment in both analyze paths). Step 4: GREEN**, gates, commit `feat(scraper): soft page-type hints (mvp-simplification task 6)`.

---

### Task 7: Source-scoped API — quickCreate, analyze, confirm

**Files:**
- Modify: `packages/api/src/routers/sources.ts`
- Modify: `packages/api/src/routers/crawl.ts` (schema fallback, below)
- Test: extend `packages/api/src/routers/` tests following `domains.test.ts`'s live-DB + cleanup pattern (test slugs prefixed `test-`)

**Interfaces (three procedures):**
- `sources.quickCreate({ mode: z.enum(['listing','detail']), urls: z.array(z.string().url()).min(1).max(50) })` → creates: an InputSet (columns `[{name:'url', primary:true}]`, one row per url) in the Scratch project's dataset; a Source in that dataset with `listingMode: mode === 'listing' ? 'listing_to_detail' : 'detail'`, `inputStrategy: 'direct'`, `urlTemplate: urls[0]`, name `"{hostname} {pathname-of-first-url}"` truncated to 255, default budget for listing sources `{ max_items: 40, max_pages: 3, mode: 'first_n' }`. Returns `{ sourceId, projectSlug: 'scratch', sourceSlug }`. Resolve the Scratch project/dataset by slug `'scratch'`; if the project has no dataset yet, create one (`name: 'Scratch'`, empty schema).
- `sources.analyze({ sourceId })` → loads the source, calls `scraperRouter`'s analyze with `pageType` derived from `listingMode`, persists the result to `sources.selectorsJson` in the SAME payload shape the sandbox analyze used (fields, pageType, cached, liveExamples, blockedReason, captureId, screenshotUrl — plus `listing` and `hints` pass-through), returns the payload. (Port the body from `sandbox.ts`'s analyze — this is its new home; sandbox.ts itself dies in Task 11.)
- `sources.confirm({ sourceId })` → sets `confirmedAt: new Date()`, then invokes the crawl `plan` flow at FULL budget (`probe: false`) and returns `{ runId }`. Implement by extracting `crawl.ts`'s plan body into an exported `planSource(db, sourceId, { probe })` helper both procedures call — no duplicated planning logic.
- **Schema fallback (both `crawl.ts` plan and `extract-item.ts`):** where the dataset schema array is read, fall back to `source.selectorsJson.fields` (enabled ones) when the dataset schema is empty — Scratch sources carry their schema on the source. One helper `effectiveSchema(source)` in `packages/api/src/crawl/effective-schema.ts`, unit-tested (dataset schema wins when non-empty; selectorsJson fields map `{name, type}`; disabled fields excluded).

- [ ] **Step 1: Failing tests** — quickCreate happy path (source+inputset rows created, listing defaults), analyze persistence shape, confirm sets confirmedAt and plans full (stub planSource), effectiveSchema unit cases.
- [ ] **Step 2: RED. Step 3: implement. Step 4: GREEN**, gates, commit `feat(api): quickCreate/analyze/confirm on sources + effective schema (mvp-simplification task 7)`.

---

### Task 8: Probe orchestration + diagnosis mapping (pure)

**Files:**
- Create: `packages/dashboard/src/lib/diagnose-run.ts` + `diagnose-run.test.ts`
- Create: `packages/api/src/crawl/probe.ts` additions if Task 3 left any (constants live here)
- Modify: `packages/api/src/routers/crawl.ts` — `probeAndSample({ sourceId })` procedure: `planSource(db, sourceId, { probe: true })` then fire-and-forget `startExecution(..., limit: PROBE_SAMPLE_LIMIT)`; returns `{ runId }`.

**Interfaces:**
- Produces: `diagnoseRun(input: { warnings: string[]; errors: Array<{ message: string }>; blockedReason?: string | null; rowsFound?: number | null; itemFailures: Array<{ url: string; error: string | null }> }): Array<{ severity: 'blocked' | 'wrong-page' | 'pagination' | 'dead-link' | 'extraction'; title: string; detail: string }>` — pure mapping, priority-ordered per spec §3 diagnosis list. Match machine strings: blockedReason/`Page blocked or unusable` → blocked; `no pagination detected` → pagination hub case; `gained only` + `re-serving page 1` → pagination broken; `404`/`Not Found` → dead-link; per-item errors → extraction entries verbatim.
- [ ] **Step 1: Failing tests** — one per diagnosis class with realistic machine strings (copy exact warning texts from `plan-run.ts` and the blocked-page error), plus ordering (blocked outranks pagination when both present) and empty input → [].
- [ ] **Step 2: RED. Step 3: implement both. Step 4: GREEN**, gates, commit `feat(api,dashboard): probe orchestration + run diagnosis mapping (mvp-simplification task 8)`.

---

### Task 9: Home flow UI

**Files:**
- Rewrite: `packages/dashboard/src/routes/landing.tsx`
- Test: none beyond `tsc` (route smoke covers render when dev server up); keep any pure logic in `src/lib` with tests if it grows

Landing becomes the two-choice flow, design-system styled:
- Mode toggle (two large selectable cards): **Listing pages** — "Pages that list many products. We'll find every product and crawl them." / **Product pages** — "Direct product URLs. We extract each one."
- One `<textarea>` (mono), placeholder per mode (`https://www.ikea.com/us/en/cat/sofas-…` newline `…/chairs-…`), parse non-empty lines, client-validate each with `new URL`.
- Submit (`btn-primary`): `sources.quickCreate` → navigate to the source workspace route (`/p/$project/sources/$source` with returned slugs). Keep the eyebrow/hero styling from the current landing.
- [ ] Implement, `pnpm --filter @robot/dashboard exec tsc --noEmit` + dashboard tests green, commit `feat(dashboard): declared-mode home flow (mvp-simplification task 9)`.

---

### Task 10: Source workspace + confirm gate UI

**Files:**
- Modify: `packages/dashboard/src/routes/source-detail.tsx` (+ a new `source-setup.tsx` tab content — port from `sandbox-detail.tsx`, do NOT delete sandbox files yet)
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx` (confirm gate + diagnosis panel)
- Modify: `packages/dashboard/src/components/results-table.tsx` consumers as needed

The workspace (Set up tab, default for sources with no completed run):
- Header: declared-mode chip (`LISTING` accent / `DETAIL` gray — declaration, never guess language), URL count.
- After `sources.analyze`: for LISTING — the report line (`N product rows · pagination: url-pattern · sample of enumerated URLs` from `schema.listing`), hints rendered as amber notes, fields table with per-field example badges: `example_source === 'cached'` → dimmed value + `earlier run` micro-badge; blocked banner logic ported as-is.
- Extract button, mode-aware: detail source → `crawl.plan` (probe:false) + `crawl.execute` (limit = row count) then link to run; listing + unconfirmed → `crawl.probeAndSample` → navigate to the probe run; listing + confirmed → full plan via `sources.confirm`-style path (plan only, Extract-pending flow as today's run page).
- Run detail page confirm gate: when the run's `inputLabel === 'probe'` and the source is unconfirmed, render above the work list: evidence summary (pages walked, strategy from the run's data, items found), the sample extracted rows (existing results plumbing), and the gate — **"Is this the desirable path?"** with `btn-primary` **Yes, crawl everything** (`sources.confirm` → navigate to the new full run) and `btn-quiet` **Something's wrong** → reveals the `diagnoseRun` panel + links: edit URLs (inputs tab), switch mode (config), delete source.
- [ ] Implement; dashboard `tsc` + tests green; screenshot the workspace and the confirm gate against the dev server for self-review (empty-state sanity: no crash when analyze hasn't run). Commit `feat(dashboard): source workspace + probe confirm gate (mvp-simplification task 10)`.

---

### Task 11: The scrub

**Files (delete):** `packages/dashboard/src/routes/sandbox-index.tsx`, `sandbox-detail.tsx`, `packages/dashboard/src/components/graduate-form.tsx`, `packages/api/src/routers/sandbox.ts`, `sandbox.test.ts`, all `/sandbox` route registrations (`router.tsx`), the header nav Sandbox link (`layout.tsx`), `is_sandbox` filters (`projects-list.tsx` filter, `domains.ts` router `isSandbox` where-clauses — sources in Scratch now appear like any other), and the routers index registration.

- [ ] **Step 1:** Grep-driven removal: `sandbox|isSandbox|is_sandbox|Graduate|graduate` across `packages/api/src` and `packages/dashboard/src`; delete/adjust every hit EXCEPT the db column definition and migrations. Router index and route tree must compile.
- [ ] **Step 2:** Delete the tests that covered deleted behavior; run `pnpm -r test`, both typechecks, hygiene gate — all green with the feature gone.
- [ ] **Step 3:** Docs: handoff.md gets the "sandbox deleted, declared sources shipped" entry; roadmap.md marks v1.5's sandbox items as superseded-by this spec and checks off "progressive confidence (MVP shape: probe-confirm)" with a pointer; CLAUDE.md's dashboard description line updated if it names the sandbox.
- [ ] **Step 4:** Commit `feat!: delete the sandbox/graduate world (mvp-simplification task 11)`.

---

### Task 12: Live proof — STOPS FOR MARKO

- [ ] **Step 1 (no spend):** pick two capturable listing URLs on ONE domain — AbeBooks two searches (e.g. `kn=python` and `kn=javascript` SearchResults URLs) are the proven-capturable choice; confirm with the free `scroll-probe`/capture check if in doubt. Create the source through the NEW home flow (real UI, not SQL).
- [ ] **Step 2 (REQUIRES MARKO'S EXPLICIT GO — spends: 1 probe ≈ 2-3 listing pages + 3 detail extractions + analyze):** Analyze → probe → review the confirm gate with real evidence → Marko clicks through Yes → bounded full crawl (source budget `{max_items: 40, max_pages: 3}` per listing) → verify: both listings walked, dedupe across them, results/export sane. Record run ids + outcomes in handoff.md.
- [ ] **Step 3:** Also demonstrate the No path once against a deliberately wrong URL (a detail URL declared as listing — free-ish: one capture + no confirm) and screenshot the diagnosis panel.

---

## Self-review notes (already applied)

- Spec coverage: §1→Tasks 1,7,9; §2→Tasks 4,5,6 (+provenance in 4); §3→Tasks 2,3,7,8,10; §5 deletions→Task 11; §6 UI→Tasks 9,10; §7 testing→in-task + fixtures in 5; §8 rollout order preserved (schema → scraper → api → UI → scrub → live).
- Sandbox.ts must keep compiling through Tasks 4–10 (Task 4 patches its call) and dies whole in Task 11 — no mid-plan breakage.
- All constants (`PROBE_BUDGET`, `PROBE_SAMPLE_LIMIT`, validator thresholds, default listing budget) appear once in Global Constraints and once at their defining task — values identical.
- No task requires a later task to leave the system consistent; probe/confirm API (7–8) works headless before the UI (9–10) exists.
