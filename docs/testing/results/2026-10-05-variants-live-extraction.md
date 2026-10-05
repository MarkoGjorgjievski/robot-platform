# Variants extraction, live on real shops — 2026-10-05

The first free live check of variants **extraction** (plan 3: run, export, run page), on branch
`feat/variants-extraction` at `6cac0e8`, against Everlane (list method) and Nike (links method), with
the product pages from `2026-10-02-variants-live-check-2.md`. Screenshots and export excerpts:
`docs/testing/results/screens-2026-10-05-variants-extraction/` (exports under `exports/`).

**Cost: $0.00.** Setup and answers were made in the app on :3000 (which talks to Marko's :4000), using
`docs/testing/ui-check-app-variants.mts`. Verify, plan, execute, the budget, the product URLs, the
variant mode and the exports all went through a second api-server on :4100, started from this branch
with `ANTHROPIC_API_KEY=`. Before each verify and each run, `sources.verifyEstimate` on :4100 returned
`aiAvailable: false, upperBoundUsd: 0`. Both verifies ended `aiCalls: 0, costUsd: 0`. After the
check, :4100 was stopped by port (its process was confirmed to be the `tsx src/index.ts` api-server)
and the port is free. :4000, :3000 and :3456 were not touched, and nothing was clicked in the app
except the setup controls.

Identity: one throwaway user, `check-1791199558909@example.com`, with one project per site. Both
projects were deleted at the end (`projects.list` returns empty). The DB was backed up with
`pg_dump` before the check. Page loads: each site's three product pages (setup, then the run), plus
Nike's two checked colourway pages and the two colourway pages queued in Nike run 2.

## Setup and verify

| Site | Fields (level) | Variants step | Counts confirmed | Verify (:4100) |
|---|---|---|---|---|
| **Everlane** | Price, SKU (both "Differs per variant") | list (`json-ld hasVariant`), no columns: "told apart by their SKU" | 6 / 6 / 6 variants | fields 2/2 and **variants passed**; Go to Extract unlocked |
| **Nike** | Title (product), Price (variant) | **links**, one column **"Colour"** (N3 fixed: no longer "Option") | 3 / 17 / 17 colours | fields 2/2 and **variants passed**, collector `//*[@id='colorway-picker-container']//a/@href`; Go to Extract unlocked |

Two things changed since 2026-10-02:

- Everlane product 2 (`…uniform-white`) now costs 180.00, and its SKUs are `M-T-CTN-ORGN-CR.2-WHT-*`.
  Its suggestions arrived a few seconds after the screenshots were ready (`E-1-after-accept.png`
  shows it empty; `E-1b-inspect.png` shows it filled).
- Nike's step now also offers "Listed in the page data: 17 / 17 / 7 variants" with Colour and Size
  columns, and pre-selects it. Links was chosen explicitly (`N-1b-inspect.png`, `N-2-step-links.png`).

## Extraction runs

Each website's input was set to its three proof pages (`sources.setProductUrls`). The budget was set
with `sources.update` to `{ max_items: 3, max_pages: 1, mode: 'first_n' }`. Then `crawl.plan` and
`crawl.execute` were called on :4100, and `crawl.status` was polled until the run finished.

| | Everlane (list) | Nike run 1 (links, 3 products) | Nike run 2 (links, product 1 only) |
|---|---|---|---|
| Run | `3b7a8f92`, **completed**, 52 s | `5f759916`, **completed**, 29 s | `0b6311e1`, **completed**, 25 s |
| Items | 3 planned, 3 done | 3 planned, 3 done, **0 queued** | 1 planned, **2 queued** (`variant_of` = group key), 3 done |
| Rows | **18** (6 per product) | **3** (one per page) | **3** (one per colourway) |
| `variantSummary` | variants 18, products 3, without 0, partial 0, skipped 0 | variants 3, **products 2**, without 0, partial 0, **skipped 17** (`skippedByProduct`: AF1 group 2, LV8 group 15) | variants 3, products 1, without 0, partial 0, skipped 0 |
| Time per product page | 14.2 / 21.4 / 15.8 s (avg 17.1) | 7.8 / 9.9 / 9.2 s (avg 9.0) | 7.2 / 7.8 / 8.7 s (avg 7.9) |
| Run page | `E-5-run-page-rpv.png` | `N-5-run1-page-rpv.png` | `N-5-run2-page-rpv.png` |

Run page count lines, as shown on :3000:

- Everlane: "18 variants from 3 products · 0 products without variants · 0 products with partial
  variants"
- Nike run 1: "3 variants from 2 products · 0 products without variants · 0 products with partial
  variants · **17 variant pages skipped for the budget**"
- Nike run 2: "3 variants from **1 products** · …" (defect D1)

Keys (samples):

- **Everlane**: `product_key` is the product page URL
  (`https://www.everlane.com/products/mens-organic-cotton-crew-tee-white`). `variant_key` is the SKU
  (`M-T-CTN-ORGN-CR-WHT-XS`, `…-S`, `…-M`, `…-L`, `…-B`, `…-AB`). There are no axis columns: the
  size exists only inside the SKU.
- **Nike**: `variant_key` is the page's own URL. `product_key` is the group key, the smallest URL in
  the colourway group, as plan 3 specifies. For Air Force 1 '07 that is `…/CT2302-100` (White/Black).
  It was not one of the inputs in run 1 and was only reached in run 2. The LV8 (`IM5752-300`) and the
  LV8 denim (`IR0951-400`) are colourways of one group: both rows carry `…/IR0951-002`, so 3 inputs
  count as **2 products**. The rows are extracted once, never queued twice.
- **Colour** values come from each page's own picker label: `White/White`, `Black/Black`,
  `White/Black`, `Fir/Sail/Coconut Milk/Black`, `Navy/Worn Blue/Summit White/Navy`.

Budget behaviour matches the plan. In run 1, the 3 inputs filled the cap of 3, so each colourway
group was all-or-nothing and was skipped whole (2 + 15 = 17 pages; the 2 LV8 inputs were already in
the run, so they were not counted). In run 2, 1 input plus 2 missing colourways fit the cap exactly,
so the group was queued in the same run and extracted before the run finished.

## Exports

Downloaded from :4100 `/export/runs/<id>.csv|.json|.xlsx`. The project was first in
`row_per_variant` mode, then switched to `nested` with `datasets.setVariantMode`.

| Shape | Verdict | Evidence |
|---|---|---|
| **row_per_variant** (CSV / JSON / XLSX) | **correct**. Column order is product-level fields, axes, variant-level fields, then `product_key`, `variant_key`: Everlane `Price,SKU,product_key,variant_key`; Nike `Title,Colour,Price,product_key,variant_key`. One row per variant; JSON `fields` matches. | `exports/E-rpv.csv`, `exports/N-rpv-run1.csv`, `exports/N-rpv-run2.csv`, `exports/N-rpv-run1.json` |
| **nested JSON** | **correct shape**. One object per product with its product-level fields and `product_key`, plus `variants: [{ variant_key, <axes>, <variant fields> }]` (Nike: `{ Title, product_key, variants: [{ variant_key, Colour, Price }] }`). The envelope's `fields` is wrong for this shape (D3). | `exports/E-nested.json`, `exports/N-nested-run2.json` |
| **nested CSV** | **correct (lossy, as designed)**. One row per product; axis and variant columns joined with `"; "` in variant order, then `product_key`, with no `variant_key` (`White/White; Black/Black; White/Black`, `115; 115; 115`). There is no lossy note in the file name (D2). | `exports/E-nested.csv`, `exports/N-nested-run1.csv`, `exports/N-nested-run2.csv` |
| **XLSX** | **correct**. One sheet `Data`, bold header, frozen first row (`ySplit: 1`). In row_per_variant, Price is a number (115, 86.97, 47). In nested, the same columns as the CSV, with joined cells as strings. A one-variant product keeps a number, so one column can mix types (D4). | `exports/xlsx-readings.txt` |

The run page's results sheet puts its columns in a different order from the export (Title, Price,
Colour, Variant key). That is deliberate, as the comment in `runs/$run.tsx` says.

