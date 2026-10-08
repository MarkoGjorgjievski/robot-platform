# ulta.com — credit campaign 2026-10-08

**Status: DONE.** Screen, proof pages, expected values, Verify and one Extract all completed.

- **Verify:** 8/8 fields verified for $0.00, with 0 AI calls.
- **Extract:** 60/60 rows, every field filled on every row, at 18.6 s per item. The run recorded $0.1030 (shared-counter caveat below).

**Website**
- Name `Ulta` (defaulted from the host), slug `ulta`, source `da0c2a28-779f-457d-bdb4-8c89f1e134fe`.
- Added through the Add website dialog with the address `https://www.ulta.com`.

**Listing used**
- https://www.ulta.com/shop/skin-care/moisturizers ("Moisturizers - Skin Care - 2075 Products"). Grid links carry `?sku=<item number>`.

**Proof pages** (pasted through "+ Add product", see Screen)
1. https://www.ulta.com/p/toleriane-double-repair-face-moisturizer-with-niacinamide-xlsImpprod16011007 (La Roche-Posay, 3.38 oz default, $25.99)
2. https://www.ulta.com/p/cicaplast-balm-b5-soothing-therapeutic-multi-purpose-cream-pimprod2018263 (La Roche-Posay, 1.3 oz default, $20.99)
3. https://www.ulta.com/p/ultra-repair-cream-intense-hydration-moisturizer-xlsImpprod13491031 (First Aid Beauty, 4.0 oz default, $35.00)

## Screen (free)

- "Find products" reported **"140 products found · a pager too"**. The three products it put on the board were not products. They were brand filter facets from the listing's sidebar:
  - `/brand/ulta-beauty-collection?…`, titled "ULTA Beauty Collection8 Products Available8";
  - `/brand/107?…`;
  - `/brand/admire-my-skin?…`.
- Their captures read `ready`. They suggested Title "Home" on all three and a meta description "Shop … Moisturizers at Ulta Beauty…" (`ulta-screen.png`). This is the known old-finder defect.
- I replaced them with three moisturizers from the real grid using "+ Add product" → URL, then dropped the three facets.
- There was no bot wall and no consent wall. All three product captures read `ready`, and each shows the product hero: brand, title, stars, price, size selector, and "In stock and ready to ship". A Rewards sign-in popover sits top right but covers nothing that is needed.

## Per-field table

| Field | What it needed | Certified (first path) | Verdict | Extract hit rate |
|---|---|---|---|---|
| Title | agreed | json-ld `name` (+ api `items[2].productName`, …) | verified 3/3 | 60/60 |
| Price | agreed (25.99 / 20.99 / 35.00 = the default size's price on each page) | json-ld `offers.price` (+ api `content.price`, …) | verified 3/3 | 60/60 |
| Main image | agreed (`media.ulta.com/i/ulta/<item no.>`) | json-ld | verified 3/3 | 60/60 |
| SKU | agreed (equals "Item 2509730 / 2570171 / 2648273" on the pages) | json-ld `sku` (+ api `content.skuId`, …) | verified 3/3 | 60/60, and **60/60 equal the `?sku=` in their URL** |
| Brand | agreed (brand line above the title) | json-ld `brand` (+ api `brandName`, …) | verified 3/3 | 60/60 (35 distinct brands) |
| Rating | agreed (4 / 4.7 / 4.5, printed next to the stars) | json-ld `aggregateRating.ratingValue` (+ an XPath on ReviewStars) | verified 3/3 | 60/60 |
| In stock | agreed ("In stock and ready to ship" on all three) | json-ld | verified 3/3 | 60/60 (all true) |
| Description | agreed (equals the page's summary paragraph above "Details", word for word) | json-ld | verified 3/3 | 60/60 |

**Counts:** agreed 8, marked 0, typed 0, absent 0. All eight were taken with "Accept all agreed (8)".

**Checks behind the accepts.** Every value was checked against the capture's boxes and the first screenshot tile, at y 338–2305 on each page.

## Verify (paid, once)

- Label **"Verify 8 fields · up to $0.40"** (≤ $3). Clicked once at 11:33:00Z.
- Wall time **20.4 s** (server 11:33:00.8 → 11:33:20.5).
- Result **8/8 verified**, allPassed, **0 AI calls, actual $0.0000** (`source_verifications` `42bd60cd…`).

## Sample (free step before Extract)

- "Sample 3 products" took **145 s**. It walked 1 page, found **30 product links** (enough, so I continued) and extracted 3 rows.
- The panel showed the same contradictions as on the other sites: "Pagination detected: not reported" and "Sample rows complete **0 of 0**" while the header said "3 rows extracted" (`ulta-sample.png`).
- The probe run `05d38503…` recorded **$0.0900**, though the button says "No AI. Free." The shared-counter caveat from nike.md applies.

## Extract (once)

- Budget set to **custom 60 products across custom 3 pages**. The screen read "1 listing · first 60 products from each · first 3 pages of each · safety stop at 5,000 products per listing".
- Run `ea82090e-efcb-43b7-bf0c-92852b95ac76`:
  - clicked 11:37:14Z, completed 11:55:48Z, **1,114 s for 60 items → 18.6 s/item** (extraction of the items alone took 11:38:43 → 11:55:48);
  - 1 listing page walked;
  - status `completed`, **60 of 60 extracted**, 60 distinct products;
  - **cost $0.1030** as recorded. With 0 AI calls certified this probably belongs to other workers' concurrent calls (shared counter), so it is reported as shown.
- **Hit rate 60/60 on every field.**
- I spot-checked four rows against the live pages, free with Playwright. Price, rating and brand matched on all four:

  | Product | Price | Rating |
  |---|---|---|
  | Kiehl's Ultra Facial Cream | $26.00 | 4.7 |
  | Clinique Dramatically Different Lotion+ | $34.00 | 4.6 |
  | Lancôme Rénergie Multi-Action | $180.00 | 4.8 |
  | bareMinerals Complexion Rescue | $39.50 | 4.4 |

- Org Usage page after this website: **$0.75** for October. This is all campaign workers combined.

## Findings in the product

1. **Find products put brand filter facets on the board as the first three "products".** It showed "140 products found", but the first three were `/brand/…` facet links whose titles read "…Products Available…". A customer who keeps the default three would verify on brand pages, where every field but Title "Home" and a meta description is missing. This is the known old-finder defect; the fix is on `main` but not live.
2. **Sample panel contradictions**, as seen on Nike, Allbirds and B&N: "0 of 0" sample rows against "3 rows extracted", and "Pagination detected: not reported".
3. **Sample says "No AI. Free." but its probe run shows $0.0900.** The Extract run of a 0-AI certified source shows $0.1030. Both are likely the process-wide cost counter charging other workers' calls (nike.md finding 1).
4. Minor: products added by URL show only their URL in the column head, with no title or thumbnail.

Unlike B&N, size variants did not mislead: Ulta's JSON-LD follows the `?sku=` the listing links to, and SKU = URL sku on 60/60.

## Screenshots

- `ulta-screen.png`: after Find products. Three brand facets are on the board ("140 products found").
- `ulta-table-before.png`: the three moisturizers with every row "agreed", before Accept all.
- `ulta-after-verify.png`: 8/8 verified.
- `ulta-sample.png`: the Extract tab after Sample (30 links, "0 of 0").
- `ulta-run.png`: the run page, Done, 60 of 60.
