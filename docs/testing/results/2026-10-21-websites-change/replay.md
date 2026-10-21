# Replay of the ten websites, read-only (2026-10-21)

Task 11 of the "websites change" plan (spec `docs/superpowers/specs/2026-10-21-websites-change-design.md`
§8–§9). For the ten websites that lost certification at the 2026-10-21 re-verify
(`docs/testing/results/2026-10-21-reverify-one-source/report.md`), this replays what the new rules —
`backfillHolds` (holds, spec §3.1) and `planRefresh` (automatic refreshes, spec §3.2) — would do on that
Verify's own stored proof-page captures. Nothing was written to the database and no page was loaded live.

## What was run

```
cd packages/api && ANTHROPIC_API_KEY= \
  CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures \
  npx tsx src/scripts/websites-change-replay.ts
```

- `packages/api/src/scripts/ten-websites.ts` — the ten source ids → labels, taken from
  `docs/testing/results/2026-10-21-reverify-one-source/results.json` and cross-checked against that run's
  `report.md`. All ten ids matched exactly.
- `packages/api/src/scripts/websites-change-replay.ts` — for each website: reads its current certification
  state (`loadCertificationState` / `runnableOf`), then calls `backfillHolds(db, browser, id, { write: false
  })`. That function reads the website's **latest completed, clean Verify** (the 2026-10-21 one that failed
  it) and its stored capture files from `CAPTURES_DIR` (`readCaptureFile`, no network, no page load), finds
  each failing field's last passing result at today's `fieldHash`, and re-runs extraction against the stored
  captures (`runVerifiedExtraction` with the capture injected — still no page load) to decide, per field,
  whether it still extracts (spec §3.1 / fix-wave-1 "no evidence, no hold"). For every field that would be
  held, `planRefresh` (pure, `@robot/scraper`) is run on those same readings against the stored expected
  values to decide whether the hold could also refresh its expected values (spec §3.2).
- `ANTHROPIC_API_KEY` is required empty (the script refuses to start otherwise) — no agent is ever
  constructed, so no AI call is possible. `withBrowserSession` launches a local headless Chromium only to run
  the stored HTML through the extractor in memory; it fetches nothing from the network.
- A real `backfillHolds(..., { write: false })` call never calls `writeHolds`, so it cannot touch
  `field_holds`. Verified directly afterwards: `SELECT count(*) FROM field_holds WHERE source_id IN (<the
  ten>)` → **0** (via a one-off `npx tsx` script using `@robot/db`, run and deleted; not part of the
  deliverable). `pg_dump` was not needed — nothing was written.
- No code changes were needed. The brief's script matched the current signatures of `backfillHolds`,
  `decideHolds`, `planRefresh`, `loadCertificationState`, `runnableOf` and `withBrowserSession` exactly, and
  `npx tsc --noEmit` in `packages/api` is clean with it in place.

## Results

Before: every one of the ten currently **refuses to run** (`runnableOf` is false — a contract field is
neither current nor held). After the backfill (in memory only), every one of the ten **would run again**:
every field that failed the 2026-10-21 Verify would be held, because every one of them still reads a real
value on at least one of the website's own stored proof pages. **No field was held without evidence** — the
"no evidence, no hold" rule (fix wave 1, item 1) excluded none of the twenty-two held fields, and none of the
ten websites' fields fell into `no-evidence` / `reads-nothing` / `no-earlier-pass`.

| Website | Before | Held (rests on real readings) | Refreshed automatically | Refused — reason | Still needs the customer |
|---|---|---|---|---|---|
| Barnesandnoble | refused | Rating, Description — both read real values on all 3 proof pages | — | Rating: **not-shown** (the page doesn't show the rating as text); Description: **not-by-nature** (text isn't a by-nature field) | Rating, Description |
| Acne / Ikea | refused | Total reviews, Average rating — both read real values on all 3 proof pages | Total reviews: 149→150, 62→64, 45→46; Average rating: 4.8→4.7 | — | none from this replay (holds alone make the website current again) |
| Madeincookware | refused | Price, SKU — both read real values on all 3 proof pages | — | Price: **fixed-variant** (reads `offers[0]`, not the variant the proof page's address names); SKU: **not-by-nature** | Price, SKU |
| Everlane | refused | Price, In stock — both read real values on all 3 proof pages | — | Price: **fixed-variant** (`hasVariant[0]`); In stock: **fixed-variant** (`hasVariant[0]`) | Price, In stock |
| Mejuri | refused | Price — reads real values on all 3 proof pages | Price: 615.00→625.00, 435.00→440.00, 3250.00→3300.00 | — | none |
| Gymshark | refused | Rating — reads real values on 3 of 4 proof pages (one page's rating cell is blank/expected-empty) | Rating: 4→4.2 | — | none |
| Ridge | refused | In stock — reads real values on all 4 proof pages | — | In stock: **fixed-variant** (`hasVariant[0]`: every product now reads "out of stock," which looks like the wrong variant rather than a real stock change) | In stock |
| Oliverbonas | refused | Rating — reads real values on 3 of 4 proof pages | — | Rating: **not-shown** | Rating |
| Burrow | refused | Price, Rating — both read real values on all 3 proof pages | — | Price: **fixed-variant**; Rating: **not-shown** | Price, Rating |
| Skullcandy | refused | all 8 fields — each reads real values on its 2 surviving proof pages | — (every held field's value on the 2 surviving pages still matches its expected value — nothing moved) | n/a | the 404'd proof page (`slyr-pro-multi-platform-wired-gaming-headset`) needs replacing — not a value-level problem `planRefresh` can see; it shows up as a missing capture (only 2 of 3 proof pages have a reading), not a refusal |

**Totals:** 22 fields held across the ten websites; 4 refresh automatically (Acne/Ikea Total reviews and
Average rating, Mejuri Price, Gymshark Rating); the rest (16, plus Skullcandy's missing proof page) still need
the customer, exactly as the spec's §8 table says.

## Differences from the spec's §8 table

One: spec §8's row for Acne / Ikea hedges Average rating — "Average rating if product 1 still reads
'Several places match'" — implying it might stay ambiguous rather than refresh outright. This replay's
`planRefresh` call refreshes it cleanly (4.8 → 4.7, no refusal): on the stored captures, the one certified
path reads a single differing value on every page with an expected value, the same path that passed there,
not through a fixed variant, shown on the page, and in range. That is correct, not a bug — "ambiguous" (cell
status `fail`, reason `ambiguous`) is a live Verify's cross-validation outcome, something this read-only
replay (which only runs `decideHolds`'s reading and `planRefresh`, never a Verify) does not model and was not
asked to. The spec's hedge is about what a *live re-verify* might still find on product 1, not about what this
probe should show; the task-11 brief's own stated expectation for this script ("refreshes for Acne / Ikea
Total reviews and Average rating") matches what ran. No rule was wrong; nothing was changed.

No other difference: every held field, every refresh (values and direction), and every refusal reason
(`fixed-variant` for Madeincookware/Everlane/Burrow Price and Ridge/Everlane In stock; `not-shown` for
Barnesandnoble/Oliverbonas/Burrow Rating; `not-by-nature` for Description and SKU) matches the spec's §8
table and the task-11 brief's expected output exactly.

## Raw data

`docs/testing/results/2026-10-21-websites-change/replay.json` — per website: `runnableBefore`,
`runnableAfter`, and per held-or-checked field: `held`, the refresh/refusal verdict, every proof page's
`reads` (this replay's value) and `expected` (the website's stored expected value).
