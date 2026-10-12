# Judge run — Gymshark

- Run: `a6db90da-b26f-458e-a3d1-aef0431f051b`
- Site: Gymshark (project Campaign 2 2026-10-11)
- When: 2026-10-12T10:13:39.836Z
- Items: 60 items in run, 60 with values, 60 captured, 0 capture failed, judged 60
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $4.9124 (cap $5.00)
- Time: 30m 23s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 60 | 59 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 60 | 0 | 0 | 0 | 60 | 0 | 0 | — |
| SKU | 60 | 0 | 0 | 56 | 4 | 0 | 0 | — |
| Brand | 60 | 8 | 24 | 15 | 13 | 0 | 0 | 25% |
| In stock | 60 | 44 | 1 | 5 | 10 | 0 | 0 | 98% |
| Rating | 33 | 33 | 0 | 0 | 0 | 0 | 27 | 100% |
| Description | 55 | 46 | 7 | 0 | 2 | 0 | 5 | 87% |

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-brown-aw26 | Gymshark Whitney Twist Sports Bra - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-leggings-leggings-purple-aw26 | Gymshark Adapt Solid Leggings - Cherry Purple \| Gymshark | C1 | C1 | U | N3 | C1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-pocket-leggings-leggings-brown-aw26 | Gymshark Whitney High-Rise Pocket Leggings - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | U3 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-shorts-shorts-brown-aw26 | Gymshark Everyday Seamless Shorts - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-zip-front-top-sleeveless-tops-black-aw26 | Gymshark Adapt Solid Zip Front Top - Black \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-pink-aw26 | Gymshark Whitney Twist Sports Bra - Strength Pink \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-jacket-jackets-outerwear-purple-aw26 | Gymshark Adapt Solid Jacket - Cherry Purple \| Gymshark | C1 | C1 | U | N3 | U1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-mid-rise-legging-leggings-brown-aw26 | Gymshark Whitney Mid-Rise Leggings - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | U1 | U1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-halter-neck-tank-sleeveless-tops-black-aw26 | Gymshark Adapt Solid Halter Neck Tank - Black \| Gymshark | C1 | C1 | U | U2 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-flared-legging-leggings-black-aw25 | Gymshark Everyday Seamless Flared Leggings - Black \| Gymshark | C1 | C1 | U | N3 | N3 | U3 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-pumper-pants-black-ss24 | Gymshark Pumper Pants - Black \| Gymshark | C1 | C1 | U | N3 | W1 | W1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-power-washed-joggers-pants-black-aw25 | Gymshark Power Washed Joggers - Black/Acid Wash Small Ball \| Gymshark | C1 | C1 | U | N3 | N3 | N3 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-black-aw23 | Gymshark Everyday Seamless Leggings - Black \| Gymshark | C1 | C1 | U | N3 | N3 | U3 | C1 | W1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-blue-aw26 | Gymshark Adapt Solid Shorts - Tranquil Blue \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-shorts-shorts-black-aw26 | Gymshark Whitney High-Rise Shorts - Black \| Gymshark | C1 | C1 | U | N3 | W1 | U1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-solid-sports-bra-sports-bras-purple-aw26 | Gymshark Adapt Solid Sports Bra - Cherry Purple \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-pink-aw26 | Gymshark Everyday Seamless Leggings - Strength Pink \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-animal-x-whitney-halter-neck-shelf-cami-sleeveless-tops-black-aw26 | Gymshark Adapt Animal x Whitney Halter Neck Shelf Cami - Black/Asphalt Grey \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | · |
| https://www.gymshark.com/products/gymshark-whitney-mid-rise-legging-leggings-black-ss26 | Gymshark Whitney Mid-Rise Leggings - Black \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-whitney-leggings-leggings-black-aw26 | Gymshark Whitney High-Rise Regular Leggings - Black \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-yellow-aw26 | Gymshark Whitney Twist Sports Bra - Butter Yellow \| Gymshark | C1 | C1 | U | N3 | U1 | U2 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-yellow-aw26 | Gymshark Adapt Solid Shorts - Butter Yellow \| Gymshark | C1 | C1 | U | N3 | U1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-soft-sculpt-leggings-black-ss25 | Gymshark Soft Sculpt Leggings - Black \| Gymshark | C1 | C1 | U | U2 | U1 | C1 | C1 | · |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-leggings-leggings-black-aw26 | Gymshark Adapt Solid Leggings - Black \| Gymshark | C1 | C1 | U | N3 | W1 | N3 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-leggings-leggings-blue-aw26 | Gymshark Whitney High-Rise Regular Leggings - Heavy Blue \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-green-aw26 | Gymshark Adapt Solid Shorts - Sprint Green \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-mid-rise-mini-flare-leggings-brown-aw26 | Gymshark Whitney Mid-Rise Mini Flare Regular - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | W1 |
| https://www.gymshark.com/products/gymshark-whitney-mini-flare-leggings-blue-aw26 | Gymshark Whitney High-Rise Mini Flare Regular - Heavy Blue \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-adapt-animal-x-whitney-halter-neck-sports-bra-sports-bras-black-aw26 | Gymshark Adapt Animal x Whitney Halter Neck Sports Bra - Black/Asphalt Grey \| Gymshark | E1 | C1 | U | N3 | C3 | C1 | · | · |
| https://www.gymshark.com/products/gymshark-whitney-mini-flare-leggings-black-aw26 | Gymshark Whitney High-Rise Mini Flare Regular - Black \| Gymshark | C1 | C1 | U | N3 | C1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-shorts-shorts-brown-aw26 | Gymshark Whitney High-Rise Shorts - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | U1 | U1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-whitney-mini-flare-leggings-brown-aw26 | Gymshark Whitney High-Rise Mini Flare Regular - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | U1 | U1 | · | U1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-jacket-jackets-outerwear-black-aw26 | Gymshark Adapt Solid Jacket - Black \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-purple-aw25 | Gymshark Everyday Seamless Leggings - Cherry Purple \| Gymshark | C1 | C1 | U | N3 | C1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-whitney-leggings-leggings-pink-aw26 | Gymshark Whitney High-Rise Regular Leggings - Strength Pink \| Gymshark | C1 | C1 | U | N3 | N3 | U3 | C1 | W1 |
| https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-blue-aw26 | Gymshark Whitney Twist Sports Bra - Heavy Blue \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-shorts-black-aw23 | Gymshark Everyday Seamless Shorts - Black \| Gymshark | C1 | C1 | U | N3 | U3 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-whitney-twist-front-shelf-tank-sleeveless-tops-black-aw26 | Gymshark Whitney Twist Front Shelf Tank - Black \| Gymshark | C1 | C1 | U | N3 | C1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26 | Gymshark Everyday Seamless Leggings - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | U1 | C1 | C1 | W1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-halter-neck-tank-sleeveless-tops-purple-aw26 | Gymshark Adapt Solid Halter Neck Tank - Cherry Purple \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-mini-flare-leggings-pink-aw26 | Gymshark Whitney High-Rise Mini Flare Regular - Strength Pink \| Gymshark | C1 | C1 | U | N3 | C1 | C1 | · | U1 |
| https://www.gymshark.com/products/gymshark-form-wide-leg-pants-pants-brown-aw26 | Gymshark Lightweight Wide Leg Pants Regular - Soft Brown \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-cotton-blend-seamless-flared-leggings-leggings-grey-aw26 | Gymshark CottonMove™ Flared Leggings - Soft Grey Marl \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | C1 | W1 |
| https://www.gymshark.com/products/gymshark-whitney-pocket-leggings-leggings-black-aw26 | Gymshark Whitney High-Rise Pocket Leggings - Black \| Gymshark | C1 | C1 | U | N3 | C1 | U2 | · | C1 |
| https://www.gymshark.com/products/gymshark-adapt-solid-sports-bra-sports-bras-black-aw26 | Gymshark Adapt Solid Sports Bra - Black \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-purple-aw26 | Gymshark Adapt Solid Shorts - Cherry Purple \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-black-aw26 | Gymshark Whitney Twist Sports Bra - Black \| Gymshark | C1 | C1 | U | N3 | C1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-featherform-v-neck-bralette-underwear-black-ss26 | Gymshark FeatherForm™ V-Neck Bralette - Black \| Gymshark | C1 | C1 | U | N3 | W1 | N3 | C1 | · |
| https://www.gymshark.com/products/gymshark-track-pants-pants-black-aw26 | Gymshark Track Pants - Black \| Gymshark | C1 | C1 | U | U3 | N3 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-whitney-mini-flare-short-leggings-black-aw26 | Gymshark Whitney High-Rise Mini Flare Short - Black \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-purple-aw26 | Gymshark Whitney Twist Sports Bra - Pace Purple \| Gymshark | C1 | C1 | U | U1 | U1 | C1 | C1 | W1 |
| https://www.gymshark.com/products/gymshark-whitney-mid-rise-mini-flare-leggings-black-aw26 | Gymshark Whitney Mid-Rise Mini Flare Regular - Black \| Gymshark | C1 | C1 | U | N3 | N3 | C1 | · | W1 |
| https://www.gymshark.com/products/gymshark-cosy-luxe-straight-leg-regular-joggers-pants-black-aw26 | Gymshark Cosy Luxe Straight Leg Regular Joggers - Black \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-grey-aw26 | Gymshark Everyday Seamless Leggings - Onyx Grey \| Gymshark | C1 | C1 | U | N3 | U1 | C1 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-black-aw26 | Gymshark Adapt Solid Shorts - Black \| Gymshark | C1 | C1 | U | N3 | N3 | U1 | · | C1 |
| https://www.gymshark.com/products/gymshark-everyday-seamless-flared-leggings-leggings-pink-aw26 | Gymshark Everyday Seamless Flared Leggings - Strength Pink \| Gymshark | C1 | C1 | U | N3 | N3 | N3 | C1 | C1 |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-pink-aw26 | Gymshark Adapt Solid Shorts - Performance Pink \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-adapt-animal-x-whitney-long-sleeve-crop-top-ls-tops-black-aw26 | Gymshark Adapt Animal x Whitney Long Sleeve Crop Top - Black/Asphalt Grey \| Gymshark | C1 | C1 | U | N3 | W1 | N3 | · | · |
| https://www.gymshark.com/products/gymshark-adapt-x-whitney-leggings-leggings-blue-aw26 | Gymshark Adapt Solid Leggings - Tranquil Blue \| Gymshark | C1 | C1 | U | N3 | W1 | C1 | · | C1 |
| https://www.gymshark.com/products/gymshark-whitney-leggings-leggings-brown-aw26 | Gymshark Whitney High-Rise Regular Leggings - Espresso Brown \| Gymshark | C1 | C1 | U | N3 | U1 | C1 | C1 | C1 |

