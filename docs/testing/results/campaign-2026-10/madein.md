# madeincookware.com — credit campaign 2026-10-08

**Status: DONE.** Screen, proof pages, expected values, Verify and one Extract all completed.

- **Verify:** 8/8 fields verified for $0.00.
- **Extract:** 35/35 rows (the whole listing), every field filled on every row, run cost $0.00, at 14.6 s per item.
- **Prices are in Malaysian ringgit (MYR), not USD.** The store prices by the visitor's location, and this machine is shown MYR (see Screen).

**Website**
- Name `Madeincookware` (the default from the host), source `5cb04b47-53cf-4aac-9d66-d9ac5bf4c2de`.
- Added through the Add website dialog with `https://madeincookware.com`.

**Listing:** https://madeincookware.com/collections/cookware

**Proof pages:** the first three that Find products put on the board, all real `/products/…` pages:
1. https://madeincookware.com/products/le-stainless-sets/10-piece-antique-brass-finish
2. https://madeincookware.com/products/stainless-clad-frying-pan-set/2-piece-stainless-handle
3. https://madeincookware.com/products/small-spaces-set/5-piece-stainless

## Screen (free)

- "35 products found", all on `/products/…` paths. The old finder's `/collections/…` menu-page defect did **not** show up here, so I did not need "Paste product pages instead".
- All three captures read `ready` within 43 s of the click. There was no bot wall and no consent wall.
- **The site serves MYR to this machine** ("MY" locale switch, "Free Express Air Shipping on Orders over 1,500 RM"). It does this both in the app's capture and in a plain Playwright browser. The dispatch asked for USD as the page shows it, but no USD price is shown, so Price holds the MYR amounts the page shows.

## Per-field table

| Field | What it needed | Certified paths | Verdict | Extract hit rate |
|---|---|---|---|---|
| Title | **marked** on all 3 (the suggestion "Made In Cookware" is the site name) | json-ld `@graph[2].name` + 3 h1 xpaths | verified 3/3 | 35/35 |
| Price | agreed | json-ld `@graph[2].offers[0].price` + 4 xpaths (Add to Cart price, price span) | verified 3/3 | 35/35 |
| Main image | agreed | json-ld `@graph[2].image` | verified 3/3 | 35/35 |
| SKU | **accepted from page data** on all 3 (not shown on the page; see below) | json-ld `@graph[2].sku`, `@graph[2].offers[0].sku` | verified 3/3 | 35/35 |
| Brand | agreed ("Accept anyway": same on every product) | json-ld `@graph[2].brand.name` (weakEvidence) | verified 3/3 | 35/35 |
| Rating | agreed ("Accept anyway") | json-ld `aggregateRating.ratingValue` + the Bazaarvoice inline-rating xpath (weakEvidence) | verified 3/3 | 35/35 |
| In stock | agreed | json-ld `offers[0].availability` (weakEvidence) | verified 3/3 | 35/35 (all true) |
| Description | agreed | json-ld `@graph[2].description` + 3 short-description xpaths | verified 3/3 | 35/35 |

**Counts:** agreed 5, marked 1 (3 cells), typed 0, accepted from page data 1 (SKU, 3 cells), absent 0.

**How each value was checked**

