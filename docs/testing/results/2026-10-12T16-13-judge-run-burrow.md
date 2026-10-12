# Judge run — Burrow

- Run: `fb5ee28d-921a-4f73-9f1b-ef4e453e2e17`
- Site: Burrow (project Campaign 2 2026-10-11)
- When: 2026-10-12T16:13:49.970Z
- Items: 25 items in run, 25 with values, 25 captured, 0 capture failed, judged 25
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $2.3639 (cap $5.00)
- Time: 12m 50s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 25 | 24 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 25 | 23 | 2 | 0 | 0 | 0 | 0 | 92% |
| Main image | 25 | 0 | 0 | 0 | 25 | 0 | 0 | — |
| SKU | 25 | 0 | 0 | 21 | 4 | 0 | 0 | — |
| Brand | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 25 | 16 | 2 | 5 | 2 | 0 | 0 | 89% |
| Rating | 25 | 1 | 20 | 3 | 1 | 0 | 0 | 5% |
| Description | 25 | 12 | 12 | 1 | 0 | 0 | 0 | 50% |

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://burrow.com/products/nomad-leather-king-sofa-with-ottoman?Fabric=Slate+-+Top+Grain+Leather&Leg+Finish=Walnut+-+Wood&Arm+Style=Block | Nomad Leather King Sofa with Ottoman | C1 | C1 | U | U2 | C1 | C1 | N3 | C2 |
| https://burrow.com/products/field-3-piece-sofa?Fabric=Navy+Blue+-+Performance+Basketweave&Leg+Finish=Walnut+-+Wood | Field 3-Piece Sofa | C1 | C1 | U | N3 | C1 | C1 | C1 | C1 |
| https://burrow.com/products/range-pro-109-3-seat-sofa?Fabric=Camel+-+Top+Grain+Leather | Range Pro 109" 3-Seat Sofa | C1 | W1 | U | N3 | C1 | W1 | W1 | W1 |
| https://burrow.com/products/span-sleeper-sofa?Fabric=Crushed+Gravel+-+Performance+Chenille | Span Sleeper Sofa | C1 | C1 | U | N3 | C1 | C1 | W1 | C1 |
| https://burrow.com/products/range-plus-4-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood | Range 4-Piece One Arm Sofa | C1 | C1 | U | N3 | C1 | C1 | W1 | W2 |
| https://burrow.com/products/range-plus-3-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal | Range 3-Piece One Arm Sofa | C1 | C1 | U | N3 | C1 | C1 | W1 | W2 |
| https://burrow.com/products/range-plus-4-piece-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood | Range 4-Piece Sofa | C1 | C1 | U | N3 | C1 | C1 | N3 | W2 |
| https://burrow.com/products/field-2-piece-sofa?Fabric=Navy+Blue+-+Performance+Basketweave&Leg+Finish=Walnut+-+Wood | Field 2-Piece Sofa | C1 | C1 | U | U1 | C1 | W1 | W1 | C1 |
| https://burrow.com/products/ember-pro-2-seat-sofa-80?Fabric=Georgia+Clay+-+Performance+Chenille | Ember Pro 2-Seat Sofa (80") | E1 | C1 | U | N3 | C1 | C1 | U1 | W1 |
| https://burrow.com/products/field-4-piece-sofa?Fabric=Navy+Blue+-+Performance+Basketweave&Leg+Finish=Walnut+-+Wood | Field 4-Piece Sofa | C1 | C1 | U | N3 | C1 | N3 | W1 | C1 |
| https://burrow.com/products/range-pro-76-2-seat-sofa?Fabric=Camel+-+Top+Grain+Leather | Range Pro 76" 2-Seat Sofa | C1 | C1 | U | N3 | C1 | C1 | N3 | W1 |
| https://burrow.com/products/field-leather-4-piece-sofa?Fabric=Slate+-+Top+Grain+Leather&Leg+Finish=Oak+-+Wood | Field Leather 4-Piece Sofa | C1 | C1 | U | U1 | C1 | C1 | W1 | C1 |
| https://burrow.com/products/field-leather-2-piece-sofa?Fabric=Slate+-+Top+Grain+Leather&Leg+Finish=Oak+-+Wood | Field Leather 2-Piece Sofa | C1 | C1 | U | N3 | C1 | N3 | W1 | C1 |
| https://burrow.com/products/range-plus-4-piece-one-arm-sofa-lounger?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal | Range 4-Piece One Arm Sofa Lounger | C1 | C1 | U | N3 | C1 | C1 | W1 | W2 |
| https://burrow.com/products/union-4-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood&Leg+Style=Round+Leg | Union 4-Seat Sofa | C1 | C1 | U | N3 | C1 | U2 | W1 | C2 |
| https://burrow.com/products/range-plus-2-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood | Range 2-Piece One Arm Sofa | C1 | C1 | U | N3 | C1 | U1 | W1 | W2 |
| https://burrow.com/products/union-3-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood&Leg+Style=Round+Leg | Union 3-Seat Sofa | C1 | C1 | U | N3 | C1 | N3 | W1 | C2 |
| https://burrow.com/products/ember-pro-3-seat-sofa-96?Fabric=Georgia+Clay+-+Performance+Chenille | Ember Pro 3-Seat Sofa (96") | C1 | C1 | U | N3 | C1 | C1 | W1 | W1 |
| https://burrow.com/products/union-pro-108-3-seat-sofa?Fabric=Ivory+-+Performance+Chenille | Union Pro 108" 3-Seat Sofa | C1 | W1 | U | N3 | C1 | N3 | W1 | W1 |
| https://burrow.com/products/range-plus-3-piece-one-arm-sofa-with-table?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Table+Finish=Oak+Legs+and+Table | Range 3-Piece One Arm Sofa with Table | C1 | C1 | U | N2 | C1 | C1 | W1 | N2 |
| https://burrow.com/products/field-leather-3-piece-sofa?Fabric=Slate+-+Top+Grain+Leather&Leg+Finish=Oak+-+Wood | Field Leather 3-Piece Sofa | C1 | C1 | U | N3 | C1 | N3 | W1 | C1 |
| https://burrow.com/products/union-pro-76-2-seat-sofa?Fabric=Crushed+Gravel+-+Performance+Chenille | Union Pro 76" 2-Seat Sofa | C1 | C1 | U | N3 | C1 | C1 | W1 | W1 |
| https://burrow.com/products/ember-sofa?Size=75%22&Fabric=Georgia+Clay+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood | Ember Sofa | C1 | C1 | U | N3 | C1 | C1 | W1 | W1 |
| https://burrow.com/products/shift-sleeper-sofa?Fabric=Heather+Charcoal+-+Performance+Basketweave | Shift Sleeper Sofa | C1 | C1 | U | U3 | C1 | C1 | W1 | C1 |
| https://burrow.com/products/union-2-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood&Leg+Style=Round+Leg | Union 2-Seat Sofa | C1 | C1 | U | N3 | C1 | C1 | W1 | C2 |

