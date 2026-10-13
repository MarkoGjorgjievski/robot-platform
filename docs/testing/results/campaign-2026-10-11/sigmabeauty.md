# sigmabeauty.com — campaign 2, 2026-10-13 (phase 2, batch C, site 16)

**Status: DONE.** Verified 8/8 on 3 proof pages after one paid Verify ($0.1031, Brand failed) and one free re-Verify. The coverage check found every field on 16 more products. Extract returned 60 of 60 in 11 min for $0.00. The run flagged 8 values as not shown on their page. The judge stopped at its $3 cap after 26 items ($2.9906). It confirmed 2 real wrong ratings, and the shown flag had caught both.

- Website `sigmabeauty` in project "Campaign 2 2026-10-11". The listing is the one the pre-screen saved (`https://sigmabeauty.com/brushes`, "19 products found · a pager too"). The run walked it and `/collections/view-all-brushes?page=2`.
- The pre-screen called it Magento, but it is Shopify (`/cdn/shop/`, `/products/`). The api-server's browser gets the Malaysia storefront: "RM160.00 MYR". My own Chromium on the same machine gets "$38.00" (USD). JSON-LD offers carry `"price": 38, "priceCurrency": "USD"`.
- The capture lays the page out normally. The title, stars, "4.9 | 1917 Reviews", the price, the open description and "SKU: F80-1" are all on the first tile. A cookie banner covers the middle of tile 1 but nothing of the buy box.

## Findings in the product (most important first)

1. **The shown flag caught two real wrong ratings.** Run values Rating 4.9 on `/products/4dhd-kabuki` and `/products/basic-eye-kit` were flagged "not on the product's page". Both pages show **4.8** (I opened 4dhd-kabuki live: "★★★★★ 4.8 | 76 Reviews"). The stored 4.9 is the JSON-LD `aggregateRating.ratingValue`, which lags the review widget. The judge agreed on both ("The page shows a rating of 4.8.").
2. **The shown flag on Brand is inconsistent.** 50 of 60 rows store the Shopify vendor "SigmaBeauty", and the page never prints that word: it shows a "SIGMA" logo image, and its text says "Sigma Beauty". The flag marked 6 of the 50 not shown and counted the other 44 shown. I did not establish why, since the live innerText of both a flagged page (e20) and an unflagged page (f80) lacks "sigmabeauty". The judge called one of them wrong ("The page shows the brand as "SIGMA."") and 25 correct.
3. **The honest brand does not verify.** I typed "Sigma Beauty" on products 1–2. Product 3's page data already said "Sigma Beauty". The result was **"fails on products 1, 2 and 3 0/3"** with "Not found on this page. Check the value, or say where it is.", although "Sigma Beauty" is the `og:site_name`, the JSON-LD `offers.seller.name` on every page, and product 3's JSON-LD `brand.name`. It cost $0.1031 (one AI call). I retyped products 1–2 as the JSON-LD `brand.name` "SigmaBeauty", which verified 3/3 for $0.00. This is gymshark's `og:site_name` gap from batch A again.
4. **"only in the page data on product 1"** was the status of SKU, Brand, In stock and Description before I confirmed anything. Product 1's page prints "SKU: F80-1", so for SKU the sentence is false. Each "Confirm … from the page data" confirmed one product only, and the status then moved on to "only in the page data on product 2".
5. **Sample is labelled "No AI. Free." and recorded $0.1014** (probe run `c554f3fa`, `partial`). The panel read "Rows extracted 0" after "3 rows extracted", as in batches A and B.
6. **The judge's estimate was low.** It estimated "~$2.37 … ~$2.60 with the 10% retry/explain allowance; cap $3.00" for 40 items and stopped at the cap after 26. Its notes say 187 requests and 992,502 input tokens, about $0.016 a call against the $0.0086 it estimates with. The report itself says "per-call estimate not re-measured since page text was added".
7. Price 160 was "same on every product — check it", which is true: three brushes at RM160.00. "Accept anyway" took it.

No `not the page's heading on product n` reason appeared, and no typed value read `not on this page`. That includes the typed "Sigma Beauty", which then failed Verify as "Not found on this page".

## Proof pages

1. https://sigmabeauty.com/products/f80-flatkabuki-chrome
2. https://sigmabeauty.com/products/f80-air-flat-kabuki (a different brush from p1, not a colourway)
3. https://sigmabeauty.com/products/f48-soft-coverage ("Sold out")

