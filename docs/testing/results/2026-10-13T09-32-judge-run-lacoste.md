# Judge run — Lacoste

> **STOPPED at the $3.00 cap** — the next item would have gone over it.
> 18 of 60 items were judged; the tables cover only those.

- Run: `730a8df2-4435-485c-979c-1c8424b62fcd`
- Site: Lacoste (project Campaign 2 2026-10-11)
- When: 2026-10-13T09:32:08.932Z
- Items: 60 items in run, 60 with values, 18 captured, 0 capture failed, judged 18 (limited by cap)
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $2.9895 (cap $3.00)
- Note: per-call estimate not re-measured since page text was added ($0.0086 a call — behind the cap and the saving below)
- 18 values settled from the page text without a call (saved at least $0.15)
- Time: 7m 55s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

Some values are counted correct from the page's visible text without a judge call: a number with one of the field's words beside it (within 15 characters, nothing but spaces, colons or brackets between) or followed by "/5", "out of 5", "stars" or "★" (a single digit only right beside the field's name); a text value longer than 80 characters, not a product name or brand, whose first 80 characters occur exactly once in the page text. Money values always go to the judge. Every other value goes to the judge with page text beside the screenshot — 4,000 characters around the value when it is found, else the first 8,000; a text value longer than 80 characters is judged on its first 80, and the judge is told so.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct includes values settled from the page text without a call. Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 100% |
| Price | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 18 | 0 | 0 | 0 | 18 | 0 | 0 | — |
| SKU | 18 | 0 | 3 | 15 | 0 | 0 | 0 | 0% |
| Brand | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 18 | 7 | 1 | 9 | 1 | 0 | 0 | 88% |
| Rating | 16 | 3 | 11 | 0 | 2 | 0 | 2 | 21% |
| Description | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 100% |

## Shown flag vs. verdict

How well the free "shown on the page" flag (spec 2026-10-12 §3/§6, stored per field on a certified run's extraction) predicts the judge's paid verdict, among cells the judge or the local text pass called correct or wrong; a cell with no stored flag, or whose field type is not checkable, counts as unflagged, not as either side.

| Shown flag vs. verdict | Count |
|---|---:|
| Wrong & not shown | 14 |
| Wrong & shown | 0 |
| Correct & not shown | 1 |
| Correct & shown | 74 |
| Unflagged (no flag or not checkable) | 8 |

The free flag caught 14 of the 14 flagged wrong values; it flagged 1 correct value.

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. Ct is a value found in the page text (a number with its field word beside it, or a long text's first 80 characters), without a judge call or cost; a trailing p means a long text judged on its first 80 characters. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=02S | Classic Fit L.12.12 Original Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | N3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00.html?color=EL6 | Classic Fit L.12.12 Marl Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | C3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/AG792-00.html?color=DD9B | Runway Loose Fit Striped Piqué Polo Shirt - Long Sleeves - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | C3 | · | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00.html?color=JPR | Classic Fit L.12.12 Marl Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | C2 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH0213-00.html?color=EL6 | Regular Fit Wool Blend Jersey Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | W2 | C1 | C1 | · | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.html?color=BDM | Classic Fit Long Sleeved L.12.12 Polo Shirt - Long Sleeves - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | U2 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=031 | Classic Fit L.12.12 Original Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | N3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-00.html?color=001 | Classic Fit L.12.12 LIGHT Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | N3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=BDM | Classic Fit L.12.12 Original Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | N3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/knitwear/AH9904-00.html?color=166 | Classic Fit Long Sleeved Knitted Polo Shirt - Men's Knitwear - New In 2026 \| Lacoste | C1 | C1 | U | N2 | C1 | N2 | C1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/PH2481-00.html?color=166 | Regular Fit Paris Stretch Piqué Polo Shirt - Long Sleeves - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | C3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH4012-00.html?color=001 | Slim Fit L.12.12 Original Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | C2 | U1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH4012-00.html?color=166 | Slim Fit L.12.12 Original Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | N3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH6809-00.html?color=ZDQ | Lacoste Tennis x Novak Djokovic On Court Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | W1 | C1 | N3 | C1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.html?color=3KE | Classic Fit Long Sleeved L.12.12 Polo Shirt - Long Sleeves - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | N3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-00.html?color=166 | Classic Fit L.12.12 LIGHT Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | N3 | W1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031 | Regular Fit Paris Stretch Piqué Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | W2 | C1 | C1 | U1 | Ct |
| https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH1417-00.html?color=WD9 | Classic Fit Monogram Jacquard Polo Shirt - Men's Short Sleeves Polo Shirts - New In 2026 \| Lacoste | C1 | C1 | U | N3 | C1 | W2 | C1 | Ct |

## Wrong values

- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=02S (tile 1)
  - extracted: `4.7672`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars (based on the star icons), with 1,091 reviews.
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00.html?color=EL6 (tile 1)
  - extracted: `4.7363`
  - shown: false
  - judge's reading (uncalibrated): The page shows a star rating of approximately 4.5 stars (based on 91 reviews), not 4.7363.
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00.html?color=JPR (tile 1)
  - extracted: `4.7363`
  - shown: false
  - judge's reading (uncalibrated): The page shows a star rating (about 4.5 stars) with "Reviews (91)" rather than a numeric 4.7363 value.
- **SKU** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH0213-00.html?color=EL6 (tile 2)
  - extracted: `3617078031774`
  - shown: false
  - judge's reading (uncalibrated): The page shows no visible value for SKU; the content is still loading/placeholder.
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.html?color=BDM (tile 1)
  - extracted: `4.9559`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars (with 68 reviews), not 4.9559.
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=031 (tile 1)
  - extracted: `4.7672`
  - shown: false
  - judge's reading (uncalibrated): The page shows a star rating of about 4.5 stars with 1,091 reviews, not 4.7672.
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-00.html?color=001 (tile 1)
  - extracted: `4.8214`
  - shown: false
  - judge's reading (uncalibrated): The page shows a star rating of approximately 4.5 (not 4.8214), based on the visible star icons next to "Reviews (84)".
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=BDM (tile 1)
  - extracted: `4.7672`
  - shown: false
  - judge's reading (uncalibrated): The page shows a star rating based on 1,091 reviews, but no exact numeric rating value is displayed.
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/PH2481-00.html?color=166 (tile 1)
  - extracted: `4.9792`
  - shown: false
  - judge's reading (uncalibrated): The page shows a star rating of approximately 4.5 stars (not a precise numeric value like 4.9792).
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH4012-00.html?color=166 (tile 1)
  - extracted: `4.6635`
  - shown: false
  - judge's reading (uncalibrated): The page shows a star rating of approximately 4.5 stars with 318 reviews, not a precise numeric value like 4.6635.
- **SKU** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH6809-00.html?color=ZDQ (tile 1)
  - extracted: `3617077699852`
  - shown: false
  - judge's reading (uncalibrated): The page shows no SKU value, only a color code labeled "ZDQ."
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.html?color=3KE (tile 1)
  - extracted: `4.9559`
  - shown: false
  - judge's reading (uncalibrated): The page shows a 4.5-star rating (based on 68 reviews), not 4.9559.
- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-00.html?color=166 (tile 1)
  - extracted: `4.8214`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars (based on the star icons), with "Reviews (84)" listed next to it.
- **SKU** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031 (tile 2)
  - extracted: `3614030789520`
  - shown: false
  - judge's reading (uncalibrated): No SKU value is visible on the page.
- **In stock** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH1417-00.html?color=WD9 (tile 2)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): No value for "In stock" is shown on the page.

## Correct values flagged not shown

- **Rating** — https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH1417-00.html?color=WD9
  - extracted: `4.625`

## Notes

```
claude-sonnet-5: 179 req, 989,297 in / 1,442 out
estimated $2.9895 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
