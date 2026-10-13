# puma.com — campaign 2, 2026-10-13 (phase 2, batch C, site 18)

**Status: DONE**, on the US storefront.

- **Verify:** 8/8 on 3 proof pages, then 4/4 with a coverage proof page.
  - The first Verify cost $0.1004: SKU failed as "Several places match".
  - The two re-Verifies were free. SKU certified only after I marked the "Style: …" line, so the stored SKU carries the label.
- **Extract:** 48 of 48 rows in 15 min, $0.00.
  - The run flagged **5 descriptions not shown on their page**. They are really stale JSON-LD copy.
- **Judge:** stopped at its $3 cap after 33 items ($2.9439). It called 4 descriptions wrong, the same ones the flag caught.

## The listing

- **The pre-screen's listing went to Malaysia.** `https://puma.com/uk/en/men/shoes` sends the api-server's browser to `/my/en/…`, which gave "21 products found" (RM prices).
  - Its three product cards each read **"redirected to https://my.puma.com/my/en/home"**. "Try again" ×3 gave the same.
- **The German store has no ratings.** `https://eu.puma.com/de/de/herren/schuhe` worked ("15 products found · a pager too"), but its product pages show no ratings at all.
  - No "Bewertung" or "Sterne" in the capture, and no `aggregateRating` in the HTML.
  - Rating was empty on all three, so the site would end at kith's "Rating needs a value on at least two products".
  - The capture there also kept a "Standort wählen" (choose location) popup over the price: "Du befindest dich scheinbar in Malaysia…".
- **I used** `https://us.puma.com/us/en/men/shoes`: "19 products found · a pager too". eu./us. sub-domains were accepted as the same website.

## Findings in the product (most important first)

1. **The shown flag caught real stale descriptions.** "Description: 5 of 48 values are not on the product's page · from json-ld (description)".
   - Deviate NITRO 4 (`312123`) stores "Deviate 4 isn't just fast – its too fast. 15g lighter…", but the page reads "The Deviate NITRO™ 4 is built for speed on everyday runs…".
   - Deviate NITRO Elite 4 (`312127`) stores "When fast isn't fast enough, you go beyond…", but the page reads "These Deviate NITRO™ Elite 4 Running shoes are made for race day…".
   - I captured both live with the app's browser class.
   - Proof page 3 (Deviate Pure NITRO) is one of the five. Its JSON-LD says "Road Running Shoes are ready for training and daily runs", while the page says "Running Shoes are ready for training and daily speed runs". **Verify certified it 3/3 anyway**: I confirmed page data the page does not show, and nothing at Verify said so.
   - The judge called the same 4 judged items wrong. "The free flag caught 4 of the 6 flagged wrong values; it flagged 0 correct values."
2. **SKU: the honest shown value can't be typed, and marking stores the label.**
   - The page data offered EANs (4067979315715…), not shown on the page. The page prints "Style: 398846_01".
   - Typed "398846_01" ×3 gave **"fails on products 1, 2 and 3 0/3"** with "Several places match. Add what makes yours different to the description." That cost $0.1004.
   - Marking the "Style: 398846_01" line on the screenshot stores **"Style: 398846_01"**, label included. It verified for $0.00, so all 48 rows store "Style: …".
   - Retyping product 1 as "398846_01" after marking it **deleted its mark** (`verificationSet.marks.sku` lost that URL), so a clean value and a location hint cannot coexist.
3. **`not the page's heading on product 1`** (Title, first table). The heading on product 1 is "Speedcat OG" over a second line "Sneakers"; the suggestion "Speedcat OG Sneakers" is the breadcrumb and JSON-LD name.
   - **Right** for product 1. But products 2 and 3 have the same layout ("Suede Classic" / "Sneakers", "Deviate Pure NITRO™" / "Men's Running Shoes") and were not named. The coverage product 4 ("Speedcat Dressed" / "Sneakers") was named: `not the page's heading on product 4`.
   - Accepting each cell stored a mark on the breadcrumb (`//ul[@data-uds-child="breadcrumb-list"]/li…`). The run's titles are the breadcrumb's full names, which the judge called correct 31/31.
