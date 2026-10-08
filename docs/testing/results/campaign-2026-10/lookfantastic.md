# lookfantastic.com — credit campaign 2026-10-08

**Status: DONE.** Screen, proof pages, expected values, Verify and one Extract all completed.

- **Verify:** 8/8 fields verified for $0.00.
- **Extract:** 50/50 rows done in 1,154 s (**23.1 s per item**), run cost $0.00.
- **Price and In stock are empty on 29 of 50 rows.** All three proof pages were single-size products. Every multi-size product publishes a JSON-LD `ProductGroup` with `hasVariant` and has no top-level `offers`. The certified `offers[0].price` / `offers[0].availability` paths therefore miss on every multi-size product (see finding 1).

**Website**
- Name `Lookfantastic` (the default from the host), source `e94144d0-87ad-4f8e-896a-54976e64c351`.
- Added through the Add website dialog with `https://www.lookfantastic.com`.

**Listing:** https://www.lookfantastic.com/c/health-beauty/face/skincare-products/moisturisers/
- The pre-screen URL `/health-beauty/skin-care/moisturisers.list` is gone. The site moved to `/c/…/` category paths and `/p/<slug>/<id>/` product paths.
- I took this URL from the homepage navigation's hrefs. In plain headless Playwright it answered 200 with about 70 `/p/…` links, plus `?pageNumber=2`.

**Proof pages:** swapped in by hand (see Screen):
1. https://www.lookfantastic.com/p/aveeno-calm-restore-oat-rich-cream-50ml/17887161/
2. https://www.lookfantastic.com/p/medik8-advanced-pro-collagen-peptide-cream-50ml/16818015/
3. https://www.lookfantastic.com/p/dr.-althea-345-relief-cream-50ml/17729496/
   - This page has a different layout from 1 and 2: a single image carousel and an upper-case title block.

## Screen (free)

- "39 products found · a pager too". Find took 14 s, and all three captures read `ready` within 27 s. There was no bot wall and no consent wall; the captures show the real product pages.
- **The first three products Find products offered were all Lumene** (Nordic-C Glow Boost Essence / Triple Glow Elixir / Glow Moisturizer). The first card's thumbnail is a Lumene "Glow ready" banner, so these appear to come from a sponsored brand strip at the top of the listing, not from the grid.
  - With them, Brand read "same on every product — check it", so it could not have tested anything.
  - I added three grid products from three brands with "+ Add product" and dropped the three Lumene cards. I did not use "Paste product pages instead". All three captures read `ready`.

## Per-field table

| Field | What it needed | Certified paths | Verdict | Extract hit rate |
|---|---|---|---|---|
| Title | agreed | json-ld `name`, api `response.Results[0].Name`, 3× json-ld `review[n].itemReviewed.name` | verified 3/3 | 50/50 |
| Price | agreed | json-ld `offers[0].price` | verified 3/3 | **21/50** |
| Main image | agreed | json-ld `image` | verified 3/3 | 50/50 |
| SKU | agreed, **from page data** (no product code is visible on any page) | json-ld `sku`, api `response.Results[0..3].ProductId` | verified 3/3 | 42/50 |
| Brand | **marked** on product 1, agreed on 2 and 3 | api `response.Results[0].Brand.Name` only | verified 3/3 | 43/50 |
| Rating | agreed | json-ld `aggregateRating.ratingValue` + 2 api review-statistics paths | verified 3/3 | 45/50 |
| In stock | agreed | json-ld `offers[0].availability` (weakEvidence) | verified 3/3 | **21/50** |
| Description | agreed | json-ld `description` | verified 3/3 | 50/50 |

**Counts:** agreed 7 fields; marked 1 cell (Brand on product 1); typed 0; absent 0. SKU was accepted from page data.

**How each value was checked against the captures**

- **Title.** Equals the h1 / title line: Aveeno Calm + Restore Oat Rich Cream 50ml / Medik8 Advanced Pro-Collagen+ Peptide Cream 50ml / Dr. Althea 345 Relief Cream 50ml.
- **Price.** 11.24 / 82 / 16.4 are the current prices: "£11.24" (RRP £14.99 struck through), "£82.00", and "£16.40" (RRP £21.90). On page 3 the price sits under the open rating-breakdown popover in the screenshot, but it is in the capture's box text. GBP, as shown.
- **Main image.** These are thgimages URLs whose file names start with each product's id (17887161-…, 16818015-…, 17729496-…), so each is the product's own pack shot.
- **SKU.** Not visible on any page. I checked the capture text and the live `innerText` after opening every `<details>` and `aria-expanded` control, and found no "product code". The suggested values (17887161 / 16818015 / 17729496) are the JSON-LD `sku`, which equals the id in the URL. Following the dispatch rule (absent on every page → accept from page data), I accepted the agreed row. The SKU cells were **not** marked on the page.
- **Brand.** The brand line above the title reads AVEENO / MEDIK8 / DR. ALTHEA, upper-cased by CSS; the DOM text is "Aveeno", "Medik8", "Dr. Althea".
  - Product 1 had no suggestion ("missing on product 1"). I marked the brand link (box `a` "Aveeno" at 854,270).
  - **The mark popover pre-selected "Title"** for this element. My script switched the picker to Brand before Confirm (see finding 4).
- **Rating.** 4.801… / 4.751… / 4.833… are the unrounded averages. The page prints 4.8 (392), 4.8 (651) and 4.8 (42); all three round to 4.8.
- **In stock.** Each page reads "In stock | Usually dispatched within 24 hours" and has an active ADD TO BASKET.
- **Description.** The suggested text matches the product description. It contains literal `&nbsp;` entities (see finding 5).

