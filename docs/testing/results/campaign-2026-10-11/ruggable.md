# ruggable.com — campaign 2, 2026-10-12 (phase 2, batch B, site 9)

**Status: BLOCKED at Verify, 7/8.** Price fails 0/3 on the size the URL selects. The verifier calls the shown price "ambiguous" and finds another size's price on product 2. Rating verified only after I gave the page data's unrounded decimals instead of the shown "4.8". Three Verifies cost **$0.5598**. Extract stays locked ("Unlocks when every field is verified"), so there was no Sample, no Extract and no judge.

- Website `ruggable` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved: https://ruggable.com/collections/shop-all
- US storefront ($).
- Every product URL from the listing carries `?size=6x9&system=rug-cvr`, and the page shows the 6'x9' price for that size.

## Findings in the product (most important first)

1. **The price of the selected size cannot be verified.** I typed the shown 6'x9' prices: $499.00, $449.25 (sale, from $599.00) and $424.15 (sale, from $499.00).
   - The page data's suggestion was the **2'x3'** price (119.00 / 104.25 / 101.15), the first variant, not the one in the URL.
   - Stored reasons: products 1 and 3 `ambiguous`, with near misses `499.00`, `$499.00`, `169.00` and `424.15`, `143.65`. Product 2 `different_value`, found **1161.75**, another size's sale price.
   - The row read **"Several places match. Add what makes yours different to the description."**
   - I rewrote the descriptor to "The price the customer pays now for the selected size: the sale price right under the product heading (not the struck-through original price, not other sizes)". The re-Verify gave exactly the same reasons; the description changed nothing.
2. **The shown rating is "Not found on this page".** Each product heading is followed by a screen-reader span, "Rated 4.8 out of 5 stars, 318 Reviews" (4.7 / 547 and 4.7 / 1065 on the others). I typed 4.8 / 4.7 / 4.7.
   - The row read **"Not found on this page. Check the value, or say where it is."** Stored: `not_found`, with near misses `4.7610064`, `4.669104` and `4.662911`.
   - The verifier compares a rounded on-page figure with the unrounded page data and never matches them.
   - A descriptor quoting the sentence did not help either. Only typing the raw decimals certified it (`response.bottomline.average_score` from the reviews API, plus JSON-LD `aggregateRating.ratingValue`).
   - So extracted ratings would be "4.7610064", not what a shopper reads.
3. **The re-Verify label understates the cost again.**
   - "Re-verify 2 fields · up to $0.10" cost **$0.2235**, and the next "Re-verify 2 fields · up to $0.10" cost $0.1131.
   - The first "Verify 8 fields · up to $0.40" cost $0.2232 (2 AI calls).
   - The selected-cell bar says only "fails on this product". The reason sentence appears only in the expanded row.
4. **The product column is off the screenshot.** The h1, price and rating sit at x≈2068 in a capture whose tiles are 1280 px wide (the same as ridge.md finding 1). Nothing could be marked, so every value that needed me was typed.
5. **Suggested titles are the `<title>` tag:** "Sierra Ivory & Opal Rug | Ruggable". The h1 reads "Sierra Persian Tufted Rug".
6. **The suggested SKU is the 2'x3' variant's:** `RUG-CVR-IND-RCT-TMP-FO026-02x03` for a URL selecting 6x9. I typed the 6x9 SKUs found in the captured HTML (…`-06x09`). They verified 3/3.
7. **Rating "0" is suggested for a product with no reviews** (Ryder Plush Rug). I replaced that product, because "Not on this product" on products 1–3 fails silently with HTTP 412 (batch A, skims).
8. **The finder counts colour-swatch links as products.** "64 products found": every other entry is a "+3", "+2" or "+5" swatch link to a colourway (`/products/sierra-soft-black-tufted-rug`). The second product as found was the first one's colourway.
9. **Card and selected-cell titles carry listing-card junk:** "BEST SELLERHeart iconSierra Ivory & Opal Rug$119 - $1399".

## Proof pages

1. https://ruggable.com/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug-cvr (kept)
2. https://ruggable.com/products/morris-and-co-pimpernel-jade-tufted-rug?size=6x9&system=rug-cvr (replaced `sierra-soft-black-tufted-rug`, a colourway of 1)
3. https://ruggable.com/products/cyrus-rose-gold-tufted-rug?size=6x9&system=rug-cvr (replaced `ryder-soft-white-plush-rug`: no reviews, Rating would need "Not on this product" on product 3)

| Field | What it needed | Verdict (final) |
|---|---|---|
| Title | **typed** the h1: "Sierra Persian Tufted Rug", "Morris & Co. Pimpernel Tufted Rug", "Cyrus Tufted Rug" | verified 3/3 |
| Price | **typed** 499.00 / 449.25 / 424.15 (the 6'x9' price shown); descriptor rewritten once | **fails on products 1, 2 and 3 0/3** |
| Main image | page data, confirmed (file names match each rug) | verified 3/3 |
| SKU | **typed** the 6x9 SKU from the captured HTML | verified 3/3 |
| Brand | page data "Ruggable", confirmed | verified 3/3 |
| In stock | page data, confirmed | verified 3/3 |
| Rating | **typed** 4.8 / 4.7 / 4.7 (fails), then the page data's 4.7610064 / 4.669104 / 4.662911 | verified 3/3 |
| Description | page data confirmed on 2–3; product 1's suggestion (no page-data hint) accepted, identical to the visible paragraph | verified 3/3 |

Counts: agreed 0, page data confirmed 4, marked 0, typed 4, absent 0.

## Verify

| When (UTC) | Label | Time | Result | AI calls / cost |
|---|---|---|---|---|
| 13:53:17 | "Verify 8 fields · up to $0.40" | 35 s | 6/8: Price and Rating "fails on products 1, 2 and 3 0/3" | 2 / $0.2232 |
| 14:06:28 | "Re-verify 2 fields · up to $0.10" (descriptors rewritten) | ~20 s | the same 6/8, the same reasons | 2 / **$0.2235** |
| 14:07:24 | "Re-verify 2 fields · up to $0.10" (Rating = page-data decimals) | 15 s | 7/8: Price still 0/3 | 1 / $0.1131 |

No coverage check ran, because Verify never passed.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify ×3 | $0.5598 |

## Screenshots

`ruggable-00-cards-as-found`, `-01-cards`, `-02-table-before`, `-03-before-verify`, `-04-after-verify`, `-05-price-fail`, `-05-rating-fail`, `-06-price-expanded` ("Several places match…"), `-07-descriptors`, `-08-after-verify`, `-09-final`.
