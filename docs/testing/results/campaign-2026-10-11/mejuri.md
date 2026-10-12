# mejuri.com — campaign 2, 2026-10-12 (phase 2, batch A, site 7)

**Status: DONE.** Verified 8/8 on 3 proof pages. A 4th proof page from the coverage line could not be verified and was dropped again. Extract returned **48 of 48**, the whole listing. The judge found **no real wrong value**: its one "wrong" is "MYR 910" vs "910". The judge cost $3.09.

- The listing is the one the pre-screen saved: https://mejuri.com/collections/rings
- The api-server's browser is redirected to the **Malaysia** store, `/my/en/` with "MYR 615" prices.

## Findings in the product (most important first)

1. **The coverage line's proof page can't be verified, and the only way out is to drop it again.** "Use a sampled product as proof page for Description" added `organic-dome-nesting-ring-set`.
   - Its visible description slot holds the collection blurb "Dôme collection is art you can wear. Crafted to embrace the duality between form and flow, structure and movement.", which is not in the capture's box map.
   - Typing that blurb gave **"fails on product 4 3/4"**: AI asked, $0.0826.
   - Typing the page's own JSON-LD description ("Featuring two Organic Dôme Nesting Rings designed to nest perfectly together …") failed again: "Re-verify 1 field · **up to $0.05**", **$0.0838**.
     - Its near miss is the *identical* text with a trailing space, reason `not_found`.
     - What the screen does not say: a JSON-LD path is wrong on products 1–3, whose descriptions were marked from the page.
   - Dropping product 4 brought back "Re-verify 8 fields · up to $0.40", which passed 8/8 3/3 for $0. The coverage check then repeated "Empty on 3 of 20 sampled products · Use as proof page" exactly.
2. **The capture lays the product column out off-screen.** On products 1 and 3, a grey modal backdrop covers the page ("The Material Guide" drawer is open). The title, rating and price boxes sit at **x = 3474** on a 1280-px screenshot, so the customer can't see or mark them. Product 2 (x = 756) was fine.
3. **Title was suggested as the variant option on every product:** "10k Yellow Gold / 3", "18k Gold Vermeil / 4", "Sterling Silver / 4" and, on product 4, "Sterling Silver, 18k Gold Vermeil / Lab Grown White Sapphire / 4".
4. **Description page data is SEO text on some products.** For example: "Browse Mejuri's collection of stacker rings and discover the Duo Beaded Stacker Ring … Explore our new ar…". I marked the visible paragraph instead.
5. **Dôme Figure Ring's Main image may belong to another product.** Both its Sterling Silver and 18k Gold Vermeil rows carry `4-BOLERO_BoldWideRing_V_BACK_012_new_….png`. It is the only duplicate image in 48 rows. Not checked further; the judge marks every image "unverifiable".
6. **The run recorded $0.0763 with no other AI work of mine on the server** (11:49–11:58). Planning costs model calls, while Extract shows no amount.
7. Sample: as on gymshark, the panel read "Rows extracted 0" with no table until a reload ("Sample rows complete 3 of 3"). The probe recorded **$0.1006** under "No AI. Free.".
8. The run log reads: "warning: api-param pagination not applied on https://mejuri.com/collections/rings: no intercepted JSON response carried page 1's detail URLs (6 intercepted JSON response(s) considered)" and "warning: no pagination detected … planned page 1 only". 48 URLs is the whole listing, which has no pager.

## Proof pages

1. https://mejuri.com/my/en/products/stacker-ring?Material=10k+Yellow+Gold
2. https://mejuri.com/my/en/products/duo-beaded-stacker-ring?Material=18k+Gold+Vermeil
3. https://mejuri.com/my/en/products/diamonds-band?Material=14k+Yellow+Gold&Stone=Natural+Diamond. This replaced `dome-figure-ring?Material=Sterling+Silver`, whose description isn't in the capture.
4. (added, then dropped) https://mejuri.com/my/en/products/organic-dome-nesting-ring-set?Material=Sterling+Silver%2C+18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire

| Field | What it needed | Verdict |
|---|---|---|
| Title | **typed** "Stacker Ring" and "Diamonds Band" (their headings are off-screen); **marked** "Duo Beaded Stacker Ring" | verified 3/3 |
| Price | agreed (615 / 435 / 3250; "MYR 615" etc. in the box map) | verified 3/3 |
| Main image | page data, confirmed (the file names name each product) | verified 3/3 |
| SKU | page data, confirmed (`p2291815148`, `p62709243`, `p62706511`, which look like product IDs) | verified 3/3 |
| Brand | "same on every product" Mejuri → Accept anyway | verified 3/3 |
| In stock | agreed | verified 3/3 |
| Rating | "same on every product" 4.8 → Accept anyway (4.8 next to each heading) | verified 3/3 |
| Description | **marked** the visible paragraph ×3 | verified 3/3 |

