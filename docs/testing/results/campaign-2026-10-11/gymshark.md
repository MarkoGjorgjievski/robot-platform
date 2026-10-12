# gymshark.com — campaign 2, 2026-10-12 (phase 2, batch A, site 1)

**Status: DONE.** Verified 8/8 on 4 proof pages, $0 in AI. Extract returned 60 of 60. The judge rated Title 100%, Price 100%, Rating 100%, Description 87% and Brand 25%; the judge cost $4.91.

- Website `gymshark` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved: https://www.gymshark.com/collections/all-products/womens
- The api-server's browser gets the **US** storefront ($ prices). Every capture shows an "ARE YOU IN THE RIGHT PLACE? ROW / US" country modal over the size picker, which popup dismissal did not close.

## Findings in the product (most important first)

1. **Brand cannot be certified as "Gymshark".** The site's JSON-LD `brand.name` is "Gymshark | We Do Gym", but `og:site_name` is "Gymshark".
   - With "Gymshark" typed on all three products, Verify read **"fails on products 1, 2 and 3 0/3"**: every cell was `no_fitting_path`, `aiCalled: false`, $0.
   - `run-verification.ts` skips the AI fallback when every cell is `no_fitting_path`, so the label's "up to $0.40" never applies. The meta tag that holds exactly "Gymshark" is never a candidate.
   - The only way to verify was to type the site's own tagline-brand. So 60 of 60 rows carry "Gymshark | We Do Gym", and the judge called 24 of them wrong (Brand 25% correct).
2. **The mark popover can preselect the wrong field.** On products 1–3, "Fix Description" → click the description on the screenshot opened the popover with the field picker reading **"SKU"**, not Description; one tick would have stored the description as the SKU. On product 4, after SKU had been answered, it read "Description".
   - `popover.key` is not set from the field being fixed. `initialKey` falls back to `rows[0]` (the first unanswered field that fits) in `routes/_app/projects/$project/sites/$site/index.tsx:858`.
3. **Sample's panel says "Rows extracted 0" with no table while the strip says "3 rows extracted".** This was right after Sample finished (115 s). After a reload it read "Sample rows complete 3 of 3", and the table was right (`gymshark-12-sample.png` vs `gymshark-12b-sample-reload.png`).
4. **Sample is labelled "No AI. Free." and the probe run recorded $0.0973.** No other worker was on the server; only my own Verify of another site may have overlapped.
5. **The Extract run is charged another site's Verify.** Run `a6db90da` recorded `cost_usd` **$0.0617**, exactly the AI cost of the bombas.com Verify I clicked at 09:59 while this run was extracting (the shared-counter attribution from campaign 1, now with a clean one-worker proof).
6. **Closing the tab during planning leaves a run that says "Completed" but extracted nothing.** Extract plans first (74 s here) with nothing on screen but the button spinner; `crawl.execute` is only called after the plan returns.
   - My script closed the page after 60 s, so execute never ran.
   - The run page then read "Extraction **Idle** · Completed **just now** · Duration **1 min** · Rows — · 60 URLs planned, not yet extracted · **Extract 60 pending**".
   - "Extract 60 pending" started it. While it was running, the page read "Extract 58 pending · Stop · Nothing reclaimed yet — an item is only given back after 30 minutes at "running", so a more recent one is left to the loop that claimed it."
7. **The second coverage check offered "Use as proof page" again for the same shape.** Rating was answered "Not on this product" on proof page 4 (a no-reviews product). The re-check then read "Empty on 8 of 20 sampled products · Use as proof page", without the "all show no rating in the page data · already a proof page" clause the first check had.
8. **Description page data is raw HTML-escaped text.** It contains `&apos;`, `&amp;amp;` and a trailing "SKU: B7A3L-NDJ1", for example "These leggings aren&apos;t 100% squat-proof … Subtle contouring around the glutes &amp;amp; the waist". I marked the visible short description instead.
9. The run stores "ButterSmooth**TM**" where the page and the proof value read "ButterSmooth™".
10. Cards for products added by URL show the page `<title>` ("Gymshark Everyday Seamless Flared Leggings - Black | Gymshark") and no image (as on Nike in campaign 1).
11. Find products returned **99** product links today, against "55 products found" in yesterday's pre-screen, and the first three were the same Everyday Seamless Leggings in brown, purple and black.

## Proof pages

Products 2 and 3 as found were colourways of product 1, so I replaced them with the 4th and 8th listing products. Product 4 was added by the coverage line.

1. https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26
2. https://www.gymshark.com/products/gymshark-everyday-seamless-flared-legging-leggings-black-aw25 (replaced the purple colourway)
3. https://www.gymshark.com/products/gymshark-whitney-mid-rise-legging-leggings-black-ss26 (replaced the black colourway)
4. https://www.gymshark.com/products/gymshark-adapt-solid-sports-bra-sports-bras-black-aw26 (added by "Use a sampled product as proof page for Rating"; no reviews)

| Field | What it needed | Verdict (final) |
|---|---|---|
| Title | agreed → Accept (checked against the screenshots) | verified 4/4 |
| Price | agreed (38 / 38 / 54; 46 on product 4) | verified 4/4 |
| Main image | "only in the page data": confirmed per product (colour names in the file names match) | verified 4/4 |
| SKU | page data, confirmed | verified 4/4 |
| Brand | **typed** "Gymshark" ×3, which failed 0/3 (finding 1); then **typed** the site's "Gymshark \| We Do Gym" | verified 4/4 |
| In stock | page data, confirmed | verified 4/4 |
| Rating | agreed (3.4 / 3.5 / 4); **absent** on product 4 | verified 4/4 |
| Description | **marked** the visible short description on each product (the page data was escaped HTML, finding 8) | verified 4/4 |

