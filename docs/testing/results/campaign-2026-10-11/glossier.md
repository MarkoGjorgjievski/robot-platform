# glossier.com — campaign 2, 2026-10-12 (phase 2, batch A, site 4)

**Status: STOPPED at Verify, 6/8.** SKU is not on the page, and a Main image marked on the screenshot does not verify. Extract is locked. Spend: **$0.2399** (2 AI calls).

## Findings in the product (most important first)

1. **A Main image marked on the screenshot fails Verify with "Not found on this page. Check the value, or say where it is."** The customer already said where it is.
   - The marked value is malformed, with its query string doubled: `https://glossier-prod.imgix.net/files/glossier-mjc-177-02.png?auto=compress,format&cs=srgb&w=916?auto=compress,format&cs=srgb` (the same on all three products).
   - The verifier's near misses are `https://www.glossier.com/cdn/shop/files/glossier-mjc-carousel-04_….png?v=…`.
   - The AI was asked and failed too.
2. **Every product's capture fails on a non-www listing, and the www pages are refused.** The pre-screen saved `https://glossier.com/collections/skincare`; its products are `https://glossier.com/products/…`.
   - Each card read **"redirected to https://www.glossier.com/products/milky-jelly-cleanser?variant=44415832752373"** with "Try again".
   - Pasting the www address into the card was refused: **"This product is not on the same website as the listing"**.
   - The way out was to drop all three cards, change the listing to `https://www.glossier.com/collections/skincare` and Find products again (17 found, 28 s).
3. **"Agreed" was wrong on Price for 2 of 3 products.** It suggested 5 / 35 / 10, but the screenshots read "Add to bag $24" (177 mL selected) / "$35" / "$34".
   - 5 and 10 are the mini variants' prices: Shopify's `.js` lists MJC 177 mL $24, 60 mL $14, … , **$5**, and AFB **$10**.
   - Anyone using "Accept all agreed" would have certified the wrong prices.
4. **Other suggestions were plainly wrong:**
   - Main image ×3: the store's placeholder `…/no-image-2048-a2addb12_348x.gif`.
   - SKU ×3: **"200"**.
   - The real SKUs (`MJC-000-00-00`, `PMR-000-00-00`, `AFB-000-00-00`) exist only in Shopify's product JSON, not on the page or in its JSON-LD.
5. **A field that is not on any product blocks Verify for good.** "Not on this product" on SKU ×3 left the button disabled with **"SKU needs a value on at least two products"**.
   - SKU is a project-level field, so the customer cannot drop it for this one website.
   - Typing the real SKUs then failed 0/3 (`not_found`, AI asked).
6. Marked prices are stored inconsistently: "$24" and "$34" keep the currency sign, while the carried value on product 2 is "35".
7. The page's star rating has hidden text that disagrees with the visible summary on product 2: "3.9619398 star rating" in the header and "4.0" in the reviews block. Product 1's header shows (4657) reviews while the block's hidden text says "8 reviews".
8. Popup dismissal leaves a "Subscribe + save" tooltip open over the size picker on products 1 and 3.

## Proof pages

1. https://www.glossier.com/products/milky-jelly-cleanser?variant=44415832752373
2. https://www.glossier.com/products/priming-moisturizer-rich?variant=43781983076597. This replaced "The Skincare Icons", a set, which was the 2nd listing product.
3. https://www.glossier.com/products/glossier-after-baume?variant=44416231604469

| Field | What it needed | Verdict |
|---|---|---|
| Title | agreed → Accept | verified 3/3 |
| Price | **marked** "$24" / "$35" / "$34" (the suggestion was wrong, finding 3) | verified 3/3 |
| Main image | **marked** the first gallery image ×3 (the suggestion was a placeholder gif) | **fails on products 1, 2 and 3 0/3** (finding 1) |
| SKU | "Not on this product" ×3, which blocked Verify; then **typed** from Shopify JSON | **fails on products 1, 2 and 3 0/3** |
| Brand | page data "Glossier", confirmed | verified 3/3 |
| In stock | agreed | verified 3/3 |
| Rating | **marked** the reviews summary 4.2 / 4.0 / 4.3 | verified 3/3 |
| Description | **marked** the visible paragraph ×3 (the page data was the meta description) | verified 3/3 |

Counts: agreed 2, page data confirmed 1, marked 4, typed 1, absent 0 (the 3 SKU absents were withdrawn).

## Verify

- 10:25:51, "Verify 8 fields · up to $0.40", 25 s.
- Result: 6/8. Main image and SKU "fails on products 1, 2 and 3".
- `source_verifications`: ai_calls 2, **$0.2399**.
- I did not re-verify: SKU cannot pass whatever is done to Main image.

## Not done

- **Coverage:** none.
- **Sample / Extract:** locked.
- **Judge:** none.

## Screenshots

- `glossier-00-cards-as-found` (the redirect cards), `-01-cards` (the "not on the same website" refusal, then the www cards).
- `-02-table-before`, `-03-price-check`, `-04-before-verify`.
- `-05-after-verify`: 6/8.
- `-06-image-fail`.
- Marks: `glossier-mark-Price-1…3`, `-Mainimage-1…3`, `-Rating-1…3`, `-Description-1…3`.
