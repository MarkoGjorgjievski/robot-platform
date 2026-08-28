# Repair Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-run coverage reports, backfill runs (item-scoped, field-focused, cell-merged), dead-field repair-then-sweep, and the schema add-fields loop — so gaps get repaired for the cost of the gappy pages, never a full re-crawl.

**Architecture:** Coverage is a pure aggregation over `run_items` + `extractions` against `effectiveSchema` (no per-field status is persisted today — key presence/null in `extractions.data[0]` is the truth). A backfill is a new run (`inputLabel: 'backfill'`, `parentRunId`) whose items are derived from the parent's gaps, each item carrying its own `targetFields`; execution reuses `executeRun`/`startExecution` with per-item schema filtering, and results merge cell-level back into the parent's extractions (never overwriting filled cells; still-missing target fields become `absent_fields` on the parent item). Repair-then-sweep is `executeRun` staged twice via its existing `limit` machinery.

**Tech Stack:** Drizzle/Postgres, tRPC v11 + Zod, existing extraction chain (`runExtraction` requested-fields focus), Vite/TanStack dashboard.

**Spec:** docs/superpowers/specs/2026-08-28-repair-engine-design.md

## Global Constraints

- **No AI spend without Marko's explicit go — and as of 2026-08-28 the Anthropic API account is NOT funded; nothing that reaches the API runs until Marko confirms payment.** All tasks below except Task 12's paid steps are AI-free (tests run with `agent: null`).
- Cost-bearing actions are explicit clicks with the price shown first (mvp-simplification ruling R6). No mount effects, no query-driven mutations.
- `completed_at` is the run-terminal marker; in-flight guards key on `completed_at IS NULL`, never on status lists (D2 lesson, commit cf6f2fc).
- A backfill NEVER overwrites a filled cell (`!= null` in `extractions.data[0]`).
- Verification gates after every task: `pnpm -r test` green (Docker Postgres `robot-platform-db` running), `pnpm typecheck` green, `pnpm --filter @robot/dashboard exec tsc --noEmit` clean, and the cache-hygiene query returns 0 rows: `select domain, page_type from domain_intelligence where domain in ('example.com','listing.example') or domain like 'test-%';`
- All test seeds go through an org row deleted in `afterEach` (FK cascade) — the `crawl-execute.test.ts` pattern.
- Shell is Windows PowerShell 5.1: no `&&` chaining.
- Constants live once, in `packages/api/src/crawl/backfill.ts` (the `probe.ts` model): `DEAD_FIELD_FILL_THRESHOLD = 0.5`, `REPAIR_SAMPLE_COUNT = 3`, `REPAIR_SUCCESS_MIN = 2`, `EST_AI_COST_PER_PAGE_USD = 0.05`.

---

### Task 1: Schema — the five new columns

**Files:**
- Create: `packages/db/drizzle/0008_repair_engine_columns.sql` (+ journal entry + snapshot per drizzle convention)
- Modify: `packages/db/src/schema.ts` (`runs` at ~342, `runItems` at ~376, `sources` at ~72)
- Test: `packages/db/src/schema.test.ts` (extend existing)

