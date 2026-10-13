# notonthehighstreet.com — campaign 2, 2026-10-13 (phase 2, batch C, site 34)

**Status: DONE.**

- **Listing:** the finder took menu links for products, so I pasted the proof pages by hand.
- **Verify:** 8/8 on 3 proof pages, $0.00, in 151 s.
- **Coverage check:** it sampled 20 **category pages** and reported every field empty on 20 of 20. Most of its reason sentences are wrong.
- **Sample and Extract:** both walked to real products. Extract returned 60 of 60 in 9 min, and recorded **$0.1106** with no amount shown.
- **Shown flag:** 21 values not shown on their page. The judge (stopped at its $3 cap after 31 items, $2.9942) found 3 real rating errors among them. 6 of the flagged values were correct: the flag does not decode "&amp;", and it misses run-together sentences.

## The listing

- **Every listing gives the finder menu links.**
  - The pre-screen's `/gifts` gave "71 products found · a pager too". Its three cards were "Subscription gifts", "Baby shower" and "Congratulations", which are category pages.
  - `/sale/jewellery-sale` gives "33 products found · a pager too": "Stocking fillers", "Garlands & bunting", "Tree decorations" and other Christmas menu links.
  - Guessed category paths (`/home/candles`, `/gifts/for-her`) read "That page doesn't exist on notonthehighstreet.com (404). Check the address."
- **Why the finder misses the products.** NOTHS product addresses are `/{seller}/product/{slug}`. On `/sale/jewellery-sale` my browser finds 60 of them across about 20 sellers (lisaangeljewellery 22, potiega 16, …). Grouped by first path segment, no seller group outweighs the menu groups.
- **I kept `/sale/jewellery-sale`** as the listing and pasted three products from it.

## Findings in the product (most important first)

1. **The coverage check sampled category pages and its sentences are wrong.**
   - "8 fields were empty on some of the 20 sampled products — see the rows."
   - Every row reads **"Empty on 20 of 20 sampled products · all 20 show no rating in the page data"**: Price, Main image, SKU, Brand, In stock and Description as well as Rating. That reason sentence belongs to Rating only.
   - Title reads "Empty on 2 of 20 sampled products · all 2 have no offer in the page data".
   - The 20 sampled "products" are `stocking-fillers`, `garlands-bunting`, `gifts-for-her` and others: the finder's menu links. Title filled on 18 of them because the certified Title path reads a category page's heading.
   - Each row offered "Use as proof page", which would have added a category page as a proof page. I did not click it.
2. **The walk and the finder disagree, the other way round from usual.** Sample read "Pages walked 1 · Product links found 30" and returned three real products (Lisa Angel bracelets). The run walked "60 URLs to extract · 1 listing page walked", all `/…/product/…` pages. Only Find products and the coverage check use the menu links.
3. **The shown flag over-flags on this site.**
   - **Brand "FORGE & FOUNDRY": 6 flagged, all correct.** The page shows "FORGE & FOUNDRY". My capture's HTML text holds "FORGE &amp; FOUNDRY", and the flag's page text decodes `&nbsp;` but not `&amp;` (`packages/scraper/src/verify/shown-on-page.ts`, `decodeNbsp`). The judge called all three it saw correct.
   - **Description: 7 flagged, at least 3 correct.** JSON-LD joins paragraphs with no space, "…from Lisa Angel.Designed by our in-house…", while the page prints them as separate blocks. The judge called 3 of them correct.
   - **Rating: 8 flagged; 3 of the judged ones really wrong.**
     - birthday-bracelet: 4.9 stored, the page shows 4.8.
     - giftsonline4u: 4.2 stored, the page shows 4.3.
     - lunity sisters necklace: 4.6 stored, "5/5" shown.
     - Not every flagged rating is wrong: `new-beginnings-bracelet` stores 4.9, and my capture shows "4.9" and "4.9 out of 5".
   - The judge's line: **"The free flag caught 3 of the 4 flagged wrong values; it flagged 6 correct values."**
4. **The run recorded $0.1106 and Sample recorded $0.2150**, with "No AI. Free." on Sample and no amount on Extract. These are the largest Sample and run charges in the campaign.
5. **The Sample panel now has a "Values not shown" line:** "1 value not shown on their page: Description" (new).
6. **Verify took 151 s** ("checking…" on every row) and cost $0.00. Other sites took 5–25 s.
7. **The card titles are the page `<title>`**: "Multi Strand 18ct Gold Plated Heart Necklace By Baronessa", "Gold Or Silver Flower Bracelet, Women's Jewellery By MUCHV". The suggested Titles drop the " By {seller}" part.

No `not the page's heading on product n` reason appeared, and no `not on this page` cell word. Nothing was typed.

## Proof pages

1. https://www.notonthehighstreet.com/baronessa/product/multi-strand-gold-plated-heart-necklace
2. https://www.notonthehighstreet.com/muchv/product/women-s-dainty-hydrangea-bracelet-flower-jewellery
3. https://www.notonthehighstreet.com/potiega/product/sideways-initial-necklace-in-sterling-silver

All three were pasted by hand, replacing the found "Stocking fillers", "Garlands & bunting" and "Tree decorations".

| Field | What it needed | Verdict |
|---|---|---|
| Title | agreed | verified 3/3 |
| Price | agreed (33.75 / 36 / 28.8; shown "From £33.75 £45") | verified 3/3 |
| Main image | page data, confirmed ×3 | verified 3/3 |
| SKU | agreed (1410750 / 1563370 / 1377000) | verified 3/3 |
| Brand | agreed (the seller: Baronessa / MUCHV / Potiega) | verified 3/3 |
| In stock | page data, confirmed ×3 | verified 3/3 |
| Rating | product 3 confirmed, then agreed (4.7 / 5 / 4.5) | verified 3/3 |
| Description | page data, confirmed ×3 | verified 3/3 |

