# Judge run — Ridge

> **STOPPED at the $5.00 cap** — the next item would have gone over it.
> 33 of 60 items were judged; the tables cover only those.

- Run: `fcb52e70-119c-46e5-a504-3f75e2878712`
- Site: Ridge (project Campaign 2 2026-10-11)
- When: 2026-10-12T13:16:02.470Z
- Items: 60 items in run, 60 with values, 33 captured, 0 capture failed, judged 33 (limited by cap)
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $5.0250 (cap $5.00)
- Time: 31m 30s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 33 | 0 | 10 | 22 | 0 | 1 | 0 | 0% |
| Price | 33 | 0 | 0 | 33 | 0 | 0 | 0 | — |
| Main image | 33 | 0 | 0 | 0 | 33 | 0 | 0 | — |
| SKU | 33 | 0 | 0 | 33 | 0 | 0 | 0 | — |
| Brand | 33 | 30 | 1 | 0 | 2 | 0 | 0 | 97% |
| In stock | 33 | 0 | 0 | 6 | 27 | 0 | 0 | — |
| Rating | 33 | 2 | 3 | 27 | 1 | 0 | 0 | 40% |
| Description | 28 | 3 | 3 | 22 | 0 | 0 | 5 | 50% |

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://ridge.com/products/us-army?variant=42058806624330 | Ridge Wallet – U.S. Army \| Officially Licensed U.S. Military Gear | W2 | N3 | U | N3 | U1 | N3 | N3 | N3 |
| https://ridge.com/products/thunderbird?variant=43444919304266 | Ridge Wallet - Thunderbird \| Limited Edition, 90s Inspired | N3 | N3 | U | N3 | C2 | U1 | N3 | N3 |
| https://ridge.com/products/batman?variant=43816271904842 | Ridge Wallet - Batman™ \| NO POWERS. JUST PREPARATION. | N3 | N3 | U | N3 | U2 | U1 | N3 | N3 |
| https://ridge.com/products/titanium-summit-matte-olive?variant=43791496249418 | Ridge Wallet - Olive Titanium - Summit | N3 | N3 | U | N3 | C2 | U1 | N3 | · |
| https://ridge.com/products/gt?variant=42112921469002 | Ridge Wallet - GT \| BEYOND THE FINISH LINE | N3 | N3 | U | N3 | C2 | U1 | N3 | N3 |
| https://ridge.com/products/kintsugi-inverse?variant=44228794515530 | Ridge Wallet – Kintsugi - Inverse \| DETAIL IN DESIGN | E1 | N3 | U | N3 | C3 | U1 | N3 | C1 |
| https://ridge.com/products/magsafe-wallet-dark-harbor?variant=43213147701322 | Ridge Wallet for MagSafe - Dark Harbor | W3 | N3 | U | N3 | C1 | U1 | W3 | N3 |
| https://ridge.com/products/great-smoky-mountains?variant=43598846132298 | Ridge Wallet - Great Smoky Mountains \| Iconic Terrain. Daily Carry. | N3 | N3 | U | N3 | C2 | U1 | N3 | W2 |
| https://ridge.com/products/burnt-damascus?variant=40185974521930 | Burnt Damascus Ridge Wallet | W2 | N3 | U | N3 | C2 | U2 | N3 | N3 |
| https://ridge.com/products/tiger-stripe?variant=43528678867018 | Ridge Wallet - Tiger Stripe \| CAMO MEETS YOUR TECH SYSTEM | W3 | N3 | U | N3 | C3 | U1 | N3 | N3 |
| https://ridge.com/products/gold-horizon?variant=43209271574602 | Ridge Wallet - Gold Horizon \| Golden Transformation | N3 | N3 | U | N3 | C2 | U1 | N3 | N3 |
| https://ridge.com/products/magsafe-wallet-batman?variant=43816313815114 | Ridge Wallet for MagSafe - Batman™ \| THE EVERYDAY HERO'S CARRY | N3 | N3 | U | N3 | C1 | U2 | N3 | N3 |
| https://ridge.com/products/batman-no-1?variant=43816286453834 | Ridge Wallet - Batman™ No. 1 \| GEAR FOR THE PREPARED | W1 | N3 | U | N3 | C3 | U1 | N3 | N3 |
| https://ridge.com/products/titanium-burnt?variant=41253474638 | Burnt Titanium Wallet - Sleek & Durable \| The Ridge | N3 | N3 | U | N3 | C3 | U1 | W3 | C2 |
| https://ridge.com/products/hot-rod?variant=43444911702090 | Ridge Wallet - Hot Rod \| Flames, Lightning, Wallet Chains | N3 | N3 | U | N3 | C2 | U1 | N3 | N3 |
| https://ridge.com/products/mkbhd-vapor?variant=42668120571978 | Ridge Wallet - MKBHD Vapor \| SURREAL FUNCTION | N3 | N3 | U | N3 | C2 | U2 | N3 | N3 |
| https://ridge.com/products/24-karat-gold | Gold Wallet — 24 Karat, Minimalist, Lifetime Guarantee // Ridge | N3 | N3 | U | N3 | C2 | U1 | N3 | N3 |
| https://ridge.com/products/yosemite?variant=43598845214794 | Ridge Wallet - Yosemite \| Iconic Terrain. Daily Carry. | N3 | N3 | U | N3 | C2 | U2 | N3 | W2 |
| https://ridge.com/products/platinum | Ridge Wallet - Platinum \| MONDAY THROUGH PLATINUM | N3 | N3 | U | N3 | C2 | U1 | N3 | N3 |
| https://ridge.com/products/titanium-terrain-matte-black?variant=43791495757898 | Ridge Wallet - Black Titanium - Terrain | N3 | N3 | U | N3 | W2 | U1 | N3 | · |
| https://ridge.com/products/magsafe-wallet-neon-tiger?variant=43528717107274 | Ridge Wallet for MagSafe - Neon Tiger \| NO NEUTRAL GROUND | N3 | N3 | U | N3 | C1 | N3 | N3 | N3 |
| https://ridge.com/products/forged-summit?variant=43791496052810 | Ridge Wallet - Forged Summit | N3 | N3 | U | N3 | C2 | U2 | N3 | · |
| https://ridge.com/products/magsafe-wallet-alpine-navy?variant=41051472461898 | Ridge Wallet For MagSafe - Alpine Navy \| The Ridge | W3 | N3 | U | N3 | C3 | N3 | C3 | N3 |
| https://ridge.com/products/aluminum-gunmetal?variant=41253314126 | Gunmetal Wallet: High-Grade Aluminum — Minimalist // The Ridge | N3 | N3 | U | N3 | C3 | U1 | N3 | N3 |
| https://ridge.com/products/daily-driver-kit-almond-surfboards?variant=43631485059146 | Ridge x Almond Surfboards \| Daily Driver Set \| Wallet & KeyCase | W1 | N3 | U | N3 | C3 | N3 | W3 | C2 |
| https://ridge.com/products/tobacco-brown?variant=40316821307466 | Ridge Wallet — Tobacco Brown \| Leather | N3 | N3 | U | N3 | C2 | U1 | N3 | N3 |
| https://ridge.com/products/titanium-matte-olive | The Ridge Wallet: Titanium - Matte Olive | W2 | N3 | U | N3 | C3 | U2 | U3 | N3 |
| https://ridge.com/products/magsafe-wallet-carbon-fiber-3k?variant=41042477875274 | Ridge Wallet For MagSafe - Carbon Fiber 3k \| The Ridge | W3 | N3 | U | N3 | C1 | N3 | C3 | N3 |
| https://ridge.com/products/american-traditional?variant=43765981675594 | Ridge Wallet - American Traditional | N3 | N3 | U | N3 | C2 | U1 | N3 | · |
| https://ridge.com/products/dark-harbor?variant=43209292054602 | Ridge Wallet - Dark Harbor \| Quiet Mystery | N3 | N3 | U | N3 | C3 | U1 | N3 | N3 |
| https://ridge.com/products/gt-silver?variant=42322751553610 | Ridge Wallet - GT Silver \| TRACK-TESTED COLORS | N3 | N3 | U | N3 | C2 | U1 | N3 | · |
| https://ridge.com/products/forgedfetti?variant=43305196912714 | Ridge Wallet - Forgedfetti \| Innovation Doesn't Take A Year Off | N3 | N3 | U | N3 | C2 | N3 | N3 | W2 |
| https://ridge.com/products/baja-gt?variant=43794128437322 | Ridge Wallet 2.0 - Baja GT | W1 | N3 | U | N3 | C2 | U2 | N3 | N3 |