| Field | What it needed | Verdict (final) |
|---|---|---|
| Title | agreed | verified 3/3 |
| Price | "same on every product — check it" → Accept anyway (160 ×3; shown "RM160.00 MYR") | verified 3/3 |
| Main image | agreed | verified 3/3 |
| SKU | page data, confirmed ×3 (F80-1 / F80-3 / F48) | verified 3/3 |
| Brand | typed "Sigma Beauty" p1–2 + page data p3 → failed 0/3; typed "SigmaBeauty" p1–2 + "Sigma Beauty" p3 (each page's JSON-LD) | verified 3/3 |
| In stock | p1 confirmed, then "agreed" (In stock / In stock / Out of stock; p3 shows "Sold out") | verified 3/3 |
| Rating | agreed (4.9 / 5 / 4.9) | verified 3/3 |
| Description | page data, confirmed ×3 (includes the collapsed HOW TO USE / DETAILS / TECHNOLOGY text) | verified 3/3 |

Counts: agreed 4 (1 via Accept anyway) · page data confirmed 8 · marked 0 · typed 2 (Brand p1–2) · absent 0.

## Verify

| When (UTC) | Label | Time | Result | AI calls / cost |
|---|---|---|---|---|
| 08:20:19 | "Verify 8 fields · up to $0.40" | 20 s | 7/8: Brand "fails on products 1, 2 and 3 0/3" | $0.1031 |
| 08:26:55 | "Re-verify 1 field · up to $0.05" | 5 s | 8/8 verified 3/3 | $0.0000 |

## Coverage check

- After the first Verify: none, because the Verify did not pass. My script waited 5 min and saw no coverage line.
- After the re-Verify (08:27:25 → 08:30:05, 2 min 40 s): **"Checked 16 more products from the listing: every field was found on all of them."** No "Use as proof page" was offered, so no re-Verify followed.

## Sample and Extract

- **Sample**: 08:30:17 → 08:31:17 (60 s). "walks the first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free." Pages walked 1, Product links found 30, Rows extracted shown as 0. Recorded $0.1014.
- **Extract**, budget "custom 60 products across custom 2 pages". The button read "Extract", with no amount.
  - Run `c6c561de-336d-4e7e-b020-bb8b4ee29f6b`. Clicked 08:31:33; "Open the run" at 08:32:11 (planning 38 s). Completed 08:43:00, "Duration 11 min".
  - "Done", "60 of 60 extracted", "60 URLs to extract · 2 listing pages walked". `cost_usd` **$0.0000**.
  - Empty cells: "SKU is empty on 3 of 60 products · all from /brushes"; "Rating is empty on 4 of 60 products · all from /brushes". These are sets such as perfect-blend-eye-brush-set.

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 60/60 | 60 |
| Price | 60/60 | 25 |
| Main image | 60/60 | 60 |
| SKU | 57/60 | 57 |
| Brand | 60/60 | 2 ("SigmaBeauty" ×50, "Sigma Beauty" ×10) |
| In stock | 60/60 | 2 |
| Rating | 56/60 | 4 |
| Description | 60/60 | 60 |

### Shown on the page (new)

- Summary line: **"60 rows · 100% confidence · 8 values not shown on their page"**.
- Column badges: Main image "not checked", Brand **"6 not shown"**, In stock "not checked", Rating **"2 not shown"**. Title, Price, SKU and Description had no badge.
- The panel "Values not shown on their page", verbatim:
  - "A value the page does not show for that product is usually another product's or the page's SEO text. Add one of these products as a proof page and mark the field there."
  - "Brand: 6 of 60 values are not on the product's page · from json-ld (brand.name)" → /products/f24-all-over-powder-brush, /products/e38-diffusedcrease, /products/e20-short-shader-chrome, /products/e30-pencil-brush-black-chrome, /products/essential-travel-brush-set, each with "Use as proof page". Only 5 of the 6 are listed.
  - "Rating: 2 of 56 values are not on the product's page · from json-ld (aggregateRating.ratingValue)" → /products/4dhd-kabuki, /products/basic-eye-kit, each with "Use as proof page".
- **Are they really wrong?**
  - **Rating:** yes, both (4.8 shown, 4.9 stored; I checked 4dhd-kabuki live and the judge read 4.8 on both).
  - **Brand:** the flagged "SigmaBeauty" is not printed on e38 or e20 (I opened e38 live: the text says "Sigma Beauty" and the logo "SIGMA"). Whether that makes it wrong is a matter of form: it is the site's own vendor name. The same value on 44 other rows went unflagged (finding 2).

## Judge

`docs/testing/results/2026-10-13T08-46-judge-run-sigmabeauty.md`, `--max-items 40 --max-usd 3`. The judge estimated ~$2.60 and spent **$2.9906**. It **stopped at the $3.00 cap after 26 of 40** items, in 12 min 15 s.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Title | 26 | 25 | 0 | 0 | 0 | 1 | 100% |
| Price | 26 | 26 | 0 | 0 | 0 | 0 | 100% |
| Main image | 26 | 0 | 0 | 0 | 26 | 0 | — |
| SKU | 26 | 21 | 4 | 0 | 0 | 1 | 84% |
| Brand | 26 | 25 | 1 | 0 | 0 | 0 | 96% |
| In stock | 26 | 26 | 0 | 0 | 0 | 0 | 100% |
| Rating | 26 | 24 | 2 | 0 | 0 | 0 | 92% |
| Description | 26 | 26 | 0 | 0 | 0 | 0 | 100% |

- Settled from the page text: **"8 values settled from the page text without a call (saved at least $0.07)"**. These were 8 ratings (Ct), for example "4.9" beside the stars.
- Shown flag vs. verdict: Wrong & not shown 2 · Wrong & shown 5 · Correct & not shown 1 · Correct & shown 146 · Unflagged 26. **"The free flag caught 2 of the 7 flagged wrong values; it flagged 1 correct value."**
- What the 7 wrongs are:
  - **Rating ×2: real** (4.9 stored, 4.8 shown). Both were flagged not shown.
  - **SKU ×4: the judge's own limit.** "The page shows no SKU value." The SKU is printed as "SKU: F80-1" near the bottom of the first screen, or below it. These verdicts should have been "not on page", not "wrong". The shown flag (true) was right.
  - **Brand ×1: judgement.** For "SigmaBeauty", "The page shows the brand as "SIGMA."". The judge called the same value correct on 15 other items.
- "Correct & not shown 1": Brand "SigmaBeauty" on glam-n-go-mini-eye-brush-set. This is the flag's form question from finding 2.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify (Brand failed) | $0.1031 |
| Re-Verify | $0.0000 |
| Sample probe | $0.1014 (recorded; labelled free) |
| Extract run | $0.0000 |
| Judge | $2.9906 |
| **Total** | **$3.1951** |

## Screenshots

`sigmabeauty-00-cards-as-found`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-05-brand-fail`, `-06-after-verify`, `-06-coverage`, `-12-sample`, `-13-extract-before`, `-15-run`.