**Interfaces:**
- Produces: `runs.parentRunId: uuid | null`, `runs.targetFields: jsonb | null` (string[]); `runItems.targetFields: jsonb | null` (string[]), `runItems.absentFields: jsonb | null` (string[]); `sources.requestedFields: jsonb | null` (`Array<{name: string; hint?: string; addedAt: string}>`). All later tasks consume these exact names.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "target_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "target_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "absent_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "requested_fields" jsonb;
--> statement-breakpoint
CREATE INDEX "runs_parent_run_id_idx" ON "runs" ("parent_run_id");
```

Register in `packages/db/drizzle/meta/_journal.json` (idx 8, tag `0008_repair_engine_columns`) with a snapshot, matching how 0007 is registered.

- [ ] **Step 2: Mirror in schema.ts**

`runs` gains (self-FK needs the `AnyPgColumn` callback form):

```ts
parentRunId: uuid('parent_run_id').references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
targetFields: jsonb('target_fields'),
```

`runItems` gains `targetFields: jsonb('target_fields')`, `absentFields: jsonb('absent_fields')`; `sources` gains `requestedFields: jsonb('requested_fields')`. Add `index('runs_parent_run_id_idx')` to the runs index block.

- [ ] **Step 3: Failing test** — insert a run with `parentRunId` pointing at another run and read it back; insert a runItem with `targetFields: ['title']` and `absentFields: []`; insert a source with `requestedFields: [{name: 'isbn', addedAt: '2026-08-28T00:00:00Z'}]`. Run `pnpm --filter @robot/db test` — fails (columns unknown) before `pnpm db:migrate`, passes after.
- [ ] **Step 4: Run `pnpm db:migrate`, verify green, full gates**
- [ ] **Step 5: Commit** `feat(db): repair-engine columns (parent_run_id, target_fields, absent_fields, requested_fields)`

---

### Task 2: Coverage — pure computation + read endpoint

**Files:**
- Create: `packages/api/src/crawl/coverage.ts`
- Create: `packages/api/src/crawl/coverage.test.ts`
- Modify: `packages/api/src/routers/crawl.ts` (add `coverage` procedure)
- Test: `packages/api/src/routers/crawl-coverage.test.ts` (new, real-Postgres pattern)

**Interfaces:**
- Consumes: `effectiveSchema(source)` (`effective-schema.ts:43`), `runItems`/`extractions` shapes from Task 1 and the digest (`extractions.data` is `[{<field>: value|null, _url, _page_number}]`).
- Produces:

```ts
export type FieldCoverage = { name: string; filled: number; missing: number; confirmedAbsent: number; total: number };
export type ItemGap = { itemId: string; url: string; missingFields: string[] };
export type RunCoverage = { fields: FieldCoverage[]; gapItems: ItemGap[] };
export function computeCoverage(
  fields: Array<{ name: string }>,
  items: Array<{ id: string; url: string; row: Record<string, unknown> | null; absentFields: string[] }>,
): RunCoverage;
```

Semantics (binding for all later tasks): a cell is **filled** iff `row` exists and `row[name] != null && row[name] !== ''`; **confirmedAbsent** iff `absentFields.includes(name)` (takes precedence over missing); otherwise **missing** — including every field of an item whose `row` is null (failed items are re-extract candidates). `missingFields` excludes confirmed-absent fields. Fields = `effectiveSchema` names only (`_url`/`_page_number` never appear).

- [ ] **Step 1: Failing unit tests** for `computeCoverage`:

```ts
it('counts filled, missing, and confirmed-absent per field', () => {
  const out = computeCoverage(
    [{ name: 'title' }, { name: 'isbn' }],
    [
      { id: 'a', url: 'u1', row: { title: 'T', isbn: null }, absentFields: [] },
      { id: 'b', url: 'u2', row: { title: '' }, absentFields: ['isbn'] },
      { id: 'c', url: 'u3', row: null, absentFields: [] },
    ],
  );
  expect(out.fields).toEqual([
    { name: 'title', filled: 1, missing: 2, confirmedAbsent: 0, total: 3 },
    { name: 'isbn', filled: 0, missing: 2, confirmedAbsent: 1, total: 3 },
  ]);
  expect(out.gapItems).toEqual([
    { itemId: 'a', url: 'u1', missingFields: ['isbn'] },
    { itemId: 'b', url: 'u2', missingFields: ['title'] },
    { itemId: 'c', url: 'u3', missingFields: ['title', 'isbn'] },
  ]);
});
it('an item with every field filled produces no gap entry', () => { /* row all filled → gapItems [] */ });
```

- [ ] **Step 2: Implement `computeCoverage`** (pure, no db). Verify green.
- [ ] **Step 3: The endpoint.** In `routers/crawl.ts`:

```ts
coverage: publicProcedure
  .input(z.object({ runId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const run = await ctx.db.query.runs.findFirst({
      where: eq(runs.id, input.runId),
      with: { source: { columns: { id: true, selectorsJson: true, datasetId: true }, with: { dataset: { columns: { schema: true } } } } },
    });
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });
    if (!run.source) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no Source' });
    const items = await ctx.db.query.runItems.findMany({
      where: and(eq(runItems.runId, input.runId), eq(runItems.kind, 'detail')),
      columns: { id: true, url: true, absentFields: true },
      with: { extraction: { columns: { data: true } } },
    });
    const fields = effectiveSchema(run.source);
    return computeCoverage(fields, items.map((i) => ({
      id: i.id, url: i.url,
      row: Array.isArray(i.extraction?.data) ? (i.extraction!.data[0] as Record<string, unknown> ?? null) : null,
      absentFields: (i.absentFields as string[] | null) ?? [],
    })));
  }),
