# MVP Flow Phase 4: Extract Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give extraction its own tab as a three-section stepper (Pages, Sample, Run) where nothing disappears: several listing pages or a list of product URLs go in, each listing is checked for free, a sample proves the walk, and one sentence with two dropdowns sets how much to run. Verify stays on the Schema tab; the listing URL leaves it for good.

**Architecture:** The engine already has everything except two small extensions: a budget value of `'all'` for pages (mapped to the existing ten-page burst ceiling) and a listing check that returns a count and whether a pager was seen (the existing link harvest plus the existing pager detector). The API gains `sources.setListingPages`, `sources.setProductUrls`, `sources.checkListingPage`, and a `budget` field on `sources.update`; `updateBinding` stops touching the input set when the source has an explicit input mode. The dashboard gains an `extract` route with a pure view module, a stepper, and three section components; the probe confirm gate on the run page is reused as the Sample section's data source (`crawl.items` + `probeEvidence`) rather than duplicated. The Overview tab is retired in favour of Extract in the tab bar (its content stays reachable through Runs).

**Tech Stack:** React 19, TanStack Router/Query, tRPC 11, Zod, Drizzle on PostgreSQL, Tailwind v4, lucide-react, Vitest, Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` sections 5.7 (all), 8 (`setListingPages`, `setProductUrls`, `checkListingPage`, the budget shape), 9 (unbounded pages, the link harvest extension), 6, 10, 12 (phase 4). Approved mockups: `.superpowers/brainstorm/1289-1788861057/content/extract-v3.html` (the stepper, both moments) and `extract-v5-run.html` (the Run sentence). Decisions from the brainstorm that bind: several listing pages, not one; the sample walks the first listing only; "all" is the default for both products and pages; nothing on the tab disappears, sections lock with Edit.

## Global Constraints

- The Extract tab is a stepper with three always-rendered sections: 1 Pages, 2 Sample, 3 Run. A passed section locks and shows an Edit link; a not-yet-reached section is dimmed with a one-line reason. Content is never replaced by different content on the same screen. After a run starts, section 3 shows the run's progress line and a link to it.
- Section 1 has a segmented control: "Listing pages" or "Product URLs". Listing pages is a small table, one row per URL, checked automatically when added (one page load, no AI, nothing saved until the section is saved): "n product links · pager found" green, "n product links · no pager seen" amber, or an error. Product URLs is a textarea plus CSV import with a `url` column, with inline counts: total, how many are the proof pages, how many are off-host and will be skipped.
- Section 2 (listing mode only): "Sample 3 products" with the sentence "walks the first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free." After it runs: four facts (pages walked, product links found, pagination detected, sample rows complete) and the sample rows in the contract's columns; an empty cell is highlighted with "X was empty on n of m sampled pages. Extraction leaves such cells empty and counts them; it never guesses." Product-URL mode shows one line: "No sample needed, the pages are known."
- Section 3: `Run [all ▾] products across [all ▾] pages.` Each dropdown offers `all` and `custom`; `custom` reveals a number box after it. Both default to `all`. Under it: "n listings · safety stop at 5,000 products per run". Button "Extract". Unlock rule: listing mode after a sample exists; product-URL mode as soon as the schema is fully green.
- Locked tab: when the schema is not fully green, every section is dimmed and a strip says "Extraction is locked · n of m fields verified · fix <field> on the Schema tab" with a link.
- Budget: `sources.budget` accepts `{ max_items: number | 'all', max_pages: number | 'all', mode }`. `'all'` items keeps the existing all mode; `'all'` pages resolves to `API_WALK_MAX_BATCH` (10), the existing single-burst ceiling, and the tab says so ("up to 10 pages per listing"). The 5,000 per-run item ceiling stays. Budget applies per listing input, as today.
- `updateBinding` (Schema tab) no longer rewrites the input set once the customer has set pages on the Extract tab: a new column-free marker, `sources.parameters.inputMode: 'listing' | 'detail' | undefined`, records that; when set, the binding save leaves rows and mode alone.
- Copy: sentence case; every button says what happens; every disabled control has a reason within one line; customer-facing text never says "source", "dataset", "input set". Visual tokens unchanged (phase 5).
- Only http(s) URLs (`httpUrl`) anywhere a browser navigates. No new dependencies.
- Tests: pure view logic in `packages/dashboard/src/lib/*.test.ts`; API tests hit the real database; `pnpm test:ui` covers the tab; gate is per-package with one worker on this machine (`pnpm --filter <pkg> test -- --maxWorkers=1`), or `pnpm -r --workspace-concurrency=1 test` where memory allows.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01AZ6EysmV6fcq3FxP33KFsw`. Windows, Git Bash; `npx pnpm` if the launcher fails.
- Budget rule for live checks: a Sample is free by construction (no AI) and may be run; a full Extract on a real site is not run in this phase.

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `packages/scraper/src/crawl/budget.ts` (+test) | `'all'` pages → `API_WALK_MAX_BATCH`; `Budget.pagesAll` flag for display | Modify |
| `packages/api/src/verify/find-product-pages.ts` (+test) | `describeListingPage(anchors, listingUrl, html)` → `{ productLinks, pagerSeen, sample }` | Modify |
| `packages/api/src/routers/sources.ts` | `checkListingPage`, `setListingPages`, `setProductUrls`; `update` accepts `budget`; `updateBinding` respects `inputMode` | Modify |
| `packages/api/src/routers/sources-extract.test.ts` | Tests for the four | Create |
| `packages/api/src/routers/sources-project.test.ts` | One assertion: binding save leaves explicit pages alone | Modify |
| `packages/dashboard/src/lib/extract-view.ts` (+test) | `stepState`, `listingCheckLabel`, `productUrlCounts`, `runSentence`, `budgetFrom/To` | Create |
| `packages/dashboard/src/lib/parse-url-lines.ts` | (exists) reuse for the textarea | — |
| `packages/dashboard/src/components/stepper.tsx` | The three-step strip + section shell (locked / current / later) | Create |
| `packages/dashboard/src/components/extract-pages.tsx` | Section 1 | Create |
| `packages/dashboard/src/components/extract-sample.tsx` | Section 2 (reads `crawl.items` + `probeEvidence`) | Create |
| `packages/dashboard/src/components/extract-run.tsx` | Section 3 | Create |
| `packages/dashboard/src/routes/source-extract.tsx` | Wiring | Create |
| `packages/dashboard/src/router.tsx`, `routes/source-detail.tsx` | `extract` route; tabs Schema / Extract / Runs / Settings; Overview unrouted | Modify |
| `packages/dashboard/src/routes/source-schema.tsx` | Extract button on the strip navigates to the Extract tab instead of running | Modify |
| `packages/dashboard/src/lib/legacy-routes.ts` (+test) | `/overview` → `/extract` | Modify |
| `packages/dashboard/src/routes-smoke.test.ts` | Extract route + locked state | Modify |
| `docs/handoff.md`, `docs/superpowers/specs/…-design.md` | phase note; the two spec corrections from phase 3 | Modify |

---

### Task 1: Budget accepts `'all'` pages

**Files:**
- Modify: `packages/scraper/src/crawl/budget.ts`; create `packages/scraper/src/crawl/budget.test.ts` if absent (check first)

**Interfaces:**
- Produces: `Budget = { maxPages: number; maxItems: number; mode: 'all' | 'first_n'; pagesAll: boolean }`; `resolveBudget({ max_pages: 'all' })` → `maxPages = PAGES_ALL_CEILING (10)`, `pagesAll = true`; `export const PAGES_ALL_CEILING = 10` (same value as `plan-run.ts`'s `API_WALK_MAX_BATCH`; import it from there if that creates no cycle, else define here and assert equality in the test by importing both).

- [ ] **Step 1: Failing test**

```ts
// packages/scraper/src/crawl/budget.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBudget, itemCap, PAGES_ALL_CEILING, HARD_ITEM_CEILING } from './budget.js';
import { API_WALK_MAX_BATCH } from './plan-run.js';

describe('resolveBudget', () => {
  it('defaults', () => expect(resolveBudget({})).toEqual({ maxPages: 3, maxItems: 50, mode: 'first_n', pagesAll: false }));
  it("'all' pages resolves to the single-burst ceiling and says so", () => {
    expect(resolveBudget({ max_pages: 'all', max_items: 'all' })).toEqual({ maxPages: PAGES_ALL_CEILING, maxItems: 50, mode: 'all', pagesAll: true });
    expect(PAGES_ALL_CEILING).toBe(API_WALK_MAX_BATCH);
  });
  it("'all' items is the existing all mode with the hard ceiling", () => {
    expect(itemCap(resolveBudget({ max_items: 'all' }))).toBe(HARD_ITEM_CEILING);
  });
  it('numbers still work', () => expect(resolveBudget({ max_pages: 4, max_items: 12 })).toMatchObject({ maxPages: 4, maxItems: 12, pagesAll: false }));
});
```

- [ ] **Step 2: Run, see it fail** — `pnpm --filter @robot/scraper exec vitest run src/crawl/budget.test.ts`.

- [ ] **Step 3: Implement**

```ts
/** "All pages" means the single-burst ceiling the walks already enforce (see API_WALK_MAX_BATCH), not an unbounded walk. */
export const PAGES_ALL_CEILING = 10;
export type Budget = { maxPages: number; maxItems: number; mode: 'all' | 'first_n'; pagesAll: boolean };