## Wrong values

- **Title** — https://ridge.com/products/us-army?variant=42058806624330 (tile 2)
  - extracted: `Ridge Wallet`
  - judge's reading (uncalibrated): The page shows no visible title field, only partially cropped text with a bullet list and headings like "SHIPPING + LIFETIME W..." — no clear "Ridge Wallet" title is visible.
- **Title** — https://ridge.com/products/magsafe-wallet-dark-harbor?variant=43213147701322 (tile 3)
  - extracted: `Ridge Wallet For MagSafe`
  - judge's reading (uncalibrated): Ridge Wallet
- **Rating** — https://ridge.com/products/magsafe-wallet-dark-harbor?variant=43213147701322 (tile 3)
  - extracted: `4.5`
  - judge's reading (uncalibrated): The page shows a 5-star rating (★★★★★) with 52,759 reviews, not 4.5.
- **Description** — https://ridge.com/products/great-smoky-mountains?variant=43598846132298 (tile 2)
  - extracted: `Iconic Terrain. Daily Carry. Translated from real elevation data and precision-engraved into the wallet and keycase. Recognizable landscapes on Ridge's core car…`
  - judge's reading (uncalibrated): The page shows no "Description" value matching that text; it instead lists product bullet points like "Lighter. Smarter. Still Ridge." and spec details.
