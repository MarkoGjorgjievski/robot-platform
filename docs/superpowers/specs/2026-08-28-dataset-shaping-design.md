# Dataset Shaping — Non-Destructive Output Layer

**Date:** 2026-08-28
**Status:** Draft for review
**Depends on:** v2.5 candidate catalogues (pin machinery), MVP simplification (declared sources)
**Companion spec:** [2026-08-28-repair-engine-design.md](2026-08-28-repair-engine-design.md) — row re-extract delegates to its backfill engine; everything else here is independent of it.

## 1. Problem

The raw extraction is often *right* while the delivered shape is *wrong* for the customer. Live examples from the AbeBooks crawl and session feedback:

- Value needs trimming: `Condition: Used - Very good` → customer wants `Used - Very good`.
- Column isn't wanted at all, or wants a different name.
- Two columns half-duplicate each other (`condition_labels` vs `product_type`) and the customer wants one coherent column.
- One row's value is a misfit that QA catches (a magazine in a books listing).
- A field is filled from the wrong source: `url` holds query-string junk (`ds=5&sortby=17&isbn=…`) while `_url` holds the correct link — a *source-pick* problem, not a formatting problem.

Principle (Marko, verbatim intent): *we adjust our output to the customer; the customer never adjusts to our system.* A shape change must cost a config edit, never a re-crawl.

## 2. Concept

A per-dataset, **non-destructive shaping config** sitting between raw extraction and everything the user sees. Raw rows are never mutated; the shape is applied at read time by one shared function.

**Where it applies (decided): everywhere you look.** Results view and export both show the shaped dataset; a **Raw toggle** in the results view (and `?raw=1` on export) reveals the untouched extraction. QA and the customer see the same thing by default.

## 3. Shaping config model

One `shaping jsonb` column on `datasets`:

```jsonc
{
  "columns": [
    // order of this array = display/export order
    { "field": "title" },
    { "field": "condition_labels", "hidden": true },
    { "field": "product_type", "hidden": true },
    { "field": "url", "hidden": true },
    { "field": "_url", "rename": "url" }
  ],
  "transforms": [
    { "field": "condition_labels", "op": "strip_prefix", "args": { "prefix": "Condition: " } },
    { "field": "price", "op": "regex_extract", "args": { "pattern": "[\\d.,]+" } }
  ],
  "fallbacks": [
    // prefer-merge: a NEW delivered column named "condition" — condition_labels'
    // value, falling back to product_type when it is empty. The two source
    // columns are hidden above; a fallback's `deliver` name obeys the same
    // collision validation as a rename.
    { "deliver": "condition", "prefer": "condition_labels", "fallback": "product_type" }
  ],
  "rowExclusions": [
    { "itemId": "…", "reason": "magazine in books listing", "at": "2026-08-28T…" }
  ]
}
```

- Unlisted fields append after listed ones in extraction order (config stays small; new fields don't vanish).
- A rename must not collide with another delivered column name — validated on save.
- `rowExclusions` remove rows from shaped view/export; raw view shows them struck through with the reason. Excluding is a shaping act, not a delete — the row and its history persist.
- No versioning in MVP; the config is one object, changes go through the API (audit later if needed).

## 4. Transform vocabulary

MVP set, all pure functions in `@robot/scraper`'s existing transform module (word-to-number, brand cleanup, whitespace collapse already live there — same registry, same testing pattern):

- `strip_prefix` / `strip_suffix` (literal)
- `regex_extract` (first match; invalid pattern rejected on save)
- `split_take` (split on delimiter, take index)
- `template` (`"{value} USD"` style, value interpolation only)

Every transform is total: on non-matching input it passes the value through unchanged (never nulls data at the shaping layer). **Live preview is mandatory UX**: the edit dialog shows before/after on the first 10 rows before saving.

## 5. The candidates bridge (the `url` vs `_url` class)

Wrong-source values are *not* fixed by transforms — the right value already exists as a different candidate with different provenance (v2.5 candidate catalogue). The bridge is one click: every column header menu gets **"View candidates…"**, opening the existing candidate picker for that field, where the existing **pin** fixes the pick (pin `_url`'s source for `url`). Nothing new is built beyond the menu entry and routing; this spec just makes the existing machinery reachable from the place where the symptom is noticed. (The junk-echo *minting* problem itself — API params cached as data — is the cache-quality initiative, out of scope here.)

## 6. Where the shaper runs

One pure function, one home: `applyShaping(rows, fields, shaping)` in `@robot/api` (shared, unit-tested), consumed by:

- the results tRPC read the dashboard renders (shaped by default, `raw: true` param honored),
- the export route in `@robot/api-server` (JSON + CSV; `?raw=1` honored; CSV headers use delivered names).

The dashboard never re-implements shaping logic; it only renders what the API delivers plus the Raw toggle state.

## 7. API surface

- `datasets.getShaping({datasetId})` / `datasets.updateShaping({datasetId, shaping})` — full-object update with server-side validation (unknown fields tolerated with a warning — the schema may have evolved; collisions and invalid regex rejected).
- `datasets.previewTransform({datasetId, transform, limit: 10})` → before/after pairs. Pure read.
- `datasets.excludeRow({datasetId, itemId, reason})` / `restoreRow` — thin wrappers writing `rowExclusions`.
- Results read + export gain `raw` flags. No other surface changes.

## 8. UI

- **Column header menu** (results view): Rename, Hide, Transform… (dialog with live preview), Prefer/fallback…, View candidates…, and — delegating to Spec A — Re-extract gaps in this column.
- **Row menu**: Exclude row (reason prompt), Restore, Re-extract row (Spec A's single-item backfill).
- **Shaping summary bar** above the table when any shaping is active: "2 renames · 1 transform · 1 hidden column · 1 excluded row — View raw". One click flips to raw; the bar is how users always know they're looking at a shape.
- Export button states which shape applies ("Export (shaped) · raw available").

## 9. Testing

- Unit: `applyShaping` (ordering, rename collision validation, hidden columns, fallback merge, transform totality, exclusion filtering), each transform op, preview endpoint.
- Export tests: shaped vs raw, CSV header naming, excluded rows absent.
- UI route smoke: shaping bar renders, raw toggle round-trips.
- Dogfood: shape the AbeBooks dataset per §1's examples (strip the condition prefix, hide `product_type` behind a fallback, deliver `_url` as `url` via pin) and export both shapes.

## 10. Out of scope

- Computed/derived columns (concatenations, math) — post-MVP.
- Multiple named shapes per dataset (per-customer views) — the config model deliberately doesn't preclude it; MVP ships one shape per dataset.
- Shape templates shared across datasets/domains.
- Auto-detection of near-duplicate columns (the system may *suggest* a fallback merge later; MVP is manual).