## Wrong values

- **Price** — https://burrow.com/products/range-pro-109-3-seat-sofa?Fabric=Camel+-+Top+Grain+Leather (tile 1)
  - extracted: `1565`
  - judge's reading (uncalibrated): The page shows a price of $2,801.
- **In stock** — https://burrow.com/products/range-pro-109-3-seat-sofa?Fabric=Camel+-+Top+Grain+Leather (tile 1)
  - extracted: `false`
  - judge's reading (uncalibrated): The page shows "Georgia Clay" as the in-stock, ready-to-ship option, not false.
- **Rating** — https://burrow.com/products/range-pro-109-3-seat-sofa?Fabric=Camel+-+Top+Grain+Leather (tile 1)
  - extracted: `4.78`
  - judge's reading (uncalibrated): The page shows a 5-star rating icon with "(286 Reviews)" but no numeric rating value like 4.78.
- **Description** — https://burrow.com/products/range-pro-109-3-seat-sofa?Fabric=Camel+-+Top+Grain+Leather (tile 1)
  - extracted: `Range is our take on modern comfort—plush, laid-back seating designed for everything from streaming marathons to afternoon naps. With clean lines, a low profile…`
  - judge's reading (uncalibrated): The page actually shows: "The award-winning design named one of Wirecutter's Best Sofas—now with deeper proportions, plush cushions, and a grounded, laid-back silhouette. Range Pro blends bold, modern style with ergonomic comfort, all built on Burrow's universal modular system. Customize your layout with added seats, tables, and plug-and-play up