- **Title** — https://ridge.com/products/burnt-damascus?variant=40185974521930 (tile 2)
  - extracted: `Ridge Wallet`
  - judge's reading (uncalibrated): The page does not show a clear "Ridge Wallet" title; the only visible headings are "FEATURES" and "SHIPPING + LIFETIME W..." sections.
- **Title** — https://ridge.com/products/tiger-stripe?variant=43528678867018 (tile 3)
  - extracted: `Ridge Wallet`
  - judge's reading (uncalibrated): The page shows the title "10% Lighter–Weig..." (truncated heading), not "Ridge Wallet".
- **Title** — https://ridge.com/products/batman-no-1?variant=43816286453834 (tile 1)
  - extracted: `Ridge Wallet`
  - judge's reading (uncalibrated): No title is visible on the page.
- **Rating** — https://ridge.com/products/titanium-burnt?variant=41253474638 (tile 3)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a 5-star rating with 2,162 reviews, not a numeric rating of 4.8.
- **Description** — https://ridge.com/products/yosemite?variant=43598845214794 (tile 2)
  - extracted: `Iconic Terrain. Daily Carry. Translated from real elevation data and precision-engraved into the wallet and keycase. Recognizable landscapes on Ridge's core car…`
  - judge's reading (uncalibrated): The page shows no value for a "Description" field; the visible text is a bulleted feature/specs list, not a description matching the extracted value.
- **Brand** — https://ridge.com/products/titanium-terrain-matte-black?variant=43791495757898 (tile 2)
  - extracted: `Ridge`
  - judge's reading (uncalibrated): The page shows no value for "Brand" visible in the screenshot.
- **Title** — https://ridge.com/products/magsafe-wallet-alpine-navy?variant=41051472461898 (tile 3)
  - extracted: `Ridge Wallet For Magsafe`
  - judge's reading (uncalibrated): The page shows the title "Daily Driver Kit for MagSafe".
- **Title** — https://ridge.com/products/daily-driver-kit-almond-surfboards?variant=43631485059146 (tile 1)
  - extracted: `Daily Driver Set`
  - judge's reading (uncalibrated): No title is visible anywhere on the page.
- **Rating** — https://ridge.com/products/daily-driver-kit-almond-surfboards?variant=43631485059146 (tile 3)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a rating of 5 stars with 2,162 reviews, not 4.8.
- **Title** — https://ridge.com/products/titanium-matte-olive (tile 2)
  - extracted: `Ridge Wallet`
  - judge's reading (uncalibrated): The page shows no title field, only section headings like "FEATURES" and "SHIPPING + LIFETIME WARRANTY."
- **Title** — https://ridge.com/products/magsafe-wallet-carbon-fiber-3k?variant=41042477875274 (tile 3)
  - extracted: `Ridge Wallet For Magsafe`
  - judge's reading (uncalibrated): The page shows the title "Daily Driver Kit for MagSafe".
- **Description** — https://ridge.com/products/forgedfetti?variant=43305196912714 (tile 2)
  - extracted: `Introducing our limited Anniversary releases: Iridescent and Forgedfetti. Thirteen years of material innovation has led to these advanced finishing processes—Ir…`
  - judge's reading (uncalibrated): No description is visible on the page; the text is cut off and unreadable, so this value cannot be confirmed.
- **Title** — https://ridge.com/products/baja-gt?variant=43794128437322 (tile 1)
  - extracted: `Ridge Wallet`
  - judge's reading (uncalibrated): No title is visible on the page.

## Notes

```
claude-sonnet-5: 600 req, 1,652,486 in / 4,500 out
estimated $5.0250 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
