# lacoste.com — campaign 2, 2026-10-13 (phase 2, batch C, site 17)

**Status: DONE.** I found a real listing first. The pre-screen's "1 products found" was a language link. The site verified 8/8 on 3 proof pages for $0.00, and coverage found every field on 18 more. Extract returned 60 of 60 rows in 14 min for $0.00, but those 60 rows are only 18 distinct products (colour URLs). The run flagged **109 values not shown on their page**: every SKU and 49 of 53 ratings. The judge stopped at its $3 cap after 18 items ($2.9895). Its wrongs are the same SKUs and ratings, and the flag predicted all 14.

## The listing

- **The pre-screen's guess was not a listing.**
  - `https://lacoste.com/en-gb/men/clothing/polos`, and `https://www.lacoste.com/gb/lacoste/men/clothing/polos/`, both gave "1 products found". The one "product" was the language link "english" → `https://lacoste.com/mea/en/`.
  - The api-server's browser is sent to Lacoste's Middle-East site. `…/mea/en/men/clothing/polos/` reads **"That address led to lacoste.ae. Paste a page on lacoste.com."**
- **Country paths work.** `/us/…/polos/` gave "18" and `/fr/…/polos/` "26".
- **The listing I used** is `https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/`: "20 products found · a pager too", found in 31 s.
  - The 20 are colour swatches of **2** products: PH5522-00 ×5 and PH4012-00 ×5, each linked twice.
  - The swatch cards are titled by colour ("Blanc - 001", "Navy blue - F9F").
- My own plain Chromium gets **HTTP 403 "Access Denied"** (Akamai) on every lacoste.com page. The app's stealth browser gets through.

## Findings in the product (most important first)

1. **The shown flag flags a whole column the Verify step certified without a word.**
   - SKU: **"SKU: 60 of 60 values are not on the product's page · from json-ld (offers[0].sku)"**.
     - The stored SKUs are EAN barcodes (3614030789520…), taken from the first size's offer.
     - The page prints **"Product Ref. PH5522-00"**, which I read through the app's capture browser on two flagged pages.
     - At Verify these were "only in the page data on product 1/2/3" and I confirmed them. Nothing there said the value is not on the page: `not on this page` is only for typed values.
   - Rating: **"Rating: 49 of 53 values are not on the product's page · from json-ld (aggregateRating.ratingValue)"**.
     - The page shows stars and "Reviews (202)", never 4.8564.
2. **60 rows hold 18 products.** The finder and the run take every `?color=` URL as a product, as on skullcandy (`?variant=`) and ruggable.
   - L1212-00 alone is 13 rows.
   - The coverage check's "18 more products" were mostly the same 2 products in other colours.
   - SKU and Main image differ per colour; title, price, rating and description repeat.
3. **The cookie consent modal stays open on every capture** ("Welcome to Lacoste … CHOOSE PREFERENCES / ACCEPT"). It covers the gallery and half the buy box. The title and price at the right edge stay visible, so marking and judging still worked.
4. **The finder sees only the first 2 products; the walk sees 30 links.**
   - Find products: 20 links, 2 products.
   - Sample: "Pages walked 1 · Product links found 30".
   - The run: "60 URLs to extract · 2 listing pages walked".
5. **Sample is labelled "No AI. Free." and recorded $0.0993** (probe run `f682c7e7`, `partial`). The panel showed "Rows extracted 0" after "3 rows extracted".
6. **Extract planning took 2 min 24 s** behind the spinner (09:14:09 → 09:16:33).
7. The tab titles of pasted products read **"Slim Fit L.12.12 Original Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 | Lacoste"** on the proof-page cards. The found product kept its plain name.

No `not the page's heading on product n` reason appeared, and no `not on this page` cell word. Nothing was typed.

## Proof pages

1. https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031 (as found)
2. https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH4012-00.html?color=001. It replaced "Blanc - 001", a colourway of product 1.
3. https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=001. I pasted it by product code, since the finder offered only two products. It replaced a third PH5522 colourway.

| Field | What it needed | Verdict |
|---|---|---|
| Title | agreed | verified 3/3 |
| Price | agreed (110 / 95 / 95; shown "£110.00", "£95.00") | verified 3/3 |
| Main image | agreed | verified 3/3 |
| SKU | page data, confirmed ×3 (EANs 3614030789520 / 3614037529983 / 3570671739495; page shows "Product Ref. PH5522-00") | verified 3/3 |
| Brand | page data "Lacoste", confirmed ×3 | verified 3/3 |
| In stock | page data, confirmed ×3 | verified 3/3 |
| Rating | page data, confirmed ×3 (4.8564 / 4.6635 / 4.7672; page shows stars only) | verified 3/3 |
| Description | agreed | verified 3/3 |

Counts: agreed 4 · page data confirmed 12 (4 fields × 3) · marked 0 · typed 0 · absent 0.

## Verify

| When (UTC) | Label | Time | Result | Cost |
|---|---|---|---|---|
| 09:05:03 | "Verify 8 fields · up to $0.40" | 10 s | 8/8 verified 3/3 | $0.0000 |

