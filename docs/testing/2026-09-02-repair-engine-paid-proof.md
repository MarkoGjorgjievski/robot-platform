# Repair engine — paid live proof (2026-09-02)

Task 12 Step 2 of `docs/superpowers/plans/2026-08-28-repair-engine.md`. Executed on the
`chore/pre-spend-fixes` branch tip (the full pre-merge stack, including the cache-reputation
fixes), against the AbeBooks full crawl `6c0a9463-ac8b-4e69-929a-f78307ee1a1d` (40 items).
API funded by Marko the same day ($10); authorization given in-conversation.

## Part 1 — healthy-field backfill (isbn / publisher / url)

- Free preview before: **5 pages, est ≤$0.25** (isbn 36/40, publisher 39/40, url 39/40).
- `crawl.backfill` → run `3f094f9c-92c5-4452-99b0-c462ca90e614`, 5 items. **Completed 5/5, 0 failed** (~4 min).
- After, in the PARENT: `url` 40/40 (1.0), `publisher` 40/40 (1.0), `isbn` still 36/40 —
  the 4 remaining items were marked **confirmed-absent** (those listings genuinely carry no
  ISBN), and 4 parent items now hold non-empty `absent_fields`.
- Re-preview of the same trio: **0 pages, $0.00** — a true absence stops costing money.
  The filled-cell-never-overwritten invariant held (no parent value changed except gap fills).

## Part 2 — repair-then-sweep on a dead field (listing_id, 0/40)

- Free preview: 40 pages, est ≤$2.00, `listing_id` classified dead.
- `crawl.backfill` with only `targetFields:['listing_id']` was **refused with
  PRECONDITION_FAILED** — guard 5 demands an explicit `deadFieldStrategy` when a dead field
  is in scope. The money-seam held under real conditions.
- Retried with `deadFieldStrategy:'repair_sweep'` → run `c96aa7de-89d7-411e-a92a-0804f2755f07`,
  40 items dead-first. Samples succeeded, the sweep was authorized, and the run
  **completed 40/40, 0 failed** (~14 min).
- After, in the parent: `listing_id` **40/40 (1.0), healthy**; sampled values are real
  AbeBooks listing ids (`32436922757`, `30872007649`, …). Re-preview: 0 pages, $0.00.

## Bonus — the cache-reputation fixes observed live (first live exercise)

`domain_intelligence.fieldPaths.listing_id` on the detail pageType now shows the
AI-discovered json-ld path `url` with **hits: 36, lastUsedAt 2026-09-02** — the sweep's
replays credited the stored path on every page. Under the pre-fix code those stats would
have stayed frozen at creation. Discovery paid once; replay compounded for free, and the
ledger recorded it.

## Spend

Preview upper bounds: $0.25 + $2.00 = **≤$2.25 total** for both runs; actual is lower
wherever cached paths answered (the sweep's replays after the samples were largely free —
consistent with the ~14-minute duration and the hit pattern above).

## Remaining coverage picture on `6c0a9463` after the proof

Gap fields left: `title` 4/40, `author` 4/40 (pre-existing cache poisoning — RCA
`docs/testing/2026-08-28-abebooks-poisoned-titles-rca.md`; the record-replay-misses half of
that fix is now live, so future replays will finally charge the poisoned paths),
`image_url` 13/40 (dead), plus small healthy gaps on `book_format`/`item_condition`/
`condition_labels`. None of these block the merge; title/author repair is the cache-quality
work, deliberately not re-chased here.

**Verdict: PASS. The repair engine's acceptance test is met; the stack is clear to merge.**