## Verify (paid, once)

- Label **"Verify 8 fields · up to $0.40"** (≤ $3). Clicked once at 11:59:52Z.
- Wall time **15.4 s**.
- Result **8/8 verified**, allPassed, 0 AI calls, **actual $0.00** (`source_verifications` id `9529a6ce-4a40-4a94-ac0c-46cc03b75844`, cost 0.0000).

## Sample (free step before Extract)

- "Sample 3 products" took **80 s**. It walked 1 listing page and found **30 product links** ("Pagination detected: not reported"). The panel read "Sample rows complete **0 of 0**", the same contradiction as on Nike, B&N, Allbirds and Made In.
- The probe run `dd2d8be9…` is stored as status **`partial`**, "warning: budget reached: 30 items", **cost_usd $0.2000**, though the screen says no AI is used. The api-server's counter is shared with the other workers running at the time, so this figure is unreliable. It is reported as shown.

## Extract (once)

- Budget set to **custom 60 products across custom 2 pages**. The screen read "1 listing · first 60 products from each · first 2 pages of each · safety stop at 5,000 products per listing".
- Run `8aaaf049-2320-406d-9241-d478055cd021`:
  - started 12:03:05Z, completed 12:22:19Z, **1,154 s for 50 items → 23.1 s/item**;
  - status `completed`, "50 of 50 extracted";
  - **cost $0.00**.
- It walked **1 listing page** and queued 50 URLs. The 60-item budget did not bind, and page 2 was not walked although the Verification tab had reported "a pager too".
- The 50 URLs include `?variation=` duplicates of the same product (the Laneige, Bobbi Brown, Clinique, Clarins and Ole Henriksen sizes) and one sponsored ad link (`…?rctxt=sponsoredAdsPLP&sponsoredAdsPLPIndex=1`).
- The run page reads **"2 fields stopped extracting"**. Empty cells: Price 29/50, In stock 29/50, SKU 8/50, Brand 7/50, Rating 5/50. Title, Main image and Description are 50/50.
- **What the misses have in common (from the stored rows).**
  - Every row with a Price also has In stock = true. All 21 are single-size products, with prices 11.24–82, including the three proof pages at the same values.
  - All 29 misses are multi-size products. A free live check of Clinique Moisture Surge 12849046 and Laneige 14979949 confirms their JSON-LD is `@type: ProductGroup` with `hasVariant[]` and no top-level `offers`.
  - SKU, Brand and Rating misses fall mostly on `?variation=` URLs. There the `response.Results[…]` reviews API that Brand and SKU depend on seems not to be captured.
- Brand casing follows the API: "Beauty Of Joseon" on one row, "Beauty of Joseon" on others.
- Org Usage page after this website: **$1.15** for October. This is all campaign workers combined.

## Findings in the product (not fixed)

1. **Certification is blind to a second data layout that the proof pages never showed.**
   - All three proof pages were single-size products, so `offers[0].price` certified 3/3. Yet 58% of the listing is multi-size `ProductGroup` pages with no top-level `offers`, and Price and In stock came out empty on 29/50.
   - The run page's "Empty cells" hint ("add one of them as a proof page") is the right repair. Nothing at setup suggested picking a multi-size product, and the "agreed" status gave no hint that the paths only cover one shape.
2. **Find products' first three products were a sponsored brand strip**, all Lumene. Brand then showed "same on every product". The Extract walk also queued a sponsored-ad URL (`rctxt=sponsoredAdsPLP`).
3. **"a pager too" on Verification, but Extract walked 1 page** with a 2-page / 60-item budget and stopped at 50. The Sample likewise said "Pagination detected: not reported". (The new listing finder on `main` is not live yet; this may be what it fixes.)
4. **The mark popover pre-selected the wrong field again.** When I marked the Brand cell from its own Fix/Mark, the picker read "Title". Confirming without looking would have overwritten Title on product 1 with "Aveeno". This is the same defect as Made In finding 4.
5. **Description values keep literal HTML entities** (`&nbsp;`) from the JSON-LD, e.g. "…skin types.&nbsp; Packed with…".
6. **Brand certified through a single third-party reviews-API path** (`response.Results[0].Brand.Name`), with no DOM or JSON-LD alternative, even though the page has a brand link that I marked. It missed on 7/50 rows.
7. **SKU certified `response.Results[1..3].ProductId`** besides json-ld `sku`. Those are positional entries in a reviews response and may belong to other products. No wrong SKU showed up in this run: every filled SKU equals the URL id.
8. **The probe run is stored as `partial` and shows $0.2000** while labelled free (shared-counter caveat). "Sample rows complete 0 of 0" again.
9. Per-cell "Accept … on product n" buttons are offered for some fields (Title, Price, In stock) but not for others (Brand, SKU, Rating, Main image, Description). For Brand I had to accept the whole row after marking product 1. Minor.

## Screenshots

- `lookfantastic-screen.png`: after Find products, 39 found, the three Lumene cards `ready`.
- `lookfantastic-swap.png`: the three hand-picked proof pages, `ready`, with the suggestions (Brand missing on product 1).
- `lookfantastic-before-verify.png`: every cell accepted, Verify reading "up to $0.40".
- `lookfantastic-after-verify.png`: 8/8 verified.
- `lookfantastic-run.png`: the run page, Done, 50 of 50, the empty-cells panel.