```

- [ ] **Step 4: Failing router test** (real Postgres, org-cascade cleanup): seed source + run + two detail items — one with an extraction `data: [{title: 'A', isbn: null}]`, one failed with none — assert the coverage payload. Verify red, then green after wiring.
- [ ] **Step 5: Full gates, commit** `feat(api): per-run coverage report`

---

### Task 3: Backfill derivation, classification, and preview

**Files:**
- Create: `packages/api/src/crawl/backfill.ts` (constants + pure derivation)
- Create: `packages/api/src/crawl/backfill.test.ts`
- Modify: `packages/api/src/routers/crawl.ts` (add `backfillPreview`)
- Test: extend `packages/api/src/routers/crawl-coverage.test.ts` or new `crawl-backfill-preview.test.ts`

**Interfaces:**
- Consumes: `RunCoverage` from Task 2.
- Produces:

```ts
export const DEAD_FIELD_FILL_THRESHOLD = 0.5;
export const REPAIR_SAMPLE_COUNT = 3;
export const REPAIR_SUCCESS_MIN = 2;
export const EST_AI_COST_PER_PAGE_USD = 0.05; // rough upper bound; preview copy must say "up to"

export type FieldClassification = { name: string; fill: number; classification: 'healthy' | 'dead' };
export function classifyFields(fields: FieldCoverage[], targetNames: string[]): FieldClassification[];
// fill = filled / total (total 0 → dead); dead iff fill < DEAD_FIELD_FILL_THRESHOLD

export type BackfillItemPlan = { parentItemId: string; url: string; targetFields: string[] };
export function deriveBackfillItems(
  gapItems: ItemGap[], targetNames: string[], itemIds?: string[],
): BackfillItemPlan[];
// items whose missingFields ∩ targetNames ≠ ∅; targetFields = that intersection;
// itemIds present → intersect with the selection first (manual handle)
```

- [ ] **Step 1: Failing unit tests** — classification at the threshold boundary (fill exactly 0.5 is healthy), total-0 field is dead, derivation intersects correctly, manual `itemIds` restricts, confirmed-absent-only items excluded (they never appear in `gapItems.missingFields` per Task 2 — assert the composition anyway with a seeded case).
- [ ] **Step 2: Implement, green.**
- [ ] **Step 3: `crawl.backfillPreview`** (pure read):

```ts
backfillPreview: publicProcedure
  .input(z.object({
    runId: z.string().uuid(),
    targetFields: z.array(z.string().min(1)).optional(),
    itemIds: z.array(z.string().uuid()).optional(),
  }))
  .query(async ({ ctx, input }) => {
    const cov = /* same load as crawl.coverage — extract a shared loadRunCoverage(db, runId) helper in coverage.ts */;
    const targetNames = input.targetFields ?? cov.fields.filter((f) => f.missing > 0).map((f) => f.name);
    const items = deriveBackfillItems(cov.gapItems, targetNames, input.itemIds);
    return {
      items: items.length,
      pages: items.length, // one detail fetch per item — say so in the UI copy
      estCostUsd: Number((items.length * EST_AI_COST_PER_PAGE_USD).toFixed(2)),
      fields: classifyFields(cov.fields, targetNames),
    };
  }),
```

- [ ] **Step 4: Router test red → green.** Include: preview of a run with zero gaps returns `items: 0`.
- [ ] **Step 5: Full gates, commit** `feat(api): backfill preview — derivation, dead-field classification, cost estimate`

---

### Task 4: Per-item field focus plumbing

**Files:**
- Modify: `packages/api/src/crawl/claim-item.ts` (SQL + `ClaimedItem`)
- Modify: `packages/api/src/crawl/extract-item.ts` (schema filter)
- Test: extend `packages/api/src/crawl/claim-item.test.ts`, `packages/api/src/crawl/extract-item.test.ts` (both exist — follow their seeding/stub patterns)

**Interfaces:**
- Consumes: `runItems.targetFields` (Task 1).
- Produces: `ClaimedItem` gains `targetFields: string[] | null`; `extractItem` extracts only `deps.schema` entries whose `name` is in `item.targetFields` (plus every `origin: 'input'` field, which cost nothing and keep `mergeRow`'s input columns intact) when `targetFields` is non-null. `ExecuteDeps`/`executeRun` unchanged.

- [ ] **Step 1: Failing claim test** — seed an item with `target_fields: ['title']`, claim it, assert `claimed.targetFields` equals `['title']`; an item without → `null`.
- [ ] **Step 2: Implement** — add `target_fields` to the claim SQL's RETURNING (and the inner SELECT is untouched), map `row.target_fields` into `ClaimedItem`. Remember the postgres-js driver returns the array directly (digest note on `claim-item.ts:47`).
- [ ] **Step 3: Failing extract-item test** — with `deps.schema` of three detail fields + one input field and `item.targetFields: ['isbn']`, the injected `extract` stub must receive `fields` containing exactly `isbn` (input fields don't reach `extract` — they merge via `mergeRow`); with `targetFields: null` all three arrive.

```ts
const seen: string[][] = [];
const fakeExtract = async (req: { fields: Array<{ name: string }> }) => {
  seen.push(req.fields.map((f) => f.name));
  return fakeOutcome({ isbn: '978-1' });
};
```

- [ ] **Step 4: Implement the filter** in `extract-item.ts` before `partitionSchemaByOrigin`:

```ts
const focus = item.targetFields;
const schema = focus
  ? deps.schema.filter((f) => focus.includes(f.name) || f.origin === 'input')
  : deps.schema;
