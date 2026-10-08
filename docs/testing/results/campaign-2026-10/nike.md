# nike.com — credit campaign 2026-10-08

**Status: DONE.** Verified 8/8 with 0 AI calls. The Extract run returned 60/60 rows. Recorded spend is $0.25 ($0.0931 for the Sample, $0.1611 for the run), but most or all of it probably belongs to other websites' runs that were going at the same moment (see finding 1).

- Website: `Nike` (slug `nike`, source `d3caae72-c6f0-4f38-baf2-1e1971928aa9`), project `credit-campaign-2026-10`
- Listing (the suggested one, used as is): https://www.nike.com/w/mens-shoes-nik1zy7ok
- Proof pages (4; the first three need every field, so the no-reviews product is #4):
  1. https://www.nike.com/t/metcon-10-mens-workout-shoes-WWGl2m1D/HJ1875-100
  2. https://www.nike.com/t/air-force-1-07-mens-shoes-XVPIszaq/FJ4146-002
  3. https://www.nike.com/t/air-max-270-mens-shoes-KkLcGR/AH8050-033
  4. https://www.nike.com/t/vomero-18-mens-road-running-shoes-NzWnvcC8/IQ0459-001 (no reviews, so Rating is absent)

## Screen

"Find products" gave **13 product links, no pager**, and the first three were colourways of the same Metcon 10. All three had the same Title, Rating and Description, which is no use as a proof set. I dropped two of them and pasted other models through "+ Add product". All screenshots read `ready` within about 10 s. There was no bot wall and no consent wall.

## Fields

| Field | What it needed | Verdict | Run hit rate |
|---|---|---|---|
| Title | **typed** ×4: the suggestion was the JSON-LD name ("Nike Metcon 10 Men's Workout Shoes"), and on product 2 it was wrong ("Air Force 1 Low Men's Shoes", where the page shows "Nike Air Force 1 '07"). The page's own heading can't be clicked (finding 2) | verified 4/4 | 60/60 |
| Price | agreed (155 / 115 / 170 / 165, checked against the screenshots) | verified 4/4 | 60/60 |
| Main image | agreed | verified 4/4 | 60/60 |
| SKU | agreed (matches "Style: …" on each page) | verified 4/4 | 60/60. All 60 match the style code in their URL |
| Brand | "same on every product", accepted anyway (Nike) | verified 4/4 | 60/60 (it reads "Jordan" on Jordan products, which is correct) |
| Rating | agreed on 1–3 (4.7 / 4.9 / 4.7); **absent** on 4 ("Reviews (0) · No Reviews") | verified 3/3 | 55/60. The 5 empties look like real no-review products |
| In stock | agreed | verified 4/4 | 60/60 |
| Description | **marked** ×4: the "agreed" suggestion was wrong on product 2 (a camo colourway's JSON-LD text) and had a meta-only lead sentence on 1 and 4. Marked the page's description paragraph | verified 4/4 | 60/60 |

Totals: agreed 5, marked 1, typed 1, absent 1 (one cell, Rating on product 4).

## Verify

- Label: **"Verify 8 fields · up to $0.40"**. Clicked once at 10:22:35.
- Strip: every row read "checking…" and turned verified within 20 s. The server took 11 s (10:22:35 → 10:22:46).
- Verdicts: 8/8 verified (Title, Price, Main image, SKU, Brand, In stock, Description 4/4; Rating 3/3).
- Actual cost: **$0.0000, 0 AI calls** (`source_verifications.cost_usd`). Everything certified on mechanical paths: JSON-LD `hasVariant[0].*` / `hydratedProducts[0].*` plus XPaths for Title and Description.

## Extract

- Pages: the listing was already saved from the Verification tab. Listing mode won't allow Extract until a **Sample** has run ("Sample first"). The Sample button says "No AI. Free.", so I ran it once: 75 s, 1 page walked, 30 product links, 3 rows. **That probe run recorded $0.0931** (finding 1).
- Budget: custom **60 products × 5 pages**. The sentence read "1 listing · first 60 products from each · first 5 pages of each · safety stop at 5,000 products per listing". Clicked Extract once at 10:27:16.
- Result: **completed, 60 rows**, 1 listing page walked ("budget reached: 60 items"). It ran 10:27:16 → 10:39:21, which is **12 min 05 s, about 12.1 s per item**. The 60 URLs cover 16 distinct models; many are colourways of the same shoe.
- Recorded run cost: **$0.1611**. Usage page: org total $0.45 at 10:40, but that includes the other workers' websites.
- The run page offers "Rating is empty on 5 of 60 products … Repair all gaps…". I did not click it, because those products have no reviews.

## Findings (product, not fixed)

1. **Run cost is attributed to whatever else is running at the time.** Barnes & Noble's probe (10:29:47–10:31:08, inside my run's window) also recorded exactly **$0.1611**, the same as my Extract run. The likely cause is that `plan-source.ts` / `start-execution.ts` charge `costSince(before)` from a usage snapshot that covers the whole process. If so, every run that overlaps another is charged the other's model calls, and the Usage total double-counts. My probe's $0.0931 overlapped Allbirds' planning (10:24:49). Separately, the plan-source comment says the planning walk itself makes model calls (pagination detection, catalogue judge). That contradicts the Sample button's "No AI. Free." and the "certified ⇒ ~$0" claim. Either way, the per-run figures here can't be trusted.
2. **Hidden mega-menu elements in the box map block clicks on the product title.** Every point of Nike's title (664,204 376×24) is also covered by invisible nav-dropdown boxes (134×26, many with no text). Those boxes are smaller, so they win the click and the popover says "This element has no text". The title can't be marked on any product, so I had to type it.
3. **On products with reviews, the reviews drawer is painted over the screenshot.** On products 1–3 the top ~650 px of the first tile shows the "4.7 out of 5 stars" drawer instead of the product header (`nike-mark-Title-1` in my scratch). Its hidden boxes (e.g. "ScreenName…", 1184 px wide) also catch clicks over the description: my first mark on product 2 read "ScreenName827241854" and I had to redo it.
4. **"Agreed" can be wrong.** Title and Description read "agreed · Accept" with a wrong value on product 2 (another colourway's JSON-LD text). Anyone using "Accept all agreed" would have certified bad expected values.
5. **The listing detector undercounts.** "Find products" reported 13 links (10 of them Metcon 10 colourways). A plain browser on the same page sees 178 unique `/t/` links across 48 models, and the Sample/Extract walk found 30 and then 60. The first three suggested proof products were all the same shoe.
6. **A field genuinely absent on one of the first three products blocks Verify** ("Rating still needs product 3"). The only way out is to reorder: drop the product and re-add it as product 4+. Nothing in the UI says that.
7. **Sample facts are inconsistent.** The strip said "3 rows extracted" while the Sample section said "Sample rows complete 0 of 0".
8. Minor: products added by URL show only their URL in the column head (no image or title), and with 4 products the Status column is cut off at 1440 px (`nike-after-verify.png`).

## Screenshots

- `nike-before-verify.png`: the table with every cell accepted, before Verify
- `nike-after-verify.png`: "Everything is verified", rows verified
- `nike-run.png`: the run page, Done, 60 of 60