export function resolveBudget(raw: unknown): Budget {
  const b = (raw ?? {}) as Record<string, unknown>;
  const pagesAll = b.max_pages === 'all';
  const itemsAll = b.max_items === 'all' || b.mode === 'all';
  return {
    maxPages: pagesAll ? PAGES_ALL_CEILING : positiveInt(b.max_pages, DEFAULTS.maxPages),
    maxItems: positiveInt(b.max_items, DEFAULTS.maxItems),
    mode: itemsAll ? 'all' : DEFAULTS.mode,
    pagesAll,
  };
}
```

Keep `DEFAULTS` (add `pagesAll: false`), `itemCap`, `HARD_ITEM_CEILING`. If importing `API_WALK_MAX_BATCH` into `budget.ts` creates an import cycle (`plan-run.ts` imports `budget.ts`), keep the literal `10` in `budget.ts` and let the test assert equality.

- [ ] **Step 4: Run the crawl tests** — `pnpm --filter @robot/scraper exec vitest run src/crawl/ --maxWorkers=1` and typecheck. Fixtures that construct a `Budget` literal need `pagesAll: false`.

- [ ] **Step 5: Commit** — `feat(scraper): budget accepts 'all' pages, resolved to the single-burst ceiling`.

---

### Task 2: `describeListingPage` and `sources.checkListingPage`

**Files:**
- Modify: `packages/api/src/verify/find-product-pages.ts` (+ its test)
- Modify: `packages/api/src/routers/sources.ts` (add `checkListingPage` next to `findProductPages`)
- Create: `packages/api/src/routers/sources-extract.test.ts` (this task adds the `checkListingPage` describe; Tasks 3 and 4 add more)

**Interfaces:**
- `describeListingPage(anchors, listingUrl, html)` → `{ productLinks: number, pagerSeen: boolean, sample: string[] }` where `productLinks` is the size of the largest same-template group (before the `limit` cut), `sample` is the first ten, and `pagerSeen` is `detectPaginationFromHtml(html, listingUrl) !== null` (import from `@robot/browser`).
- `sources.checkListingPage({ listingUrl: httpUrl })` → the same shape; captures with `withBrowserSession` exactly as `findProductPages` does and passes `capture.html`.

- [ ] **Step 1: Failing tests** — pure: a fixture of anchors with one large group (12 links) and a small one, plus HTML containing `<link rel="next" href="?page=2">` → `{ productLinks: 12, pagerSeen: true, sample.length: 10 }`; the same without any pager markup → `pagerSeen: false`. Router: mock `withBrowserSession` (the pattern in `sources-schema.test.ts`) to return anchors + html and assert the shape; and `file:///x` is rejected by Zod.