4. **Rating "0" is suggested for a product with no reviews** (Speedcat Dressed, twice: as a replacement product 2 and as the coverage product 4). Ruggable had the same in batch B. I replaced it as product 2 and answered "Not on this product" as product 4.
5. **The mark popover preselects the wrong field.** Clicking the "Style:" line opened "Title · already on this product" with Title selected, on all four products. Batch A saw the same with "SKU".
6. **The coverage line offers "Use as proof page" again after the answer.** The 1st check (16 sampled) read "Empty on 5 of 16 sampled products"; I added Speedcat Dressed and answered Rating "Not on this product". The 2nd check (15 sampled) read "Empty on 4 of 15 sampled products" with "Use as proof page" again. This is ridge's and gymshark's shape.
7. **Sample is labelled "No AI. Free." and recorded $0.0333** (probe `56f35494`).
8. **"13 Colors, Speedcat OG Sneakers, Price, $100, Best Seller"** is the card title the finder gives (the link's aria text). It stays as the product's name on the card and in the selected-cell bar.

## Proof pages

1. https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=01 (as found)
2. https://us.puma.com/us/en/pd/suede-classic-sneakers/399781?swatch=01. Pasted to replace swatch=02, a colourway of product 1. A first replacement, Speedcat Dressed, had rating "0".
3. https://us.puma.com/us/en/pd/deviate-pure-nitro-mens-running-shoes/313904?swatch=19 (as found)
4. https://us.puma.com/us/en/pd/speedcat-dressed-sneakers/407829?swatch=01 (coverage, "Use a sampled product as proof page for Rating")

| Field | What it needed | Verdict (final) |
|---|---|---|
| Title | `not the page's heading on product 1` → accepted each cell (breadcrumb name) | verified 4/4 |
| Price | agreed (100 / 90 / 150 / 110) | verified 4/4 |
| Main image | page data, confirmed | verified 4/4 |
| SKU | typed Style codes → "Several places match…" 0/3; marked "Style: …" ×4 | verified 4/4 (value "Style: 398846_01") |
| Brand | page data "PUMA", confirmed | verified 4/4 |
| In stock | agreed / confirmed | verified 4/4 |
| Rating | agreed (4.4 / 4.6 / 4.8); product 4 absent (suggested "0") | verified 4/4 |
| Description | agreed / confirmed (p3's page data differs from the shown copy) | verified 4/4 |

Counts on products 1–3: agreed 4 (Price, In stock, Rating, Description) · page data confirmed 3 rows (Main image, Brand, Description p3) · marked 1 (SKU ×3) · typed 1 (SKU, replaced by the marks) · absent 0. Product 4: absent 1 (Rating).

## Verify

| When (UTC) | Label | Time | Result | Cost |
|---|---|---|---|---|
| 09:55:45 | "Verify 8 fields · up to $0.40" | 20 s | 7/8: SKU "fails on products 1, 2 and 3 0/3" ("Several places match…") | $0.1004 |
| 10:02:29 | "Re-verify 1 field · up to $0.05" (SKU marked) | 5 s | 8/8 verified 3/3 | $0.0000 |
| 10:07:59 | "Re-verify" with product 4 | 5 s | 8/8 verified 4/4 | $0.0000 |

## Coverage check

- **1st** (10:02:49 → 10:06:50, 4 min 1 s): "1 field was empty on some of the 16 sampled products — see the row." Rating: "Empty on 5 of 16 sampled products" + "Use as proof page". These are new shoes with no reviews.
- "Use as proof page" → product 4, Speedcat Dressed. Rating suggested "0" → "Not on this product".
- **2nd** (10:08:19 → 10:12:05, 3 min 46 s): Rating "Empty on 4 of 15 sampled products" + "Use as proof page" offered again.

## Sample and Extract

- **Sample**: 10:12:18 → 10:14:48 (150 s). Pages walked 1, Product links found 24, "Pagination detected mechanical: url-pattern", Rows extracted shown as 0 (3 extracted). Recorded $0.0333.
- **Extract**, "custom 60 products across custom 2 pages". The button read "Extract", with no amount.
  - Run `3ca46d0a-9403-4569-a994-ffd2d2d6f7c3`. Clicked 10:15:00; "Open the run" at 10:15:27 (planning 27 s). Completed 10:29:39, "Duration 15 min".
  - "48 of 48 extracted", "48 URLs to extract · 2 listing pages walked". $0.0000.
  - Empty cells: "Rating is empty on 19 of 48 products · all from /us/en/men/shoes". These are products with no reviews.

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 48/48 | 30 |
| Price | 48/48 | 15 |
| Main image | 48/48 | 47 |
| SKU | 48/48 | 47 ("Style: 109135_03" …) |
| Brand | 48/48 | 1 |
| In stock | 48/48 | 1 |
| Rating | 29/48 | 10 |
| Description | 48/48 | 31 |

### Shown on the page (new)

- Summary: **"48 rows · 100% confidence · 5 values not shown on their page"**.
- Badges: Main image "not checked", In stock "not checked", Description **"5 not shown"**.
- Panel, verbatim: "Description: 5 of 48 values are not on the product's page · from json-ld (description)". It lists 312123 swatch 17, 16 and 19, 313904 swatch 19 (proof page 3) and 312127 swatch 09, each with "Use as proof page".
- **Really wrong?** Yes. On the two I captured (312123 swatch 17 and 312127 swatch 09) the shown description is a different text from the stored one (finding 1).

## Judge

`docs/testing/results/2026-10-13T10-31-judge-run-puma.md`, `--max-items 40 --max-usd 3`. It spent **$2.9439** and **stopped at the cap after 33 of 40** items, in 15 min 5 s (181 requests, 975,444 input tokens).

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|
| Title | 33 | 31 | 0 | 0 | 0 | 2 | 100% |
| Price | 33 | 33 | 0 | 0 | 0 | 0 | 100% |
| Main image | 33 | 0 | 0 | 0 | 33 | 0 | — |
| SKU | 33 | 31 | 2 | 0 | 0 | 0 | 94% |
| Brand | 33 | 33 | 0 | 0 | 0 | 0 | 100% |
| In stock | 33 | 30 | 1 | 1 | 1 | 0 | 97% |
| Rating | 18 | 18 | 0 | 0 | 0 | 0 | 100% |
| Description | 33 | 29 | 4 | 0 | 0 | 0 | 88% |

- Settled from the page text: **"45 values settled from the page text without a call (saved at least $0.39)"**.
- Shown flag vs. verdict: Wrong & not shown 4 · Wrong & shown 2 · Correct & not shown 0 · Correct & shown 175 · Unflagged 31. **"The free flag caught 4 of the 6 flagged wrong values; it flagged 0 correct values."**
- What the 7 wrongs are:
  - **Description ×4: real** (stale JSON-LD copy). All 4 were flagged.
  - **SKU, 312123 `?swatch=16`: probably real.** "The page shows Style: 312123_17, not 312123_16." The judge's fresh capture of `?swatch=16` rendered swatch 17: the selected variant in the URL again.
  - **SKU, lafrance-sneakers: judge vocabulary.** "The page does not display an SKU value."
  - **In stock, Speedcat OG `?swatch=94`: judgement.** "it only displays size availability (7 and 7.5 appear crossed out/unavailable)". Other sizes are available, so `true` is right.

## Spend for this website

| Item | Cost |
|---|---:|
| Verify (SKU failed) | $0.1004 |
| Re-Verify ×2 | $0.0000 |
| Sample probe | $0.0333 (labelled free) |
| Extract run | $0.0000 |
| Judge | $2.9439 |
| **Total** | **$3.0776** |

## Screenshots

`puma-00-cards-as-found` (the Malaysia redirect), `-01-retry`, `-01-cards`, `-02-title-heading`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-05-sku-fail`, `puma-mark-SKU-1…4`, `-06-after-verify`, `-06-coverage`, `-07-before-use-as-proof`, `-08-fourth-card`, `-09-after-verify`, `-09-coverage`, `-12-sample`, `-13-extract-before`, `-15-run`.
