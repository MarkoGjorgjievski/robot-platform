# barnesandnoble.com — credit campaign 2026-10-08

**Status: DONE.** Screen, proof pages, expected values, Verify and one Extract all completed.

- **Verify:** 8/8 fields verified for $0.00.
- **Extract:** 60/60 rows for $0.00, at 14.8 s per item.
- **Caveat:** the certified Price and SKU paths read the wrong format's offer on most extracted books. Verify could not see this, because its three proof pages happened to agree. See finding 1.

**Website**
- Name `Barnesandnoble`, slug `barnesandnoble`, source `ae6fa0b3-4e5f-4028-8d35-993ce85b1d76`.
- Added through the Add website dialog with the address `https://www.barnesandnoble.com`.

**Listing used**
- The suggested **https://www.barnesandnoble.com/b/books/_/N-1fZ29Z8q8**.
- It redirects to `/collections/books/bestselling-books` ("Bestselling Books"), 20 books per page, with `?page=N` pagination.

**Proof pages**
- Find products reported "33 products found". The first three it put on the board were not bestsellers from the grid:
  - two NOOK tablets from the site's navigation menu;
  - the "Our October Audiobook Pick - Partita" promo banner (`bn-screen.png`).
- I replaced them with three books from the bestseller grid, using "+ Add product" → URL, then dropping the three originals:
  1. https://www.barnesandnoble.com/w/threshing-day-rebecca-yarros/1150799611 (default format eBook, $11.99)
  2. https://www.barnesandnoble.com/w/theo-of-golden-allen-levi/1143923011 (Paperback, $20.00)
  3. https://www.barnesandnoble.com/w/the-french-illusion-john-grisham/1149667428 (Hardcover, $24.50)

## Screen (free)

- There was no bot wall and no consent wall.
- All three captures read `ready` in about a minute. A Holiday Gift Guide banner is in the captures but covers nothing.

## Per-field table

| Field | What it needed | Certified (first path) | Verdict | Extract hit rate |
|---|---|---|---|---|
| Title | agreed (row Accept) | json-ld `@graph[0].name` (+ og:title, h1 xpath) | verified 3/3 | 60/60 |
| Price | agreed | json-ld `@graph[1].offers.price` (+ `hasVariant[2].offers.price`) | verified 3/3 | 59/60, **but wrong on 3 of 3 spot-checked** (finding 1) |
| Main image | agreed | json-ld `@graph[0].image` (+ og:image) | verified 3/3 | 60/60 |
| SKU | **marked** on all 3 (the agreed suggestion was wrong) | json-ld `@graph[0].hasVariant[2].sku` (+ ISBN-13 td xpaths) | verified 3/3 | 59/60, **but equals the URL's own EAN on only 24/60** (finding 1) |
| Brand (publisher) | **marked** on all 3 (empty on 1, wrong on 3, right on 2) | json-ld `@graph[0].publisher` (+ Publisher-row xpaths) | verified 3/3 | 59/60 |
| Rating | agreed | json-ld `@graph[1].aggregateRating.ratingValue` | verified 3/3 | 54/60 (6 empty: new or pre-order titles without reviews) |
| In stock | agreed | json-ld `@graph[1].offers.availability` + 4 `hasVariant[n]` alternates (weakEvidence) | verified 3/3 | 59/60 |
| Description | agreed | json-ld `@graph[0].description` (+ alternates) | verified 3/3 | 59/60 |

**Counts:** agreed 6, marked 2 (6 cells), typed 0, absent 0.

**Checks behind the accepts.** I checked each value against the capture boxes and screenshots:

- **Title and price.** Both are visible on all three pages, and the price matches the selected format.
- **Main image.** The image file name equals the page's ISBN-13 on all three.
- **Rating.** 4.5 and 4.4 are printed on pages 2 and 3. On page 1 only the stars are shown (about 4½, review count 35), so 4.3 was accepted as the site's own data.
- **In stock.** Pages 2 and 3 say "In stock". Page 1 is an eBook with Add To Cart.
- **Description.** It matches the Overview text, including the bold blurb lines above it.

**Why SKU and Brand were marked.** The suggested SKUs did not match the page:

| Product | Suggested SKU | ISBN-13 on the page |
|---|---|---|
| 1 | 9781682818084 | 9781682818527 |
| 2 | 9798988702917 | 9781668236512 |
| 3 | 9780385550550 | 9780385550543 |

The suggested SKUs belonged to other formats. Brand was suggested only on product 3, as "Tor Publishing Group", but the page shows "JG Publishing". It was empty on product 1. Every SKU and Brand cell was marked on the ISBN-13 and Publisher rows of the Product Details table.

## Verify (paid, once)

