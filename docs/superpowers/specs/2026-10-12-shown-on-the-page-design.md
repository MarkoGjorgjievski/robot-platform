# Correctness on the run page: "shown on the page" — design

**Status:** approved in chat by Marko 2026-10-12 ("go with the correctness design"); Part B added the same day after campaign 2 batch A, on Marko's "do the judge changes and amend the spec"; plan next.
Follows `2026-10-10-proof-page-coverage-design.md` and the credit campaign's judge findings
(`docs/testing/2026-10-08-credit-campaign.md`, "What the campaign answered").

## 1. The problem

A certified run reports a hit rate, and the run page shows "100% confidence" when every certified
path resolved. The campaign's judge runs (about 2,850 values on seven sites) found that a resolved
value is not a correct value: Allbirds wrote the JSON-LD description the page does not show on 8
of 36 products; Decathlon's rating fallback wrote `0` on five products with no rating; Made In
wrote the site's name as Title; Everlane and Otto wrote category SEO text; Nike wrote another
colour's title. Every one of these values is absent from the rendered page of the product it was
written for. The judge finds them at $0.0086 a value; nothing in the product does.

## 2. What changes, in one paragraph

When a run writes a certified value, the extractor also records whether the value is **shown on
the page**: the captured page's visible text contains it, or the value came from an element on
the page. The flag is stored per field beside the row. The run page counts the values that are
not shown, names the fields and the certified path that produced them, lists sample products,
and marks the cells in the results sheet. Nothing is removed, re-extracted or re-certified; the
customer sees which values to distrust and what to fix (a proof page or a re-mark). The Sample
panel shows the same count for its three products. The judge-run report gains a "shown" column,
so the campaign measures how well the free flag predicts the paid verdict.

## 3. The check (`@robot/scraper`, `verify/shown-on-page.ts`)

`shownOnPage(field: VerifiedField, path: CertifiedPath, value: unknown, pageText: string): boolean | null`

- `pageText` is the capture's visible text (`visibleTextFromHtml` in `corroborate-value.ts`:
  scripts and styles removed, tags stripped, whitespace collapsed), computed once per capture,
  lower-cased and NFKC-normalised.
- An `xpath` path is shown by definition: `true` without a comparison (the value was read from a
  rendered element).
- Types that cannot be checked return `null` (not counted either way): `url`, `image`, `boolean`
  (availability words vary), `date`.
- `text`: `true` when the normalised value (NFKC, whitespace collapsed, lower-cased) is a
  substring of the page text; a value over 80 characters is checked on its first 80 characters
  (a description shown with a "read more" fold still starts on the page).
- `number`: `true` when any common rendering of the number appears as a whole token: as stored,
  with `,` or `.` as the decimal mark, with thousands separators, with one or two decimals
  (`4.5` ↔ `4,5` ↔ `4.50`; `1144` ↔ `1,144` ↔ `1.144`). `0` is never considered shown unless
  the page text contains a `0` token adjacent to the field's concept words (`0 reviews`,
  `rating 0`); a bare `0` elsewhere on the page proves nothing (Decathlon's case).
- `money`: `true` when the amount appears as a token with either decimal mark and with or
  without thousands separators, currency sign ignored (`22` ↔ `22.00` ↔ `22,00`; `1,299.99`
  ↔ `1.299,99`).
- A value in a row-per-variant run is checked against the same page text (the variant page or
  the product page that carried the list); nothing variant-specific.

The check is pure and free. `runVerifiedExtraction` computes it for every field it writes and
returns it in `data`'s companion `shown: Record<fieldKey, boolean | null>` (the path that
produced the value is already in `stats`).

## 4. Storage (`@robot/api`)

`extractions.validation_result` (jsonb, present, unused today) holds
`{ shown: Record<fieldKey, boolean | null>, paths: Record<fieldKey, CertifiedPath> }` for the
extraction's first row; `extract-item.ts` passes it to `persistRows`. No migration. Backfill and
repair rows carry it too (they go through the same code). Rows written before this change have
no `validation_result` and count as "not checked".

## 5. What the run page shows (`@robot/app`)

