# Final whole-branch review findings (941cac3..189052e) — verdict: needs-fixes

Fix findings 1-3 (blockers) and minors 4, 5, 6, 8a. Do NOT touch 7 or 8b (parked).

## 1. Critical — resume/retry on a backfill run silently drops merge-to-parent

`packages/api/src/routers/crawl.ts:351` — `crawl.execute` calls `startExecution(runId, sourceId, schema, limit)` with no `{mergeToParent: true}` and never inspects `parentRunId`. Every non-initial execution path of a backfill run goes through it: Retry-N-failed (run-progress.ts:76 keeps showRetry in the backfill branch), Extract-N-pending on a stalled-active backfill, crash-resume. Scenario: a backfill item fails (R4 explicitly made merge throws retryable), operator clicks Retry → page re-fetched and PAID, item marked done via plain onDone, row lands only in the backfill run's own extraction — the parent cell stays empty forever and the next backfill pays for the same page again. Breaks R4's "'done' MEANS merged".

Fix: in `crawl.execute`, the run row already loads — read `parentRunId` and pass `{mergeToParent: true}` when set. TDD: router test — retryFailed on a backfill run must call startExecution with mergeToParent true (mock-assert), and a non-backfill run must not.

## 2. Important — Stop during the repair-sweep sample stage is overridden; the sweep runs after an explicit cancel

`packages/api/src/crawl/repair-sweep.ts:44-85` + `mark-extracting.ts:44`. The sample `execute({limit:3})` can finalise the run 'cancelled' (operator clicked Stop mid-samples). `runRepairSweep` never re-reads status; if ≥2 samples resolved it calls `markRunExtracting` — whose guard only spares 'cancelling', so 'cancelled' flips back to 'extracting' — and sweeps the entire remainder. Money spent after an explicit Stop; violates the R6 philosophy outright.

Fix: before step 3 (the sweep), re-read the run row; if status is 'cancelled' or 'cancelling', append a log line (`warning: sweep skipped — run was stopped during sampling`) and return without sweeping. TDD: scripted test — samples resolve but run reads 'cancelled' → no second execute call, warning appended.

## 3. Important — backfilling a backfill run is reachable (API + UI) and strands data/money

`crawl.backfill` (crawl.ts:410-470) never checks `parent.inputLabel === 'backfill'`; the run page enables coverage/selection on terminal backfill runs (source-run-detail.tsx:64-67 gate lacks `!isBackfillRun`; `selectable` line 154), whose fill badges are computed over deliberately-partial audit rows (every non-target field reads dead). A grandchild backfill's merges fold into the BACKFILL run's items — the real parent never receives data; its coverage stays gappy; pages re-purchasable indefinitely. Only BackfillGapsPanel is gated.

Fix both layers: (a) `crawl.backfill` guard — parent with `inputLabel === 'backfill'` → PRECONDITION_FAILED naming the real parent's id ("backfill a backfill's parent instead"); (b) gate the coverage query + selection + CoverageActionBar on `!isBackfillRun`, same as the panel. TDD both: router test for the refusal; the UI side is covered by tsc + a coverage-view lib note (no harness).

## 4. Minor — duplicate-backfill window between sample finalise and sweep re-mark

Between stage-1 `finaliseRun('partial')` (completedAt SET) and the sweep's `markRunExtracting`, guard 3 sees no in-flight child → a second backfill click in that window creates a concurrent duplicate. Fix folds into finding 2's re-read: in the same pre-sweep re-read, ALSO detect a newer sibling backfill for the same parent (`parentRunId` = this run's parentRunId, createdAt > this run's, completedAt IS NULL) and skip the sweep with a warning if one exists. Keep it one query; do not add locks.

## 5. Minor — a heal never re-rolls-up the parent run's resultCount/status

`merge-backfill.ts:73-75` — healed parent items flip to 'done' with new extractions, but the parent run's `resultCount` (and status, e.g. 'partial' that is now complete) is never recomputed; run header "Rows" and history undercount. Fix: after a heal (rule-5 path only — plain merges don't change counts), call the existing `finaliseRun`-style rollup for the PARENT run (reuse roll-up-run.ts machinery; cancelled=false, limitReached=false). TDD: heal test asserts parent resultCount incremented and status recomputed.

## 6. Minor — the sample stage counts ANY first 3 items, not dead-target items

`repair-sweep.ts:44,59-61` — a mixed-target backfill whose first 3 claims carry healthy-only gaps spuriously reports repair_failed (fails safe but wastes the operator's loop). Fix: order backfill items dead-first at INSERT (planBackfillRun gains an optional `orderFirst: (item) => boolean` — insert matching items before the rest so claim order (created_at) naturally samples dead-target items; crawl.backfill passes the dead-intersection predicate when strategy is repair_sweep). No claim-SQL change. TDD: planBackfillRun ordering test + a repair-sweep test with mixed items seeded dead-first proving the samples hit dead items.

## 7. PARKED (do not fix) — spec §2.6's guided "field added → backfill N existing rows?" chain exists in no form; ticket it in the docs task.

## 8a. Minor — backfill runs unlabeled in run lists + source-index gate

`source-runs.tsx` renders backfill runs indistinguishably; `source-index.tsx:33-35`'s completed-non-probe gate counts them. Fix: render a quiet 'backfill' chip (micro-label) on rows whose run has parentRunId (the list query may need the column — keep the projection addition minimal), and exclude backfill runs from the source-index tab-flip gate (`inputLabel !== 'backfill'` alongside the probe exclusion). tsc + existing test file updates only.

## 8b. PARKED (do not fix) — backfill runs' own CSV/JSON export contains partial audit rows; export caveat is a follow-up with the shaping initiative's export work.