- **Title.** Marked on the h1 of each page: Limited Edition Stainless Sets / Stainless Clad Frying Pan Set / Small Spaces Set.
- **Price.** 4051.41 / 1300.00 / 2050.00 equal the sale prices shown: "MYR4,051.41" / "MYR 1,300" / "MYR 2,050". The struck-through prices were not taken.
- **Main image.** The suggestions are Shopify CDN URLs, while the page renders its pictures from `cdn.sanity.io`. I downloaded both and compared them side by side: the same picture on all 3.
- **Brand.** "Made In": the header logo reads MADE IN (alt "Made In Logo"). Page 3 also says "Why Chefs Choose Made In".
- **Rating.** 4.8 is printed above the title on all 3, with (5,138) / (14,398) / (5,138) reviews.
- **In stock.** Every page has an active "Add to Cart" and no sold-out marker.
- **Description.** It matches the paragraph under the price word for word.
- **SKU (coordinator's ruling).**
  - Not visible anywhere on the pages: not in the capture's text, not in the live page's `innerText`. The values exist only in the page's data (JSON-LD/HTML): `KIT-10-ISS-V2-GOLD`, `KIT-2-FRY-ISS-V2`, `KIT-5-FSS-ISS-R7`.
  - With SKU left `absent`, Verify was blocked ("Accept SKU first"; see finding 1).
  - The coordinator ruled to take them as the real article codes. They were accepted through each cell's "Confirm SKU from the page data" tick in the expanded row, **from page data, not from the visible page**.

## Verify (paid, once)

- Label **"Verify 8 fields · up to $0.40"** (≤ $3). Clicked once at 11:37:06Z.
- Wall time **20.4 s**.
- Result **8/8 verified**, allPassed, 0 AI calls, **actual $0.00** (`source_verifications` id `9c2e2064-75f5-4619-badf-d59d300e18f8`, cost 0.0000).

## Sample (free step before Extract)

- "Sample 3 products" took **70 s**. It walked 1 listing page and found **30 product links** ("Pagination detected: not reported"), then extracted 3 rows.
- Right after the sample the panel read "Sample rows complete **0 of 0**". After a reload it read "3 of 3". This contradiction was already seen on Nike, B&N and Allbirds.
- The probe run `45b1af26…` shows **cost_usd $0.1030**, though the screen says "No AI. Free." The api-server's counter is shared with the other workers running at the time, so this figure is unreliable. It is reported as shown.

## Extract (once)

- Budget set to **custom 35 products across custom 2 pages** (the whole listing). The screen read "1 listing · first 35 products from each · first 2 pages of each · safety stop at 5,000 products per listing".
- Run `755e056c-e5bb-4a9a-8c0a-e070327e7b43`:
  - clicked 11:40:39Z, completed 11:49:12Z, **512 s for 35 items → 14.6 s/item**;
  - 1 listing page walked, "35 URLs to extract";
  - status `completed`, **35 of 35 extracted**;
  - **cost $0.00**.
- Every field was filled on every row (35/35 for all 8). The run page says "35 rows · 100% confidence".
- **Variants come out right.** The 35 URLs include variant pages of the same product (cast-iron skillet 8"/10"/12"/3-piece, frying-pan sets in stainless/brass, two colours of the enamelled set). Each got its own price, SKU and image, so `offers[0]` follows the variant in the URL on this store.
- **Spot check (free, live Playwright).** I checked 7 rows against the live pages: 10-piece Stainless Set, cast-iron 8-inch, cast-iron 3-piece, Curated Kitchen, CeramiClad 5-piece black, frying-pan set stainless, enamelled set ruby red. Title (h1) and price (Add to Cart, MYR) match on all 7: 4,051.41 / 655.84 / 2,050 / 15,241.02 / 2,197.55 / 1,548.22 / 2,447.8.
- Org Usage page after this website: **$0.65** for October. This is all campaign workers combined.

## Findings in the product (not fixed)

1. **A field missing on every proof page blocks Verify for good, and there is no "not on this website" answer.**
   - `verifyGate` in `packages/app/src/lib/site/verification-model.ts` needs an answer for every field on products 1–3. Fields are project-level, so there is no per-website opt-out.
   - Here SKU is not shown on any page. The way through was to accept the page-data value (coordinator's ruling). A customer whose site has no SKU even in its data could never verify.
   - Reordering (the Nike workaround) cannot help when the field is missing on every product.
2. **Title's suggestion was the site name.** "Made In Cookware" on all 3. The "same on every product — check it" warning fired, but accepting it would have certified the site name as the title.
3. **Hidden search-overlay boxes in the box map catch clicks on the product title.** This is the same class as Nike finding 2.
   - The closed search dropdown's "Popular Categories" div (438,270 637×30) and its category tiles sit over the two-line h1. My first mark on products 1 and 2 saved **"Popular Categories"** as the Title.
   - I re-marked at a point on the h1 outside the overlay (x≈1200, y≈255).
4. **The mark popover pre-selected the wrong field.** When I re-marked a Title cell (opened from that cell's Fix), the field picker read **"SKU"**, presumably the first unanswered field, not Title. Clicking Confirm without looking would have put the title into SKU.
5. **Product cards from Find products are titled with the listing tile's whole text**, rating included: "4.8(5138)4.8 out of 5 stars. 5138 reviews Limited Edition Stainless Sets10-Piece · Antique Brass HandlesMYR4,051.41…". The same text appears in the detail bar's heading.
6. **The currency follows the visitor's geo-IP, and Money keeps no currency.** The store prices in MYR for this machine. Price is stored as a bare number (4051.41), so a US customer and our extraction host get different, unlabelled numbers.
7. **Sample's walk found 30 links, then the Extract walk found 35 on the same page,** and Find products said 35. Only 1 page was walked both times. Harmless here, but the Sample number undercounts.
8. **Sample labelled "No AI. Free." shows $0.1030**, with the shared-counter caveat. The same was seen on Allbirds and B&N.
9. The website name defaulted to **"Madeincookware"** (the host with the dots removed), as on B&N.

## Screenshots

- `madein-screen.png`: after Find products, 35 found, three cards `ready`, the suggestions before any accept.
- `madein-before-verify.png`: every cell accepted, Verify reading "up to $0.40".
- `madein-after-verify.png`: "Everything is verified", 8/8.
- `madein-run.png`: the run page, Done, 35 of 35.
