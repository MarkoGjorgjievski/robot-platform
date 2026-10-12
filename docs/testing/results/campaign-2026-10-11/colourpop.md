# colourpop.com — campaign 2, 2026-10-12 (phase 2, batch A, site 5)

**Status: DONE.** Verified 8/8 on 4 proof pages, $0 in AI. Extract returned **40 of 40**: the listing has only 40 products over its 2 pages. Judge correct rates: Title 50%, Price 83%, Brand 94%, In stock 100%, Rating 89%, Description 93%. The judge cost $3.91.

- The listing is the one the pre-screen saved: https://colourpop.com/collections/shopall
- `checkListingPage` gave 34 product links today, with a pager.

## Findings in the product (most important first)

1. **Every capture opens the image zoom lightbox and hides the product header.** On all three proof pages and the 4th, the screenshot shows the gallery viewer (× top right, thumbnails on the left) over the title, price and add-to-bag. Popup dismissal probably clicked the main image.
   - The values were still read from the page data, so everything verified. But a customer cannot check Title or Price on the screenshot, and cannot mark them.
2. **Title on ColourPop is the shade, and the visible heading is the product type.** The judge marked **18 of 40 titles wrong**. About 9 are this pattern, for example:
   - "Drift": the page heading is "Super Shock Shadow".
   - "Beetle": "Chrome Liquid Eyeshadow".
   - Also "Game Over", "Cotton Candy", "Flexitarian", "Emo Inside" and "Truth or Bare".
   - Shopify's own product title *is* "Drift" (`product_type` "Super Shock Shadow"), so the stored value is the site's name.
   - The proof pages were palettes, where name and heading are the same, so verification could not see the difference.
   - The rest are judge misreadings: it took review titles such as "Would recommend!", "Cute" and "My new favorite glitter!" for the product title, or found no title because of the cookie banner.
3. **Price: the stored price differs from the displayed price on 2 products.**
   - Change Me Mega Highlighter: stored 15, the page shows "$12.00". Shopify's `.js` price is 15 with no compare-at price, so the page applies a discount that the data doesn't carry.
   - Berry Glaze bundle: stored 26, the page shows "$18.00".
   - Two other wrongs are the judge reading an add-on's price.
4. **Coverage re-check was closed "stalled" while the Extract was running, and the tab then shows no coverage at all.** The second check (after "Use as proof page") ran 10:53:38 → 11:09:23. The server closed it `failed` / `stalled` at the 10-minute limit (`COVERAGE_CHECK_STALL_MS`).
   - The Verification tab then read only "Everything is verified · Nothing has changed since the last verification". There was no coverage line and no word that the check died.
   - The first check (no Extract running) took 6 min.
5. **Sample is labelled "No AI. Free." and the probe recorded $0.0997.** It took 256 s (10:54:03 → 10:58:18): "Pages walked 2", "Product links found 30", "Sample rows complete 3 of 3".
6. **Extract planning took 3 min 46 s with only a spinner on screen** (10:58:54 click → 11:02:41, when "Open the run" appeared).
7. The run log reads: "warning: pagination (mechanical: url-pattern) produced no new items on https://colourpop.com/collections/shopall". Two pages were walked, but page 2 added nothing new.
8. Description text keeps HTML entities in places ("100% Vegan &amp; Cruelty-Free"), which the judge flagged on 1 product.
9. Rating: the 4 "wrong" are the judge's vocabulary, not a bad value. The page shows "Rated 4.9 out of 5 stars" as hidden text, the judge sees only stars, and says "5-star rating with 48 Reviews, not a numeric 4.9 value".

## Proof pages

1. https://colourpop.com/products/fade-to-hue-pressed-powder-makeup-palette
2. https://colourpop.com/products/aurora-stuck-shadow-palette
3. https://colourpop.com/products/bare-necessities-neutral-eyeshadow-palette. This replaced `chrome-dreams-creme-gel-liner-set`, a bundle.
4. https://colourpop.com/products/fallen-collection (a bundle; no rating; added by the coverage line)