const partitions = partitionSchemaByOrigin(schema);
```

- [ ] **Step 5: Green, full gates, commit** `feat(api): claimed items carry a per-item field focus`

---

### Task 5: Cell merge-back

**Files:**
- Create: `packages/api/src/crawl/merge-backfill.ts`
- Create: `packages/api/src/crawl/merge-backfill.test.ts` (real-Postgres pattern)
- Modify: `packages/api/src/crawl/start-execution.ts` (backfill-aware `onDone`)

**Interfaces:**
- Consumes: `markItemDone` (`record-outcome.ts:12`), `extractions`/`runItems` schemas.
- Produces:

```ts
export async function mergeBackfillResult(
  db: typeof Database,
  backfillItemId: string,   // the backfill run's item (parentId → parent run's item)
  row: Record<string, unknown>,
  targetFields: string[],
): Promise<void>;
```

and `startExecution` gains `opts?: { mergeToParent?: boolean }` — when set, the wired `onDone` becomes `async (itemId, extractionId) => { await markItemDone(db, itemId, extractionId); await mergeBackfillResult(db, itemId, lastRow, targetFields); }` (thread the row + targetFields through `extractItem`'s return — extend `ExecuteDeps.extractItem`'s result to `{ row, extractionId, targetFields }` or capture per-item in the closure; pick ONE and state it in the code).

Merge semantics (binding, from spec §2.3/§5):
1. Load the backfill item → its `parentId` is the parent run's item; load that parent item + its extraction.
2. `data0 = parentExtraction.data[0] ?? {}`. For each `f` of `targetFields`: if `data0[f] == null || data0[f] === ''` and `row[f] != null && row[f] !== ''` → `data0[f] = row[f]`. **Filled parent cells are never touched.**
3. `stillMissing` = target fields still empty after (2) → parent item's `absentFields` = union(existing, stillMissing). Newly-filled fields are REMOVED from `absentFields` if present.
4. Write back: update parent extraction `data = [data0]`; update parent item `absentFields`.
5. Parent item had NO extraction (it failed originally): insert a fresh `extractions` row (`sourceId`, `runId: parentRunId`, `data: [row]`, `rowCount: 1`), set parent item `extractionId` + `status: 'done'` — a backfill heals failed rows.

- [ ] **Step 1: Failing tests** — one per semantic above, seeded through the org cascade: never-overwrite (parent has `title: 'Real'`, backfill row says `title: 'Other'` → parent keeps `'Real'`); fill (parent `isbn: null` → filled); absent marking (target `publisher` still empty → `absentFields: ['publisher']`); absent clearing (was absent, now found → removed); healed failed item.
- [ ] **Step 2: Implement `mergeBackfillResult`, green.**
- [ ] **Step 3: Wire `startExecution` opts** with its own small test (stubbed deps — assert `onDone` calls both when `mergeToParent`, only `markItemDone` otherwise).
- [ ] **Step 4: Full gates, commit** `feat(api): backfill results merge cell-level into the parent run`

---

### Task 6: `crawl.backfill` — the mutation, plain path

**Files:**
- Modify: `packages/api/src/routers/crawl.ts`
- Modify: `packages/api/src/crawl/backfill.ts` (add `planBackfillRun`)
- Test: `packages/api/src/routers/crawl-backfill.test.ts` (new; mock `startExecution` like `sources.test.ts` mocks `planSource`)

**Interfaces:**
- Consumes: Tasks 2–5. Guard precedents: `crawl.ts:82-87` (PRECONDITION_FAILED), `crawl.ts:108-124` (`isNull(runs.completedAt)` reuse-in-flight).
- Produces:

```ts
export async function planBackfillRun(
  db: typeof Database,
  parentRunId: string,
  sourceId: string,
  items: BackfillItemPlan[],
  targetNames: string[],
): Promise<string>; // new runId
```

Inserts the run (`sourceId`, `inputLabel: 'backfill'`, `parentRunId`, `targetFields: targetNames`, `status: 'planned'`) and one `run_items` row per plan entry: `kind: 'detail'`, `url`, `targetFields`, `parentId: parentItemId`, and `inputValues`/`listingValues`/`inputIndex`/`pageNumber` **copied from the parent item** (so `mergeRow` context survives).

Mutation contract:

```ts
backfill: publicProcedure
  .input(z.object({
    runId: z.string().uuid(),
    targetFields: z.array(z.string().min(1)).optional(),
    itemIds: z.array(z.string().uuid()).optional(),
    deadFieldStrategy: z.enum(['repair_sweep', 'full_focus']).optional(),
  }))
  .mutation(async ({ ctx, input }) => { ... })