- [ ] **Step 2: Run, see them fail.**

- [ ] **Step 3: Implement** — refactor `rankProductLinks` so the grouping is a shared helper `largestProductGroup(anchors, listingUrl): string[]`; `rankProductLinks` = `largestProductGroup(...).slice(0, limit)`; `describeListingPage` uses the group length, the first ten, and the detector. `checkListingPage` mirrors `findProductPages` but also returns the html to the ranker.

- [ ] **Step 4: Run + typecheck**; **Step 5: Commit** — `feat(api): sources.checkListingPage reports product links and whether a pager was seen`.

---

### Task 3: `setListingPages`, `setProductUrls`, `update` accepts `budget`, `updateBinding` respects `inputMode`

**Files:**
- Modify: `packages/api/src/routers/sources.ts`, `packages/api/src/routers/sources-extract.test.ts`, `packages/api/src/routers/sources-project.test.ts`

**Interfaces:**
- `sources.setListingPages({ sourceId, urls: httpUrl[] (1..50) })`: same-host as the binding's proof pages (when a binding exists) else same host as each other; writes the source's input set rows (`{ url }` each; creates the input set if missing, in the source's project), sets `listingMode: 'listing_to_detail'`, seeds `budget` with `{ max_items: 'all', max_pages: 'all', mode: 'all' }` only if the stored budget is empty, and sets `parameters.inputMode = 'listing'`. Refused with `PRECONDITION_FAILED` when `confirmedAt` is set and the mode would change.
- `sources.setProductUrls({ sourceId, urls: httpUrl[] (1..5000) })`: off-host URLs dropped (returned as `skipped`), rows written, `listingMode: 'detail'`, `parameters.inputMode = 'detail'`, same confirmed lock. Returns `{ accepted: number, skipped: string[] }`.
- `sources.update` gains `budget: z.object({ max_items: z.union([z.number().int().positive(), z.literal('all')]), max_pages: z.union([z.number().int().positive(), z.literal('all')]), mode: z.enum(['all', 'first_n']).optional() }).optional()`; stored as given.
- `updateBinding`: when `source.parameters?.inputMode` is set, skip the input-set sync entirely (rows, mode, budget) and keep the transaction for the schema write only.

- [ ] **Step 1: Failing tests** (real database; build sources with `createProjectWithSource` + `datasets.addField` as the phase 2 helper does): listing pages writes rows and mode and seeds the all/all budget; a second call with a different host is refused; product URLs drops an off-host URL into `skipped`; `update` stores `{ max_items: 40, max_pages: 'all' }`; a binding save after `setListingPages` leaves the three listing rows intact (the new assertion in `sources-project.test.ts`); the confirmed lock.

- [ ] **Step 2 to 5** — implement, run `sources-extract.test.ts`, `sources-project.test.ts`, `sources-binding.test.ts` with one worker, typecheck, commit `feat(api): listing pages and product URLs as the source's input; budget on update; binding save respects an explicit input mode`.

---

### Task 4: Pure view module `extract-view.ts`

**Files:**
- Create: `packages/dashboard/src/lib/extract-view.ts`, `extract-view.test.ts`

**Interfaces:**

```ts
export type StepState = 'locked' | 'current' | 'done' | 'later';
export type ExtractMode = 'listing' | 'detail';
export function stepStates(args: { schemaGreen: boolean; mode: ExtractMode | null; pagesSaved: boolean; sampleRun: { status: string } | null; running: boolean }): [StepState, StepState, StepState];
export function listingCheckLabel(check: { productLinks: number; pagerSeen: boolean } | { error: string } | null): { tone: 'ok' | 'warn' | 'error' | 'pending'; text: string };
export function productUrlCounts(lines: string[], proofUrls: string[], host: string | null): { total: number; proof: number; offHost: number };
export function runSentence(b: { items: number | 'all'; pages: number | 'all' }, listings: number): string;   // "3 listings · up to 10 pages per listing · safety stop at 5,000 products per run" / "first 3 pages of each"
export function budgetFromForm(items: number | 'all', pages: number | 'all'): { max_items: number | 'all'; max_pages: number | 'all'; mode: 'all' | 'first_n' };
export function budgetToForm(raw: unknown): { items: number | 'all'; pages: number | 'all' };
export function lockedStripText(args: { fieldCount: number; currentKeys: string[]; firstFailing: string | null }): string;  // "Extraction is locked · 4 of 5 fields verified · fix author_url on the Schema tab"
export function sampleFacts(evidence: { pagesWalked: number; itemsFound: number; paginationNote: string }, counts: { detail: number; done: number }): Array<{ label: string; value: string }>;
export function emptyCellNote(field: string, emptyOn: number, sampled: number): string;
```

Rules: `stepStates`: schema not green → all `locked`; no mode chosen or pages not saved → `['current','later','later']`; listing mode, pages saved, no sample → `['done','current','later']`; sample completed → `['done','done','current']`; detail mode, pages saved → `['done','done','current']` (section 2 renders the one-line note); `running` → `['done','done','done']`. `listingCheckLabel`: `null` → pending "checking…"; error → tone error with the message; pager → ok "n product links · pager found"; no pager → warn "n product links · no pager seen". `runSentence`: pages `'all'` → "up to 10 pages per listing"; number → "first n pages of each"; items `'all'` → nothing extra; number → "first n products from each"; always ends "safety stop at 5,000 products per run". `budgetToForm` maps a missing/legacy budget to `{ items: 'all', pages: 'all' }`.

- [ ] **Step 1** tests for every function (two or three cases each, including the plural/singular of "listing"), **Step 2** run/fail, **Step 3** implement, **Step 4** run + typecheck, **Step 5** commit `feat(dashboard): pure view logic for the Extract stepper`.

---

### Task 5: Stepper shell and the three section components

**Files:**
- Create: `packages/dashboard/src/components/stepper.tsx`, `extract-pages.tsx`, `extract-sample.tsx`, `extract-run.tsx`

**Interfaces:**

```tsx
export function Stepper({ steps }: { steps: Array<{ n: number; title: string; detail: string; state: StepState }> }): JSX.Element;   // the strip
export function Section({ n, title, hint, state, onEdit, children }: { n: number; title: string; hint?: string; state: StepState; onEdit?: () => void; children: ReactNode }): JSX.Element;  // locked: dimmed + reason; done: grey background + "Edit" link; current: normal; later: dimmed
export function ExtractPages(props: { mode: ExtractMode | null; onMode: (m: ExtractMode) => void; listing: string[]; onListing: (urls: string[]) => void; checks: Record<string, { productLinks: number; pagerSeen: boolean } | { error: string } | null>; onCheck: (url: string) => void; productText: string; onProductText: (t: string) => void; proofUrls: string[]; host: string | null; onImportCsv: (file: File) => void; onSave: () => void; saving: boolean; readOnly: boolean }): JSX.Element;
export function ExtractSample(props: { mode: ExtractMode; runId: string | null; sampling: boolean; onSample: () => void; onSampleAgain: () => void; columns: Array<{ key: string; name: string }>; stale: boolean; readOnly: boolean }): JSX.Element;   // reads crawl.status/items itself via trpc; renders facts + rows via ResultsTable-like table
export function ExtractRun(props: { items: number | 'all'; pages: number | 'all'; onChange: (b: { items: number | 'all'; pages: number | 'all' }) => void; sentence: string; onExtract: () => void; extracting: boolean; disabled: boolean; reason?: string; activeRun: { id: string; label: string } | null; projectSlug: string; sourceSlug: string }): JSX.Element;
```

Copy from the mockups verbatim: section titles "1 · Pages", "2 · Sample", "3 · Run"; hints "where the products come from", "proof that the walk works before anything runs at scale", "how much, then go"; the listing table columns "Listing page", "Check", remove; the placeholder "paste one or more listing URLs" (a textarea accepting several lines, split by `parseUrlLines` from `lib/parse-url-lines.ts`); "Sample 3 products" and its sentence; "Sample again"; "Extract"; dropdown labels `all` / `custom`.

`ExtractSample`: `trpc.crawl.status.useQuery({ runId }, { enabled: !!runId, refetchInterval: active ? 2000 : false })` and `trpc.crawl.items.useQuery`; facts via `probeEvidence({ counts, warnings: parseRunLog(logs).warnings })` (import from the existing libs; `logs` comes from `runs.get` if a procedure exists, else pass `warnings: []` and drop the pagination fact to "walked"). Sample rows: a compact table with the contract columns, cells from `crawl.items`'s extractions (`trpc.runs.results` or the existing results reader the run page uses; check `source-run-detail.tsx` for the exact query and reuse it). Empty cells get `bg-red-50` and the note under the table via `emptyCellNote`.

- [ ] **Step 1** write the four files; **Step 2** typecheck (nothing imports them yet); **Step 3** commit `feat(dashboard): Extract stepper shell and the Pages, Sample and Run sections`.

---

### Task 6: The route, tabs, schema-tab handoff, legacy redirect

**Files:**
- Create: `packages/dashboard/src/routes/source-extract.tsx`
- Modify: `router.tsx` (add `extract` child; remove the `overview` child), `source-detail.tsx` (tabs Schema / Extract / Runs / Settings), `source-schema.tsx` (the strip's Extract button navigates to `/projects/$project/sources/$source/extract`; label "Go to Extract"; enabled when green), `lib/legacy-routes.ts` (+test: `/overview` → `/extract`), `routes-smoke.test.ts`

**Wiring in `source-extract.tsx`:**
- Queries: `sources.listByProject` (source row: `id, slug, listingMode, confirmedAt, budget, urlCount, parameters, verificationSet, datasetId, schemaDefinition`), `sources.verificationStatus` (green = `current && allPassed`, `currentKeys`), `runs.listBySource` (latest probe run = `inputLabel === 'probe'` newest; latest full run = newest non-probe non-backfill), `datasets.getContract` for column names.
- Mutations: `checkListingPage` (per URL, debounced on add), `setListingPages`, `setProductUrls`, `update` (budget), `crawl.probeAndSample`, `sources.confirm` (listing mode, first full run: it plans with `probe: false` and sets `confirmedAt`; navigate to the run), `crawl.plan` + `crawl.execute` (detail mode, as `handleExtract` does today), `crawl.plan` (listing mode, already confirmed).
- State: `mode` seeded from `parameters.inputMode ?? (listingMode === 'listing_to_detail' ? 'listing' : listingMode === 'detail' && urlCount > 0 ? 'detail' : null)`; `listing` seeded from the input set rows when `inputMode === 'listing'` (fetch rows via a small `sources.inputRows({ sourceId })` query added in this task to `sources.ts`: returns `rows.map(r => r.url)`); `productText` seeded the same way for detail mode; `budget` from `budgetToForm(source.budget)`; `sampleStale` true when pages were saved after the latest probe run started.
- Locked: `!green` → `Stepper` with all `locked` and the strip text from `lockedStripText`, sections rendered dimmed, no handlers.
- Section 3's Extract: listing + unconfirmed → `sources.confirm`; listing + confirmed → `crawl.plan({ probe: false })`; detail → plan + execute. Before any of them, save the budget with `sources.update` if it changed. After start, `activeRun` shows "Extracting · n of m" from `crawl.status` polling and a link to the run.

- [ ] **Step 1** write the route and the small `inputRows` query (+ a test in `sources-extract.test.ts`); **Step 2** router/tabs/legacy/schema-tab edits; **Step 3** typecheck + `pnpm --filter @robot/dashboard test -- --maxWorkers=1`; **Step 4** browser: Ikea → Extract tab: unlocked (schema is green), section 1 current; paste `https://www.ikea.com/my/en/cat/two-seater-sofas-10668/`, see the check land with a count and pager state, save; click "Sample 3 products" (free, allowed); watch section 2 fill with facts and three rows; section 3 shows the sentence with both dropdowns on `all`; do NOT click Extract. Screenshot each moment to `docs/testing/screens/extract-<moment>.png`. **Step 5** commit `feat(dashboard): Extract tab — pages, sample, run; Overview retired from the tab bar`.

---

### Task 7: Smoke, docs, spec corrections

- Smoke: add `/projects/scratch/sources` still; in the create-flow test, navigate to `.../extract` and assert `getByText('Extraction is locked')` (no fields verified) and the three section titles present.
- `docs/handoff.md`: phase 4 section (what landed, the `'all'` pages = 10 rule, `inputMode` marker, the Ikea sample result and screenshots, that a full Extract was not run).
- Spec corrections carried from phase 3: in section 5.6, note that the strip copy splits into summary and detail (spec 6's single-separator rule wins, shown as two spans); in 5.6 say paste maps by name with positional fallback; record "rough time" as deferred to phase 5. In section 8 record `PAGES_ALL_CEILING` and the `inputMode` marker.
- Gate per package with one worker; commit `test,docs: Extract tab smoke, phase 4 handoff, spec corrections from phase 3`.

---

## Self-review

**Spec 5.7 coverage:** stepper with three always-rendered sections and lock/dim rules (Tasks 4, 5, 6); Pages with the segmented control, listing table with automatic check, product-URL textarea with counts and CSV (Tasks 2, 3, 5, 6); Sample with the sentence, four facts, rows, empty-cell note, product-URL one-liner (Tasks 4, 5, 6); Run sentence with two dropdowns defaulting to all, the safety-stop line, unlock rules, post-start progress (Tasks 1, 3, 4, 5, 6); locked tab strip (Tasks 4, 6). Spec 8 procedures (Tasks 2, 3, 6) and budget shape (Tasks 1, 3). Spec 9 unbounded pages (Task 1, mapped to the ceiling with the reason) and link harvest extension (Task 2). Spec 6 copy (all). Spec 10 tests (Tasks 1 to 4, 7).

**Deliberate deviations:** "all pages" is the ten-page burst ceiling, not unbounded, because the walk's own anti-bot rule already caps a burst there; the tab says "up to 10 pages per listing". The Overview tab is retired from the bar (its data lives on Runs); `/overview` redirects to `/extract`.

**Type consistency:** `Budget.pagesAll` (T1) read nowhere in the dashboard (the dashboard reads the raw `sources.budget`), fine. `checkListingPage` shape (T2) consumed by T4's `listingCheckLabel` and T5/T6. `setListingPages`/`setProductUrls`/`inputRows` (T3, T6) consumed by T6. `StepState`, `ExtractMode` (T4) consumed by T5 and T6. `ExtractSample` reuses `probeEvidence`, `parseRunLog` (existing).
