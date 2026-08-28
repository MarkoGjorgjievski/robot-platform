# Repair Engine — Coverage, Backfill, and Schema Feedback

**Date:** 2026-08-28
**Status:** Draft for review
**Depends on:** MVP simplification (declared sources + probe-confirm, feat/mvp-simplification), v2.5 candidate catalogues
**Companion spec:** [2026-08-28-dataset-shaping-design.md](2026-08-28-dataset-shaping-design.md) — the shaping layer consumes this spec's row re-extract and coverage machinery but is otherwise independent.

## 1. Problem

A crawl is never 100% on the first pass, and today the only remedy is re-running everything. Live grounding — the AbeBooks crawl (run `6c0a9463`, 40 items) produced all three gap shapes in one run:

| Shape | Live example | Wrong remedy today | Right remedy |
|---|---|---|---|
| Small gaps | `isbn` 36/40, `publisher` 39/40 | re-run 40 pages | re-fetch the 1–4 gappy pages |
| Mid-band mystery | `image_url` 13/40 | shrug | re-fetch the 27, watch what happens |
| Dead field | `title` 4/40 (poisoned path), `listing_id` 0/40 | re-run 40 pages with the same broken path | repair the path on samples, then sweep with cached replay |

The design constraint that shapes everything: **the expensive unit is fetching a page, not extracting a field.** Item-scoping is where the money is; field-scoping is about extraction focus. And per the platform's standing cost philosophy (mvp-simplification ruling R6): **nothing spends without an explicit click, and every click shows its price first.**

Additionally (problem 3 from the same session): users must be able to push back on the discovered schema — keep the 12 fields we found, add 4 more they know are on the page — at the moments where that feedback is cheapest.

## 2. Concepts

### 2.1 Coverage report

Every run with results gets a computed **coverage report**: per field, `filled / total`, plus which items are missing which fields. Computed from run items (the v1.1a invariant — every toggled field returns a row with a status — makes this a pure aggregation, no schema change). Rendered in the run view as fill counts on column headers and an Excel-style filter ("show rows missing `description`").

### 2.2 Cell states: filled / missing / confirmed-absent

A row-field cell today is effectively filled-or-not. Backfill introduces a third state:

- `filled` — value present.
- `missing` — no value; eligible for backfill.
- `confirmed_absent` — a backfill re-fetched this page, focused on this field, and still found nothing. The page genuinely lacks it. **Confirmed-absent cells are excluded from future backfill item lists** — a true absence must stop costing money. Displayed distinctly (e.g. "—" vs "not on page").

A later full re-extraction of the item (not a backfill) may clear `confirmed_absent` back to whatever it finds — the state is a backfill economy measure, not a permanent verdict.

### 2.3 Backfill run

A new run flavor: `inputLabel: 'backfill'` (same pattern probe runs use), with:

