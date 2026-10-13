# ikea.com (the control) — campaign 2, 2026-10-13 (phase 2, batch C, site 36)

**Status: DONE.** Ikea passed as a control should: verified 8/8 for $0.00, coverage found every field on 20 more products, and Extract returned 47 of 47 in 8 min for $0.00. The new shown flag is noisy here: **"105 values not shown on their page"**, and 94 of those are Ikea's own title and description reformatted. It also caught 11 ratings stored as **0** for products with no reviews, which are real errors. The judge stopped at its $3 cap after 25 items ($2.9569). Price, SKU, Brand and Title were 100%.

## The listing

- **The pre-screen's listing was a blog post.** Homepage discovery picked `/global/en/stories/ideas-inspiration/style-report-modern-nordic-warmth-260617/` ("2 products found"). The campaign-2 website row had no listing or proof pages stored.
- **The real listing comes from campaign 1.** Its Ikea run (`01af1eb0…`, 2026-10-08) walked `https://www.ikea.com/my/en/cat/sofas-fu003/`. That run was in the `acne` project's website; the `competitor-prices` project's Ikea uses `/my/en/cat/cabinets-10409/`. I read both by read-only SQL.
- I set `https://www.ikea.com/my/en/cat/sofas-fu003/` in campaign 2: **"40 products found · a pager too"**, found in 15 s.
  - Its first products were a "BLODFLÄDER Picture", a "New FAGERBACKEN Armchair" and a "New ARENBOK Cushion cover", from a shop-the-look strip above the sofas.
  - The armchair and the cushion cover have no reviews (Rating empty), so I pasted campaign 1's three sofa proof pages instead.

## Findings in the product (most important first)

1. **Rating "0" is stored for 11 of 47 products, and the shown flag catches all 11.**
   - "Rating: 11 of 47 values are not on the product's page · from api (experimental.rating.value)".
   - The 11 are products with no reviews (LILLEHEM 4-seat, VIMLE corner 5-seat, SALTSJÖBADEN, MANNARP with chaise longues, EKTORP with chaise longue, …), stored `0` instead of empty.
   - Because they are filled, the run shows no "Empty cells" for Rating.
   - The judge read them as "not on page" (N3), not wrong, so its table shows Rating 20/0. The flag is the only signal for these errors.
2. **The shown flag marks Ikea's every Title and Description.**
   - "Title: 47 of 47 values are not on the product's page · from json-ld (name)" and "Description: 47 of 47 values are not on the product's page · from json-ld (description)".
   - **Title:** the stored "GLOSTAD 2-seat sofa - Knisa dark grey" is the JSON-LD name. The page shows "GLOSTAD" over "2-seat sofa, Knisa dark grey": the same words, with a comma where the name has " - ".
   - **Description:** the JSON-LD description starts with that name ("KIVIK 3-seat sofa - Tibbleby beige/grey. Enjoy the super comfy…"). The page's text starts at "Enjoy the super comfy…".
   - The judge called the Titles 24/24 correct. **"The free flag caught 3 of the 3 flagged wrong values; it flagged 46 correct values."**
   - On a site that verified and that the judge rates 100% on Title, the run page reads "105 values not shown on their page".
3. **`not the page's heading on product 1`** at Verify (Title).
   - It was right that the heading differs: "GLOSTAD" with the subline "2-seat sofa, Knisa dark grey".
   - Only product 1 was named, though products 2 and 3 have the same layout.
   - The Title row had no "Accept" button with that reason: "Accept Title on product n" timed out. I used "Confirm Title from the page data" ×3.
4. **"different place on product 1 — check it"** for Price.
   - Product 1 then read "check product 1", with no page-data confirm and no hover Accept.
   - I marked the visible "349" on the screenshot, which settled it.
5. **The cookie banner is still on the judge's captures.** One description verdict: "with the rest hidden by the cookie banner".
6. The Sample recorded **$0.0000**: the only free Sample in batch C.

## Proof pages

1. https://www.ikea.com/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/
2. https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/
3. https://www.ikea.com/my/en/p/hemlingby-2-seat-sofa-knisa-dark-grey-70434368/

These are campaign 1's (the `acne` project's) proof pages. They replaced the found picture, armchair and cushion cover.

| Field | What it needed | Verdict |
|---|---|---|
| Title | `not the page's heading on product 1` → page data, confirmed ×3 | verified 3/3 |
| Price | "different place on product 1 — check it"; row accepted, product 1 marked "349" | verified 3/3 |
| Main image | agreed | verified 3/3 |
| SKU | agreed (104.890.09 / 194.405.94 / 704.343.68) | verified 3/3 |
| Brand | page data "IKEA", confirmed ×3 | verified 3/3 |
| In stock | page data, confirmed ×3 | verified 3/3 |
| Rating | agreed (4.8 / 4.7 / 4.7) | verified 3/3 |
| Description | page data, confirmed ×3 | verified 3/3 |

Counts: agreed 4 · page data confirmed 12 · marked 1 (Price p1) · typed 0 · absent 0.

