# thomann.de — campaign 2, 2026-10-13 (phase 2, batch C, site 30)

**Status: STOPPED at Verify, 6/8.** Brand and In stock fail with "We can't tell which value on this page is Brand — mark it on the screenshot." On all three captures the place to mark sits under an overlay the capture itself opened: a YouTube review video on products 1 and 3, the "Sicherheits- und Warnhinweise" drawer on product 2. Verify cost $0.00. Nothing was extracted or judged.

## The listing

- **The pre-screen's listing gave category tiles, not products.** `https://www.thomann.de/de/gitarren_baesse.html` gave "6 products found", and the six were sub-categories (Konzertgitarren, Westerngitarren, …).
  - Those three cards had sat at **"taking screenshot…"** since the pre-screen, the day before.
- **Every category page I tried gives the finder a handful of links:**
  - `/de/konzertgitarren.html`: 8, all categories.
  - `/de/alle-produkte-der-kategorie-konzertgitarren.html`: 8, all categories.
  - `/de/topseller_GF_konzertgitarren.html`: 3.
  - `/de/search_dir.html?sw=konzertgitarre`: 4.
  - `/de/4-4_konzertgitarren.html`: 3 Taylor guitars.
- **The products are there.** My own browser counts 100 product links (`…htm?type=category`) on `/de/4-4_konzertgitarren.html` after scrolling 10 screens, and about 12 before scrolling. The finder sees only the 3 in a "top" strip.
- I used `/de/4-4_konzertgitarren.html` ("3 products found", no pager). The Extract walk might have found more, as on burrow and lacoste, but the site never reached Extract.

## Findings in the product (most important first)

1. **Popup dismissal opens overlays instead of closing them.** I read the first tile of each capture:
   - Product 1 (Taylor 814ce-N): a "Review of Taylor 814-CEN Guitar" YouTube modal covers the title, stars, price and stock.
   - Product 2 (Taylor 112ce-N): the "Sicherheits- und Warnhinweise" side drawer covers the price column. The heading, stars and brand logo stay visible under a dark scrim.
   - Product 3 (Taylor 314ce-N): a YouTube modal reading "Video unavailable".
   - These are the same shape as kith's size guide, mejuri's Material Guide and colourpop's zoom lightbox: something on the page is clicked open before the screenshot.
2. **The fix the Verify asks for is not possible.** "We can't tell which value on this page is Brand — mark it on the screenshot." and the same for In stock. The DOM boxes exist under the overlays: the breadcrumb "Taylor" at (648,154) and "Sofort lieferbar" at (879,374/332). A customer looking at the screenshot sees a video player there, so I did not mark blind. No AI call was made ($0.00) although the label read "up to $0.40", as gymshark's Brand in batch A.
3. **Thomann puts almost nothing in page data.** Price, SKU, Brand, In stock and Rating were all "missing on product 1"; only Title, Main image (an og:image thumb) and Description were suggested. I typed the visible values:
   - Price 3498 / 835 / 2399.
   - SKU = "Artikelnummer" 493927 / 606421 / 396814.
   - Brand "Taylor".
   - In stock "In stock" ("Sofort lieferbar").
   - Rating 4.0 / 5.0 / 4.9.

   Price, SKU and Rating verified mechanically. Rating is read from a 1×1 hidden text, "4.0 von 5 Sternen aus 5 Kundenbewertungen".
4. **The finder misses lazy product grids** (see the listing above). Category tiles count as products: "6 products found" for six sub-categories.

No `not the page's heading on product n` reason appeared. No typed value read `not on this page`; every typed value is printed on its page.

## Proof pages

1. https://www.thomann.de/de/taylor_814ce_n.htm?type=category
2. https://www.thomann.de/de/taylor_112ce_n.htm?type=category
3. https://www.thomann.de/de/taylor_314ce_n.htm?type=category

| Field | What it needed | Verdict |
|---|---|---|
| Title | agreed ("Taylor 814ce-N" …) | verified 3/3 |
| Price | typed 3498 / 835 / 2399 | verified 3/3 |
| Main image | page data, confirmed ×3 | verified 3/3 |
| SKU | typed (Artikelnummer) | verified 3/3 |
| Brand | typed "Taylor" ×3 | **fails on products 1, 2 and 3 0/3**: "We can't tell which value on this page is Brand — mark it on the screenshot." |
| In stock | typed "In stock" ×3 | **fails on products 1, 2 and 3 0/3**: "We can't tell which value on this page is In stock — mark it on the screenshot." |
| Rating | typed 4.0 / 5.0 / 4.9 | verified 3/3 |
| Description | page data, confirmed ×3 | verified 3/3 |

Counts: agreed 1 · page data confirmed 6 · marked 0 · typed 15 (5 fields × 3) · absent 0.

## Verify

| When (UTC) | Label | Time | Result | Cost |
|---|---|---|---|---|
| 10:20:05 | "Verify 8 fields · up to $0.40" | 10 s | 6/8; Brand and In stock 0/3 | $0.0000 |

- Coverage: none, because the Verify did not pass. Extract is locked: "Unlocks when every field is verified".

## Spend for this website

$0.00.

## Screenshots

`thomann-00-as-found` (the pre-screen cards stuck at "taking screenshot…"), `-01-cards`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-05-brand-fail`, `-05-stock-fail`.
