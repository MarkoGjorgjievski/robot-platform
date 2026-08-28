# T12 crawl verification — post-confirm full run

Source: `abebooks-com-353m8e` (id `344bc5aa-4ce8-4144-9b5f-c41945586229`), dataset `102cad62-8899-4a57-9287-6f714eac58ba`.
Input set `47769e3c-0ae4-433a-87fc-d7f78022f0e9`: two listing rows — `kn=python`, `kn=javascript`.
Budget on source: `{"mode": "first_n", "max_items": 40, "max_pages": 3}`.

Read-only verification, no code/DB changes, no AI calls. Branch `feat/mvp-simplification`.

## 1. Run(s) created after confirmation

`sources.confirm` was clicked and one new run row was created:

| id | status | input_label | started_at | completed_at | result_count |
|---|---|---|---|---|---|
| `6c0a9463-ac8b-4e69-929a-f78307ee1a1d` | completed | `https://www.abebooks.com/servlet/SearchResults?kn=python` | 2026-08-28 04:34:44 UTC | 2026-08-28 04:51:10 UTC | 40 |

Source `confirmed_at` = `2026-08-28 04:35:11.994+00`.

**Only one of the two listing inputs was walked.** `run_items` breakdown for this run:

| kind | input | page | status | count |
|---|---|---|---|---|
| listing | kn=python (index 0) | 1 | done | 1 |
| listing | kn=python (index 0) | 2 | done | 1 |
| detail | kn=python (index 0) | 1 | done | 30 |
| detail | kn=python (index 0) | 2 | done | 10 |

No rows at all for `kn=javascript` (input index 1) — it was never planned. `runs.logs` for this run confirms it was a deliberate budget stop, not a crawl failure:

```
warning: api-param pagination not applied on https://www.abebooks.com/servlet/SearchResults?kn=python: no intercepted JSON response carried page 1's detail URLs (7 intercepted JSON response(s) considered)
warning: budget reached: 40 items
warning: budget reached: 40 items; 1 input(s) not planned
```

This matches the code in `packages/scraper/src/crawl/plan-run.ts` (`itemCap`/`budget.ts`): `max_items` is a **total cap across the whole run**, not per listing (`budget.ts` line 28: "How many detail URLs this run may enumerate in total"). Inputs are walked in order (index 0 first); once the 40-item cap is hit mid-way through `kn=python`'s second listing page, the loop breaks (`plan-run.ts` lines 304–314) and every remaining input — here, all of `kn=javascript` — is marked `skipped_budget` and reported in a warning, never fetched.

**Pages per listing**: `kn=python` — 2 of the allowed 3 pages fetched (page 1: 30 detail items, page 2: 10 detail items, hit the 40-item cap partway through page 2, so page 3 was never requested). `kn=javascript` — 0 pages; never started.

