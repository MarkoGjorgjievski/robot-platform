# kith.com — campaign 2, 2026-10-12 (phase 2, batch B, site 10)

**Status: BLOCKED before Verify, $0.** Kith shows no ratings on any product. The project's Rating field can only be answered "Not on this product", and the Verify button then stays disabled under **"Rating needs a value on at least two products"**. No Verify, Sample, Extract or judge was possible.

- Website `kith` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved: https://kith.com/collections/kith-women-sweatshirts (14 products, no pager).
- The api-server's browser gets the **Malaysia** storefront: "RM810.00 MYR". A plain Chromium from this machine gets USD 175 in JSON-LD.

## Findings in the product (most important first)

1. **A project field that a website does not have blocks the website forever.** I answered Rating "Not on this product" on all three products, which is the truth for Kith. Verify then went disabled with "Rating needs a value on at least two products".
   - There is no way to say "this website has no ratings". The field is project-level, so it can't be dropped for one website without dropping it for every website.
   - This is the dead end batch A hit on glossier's SKU. It is not specific to a field: any project field that one shop lacks blocks that shop.
2. **The page data's stock state is the first variant's.**
   - JSON-LD `offers[0]` is size XXS, `"availability": "https://schema.org/OutOfStock"`. XS and the larger sizes are `InStock`, and the page shows XS–XXL as selectable size labels under "Select A Size".
   - The table offered **"Out of stock"** on all three products, marked "agreed".
   - I typed "In stock". Accepting the agreed value would have certified a wrong value. This is gymshark's Pumper Pants error, found before Verify this time.
3. **Every capture opens the size-guide drawer** ("CM | INCHES", the measurement table and the garment diagram). It covers the buy box and dims the gallery (`c2b-shots/kith-p1-t0.png`).
   - The title, price and "Select A Size" sit under the drawer. The drawer's own heading ("Kith Women Toyo Zip Hoodie - Chelonian") is the only title visible.
   - This is the same kind of left-open overlay as colourpop's zoom lightbox and mejuri's Material Guide.
4. **Brand is suggested as "Kith Women"** (JSON-LD `brand.name`). The shop is Kith (`og:site_name` "Kith"). I typed "Kith"; this was never verified, because Verify was disabled.
5. **The finder's first two products were colourways of one hoodie** (`khwa030083-338` Chelonian, `khwa030083-001` Black). Every second entry is a "View Product:…" duplicate card of the same style in another colour.

## Proof pages

1. https://kith.com/collections/kith-women-sweatshirts/products/khwa030083-338 (Toyo Zip Hoodie - Chelonian, kept)
2. https://kith.com/collections/kith-women-sweatshirts/products/khwa030103-2017 (Tye Pinstripe Zip Hoodie - Quilt; replaced `khwa030083-001`, the black colourway of 1)
3. https://kith.com/collections/kith-women-sweatshirts/products/khwa030086-001 (Elvina Paneled Hoodie - Black, kept)

| Field | What it needed |
|---|---|
| Title | agreed ("Kith Women Toyo Zip Hoodie - Chelonian"…), accepted. The h1 reads "Kith Women Toyo Zip Hoodie" (without the colour) |
| Price | agreed 810 / 975 / 810 (RM…MYR), accepted |
| Main image | agreed, accepted |
| SKU | page data, confirmed (2000369947… the XS variant's) |
| Brand | **typed** "Kith" |
| In stock | **typed** "In stock" (the agreed suggestion was "Out of stock") |
| Rating | **absent** ×3, which blocks Verify |
| Description | page data, confirmed (the bullet list shown under "Description") |

Counts: agreed 3, page data confirmed 2, marked 0, typed 2, absent 1 field ×3.

## Spend for this website

$0.00.

## Screenshots

`kith-00-cards-as-found`, `-01-cards`, `-02-table-before`, `-03-before-verify`, `-04-verify-disabled` ("Rating needs a value on at least two products"), `-05-rating-row`.
