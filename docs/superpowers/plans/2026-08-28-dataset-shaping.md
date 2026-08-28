# Dataset Shaping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-dataset, non-destructive shaping config (column ops, total transforms, fallback merges, URL-keyed row exclusions) applied by one shared function to both the run results view and the export, with a raw toggle everywhere — plus the one-click candidates bridge.

**Architecture:** One `shaping jsonb` column on `datasets`. One pure `applyShaping(rows, fields, shaping)` in a new `packages/api/src/shaping/` module (types + zod validation, a NEW name-keyed transform registry — reconnaissance confirmed no existing registry to extend — and the shaper), consumed server-side by `runs.getWithDetails` (new `raw?: boolean` input) and by the export path (`loadRunExport` joins the dataset's shaping; route honors `?raw=1`). The dashboard renders what the API delivers plus a raw toggle; the editor lives on the dataset page beside `SchemaFieldOrigins`; the column-header menu lands in `ResultsTable`. Row exclusions key on the row's `_url` (rows carry no persisted item id; `_url` is unique per run item and is the better dataset-level semantic).

**Tech Stack:** Drizzle/Postgres, tRPC v11 + Zod (`.superRefine` for cross-field checks), Hono export route, Vite/TanStack dashboard.

**Spec:** docs/superpowers/specs/2026-08-28-dataset-shaping-design.md (amended 2026-08-28: transforms registry built fresh; exclusions keyed by URL; candidates bridge deep-links to the dataset page's selector)

## Global Constraints

- **This plan executes AFTER the repair-engine branch merges** — `results-table.tsx` and `source-run-detail.tsx` will already carry coverage badges, selection, and optional-prop extensions (repair-engine Tasks 9–11). Every dashboard task here composes with that tree; on conflict, the file on disk wins over this plan's line numbers.
- **Everything in this plan is AI-free** — shaping is config; no task reaches the Anthropic API (the funding freeze does not block any of it). Task 10's live proof is free (config edits + reads + export).
- `applyShaping` and every transform are **total**: non-matching input passes through unchanged; shaping never nulls data. Raw is always recoverable (`raw` flag on reads; config is the only thing that changes).
- Shaping applies **everywhere by default** (results view AND export show shaped; `raw` reveals the untouched extraction) — Marko's explicit decision.
- Migration number: the next free index in `packages/db/drizzle/meta/_journal.json` at execution time (repair-engine owns 0008; expect 0009 — verify, don't assume).
- Verification gates after every task: `pnpm -r test` green (Docker Postgres `robot-platform-db` running), `pnpm typecheck` green, `pnpm --filter @robot/dashboard exec tsc --noEmit` clean, cache-hygiene query 0 rows (`select domain, page_type from domain_intelligence where domain in ('example.com','listing.example') or domain like 'test-%';`).
- Dashboard has NO component-test harness — all dashboard logic goes into `lib/*.ts` files with unit tests; components stay thin.
- Shell is Windows PowerShell 5.1: no `&&` chaining.

---

### Task 1: Schema — `datasets.shaping`

**Files:**
- Create: `packages/db/drizzle/00NN_dataset_shaping.sql` (+ journal + snapshot, 0007/0008 conventions)
- Modify: `packages/db/src/schema.ts` (datasets table, ~line 51)
- Test: extend the db package's schema round-trip test file (created by repair-engine Task 1 as `schema.test.ts` — extend it)

**Interfaces:**
- Produces: `datasets.shaping: jsonb | null` — consumed by Tasks 5–6 as `DatasetShaping | null`.

- [ ] **Step 1: Migration** — `ALTER TABLE "datasets" ADD COLUMN "shaping" jsonb;` with journal + snapshot registration.
- [ ] **Step 2: schema.ts** — `shaping: jsonb('shaping'),` on `datasets`.
- [ ] **Step 3: Failing round-trip test** (insert a dataset with a shaping object, read it back) — red before `pnpm db:migrate`, green after.
- [ ] **Step 4: Full gates. Commit** `feat(db): datasets.shaping column`

---

### Task 2: Shaping types + validation

**Files:**
- Create: `packages/api/src/shaping/types.ts`
- Create: `packages/api/src/shaping/types.test.ts` (the `datasets-schema-field.test.ts` pattern: bare zod parse, no DB)

**Interfaces:**
- Produces (consumed by every later task — names are binding):

```ts
import { z } from 'zod';

export const shapingColumnSchema = z.object({
  field: z.string().min(1),
  rename: z.string().min(1).max(100).optional(),
  hidden: z.boolean().optional(),
});
export const shapingTransformSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['strip_prefix', 'strip_suffix', 'regex_extract', 'split_take', 'template']),
  args: z.record(z.unknown()),
});
export const shapingFallbackSchema = z.object({
  deliver: z.string().min(1).max(100),
  prefer: z.string().min(1),
  fallback: z.string().min(1),
});
export const shapingRowExclusionSchema = z.object({
  url: z.string().min(1),
  reason: z.string().max(500),
  at: z.string(), // ISO timestamp, written by the API not the client
});
export const datasetShapingSchema = z.object({
  columns: z.array(shapingColumnSchema).default([]),
  transforms: z.array(shapingTransformSchema).default([]),
  fallbacks: z.array(shapingFallbackSchema).default([]),
  rowExclusions: z.array(shapingRowExclusionSchema).default([]),
});
export type DatasetShaping = z.infer<typeof datasetShapingSchema>;

/** Cross-field checks zod's shape can't express. Errors REJECT the save; warnings accompany it. */
export function validateShaping(shaping: DatasetShaping, knownFields: string[]): { errors: string[]; warnings: string[] };
```

`validateShaping` semantics (binding): **errors** — duplicate delivered names (a delivered name = each visible column's `rename ?? field`, plus every `fallbacks[].deliver`; any collision including with an unrenamed visible field); `regex_extract` whose `args.pattern` does not compile (`new RegExp` in try/catch); `split_take` whose `args.index` is not a non-negative integer; `strip_prefix`/`strip_suffix` without a string `args.prefix`/`args.suffix`; `template` without a string `args.template` containing `{value}`. **Warnings** — any `columns[].field`, `transforms[].field`, `fallbacks[].prefer/.fallback` not in `knownFields` (the schema may have evolved; tolerated per spec §7).

- [ ] **Step 1: Failing tests** — one per error rule (each with the exact offending config), one per warning rule, one clean config with zero errors/warnings, and a zod-level parse-reject (unknown `op`).
- [ ] **Step 2: Implement, green, full gates. Commit** `feat(api): dataset shaping types and validation`

---

### Task 3: The transform registry

**Files:**
- Create: `packages/api/src/shaping/transforms.ts`
- Create: `packages/api/src/shaping/transforms.test.ts`

**Interfaces:**
- Produces:

```ts
export type TransformFn = (value: unknown, args: Record<string, unknown>) => unknown;
export const TRANSFORMS: Record<'strip_prefix' | 'strip_suffix' | 'regex_extract' | 'split_take' | 'template', TransformFn>;
export function applyTransform(op: string, value: unknown, args: Record<string, unknown>): unknown;
// unknown op or non-string value (except template, which stringifies) → value unchanged. TOTAL, always.
```

Semantics: `strip_prefix` — remove `args.prefix` if the string starts with it; `strip_suffix` mirror; `regex_extract` — first match of `args.pattern` (first capture group if present, else whole match), non-matching → unchanged; `split_take` — split on `args.delimiter`, take `args.index`, out-of-range → unchanged; `template` — `String(args.template).replace('{value}', String(value))`, null/undefined value → unchanged (never renders "null").

- [ ] **Step 1: Failing tests** — per op: the happy case, the non-matching-input-passes-through case, and the non-string-input-passes-through case; plus `applyTransform('nonsense', v, {})` → `v`, and an invalid regex at apply time → unchanged (validation rejects it at save; apply still must not throw).
- [ ] **Step 2: Implement, green, full gates. Commit** `feat(api): total transform registry for dataset shaping`

---

### Task 4: `applyShaping`

**Files:**
- Create: `packages/api/src/shaping/apply-shaping.ts`
- Create: `packages/api/src/shaping/apply-shaping.test.ts`
- Modify: `packages/api/src/shaping/index.ts` (new barrel: types, transforms, shaper)

**Interfaces:**
- Consumes: Tasks 2–3; `deriveColumns`' ordering rule (`build-run-export.ts:50` — listed order first, unlisted appended in first-encounter order; reuse the algorithm shape, not the function).
- Produces:

```ts
export type ShapedResult = { fields: string[]; rows: Record<string, unknown>[]; excludedCount: number };
export function applyShaping(
  rows: Record<string, unknown>[],
  rawFields: string[],               // the unshaped column list (deriveColumns output or selectorsJson names)
  shaping: DatasetShaping | null,    // null → identity: fields=rawFields, rows untouched, excludedCount 0
): ShapedResult;
```

Pipeline order (binding): (1) drop rows whose `_url` is in `rowExclusions` (count them); (2) apply transforms per field; (3) compute fallback columns (`deliver` value = transformed `prefer` if non-empty else transformed `fallback`); (4) column pass — listed visible columns in config order under their delivered names, then fallback `deliver` columns not already listed, then unlisted raw fields in `rawFields` order, hidden ones dropped; system keys `_url`/`_page_number` never appear as columns but survive ON the row objects (the view needs `_url` for row actions). Renames move the VALUE to the new key in the emitted rows.

- [ ] **Step 1: Failing tests** — identity on null shaping; exclusion by `_url` with count; rename moves value + header; hidden drops column but not the row key... (decide: emitted rows contain only delivered columns + `_url`/`_page_number` — assert that); transform applied before fallback (a prefer field emptied by a transform falls back); fallback with both empty → empty string not "undefined"; unlisted-field append order; the spec §3 example config end-to-end.
- [ ] **Step 2: Implement, green, full gates. Commit** `feat(api): applyShaping — the one shared shaper`

---

### Task 5: Shaping API surface

**Files:**
- Modify: `packages/api/src/routers/datasets.ts`
- Test: extend `packages/api/src/routers/datasets-schema-field.test.ts` sibling (new `datasets-shaping.test.ts`, real-Postgres pattern with org-cascade cleanup)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:

```ts
getShaping:   query    { datasetId: uuid } → { shaping: DatasetShaping | null }
updateShaping: mutation { datasetId: uuid, shaping: datasetShapingSchema }
  → { dataset, warnings: string[] }   // validateShaping errors → BAD_REQUEST listing them;
                                      // warnings returned, save proceeds; sets updatedAt (deliberately
                                      // unlike updateSchema, which leaves it stale — do not "fix" updateSchema here)
previewTransform: query { datasetId: uuid, transform: shapingTransformSchema, limit: z.number().int().min(1).max(10).default(10) }
  → { pairs: Array<{ before: unknown; after: unknown }> }
  // sample rows: the dataset's sources → the most recent run with extractions → first `limit` rows' transform.field values
excludeRow:  mutation { datasetId: uuid, url: z.string().min(1), reason: z.string().max(500) } → { shaping }
restoreRow:  mutation { datasetId: uuid, url: z.string().min(1) } → { shaping }
  // both rewrite rowExclusions (dedupe by url; `at` stamped server-side); dataset without shaping → initialize {}
```

`knownFields` for validation: the dataset schema's names if non-empty, else the union of its sources' `selectorsJson.fields` names (mirror `effectiveSchema`'s precedence).

- [ ] **Step 1: Failing router tests** — updateShaping rejects a delivered-name collision with BAD_REQUEST naming it; accepts-with-warning on an unknown field; excludeRow then restoreRow round-trip; previewTransform returns before/after pairs from seeded extraction rows; getShaping on a never-shaped dataset → null.
- [ ] **Step 2: Implement, green, full gates. Commit** `feat(api): dataset shaping endpoints`

---

### Task 6: Shaped reads — results + export + raw toggles

**Files:**
- Modify: `packages/api/src/routers/runs.ts` (`getWithDetails`)
- Modify: `packages/api/src/export/load-run-export.ts`, `build-run-export.ts`
- Modify: `packages/api-server/src/routes/export.ts`
- Modify: `packages/dashboard/src/lib/export-url.ts`
- Test: extend `packages/api/src/routers/runs.test.ts`, `packages/api/src/export/build-run-export.test.ts` (or sibling), `packages/api-server`'s export route test

**Interfaces:**
- Consumes: `applyShaping`; `RunExport` (`build-run-export.ts:30`); route `GET /export/runs/:file` (no query parsing today — add `c.req.query('raw')`).
- Produces:
  - `runs.getWithDetails` input becomes `{ id: uuid, raw?: boolean }`; loads the source's dataset (`with: { dataset: { columns: { slug: true, shaping: true } } }` added to the source relation load); when shaping exists and `!raw`, the returned `extraction.data` and a NEW top-level `shaped: { fields: string[], excludedCount: number } | null` reflect `applyShaping`; `raw: true` returns today's exact payload with `shaped: null`. The `source` projection ALSO gains `datasetSlug` (for the candidates deep link) regardless of raw.
  - `RunExportInput` gains `shaping: DatasetShaping | null`; `buildRunExport` applies it (fields = shaped fields, rows = shaped rows) unless the new `raw` flag in the input is set; `loadRunExport(db, runId, opts?: { raw?: boolean })` joins `source → dataset` for `shaping` and threads through.
  - Export route: `?raw=1` → `loadRunExport(runId, { raw: true })`; `ExportDeps.loadRunExport` signature widens accordingly. `exportUrl` helper gains `raw?: boolean` appending `?raw=1`.

- [ ] **Step 1: Failing export tests** — shaped by default (renamed header in CSV, hidden column absent, excluded row gone, fallback column present); `raw: true` byte-identical to today's output; BOM + RFC 4180 behavior untouched.
- [ ] **Step 2: Failing `getWithDetails` tests** — shaped data + `shaped.fields` + `excludedCount`; `raw: true` passthrough; `datasetSlug` present both ways.
- [ ] **Step 3: Implement all, green, full gates. Commit** `feat(api): shaped results and export with raw escape hatch`

---

### Task 7: Dashboard — shaping summary bar + raw toggle

**Files:**
- Create: `packages/dashboard/src/lib/shaping-summary.ts` + test
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx`

**Interfaces:**
- Consumes: `runs.getWithDetails` with `raw` + `shaped` (Task 6). Rendered fields: when `shaped` is non-null, the table's columns are `shaped.fields` verbatim (already renamed/ordered/hidden server-side) — the client builds `fields` props as `shaped.fields.map(name => ({name, type: 'string'}))` and stops filtering `DETAIL_URL_FIELD` in shaped mode (the server already handles it); raw mode keeps today's path byte-for-byte.
- Produces (pure, tested): `shapingSummaryLine(shaping-ish: { renames: number; transforms: number; hidden: number; excluded: number }): string | null` — null when nothing is active; otherwise e.g. `"2 renames · 1 transform · 1 hidden column · 1 excluded row"`.

- [ ] **Step 1: Failing lib tests** (singular/plural, null on all-zero), implement, green.
- [ ] **Step 2: Wire the page** — `useState(rawView)`; query passes `raw: rawView`; when `shaped` non-null render the summary bar (`card` strip above the table): summary line + a `btn-quiet` "View raw" / "View shaped" toggle. Raw view shows excluded rows struck-through (match by `_url` against the shaping read — one extra `datasets.getShaping` query keyed by the new `datasetSlug`... no: excluded urls are derivable only from shaping; fetch `datasets.getShaping` lazily when entering raw view).
- [ ] **Step 3: Export buttons** state the shape: "Export CSV (shaped)" with a small "raw" link using `exportUrl(runId, 'csv', {raw: true})`.
- [ ] **Step 4: `tsc` clean, tests green, full gates. Commit** `feat(dashboard): shaping summary bar and raw toggle`

---

### Task 8: Dashboard — column-header menu + transform dialog + row menu

**Files:**
- Create: `packages/dashboard/src/lib/column-menu.ts` + test (menu-item derivation, dialog state marshalling, candidates-link building)
- Modify: `packages/dashboard/src/components/results-table.tsx`
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx`

**Interfaces:**
- Consumes: Task 5 mutations; `pickerOptions` returning `null` below 2 candidates (`candidate-picker.ts:87`) — the menu handles that; deep link target `/p/$project/datasets/$dataset?field=<name>` (Task 9 implements the anchor); repair-engine's ResultsTable extensions (compose, don't collide — header cells will already carry coverage badges).
- Produces (pure, tested in `column-menu.ts`):

```ts
export type ColumnMenuItem = { key: 'rename'|'hide'|'transform'|'fallback'|'candidates'|'reextract'; label: string; disabled?: boolean; disabledReason?: string };
export function columnMenuItems(field: string, opts: { candidateCount: number; hasDataset: boolean }): ColumnMenuItem[];
export function candidatesLink(projectSlug: string, datasetSlug: string, field: string): { to: string; search: Record<string, string> };
export function buildRenamePatch(shaping: DatasetShaping, field: string, rename: string): DatasetShaping;
export function buildHidePatch(shaping: DatasetShaping, field: string): DatasetShaping;
export function buildTransformPatch(shaping: DatasetShaping, t: ShapingTransform): DatasetShaping; // replaces an existing transform on the same field+op
export function buildFallbackPatch(shaping: DatasetShaping, f: ShapingFallback): DatasetShaping;
```

- [ ] **Step 1: Failing lib tests** for every helper (patches are non-destructive copies; menu disables candidates below 2 with a reason; reextract disabled without the repair-engine's selection machinery present — feature-detect via a prop, not an import).
- [ ] **Step 2: ResultsTable** — optional props `onColumnMenu?: (field: string) => void` (header cells gain a quiet `▾` button when present; composes beside the coverage badge). The menu itself renders in `source-run-detail.tsx` (Radix dropdown, existing pattern), items from `columnMenuItems`.
- [ ] **Step 3: Dialogs** — Rename (inline input → `buildRenamePatch` → `updateShaping`), Hide (immediate patch), Transform (op select + args inputs + **live preview via `previewTransform` — mandatory before Save**, pairs rendered before/after), Prefer/fallback (two field selects + deliver name). All mutations invalidate `runs.getWithDetails` + `datasets.getShaping`. Save disabled while the preview query is loading; `updateShaping`'s `warnings` render as a dismissible note.
- [ ] **Step 4: Row menu** — per-row quiet `▾` (needs `_url` from the row object): "Exclude row…" (reason prompt → `excludeRow`), "Restore" in raw view on struck rows; "Re-extract row" delegates to the repair-engine selection flow when present.
- [ ] **Step 5: `tsc` clean, tests green, full gates. Commit** `feat(dashboard): column menu, transform dialog with live preview, row exclusions`

---

### Task 9: Dashboard — the shaping editor on the dataset page + field anchor

**Files:**
- Create: `packages/dashboard/src/lib/shaping-editor.ts` + test (list-reorder/patch helpers)
- Modify: `packages/dashboard/src/routes/dataset-detail.tsx`

**Interfaces:**
- Consumes: Task 5; `SchemaFieldOrigins`' local-state + explicit-Save pattern (`dataset-detail.tsx:83-95, 231-238` — copy its shape); TanStack search params for `?field=`.
- Produces: user-visible behavior.

- [ ] **Step 1: Failing lib tests** for reorder/remove helpers (pure array ops on `DatasetShaping`).
- [ ] **Step 2: Editor section** on `dataset-detail.tsx` under `SchemaFieldOrigins`: the full config visible — columns (order via up/down, rename inputs, hidden toggles), transforms list (op + args + remove), fallbacks list, exclusions list (url + reason + restore) — local state seeded from `datasets.getShaping`, explicit Save via `updateShaping`, warnings surfaced, errors inline.
- [ ] **Step 3: `?field=` anchor** — `SchemaFieldOrigins` reads the search param, scrolls to and highlights that field's row (the candidates deep-link landing).
- [ ] **Step 4: `tsc` clean, tests green, full gates. Commit** `feat(dashboard): dataset shaping editor and field anchor`

---

### Task 10: Free live proof + docs

**Files:**
- Modify: `docs/handoff.md`, `docs/roadmap.md`

**Everything here is free — no AI, no crawling. No funding gate; show Marko the results when done.**

- [ ] **Step 1:** Dev servers up; on the AbeBooks dataset (Scratch project), build the spec §1 shapes through the real UI: strip the condition prefix if the live values carry one (inspect first, use what's really there), hide the near-duplicate column behind a fallback merge, deliver `_url` as the url column via rename+hide (and if the `url` field has ≥2 candidates, demonstrate the candidates deep link), exclude one row with a reason. Screenshot the shaped table, the raw toggle (struck row visible), the summary bar, the editor page.
- [ ] **Step 2:** Export CSV+JSON both shaped and `?raw=1`; verify headers, excluded row, fallback column; attach the four outputs to the workspace.
- [ ] **Step 3:** Docs — `handoff.md` dated entry (what shaping is, where the editor lives, what was demonstrated); `roadmap.md` marks the shaping items delivered with the spec pointer.
- [ ] **Step 4: Commit** `docs: dataset shaping live proof and handoff`

---

## Self-review notes (applied)

- Spec coverage: §2→T6/T7 (everywhere + raw), §3→T1/T2/T4 (URL-keyed exclusions per amendment), §4→T3 (fresh registry per amendment; totality tested per-op), §5→T8/T9 (deep link + anchor + disabled-below-2), §6→T4/T6 (one shaper, two consumers), §7→T5 (errors reject, warnings accompany), §8→T7/T8, §9→per-task tests + T10, §10 exclusions honored (no computed columns, one shape per dataset, no templates, manual fallbacks only).
- Type consistency: `DatasetShaping`/`ShapedResult`/patch helpers defined once (T2/T4/T8) and consumed by name; `loadRunExport`'s widened signature (T6) updates its one consumer (`ExportDeps`, `app.ts:21`) in the same task.
- Deliberate divergences called out in-task: `updateShaping` sets `updatedAt` while `updateSchema`'s stale-timestamp gap is left alone; export's documented non-use of `effectiveSchema` is preserved (shaping wraps `deriveColumns`' output, it does not re-derive).
- The repair-engine dependency is a constraint, not a task: dashboard tasks feature-detect its machinery (T8 Step 1) rather than import-assume it.
