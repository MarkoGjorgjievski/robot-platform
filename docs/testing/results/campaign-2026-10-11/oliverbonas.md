# oliverbonas.com — campaign 2, 2026-10-12 (phase 2, batch B, site 15)

**Status: DONE.** Verified 8/8 on 3 proof pages, then 4/4 with the coverage proof page; both Verifies cost $0.00. Extract returned 60 of 60 in 10 min for $0.00. The judge ($3.7709) rated Title, Price, SKU and Brand 100%. Its In stock, Rating and Description "wrongs" are its own vocabulary (stars against decimals, no "In stock" label, a collapsed "Product Details"), with at most one possibly real rating.

- Website `oliverbonas` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved: https://www.oliverbonas.com/sale/category/clothing/dresses-sale ("99 products found", no pager).
- Magento, UK storefront (£). The capture lays the page out normally: title, the struck-through and sale prices, stars and "Code: …" are all on the first tile.
- This is the only site in the batch with no overlay, no off-screen column and no wrong suggestion that reached Verify.

## Findings in the product (most important first)

1. **Rating "100" is suggested for a product with no reviews.** The polka-dot dress (product 1 as found, and the coverage product later) shows no stars and no reviews, yet the table suggested **"100"** both times, presumably a percentage-recommended field. Accepting it would have certified a wrong value.
   - I replaced it as product 1 (to avoid "Not on this product" on products 1–3, batch A's silent 412) and answered "Not on this product" when the coverage line brought it back as product 4.
2. **The coverage line cuts its address pattern:** "Empty on 1 of 20 sampled products · its address looks like /fashion/white-brown-polka-dot-scallop-collar-cotton-midi-dress-n". The "-n" stands for the trailing product number. It reads as a cut-off word, and with one product it is no pattern at all.
3. **Sample is labelled "No AI. Free." and recorded $0.1014** (probe `81ada19d`, `partial`).
4. Ratings are shown only as stars plus "n reviews". The verified values (4.85 / 5 / 4) come from page data and cannot be read off the page to the decimal.

## Proof pages

1. https://www.oliverbonas.com/fashion/red-orange-floral-v-neck-tie-waist-midi-dress-409016 (replaced `white-brown-polka-dot-scallop-collar-cotton-midi-dress-410935`, which has no reviews, finding 1)
2. https://www.oliverbonas.com/fashion/black-floral-embroidered-frill-collar-tiered-midi-dress-409216
3. https://www.oliverbonas.com/fashion/red-embriodered-tie-waist-strappy-midi-dress-409184
4. https://www.oliverbonas.com/fashion/white-brown-polka-dot-scallop-collar-cotton-midi-dress-410935 (added by "Use a sampled product as proof page for Rating")

| Field | What it needed | Verdict (final) |
|---|---|---|
| Title | agreed | verified 4/4 |
| Price | page data, confirmed (40 / 42.5 / 32.8; shown "£80.00 £40.00", "£85.00 £42.50") | verified 4/4 |
| Main image | page data, confirmed | verified 4/4 |
| SKU | page data, confirmed (2130903…; shown "Code: 2130903") | verified 4/4 |
| Brand | page data "Oliver Bonas", confirmed | verified 4/4 |
| In stock | page data, confirmed | verified 4/4 |
| Rating | page data, confirmed (4.85 / 5 / 4); **absent** on product 4 (suggested "100") | verified 4/4 |
| Description | page data, confirmed | verified 4/4 |

Counts on the first three: agreed 1, page data confirmed 7, marked 0, typed 0, absent 0. Product 4: absent 1 (Rating).

## Verify

| When (UTC) | Label | Time | Result | AI calls / cost |
|---|---|---|---|---|
| 15:06:42 | "Verify 8 fields · up to $0.40" | 20 s | 8/8 verified 3/3 | 0 / $0.0000 |
| 15:12:42 | "Re-verify 8 fields · up to $0.40" (4 proof pages) | 5 s | 8/8 verified 4/4 | 0 / $0.0000 |

## Coverage check

- **First** (15:06:55 → 15:11:03, 4 min 8 s): "1 field was empty on some of the 20 sampled products — see the row."
  - `rating`: "Empty on 1 of 20 sampled products · its address looks like /fashion/white-brown-polka-dot-scallop-collar-cotton-midi-dress-n" + "Use as proof page".
- "Use a sampled product as proof page for Rating" → product 4, ready in about 20 s, Rating suggested "100" → "Not on this product".
- **Second** (15:12:42 → 15:16:32, 3 min 50 s): **"Checked 20 more products from the listing: every field was found on all of them."**

## Sample and Extract

- **Sample**: 15:26:30 → 15:27:35 (65 s). Pages walked 1, Product links found 30, "Sample rows complete 3 of 3". Probe `81ada19d-f6b0-41f4-af71-a97d38483107`, `partial`, $0.1014.
- **Extract**, budget "custom 60 products across custom 2 pages":
  - Run `3647ab4b-fde0-4ff9-a587-8aff2104ccbb`. Clicked 15:28:05; "Open the run" at 15:28:17 (planning 12 s). Completed 15:38:56, "Duration 10 min".
  - "Done", "60 of 60 extracted", "60 URLs to extract · 1 listing page walked". `cost_usd` **$0.0000**.
  - Empty cells: "Rating is empty on 2 of 60 products · all from /sale/category/clothing/dresses-sale".

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 60/60 | 60 |
| Price | 60/60 | 20 |
| Main image | 60/60 | 60 |
| SKU | 60/60 | 60 |
| Brand | 60/60 | 1 ("Oliver Bonas") |
| In stock | 60/60 | 1 (true) |
| Rating | 58/60 | 16 |
| Description | 60/60 | 60 |

## Judge

`docs/testing/results/2026-10-12T16-26-judge-run-oliverbonas.md`. It estimated "~$3.59 … ~$3.95 with the 10% retry/explain allowance" and cost **$3.7709**, in 27 min 2 s. It judged all 60 items.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 60 | 58 | 0 | 0 | 0 | 2 | 0 | 100% |
| Price | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 60 | 0 | 0 | 0 | 60 | 0 | 0 | — |
| SKU | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| Brand | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 60 | 14 | 10 | 22 | 12 | 2 | 0 | 58% |
| Rating | 58 | 35 | 22 | 0 | 1 | 0 | 2 | 61% |
| Description | 60 | 0 | 2 | 58 | 0 | 0 | 0 | 0% |

What the wrong verdicts are:

- **Rating ×22: the judge.** "The page shows a 5-star rating (based on 4 reviews), not 4.75."; "approximately 4 stars (4 filled stars with a half star) … not 4.6". The site shows stars only.
  - One may be real: `blue-cream-sun-print-v-neck-tiered-midi-dress-406579` stored **5** where the judge read "a 4-star rating with 25 reviews".
- **In stock ×10: the judge.** "The page does not display an explicit "In stock" field/value." The page offers sizes and "Select your size", so `true` is right.
- **Description ×2 (+58 not on page): the judge.** The description sits under a collapsed "Product Details +", so it is not on the screenshot: "The page shows no description text; the "Product Details" section is collapsed".
- SKU is 60/60 correct here because the page prints "Code: 2130903". This is the only site in either batch where the judge could check SKUs.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify ×2 | $0.0000 |
| Sample probe | $0.1014 (recorded; labelled free) |
| Extract run | $0.0000 |
| Judge | $3.7709 |

## Screenshots

`oliverbonas-00-cards-as-found`, `-01-cards`, `-02-table-before`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-07-before-use-as-proof`, `-08-fourth-card`, `-09-after-verify`, `-12-sample`, `-12b-sample-reload`, `-13-extract-before`, `-15-run`.