| Field | What it needed | Verdict |
|---|---|---|
| Title | agreed → Accept (palette names, checked against the page data, since the header is hidden by the lightbox) | verified 4/4 |
| Price | "same on every product" 35.00 → Accept anyway (Shopify `.js` says 35 / 35 / 35) | verified 4/4 |
| Main image | agreed → Accept | verified 4/4 |
| SKU | page data, confirmed (EyePalette-FadeIntoHue …, matching Shopify) | verified 4/4 |
| Brand | page data "ColourPop", confirmed | verified 4/4 |
| In stock | page data, confirmed (then agreed) | verified 4/4 |
| Rating | "same on every product" 4.9 → Accept anyway ("Rated 4.9 out of 5 stars" on each); **absent** on product 4 | verified 4/4 |
| Description | page data, confirmed (it matches the visible "product details") | verified 4/4 |

Counts on the first three: agreed 5 (two of them via "Accept anyway"), page data confirmed 4, marked 0, typed 0, absent 0. Product 4 added 1 absent.

## Verify

- 10:24:49, "Verify 8 fields · up to $0.40": 20 s, 8/8, 0 AI, $0.00.
- 10:53:34, "Re-verify 8 fields · up to $0.40" (4 proof pages): 10 s, 8/8 4/4, $0.00.

## Coverage

- **First** (10:25:01 → 10:31:05, 6 min): "1 field was empty on some of the 20 sampled products — see the row."
  - `rating`: "Empty on 1 of 20 sampled products · it shows no rating in the page data" + "Use as proof page". The product was `fallen-collection`.
- "Use a sampled product as proof page for Rating" put fallen-collection in as product 4 (ready in about 20 s). I answered it, and the re-Verify cost $0.
- **Second**: closed "stalled" after 15 min 45 s (finding 4). No result.

## Sample and Extract

- **Sample:** see finding 5.
- **Extract:** "custom 60 products across custom 2 pages", which read "1 listing · first 60 products from each · first 2 pages of each · safety stop at 5,000 products per listing". The button reads only "Extract".
  - Run `50c08f41-b6b4-4cbc-ae1f-63a6946263e6`: 10:58:55 → 11:16:08, Duration "17 min". "Done", "40 of 40 extracted", "40 URLs to extract · 2 listing pages walked".
  - The run's `cost_usd` is $0.0000.
  - Empty cells: "Rating is empty on 2 of 40 products · all from /collections/shopall" (two bundles, Super Stain Full Collection and Fallen Collection, which have no rating).

| Field | Filled | Distinct |
|---|---:|---:|
| Title, Main image, SKU, Description | 40/40 | 40 |
| Price | 40/40 | 21 |
| Brand | 40/40 | 2 (ColourPop 39, "SOL Body" 1 on Opaltini, a ColourPop sub-brand) |
| In stock | 40/40 | 1 |
| Rating | 38/40 | 4 |

## Judge

`docs/testing/results/2026-10-12T11-16-judge-run-colourpop.md`. It estimated "~$2.39 … ~$2.63 with the 10% retry/explain allowance" and actually cost **$3.9130**, 49% over, in 29 min 23 s.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 40 | 18 | 18 | 2 | 0 | 2 | 0 | 50% |
| Price | 40 | 19 | 4 | 17 | 0 | 0 | 0 | 83% |
| Main image | 40 | 0 | 0 | 0 | 40 | 0 | 0 | — |
| SKU | 40 | 0 | 0 | 36 | 4 | 0 | 0 | — |
| Brand | 40 | 31 | 2 | 1 | 6 | 0 | 0 | 94% |
| In stock | 40 | 21 | 0 | 9 | 10 | 0 | 0 | 100% |
| Rating | 38 | 32 | 4 | 0 | 2 | 0 | 2 | 89% |
| Description | 40 | 37 | 3 | 0 | 0 | 0 | 0 | 93% |

## Spend

| Item | Cost |
|---|---:|
| Verify ×2 | $0.00 |
| Sample probe | $0.0997 (recorded; labelled free) |
| Extract | $0.00 |
| Judge | $3.9130 |

## Screenshots

- Proof pages: `colourpop-00-cards-as-found`, `-01-cards`, `-02-table-before`, `-03-before-verify`.
- Verify and coverage: `-04-after-verify`, `-05-coverage`, `-07-before-use-as-proof`, `-08-fourth-card`, `-09-after-verify`, `-10-coverage-2-stalled` (no coverage line at all).
- Extract: `-12-sample`, `-12b-sample-reload`, `-13-extract-before`, `-15-run`.