## Defects

- **D1. "1 products".** `variantCountLines` (`packages/app/src/lib/site/run-screen-view.ts`) always
  says "products", so Nike run 2 shows "3 variants from 1 products". The other lines ("1 products
  without variants", "1 variant pages skipped…") would read the same way at 1. Screen
  `N-5-run2-page-rpv.png`.
- **D2. Nested exports carry no lossy note in the file name.** Plan 3 says the nested CSV/XLSX shape is
  "Documented as lossy in the export file's name note". The file names are the same in both modes
  (`everlane-3b7a8f92-2026-10-05.csv|json|xlsx`), and nothing else in the file marks it as lossy.
- **D3. The nested JSON's `fields` describes the CSV, not the JSON.** For Everlane, `fields` is
  `["Price","SKU","product_key"]`, while each row has only `product_key` and `variants` (Price and SKU
  sit inside `variants`, and `variant_key` is not listed at all). See `exports/E-nested.json`. The
  route takes `fields` from the CSV shape and swaps only `rows`.
- **D4 (minor). A nested CSV/XLSX column can mix types.** A one-variant product keeps the number 115,
  while a two-variant one becomes the string `"86.97; 86.97"` in the same column. See
  `exports/xlsx-readings.txt`, nested run 1.

Not defects, but worth knowing:

- In run 1, the Air Force 1 '07 product is exported with 1 of its 3 colourways and `partial: 0`.
  The 2 budget-skipped pages appear only in the run page's skipped line; the export has nothing that
  marks the product as incomplete. This is by design: partial means a page that failed to load.
- The Nike `product_key` can be a URL the customer never gave (`CT2302-100`), because the group key
  is the smallest URL in the group. This is by design, but it can surprise a customer reading the
  export.
- Everlane variants carry no size column: its page data has no size attribute, so the size is
  visible only inside the SKU.
- `/export/runs/<id>.*` answers 200 without a session. This is already known and documented in
  `packages/api-server/src/routes/export.ts` ("Cut-over puts both behind the session").

## How to rerun

Setup and verify are the same as in `2026-10-02-variants-live-check-2.md` ("How to rerun"), with
`SHOTS_DIR=../../docs/testing/results/screens-2026-10-05-variants-extraction`:

- **Everlane**: `--fields "Price Money,SKU Text"`, `accept-cell --row 'all agreed \(2\)'`,
  `step --method list`.
- **Nike**: `--fields "Title Text,Price Money"`, `step --method links`.

Then, on :4100 only, with the session cookie:

1. Check `sources.verifyEstimate` (it must return `aiAvailable: false`).
2. Call `sources.setProductUrls` with the proof pages, or with Nike product 1 alone to see queueing.
3. Call `sources.update` with `budget { max_items: 3, max_pages: 1, mode: 'first_n' }`.
4. Call `crawl.plan { sourceId }`, then `crawl.execute { runId }`, then poll `crawl.status` until the
   run finishes.
5. Fetch `/export/runs/<id>.csv|json|xlsx`.
6. Call `datasets.setVariantMode { mode: 'nested' }` and fetch the exports again.

Read per-page times from `run_items.started_at` and `completed_at`. Open the run page on :3000 at
`/projects/<p>/sites/<w>/runs/<runId>`. Finally, delete the projects, stop :4100 by port, and check
that the port is free.
