# allbirds.com — credit campaign 2026-10-08

**Status: STOPPED at step 5 (Extract).** Screen, proof pages, expected values and Verify all
went cleanly. The Extract tab's mandatory Sample found 1 product link on a listing that shows
148 products, and it charged $0.0376 while the screen says "No AI. Free.". So the one Extract
start was **not** used (hard rule: stop at an app problem, do not improvise). It is still
available for a re-run once the listing walk is fixed.

- Website: `Allbirds` (slug `allbirds`, source `da33ce25-77b6-424c-932f-7837b254ea05`), added through the Add website dialog with the address `https://www.allbirds.com`.
- Listing used: **https://www.allbirds.com/collections/mens**, the suggested one. It lists products. The live page reads "148 products" and has 153 unique `/products/` links, which include some women's colourways.
- Proof pages (the first three that Find products returned, all with the same layout):
  1. https://www.allbirds.com/products/mens-runner-nz-slip-on-mushroom
  2. https://www.allbirds.com/products/mens-cruiser-medium-grey
  3. https://www.allbirds.com/products/mens-tree-runner-nz-medium-grey

## Screen (free)

"Find products" worked first time. There was no bot wall and no consent wall in the captures; a
"Where are we shipping to?" country modal appears on the live site, but it was not in the
captures. All three screenshots read `ready` in about a minute, and every one of the 8 rows was
pre-filled.

## Per-field table

| Field | What it needed | Source certified | Verdict |
|---|---|---|---|
| Title | agreed (row Accept) | json-ld `name` (+ alternates) | verified 3/3 |
| Price | agreed | json-ld `offers.price` | verified 3/3 |
| Main image | **marked** on product 2. Products 1 and 3 were agreed (cell accept) | json-ld `image[0]` | verified 3/3 (but see finding 3) |
| SKU | agreed | json-ld `sku` | verified 3/3 |
| Brand | agreed ("same on every product — Accept anyway") | json-ld `brand.name` (weakEvidence) | verified 3/3 |
| Rating | agreed | json-ld `aggregateRating.ratingValue` | verified 3/3 |
| In stock | agreed | json-ld `offers.availability` (weakEvidence) | verified 3/3 |
| Description | **marked** on products 2–3. Product 1 was agreed (cell accept) | xpath (the "why we made this" paragraph) | verified 3/3 |

Counts: agreed 6, marked 2, typed 0, absent 0.

Checks behind the accepts:
- Title and price are visible on all three screenshots ($105 / $105 / $100).
- SKU, brand and rating are **not visibly rendered**. The reviews block paints only its heading in the capture, and the live page shows no rating number either. The suggested values match the site's own JSON-LD on the live page (ratingValue 4.7 / 4.1 / 4.2; sku = productGroupID), so they were accepted as the site's data, not as anything read off the page.
- In stock: sizes are selectable on every page, so `true` is right.
- Description was "agreed", but the JSON-LD text **differs from the page** on products 2 and 3:
  - Product 2: the JSON-LD has "Inspired by a classic court style…", while the page shows "Minimal and modern, our signature classic court shoe…".
  - Product 3: the page text is a longer, different version of the JSON-LD one.

  So the row's suggestion was refused. Product 1 (identical text) was accepted, and products 2 and 3 were marked on the screenshot.

## Verify (paid, once)

- Label: **"Verify 8 fields · up to $0.40"** (≤ $3), clicked once at 10:13:38Z.
- Wall time: **5 s** (10:13:38.7 → 10:13:43.1).
- Result: **8/8 verified**, allPassed, 0 AI calls, **actual cost $0.00** (`source_verifications.cost_usd` = 0.0000).
- Everything certified mechanically (JSON-LD, plus an XPath for Description). The "up to $0.40" upper bound was never approached.

## Extract: not started

The Extract tab requires "Sample 3 products" before Extract unlocks. The Sample says "walks the
first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free." It
was clicked once:

- Wall time 105 s. Pages walked 1, **Product links found 1**, pagination "none detected — single page", "Sample rows complete 0 of 0", while the step header said "1 row extracted".
- The one row (Runner NZ Slip On) was extracted correctly in every field, with the certified paths.
- Run `35d38ce3-c036-47c9-ac16-cb5ad6413903` (input_label `probe`) has **cost_usd 0.0376**, and the org's Usage page shows **$0.04** for October.
- Run log: `api-param pagination not applied … (7 intercepted JSON response(s) considered)` and `no pagination detected … planned page 1 only`.