`crawl.coverage` (`load-run-coverage.ts`) gains, per field: `notShown: number` (values written
and flagged `false`), `checked: number` (flagged `true` or `false`); and a list
`unshownItems: Array<{ url: string; fields: string[] }>` (first 50 by item order). Pure
derivation, no new query.

- **The fill table** (`coverage-bar.tsx`) gets a third figure per field beside the fill: "n not
  shown" in warning colour when `notShown > 0`, nothing when 0, "not checked" muted for `url`,
  `image`, `boolean`, `date` and for rows without a flag.
- **A panel "Values not shown on their page"** under the fill table (same place and style as
  "Empty cells"): one row per affected field — "Description: 8 of 36 values are not on the product's
  page · from page data (json-ld description)" — with up to five product links, and one
  sentence: "A value the page does not show for that product is usually another product's or the
  page's SEO text. Add one of these products as a proof page and mark the field there." with
  "Use as proof page" on each product (the run page's existing `?addPage` link).
- **The results sheet** (`results-table.tsx`) marks a not-shown cell with a 2 px warning rail and
  the title "not shown on the page"; the value stays.
- **The run summary line** "n rows · 100% confidence" becomes "n rows · 100% confidence · 12
  values not shown on their page" when the count is above zero.
- **The Sample panel** (`extract-sample.tsx`): "n values not shown on their page" beside the
  rows line when above zero, with the fields named.
- **Ops** (the website page's certified paths): unchanged in this spec; a path's not-shown rate
  is a later addition.

## 6. The judge (`judge-run.ts`, `judge-run-report.ts`)

The report's per-value rows gain a `shown` column (`true` / `false` / `—`), and the summary a
small confusion table: judged wrong and flagged not shown; judged wrong and flagged shown; judged
right and flagged not shown. No change to what is judged or spent. This is how campaign 2 answers
"does the free flag predict the paid verdict".

## 7. Copy

| where | reads |
|---|---|
| fill table | `8 not shown` · `not checked` |
| panel title | Values not shown on their page |
| panel row | `{Field}: {n} of {m} values are not on the product's page · from {source} ({path})` |
| panel sentence | A value the page does not show for that product is usually another product's or the page's SEO text. Add one of these products as a proof page and mark the field there. |
| cell title | not shown on the page |
| summary | `{rows} rows · {confidence}% confidence · {n} values not shown on their page` |
| Sample | `{n} values not shown on their page: {fields}` |

## 8. Safety properties the tests must pin

1. The check never changes a value, a hit, a path stat or the run's status; a run with every value
   shown produces byte-identical rows and stats.
2. An `xpath` value is always `true`; `url`/`image`/`boolean`/`date` are always `null`.
3. `0` is not shown by a bare `0` elsewhere on the page.
4. A text value over 80 characters is checked on its first 80.
5. A page whose visible text is empty (a capture with no document body) flags every checkable
   value `false`, never throws.
6. Rows without `validation_result` count as not checked, never as not shown.
7. The panel and the cell marks appear only when `notShown > 0`; the summary line is unchanged
   otherwise.

## 9. Testing

- **Unit, free:** `shown-on-page.test.ts` on the campaign's real cases (Allbirds' JSON-LD
  description vs the page text that lacks it; Decathlon's `0` rating; Made In's site name as
  title; a price `22` vs a page showing `$22.00`; a number `1144` vs `(1,144)`; an xpath value;
  the four null types); `verified-extraction.test.ts` (the companion `shown` map; property 1);
  `extract-item.test.ts` (persisted `validation_result`); `load-run-coverage.test.ts` (the
  counts, the item list, rows without the flag); app view tests for the copy; the judge report's
  confusion table on a fixture.
- **Route smoke:** the fixture shop's `/p/9` already carries a JSON-LD name and a description the
  page does not show; a seeded run with a not-shown value shows the fill-table figure, the panel,
  the cell mark and the summary line.
- **Live, free:** a 60-product Extract on one campaign-2 site with a JSON-LD description, then its
  judge run (paid, already planned): the confusion table in the report.

## 10. Files

- `packages/scraper/src/verify/shown-on-page.ts` (new) + test; `verify/verified-extraction.ts`
  (computes and returns `shown`); `corroborate-value.ts` (export `visibleTextFromHtml` if not
  already exported from the package index)
- `packages/api/src/crawl/extract-item.ts` (persists `validation_result`), `crawl/load-run-coverage.ts`
  (`notShown`, `checked`, `unshownItems`), `judge-run.ts` + `judge-run-report.ts` (the column and
  the table)
- `packages/app/src/components/runs/coverage-bar.tsx`, a new `unshown-panel.tsx`,
  `results-table.tsx`, the run route's summary line, `components/extract/extract-sample.tsx`,
  `lib/site/run-screen-view.ts` / `lib/site/coverage-view.ts` (the copy as pure functions)
- the route smoke (a seeded run helper gains `validationResult`), `docs/handoff.md`


## Part B — two rules at Verify (added 2026-10-12, after campaign 2 batch A)

Batch A's judge found two error patterns the flag above does not reach, because the wrong value
is on the page or was typed by a person: Colourpop stored the shade name ("Drift") as the Title
on about nine of forty products while the page's heading reads the product ("Super Shock
Shadow"), because the suggestion came from a JSON-LD name that "agreed" on the three proof pages;
Gymshark stored the site's tagline ("Gymshark | We Do Gym") as the Brand on all sixty rows,
because the worker typed it to get past Verify. Both are decided at Verify, so Verify is where
they are caught:

### B1. A Title must be the page's main heading

For the Title field (concept `product_name`), a suggestion is never "agreed" unless its value is
the page's main heading: the text of the first `h1` in the proof page's box map, or, with no
`h1`, the largest heading box. A suggestion that is on the page but not the heading reads
`needs-you` with the reason "not the page's heading on product n" and the row's page-data hint
offers both the suggestion and the heading. A customer can still accept the suggestion cell by
cell. Certification is unchanged: the rule shapes what the row offers, not what certifies.

### B2. A typed value the page does not show warns

When a typed expected value (an `Answer` with no mark and no path) is not shown on the proof
page by the §3 rule (type-aware; `xpath` has no meaning here, so every typed value is checked;
`url`, `image`, `boolean`, `date` are not), the cell shows "not on this page" in warning colour
with the title "The page does not show this value; a path that produces it will be certified
anyway. Mark it on the screenshot if it is there, or use \"Not on this product\"." Verify is not
blocked. The check runs on the proof page's stored capture text (the proof-page capture's `html`
is stored, unlike a run's), in the app's existing `verification-model` as a pure function fed by
a new `pageText` per captured url from the captures query.

### B3. Testing, files, copy for Part B

- Unit: `rowStatus` with a Title suggestion that is not the heading → `needs-you`, reason "not the
  page's heading on product 1"; with the heading → `agreed` as before; `typedNotShown(field,
  value, pageText)` on the Gymshark tagline against a page text without it → true; on a price
  typed as `22` against "$22.00" → false.
- Files: `packages/app/src/lib/site/verification-model.ts` (the heading rule; `typedNotShown`),
  the suggestion builder in `packages/api/src/verify/*` that returns the box map (adds
  `headingText` per captured page and `pageText`), `verification-table.tsx` (the cell warning),
  the smoke (a fixture product whose JSON-LD name differs from its `h1`).
- Copy: row reason `not the page's heading on product n`; cell word `not on this page`; cell
  title as above.

### B4. What this would have changed on batch A

Of the 46 real errors the judge found on Gymshark, Colourpop and Mejuri: B1 prevents the 18
shade-name titles; B2 warns on the 24 tagline brands before the run; Part A flags the 24 brands
and the 2 prices after it. The remaining 2 (an other-offer stock state and a price) stay the
judge's.
## 11. Not in this spec

- Re-extracting, dropping or repairing a not-shown value automatically.
- Checking values on the Verification tab (certification already requires the value on the
  proof pages).
- A not-shown rate per certified path in ops; pruning paths by it.
- Values on the page but belonging to another offer (Barnes & Noble's other format): the judge's
  job.

## 12. Decisions (recommended, 2026-10-12)

- **D1** The check runs at extraction time, on the capture in memory; no page text is stored.
- **D2** `boolean`, `url`, `image` and `date` are not checked.
- **D3** The flag informs; nothing is changed by it.
- **D4** The judge report measures the flag against the verdict, so the campaign can say how
  much of the judge's work the flag does for free.
