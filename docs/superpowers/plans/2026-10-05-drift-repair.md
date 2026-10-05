# Drift repair (Part B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a run flags fields as drifted, a free check re-captures the website's proof pages and says what happened to each field (it moved, its value changed, other products differ, it's lost, or the page is gone). The customer sees it everywhere the website appears and on the Verification tab, and can accept a proposed repair, which then needs a normal Verify.

**Architecture:**
- **Classifier:** a pure-ish scraper function `classifyDrift` decides each drifted field's result from fresh proof-page captures. It uses the field's certified paths and certification's own mechanical candidate search (`gatherCandidates` + `certify`, never the AI step).
- **Job:** an API job `runDriftCheck` re-captures the proof pages (three at a time, the proof-page capture the tab already uses), classifies each drifted field, and stores one `drift_checks` row. It never touches certification, answers, `verificationSet`, `driftedFields` or `source_verifications`.
- **When it runs:** automatically after a run flags drift, and on demand.
- **The app:**
  - shows "n fields stopped extracting" on the website;
  - shows a banner and per-row results on the Verification tab;
  - lets the customer accept a move or a changed value through the normal autosave.

  Only a completed Verify certifies the new paths and clears the flag.

**Tech Stack:** Drizzle + Postgres (migration 0015), tRPC v11 + zod, `@robot/scraper` verify (`gatherCandidates`, `certify`, `resolveStructured`, box map), Playwright, React (TanStack), vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-table-first-and-drift-repair-design.md`, Part B (B1–B5) and decision D3 ("the repair check runs automatically when a run flags drift"). Part A is merged. Current drift code: `packages/api/src/crawl/drift.ts` (`driftedKeys`, `flagDrift`), called from `buildFinalise` in `packages/api/src/crawl/start-execution.ts`. The app shows no drift today.

## Global Constraints

- **The check is free:** page loads and code only. No model call, ever. A test asserts that `proposeWithAi`/the agent is never constructed or invoked.
- **The check changes nothing by itself:** it never writes `sources.verificationSet`, `sources.schemaDefinition`, `sources.driftedFields`, `source_verifications`, or the domain cache. It writes only `drift_checks` and proof-page `captures` rows (the same captures the tab takes).
- **Per-field results** (exact names): `other-layout` · `moved` · `changed` · `lost`. Per-page result: `page-gone` (no capture, or the capture failed).
- **Field result precedence:**
  1. `other-layout` (certified paths still read every expected value on every captured page);
  2. else `moved` (a mechanically found path certifies against the stored expected values on every captured page);
  3. else `changed` (an old certified path, or a concept-fitting structured path, reads a valid different value on some page and the expected value on none of those pages);
  4. else `lost`.

  Pages that are `page-gone` are left out of the field's decision. If every page is gone, the field result is `lost`.
- **What the customer sees** (exact templates):
  - **On the website,** in warn colour: `{n} fields stopped extracting`; with one field, `1 field stopped extracting`.
  - **Verification banner:** `{Fields} stopped extracting in the run of {d MMM} ({p1} % and {p2} % of products empty)`. Fields are joined like the badge ("Price", "Price and Rating", "Price, Rating and SKU"). The percentages are each field's empty share in that run, rounded, in the same order.
  - **Row texts:**
    - `moved` → "Moved on the page — Accept new location";
    - `changed` → "Page now shows {new} (was {old})" on each product it applies to, with "Accept new values";
    - `other-layout` → "The products you verified still work; some others differ — See missed products";
    - `lost` → "Not found on the page — Mark it again";
    - `page-gone` (per product) → "Product {n} no longer loads — Replace product {n}".
  - **While the check runs:** "Checking what changed…".
- **Accepting a repair** writes the row's answers through the existing autosave (`updateBinding`):
  - `moved` sets each page's mark to the new element and leaves values unchanged;
  - `changed` sets each page's expected value and mark to the new one.

  The row then needs a Verify like any change. Nothing is auto-accepted.
- **Out of scope:** variant entry paths and links collectors (fields only).
- **Unchanged rules:**
  - **Budget:** no implementer or test clicks Verify, Sample, Extract or Check with an Anthropic key present. Live checks run only on the keyless :4100.
  - **Identity:** never sign in as `markodjordjievski@gmail.com`, and never touch org `default`/`mar` or the projects Acne, Scratch or Competitor prices.
  - **Dev servers:** never stop, start or restart them (:4000/:3000/:3456).
  - **Commits:** by explicit path, never `git stash`. Each ends with the writer's `Co-Authored-By:` line.
  - **Tests:** run with `vitest run --maxWorkers=2 --testTimeout=30000`.
  - **Migration:** `pg_dump` before it (`docker exec robot-platform-db pg_dump -U postgres robot_platform > <scratchpad>/pre-drift.sql`).

## Review Focus

1. **A drift check started while another is still running for the same website.** Expected: the running one is returned. A check older than 10 minutes that is still `running` is closed as `failed` and a new one starts (the same stall rule as Verify). Test: Task 2.
2. **A proof page that redirects to a listing, or now shows a 404 page.** Expected: that product is `page-gone` and the other pages still decide. Never a crash and never a false `moved`. Test: Task 1 (a null capture), Task 2 (a failed capture).
3. **A field that drifted but whose website was re-verified since** (`driftedFields` now null). Expected: the Verification tab shows no banner, and old check results are ignored. Test: Task 3.
4. **A yes/no or same-on-every-page field that "moved".** Expected: the weak-field rule still applies (a concept-fitting or confirmed path only), so a random `true` elsewhere on the page never counts as `moved`. Test: Task 1.
5. **Accepting a move while the autosave is mid-flight on another field.** Expected: both changes land (the autosave merges per field). Test: Task 4 (view logic: the accepted marks merge into the current board).

---

## File map

- **Database:** create `packages/db/drizzle/0015_drift_checks.sql` (via drizzle-kit) and modify `packages/db/src/schema.ts` (the `driftChecks` table).
- **Scraper:** create `packages/scraper/src/verify/drift-classify.ts` and its test, and modify `verify/index.ts`.
- **API:**
  - Create `packages/api/src/verify/run-drift-check.ts` and its test.
  - Modify `packages/api/src/routers/sources.ts` (`checkDrift`, `driftCheck`), `packages/api/src/crawl/start-execution.ts` (auto-start after drift is flagged), `packages/api/src/crawl/drift.ts` (expose each field's empty share), and the websites list query that feeds the app's websites table (it gains `driftedFields`).
- **App:**
  - Create `packages/app/src/lib/site/drift-view.ts` and its test, and `packages/app/src/components/verification/drift-banner.tsx`.
  - Modify `packages/app/src/components/project/websites-table.tsx`, the website header, `verification-table.tsx` (row marks and actions), the Verification route, and `packages/app/src/routes-smoke.test.ts`.
- **Test fixture:** create `packages/api/src/test-helpers/drift-site.ts`, a local HTTP server serving three product pages whose layout can be switched.
- **Docs:** `docs/handoff.md`.

---

### Task 1: Storage, and the drift classifier

**Files:**
- Modify: `packages/db/src/schema.ts`. Create: migration 0015. Back up first, then run `pnpm db:migrate`.
- Create: `packages/scraper/src/verify/drift-classify.ts`; Test: `drift-classify.test.ts`. Modify: `verify/index.ts`.

**Interfaces — Produces:**

```ts
// db
export const driftChecks = pgTable('drift_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 12 }).notNull().default('running'),   // 'running' | 'done' | 'failed'
  results: jsonb('results'),                                                // DriftCheckResults
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// drift-classify.ts
export type DriftPage =
  | { status: 'ok'; value: string | null; mark?: Mark }        // the field's reading on that page under the result's path
  | { status: 'page-gone' };
export type DriftFieldResult = {
  key: string;
  result: 'other-layout' | 'moved' | 'changed' | 'lost';
  path?: CertifiedPath;                                        // moved: the found path; changed: the path that read the new values
  pages: Record<string, DriftPage>;                            // per proof url
  emptyShare?: number;                                         // filled by the API from the run
};
export type DriftCheckResults = { runId: string | null; fields: Record<string, DriftFieldResult> };
export async function classifyDrift(input: {
  field: SchemaDefinitionField;
  expected: Record<string, string>;                            // url → expected
  certified: CertifiedPath[];
  captures: Record<string, (CaptureLike & { boxes?: Box[] }) | null>;   // null = page gone
  confirmed?: ConfirmedPath[]; markXPaths?: string[];
}, deps: CertifyDeps & { runDomSearch: Parameters<typeof gatherCandidates>[3]['runDomSearch'] }): Promise<DriftFieldResult>;
export function markFromXPath(boxes: Box[], xpath: string): Mark | undefined;  // the box whose xpaths include it → { xpaths, text, rect }
```

**Rules:**
- **Page set:** pages with `captures[url] === null` are `page-gone`. The rest are the captured pages, and only those with a non-blank expected value decide.
- **`other-layout`:** evaluate `certified` on the captured pages with certification's evaluation (structured through `resolveStructured`, XPath through `deps.evalXPaths`), the way `certify` checks a candidate. If the same path set reads `valuesEqual(type, expected)` on every deciding page, the result is `other-layout` with each page's value.
- **`moved`:**
  1. `gatherCandidates(field, expected, captures, deps)`, then `certify({ field, expected, captures, candidates, confirmed, markXPaths }, deps)`.
  2. If the result certifies, with every deciding cell `pass`, the result is `moved` with `path = certified[0]` and, per page, the value and `mark = markFromXPath(boxes, xpath)` when the path is an XPath.
  3. Weak fields follow certify's own rule (Review Focus 4), so nothing extra is needed beyond passing `confirmed`/`markXPaths`.
  4. Never call the AI fallback: `classifyDrift` takes no agent.
- **`changed`:** among the old certified paths, plus the concept-fitting structured paths found by `searchStructured` on the captured pages (any value of the field's type), take the first path that reads a valid value (`normalize` non-null) on every deciding page and the expected value on none of the pages where it differs. Result `changed`, with the new value per page and a `mark` when it can be built.
- **Otherwise:** `lost`. Each page's value is `null`.

- [ ] **Step 1: Write the failing tests.** Use the shop-example triple (`loadShopExample`, `__fixtures__/verify/shop-example`). Build each scenario by editing the loaded captures in the test:
  - **still working:** unchanged captures → `other-layout`;
  - **moved price:** remove the JSON-LD price, and put the price in a new DOM element with a different class, as page HTML. Certified = the JSON-LD path → `moved`, with an XPath path and a mark per page when boxes are supplied;
  - **changed price:** the JSON-LD price is a different number on page 2 → `changed`, page 2 value = the new price, `path` = the old path;
  - **missing field:** remove the field from data and DOM → `lost`;
  - **page gone:** page 3 null → `page-gone` for page 3, with the other pages still deciding;
  - **Review Focus 4:** a boolean field whose certified path is gone, while an unrelated `featured: true` exists → never `moved` via that path (`lost` or `changed` only by a concept-fitting path).
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement**, including the migration. **Step 4: Run them to see them pass**, then the scraper gate and `tsc` in scraper and db.
- [ ] **Step 5: Commit** `feat(db,scraper): classify what happened to a drifted field on fresh proof pages`.

---

### Task 2: The drift check job and its API

**Files:**
- Create: `packages/api/src/verify/run-drift-check.ts`; Test: `run-drift-check.test.ts` (DB-backed; captures injected).
- Modify: `packages/api/src/routers/sources.ts`; test `sources-drift.test.ts` (new).
- Modify: `packages/api/src/crawl/drift.ts` (`flagDrift` also returns each drifted key's empty share) and `packages/api/src/crawl/start-execution.ts` (after `flagDrift` returns keys, `void startDriftCheck(sourceId, runId)`).

**Interfaces — Produces:**

```ts
export async function startDriftCheck(sourceId: string, runId: string | null, opts?: { capture?: CaptureProofPagesFn; fire?: boolean }): Promise<{ checkId: string; status: 'started' | 'in-progress' }>;
export async function runDriftCheck(checkId: string, deps?: { capture?: CaptureProofPagesFn; session?: Session }): Promise<void>;
export type CaptureProofPagesFn = (sourceId: string, urls: string[]) => Promise<Record<string, ProofPageCaptureRecord | null>>;
// flagDrift now returns: { keys: string[]; emptyShare: Record<string, number> }
sources.checkDrift({ sourceId }) → { checkId, status }
sources.driftCheck({ sourceId }) → { id, status, createdAt, completedAt, results: DriftCheckResults | null, runAt: Date | null } | null   // latest
```

**Rules:**
- **`startDriftCheck`:**
  - Org-scoped through its callers.
  - Returns the in-flight check if one is younger than 10 minutes. An older `running` one is closed as `failed` with `error: 'stalled'`.
  - Otherwise inserts a `running` row and fires `runDriftCheck`, unawaited unless `fire: false`.
- **`runDriftCheck`:**
  1. Load the source's `schemaDefinition`, `verificationSet`, `driftedFields` and its current certification (`loadCurrentCertification`). A field without a current certified path is `lost` with no work.
  2. Re-capture every proof URL with the default `CaptureProofPagesFn`. It inserts a capture with `startProofPageCapture(sourceId, url, { fire: false })` and awaits `runProofPageCapture(captureId)` itself, three at a time (`createLimiter(3)`). Then it loads the captures with `loadProofPageCaptures`; a failed capture is `null`. Each capture gets `boxes` from its stored meta.
  3. Classify each drifted key with `classifyDrift`, building `evalXPaths`/`runDomSearch` from one `withBrowserSession` over the captures' HTML (as `runVerification` does).
  4. Fill `emptyShare` from the run (`runs.driftedFields` plus the shares `flagDrift` now stores, see below).
  5. Write `results` and `status: 'done'`, or `failed` with `error` on a throw.
- **Where the shares live:** `flagDrift` stores the shares on the run as `runs.driftedFields = keys` (unchanged) and returns `emptyShare`. `startExecution` passes them to `startDriftCheck`, which writes them into the row's `results.fields[key].emptyShare` up front.
- **Never** write any table but `drift_checks`, and the proof-page `captures` rows the capture function creates.
- **`sources.driftCheck`:** returns the latest row for the source, plus `runAt` (the run's `completedAt`) when `runId` is set.

- [ ] **Step 1: Write the failing tests:**
  - `runDriftCheck` with an injected `capture` returning the Task 1 fixtures writes a `done` row with `moved`/`changed`/`lost` per field.
  - The source's `verificationSet`, `driftedFields` and its `source_verifications` count are unchanged (a deep-equal before and after).
  - **Review Focus 1:** a second start returns `in-progress`, and a stalled one is replaced.
  - **Review Focus 2:** a capture function returning `null` for one URL gives `page-gone` there.
  - No agent: spy on `SchemaAgent`/the AI fallback module (`vi.mock`) and assert it is never called.
  - `startExecution`'s finalise starts a check when drift is flagged, and doesn't when nothing drifted.
  - Both procedures give NOT_FOUND to another org.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the api gate and `tsc`.
- [ ] **Step 5: Commit** `feat(api): a free drift check re-captures the proof pages and records what changed`.

---

### Task 3: Showing drift — on the website and as a banner

**Files:**
- Create: `packages/app/src/lib/site/drift-view.ts` and its test, and `packages/app/src/components/verification/drift-banner.tsx`.
- Modify: `packages/app/src/components/project/websites-table.tsx` and the query behind it (add `driftedFields`), the website header component (find where the website's name and URL render on the website routes), and the Verification route (the banner above the table; poll `sources.driftCheck` every 3 s while `running`).

**Interfaces — Produces:**

```ts
export function driftBadge(driftedFields: string[] | null): string | null;      // "{n} fields stopped extracting" / "1 field …" / null
export function driftBanner(args: {
  driftedFields: string[] | null; fieldNames: Record<string, string>;
  check: { status: 'running' | 'done' | 'failed'; results: { fields: Record<string, { emptyShare?: number }> } | null; runAt: string | Date | null } | null;
}): { kind: 'none' } | { kind: 'checking'; text: string } | { kind: 'result'; text: string };
```

**Rules:**
- **Exact texts:** as in Global Constraints. The date is formatted `d MMM` (e.g. "26 Sep"). Percentages are `Math.round(share * 100)`. Fields keep `driftedFields` order and are named with `fieldNames`.
- **No banner** when `driftedFields` is null or empty (Review Focus 3), even if old check rows exist.
- **A `running` check** gives `checking` ("Checking what changed…"). A `failed` check, or none, gives the result text without percentages if shares are missing: "{Fields} stopped extracting in the run of {d MMM}"; if `runAt` is missing too, "{Fields} stopped extracting".

- [ ] **Step 1: Write the failing tests:** `driftBadge` for null, 1 and 3; `driftBanner` for none, checking, a result with two fields and shares, a result without shares, and stale checks with `driftedFields` null giving `none`.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement** the view logic and wiring, matching the existing warn styles. **Step 4: Run them to see them pass**, then the app gate and `tsc`.
- [ ] **Step 5: Commit** `feat(app): show which fields stopped extracting, on the website and the Verification tab`.

---

### Task 4: Repair actions on the drifted rows

**Files:**
- Modify: `packages/app/src/lib/site/drift-view.ts` (row states and accept helpers) and its test, `verification-table.tsx` (a drift line under a drifted row, with its action), and the Verification route (wire the actions to the board and autosave, and "See missed products" to the run page's misses for `check.runId`).

**Interfaces — Produces:**

```ts
export type DriftRow =
  | { kind: 'moved'; text: string; marks: Record<string, Mark> }
  | { kind: 'changed'; text: string; values: Record<string, { value: string; mark?: Mark }> }
  | { kind: 'other-layout'; text: string; runId: string | null }
  | { kind: 'lost'; text: string }
  | { kind: 'page-gone'; texts: Array<{ url: string; text: string }> };
export function driftRows(args: { fieldKeys: string[]; urls: string[]; results: Record<string, DriftFieldResult-like> | null; values: Record<string, Record<string, string>> }): Record<string, DriftRow[]>;
export function acceptMoved(board: Board, key: string, marks: Record<string, Mark>): Board;     // marks replaced, values unchanged
export function acceptChanged(board: Board, key: string, values: Record<string, { value: string; mark?: Mark }>): Board;
```

**Rules:**
- **Texts:** exactly Global Constraints' row texts. A page-gone row can sit beside the field's own result row, giving one entry per gone product.
- **`acceptMoved` and `acceptChanged`:** pure. They return a new board with only that field's cells changed (Review Focus 5: other fields' pending edits are kept). The route then pushes the board through the existing saver.
- **The actions:**
  - "Mark it again" opens that product's screenshot in the existing mark mode for that field.
  - "Replace product {n}" uses the grid's existing remove-and-fill-from-listing action.
  - "See missed products" links to `…/runs/{runId}` (the misses panel).
- **After accepting,** the row shows the normal "needs Verify" state the table already has for a changed field.

- [ ] **Step 1: Write the failing tests:** `driftRows` for each kind, plus page-gone alongside `moved`; `acceptMoved` keeps values and replaces marks; `acceptChanged` sets values and marks; both leave another field's pending cell untouched.
- [ ] **Step 2: Run them to see them fail.** **Step 3: Implement.** **Step 4: Run them to see them pass**, then the app gate and `tsc`.
- [ ] **Step 5: Commit** `feat(app): accept a moved field or its new values from the drift check`.

---

### Task 5: End to end on a local site whose layout changes, smoke and handoff

**Files:**
- Create: `packages/api/src/test-helpers/drift-site.ts`, a tiny `http` server on a random port. It serves `/p/1..3` product pages in two layouts, A (price in JSON-LD and `.price`) and B (no JSON-LD price; price in `.amount`), with `setLayout('A' | 'B')`.
- Create: `packages/api/src/verify/drift-end-to-end.test.ts`.
- Modify: `packages/app/src/routes-smoke.test.ts`, `docs/handoff.md`.

**Rules:**
- **The end-to-end test**, real Chromium and no AI. Never call `runVerification`; seed the certification so no model can be reached even with a key in `.env`.
  1. Seed a customer-schema source whose proof URLs point at the local server, and a completed clean `source_verifications` row whose certified price path is the JSON-LD path, with matching `fieldHash` (copy the `hashOf` helper pattern).
  2. Switch the server to layout B.
  3. Run `runDriftCheck` with the real capture function (real proof-page captures against the local server).
  4. Expect price `moved` to an XPath under `.amount`, the title `other-layout`, and no write outside `drift_checks`/`captures`.
- **The smoke** (Marko's servers already running; never start or restart them; throwaway identity; never click Verify or Extract):
  1. For the smoke's throwaway project, set `driftedFields` on its website and insert one finished `drift_checks` row through a test helper, scoped and cleaned up like `seed-variants-run`.
  2. Assert the website badge, the banner text and the moved row's "Accept new location".
  3. Click it, then assert the row reads as needing Verify. Don't click Verify.
  4. Restore unrelated screenshots.
- **Handoff:** a "Drift repair (Part B)" section covering what landed, how it runs, and how to check it.

- [ ] **Step 1: Write the end-to-end test** and run it to see it fail (no server or helper yet). **Step 2: Implement** the server helper. **Step 3: Run it to see it pass.**
- [ ] **Step 4: Smoke**, as above. **Step 5: Docs.**
- [ ] **Step 6: Commit** `test(api,app): drift repair end to end on a local site whose layout changes`; docs separately.

---

## Not in this plan

- **Drift for variant entry paths and links collectors.**
- **Email alerts, and auto-accepting a repair** (spec C).
- **Jev** (parked).
- **Coverage repair of variant rows other than the first** (deferred from variants plan 3).
