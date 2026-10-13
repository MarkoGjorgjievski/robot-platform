# Judge run — Puma

> **STOPPED at the $3.00 cap** — the next item would have gone over it.
> 33 of 48 items were judged; the tables cover only those.

- Run: `3ca46d0a-9403-4569-a994-ffd2d2d6f7c3`
- Site: Puma (project Campaign 2 2026-10-11)
- When: 2026-10-13T10:31:36.890Z
- Items: 48 items in run, 48 with values, 33 captured, 0 capture failed, judged 33 (limited by cap)
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $2.9439 (cap $3.00)
- Note: per-call estimate not re-measured since page text was added ($0.0086 a call — behind the cap and the saving below)
- 45 values settled from the page text without a call (saved at least $0.39)
- Time: 15m 5s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

Some values are counted correct from the page's visible text without a judge call: a number with one of the field's words beside it (within 15 characters, nothing but spaces, colons or brackets between) or followed by "/5", "out of 5", "stars" or "★" (a single digit only right beside the field's name); a text value longer than 80 characters, not a product name or brand, whose first 80 characters occur exactly once in the page text. Money values always go to the judge. Every other value goes to the judge with page text beside the screenshot — 4,000 characters around the value when it is found, else the first 8,000; a text value longer than 80 characters is judged on its first 80, and the judge is told so.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct includes values settled from the page text without a call. Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 33 | 31 | 0 | 0 | 0 | 2 | 0 | 100% |
| Price | 33 | 33 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 33 | 0 | 0 | 0 | 33 | 0 | 0 | — |
| SKU | 33 | 31 | 2 | 0 | 0 | 0 | 0 | 94% |
| Brand | 33 | 33 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 33 | 30 | 1 | 1 | 1 | 0 | 0 | 97% |
| Rating | 18 | 18 | 0 | 0 | 0 | 0 | 15 | 100% |
| Description | 33 | 29 | 4 | 0 | 0 | 0 | 0 | 88% |

## Shown flag vs. verdict

How well the free "shown on the page" flag (spec 2026-10-12 §3/§6, stored per field on a certified run's extraction) predicts the judge's paid verdict, among cells the judge or the local text pass called correct or wrong; a cell with no stored flag, or whose field type is not checkable, counts as unflagged, not as either side.

| Shown flag vs. verdict | Count |
|---|---:|
| Wrong & not shown | 4 |
| Wrong & shown | 2 |
| Correct & not shown | 0 |
| Correct & shown | 175 |
| Unflagged (no flag or not checkable) | 31 |

The free flag caught 4 of the 6 flagged wrong values; it flagged 0 correct values.

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. Ct is a value found in the page text (a number with its field word beside it, or a long text's first 80 characters), without a judge call or cost; a trailing p means a long text judged on its first 80 characters. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://us.puma.com/us/en/pd/suede-snake-print-sneakers/408329?swatch=01 | Suede Snake Print Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?swatch=16 | Deviate NITRO™ 4 Men's Road Running Shoes \| PUMA | C1 | C1 | U | W1 | C1 | C1 | Ct | W1p |
| https://us.puma.com/us/en/pd/arizona-suede-sneakers/402362?swatch=11 | Arizona Suede Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/future-9-match-playmaker-indoor-soccer-cleats/109152?swatch=03 | FUTURE 9 MATCH PLAYMAKER Indoor Soccer Cleats \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/speedcat-decon-sneakers/407251?swatch=02 | Speedcat Decon Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/speedcat-patch-sneakers/407257?swatch=01 | Speedcat Patch Sneakers \| PUMA | E1 | C1 | U | C1 | C1 | C2 | C1 | Ct |
| https://us.puma.com/us/en/pd/suede-classic-sneakers/399781?swatch=01 | Suede Classic Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/suede-dressed-sneakers/408831?swatch=01 | Suede Dressed Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=93 | Speedcat OG Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/future-9-fusion-firm-artificial-ground-soccer-cleats/109127?swatch=03 | FUTURE 9 FUSION Firm/Artificial Ground Soccer Cleats \| PUMA | C1 | C1 | U | C1 | C1 | C2 | · | Ct |
| https://us.puma.com/us/en/pd/suede-forever-sneakers/404627?swatch=04 | Suede Forever Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=64 | Speedcat OG Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | U2 | Ct | Ct |
| https://us.puma.com/us/en/pd/palermo-sneakers/396463?swatch=98 | Palermo Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/suede-classic-sneakers/399781?swatch=41 | Suede Classic Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=38 | Speedcat OG Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/puma-x-hyrox-deviate-nitro-elite-4-mens-training-shoes/314156?swatch=01 | PUMA x HYROX Deviate NITRO™ Elite 4 Men's Training Shoes \| PUMA | C1 | C1 | U | C1 | C1 | C1 | C1 | Ct |
| https://us.puma.com/us/en/pd/future-9-match-firm-artificial-ground-soccer-cleats/109135?swatch=03 | FUTURE 9 MATCH Firm/Artificial Ground Soccer Cleats \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/deviate-pure-nitro-mens-running-shoes/313904?swatch=19 | Deviate Pure NITRO™ Men's Running Shoes \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | W1p |
| https://us.puma.com/us/en/pd/h-street-primaloft-sneakers/407682?swatch=02 | H-Street PrimaLoft® Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/puma-x-street-fighter-suede-chun-li-sneakers/410648?swatch=01 | PUMA x STREET FIGHTER Suede Chun-Li Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/mb06-shooting-star-basketball-shoes/313624?swatch=01 | MB.06 Shooting Star Basketball Shoes \| PUMA | C1 | C1 | U | C1 | C1 | N3 | · | Ct |
| https://us.puma.com/us/en/pd/basket-trippy-camo-sneakers-unisex/408345?swatch=01 | Basket Trippy Camo Sneakers Unisex \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?swatch=19 | Deviate NITRO™ 4 Men's Road Running Shoes \| PUMA | E1 | C1 | U | C1 | C1 | C1 | Ct | W1p |
| https://us.puma.com/us/en/pd/puma-x-madhappy-suede-sneakers/409137?swatch=01 | PUMA x MADHAPPY Suede Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/rs-surge-las-vegas-mens-sneakers/406710?swatch=01 | RS Surge Las Vegas Men's Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=02 | Speedcat OG Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/lafrance-sneakers/314471?swatch=01 | LaFrancé Sneakers \| PUMA | C1 | C1 | U | W1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/speedcat-dress-up-sneakers/406998?swatch=03 | Speedcat Dress-Up Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=94 | Speedcat OG Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | W1 | Ct | Ct |
| https://us.puma.com/us/en/pd/suede-classic-sneakers/399781?swatch=03 | Suede Classic Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=19 | Speedcat OG Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://us.puma.com/us/en/pd/puma-x-le-pere-suede-sneakers/409463?swatch=01 | PUMA x LE PÈRE Suede Sneakers \| PUMA | C1 | C1 | U | C1 | C1 | C1 | · | Ct |
| https://us.puma.com/us/en/pd/deviate-nitro-elite-4-mens-road-running-shoes/312127?swatch=09 | Deviate NITRO™ Elite 4 Men's Road Running Shoes \| PUMA | C1 | C1 | U | C1 | C1 | C1 | Ct | W1p |

## Wrong values

- **SKU** — https://us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?swatch=16 (tile 1)
  - extracted: `Style: 312123_16`
  - shown: true
  - judge's reading (uncalibrated): The page shows Style: 312123_17, not 312123_16.
- **Description** — https://us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?swatch=16 (tile 1) (judged on its first 80 characters)
  - extracted: `Deviate 4 isn't just fast – its too fast. 15g lighter than its predecessor, this high-performance shoe is built for runners who refuse to slow down. Featuring e…`
  - shown: false
  - judge's reading (uncalibrated): The page actually describes it as: "The Deviate NITRO™ 4 is built for speed on everyday runs. NITROFOAM™ delivers responsive energy return, while a breathable mesh upper and a PWRPLATE provide smooth propulsion and comfort with every stride."
- **Description** — https://us.puma.com/us/en/pd/deviate-pure-nitro-mens-running-shoes/313904?swatch=19 (tile 1) (judged on its first 80 characters)
  - extracted: `Deviate Pure NITROTM Road Running Shoes are ready for training and daily runs with lightweight NITROFOAMTM cushioning and a flexible ride. No plate, just smooth…`
  - shown: false
  - judge's reading (uncalibrated): The page actually reads: "Deviate Pure NITRO™ Running Shoes are ready for training and daily speed runs with lightweight NITROFOAM™ cushioning and a flexible ride. No plate, just smooth propulsion, so you can pick up the pace when it feels right."
- **Description** — https://us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?swatch=19 (tile 1) (judged on its first 80 characters)
  - extracted: `Deviate 4 isn't just fast – its too fast. 15g lighter than its predecessor, this high-performance shoe is built for runners who refuse to slow down. Featuring e…`
  - shown: false
  - judge's reading (uncalibrated): The page actually shows: "The Deviate NITRO™ 4 is built for speed on everyday runs. NITROFOAM™ delivers responsive energy return, while a breathable mesh upper and a PWRPLATE provide smooth propulsion and comfort with every stride."
- **SKU** — https://us.puma.com/us/en/pd/lafrance-sneakers/314471?swatch=01 (tile 1)
  - extracted: `Style: 314471_01`
  - shown: true
  - judge's reading (uncalibrated): The page does not display an SKU value.
- **In stock** — https://us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=94 (tile 1)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): The page shows no "In stock" value; it only displays size availability (7 and 7.5 appear crossed out/unavailable).
- **Description** — https://us.puma.com/us/en/pd/deviate-nitro-elite-4-mens-road-running-shoes/312127?swatch=09 (tile 1) (judged on its first 80 characters)
  - extracted: `When fast isn’t fast enough, you go beyond. The Deviate NITROTM Elite 4 is built for race day – those moments when every second counts. Upgraded NITROFOAMTM ELI…`
  - shown: false
  - judge's reading (uncalibrated): The page actually shows: "These Deviate NITRO™ Elite 4 Running shoes are made for race day. NITROFOAM™ Elite delivers lightweight, responsive cushioning and a re-engineered PWRPLATE adds support and forward propulsion."

## Correct values flagged not shown

None.

## Notes

```
claude-sonnet-5: 181 req, 975,444 in / 1,172 out
estimated $2.9439 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