- **Rating** — https://burrow.com/products/span-sleeper-sofa?Fabric=Crushed+Gravel+-+Performance+Chenille (tile 1)
  - extracted: `4.83`
  - judge's reading (uncalibrated): The page shows a 5-star rating (based on 41 reviews), not 4.83.
- **Rating** — https://burrow.com/products/range-plus-4-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood (tile 1)
  - extracted: `4.78`
  - judge's reading (uncalibrated): The page shows a 5-star rating (286 Reviews), not 4.78.
- **Description** — https://burrow.com/products/range-plus-4-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood (tile 2)
  - extracted: `Range is our take on modern comfort—plush, laid-back seating designed for everything from streaming marathons to afternoon naps. With clean lines, a low profile…`
  - judge's reading (uncalibrated): The visible text instead reads about the "Range Plus" upgraded version, describing deeper seats, softer cushions, a smarter modular system, triple-layer cushions, PFAS-free performance fabric, and a refined ergonomic profile—not the "Range" description quoted.
- **Rating** — https://burrow.com/products/range-plus-3-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal (tile 1)
  - extracted: `4.78`
  - judge's reading (uncalibrated): The page shows a 5-star rating (286 Reviews), not a numeric value of 4.78.
- **Description** — https://burrow.com/products/range-plus-3-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal (tile 2)
  - extracted: `Range is our take on modern comfort—plush, laid-back seating designed for everything from streaming marathons to afternoon naps. With clean lines, a low profile…`
  - judge's reading (uncalibrated): The page actually describes "Range Plus," a reimagined modular sofa with deeper seats, softer cushions, plusher triple-layer cushions, PFAS-free performance fabric, and a refined ergonomic profile—not the original "Range" description text shown in the extracted value.
- **Description** — https://burrow.com/products/range-plus-4-piece-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood (tile 2)
  - extracted: `Range is our take on modern comfort—plush, laid-back seating designed for everything from streaming marathons to afternoon naps. With clean lines, a low profile…`
  - judge's reading (uncalibrated): The visible text actually begins mid-sentence ("...inspired design and engineered comfort in a reimagined modular sofa built for real life...") and describes the "Range Plus" upgraded version, not the "Range" description quoted in the extracted value.
- **In stock** — https://burrow.com/products/field-2-piece-sofa?Fabric=Navy+Blue+-+Performance+Basketweave&Leg+Finish=Walnut+-+Wood (tile 1)
  - extracted: `false`
  - judge's reading (uncalibrated): The page shows "Out of stock" only for the Ottoman upgrade option, not for the main product itself.
- **Rating** — https://burrow.com/products/field-2-piece-sofa?Fabric=Navy+Blue+-+Performance+Basketweave&Leg+Finish=Walnut+-+Wood (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows 5 stars (filled star icons) with "(74 Reviews)" but no explicit numeric rating value.
- **Description** — https://burrow.com/products/ember-pro-2-seat-sofa-80?Fabric=Georgia+Clay+-+Performance+Chenille (tile 1)
  - extracted: `Ember features extra-wide, extra-deep seats, plush cushions, and a soft, sculptural silhouette. It’s the kind of comfort you sink into—without sacrificing an ou…`
  - judge's reading (uncalibrated): The page actually reads: "Ember Pro features extra-wide, extra-deep seats, extra-plush cushions, and the same soft, sculptural silhouette you know. It's the kind of comfort you sink into—without sacrificing an ounce of style. Every detail is intentional, from the curved lines to the elevated materials. And now, it's delivered with premium white glove service
- **Rating** — https://burrow.com/products/field-4-piece-sofa?Fabric=Navy+Blue+-+Performance+Basketweave&Leg+Finish=Walnut+-+Wood (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a 5-star rating icon with "(74 Reviews)" but no numeric rating value.
- **Description** — https://burrow.com/products/range-pro-76-2-seat-sofa?Fabric=Camel+-+Top+Grain+Leather (tile 1)
  - extracted: `Range is our take on modern comfort—plush, laid-back seating designed for everything from streaming marathons to afternoon naps. With clean lines, a low profile…`
  - judge's reading (uncalibrated): The page shows: "Laid-back style, reengineered for even more comfort. Modular to expand with you, with plusher cushions, a deeper sit, and grounded, low-slung style."