- Label **"Verify 8 fields · up to $0.40"** (≤ $3). Clicked once at 10:28:52Z.
- Wall time **20.5 s**.
- Result **8/8 verified**, allPassed, 0 AI calls, **actual $0.00** (`source_verifications.cost_usd` 0.0000, id `11719d21…`).

## Sample (free step before Extract)

- "Sample 3 products" took **85 s**. It walked 2 listing pages and found 30 product links, with "Pagination detected: not reported" even though it walked page 2. It extracted 3 rows (the run row says 3, status `partial`).
- Right after the sample the panel read "Sample rows complete **0 of 0**". After a reload it read "2 of 3", while the step header said "3 rows extracted".
- The probe run `942a1689…` has **cost_usd $0.1611**, though the screen says "No AI. Free." The counter is shared by the whole api-server and other workers were running at the same time, so this number is unreliable. It is reported as shown.

## Extract (once)

- Budget set to **custom 60 products across custom 4 pages**. The screen read "1 listing · first 60 products from each · first 4 pages of each · safety stop at 5,000 products per listing". At 20 books per page, the item budget binds.
- Run `a80bd75a-828f-436e-9b50-3bc25fa9b42c`:
  - clicked 10:33:48Z, completed 10:48:33Z, **885 s for 60 items → 14.8 s/item**;
  - 3 listing pages walked;
  - status `completed`, **60 of 60 extracted**;
  - **cost $0.00**.
- Empty cells (run page): Price 1, SKU 1, Brand 1, Rating 6, In stock 1, Description 1 of 60.
  - One row, "The Sixth Faction Deluxe Limited Edition", has only Title and Main image. It is the 1 in every count of 1.
  - The run page still shows "60 rows · 100% confidence".
- The 60 URLs are 57 distinct books. Three books came twice with different `?ean=` values: The Knave and the Moon, Dungeon Crawler Carl and Carl's Doomsday Scenario. Each pair was extracted with identical data.
- Org Usage page after this website: **$0.45** for October. This is all campaign workers combined.

## Findings in the product

1. **The certified Price and SKU paths pick a format positionally, so most extracted books get another format's price and ISBN.**
   - The listing links each book with `?ean=<format>`. The certified paths are `@graph[1].offers.price` and `@graph[0].hasVariant[2].sku`, and neither follows the `ean` in the URL.
   - I checked three live pages for free with Playwright:

     | Book | Price shown on the page | Price extracted |
     |---|---|---|
     | Falling Like Leaves | $12.99 (BN Exclusive Paperback) | 2.99 (the eBook) |
     | Project Hail Mary | $22.00 Paperback | 14.99 |
     | Atomic Habits | $22.00 Hardcover | 12.99 |

   - SKU equals the URL's EAN on only **24/60** rows. Many SKUs are eBook EANs (`2940…`), and SKU agrees with the main image's ISBN on only 24/60.
   - Verify passed because, on the three proof pages, variant index 2 and `@graph[1]` happened to be the format each page showed. That is the "verification certifies a coincidence" class of bug.
   - The run page then reports 100% confidence.
2. **Find products took navigation-menu and promo-banner links as the first products.** The two NOOK tablets come from the mega-menu, and the audiobook pick is a hero banner. A customer who keeps the default three verifies on non-books.
   - The Extract walk itself took the real grid. Its planned URLs were all books.
3. **Product cards added by URL show the URL as their title and a blank thumbnail** (`bn-after-verify.png`). Cards from Find products show the product name.
4. **The website name defaulted to "Barnesandnoble"** (the host with its dots removed), not "Barnes & Noble".
5. **Two contradictions in the Sample panel.** It shows "0 of 0" right after sampling, then "2 of 3" after a reload, while the header says "3 rows extracted". It also says "Pagination detected: not reported" while walking `?page=2`. This was seen on Allbirds too.
6. **Sample is labelled "No AI. Free." but its run shows $0.1611.** The shared-counter caveat applies, as on Allbirds.
7. **The duplicate books** (same work, different `?ean=`) are extracted as separate rows with identical values, so the budget of 60 bought 57 books.
8. **In stock certified five alternate paths, one per variant (weakEvidence).** Any one variant in stock could stand in for the page's format. This is the same family as finding 1.

## Screenshots

- `bn-screen.png`: after Find products on the suggested listing. Two NOOK tablets and the audiobook promo are on the board.
- `bn-table-before.png`: the three books with their suggestions, before any accept (Verify reads "up to $0.40").
- `bn-after-verify.png`: "Everything is verified", 8/8.
- `bn-sample.png`: the Extract tab right after Sample (2 pages walked, 30 links, "0 of 0").
- `bn-run.png`: the run page, 60 of 60 extracted, with empty-cell counts and rows.