## Wrong values

- **Brand** — https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-brown-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-zip-front-top-sleeveless-tops-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Brand is shown as "GYMSHARK" (the logo text in the header), not "Gymshark \| We Do Gym".
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-halter-neck-tank-sleeveless-tops-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-pumper-pants-black-ss24 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark
- **In stock** — https://www.gymshark.com/products/gymshark-pumper-pants-black-ss24 (tile 1)
  - extracted: `false`
  - judge's reading (uncalibrated): The page shows no explicit "In stock" field; sizes XS and S are crossed out/unavailable, while M, L, XL, and XXL appear selectable.
- **Description** — https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-black-aw23 (tile 1)
  - extracted: `Designed for any kind of training such as hybrid, lifting and studio. These leggings are high waisted and made from soft seamless fabric.`
  - judge's reading (uncalibrated): The actual description text is cut off with "Learn more" and reads: "Designed for any kind of training such as hybrid, lifting and studio. These leggings are high waisted and made from soft seamless…" (truncated with ellipsis, not the full sentence shown).
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-blue-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-whitney-shorts-shorts-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-solid-sports-bra-sports-bras-purple-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK" (logo text only, no tagline).
- **Brand** — https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-pink-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-animal-x-whitney-halter-neck-shelf-cami-sleeveless-tops-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK" (logo text only, no tagline).
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-leggings-leggings-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-green-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-whitney-mid-rise-mini-flare-leggings-brown-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Brand is "GYMSHARK" (shown as the logo text in the header).
- **Description** — https://www.gymshark.com/products/gymshark-whitney-mid-rise-mini-flare-leggings-brown-aw26 (tile 1)
  - extracted: `Made with our ButterSmoothTM fabric. Designed for lifting. These leggings are mid-rise with a mini flared leg and made from stretchy, buttery soft, squat-proof …`
  - judge's reading (uncalibrated): The page shows a truncated description: "Made with our ButterSmooth™ fabric. Designed for lifting. These leggings are mid-rise with a mini flared leg and made from…" followed by a "Learn more" link, so the full text is not visible.
