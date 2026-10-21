# Websites change follow-ups — plan

**Status:** under the standing approval (queue item 1). Spec:
`docs/superpowers/specs/2026-10-21-websites-change-followups-design.md`. Branch
`fix/websites-change-followups` from `main` @ `4c0a727`. One commit per task, explicit paths, TDD (failing
test first, reproduced from the apply report's shapes). Api vitest serially
(`npx vitest run --no-file-parallelism`); `tsc --noEmit` in each touched package.

## Task 1 — refresh re-verify keeps the check's other findings (spec §1)

- Test (`packages/api/src/verify/attention.test.ts`): a clean Verify; a schedule check that found Title
  `lost` and Price `changed` with `refresh.applied`; a newer clean Verify linked by a `value_refreshes` row
  (Price) as its `verification_id`. Expect Title in `fields`/`findings`. Then a newer full clean Verify:
  Title's finding is superseded.
- Code (`packages/api/src/verify/attention.ts`): read the clean Verifies newer than the oldest check read,
  and the `value_refreshes` keys linked to them; a current field's finding counts when no such Verify that
  verified the field is newer than the check.

## Task 2 — a refresh re-verify starts no coverage check (spec §2)

- Test (`packages/api/src/verify/run-source-verification-holds.test.ts`): a passing refresh-origin re-verify
  does not call `startCoverage`; a passing customer Verify does.
- Code (`packages/api/src/verify/run-source-verification.ts`): start the coverage check only when not
  `refresh`.

## Task 3 — nothing to compare is not "lost" (spec §3)

- Tests (`packages/scraper/src/verify/drift-classify.test.ts`): blank expected on every page, the certified
  path reads on every page → `other-layout` with the values; reads nothing anywhere, no default → `lost`;
  reads nothing, a default → `other-layout`. (`packages/api/src/verify/run-drift-check.test.ts`): a
  manual check of a `defaultOnly` field with a default records `other-layout`, not `lost`.
- Code: `classifyDrift` gains `defaultValue`; `runDriftCheck` passes the website default and records a
  `defaultOnly` field with a default as `other-layout`.