This is expected/by-design behavior given the current budget semantics (confirmed by code comments and the explicit warning), but it means "confirm ran a full crawl over two listing URLs" is only half true in effect — one listing absorbed the entire budget and the second was silently (from the UI's perspective — it *is* logged) skipped.

## 2. Cross-listing dedupe

Not applicable in practice: since `kn=javascript` was never walked, there is no cross-listing duplication to check. Within the single listing that did run (`kn=python`, pages 1–2):

```sql
SELECT url, count(*) FROM run_items
WHERE run_id='6c0a9463-ac8b-4e69-929a-f78307ee1a1d' AND kind='detail'
GROUP BY url HAVING count(*) > 1;
-- 0 rows
```

No duplicate detail URLs within the run (also enforced at the DB level by the `run_items_run_url_idx` unique index on `(run_id, url)`). All 40 detail items have `status='done'` and a linked extraction — each extracted exactly once.

## 3. Export sanity

Export route: `packages/api-server/src/routes/export.ts`, mounted at `/export` in `packages/api-server/src/app.ts` (`app.route('/export', createExportRoutes(...))`), so the live path is `GET /export/runs/:runId.{json,csv}` — export is keyed by **run id**, not dataset id (no dataset-level export route exists). Data comes from `packages/api/src/export/load-run-export.ts` → `buildRunExport` in `build-run-export.ts`, which concatenates every extraction's `data` array for the run in `(createdAt, id)` order.

Fetched both formats from the api-server on :4000 for run `6c0a9463-ac8b-4e69-929a-f78307ee1a1d`:

- `GET /export/runs/6c0a9463-ac8b-4e69-929a-f78307ee1a1d.json` → HTTP 200, valid JSON, `rowCount: 40`, `rows.length: 40` — matches `runs.result_count` and the extraction count.
- `GET /export/runs/6c0a9463-ac8b-4e69-929a-f78307ee1a1d.csv` → HTTP 200, 41 lines (1 header + 40 rows) — parses cleanly, count matches.
- No `[object Object]` substring anywhere in any row of the JSON export (checked programmatically across all fields/rows).

**One discrepancy from the expected sanity check**: the export **does** contain a `detail_url` column (`fields: [...,"detail_url",...,"listing_id",...]`). It comes from the source's `selectorsJson.fields` schema (via `deriveColumns` in `build-run-export.ts`, which always emits a column per declared schema field even if no row ever populated it) — not from the extracted data itself, which uses `_url` instead. Fill rate: `detail_url` is **0/40** filled (always empty string/undefined), same for `listing_id` (0/40). So the column is a phantom/dead schema field, not real duplicate data, but it does exist in the export header — worth flagging since the check explicitly expected it absent.

## 4. Per-field fill rate (full run, n=40)

Computed from the 40 extraction rows (`jsonb_array_elements(data)`) for run `6c0a9463-ac8b-4e69-929a-f78307ee1a1d`:

| field | filled/total |
|---|---|
| author | 4/40 |
| availability | 40/40 |
| book_format | 39/40 |
| condition_labels | 37/40 |
| image_url | 13/40 |
| isbn | 36/40 |
| item_condition | 37/40 |
| price | 40/40 |
| price_currency | 40/40 |
| product_type | 40/40 |
| publisher | 39/40 |
| seller_name | 40/40 |
| seller_url | 40/40 |
| shipping_price | 40/40 |
| sku | 40/40 |
| title | 4/40 |
| url | 39/40 |
| _url | 40/40 |
| _page_number | 40/40 |

(Export-only phantom columns `detail_url` and `listing_id`, declared by the schema but never populated by extraction: 0/40 each — see §3.)

**`title` and `author` are the known garbled-title victims** (poisoned domain-intelligence cache, per `c2-garbled-titles-rca.md` in this same sdd folder) — both sit at 4/40, and the 4 values present are garbled/swapped rather than correct, e.g.:

| title (extracted) | author (extracted) |
|---|---|
| `book magazine collector 129 dec` | `crispin jackson charles dickens novels` |
| `brand new monty python book` | `graham chapman john cleese terry` |
| `monstruo acero numero` | `python` |
| `brand new papperbok` | `monty python graham chapman` |

These read as scraped search-facet/attribute strings and reversed title↔author pairs, not real book titles/authors — consistent with the documented poisoned-cache issue, not a new defect. `image_url` at 13/40 also looks weak but wasn't called out as a known issue — worth a follow-up look, though out of scope for this verification.

## 5. Source/probe state

- `sources.confirmed_at` for `344bc5aa-4ce8-4144-9b5f-c41945586229` = `2026-08-28 04:35:11.994+00` — set as expected.
- Probe run `f89905b1-da26-4203-ac3b-4b7663a6042a` is untouched: still `status='partial'`, `result_count=3`, `completed_at=2026-08-27 15:19:51+00`, `run_items` count still 31 — identical to its pre-confirm state. (`runs` has no `updated_at` column, so "untouched" is verified by the row's values being unchanged and no new writes referencing it.)

## Concerns / follow-ups

1. **Second listing input never walked.** By design (total, not per-listing, item budget) — logged as a warning, not silently dropped — but worth confirming this matches product intent before calling "confirm ran the full configured crawl" done. If per-listing coverage is expected, the budget semantics or UI copy need to change.
2. **`detail_url` (and `listing_id`) appear as always-empty columns in the export**, sourced from a stale/unused schema field declaration rather than actual data. Cosmetic but noisy for a downstream CSV consumer.
3. **`title`/`author` fill rates (4/40) are expected** per the known poisoned-cache issue — not a new regression, but real data quality is currently unusable for these two fields on this source.
4. **`image_url` at 13/40** is lower than every other non-poisoned field; not flagged as known, may warrant a look.
