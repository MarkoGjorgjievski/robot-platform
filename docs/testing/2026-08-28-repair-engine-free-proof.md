# Task 12 report

## Step 1 (free live check)

**Setup.** Docker Postgres `robot-platform-db` was already running. Both dev servers
(dashboard :3456, api-server :4000) were stopped and restarted onto branch
`feat/repair-engine` head `189052e` (`pnpm dev:all` via `pnpm.cmd`, since `Start-Process`
against the `pnpm` name resolves to `pnpm.ps1`, which `Start-Process` cannot launch
directly on this machine — using the `.cmd` shim worked). Full run id resolved via SQL:
`6c0a9463-ac8b-4e69-929a-f78307ee1a1d` on source `344bc5aa-4ce8-4144-9b5f-c41945586229`
(`abebooks-com-353m8e`). Confirmed via SQL before starting: `requested_fields` empty,
no run has `parent_run_id` set (no backfill run exists yet).

Driven with headless Playwright `.mts` scripts run via
`pnpm --filter @robot/browser exec tsx <script>` (module resolution required the
scripts to sit under `packages/browser/` while running; canonical copies kept under
this `.superpowers/sdd/2026-08-28-repair-engine/` directory, temp copies deleted after
each run). No forbidden buttons (Run backfill / Re-extract selected / Re-analyze /
Analyze) were ever clicked.

### 1. Coverage badges — MATCH
Header badges on the run page: `url 39/40`, `isbn 36/40`, `title 4/40`, `author 4/40`,
`image_url 13/40`, `publisher 39/40`, `listing_id 0/40`, `book_format 39/40`,
`item_condition 37/40`, `condition_labels 37/40`. Spot-checked values (title 4/40,
isbn 36/40, image_url 13/40) match the known fill table exactly; publisher shows
39/40, consistent with "most others 40/40" (publisher itself is called out as 39/40).
Screenshot: `t12-s1-coverage.png`.

### 2. Filter + selection + clear — CORRECT
Clicking the isbn badge narrowed the results table to exactly 4 rows (checkbox count
confirmed: 4 selectable rows under the isbn filter). Selecting 2 of them produced the
action bar text: `Re-extract selected (2 pages — cached paths first, AI only where the
cache can't answer)` — matches the honest-cost copy spec. Screenshot:
`t12-s1-filter-selection.png`.

Switching the filter to the `title` badge cleared the selection to 0 checked rows
(Task 9's fix confirmed live). Screenshot: `t12-s1-filter-switch-clear.png`. The
Re-extract button was never clicked.

### 3. Backfill preview panel — classifications correct; summary line does NOT shrink
Opening "Backfill gaps" showed all 10 gappy fields with fill bars and
healthy/dead classification:
- `title` 10% filled — **dead**
- `author` 10% filled — **dead**
- `image_url` 33% filled — **dead**
- `listing_id` 0% filled — **dead**
- `isbn` 90%, `publisher` 98%, `url` 98%, `book_format` 98%, `item_condition` 93%,
  `condition_labels` 93% — all **healthy**

This matches the expected classification (title/author/image_url dead at
0.10/0.10/0.325 < 0.5 threshold; isbn/publisher healthy). Every dead field showed the
repair-then-sweep vs full-focus strategy radio pair, defaulting to repair-then-sweep,
for a total of 8 radio inputs (4 dead fields × 2 options). Preview summary line: `40
rows, 40 pages — up to ~$2.00 if no cache answers`. Screenshot: `t12-s1-preview-dead.png`.

Unchecking **all four** dead fields correctly removed the strategy radio section
entirely (8 → 0 radios) and left "Run backfill" enabled (healthy fields were still
checked). Screenshot: `t12-s1-preview-healthy.png`.

**Defect / expectation mismatch:** the previewSummary line did **not** shrink after
unchecking the dead fields — it stayed at `40 rows, 40 pages — up to ~$2.00 if no cache
answers`, identical to the fully-checked state. Root cause: `BackfillGapsPanel` in
`source-run-detail.tsx` always calls `previewSummary` with the fixed
`previewQuery.data.{items,pages,estCostUsd}` from the one preview query fired for the
full `gappyFieldNames` set — it is never recomputed against the checked subset
(`packages/dashboard/src/lib/backfill-preview.ts`, `previewSummary`). The code's own
doc comment calls this an intentional "honest upper bound," but the task's step 3
explicitly expects the summary to shrink on uncheck, and it visibly does not — worth a
product decision on whether this is correct behavior or a gap.

### 4. Absent cells + empty-filter note — correct, no absent cells (expected)
No `absentFields` exist yet (no backfill has ever run against this run), so no
extraction cell anywhere on the page renders "not on page" — verified via a full-page
text scan (0 matches). This is the expected state since nothing has been confirmed
absent yet.

### 5. Add-fields loop (Set-up page) — verified
Note: the bare source URL (`/p/scratch/sources/abebooks-com-353m8e`) resolves to
**Overview**, not Set-up, once a run has completed — Set-up lives at
`/p/scratch/sources/abebooks-com-353m8e/setup` (`source-index.tsx`'s documented
default-tab behavior). Used the explicit `/setup` URL.

FieldsTable rendered 19 field rows with Enabled checkboxes. Toggled `title`'s checkbox
OFF (row dimmed with `opacity-50`), reloaded — the OFF state and the dim styling
persisted correctly. Toggled it back ON, reloaded again — ON state and undimmed
styling persisted correctly. (Restored to its original ON state as the last action,
confirmed by a follow-up reload.)

In the Add-fields textarea, typed:
```
page_count: near the binding details
!!!
```
Rejected-line note appeared: `1 line skipped: !!!`. Clicked "Save requested fields"
(free) → success state, and the "Re-analyze with 1 requested field (may use AI for a
new domain)" button appeared. It was **not** clicked. SQL-verified
`sources.requested_fields`:
```json
[{"hint": "near the binding details", "name": "page_count", "addedAt": "2026-08-28T13:48:47.491Z"}]
```
Screenshots: `t12-s1-addfields.png` (typed, pre-save), `t12-s1-addfields-saved.png`
(post-save, Re-analyze button visible).

### 6. Backfill run-page affordances — deferred, precondition confirmed
SQL-confirmed no run for this source has `parent_run_id` set — no backfill run exists,
as expected, since nothing was ever clicked to create one. Breadcrumb rendering
(`Backfill of run …`, `Backfilled by run …`) and the no-Extract-pending affordance on
a backfill run's own page are deferred to the paid Step 2, where an actual backfill
run will exist.

### Servers
Left running (dashboard :3456, api-server :4000) per instructions.

### Defects found
1. **Backfill preview summary line does not shrink** when dead fields are unchecked
   (see §3 above) — contradicts the task's stated expectation, though it matches an
   explicit design comment in the code calling it a fixed "upper bound." Flagged for a
   product/spec decision, not fixed in this step (Step 1 is observation-only).

No other UI misbehavior observed. Badges, filter/selection/clear, dead/healthy
classification, strategy defaults, rejected-line handling, and requested-fields
persistence all matched expectations.