- **Rating** — https://burrow.com/products/field-leather-4-piece-sofa?Fabric=Slate+-+Top+Grain+Leather&Leg+Finish=Oak+-+Wood (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a 5-star rating icon with "(74 Reviews)" but no explicit numeric rating value.
- **Rating** — https://burrow.com/products/field-leather-2-piece-sofa?Fabric=Slate+-+Top+Grain+Leather&Leg+Finish=Oak+-+Wood (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a 5-star rating icon with "(74 Reviews)" but no numeric rating value is displayed.
- **Rating** — https://burrow.com/products/range-plus-4-piece-one-arm-sofa-lounger?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal (tile 1)
  - extracted: `4.78`
  - judge's reading (uncalibrated): The page shows a 5-star rating with "(286 Reviews)" rather than a numeric 4.78 value.
- **Description** — https://burrow.com/products/range-plus-4-piece-one-arm-sofa-lounger?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal (tile 2)
  - extracted: `Range is our take on modern comfort—plush, laid-back seating designed for everything from streaming marathons to afternoon naps. With clean lines, a low profile…`
  - judge's reading (uncalibrated): The page shows a different description for "Range Plus," emphasizing deeper seats, softer cushions, a smarter modular system, plusher triple-layer cushions, PFAS-free performance fabric, and a refined ergonomic profile—not the "Range" text in the extracted value.
- **Rating** — https://burrow.com/products/union-4-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood&Leg+Style=Round+Leg (tile 1)
  - extracted: `4.67`
  - judge's reading (uncalibrated): The page shows a rating of 5 stars (42 Reviews).
- **Rating** — https://burrow.com/products/range-plus-2-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood (tile 1)
  - extracted: `4.78`
  - judge's reading (uncalibrated): The page shows a 5-star rating (286 Reviews).
- **Description** — https://burrow.com/products/range-plus-2-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Oak+-+Wood (tile 2)
  - extracted: `Range is our take on modern comfort—plush, laid-back seating designed for everything from streaming marathons to afternoon naps. With clean lines, a low profile…`
  - judge's reading (uncalibrated): The page shows a different description: "Inspired design and engineered comfort in a reimagined modular sofa built for real life. With deeper seats, softer cushions, and a smarter modular system, it's designed for how people actually lounge today — stretched out, curled up, and connected. This upgraded version keeps everything you loved about the original: bold low-profile design, flexible configuration, and
- **Rating** — https://burrow.com/products/union-3-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood&Leg+Style=Round+Leg (tile 1)
  - extracted: `4.67`
  - judge's reading (uncalibrated): The page shows a 5-star rating with "(42 Reviews)" but no numeric rating value is displayed.
- **Rating** — https://burrow.com/products/ember-pro-3-seat-sofa-96?Fabric=Georgia+Clay+-+Performance+Chenille (tile 1)
  - extracted: `4.92`
  - judge's reading (uncalibrated): The page shows a 5-star rating (★★★★★) with "(12 Reviews)", not a numeric 4.92.
- **Description** — https://burrow.com/products/ember-pro-3-seat-sofa-96?Fabric=Georgia+Clay+-+Performance+Chenille (tile 1)
  - extracted: `Ember features extra-wide, extra-deep seats, plush cushions, and a soft, sculptural silhouette. It’s the kind of comfort you sink into—without sacrificing an ou…`
  - judge's reading (uncalibrated): The page actually shows: "Ember Pro features extra-wide, extra-deep seats, extra-plush cushions, and the same soft, sculptural silhouette you know. It's the kind of comfort you sink into—without sacrificing an ounce of style. Every detail is intentional, from the curved lines to the elevated materials. And now, it's delivered with premium white glove service
- **Price** — https://burrow.com/products/union-pro-108-3-seat-sofa?Fabric=Ivory+-+Performance+Chenille (tile 1)
  - extracted: `1690`
  - judge's reading (uncalibrated): The page shows the price as $2,196 (discounted from $3,379).
