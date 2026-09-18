# Proof-page capture, suggestMarks and transferMarks — live check, 2026-09-18

Free by construction: a second api-server started with no `ANTHROPIC_API_KEY`
on :4100 (Marko's dev servers untouched), driven over tRPC-HTTP by a scratch
script. The Acne / Ikea website (source `799be508-…`, three proof pages, eight
fields). **Nothing was written to the binding**: no `updateBinding`, no
`verify`. Three `captures` rows and their PNG tiles and `.capture.json` files
were created, as the feature does.

Spec: `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md`.
Plan: `docs/superpowers/plans/2026-09-18-schema-stepper-engine.md`, Task 11.

## 1. `sources.captureProofPage` → `proofPageCapture`

| Page | Time | Tiles | Boxes | contentHeight |
|---|---|---|---|---|
| GLOSTAD (`…-10489009/`) | 14.7 s | 6 | 266 | 8,818 px |
| KIVIK (`…-s19440594/`) | 16.8 s | 6 | 288 | 9,341 px |
| HEMLINGBY (`…-70434368/`) | 16.3 s | 6 | 252 | 8,690 px |

All three `captured`, none blocked. Six tiles is the `PROOF_PAGE_MAX_TILES`
cap (9,216 px); each page's content runs to about that, so the cap is right
for Ikea. The three captures ran concurrently in three browser sessions; the
time is per page from the mutation to `captured`. For comparison, the
verification ready check measured 8.4 s per page on 2026-09-17 with a warm
browser; this one includes launching Chromium per capture and six tile
renders.

## 2. `sources.suggestMarks` on page 1 (GLOSTAD)

| Field | Suggestion | Source | Boxes | Verdict |
|---|---|---|---|---|
| price | `349` | json-ld `offers.offers[0].price` | 2 | right; first box `[828,253 56×43]` sits exactly on the price (checked by eye on tile 0, red outline over "349") |
| price_currency | `349` | json-ld `offers.offers[0].price` | 1 | wrong: the field's concept is `price` (`deriveConcept` matches `\bprice\b` before `\bcurrency\b`); outside this plan, see follow-ups |
| title | `Products` | json-ld `itemListElement[0].name` | 1 | **wrong**: the BreadcrumbList block precedes the Product block and both end in `name`. Fixed the same day (`c0be550`): the shallowest matching path wins (`name` at depth 1 beats `itemListElement[0].name`). Re-queried on the stored capture after the fix: `GLOSTAD 2-seat sofa - Knisa dark grey` from json-ld `name`, 0 boxes — the page shows the name and the subtitle as two elements, so the row fills from page data with no outline |
| subtitle | `Which list should we move {{item}} to?` | api `fa.list.listProduct.modal.move.modal.subtitle` | 0 | wrong: the unknown-concept fallback matched an API translation string by its tail; harmless (no outline, the customer clicks), see follow-ups |
| product_id | none | — | — | the JSON-LD has `mpn`; concept `product_id` has no alias, see follow-ups |
| product_details | none | — | — | expected: an XPath-only field |
| total_reviews | `148` | json-ld `aggregateRating.reviewCount` | 1 | right |
| average_rating | `4.8` | json-ld `aggregateRating.ratingValue` | 1 | right |

After the fix: four of eight right (three with the element outlined, the
title from page data), two wrong for reasons outside this plan, two none.

## 3. `sources.transferMarks` from page 1 to pages 2 and 3

8.9 s for both pages (one browser session, eight fields).

| Field | KIVIK (page 2) | HEMLINGBY (page 3) |
|---|---|---|
| price | `RM1,195` api `price`, 2 boxes | `RM595` api `price`, 2 boxes |
| price_currency | `RM` api `revampPrice.currencyPrefix`, 1 box | `RM`, 1 box |
| title | `KIVIK` api `name`, 3 boxes | `HEMLINGBY`, 3 boxes |
| subtitle | `2-seat sofa, Tibbleby beige/grey` xpath `//*[@id="content"]/…`, 1 box | **null** |
| product_id | `194.405.94` json-ld `mpn`, 1 box | `704.343.68`, 3 boxes |
| product_details | `Enjoy the super comfy KIVIK sofa…` xpath `//*[@id="product-details"]/…`, 0 boxes | `A sofa with small, neat dimensions…`, 0 boxes |
| total_reviews | `45` api `experimental.rating.count`, 1 box | `62`, 1 box |
| average_rating | `4.8` api `experimental.rating.value`, 1 box | `4.7`, 1 box |

Eight of eight on page 2, seven of eight on page 3. The values are the ones
the stored certification reads for these products. `product_details` has no
box because its element's own text is split across children (the box map
records each element's own text), so the row fills but nothing is outlined.
`subtitle` on page 3: none of page 1's candidates resolves there; the
customer clicks it, which is the designed fallback.

## Follow-ups surfaced (not fixed here)

1. `deriveConcept('price currency')` yields `price`, so any field with "price"
   in its name is a price to the suggester; `currency` should win when both
   match. `product_id` gets no concept alias although `sku`'s aliases include
   `productID`/`mpn`. Both live in `derive-concept.ts`, outside this plan.
2. The unknown-concept fallback matches API translation strings by tail
   (`…modal.subtitle`); a rule such as "an API leaf under a path containing
   `modal`/`translation`/`i18n` is not a field" or limiting the fallback to
   JSON-LD and meta would remove the noise.
3. `product_details` has a value but no box: an element whose text is spread
   over children never matches by own text. Matching the concatenated text of
   a container (bounded) would outline it.