Given the probe, an Extract of this listing would have yielded about 1 item, not 50–100. The
item budget was not set and Extract was not clicked. The budget control offered "Run [all]
products across [all] pages", and the website's stored budget is `{first_n, max_items 40,
max_pages 3}`.

Spend for this website: Verify $0.00 + Sample $0.0376 = **$0.04** (Usage page).

## Findings in the product

1. **The listing walk finds 1 product link on a 148-product listing.** "Find products" on the Verification tab found the products on the same URL, but Sample (which plans with the extraction crawler) found only the first. Extract is unusable for this site until that is fixed.
2. **Sample is labelled "No AI. Free." but cost $0.0376.** Planning runs `SchemaAgent` inside `plan-source.ts`.
   - The cost is measured as a diff of a process-wide usage counter (`record-run-cost.ts`, `costSince`). With other campaign workers on the same api-server, this figure can also absorb their model calls. Either way, the label and the charge disagree.
3. **A variant page's "Main image" is the default colourway's image.**
   - On `mens-cruiser-medium-grey` the screenshot paints the grey shoe. The JSON-LD `image[0]` and the `<img src>` attribute both name `…Cruiser_Dark_Navy…` (the grey is presumably served via srcset/JS).
   - Marking the image on the screenshot gives the same navy URL, so a wrong image verifies 3/3.
   - The value is also the `&width=100` thumbnail URL.
4. **Main image certifies `image[1]`…`image[3]` as alternate paths.** These are the back and top-down views, so if `image[0]` were ever missing, a non-main image would be extracted silently.
5. **Title certifies an XPath into the size-chart modal's `<h2>`** as an alternate path. It is fragile, and it is not the product heading.
6. **Description: the row said "agreed" on JSON-LD text that two of the three pages do not show.** The agreement check compares paths across products, not against the rendered text.
7. **The capture leaves the description and other text sections blank in the screenshot.** The boxes exist (text at y≈1100–1400), but the pixels are an empty band. This is probably a fade-in that never fired. Clicking the blank area still marked the right element.
8. **The Sample panel contradicts itself:** "1 row extracted" in the step header vs "Sample rows complete 0 of 0" in the panel.

## Screenshots

- `allbirds-table-before.png`: the table after Find products, before any accept (Verify reads "up to $0.40").
- `allbirds-after-verify.png`: 8/8 verified, "Everything is verified".
- `allbirds-sample.png`: the Extract tab after Sample. 1 page walked, 1 link found, "0 of 0".

## Re-run after fix B (2026-10-08, servers restarted)

Fix B is the change to the listing walk: after page 1 it plans from the page's product links
when the row selector missed them. The website was **not** re-verified; the certification
from 10:13Z stands. The listing is unchanged, **https://www.allbirds.com/collections/mens**,
already saved on the Extract tab.

**Status: DONE.** Sample now finds 30 links where it found 1 before, and Extract returned
60 of 60.

### Sample (clicked once, "Sample again")

| | Before fix (10:15Z) | After fix (13:32Z) |
|---|---|---|
| Pages walked | 1 | 1 |
| Product links found | **1** | **30** (the probe's item budget: the run log reads `budget reached: 30 items`) |
| Pagination detected | none detected — single page | not reported |
| Sample rows | "0 of 0" (header "1 row extracted") | **3 of 3** (header "3 rows extracted") |
| Wall time | 105 s | 104 s (13:32:49.8 → 13:34:33.7) |
| Run cost | $0.0376 | $0.0306 (run `8d5ad632-…`, status `partial`) |

- The three sample rows were three colourways of Men's Dasher NZ (Anthracite, Light Burnt Olive, Blizzard). Every field was filled, and each row had its own colourway's image.
- The message "planned from the page's product links" does **not** appear anywhere the customer can see it. The probe's and the run's `logs` contain only `warning: budget reached: N items`, and neither the Sample panel nor the run page says it. So it cannot be confirmed from the UI that the new branch, rather than some other path, produced the links. The outcome is what changed.
- Finding 8 (the panel contradicting itself) is gone: the header and the panel now agree at 3.
- The Sample is still labelled "No AI. Free." while the run records $0.0306 (finding 2 stands). That figure comes from the process-wide counter, and two judge processes and another worker were running at the same time.
- The Sample run's status is `partial`, presumably because 27 of its 30 planned detail items stay `pending` by design.

### Extract (started once)

- Budget: "Run **custom** (60) products across **custom** (2) pages". The screen read "first 60 products from each · first 2 pages of each". Extract was clicked at 13:45:01.7Z, about 10 min after Sample finished.
- Run `608342bc-70e2-4156-a166-70391b2ee8db`, status **completed**, **60 of 60 extracted**. The page reads "60 URLs to extract · 1 listing page walked", and the log reads `budget reached: 60 items`, so the item budget bound.
- The 60 URLs were all distinct and all `/products/mens-…`; none of the women's colourways on the page came through.
- Time: 13:45:01.8 → 13:55:38.5 = **637 s, which is 10.6 s per item**.
- Cost shown: **$0.1512** (`runs.cost_usd`). A run on certified JSON-LD/XPath paths should cost $0, so most or all of this is probably other processes' model calls absorbed by the shared counter. It is a finding either way: the run is charged.

Per-field hit rates (from the run's rows; the run page's "Empty cells" panel says the same):

| Field | Filled | Note |
|---|---|---|
| Title | 60/60 | |
| Price | 60/60 | |
| Main image | 60/60 | `&width=100` thumbnail URL (finding 3) |
| SKU | 60/60 | only **13 distinct** values over 60 rows: the SKU is the style (`MENS_DASHER_NZ`), the same for every colourway |
| Brand | 60/60 | |
| Rating | **55/60** | empty on 5: Cruiser/Varsity Terralux colourways, Dasher NZ Relay ×2 (product pages with no rating in their data, presumably new products) |
| In stock | 60/60 | |
| Description | **52/60** | empty on 8: Terralux, Terry, Jersey and Relay products; the run page says "all from /collections/mens" and offers "Repair all gaps…" |

### Spot-check of 5 rows against the live pages

The pages were opened headless at 13:58Z. The "Where are we shipping to?" modal covers the
middle of each page, but the title, price and colour stay readable.

| Product | Price (row / page) | SKU (row / page JSON-LD) | Main image colour (row / page) |
|---|---|---|---|
| mens-dasher-nz-blizzard | 140 / $140 visible | MENS_DASHER_NZ / same | Blizzard / Blizzard selected, same file as the first gallery image |
| mens-tree-runner-nz-rugged-beige | 100 / JSON-LD 100 | MENS_TREE_RUNNER_NZ / same | Rugged Beige / Rugged Beige, same file |
| mens-varsity-airy-mushroom-blizzard | 120 / $120 visible | MENS_MENS_VARSITY_AIRY / same | Mushroom / Mushroom, same file |
| mens-cruiser-terralux | 135 / JSON-LD 135 | MENS_CRUISER_TERRALUX / same | Toasted Coconut / Toasted Coconut, same file |
| mens-cruiser-terry-ochre | 115 / $115 visible | MENS_CRUISER_TERRY / same | Ochre / Ochre, same file |

All 5 rows agree with the pages: price 5/5 (3 read off the screenshot, 2 against the page's
JSON-LD), SKU 5/5 and image colour 5/5. On these five URLs the image matches the colourway
named in the URL. The wrong-colour case from finding 3 (`mens-cruiser-medium-grey`) was not
among the 60 rows.

### Findings from the re-run

1. **Fix B works live:** 1 → 30 links on Sample, and 60 of 60 on Extract with every row a distinct men's product.
2. **The "planned from the page's product links" warning is not surfaced.** It is not in `runs.logs`, the Sample panel or the run page, so neither a customer nor an operator can tell that the fallback fired.
3. **The Extract run is charged $0.15 with zero expected AI.** Like the Sample, it has no AI work to do, so this is the shared-counter attribution problem (finding 2) at a larger scale.
4. **SKU is the style code, not a variant SKU.** With "one row per variant" there are 60 rows but only 13 distinct SKUs, so the column cannot key a row. This is the site's JSON-LD `sku`, accepted at Verification.
5. Description is 87% and Rating 92%. The gaps cluster by product line (Terralux, Jersey, Relay), which matches the run page's "lays that field out differently" hint.

Spend for this re-run: Sample $0.0306 + Extract $0.1512 = **$0.18** as recorded (shared-counter caveat).

Screenshots:
- `allbirds-rerun-sample.png`: the Extract tab after Sample. 30 links, 3 of 3.
- `allbirds-rerun-extract-before.png`: the budget set to 60 products / 2 pages, before Extract.
- `allbirds-rerun-run.png`: the run page, Done, 60 of 60, with the Empty cells panel.