## Coverage check

- 09:06:24: "Checking 18 more products from the listing…". It was still running when my 5-minute wait ended at 09:10:04.
- At 09:11:47: **"Checked 18 more products from the listing: every field was found on all of them."**
- No "Use as proof page" was offered, so no re-Verify followed.

## Sample and Extract

- **Sample**: 09:11:58 → 09:13:53 (115 s). Pages walked 1, Product links found 30, Rows extracted shown as 0 (3 extracted). Recorded $0.0993.
- **Extract**, "custom 60 products across custom 2 pages". The button read "Extract", with no amount.
  - Run `730a8df2-4435-485c-979c-1c8424b62fcd`. Clicked 09:14:09; "Open the run" at 09:16:33 (planning 144 s). Completed 09:28:17, "Duration 14 min".
  - "60 of 60 extracted", "60 URLs to extract · 2 listing pages walked". $0.0000.
  - Empty cells: "Rating is empty on 7 of 60 products · all from /gb/lacoste/men/clothing/polo-shirts/". These are products with no reviews (AG792, DH0215 and others), which is right.

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 60/60 | 17 |
| Price | 60/60 | 8 |
| Main image | 60/60 | 60 |
| SKU | 60/60 | 60 |
| Brand | 60/60 | 1 |
| In stock | 60/60 | 1 (true) |
| Rating | 53/60 | 12 |
| Description | 60/60 | 18 |

### Shown on the page (new)

- Summary: **"60 rows · 100% confidence · 109 values not shown on their page"**.
- Badges: Main image "not checked", SKU **"60 not shown"**, In stock "not checked", Rating **"49 not shown"**. Title, Price, Brand and Description had none.
- Panel, verbatim: "SKU: 60 of 60 values are not on the product's page · from json-ld (offers[0].sku)" and "Rating: 49 of 53 values are not on the product's page · from json-ld (aggregateRating.ratingValue)". Each lists 5 addresses with "Use as proof page": PH5522-00 001, PH5522-00 5I1, PH4012-00 001, 031 and 166.
- **Are they really wrong?** I captured PH5522-00 `?color=001` and PH4012-00 `?color=166` with the app's browser class.
  - **SKU:** the pages print "Product Ref. PH5522-00" and "Product Ref. PH4012-00", not the stored 3614030789445 and 3614037530309. As a shown value, the stored SKU is wrong. It is the site's barcode for the first size, not the reference a customer sees.
  - **Rating:** the pages show stars and "Reviews (202)" or "Reviews (318)", with no number. The stored decimals are the site's own aggregate, so the values are not wrong; they are just not printed.

## Judge

`docs/testing/results/2026-10-13T09-32-judge-run-lacoste.md`, `--max-items 40 --max-usd 3`. Estimated ~$2.60; it spent **$2.9895** and **stopped at the cap after 18 of 40**, in 7 min 55 s. Its notes say 179 requests and 989,297 input tokens.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Correct % |
|---|---:|---:|---:|---:|---:|---:|
| Title | 18 | 18 | 0 | 0 | 0 | 100% |
| Price | 18 | 18 | 0 | 0 | 0 | 100% |
| Main image | 18 | 0 | 0 | 0 | 18 | — |
| SKU | 18 | 0 | 3 | 15 | 0 | 0% |
| Brand | 18 | 18 | 0 | 0 | 0 | 100% |
| In stock | 18 | 7 | 1 | 9 | 1 | 88% |
| Rating | 16 | 3 | 11 | 0 | 2 | 21% |
| Description | 18 | 18 | 0 | 0 | 0 | 100% |

- Settled from the page text: **"18 values settled from the page text without a call (saved at least $0.15)"**. These were the 18 descriptions, by their first 80 characters.
- Shown flag vs. verdict: Wrong & not shown 14 · Wrong & shown 0 · Correct & not shown 1 · Correct & shown 74 · Unflagged 8. **"The free flag caught 14 of the 14 flagged wrong values; it flagged 1 correct value."**
- What the 15 wrongs are:
  - **Rating ×11: judge vocabulary.** "The page shows a star rating of approximately 4.5 stars (based on 91 reviews), not 4.7363." The page has no number.
  - **SKU ×3: the judge says "no SKU"** ("The page shows no SKU value, only a color code labeled "ZDQ.""). That agrees with the flag: the EAN is not shown.
  - **In stock ×1: judge vocabulary** ("No value for "In stock" is shown on the page.").
  - So the flag's 14 of 14 here is agreement about "not printed", not 14 errors caught. The real problem it surfaces is the SKU column, where the shown reference differs from the stored barcode.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify | $0.0000 |
| Sample probe | $0.0993 (labelled free) |
| Extract run | $0.0000 |
| Judge | $2.9895 |
| **Total** | **$3.0888** |

## Screenshots

`lacoste-00-as-found`, `-01-cards`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-05-coverage`, `-12-sample`, `-13-extract-before`, `-15-run`.
