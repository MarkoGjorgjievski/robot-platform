# bombas.com — campaign 2, 2026-10-12 (phase 2, batch A, site 2)

**Status: STOPPED at Verify, 7/8.** Rating cannot be verified because the capture never contains the reviews. Extract stays locked ("Unlocks when every field is verified"). Spend: $0.0617 (one AI call during Verify).

- Website `bombas`. The listing is the one the pre-screen saved: https://bombas.com/collections/mens-socks
- The api-server's browser gets the **Malaysia** storefront: "MYR 72", and a "Malaysia" switch in the header.

## Findings in the product (most important first)

1. **The proof-page capture misses the lazy-loaded reviews, so Rating can never be verified.** The live page (my own browser, after scrolling) reads "Overall rating: 4.7658916 / 5 from 68306 reviews." (4.695361 / 18517 and 4.56312 / 3731 on the other two products). The capture ends at the donation band and the footer, with no reviews block (`bombas-p1` tile 2 is 149 bytes, blank).
   - Rating had no suggestion ("missing on product 1"). I typed the page's values; Verify then read **"fails on products 1, 2 and 3 0/3"**, each cell `not_found`. The AI was asked once ($0.0617) and found nothing.
   - The row tells the customer **"Not found on this page. Check the value, or say where it is."**, but there is nothing on the screenshot to point at.
   - The only way past it is to answer "Not on this product", which is false. Rating is on every product.
2. **"111 products found" were collection links, not products.** The pre-screen's three cards were https://bombas.com/collections/new-releases, /collections/womens-performance-socks and /collections/mens-ankle-socks.
   - Their suggestions read "New Releases in Socks, Underwear and T-Shirts", "Product Breadcrumbs" and "Product Breadcrumbs", with the Bombas logo as Main image.
   - The `checkListingPage` list starts with nav and promo links ("20% Off First Order with Code COMFORT20 Free Standard Shipping on Orders $75+", "Shop All", "AnkleComfy coverage that protects ankles.AnkleComfy coverage…"). The same page has **29** `/products/` links in a plain browser.
3. **SKU colour codes don't match the selected colour.** The page data gave `A-E-A-101A01-MABL-01P-ALPIN-L` for `?variant=slate-sea` and `…-VNTGR-L-R` for `?variant=rouge`. These are probably the default variant's SKU. I accepted them as the site's own data; the screen gives no way to check.
4. Description page data contains HTML entities: "Merino Wool is a super strong natural fiber that&#39;s incredibly soft … And that&#39;s just the fabric". It also has a doubled period: "as our regular dress socks..One purchased = one donated."
5. For `?variant=slate-sea`, the selected-cell bar names the product "Men's Bombas Marl Cotton Blend Ankle Socks - **Sage Brush**", the page `<title>` of another colourway.

## Proof pages (all three replaced; finding 2)

1. https://bombas.com/products/mens-classic-marls-ankle?variant=slate-sea
2. https://bombas.com/products/mens-merino-wool-socks?variant=rouge
3. https://bombas.com/products/mens-dress-calf-sock?variant=navy-dot

All three captures were `ready` in about 20 s. A "Get 20% Off" chip and the chat bubble stay on the screenshot.

| Field | What it needed | Verdict |
|---|---|---|
| Title | agreed → Accept ("Men's Marl Ankle Socks" / "Men's Merino Wool Blend Calf Socks" / "Men's Dress Calf Socks") | verified 3/3 |
| Price | agreed (72.0 / 115.0 / 92.0, "MYR 72" etc. on the screenshots) | verified 3/3 |
| Main image | page data, confirmed (slate_sea / rouge / navy_dot in the file names) | verified 3/3 |
| SKU | page data, confirmed (finding 3) | verified 3/3 |
| Brand | page data "Bombas", confirmed | verified 3/3 |
| In stock | agreed | verified 3/3 |
| Rating | **typed** 4.7658916 / 4.695361 / 4.56312 (finding 1) | **fails on products 1, 2 and 3 0/3** |
| Description | page data, confirmed (finding 4) | verified 3/3 |

Counts: agreed 3, page data confirmed 4, marked 0, typed 1, absent 0.

## Verify

- 09:59:23, "Verify 8 fields · up to $0.40", 20 s.
- Result: 7/8. Rating failed: "Not found on this page. Check the value, or say where it is." (`bombas-05-rating-fail.png`).
- `source_verifications`: ai_calls 1, **$0.0617**.
- I did not re-verify: there is no other honest answer to give.

## Not done

- **Coverage:** none, because the verification did not pass.
- **Sample / Extract:** locked.
- **Judge:** no run to judge.

## Screenshots

- `bombas-01-cards`: the cards after replacement.
- `-02-table-before`, `-03-before-verify`.
- `-04-after-verify`: Rating fails.
- `-05-rating-fail`: the expanded row with its sentence.