- **Rating** — https://burrow.com/products/union-pro-108-3-seat-sofa?Fabric=Ivory+-+Performance+Chenille (tile 1)
  - extracted: `4.67`
  - judge's reading (uncalibrated): The page shows a 5-star rating (42 Reviews), not 4.67.
- **Description** — https://burrow.com/products/union-pro-108-3-seat-sofa?Fabric=Ivory+-+Performance+Chenille (tile 1)
  - extracted: `Voted one of Esquire's Best Sofas, Union is our most spacious modular sofa - deep, sink-in seating meets modern design and effortless flexibility. Built for lou…`
  - judge's reading (uncalibrated): The page actually shows: "Union Pro takes our most spacious modular design and redefines it with deeper seats, plusher cushions, and elevated proportions for a grounded, modern silhouette. It's the same award-winning comfort - only smarter, softer, and fully assembled for you."
- **Rating** — https://burrow.com/products/range-plus-3-piece-one-arm-sofa-with-table?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Table+Finish=Oak+Legs+and+Table (tile 1)
  - extracted: `4.78`
  - judge's reading (uncalibrated): The page shows a rating of 5 stars (286 Reviews), not 4.78.
- **Rating** — https://burrow.com/products/field-leather-3-piece-sofa?Fabric=Slate+-+Top+Grain+Leather&Leg+Finish=Oak+-+Wood (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a 5-star rating (74 Reviews), not 4.8.
- **Rating** — https://burrow.com/products/union-pro-76-2-seat-sofa?Fabric=Crushed+Gravel+-+Performance+Chenille (tile 1)
  - extracted: `4.67`
  - judge's reading (uncalibrated): The page shows a 5-star rating (42 Reviews), not a numeric value of 4.67.
- **Description** — https://burrow.com/products/union-pro-76-2-seat-sofa?Fabric=Crushed+Gravel+-+Performance+Chenille (tile 1)
  - extracted: `Voted one of Esquire's Best Sofas, Union is our most spacious modular sofa - deep, sink-in seating meets modern design and effortless flexibility. Built for lou…`
  - judge's reading (uncalibrated): The page actually shows: "Union Pro takes our most spacious modular design and redefines it with deeper seats, plusher cushions, and elevated proportions for a grounded, modern silhouette. It's the same award-winning comfort - only smarter, softer, and fully assembled for you."
- **Rating** — https://burrow.com/products/ember-sofa?Size=75%22&Fabric=Georgia+Clay+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood (tile 1)
  - extracted: `4.92`
  - judge's reading (uncalibrated): The page shows a 5-star rating (★★★★★) with 12 Reviews, not a numeric 4.92.
- **Description** — https://burrow.com/products/ember-sofa?Size=75%22&Fabric=Georgia+Clay+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood (tile 1)
  - extracted: `Ember features extra-wide, extra-deep seats, plush cushions, and a soft, sculptural silhouette. It’s the kind of comfort you sink into—without sacrificing an ou…`
  - judge's reading (uncalibrated): The page shows a shorter description ending mid-sentence: "Ember features extra-wide, extra-deep seats, plush cushions, and a soft, sculptural silhouette. It's the kind of comfort you sink into—without sacrificing an ounce of style. Every detail is intentional, from the curved lines to the elevated materials. Proof that comfort and craftsman
- **Rating** — https://burrow.com/products/shift-sleeper-sofa?Fabric=Heather+Charcoal+-+Performance+Basketweave (tile 1)
  - extracted: `4.62`
  - judge's reading (uncalibrated): The page shows a star rating (approximately 4.5 stars) with "(119 Reviews)" but no numeric rating value like "4.62" is displayed.
- **Rating** — https://burrow.com/products/union-2-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Walnut+-+Wood&Leg+Style=Round+Leg (tile 1)
  - extracted: `4.67`
  - judge's reading (uncalibrated): The page shows a 5-star rating (42 Reviews), not a numeric 4.67.

## Notes

```
claude-sonnet-5: 281 req, 771,316 in / 3,330 out
estimated $2.3639 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