Counts: agreed 4 (two of them via "Accept anyway"), page data confirmed 2, marked 2, typed 1, absent 0.

## Verify

| When (UTC) | Label | Result | AI / cost |
|---|---|---|---|
| 11:08:59 | "Verify 8 fields · up to $0.40" | 8/8 3/3 | 0 / $0.00 |
| 11:18:07 | "Re-verify 8 fields · up to $0.40" (p4 with the typed blurb) | 7/8, Description "fails on product 4 3/4" | 1 / $0.0826 |
| 11:19:40 | "Re-verify 1 field · up to $0.05" (p4 with the JSON-LD text) | the same | 1 / $0.0838 |
| 11:20:44 | "Re-verify 8 fields · up to $0.40" (p4 dropped) | 8/8 3/3 | 0 / $0.00 |

## Coverage

- **First** (11:09:07 → 11:15:39, 6 min 32 s): "2 fields were empty on some of the 20 sampled products — see the rows."
  - `description`: "Empty on 3 of 20 sampled products" + "Use as proof page". The products were dome-figure-ring and organic-dome-nesting-ring-set ×2.
  - `rating`: "Empty on 1 of 20 sampled products · it shows no rating in the page data" + "Use as proof page".
- I used "Use as proof page" once, for Description; see finding 1.
- **After the drop** (11:20:46 → 11:27:40): the same two lines.

## Sample and Extract

- **Sample:** 11:46:31 → 11:48:36 (125 s), Pages walked 1, Product links found 30, 3 of 3 after a reload. Probe $0.1006.
- **Extract:** "custom 60 products across custom 2 pages". Planning took 98 s before "Open the run" appeared.
  - Run `64bf2266-bb97-45ee-a625-6bf87a8a65fb`: 11:49:11 → 11:58:33, Duration "9 min". "Done", "48 of 48 extracted", "48 URLs to extract · 1 listing page walked". `cost_usd` $0.0763.
  - Empty cells: "Rating is empty on 1 of 48 products · all from /collections/rings" and "Description is empty on 6 of 48 products · all from /collections/rings".
  - The 6 empty descriptions are Dôme Figure Ring ×2, Organic Dôme Nesting Ring Set ×2, Beverly Ring and Ziggy Ring. Rating is empty on the Interconnected Strike Pavé ring.

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 48/48 | 35 |
| Price | 48/48 | 16 |
| Main image | 48/48 | 47 |
| SKU | 48/48 | 48 |
| Brand | 48/48 | 1 |
| In stock | 48/48 | 1 |
| Rating | 47/48 | 7 |
| Description | 42/48 | 31 |

## Judge

`docs/testing/results/2026-10-12T11-58-judge-run-mejuri.md`. It estimated "~$2.83 … ~$3.11" and actually cost **$3.0930**, in 18 min 42 s.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 48 | 46 | 0 | 2 | 0 | 0 | 0 | 100% |
| Price | 48 | 45 | 1 | 2 | 0 | 0 | 0 | 98% |
| Main image | 48 | 0 | 0 | 0 | 48 | 0 | 0 | — |
| SKU | 48 | 0 | 0 | 47 | 1 | 0 | 0 | — |
| Brand | 48 | 48 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 48 | 28 | 0 | 14 | 6 | 0 | 0 | 100% |
| Rating | 47 | 45 | 0 | 2 | 0 | 0 | 1 | 100% |
| Description | 42 | 42 | 0 | 0 | 0 | 0 | 6 | 100% |

The one Price "wrong" is a limit of the judge: "The page shows the price as "MYR 910", not just "910"."

## Spend

| Item | Cost |
|---|---:|
| Verify ×4 | $0.1664 (two failed p4 attempts) |
| Sample probe | $0.1006 |
| Extract | $0.0763 |
| Judge | $3.0930 |

## Screenshots

- Proof pages: `mejuri-00-cards-as-found`, `-01-cards`, `-02-table-before`, `-03-before-verify`, `-04-after-verify`.
- Coverage and product 4: `-05-coverage`, `-07-before-use-as-proof`, `-08-fourth-card`, `-09-after-verify` (3/4), `-10-after-verify`, `-11-after-drop-p4`, `-12-after-verify` (8/8 3/3), `-14-coverage-3`.
- Extract: `-12-sample`, `-12b-sample-reload`, `-13-extract-before`, `-15-run`.