```

Guards, in order:
1. Parent run exists + has a source (NOT_FOUND / PRECONDITION_FAILED, copy `crawl.ts:297-298`).
2. Parent terminal: `if (!parent.completedAt) throw PRECONDITION_FAILED('parent run is still executing')`.
3. In-flight reuse: existing run with `parentRunId = input.runId` and `completedAt IS NULL` → return `{ backfillRunId: existing.id, status: 'in-progress' as const }`.
4. Derive items (Tasks 2–3 helpers). Empty → `PRECONDITION_FAILED('nothing to backfill — no items are missing the requested fields')`.
5. Classify: any dead field among targets and no `deadFieldStrategy` → `PRECONDITION_FAILED('deadFieldStrategy required: fields with a broken path are in scope')`.
6. Plan the run, `markRunExtracting`, fire-and-forget `startExecution(runId, sourceId, effectiveSchema(source) as OriginField[], undefined, { mergeToParent: true })` (this task: `full_focus`/no-dead path only; Task 7 adds the staged path). Return `{ backfillRunId, items: n }`.

- [ ] **Step 1: Failing router tests** — one per guard (parent not terminal; in-flight reuse returns the same id; empty derivation refused; dead-without-strategy refused) + the happy path asserting the inserted run/items shapes and that the mocked `startExecution` was called once with `mergeToParent: true`.
- [ ] **Step 2: Implement, green, full gates.**
- [ ] **Step 3: Commit** `feat(api): backfill runs — derived items, guarded mutation, merged execution`

---

### Task 7: Repair-then-sweep

**Files:**
- Create: `packages/api/src/crawl/repair-sweep.ts`
- Create: `packages/api/src/crawl/repair-sweep.test.ts`
- Modify: `packages/api/src/routers/crawl.ts` (backfill's `repair_sweep` branch calls it)
- Modify: `packages/api/src/crawl/plan-source.ts` — export a tiny `appendRunLog(db, runId, line)` helper next to `formatPlanLog` (logs is a text column; append with `\n`)

**Interfaces:**
- Consumes: `executeRun` limit machinery (`execute-run.ts:70-73`), `markRunExtracting`, `finaliseRun`, coverage semantics.
- Produces:

```ts
export async function runRepairSweep(
  db: typeof Database,
  runId: string,
  deadFields: string[],
  execute: (opts?: { limit?: number }) => Promise<ExecuteOutcome>, // startExecution-shaped closure
): Promise<'swept' | 'repair_failed'>;
```

Behavior (spec §2.5, binding):
1. `await execute({ limit: REPAIR_SAMPLE_COUNT })` — the first 3 items are the samples; the run finalises `'partial'` (F1 semantics).
2. Evaluate: load the `REPAIR_SAMPLE_COUNT` first completed backfill items whose `targetFields` intersect `deadFields`; a sample **resolves** iff every dead field in its own `targetFields` is now filled in the PARENT's merged row (read back via the parent item — merge already ran).
3. `resolved >= REPAIR_SUCCESS_MIN` → `markRunExtracting` and `await execute({})` (no limit — the sweep; cached paths minted by the samples make it the free tier) → `'swept'`.
4. Else → `appendRunLog(db, runId, 'warning: repair failed for <fields> — sweep skipped, cells left missing')` → `'repair_failed'`. The run stays `'partial'` — honest, terminal, `completed_at` set.

- [ ] **Step 1: Failing tests** with a scripted `execute` stub and seeded parent/backfill rows: ≥2/3 resolve → second `execute` call with no limit; 1/3 → no second call, warning line appended to `runs.logs` (assert via `parseRunLog`-compatible format `warning: ...`); zero eligible samples (all failed) → `repair_failed`.
- [ ] **Step 2: Implement; wire the `repair_sweep` branch** in `crawl.backfill` (fire-and-forget wraps `runRepairSweep` instead of plain `startExecution`; the `execute` closure is `(opts) => startExecution(runId, sourceId, schema, opts?.limit, { mergeToParent: true })` — adjust `startExecution`'s signature from Task 5 so limit passes through).
- [ ] **Step 3: Green, full gates, commit** `feat(api): dead-field repair-then-sweep`

---

### Task 8: Requested fields + per-field toggles (API)

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (`requestFields`, `setFieldEnabled`, forward into `analyze`)
- Modify: `packages/scraper/src/normalize-user-fields.ts` (hint support — inspect first; it parses newline-delimited names today)
- Test: extend `packages/api/src/routers/sources.test.ts`; `packages/scraper/src/normalize-user-fields.test.ts`

**Interfaces:**
- Consumes: `sources.requestedFields` (Task 1); `scraper.analyze`'s existing `requestedFields: z.string().optional()` (`scraper.ts` input) → `runAnalysis`'s `normalizeUserFields` (`analysis-orchestrator.ts:118`) → tier promotion (`:156-164`).
- Produces:

```ts
requestFields: publicProcedure
  .input(z.object({
    sourceId: z.string().uuid(),
    fields: z.array(z.object({ name: z.string().min(1).max(100), hint: z.string().max(500).optional() })).min(1),
  }))
  .mutation(...)