Counts: agreed 5 · page data confirmed 10 · marked 0 · typed 0 · absent 0.

## Verify

| When (UTC) | Label | Time | Result | Cost |
|---|---|---|---|---|
| 10:53:11 | "Verify 8 fields · up to $0.40" | 151 s | 8/8 verified 3/3 | $0.0000 |

## Coverage check

- From 10:55:57: "Checking 20 more products from the listing…". It was still running at 10:59:12, when my 5-minute wait ran out, and at about 11:01. The result was there at about 11:04, so the check took 5–8 min.
- Result: "8 fields were empty on some of the 20 sampled products — see the rows." The rows are as in finding 1. No proof page was added and there was no re-Verify, because the sampled pages are not products.

## Sample and Extract

- **Sample**: 11:04:11 → 11:05:16 (65 s). Pages walked 1, Product links found 30, Rows extracted shown as 0. After a reload: "Sample rows complete 3 of 3" and "Values not shown 1 value not shown on their page: Description". Recorded **$0.2150**.
- **Extract**, "custom 60 products across custom 2 pages". The button read "Extract", with no amount.
  - Run `582723e6-935a-4eb6-acc1-a01e632200b8`. Clicked 11:05:41; "Open the run" at 11:06:25 (planning 44 s). Completed 11:14:21, "Duration 9 min".
  - "60 of 60 extracted", "60 URLs to extract · 1 listing page walked". `cost_usd` **$0.1106**.
  - Empty cells: "Rating is empty on 2 of 60 products · all from /sale/jewellery-sale".

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 60/60 | 60 |
| Price | 60/60 | 40 |
| Main image | 60/60 | 60 |
| SKU | 60/60 | 60 |
| Brand | 60/60 | 19 (sellers) |
| In stock | 60/60 | 1 |
| Rating | 58/60 | 10 |
| Description | 60/60 | 60 |

### Shown on the page (new)

- Summary: **"60 rows · 100% confidence · 21 values not shown on their page"**.
- Badges: Main image "not checked", Brand **"6 not shown"**, In stock "not checked", Rating **"8 not shown"**, Description **"7 not shown"**.
- Panel, verbatim:
  - "Brand: 6 of 60 values are not on the product's page · from json-ld (brand.name)". Five forgeandfoundry products are listed.
  - "Rating: 8 of 58 values are not on the product's page · from json-ld (aggregateRating.ratingValue)": birthday-bracelet, new-beginnings-bracelet, giftsonline4u leather bracelet, baronessa heart earrings, forgeandfoundry onyx bracelet.
  - "Description: 7 of 60 values are not on the product's page · from json-ld (description)": starry-night jewellery case, clothncard cufflinks, silkpursesowsear earrings, harfi paperclip bracelet, lisaangel Connell's chain.
- **Really wrong?** I captured three flagged products with the app's browser class.
  - **Brand (forgeandfoundry braided bracelet): not wrong.** The page shows "FORGE & FOUNDRY".
  - **Rating (new-beginnings, 4.9): not wrong.** The page shows "4.9".
  - **Description (starry-night): not wrong.** The page shows "An oval shaped velvet jewellery case with celestail detailing, from Lisa Angel." as its own paragraph; the stored text continues "…Lisa Angel.Designed…".
  - The judge found 3 flagged ratings really wrong (finding 3).

## Judge

`docs/testing/results/2026-10-13T11-28-judge-run-notonthehighstreet.md`, `--max-items 40 --max-usd 3`. Estimated ~$2.64; spent **$2.9942**; **stopped at the cap after 31 of 40**, in 12 min 25 s (197 requests, 992,964 input tokens).

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Title | 31 | 30 | 0 | 0 | 0 | 1 | 100% |
| Price | 31 | 31 | 0 | 0 | 0 | 0 | 100% |
| Main image | 31 | 0 | 0 | 0 | 31 | 0 | — |
| SKU | 31 | 31 | 0 | 0 | 0 | 0 | 100% |
| Brand | 31 | 31 | 0 | 0 | 0 | 0 | 100% |
| In stock | 31 | 17 | 0 | 13 | 1 | 0 | 100% |
| Rating | 30 | 26 | 4 | 0 | 0 | 0 | 87% |
| Description | 31 | 30 | 0 | 0 | 0 | 1 | 100% |

- Settled from the page text: **"48 values settled from the page text without a call (saved at least $0.41)"**.
- Shown flag vs. verdict: Wrong & not shown 3 · Wrong & shown 1 · Correct & not shown 6 · Correct & shown 173 · Unflagged 17. **"The free flag caught 3 of the 4 flagged wrong values; it flagged 6 correct values."**
- What the 4 rating wrongs are:
  - **3 real** ("The page shows a rating of 4.8 (12 reviews).", "… of 4.3 (117 reviews).", "… of 5 (5/5, based on 8 reviews)."). The JSON-LD aggregate lags the shown widget, as on sigmabeauty.
  - **1 the judge:** "The page shows a seller rating of 4.7/5, not 4.2." That is the seller's rating box, not the product's.
- SKU is 31/31 correct: the product number is printed on the page.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify | $0.0000 |
| Sample probe | $0.2150 (labelled free) |
| Extract run | $0.1106 (no amount shown) |
| Judge | $2.9942 |
| **Total** | **$3.3198** |

## Screenshots

`notonthehighstreet-01-cards`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-05-coverage` (the 8 "Empty on 20 of 20" rows), `-12-sample`, `-12b-sample-reload`, `-13-extract-before`, `-15-run`.