- `parentRunId` — the run whose gaps it repairs.
- `targetFields` — the fields in scope (null = all gappy fields).
- **Item list derived, not enumerated**: the union of the parent run's items having ≥1 `missing` cell among the target fields, minus `confirmed_absent`-only items. No listing walk, no pagination — backfill goes straight to known detail URLs.
- **Per-item field focus**: each item re-extracts only *its* missing target fields (the chain's requested-fields focus). Filled cells are never overwritten by a backfill.
- Results merge back into the parent run's items (cell-level update: `missing` → `filled` or `confirmed_absent`). The backfill run itself keeps its own log/status for audit, but the dataset has one canonical row per item — no duplicate rows.

### 2.4 Two trigger handles, one engine — always both offered

- **Manual selection**: filter the coverage view, select rows, "Re-extract selected (N pages, ~$X)". The selection becomes the backfill's item list.
- **Bulk preview**: "Backfill gaps" opens a preview — target fields (pre-checked to all gappy fields, editable), derived item count, page count, cost estimate, dead-field warnings — then "Run backfill".

The percentage instinct becomes a *default suggestion, not a mode*: small gap counts pre-highlight the manual handle, large or multi-field gaps lead with the bulk preview. Both are always present. No settings page — the choice lives at the decision point, like the confirm gate.

### 2.5 Dead-field detection and repair-then-sweep

The preview classifies each target field by parent-run fill rate:

- **Fill ≥ threshold (default 50%)**: the path works; gaps are page oddities. Plain re-fetch.
- **Fill < threshold**: the field's extraction path is presumed broken ("dead field"). Re-fetching N pages with the same path is burning money. The preview forces a choice, offered as two buttons per dead field (both must ship; usage will tell us which survives):
  1. **Repair-then-sweep (recommended default)**: run AI discovery for that field on 3 sample pages from the gap set → persist the new path(s) → show the 3 sample values in the run view → sweep the remaining items with cached replay (free-tier extraction). The sweep starts automatically when ≥2 of 3 samples resolve; if <2 resolve, the backfill stops after the samples with a warning ("repair failed — field may not be extractable") and the remaining cells stay `missing`.
  2. **Full focus**: re-fetch every gappy item with AI focused on the field, no staging. Costlier, simpler, occasionally right (heterogeneous pages where one path never generalizes).

Mixed previews compose: healthy fields plain-re-fetch, dead fields go through their chosen strategy, one backfill run, each item touched once.

### 2.6 Schema feedback (problem 3)

Two moments, both pre-scale:

1. **Set-up page, post-analyze**: the discovered-fields table becomes editable — toggle fields off, and an **Add fields** control: field name + optional free-text hint ("near the ISBN, labeled 'Publisher'"). Added fields become requested fields on the source; the next analyze/probe attempts them with priority (machinery exists: requested fields + discovered-but-unresolved persistence with the rediscovery flag).
2. **Confirm gate**: alongside Yes / Something's-wrong, a quiet **"Request more fields"** action — same add-fields control, then one re-analyze + re-probe cycle (explicit, costed click). Rationale: three real rows is when "where's the ISBN?" occurs to a human, and schema negotiation must finish before scale spending starts.

Post-confirm, added fields are still possible (schema evolves), and their historical gap is exactly a backfill: add field → re-analyze → backfill with `targetFields: [new_field]` fills history. The UI should offer that chain as one guided step ("field added — backfill 40 existing rows? ~$0.20").

## 3. Data model

- `runs`: add `parent_run_id uuid null references runs(id)`, `target_fields jsonb null`. `inputLabel: 'backfill'` distinguishes the flavor (no new status values; the F1/D2 lesson stands — `completed_at` is the terminal marker).
- `run_items` (cell states): per-field result rows gain `absent_confirmed_at timestamp null` (set by backfill re-checks; null means plain `missing` when no value). No destructive migration; existing rows read as filled/missing exactly as today.
- `sources`: add `requested_fields jsonb null` — `[{name, hint?, addedAt}]`, merged into analyze requests. (Analyze already accepts requested fields; this persists them.)

## 4. API surface (tRPC, `@robot/api`)

- `crawl.coverage({runId})` → `{fields: [{name, filled, missing, confirmedAbsent, total}], gapItems: [{itemId, missingFields}]}`. Pure read.
- `crawl.backfillPreview({runId, targetFields?, itemIds?})` → `{items, pages, estCost, fields: [{name, fill, classification: 'healthy'|'dead'}]}`. Pure read; `itemIds` set = manual-selection path.
- `crawl.backfill({runId, targetFields?, itemIds?, deadFieldStrategy?: 'repair_sweep'|'full_focus'})` → `{backfillRunId}`. Refuses when the parent run is not terminal, when a backfill for the same parent is already in flight (`completed_at IS NULL` guard, per the D2 lesson), or when the derived item list is empty. `deadFieldStrategy` required iff the preview classified any target field dead.
- `sources.requestFields({sourceId, fields: [{name, hint?}]})` → persists to `requested_fields`; returns nothing. The UI chains it with the existing `sources.analyze` click (kept separate so persisting intent is free and analyzing stays an explicit costed click).

## 5. Extraction semantics

- Backfill items re-enter the standard extraction chain with requested-fields focus = that item's missing target fields. Cached paths first (free), AI only on cache miss — unchanged chain economics.
- A backfill result for a field: value found → cell `filled`; nothing found → `absent_confirmed_at` set. Never overwrite an existing `filled` cell.
- Repair-then-sweep's sample stage runs AI discovery scoped to the dead field on 3 gap-set pages; persisted paths follow the normal cache policy (enrich, never overwrite; the poisoned-path problem — recording replay misses so the prune can retire bad paths — is the cache-quality initiative's scope, not this spec's, but backfill must *record* hits/misses through the existing discipline so that initiative has data).

## 6. UI

- **Run view**: fill count under each column header (`36/40`); header click → filter to missing; multi-select rows → "Re-extract selected (N pages, ~$X)"; a "Backfill gaps" button opens the preview panel. Suggestion defaults per §2.4.
- **Backfill preview panel**: field checklist with fill bars and dead-field classification, item/page/cost line, per-dead-field strategy buttons, single confirm button. Everything above the button is free.
- **Backfill run page**: standard run page; repair-then-sweep shows the 3 sample values before/while the sweep runs. No confirm gate (the parent run was already confirmed or is detail-mode).
- **Set-up page**: editable field toggles + Add fields (name, hint). **Confirm gate**: "Request more fields" quiet action.
- Cost strings follow the existing honesty copy ("may use AI for pages the cache can't answer").

## 7. Testing

- Unit: gap derivation (items × fields, confirmed-absent exclusion), dead-field classification thresholds, item-list derivation from manual selection, cell-merge rules (never overwrite filled; absent marking), backfill refusal guards.
- Fixture replay (Tier 1): a backfill against fixture pages with seeded gaps — full chain, no AI, no network.
- Live dogfood (Tier 2, explicit): AbeBooks run `6c0a9463` — backfill `image_url` (13/40, mid-band) and `listing_id` (0/40, dead → repair-then-sweep). These two are the acceptance demo.

## 8. Out of scope

- The shaping layer (Spec B).
- Scheduled/automatic backfills (no spend without a click — revisit post-MVP).
- Cache-quality corroboration + replay-miss recording (the poisoned-titles RCA fix) — separate initiative; this spec only feeds it hit/miss data.
- Embedding/AI-judged value QA ("is this description plausible?") — vision doc territory.