// merge-by-name into sources.requestedFields (replace an existing entry's hint), addedAt = new Date().toISOString()

setFieldEnabled: publicProcedure
  .input(z.object({ sourceId: z.string().uuid(), field: z.string().min(1), enabled: z.boolean() }))
  .mutation(...)
// rewrite selectorsJson.fields with the flag on the named entry; unknown field → NOT_FOUND.
// effectiveSchema and ResultsTable already honor enabled !== false — no other changes.
```

and `sources.analyze` builds the pass-through string from persisted requests:

```ts
const requested = (source.requestedFields as Array<{ name: string; hint?: string }> | null) ?? [];
const requestedFields = requested.length
  ? requested.map((f) => (f.hint ? `${f.name}: ${f.hint}` : f.name)).join('\n')
  : undefined;
const result = await scraperCaller.analyze({ url: source.urlTemplate, pageType, requestedFields });
```

- [ ] **Step 1: Inspect `normalizeUserFields`** — if it does not already split `name: hint` into `{name, description}`, write the failing scraper test first (`'isbn: near the publisher line'` → `{ name: 'isbn', description: 'near the publisher line' }`; bare `'isbn'` unchanged) and extend it minimally. The description flows into `discoverSchema`'s requested-fields prompt for free.
- [ ] **Step 2: Failing router tests** — requestFields persists + merges by name; analyze forwards the joined string (assert on the mocked `runAnalysis`'s received `requestedFields`); setFieldEnabled flips the flag and refuses unknown names; a disabled field disappears from `effectiveSchema(source)`.
- [ ] **Step 3: Implement, green, full gates.**
- [ ] **Step 4: Commit** `feat(api): persisted requested fields + per-field enable toggles`

---

### Task 9: Dashboard — coverage in the run view

**Files:**
- Create: `packages/dashboard/src/lib/coverage-view.ts` + `coverage-view.test.ts` (all logic here — the package has no component harness)
- Modify: `packages/dashboard/src/components/results-table.tsx`
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx`

**Interfaces:**
- Consumes: `trpc.crawl.coverage` (Task 2), `trpc.crawl.backfill` with `itemIds` (Task 6), ResultsTable's existing props (`{data, confidence, fields, headerVariant?}`), rows carry `_url` (digest: `mergeRow` always writes it), coverage `gapItems` carry `url` + `itemId`.
- Produces (in `coverage-view.ts`, all pure + tested):