Counts on the first three: agreed 3, page data confirmed 3, marked 1, typed 1, absent 0. Product 4 added 1 absent (Rating).

## Verify

| When (UTC) | Label | Time | Result | AI calls / cost |
|---|---|---|---|---|
| 09:20:19 | "Verify 8 fields · up to $0.40" | 20 s | 7/8, Brand "fails on products 1, 2 and 3 0/3" | 0 / $0.00 |
| 09:28:40 | "Re-verify 1 field · up to $0.05" | 5 s | 8/8 verified 3/3, "Everything is verified" | 0 / $0.00 |
| 09:38:44 | "Re-verify 8 fields · up to $0.40" (4 proof pages) | 10 s | 8/8 verified 4/4 | 0 / $0.00 |

## Coverage check

The stage line read "Checking 20 more products from the listing…" from 70 s after the verify, then "2 fields were empty on some of the 20 sampled products — see the rows."

- **First** (09:28:42 → 09:36:34, **7 min 52 s**):
  - `rating`: "Empty on 9 of 20 sampled products · all 9 show no rating in the page data" + "Use as proof page"
  - `description`: "Empty on 2 of 20 sampled products" + "Use as proof page"
- I used "Use a sampled product as proof page for Rating" once. The 4th card was ready in 16 s; I answered it, and the re-Verify cost $0.
- **Second** (09:38:47 → 09:46:26, 7 min 39 s, a different 20):
  - `rating`: "Empty on 8 of 20 sampled products" + "Use as proof page" (finding 7)
  - `description`: "Empty on 3 of 20 sampled products" + "Use as proof page"

## Sample and Extract

- **Sample** ("Sample 3 products", labelled "walks the first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free."):
  - 09:48:00 → 09:49:54 (115 s): Pages walked 1, Product links found 30, 3 of 3 rows after a reload (finding 3).
  - Probe `0b54618d`, recorded $0.0973.
- **Extract**: the budget was "custom 60 products across custom 2 pages", which read "1 listing · first 60 products from each · first 2 pages of each · safety stop at 5,000 products per listing". The button reads only "Extract" (no amount; see the report).
  - Run `a6db90da-b26f-458e-a3d1-aef0431f051b`: planned 09:50:59 → 09:52:13; extracting from 09:53:11; completed **10:12:24**. That is 19 min for 60 items, about 19 s per item.
  - Status **completed**, "60 of 60 extracted", "60 URLs to extract · 1 listing page walked".
  - Banner on the website: "1 field stopped extracting".
  - Empty cells panel: "Rating is empty on 27 of 60 products · all from /collections/all-products/womens" and "Description is empty on 5 of 60 products · all from /collections/all-products/womens", with "Repair all gaps…".

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 60/60 | 29 |
| Price | 60/60 | 12 |
| Main image | 60/60 | 60 |
| SKU | 60/60 | 60 |
| Brand | 60/60 | 1 ("Gymshark \| We Do Gym") |
| In stock | 60/60 | 2 |
| Rating | 33/60 | 11 |
| Description | 55/60 | 25 |

## Judge

`docs/testing/results/2026-10-12T10-13-judge-run-gymshark.md`. It estimated "~$3.34 … ~$3.67 with the 10% retry/explain allowance; cap $5.00" and actually cost **$4.9124**, in 30 min 23 s.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 60 | 59 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 60 | 0 | 0 | 0 | 60 | 0 | 0 | — |
| SKU | 60 | 0 | 0 | 56 | 4 | 0 | 0 | — |
| Brand | 60 | 8 | 24 | 15 | 13 | 0 | 0 | 25% |
| In stock | 60 | 44 | 1 | 5 | 10 | 0 | 0 | 98% |
| Rating | 33 | 33 | 0 | 0 | 0 | 0 | 27 | 100% |
| Description | 55 | 46 | 7 | 0 | 2 | 0 | 5 | 87% |

What the wrong verdicts are:

- **Brand ×24**: real, finding 1.
- **In stock ×1**: real. Pumper Pants is stored `false`, but sizes M–XXL are selectable. Availability probably comes from the first (sold-out) variant.
- **Description ×7**: a limit of the judge. The page clamps the text with "…" and "Learn more", and the judge calls the full stored sentence wrong because the screenshot shows it cut off. The stored text is the right text.
- Judge cost ran **34% over its own estimate** ($4.91 against $3.67), and finished just under the $5 cap.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify ×3 | $0.00 |
| Sample probe | $0.0973 (recorded; labelled free) |
| Extract run | $0.0617 (recorded; belongs to the bombas Verify) |
| Judge | $4.9124 |

## Screenshots

`gymshark-00…` was not taken; the pre-screen's `gymshark.com-screen.png` stands.

- Proof pages: `gymshark-01-cards`, `-02-table-before`, `-03-before-verify`.
- Verify: `-04-after-verify` (Brand fails), `-05-after-verify` (8/8).
- Coverage: `-06-coverage-done`, `-07-before-use-as-proof`, `-08-fourth-card`, `-09-after-verify` (4/4), `-10-coverage-2`.
- Extract: `-11-extract-tab`, `-12-sample` (0 rows shown), `-12b-sample-reload` (3 of 3), `-13-extract-before`, `-14-run-started`, `-15-run`.
- Marks: `gymshark-mark-Description-1…4`.