- **Brand** — https://www.gymshark.com/products/gymshark-whitney-mini-flare-leggings-blue-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-jacket-jackets-outerwear-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark
- **Description** — https://www.gymshark.com/products/gymshark-whitney-leggings-leggings-pink-aw26 (tile 1)
  - extracted: `Made with our ButterSmoothTM fabric. Designed for lifting. These leggings are high-rise and made from stretchy, buttery soft, squat-proof fabric.`
  - judge's reading (uncalibrated): The page shows the description truncated as "Made with our ButterSmooth™ fabric. Designed for lifting. These leggings are high-rise and made from stretchy, buttery soft, squa..." with a "Learn more" link, not the full sentence shown in the extracted value.
- **Brand** — https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-blue-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK" (logo text only, no tagline).
- **Description** — https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26 (tile 1)
  - extracted: `Designed for any kind of training such as hybrid, lifting and studio. These leggings are high waisted and made from soft seamless fabric.`
  - judge's reading (uncalibrated): The page shows the description as "Designed for any kind of training such as hybrid, lifting and studio. These leggings are high waisted and made from soft seamless…" (truncated with a "Learn more" link, not the full sentence shown).
- **Brand** — https://www.gymshark.com/products/gymshark-form-wide-leg-pants-pants-brown-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark
- **Description** — https://www.gymshark.com/products/gymshark-cotton-blend-seamless-flared-leggings-leggings-grey-aw26 (tile 1)
  - extracted: `Made with our CottonMoveTM fabric. Designed for studio workouts. These leggings have an adjustable (mid- or low-rise) waistband, are flared leg and are made fro…`
  - judge's reading (uncalibrated): The page only shows a truncated description ending in "...waist-" before being cut off by "Learn more," not the full text in the extracted value.
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-solid-sports-bra-sports-bras-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-purple-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-featherform-v-neck-bralette-underwear-black-ss26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): The page shows the brand as "GYMSHARK."
- **Brand** — https://www.gymshark.com/products/gymshark-whitney-mini-flare-short-leggings-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark
- **Description** — https://www.gymshark.com/products/gymshark-whitney-twist-sports-bra-sports-bras-purple-aw26 (tile 1)
  - extracted: `Made with our ButterSmoothTM fabric. Designed for lifting. This sports bra is light support and made from stretchy, buttery soft fabric.`
  - judge's reading (uncalibrated): The page shows the description as "Made with our ButterSmooth™ fabric. Designed for lifting. This sports bra is light support and made from stretchy, buttery soft..." (truncated, followed by a "Learn more" link).
- **Description** — https://www.gymshark.com/products/gymshark-whitney-mid-rise-mini-flare-leggings-black-aw26 (tile 1)
  - extracted: `Made with our ButterSmoothTM fabric. Designed for lifting. These leggings are mid-rise with a mini flared leg and made from stretchy, buttery soft, squat-proof …`
  - judge's reading (uncalibrated): The page only shows the truncated text "Made with our ButterSmooth™ fabric. Designed for lifting. These leggings are mid-rise with a mini flared leg and made from…" followed by a "Learn more" link, not the full sentence stated in the extracted value.
- **Brand** — https://www.gymshark.com/products/gymshark-cosy-luxe-straight-leg-regular-joggers-pants-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-shorts-shorts-pink-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): "GYMSHARK"
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-animal-x-whitney-long-sleeve-crop-top-ls-tops-black-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Brand is shown simply as "GYMSHARK" in the site header.
- **Brand** — https://www.gymshark.com/products/gymshark-adapt-x-whitney-leggings-leggings-blue-aw26 (tile 1)
  - extracted: `Gymshark | We Do Gym`
  - judge's reading (uncalibrated): Gymshark

## Notes

```
claude-sonnet-5: 589 req, 1,616,988 in / 4,099 out
estimated $4.9124 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