```ts
export function fillBadge(cov: FieldCoverage | undefined): string | null;
// "36/40" when missing+confirmedAbsent > 0; null when complete (no badge noise on clean columns)
export function rowsMissingField(rows: Row[], field: string, gapByUrl: Map<string, ItemGap>): Row[];
export function selectionToItemIds(selectedUrls: string[], gapByUrl: Map<string, ItemGap>): string[];
export function reExtractLabel(count: number): string; // "Re-extract selected (4 pages — cached paths first, AI only where the cache can't answer)"
export function cellState(value: unknown, field: string, absent: Set<string>): 'filled' | 'missing' | 'absent';
```

- [ ] **Step 1: Failing lib tests** for each helper (the `work-list.test.ts` "names the action and its cost honestly" pattern for `reExtractLabel`).
- [ ] **Step 2: Implement, green.**
- [ ] **Step 3: ResultsTable extensions** (optional props — untouched call sites keep compiling): `coverage?: FieldCoverage[]`, `absentByUrl?: Map<string, Set<string>>`, `selectable?: boolean`, `selectedUrls?: Set<string>`, `onToggleRow?: (url: string) => void`, `onFilterField?: (name: string) => void`. Header shows `fillBadge` as a `micro-label` button firing `onFilterField`; body renders absent cells as `not on page` (distinct gray-400 italic) vs missing `—`; a leading checkbox column when `selectable`.
- [ ] **Step 4: Run page wiring** in `source-run-detail.tsx`: `trpc.crawl.coverage.useQuery({ runId }, { enabled: runIsTerminal && !probeGateShowing })`; filter state (field name | null); selection state; a quiet action bar above the table when a filter or selection is active: "N rows missing `description` — Select all · Re-extract selected (…)" → `crawl.backfill.mutate({ runId, itemIds, targetFields: [field] })` → navigate to the returned `backfillRunId`'s run page. **The button is the only spender; it shows the page count; per the funding constraint it stays behind Marko's explicit click by construction.**
- [ ] **Step 5: `tsc --noEmit` clean, dashboard tests green, full gates. Commit** `feat(dashboard): coverage badges, gap filter, re-extract selection`

---

### Task 10: Dashboard — backfill preview panel + backfill run page

**Files:**
- Create: `packages/dashboard/src/lib/backfill-preview.ts` + test
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx`
- Modify: `packages/dashboard/src/lib/run-progress.ts` (+ its test)

**Interfaces:**
- Consumes: `trpc.crawl.backfillPreview`, `trpc.crawl.backfill`, `runs.getWithDetails` (returns `inputLabel`, and after Task 1 the run's `parentRunId` — extend `runs.getWithDetails`'s run columns with `parentRunId` and `targetFields`; small `runs.ts` change, covered by its existing test file).
- Produces (pure, tested):

```ts
export function previewSummary(p: {items: number; pages: number; estCostUsd: number}): string;
// "17 rows, 17 pages — up to ~$0.85 if no cache answers"
export function strategyCopy(f: FieldClassification): { title: string; recommended: string; alternative: string } | null; // null for healthy
```

- [ ] **Step 1: Failing lib tests, implement, green.**
- [ ] **Step 2: The panel.** On a terminal non-probe run with gaps: a `card` under the coverage bar — "Backfill gaps" opens the preview (fields checklist with fill bars, classification chips, per-dead-field strategy radio defaulting to repair-then-sweep, the `previewSummary` line, one `btn-primary` "Run backfill"). Mutation → navigate to the backfill run.
- [ ] **Step 3: Backfill run page affordances.** In `run-progress.ts`, `runControls` gains `opts?: { …, backfill?: boolean }`: a backfill run shows Stop while active but **never** "Extract N pending" after `repair_failed` (pending items on a terminal backfill run are the failed repair's remainder — the honest affordance is the parent's preview again, not a raw re-execute). Test in `run-progress.test.ts` next to the `probeUnconfirmed` cases. On the page: when `run.parentRunId`, a breadcrumb line "Backfill of run <short-id> · fields: title, isbn" linking back to the parent, and the parent's page gets an equivalent "Backfilled by run <short-id>" line (both derived from data already loaded — no new queries).
- [ ] **Step 4: `tsc` clean, tests green, full gates. Commit** `feat(dashboard): backfill preview panel and backfill run affordances`

---

### Task 11: Dashboard — add-fields loop (Set-up + confirm gate)

**Files:**
- Create: `packages/dashboard/src/lib/add-fields.ts` + test (input parsing: one field per line, `name: hint` form, dedupe, name validation `[a-z0-9_]{1,100}` after lowercase/trim)
- Modify: `packages/dashboard/src/routes/source-setup.tsx` (FieldsTable + add-fields control)
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx` (gate action)

