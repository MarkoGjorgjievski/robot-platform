# burrow.com — campaign 2, 2026-10-12 (phase 2, batch B, site 13)

**Status: DONE.** Verified 8/8 3/3 for $0.00, the cleanest Verify of the batch. Extract returned **25 of 25**, the whole listing, against "5 products found" by the finder. The judge ($2.3639) found real wrong values the Verify could not see: 12 stale descriptions (the old "Range"/"Ember" copy on Range Plus and Ember Pro pages) and 2 prices taken from the base variant instead of the leather fabric in the URL.

- Website `burrow` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved: https://burrow.com/collections/sofas
- The candidate list calls it BigCommerce, but it is Shopify (`cdn.shopify.com`, `/products/`).
- US storefront ($).
- The capture lays the page out normally: the h1 is at x=862, and title, price and the "Add to cart - $1,301" button are on the first tile.

## Findings in the product (most important first)

1. **The finder undercounts a lazy-loading listing by 5×.** "5 products found" (`checkListingPage`: 5 links, no pager). Sample read "Product links found 25 · Pagination detected none detected — single page", and the run walked 25 (`scroll_rounds: [{"rows":25,"round":2,"planned":0}]`).
   - The finder does not scroll; the walk does.
   - The coverage check therefore sampled only "2 more products" (the finder's 5 minus the 3 proof pages).
2. **Sample is labelled "No AI. Free." and recorded $0.1898**, the most of any Sample so far (probe `d86ac3c9`, `partial`). It took **271 s**.
3. **The run recorded $0.0887 with an Extract button that shows no amount.** No other AI work of mine was running; the oliverbonas coverage check was finishing and coverage checks make no AI calls.
4. **Extract planning took 209 s behind the button spinner** (15:17:57 → 15:21:26), longer than the 25-item extraction itself (about 5 min).
5. **Rating and Description are line-level, not product-level.** Every Range configuration carries the same "4.78" (only stars and "(286 Reviews)" are shown) and the same "Range is our take on modern comfort…" description. They are true to the page, but a buyer comparing configurations gets identical values.
6. **Every product URL carries a configuration** (`?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal`). Title, price, SKU and image follow it (the SKU ends `-MGF-BM` for Moss Green Flatweave / Black Metal), and they verified.

## Proof pages

All three are as found: different Range configurations, which are separate products with different prices and SKUs.

1. https://burrow.com/products/range-plus-3-piece-one-arm-sofa-with-table?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Table+Finish=Oak+Legs+and+Table
2. https://burrow.com/products/range-plus-3-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal
3. https://burrow.com/products/range-plus-4-piece-one-arm-sofa-lounger?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal

| Field | What it needed | Verdict |
|---|---|---|
| Title | agreed ("Range 3-Piece One Arm Sofa with Table"…) | verified 3/3 |
| Price | agreed (1301.0 / 1133.0 / 1306.0; shown "$1,301" with "$1,859" struck through) | verified 3/3 |
| Main image | agreed | verified 3/3 |
| SKU | page data, confirmed (FLRST-SFT-RGPL-S3-A1-C0-MGF-LW-OK…) | verified 3/3 |
| Brand | page data "Burrow", confirmed | verified 3/3 |
| In stock | page data, confirmed ("Add to cart"; "Ships in 10-12 weeks") | verified 3/3 |
| Rating | page data 4.78, confirmed (stars only on the page) | verified 3/3 |
| Description | page data, confirmed | verified 3/3 |

Counts: agreed 3, page data confirmed 5, marked 0, typed 0, absent 0.

## Verify

| When (UTC) | Label | Time | Result | AI calls / cost |
|---|---|---|---|---|
| 15:03:23 | "Verify 8 fields · up to $0.40" | 25 s | 8/8 verified 3/3, "Everything is verified" | 0 / $0.0000 |

## Coverage check

15:03:43 → 15:06:06 (2 min 23 s): **"Checked 2 more products from the listing: every field was found on all of them."** No gap, so "Use as proof page" was not offered and there was no second check.

## Sample and Extract

- **Sample**: 15:13:03 → 15:17:33 (271 s). Pages walked 1, Product links found 25, "Pagination detected none detected — single page", "Sample rows complete 3 of 3". The first row was "Shift Sleeper Sofa", 1611. Probe `d86ac3c9-fa44-4fcb-90a7-a6c94ab0dc18`, `partial`, **$0.1898**.
- **Extract**, budget "custom 60 products across custom 2 pages":
  - Run `fb5ee28d-921a-4f73-9f1b-ef4e453e2e17`. Clicked 15:17:57; "Open the run" at 15:21:26 (planning 209 s). Completed 15:26:05, "Duration 8 min".
  - "Done", "25 of 25 extracted", "25 URLs to extract · 1 listing page walked". No "Empty cells" panel. `cost_usd` **$0.0887**.

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 25/25 | 25 |
| Price | 25/25 | 24 |
| Main image | 25/25 | 25 |
| SKU | 25/25 | 25 |
| Brand | 25/25 | 1 ("Burrow") |
| In stock | 25/25 | 2 |
| Rating | 25/25 | 7 |
| Description | 25/25 | 7 |

## Judge

`docs/testing/results/2026-10-12T16-13-judge-run-burrow.md`. It estimated "~$1.50 … ~$1.66 with the 10% retry/explain allowance" and cost **$2.3639** (42% over), in 12 min 50 s. It judged all 25 items.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 25 | 24 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 25 | 23 | 2 | 0 | 0 | 0 | 0 | 92% |
| Main image | 25 | 0 | 0 | 0 | 25 | 0 | 0 | — |
| SKU | 25 | 0 | 0 | 21 | 4 | 0 | 0 | — |
| Brand | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 25 | 16 | 2 | 5 | 2 | 0 | 0 | 89% |
| Rating | 25 | 1 | 20 | 3 | 1 | 0 | 0 | 5% |
| Description | 25 | 12 | 12 | 1 | 0 | 0 | 0 | 50% |

What the wrong verdicts are:

- **Description ×12: real.** The certified path (page data) carries the **previous line's** copy.
  - Range Plus pages store "Range is our take on modern comfort—plush, laid-back seating…", while the page reads "Voted one of Wirecutter's best sofas, Range brings together Scandinavian-inspired design… This upgraded version keeps everything you loved…".
  - Ember Pro pages store "Ember features extra-wide, extra-deep seats…", while the page reads "Ember Pro features extra-wide, extra-deep seats, extra-plush cushions…".
  - All three proof pages were Range Plus and carried the same stale text, so Verify had no way to notice. This is new in this campaign: certified page data that is out of date.
- **Price ×2: real.** Both URLs select a leather fabric (`?Fabric=Camel+-+Top+Grain+Leather`, `Ivory`). The run stored the base price (**1565**, **1690**), while the page shows **$2,801** and **$2,196** (from $3,379). The price path reads the first variant, not the one in the URL, the same shape as ruggable's sizes.
- **In stock ×2: probably real.** Range Pro 109 was stored `false` while "Georgia Clay" shows as in stock and ready to ship. Field 2-Piece was stored `false` while "Out of stock" applies only to the Ottoman upgrade option.
- **Rating ×20: the judge.** "The page shows a 5-star rating (286 Reviews), not 4.78." Burrow shows stars only, so a decimal can't be confirmed from the screenshot.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify | $0.0000 |
| Sample probe | $0.1898 (recorded; labelled free) |
| Extract run | $0.0887 |
| Judge | $2.3639 |

## Screenshots

`burrow-02-table-before`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-12-sample`, `-12b-sample-reload`, `-13-extract-before`, `-15-run`.
