# ridge.com — campaign 2, 2026-10-12 (phase 2, batch B, site 8)

**Status: DONE.** Verified 8/8, first on 3 proof pages and then on 4. The AI cost $0.1150, all of it on a coverage proof page whose description could not be certified. Extract returned 60 of 60 (2 listing pages) for $0.00. The judge hit its $5 cap after 33 of 60 items ($5.0250) and could judge almost nothing, because it sees the same off-screen layout (finding 1).

- Website `ridge` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved: https://ridge.com/collections/wallets
- The api-server's browser gets the **US** storefront ($ prices).
- A plain Playwright Chromium gets **"Sorry, you have been blocked"** (Cloudflare, HTTP 403) on every Ridge product page. Only the app's stealth capture gets through, so every check below was made on the app's own captures (boxes and tiles).

## Findings in the product (most important first)

1. **The screenshot never shows the product.** Ridge lays its page out about 4,000 px wide inside the capture:
   - The header's "USA" sits at x=3935.
   - The h1 "Ridge Wallet" and the price ("$95" struck through, "$76") sit at x≈2600–2970.
   - The visible description paragraph sits at x=1350.

   Every screenshot tile is 1280 px wide (`ridge-p1-t0.png`: an empty cream page with the gallery's left edge at the right margin).
   - Title, price, rating summary and description cannot be marked. I typed every value that needed me.
   - The proof-page thumbnail on product 4 is a blank page with a tiny wallet in the corner (`ridge-10-description-fail.png`, right).
   - The judge's captures have the same window: it read title and price as "not on page" (see Judge).
   - This is the shape batch A met on mejuri (title at x=3474).
2. **A typed visible description fails with no reason on screen.** Coverage product 4 (American Traditional) has no `description` in its JSON-LD. Its page shows "The wallet, perfected. Slim, RFID-blocking, and built to hold up to 12 cards without the bulk. Backed by our Built for Life Warranty.", a single `<p>`, verbatim in the capture's boxes.
   - I typed exactly that. "Re-verify 8 fields · up to $0.40" cost **$0.1150** (1 AI call).
   - The result was **"fails on product 4 3/4"**, and the selected-cell bar read only "fails on this product". It gave no "not found" sentence and no hint.
   - Stored reason: `not_found`, `certified: []`. The same `<p>` holds different text on products 1–3 (generic "The wallet, perfected: Ridge Wallet 2.0…"), so no path can serve both the JSON-LD description on 1–3 and the paragraph on 4. Saying `not_found` for a value that is on the page is misleading.
   - I answered "Not on this product" instead. "Re-verify 1 field · up to $0.05" cost $0.00 and gave 8/8 4/4.
3. **Suggestions take the site name and a review score for product facts.**
   - Title was suggested as **"Ridge"** on all four products ("only in the page data"); the heading reads "Ridge Wallet" / "Ridge Wallet For MagSafe".
   - Rating was suggested as **"5"** on all four ("same on every product — check it"); the pages read 4.8, 4.8, 4.5 and 4.8.
   - Both still came back as the suggestion on product 4 *after* Title and Rating had been certified on other paths.
4. **The finder lists colourways first.** The 3 products as found were the Aluminum wallet in black, navy and OD green: `/products/aluminum-black`, `-navy`, `-od-green`. The card titles all read "View product - Ridge Wallet".
5. **Sample is labelled "No AI. Free." and recorded $0.0995.** Probe run `9a589b04`, status `partial`, with no other worker on the server.
   - The panel read "Rows extracted 0" until a reload. After the reload it read "Sample rows complete 3 of 3".
   - While it ran it read "Sampling · 0 of 30 rows extracted" for a 3-product sample.
6. **The second coverage check offers "Use as proof page" again for the shape already answered.** Description on product 4 is "Not on this product". The re-check read "Empty on 4 of 20 sampled products · Use as proof page", without the "· already a proof page" clause the first check carried. (This is gymshark's finding 7.)
7. **The Description row's status read "same on every product — check it"** while its page-data hint showed three different descriptions.
8. **Extract planning took 139 s behind the button spinner** before "Open the run" appeared.

## Proof pages

Products 2 and 3 as found were colourways of product 1. I replaced them with the Carbon Fiber wallet and a MagSafe wallet, which are different lines at different prices. Product 4 was added by the coverage line.

1. https://ridge.com/products/aluminum-black (kept)
2. https://ridge.com/products/carbon-fiber (replaced `aluminum-navy`)
3. https://ridge.com/products/magsafe-wallet-neon-tiger (replaced `aluminum-od-green`)
4. https://ridge.com/products/american-traditional?variant=43765981675594 (added by "Use a sampled product as proof page for Description")

| Field | What it needed | Certified path | Verdict (final) |
|---|---|---|---|
| Title | **typed** the h1: "Ridge Wallet", "Ridge Wallet", "Ridge Wallet For MagSafe", "Ridge Wallet" (the suggestion was "Ridge") | xpath to the product-header h1 | verified 4/4 |
| Price | agreed (76.00 / 150.00 / 125.00; 76.00) | JSON-LD `hasVariant[0].offers.price` | verified 4/4 |
| Main image | agreed (the file names match the colourway) | | verified 4/4 |
| SKU | page data, confirmed (A0449 / A0456 / A1059; A1243) | JSON-LD `hasVariant[0].sku` | verified 4/4 |
| Brand | **typed** "Ridge" (page data offered "The Ridge Wallet") | Shopify API `products[0].vendor` (weak evidence) | verified 4/4 |
| In stock | agreed | | verified 4/4 |
| Rating | **typed** 4.8 / 4.8 / 4.5 / 4.8 (the suggestion was 5) | xpath to the Okendo `oke-w-ratingAverageModule-rating-average` span | verified 4/4 |
| Description | page data, confirmed on 1–3. On 4: typed the visible paragraph (fails), then **absent** | JSON-LD `description` | verified 4/4 |

Counts on the first three: agreed 3, page data confirmed 2, marked 0 (nothing in the product column is on the screenshot), typed 3, absent 0. Product 4: typed 4, absent 1 (Description).

## Verify

| When (UTC) | Label | Time | Result | AI calls / cost |
|---|---|---|---|---|
| 12:31:56 | "Verify 8 fields · up to $0.40" | 36 s | 8/8 verified 3/3, "Everything is verified" | 0 / $0.0000 |
| 12:43:01 | "Re-verify 8 fields · up to $0.40" (4 proof pages) | 20 s | 7/8: Description "fails on product 4 3/4" | 1 / $0.1150 |
| 12:44:28 | "Re-verify 1 field · up to $0.05" | 5 s | 8/8 verified 4/4 | 0 / $0.0000 |

## Coverage check

- **First** (stage line 12:33:52 → settled 12:40:29, 6 min 37 s after the line appeared):
  - "1 field was empty on some of the 20 sampled products — see the row."
  - `description`: "Empty on 5 of 20 sampled products" + "Use as proof page".
  - The empty five were american-traditional and four titanium-summit/terrain variants.
- "Use a sampled product as proof page for Description": the 4th card was ready in 21 s. The row then read "Empty on 5 of 20 sampled products · already a proof page".
- **Second** (12:45:38 → 12:51:39, 6 min 1 s):
  - `description`: "Empty on 4 of 20 sampled products" + "Use as proof page" (finding 6).

## Sample and Extract

- **Sample** ("walks the first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free."):
  - 12:51:52 → 12:53:58 (125 s): Pages walked 1, Product links found 30, 3 of 3 after a reload.
  - Probe `9a589b04-92c4-497b-95d9-0c32f9eae082`, status `partial`, **$0.0995**.
- **Extract**, budget "custom 60 products across custom 2 pages": "1 listing · first 60 products from each · first 2 pages of each · safety stop at 5,000 products per listing". The button reads only "Extract".
  - Run `fcb52e70-119c-46e5-a504-3f75e2878712`. Clicked 12:54:31; "Open the run" at 12:56:50 (planning 139 s). Completed 13:15:23, "Duration 21 min".
  - "Done", "60 of 60 extracted", "60 URLs to extract · 2 listing pages walked". `cost_usd` **$0.0000**.
  - Empty cells: "Description is empty on 7 of 60 products · all from /collections/wallets" + "Repair all gaps…".

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 60/60 | 4 ("Ridge Wallet" ×52, "Ridge Wallet For MagSafe" ×4, "…For Magsafe" ×3, "Daily Driver Set" ×1) |
| Price | 60/60 | 10 |
| Main image | 60/60 | 60 |
| SKU | 60/60 | 60 |
| Brand | 60/60 | 1 ("Ridge") |
| In stock | 60/60 | 1 (true) |
| Rating | 60/60 | 2 (4.8, 4.5) |
| Description | 53/60 | 39 |

The extracted titles are the page heading, and the heading is generic: 52 of 60 rows are "Ridge Wallet", with the finish only in the "Color:" line. That is true to the page, but a customer would want the finish in the name.

## Judge

`docs/testing/results/2026-10-12T13-16-judge-run-ridge.md`. It estimated "~$3.55 … ~$3.91 with the 10% retry/explain allowance; cap $5.00".
- It was **"STOPPED at the $5.00 cap"** after **33 of 60** items, in 31 min 30 s.
- It recorded a cost of **$5.0250**, $0.025 over its own cap.
- Almost every value went to tile 3 before "not on page", which is three judge calls per value: 600 requests for 33 items.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 33 | 0 | 10 | 22 | 0 | 1 | 0 | 0% |
| Price | 33 | 0 | 0 | 33 | 0 | 0 | 0 | — |
| Main image | 33 | 0 | 0 | 0 | 33 | 0 | 0 | — |
| SKU | 33 | 0 | 0 | 33 | 0 | 0 | 0 | — |
| Brand | 33 | 30 | 1 | 0 | 2 | 0 | 0 | 97% |
| In stock | 33 | 0 | 0 | 6 | 27 | 0 | 0 | — |
| Rating | 33 | 2 | 3 | 27 | 1 | 0 | 0 | 40% |
| Description | 28 | 3 | 3 | 22 | 0 | 0 | 5 | 50% |

What the wrong verdicts are:

- **Title ×10**
  - Seven are the judge saying the title isn't there: "No title is visible on the page."; "The page does not show a clear "Ridge Wallet" title; the only visible headings are "FEATURES" and…". The heading is off the screenshot (finding 1), and the judge counts "not visible" as wrong.
  - Two MagSafe pages read **"The page shows the title "Daily Driver Kit for MagSafe""** against the stored "Ridge Wallet For Magsafe". This may be an upsell block's heading in the visible part, or a real mismatch. The capture cannot show which.
  - The tenth is dark-harbor: "Ridge Wallet" read against the stored "Ridge Wallet For MagSafe". That is probably another product's heading in view.
- **Rating ×3**: the judge's vocabulary. "The page shows a 5-star rating (★★★★★) with 52,759 reviews, not 4.5." The 4.8/4.5 averages sit in the review block's header, which is off-screen. The stars it reads are a different widget.
- **Description ×3**: "No description is visible on the page". The text is cut off.
- **Brand ×1**: "The page shows no value for "Brand" visible in the screenshot."
- **Not a single price, SKU or rating could be seen** on 33 pages. The judge is no evidence for or against this run's correctness. What it does show is that the capture window hides the product column.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify ×3 | $0.1150 |
| Sample probe | $0.0995 (recorded; labelled free) |
| Extract run | $0.0000 |
| Judge | $5.0250 (cap $5.00; stopped at 33/60) |

## Screenshots

`ridge-01-cards`, `-02-table-before`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-07-before-use-as-proof`, `-08-fourth-card`, `-09-after-verify` (Description fails on 4), `-10-description-fail`, `-11-after-verify` (4/4), `-11-coverage` (second check), `-12-sample` (0 rows shown), `-12b-sample-reload`, `-13-extract-before`, `-15-run`.