**Interfaces:**
- Consumes: `sources.requestFields`, `sources.setFieldEnabled`, `sources.analyze` (Task 8); FieldsTable currently read-only (`source-setup.tsx:287-338`); ProbeConfirmGate action row (`:474-496`).
- Produces: user-visible behavior only.

- [ ] **Step 1: Failing lib tests** for the parser (valid lines, hint split on first `:`, blank/dup lines dropped, invalid names reported not silently eaten — return `{fields, rejected}`).
- [ ] **Step 2: FieldsTable toggles.** Add an Enabled checkbox column → `sources.setFieldEnabled` per flip (optimistic off; invalidate `sources.listByProject` on settle — the page's existing invalidation pattern at `source-setup.tsx:68-71`). Disabled rows render dimmed.
- [ ] **Step 3: Add-fields control** under FieldsTable: mono textarea (placeholder `isbn: near the publisher line`), parse via the lib, `sources.requestFields` then — **explicitly, as a second labeled button, never automatically** — "Re-analyze with N requested fields (may use AI for a new domain)" firing the existing `analyzeMutation`. Persisting intent is free; analyzing is the click.
- [ ] **Step 4: Gate action.** In ProbeConfirmGate, next to "Something's wrong": a quiet "Request more fields" button revealing the same control inline (shared component extracted from Step 3); its re-analyze button navigates back to Set-up after firing so the user lands where the new schema appears.
- [ ] **Step 5: `tsc` clean, tests green, full gates. Commit** `feat(dashboard): add-fields loop at Set-up and the confirm gate`

---

### Task 12: Live proof + docs — STOPS FOR MARKO, TWICE

**Files:**
- Modify: `docs/handoff.md`, `docs/roadmap.md`

**Gate: every paid step below requires (a) Marko's explicit go in-conversation AND (b) his confirmation that the Anthropic API account is funded (as of 2026-08-28 it is NOT — see memory `anthropic-api-not-funded`). Free steps may run without (b).**

- [ ] **Step 1 (free): coverage on real data.** Dev servers up; open the AbeBooks full run (`6c0a9463`) — the coverage badges must reproduce the known fill table (`image_url` 13/40, `isbn` 36/40, …); filter + selection UI works; backfill preview classifies `image_url` healthy-ish (13/40 = dead, actually — 0.325 < 0.5: expect the dead classification and say so) and `listing_id` dead. Screenshot everything. No clicks past any preview.
- [ ] **Step 2 (PAID — STOP FOR MARKO + funding):** backfill `isbn`/`publisher`/`url` (the small-gap healthy fields — a handful of pages) via manual selection; verify cells fill in the parent run and the export; then repair-then-sweep on `listing_id` (0/40 dead): 3 samples, evaluate, sweep or honest `repair_failed` warning. Record run ids + outcomes in `docs/handoff.md`.
- [ ] **Step 3 (free): docs.** `handoff.md` dated entry (what the repair engine is, run ids, outcomes); `roadmap.md` marks the repair-engine items delivered with a pointer to the spec.
- [ ] **Step 4: Commit** `docs: repair-engine live proof and handoff`

---

## Self-review notes (applied)

- Spec coverage: §2.1→T2, §2.2→T1+T2 semantics, §2.3→T1/T5/T6, §2.4→T3/T9/T10, §2.5→T3/T7/T10, §2.6→T8/T11, §3→T1, §4→T2/T3/T6/T8, §5→T4/T5/T7, §6→T9/T10/T11, §7→per-task tests + T12.
- The spec's §4 wording "refuses when … a backfill for the same parent is already in flight" is implemented as reuse-and-return (T6 guard 3), matching `probeAndSample`'s precedent — spec's intent is no-duplicate-spend, and returning the in-flight id is the kinder contract the UI already knows.
- Type consistency: `FieldCoverage`/`ItemGap`/`BackfillItemPlan`/`FieldClassification` defined once (T2/T3) and consumed by name in T6/T7/T9/T10. `startExecution`'s signature changes land once (T5, limit pass-through noted in T7 Step 2).
- Per-field persistence deliberately NOT added (no `fieldsByTier` storage): coverage derives from `extractions.data[0]` key-presence — one source of truth, zero migration risk on historical runs.
