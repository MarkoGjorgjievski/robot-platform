# Judge run — Sigmabeauty

> **STOPPED at the $3.00 cap** — the next item would have gone over it.
> 26 of 60 items were judged; the tables cover only those.

- Run: `c6c561de-336d-4e7e-b020-bb8b4ee29f6b`
- Site: Sigmabeauty (project Campaign 2 2026-10-11)
- When: 2026-10-13T08:46:18.784Z
- Items: 60 items in run, 60 with values, 26 captured, 0 capture failed, judged 26 (limited by cap)
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $2.9906 (cap $3.00)
- Note: per-call estimate not re-measured since page text was added ($0.0086 a call — behind the cap and the saving below)
- 8 values settled from the page text without a call (saved at least $0.07)
- Time: 12m 15s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

Some values are counted correct from the page's visible text without a judge call: a number with one of the field's words beside it (within 15 characters, nothing but spaces, colons or brackets between) or followed by "/5", "out of 5", "stars" or "★" (a single digit only right beside the field's name); a text value longer than 80 characters, not a product name or brand, whose first 80 characters occur exactly once in the page text. Money values always go to the judge. Every other value goes to the judge with page text beside the screenshot — 4,000 characters around the value when it is found, else the first 8,000; a text value longer than 80 characters is judged on its first 80, and the judge is told so.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct includes values settled from the page text without a call. Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 26 | 25 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 26 | 0 | 0 | 0 | 26 | 0 | 0 | — |
| SKU | 26 | 21 | 4 | 0 | 0 | 1 | 0 | 84% |
| Brand | 26 | 25 | 1 | 0 | 0 | 0 | 0 | 96% |
| In stock | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 100% |
| Rating | 26 | 24 | 2 | 0 | 0 | 0 | 0 | 92% |
| Description | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 100% |

## Shown flag vs. verdict

How well the free "shown on the page" flag (spec 2026-10-12 §3/§6, stored per field on a certified run's extraction) predicts the judge's paid verdict, among cells the judge or the local text pass called correct or wrong; a cell with no stored flag, or whose field type is not checkable, counts as unflagged, not as either side.

| Shown flag vs. verdict | Count |
|---|---:|
| Wrong & not shown | 2 |
| Wrong & shown | 5 |
| Correct & not shown | 1 |
| Correct & shown | 146 |
| Unflagged (no flag or not checkable) | 26 |

The free flag caught 2 of the 7 flagged wrong values; it flagged 1 correct value.

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. Ct is a value found in the page text (a number with its field word beside it, or a long text's first 80 characters), without a judge call or cost; a trailing p means a long text judged on its first 80 characters. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://sigmabeauty.com/products/skincare-brush-set | Skincare Brush Set \| Makeup Brush Set for Healthy Skin | C1 | C1 | U | W1 | C1 | C2 | C1 | C1p |
| https://sigmabeauty.com/products/e42-precision-firm-blender | E42 Precision Firm Blender™ Brush \| Beauty Blending Brush | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/f30-large-powder-chrome | F30 Large Powder Brush \| Face Makeup Brush \| Setting Brush | C1 | C1 | U | W1 | W1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/f03-high-cheekbone-highlighter | F03 High Cheekbone Highlighter™ Brush \| Sigmax® fiber brush | E1 | C1 | U | W1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/3dhdr-kabuki-brush | 3DHD® Kabuki Brush - Black/Chrome \| Kabuki Makeup Brushes | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/e55-eye-shading-chrome | Chrome E55 Eye Shading Brush \| Best Fiber Eyeshadow Brush | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/e45-small-tapered-blending-chrome | E45 Small Tapered Blending Brush \| Best Makeup Brushes \| Sigma | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/glam-n-go-mini-eye-brush-set | Glam 'N Go Mini Eye Brush Set \| Sigma Beauty Makeup Brush Set | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/basic-eye-kit | Basic Eye Brush Set \| Professional Eye Makeup Brushes \| Sigma | C1 | C1 | U | C1 | C1 | C2 | W1 | C1p |
| https://sigmabeauty.com/products/sigmagic-scrub | Sigmagic™ Scrub \| Makeup Brush Cleanser \| Brush Cleaning Tools | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/f48-soft-coverage | F48 Soft Coverage Foundation Makeup Brush \| Best Face Brushes | C1 | C1 | U | C2 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/most-wanted-brush-set | Most-Wanted Brush Set \| Top Selling Sigma Makeup Brushes | C1 | C1 | U | C1 | C1 | C3 | C1 | C1p |
| https://sigmabeauty.com/products/f53-air-contour-blush | F53 Air Contour/ Blush™ Brush \| Sigma Contour Brushes | C1 | C1 | U | W1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/sigma-x-angela-bright-brush-set | Sigma x Angela Bright Brush Set \| Precision Blending Tools | C1 | C1 | U | E1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/f43-soft-angled-cheek | F43 Soft Angled Cheek Makeup Brush \| Precision Face Brush | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/e15-flat-definer-chrome | E15 Flat Definer Brush \| Makeup Brush for Eyes \| Eye Makeup | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/spa-express-brush-cleaning-glove | Sigma Spa® Express: The Ultimate Brush Cleaning Glove | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/f80-air-flat-kabuki | F80 Air Flat Kabuki™ Brush \| Best-Selling Foundation Brush | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/4dhd-kabuki | 4DHD™ Kabuki Brush \| Kabuki Makeup Brush \| Sigma Beauty | C1 | C1 | U | C1 | C1 | C1 | W1 | C1p |
| https://sigmabeauty.com/products/f80-flatkabuki-chrome | F80 Flat Kabuki™ Brush \| Foundation Brush \| Sigma Makeup | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/f08-precision-powder | F08 Precision Powder Makeup Brush \| Best Powder Brush \| Sigma | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/sigma-travel-switch | Sigma® Travel Switch \| Travel-Ready Makeup Cleaning Tool | C1 | C1 | U | C1 | C1 | C2 | C1 | C1p |
| https://sigmabeauty.com/products/2x-sigma-spa-brush-cleaning-glove-pink | 2X Sigma Spa® Brush Cleaning Glove \| Makeup Brush Cleaning | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://sigmabeauty.com/products/sigma-palmat | Sigma Palmat® \| 2-in-1 Brush Cleaning Tool \| Sigma Beauty | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/f26-domed-concealer | F26 Domed Concealer Brush \| Precision Blending for Flawless Skin | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://sigmabeauty.com/products/e40-tapered-blending-chrome | E40 Tapered Blending Brush \| Expert Eyeshadow Blending Brush | C1 | C1 | U | C1 | C1 | C2 | C1 | C1p |

## Wrong values

- **SKU** — https://sigmabeauty.com/products/skincare-brush-set (tile 1)
  - extracted: `SBS01`
  - shown: true
  - judge's reading (uncalibrated): The page shows no SKU value.
- **SKU** — https://sigmabeauty.com/products/f30-large-powder-chrome (tile 1)
  - extracted: `F30-1`
  - shown: true
  - judge's reading (uncalibrated): The page does not display an SKU value.
- **Brand** — https://sigmabeauty.com/products/f30-large-powder-chrome (tile 1)
  - extracted: `SigmaBeauty`
  - shown: true
  - judge's reading (uncalibrated): The page shows the brand as "SIGMA."
- **SKU** — https://sigmabeauty.com/products/f03-high-cheekbone-highlighter (tile 1)
  - extracted: `F03`
  - shown: true
  - judge's reading (uncalibrated): The page shows no SKU value for this product.
- **Rating** — https://sigmabeauty.com/products/basic-eye-kit (tile 1)
  - extracted: `4.9`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of 4.8.
- **SKU** — https://sigmabeauty.com/products/f53-air-contour-blush (tile 1)
  - extracted: `F53`
  - shown: true
  - judge's reading (uncalibrated): The page shows no SKU value.
- **Rating** — https://sigmabeauty.com/products/4dhd-kabuki (tile 1)
  - extracted: `4.9`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of 4.8.

## Correct values flagged not shown

- **Brand** — https://sigmabeauty.com/products/glam-n-go-mini-eye-brush-set
  - extracted: `SigmaBeauty`

## Notes

```
claude-sonnet-5: 187 req, 992,502 in / 875 out
estimated $2.9906 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