## Verify

| When (UTC) | Label | Time | Result | Cost |
|---|---|---|---|---|
| 11:12:35 | "Verify 8 fields · up to $0.40" | 5 s | 8/8 verified 3/3 | $0.0000 |

## Coverage check

11:12:56 → 11:16:21 (3 min 25 s): **"Checked 20 more products from the listing: every field was found on all of them."**

- Rating "0" counts as found, so the 11 reviewless sofas did not show up here (finding 1).

## Sample and Extract

- **Sample**: 11:17:44 → 11:18:49 (65 s). Pages walked 2, Product links found 30, Rows extracted shown as 0 (3 extracted). $0.0000.
- **Extract**, "custom 60 products across custom 2 pages". The button read "Extract", with no amount.
  - Run `09250446-55d9-41b9-8812-f3ef8c41c948`. Clicked 11:19:01; "Open the run" at 11:19:26 (planning 25 s). Completed 11:27:29, "Duration 8 min".
  - "47 of 47 extracted", "47 URLs to extract · 2 listing pages walked". $0.0000.
  - The run page shows no "Empty cells" section.

| Field | Filled | Distinct |
|---|---:|---:|
| Title | 47/47 | 47 |
| Price | 47/47 | 39 |
| Main image | 47/47 | 47 |
| SKU | 47/47 | 47 |
| Brand | 47/47 | 1 |
| In stock | 47/47 | 1 (true) |
| Rating | 47/47 | 13 ("0" ×11, "5" ×14, 4.7 ×6, …) |
| Description | 47/47 | 47 |

### Shown on the page (new)

- Summary: **"47 rows · 100% confidence · 105 values not shown on their page"**.
- Badges: Title **"47 not shown"**, Main image "not checked", In stock "not checked", Rating **"11 not shown"**, Description **"47 not shown"**. Price, SKU and Brand had none.
- Panel, verbatim:
  - "Title: 47 of 47 values are not on the product's page · from json-ld (name)"
  - "Rating: 11 of 47 values are not on the product's page · from api (experimental.rating.value)" → lillehem-4-seat-modular-sofa, vimle-corner-sofa-5-seat, saltsjoebaden-3-seat-sofa, mannarp-4-seat-sofa-with-chaise-longues, ektorp-3-seat-sofa-with-chaise-longue
  - "Description: 47 of 47 values are not on the product's page · from json-ld (description)"
- **Really wrong?**
  - Rating: yes, all 11 shown are "0" on products without reviews (SQL).
  - Title and Description: no. They are the same words in Ikea's JSON-LD format (finding 2).

## Judge

`docs/testing/results/2026-10-13T11-40-judge-run-ikea.md`, `--max-items 40 --max-usd 3`. Spent **$2.9569**; **stopped at the cap after 25 of 40**, in 11 min 9 s.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Correct % |
|---|---:|---:|---:|---:|---:|---:|
| Title | 25 | 24 | 0 | 0 | 0 | 100% |
| Price | 25 | 25 | 0 | 0 | 0 | 100% |
| Main image | 25 | 0 | 0 | 0 | 25 | — |
| SKU | 25 | 25 | 0 | 0 | 0 | 100% |
| Brand | 25 | 25 | 0 | 0 | 0 | 100% |
| In stock | 25 | 15 | 6 | 3 | 1 | 71% |
| Rating | 25 | 20 | 0 | 5 | 0 | 100% |
| Description | 25 | 22 | 3 | 0 | 0 | 88% |

- Settled from the page text: **"13 values settled from the page text without a call (saved at least $0.11)"**.
- Shown flag vs. verdict: Wrong & not shown 3 · Wrong & shown 0 · Correct & not shown 46 · Correct & shown 95 · Unflagged 21. **"The free flag caught 3 of the 3 flagged wrong values; it flagged 46 correct values."**
- What the wrongs are:
  - **In stock ×6: judge vocabulary.** "The page shows "Check in-store stock" with a grey indicator, not a confirmed in-stock status." Ikea Malaysia shows delivery and in-store stock, and `true` comes from `offers.availability`.
  - **Description ×3: the page and the judge.** "the rest hidden by the cookie banner", and "The page shows no such description text…" for the name-prefixed JSON-LD description. The flag marked these as well as 44 correct ones.
  - **Rating:** the five "0" values the judge saw are "not on page" (N3), not wrong.
- Against campaign 1 (`2026-10-08T11-41-judge-run-ikea.md`): Price is right everywhere again (38/38 then, 25/25 now).

## Spend for this website

| Item | Cost |
|---|---:|
| Verify | $0.0000 |
| Sample probe | $0.0000 |
| Extract run | $0.0000 |
| Judge | $2.9569 |
| **Total** | **$2.9569** |

## Screenshots

`ikea-00-as-found`, `-01-cards`, `-02-title-heading`, `ikea-mark-Price-1`, `-03-before-verify`, `-04-after-verify`, `-04-coverage`, `-12-sample`, `-13-extract-before`, `-15-run`.
